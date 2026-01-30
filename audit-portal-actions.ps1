param(
  [string]$BackendBase = 'https://h2s-backend.vercel.app',
  [string]$PortalEmail = 'tech@home2smart.com',
  [string]$PortalZip = '29649',
  [string]$Coupon = 'h2sqa-e2e-2025',
  [string]$BundleId = 'cam_basic',
  [string]$BundleNameAccept = 'Front Door Only',
  [int]$BundlePriceAccept = 199,
  [string]$BundleNameDecline = 'E2E Decline Only',
  [int]$BundlePriceDecline = 199,
  [string]$OutFile = 'portal_actions_audit_results.json'
)

$ErrorActionPreference = 'Stop'

function Invoke-Json {
  param(
    [Parameter(Mandatory=$true)][ValidateSet('GET','POST')][string]$Method,
    [Parameter(Mandatory=$true)][string]$Uri,
    [hashtable]$Headers,
    [object]$Body,
    [int]$TimeoutSec = 45
  )

  $jsonBody = $null
  if ($null -ne $Body) {
    if ($Body -is [string]) {
      $jsonBody = $Body
    } else {
      $jsonBody = ($Body | ConvertTo-Json -Depth 20)
    }
  }

  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Method $Method -Uri $Uri -Headers $Headers -ContentType 'application/json' -Body $jsonBody -TimeoutSec $TimeoutSec
    $parsed = $null
    try { $parsed = ($resp.Content | ConvertFrom-Json) } catch { $parsed = $null }

    return [pscustomobject]@{
      StatusCode = $resp.StatusCode
      Headers    = $resp.Headers
      Raw        = $resp.Content
      Json       = $parsed
    }
  } catch {
    $statusCode = $null
    $raw = $null
    $headersOut = $null

    try {
      $we = $_.Exception
      if ($we -and $we.Response) {
        $statusCode = [int]$we.Response.StatusCode
        $headersOut = $we.Response.Headers
        $stream = $we.Response.GetResponseStream()
        if ($stream) {
          $reader = New-Object System.IO.StreamReader($stream)
          $raw = $reader.ReadToEnd()
          $reader.Close()
        }
      }
    } catch {
      # ignore secondary parse errors
    }

    $parsed = $null
    if ($raw) {
      try { $parsed = ($raw | ConvertFrom-Json) } catch { $parsed = $null }
    }

    return [pscustomobject]@{
      StatusCode = $statusCode
      Headers    = $headersOut
      Raw        = $raw
      Json       = $parsed
      Error      = $_.Exception.Message
    }
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

function New-E2EJob {
  param(
    [Parameter(Mandatory=$true)][string]$BundleName,
    [Parameter(Mandatory=$true)][int]$BundlePrice
  )

  $timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $nonce = ([Guid]::NewGuid().ToString('N').Substring(0,8))
  $testEmail = "test+portal_actions_${timestamp}_${nonce}@home2smart.com"

  $requestedDate = (Get-Date).AddDays(2).ToString('yyyy-MM-dd')

  # Best-effort: fetch catalog for Stripe price ID
  $stripePriceId = $null
  try {
    $catalogResp = Invoke-Json -Method GET -Uri "$BackendBase/api/shop?action=catalog" -TimeoutSec 30
    if ($catalogResp.Json -and $catalogResp.Json.ok -and $catalogResp.Json.catalog -and $catalogResp.Json.catalog.bundles) {
      $bundle = @($catalogResp.Json.catalog.bundles) | Where-Object { $_.bundle_id -eq $BundleId -or $_.id -eq $BundleId } | Select-Object -First 1
      if ($bundle -and $bundle.stripe_price_id) { $stripePriceId = [string]$bundle.stripe_price_id }
    }
  } catch {
    $stripePriceId = $null
  }

  $cartItem = @{
    type = 'package'
    id = $BundleId
    bundle_id = $BundleId
    name = $BundleName
    price = $BundlePrice
    qty = 1
  }
  if ($stripePriceId) { $cartItem.stripe_price_id = $stripePriceId }

  $checkoutBody = @{
    __action = 'create_checkout_session'
    customer = @{ email = $testEmail; name = 'E2E Portal Actions'; phone = '555-0100' }
    customer_email = $testEmail
    cart = @($cartItem)
    source = 'shop_rebuilt'
    promotion_code = $Coupon
    success_url = 'https://shop.home2smart.com/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}'
    cancel_url = 'https://shop.home2smart.com/bundles'
    metadata = @{
      customer_name = 'E2E Portal Actions'
      customer_phone = '555-0100'
      customer_email = $testEmail
      service_address = '2409 East Cambridge Avenue'
      service_city = 'Greenwood'
      service_state = 'SC'
      service_zip = $PortalZip
      source = 'shop_rebuilt'
      job_details = @{
        services = @(
          @{
            name = $BundleName
            price = $BundlePrice
            qty = 1
          }
        )
        equipment_provided = 'provider'
        notes = "[AUTOMATED ACTIONS AUDIT] ${timestamp} ${nonce}"
        requested_date = $requestedDate
        requested_time = 'morning'
      }
    }
  }

  if ($stripePriceId) {
    $checkoutBody.line_items = @(
      @{ price = $stripePriceId; quantity = 1 }
    )
  }

  $checkoutResp = Invoke-Json -Method POST -Uri "$BackendBase/api/shop" -Body $checkoutBody -TimeoutSec 45
  Show-Receipt -Label "shop(create_checkout_session)" -Resp $checkoutResp

  if (-not $checkoutResp.Json -or -not $checkoutResp.Json.order_id) {
    throw "shop(create_checkout_session) did not return order_id"
  }

  $orderId = [string]$checkoutResp.Json.order_id
  $jobId = $null
  if ($checkoutResp.Json.job_id) { $jobId = [string]$checkoutResp.Json.job_id }

  $candidateDates = @(
    $requestedDate,
    (Get-Date).AddDays(3).ToString('yyyy-MM-dd'),
    (Get-Date).AddDays(4).ToString('yyyy-MM-dd')
  )
  $candidateTimes = @('morning','afternoon')

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
        $scheduleResp = Invoke-Json -Method POST -Uri "$BackendBase/api/schedule-appointment" -Body $scheduleBody -TimeoutSec 60
        Show-Receipt -Label "schedule-appointment" -Resp $scheduleResp
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

  if (-not $jobId) {
    throw "Scheduling did not return job_id"
  }

  return [pscustomobject]@{
    ok = $true
    order_id = $orderId
    job_id = $jobId
    test_email = $testEmail
    bundle_name = $BundleName
    bundle_price = $BundlePrice
  }
}

Write-Host "=== PORTAL ACTION ENDPOINTS AUDIT ===" -ForegroundColor Cyan
Write-Host "Backend: $BackendBase" -ForegroundColor Gray
Write-Host "Portal login: $PortalEmail ($PortalZip)" -ForegroundColor Gray
Write-Host "Coupon: $Coupon" -ForegroundColor Gray

$results = [ordered]@{
  meta = [ordered]@{
    backend = $BackendBase
    portal_email = $PortalEmail
    portal_zip = $PortalZip
    coupon = $Coupon
    when_utc = (Get-Date).ToUniversalTime().ToString('o')
  }
  accept_flow = [ordered]@{}
  decline_flow = [ordered]@{}
}

# 0) Login
Write-Host "`n[0/5] Logging in (portal_login)..." -ForegroundColor Yellow
$loginResp = Invoke-Json -Method POST -Uri "$BackendBase/api/portal_login" -Body @{ email = $PortalEmail; zip = $PortalZip } -TimeoutSec 30
Show-Receipt -Label 'portal_login' -Resp $loginResp
if (-not $loginResp.Json -or -not $loginResp.Json.ok -or -not $loginResp.Json.token) {
  throw "portal_login failed"
}
$token = [string]$loginResp.Json.token
$results.meta.portal_token_prefix = if ($token.Length -gt 16) { $token.Substring(0,16) + '...' } else { $token }

# 1) Create job for ACCEPT -> DONE
Write-Host "`n[1/5] Creating E2E job for accept/complete..." -ForegroundColor Yellow
$jobA = New-E2EJob -BundleName $BundleNameAccept -BundlePrice $BundlePriceAccept
$results.accept_flow.created = $jobA
Write-Host "  Job A: $($jobA.job_id) order=$($jobA.order_id)" -ForegroundColor Green
Start-Sleep -Seconds 4

# 2) Accept
Write-Host "`n[2/5] Calling portal_accept..." -ForegroundColor Yellow
$acceptResp = Invoke-Json -Method POST -Uri "$BackendBase/api/portal_accept" -Body @{ token = $token; job_id = $jobA.job_id } -TimeoutSec 45
Show-Receipt -Label 'portal_accept' -Resp $acceptResp
$results.accept_flow.portal_accept = $acceptResp.Json
if (-not $acceptResp.Json -or -not $acceptResp.Json.ok) {
  throw "portal_accept returned ok=false"
}

$assignId = $null
if ($acceptResp.Json.assignment) {
  if ($acceptResp.Json.assignment.assign_id) { $assignId = [string]$acceptResp.Json.assignment.assign_id }
  elseif ($acceptResp.Json.assignment.id) { $assignId = [string]$acceptResp.Json.assignment.id }
}
$results.accept_flow.assign_id = $assignId
if (-not $assignId) {
  throw "portal_accept did not return assignment.assign_id (or .id); cannot call portal_mark_done safely"
}

# 3) Mark done
Write-Host "`n[3/5] Calling portal_mark_done (requires Authorization Bearer)..." -ForegroundColor Yellow
$cid = "actions_audit_$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())_$([Guid]::NewGuid().ToString('N').Substring(0,6))"
$markHeaders = @{ Authorization = "Bearer $token"; 'X-Cid' = $cid }
$markBody = @{ assign_id = $assignId; cid = $cid }
$markResp = Invoke-Json -Method POST -Uri "$BackendBase/api/portal_mark_done" -Headers $markHeaders -Body $markBody -TimeoutSec 90
Show-Receipt -Label 'portal_mark_done' -Resp $markResp
$results.accept_flow.portal_mark_done = $markResp.Json
if (-not $markResp.Json -or -not $markResp.Json.ok) {
  $err = if ($markResp.Json -and $markResp.Json.error) { $markResp.Json.error } else { 'unknown_error' }
  throw "portal_mark_done failed: $err"
}

# 4) Verify job appears in completed (best-effort)
Write-Host "`n[4/5] Verifying job now appears in portal_jobs.completed..." -ForegroundColor Yellow
$jobsResp = Invoke-Json -Method POST -Uri "$BackendBase/api/portal_jobs" -Body @{ token = $token } -TimeoutSec 45
Show-Receipt -Label 'portal_jobs' -Resp $jobsResp
$results.accept_flow.portal_jobs = $jobsResp.Json
$completed = @()
if ($jobsResp.Json -and $jobsResp.Json.completed) { $completed = @($jobsResp.Json.completed) }
$found = $false
foreach ($j in $completed) {
  if ($j -and $j.job_id -and ([string]$j.job_id) -eq $jobA.job_id) { $found = $true; break }
}
$results.accept_flow.completed_contains_job = $found
Write-Host "  Completed contains Job A: $found" -ForegroundColor Gray

# 5) Decline endpoint sanity (create separate job, decline it)
Write-Host "`n[5/5] Creating E2E job for decline-only..." -ForegroundColor Yellow
$jobD = New-E2EJob -BundleName $BundleNameDecline -BundlePrice $BundlePriceDecline
$results.decline_flow.created = $jobD
Write-Host "  Job D: $($jobD.job_id) order=$($jobD.order_id)" -ForegroundColor Green
Start-Sleep -Seconds 3

Write-Host "  Calling portal_decline..." -ForegroundColor Yellow
$declineResp = Invoke-Json -Method POST -Uri "$BackendBase/api/portal_decline" -Body @{ token = $token; job_id = $jobD.job_id } -TimeoutSec 45
Show-Receipt -Label 'portal_decline' -Resp $declineResp
$results.decline_flow.portal_decline = $declineResp.Json
if (-not $declineResp.Json -or -not $declineResp.Json.ok) {
  throw "portal_decline returned ok=false"
}

# Save results
$results | ConvertTo-Json -Depth 30 | Set-Content -Encoding UTF8 -Path $OutFile
Write-Host "`n=== ACTION AUDIT COMPLETE ===" -ForegroundColor Cyan
Write-Host "Saved: $OutFile" -ForegroundColor Gray
Write-Host "Accept: ok=$($acceptResp.Json.ok) mark_done: ok=$($markResp.Json.ok) decline: ok=$($declineResp.Json.ok)" -ForegroundColor Green
