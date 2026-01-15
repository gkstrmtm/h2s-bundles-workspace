# DAILY HEALTH CHECK FOR CHECKOUT SYSTEM
# Monitors production system health and alerts on issues

$ErrorActionPreference = "Continue"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   CHECKOUT SYSTEM HEALTH CHECK" -ForegroundColor Cyan
Write-Host "   $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host "========================================`n" -ForegroundColor Cyan

$issues = @()
$warnings = @()

# ============================================
# CHECK 1: Frontend Availability
# ============================================

Write-Host "[1/5] Checking frontend..." -ForegroundColor Yellow

try {
    $response = Invoke-WebRequest -Uri "https://shop.home2smart.com/bundles.js" -UseBasicParsing -TimeoutSec 10
    
    if ($response.StatusCode -eq 200) {
        if ($response.Content -match "window\.checkout") {
            Write-Host "  ✓ Frontend is UP and has checkout function" -ForegroundColor Green
        } else {
            Write-Host "  ⚠ Frontend is UP but checkout function MISSING!" -ForegroundColor Red
            $issues += "Frontend missing checkout function"
        }
    } else {
        Write-Host "  ✗ Frontend returned status: $($response.StatusCode)" -ForegroundColor Red
        $issues += "Frontend returned non-200 status"
    }
} catch {
    Write-Host "  ✗ Frontend UNREACHABLE: $($_.Exception.Message)" -ForegroundColor Red
    $issues += "Frontend unreachable"
}

# ============================================
# CHECK 2: Backend API Availability
# ============================================

Write-Host "`n[2/5] Checking backend API..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop?action=catalog" -TimeoutSec 10
    
    if ($response.ok -and $response.bundles) {
        Write-Host "  ✓ Backend API is UP and returning catalog" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ Backend API responding but data invalid" -ForegroundColor Red
        $issues += "Backend API data invalid"
    }
} catch {
    Write-Host "  ✗ Backend API UNREACHABLE: $($_.Exception.Message)" -ForegroundColor Red
    $issues += "Backend API unreachable"
}

# ============================================
# CHECK 3: Critical Code Integrity
# ============================================

Write-Host "`n[3/5] Checking code integrity..." -ForegroundColor Yellow

# Check frontend API endpoint
$frontendJs = Invoke-WebRequest -Uri "https://shop.home2smart.com/bundles.js" -UseBasicParsing
if ($frontendJs.Content -match "https://h2s-backend\.vercel\.app/api/shop") {
    Write-Host "  ✓ Frontend API endpoint is correct" -ForegroundColor Green
} else {
    Write-Host "  ✗ Frontend API endpoint CHANGED!" -ForegroundColor Red
    $issues += "Frontend API endpoint incorrect"
}

# Check success URL format
if ($frontendJs.Content -match "shop\.home2smart\.com/bundles\?view=shopsuccess") {
    Write-Host "  ✓ Success URL format is correct" -ForegroundColor Green
} else {
    Write-Host "  ✗ Success URL format CHANGED!" -ForegroundColor Red
    $issues += "Success URL format incorrect"
}

# ============================================
# CHECK 4: Deployment Status
# ============================================

Write-Host "`n[4/5] Checking deployment status..." -ForegroundColor Yellow

try {
    # Check if local files differ from deployed
    $localExists = Test-Path "frontend/bundles.js"
    if ($localExists) {
        $gitStatus = git status frontend/ --porcelain 2>$null
        if ($gitStatus) {
            Write-Host "  ⚠ Uncommitted changes detected in frontend/" -ForegroundColor Yellow
            $warnings += "Uncommitted frontend changes"
        } else {
            Write-Host "  ✓ No uncommitted changes" -ForegroundColor Green
        }
    } else {
        Write-Host "  ⚠ Cannot check git status (not in repo root)" -ForegroundColor Gray
    }
} catch {
    Write-Host "  ⚠ Git check skipped (not a git repo)" -ForegroundColor Gray
}

# ============================================
# CHECK 5: Recent Orders Check
# ============================================

Write-Host "`n[5/5] Recent activity check..." -ForegroundColor Yellow
Write-Host "  ℹ Automated database checks require Supabase credentials" -ForegroundColor Cyan
Write-Host "  → Manual check recommended:" -ForegroundColor Gray
Write-Host "    - Check h2s_orders table for recent orders" -ForegroundColor Gray
Write-Host "    - Verify h2s_dispatch_jobs exist for those orders" -ForegroundColor Gray
Write-Host "    - Check for abandoned 'pending_payment' jobs (should be minimal)" -ForegroundColor Gray

# ============================================
# SUMMARY & ALERTS
# ============================================

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   HEALTH CHECK RESULTS" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

if ($issues.Count -eq 0 -and $warnings.Count -eq 0) {
    Write-Host "✅ ALL CHECKS PASSED - System is healthy`n" -ForegroundColor Green
    exit 0
} else {
    if ($issues.Count -gt 0) {
        Write-Host "❌ CRITICAL ISSUES FOUND:`n" -ForegroundColor Red
        foreach ($issue in $issues) {
            Write-Host "  • $issue" -ForegroundColor Red
        }
        Write-Host ""
    }
    
    if ($warnings.Count -gt 0) {
        Write-Host "⚠ WARNINGS:`n" -ForegroundColor Yellow
        foreach ($warning in $warnings) {
            Write-Host "  • $warning" -ForegroundColor Yellow
        }
        Write-Host ""
    }
    
    Write-Host "🔧 Recommended Actions:" -ForegroundColor Cyan
    Write-Host "  1. Review issues above" -ForegroundColor White
    Write-Host "  2. Check recent deployments" -ForegroundColor White
    Write-Host "  3. Verify CHECKOUT_GUARDRAILS.md" -ForegroundColor White
    Write-Host "  4. Run VALIDATE-CHECKOUT-SYSTEM.ps1" -ForegroundColor White
    Write-Host ""
    
    exit 1
}
