# DEPLOYMENT VERIFICATION SCRIPT
# Purpose: Stamp versions, deploy, and verify correct files are on correct URLs
# Usage: .\deploy-and-verify.ps1

$ErrorActionPreference = "Stop"

Write-Host "`nHOME2SMART DEPLOYMENT VERIFICATION SYSTEM`n" -ForegroundColor Cyan
Write-Host "======================================================`n" -ForegroundColor Cyan

# Step 1: Generate version stamp
$version = Get-Date -Format "yyyy-MM-dd-HHmmss"
Write-Host "Version: $version" -ForegroundColor Yellow

# Step 2: Verify we're in the right directory
if (-not (Test-Path "frontend\portal.html") -or -not (Test-Path "frontend\bundles.html")) {
    Write-Host "ERROR: Must run from h2s-bundles-workspace root" -ForegroundColor Red
    Write-Host "   Current location: $(Get-Location)" -ForegroundColor Red
    exit 1
}

# Step 3: Check for uncommitted changes (warn but don't block)
$gitStatus = git status --porcelain
if ($gitStatus) {
    Write-Host "`nWARNING: You have uncommitted changes:" -ForegroundColor Yellow
    Write-Host $gitStatus -ForegroundColor Gray
    $response = Read-Host "`nContinue anyway? (yes/no)"
    if ($response -ne "yes") {
        Write-Host "Deployment cancelled" -ForegroundColor Red
        exit 1
    }
}

# Step 4: Stamp portal.html with new version
Write-Host "`nStamping portal.html..." -ForegroundColor Cyan
$portalPath = "frontend\portal.html"
$portalContent = Get-Content $portalPath -Raw

# Replace the version marker (look for the <!-- VERSION: --> comment)
$portalContent = $portalContent -replace "<!-- VERSION: .* -->", "<!-- VERSION: $version -->"
$portalContent = $portalContent -replace "console\.log\('.*PORTAL VERSION: .*'\);", "console.log('PORTAL VERSION: $version');"

Set-Content -Path $portalPath -Value $portalContent -NoNewline
Write-Host "   Portal stamped with version: $version" -ForegroundColor Green

# Step 5: Stamp bundles.html with new version
Write-Host "`nStamping bundles.html..." -ForegroundColor Cyan
$bundlesPath = "frontend\bundles.html"
$bundlesContent = Get-Content $bundlesPath -Raw

# Replace the version marker
$bundlesContent = $bundlesContent -replace "<!-- VERSION: .* -->", "<!-- VERSION: $version -->"
$bundlesContent = $bundlesContent -replace "console\.log\('.*SHOP VERSION: .*'\);", "console.log('SHOP VERSION: $version');"

Set-Content -Path $bundlesPath -Value $bundlesContent -NoNewline
Write-Host "   Shop stamped with version: $version" -ForegroundColor Green

# Step 6: Copy files to root (Vercel deploys from root)
Write-Host "`nCopying to root for deployment..." -ForegroundColor Cyan
Copy-Item "frontend\portal.html" "portal.html" -Force
Copy-Item "frontend\bundles.html" "bundles.html" -Force
Write-Host "   Files copied to root" -ForegroundColor Green

# Step 7: Show what changed
Write-Host "`nChanges to be deployed:" -ForegroundColor Cyan
git diff --stat portal.html bundles.html

# Step 8: Confirm deployment
Write-Host "`nReady to deploy version $version" -ForegroundColor Yellow
$confirm = Read-Host "Continue with deployment? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "Deployment cancelled" -ForegroundColor Red
    exit 1
}

# Step 9: Deploy to Vercel
Write-Host "`nDeploying to Vercel..." -ForegroundColor Cyan
git add portal.html bundles.html frontend\portal.html frontend\bundles.html
git commit -m "Deploy: $version - Stamped portal and bundles"
git push

Write-Host "   Pushed to Git" -ForegroundColor Green
Write-Host "`n   Triggering Vercel deployment..." -ForegroundColor Cyan

# Vercel auto-deploys on push, but we can force it
vercel --prod --yes 2>$null

Write-Host "   Vercel deployment triggered" -ForegroundColor Green

# Step 10: Wait for CDN propagation
Write-Host "`nWaiting 20 seconds for CDN propagation..." -ForegroundColor Yellow
Start-Sleep -Seconds 20

