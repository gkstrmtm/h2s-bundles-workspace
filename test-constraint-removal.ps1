# Test if constraint was dropped by attempting duplicate recipient+step insert

$testRecipient = "test-recipient-$(Get-Random)"
$testStep = "d30da333-3a54-4598-8ac1-f3b276185ea1" # Same step_id used in backend

Write-Host "Testing constraint removal..." -ForegroundColor Cyan
Write-Host "Test recipient: $testRecipient" -ForegroundColor Gray
Write-Host ""

# Order 1
Write-Host "Creating Order 1 (should succeed)..." -ForegroundColor Yellow
$order1 = @{
    __action = "create_checkout_session"
    customer = @{
        email = "constraint-test-$(Get-Random)@test.com"
        name = "Constraint Test"
        phone = "555-0100"
    }
    cart = @(
        @{
            bundle_id = "bnd-welcome-to-h2s"
            name = "Test Bundle"
            price = 999
            quantity = 1
        }
    )
    promotion_code = ""
    success_url = "https://example.com/success"
    cancel_url = "https://example.com/cancel"
} | ConvertTo-Json -Depth 10

try {
    $resp1 = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop" -Method POST -Body $order1 -ContentType "application/json" -ErrorAction Stop
    if ($resp1.ok) {
        Write-Host "✅ Order 1 created: $($resp1.order_id)" -ForegroundColor Green
        Write-Host "   Job ID: $($resp1.job_id)" -ForegroundColor Gray
    } else {
        Write-Host "❌ Order 1 failed: $($resp1.error)" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "❌ Order 1 request failed: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) {
        Write-Host "   Details: $($_.ErrorDetails.Message)" -ForegroundColor Gray
    }
    exit 1
}

Start-Sleep -Seconds 2

# Order 2 - same email/phone (same recipient) but slightly different to avoid any caching
Write-Host ""
Write-Host "Creating Order 2 - SAME CUSTOMER (testing constraint)..." -ForegroundColor Yellow

$sameCustomer = ($order1 | ConvertFrom-Json).customer
$sameCustomer.name = $sameCustomer.name + " Jr" # Slight variation to avoid any dedup

$order2 = @{
    __action = "create_checkout_session"
    customer = $sameCustomer
    cart = @(
        @{
            bundle_id = "bnd-welcome-to-h2s"
            name = "Test Bundle"
            price = 999
            quantity = 1
        }
    )
    promotion_code = ""
    success_url = "https://example.com/success2" # Different URL
    cancel_url = "https://example.com/cancel2"
} | ConvertTo-Json -Depth 10

try {
    $resp2 = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop" -Method POST -Body $order2 -ContentType "application/json" -ErrorAction Stop
    if ($resp2.ok) {
        Write-Host "✅ Order 2 created: $($resp2.order_id)" -ForegroundColor Green
        Write-Host "   Job ID: $($resp2.job_id)" -ForegroundColor Gray
        Write-Host ""
        Write-Host "============================================" -ForegroundColor Green
        Write-Host "✅✅✅ CONSTRAINT REMOVED SUCCESSFULLY! ✅✅✅" -ForegroundColor Green
        Write-Host "============================================" -ForegroundColor Green
        Write-Host "Same customer placed 2 orders:" -ForegroundColor Green
        Write-Host "  Order 1: $($resp1.order_id)" -ForegroundColor Green
        Write-Host "  Order 2: $($resp2.order_id)" -ForegroundColor Green
        Write-Host "  Both have dispatch jobs!" -ForegroundColor Green
    } else {
        Write-Host "❌ Order 2 failed: $($resp2.error)" -ForegroundColor Red
        Write-Host ""
        Write-Host "CONSTRAINT STILL EXISTS!" -ForegroundColor Red
        exit 1
    }
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "❌ Order 2 request failed with status $statusCode" -ForegroundColor Red
    
    # Try to read error response body
    try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $errorBody = $reader.ReadToEnd() | ConvertFrom-Json
        $reader.Close()
        
        Write-Host ""
        Write-Host "ERROR DETAILS:" -ForegroundColor Yellow
        Write-Host "  Error: $($errorBody.error)" -ForegroundColor Gray
        Write-Host "  Code: $($errorBody.code)" -ForegroundColor Gray
        Write-Host "  Details: $($errorBody.details)" -ForegroundColor Gray
        
        if ($errorBody.supabase_error) {
            Write-Host ""
            Write-Host "SUPABASE ERROR:" -ForegroundColor Yellow
            Write-Host "  Code: $($errorBody.supabase_error.code)" -ForegroundColor Gray
            Write-Host "  Message: $($errorBody.supabase_error.message)" -ForegroundColor Gray
            Write-Host "  Details: $($errorBody.supabase_error.details)" -ForegroundColor Gray
            Write-Host "  Hint: $($errorBody.supabase_error.hint)" -ForegroundColor Gray
        }
    } catch {
        Write-Host "  Could not parse error body: $($_.Exception.Message)" -ForegroundColor Gray
    }
    
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Red
    Write-Host "❌ CONSTRAINT STILL BLOCKING REPEAT CUSTOMERS!" -ForegroundColor Red
    Write-Host "============================================" -ForegroundColor Red
    exit 1
}
