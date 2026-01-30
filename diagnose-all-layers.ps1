$ErrorActionPreference = 'Stop'

# COMPLETE JOB DETAILS DIAGNOSTIC (All Layers)
# - Layer 3: Portal API receipts + field presence
# - Layer 4: Deployed portal HTML contains + uses render helpers
#
# Optional env vars:
#   $env:H2S_BACKEND_URL='https://h2s-backend.vercel.app'
#   $env:PORTAL_EMAIL='tech@home2smart.com'
#   $env:PORTAL_ZIP='29902'
#   $env:JOB_ID='<job-id>'   # if set, runs single-job fetch

$backend = $env:H2S_BACKEND_URL
if (-not $backend) { $backend = 'https://h2s-backend.vercel.app' }

$portalEmail = $env:PORTAL_EMAIL
if (-not $portalEmail) { $portalEmail = 'tech@home2smart.com' }

$portalZip = $env:PORTAL_ZIP
if (-not $portalZip) { $portalZip = '00000' }

$jobId = $env:JOB_ID

function Invoke-JsonWebRequest {
  param(
    [Parameter(Mandatory=$true)][string]$Method,
    [Parameter(Mandatory=$true)][string]$Uri,
    [Parameter(Mandatory=$false)][hashtable]$Headers,
    [Parameter(Mandatory=$false)][object]$Body,
    [Parameter(Mandatory=$false)][int]$TimeoutSec = 30
  )

  $jsonBody = $null
  if ($null -ne $Body) {
    if ($Body -is [string]) {
      $jsonBody = $Body
    } else {
      $jsonBody = ($Body | ConvertTo-Json -Depth 20)
    }
  }

  $resp = Invoke-WebRequest -UseBasicParsing -Method $Method -Uri $Uri -Headers $Headers -ContentType 'application/json' -Body $jsonBody -TimeoutSec $TimeoutSec
  $parsed = $null
  try { $parsed = ($resp.Content | ConvertFrom-Json) } catch { $parsed = $null }

  return [pscustomobject]@{
    StatusCode = $resp.StatusCode
    Headers    = $resp.Headers
    Raw        = $resp.Content
    Json       = $parsed
  }
}

function Show-Receipt {
  param(
    [Parameter(Mandatory=$true)][string]$Label,
    [Parameter(Mandatory=$true)][object]$Resp
  )

  Write-Host "[$Label] HTTP $($Resp.StatusCode)" -ForegroundColor Gray
  Write-Host "  X-Vercel-Id: $($Resp.Headers['X-Vercel-Id'])" -ForegroundColor DarkGray
  Write-Host "  X-Build-ID:  $($Resp.Headers['X-Build-ID'])" -ForegroundColor DarkGray
  if ($Resp.Json -and $Resp.Json.build_id) {
    Write-Host "  build_id(JSON): $($Resp.Json.build_id)" -ForegroundColor DarkGray
  }
}

Write-Host "=== COMPLETE JOB DETAILS DIAGNOSTIC ===" -ForegroundColor Cyan
Write-Host "Backend: $backend" -ForegroundColor Gray

# Layer 3: API
Write-Host "`n=== LAYER 3: PORTAL API CHECK ===" -ForegroundColor Cyan
Write-Host "Logging in (email=$portalEmail zip=$portalZip)..." -ForegroundColor Yellow

$loginResp = Invoke-JsonWebRequest -Method POST -Uri "$backend/api/portal_login" -Body @{ email=$portalEmail; zip=$portalZip } -TimeoutSec 30
Show-Receipt -Label 'portal_login' -Resp $loginResp

if (-not $loginResp.Json -or -not $loginResp.Json.ok -or -not $loginResp.Json.token) {
  Write-Host "portal_login body:" -ForegroundColor Red
  Write-Host $loginResp.Raw
  throw 'portal_login failed'
}

$token = [string]$loginResp.Json.token

Write-Host "`nFetching portal_jobs list (with debug)..." -ForegroundColor Yellow
$listResp = Invoke-JsonWebRequest -Method GET -Uri "$backend/api/portal_jobs?_cb=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -Headers @{ Authorization = "Bearer $token"; 'x-debug'='1' } -TimeoutSec 30
Show-Receipt -Label 'portal_jobs(list)' -Resp $listResp

if (-not $listResp.Json) {
  Write-Host $listResp.Raw
  throw 'portal_jobs(list) did not return JSON'
}

$offers = @(); $upcoming = @(); $completed = @();
if ($listResp.Json.offers) { $offers = @($listResp.Json.offers) }
if ($listResp.Json.upcoming) { $upcoming = @($listResp.Json.upcoming) }
if ($listResp.Json.completed) { $completed = @($listResp.Json.completed) }

Write-Host "  offers:   $($offers.Count)" -ForegroundColor Gray
Write-Host "  upcoming: $($upcoming.Count)" -ForegroundColor Gray
Write-Host "  completed:$($completed.Count)" -ForegroundColor Gray

