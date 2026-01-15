#!/usr/bin/env pwsh
# Smoke Test - Verifies shop.home2smart.com is working

param(
    [switch]$NoCacheHeaders = $false,
    [switch]$Verbose = $false
)

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   H2S BUNDLES SMOKE TEST" -ForegroundColor Cyan  
Write-Host "========================================`n" -ForegroundColor Cyan

$tests = @()
$passed = 0
$failed = 0

function Test-Endpoint {
    param($Name, $Url, $ExpectedStatus = 200, $CheckContent = $null)
    
    Write-Host "Testing: $Name" -ForegroundColor Yellow
    try {
        $headers = @{}
        if ($NoCacheHeaders) {
            $headers['Cache-Control'] = 'no-cache'
            $headers['Pragma'] = 'no-cache'
        }
        
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -Headers $headers -TimeoutSec 10
        
        if ($response.StatusCode -eq $ExpectedStatus) {
            if ($CheckContent) {
                if ($response.Content -match $CheckContent) {
                    Write-Host "  ✓ PASS - Status $($response.StatusCode), content matched" -ForegroundColor Green
                    return $true
                } else {
                    Write-Host "  ✗ FAIL - Status OK but content mismatch" -ForegroundColor Red
                    if ($Verbose) {
                        Write-Host "    Expected pattern: $CheckContent" -ForegroundColor Gray
                    }
                    return $false
                }
            } else {
                Write-Host "  ✓ PASS - Status $($response.StatusCode)" -ForegroundColor Green
                return $true
            }
        } else {
            Write-Host "  ✗ FAIL - Expected $ExpectedStatus, got $($response.StatusCode)" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "  ✗ FAIL - $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# Test 1: Frontend loads
if (Test-Endpoint "Frontend Page" "https://shop.home2smart.com") { $passed++ } else { $failed++ }

# Test 2: Frontend has outlet div
if (Test-Endpoint "Outlet Element" "https://shop.home2smart.com" -CheckContent 'id="outlet"') { $passed++ } else { $failed++ }

# Test 3: bundles.js loads
if (Test-Endpoint "JavaScript File" "https://shop.home2smart.com/bundles.js" -CheckContent "function renderShop") { $passed++ } else { $failed++ }

# Test 4: Backend bundles API
Write-Host "Testing: Backend Bundles API" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/bundles-data" -Method GET -TimeoutSec 10
    if ($response.bundles -and $response.bundles.Count -gt 0) {
        Write-Host "  ✓ PASS - Returned $($response.bundles.Count) bundles" -ForegroundColor Green
        $passed++
    } else {
        Write-Host "  ✗ FAIL - No bundles returned" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "  ✗ FAIL - $($_.Exception.Message)" -ForegroundColor Red
    $failed++
}

# Test 5: Backend checkout API
Write-Host "Testing: Backend Checkout API" -ForegroundColor Yellow
try {
    $testBody = @{
        action="create_checkout_session"
        customer=@{email="smoketest@test.com";name="Smoke Test";phone="5555555555"}
        cart=@(@{id="bundle-1";name="Test Bundle";price=999;qty=1})
        metadata=@{customer_email="smoketest@test.com"}
    } | ConvertTo-Json -Depth 10
    
    $response = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop" -Method POST -Body $testBody -ContentType "application/json" -TimeoutSec 15
    
    if ($response.ok -and $response.order_id -and $response.job_id) {
        Write-Host "  ✓ PASS - Created order $($response.order_id)" -ForegroundColor Green
        Write-Host "    Job ID: $($response.job_id)" -ForegroundColor Gray
        $passed++
    } else {
        Write-Host "  ✗ FAIL - Response missing required fields" -ForegroundColor Red
        $failed++
    }
} catch {
    Write-Host "  ✗ FAIL - $($_.Exception.Message)" -ForegroundColor Red
    $failed++
}

# Summary
Write-Host "`n========================================" -ForegroundColor Cyan
$total = $passed + $failed
$percentage = [math]::Round(($passed / $total) * 100, 1)

if ($failed -eq 0) {
    Write-Host "   ALL TESTS PASSED (check)" -ForegroundColor Green
} else {
    Write-Host "   SOME TESTS FAILED" -ForegroundColor Red
}

Write-Host "   $passed of $total tests passed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Yellow" })
Write-Host "========================================`n" -ForegroundColor Cyan

# Exit code
exit $failed
