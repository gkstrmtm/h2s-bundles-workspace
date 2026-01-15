# FRONTEND DEPLOYMENT SAFEGUARD & AUTOMATION
# This script ensures frontend deployments work correctly every time

param(
    [switch]$Force,
    [switch]$Test
)

$ErrorActionPreference = "Stop"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   FRONTEND DEPLOYMENT SAFEGUARD" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Generate Build ID
$buildDate = Get-Date -Format "yyyyMMdd_HHmm"
$gitSha = (git rev-parse --short=7 HEAD 2>$null).Trim()
if ([string]::IsNullOrEmpty($gitSha)) {
    $gitSha = "0000000"
    Write-Host "WARNING: Could not get git SHA, using placeholder" -ForegroundColor Yellow
}
$buildId = "PORTAL_BUILD_${buildDate}_${gitSha}"

Write-Host "Build ID: " -NoNewline -ForegroundColor Yellow
Write-Host $buildId -ForegroundColor Green
Write-Host ""

# Configuration
$frontendDir = "frontend"
$requiredFiles = @("portal.html", "bundles.html", "vercel.json")
$workingDeployment = "h2s-bundles-frontend-ocfo1pksa-tabari-ropers-projects-6f2e090b.vercel.app"
$portalDomain = "portal.home2smart.com"
$shopDomain = "shop.home2smart.com"

# Step 1: Validate we're in the right directory
Write-Host "[1/7] Validating workspace structure..." -ForegroundColor Yellow
if (!(Test-Path $frontendDir)) {
    Write-Host "ERROR: frontend/ directory not found!" -ForegroundColor Red
    Write-Host "You must run this from: c:\Users\tabar\h2s-bundles-workspace" -ForegroundColor Red
    exit 1
}

# Step 2: Validate all required files exist
Write-Host "[2/7] Checking required files..." -ForegroundColor Yellow
foreach ($file in $requiredFiles) {
    $path = Join-Path $frontendDir $file
    if (!(Test-Path $path)) {
        Write-Host "ERROR: Missing required file: $file" -ForegroundColor Red
        exit 1
    }
    Write-Host "  ✓ $file exists" -ForegroundColor Green
}

# Step 3: Validate portal.html has correct backend URL and version
Write-Host "[3/7] Validating portal.html configuration..." -ForegroundColor Yellow
$portalContent = Get-Content "$frontendDir/portal.html" -Raw

if ($portalContent -match 'PORTAL VERSION: ([^'']+)') {
    $version = $matches[1]
    Write-Host "  ✓ Version: $version" -ForegroundColor Green
} else {
    Write-Host "ERROR: No version banner found in portal.html!" -ForegroundColor Red
    exit 1
}

if ($portalContent -match 'const VERCEL_API = "([^"]+)"') {
    $backendUrl = $matches[1]
    Write-Host "  ✓ Backend URL: $backendUrl" -ForegroundColor Green
} else {
    Write-Host "ERROR: No VERCEL_API found in portal.html!" -ForegroundColor Red
    exit 1
}

# Step 4: Check vercel.json has domain routing
Write-Host "[4/7] Validating vercel.json routing..." -ForegroundColor Yellow
$vercelConfig = Get-Content "$frontendDir/vercel.json" -Raw
if ($vercelConfig -match 'portal\.home2smart\.com' -and $vercelConfig -match 'shop\.home2smart\.com') {
    Write-Host "  ✓ Domain-based routing configured" -ForegroundColor Green
} else {
    Write-Host "ERROR: vercel.json missing domain routing!" -ForegroundColor Red
    exit 1
}

# Step 5: Test working deployment is still accessible
Write-Host "[5/7] Verifying working deployment baseline..." -ForegroundColor Yellow
try {
    $result = Invoke-WebRequest -Uri "https://$workingDeployment/" -UseBasicParsing -TimeoutSec 10
    Write-Host "  ✓ Working deployment accessible (Status: $($result.StatusCode))" -ForegroundColor Green
} catch {
    Write-Host "WARNING: Working deployment not accessible" -ForegroundColor Yellow
}

