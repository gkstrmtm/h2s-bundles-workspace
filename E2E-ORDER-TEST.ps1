$ErrorActionPreference = 'Stop'

# COMPLETE E2E ORDER TEST (Production)
# Coupon: h2sqa-e2e-2025 (100% discount)
#
# Optional env overrides:
#   $env:H2S_BACKEND_URL = 'https://h2s-backend.vercel.app'
#   $env:PORTAL_EMAIL = 'tech@home2smart.com'
#   $env:PORTAL_ZIP = '29649'

$backend = $env:H2S_BACKEND_URL
if (-not $backend) { $backend = 'https://h2s-backend.vercel.app' }

$portalEmail = $env:PORTAL_EMAIL
if (-not $portalEmail) { $portalEmail = 'tech@home2smart.com' }

$portalZip = $env:PORTAL_ZIP
if (-not $portalZip) { $portalZip = '29649' }

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
  if ($Resp.Headers) {
    Write-Host "  X-Vercel-Id: $($Resp.Headers['X-Vercel-Id'])" -ForegroundColor DarkGray
    Write-Host "  X-Build-ID:  $($Resp.Headers['X-Build-ID'])" -ForegroundColor DarkGray
  }
  if ($Resp.Json -and $Resp.Json.build_id) {
    Write-Host "  build_id(JSON): $($Resp.Json.build_id)" -ForegroundColor DarkGray
  }
}

Write-Host "=== COMPLETE E2E ORDER TEST ===" -ForegroundColor Cyan
Write-Host "Backend: $backend" -ForegroundColor Gray
Write-Host "Using coupon: h2sqa-e2e-2025 (100% discount)" -ForegroundColor Gray

$timestamp = Get-Date -Format 'HHmmss'
$testEmail = "test+e2e_$timestamp@home2smart.com"

Write-Host "`nTest email: $testEmail" -ForegroundColor Cyan

# Step 1: Create checkout
Write-Host "`n[1/5] Creating checkout session..." -ForegroundColor Yellow

$requestedDate = (Get-Date).AddDays(2).ToString('yyyy-MM-dd')

# Real-world bundle IDs on the static bundles page are short IDs (e.g., cam_basic).
$bundleId = $env:E2E_BUNDLE_ID
if (-not $bundleId) { $bundleId = 'cam_basic' }

# Keep these aligned with the actual job we want to test.
$bundleName = 'Front Door Only'
$bundlePrice = 199

# Best-effort: try to fetch catalog for a Stripe price ID; do not fail if catalog is empty.
$stripePriceId = $null
try {
  Write-Host "  Fetching catalog (best-effort for Stripe price ID)..." -ForegroundColor DarkGray
  $catalogResp = Invoke-JsonWebRequest -Method GET -Uri "$backend/api/shop?action=catalog" -TimeoutSec 30
  Show-Receipt -Label 'catalog' -Resp $catalogResp

  if ($catalogResp.Json -and $catalogResp.Json.ok -and $catalogResp.Json.catalog -and $catalogResp.Json.catalog.bundles) {
    $bundle = @($catalogResp.Json.catalog.bundles) | Where-Object { $_.bundle_id -eq $bundleId -or $_.id -eq $bundleId } | Select-Object -First 1
    if ($bundle -and $bundle.stripe_price_id) { $stripePriceId = [string]$bundle.stripe_price_id }
  }
} catch {
  $stripePriceId = $null
}
Write-Host "  Bundle: $bundleName  customer_price=$bundlePrice  stripe_price_id=$stripePriceId" -ForegroundColor DarkGray

$cartItem = @{
  type = 'package'
  id = $bundleId
  bundle_id = $bundleId
  name = $bundleName
  price = $bundlePrice
  qty = 1
}
if ($stripePriceId) { $cartItem.stripe_price_id = $stripePriceId }

