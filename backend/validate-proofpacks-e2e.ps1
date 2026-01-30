param(
  [Parameter(Mandatory=$true)][string]$Base,
  [ValidateSet('cameras','tv_mounting')][string]$Service = 'cameras',
  [string]$Surface = 'bundles',
  [string]$WeekOf = '',
  [string]$VideoPath = '',
  [string]$Origin = 'http://127.0.0.1:3000'
)

$ErrorActionPreference = 'Stop'

function Fail($msg) { throw $msg }
function Ok($msg) { Write-Host ("OK  " + $msg) }
function Info($msg) { Write-Host ("... " + $msg) }

function Invoke-Curl([string[]]$curlArgs) {
  $out = & curl.exe @curlArgs 2>&1
  return ($out | Out-String)
}

function Get-Json([string]$url, [hashtable]$headers) {
  $h = @()
  foreach ($k in $headers.Keys) {
    $h += @('-H', ("{0}: {1}" -f $k, $headers[$k]))
  }
  $resp = Invoke-Curl @('-sS', '-i', $url) + ""
  return $resp
}

function Assert-Contains([string]$haystack, [string]$needle, [string]$msg) {
  if ($haystack -notmatch [regex]::Escape($needle)) { Fail $msg }
}

function Extract-JsonBody([string]$http) {
  $parts = $http -split "\r?\n\r?\n", 2
  if ($parts.Length -lt 2) { return '' }
  return $parts[1].Trim()
}

function Extract-Status([string]$http) {
  $m = [regex]::Match($http, "HTTP/\d+\.\d+\s+(\d+)")
  if (-not $m.Success) { return 0 }
  return [int]$m.Groups[1].Value
}

function Post-Json([string]$url, [string]$jsonBody, [hashtable]$headers) {
  try {
    $resp = Invoke-WebRequest -Method POST -Uri $url -Headers $headers -ContentType 'application/json' -Body $jsonBody -UseBasicParsing -ErrorAction Stop
    return @{ status = [int]$resp.StatusCode; content = [string]$resp.Content }
  } catch [System.Net.WebException] {
    $we = $_.Exception
    if ($we.Response) {
      $r = [System.Net.HttpWebResponse]$we.Response
      $sr = New-Object System.IO.StreamReader($r.GetResponseStream())
      $content = $sr.ReadToEnd()
      try { $sr.Close() } catch {}
      return @{ status = [int]$r.StatusCode; content = [string]$content }
    }
    throw
  }
}

function Generate-TestMov() {
  Info "Generating a real 1s .mov using ffmpeg-static"
  $ff = (& node -e "process.stdout.write(require('ffmpeg-static')||'')")
  if (-not $ff) { Fail "ffmpeg-static path not found (node require('ffmpeg-static') returned empty)" }

  $out = Join-Path $env:TEMP ("proofpacks_e2e_" + [Guid]::NewGuid().ToString('n') + '.mov')
  & $ff -y -f lavfi -i color=c=blue:s=320x240:d=1 -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart $out | Out-Null
  if (-not (Test-Path $out)) { Fail "Failed to generate test MOV" }
  return $out
}

if (-not $Base.StartsWith('http')) { $Base = "https://$Base" }
$Base = ([Uri]$Base).GetLeftPart([System.UriPartial]::Authority)

$headers = @{
  'Origin' = $Origin
  'Cache-Control' = 'no-cache'
  'Accept' = 'application/json'
}

Write-Output "=== Proof Packs E2E Validation ==="
Write-Output ("Base:   " + $Base)
Write-Output ("Origin: " + $Origin)
Write-Output ("Service: " + $Service)
Write-Output ("Surface: " + $Surface)

# Step A: Health
Info "GET /api/health"
$healthHttp = Invoke-Curl @('-sS','-i',"$Base/api/health",'-H',"Origin: $Origin",'-H','Cache-Control: no-cache')
$healthStatus = Extract-Status $healthHttp
if ($healthStatus -ne 200) {
  Write-Output $healthHttp
  Fail "/api/health expected 200, got $healthStatus"
}
Ok "/api/health returned 200"

# Step B: Supabase config
Info "GET /api/get_supabase_config"
$cfgHttp = Invoke-Curl @('-sS','-i',"$Base/api/get_supabase_config",'-H',"Origin: $Origin",'-H','Cache-Control: no-cache')
$cfgStatus = Extract-Status $cfgHttp
if ($cfgStatus -ne 200) {
  Write-Output $cfgHttp
  Fail "/api/get_supabase_config expected 200, got $cfgStatus"
}
Ok "/api/get_supabase_config returned 200"

# Step C: Preflight (the exact failure shown in screenshot)
Info "OPTIONS preflight /api/admin/proof-packs (Request-Headers: cache-control)"
$pre = Invoke-Curl @(
  '-sS','-i','-X','OPTIONS',
  "$Base/api/admin/proof-packs?surface=$Surface&service=$Service",
  '-H',"Origin: $Origin",
  '-H','Access-Control-Request-Method: GET',
  '-H','Access-Control-Request-Headers: cache-control'
)
$preStatus = Extract-Status $pre
if ($preStatus -ne 204 -and $preStatus -ne 200) {
  Write-Output $pre
  Fail "Preflight expected 204/200, got $preStatus"
}
Assert-Contains $pre "Access-Control-Allow-Headers" "Preflight missing Access-Control-Allow-Headers"
Assert-Contains ($pre.ToLowerInvariant()) "cache-control" "Preflight does not allow cache-control"
Ok "Preflight allows cache-control"

