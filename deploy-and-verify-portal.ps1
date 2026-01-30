$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "" -ForegroundColor Cyan
Write-Host "  PORTAL DEPLOYMENT & VERIFICATION     " -ForegroundColor Cyan
Write-Host "" -ForegroundColor Cyan

# 1. VERIFY LOCAL CODE
Write-Host "`n[1/4] Verifying local code..." -ForegroundColor Yellow
$portalPath = "portal.html"
if (-not (Test-Path $portalPath)) { throw "portal.html not found!" }
$content = Get-Content $portalPath -Raw

if ($content -match " Approved" -or $content -match " Pending") {
    Write-Host " FAILED: Local code still has emojis!" -ForegroundColor Red
    exit 1
}

if ($content -notmatch "You know what I'm worried about") {
    Write-Host " FAILED: Custom placeholder text is missing from local code!" -ForegroundColor Red
    exit 1
}
Write-Host " Local code looks correct (No emojis, has custom placeholder)." -ForegroundColor Green

# 2. DEPLOY
Write-Host "`n[2/4] Deploying to Vercel (Production)..." -ForegroundColor Yellow
# Using cmd /c ensuring we don't have path issues with vercel.cmd
cmd /c vercel --prod --confirm

if ($LASTEXITCODE -ne 0) {
    Write-Host " Deployment failed!" -ForegroundColor Red
    exit 1
}
Write-Host " Deployment command finished." -ForegroundColor Green

# 3. VERIFY LIVE
Write-Host "`n[3/4] Verifying Live Site (Propagation may take time)..." -ForegroundColor Yellow
$url = "https://portal.home2smart.com/portal"

$maxRetries = 10
$retryDelay = 5 # seconds

for ($i = 1; $i -le $maxRetries; $i++) {
    Write-Host "Attempt $i/$maxRetries : Checking $url ..." -NoNewline
    
    try {
        # Cache-busting parameter
        $t = Get-Date -UFormat %s
        $liveContent = (Invoke-WebRequest -Uri "$url?t=$t" -UseBasicParsing).Content

        # Check for emojis including question marks
        $hasEmojis = ($liveContent -match " Approved" -or $liveContent -match " Pending" -or $liveContent -match "\? Pending")
        $hasPlaceholder = ($liveContent -match "You know what I'm worried about")

        if (-not $hasEmojis -and $hasPlaceholder) {
            Write-Host " SUCCESS!" -ForegroundColor Green
            Write-Host "`n VERIFICATION PASSED!" -ForegroundColor Green
            Write-Host "   - Emojis: GONE"
            Write-Host "   - Placeholder: PRESENT"
            exit 0
        } else {
            Write-Host " Waiting..." -ForegroundColor Gray
            if ($hasEmojis) { Write-Host "     [State: Found Emojis (Old Version)]" -ForegroundColor Red }
            if (-not $hasPlaceholder) { Write-Host "     [State: Placeholder Missing]" -ForegroundColor Red }
        }
    } catch {
        Write-Host " Error fetching URL." -ForegroundColor Red
    }
    
    Start-Sleep -Seconds $retryDelay
}

Write-Host "`n VERIFICATION TIMED OUT" -ForegroundColor Red
Write-Host "The deployment may still be propagating, or caching is holding the old version."
Write-Host "Please manually check in Incognito Mode."
exit 1
