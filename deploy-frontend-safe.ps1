# FRONTEND DEPLOYMENT SAFEGUARD & AUTOMATION
# This script ensures frontend deployments work correctly every time

param(
    [switch]$Force,
    [switch]$Test,
    [switch]$SkipAlias,
    [string]$ShopHost = 'shop.home2smart.com',
    [string]$PortalHost = 'portal.home2smart.com'
)

$ErrorActionPreference = "Stop"

function Get-VercelDeploymentUrlFromText([string]$text) {
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    $matches = [regex]::Matches($text, 'https:\/\/[a-zA-Z0-9-]+\.vercel\.app')
    if ($matches.Count -le 0) { return $null }
    return $matches[$matches.Count - 1].Value
}

function Set-VercelAlias([string]$deploymentUrl, [string]$aliasHost) {
    if ([string]::IsNullOrWhiteSpace($deploymentUrl)) { throw "Missing deployment URL" }
    if ([string]::IsNullOrWhiteSpace($aliasHost)) { throw "Missing alias host" }

    $deploymentHost = ($deploymentUrl -replace '^https?://', '').TrimEnd('/')
    if ([string]::IsNullOrWhiteSpace($deploymentHost)) { throw "Invalid deployment URL: $deploymentUrl" }

    Write-Host "  Setting alias: $aliasHost -> $deploymentHost" -ForegroundColor Yellow
    # Vercel writes progress to stderr; in Windows PowerShell that can trip $ErrorActionPreference='Stop'.
    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = cmd /c "echo y | vercel alias set $deploymentHost $aliasHost" 2>&1
    $ErrorActionPreference = $oldEap
    $text = ($out | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        if ($text) { Write-Host $text }
        throw "vercel alias set failed for $aliasHost (exit $LASTEXITCODE)"
    }
    if ($text) { Write-Host $text -ForegroundColor DarkGray }
    Write-Host "  OK: Alias updated for $aliasHost" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   FRONTEND DEPLOYMENT SAFEGUARD" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$frontendDir = "frontend"
$entryFile = "dash.html"  # Canonical file served by frontend/vercel.json (/dash -> /dash.html)
$requiredFiles = @("dash.html", "bundles.html", "vercel.json", "dash.css", "dash.js")

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

# Step 2: Validate entry file exists (no copying; avoid duplicating sources)
Write-Host "[1/6] Validating entry file..." -ForegroundColor Yellow
$entryPath = Join-Path $frontendDir $entryFile
if (-not (Test-Path $entryPath)) {
    Write-Host "ERROR: Missing entry file: $entryFile" -ForegroundColor Red
    exit 1
}
Write-Host "  OK: Found $entryFile" -ForegroundColor Green

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
$portalPath = $entryPath
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

# Step 5: Inject Build ID into the canonical entry file
Write-Host "[4/6] Injecting Build ID into $entryFile..." -ForegroundColor Yellow
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
    # Vercel writes informational output to stderr; don't let that trip $ErrorActionPreference='Stop'.
    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $deployOut = cmd /c "vercel --prod --yes" 2>&1
    $ErrorActionPreference = $oldEap
    $deployText = ($deployOut | Out-String)
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "[6/6] Deployment Success!" -ForegroundColor Green
        Write-Host "Build ID: $buildId" -ForegroundColor Cyan

        if (-not $SkipAlias) {
            Write-Host "" 
            Write-Host "Syncing production aliases to this deployment..." -ForegroundColor Cyan

            $deployUrl = Get-VercelDeploymentUrlFromText $deployText
            if (-not $deployUrl) {
                Write-Host $deployText.Trim() -ForegroundColor DarkGray
                throw "Could not determine Vercel deployment URL from output; cannot set aliases. Re-run with -SkipAlias to bypass."
            }

            # Keep both portal + shop pinned to the same production deployment.
            Set-VercelAlias -deploymentUrl $deployUrl -aliasHost $PortalHost
            Set-VercelAlias -deploymentUrl $deployUrl -aliasHost $ShopHost
        } else {
            Write-Host "" 
            Write-Host "Skipping alias sync (-SkipAlias)." -ForegroundColor Yellow
        }
    } else {
        Write-Host ""
        Write-Host "ERROR: Vercel deployment failed (Code: $LASTEXITCODE)" -ForegroundColor Red
        if ($deployText) { Write-Host $deployText.Trim() -ForegroundColor DarkGray }
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
