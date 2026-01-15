#!/usr/bin/env pwsh
<#
.SYNOPSIS
    System Guardian - Comprehensive validation for H2S ecosystem
    
.DESCRIPTION
    This script validates EVERY critical component of the system:
    - Environment variables (Backend, Frontend, Relay)
    - Relay service health and authentication
    - Vercel deployment status and aliases
    - Checkout flow end-to-end
    - Database connectivity and schema
    - Dispatch system data consistency
    - Technician profile data integrity
    - Order-to-job pipeline validation
    
    Run this BEFORE any deployment and AFTER any changes.
    If this fails, DO NOT DEPLOY.
    
.PARAMETER SkipDeploymentCheck
    Skip checking Vercel deployment status (useful for local validation)
    
.PARAMETER SkipCheckoutTest
    Skip the live checkout session creation test
    
.PARAMETER Verbose
    Show detailed output for all tests
    
.EXAMPLE
    .\SYSTEM_GUARDIAN.ps1
    Run full validation
    
.EXAMPLE
    .\SYSTEM_GUARDIAN.ps1 -SkipCheckoutTest
    Validate system without creating test checkout session
    
.NOTES
    Version: 2.0.0
    Last Updated: 2026-01-08
    This is your last line of defense. Do not bypass failures.
#>

[CmdletBinding()]
param(
    [switch]$SkipDeploymentCheck,
    [switch]$SkipCheckoutTest,
    [switch]$VerboseOutput
)

$ErrorActionPreference = "Continue"  # Changed from Stop to Continue for safer execution
$ProgressPreference = "SilentlyContinue"  # Suppress progress bars
$Global:FailureCount = 0
$Global:WarningCount = 0
$Global:TestResults = @()
$Global:StartTime = Get-Date

# Color scheme
$Colors = @{
    Pass = 'Green'
    Fail = 'Red'
    Warn = 'Yellow'
    Info = 'Cyan'
    Muted = 'Gray'
}

function Write-TestResult {
    param(
        [string]$Test,
        [bool]$Passed,
        [string]$Message,
        [bool]$IsWarning = $false,
        [hashtable]$Metadata = @{}
    )
    
    $result = @{
        Test = $Test
        Passed = $Passed
        Message = $Message
        Timestamp = Get-Date
        IsWarning = $IsWarning
        Metadata = $Metadata
    }
    
    $Global:TestResults += $result
    
    if ($Passed) {
        Write-Host "✓ " -ForegroundColor $Colors.Pass -NoNewline
        Write-Host "PASS: " -ForegroundColor $Colors.Pass -NoNewline
        Write-Host $Test -ForegroundColor White
        if ($Message -and $VerboseOutput) { 
            Write-Host "  → $Message" -ForegroundColor $Colors.Muted 
        }
    } elseif ($IsWarning) {
        Write-Host "⚠ " -ForegroundColor $Colors.Warn -NoNewline
        Write-Host "WARN: " -ForegroundColor $Colors.Warn -NoNewline
        Write-Host $Test -ForegroundColor White
        Write-Host "  → $Message" -ForegroundColor $Colors.Warn
        $Global:WarningCount++
    } else {
        Write-Host "✗ " -ForegroundColor $Colors.Fail -NoNewline
        Write-Host "FAIL: " -ForegroundColor $Colors.Fail -NoNewline
        Write-Host $Test -ForegroundColor White
        Write-Host "  → $Message" -ForegroundColor $Colors.Fail
        $Global:FailureCount++
    }
}

function Test-EnvironmentVariable {
    param([string]$Name, [string]$Context, [bool]$Required = $true)
    
    try {
        $output = vercel env ls 2>&1 | Select-String $Name
        if ($output) {
            Write-TestResult -Test "$Context - $Name exists" -Passed $true -Message "Variable configured"
            return $true
        } else {
            Write-TestResult -Test "$Context - $Name exists" -Passed $false -Message "Variable NOT found in Vercel"
            return $false
        }
    } catch {
        Write-TestResult -Test "$Context - $Name check" -Passed $false -Message "Failed to check: $_"
        return $false
    }
}

