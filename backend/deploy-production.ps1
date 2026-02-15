# Complete production deployment script
Write-Host "Starting production deployment..." -ForegroundColor Cyan

$backendDir = $PSScriptRoot
$vercelConfig = Join-Path $backendDir 'vercel.json'

Push-Location $backendDir

# Step 1: Deploy to Vercel
Write-Host "`n[1/3] Deploying to Vercel..." -ForegroundColor Yellow
# Ensure this folder is linked to the correct Vercel project.
cmd /c "vercel link --project h2s-backend --yes 2>&1" | Out-String | Write-Host

# Use cmd.exe to avoid PowerShell's NativeCommandError behavior from the vercel.ps1 shim.
# IMPORTANT: force backend-local config so we don't accidentally pick up the repo-root vercel.json.
$output = cmd /c "vercel --local-config vercel.json --prod --yes 2>&1" | Out-String
Write-Host $output

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Vercel deploy failed (exit code $LASTEXITCODE)" -ForegroundColor Red
    exit 1
}

# Extract deployment URL (prefer the Production: line)
$deployUrl = $null

$prodMatch = ($output | Select-String -Pattern 'Production:\s+(https://[a-z0-9-]+\.vercel\.app)' -AllMatches)
if ($prodMatch -and $prodMatch.Matches.Count -gt 0) {
    $deployUrl = $prodMatch.Matches[$prodMatch.Matches.Count - 1].Groups[1].Value
}

if (-not $deployUrl) {
    $anyMatch = ($output | Select-String -Pattern '(https://[a-z0-9-]+\.vercel\.app)' -AllMatches)
    if ($anyMatch -and $anyMatch.Matches.Count -gt 0) {
        $deployUrl = $anyMatch.Matches[$anyMatch.Matches.Count - 1].Groups[1].Value
    }
}

if (-not $deployUrl) {
    Write-Host "ERROR: Could not extract deployment URL" -ForegroundColor Red
    exit 1
}
Write-Host "Deployed to: $deployUrl" -ForegroundColor Green

# Step 2: Alias to production domains
Write-Host "`n[2/3] Aliasing to production domains..." -ForegroundColor Yellow
cmd /c "vercel alias set $deployUrl h2s-backend.vercel.app 2>&1" | Out-String | Write-Host

# NOTE: portal.home2smart.com is served by the frontend project.
# Do not alias the portal domain to the backend.

# Step 3: Verify deployment
Write-Host "`n[3/3] Verifying deployment..." -ForegroundColor Yellow
Start-Sleep -Seconds 2
$pingUrl = 'https://h2s-backend.vercel.app/api/v1?action=ping&_ts=' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
try {
    $ping = Invoke-RestMethod -Uri $pingUrl -Method GET -Headers @{"Cache-Control"="no-cache"}
    if ($ping -and $ping.ok -eq $true) {
        Write-Host "Backend ping: OK ($($ping.ts))" -ForegroundColor Green
    } else {
        Write-Host "WARNING: Backend ping did not return ok:true" -ForegroundColor Yellow
    }
} catch {
    Write-Host "WARNING: Backend ping failed: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "" -ForegroundColor Green
Write-Host "Deployment complete!" -ForegroundColor Green
Write-Host "URLs:" -ForegroundColor Cyan
Write-Host "  - https://h2s-backend.vercel.app/api/v1?action=ping" -ForegroundColor White
Write-Host "" -ForegroundColor Yellow
Write-Host "Hard refresh (Ctrl+Shift+R) to clear browser cache" -ForegroundColor Yellow

Pop-Location