if ($Test) {
    Write-Host "`n[TEST MODE] Validation complete. Skipping deployment.`n" -ForegroundColor Green
    exit 0
}

# Step 5.5: Inject Build ID
Write-Host "[5.5/7] Injecting build ID into portal.html..." -ForegroundColor Yellow
$portalPath = Join-Path $frontendDir "portal.html"
$originalContent = Get-Content $portalPath -Raw
$injectedContent = $originalContent -replace "\{\{BUILD_ID\}\}", $buildId

if ($injectedContent -ne $originalContent) {
    Set-Content $portalPath -Value $injectedContent -NoNewline
    Write-Host "  ✓ Build ID injected: $buildId" -ForegroundColor Green
    
    # Verify injection
    $verifyContent = Get-Content $portalPath -Raw
    if ($verifyContent -match $buildId) {
        Write-Host "  ✓ Injection verified" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: Injection verification failed!" -ForegroundColor Red
        # Restore original
        Set-Content $portalPath -Value $originalContent -NoNewline
        exit 1
    }
} else {
    Write-Host "  ⚠ No {{BUILD_ID}} placeholders found (already replaced or missing)" -ForegroundColor Yellow
}

# Step 6: Deploy from ROOT with frontend/ as root directory
Write-Host "[6/7] Deploying via Git integration (recommended method)..." -ForegroundColor Yellow
Write-Host "  The h2s-bundles-frontend project MUST be configured with:" -ForegroundColor Yellow
Write-Host "    - Root Directory: frontend" -ForegroundColor Yellow
Write-Host "    - Git Integration: Enabled" -ForegroundColor Yellow
Write-Host "    - Auto-deploy from: main branch" -ForegroundColor Yellow
Write-Host "`n  Deployments should trigger automatically on git push." -ForegroundColor Cyan
Write-Host "  Manual deployment from frontend/ folder creates EMPTY deployments.`n" -ForegroundColor Red

if (!$Force) {
    Write-Host "To verify Git integration is working:" -ForegroundColor Yellow
    Write-Host "  1. Make a small change to frontend/portal.html" -ForegroundColor White
    Write-Host "  2. git add -A; git commit -m 'test'; git push" -ForegroundColor White
    Write-Host "  3. Wait 10 seconds" -ForegroundColor White
    Write-Host "  4. Run: vercel ls h2s-bundles-frontend | Select-Object -First 3" -ForegroundColor White
    Write-Host "  5. New deployment should appear with Age less than 1m`n" -ForegroundColor White
    
    Write-Host "Use -Force to attempt manual deployment (NOT RECOMMENDED)`n" -ForegroundColor Yellow
    exit 0
}

# Manual deployment (usually fails - creates empty deployment)
Write-Host "WARNING: Manual deployment often creates empty deployments!" -ForegroundColor Red
Write-Host "Proceeding anyway because -Force was specified...`n" -ForegroundColor Yellow

Push-Location
Set-Location $frontendDir

try {
    Write-Host "Deploying from: $(Get-Location)" -ForegroundColor Yellow
    vercel --prod --yes
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n[7/7] Deployment command completed" -ForegroundColor Green
        Write-Host "IMPORTANT: Verify the deployment actually has files!" -ForegroundColor Yellow
        Write-Host "Run: vercel ls h2s-bundles-frontend | Select-Object -First 3`n" -ForegroundColor White
    } else {
        Write-Host "`nERROR: Deployment failed with exit code $LASTEXITCODE" -ForegroundColor Red
        Pop-Location
        exit 1
    }
} catch {
    Write-Host "`nERROR: Deployment exception: $_" -ForegroundColor Red
    Pop-Location
    exit 1
}

Pop-Location

# Restore original portal.html (remove injected build ID)
if ($originalContent) {
    Write-Host "`nRestoring portal.html to original state..." -ForegroundColor Yellow
    Set-Content (Join-Path $frontendDir "portal.html") -Value $originalContent -NoNewline
    Write-Host "  ✓ Restored {{BUILD_ID}} placeholders" -ForegroundColor Green
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   DEPLOYMENT COMPLETE" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan
Write-Host "Build ID: $buildId" -ForegroundColor Green
Write-Host ""