$checkoutBody = @{
  __action = 'create_checkout_session'
  customer = @{ email = $testEmail; name = 'E2E Test'; phone = '555-0100' }
  customer_email = $testEmail
  cart = @($cartItem)
  source = 'shop_rebuilt'
  promotion_code = 'h2sqa-e2e-2025'
  success_url = 'https://shop.home2smart.com/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}'
  cancel_url = 'https://shop.home2smart.com/bundles'
  metadata = @{
    customer_name = 'E2E Test'
    customer_phone = '555-0100'
    customer_email = $testEmail
    service_address = '2409 East Cambridge Avenue'
    service_city = 'Greenwood'
    service_state = 'SC'
    service_zip = '29649'
    source = 'shop_rebuilt'
    job_details = @{
      services = @(
        @{
          name = $bundleName
          price = $bundlePrice
          qty = 1
        }
      )
      equipment_provided = 'provider'
      notes = 'None specified'
      requested_date = $requestedDate
      requested_time = 'morning'
    }
  }
}

# Optional: include Stripe line_items if the catalog provides a price ID (matches diagnose checkout payload)
if ($stripePriceId) {
  $checkoutBody.line_items = @(
    @{ price = $stripePriceId; quantity = 1 }
  )
}

$checkoutResp = Invoke-JsonWebRequest -Method POST -Uri "$backend/api/shop" -Body $checkoutBody -TimeoutSec 30
Show-Receipt -Label 'create-checkout-session' -Resp $checkoutResp

if (-not $checkoutResp.Json -or -not $checkoutResp.Json.order_id) {
  Write-Host "Response body:" -ForegroundColor Red
  Write-Host $checkoutResp.Raw
  throw "shop(create_checkout_session) did not return order_id"
}

$orderId = [string]$checkoutResp.Json.order_id
Write-Host "  Order ID: $orderId" -ForegroundColor Green

# Prefer job_id from checkout if present (it should be, and helps tie-out later)
$jobIdFromCheckout = $null
if ($checkoutResp.Json.job_id) { $jobIdFromCheckout = [string]$checkoutResp.Json.job_id }
if ($jobIdFromCheckout) {
  Write-Host "  Job ID (from checkout): $jobIdFromCheckout" -ForegroundColor Gray
}

# Step 2: Schedule
Write-Host "`n[2/5] Scheduling order..." -ForegroundColor Yellow

$jobId = $null
$scheduleResp = $null

# schedule endpoint does not exist in this backend; schedule-appointment can return 409 conflicts.
$candidateDates = @(
  $requestedDate,
  (Get-Date).AddDays(3).ToString('yyyy-MM-dd'),
  (Get-Date).AddDays(4).ToString('yyyy-MM-dd')
)
$candidateTimes = @('morning', 'afternoon')

foreach ($d in $candidateDates) {
  foreach ($t in $candidateTimes) {
    $scheduleBody = @{
      order_id = $orderId
      delivery_date = $d
      delivery_time = $t
      scheduled_date = $d
      scheduled_time = $t
    }

    try {
      $scheduleResp = Invoke-JsonWebRequest -Method POST -Uri "$backend/api/schedule-appointment" -Body $scheduleBody -TimeoutSec 45
      Show-Receipt -Label 'schedule-appointment' -Resp $scheduleResp
      if ($scheduleResp.Json -and $scheduleResp.Json.job_id) { $jobId = [string]$scheduleResp.Json.job_id }
      if ($jobId) { break }
    } catch {
      $msg = ($_ | Out-String)
      if ($msg -match "\(409\)\s*Conflict") {
        Write-Host "  Slot conflict for $d $t; trying next..." -ForegroundColor DarkYellow
        continue
      }
      throw
    }
  }
  if ($jobId) { break }
}

if (-not $jobId -and $jobIdFromCheckout) {
  $jobId = $jobIdFromCheckout
}

if (-not $jobId) {
  Write-Host "Response body:" -ForegroundColor Red
  Write-Host $scheduleResp.Raw
  throw "Scheduling did not return job_id"
}

Write-Host "  Job ID: $jobId" -ForegroundColor Green

# Step 3: Wait for propagation
Write-Host "`n[3/5] Waiting for job to propagate..." -ForegroundColor Yellow
Start-Sleep -Seconds 6