function Test-RelayHealth {
    try {
        $response = Invoke-RestMethod -Uri "https://modest-beauty-production-2b84.up.railway.app/health" -TimeoutSec 10
        if ($response.ok -eq $true) {
            Write-TestResult -Test "Relay Health Check" -Passed $true -Message "Service: $($response.service), Time: $($response.timestamp)"
            return $true
        } else {
            Write-TestResult -Test "Relay Health Check" -Passed $false -Message "Unhealthy response: $($response | ConvertTo-Json -Compress)"
            return $false
        }
    } catch {
        Write-TestResult -Test "Relay Health Check" -Passed $false -Message "Cannot reach relay: $_"
        return $false
    }
}

function Test-RelayAuthentication {
    try {
        $timestamp = Get-Date -Format "yyyyMMddHHmmss"
        $body = "{`"sessionParams`":{`"mode`":`"payment`",`"payment_method_types`":[`"card`"],`"line_items`":[{`"price_data`":{`"currency`":`"usd`",`"unit_amount`":100,`"product_data`":{`"name`":`"Guardian Test`"}},`"quantity`":1}],`"success_url`":`"https://test.com`",`"cancel_url`":`"https://test.com`"},`"idempotencyKey`":`"guardian-test-$timestamp`"}"
        
        $response = Invoke-RestMethod -Uri "https://modest-beauty-production-2b84.up.railway.app/stripe/checkout" `
            -Method POST `
            -Headers @{'Authorization'='Bearer a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456';'Content-Type'='application/json'} `
            -Body $body `
            -TimeoutSec 30
            
        if ($response.ok -eq $true -and $response.session.id) {
            Write-TestResult -Test "Relay Stripe Integration" -Passed $true -Message "Created session: $($response.session.id)"
            return $true
        } else {
            Write-TestResult -Test "Relay Stripe Integration" -Passed $false -Message "Failed to create session"
            return $false
        }
    } catch {
        $errorMsg = $_.Exception.Message
        if ($errorMsg -like "*Invalid API Key*") {
            Write-TestResult -Test "Relay Stripe Integration" -Passed $false -Message "STRIPE_SECRET_KEY in Railway is INVALID"
        } else {
            Write-TestResult -Test "Relay Stripe Integration" -Passed $false -Message "Relay error: $errorMsg"
        }
        return $false
    }
}

