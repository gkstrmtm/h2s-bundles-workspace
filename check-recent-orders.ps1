# Quick check for recent orders and jobs
$backendUrl = "https://h2s-backend.vercel.app"

Write-Host "`nChecking recent orders..." -ForegroundColor Cyan

try {
    # Get recent orders (no email filter)
    $orders = Invoke-RestMethod -Uri "$backendUrl/api/customer_orders" -Method GET -TimeoutSec 15
    
    if ($orders -and $orders.Count -gt 0) {
        $recentOrders = $orders | Sort-Object -Property created_at -Descending | Select-Object -First 5
        
        Write-Host "Found $($orders.Count) total orders. Most recent 5:" -ForegroundColor Green
        
        foreach ($order in $recentOrders) {
            Write-Host "`n  Order ID: $($order.id)" -ForegroundColor White
            Write-Host "  Email: $($order.customer_email)" -ForegroundColor Gray
            Write-Host "  Created: $($order.created_at)" -ForegroundColor Gray
            Write-Host "  Status: $($order.status)" -ForegroundColor Gray
            Write-Host "  Total: `$$($order.final_total)" -ForegroundColor Gray
            
            # Check if this order has a job
            try {
                $jobCheck = Invoke-RestMethod -Uri "$backendUrl/api/portal_jobs?recipientEmail=$([System.Uri]::EscapeDataString($order.customer_email))" -Method GET -TimeoutSec 15 -ErrorAction SilentlyContinue
                
                $matchingJob = $jobCheck | Where-Object { $_.order_id -eq $order.id }
                
                if ($matchingJob) {
                    Write-Host "  Job: FOUND (ID: $($matchingJob.id))" -ForegroundColor Green
                } else {
                    Write-Host "  Job: MISSING" -ForegroundColor Red
                }
            } catch {
                Write-Host "  Job: Could not check" -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "No orders found" -ForegroundColor Yellow
    }
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