# Step 4: Login
Write-Host "`n[4/5] Logging in to portal..." -ForegroundColor Yellow
Write-Host "  email=$portalEmail zip=$portalZip" -ForegroundColor Gray

$loginBody = @{ email=$portalEmail; zip=$portalZip }
$loginResp = Invoke-JsonWebRequest -Method POST -Uri "$backend/api/portal_login" -Body $loginBody -TimeoutSec 30
Show-Receipt -Label 'portal_login' -Resp $loginResp

if (-not $loginResp.Json -or -not $loginResp.Json.ok -or -not $loginResp.Json.token) {
  Write-Host "Response body:" -ForegroundColor Red
  Write-Host $loginResp.Raw
  throw "portal_login failed"
}

$token = [string]$loginResp.Json.token

# Step 5: Get jobs and verify
Write-Host "`n[5/5] Fetching portal jobs..." -ForegroundColor Yellow

$jobsResp = Invoke-JsonWebRequest -Method GET -Uri "$backend/api/portal_jobs?_cb=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" -Headers @{ Authorization = "Bearer $token"; 'x-debug'='1' } -TimeoutSec 30
Show-Receipt -Label 'portal_jobs' -Resp $jobsResp

if (-not $jobsResp.Json) {
  Write-Host "Response body:" -ForegroundColor Red
  Write-Host $jobsResp.Raw
  throw "portal_jobs did not return JSON"
}

$offers = @()
$upcoming = @()
$completed = @()
if ($jobsResp.Json.offers) { $offers = @($jobsResp.Json.offers) }
if ($jobsResp.Json.upcoming) { $upcoming = @($jobsResp.Json.upcoming) }
if ($jobsResp.Json.completed) { $completed = @($jobsResp.Json.completed) }

Write-Host "  offers:   $($offers.Count)" -ForegroundColor Gray
Write-Host "  upcoming: $($upcoming.Count)" -ForegroundColor Gray
Write-Host "  completed:$($completed.Count)" -ForegroundColor Gray

$all = @()
if ($offers.Count -gt 0) { $all += $offers | ForEach-Object { $_ | Add-Member -NotePropertyName '__source' -NotePropertyValue 'offers' -PassThru } }
if ($upcoming.Count -gt 0) { $all += $upcoming | ForEach-Object { $_ | Add-Member -NotePropertyName '__source' -NotePropertyValue 'upcoming' -PassThru } }
if ($completed.Count -gt 0) { $all += $completed | ForEach-Object { $_ | Add-Member -NotePropertyName '__source' -NotePropertyValue 'completed' -PassThru } }

$testJob = $null

# Prefer match by customer_email (strongest when present)
$testJob = $all | Where-Object { $_.customer_email -and ([string]$_.customer_email).ToLower() -eq $testEmail.ToLower() } | Select-Object -First 1

# Fallback match by order_id if present
if (-not $testJob) {
  $testJob = $all | Where-Object { $_.order_id -and ([string]$_.order_id) -eq $orderId } | Select-Object -First 1
}

# Fallback match by job_id from schedule
if (-not $testJob) {
  $testJob = $all | Where-Object { $_.job_id -and ([string]$_.job_id) -eq $jobId } | Select-Object -First 1
}

