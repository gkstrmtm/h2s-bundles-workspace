# TEST DISPATCH JOB DATA FIX
# Validates install date and payout are correct

$ErrorActionPreference = "Stop"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   DISPATCH JOB DATA FIX TEST" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Test configuration
$backendUrl = "https://h2s-backend.vercel.app"
$testEmail = "dispatch-fix-test-$(Get-Random)@test.com"

Write-Host "Test Email: $testEmail`n" -ForegroundColor Yellow

# ============================================
# STEP 1: Create checkout with known cart value
# ============================================

Write-Host "[1/4] Creating checkout..." -ForegroundColor Yellow

$cart = @(
    @{
        id = "test-bundle-001"
        name = "Test Smart Home Bundle"
        price = 210000  # $2,100 in cents
        qty = 1
        metadata = @{
            service_type = "smart_home_install"
        }
    }
)

$checkoutPayload = @{
    __action = "create_checkout_session"
    customer = @{
        name = "Dispatch Test Customer"
        email = $testEmail
        phone = "555-0199"
    }
    cart = $cart
    source = "dispatch_fix_test"
    success_url = "https://shop.home2smart.com/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}"
    cancel_url = "https://shop.home2smart.com/bundles"
    metadata = @{
        customer_name = "Dispatch Test Customer"
        customer_email = $testEmail
        service_address = "123 Test Lane"
        service_city = "Testville"
        service_state = "SC"
        service_zip = "29601"
    }
} | ConvertTo-Json -Depth 10