# Step 11: Verify portal.home2smart.com
Write-Host "`nVERIFICATION PHASE" -ForegroundColor Cyan
Write-Host "======================================================`n" -ForegroundColor Cyan

Write-Host "Checking portal.home2smart.com/portal..." -ForegroundColor Cyan
try {
    $portalResponse = Invoke-WebRequest -Uri "https://portal.home2smart.com/portal" -UseBasicParsing
    $portalHtml = $portalResponse.Content
    
    # Check for portal version marker
    if ($portalHtml -match "PORTAL VERSION: $version") {
        Write-Host "   Portal version MATCHES: $version" -ForegroundColor Green
    } else {
        Write-Host "   Portal version MISMATCH!" -ForegroundColor Red
        if ($portalHtml -match "PORTAL VERSION: (.*)") {
            Write-Host "      Expected: $version" -ForegroundColor Red
            Write-Host "      Got:      $($matches[1])" -ForegroundColor Red
        } else {
            Write-Host "      No version marker found in response" -ForegroundColor Red
        }
        Write-Host "`n   PORTAL VERIFICATION FAILED - Old version may be cached" -ForegroundColor Red
    }
    
    # Check it's not serving bundles by mistake
    if ($portalHtml -match "SHOP VERSION") {
        Write-Host "   ERROR: Portal is serving SHOP page!" -ForegroundColor Red
    }
    
} catch {
    Write-Host "   ❌ Failed to fetch portal: $_" -ForegroundColor Red
}

# Step 12: Verify shop.home2smart.com/bundles
Write-Host "`nChecking shop.home2smart.com/bundles..." -ForegroundColor Cyan
try {
    $shopResponse = Invoke-WebRequest -Uri "https://shop.home2smart.com/bundles" -UseBasicParsing
    $shopHtml = $shopResponse.Content
    
    # Check for shop version marker
    if ($shopHtml -match "SHOP VERSION: $version") {
        Write-Host "   Shop version MATCHES: $version" -ForegroundColor Green
    } else {
        Write-Host "   Shop version MISMATCH!" -ForegroundColor Red
        if ($shopHtml -match "SHOP VERSION: (.*)") {
            Write-Host "      Expected: $version" -ForegroundColor Red
            Write-Host "      Got:      $($matches[1])" -ForegroundColor Red
        } else {
            Write-Host "      No version marker found in response" -ForegroundColor Red
        }
        Write-Host "`n   SHOP VERIFICATION FAILED - Old version may be cached" -ForegroundColor Red
    }
    
    # Check it's not serving portal by mistake
    if ($shopHtml -match "PORTAL VERSION") {
        Write-Host "   ERROR: Shop is serving PORTAL page!" -ForegroundColor Red
    }
    
} catch {
    Write-Host "   ❌ Failed to fetch shop: $_" -ForegroundColor Red
}

# Step 13: Verify backend is reachable
Write-Host "`nChecking h2s-backend.vercel.app/api..." -ForegroundColor Cyan
try {
    $backendResponse = Invoke-WebRequest -Uri "https://h2s-backend.vercel.app/api/portal_login" -Method OPTIONS -UseBasicParsing
    if ($backendResponse.StatusCode -eq 204) {
        Write-Host "   Backend API is reachable" -ForegroundColor Green
    } else {
        Write-Host "   Backend returned status: $($backendResponse.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "   Backend check failed: $_" -ForegroundColor Red
}

# Step 14: Summary
Write-Host "`n" -NoNewline
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "DEPLOYMENT COMPLETE - Version: $version" -ForegroundColor Cyan
Write-Host "======================================================`n" -ForegroundColor Cyan

Write-Host "NEXT STEPS:" -ForegroundColor Yellow
Write-Host "   1. Open portal.home2smart.com/portal in incognito mode" -ForegroundColor White
Write-Host "   2. Open DevTools console and verify version: $version" -ForegroundColor White
Write-Host "   3. Test portal signup flow (see E2E_TEST_PLAN.md)" -ForegroundColor White
Write-Host "   4. Open shop.home2smart.com/bundles in incognito mode" -ForegroundColor White
Write-Host "   5. Verify shop version: $version" -ForegroundColor White
Write-Host "   6. Test bundle purchase flow`n" -ForegroundColor White

Write-Host "If versions don't match, wait 60 seconds for CDN and run:" -ForegroundColor Yellow
Write-Host "   .\verify-live-deployment.ps1`n" -ForegroundColor White
