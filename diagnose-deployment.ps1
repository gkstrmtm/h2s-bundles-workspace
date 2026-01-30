$ErrorActionPreference = 'Stop'

Write-Host "=== PORTAL DEPLOYMENT ROUTING DIAGNOSTIC ===" -ForegroundColor Cyan

# 1. Download what's actually being served
Write-Host "`n[1] Downloading live portal..." -ForegroundColor Yellow
$livePortal = Invoke-WebRequest -Uri "https://portal.home2smart.com/portal?t=$(Get-Date -UFormat %s)" -UseBasicParsing
$liveContent = $livePortal.Content

# Save it
$liveContent | Out-File "LIVE_portal.html" -Encoding UTF8

# 2. Check for build markers/timestamps
Write-Host "`n[2] Checking for build identifiers..." -ForegroundColor Yellow

# Look for build ID or version comments
$buildMarkers = @(
    'PORTAL_BUILD_ID',
    'BUILD:',
    'Version:',
    'Last modified:',
    'Generated:',
    '2026-01-18',  # Recent date
    '2025-',        # Older dates
    '2024-'         # Very old
)

foreach ($marker in $buildMarkers) {
    if ($liveContent -match $marker) {
        $matches = [regex]::Matches($liveContent, ".{0,100}$marker.{0,100}")
        if ($matches.Count -gt 0) {
            Write-Host "  Found marker: $marker" -ForegroundColor Yellow
            foreach($m in $matches) {
                 Write-Host "    $($m.Value.Trim())" -ForegroundColor Gray
            }
        }
    }
}

# 3. Check for known issues
Write-Host "`n[3] Checking for known issues..." -ForegroundColor Yellow

$issues = @{}

# Issue 1: Placeholder text
if ($liveContent -match 'details pending|Location pending|Address not provided') {
    $issues['placeholder_text'] = $true
    Write-Host "  ❌ Has placeholder text" -ForegroundColor Red
    if ($liveContent -match 'details pending') { Write-Host "     - details pending" -ForegroundColor Red }
    if ($liveContent -match 'Location pending') { Write-Host "     - Location pending" -ForegroundColor Red }
    if ($liveContent -match 'Address not provided') { Write-Host "     - Address not provided" -ForegroundColor Red }
} else {
    Write-Host "  ✅ No placeholder text" -ForegroundColor Green
}

# Issue 2: Account name display
if ($liveContent -match 'profile\.name|techName.*=.*profile') {
    $issues['account_name'] = $false  # Has the fix
    Write-Host "  ✅ Has account name display code" -ForegroundColor Green
} else {
    $issues['account_name'] = $true  # Missing
    Write-Host "  ❌ Missing account name display code" -ForegroundColor Red
}

# Issue 3: UTF-8 charset
if ($liveContent -match '<meta charset="UTF-8">') {
    Write-Host "  ✅ Has UTF-8 charset" -ForegroundColor Green
} else {
    Write-Host "  ❌ Missing UTF-8 charset" -ForegroundColor Yellow
}

# Issue 4: Broken characters (Skipped to avoid encoding errors)
# if ($liveContent -match '\?{3,}|â€™|â€œ') { ... }
Write-Host "  [-] Skipped broken char check to avoid encoding errors" -ForegroundColor Gray

# 4. Compare with local files
Write-Host "`n[4] Comparing with local files..." -ForegroundColor Yellow

$localFiles = @()
if (Test-Path "portal.html") {
    $localFiles += @{
        Path = "portal.html"
        Content = Get-Content "portal.html" -Raw
    }
}

if (Test-Path "frontend/portal.html") {
    $localFiles += @{
        Path = "frontend/portal.html"
        Content = Get-Content "frontend/portal.html" -Raw
    }
}

# Compute Hash of live portal content string (to handle encoding diffs with Get-FileHash)
# We normalize newlines for fair comparison if possible, or just strict string compare.

# Function to get SHA256 of string
function Get-StringHash([string]$String) {
    $StringBuilder = [System.Text.StringBuilder]::new()
    [System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes($String)) | ForEach-Object {
        [void]$StringBuilder.Append($_.ToString("x2"))
    }
    return $StringBuilder.ToString()
}

$liveHash = Get-StringHash $liveContent
Write-Host "  Live portal hash (calc): $liveHash" -ForegroundColor Gray

foreach ($file in $localFiles) {
    $localHash = Get-StringHash $file.Content
    Write-Host "`n  Local file: $($file.Path)" -ForegroundColor Gray
    Write-Host "    Hash: $localHash" -ForegroundColor DarkGray
    
    if ($localHash -eq $liveHash) {
        Write-Host "    ✅ EXACT MATCH - This is what's deployed" -ForegroundColor Green
    } else {
        # Check similarity
        $livePlaceholders = [regex]::Matches($liveContent, 'details pending|Location pending').Count
        $localPlaceholders = [regex]::Matches($file.Content, 'details pending|Location pending').Count
        
        Write-Host "    Counts - Live: $livePlaceholders, Local: $localPlaceholders" -ForegroundColor Gray
        
        if ($livePlaceholders -eq $localPlaceholders) {
            Write-Host "    ⚠️  Similar issues - might be same version but different whitespace/encoding" -ForegroundColor Yellow
        } else {
            Write-Host "    ❌ Different - local is newer/older" -ForegroundColor Red
        }
    }
}

# 5. Check Vercel deployment
Write-Host "`n[5] Checking Vercel deployment info..." -ForegroundColor Yellow

if ($livePortal.Headers['X-Vercel-Id']) {
    Write-Host "  Vercel ID: $($livePortal.Headers['X-Vercel-Id'])" -ForegroundColor Gray
}

if ($livePortal.Headers['X-Vercel-Cache']) {
    Write-Host "  Cache status: $($livePortal.Headers['X-Vercel-Cache'])" -ForegroundColor Gray
}

# 6. Summary
Write-Host "`n=== DIAGNOSIS ===" -ForegroundColor Cyan

if ($issues.Count -gt 0) {
    Write-Host "❌ Live portal has known issues:" -ForegroundColor Red
    if ($issues['placeholder_text']) {
        Write-Host "  - Placeholder text (code not updated)" -ForegroundColor Yellow
    }
    if ($issues['account_name']) {
        Write-Host "  - Account name missing (code not updated)" -ForegroundColor Yellow
    }
    if ($issues['broken_chars']) {
        Write-Host "  - Broken characters (encoding issue)" -ForegroundColor Yellow
    }
    
    Write-Host "`n❌ CONCLUSION: Wrong/old portal.html is being served" -ForegroundColor Red
    Write-Host "   Either:" -ForegroundColor Yellow
    Write-Host "   1. Vercel is serving cached version" -ForegroundColor Yellow
    Write-Host "   2. Wrong file was deployed (frontend/ instead of root)" -ForegroundColor Yellow
    Write-Host "   3. Deployment didn't actually update the file" -ForegroundColor Yellow
    
} else {
    Write-Host "✅ Live portal looks clean" -ForegroundColor Green
    Write-Host "   Issue might be in database data, not code" -ForegroundColor Gray
}

Write-Host "`nLive portal saved to: LIVE_portal.html" -ForegroundColor Cyan
