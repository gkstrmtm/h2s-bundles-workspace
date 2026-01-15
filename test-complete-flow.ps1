# Complete test: Create order and schedule appointment (bypasses Stripe)
Write-Host "`n=== FRONT DOOR ONLY - COMPLETE TEST ===" -ForegroundColor Cyan

$baseUrl = "https://h2s-backend.vercel.app"
$testEmail = "test$(Get-Random)@example.com"

Write-Host "`n[STEP 1] Creating test order..." -ForegroundColor Yellow
Write-Host "Email: $testEmail" -ForegroundColor Gray

$orderPayload = @{
    customer = @{
        email = $testEmail
        name = "Tabari Roper"
        phone = "8643041234"
    }
    cart = @(@{
        id = "front-door-only"
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

try {
    $orderResp = Invoke-RestMethod -Uri "$baseUrl/api/test-create-order" -Method POST -Body $orderPayload -ContentType "application/json"
    
    if ($orderResp.ok) {
        $orderId = $orderResp.order_id
        Write-Host "SUCCESS - Order created: $orderId" -ForegroundColor Green
        Write-Host "  Total: $($orderResp.total)" -ForegroundColor Gray
        
        # Step 2: Schedule appointment
        Write-Host "`n[STEP 2] Scheduling for Jan 12, 3:30 PM..." -ForegroundColor Yellow
        
        $schedulePayload = @{
            order_id = $orderId
            delivery_date = "2026-01-12"
            delivery_time = "3:30 PM"
        } | ConvertTo-Json
        
        try {
            $scheduleResp = Invoke-RestMethod -Uri "$baseUrl/api/schedule-appointment" -Method POST -Body $schedulePayload -ContentType "application/json"
            
            if ($scheduleResp.ok) {
                Write-Host "SUCCESS - Appointment scheduled!" -ForegroundColor Green
                Write-Host "  Job ID: $($scheduleResp.job_id)" -ForegroundColor Cyan
                
                Write-Host "`n========================================" -ForegroundColor Green
                Write-Host "  TEST COMPLETE - CHECK ADMIN PORTAL" -ForegroundColor Green
                Write-Host "========================================" -ForegroundColor Green
                
                Write-Host "`nExpected display in portal:" -ForegroundColor Yellow
                Write-Host "  Service: Front Door Only" -ForegroundColor White
                Write-Host "  Payout: 15.75 (35% of 45.00)" -ForegroundColor White
                Write-Host "  Date: Mon, Jan 12 - 3:30 PM" -ForegroundColor White
                Write-Host "  Address: 117 king cir, greenwood SC 29649" -ForegroundColor White
                Write-Host "  Customer: Tabari Roper" -ForegroundColor White
                Write-Host "  Job Details: Front Door Only service" -ForegroundColor White
                Write-Host "  Equipment: No (We provide)" -ForegroundColor White
                
                Write-Host "`nOrder ID: $orderId" -ForegroundColor Cyan
                Write-Host "Job ID: $($scheduleResp.job_id)" -ForegroundColor Cyan
            } else {
                Write-Host "FAILED - $($scheduleResp.error)" -ForegroundColor Red
            }
        } catch {
            Write-Host "FAILED - Schedule error" -ForegroundColor Red
            Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
            if ($_.ErrorDetails.Message) {
                Write-Host "  Details: $($_.ErrorDetails.Message)" -ForegroundColor Gray
            }
        }
    } else {
        Write-Host "FAILED - $($orderResp.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "FAILED - Order creation error" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "  Details: $($_.ErrorDetails.Message)" -ForegroundColor Gray
    }
}
