# ============================================================================
# MASTER VALIDATION ORCHESTRATOR
# ============================================================================
# Runs ALL validation scripts in proper sequence
# Use this before ANY deployment or major system change
#
# Usage: .\Run-AllValidations.ps1
# ============================================================================

param(
    [switch]$SkipDestructive,
    [switch]$Verbose,
    [string]$AdminToken = $env:H2S_ADMIN_TOKEN,
    [string]$SupabaseUrl = $env:SUPABASE_URL,
    [string]$SupabaseKey = $env:SUPABASE_SERVICE_KEY
)

$ErrorActionPreference = "Continue"

# ============================================================================
# CONFIGURATION
# ============================================================================

$ValidationScripts = @(
    @{
        Name = "System Validation (Frontend/Portal)"
        Script = ".\Validate-System.ps1"
        Required = $true
        Description = "Tests portal domains, backend API, critical files"
    },
    @{
        Name = "Backend Enhancements"
        Script = ".\Test-BackendEnhancements.ps1"
        Required = $false
        RequiresAdminToken = $true
        Description = "Tests race condition protection, priority scoring, photo de-duplication"
    },
    @{
        Name = "Database Integrity"
        Script = ".\Test-DatabaseIntegrity.ps1"
        Required = $false
        RequiresSupabase = $true
        Description = "Tests schema congruence, data integrity, referential integrity"
    }
)

$Global:Results = @()

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

function Write-Section {
    param([string]$Title)
    Write-Host "`n╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║  $($Title.PadRight(60))  ║" -ForegroundColor Cyan
    Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
}

function Test-Prerequisites {
    param($ValidationSpec)
    
    $canRun = $true
    $missingRequirements = @()
    
    # Check if script file exists
    if (!(Test-Path $ValidationSpec.Script)) {
        $canRun = $false
        $missingRequirements += "Script not found: $($ValidationSpec.Script)"
    }
    
    # Check admin token requirement
    if ($ValidationSpec.RequiresAdminToken -and !$AdminToken) {
        $canRun = $false
        $missingRequirements += "H2S_ADMIN_TOKEN required"
    }
    
    # Check Supabase credentials requirement
    if ($ValidationSpec.RequiresSupabase -and (!$SupabaseUrl -or !$SupabaseKey)) {
        $canRun = $false
        $missingRequirements += "SUPABASE_URL and SUPABASE_SERVICE_KEY required"
    }
    
    return @{
        CanRun = $canRun
        MissingRequirements = $missingRequirements
    }
}

# ============================================================================
# MAIN EXECUTION
# ============================================================================

Write-Host "`n`n"
Write-Host "████████████████████████████████████████████████████████████████" -ForegroundColor Magenta
Write-Host "█                                                              █" -ForegroundColor Magenta
Write-Host "█      HOME2SMART MASTER VALIDATION ORCHESTRATOR              █" -ForegroundColor Magenta
Write-Host "█      Complete System Integrity Check                        █" -ForegroundColor Magenta
Write-Host "█                                                              █" -ForegroundColor Magenta
Write-Host "████████████████████████████████████████████████████████████████" -ForegroundColor Magenta
Write-Host ""

# Display environment status
Write-Section "ENVIRONMENT STATUS"

Write-Host "  Admin Token:         $(if ($AdminToken) { '✅ SET' } else { '❌ NOT SET' })" -ForegroundColor $(if ($AdminToken) { 'Green' } else { 'Yellow' })
Write-Host "  Supabase URL:        $(if ($SupabaseUrl) { '✅ SET' } else { '❌ NOT SET' })" -ForegroundColor $(if ($SupabaseUrl) { 'Green' } else { 'Yellow' })
Write-Host "  Supabase Key:        $(if ($SupabaseKey) { '✅ SET' } else { '❌ NOT SET' })" -ForegroundColor $(if ($SupabaseKey) { 'Green' } else { 'Yellow' })

