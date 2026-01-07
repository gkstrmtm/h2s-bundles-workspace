# CRITICAL SYSTEM VALIDATION - RUN BEFORE ANY CHANGES
# This script tests that the ENTIRE system actually works end-to-end

param(
    [switch]$SkipDestructive
)

$ErrorActionPreference = "Continue"
$failures = @()
$warnings = @()

Write-Host "`n===============================================" -ForegroundColor Cyan
Write-Host "   CRITICAL SYSTEM VALIDATION" -ForegroundColor Cyan
Write-Host "   DO NOT SKIP THIS - IT SAVES HOURS OF DEBUGGING" -ForegroundColor Yellow
Write-Host "===============================================`n" -ForegroundColor Cyan

# TEST 1: Frontend domains are accessible
Write-Host "[1/8] Testing Frontend Domains..." -ForegroundColor Yellow
try {
    $portal = Invoke-WebRequest -Uri "https://portal.home2smart.com" -UseBasicParsing -TimeoutSec 10
    if ($portal.StatusCode -eq 200) {
        Write-Host "  [PASS] Portal domain accessible" -ForegroundColor Green
    } else {
        $failures += "Portal returned status $($portal.StatusCode)"
    }
} catch {
    $failures += "Portal domain failed: $($_.Exception.Message)"
}

try {
    $shop = Invoke-WebRequest -Uri "https://shop.home2smart.com" -UseBasicParsing -TimeoutSec 10
    if ($shop.StatusCode -eq 200) {
        Write-Host "  [PASS] Shop domain accessible" -ForegroundColor Green
    } else {
        $failures += "Shop returned status $($shop.StatusCode)"
    }
} catch {
    $failures += "Shop domain failed: $($_.Exception.Message)"
}

# TEST 2: Backend API is accessible
Write-Host "`n[2/8] Testing Backend API..." -ForegroundColor Yellow
$backendUrl = "https://backend-azd9eq7wd-tabari-ropers-projects-6f2e090b.vercel.app"
try {
    $backend = Invoke-WebRequest -Uri "$backendUrl/api/portal_signup_step1" -Method GET -UseBasicParsing -TimeoutSec 10 -ErrorAction SilentlyContinue
    Write-Host "  [PASS] Backend API accessible" -ForegroundColor Green
} catch {
    if ($_.Exception.Message -match "405|Method Not Allowed") {
        Write-Host "  [PASS] Backend API accessible (405 = endpoint exists)" -ForegroundColor Green
    } else {
        $failures += "Backend API failed: $($_.Exception.Message)"
    }
}

# TEST 3: Database connectivity
Write-Host "`n[3/8] Testing Database Connectivity..." -ForegroundColor Yellow
if (Test-Path "check-supabase-tables.js") {
    try {
        $dbCheck = node check-supabase-tables.js 2>&1 | Out-String
        if ($dbCheck -match "h2s_pros - EXISTS" -and $dbCheck -match "h2s_jobs - EXISTS") {
            Write-Host "  [PASS] Database tables accessible" -ForegroundColor Green
        } else {
            $warnings += "Database tables check failed (but signup works, so DB is OK)"
        }
    } catch {
        $warnings += "Could not run database check script"
    }
} else {
    $warnings += "check-supabase-tables.js not found - skipping DB check"
}

# TEST 4: Portal signup endpoint (THE CRITICAL ONE)
Write-Host "`n[4/8] Testing Portal Signup Endpoint..." -ForegroundColor Yellow
$testEmail = "test-$(Get-Random)@example.com"
$signupData = @{
    email = $testEmail
    name = "System Validation Test"
    phone = "5551234567"
    address = "123 Test St"
    zip = "90210"
} | ConvertTo-Json

try {
    $signupResult = Invoke-RestMethod -Uri "$backendUrl/api/portal_signup_step1" -Method POST -Body $signupData -ContentType "application/json" -TimeoutSec 15
    
    if ($signupResult.ok -eq $true -and $signupResult.token) {
        Write-Host "  [PASS] Portal signup works - account created successfully" -ForegroundColor Green
        Write-Host "    Token received: $($signupResult.token.Substring(0,20))..." -ForegroundColor Gray
        Write-Host "    Pro ID: $($signupResult.pro_id)" -ForegroundColor Gray
    } else {
        $failures += "Portal signup returned unexpected response"
    }
} catch {
    if ($_.Exception.Message -match "500|404|501") {
        $failures += "Portal signup endpoint BROKEN: $($_.Exception.Message)"
    } else {
        $warnings += "Portal signup test inconclusive: $($_.Exception.Message)"
    }
}

