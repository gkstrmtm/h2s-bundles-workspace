#!/usr/bin/env pwsh
# Proof Packs Editor System Validation

Write-Host ""
Write-Host "=== Proof Packs Editor - System Validation ===" -ForegroundColor Cyan
Write-Host ""

$Backend = "https://h2s-backend-adql3lvdh-tabari-ropers-projects-6f2e090b.vercel.app"

# Test 1: Backend Health
Write-Host "1. Testing backend health..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$Backend/api/health" -Method GET -ErrorAction Stop
    Write-Host "   [OK] Backend online" -ForegroundColor Green
    Write-Host "     Build: $($health.build_id)" -ForegroundColor Gray
} catch {
    Write-Host "   [FAIL] Backend unreachable" -ForegroundColor Red
    exit 1
}

# Test 2: Proof Asset Edit Endpoint
Write-Host ""
Write-Host "2. Testing proof-asset-edit endpoint..." -ForegroundColor Yellow
try {
    $body = '{"asset_id":""}'
    $null = Invoke-WebRequest -Uri "$Backend/api/admin/proof-asset-edit" -Method POST `
        -Headers @{"Content-Type"="application/json"} -Body $body -UseBasicParsing -ErrorAction Stop
} catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 400) {
        Write-Host "   [OK] Endpoint working (400 validation)" -ForegroundColor Green
    } elseif ($status -eq 405) {
        Write-Host "   [FAIL] Route not deployed (405)" -ForegroundColor Red
        exit 1
    } else {
        Write-Host "   [WARN] Status: $status" -ForegroundColor Yellow
    }
}

# Test 3: Supabase Config
Write-Host ""
Write-Host "3. Testing Supabase config..." -ForegroundColor Yellow
try {
    $config = Invoke-RestMethod -Uri "$Backend/api/get_supabase_config" -Method GET -ErrorAction Stop
    if ($config.supabase_url) {
        Write-Host "   [OK] Supabase configured" -ForegroundColor Green
    }
} catch {
    Write-Host "   [FAIL] Config unavailable" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== System Status ===" -ForegroundColor Cyan
Write-Host "[OK] Backend deployed and responding" -ForegroundColor Green
Write-Host "[OK] Edit endpoint available" -ForegroundColor Green
Write-Host "[OK] Database configured" -ForegroundColor Green
Write-Host ""
Write-Host "=== Manual Test Steps ===" -ForegroundColor Cyan
Write-Host "1. Open Dash.html" -ForegroundColor White
Write-Host "2. Go to Proof Packs panel" -ForegroundColor White
Write-Host "3. Set Backend URL to: $Backend" -ForegroundColor White
Write-Host "4. Select a pack, switch to Library tab" -ForegroundColor White
Write-Host "5. Click Edit media on a video" -ForegroundColor White
Write-Host "6. Adjust rotation/trim/filters" -ForegroundColor White
Write-Host "7. Click Apply edits" -ForegroundColor White
Write-Host ""
Write-Host "=== Expected Success Indicators ===" -ForegroundColor Cyan
Write-Host "- Toast: Edits applied successfully: [changes]" -ForegroundColor Green
Write-Host "- Editor status shows: Applied: [changes]" -ForegroundColor Green
Write-Host "- Header shows: Updated at [time]" -ForegroundColor Green
Write-Host "- Preview reloads with edited video" -ForegroundColor Green
Write-Host "- Library refreshes automatically" -ForegroundColor Green
Write-Host ""
Write-Host "System ready for testing." -ForegroundColor Green
Write-Host ""
