# Test: Create Front Door Only order matching screenshot
Write-Host "`n=== Testing Front Door Only Order ===" -ForegroundColor Cyan

$baseUrl = "https://h2s-backend.vercel.app"
$testEmail = "tabari.test$(Get-Random)@home2smart.com"

# Step 1: Create checkout
Write-Host "[1/3] Creating checkout session..." -ForegroundColor Yellow
$checkout = @{
    __action = "create_checkout_session"
    customer = @{
        email = $testEmail
        name = "Tabari Roper"
        phone = "8643041234"
    }
    cart = @(@{
        id = "front-door"
        name = "Front Door Only"
        price = 45
        qty = 1
    })
    metadata = @{
        customer_email = $testEmail
        customer_name = "Tabari Roper"
        customer_phone = "8643041234"
        service_address = "117 king cir"
        service_city = "greenwood"
        service_state = "SC"
        service_zip = "29649"
        job_details = @{
            services = @(@{
                name = "Front Door Only"
                price = 45
                qty = 1
            })
            equipment_provided = "provider"
            notes = "None specified"
        }
    }
} | ConvertTo-Json -Depth 10

$session = Invoke-RestMethod -Uri "$baseUrl/api/shop" -Method POST -Body $checkout -ContentType "application/json"
$sessionId = $session.session_id
Write-Host "OK - Session: $sessionId" -ForegroundColor Green

# Step 2: Check for order (Note: requires Stripe webhook in production)
Write-Host "`n[2/3] Checking for order..." -ForegroundColor Yellow
Start-Sleep 2

$orders = Invoke-RestMethod -Uri "$baseUrl/api/customer_orders" -Method POST -Body (@{customer_email=$testEmail} | ConvertTo-Json) -ContentType "application/json"

if ($orders.orders -and $orders.orders.Count -gt 0) {
    $order = $orders.orders[0]
    $orderId = $order.order_id
    Write-Host "OK - Order: $orderId (Total: $($order.order_total))" -ForegroundColor Green
    
    # Step 3: Schedule appointment
    Write-Host "`n[3/3] Scheduling for Jan 12 at 3:30 PM..." -ForegroundColor Yellow
    $schedule = @{
        order_key = $orderId
        delivery_date = "2026-01-12"
        delivery_time = "3:30 PM"
    } | ConvertTo-Json
    
    $result = Invoke-RestMethod -Uri "$baseUrl/api/schedule-appointment" -Method POST -Body $schedule -ContentType "application/json"
    
    if ($result.ok) {
        Write-Host "OK - Scheduled!" -ForegroundColor Green
        Write-Host "  Job ID: $($result.job_id)" -ForegroundColor Gray
        Write-Host "`nEXPECTED IN PORTAL:" -ForegroundColor Cyan
        Write-Host "  Service: Front Door Only" -ForegroundColor White
        Write-Host "  Payout: 15.75 (35% of 45)" -ForegroundColor White
        Write-Host "  Date: Mon, Jan 12 - 3:30 PM" -ForegroundColor White
        Write-Host "  Address: 117 king cir, greenwood SC 29649" -ForegroundColor White
    } else {
        Write-Host "FAILED - $($result.error)" -ForegroundColor Red
    }
} else {
    Write-Host "No order found - Stripe webhook has not fired yet" -ForegroundColor Yellow
    Write-Host "Session URL: $($session.url)" -ForegroundColor Gray
}
