#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Quick validation script for dispatch system data consistency
    
.DESCRIPTION
    Tests dispatch system without requiring full SYSTEM_GUARDIAN execution.
    Focuses specifically on dispatch portal, technician data, and job pipeline.
    
.EXAMPLE
    .\quick-dispatch-check.ps1
#>

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Quick Dispatch Validation" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# Test 1: Dispatch Portal Access
Write-Host "Testing dispatch portal..." -NoNewline
try {
    $response = Invoke-WebRequest -Uri "https://shop.home2smart.com/dispatch" -UseBasicParsing -TimeoutSec 10
    if ($response.StatusCode -eq 200 -and $response.Content -like "*Dispatch Command Center*") {
        Write-Host " ✓ OK" -ForegroundColor Green
    } else {
        Write-Host " ✗ FAIL - Content missing" -ForegroundColor Red
    }
} catch {
    Write-Host " ✗ FAIL - $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: Backend API Health
Write-Host "Testing backend API..." -NoNewline
try {
    $response = Invoke-WebRequest -Uri "https://h2s-backend.vercel.app/api/get-pros" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
    Write-Host " ✗ WARN - No auth check?" -ForegroundColor Yellow
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 401) {
        Write-Host " ✓ OK (requires auth)" -ForegroundColor Green
    } else {
        Write-Host " ✗ FAIL - Unexpected: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    }
}

# Test 3: Webhook Endpoint
Write-Host "Testing webhook endpoint..." -NoNewline
try {
    $response = Invoke-WebRequest -Uri "https://h2s-backend.vercel.app/api/stripe-webhook" `
        -Method POST `
        -Body "invalid" `
        -ContentType "application/json" `
        -UseBasicParsing `
        -TimeoutSec 10 `
        -ErrorAction Stop
    Write-Host " ✗ FAIL - Accepted invalid payload" -ForegroundColor Red
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 400) {
        Write-Host " ✓ OK (validates signatures)" -ForegroundColor Green
    } elseif ($_.Exception.Response.StatusCode.value__ -eq 404) {
        Write-Host " ✗ CRITICAL - Endpoint NOT FOUND" -ForegroundColor Red
    } else {
        Write-Host " ⚠ WARN - Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Yellow
    }
}

# Test 4: Technician Data Schema
Write-Host "Checking technician schema..." -NoNewline
$dispatchPath = "frontend\dispatch.html"
if (Test-Path $dispatchPath) {
    $content = Get-Content $dispatchPath -Raw
    $requiredFields = @('pro_id', 'email', 'phone', 'vehicle_make_model', 'home_address', 'is_active')
    $missing = @()
    foreach ($field in $requiredFields) {
        if ($content -notlike "*$field*") {
            $missing += $field
        }
    }
    if ($missing.Count -eq 0) {
        Write-Host " ✓ OK" -ForegroundColor Green
    } else {
        Write-Host " ✗ FAIL - Missing: $($missing -join ', ')" -ForegroundColor Red
    }
} else {
    Write-Host " ✗ FAIL - dispatch.html not found" -ForegroundColor Red
}

# Test 5: Realtime Configuration
Write-Host "Checking realtime setup..." -NoNewline
if (Test-Path $dispatchPath) {
    $content = Get-Content $dispatchPath -Raw
    if ($content -like "*dispatch-jobs-channel*" -and $content -like "*event:*INSERT*") {
        Write-Host " ✓ OK" -ForegroundColor Green
    } else {
        Write-Host " ✗ FAIL - Missing realtime listeners" -ForegroundColor Red
    }
} else {
    Write-Host " ✗ FAIL - dispatch.html not found" -ForegroundColor Red
}

# Test 6: Success Page Performance
Write-Host "Testing success page load..." -NoNewline
try {
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $response = Invoke-WebRequest -Uri "https://shop.home2smart.com/bundles?view=shopsuccess&session_id=test" -UseBasicParsing -TimeoutSec 10
    $stopwatch.Stop()
    $loadTime = $stopwatch.ElapsedMilliseconds
    
    if ($response.StatusCode -eq 200) {
        if ($loadTime -lt 1000) {
            Write-Host " ✓ OK (${loadTime}ms)" -ForegroundColor Green
        } else {
            Write-Host " ⚠ SLOW (${loadTime}ms)" -ForegroundColor Yellow
        }
    } else {
        Write-Host " ✗ FAIL - Status: $($response.StatusCode)" -ForegroundColor Red
    }
} catch {
    Write-Host " ✗ FAIL - $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Validation complete!" -ForegroundColor Cyan
Write-Host ""
Write-Host "For full validation, run: " -NoNewline
Write-Host ".\SYSTEM_GUARDIAN.ps1" -ForegroundColor Yellow
Write-Host ""
