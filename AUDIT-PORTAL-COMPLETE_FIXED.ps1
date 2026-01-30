# COMPREHENSIVE PORTAL & SAVE AUDIT (ASCII-SAFE)
# Tests portal encoding, checkout/job creation, schedule save performance, and persistence.

$ErrorActionPreference = "Continue"
$apiUrl = "https://h2s-backend.vercel.app/api"

Write-Host "" 
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  PORTAL & SAVE PERFORMANCE FULL AUDIT" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "" 

$issues = @()
$warnings = @()
$timings = @()

# AUDIT 1: portal.html encoding checks
Write-Host "[1/5] Auditing portal.html for encoding issues..." -ForegroundColor Yellow
$portalContent = Get-Content "portal.html" -Raw -Encoding UTF8

$brokenPatterns = @(
  # This is the exact signal used by audit-portal-simple.ps1 for the bullet/encoding regression.
  @{ pattern = '\s\?\s\$\{'; name = 'Question mark before template expression'; example = ' ? ${...}' }
)

$found = @()
foreach ($check in $brokenPatterns) {
  if ($portalContent -match $check.pattern) {
    $matches = [regex]::Matches($portalContent, $check.pattern)
    $found += "Found $($matches.Count) instances of: $($check.name) (example: $($check.example))"
  }
}

if ($found.Count -eq 0) {
  Write-Host "  PASS: No broken-character patterns detected" -ForegroundColor Green
} else {
  Write-Host "  FAIL: Character encoding issues found" -ForegroundColor Red
  foreach ($f in $found) {
    Write-Host ("   - " + $f) -ForegroundColor Red
    $issues += $f
  }
}

# AUDIT 2: Create test order
Write-Host "" 
Write-Host "[2/5] Creating order (checkout + job creation)..." -ForegroundColor Yellow
$testEmail = "portal-audit-$(Get-Random)@test.com"
Write-Host ("  Test email: " + $testEmail) -ForegroundColor Gray
$checkoutStart = Get-Date

$checkoutBody = @{
  __action = "create_checkout_session"
  customer = @{ email = $testEmail; name = "Portal Audit Test"; phone = "555-0199" }
  cart = @(@{ bundle_id = "bnd-welcome-to-h2s"; name = "Smart Home Bundle"; price = 999; quantity = 1 })
  promotion_code = ""
  success_url = "https://example.com/success"
  cancel_url = "https://example.com/cancel"
} | ConvertTo-Json -Depth 10

try {
  $checkout = Invoke-RestMethod -Uri "$apiUrl/shop" -Method POST -Body $checkoutBody -ContentType "application/json" -TimeoutSec 30
  $checkoutMs = ((Get-Date) - $checkoutStart).TotalMilliseconds
  $timings += @{ operation = "Checkout Creation"; time = $checkoutMs }

  if ($checkout.ok) {
    Write-Host ("  PASS: Order created: " + $checkout.order_id) -ForegroundColor Green
    Write-Host ("  Time: " + [math]::Round($checkoutMs, 0) + "ms") -ForegroundColor Gray
  } else {
    Write-Host "  FAIL: Checkout returned ok=false" -ForegroundColor Red
    $issues += "Checkout returned ok=false"
  }

  if (!$checkout.job_id) {
    Write-Host "  WARNING: No job_id returned" -ForegroundColor Yellow
    $warnings += "Missing job_id in checkout response"
  } else {
    Write-Host ("  Job ID: " + $checkout.job_id) -ForegroundColor Gray
  }
} catch {
  Write-Host ("  FAIL: Checkout failed: " + $_.Exception.Message) -ForegroundColor Red
  $issues += ("Checkout failed: " + $_.Exception.Message)
}

Start-Sleep 2

# AUDIT 3: Verify customer_orders contract + service details
Write-Host "" 
Write-Host "[3/5] Checking customer_orders contract + service details..." -ForegroundColor Yellow
$orderBody = @{ customer_email = $testEmail } | ConvertTo-Json

