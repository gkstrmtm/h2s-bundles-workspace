# Test scheduling for the existing order
$orderId = "ORD-MKA8AYJB8F5D1EB2"

Write-Host "`n=== DIAGNOSTIC: Order $orderId ===" -ForegroundColor Cyan

# Step 1: Check if order exists by querying all orders
Write-Host "`n[1] Checking if order exists..." -ForegroundColor Yellow
$allOrdersBody = @{
    customer_email = "test2008312906@example.com"
} | ConvertTo-Json

try {
    $ordersResp = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/customer_orders" -Method POST -Body $allOrdersBody -ContentType "application/json"
    
    if ($ordersResp.orders -and $ordersResp.orders.Count -gt 0) {
        $order = $ordersResp.orders | Where-Object { $_.order_id -eq $orderId } | Select-Object -First 1
        
        if ($order) {
            Write-Host "OK - Order found!" -ForegroundColor Green
            Write-Host "  Order ID: $($order.order_id)" -ForegroundColor White
            Write-Host "  Status: $($order.status)" -ForegroundColor Gray
            Write-Host "  Total: $($order.order_total)" -ForegroundColor Gray
            Write-Host "  Customer: $($order.customer_name)" -ForegroundColor Gray
            Write-Host "  Has metadata: $($null -ne $order.metadata_json)" -ForegroundColor Gray
            
            # Step 2: Try scheduling
            Write-Host "`n[2] Attempting to schedule..." -ForegroundColor Yellow
            $scheduleBody = @{
                order_key = $orderId
                delivery_date = "2026-01-12"
                delivery_time = "3:30 PM"
            } | ConvertTo-Json
            
            Write-Host "Payload:" -ForegroundColor Gray
            Write-Host $scheduleBody -ForegroundColor DarkGray
            
            try {
                $scheduleResp = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/schedule-appointment" -Method POST -Body $scheduleBody -ContentType "application/json"
                
                if ($scheduleResp.ok) {
                    Write-Host "`nSUCCESS!" -ForegroundColor Green
                    Write-Host "  Job ID: $($scheduleResp.job_id)" -ForegroundColor Cyan
                    Write-Host "`nExpected in admin portal:" -ForegroundColor Yellow
                    Write-Host "  - Service: Front Door Only" -ForegroundColor White
                    Write-Host "  - Payout: 15.75 (35% of 45)" -ForegroundColor White
                    Write-Host "  - Date: Mon, Jan 12 - 3:30 PM" -ForegroundColor White
                    Write-Host "  - Address: 117 king cir, greenwood SC 29649" -ForegroundColor White
                } else {
                    Write-Host "`nFAILED: $($scheduleResp.error)" -ForegroundColor Red
                }
            } catch {
                Write-Host "`nSCHEDULE ERROR:" -ForegroundColor Red
                Write-Host "  Message: $($_.Exception.Message)" -ForegroundColor Red
                
                # Try to get more details
                if ($_.ErrorDetails.Message) {
                    Write-Host "  Details: $($_.ErrorDetails.Message)" -ForegroundColor Gray
                }
                
                # The 400 error suggests the order might not be in the right state
                Write-Host "`nPOSSIBLE CAUSES:" -ForegroundColor Yellow
                Write-Host "  1. Order status is not 'pending' or 'confirmed'" -ForegroundColor Gray
                Write-Host "  2. Order is missing required metadata" -ForegroundColor Gray
                Write-Host "  3. Order was created via checkout session but payment not completed" -ForegroundColor Gray
                Write-Host "`nSOLUTION: Complete Stripe payment or create order via different method" -ForegroundColor Cyan
            }
        } else {
            Write-Host "ERROR - Order ID not found in customer orders" -ForegroundColor Red
        }
    } else {
        Write-Host "ERROR - No orders found for customer" -ForegroundColor Red
    }
} catch {
    Write-Host "ERROR checking orders: $($_.Exception.Message)" -ForegroundColor Red
}
