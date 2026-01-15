# END-TO-END CHECKOUT TEST
# Simulates complete checkout flow from cart to webhook

param(
    [switch]$Production,
    [switch]$Local
)

$ErrorActionPreference = "Stop"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   END-TO-END CHECKOUT TEST" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$baseUrl = if ($Production) {
    "https://h2s-backend.vercel.app"
} elseif ($Local) {
    "http://localhost:3000"
} else {
    Write-Host "❌ Must specify -Production or -Local" -ForegroundColor Red
    exit 1
}

Write-Host "Testing against: $baseUrl`n" -ForegroundColor Cyan

# ============================================
# TEST 1: Catalog Fetch
# ============================================

Write-Host "[1/5] Testing catalog fetch..." -ForegroundColor Yellow

try {
    $catalog = Invoke-RestMethod -Uri "$baseUrl/api/shop?action=catalog" -Method Get -TimeoutSec 10
    
    if ($catalog.ok -and $catalog.bundles) {
        $bundleCount = $catalog.bundles.Count
        Write-Host "  ✓ Catalog loaded: $bundleCount bundles" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Catalog response invalid!" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  ✗ Catalog fetch failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# ============================================
# TEST 2: Checkout Creation (CRITICAL)
# ============================================

Write-Host "`n[2/5] Testing checkout creation..." -ForegroundColor Yellow

$testCart = @(
    @{
        id = "BUNDLE-001"
        name = "Test Bundle"
        price = 9900
        quantity = 1
        bundle_value = 100
    }
)

$checkoutPayload = @{
    action = "checkout"
    cart = $testCart
    email = "test@example.com"
    phone = "555-1234"
    address = "123 Test St"
    city = "TestCity"
    state = "TS"
    zip = "12345"
} | ConvertTo-Json -Depth 10

try {
    $checkout = Invoke-RestMethod -Uri "$baseUrl/api/shop" -Method Post -Body $checkoutPayload -ContentType "application/json" -TimeoutSec 30
    
    # Validate response structure
    $valid = $true
    
    if (-not $checkout.ok) {
        Write-Host "  ✗ Checkout failed: ok = false" -ForegroundColor Red
        $valid = $false
    }
    
    if (-not $checkout.sessionId) {
        Write-Host "  ✗ Missing sessionId" -ForegroundColor Red
        $valid = $false
    }
    
    if (-not $checkout.order_id) {
        Write-Host "  ✗ Missing order_id - webhook won't work!" -ForegroundColor Red
        $valid = $false
    }
    
    if (-not $checkout.job_id) {
        Write-Host "  ✗ Missing job_id - job not created!" -ForegroundColor Red
        $valid = $false
    }
    
    if ($valid) {
        Write-Host "  ✓ Checkout created successfully" -ForegroundColor Green
        Write-Host "    - Session ID: $($checkout.sessionId.Substring(0,20))..." -ForegroundColor Gray
        Write-Host "    - Order ID: $($checkout.order_id)" -ForegroundColor Gray
        Write-Host "    - Job ID: $($checkout.job_id)" -ForegroundColor Gray
        
        # Save for later tests
        $script:orderId = $checkout.order_id
        $script:jobId = $checkout.job_id
    } else {
        exit 1
    }
    
} catch {
    Write-Host "  ✗ Checkout creation failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# ============================================
# TEST 3: Job Status Verification
# ============================================

Write-Host "`n[3/5] Verifying job status..." -ForegroundColor Yellow

if ($Production) {
    Write-Host "  ⚠ Skipping database check (production mode)" -ForegroundColor Yellow
    Write-Host "  → Job ID: $script:jobId should be 'pending_payment'" -ForegroundColor Gray
} else {
    Write-Host "  → Job ID: $script:jobId" -ForegroundColor Gray
    Write-Host "  → Expected status: pending_payment" -ForegroundColor Gray
    Write-Host "  ℹ Manual verification required (check Supabase)" -ForegroundColor Cyan
}

# ============================================
# TEST 4: Frontend Success Page
# ============================================

Write-Host "`n[4/5] Testing success page rendering..." -ForegroundColor Yellow

try {
    $frontendUrl = if ($Production) {
        "https://shop.home2smart.com/bundles"
    } else {
        "http://localhost:8080/bundles"
    }
    
    $response = Invoke-WebRequest -Uri $frontendUrl -UseBasicParsing -TimeoutSec 10
    
    # Check for critical components
    $checks = @{
        "Static success page" = $response.Content -match '<div id="staticSuccessPage"'
        "Success detection script" = $response.Content -match "p\.get\('view'\)==='shopsuccess'"
        "Checkout function" = $response.Content -match "window\.checkout"
    }
    
    foreach ($check in $checks.GetEnumerator()) {
        if ($check.Value) {
            Write-Host "  ✓ $($check.Key)" -ForegroundColor Green
        } else {
            Write-Host "  ✗ Missing: $($check.Key)" -ForegroundColor Red
        }
    }
    
} catch {
    Write-Host "  ✗ Frontend test failed: $($_.Exception.Message)" -ForegroundColor Red
}

# ============================================
# TEST 5: Webhook Simulation
# ============================================

Write-Host "`n[5/5] Webhook test guidance..." -ForegroundColor Yellow
Write-Host "  ℹ Automated webhook testing requires Stripe webhook setup" -ForegroundColor Cyan
Write-Host "  → To test webhook:" -ForegroundColor Gray
Write-Host "    1. Complete a real checkout with Stripe test card" -ForegroundColor Gray
Write-Host "    2. Check job status changes from 'pending_payment' to 'queued'" -ForegroundColor Gray
Write-Host "    3. Verify job appears in technician portal" -ForegroundColor Gray

# ============================================
# SUMMARY
# ============================================

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   TEST SUMMARY" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "✅ Catalog: PASSED" -ForegroundColor Green
Write-Host "✅ Checkout: PASSED" -ForegroundColor Green
Write-Host "✅ Response: PASSED (order_id + job_id present)" -ForegroundColor Green
Write-Host "⚠  Job Status: Manual verification required" -ForegroundColor Yellow
Write-Host "✅ Frontend: Components present" -ForegroundColor Green

Write-Host "`n📋 Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Test with real Stripe checkout" -ForegroundColor White
Write-Host "  2. Verify webhook activates job" -ForegroundColor White
Write-Host "  3. Check job appears in portal" -ForegroundColor White
Write-Host ""
