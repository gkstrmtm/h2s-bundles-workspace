# Direct database check - compares orders vs jobs
$backendUrl = "https://h2s-backend.vercel.app"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "ORDER vs JOB COMPARISON CHECK" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Call the diagnostic endpoint which directly queries both tables
Write-Host "`nCalling portal_jobs_diagnostic endpoint..." -ForegroundColor Yellow

try {
    $diagnostic = Invoke-RestMethod -Uri "$backendUrl/api/portal_jobs_diagnostic" -Method GET -TimeoutSec 30
    
    if ($diagnostic.logs) {
        Write-Host "`nDiagnostic Output:" -ForegroundColor Green
        foreach ($log in $diagnostic.logs) {
            Write-Host $log
        }
    }
    
    if ($diagnostic.summary) {
        Write-Host "`n========================================" -ForegroundColor Cyan
        Write-Host "SUMMARY" -ForegroundColor Cyan
        Write-Host "========================================" -ForegroundColor Cyan
        Write-Host $diagnostic.summary
    }
    
} catch {
    Write-Host "`nERROR calling diagnostic:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "`nResponse body:" -ForegroundColor Yellow
        Write-Host $responseBody
    }
}

Write-Host ""