# Step D: Actual GET packs
Info "GET /api/admin/proof-packs"
$packs = Invoke-Curl @('-sS','-i',"$Base/api/admin/proof-packs?surface=$Surface&service=$Service&limit=3",'-H',"Origin: $Origin",'-H','Cache-Control: no-cache')
$packsStatus = Extract-Status $packs
if ($packsStatus -ne 200) {
  Write-Output $packs
  Fail "proof-packs expected 200, got $packsStatus"
}
Ok "proof-packs returned 200"

# Step E: Generate video if needed
$tmp = $null
if ($VideoPath -and (Test-Path $VideoPath)) {
  $tmp = $VideoPath
  Info ("Using provided video: " + $tmp)
} else {
  $tmp = Generate-TestMov
  Info ("Generated video: " + $tmp)
}

try {
  # Step F: Init staged upload
  Info "POST /api/admin/proof-upload-init"
  $initBody = @{ surface=$Surface; service=$Service; week_of=$WeekOf; bucket='proof'; filename='sample.mov'; mime='video/quicktime'; media_kind='video' } | ConvertTo-Json -Compress
  $init = Post-Json "$Base/api/admin/proof-upload-init" $initBody @{ Origin=$Origin; 'Cache-Control'='no-cache' }
  $initStatus = [int]$init.status
  if ($initStatus -ne 200) {
    Write-Output $init.content
    Fail "proof-upload-init expected 200, got $initStatus"
  }
  $initJson = $init.content | ConvertFrom-Json
  if (-not $initJson.ok) { Fail "proof-upload-init returned ok=false" }
  if (-not $initJson.signed_url -or -not $initJson.raw_path) { Fail "proof-upload-init missing signed_url/raw_path" }
  Ok "proof-upload-init returned signed_url"

  # Step G: Upload bytes to signed URL (bypasses Vercel limits)
  Info "PUT raw bytes to signed_url"
  $signedUrl = [string]$initJson.signed_url
  $signedUrl = ($signedUrl -replace "`r", "" -replace "`n", "" -replace " ", "").Trim()
  if (-not $signedUrl.StartsWith('http')) { Fail ("signed_url invalid: " + $signedUrl) }
  $putArgs = @('-sS','-o','NUL','-w','%{http_code}','-X','PUT','-H','Content-Type: video/quicktime','--upload-file',$tmp,$signedUrl)
  if ($initJson.token) { $putArgs = @('-H',"Authorization: Bearer $([string]$initJson.token)") + $putArgs }
  $putCode = & curl.exe @putArgs
  if ([int]$putCode -lt 200 -or [int]$putCode -ge 300) { Fail "PUT to signed_url failed: HTTP $putCode" }
  Ok "PUT to signed_url succeeded"

  # Step H: Finalize WITH conversion
  Info "POST /api/admin/proof-upload-finalize (convert_to_mp4=1)"
  $finalBody = @{ bucket='proof'; raw_path=$initJson.raw_path; filename='sample.mov'; mime='video/quicktime'; surface=$Surface; service=$Service; week_of=$WeekOf; media_kind='video'; convert_to_mp4='1' } | ConvertTo-Json -Compress
  $final = Post-Json "$Base/api/admin/proof-upload-finalize" $finalBody @{ Origin=$Origin; 'Cache-Control'='no-cache' }
  $finalStatus = [int]$final.status
  if ($finalStatus -ne 200) {
    Write-Output $final.content
    Fail "proof-upload-finalize expected 200, got $finalStatus"
  }
  $finalJson = $final.content | ConvertFrom-Json
  if (-not $finalJson.ok) { Fail ("proof-upload-finalize ok=false: " + ($finalJson.error | Out-String)) }
  if (-not $finalJson.converted_to_mp4) { Fail "Expected converted_to_mp4=true" }
  if (-not $finalJson.url) { Fail "Expected a url in finalize response" }
  Ok ("proof-upload-finalize converted: " + $finalJson.path)

  # Step I: Verify returned URL is reachable
  Info "HEAD returned url"
  $head = Invoke-Curl @('-sS','-I',"$($finalJson.url)")
  $headStatus = Extract-Status $head
  if ($headStatus -lt 200 -or $headStatus -ge 400) {
    Write-Output $head
    Fail "Returned url not reachable (status $headStatus)"
  }
  Ok "Returned url is reachable"

  Write-Output "\nRESULT"
  Write-Output ("- mp4 url: " + $finalJson.url)
} finally {
  if (-not $VideoPath -and $tmp -and (Test-Path $tmp)) {
    try { Remove-Item -Force $tmp } catch {}
  }
}
