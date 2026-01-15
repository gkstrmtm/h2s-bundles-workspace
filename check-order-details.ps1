# Check specific order details to understand the job creation issue

param(
    [string]$OrderId = "ORD-07670F21"
)

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host " ORDER DETAILS DIAGNOSTIC" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan

$backendUrl = "https://h2s-backend.vercel.app"

Write-Host "`nChecking order: $OrderId" -ForegroundColor Yellow

# Get order from h2s_orders
try {
    $response = Invoke-RestMethod -Uri "$backendUrl/api/customer_orders" -Method POST -Body (@{
        customer_email = "h2sbackend@gmail.com"
    } | ConvertTo-Json) -ContentType "application/json"
    
    if ($response.ok) {
        $order = $response.orders | Where-Object { $_.order_id -eq $OrderId } | Select-Object -First 1
        
        if ($order) {
            Write-Host "`n[ORDER FOUND]" -ForegroundColor Green
            Write-Host "  Order ID: $($order.order_id)" -ForegroundColor White
            Write-Host "  Customer: $($order.customer_email)" -ForegroundColor Gray
            Write-Host "  Created: $($order.created_at)" -ForegroundColor Gray
            Write-Host "  Status: $($order.status)" -ForegroundColor Gray
            Write-Host "`n  Metadata:" -ForegroundColor Yellow
            
            if ($order.metadata_json) {
                $order.metadata_json | ConvertTo-Json -Depth 5 | Write-Host -ForegroundColor Gray
            } else {
                Write-Host "    (none)" -ForegroundColor Gray
            }
            
            Write-Host "`n  Job ID in metadata: " -NoNewline
            if ($order.job_id) {
                Write-Host $order.job_id -ForegroundColor Green
            } else {
                Write-Host "MISSING" -ForegroundColor Red
                Write-Host "`n  This means the dispatch job creation failed!" -ForegroundColor Red
            }
            
            if ($order.metadata_json.dispatch_job_id) {
                Write-Host "  Dispatch Job ID: $($order.metadata_json.dispatch_job_id)" -ForegroundColor Green
            } else {
                Write-Host "  Dispatch Job ID: MISSING" -ForegroundColor Red
            }
            
        } else {
            Write-Host "`n[ORDER NOT FOUND]" -ForegroundColor Red
        }
    } else {
        Write-Host "Error: $($response.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "`nDIAGNOSIS:" -ForegroundColor Yellow
Write-Host "If job_id is MISSING from metadata, the job creation code path" -ForegroundColor Gray
Write-Host "either didn't execute OR failed silently." -ForegroundColor Gray
Write-Host "`nNext step: Check Vercel logs for [Checkout] messages" -ForegroundColor Yellow
Write-Host "Run: .\check-logs.ps1" -ForegroundColor Cyan
Write-Host "`n================================================================`n" -ForegroundColor Cyan
