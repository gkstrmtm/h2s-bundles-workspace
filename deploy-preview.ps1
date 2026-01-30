# PREVIEW DEPLOYMENT SCRIPT
# Deploys frontend to Vercel preview URL (NOT production alias)
# Use this for testing changes without affecting shop.home2smart.com

param([switch]$Yes)

$ErrorActionPreference = "Stop"

Write-Host "`nPREVIEW DEPLOYMENT (Non-Production)`n" -ForegroundColor Cyan
Write-Host "======================================================`n" -ForegroundColor Cyan

# Generate version stamp
$version = Get-Date -Format "yyyy-MM-dd-HHmmss"
Write-Host "Version: $version" -ForegroundColor Yellow

# Verify location
if (-not (Test-Path "frontend\bundles.html")) {
    Write-Host "ERROR: Must run from h2s-bundles-workspace root" -ForegroundColor Red
    exit 1
}

# Stamp bundles.html
Write-Host "`nStamping bundles.html..." -ForegroundColor Cyan
$bundlesPath = "frontend\bundles.html"
$bundlesContent = Get-Content $bundlesPath -Raw

# Update version comments
$bundlesContent = $bundlesContent -replace "<!-- VERSION: .* -->", "<!-- VERSION: $version -->"
$bundlesContent = $bundlesContent -replace "console\.log\('.*SHOP VERSION: .*'\);", "console.log('SHOP VERSION: $version');"

Set-Content -Path $bundlesPath -Value $bundlesContent -NoNewline
Write-Host "   OK - Stamped: $version" -ForegroundColor Green

# Stamp bundles.js
Write-Host "`nStamping bundles.js..." -ForegroundColor Cyan
$bundlesJsPath = "frontend\bundles.js"
if (Test-Path $bundlesJsPath) {
    $bundlesJs = Get-Content $bundlesJsPath -Raw
    # Find the __H2S_BOOT assignment line and replace its version string
    $bundlesJs = $bundlesJs -replace '(__H2S_BUNDLES_START\(\);.*?)(//\s*VERSION:.*)', "`$1// VERSION: $version"
    Set-Content -Path $bundlesJsPath -Value $bundlesJs -NoNewline
    Write-Host "   OK - Stamped bundles.js" -ForegroundColor Green
}

# Show changes
Write-Host "`nChanges:" -ForegroundColor Cyan
git diff --stat frontend/bundles.html frontend/bundles.js

# Confirm
if (-not $Yes) {
    Write-Host "`nThis will deploy to a PREVIEW URL (not production)" -ForegroundColor Yellow
    $confirm = Read-Host "Continue? (yes/no)"
    if ($confirm -notin @('yes','y','Y','YES','Yes')) {
        Write-Host "Cancelled" -ForegroundColor Red
        exit 1
    }
}

# Deploy to preview (no --prod flag)
Write-Host "`nDeploying to Vercel preview..." -ForegroundColor Cyan
cd frontend

try {
    $ErrorActionPreference = 'Continue'
    $out = (& vercel --yes 2>&1) | Out-String
    $exit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    
    Write-Host $out
    
    if ($exit -eq 0) {
        Write-Host "`nPreview deployment complete" -ForegroundColor Green
        
        # Extract preview URL from output
        $previewUrl = ($out -split "`n" | Where-Object { $_ -match 'https://.*vercel\.app' } | Select-Object -First 1).Trim()
        if ($previewUrl) {
            Write-Host "`nPreview URL: $previewUrl/bundles" -ForegroundColor Cyan
            Write-Host "`nTest your changes at the preview URL above." -ForegroundColor Yellow
            Write-Host "When ready, use .\deploy-and-verify.ps1 to push to production." -ForegroundColor Gray
        }
    } else {
        Write-Host "`nDeployment failed (exit code: $exit)" -ForegroundColor Red
        exit $exit
    }
} catch {
    Write-Host "`nDeployment error: $_" -ForegroundColor Red
    exit 1
} finally {
    cd ..
}
