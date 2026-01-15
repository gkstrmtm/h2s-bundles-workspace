# Complete production deployment script
Write-Host "Starting production deployment..." -ForegroundColor Cyan

# Step 1: Deploy to Vercel
Write-Host "`n[1/3] Deploying to Vercel..." -ForegroundColor Yellow
$output = vercel --prod --yes 2>&1 | Out-String
Write-Host $output

# Extract deployment URL
$deployUrl = ($output | Select-String -Pattern 'https://backend-[a-z0-9]+-tabari-ropers-projects-[a-z0-9]+\.vercel\.app').Matches[0].Value
if (-not $deployUrl) {
    Write-Host "ERROR: Could not extract deployment URL" -ForegroundColor Red
    exit 1
}
Write-Host "Deployed to: $deployUrl" -ForegroundColor Green

# Step 2: Alias to production domains
Write-Host "`n[2/3] Aliasing to production domains..." -ForegroundColor Yellow
vercel alias set $deployUrl h2s-backend.vercel.app
vercel alias set $deployUrl portal.home2smart.com

# Step 3: Verify deployment
Write-Host "`n[3/3] Verifying deployment..." -ForegroundColor Yellow
Start-Sleep -Seconds 2
$html = (Invoke-WebRequest -Uri 'https://h2s-backend.vercel.app/portal.html' -UseBasicParsing -Headers @{"Cache-Control"="no-cache"}).Content
$buildLine = ($html -split "`n" | Select-String -Pattern "BUILD_ID").ToString()
Write-Host "Live build ID: $buildLine" -ForegroundColor Green

Write-Host "`n✓ Deployment complete!" -ForegroundColor Green
Write-Host "URLs:" -ForegroundColor Cyan
Write-Host "  - https://h2s-backend.vercel.app/portal.html" -ForegroundColor White
Write-Host "  - https://portal.home2smart.com/portal.html" -ForegroundColor White
Write-Host "`nHard refresh (Ctrl+Shift+R) to clear browser cache" -ForegroundColor Yellow