try {
  $ordersResp = Invoke-WebRequest -UseBasicParsing -Uri "$apiUrl/customer_orders" -Method POST -Body $orderBody -ContentType "application/json" -TimeoutSec 10
  $orders = $ordersResp.Content | ConvertFrom-Json

  $hdrBuild = $ordersResp.Headers['X-Build-ID']
  if (!$hdrBuild -or [string]::IsNullOrWhiteSpace([string]$hdrBuild)) {
    Write-Host "  FAIL: Missing X-Build-ID header" -ForegroundColor Red
    $issues += "customer_orders missing X-Build-ID"
  } else {
    Write-Host ("  PASS: X-Build-ID=" + $hdrBuild) -ForegroundColor Green
  }

  if (!$orders.build_id -or [string]::IsNullOrWhiteSpace([string]$orders.build_id)) {
    Write-Host "  FAIL: Missing build_id in JSON" -ForegroundColor Red
    $issues += "customer_orders missing build_id"
  } else {
    Write-Host ("  PASS: build_id=" + $orders.build_id) -ForegroundColor Green
  }

  if (!$orders.orders -or $orders.orders.Count -eq 0) {
    Write-Host "  FAIL: Order not found in customer_orders" -ForegroundColor Red
    $issues += "Order missing from customer_orders"
  } else {
    $order = $orders.orders[0]
    $serviceSummary = [string]$order.service_summary
    $jobDetails = [string]$order.job_details

    if (![string]::IsNullOrWhiteSpace($jobDetails)) {
      Write-Host "  PASS: job_details present" -ForegroundColor Green
    }

    if (![string]::IsNullOrWhiteSpace($serviceSummary) -and $serviceSummary -ne 'Service') {
      Write-Host "  PASS: service_summary present" -ForegroundColor Green
    }

    if (([string]::IsNullOrWhiteSpace($jobDetails)) -and ([string]::IsNullOrWhiteSpace($serviceSummary) -or $serviceSummary -eq 'Service')) {
      Write-Host "  FAIL: Missing service details (job_details and service_summary)" -ForegroundColor Red
      $issues += "Missing service details in customer_orders"
    }
  }
} catch {
  Write-Host ("  FAIL: Order retrieval failed: " + $_.Exception.Message) -ForegroundColor Red
  $issues += "Order retrieval failed"
}

