$ErrorActionPreference = 'Stop'

Write-Host "=== PORTAL LIVE PROOF (API -> JOB OBJECT) ===" -ForegroundColor Cyan

function Save-TextFile($path, $text) {
  $text | Out-File -FilePath $path -Encoding UTF8
}

$report = New-Object System.Collections.Generic.List[string]
$report.Add("=== PORTAL LIVE PROOF ===")
$report.Add("Timestamp(UTC): $([DateTime]::UtcNow.ToString('o'))")

# Prefer env vars; fall back to the repo's known working profile.
$email = $env:PORTAL_LOGIN_EMAIL
$zip = $env:PORTAL_LOGIN_ZIP
if (-not $email) { $email = 'h2sbackend@gmail.com' }
if (-not $zip) { $zip = '29649' }

$report.Add("email: $email")
$report.Add("zip: $zip")

# 1) Login (capture headers + JSON)
$cb = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$loginBody = @{ email=$email; zip=$zip } | ConvertTo-Json
$loginResp = Invoke-WebRequest -UseBasicParsing -Uri "https://h2s-backend.vercel.app/api/portal_login?_cb=$cb" `
  -Method POST -ContentType 'application/json' -Body $loginBody -TimeoutSec 30
$loginJson = $loginResp.Content | ConvertFrom-Json

$report.Add("")
$report.Add("[LOGIN]")
$report.Add("Status: $($loginResp.StatusCode)")
$report.Add("X-Vercel-Id: $($loginResp.Headers['X-Vercel-Id'])")
$report.Add("X-Build-ID: $($loginResp.Headers['X-Build-ID'])")
$report.Add("build_id(JSON): $($loginJson.build_id)")
$report.Add("ok(JSON): $($loginJson.ok)")

if (-not $loginJson.ok -or -not $loginJson.token) {
  Save-TextFile -path "portal_live_proof.txt" -text ($report -join "`n")
  throw "portal_login failed"
}
$token = $loginJson.token

# 2) Jobs (capture headers + JSON)
$cb = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$jobsResp = Invoke-WebRequest -UseBasicParsing -Uri "https://h2s-backend.vercel.app/api/portal_jobs?_cb=$cb" `
  -Method GET -Headers @{ Authorization = "Bearer $token"; 'x-debug'='1' } -TimeoutSec 30
$jobsJson = $jobsResp.Content | ConvertFrom-Json

$report.Add("")
$report.Add("[PORTAL_JOBS]")
$report.Add("Status: $($jobsResp.StatusCode)")
$report.Add("X-Vercel-Id: $($jobsResp.Headers['X-Vercel-Id'])")
$report.Add("X-Build-ID: $($jobsResp.Headers['X-Build-ID'])")
$report.Add("build_id(JSON): $($jobsJson.build_id)")
$report.Add("offers.count: $($jobsJson.offers.Count)")
$report.Add("upcoming.count: $($jobsJson.upcoming.Count)")
$report.Add("completed.count: $($jobsJson.completed.Count)")

if ($jobsJson.meta -and $jobsJson.meta.geo) {
  try {
    $report.Add("meta.geo: $(($jobsJson.meta.geo | ConvertTo-Json -Compress))")
  } catch {
    $report.Add("meta.geo: (unavailable)")
  }
}

# Save full response for inspection
$jobsResp.Content | Out-File -FilePath "live_portal_jobs_response.json" -Encoding UTF8

# Pick a real job from the live payload.
# Prefer the problematic placeholder case when present so we can prove the data flow.
$source = $null
$job = $null

$all = @()
if ($jobsJson.offers) { $all += @($jobsJson.offers | ForEach-Object { $_ | Add-Member -NotePropertyName '__source' -NotePropertyValue 'offers' -PassThru }) }
if ($jobsJson.upcoming) { $all += @($jobsJson.upcoming | ForEach-Object { $_ | Add-Member -NotePropertyName '__source' -NotePropertyValue 'upcoming' -PassThru }) }
if ($jobsJson.completed) { $all += @($jobsJson.completed | ForEach-Object { $_ | Add-Member -NotePropertyName '__source' -NotePropertyValue 'completed' -PassThru }) }

$placeholderJob = $all | Where-Object {
  ($_.service_title -match 'details pending') -or
  ($_.service_name -match 'details pending') -or
  ($_.service_description -match 'details pending') -or
  ($_.service_details_state -eq 'pending') -or
  ($_.details_ok -eq $false)
} | Select-Object -First 1

if ($placeholderJob) {
  $job = $placeholderJob
  $source = "$($job.__source)[placeholder]"
} elseif ($jobsJson.offers -and $jobsJson.offers.Count -gt 0) {
  $source = 'offers[0]'
  $job = $jobsJson.offers[0]
} elseif ($jobsJson.upcoming -and $jobsJson.upcoming.Count -gt 0) {
  $source = 'upcoming[0]'
  $job = $jobsJson.upcoming[0]
} elseif ($jobsJson.completed -and $jobsJson.completed.Count -gt 0) {
  $source = 'completed[0]'
  $job = $jobsJson.completed[0]
}

if (-not $job) {
  $report.Add("")
  $report.Add("No jobs found in offers/upcoming/completed; cannot inspect service description flow.")
  Save-TextFile -path "portal_live_proof.txt" -text ($report -join "`n")
  throw "No jobs found"
}

$report.Add("")
$report.Add("[$source - KEY FIELDS]")
$report.Add("job_id: $($job.job_id)")
$report.Add("assign_state/status: $($job.assign_state) / $($job.status)")
$report.Add("service_title: $($job.service_title)")
$report.Add("service_description: $($job.service_description)")
$report.Add("description: $($job.description)")
$report.Add("job_details: $($job.job_details)")
$report.Add("bundle_name: $($job.bundle_name)")
$report.Add("bundle_description: $($job.bundle_description)")
$report.Add("distance_miles: $($job.distance_miles)")
$report.Add("distance_mi: $($job.distance_mi)")
$report.Add("line_items.count: $(if($job.line_items){$job.line_items.Count}else{0})")

if ($job.line_items -and $job.line_items.Count -gt 0) {
  $report.Add("line_items (first up to 8):")
  $job.line_items | Select-Object -First 8 | ForEach-Object {
    $desc = $_.description
    if (-not $desc) { $desc = $_.name }
    if (-not $desc) { $desc = $_.title }
    $report.Add("  - $desc")
  }
}

# Save the job for JS evaluation / manual inspection
$job | ConvertTo-Json -Depth 8 | Out-File -FilePath "live_job_data.json" -Encoding UTF8

Save-TextFile -path "portal_live_proof.txt" -text ($report -join "`n")

Write-Host "Wrote: portal_live_proof.txt" -ForegroundColor Green
Write-Host "Wrote: live_job_data.json" -ForegroundColor Green
Write-Host "Wrote: live_portal_jobs_response.json" -ForegroundColor Green
