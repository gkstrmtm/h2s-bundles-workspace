# AGGRESSIVE END-TO-END FLOW TEST
# This creates a test order and validates EVERYTHING

$ErrorActionPreference = "Stop"
$backendUrl = "https://h2s-backend.vercel.app"

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "  AGGRESSIVE FLOW TEST - Order -> Job Validation" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

# Generate unique test data
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$testEmail = "flowtest-$timestamp@test.com"
$testName = "FlowTest-$timestamp"

Write-Host "[1/5] Creating test order..." -ForegroundColor Yellow
Write-Host "      Email: $testEmail" -ForegroundColor Gray

$checkoutBody = @{
    __action = "create_checkout_session"
    customer = @{
        email = $testEmail
        name = $testName
        phone = "5551234567"
    }
    cart = @(
        @{
            id = "smart-home-bundle"
            name = "Smart Home Bundle Test"
            price = 99900  # $999 in cents
            quantity = 1
            metadata = @{
                bundle_type = "smart_home"
                test_order = $true
            }
        }
    )
    metadata = @{
        customer_email = $testEmail
        customer_name = $testName
        customer_phone = "5551234567"
        service_address = "123 Test Street"
        service_city = "Los Angeles"
        service_state = "CA"
        service_zip = "90210"
        test_timestamp = $timestamp
    }
    success_url = "https://home2smart.com/success?session_id={CHECKOUT_SESSION_ID}"
    cancel_url = "https://home2smart.com/cancel"
} | ConvertTo-Json -Depth 10

try {
    $checkoutResp = Invoke-RestMethod -Uri "$backendUrl/api/shop" -Method POST -Body $checkoutBody -ContentType "application/json" -TimeoutSec 30
    
    if (!$checkoutResp.ok) {
        Write-Host "      FAILED: $($checkoutResp.error)" -ForegroundColor Red
        exit 1
    }
    
    $sessionId = $checkoutResp.pay.session_id
    Write-Host "      SUCCESS: Session created: $sessionId" -ForegroundColor Green
    
} catch {
    Write-Host "      FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n[2/5] Waiting for database write (3 seconds)..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

Write-Host "`n[3/5] Querying h2s_orders table..." -ForegroundColor Yellow

try {
    $ordersResp = Invoke-RestMethod -Uri "$backendUrl/api/customer_orders" -Method POST -Body (@{
        customer_email = $testEmail
    } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 10
    
    if (!$ordersResp.ok -or $ordersResp.orders.Count -eq 0) {
        Write-Host "      CRITICAL FAILURE: Order not found in h2s_orders!" -ForegroundColor Red
        Write-Host "      This means order insertion failed completely" -ForegroundColor Red
        exit 1
    }
    
    $order = $ordersResp.orders[0]
    $orderId = $order.order_id
    Write-Host "      Order ID: $orderId" -ForegroundColor Green
    Write-Host "      Status: $($order.status)" -ForegroundColor Gray
    Write-Host "      Created: $($order.created_at)" -ForegroundColor Gray
    
} catch {
    Write-Host "      FAILED: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n[4/5] Checking job_id in order metadata..." -ForegroundColor Yellow

$metadata = $order.metadata_json
$jobIdInOrder = $order.job_id
$dispatchJobId = $metadata.dispatch_job_id
$dispatchRecipientId = $metadata.dispatch_recipient_id

Write-Host "      job_id (order field): " -NoNewline
if ($jobIdInOrder) {
    Write-Host $jobIdInOrder -ForegroundColor Green
} else {
    Write-Host "NULL" -ForegroundColor Red
}

Write-Host "      dispatch_job_id (metadata): " -NoNewline
if ($dispatchJobId) {
    Write-Host $dispatchJobId -ForegroundColor Green
} else {
    Write-Host "NULL" -ForegroundColor Red
}

Write-Host "      dispatch_recipient_id (metadata): " -NoNewline
if ($dispatchRecipientId) {
    Write-Host $dispatchRecipientId -ForegroundColor Green
} else {
    Write-Host "NULL" -ForegroundColor Red
}

Write-Host "`n[5/5] Checking h2s_dispatch_jobs table..." -ForegroundColor Yellow

if ($env:H2S_ADMIN_TOKEN) {
    try {
        $jobsResp = Invoke-RestMethod -Uri "$backendUrl/api/portal_jobs" -Method POST -Body (@{
            token = $env:H2S_ADMIN_TOKEN
        } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 10
        
        if ($jobsResp.ok) {
            $allJobs = $jobsResp.offers + $jobsResp.upcoming + $jobsResp.completed
            $ourJob = $allJobs | Where-Object { $_.order_id -eq $orderId } | Select-Object -First 1
            
            if ($ourJob) {
                Write-Host "      Job ID: $($ourJob.job_id)" -ForegroundColor Green
                Write-Host "      Status: $($ourJob.status)" -ForegroundColor Gray
                Write-Host "      Recipient ID: $($ourJob.recipient_id)" -ForegroundColor Gray
            } else {
                Write-Host "      NO JOB FOUND with order_id = $orderId" -ForegroundColor Red
                Write-Host "      Total jobs in system: $($allJobs.Count)" -ForegroundColor Gray
            }
        } else {
            Write-Host "      Failed to query jobs: $($jobsResp.error)" -ForegroundColor Red
        }
    } catch {
        Write-Host "      Failed to query jobs: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "      Skipped (H2S_ADMIN_TOKEN not set)" -ForegroundColor Yellow
    Write-Host "      Set H2S_ADMIN_TOKEN to check dispatch jobs table" -ForegroundColor Gray
}

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "  RESULTS SUMMARY" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

$issues = @()

if (!$orderId) {
    $issues += "Order not created in h2s_orders"
}

if (!$jobIdInOrder -and !$dispatchJobId) {
    $issues += "No job_id in order (job creation likely failed)"
}

if (!$dispatchRecipientId) {
    $issues += "No recipient_id in order metadata (recipient creation failed)"
}

if ($issues.Count -eq 0) {
    Write-Host "`nSTATUS: ALL CHECKS PASSED!" -ForegroundColor Green
    Write-Host "Order -> Job flow is working correctly" -ForegroundColor Green
} else {
    Write-Host "`nSTATUS: $($issues.Count) ISSUE(S) FOUND" -ForegroundColor Red
    foreach ($issue in $issues) {
        Write-Host "  - $issue" -ForegroundColor Red
    }
    Write-Host "`nNext step: Check Vercel logs for [Checkout] error messages" -ForegroundColor Yellow
}

Write-Host "`n================================================================`n" -ForegroundColor Cyan
