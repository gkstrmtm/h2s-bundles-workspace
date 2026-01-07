# PORTAL DEPLOYMENT VALIDATION
# This script ensures portal.html has matching version banner and backend URL

Write-Host "`n=== PORTAL DEPLOYMENT VALIDATION ===" -ForegroundColor Cyan

$portalFile = "frontend/portal.html"
$content = Get-Content $portalFile -Raw

# Extract version from banner
if ($content -match "PORTAL VERSION: ([^']+)'") {
    $version = $matches[1]
    Write-Host "Version Banner: $version" -ForegroundColor Yellow
} else {
    Write-Host "ERROR: No version banner found!" -ForegroundColor Red
    exit 1
}

# Extract backend URL from banner
if ($content -match "Backend API: ([^']+)'") {
    $bannerBackend = $matches[1]
    Write-Host "Banner Backend: $bannerBackend" -ForegroundColor Yellow
} else {
    Write-Host "ERROR: No backend URL in banner!" -ForegroundColor Red
    exit 1
}

# Extract actual VERCEL_API value
if ($content -match 'const VERCEL_API = "([^"]+)"') {
    $actualBackend = $matches[1]
    Write-Host "Actual Backend: $actualBackend" -ForegroundColor Yellow
} else {
    Write-Host "ERROR: No VERCEL_API constant found!" -ForegroundColor Red
    exit 1
}

# Validate they match (banner shows truncated version, strip https://)
$actualBackendShort = $actualBackend -replace 'https://', '' -replace '-tabari-ropers-projects.*?.vercel.app', '-tabari-ropers-projects...vercel.app'
$bannerBackendClean = $bannerBackend -replace '\.\.\./api', '-tabari-ropers-projects...vercel.app/api'

if ($actualBackendShort -like "*$($bannerBackendClean.Split('.')[0])*") {
    Write-Host "✅ PASS: Backend URLs match" -ForegroundColor Green
} else {
    Write-Host "❌ FAIL: Backend URLs DO NOT MATCH!" -ForegroundColor Red
    Write-Host "  Banner shows: $bannerBackend" -ForegroundColor Red
    Write-Host "  Code uses: $actualBackend" -ForegroundColor Red
    Write-Host "  Normalized banner: $bannerBackendClean" -ForegroundColor Yellow
    Write-Host "  Normalized code: $actualBackendShort" -ForegroundColor Yellow
    exit 1
}

# Validate version timestamp is recent (within last 24 hours)
if ($version -match '(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})') {
    $year = [int]$matches[1]
    $month = [int]$matches[2]
    $day = [int]$matches[3]
    $hour = [int]$matches[4]
    $minute = [int]$matches[5]
    $second = [int]$matches[6]
    
    $versionDate = Get-Date -Year $year -Month $month -Day $day -Hour $hour -Minute $minute -Second $second
    $hoursSince = (Get-Date) - $versionDate
    
    if ($hoursSince.TotalHours -gt 24) {
        Write-Host "WARNING: Version timestamp is $([int]$hoursSince.TotalHours) hours old" -ForegroundColor Yellow
        Write-Host "  Consider updating to current timestamp before deploying" -ForegroundColor Yellow
    } else {
        Write-Host "PASS: Version timestamp is recent" -ForegroundColor Green
    }
}

Write-Host "`n=== VALIDATION COMPLETE ===" -ForegroundColor Green
Write-Host "Portal is ready to deploy`n" -ForegroundColor Green
