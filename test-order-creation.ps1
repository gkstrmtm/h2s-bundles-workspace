# Quick order creation test - Run this to trigger the enhanced logging
Write-Host "`nCREATING TEST ORDER..." -ForegroundColor Cyan
Write-Host "This will trigger the enhanced logging we just deployed`n" -ForegroundColor Yellow

$testEmail = "test-$(Get-Random)@h2stest.com"
Write-Host "Test Email: $testEmail" -ForegroundColor Gray

$payload = @{
    __action = "create_checkout_session"
    customer = @{
        email = $testEmail
        name = "Test User"
        phone = "5551234567"
    }
    cart = @(
        @{
            id = "tv-mount-1"
            name = "TV Mount Installation"
            price = 19900
            qty = 1
            metadata = @{
                tv_size = "55-inch"
                mount_type = "Full-Motion"
            }
        }
    )
    metadata = @{
        customer_email = $testEmail
        customer_name = "Test User"
        customer_phone = "5551234567"
        service_address = "123 Test St"
        service_city = "Los Angeles"
        service_state = "CA"
        service_zip = "90001"
    }
    success_url = "https://home2smart.com/success"
    cancel_url = "https://home2smart.com/cancel"
} | ConvertTo-Json -Depth 10

try {
    Write-Host "Sending to: https://h2s-backend.vercel.app/api/shop" -ForegroundColor Gray
    $response = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop" -Method POST -Body $payload -ContentType "application/json" -TimeoutSec 15
    
    if ($response.ok) {
        Write-Host "`nSUCCESS!" -ForegroundColor Green
        Write-Host "Session created: $($response.pay.session_id)" -ForegroundColor Green
        Write-Host "`nNow check logs with:`n  vercel logs h2s-backend.vercel.app --since 5m" -ForegroundColor Yellow
        Write-Host "`nLook for [Checkout] messages to see where job creation fails" -ForegroundColor Cyan
    } else {
        Write-Host "`nFAILED!" -ForegroundColor Red
        Write-Host "Error: $($response.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "`nERROR!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}

Write-Host ""
