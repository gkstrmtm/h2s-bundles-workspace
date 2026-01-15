# SYSTEM GUARDIAN - Quick Validation
# Run this before ANY deployment

$ErrorActionPreference = "Stop"
$Failures = 0

Write-Host "`n============================================" -F Cyan
Write-Host "  SYSTEM GUARDIAN - Quick Validation" -F Cyan
Write-Host "============================================`n" -F Cyan

# Test 1: Relay Health
Write-Host "[1/5] Testing Relay Health..." -F Yellow
try {
    $health = Invoke-RestMethod "https://modest-beauty-production-2b84.up.railway.app/health" -TimeoutSec 5
    if ($health.ok) {
        Write-Host "  PASS: Relay is online" -F Green
    } else {
        Write-Host "  FAIL: Relay unhealthy" -F Red
        $Failures++
    }
} catch {
    Write-Host "  FAIL: Cannot reach relay" -F Red
    $Failures++
}

# Test 2: Relay Stripe Integration
Write-Host "[2/5] Testing Relay <-> Stripe..." -F Yellow
try {
    $body = @{
        sessionParams = @{
            mode = "payment"
            payment_method_types = @("card")
            line_items = @(@{
                price_data = @{
                    currency = "usd"
                    unit_amount = 100
                    product_data = @{name = "Test"}
                }
                quantity = 1
            })
            success_url = "https://test.com"
            cancel_url = "https://test.com"
        }
        idempotencyKey = "guardian-$(Get-Date -Format 'yyyyMMddHHmmss')"
    } | ConvertTo-Json -Depth 10
    
    $response = Invoke-RestMethod -Uri "https://modest-beauty-production-2b84.up.railway.app/stripe/checkout" `
        -Method POST -Headers @{'Authorization'='Bearer a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456';'Content-Type'='application/json'} `
        -Body $body -TimeoutSec 30
        
    if ($response.ok -and $response.session.id) {
        Write-Host "  PASS: Relay can create Stripe sessions" -F Green
    } else {
        Write-Host "  FAIL: Relay cannot create sessions" -F Red
        $Failures++
    }
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -F Red
    $Failures++
}

# Test 3: Vercel Environment Variables
Write-Host "[3/5] Checking Vercel Environment..." -F Yellow
try {
    $envs = vercel env ls 2>&1 | Out-String
    $requiredVars = @("STRIPE_RELAY_URL", "STRIPE_RELAY_SECRET", "STRIPE_SECRET_KEY")
    $missing = @()
    
    foreach ($var in $requiredVars) {
        if ($envs -notlike "*$var*") {
            $missing += $var
        }
    }
    
    if ($missing.Count -eq 0) {
        Write-Host "  PASS: All environment variables configured" -F Green
    } else {
        Write-Host "  FAIL: Missing variables: $($missing -join ', ')" -F Red
        $Failures++
    }
} catch {
    Write-Host "  WARN: Could not check environment variables" -F Yellow
}

# Test 4: Full Checkout Flow
Write-Host "[4/5] Testing Full Checkout Flow..." -F Yellow
try {
    $body = @{
        __action = 'create_checkout_session'
        customer = @{name='Test';email='test@test.com';phone='5555555555'}
        cart = @(@{id='test';name='Test';price=100;qty=1})
        success_url = 'https://test.com/success'
        cancel_url = 'https://test.com/cancel'
    } | ConvertTo-Json -Depth 5
    
    $response = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop" `
        -Method POST -Body $body -ContentType 'application/json' -TimeoutSec 30
        
    if ($response.ok -and $response.pay.session_url) {
        Write-Host "  PASS: Vercel -> Relay -> Stripe working" -F Green
    } else {
        Write-Host "  FAIL: Checkout flow broken" -F Red
        $Failures++
    }
} catch {
    Write-Host "  FAIL: $($_.Exception.Message)" -F Red
    $Failures++
}

# Test 5: Frontend Accessibility
Write-Host "[5/5] Testing Frontend..." -F Yellow
try {
    $response = Invoke-WebRequest "https://shop.home2smart.com/bundles" -UseBasicParsing -TimeoutSec 10
    if ($response.StatusCode -eq 200) {
        Write-Host "  PASS: Frontend accessible" -F Green
    } else {
        Write-Host "  FAIL: Frontend unreachable" -F Red
        $Failures++
    }
} catch {
    Write-Host "  FAIL: Cannot reach frontend" -F Red
    $Failures++
}

# Summary
Write-Host "`n============================================" -F Cyan
if ($Failures -eq 0) {
    Write-Host "  ALL SYSTEMS OPERATIONAL" -F Green
    Write-Host "  Safe to deploy and process payments" -F Green
    Write-Host "============================================`n" -F Cyan
    exit 0
} else {
    Write-Host "  $Failures CRITICAL FAILURE(S) DETECTED" -F Red
    Write-Host "  DO NOT DEPLOY - FIX ISSUES ABOVE" -F Red
    Write-Host "============================================`n" -F Cyan
    exit 1
}