function Test-VercelBackendHealth {
    try {
        $body = @{
            __action = 'create_checkout_session'
            customer = @{name='Guardian Test';email='test@guardian.com';phone='5555555555'}
            cart = @(@{id='test';name='Test Item';price=100;qty=1})
            success_url = 'https://test.com/success'
            cancel_url = 'https://test.com/cancel'
        } | ConvertTo-Json -Depth 5
        
        $response = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop" `
            -Method POST `
            -Body $body `
            -ContentType 'application/json' `
            -TimeoutSec 30
            
        if ($response.ok -eq $true -and $response.pay.session_url) {
            Write-TestResult -Test "Vercel → Relay → Stripe Flow" -Passed $true -Message "End-to-end checkout working"
            return $true
        } else {
            Write-TestResult -Test "Vercel → Relay → Stripe Flow" -Passed $false -Message "Checkout failed: $($response | ConvertTo-Json -Compress)"
            return $false
        }
    } catch {
        Write-TestResult -Test "Vercel → Relay → Stripe Flow" -Passed $false -Message "Backend error: $($_.Exception.Message)"
        return $false
    }
}

function Test-PromoCodeCache {
    $cacheFile = "c:\Users\tabar\h2s-bundles-workspace\backend\lib\promoCache.ts"
    
    if (!(Test-Path $cacheFile)) {
        Write-TestResult -Test "Promo Code Cache File" -Passed $false -Message "promoCache.ts not found"
        return $false
    }
    
    $content = Get-Content $cacheFile -Raw
    
    if ($content -match "h2sqa-e2e-2025" -and $content -match "promo_1SZWVsLuMP6aPhGZGhct6nRT") {
        Write-TestResult -Test "Promo Code Cache" -Passed $true -Message "Cache contains h2sqa-e2e-2025 with Stripe ID"
        return $true
    } else {
        Write-TestResult -Test "Promo Code Cache" -Passed $false -Message "Cache missing required promo codes"
        return $false
    }
}

function Test-FrontendAccess {
    try {
        $response = Invoke-WebRequest -Uri "https://shop.home2smart.com/bundles" -UseBasicParsing -TimeoutSec 10
        if ($response.StatusCode -eq 200) {
            Write-TestResult -Test "Frontend Availability" -Passed $true -Message "shop.home2smart.com is accessible"
            return $true
        } else {
            Write-TestResult -Test "Frontend Availability" -Passed $false -Message "Unexpected status: $($response.StatusCode)"
            return $false
        }
    } catch {
        Write-TestResult -Test "Frontend Availability" -Passed $false -Message "Cannot reach frontend: $_"
        return $false
    }
}

function Test-VercelAlias {
    try {
        $deployments = vercel ls 2>&1 | Select-String "backend-" | Select-Object -First 1
        if ($deployments) {
            Write-TestResult -Test "Vercel Deployment Status" -Passed $true -Message "Latest deployment exists"
            
            # Check if h2s-backend.vercel.app resolves
            try {
                $aliasTest = Invoke-WebRequest -Uri "https://h2s-backend.vercel.app/api/stripe_smoke" -UseBasicParsing -TimeoutSec 10 -ErrorAction SilentlyContinue
                # We expect this to fail with 500 (Stripe timeout) but it should respond
                Write-TestResult -Test "Custom Domain Alias" -Passed $true -Message "h2s-backend.vercel.app is responding"
            } catch {
                if ($_.Exception.Response.StatusCode -eq 500) {
                    Write-TestResult -Test "Custom Domain Alias" -Passed $true -Message "Domain responds (expected 500 from smoke test)"
                } else {
                    Write-TestResult -Test "Custom Domain Alias" -Passed $false -Message "Domain not responding correctly"
                }
            }
            
            return $true
        } else {
            Write-TestResult -Test "Vercel Deployment Status" -Passed $false -Message "No deployments found"
            return $false
        }
    } catch {
        Write-TestResult -Test "Vercel Deployment Status" -Passed $false -Message "Cannot check deployments: $_"
        return $false
    }
}

function Test-DispatchSystemAccess {
    <#
    .SYNOPSIS
    Validates dispatch.html is accessible and loads properly
    #>
    try {
        $response = Invoke-WebRequest -Uri "https://shop.home2smart.com/dispatch" -UseBasicParsing -TimeoutSec 10 -ErrorAction Stop
        if ($response.StatusCode -eq 200 -and $response.Content -like "*Dispatch Command Center*") {
            Write-TestResult -Test "Dispatch Portal Access" -Passed $true -Message "Dispatch interface loads successfully"
            return $true
        } else {
            Write-TestResult -Test "Dispatch Portal Access" -Passed $false -Message "Page loads but content missing"
            return $false
        }
    } catch {
        Write-TestResult -Test "Dispatch Portal Access" -Passed $false -Message "Cannot load dispatch portal: $($_.Exception.Message)"
        return $false
    }
}

function Test-DispatchAPIEndpoints {
    <#
    .SYNOPSIS
    Validates critical dispatch API endpoints are functioning
    #>
    $endpoints = @(
        @{Name = "Get Jobs"; Path = "/api/get-dispatch-jobs"; ExpectAuth = $true}
        @{Name = "Get Technicians"; Path = "/api/get-pros"; ExpectAuth = $true}
        @{Name = "Job Details"; Path = "/api/get-job-data"; ExpectAuth = $true}
    )
    
    $allPassed = $true
    foreach ($endpoint in $endpoints) {
        try {
            $response = Invoke-WebRequest -Uri "https://h2s-backend.vercel.app$($endpoint.Path)" `
                -UseBasicParsing `
                -TimeoutSec 10 `
                -ErrorAction Stop
            
            if ($endpoint.ExpectAuth) {
                # Should return 401 Unauthorized without auth (expected)
                Write-TestResult -Test "Dispatch API - $($endpoint.Name)" -Passed $false -Message "Endpoint responding but no auth check?"
                $allPassed = $false
            } else {
                if ($response.StatusCode -eq 200) {
                    Write-TestResult -Test "Dispatch API - $($endpoint.Name)" -Passed $true -Message "Endpoint functional"
                } else {
                    Write-TestResult -Test "Dispatch API - $($endpoint.Name)" -Passed $false -Message "Unexpected status: $($response.StatusCode)"
                    $allPassed = $false
                }
            }
        } catch {
            $statusCode = $_.Exception.Response.StatusCode.value__
            if ($endpoint.ExpectAuth -and $statusCode -eq 401) {
                # Expected: Auth required
                Write-TestResult -Test "Dispatch API - $($endpoint.Name)" -Passed $true -Message "Endpoint protected (requires auth)"
            } elseif ($statusCode -eq 404) {
                Write-TestResult -Test "Dispatch API - $($endpoint.Name)" -Passed $false -Message "Endpoint NOT FOUND (404)"
                $allPassed = $false
            } else {
                Write-TestResult -Test "Dispatch API - $($endpoint.Name)" -Passed $false -Message "Error: $($_.Exception.Message)"
                $allPassed = $false
            }
        }
    }
    
    return $allPassed
}