$first = $null
$firstSource = $null
if ($offers.Count -gt 0) { $first = $offers[0]; $firstSource = 'offers[0]' }
elseif ($upcoming.Count -gt 0) { $first = $upcoming[0]; $firstSource = 'upcoming[0]' }
elseif ($completed.Count -gt 0) { $first = $completed[0]; $firstSource = 'completed[0]' }

if ($first) {
  Write-Host "`n=== FIRST JOB ($firstSource) ===" -ForegroundColor Yellow
  Write-Host "job_id: $($first.job_id)"
  Write-Host "order_id: $($first.order_id)"
  Write-Host "service_title: $($first.service_title)"
  Write-Host "service_description: $($first.service_description)"
  Write-Host "description: $($first.description)"
  $liCount = 0; if ($first.line_items) { try { $liCount = @($first.line_items).Count } catch { $liCount = 0 } }
  Write-Host "line_items: $liCount"
  Write-Host "scheduled_date: $($first.scheduled_date)"
  Write-Host "delivery_date: $($first.delivery_date)"
  Write-Host "due_at: $($first.due_at)"

  $apiHasTitle = ($first.service_title -or $first.service_name -or $first.bundle_name)
  $apiHasDesc = ($first.service_description -or $first.description -or $first.job_details -or $first.bundle_description)
  $apiHasItems = ($liCount -gt 0)
  $apiHasDate = ($first.scheduled_date -or $first.delivery_date -or $first.due_at)

  Write-Host "`n=== ANALYSIS (FIRST JOB) ===" -ForegroundColor Yellow
  Write-Host "  Title data:       $(if($apiHasTitle){'✅'}else{'❌'})"
  Write-Host "  Description data: $(if($apiHasDesc){'✅'}else{'❌'})"
  Write-Host "  Line items:       $(if($apiHasItems){'✅'}else{'❌'})"
  Write-Host "  Date:             $(if($apiHasDate){'✅'}else{'❌'})"

  $first | ConvertTo-Json -Depth 8 | Out-File 'diagnostic_api_job.json' -Encoding UTF8
  Write-Host "Saved: diagnostic_api_job.json" -ForegroundColor Gray
} else {
  Write-Host "`nNo jobs returned in list. This can be geo filtering, not a creation failure." -ForegroundColor Yellow
}

if ($jobId) {
  Write-Host "`nFetching portal_jobs single job... job_id=$jobId" -ForegroundColor Yellow
  $singleResp = Invoke-JsonWebRequest -Method GET -Uri "$backend/api/portal_jobs?token=$([System.Uri]::EscapeDataString($token))&job_id=$([System.Uri]::EscapeDataString($jobId))&_cb=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -TimeoutSec 45
  Show-Receipt -Label 'portal_jobs(single)' -Resp $singleResp

  if ($singleResp.Json -and $singleResp.Json.ok -and $singleResp.Json.job) {
    $j = $singleResp.Json.job
    $liCount = 0; if ($j.line_items) { try { $liCount = @($j.line_items).Count } catch { $liCount = 0 } }

    Write-Host "`n=== SINGLE JOB FIELDS ===" -ForegroundColor Yellow
    Write-Host "service_title: $($j.service_title)"
    Write-Host "service_description: $($j.service_description)"
    Write-Host "description: $($j.description)"
    Write-Host "line_items: $liCount"
    Write-Host "scheduled_date: $($j.scheduled_date)"
    Write-Host "delivery_date: $($j.delivery_date)"
    Write-Host "due_at: $($j.due_at)"

    $singleResp.Json | ConvertTo-Json -Depth 10 | Out-File 'diagnostic_single_job.json' -Encoding UTF8
    Write-Host "Saved: diagnostic_single_job.json" -ForegroundColor Gray
  } else {
    Write-Host "Single-job body:" -ForegroundColor Red
    Write-Host $singleResp.Raw
  }
}

# Layer 4: Frontend
Write-Host "`n=== LAYER 4: FRONTEND CODE CHECK ===" -ForegroundColor Cyan
$deployedResp = Invoke-WebRequest -UseBasicParsing -Uri 'https://portal.home2smart.com/portal' -TimeoutSec 30
Write-Host "[portal] HTTP $($deployedResp.StatusCode)" -ForegroundColor Gray

$deployed = [string]$deployedResp.Content

$checks = [ordered]@{
  'getSafeTitle defined' = ($deployed -match 'function\s+getSafeTitle')
  'generateServiceDescription defined' = ($deployed -match 'function\s+generateServiceDescription')
  'isPlaceholderText defined' = ($deployed -match 'function\s+isPlaceholderText')
  'getSafeTitle(job) used' = ($deployed -match 'getSafeTitle\s*\(\s*job')
  'generateServiceDescription(job) used' = ($deployed -match 'generateServiceDescription\s*\(\s*job')
}

foreach ($kv in $checks.GetEnumerator()) {
  $ok = [bool]$kv.Value
  $mark = $(if ($ok) { '✅' } else { '❌' })
  $color = $(if ($ok) { 'Green' } else { 'Red' })
  Write-Host ("  $mark " + $kv.Key) -ForegroundColor $color
}

Write-Host "`nDone." -ForegroundColor Cyan
