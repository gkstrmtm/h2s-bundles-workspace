param([string]$Url = "https://portal.home2smart.com/portal")

Write-Host "`n========================================"
Write-Host "   PORTAL BUILD VERIFICATION"
Write-Host "========================================`n"
Write-Host "Checking: $Url`n"

try {
    # Use curl for reliable HTML fetching
    $html = (curl.exe -s -L $Url) -join "`n"
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to fetch URL"
    }
    
    $allMatches = [regex]::Matches($html, 'PORTAL_BUILD_\d{8}_\d{4}_[a-f0-9]{7}')
    
    if ($allMatches.Count -eq 0) {
        Write-Host "No build ID found!" -ForegroundColor Red
        Write-Host "The build ID system may not be deployed yet." -ForegroundColor Yellow
        exit 1
    }
    
    $buildIds = $allMatches | Select-Object -ExpandProperty Value | Select-Object -Unique
    
    if ($buildIds.Count -eq 1 -or ($buildIds -is [string])) {
        $buildId = if ($buildIds -is [string]) { $buildIds } else { $buildIds[0] }
        Write-Host "Build ID found: " -NoNewline -ForegroundColor Green
        Write-Host $buildId -ForegroundColor Cyan
        Write-Host ""
        
        $parts = $buildId -split '_'
        if ($parts.Length -eq 5) {
            $date = $parts[2]
            $time = $parts[3]
            $sha = $parts[4]
            
            $year = $date.Substring(0, 4)
            $month = $date.Substring(4, 2)
            $day = $date.Substring(6, 2)
            $hour = $time.Substring(0, 2)
            $minute = $time.Substring(2, 2)
            
            Write-Host "Deployed: $year-$month-$day at $($hour):$($minute)"
            Write-Host "Commit: $sha"
            Write-Host ""
        }
        
        Write-Host "Found in $($allMatches.Count) location(s)" -ForegroundColor Gray
        Write-Host ""
        
    } else {
        Write-Host "Multiple build IDs found (inconsistent):" -ForegroundColor Yellow
        foreach ($id in $buildIds) {
            Write-Host "  $id" -ForegroundColor Yellow
        }
    }
    
    Write-Host "`n========================================"
    Write-Host "Next steps:"
    Write-Host "1. Open browser to $Url"
    Write-Host "2. Open DevTools console (F12)"
    Write-Host "3. Look for build ID in console"
    Write-Host "4. Check footer (bottom-right corner)"
    Write-Host "5. Compare with server build ID above"
    Write-Host "========================================`n"
    
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