# AUDIT 4/5: Schedule save + persistence
if ($checkout -and $checkout.job_id) {
  Write-Host "" 
  Write-Host "[4/5] Testing schedule save performance..." -ForegroundColor Yellow

  $scheduleDate = (Get-Date).AddDays(3).ToString("yyyy-MM-dd")
  $scheduleStart = Get-Date

  $scheduleBody = @{
    order_id = $checkout.order_id
    scheduled_iso = "$scheduleDate`T10:00:00-05:00"
    timezone = "America/New_York"
    time_window = "9am - 12pm"
  } | ConvertTo-Json

  try {
    $scheduleResult = Invoke-RestMethod -Uri "$apiUrl/customer_reschedule" -Method POST -Body $scheduleBody -ContentType "application/json" -TimeoutSec 20
    $scheduleMs = ((Get-Date) - $scheduleStart).TotalMilliseconds
    $timings += @{ operation = "Schedule Save"; time = $scheduleMs }

    Write-Host ("  Time: " + [math]::Round($scheduleMs, 0) + "ms") -ForegroundColor Gray

    if ($scheduleResult.ok) {
      Write-Host "  PASS: Schedule saved" -ForegroundColor Green
      if ($scheduleMs -gt 5000) {
        Write-Host ("  WARNING: Slow save (>5s): " + [math]::Round($scheduleMs/1000, 1) + "s") -ForegroundColor Yellow
        $warnings += "Schedule save is slow"
      }
    } else {
      Write-Host ("  FAIL: Schedule save returned ok=false: " + ($scheduleResult.error | Out-String)) -ForegroundColor Red
      $issues += "Schedule save returned ok=false"
    }
  } catch {
    $scheduleMs = ((Get-Date) - $scheduleStart).TotalMilliseconds
    Write-Host ("  FAIL: Schedule save exception after " + [math]::Round($scheduleMs, 0) + "ms") -ForegroundColor Red
    Write-Host ("  Error: " + $_.Exception.Message) -ForegroundColor Red
    $issues += ("Schedule save exception: " + $_.Exception.Message)

    if ($_.Exception.Message -match 'timeout' -or $scheduleMs -gt 18000) {
      $issues += "CRITICAL: Schedule save timeout (silent failure risk)"
    }
  }

  Write-Host "" 
  Write-Host "[5/5] Verifying schedule persisted to database..." -ForegroundColor Yellow
  Start-Sleep 2

  try {
    $verifyOrders = $null
    $lastVerifyErr = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      try {
        if ($attempt -gt 1) {
          Write-Host ("  Retry customer_orders (attempt $attempt/3)...") -ForegroundColor Gray
        }
        $verifyOrders = Invoke-RestMethod -Uri "$apiUrl/customer_orders" -Method POST -Body $orderBody -ContentType "application/json" -TimeoutSec 30
        $lastVerifyErr = $null
        break
      } catch {
        $lastVerifyErr = $_
        Start-Sleep -Seconds (2 * $attempt)
      }
    }

    if (-not $verifyOrders) {
      throw $lastVerifyErr
    }

    $verifiedOrder = $verifyOrders.orders[0]

    if ($verifiedOrder.installation_date) {
      Write-Host ("  PASS: installation_date persisted: " + $verifiedOrder.installation_date) -ForegroundColor Green
    } else {
      Write-Host "  FAIL: installation_date NOT saved" -ForegroundColor Red
      $issues += "CRITICAL: Installation date not persisted (silent failure)"
    }

    if ($verifiedOrder.time_preference -or $verifiedOrder.time_window) {
      Write-Host "  PASS: Time preference persisted" -ForegroundColor Green
    } else {
      Write-Host "  WARNING: Time preference not persisted" -ForegroundColor Yellow
      $warnings += "Time preference not persisted"
    }

    if (($verifiedOrder.installation_date | Out-String) -match '\?') {
      Write-Host "  FAIL: '?' detected in installation_date" -ForegroundColor Red
      $issues += "Broken characters in installation_date display"
    }

  } catch {
    Write-Host ("  FAIL: Schedule verification failed: " + $_.Exception.Message) -ForegroundColor Red
    $issues += "Schedule verification failed"
  }
} else {
  Write-Host "" 
  Write-Host "[4/5] SKIPPED: No job_id to test scheduling" -ForegroundColor Yellow
  Write-Host "[5/5] SKIPPED: Cannot verify schedule" -ForegroundColor Yellow
}

# SUMMARY
Write-Host "" 
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  RESULTS" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta

Write-Host "" 
Write-Host "PERFORMANCE TIMINGS:" -ForegroundColor White
foreach ($t in $timings) {
  $ms = [math]::Round($t.time, 0)
  $color = if ($ms -lt 2000) { 'Green' } elseif ($ms -lt 5000) { 'Yellow' } else { 'Red' }
  Write-Host ("  " + $t.operation + ": " + $ms + "ms") -ForegroundColor $color
}

if ($warnings.Count -gt 0) {
  Write-Host "" 
  Write-Host ("WARNINGS: " + $warnings.Count) -ForegroundColor Yellow
  foreach ($w in $warnings) { Write-Host ("  - " + $w) -ForegroundColor Yellow }
}

if ($issues.Count -eq 0) {
  Write-Host "" 
  Write-Host "PASS: No critical issues" -ForegroundColor Green
  exit 0
}

Write-Host "" 
Write-Host ("FAIL: " + $issues.Count + " issues found") -ForegroundColor Red
foreach ($i in $issues) { Write-Host ("  - " + $i) -ForegroundColor Red }
exit 1
