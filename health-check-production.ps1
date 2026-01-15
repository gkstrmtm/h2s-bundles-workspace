# PRODUCTION HEALTH CHECK
# Quick health check for production API

$apiUrl = "https://h2s-backend.vercel.app"

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "PRODUCTION HEALTH CHECK" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

Write-Host "API: $apiUrl" -ForegroundColor Gray
Write-Host ""

# Test 1: API is reachable
Write-Host "[1/5] API Reachability..." -ForegroundColor Yellow
try {
    $ping = Invoke-WebRequest -Uri "$apiUrl/api/health" -Method GET -TimeoutSec 10 -ErrorAction SilentlyContinue
    Write-Host "  ✅ API is reachable" -ForegroundColor Green
} catch {
    Write-Host "  ⚠️  Health endpoint not found (may not exist)" -ForegroundColor Yellow
}

# Test 2: Checkout endpoint responds
Write-Host "`n[2/5] Checkout Endpoint..." -ForegroundColor Yellow
try {
    $checkoutTest = Invoke-WebRequest -Uri "$apiUrl/api/shop" -Method POST -Body '{"test":"ping"}' -ContentType "application/json" -TimeoutSec 10 -ErrorAction Stop
    Write-Host "  ✅ Checkout endpoint responds" -ForegroundColor Green
} catch {
    if ($_.Exception.Response.StatusCode -eq 400) {
        Write-Host "  ✅ Checkout endpoint responds (validation working)" -ForegroundColor Green
    } else {
        Write-Host "  ❌ Checkout endpoint failed: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Test 3: Single order
Write-Host "`n[3/5] Single Order Creation..." -ForegroundColor Yellow
$testEmail = "health-$(Get-Random)@test.com"
$body = @{
    __action = "create_checkout_session"
    customer = @{
        email = $testEmail
        name = "Health Check"
        phone = "555-0100"
    }
    cart = @(
        @{
            bundle_id = "bnd-welcome-to-h2s"
            name = "Test"
            price = 999
            quantity = 1
        }
    )
    promotion_code = ""
    success_url = "https://example.com/success"
    cancel_url = "https://example.com/cancel"
} | ConvertTo-Json -Depth 10

try {
    $order1 = Invoke-RestMethod -Uri "$apiUrl/api/shop" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30 -ErrorAction Stop
    if ($order1.ok) {
        Write-Host "  ✅ Order created: $($order1.order_id)" -ForegroundColor Green
    } else {
        Write-Host "  ❌ Order creation failed" -ForegroundColor Red
    }
} catch {
    Write-Host "  ❌ Order creation failed: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 4: Repeat customer
Write-Host "`n[4/5] Repeat Customer (Critical!)..." -ForegroundColor Yellow
Start-Sleep -Seconds 2
try {
    $order2 = Invoke-RestMethod -Uri "$apiUrl/api/shop" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30 -ErrorAction Stop
    if ($order2.ok) {
        Write-Host "  ✅ Repeat order created: $($order2.order_id)" -ForegroundColor Green
        Write-Host "  ✅ REPEAT CUSTOMERS WORK!" -ForegroundColor Green
    } else {
        Write-Host "  ❌ Repeat order failed" -ForegroundColor Red
    }
} catch {
    Write-Host "  ❌ REPEAT CUSTOMER BROKEN!" -ForegroundColor Red
    Write-Host "     Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "     ACTION REQUIRED: Check database constraints!" -ForegroundColor Red
}

# Test 5: Response time
Write-Host "`n[5/5] Response Time..." -ForegroundColor Yellow
$start = Get-Date
try {
    $timeTest = Invoke-RestMethod -Uri "$apiUrl/api/shop" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30 -ErrorAction Stop
    $elapsed = ((Get-Date) - $start).TotalSeconds
    if ($elapsed -lt 5) {
        Write-Host "  ✅ Response time: $([math]::Round($elapsed, 2))s (fast)" -ForegroundColor Green
    } elseif ($elapsed -lt 10) {
        Write-Host "  ⚠️  Response time: $([math]::Round($elapsed, 2))s (acceptable)" -ForegroundColor Yellow
    } else {
        Write-Host "  ❌ Response time: $([math]::Round($elapsed, 2))s (slow!)" -ForegroundColor Red
    }
} catch {
    Write-Host "  ❌ Response time test failed" -ForegroundColor Red
}

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "Health check complete!" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan
