# Check Vercel deployment logs for error messages
# This will show the enhanced error logging we added

Write-Host "`n╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  VERCEL LOGS - Job Creation Errors                            ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

Write-Host "`nFetching recent logs from Vercel..." -ForegroundColor Yellow
Write-Host "(Looking for [Checkout] error messages)`n" -ForegroundColor Gray

Set-Location backend

# Get logs from production
$logs = vercel logs h2s-backend.vercel.app --since 30m 2>&1

# Filter for our checkout logging
$checkoutLogs = $logs | Select-String -Pattern "\[Checkout\]" -Context 0,2

if ($checkoutLogs) {
    Write-Host "═══ CHECKOUT LOGS (Last 30 minutes) ═══`n" -ForegroundColor Cyan
    $checkoutLogs | ForEach-Object {
        $line = $_.ToString()
        if ($line -match "❌") {
            Write-Host $line -ForegroundColor Red
        } elseif ($line -match "✅") {
            Write-Host $line -ForegroundColor Green
        } elseif ($line -match "Starting|Creating|Dispatch") {
            Write-Host $line -ForegroundColor Yellow
        } else {
            Write-Host $line -ForegroundColor Gray
        }
    }
} else {
    Write-Host "No [Checkout] logs found in last 30 minutes" -ForegroundColor Yellow
    Write-Host "This means no orders were created yet" -ForegroundColor Gray
}

Write-Host "`n═══════════════════════════════════════════════════════════════`n" -ForegroundColor Cyan

Set-Location ..