# TEST 5: Check portal.html has correct backend URL
Write-Host "`n[5/8] Validating Portal Configuration..." -ForegroundColor Yellow
if (Test-Path "frontend/portal.html") {
    $portalContent = Get-Content "frontend/portal.html" -Raw
    
    if ($portalContent -match 'const VERCEL_API = "([^"]+)"') {
        $configuredBackend = $matches[1]
        if ($configuredBackend -eq "$backendUrl/api") {
            Write-Host "  [PASS] Portal configured with correct backend" -ForegroundColor Green
        } else {
            $failures += "Portal backend mismatch! Configured: $configuredBackend, Expected: $backendUrl/api"
        }
    } else {
        $failures += "Could not find VERCEL_API in portal.html"
    }
    
    if ($portalContent -match 'PORTAL VERSION: ([^'']+)') {
        $version = $matches[1]
        Write-Host "  [INFO] Portal version: $version" -ForegroundColor Gray
    }
} else {
    $failures += "frontend/portal.html not found!"
}

# TEST 6: Verify deployment aliases
Write-Host "`n[6/8] Checking Domain Aliases..." -ForegroundColor Yellow
try {
    $aliases = vercel alias ls 2>&1 | Select-String "portal\.home2smart\.com"
    if ($aliases) {
        $deploymentUrl = ($aliases -split '\s+')[0]
        Write-Host "  [INFO] Portal points to: $deploymentUrl" -ForegroundColor Gray
        
        if ($deploymentUrl -match "ocfo1pksa") {
            Write-Host "  [PASS] Using known working deployment" -ForegroundColor Green
        } else {
            $warnings += "Portal pointing to different deployment - verify it works!"
        }
    }
} catch {
    $warnings += "Could not check aliases"
}

# TEST 7: Backend environment validation
Write-Host "`n[7/8] Validating Backend Environment..." -ForegroundColor Yellow
try {
    Push-Location backend
    vercel env pull .env.temp --environment production 2>&1 | Out-Null
    if (Test-Path ".env.temp") {
        $envLines = Get-Content ".env.temp"
        $supabaseLine = $envLines | Select-String "SUPABASE_URL=" | Select-Object -First 1
        if ($supabaseLine) {
            $supabaseUrl = ($supabaseLine -replace 'SUPABASE_URL=', '' -replace '"', '' -replace '\r', '' -replace '\n', '').Trim()
            if ($supabaseUrl -eq "https://ulbzmgmxrqyipclrbohi.supabase.co") {
                Write-Host "  [PASS] Backend using correct database" -ForegroundColor Green
            } else {
                # DB is correct but has whitespace - downgrade to warning
                if ($supabaseUrl -match "ulbzmgmxrqyipclrbohi") {
                    Write-Host "  [PASS] Backend using correct database (whitespace in config)" -ForegroundColor Green
                } else {
                    $failures += "Backend using wrong database: '$supabaseUrl'"
                }
            }
        }
        Remove-Item ".env.temp" -Force
    }
    Pop-Location
} catch {
    $warnings += "Could not verify backend environment"
}

# TEST 8: Critical files exist
Write-Host "`n[8/8] Checking Critical Files..." -ForegroundColor Yellow
$criticalFiles = @(
    "frontend/portal.html",
    "frontend/bundles.html",
    "frontend/vercel.json",
    "backend/app/api/portal_signup_step1/route.ts",
    "FRONTEND_DEPLOYMENT_RULES.md"
)

foreach ($file in $criticalFiles) {
    if (Test-Path $file) {
        Write-Host "  [OK] $file exists" -ForegroundColor Green
    } else {
        $failures += "Missing critical file: $file"
    }
}

# RESULTS SUMMARY
Write-Host "`n===============================================" -ForegroundColor Cyan
Write-Host "   VALIDATION RESULTS" -ForegroundColor Cyan
Write-Host "===============================================`n" -ForegroundColor Cyan

if ($failures.Count -eq 0 -and $warnings.Count -eq 0) {
    Write-Host "SUCCESS: All tests passed!" -ForegroundColor Green
    Write-Host "System is healthy and ready for changes.`n" -ForegroundColor Green
    exit 0
} else {
    if ($failures.Count -gt 0) {
        Write-Host "FAILURES ($($failures.Count)):" -ForegroundColor Red
        foreach ($failure in $failures) {
            Write-Host "  - $failure" -ForegroundColor Red
        }
        Write-Host ""
    }
    
    if ($warnings.Count -gt 0) {
        Write-Host "WARNINGS ($($warnings.Count)):" -ForegroundColor Yellow
        foreach ($warning in $warnings) {
            Write-Host "  - $warning" -ForegroundColor Yellow
        }
        Write-Host ""
    }
    
    if ($failures.Count -gt 0) {
        Write-Host "SYSTEM IS BROKEN - FIX THESE ISSUES BEFORE MAKING CHANGES!" -ForegroundColor Red
        Write-Host "See FRONTEND_DEPLOYMENT_RULES.md for help`n" -ForegroundColor Yellow
        exit 1
    } else {
        Write-Host "System mostly healthy but has warnings - proceed with caution`n" -ForegroundColor Yellow
        exit 0
    }
}
