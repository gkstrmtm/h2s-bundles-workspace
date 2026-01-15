# Create order directly bypassing Stripe (for testing)
Write-Host "`n=== CREATING TEST ORDER (Direct Insert) ===" -ForegroundColor Cyan

$testEmail = "test$(Get-Random)@example.com"
$orderId = "ORD-TEST$(Get-Random -Minimum 10000 -Maximum 99999)"

Write-Host "Creating order: $orderId" -ForegroundColor Yellow
Write-Host "Email: $testEmail" -ForegroundColor Gray

# This would need a direct database insert script or a special test endpoint
# For now, let's use the existing checkout flow and just wait for webhook

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
        }
    }
} | ConvertTo-Json -Depth 10

$session = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop" -Method POST -Body $checkout -ContentType "application/json"

Write-Host "`nCheckout session created: $($session.session_id)" -ForegroundColor Green
Write-Host "`nTO COMPLETE THIS TEST:" -ForegroundColor Yellow
Write-Host "1. Go to: $($session.url)" -ForegroundColor White
Write-Host "2. Use test card: 4242 4242 4242 4242" -ForegroundColor White
Write-Host "3. Complete payment" -ForegroundColor White
Write-Host "4. Run: .\diagnose-jobs.ps1 -OrderEmail $testEmail" -ForegroundColor White
Write-Host "5. Then schedule with order_id from step 4" -ForegroundColor White

Write-Host "`nOR use Stripe CLI to trigger webhook:" -ForegroundColor Cyan
Write-Host "stripe trigger checkout.session.completed" -ForegroundColor Gray
