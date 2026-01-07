# VERIFY LIVE DEPLOYMENT
# Purpose: Check what's actually live on portal and shop domains
# Usage: .\verify-live-deployment.ps1

$ErrorActionPreference = "Stop"

Write-Host "`n🔍 LIVE DEPLOYMENT VERIFICATION`n" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════`n" -ForegroundColor Cyan

# Check portal.home2smart.com
Write-Host "📍 Checking portal.home2smart.com/portal..." -ForegroundColor Cyan
try {
    $portalResponse = Invoke-WebRequest -Uri "https://portal.home2smart.com/portal" -UseBasicParsing
    $portalHtml = $portalResponse.Content
    
    # Extract version
    if ($portalHtml -match "🔧 PORTAL VERSION: ([^\s']+)") {
        $portalVersion = $matches[1]
        Write-Host "   ✅ Portal is live" -ForegroundColor Green
        Write-Host "   📋 Version: $portalVersion" -ForegroundColor Yellow
    } else {
        Write-Host "   ❌ No version marker found" -ForegroundColor Red
    }
    
    # Check backend config
    if ($portalHtml -match "🔧 Backend: ([^\s']+)") {
        $backend = $matches[1]
        Write-Host "   🔗 Backend: $backend" -ForegroundColor Gray
    }
    
    # Verify it's the right page
    if ($portalHtml -match "🛒 SHOP VERSION") {
        Write-Host "   ❌ ERROR: Portal is serving SHOP page!" -ForegroundColor Red
    }
    
} catch {
    Write-Host "   ❌ Failed to fetch portal: $_" -ForegroundColor Red
}

# Check shop.home2smart.com
Write-Host "`n📍 Checking shop.home2smart.com/bundles..." -ForegroundColor Cyan
try {
    $shopResponse = Invoke-WebRequest -Uri "https://shop.home2smart.com/bundles" -UseBasicParsing
    $shopHtml = $shopResponse.Content
    
    # Extract version
    if ($shopHtml -match "🛒 SHOP VERSION: ([^\s']+)") {
        $shopVersion = $matches[1]
        Write-Host "   ✅ Shop is live" -ForegroundColor Green
        Write-Host "   📋 Version: $shopVersion" -ForegroundColor Yellow
    } else {
        Write-Host "   ❌ No version marker found" -ForegroundColor Red
    }
    
    # Check backend config
    if ($shopHtml -match "🛒 Backend: ([^\s']+)") {
        $backend = $matches[1]
        Write-Host "   🔗 Backend: $backend" -ForegroundColor Gray
    }
    
    # Verify it's the right page
    if ($shopHtml -match "🔧 PORTAL VERSION") {
        Write-Host "   ❌ ERROR: Shop is serving PORTAL page!" -ForegroundColor Red
    }
    
} catch {
    Write-Host "   ❌ Failed to fetch shop: $_" -ForegroundColor Red
}

# Check backend
Write-Host "`n📍 Checking h2s-backend.vercel.app/api..." -ForegroundColor Cyan
try {
    $backendResponse = Invoke-WebRequest -Uri "https://h2s-backend.vercel.app/api/portal_login" -Method OPTIONS -UseBasicParsing
    if ($backendResponse.StatusCode -eq 204) {
        Write-Host "   ✅ Backend API is reachable" -ForegroundColor Green
    }
} catch {
    Write-Host "   ❌ Backend check failed: $_" -ForegroundColor Red
}

Write-Host "`n═══════════════════════════════════════════════`n" -ForegroundColor Cyan

# Summary
if ($portalVersion -and $shopVersion) {
    Write-Host "🎯 Both sites are live and serving correct pages" -ForegroundColor Green
    Write-Host "`n📊 Versions:" -ForegroundColor White
    Write-Host "   Portal: $portalVersion" -ForegroundColor Yellow
    Write-Host "   Shop:   $shopVersion" -ForegroundColor Yellow
    
    if ($portalVersion -eq $shopVersion) {
        Write-Host "`n✅ Versions match - deployment synchronized" -ForegroundColor Green
    } else {
        Write-Host "`n⚠️  Versions differ - may be from different deployments" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠️  Issues detected - see errors above" -ForegroundColor Yellow
}

Write-Host "`n"