if (-not $testJob) {
  Write-Host "❌ Test job not found in portal offers/upcoming/completed" -ForegroundColor Red

  Write-Host "`nFirst 10 jobs (for debugging):" -ForegroundColor Yellow
  $all | Select-Object -First 10 | ForEach-Object {
    $emailOut = if ($_.customer_email) { $_.customer_email } else { '(no customer_email)' }
    Write-Host "  - [$($_.__source)] job_id=$($_.job_id) order_id=$($_.order_id) email=$emailOut title=$($_.service_title) state=$($_.service_details_state)" -ForegroundColor Gray
  }

  Write-Host "`nTest email: $testEmail" -ForegroundColor Cyan
  Write-Host "Order ID: $orderId" -ForegroundColor Cyan
  Write-Host "Job ID: $jobId" -ForegroundColor Cyan

  Write-Host "`nAttempting direct single-job fetch (bypasses list filters)..." -ForegroundColor Yellow
  $singleUri = "$backend/api/portal_jobs?token=$([System.Uri]::EscapeDataString($token))&job_id=$([System.Uri]::EscapeDataString($jobId))&_cb=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
  $singleResp = $null
  try {
    $singleResp = Invoke-JsonWebRequest -Method GET -Uri $singleUri -TimeoutSec 45
    Show-Receipt -Label 'portal_jobs(single)' -Resp $singleResp
  } catch {
    Write-Host "❌ Single-job fetch failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 2
  }

  if ($singleResp -and $singleResp.Json -and $singleResp.Json.ok -and $singleResp.Json.job) {
    $testJob = $singleResp.Json.job
    $testJob | Add-Member -NotePropertyName '__source' -NotePropertyValue 'single' -PassThru | Out-Null
  } else {
    Write-Host "❌ Single-job fetch did not return ok/job" -ForegroundColor Red
    if ($singleResp) {
      Write-Host "Response body:" -ForegroundColor Red
      Write-Host $singleResp.Raw
    }
    exit 2
  }
}

Write-Host "`n=== TEST JOB DETAILS ===" -ForegroundColor Cyan
Write-Host "source: $($testJob.__source)" -ForegroundColor Gray
Write-Host "job_id: $($testJob.job_id)" -ForegroundColor Gray
Write-Host "order_id: $($testJob.order_id)" -ForegroundColor Gray
Write-Host "customer_email: $($testJob.customer_email)" -ForegroundColor Gray

Write-Host "service_title: $($testJob.service_title)"
Write-Host "service_description: $($testJob.service_description)"
Write-Host "description: $($testJob.description)"
Write-Host "service_details_state: $($testJob.service_details_state)"
Write-Host "details_ok: $($testJob.details_ok)"
Write-Host "delivery_date: $($testJob.delivery_date)"
Write-Host "due_at: $($testJob.due_at)"
Write-Host "scheduled_date: $($testJob.scheduled_date)"

$lineItemsCount = 0
if ($testJob.line_items) {
  try { $lineItemsCount = @($testJob.line_items).Count } catch { $lineItemsCount = 0 }
}
Write-Host "line_items: $lineItemsCount items"

Write-Host "`n=== RESULT ===" -ForegroundColor Cyan

$titlePending = $false
if ($testJob.service_title -and ([string]$testJob.service_title -match 'pending')) { $titlePending = $true }

$hasDescription = $false
if ($testJob.service_description -and ([string]$testJob.service_description).Trim().Length -gt 0) { $hasDescription = $true }
if (-not $hasDescription -and $testJob.description -and ([string]$testJob.description).Trim().Length -gt 0) { $hasDescription = $true }

$hasDate = $false
if ($testJob.scheduled_date) { $hasDate = $true }
if (-not $hasDate -and $testJob.delivery_date) { $hasDate = $true }
if (-not $hasDate -and $testJob.due_at) { $hasDate = $true }

$hasLineItems = ($lineItemsCount -gt 0)

$passed = (-not $titlePending) -and $hasDescription -and $hasDate -and $hasLineItems

if ($passed) {
  Write-Host "✅ PASS: Job has real details!" -ForegroundColor Green
} else {
  Write-Host "❌ FAIL: Job missing details" -ForegroundColor Red
  Write-Host "`nWhat's missing:" -ForegroundColor Yellow
  if ($titlePending) { Write-Host "  - service_title is placeholder" }
  if (-not $hasDescription) { Write-Host "  - service_description/description empty" }
  if (-not $hasDate) { Write-Host "  - date missing (scheduled_date/delivery_date/due_at)" }
  if (-not $hasLineItems) { Write-Host "  - line_items empty" }
}

Write-Host "`nTest email: $testEmail" -ForegroundColor Cyan
Write-Host "Order ID: $orderId" -ForegroundColor Cyan
Write-Host "Job ID: $jobId" -ForegroundColor Cyan