try {
    $checkoutResponse = Invoke-RestMethod -Uri "$backendUrl/api/shop" `
        -Method POST `
        -Body $checkoutPayload `
        -ContentType "application/json" `
        -TimeoutSec 30
    
    if (-not $checkoutResponse.ok) {
        Write-Host "  ✗ Checkout failed: $($checkoutResponse.error)" -ForegroundColor Red
        exit 1
    }
    
    $orderId = $checkoutResponse.order_id
    $jobId = $checkoutResponse.job_id
    
    Write-Host "  ✓ Checkout created" -ForegroundColor Green
    Write-Host "    Order ID: $orderId" -ForegroundColor Gray
    Write-Host "    Job ID: $jobId" -ForegroundColor Gray
    
} catch {
    Write-Host "  ✗ Checkout failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Start-Sleep -Seconds 2

# ============================================
# STEP 2: Check job was created with correct payout
# ============================================

Write-Host "`n[2/4] Checking job payout..." -ForegroundColor Yellow

# Expected: $2,100 * 35% = $735
$expectedJobValue = 2100.00
$expectedPayout = 735.00

Write-Host "  Expected job value: `$$expectedJobValue" -ForegroundColor Gray
Write-Host "  Expected payout (35%): `$$expectedPayout" -ForegroundColor Gray

# We can't query Supabase directly, but we can check backend logs
Write-Host "  ℹ Manual verification required:" -ForegroundColor Cyan
Write-Host "    1. Check Vercel logs for: [Checkout] Tech payout @ 35%: $expectedPayout" -ForegroundColor Gray
Write-Host "    2. Query h2s_dispatch_jobs for job_id: $jobId" -ForegroundColor Gray
Write-Host "    3. Verify payout_estimated = $expectedPayout" -ForegroundColor Gray

# ============================================
# STEP 3: Schedule appointment with specific date
# ============================================

Write-Host "`n[3/4] Scheduling appointment..." -ForegroundColor Yellow

$scheduleDate = "2026-01-15"  # Wed, Jan 15, 2026
$scheduleWindow = "12:00 PM - 3:00 PM"

Write-Host "  Install Date: $scheduleDate" -ForegroundColor Gray
Write-Host "  Time Window: $scheduleWindow" -ForegroundColor Gray

$schedulePayload = @{
    order_id = $orderId
    delivery_date = $scheduleDate
    delivery_time = $scheduleWindow
    session_id = $checkoutResponse.pay.session_id
    customer_name = "Dispatch Test Customer"
    customer_email = $testEmail
    customer_phone = "555-0199"
    service_address = "123 Test Lane"
    service_city = "Testville"
    service_state = "SC"
    service_zip = "29601"
} | ConvertTo-Json -Depth 10

try {
    $scheduleResponse = Invoke-RestMethod -Uri "$backendUrl/api/schedule-appointment" `
        -Method POST `
        -Body $schedulePayload `
        -ContentType "application/json" `
        -TimeoutSec 30
    
    if (-not $scheduleResponse.ok) {
        Write-Host "  ✗ Scheduling failed: $($scheduleResponse.error)" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "  ✓ Appointment scheduled" -ForegroundColor Green
    
} catch {
    Write-Host "  ✗ Scheduling failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Start-Sleep -Seconds 2

# ============================================
# STEP 4: Verify job data in portal
# ============================================

Write-Host "`n[4/4] Verification checklist..." -ForegroundColor Yellow

Write-Host "`n📋 Manual Verification Steps:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Check Backend Logs (Vercel)" -ForegroundColor White
Write-Host "   ✓ Should see: [Checkout] Job value (cents): 210000" -ForegroundColor Gray
Write-Host "   ✓ Should see: [Checkout] Tech payout @ 35%: 735" -ForegroundColor Gray
Write-Host "   ✓ Should see: [Schedule] Install date (YYYY-MM-DD): $scheduleDate" -ForegroundColor Gray
Write-Host "   ✓ Should see: [Schedule] Install window: $scheduleWindow" -ForegroundColor Gray
Write-Host ""

Write-Host "2. Query Supabase h2s_dispatch_jobs" -ForegroundColor White
Write-Host "   SELECT * FROM h2s_dispatch_jobs WHERE job_id = '$jobId';" -ForegroundColor Gray
Write-Host ""
Write-Host "   ✓ payout_estimated should be: 735" -ForegroundColor Gray
Write-Host "   ✓ start_iso should contain: $scheduleDate" -ForegroundColor Gray
Write-Host "   ✓ due_at should contain: $scheduleDate" -ForegroundColor Gray
Write-Host "   ✓ metadata->install_date should be: $scheduleDate" -ForegroundColor Gray
Write-Host "   ✓ metadata->install_window should be: $scheduleWindow" -ForegroundColor Gray
Write-Host "   ✓ metadata->job_value_cents should be: 210000" -ForegroundColor Gray
Write-Host "   ✓ metadata->tech_payout_cents should be: 73500" -ForegroundColor Gray
Write-Host ""

Write-Host "3. Check Dispatch Portal" -ForegroundColor White
Write-Host "   Open: https://portal.home2smart.com" -ForegroundColor Gray
Write-Host "   Find job: $jobId" -ForegroundColor Gray
Write-Host ""
Write-Host "   ✓ Date should show: Wed, Jan 15 (NOT today's date)" -ForegroundColor Gray
Write-Host "   ✓ Time window should show: $scheduleWindow" -ForegroundColor Gray
Write-Host "   ✓ Payout should show: `$735.00 (NOT `$45.00)" -ForegroundColor Gray
Write-Host ""

Write-Host "4. Test with 100% Discount" -ForegroundColor White
Write-Host "   Apply promo code for 100% off" -ForegroundColor Gray
Write-Host "   Complete checkout (Stripe shows `$0 paid)" -ForegroundColor Gray
Write-Host ""
Write-Host "   ✓ Job payout should STILL show `$735.00" -ForegroundColor Gray
Write-Host "   ✓ Job value based on subtotal, not amount paid" -ForegroundColor Gray
Write-Host ""

# ============================================
# SUMMARY
# ============================================

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   TEST DATA CREATED" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Order ID:   $orderId" -ForegroundColor Green
Write-Host "Job ID:     $jobId" -ForegroundColor Green
Write-Host "Email:      $testEmail" -ForegroundColor Green
Write-Host ""
Write-Host "Expected Results:" -ForegroundColor Yellow
Write-Host "  - Install Date: Wed, Jan 15, 2026" -ForegroundColor White
Write-Host "  - Time Window: 12:00 PM - 3:00 PM" -ForegroundColor White
Write-Host "  - Job Value: `$2,100.00" -ForegroundColor White
Write-Host "  - Tech Payout: `$735.00 (35%)" -ForegroundColor White
Write-Host ""

Write-Host "✅ Test data created successfully!" -ForegroundColor Green
Write-Host "Follow verification steps above to confirm fixes work.`n" -ForegroundColor Cyan
