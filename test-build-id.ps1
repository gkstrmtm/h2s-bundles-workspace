# Test Build ID Generation
$ErrorActionPreference = "Stop"

Write-Host "`n========= BUILD ID TEST =========`n"  -ForegroundColor Cyan

# Generate Build ID
$buildDate = Get-Date -Format "yyyyMMdd_HHmm"
$gitSha = (git rev-parse --short=7 HEAD 2>$null).Trim()
if ([string]::IsNullOrEmpty($gitSha)) {
    $gitSha = "0000000"
}
$buildId = "PORTAL_BUILD_${buildDate}_${gitSha}"

Write-Host "Build ID: $buildId" -ForegroundColor Green

# Test injection
$portalPath = "frontend\portal.html"
if (Test-Path $portalPath) {
    $content = Get-Content $portalPath -Raw
    
    # Check for placeholders
    if ($content -match '\{\{BUILD_ID\}\}') {
        Write-Host "✓ Found {{BUILD_ID}} placeholders" -ForegroundColor Green
        
        # Test replacement
        $injected = $content -replace '\{\{BUILD_ID\}\}', $buildId
        
        # Verify replacement worked
        if ($injected -match $buildId) {
            Write-Host "✓ Injection would work correctly" -ForegroundColor Green
            Write-Host "`nSample injected content:"
            $injected | Select-String $buildId -Context 0,1 | Select-Object -First 2
        }
    } else {
        Write-Host "⚠ No {{BUILD_ID}} placeholders found" -ForegroundColor Yellow
    }
} else {
    Write-Host "✗ File not found: $portalPath" -ForegroundColor Red
}

Write-Host "`n========= TEST COMPLETE =========`n" -ForegroundColor Cyan
