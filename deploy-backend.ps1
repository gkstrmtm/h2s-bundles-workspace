#!/usr/bin/env pwsh
# Deploy backend to Vercel production

Write-Host "`n=== Deploying Backend to Vercel ===" -ForegroundColor Cyan

$BackendPath = Join-Path $PSScriptRoot "backend"
Push-Location $BackendPath

try {
    Write-Host "`n1. Checking Vercel CLI..." -ForegroundColor Yellow
    $vercelVersion = vercel --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   ERROR: Vercel CLI not found. Install with: npm i -g vercel" -ForegroundColor Red
        exit 1
    }
    Write-Host "   Vercel CLI: $vercelVersion" -ForegroundColor Green

    Write-Host "`n2. Running lint check..." -ForegroundColor Yellow
    npm run lint
    if ($LASTEXITCODE -ne 0) {
        Write-Host "   ERROR: Lint failed. Fix errors before deploying." -ForegroundColor Red
        exit 1
    }
    Write-Host "   Lint passed" -ForegroundColor Green

    Write-Host "`n3. Deploying to production..." -ForegroundColor Yellow
    Write-Host "   This will take 1-2 minutes..." -ForegroundColor Gray
    # Use cmd.exe to avoid PowerShell's NativeCommandError behavior from the vercel.ps1 shim.
    cmd /c "vercel --prod --yes" 2>&1 | Out-String | Write-Host
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`n=== Deployment SUCCESS ===" -ForegroundColor Green
        Write-Host "Wait 10-20 seconds for propagation, then test the endpoint again." -ForegroundColor Yellow
    } else {
        Write-Host "`n=== Deployment FAILED ===" -ForegroundColor Red
        Write-Host "Check Vercel dashboard for errors." -ForegroundColor Yellow
    }

} finally {
    Pop-Location
}
