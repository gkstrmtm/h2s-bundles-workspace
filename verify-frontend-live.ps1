# FRONTEND VERIFICATION SCRIPT
# Tests that portal.home2smart.com and shop.home2smart.com are working

param(
    [switch]$Detailed
)

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   FRONTEND VERIFICATION CHECK" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

function Test-Url {
    param(
        [string]$Url,
        [string]$Name,
        [string]$ExpectedContent
    )
    
    Write-Host "Testing $Name..." -ForegroundColor Yellow
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
        
        if ($response.StatusCode -eq 200) {
            Write-Host "  [OK] $Name is accessible (200 OK)" -ForegroundColor Green
            
            if ($ExpectedContent -and $response.Content -match $ExpectedContent) {
                Write-Host "  [OK] Content validation passed" -ForegroundColor Green
                return $true
            } elseif ($ExpectedContent) {
                Write-Host "  [FAIL] Expected content not found" -ForegroundColor Red
                return $false
            }
            return $true
        } else {
            Write-Host "  [FAIL] $Name returned status: $($response.StatusCode)" -ForegroundColor Red
            return $false
        }
    } catch {
        Write-Host "  [FAIL] $Name failed: $($_.Exception.Message)" -ForegroundColor Red
        if ($_.Exception.Message -match '404') {
            Write-Host "    → Deployment is empty or domain not configured" -ForegroundColor Yellow
        }
        return $false
    }
}

# Test Portal
$portalOk = Test-Url -Url "https://portal.home2smart.com" -Name "Portal (portal.home2smart.com)" -ExpectedContent "PORTAL VERSION:"

# Test Shop
$shopOk = Test-Url -Url "https://shop.home2smart.com" -Name "Shop (shop.home2smart.com)" -ExpectedContent "Home2Smart"

# Get current deployment info
Write-Host "`nCurrent Deployment Info:" -ForegroundColor Yellow
try {
    $aliases = vercel alias ls 2>$null | Select-String "portal\.home2smart\.com" | Select-Object -First 1
    if ($aliases) {
        $deploymentUrl = ($aliases -split '\s+')[0]
        Write-Host "  Portal points to: $deploymentUrl" -ForegroundColor Cyan
        
        # Test the direct deployment URL
        Write-Host "`nTesting direct deployment URL..." -ForegroundColor Yellow
        try {
            $direct = Invoke-WebRequest -Uri "https://$deploymentUrl/" -UseBasicParsing -TimeoutSec 10 -ErrorAction SilentlyContinue
            if ($direct) {
                Write-Host "  [OK] Direct URL works (Status: $($direct.StatusCode))" -ForegroundColor Green
            }
        } catch {
            Write-Host "  [FAIL] Direct URL fails: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "    → This deployment is EMPTY. Use working deployment:" -ForegroundColor Yellow
            Write-Host "    → h2s-bundles-frontend-ocfo1pksa-tabari-ropers-projects-6f2e090b.vercel.app" -ForegroundColor White
        }
    }
} catch {
    Write-Host "  Could not retrieve deployment info" -ForegroundColor Yellow
}

Write-Host "`n========================================" -ForegroundColor Cyan
if ($portalOk -and $shopOk) {
    Write-Host "   [SUCCESS] ALL CHECKS PASSED" -ForegroundColor Green
} else {
    Write-Host "   [FAILURE] SOME CHECKS FAILED" -ForegroundColor Red
    Write-Host "`nTo fix:" -ForegroundColor Yellow
    Write-Host "  1. Rollback to working deployment:" -ForegroundColor White
    Write-Host "     vercel alias set h2s-bundles-frontend-ocfo1pksa... portal.home2smart.com" -ForegroundColor Cyan
    Write-Host "  2. Or trigger new deployment via git push (recommended)" -ForegroundColor White
}
Write-Host "========================================`n" -ForegroundColor Cyan
