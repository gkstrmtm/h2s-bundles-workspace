# DEPLOYMENT VERIFICATION SCRIPT
# Run this immediately after deploying backend changes

param(
    [string]$DeploymentUrl = "https://h2s-backend.vercel.app",
    [int]$BundlePriceDollars = 2100,
    [string]$DeliveryDate = "2026-01-20",
    [string]$DeliveryTime = "9am - 12pm"
)

$ErrorActionPreference = "Continue"

Write-Host "`n============================================" -ForegroundColor Magenta
Write-Host "DEPLOYMENT VERIFICATION" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta
Write-Host "URL: $DeploymentUrl`n" -ForegroundColor Gray

$allPassed = $true

# Critical Test 1: Single checkout
Write-Host "[CRITICAL] Testing single checkout..." -ForegroundColor Yellow
$email1 = "deploy-verify-$(Get-Random)@test.com"
$price = [int]$BundlePriceDollars
$expectedPayout = [Math]::Round($price * 0.35, 2)

$body = @{
    customer = @{ email = $email1; name = "Deploy Test"; phone = "555-0100" }
    cart = @(@{ id = "bundle-1"; name = "Smart Home Bundle"; price = $price; qty = 1 })
    metadata = @{ customer_email = $email1; customer_name = "Deploy Test"; service_address = "123 Test St"; service_city = "LA"; service_state = "CA"; service_zip = "90210" }
} | ConvertTo-Json -Depth 10

try {
    $r1 = Invoke-RestMethod -Uri "$DeploymentUrl/api/shop" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30 -ErrorAction Stop
    if ($r1.ok -and $r1.order_id -and $r1.job_id) {
        Write-Host "  ✅ PASS: Order $($r1.order_id)" -ForegroundColor Green
    } else {
        Write-Host "  ❌ FAIL: Missing order_id or job_id" -ForegroundColor Red
        $allPassed = $false
    }
} catch {
    Write-Host "  ❌ FAIL: $($_.Exception.Message)" -ForegroundColor Red
    $allPassed = $false
}

Start-Sleep -Seconds 3

# Critical Test 1b: Verify payout stored on order
Write-Host "`n[CRITICAL] Verifying payout stored on order (35% of $$price = $$expectedPayout)..." -ForegroundColor Yellow
try {
    $od = Invoke-RestMethod -Uri "$DeploymentUrl/api/get-order-details?order_id=$($r1.order_id)" -Method GET -TimeoutSec 30 -ErrorAction Stop
    if (-not $od.ok) { throw "get-order-details returned ok=false" }
    $meta = $od.order.metadata
    $jobValueCents = [int]$meta.job_value_cents
    $techPayoutDollars = [double]$meta.tech_payout_dollars
    if ($jobValueCents -ne ($price * 100)) { throw "job_value_cents expected $($price*100) got $jobValueCents" }
    if ([Math]::Abs($techPayoutDollars - $expectedPayout) -gt 0.001) { throw "tech_payout_dollars expected $expectedPayout got $techPayoutDollars" }
    Write-Host "  ✅ PASS: Payout $$techPayoutDollars" -ForegroundColor Green
} catch {
    Write-Host "  ❌ FAIL: $($_.Exception.Message)" -ForegroundColor Red
    $allPassed = $false
}

# Critical Test 2: Repeat customer
Write-Host "`n[CRITICAL] Testing repeat customer..." -ForegroundColor Yellow
try {
    $r2 = Invoke-RestMethod -Uri "$DeploymentUrl/api/shop" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30 -ErrorAction Stop
    if ($r2.ok -and $r2.order_id -and $r2.job_id) {
        Write-Host "  ✅ PASS: Order $($r2.order_id)" -ForegroundColor Green
    } else {
        Write-Host "  ❌ FAIL: Repeat customer broken!" -ForegroundColor Red
        $allPassed = $false
    }
} catch {
    Write-Host "  ❌ FAIL: Repeat customer broken!" -ForegroundColor Red
    Write-Host "     $($_.Exception.Message)" -ForegroundColor Red
    $allPassed = $false
}

