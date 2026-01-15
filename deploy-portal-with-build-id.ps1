$ErrorActionPreference = "Stop"

Write-Host "`n=== DEPLOYING PORTAL WITH BUILD ID ===`n" -ForegroundColor Cyan

# 1. Generate Build ID
$buildId = "PORTAL_BUILD_$(Get-Date -Format 'yyyyMMdd_HHmm')_$(git rev-parse --short HEAD)"
Write-Host "Build ID: $buildId" -ForegroundColor Green

# 2. Inject into portal.html
Write-Host "Injecting build ID..." -ForegroundColor Yellow
$portalPath = "frontend\portal.html"
$content = Get-Content $portalPath -Raw
$injected = $content -replace '\{\{BUILD_ID\}\}', $buildId

# 3. Save to temp file
$tempPath = "frontend\portal.html.deploy"
Set-Content $tempPath -Value $injected -NoNewline
Write-Host "Created: $tempPath" -ForegroundColor Green

# 4. Backup original, swap files
Copy-Item $portalPath "$portalPath.backup"
Move-Item $tempPath $portalPath -Force
Write-Host "Swapped files for deployment" -ForegroundColor Green

# 5. Deploy
Write-Host "`nDeploying to Vercel..." -ForegroundColor Yellow
Set-Location frontend
vercel --prod --yes

# 6. Restore original
Write-Host "`nRestoring original portal.html..." -ForegroundColor Yellow
Set-Location ..
Move-Item "$portalPath.backup" $portalPath -Force
Write-Host "Restored" -ForegroundColor Green

Write-Host "`n=== DEPLOYMENT COMPLETE ===`n" -ForegroundColor Cyan
Write-Host "Build ID deployed: $buildId" -ForegroundColor Green
Write-Host "`nVerify at: https://portal.home2smart.com" -ForegroundColor Cyan
Write-Host "1. Open browser console - look for build ID" -ForegroundColor Gray
Write-Host "2. Check bottom-right footer" -ForegroundColor Gray
Write-Host "`nRun verification script to confirm" -ForegroundColor White
