param(
  [Parameter(Mandatory=$true)][string]$Base,
  [string]$AdminKey = '',
  [ValidateSet('cameras','tv_mounting')][string]$Service = 'cameras',
  [string]$Surface = 'bundles',
  [string]$WeekOf = '',
  [string]$VideoPath = ''
)

$ErrorActionPreference = 'Stop'

function Assert-Ok($cond, $msg) {
  if (-not $cond) { throw $msg }
}

function Put-ToSignedUrlMultipart($signedUrl, $filePath) {
  # Windows PowerShell 5.1 doesn't support Invoke-WebRequest -Form.
  # Supabase signed upload URL expects multipart/form-data with an empty field name.
  $httpCode = & curl.exe -sS -o NUL -w "%{http_code}" -X PUT `
    -F "cacheControl=3600" `
    -F "=@$filePath" `
    "$signedUrl"
  return [int]$httpCode
}

Write-Output "[1/5] Preparing fixture file..."
$headers = @{}
# Proof endpoints no longer require x-admin-key; keep this optional for compatibility.
$effectiveAdminKey = $AdminKey
if (-not $effectiveAdminKey) { $effectiveAdminKey = $env:ADMIN_KEY }
if ($effectiveAdminKey) { $headers["x-admin-key"] = $effectiveAdminKey }

$tmp = $null
if ($VideoPath -and (Test-Path $VideoPath)) {
  $tmp = $VideoPath
  Write-Output ("Using provided file: " + $tmp)
} else {
  Write-Output "No -VideoPath provided; creating a tiny placeholder file."
  Write-Output "Note: conversion success is not guaranteed with placeholder bytes; pass a real MP4/MOV for a true top-to-bottom test."
  # Tiny ISO-BMFF-ish payload (may not be a fully valid video). This at least exercises the server spawn path.
  $mp4Base64 = @'
AAAAHGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAABxtZGF0AAAAAA==
'@ -replace "\s+", ""
  $bytes = [Convert]::FromBase64String($mp4Base64)
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("h2s_e2e_" + [Guid]::NewGuid().ToString('n') + ".mp4")
  [System.IO.File]::WriteAllBytes($tmp, $bytes)
}

Assert-Ok ((Test-Path $tmp) -and ((Get-Item $tmp).Length -gt 0)) "Fixture file not created"

try {
  Write-Output "[2/5] Init staged upload (signed URL)..."
  $initBody = @{ surface=$Surface; service=$Service; week_of=$WeekOf; bucket='proof'; filename='sample.mov'; mime='video/quicktime'; media_kind='video' } | ConvertTo-Json
  $init = Invoke-RestMethod -Method Post -Uri "$Base/api/admin/proof-upload-init" -Headers $headers -ContentType "application/json" -Body $initBody
  Assert-Ok ($init.ok -eq $true) "Init failed"
  Assert-Ok ($init.signed_url -and $init.raw_path) "Init missing signed_url/raw_path"

  Write-Output "[3/5] PUT file directly to Supabase signed URL..."
  $putCode = Put-ToSignedUrlMultipart -signedUrl $init.signed_url -filePath $tmp
  Assert-Ok ($putCode -ge 200 -and $putCode -lt 300) ("PUT failed: HTTP " + $putCode)

  Write-Output "[4/5] Finalize without conversion..."
  $finalBody1 = @{ bucket='proof'; raw_path=$init.raw_path; filename='sample.mov'; mime='video/quicktime'; surface=$Surface; service=$Service; week_of=$WeekOf; media_kind='video'; convert_to_mp4='0' } | ConvertTo-Json
  $final1 = Invoke-RestMethod -Method Post -Uri "$Base/api/admin/proof-upload-finalize" -Headers $headers -ContentType "application/json" -Body $finalBody1
  Assert-Ok ($final1.ok -eq $true) ("Finalize (no convert) failed: " + ($final1.error | Out-String))

  Write-Output "[5/5] Finalize WITH conversion (forces ffmpeg invocation)..."
  # Need a new staged upload for the second finalize, because finalize deletes raw_path.
  $init2 = Invoke-RestMethod -Method Post -Uri "$Base/api/admin/proof-upload-init" -Headers $headers -ContentType "application/json" -Body $initBody
  Assert-Ok ($init2.ok -eq $true) "Init2 failed"
  $putCode2 = Put-ToSignedUrlMultipart -signedUrl $init2.signed_url -filePath $tmp
  Assert-Ok ($putCode2 -ge 200 -and $putCode2 -lt 300) ("PUT2 failed: HTTP " + $putCode2)

  $finalBody2 = @{ bucket='proof'; raw_path=$init2.raw_path; filename='sample.mov'; mime='video/quicktime'; surface=$Surface; service=$Service; week_of=$WeekOf; media_kind='video'; convert_to_mp4='1' } | ConvertTo-Json
  $final2 = Invoke-RestMethod -Method Post -Uri "$Base/api/admin/proof-upload-finalize" -Headers $headers -ContentType "application/json" -Body $finalBody2
  Assert-Ok ($final2.ok -eq $true) ("Finalize (convert) failed: " + ($final2.error | Out-String))

  Write-Output "\nRESULTS"
  Write-Output ("- No-convert stored: " + $final1.path)
  Write-Output ("- Convert stored:    " + $final2.path)
  Write-Output ("- converted_to_mp4:  " + $final2.converted_to_mp4)
  if ($final2.warnings) { Write-Output ("- warnings:          " + ($final2.warnings -join ' | ')) }
} finally {
  if (-not $VideoPath) {
    try { Remove-Item -Force $tmp } catch {}
  }
}