if (!$AdminToken) {
    Write-Host "`n  ⚠️  Set H2S_ADMIN_TOKEN to run backend enhancement tests" -ForegroundColor Yellow
}
if (!$SupabaseUrl -or !$SupabaseKey) {
    Write-Host "  ⚠️  Set SUPABASE credentials to run database integrity tests" -ForegroundColor Yellow
}

Write-Host ""

# Run each validation script
foreach ($validation in $ValidationScripts) {
    Write-Section "$($validation.Name)"
    
    Write-Host "  Description: $($validation.Description)" -ForegroundColor Gray
    Write-Host "  Script: $($validation.Script)" -ForegroundColor Gray
    Write-Host ""
    
    # Check prerequisites
    $prereqCheck = Test-Prerequisites -ValidationSpec $validation
    
    if (!$prereqCheck.CanRun) {
        if ($validation.Required) {
            Write-Host "  ❌ SKIPPED (REQUIRED) - Missing prerequisites:" -ForegroundColor Red
            foreach ($missing in $prereqCheck.MissingRequirements) {
                Write-Host "     - $missing" -ForegroundColor Red
            }
            
            $Global:Results += @{
                Name = $validation.Name
                Status = "FAILED"
                Reason = "Missing prerequisites: $($prereqCheck.MissingRequirements -join ', ')"
                Required = $validation.Required
            }
        } else {
            Write-Host "  ⏭️  SKIPPED (OPTIONAL) - Missing prerequisites:" -ForegroundColor Yellow
            foreach ($missing in $prereqCheck.MissingRequirements) {
                Write-Host "     - $missing" -ForegroundColor Yellow
            }
            
            $Global:Results += @{
                Name = $validation.Name
                Status = "SKIPPED"
                Reason = "Missing prerequisites: $($prereqCheck.MissingRequirements -join ', ')"
                Required = $validation.Required
            }
        }
        
        continue
    }
    
    # Build command
    $command = $validation.Script
    $args = @()
    
    if ($Verbose) {
        $args += "-Verbose"
    }
    
    if ($SkipDestructive -and $validation.Script -like "*BackendEnhancements*") {
        $args += "-SkipDestructive"
    }
    
    if ($validation.RequiresAdminToken -and $AdminToken) {
        $args += "-AdminToken", $AdminToken
    }
    
    # Execute script
    Write-Host "  ▶️  Running validation..." -ForegroundColor Cyan
    
    $startTime = Get-Date
    
    try {
        $output = & $command @args 2>&1
        $exitCode = $LASTEXITCODE
        $endTime = Get-Date
        $duration = ($endTime - $startTime).TotalSeconds
        
        if ($exitCode -eq 0) {
            Write-Host "`n  ✅ PASSED in $([math]::Round($duration, 1))s" -ForegroundColor Green
            
            $Global:Results += @{
                Name = $validation.Name
                Status = "PASSED"
                Duration = $duration
                ExitCode = $exitCode
                Required = $validation.Required
            }
        } else {
            Write-Host "`n  ❌ FAILED in $([math]::Round($duration, 1))s (Exit Code: $exitCode)" -ForegroundColor Red
            
            $Global:Results += @{
                Name = $validation.Name
                Status = "FAILED"
                Duration = $duration
                ExitCode = $exitCode
                Required = $validation.Required
            }
        }
    } catch {
        Write-Host "`n  ❌ ERROR: $($_.Exception.Message)" -ForegroundColor Red
        
        $Global:Results += @{
            Name = $validation.Name
            Status = "ERROR"
            Error = $_.Exception.Message
            Required = $validation.Required
        }
    }
}

# ============================================================================
# GENERATE FINAL REPORT
# ============================================================================

Write-Section "VALIDATION SUMMARY"

