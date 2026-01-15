# Test Order → Dispatch Job Creation Flow
# This simulates the checkout process to identify where jobs are getting lost

param(
    [string]$TestEmail = "test-job-flow-$(Get-Random)@example.com"
)

$ErrorActionPreference = "Continue"
$backendUrl = "https://h2s-backend.vercel.app"

Write-Host "`n╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║  ORDER → JOB FLOW DIAGNOSTIC                                   ║" -ForegroundColor Magenta
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Magenta

Write-Host "`nTest Email: $TestEmail`n" -ForegroundColor Cyan

# Step 1: Create a test order via shop endpoint
Write-Host "[1/4] Creating test checkout session..." -ForegroundColor Yellow

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
        customer_name = "Test Customer"
        customer_phone = "5551234567"
        service_address = "123 Test St"
        service_city = "Los Angeles"
        service_state = "CA"
        service_zip = "90210"
        geo_lat = 34.0522
        geo_lng = -118.2437
    }
} | ConvertTo-Json -Depth 10

try {
    $checkoutResponse = Invoke-RestMethod -Uri "$backendUrl/api/shop" -Method POST -Body $checkoutPayload -ContentType "application/json" -TimeoutSec 30
    
    if ($checkoutResponse.ok) {
        Write-Host "  ✅ Checkout session created" -ForegroundColor Green
        Write-Host "     Session URL: $($checkoutResponse.pay.session_url)" -ForegroundColor Gray
    } else {
        Write-Host "  ❌ Checkout failed: $($checkoutResponse.error)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "  ❌ Checkout error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Start-Sleep -Seconds 2

# Step 2: Check if order was created in h2s_orders
Write-Host "`n[2/4] Checking h2s_orders table..." -ForegroundColor Yellow

try {
    $ordersResponse = Invoke-RestMethod -Uri "$backendUrl/api/customer_orders" -Method POST -Body (@{
        customer_email = $TestEmail
    } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 30
    
    if ($ordersResponse.ok -and $ordersResponse.orders.Count -gt 0) {
        $order = $ordersResponse.orders[0]
        Write-Host "  ✅ Order found in h2s_orders" -ForegroundColor Green
        Write-Host "     Order ID: $($order.order_id)" -ForegroundColor Gray
        Write-Host "     Status: $($order.status)" -ForegroundColor Gray
        Write-Host "     Job ID (from metadata): $($order.job_id)" -ForegroundColor Gray
        
        $orderId = $order.order_id
        $jobIdFromMeta = $order.job_id
    } else {
        Write-Host "  ❌ Order NOT found in h2s_orders" -ForegroundColor Red
        Write-Host "     This means the order insert failed completely" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "  ❌ Error checking orders: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 3: Check if job was created in h2s_dispatch_jobs (via portal_jobs endpoint)
Write-Host "`n[3/4] Checking h2s_dispatch_jobs table..." -ForegroundColor Yellow

# We need an admin token to query portal jobs
if (!$env:H2S_ADMIN_TOKEN) {
    Write-Host "  ⚠️  H2S_ADMIN_TOKEN not set - creating test account..." -ForegroundColor Yellow
    
    try {
        $signupResponse = Invoke-RestMethod -Uri "$backendUrl/api/portal_signup_step1" -Method POST -Body (@{
            email = "diagnostic-$(Get-Random)@test.com"
            name = "Diagnostic Test"
            phone = "5559999999"
            address = "123 Test St"
            zip = "90210"
        } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 30
        
        if ($signupResponse.ok) {
            $adminToken = $signupResponse.token
            Write-Host "  ✅ Got test admin token" -ForegroundColor Green
        } else {
            Write-Host "  ❌ Could not get admin token - skipping job check" -ForegroundColor Red
            $adminToken = $null
        }
    } catch {
        Write-Host "  ❌ Signup error: $($_.Exception.Message)" -ForegroundColor Red
        $adminToken = $null
    }
} else {
    $adminToken = $env:H2S_ADMIN_TOKEN
    Write-Host "  ℹ️  Using existing H2S_ADMIN_TOKEN" -ForegroundColor Gray
}

if ($adminToken) {
    try {
        $jobsResponse = Invoke-RestMethod -Uri "$backendUrl/api/portal_jobs" -Method POST -Body (@{
            token = $adminToken
        } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 30
        
        if ($jobsResponse.ok) {
            $allJobs = $jobsResponse.offers + $jobsResponse.upcoming + $jobsResponse.completed
            
            # Look for our job by order_id or customer email
            $ourJob = $allJobs | Where-Object { 
                $_.order_id -eq $orderId -or 
                $_.customer_email -eq $TestEmail -or
                $_.job_id -eq $jobIdFromMeta
            } | Select-Object -First 1
            
            if ($ourJob) {
                Write-Host "  ✅ Job FOUND in h2s_dispatch_jobs" -ForegroundColor Green
                Write-Host "     Job ID: $($ourJob.job_id)" -ForegroundColor Gray
                Write-Host "     Status: $($ourJob.status)" -ForegroundColor Gray
                Write-Host "     Order ID: $($ourJob.order_id)" -ForegroundColor Gray
                Write-Host "     Job Details: $($ourJob.job_details)" -ForegroundColor Gray
                Write-Host "     Customer: $($ourJob.customer_name)" -ForegroundColor Gray
            } else {
                Write-Host "  ❌ Job NOT FOUND in h2s_dispatch_jobs" -ForegroundColor Red
                Write-Host "     This is the problem! Order exists but job was never created." -ForegroundColor Yellow
                Write-Host "     Total jobs in system: $($allJobs.Count)" -ForegroundColor Gray
                
                Write-Host "`n     Possible causes:" -ForegroundColor Yellow
                Write-Host "       1. Dispatch job insert is failing silently" -ForegroundColor Yellow
                Write-Host "       2. Database permissions issue" -ForegroundColor Yellow
                Write-Host "       3. Schema mismatch (missing required fields)" -ForegroundColor Yellow
                Write-Host "       4. Recipient creation failing" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  ❌ Portal jobs query failed: $($jobsResponse.error)" -ForegroundColor Red
        }
    } catch {
        Write-Host "  ❌ Error checking jobs: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "  ⏭️  Skipping job check (no admin token)" -ForegroundColor Yellow
}

# Step 4: Summary
Write-Host "`n[4/4] DIAGNOSTIC SUMMARY" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════════════" -ForegroundColor Cyan

if ($order -and !$ourJob) {
    Write-Host "`n❌ CRITICAL ISSUE IDENTIFIED:" -ForegroundColor Red
    Write-Host "   Orders are being created in h2s_orders" -ForegroundColor Yellow
    Write-Host "   BUT jobs are NOT being created in h2s_dispatch_jobs" -ForegroundColor Yellow
    Write-Host "`n   This breaks the entire dispatch workflow!" -ForegroundColor Red
    Write-Host "`n   Action required:" -ForegroundColor Cyan
    Write-Host "     1. Check backend logs for dispatch job errors" -ForegroundColor White
    Write-Host "     2. Verify h2s_dispatch_jobs table permissions" -ForegroundColor White
    Write-Host "     3. Check recipient creation logic" -ForegroundColor White
    Write-Host "     4. Add error logging to shop/route.ts" -ForegroundColor White
} elseif ($order -and $ourJob) {
    Write-Host "`n✅ DATA FLOW IS WORKING:" -ForegroundColor Green
    Write-Host "   Order created, Job created, Portal visible" -ForegroundColor Green
} else {
    Write-Host "`n⚠️  INCOMPLETE DIAGNOSTIC:" -ForegroundColor Yellow
    Write-Host "   Could not verify full flow (missing admin token)" -ForegroundColor Yellow
}

Write-Host ""
