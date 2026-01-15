# VERIFY PAYOUT CALCULATION FIX (DEPRECATED)
#
# This script predates the schema correction that moved payout storage to h2s_orders.metadata_json.
# It also references dispatch_jobs.metadata / payout_estimated columns that DO NOT exist.
#
# Use instead:
#   .\deploy-and-verify.ps1 -Backend
# (It runs an automated $2,100 payout + scheduling + portal_jobs enrichment verification.)

$ErrorActionPreference = "Stop"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   PAYOUT CALCULATION VERIFICATION" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Bundle Price: `$2,100.00" -ForegroundColor Yellow
Write-Host "Expected Payout: `$735.00 (35%)" -ForegroundColor Yellow
Write-Host "Expected Job Value (cents): 210,000" -ForegroundColor Yellow
Write-Host "Expected Payout (cents): 73,500`n" -ForegroundColor Yellow

# Create test order
$testEmail = "payout-verify-$(Get-Random)@test.com"
Write-Host "Test Email: $testEmail`n" -ForegroundColor Gray

$cart = @(@{
    id = "smart-home-bundle-2100"
    name = "Smart Home Bundle"
    price = 2100  # $2,100 in DOLLARS
    qty = 1
    metadata = @{
        service_type = "smart_home_install"
    }
})

$checkoutPayload = @{
    __action = "create_checkout_session"
    customer = @{
        name = "Payout Verification Test"
        email = $testEmail
        phone = "555-0100"
    }
    cart = $cart
    source = "payout_verification"
    success_url = "https://shop.home2smart.com/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}"
    cancel_url = "https://shop.home2smart.com/bundles"
    metadata = @{
        customer_name = "Payout Verification Test"
        customer_email = $testEmail
        customer_phone = "555-0100"
        service_address = "123 Verification St"
        service_city = "Testville"
        service_state = "SC"
        service_zip = "29601"
    }
} | ConvertTo-Json -Depth 10

Write-Host "[1/2] Creating checkout with `$2,100 bundle..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop" `
        -Method POST `
        -Body $checkoutPayload `
        -ContentType "application/json" `
        -TimeoutSec 30
    
    if (-not $response.ok) {
        Write-Host "  ✗ Checkout failed: $($response.error)" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "  ✓ Checkout created" -ForegroundColor Green
    Write-Host "    Order ID: $($response.order_id)" -ForegroundColor White
    Write-Host "    Job ID: $($response.job_id)" -ForegroundColor White
    
    $orderId = $response.order_id
    $jobId = $response.job_id
    
} catch {
    Write-Host "  ✗ Request failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Start-Sleep -Seconds 3

Write-Host "`n[2/2] Vercel logs (check manually if needed)..." -ForegroundColor Yellow
Write-Host "  Run: vercel logs --output raw | Select-String 'JOB VALUE|payout'" -ForegroundColor Gray

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   VERIFICATION CHECKLIST" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "✅ Check these values in Vercel logs:" -ForegroundColor Yellow
Write-Host ""
Write-Host "   [Checkout] Cart subtotal (DOLLARS): 2100" -ForegroundColor White
Write-Host "   [Checkout] Job value (cents): 210000" -ForegroundColor White
Write-Host "   [Checkout] Tech payout @ 35% (cents): 73500" -ForegroundColor White
Write-Host "   [Checkout] Tech payout (DOLLARS): 735" -ForegroundColor White
Write-Host ""

Write-Host "✅ Query Supabase h2s_dispatch_jobs:" -ForegroundColor Yellow
Write-Host ""
Write-Host "   SELECT" -ForegroundColor Gray
Write-Host "     job_id," -ForegroundColor Gray
Write-Host "     payout_estimated," -ForegroundColor Gray
Write-Host "     metadata->>'job_value_cents' as job_value_cents," -ForegroundColor Gray
Write-Host "     metadata->>'tech_payout_cents' as tech_payout_cents," -ForegroundColor Gray
Write-Host "     metadata->>'job_value_dollars' as job_value_dollars," -ForegroundColor Gray
Write-Host "     metadata->>'tech_payout_dollars' as tech_payout_dollars" -ForegroundColor Gray
Write-Host "   FROM h2s_dispatch_jobs" -ForegroundColor Gray
Write-Host "   WHERE job_id = '$jobId';" -ForegroundColor Gray
Write-Host ""

Write-Host "Expected Results:" -ForegroundColor Yellow
Write-Host "  payout_estimated = 735" -ForegroundColor White
Write-Host "  job_value_cents = 210000" -ForegroundColor White
Write-Host "  tech_payout_cents = 73500" -ForegroundColor White
Write-Host "  job_value_dollars = 2100" -ForegroundColor White
Write-Host "  tech_payout_dollars = 735" -ForegroundColor White
Write-Host ""

Write-Host "❌ If you see payout = 45 or payout < 100:" -ForegroundColor Red
Write-Host "  The fix did not work - dollars/cents conversion still broken" -ForegroundColor White
Write-Host ""

Write-Host "Test Order Created:" -ForegroundColor Cyan
Write-Host "  Order: $orderId" -ForegroundColor White
Write-Host "  Job: $jobId" -ForegroundColor White
Write-Host "  Email: $testEmail`n" -ForegroundColor White
