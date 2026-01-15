# COMPLETE SYSTEM VALIDATION TEST
# Tests: Checkout -> Order Creation -> Job Dispatch -> Portal Display

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   H2S COMPLETE SYSTEM VALIDATION" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$testEmail = "sysvalidate-$(Get-Random)@test.com"
$sessionId = $null
$orderId = $null
$jobId = $null

# STEP 1: CREATE CHECKOUT
Write-Host "`n[STEP 1] Creating Checkout..." -ForegroundColor Yellow
Write-Host "Test Email: $testEmail" -ForegroundColor Gray

$checkoutBody = @{
    customer = @{
        email = $testEmail
        name = "System Validation Test"
        phone = "8645281475"
    }
    cart = @(
        @{
            id = "bundle-2"
            name = "Security Pro - 2 Cameras"
            price = 599
            qty = 1
        }
    )
    metadata = @{
        customer_email = $testEmail
        customer_name = "System Validation Test"
        service_address = "456 Test Ave"
        service_city = "Greenville"
        service_state = "SC"
        service_zip = "29601"
    }
} | ConvertTo-Json -Depth 10

try {
    $checkoutResponse = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop" -Method POST -Body $checkoutBody -ContentType "application/json" -ErrorAction Stop
    
    if ($checkoutResponse.ok) {
        Write-Host "[OK] Checkout created successfully" -ForegroundColor Green
        $sessionId = $checkoutResponse.session_id
        Write-Host "  Session ID: $sessionId" -ForegroundColor Gray
    } else {
        Write-Host "[FAIL] Checkout failed: $($checkoutResponse.error)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "[FAIL] Checkout API error: $_" -ForegroundColor Red
    exit 1
}

Start-Sleep -Seconds 3

# STEP 2: VERIFY ORDER CREATION IN h2s_orders
Write-Host "`n[STEP 2] Verifying Order in h2s_orders..." -ForegroundColor Yellow

try {
    $ordersResponse = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/customer_orders" -Method POST -Body (@{customer_email=$testEmail} | ConvertTo-Json) -ContentType "application/json" -ErrorAction Stop
    
    if ($ordersResponse.orders -and $ordersResponse.orders.Count -gt 0) {
        $order = $ordersResponse.orders[0]
        $orderId = $order.order_id
        $jobId = $order.job_id
        
        Write-Host "[OK] Order found in h2s_orders" -ForegroundColor Green
        Write-Host "  Order ID: $orderId" -ForegroundColor Gray
        Write-Host "  Job ID: $jobId" -ForegroundColor Gray
        Write-Host "  Status: $($order.status)" -ForegroundColor Gray
        Write-Host "  Total: $($order.order_total)" -ForegroundColor Gray
        Write-Host "  Service: $($order.service_name)" -ForegroundColor Gray
        
        if ($jobId) {
            Write-Host "[OK] job_id present in order metadata" -ForegroundColor Green
        } else {
            Write-Host "[FAIL] job_id missing from order metadata" -ForegroundColor Red
            Write-Host "  This means dispatch job creation failed" -ForegroundColor Yellow
        }
        
    } else {
        Write-Host "[FAIL] Order not found in h2s_orders" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "[FAIL] Error fetching orders: $_" -ForegroundColor Red
    exit 1
}

# STEP 3: VERIFY JOB IN h2s_dispatch_jobs
Write-Host "`n[STEP 3] Verifying Job in h2s_dispatch_jobs..." -ForegroundColor Yellow

if ($jobId) {
    try {
        $jobResponse = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/admin/jobs?job_id=$jobId" -Method GET -ErrorAction Stop
        
        if ($jobResponse.jobs -and $jobResponse.jobs.Count -gt 0) {
            $job = $jobResponse.jobs[0]
            
            Write-Host "[OK] Job found in h2s_dispatch_jobs" -ForegroundColor Green
            Write-Host "  Job ID: $($job.job_id)" -ForegroundColor Gray
            Write-Host "  Status: $($job.status)" -ForegroundColor Gray
            Write-Host "  Customer: $($job.customer_name)" -ForegroundColor Gray
            Write-Host "  Service Address: $($job.service_address)" -ForegroundColor Gray
            Write-Host "  Created: $($job.created_at)" -ForegroundColor Gray
            
            Write-Host "`n  Payload Validation:" -ForegroundColor Cyan
            if ($job.customer_email -eq $testEmail) {
                Write-Host "  [OK] Email matches" -ForegroundColor Green
            } else {
                Write-Host "  [FAIL] Email mismatch: $($job.customer_email)" -ForegroundColor Red
            }
            
            if ($job.service_address -eq "456 Test Ave") {
                Write-Host "  [OK] Address matches" -ForegroundColor Green
            } else {
                Write-Host "  [FAIL] Address mismatch: $($job.service_address)" -ForegroundColor Red
            }
            
        } else {
            Write-Host "[FAIL] Job not found in h2s_dispatch_jobs" -ForegroundColor Red
        }
    } catch {
        Write-Host "[FAIL] Error fetching job: $_" -ForegroundColor Red
    }
} else {
    Write-Host "[SKIP] No job_id to verify" -ForegroundColor Red
}

# STEP 4: TEST SCHEDULE APPOINTMENT
Write-Host "`n[STEP 4] Testing Schedule Appointment..." -ForegroundColor Yellow

if ($sessionId -and $jobId) {
    $scheduleBody = @{
        session_id = $sessionId
        job_id = $jobId
        appointment_date = (Get-Date).AddDays(7).ToString("yyyy-MM-dd")
        time_window = "9am - 12pm"
    } | ConvertTo-Json
    
    try {
        $scheduleResponse = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/schedule-appointment" -Method POST -Body $scheduleBody -ContentType "application/json" -ErrorAction Stop
        
        if ($scheduleResponse.ok) {
            Write-Host "[OK] Appointment scheduled successfully" -ForegroundColor Green
            Write-Host "  Date: $($scheduleResponse.appointment_date)" -ForegroundColor Gray
            Write-Host "  Window: $($scheduleResponse.time_window)" -ForegroundColor Gray
        } else {
            Write-Host "[FAIL] Schedule failed: $($scheduleResponse.error)" -ForegroundColor Red
        }
    } catch {
        Write-Host "[WARN] Schedule API error (may be expected): $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "[SKIP] Missing session_id or job_id" -ForegroundColor Red
}

# STEP 5: VERIFY PORTAL DISPLAY
Write-Host "`n[STEP 5] Portal Display Check..." -ForegroundColor Yellow

if ($jobId) {
    Write-Host "Portal URL: https://h2s-admin-portal.vercel.app" -ForegroundColor Cyan
    Write-Host "Job ID to search: $jobId" -ForegroundColor Gray
    Write-Host "Expected Details:" -ForegroundColor Gray
    Write-Host "  - Customer: System Validation Test" -ForegroundColor Gray
    Write-Host "  - Email: $testEmail" -ForegroundColor Gray
    Write-Host "  - Address: 456 Test Ave, Greenville, SC 29601" -ForegroundColor Gray
    Write-Host "  - Service: Security Pro - 2 Cameras" -ForegroundColor Gray
    Write-Host "`n[OK] Manual verification required in portal" -ForegroundColor Yellow
}

# SUMMARY
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   VALIDATION SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

Write-Host "`nTest Email: $testEmail" -ForegroundColor White
Write-Host "Session ID: $sessionId" -ForegroundColor White
Write-Host "Order ID: $orderId" -ForegroundColor White
Write-Host "Job ID: $jobId" -ForegroundColor White

Write-Host "`nNext Steps:" -ForegroundColor Yellow
Write-Host "1. Open portal: https://h2s-admin-portal.vercel.app" -ForegroundColor Gray
Write-Host "2. Search for Job ID: $jobId" -ForegroundColor Gray
Write-Host "3. Verify all details display correctly" -ForegroundColor Gray
Write-Host "4. Check status updates work" -ForegroundColor Gray

Write-Host "`n[COMPLETE] Validation finished" -ForegroundColor Green
