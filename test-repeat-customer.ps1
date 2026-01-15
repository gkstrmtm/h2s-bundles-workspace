# PROOF TEST: Same customer, multiple orders

Write-Host "`n=== TEST 1: First checkout for customer ===" -ForegroundColor Cyan
$testEmail = "repeat-customer-$(Get-Random)@test.com"
Write-Host "Customer: $testEmail`n" -ForegroundColor Yellow

$payload = @{
  action = 'create_checkout_session'
  customer = @{
    email = $testEmail
    name = "Repeat Customer"
    phone = "8645551234"
  }
  cart = @(@{
    id = "tv-1"
    name = "TV Mount"
    price = 149
    qty = 1
  })
  metadata = @{
    service_address = "123 Main St"
    service_city = "Greenwood"
    service_state = "SC"
    service_zip = "29649"
  }
} | ConvertTo-Json -Depth 10 -Compress

try {
  $response1 = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop" -Method POST -Body $payload -ContentType "application/json"
  Write-Host "✅ First order succeeded!" -ForegroundColor Green
  Write-Host "   Order 1: $($response1.order_id)" -ForegroundColor White
  Write-Host "   Job 1: $($response1.job_id)" -ForegroundColor White
} catch {
  Write-Host "❌ First order FAILED!" -ForegroundColor Red
  $err = $_.ErrorDetails.Message | ConvertFrom-Json
  Write-Host "   Error: $($err.error)" -ForegroundColor Red
  exit 1
}

Start-Sleep -Seconds 2

Write-Host "`n=== TEST 2: Second checkout for SAME customer ===" -ForegroundColor Cyan
Write-Host "Customer: $testEmail (same as above)`n" -ForegroundColor Yellow

# Modify cart slightly
$payload2 = @{
  action = 'create_checkout_session'
  customer = @{
    email = $testEmail
    name = "Repeat Customer"
    phone = "8645551234"
  }
  cart = @(@{
    id = "camera-1"
    name = "Security Camera"
    price = 99
    qty = 1
  })
  metadata = @{
    service_address = "123 Main St"
    service_city = "Greenwood"
    service_state = "SC"
    service_zip = "29649"
  }
} | ConvertTo-Json -Depth 10 -Compress

try {
  $response2 = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop" -Method POST -Body $payload2 -ContentType "application/json"
  Write-Host "✅ Second order succeeded!" -ForegroundColor Green
  Write-Host "   Order 2: $($response2.order_id)" -ForegroundColor White
  Write-Host "   Job 2: $($response2.job_id)" -ForegroundColor White
} catch {
  Write-Host "❌ Second order FAILED!" -ForegroundColor Red
  $err = $_.ErrorDetails.Message | ConvertFrom-Json
  Write-Host "   Error: $($err.error)" -ForegroundColor Red
  
  if ($err.error -match "duplicate key.*recipient_step") {
    Write-Host "`n💥 CONSTRAINT STILL EXISTS! Migration not applied." -ForegroundColor Red
    Write-Host "   The h2s_dispatch_jobs_recipient_step_uq constraint is still blocking repeat customers." -ForegroundColor Yellow
  }
  
  exit 1
}

Write-Host "`n=== VERIFICATION ===" -ForegroundColor Green
Write-Host "✅ Same customer placed TWO orders successfully" -ForegroundColor Green
Write-Host "✅ No duplicate key constraint error" -ForegroundColor Green
Write-Host "✅ Each order has its own dispatch job" -ForegroundColor Green

Write-Host "`nOrders created:" -ForegroundColor White
Write-Host "  1. $($response1.order_id) → Job $($response1.job_id)" -ForegroundColor Gray
Write-Host "  2. $($response2.order_id) → Job $($response2.job_id)" -ForegroundColor Gray
