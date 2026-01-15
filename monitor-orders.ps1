# Monitor Orders & Jobs in Real-Time
# Run this WHILE you create an order through the website

param(
    [string]$Email = "",
    [int]$RefreshSeconds = 5
)

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "  REAL-TIME ORDER & JOB MONITOR" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

if (!$Email) {
    $Email = Read-Host "`nEnter customer email to monitor"
}

Write-Host "`nMonitoring: $Email" -ForegroundColor Yellow
Write-Host "Refresh: Every $RefreshSeconds seconds" -ForegroundColor Gray
Write-Host "Press Ctrl+C to stop`n" -ForegroundColor Gray

$backendUrl = "https://h2s-backend.vercel.app"
$lastOrderCount = 0
$lastJobFound = $false

while ($true) {
    Clear-Host
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host " MONITORING: $Email" -ForegroundColor Cyan
    Write-Host " Time: $(Get-Date -Format 'HH:mm:ss')" -ForegroundColor Gray
    Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    
    # Check h2s_orders
    Write-Host "`n[1] h2s_orders Table:" -ForegroundColor Yellow
    try {
        $ordersResponse = Invoke-RestMethod -Uri "$backendUrl/api/customer_orders" -Method POST -Body (@{
            customer_email = $Email
        } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 10
        
        if ($ordersResponse.ok) {
            $orders = $ordersResponse.orders
            Write-Host "    Found: $($orders.Count) orders" -ForegroundColor $(if ($orders.Count -gt 0) {"Green"} else {"Yellow"})
            
            if ($orders.Count -gt $lastOrderCount) {
                Write-Host "    *** NEW ORDER CREATED! ***" -ForegroundColor Green
                $lastOrderCount = $orders.Count
            }
            
            foreach ($order in $orders) {
                Write-Host "`n    Order: $($order.order_id)" -ForegroundColor White
                Write-Host "      Status: $($order.status)" -ForegroundColor Gray
                Write-Host "      Created: $($order.created_at)" -ForegroundColor Gray
                Write-Host "      Job ID (metadata): $($order.job_id)" -ForegroundColor $(if ($order.job_id) {"Green"} else {"Red"})
                
                if ($order.job_id -and !$lastJobFound) {
                    Write-Host "      *** JOB ID DETECTED! ***" -ForegroundColor Green
                    $lastJobFound = $true
                }
                
                if (!$order.job_id) {
                    Write-Host "      WARNING: No job_id - dispatch job may have failed!" -ForegroundColor Red
                }
            }
        } else {
            Write-Host "    Error: $($ordersResponse.error)" -ForegroundColor Red
        }
    } catch {
        Write-Host "    Error: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    # Check h2s_dispatch_jobs (if we have admin token)
    Write-Host "`n[2] h2s_dispatch_jobs Table:" -ForegroundColor Yellow
    
    if ($env:H2S_ADMIN_TOKEN) {
        try {
            $jobsResponse = Invoke-RestMethod -Uri "$backendUrl/api/portal_jobs" -Method POST -Body (@{
                token = $env:H2S_ADMIN_TOKEN
            } | ConvertTo-Json) -ContentType "application/json" -TimeoutSec 10
            
            if ($jobsResponse.ok) {
                $allJobs = $jobsResponse.offers + $jobsResponse.upcoming + $jobsResponse.completed
                $ourJobs = $allJobs | Where-Object { $_.customer_email -eq $Email }
                
                Write-Host "    Found: $($ourJobs.Count) jobs for this customer" -ForegroundColor $(if ($ourJobs.Count -gt 0) {"Green"} else {"Yellow"})
                
                foreach ($job in $ourJobs) {
                    Write-Host "`n    Job: $($job.job_id)" -ForegroundColor White
                    Write-Host "      Status: $($job.status)" -ForegroundColor Gray
                    Write-Host "      Order ID: $($job.order_id)" -ForegroundColor Gray
                    Write-Host "      Created: $($job.created_at)" -ForegroundColor Gray
                }
            } else {
                Write-Host "    Error: $($jobsResponse.error)" -ForegroundColor Red
            }
        } catch {
            Write-Host "    Error: $($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host "    Skipped (H2S_ADMIN_TOKEN not set)" -ForegroundColor Gray
        Write-Host "    Set token to monitor jobs table" -ForegroundColor Gray
    }
    
    Write-Host "`n═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host " Refreshing in $RefreshSeconds seconds..." -ForegroundColor Gray
    
    Start-Sleep -Seconds $RefreshSeconds
}
