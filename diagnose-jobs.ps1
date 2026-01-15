# Quick job diagnostic script
param(
    [string]$OrderEmail = "",
    [int]$LastNHours = 24
)

$backendUrl = "https://h2s-backend.vercel.app"

Write-Host "`n🔍 JOB DIAGNOSTIC REPORT" -ForegroundColor Cyan
Write-Host "Last $LastNHours hours`n" -ForegroundColor Gray

# Check recent orders
if ($OrderEmail) {
    Write-Host "Checking orders for: $OrderEmail" -ForegroundColor Yellow
    
    try {
        $ordersResponse = Invoke-RestMethod -Uri "$backendUrl/api/customer_orders" -Method POST -Body (@{
            customer_email = $OrderEmail
        } | ConvertTo-Json) -ContentType "application/json"
        
        if ($ordersResponse.ok) {
            $orders = $ordersResponse.orders
            Write-Host "  Found: $($orders.Count) orders" -ForegroundColor Green
            
            foreach ($order in $orders) {
                Write-Host "`n  Order: $($order.order_id)" -ForegroundColor White
                Write-Host "    Status: $($order.status)" -ForegroundColor $(if ($order.status -eq "completed") {"Green"} else {"Yellow"})
                Write-Host "    Job ID: $($order.job_id)" -ForegroundColor Gray
                Write-Host "    Created: $($order.created_at)" -ForegroundColor Gray
                Write-Host "    Job Details: $($order.service_summary)" -ForegroundColor Gray
                
                if ($order.scheduled_date) {
                    Write-Host "    Scheduled: $($order.scheduled_date) $($order.time_window)" -ForegroundColor Cyan
                }
            }
        } else {
            Write-Host "  ❌ Error: $($ordersResponse.error)" -ForegroundColor Red
        }
    } catch {
        Write-Host "  ❌ API Error: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "ℹ️  Use -OrderEmail parameter to check specific customer orders" -ForegroundColor Gray
}

Write-Host "`n✅ Diagnostic complete`n" -ForegroundColor Green
