#!/usr/bin/env pwsh
# QUICK VALIDATION - Run this anytime to check system health

param(
    [switch]$Fix
)

$ErrorActionPreference = "Stop"

Write-Host "`n🔍 SYSTEM HEALTH CHECK" -ForegroundColor Cyan
Write-Host "════════════════════════════════════════════════════════`n"

$issues = @()

# Check 1: Forbidden directories
if (Test-Path "app") {
    $issues += "❌ /app directory exists"
    if ($Fix) {
        Remove-Item "app" -Recurse -Force
        Write-Host "✅ FIXED: Deleted /app directory" -ForegroundColor Green
    }
}

if (Test-Path "tsconfig.json") {
    $issues += "❌ tsconfig.json at root"
    if ($Fix) {
        Remove-Item "tsconfig.json" -Force
        Write-Host "✅ FIXED: Deleted tsconfig.json" -ForegroundColor Green
    }
}

if (Test-Path "next.config.js") {
    $issues += "❌ next.config.js at root"
    if ($Fix) {
        Remove-Item "next.config.js" -Force
        Write-Host "✅ FIXED: Deleted next.config.js" -ForegroundColor Green
    }
}

# Check 2: API configuration
$portalContent = Get-Content "frontend\portal.html" -Raw -ErrorAction SilentlyContinue
if ($portalContent -and $portalContent -notmatch 'h2s-backend\.vercel\.app/api') {
    $issues += "❌ Portal.html not using h2s-backend.vercel.app"
    if ($Fix) {
        Write-Host "⚠️  Cannot auto-fix API URL - manual edit required" -ForegroundColor Yellow
    }
}

# Check 3: File sync
if (Test-Path "frontend\portal.html" -and Test-Path "portal.html") {
    $frontendHash = (Get-FileHash "frontend\portal.html").Hash
    $rootHash = (Get-FileHash "portal.html").Hash
    if ($frontendHash -ne $rootHash) {
        $issues += "⚠️  portal.html out of sync"
        if ($Fix) {
            Copy-Item "frontend\portal.html" "portal.html" -Force
            Write-Host "✅ FIXED: Synced portal.html" -ForegroundColor Green
        }
    }
}

# Check 4: Test live deployment
Write-Host "`n📡 Testing live deployment..."
try {
    $response = Invoke-WebRequest -Uri "https://portal.home2smart.com/portal" -UseBasicParsing -TimeoutSec 5
    if ($response.Content -match 'h2s-backend\.vercel\.app/api') {
        Write-Host "✅ Portal live and using correct backend" -ForegroundColor Green
    } else {
        $issues += "❌ Live portal not using h2s-backend"
    }
} catch {
    $issues += "❌ Cannot reach live portal"
}

# Summary
Write-Host "`n════════════════════════════════════════════════════════"
if ($issues.Count -eq 0) {
    Write-Host "✅ ALL SYSTEMS HEALTHY!" -ForegroundColor Green
} else {
    Write-Host "⚠️  ISSUES FOUND:" -ForegroundColor Yellow
    $issues | ForEach-Object { Write-Host "  $_" }
    if (-not $Fix) {
        Write-Host "`nRun with -Fix flag to auto-fix issues:" -ForegroundColor Cyan
        Write-Host "  .\validate-system.ps1 -Fix" -ForegroundColor Cyan
    }
}
Write-Host "════════════════════════════════════════════════════════`n"

if ($issues.Count -gt 0) {
    exit 1
} else {
    exit 0
}