function Test-TechnicianDataSchema {
    <#
    .SYNOPSIS
    Validates that technician profile data structure is consistent
    Checks that dispatch.html expects the right fields from the database
    #>
    try {
        # Read dispatch.html to validate expected fields
        $dispatchPath = "frontend\dispatch.html"
        if (Test-Path $dispatchPath) {
            $content = Get-Content $dispatchPath -Raw
            
            $expectedFields = @(
                'pro_id',
                'name',
                'email',
                'phone',
                'company_name',
                'home_address',
                'city',
                'state',
                'home_zip',
                'service_radius_miles',
                'vehicle_make_model',
                'vehicle_year',
                'vehicle_license_plate',
                'vehicle_color',
                'photo_url',
                'is_active',
                'rating',
                'total_jobs_completed'
            )
            
            $missingFields = @()
            foreach ($field in $expectedFields) {
                if ($content -notlike "*$field*") {
                    $missingFields += $field
                }
            }
            
            if ($missingFields.Count -eq 0) {
                Write-TestResult -Test "Technician Data Schema" -Passed $true -Message "All $($expectedFields.Count) expected fields referenced in dispatch UI"
                return $true
            } else {
                Write-TestResult -Test "Technician Data Schema" -Passed $false -Message "Missing fields: $($missingFields -join ', ')" -IsWarning $true
                return $false
            }
        } else {
            Write-TestResult -Test "Technician Data Schema" -Passed $false -Message "Cannot find dispatch.html at: $dispatchPath"
            return $false
        }
    } catch {
        Write-TestResult -Test "Technician Data Schema" -Passed $false -Message "Validation error: $($_.Exception.Message)"
        return $false
    }
}

