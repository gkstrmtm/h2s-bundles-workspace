# PROBE DATABASE FOR ORPHANED ORDERS AND LINKAGE ISSUES
# This checks existing data for inconsistencies

$ErrorActionPreference = "Stop"
$backendUrl = "https://h2s-backend.vercel.app"

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "  DATABASE CONGRUENCE PROBE" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

# Get all orders for h2sbackend@gmail.com (test account)
Write-Host "[1/3] Fetching orders from h2s_orders..." -ForegroundColor Yellow

try {
    $ordersResp = Invoke-RestMethod -Uri "$backendUrl/api/customer_orders" -Method POST -Body (@{
        customer_email = "h2sbackend@gmail.com"
    } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 10
    
    if (!$ordersResp.ok) {
        Write-Host "      Failed: $($ordersResp.error)" -ForegroundColor Red
        exit 1
    }
    
    $orders = $ordersResp.orders
    Write-Host "      Found: $($orders.Count) orders" -ForegroundColor Green
    
} catch {
    Write-Host "      Failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Get all jobs from dispatch
Write-Host "`n[2/3] Fetching jobs from h2s_dispatch_jobs..." -ForegroundColor Yellow

if (!$env:H2S_ADMIN_TOKEN) {
    Write-Host "      Skipped: H2S_ADMIN_TOKEN not set" -ForegroundColor Yellow
    Write-Host "      Cannot check job linkage without admin token" -ForegroundColor Gray
    $jobs = @()
} else {
    try {
        $jobsResp = Invoke-RestMethod -Uri "$backendUrl/api/portal_jobs" -Method POST -Body (@{
            token = $env:H2S_ADMIN_TOKEN
        } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 10
        
        if (!$jobsResp.ok) {
            Write-Host "      Failed: $($jobsResp.error)" -ForegroundColor Red
            $jobs = @()
        } else {
            $jobs = $jobsResp.offers + $jobsResp.upcoming + $jobsResp.completed
            Write-Host "      Found: $($jobs.Count) jobs" -ForegroundColor Green
        }
    } catch {
        Write-Host "      Failed: $($_.Exception.Message)" -ForegroundColor Red
        $jobs = @()
    }
}

# Analyze linkage
Write-Host "`n[3/3] Analyzing order -> job linkage..." -ForegroundColor Yellow

$orphanedOrders = @()
$linkedOrders = @()
$ordersWithMetadata = @()
$ordersWithoutMetadata = @()

foreach ($order in $orders) {
    $orderId = $order.order_id
    $jobIdField = $order.job_id
    $metaJobId = $order.metadata_json.dispatch_job_id
    
    # Check if order has job_id in metadata
    if ($metaJobId) {
        $ordersWithMetadata += $order
        
        # Check if corresponding job exists
        $jobExists = $jobs | Where-Object { $_.job_id -eq $metaJobId } | Select-Object -First 1
        
        if ($jobExists) {
            $linkedOrders += $order
        } else {
            $orphanedOrders += $order
        }
    } else {
        $ordersWithoutMetadata += $order
        $orphanedOrders += $order
    }
}

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "  CONGRUENCE REPORT" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

Write-Host "Total Orders: $($orders.Count)" -ForegroundColor White
Write-Host "Total Jobs: $($jobs.Count)" -ForegroundColor White

Write-Host "`nOrders WITH job_id in metadata: $($ordersWithMetadata.Count)" -ForegroundColor $(if ($ordersWithMetadata.Count -gt 0) {"Green"} else {"Yellow"})
Write-Host "Orders WITHOUT job_id in metadata: $($ordersWithoutMetadata.Count)" -ForegroundColor $(if ($ordersWithoutMetadata.Count -eq 0) {"Green"} else {"Red"})

Write-Host "`nProperly Linked Orders: $($linkedOrders.Count)" -ForegroundColor $(if ($linkedOrders.Count -eq $orders.Count) {"Green"} else {"Yellow"})
Write-Host "Orphaned Orders (no job): $($orphanedOrders.Count)" -ForegroundColor $(if ($orphanedOrders.Count -eq 0) {"Green"} else {"Red"})

if ($orphanedOrders.Count -gt 0) {
    Write-Host "`nORPHANED ORDERS (No dispatch job created):" -ForegroundColor Red
    foreach ($order in $orphanedOrders) {
        Write-Host "  - $($order.order_id) | $($order.customer_email) | $($order.created_at)" -ForegroundColor Red
        if ($order.metadata_json.dispatch_job_id) {
            Write-Host "    Meta job_id: $($order.metadata_json.dispatch_job_id) (JOB MISSING FROM DATABASE)" -ForegroundColor Yellow
        } else {
            Write-Host "    No job_id in metadata (JOB CREATION FAILED)" -ForegroundColor Yellow
        }
    }
}

# Check for jobs without orders (shouldn't happen but let's verify)
if ($jobs.Count -gt 0) {
    $jobsWithoutOrders = @()
    foreach ($job in $jobs) {
        $orderExists = $orders | Where-Object { $_.order_id -eq $job.order_id } | Select-Object -First 1
        if (!$orderExists) {
            $jobsWithoutOrders += $job
        }
    }
    
    if ($jobsWithoutOrders.Count -gt 0) {
        Write-Host "`nJOBS WITHOUT ORDERS (data inconsistency):" -ForegroundColor Yellow
        foreach ($job in $jobsWithoutOrders) {
            Write-Host "  - $($job.job_id) | order_id: $($job.order_id)" -ForegroundColor Yellow
        }
    }
}

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "DIAGNOSIS:" -ForegroundColor Yellow

if ($orphanedOrders.Count -eq 0 -and $orders.Count -gt 0) {
    Write-Host "  Data is CONGRUENT - All orders have linked jobs" -ForegroundColor Green
} elseif ($orphanedOrders.Count -eq $orders.Count) {
    Write-Host "  CRITICAL: NO orders are creating jobs!" -ForegroundColor Red
    Write-Host "  The job creation code is failing for ALL orders" -ForegroundColor Red
} elseif ($orphanedOrders.Count -gt 0) {
    Write-Host "  PARTIAL FAILURE: Some orders not creating jobs" -ForegroundColor Yellow
    Write-Host "  Job creation is inconsistent" -ForegroundColor Yellow
} else {
    Write-Host "  No orders found to analyze" -ForegroundColor Gray
}

Write-Host "`n================================================================`n" -ForegroundColor Cyan