# Critical Test 3: Schedule + portal_jobs single-job enrichment
Write-Host "`n[CRITICAL] Scheduling install + verifying portal_jobs (single job) shows payout/date..." -ForegroundColor Yellow
try {
    $schedBody = @{ order_id = $r1.order_id; delivery_date = $DeliveryDate; delivery_time = $DeliveryTime } | ConvertTo-Json
    $sched = Invoke-RestMethod -Uri "$DeploymentUrl/api/schedule-appointment" -Method POST -Body $schedBody -ContentType "application/json" -TimeoutSec 45 -ErrorAction Stop
    if (-not $sched.ok) { throw "schedule-appointment returned ok=false" }

    $loginBody = @{ email = "tech@home2smart.com"; zip = "00000" } | ConvertTo-Json
    $login = Invoke-RestMethod -Uri "$DeploymentUrl/api/portal_login" -Method POST -Body $loginBody -ContentType "application/json" -TimeoutSec 30 -ErrorAction Stop
    if (-not $login.ok -or -not $login.token) { throw "portal_login failed" }

    $job = Invoke-RestMethod -Uri "$DeploymentUrl/api/portal_jobs?token=$($login.token)&job_id=$($r1.job_id)" -Method GET -TimeoutSec 45 -ErrorAction Stop
    if (-not $job.ok) { throw "portal_jobs returned ok=false" }

    $payout = [double]$job.job.payout_estimated
    $dueAt = [string]$job.job.due_at
    if ([Math]::Abs($payout - $expectedPayout) -gt 0.001) { throw "portal payout_estimated expected $expectedPayout got $payout" }
    if ($dueAt -and (-not $dueAt.StartsWith($DeliveryDate))) { throw "portal due_at expected startswith $DeliveryDate got $dueAt" }

    Write-Host "  ✅ PASS: portal_jobs payout + due_at OK" -ForegroundColor Green
} catch {
    Write-Host "  ❌ FAIL: $($_.Exception.Message)" -ForegroundColor Red
    $allPassed = $false
}

# Test 3: Order IDs are unique
if ($r1.order_id -and $r2.order_id) {
    Write-Host "`n[CRITICAL] Checking order ID uniqueness..." -ForegroundColor Yellow
    if ($r1.order_id -ne $r2.order_id) {
        Write-Host "  ✅ PASS: Order IDs are unique" -ForegroundColor Green
        Write-Host "     Order 1: $($r1.order_id)" -ForegroundColor Gray
        Write-Host "     Order 2: $($r2.order_id)" -ForegroundColor Gray
    } else {
        Write-Host "  ❌ FAIL: Order IDs are the same!" -ForegroundColor Red
        Write-Host "     This means order_id generation is broken!" -ForegroundColor Red
        $allPassed = $false
    }
}

# Final verdict
Write-Host "`n============================================" -ForegroundColor Magenta
if ($allPassed) {
    Write-Host "✅ DEPLOYMENT VERIFIED - SAFE TO ALIAS" -ForegroundColor Green
    Write-Host "============================================" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "To make this deployment live, run:" -ForegroundColor White
    Write-Host "  cd backend" -ForegroundColor Gray
    Write-Host "  vercel alias <deployment-url> h2s-backend.vercel.app" -ForegroundColor Gray
    exit 0
} else {
    Write-Host "❌ DEPLOYMENT FAILED VERIFICATION" -ForegroundColor Red
    Write-Host "============================================" -ForegroundColor Magenta
    Write-Host ""
    Write-Host "DO NOT ALIAS THIS DEPLOYMENT!" -ForegroundColor Red
    Write-Host "Fix the errors above and redeploy." -ForegroundColor Red
    exit 1
}
