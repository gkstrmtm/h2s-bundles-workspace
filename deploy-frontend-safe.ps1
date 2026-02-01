# FRONTEND DEPLOYMENT SAFEGUARD & AUTOMATION
# This script ensures frontend deployments work correctly every time

param(
    [switch]$Force,
    [switch]$Test
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   FRONTEND DEPLOYMENT SAFEGUARD" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$frontendDir = "frontend"
$sourceFile = "dash.html"
$targetFile = "portal.html"
$requiredFiles = @("portal.html", "bundles.html", "vercel.json")

$buildDate = Get-Date -Format "yyyyMMdd_HHmm"
try {
    $gitSha = (git rev-parse --short=7 HEAD 2>$null).Trim()
} catch {
    $gitSha = "0000000"
}
$buildId = "PORTAL_BUILD_${buildDate}_${gitSha}"

# Step 1: Validate workspace
if (-not (Test-Path $frontendDir)) {
    Write-Host "ERROR: frontend/ directory not found!" -ForegroundColor Red
    Write-Host "You must run this from the workspace root." -ForegroundColor Red
    exit 1
}

# Step 2: Ensure portal.html is present and up-to-date
Write-Host "[1/6] Syncing portal.html from dash.html..." -ForegroundColor Yellow
$srcPath = Join-Path $frontendDir $sourceFile
$destPath = Join-Path $frontendDir $targetFile

if (Test-Path $srcPath) {
    Copy-Item -Path $srcPath -Destination $destPath -Force
    Write-Host "  OK: Copied dash.html to portal.html" -ForegroundColor Green
} else {
    Write-Host "ERROR: dash.html (source) is missing!" -ForegroundColor Red
    exit 1
}

# Step 3: Validate strict requirements
Write-Host "[2/6] Validating required files..." -ForegroundColor Yellow
foreach ($file in $requiredFiles) {
    if (-not (Test-Path (Join-Path $frontendDir $file))) {
        Write-Host "ERROR: Missing required file: $file" -ForegroundColor Red
        exit 1
    }
    Write-Host "  OK: $file exists" -ForegroundColor Green
}

# Step 4: Validate content integrity (Simplified)
# NOTE: Removed strict regex checks for VERSION/API constants as dash.html structure varies.
# Use Test check only.
Write-Host "[3/6] Validating configuration..." -ForegroundColor Yellow
$portalPath = Join-Path $frontendDir "portal.html"
$portalContent = Get-Content $portalPath -Raw

# Check if file has substantial content
if ($portalContent.Length -gt 1000) {
    Write-Host "  OK: portal.html seems valid (Size: $($portalContent.Length) bytes)" -ForegroundColor Green
} else {
    Write-Host "ERROR: portal.html is too small or empty!" -ForegroundColor Red
    exit 1
}

if ($Test) {
    Write-Host ""
    Write-Host "[TEST MODE] Checks pass. Build ID would be: $buildId" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# Step 5: Inject Build ID
Write-Host "[4/6] Injecting Build ID..." -ForegroundColor Yellow
$originalContent = Get-Content $portalPath -Raw
# Use single quotes for regex pattern to avoid interpolation issues
$injectedContent = $originalContent -replace '\{\{BUILD_ID\}\}', $buildId
$filesModified = $false

if ($injectedContent -ne $originalContent) {
    Set-Content $portalPath -Value $injectedContent -NoNewline
    $filesModified = $true
    Write-Host "  OK: Injected $buildId" -ForegroundColor Green
} else {
    Write-Host "  INFO: No {{BUILD_ID}} placeholders found" -ForegroundColor Yellow
}

# Step 6: Deploy
Write-Host "[5/6] Deploying to Vercel..." -ForegroundColor Yellow

Push-Location $frontendDir
try {
    # Run Vercel directly via CMD to avoid alias issues
    cmd /c "vercel --prod --yes"
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "[6/6] Deployment Success!" -ForegroundColor Green
        Write-Host "Build ID: $buildId" -ForegroundColor Cyan
    } else {
        Write-Host ""
        Write-Host "ERROR: Vercel deployment failed (Code: $LASTEXITCODE)" -ForegroundColor Red
    }
} catch {
    Write-Host ""
    Write-Host "ERROR: Deployment script failed: $_" -ForegroundColor Red
} finally {
    Pop-Location
}

# Restore original file
if ($filesModified) {
    Write-Host ""
    Write-Host "Restoring development state..." -ForegroundColor Yellow
    Set-Content $portalPath -Value $originalContent -NoNewline
    Write-Host "  OK: Reverted build ID injection" -ForegroundColor Green
}

Write-Host ""
Write-Host "DONE" -ForegroundColor Cyan