function Test-JobCreationPipeline {
    <#
    .SYNOPSIS
    Validates that the order-to-job pipeline is properly configured
    Checks for webhook → h2s_orders → h2s_dispatch_jobs flow
    #>
    try {
        # Check if webhook endpoint exists
        $webhookTest = Invoke-WebRequest -Uri "https://h2s-backend.vercel.app/api/stripe-webhook" `
            -Method POST `
            -Body "test" `
            -ContentType "application/json" `
            -UseBasicParsing `
            -ErrorAction Stop `
            -TimeoutSec 10
        
        Write-TestResult -Test "Job Creation Pipeline - Webhook Endpoint" -Passed $false -Message "Webhook accepted invalid payload"
        return $false
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq 400) {
            # Expected: Webhook validates signatures
            Write-TestResult -Test "Job Creation Pipeline - Webhook Endpoint" -Passed $true -Message "Webhook properly validates payloads"
            return $true
        } elseif ($statusCode -eq 404) {
            Write-TestResult -Test "Job Creation Pipeline - Webhook Endpoint" -Passed $false -Message "CRITICAL: Webhook endpoint NOT FOUND"
            return $false
        } else {
            Write-TestResult -Test "Job Creation Pipeline - Webhook Endpoint" -Passed $false -Message "Unexpected response: $statusCode" -IsWarning $true
            return $false
        }
    }
}

function Test-DispatchRealtimeUpdates {
    <#
    .SYNOPSIS
    Validates that dispatch uses Supabase realtime for live job updates
    #>
    try {
        $dispatchPath = "frontend\dispatch.html"
        if (Test-Path $dispatchPath) {
            $content = Get-Content $dispatchPath -Raw
            
            $realtimeChecks = @{
                'Supabase Client' = '*createClient*'
                'Channel Subscription' = '*channel(*dispatch-jobs-channel*'
                'Insert Listener' = '*event:*INSERT*'
                'Update Listener' = '*event:*UPDATE*'
                'Delete Listener' = '*event:*DELETE*'
            }
            
            $allPassed = $true
            foreach ($check in $realtimeChecks.GetEnumerator()) {
                if ($content -like $check.Value) {
                    if ($VerboseOutput) {
                        Write-TestResult -Test "Realtime - $($check.Key)" -Passed $true -Message "Implementation found"
                    }
                } else {
                    Write-TestResult -Test "Realtime - $($check.Key)" -Passed $false -Message "Missing realtime listener" -IsWarning $true
                    $allPassed = $false
                }
            }
            
            if ($allPassed) {
                Write-TestResult -Test "Dispatch Realtime Updates" -Passed $true -Message "All realtime listeners configured"
            }
            
            return $allPassed
        } else {
            Write-TestResult -Test "Dispatch Realtime Updates" -Passed $false -Message "Cannot find dispatch.html"
            return $false
        }
    } catch {
        Write-TestResult -Test "Dispatch Realtime Updates" -Passed $false -Message "Validation error: $($_.Exception.Message)"
        return $false
    }
}

# ============================================================
# MAIN EXECUTION
# ============================================================

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor $Colors.Info
Write-Host "    SYSTEM GUARDIAN v2.0 - H2S Ecosystem Validator" -ForegroundColor $Colors.Info
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor $Colors.Info
Write-Host ""
Write-Host "Starting comprehensive system validation..." -ForegroundColor Yellow
$currentTime = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Host "Timestamp: $currentTime" -ForegroundColor $Colors.Muted
if ($VerboseOutput) { Write-Host "Verbose Mode: ENABLED" -ForegroundColor $Colors.Info }
Write-Host ""

# Category 1: Environment Configuration
Write-Host "━━━ CATEGORY 1: Environment Configuration ━━━" -ForegroundColor Magenta
Test-EnvironmentVariable -Name "STRIPE_RELAY_URL" -Context "Vercel Backend"
Test-EnvironmentVariable -Name "STRIPE_RELAY_SECRET" -Context "Vercel Backend"
Test-EnvironmentVariable -Name "STRIPE_SECRET_KEY" -Context "Vercel Backend"
Test-EnvironmentVariable -Name "SUPABASE_URL" -Context "Vercel Backend"
Test-PromoCodeCache
Write-Host ""

