$ErrorActionPreference = 'Continue'

Write-Host "============================================"
Write-Host "REPEAT CUSTOMER VALIDATION TEST"
Write-Host "============================================"
Write-Host ""

$email = "repeat-test-$(Get-Date -Format 'HHmmss')@test.com"
$phone = "555-01$(Get-Date -Format 'mmss')"

Write-Host "Test Customer: $email / $phone"
Write-Host ""

# Correct payload structure
$payload1 = @{
    __action = "create_checkout_session"
    customer = @{
        email = $email
        firstName = "Test"
        lastName = "Repeat"
        phone = $phone
    }
    cart = @(
        @{
            bundle_id = "bnd-welcome-to-h2s"
            quantity = 1
        }
    )
    promotion_code = ""
    success_url = "https://example.com/success"
    cancel_url = "https://example.com/cancel"
} | ConvertTo-Json -Depth 10

Write-Host "============================================"
Write-Host "ORDER 1 - First purchase"
Write-Host "============================================"

try {
    $response1 = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop" `
        -Method POST `
        -ContentType "application/json" `
        -Body $payload1 `
        -ErrorAction Stop
    
    Write-Host "✅ Order 1 SUCCESS"
    Write-Host "   Order ID: $($response1.order_id)"
    Write-Host "   Job ID: $($response1.job_id)"
    Write-Host "   Session URL: $($response1.url)"
} catch {
    Write-Host "❌ Order 1 FAILED"
    Write-Host "   Status: $($_.Exception.Response.StatusCode.value__)"
    Write-Host "   Error: $($_.ErrorDetails.Message)"
    exit 1
}

Write-Host ""
Write-Host "Waiting 2 seconds before Order 2..."
Start-Sleep -Seconds 2
Write-Host ""

Write-Host "============================================"
Write-Host "ORDER 2 - Same customer repeat purchase"
Write-Host "============================================"

$payload2 = @{
    __action = "create_checkout_session"
    customer = @{
        email = $email
        firstName = "Test"
        lastName = "Repeat"
        phone = $phone
    }
    cart = @(
        @{
            bundle_id = "bnd-welcome-to-h2s"
            quantity = 1
        }
    )
    promotion_code = ""
    success_url = "https://example.com/success"
    cancel_url = "https://example.com/cancel"
} | ConvertTo-Json -Depth 10

try {
    $response2 = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop" `
        -Method POST `
        -ContentType "application/json" `
        -Body $payload2 `
        -ErrorAction Stop
    
    Write-Host "✅ ORDER 2 SUCCESS - CONSTRAINT REMOVED!"
    Write-Host "   Order ID: $($response2.order_id)"
    Write-Host "   Job ID: $($response2.job_id)"
    Write-Host "   Session URL: $($response2.url)"
    Write-Host ""
    Write-Host "============================================"
    Write-Host "✅ VALIDATION PASSED"
    Write-Host "Same customer can place multiple orders!"
    Write-Host "============================================"
} catch {
    Write-Host "❌ ORDER 2 FAILED - STILL BLOCKED!"
    Write-Host "   Status: $($_.Exception.Response.StatusCode.value__)"
    if ($_.ErrorDetails.Message) {
        Write-Host "   Error Details:"
        Write-Host "   $($_.ErrorDetails.Message)"
    } else {
        Write-Host "   Error: $($_.Exception.Message)"
    }
    Write-Host ""
    Write-Host "============================================"
    Write-Host "❌ VALIDATION FAILED"
    Write-Host "Constraint still blocking repeat customers"
    Write-Host "============================================"
    exit 1
}