$passed = ($Global:Results | Where-Object { $_.Status -eq "PASSED" }).Count
$failed = ($Global:Results | Where-Object { $_.Status -eq "FAILED" }).Count
$skipped = ($Global:Results | Where-Object { $_.Status -eq "SKIPPED" }).Count
$errors = ($Global:Results | Where-Object { $_.Status -eq "ERROR" }).Count

$requiredPassed = ($Global:Results | Where-Object { $_.Required -and $_.Status -eq "PASSED" }).Count
$requiredFailed = ($Global:Results | Where-Object { $_.Required -and ($_.Status -eq "FAILED" -or $_.Status -eq "ERROR") }).Count

Write-Host "`n  Results:" -ForegroundColor White
Write-Host "    ✅ Passed:   $passed" -ForegroundColor Green
Write-Host "    ❌ Failed:   $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Gray" })
Write-Host "    ⏭️  Skipped:  $skipped" -ForegroundColor Yellow
Write-Host "    ❗ Errors:   $errors" -ForegroundColor $(if ($errors -gt 0) { "Red" } else { "Gray" })

Write-Host "`n  Critical Tests (Required):" -ForegroundColor White
Write-Host "    Passed: $requiredPassed" -ForegroundColor $(if ($requiredPassed -gt 0) { "Green" } else { "Red" })
Write-Host "    Failed: $requiredFailed" -ForegroundColor $(if ($requiredFailed -gt 0) { "Red" } else { "Gray" })

# Detailed breakdown
Write-Host "`n  Detailed Results:" -ForegroundColor White
foreach ($result in $Global:Results) {
    $icon = switch ($result.Status) {
        "PASSED" { "✅" }
        "FAILED" { "❌" }
        "SKIPPED" { "⏭️ " }
        "ERROR" { "❗" }
    }
    
    $color = switch ($result.Status) {
        "PASSED" { "Green" }
        "FAILED" { "Red" }
        "SKIPPED" { "Yellow" }
        "ERROR" { "Red" }
    }
    
    $requiredTag = if ($result.Required) { "[REQUIRED]" } else { "[OPTIONAL]" }
    
    Write-Host "    $icon $($result.Name.PadRight(40)) $requiredTag" -ForegroundColor $color
    
    if ($result.Duration) {
        Write-Host "       Duration: $([math]::Round($result.Duration, 1))s" -ForegroundColor DarkGray
    }
    
    if ($result.Reason) {
        Write-Host "       Reason: $($result.Reason)" -ForegroundColor DarkGray
    }
    
    if ($result.Error) {
        Write-Host "       Error: $($result.Error)" -ForegroundColor DarkGray
    }
}

# Save report
$reportPath = ".\master-validation-report-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
$Global:Results | ConvertTo-Json -Depth 10 | Out-File -FilePath $reportPath -Encoding UTF8

Write-Host "`n  📄 Full report saved to: $reportPath" -ForegroundColor Cyan

# Final verdict
Write-Host ""
Write-Section "FINAL VERDICT"

if ($requiredFailed -eq 0 -and $failed -eq 0 -and $errors -eq 0) {
    Write-Host "  🎉 SUCCESS! ALL VALIDATIONS PASSED" -ForegroundColor Green
    Write-Host "  System is healthy and ready for deployment" -ForegroundColor Green
    Write-Host ""
    exit 0
} elseif ($requiredFailed -eq 0) {
    Write-Host "  ⚠️  PASSED WITH WARNINGS" -ForegroundColor Yellow
    Write-Host "  All required tests passed, but some optional tests failed" -ForegroundColor Yellow
    Write-Host "  Review optional test failures before proceeding" -ForegroundColor Yellow
    Write-Host ""
    exit 0
} else {
    Write-Host "  ❌ CRITICAL FAILURE" -ForegroundColor Red
    Write-Host "  $requiredFailed REQUIRED test(s) failed" -ForegroundColor Red
    Write-Host "  DO NOT DEPLOY until these are fixed!" -ForegroundColor Red
    Write-Host ""
    exit 1
}
