# Preview deployment script (NO production aliasing)
Write-Host "Starting PREVIEW deployment (no aliasing)..." -ForegroundColor Cyan

# Step 1: Deploy to Vercel (preview)
Write-Host "`n[1/3] Deploying to Vercel (preview)..." -ForegroundColor Yellow
$output = vercel --yes 2>&1 | Out-String
Write-Host $output

# Extract deployment URL
$deployUrl = $null
try {
    $m = ($output | Select-String -Pattern '(https://[^\s]+\.vercel\.app)' -AllMatches).Matches
    if ($m -and $m.Count -gt 0) { $deployUrl = $m[$m.Count - 1].Groups[1].Value }
} catch {}

if (-not $deployUrl) {
    Write-Host "ERROR: Could not extract preview deployment URL" -ForegroundColor Red
    exit 1
}
Write-Host "Preview deployed to: $deployUrl" -ForegroundColor Green

# Step 2: Verify deployment (on preview URL)
Write-Host "`n[2/3] Verifying preview deployment..." -ForegroundColor Yellow
Start-Sleep -Seconds 2

$healthUrl = "$deployUrl/api/health"
try {
    $health = (Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -Headers @{"Cache-Control"="no-cache"}).Content | ConvertFrom-Json
    Write-Host "Preview backend build_id: $($health.build_id)" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Preview health check failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Step 3: Proof endpoints smoke checks (public) on preview URL
Write-Host "`n[3/3] Proof endpoint smoke checks (preview)..." -ForegroundColor Yellow
try {
    $slotsUrl = "$deployUrl/api/proof-slots?surface=bundles&limit=3"
    $slots = (Invoke-WebRequest -Uri $slotsUrl -UseBasicParsing -Headers @{"Cache-Control"="no-cache";"Accept"="application/json"}).Content | ConvertFrom-Json
    if (-not $slots.ok) { throw "proof-slots returned ok=false" }
    Write-Host "Proof slots: OK" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Proof slots check failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

try {
    $evtUrl = "$deployUrl/api/proof-event"
    $body = @{ event_type = 'impression'; surface = 'bundles'; slot_key = 'pre_cta'; service = 'cameras'; session_id = 'deploy-smoke'; page_url = 'deploy-script' } | ConvertTo-Json
    $evt = (Invoke-WebRequest -Method POST -Uri $evtUrl -UseBasicParsing -Headers @{"Cache-Control"="no-cache";"Content-Type"="application/json";"Accept"="application/json"} -Body $body).Content | ConvertFrom-Json
    if (-not $evt.ok) { throw "proof-event returned ok=false" }
    Write-Host "Proof event: OK" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Proof event check failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "" 
Write-Host "Preview deployment complete!" -ForegroundColor Green
Write-Host "Preview URL:" -ForegroundColor Cyan
Write-Host "  - $deployUrl" -ForegroundColor White
Write-Host "Health:" -ForegroundColor Cyan
Write-Host "  - $healthUrl" -ForegroundColor White
