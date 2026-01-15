# SYNC WORKSPACE - Single Source of Truth Enforcer
# Run this to ensure all artifacts match the frontend/ source

$ErrorActionPreference = "Stop"

Write-Host "?? SYNCING WORKSPACE FILES..." -ForegroundColor Cyan

# 1. PORTAL
$PortalSource = "frontend/portal.html"
$PortalTargets = @("portal.html", "backend/public/portal.html")

if (Test-Path $PortalSource) {
    $Hash = (Get-FileHash $PortalSource).Hash
    Write-Host "   Source: $PortalSource ($Hash)" -ForegroundColor Gray
    
    foreach ($T in $PortalTargets) {
        Copy-Item $PortalSource $T -Force
        Write-Host "   ? Synced to $T" -ForegroundColor Green
    }
} else {
    Write-Error "CRITICAL: Source file $PortalSource not found!"
}

# 2. BUNDLES
$BundlesSource = "frontend/bundles.html"
$BundlesTargets = @("bundles.html", "backend/public/bundles.html")

if (Test-Path $BundlesSource) {
    foreach ($T in $BundlesTargets) {
        Copy-Item $BundlesSource $T -Force
        Write-Host "   ? Synced to $T" -ForegroundColor Green
    }
}

Write-Host "`n? WORKSPACE UNIFIED. You can now commit." -ForegroundColor Yellow
