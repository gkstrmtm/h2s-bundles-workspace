# CHECKOUT SYSTEM VALIDATION
# Run this after any deployment to verify checkout is working correctly

$ErrorActionPreference = "Continue"
$apiUrl = "https://h2s-backend.vercel.app/api/shop"

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "CHECKOUT SYSTEM VALIDATION" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

$results = @{
    passed = 0
    failed = 0
    tests = @()
}

function Test-Checkout {
    param($email, $testName)
    
    Write-Host "Testing: $testName" -ForegroundColor Yellow
    Write-Host "  Email: $email" -ForegroundColor Gray
    
    $body = @{
        __action = "create_checkout_session"
        customer = @{
            email = $email
            name = "Test Customer"
            phone = "555-0100"
        }
        cart = @(
            @{
                bundle_id = "bnd-welcome-to-h2s"
                name = "Smart Home Bundle"
                price = 999
                quantity = 1
            }
        )
        promotion_code = ""
        success_url = "https://example.com/success"
        cancel_url = "https://example.com/cancel"
    } | ConvertTo-Json -Depth 10
    
    try {
        $response = Invoke-RestMethod -Uri $apiUrl -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop
        
        if ($response.ok -and $response.order_id -and $response.job_id) {
            Write-Host "  ✅ SUCCESS" -ForegroundColor Green
            Write-Host "     Order: $($response.order_id)" -ForegroundColor Gray
            Write-Host "     Job: $($response.job_id)" -ForegroundColor Gray
            return @{
                success = $true
                order_id = $response.order_id
                job_id = $response.job_id
            }
        } else {
            Write-Host "  ❌ FAILED: Missing order_id or job_id" -ForegroundColor Red
            return @{ success = $false; error = "Missing order_id or job_id" }
        }
    } catch {
        Write-Host "  ❌ FAILED: $($_.Exception.Message)" -ForegroundColor Red
        return @{ success = $false; error = $_.Exception.Message }
    }
}

# TEST 1: Single customer checkout
Write-Host "`n[TEST 1] Single Customer Checkout" -ForegroundColor Cyan
$test1 = Test-Checkout -email "single-$(Get-Random)@test.com" -testName "Single customer first order"
if ($test1.success) { $results.passed++ } else { $results.failed++ }
$results.tests += @{ name = "Single Customer Checkout"; result = $test1 }

Start-Sleep -Seconds 2

# TEST 2: Repeat customer (same email, 2 orders)
Write-Host "`n[TEST 2] Repeat Customer - Multiple Orders" -ForegroundColor Cyan
$repeatEmail = "repeat-$(Get-Random)@test.com"

Write-Host "  Order 1..." -ForegroundColor Gray
$test2a = Test-Checkout -email $repeatEmail -testName "Repeat customer - Order 1"
Start-Sleep -Seconds 2

Write-Host "  Order 2 (same customer)..." -ForegroundColor Gray
$test2b = Test-Checkout -email $repeatEmail -testName "Repeat customer - Order 2"

if ($test2a.success -and $test2b.success) {
    Write-Host "  ✅ REPEAT CUSTOMER WORKS!" -ForegroundColor Green
    $results.passed++
    $results.tests += @{ name = "Repeat Customer"; result = @{ success = $true } }
} else {
    Write-Host "  ❌ REPEAT CUSTOMER FAILED!" -ForegroundColor Red
    $results.failed++
    $results.tests += @{ name = "Repeat Customer"; result = @{ success = $false; error = "One or both orders failed" } }
}

Start-Sleep -Seconds 2

# TEST 3: Rapid succession (idempotency test)
Write-Host "`n[TEST 3] Rapid Succession (5 seconds apart)" -ForegroundColor Cyan
$rapidEmail = "rapid-$(Get-Random)@test.com"
$test3a = Test-Checkout -email $rapidEmail -testName "Rapid order 1"
Start-Sleep -Seconds 5
$test3b = Test-Checkout -email $rapidEmail -testName "Rapid order 2"

if ($test3a.success -and $test3b.success) {
    Write-Host "  ✅ RAPID SUCCESSION WORKS!" -ForegroundColor Green
    $results.passed++
    $results.tests += @{ name = "Rapid Succession"; result = @{ success = $true } }
} else {
    Write-Host "  ❌ RAPID SUCCESSION FAILED!" -ForegroundColor Red
    $results.failed++
    $results.tests += @{ name = "Rapid Succession"; result = @{ success = $false } }
}

# SUMMARY
Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "VALIDATION SUMMARY" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Passed: $($results.passed)" -ForegroundColor Green
Write-Host "Failed: $($results.failed)" -ForegroundColor Red

if ($results.failed -eq 0) {
    Write-Host "`n✅✅✅ ALL TESTS PASSED ✅✅✅" -ForegroundColor Green
    Write-Host "Checkout system is healthy!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n❌ SOME TESTS FAILED ❌" -ForegroundColor Red
    Write-Host "Review errors above" -ForegroundColor Red
    exit 1
}
