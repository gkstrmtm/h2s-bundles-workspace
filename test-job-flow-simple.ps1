# Simple Order to Job Flow Test
# Tests if orders are creating dispatch jobs

param(
    [string]$TestEmail = "test-flow-$(Get-Random)@example.com"
)

$ErrorActionPreference = "Continue"
$backendUrl = "https://h2s-backend.vercel.app"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "ORDER -> JOB FLOW DIAGNOSTIC" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "`nTest Email: $TestEmail" -ForegroundColor Yellow

# Step 1: Create test checkout
Write-Host "`n[1/4] Creating test checkout session..." -ForegroundColor Cyan

$testCart = @(
    @{
        id = "test-item-1"
        name = "Test Smart Home Bundle"
        price = 999
        qty = 1
        metadata = @{
            category = "bundle"
        }
    }
)

$checkoutPayload = @{
    customer = @{
        email = $TestEmail
        name = "Test Customer"
        phone = "5551234567"
    }
    cart = $testCart
    metadata = @{
        customer_email = $TestEmail
        test_order = "true"
    }
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-RestMethod -Uri "$backendUrl/api/shop" `
        -Method POST `
        -ContentType "application/json" `
        -Body $checkoutPayload `
        -TimeoutSec 30
    
    Write-Host "   Success! Session ID: $($response.sessionId)" -ForegroundColor Green
    $sessionId = $response.sessionId
} catch {
    Write-Host "   ERROR creating checkout session:" -ForegroundColor Red
    Write-Host "   $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 2: Wait for webhook processing
Write-Host "`n[2/4] Waiting for order processing (5 seconds)..." -ForegroundColor Cyan
Start-Sleep -Seconds 5

# Step 3: Check if order was created in h2s_orders
Write-Host "`n[3/4] Checking for order in h2s_orders..." -ForegroundColor Cyan

try {
    $orderCheckUrl = "$backendUrl/api/customer_orders?email=$([System.Uri]::EscapeDataString($TestEmail))"
    $orders = Invoke-RestMethod -Uri $orderCheckUrl -Method GET -TimeoutSec 15
    
    $ourOrder = $orders | Where-Object { $_.customer_email -eq $TestEmail } | Select-Object -First 1
    
    if ($ourOrder) {
        Write-Host "   SUCCESS: Order found!" -ForegroundColor Green
        Write-Host "   Order ID: $($ourOrder.id)" -ForegroundColor White
        Write-Host "   Status: $($ourOrder.status)" -ForegroundColor White
        Write-Host "   Total: `$$($ourOrder.final_total)" -ForegroundColor White
        $orderId = $ourOrder.id
    } else {
        Write-Host "   WARNING: No order found for $TestEmail" -ForegroundColor Yellow
        Write-Host "   This might be normal if webhook hasn't processed yet" -ForegroundColor Yellow
        $orderId = $null
    }
} catch {
    Write-Host "   ERROR checking orders:" -ForegroundColor Red
    Write-Host "   $($_.Exception.Message)" -ForegroundColor Red
    $orderId = $null
}

# Step 4: Check if job was created in h2s_dispatch_jobs
Write-Host "`n[4/4] Checking for job in h2s_dispatch_jobs..." -ForegroundColor Cyan

try {
    $jobCheckUrl = "$backendUrl/api/portal_jobs?recipientEmail=$([System.Uri]::EscapeDataString($TestEmail))"
    $jobs = Invoke-RestMethod -Uri $jobCheckUrl -Method GET -TimeoutSec 15
    
    $ourJob = $jobs | Where-Object { $_.recipient_email -eq $TestEmail } | Select-Object -First 1
    
    if ($ourJob) {
        Write-Host "   SUCCESS: Job found!" -ForegroundColor Green
        Write-Host "   Job ID: $($ourJob.id)" -ForegroundColor White
        Write-Host "   Status: $($ourJob.status)" -ForegroundColor White
        Write-Host "   Order ID: $($ourJob.order_id)" -ForegroundColor White
    } else {
        Write-Host "   FAILED: No job found for $TestEmail" -ForegroundColor Red
        $ourJob = $null
    }
} catch {
    Write-Host "   ERROR checking jobs:" -ForegroundColor Red
    Write-Host "   $($_.Exception.Message)" -ForegroundColor Red
    $ourJob = $null
}

# Summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "DIAGNOSTIC SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if ($orderId -and !$ourJob) {
    Write-Host "`nCRITICAL ISSUE IDENTIFIED:" -ForegroundColor Red
    Write-Host "  - Order was created in h2s_orders" -ForegroundColor Yellow
    Write-Host "  - BUT job was NOT created in h2s_dispatch_jobs" -ForegroundColor Yellow
    Write-Host "`nThis breaks the dispatch workflow!" -ForegroundColor Red
    Write-Host "`nNext steps:" -ForegroundColor White
    Write-Host "  1. Check Vercel logs for dispatch job errors" -ForegroundColor Gray
    Write-Host "  2. Look for '[Checkout]' prefixed error messages" -ForegroundColor Gray
    Write-Host "  3. Check recipient creation errors" -ForegroundColor Gray
    Write-Host "  4. Verify h2s_dispatch_jobs table permissions" -ForegroundColor Gray
    
    Write-Host "`nCheck logs with:" -ForegroundColor Cyan
    Write-Host "  vercel logs h2s-backend.vercel.app --follow" -ForegroundColor White
    
} elseif ($orderId -and $ourJob) {
    Write-Host "`nSUCCESS! Data flow is working:" -ForegroundColor Green
    Write-Host "  - Order created in h2s_orders" -ForegroundColor Green
    Write-Host "  - Job created in h2s_dispatch_jobs" -ForegroundColor Green
    Write-Host "  - Portal would show this job to technicians" -ForegroundColor Green
    
} else {
    Write-Host "`nINCOMPLETE TEST:" -ForegroundColor Yellow
    Write-Host "  Order was not found (webhook may be processing)" -ForegroundColor Yellow
    Write-Host "  Try running again in 10 seconds" -ForegroundColor Yellow
}

Write-Host ""
