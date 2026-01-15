# GUARDRAIL SUITE - RUN ALL VALIDATION CHECKS
# Master script that runs all guardrail checks

Write-Host @"

╔══════════════════════════════════════════════════════════╗
║                                                          ║
║           H2S CHECKOUT GUARDRAIL SUITE                  ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝

"@ -ForegroundColor Cyan

Write-Host "Running all validation checks...`n" -ForegroundColor White

$script:totalTests = 0
$script:totalPassed = 0
$script:totalFailed = 0

function Run-Check {
    param($Name, $ScriptPath)
    
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    Write-Host "Running: $Name" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkGray
    
    $script:totalTests++
    
    try {
        & $ScriptPath
        if ($LASTEXITCODE -eq 0) {
            $script:totalPassed++
            Write-Host "`n✅ $Name PASSED`n" -ForegroundColor Green
            return $true
        } else {
            $script:totalFailed++
            Write-Host "`n❌ $Name FAILED`n" -ForegroundColor Red
            return $false
        }
    } catch {
        $script:totalFailed++
        Write-Host "`n❌ $Name FAILED: $($_.Exception.Message)`n" -ForegroundColor Red
        return $false
    }
}

# Run all checks
$checks = @(
    @{ Name = "Production Health Check"; Script = ".\health-check-production.ps1" },
    @{ Name = "Checkout System Validation"; Script = ".\validate-checkout-system.ps1" }
)

$results = @()
foreach ($check in $checks) {
    if (Test-Path $check.Script) {
        $passed = Run-Check -Name $check.Name -ScriptPath $check.Script
        $results += @{ Name = $check.Name; Passed = $passed }
    } else {
        Write-Host "⚠️  Script not found: $($check.Script)" -ForegroundColor Yellow
        Write-Host ""
    }
}

# Summary
Write-Host @"

╔══════════════════════════════════════════════════════════╗
║                    FINAL SUMMARY                         ║
╚══════════════════════════════════════════════════════════╝

"@ -ForegroundColor Cyan

foreach ($result in $results) {
    if ($result.Passed) {
        Write-Host "  ✅ $($result.Name)" -ForegroundColor Green
    } else {
        Write-Host "  ❌ $($result.Name)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "Total Checks: $script:totalTests" -ForegroundColor White
Write-Host "Passed: $script:totalPassed" -ForegroundColor Green
Write-Host "Failed: $script:totalFailed" -ForegroundColor Red
Write-Host ""

if ($script:totalFailed -eq 0) {
    Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "║   ✅ ALL GUARDRAILS PASSED - SYSTEM IS HEALTHY ✅       ║" -ForegroundColor Green
    Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Green
    exit 0
} else {
    Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Red
    Write-Host "║   ❌ SOME GUARDRAILS FAILED - ACTION REQUIRED ❌        ║" -ForegroundColor Red
    Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Red
    exit 1
}
