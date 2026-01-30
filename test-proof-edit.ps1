#!/usr/bin/env pwsh
# Test proof-asset-edit endpoint

$Backend = "https://h2s-backend-adql3lvdh-tabari-ropers-projects-6f2e090b.vercel.app"
$Endpoint = "$Backend/api/admin/proof-asset-edit"

Write-Host "`n=== Testing Proof Asset Edit Endpoint ===" -ForegroundColor Cyan

# Test 1: OPTIONS (preflight)
Write-Host "`n1. Testing OPTIONS (CORS preflight)..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri $Endpoint -Method OPTIONS -Headers @{
        "Origin" = "http://localhost:3000"
        "Access-Control-Request-Method" = "POST"
        "Access-Control-Request-Headers" = "content-type"
    } -UseBasicParsing -ErrorAction SilentlyContinue
    Write-Host "   Status: $($response.StatusCode)" -ForegroundColor $(if ($response.StatusCode -eq 204) { "Green" } else { "Red" })
    Write-Host "   CORS Headers:" -ForegroundColor Gray
    $response.Headers.GetEnumerator() | Where-Object { $_.Key -like "*Access-Control*" } | ForEach-Object {
        Write-Host "     $($_.Key): $($_.Value)" -ForegroundColor Gray
    }
} catch {
    Write-Host "   Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    Write-Host "   ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: POST with invalid payload (should get 400, not 405)
Write-Host "`n2. Testing POST with invalid payload..." -ForegroundColor Yellow
try {
    $body = @{
        asset_id = ""
    } | ConvertTo-Json
    
    $response = Invoke-WebRequest -Uri $Endpoint -Method POST `
        -Headers @{
            "Content-Type" = "application/json"
            "Origin" = "http://localhost:3000"
        } `
        -Body $body `
        -UseBasicParsing -ErrorAction SilentlyContinue
    
    Write-Host "   Status: $($response.StatusCode)" -ForegroundColor $(if ($response.StatusCode -ne 405) { "Green" } else { "Red" })
    $json = $response.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($json) {
        Write-Host "   Response: $($json | ConvertTo-Json -Compress)" -ForegroundColor Gray
    }
} catch {
    Write-Host "   Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    Write-Host "   ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 3: Check if route exists at all
Write-Host "`n3. Checking backend health..." -ForegroundColor Yellow
try {
    $healthResponse = Invoke-WebRequest -Uri "$Backend/api/health" -Method GET -UseBasicParsing -ErrorAction SilentlyContinue
    Write-Host "   Health Status: $($healthResponse.StatusCode)" -ForegroundColor $(if ($healthResponse.StatusCode -eq 200) { "Green" } else { "Red" })
    $healthJson = $healthResponse.Content | ConvertFrom-Json -ErrorAction SilentlyContinue
    if ($healthJson) {
        Write-Host "   Build ID: $($healthJson.build_id)" -ForegroundColor Gray
        Write-Host "   Env: $($healthJson.env_name)" -ForegroundColor Gray
    }
} catch {
    Write-Host "   Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    Write-Host "   ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
Write-Host "If you see 405 on POST test, the route is not deployed or misconfigured."
Write-Host "If you see 400 on POST test, the route IS working (just rejecting bad data)."
Write-Host "`nTo fix 405: Redeploy backend with 'vercel --prod' or check Vercel dashboard."
Write-Host ""