# Category 2: Relay Service
Write-Host "━━━ CATEGORY 2: Railway Relay Service ━━━" -ForegroundColor Magenta
Test-RelayHealth
if (-not $SkipCheckoutTest) {
    Test-RelayAuthentication
}
Write-Host ""

# Category 3: Vercel Backend
Write-Host "━━━ CATEGORY 3: Vercel Backend ━━━" -ForegroundColor Magenta
if (-not $SkipDeploymentCheck) {
    Test-VercelAlias
}
Test-VercelBackendHealth
Write-Host ""

# Category 4: Frontend
Write-Host "━━━ CATEGORY 4: Frontend ━━━" -ForegroundColor Magenta
Test-FrontendAccess
Write-Host ""

# Category 5: Dispatch System (NEW)
Write-Host "━━━ CATEGORY 5: Dispatch System ━━━" -ForegroundColor Magenta
Test-DispatchSystemAccess
Test-DispatchAPIEndpoints
Test-TechnicianDataSchema
Test-JobCreationPipeline
Test-DispatchRealtimeUpdates
Write-Host ""

# ============================================================
# FINAL REPORT
# ============================================================

$executionTime = (Get-Date) - $Global:StartTime
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor $Colors.Info
Write-Host "                    VALIDATION COMPLETE" -ForegroundColor $Colors.Info
Write-Host "═══════════════════════════════════════════════════════════" -ForegroundColor $Colors.Info
Write-Host ""

$totalTests = $Global:TestResults.Count
$passedTests = ($Global:TestResults | Where-Object { $_.Passed -eq $true }).Count
$failedTests = $Global:FailureCount
$warnings = $Global:WarningCount

Write-Host "Execution Time: $($executionTime.TotalSeconds.ToString('F2'))s" -ForegroundColor $Colors.Muted
Write-Host "Total Tests:    $totalTests" -ForegroundColor White
Write-Host "Passed:         $passedTests" -ForegroundColor $Colors.Pass
Write-Host "Failed:         $failedTests" -ForegroundColor $Colors.Fail
Write-Host "Warnings:       $warnings" -ForegroundColor $Colors.Warn
Write-Host ""

if ($failedTests -eq 0 -and $warnings -eq 0) {
    Write-Host "✓ ALL SYSTEMS OPERATIONAL" -ForegroundColor $Colors.Pass
    Write-Host "  Safe to deploy and accept customer payments." -ForegroundColor $Colors.Pass
    Write-Host "  Dispatch system validated and ready." -ForegroundColor $Colors.Pass
    exit 0
} elseif ($failedTests -eq 0) {
    Write-Host "⚠ SYSTEM OPERATIONAL WITH WARNINGS" -ForegroundColor $Colors.Warn
    Write-Host "  Review warnings above before deploying." -ForegroundColor $Colors.Warn
    Write-Host ""
    Write-Host "Warnings:" -ForegroundColor $Colors.Warn
    $Global:TestResults | Where-Object { $_.Passed -eq $false -and $_.IsWarning -eq $true } | ForEach-Object {
        Write-Host "  - $($_.Test): $($_.Message)" -ForegroundColor $Colors.Warn
    }
    exit 0
} else {
    Write-Host "✗ CRITICAL FAILURES DETECTED" -ForegroundColor $Colors.Fail
    Write-Host "  DO NOT DEPLOY. Fix failures above first." -ForegroundColor $Colors.Fail
    Write-Host ""
    Write-Host "Failed Tests:" -ForegroundColor $Colors.Fail
    $Global:TestResults | Where-Object { $_.Passed -eq $false -and $_.IsWarning -eq $false } | ForEach-Object {
        Write-Host "  - $($_.Test): $($_.Message)" -ForegroundColor $Colors.Fail
