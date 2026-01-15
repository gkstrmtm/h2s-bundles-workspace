# COMPREHENSIVE PORTAL & SAVE AUDIT
# Tests save performance, portal data integrity, and character encoding

$ErrorActionPreference = "Continue"
$apiUrl = "https://h2s-backend.vercel.app/api"

Write-Host @"

╔════════════════════════════════════════════════════════════════╗
║        PORTAL & SAVE PERFORMANCE COMPREHENSIVE AUDIT           ║
╚════════════════════════════════════════════════════════════════╝

"@ -ForegroundColor Magenta

$issues = @()
$warnings = @()
$timings = @()

# AUDIT 1: Check portal.html for broken characters
Write-Host "`n[1/5] Auditing portal.html for character encoding issues..." -ForegroundColor Yellow

$portalContent = Get-Content "frontend\portal.html" -Raw -Encoding UTF8
$brokenPatterns = @(
    @{ pattern = '\s\?\s[a-zA-Z]'; name = "Question mark instead of bullet"; example = " ? Schedule" }
)

$foundIssues = @()
foreach ($check in $brokenPatterns) {
    if ($portalContent -match $check.pattern) {
        $matches = [regex]::Matches($portalContent, $check.pattern)
        $foundIssues += "Found $($matches.Count) instances of '$($check.name)'"
    }
}

if ($foundIssues.Count -eq 0) {
    Write-Host "  ✅ No broken characters found in portal.html" -ForegroundColor Green
} else {
    Write-Host "  ❌ Character encoding issues found:" -ForegroundColor Red
    foreach ($issue in $foundIssues) {
        Write-Host "     $issue" -ForegroundColor Red
        $issues += $issue
    }
}

# AUDIT 2: Create test order with full metadata
Write-Host "`n[2/5] Creating order with complete job details..." -ForegroundColor Yellow

$testEmail = "portal-audit-$(Get-Random)@test.com"
$checkoutStart = Get-Date

$checkoutBody = @{
    __action = "create_checkout_session"
    customer = @{
        email = $testEmail
        name = "Portal Audit Test"
        phone = "555-0199"
    }
    cart = @(
        @{
            bundle_id = "bnd-welcome-to-h2s"
            name = "Smart Home Bundle"
            price = 999
            quantity = 1
        }
    )
    promotion_code = ""
    success_url = "https://example.com/success"
    cancel_url = "https://example.com/cancel"
} | ConvertTo-Json -Depth 10

try {
    $checkout = Invoke-RestMethod -Uri "$apiUrl/shop" -Method POST -Body $checkoutBody -ContentType "application/json" -TimeoutSec 30
    $checkoutTime = ((Get-Date) - $checkoutStart).TotalMilliseconds
    $timings += @{ operation = "Checkout Creation"; time = $checkoutTime }
    
    Write-Host "  ✅ Order created: $($checkout.order_id)" -ForegroundColor Green
    Write-Host "  ⏱️  Time: $([math]::Round($checkoutTime, 0))ms" -ForegroundColor Gray
    
    if (!$checkout.job_id) {
        Write-Host "  ⚠️  No job_id returned!" -ForegroundColor Yellow
        $warnings += "Missing job_id in checkout response"
    } else {
        Write-Host "  ✅ Job ID: $($checkout.job_id)" -ForegroundColor Green
    }
} catch {
    Write-Host "  ❌ Checkout failed: $($_.Exception.Message)" -ForegroundColor Red
    $issues += "Checkout failed: $($_.Exception.Message)"
    exit 1
}

Start-Sleep 2

# AUDIT 3: Verify job metadata completeness
Write-Host "`n[3/5] Checking job_metadata for completeness..." -ForegroundColor Yellow

$orderBody = @{ customer_email = $testEmail } | ConvertTo-Json

try {
    $orders = Invoke-RestMethod -Uri "$apiUrl/customer_orders" -Method POST -Body $orderBody -ContentType "application/json" -TimeoutSec 10
    
    if ($orders.orders.Count -eq 0) {
        Write-Host "  ❌ Order not found in h2s_orders!" -ForegroundColor Red
        $issues += "Order missing from h2s_orders table"
    } else {
        $order = $orders.orders[0]
        $metadata = $order.job_metadata
        
        if ($metadata) {
            Write-Host "  ✅ Job metadata present" -ForegroundColor Green
            
            # Check for required fields
            $requiredFields = @('customer_name', 'customer_email', 'customer_phone')
            $missingFields = @()
            
            foreach ($field in $requiredFields) {
                if (!$metadata.$field -or [string]::IsNullOrWhiteSpace($metadata.$field)) {
                    $missingFields += $field
                }
            }
            
            if ($missingFields.Count -eq 0) {
                Write-Host "  ✅ All required fields present" -ForegroundColor Green
            } else {
                Write-Host "  ⚠️  Missing fields: $($missingFields -join ', ')" -ForegroundColor Yellow
                $warnings += "Missing metadata fields: $($missingFields -join ', ')"
            }
            
            # Check for broken characters in metadata
            $metadataJson = $metadata | ConvertTo-Json
            if ($metadataJson -match '\?') {
                Write-Host "  X Broken characters detected in metadata!" -ForegroundColor Red
                $issues += "Broken characters in job_metadata"
                Write-Host "     Sample: $($metadataJson.Substring(0, [Math]::Min(300, $metadataJson.Length)))" -ForegroundColor Gray
            } else {
                Write-Host "  OK No broken characters in metadata" -ForegroundColor Green
            }
        } else {
            Write-Host "  ❌ No job_metadata!" -ForegroundColor Red
            $issues += "Missing job_metadata"
        }
    }
} catch {
    Write-Host "  ❌ Failed to retrieve order: $($_.Exception.Message)" -ForegroundColor Red
    $issues += "Order retrieval failed"
}

# AUDIT 4: Test schedule save performance
if ($checkout.job_id) {
    Write-Host "`n[4/5] Testing schedule save performance..." -ForegroundColor Yellow
    
    $scheduleDate = (Get-Date).AddDays(3).ToString("yyyy-MM-dd")
    $scheduleTime = "10:00 AM"
    
    $scheduleStart = Get-Date
    $scheduleBody = @{
        order_id = $checkout.order_id
        scheduled_iso = "$scheduleDate`T10:00:00-05:00"
        timezone = "America/New_York"
        time_window = "9am - 12pm"
    } | ConvertTo-Json
    
    try {
        $scheduleResult = Invoke-RestMethod -Uri "$apiUrl/customer_reschedule" -Method POST -Body $scheduleBody -ContentType "application/json" -TimeoutSec 20
        $scheduleTime = ((Get-Date) - $scheduleStart).TotalMilliseconds
        $timings += @{ operation = "Schedule Save"; time = $scheduleTime }
        
        Write-Host "  ⏱️  Time: $([math]::Round($scheduleTime, 0))ms" -ForegroundColor Gray
        
        if ($scheduleResult.ok) {
            Write-Host "  ✅ Schedule saved successfully" -ForegroundColor Green
            
            if ($scheduleTime -gt 5000) {
                Write-Host "  ⚠️  Schedule save took $([math]::Round($scheduleTime/1000, 1))s (>5s threshold)" -ForegroundColor Yellow
                $warnings += "Schedule save is slow: $([math]::Round($scheduleTime/1000, 1))s"
            }
        } else {
            Write-Host "  ❌ Schedule save failed: $($scheduleResult.error)" -ForegroundColor Red
            $issues += "Schedule save returned ok=false"
        }
    } catch {
        $scheduleTime = ((Get-Date) - $scheduleStart).TotalMilliseconds
        Write-Host "  ⏱️  Failed after: $([math]::Round($scheduleTime, 0))ms" -ForegroundColor Gray
        Write-Host "  ❌ Schedule save error: $($_.Exception.Message)" -ForegroundColor Red
        $issues += "Schedule save exception: $($_.Exception.Message)"
        
        if ($_.Exception.Message -match "timeout" -or $scheduleTime -gt 18000) {
            Write-Host "  🔥 TIMEOUT/SLOW - This is a silent failure risk!" -ForegroundColor Red
            $issues += "CRITICAL: Schedule save timeout (silent failure)"
        }
    }
    
    # AUDIT 5: Verify schedule persisted
    Write-Host "`n[5/5] Verifying schedule persisted to database..." -ForegroundColor Yellow
    Start-Sleep 2
    
    try {
        $verifyOrders = Invoke-RestMethod -Uri "$apiUrl/customer_orders" -Method POST -Body $orderBody -ContentType "application/json" -TimeoutSec 10
        $verifiedOrder = $verifyOrders.orders[0]
        
        if ($verifiedOrder.installation_date) {
            Write-Host "  ✅ Installation date persisted: $($verifiedOrder.installation_date)" -ForegroundColor Green
        } else {
            Write-Host "  ❌ Installation date NOT saved!" -ForegroundColor Red
            $issues += "CRITICAL: Installation date not persisted (silent failure)"
        }
        
        if ($verifiedOrder.time_preference -or $verifiedOrder.time_window) {
            Write-Host "  ✅ Time preference persisted" -ForegroundColor Green
        } else {
            Write-Host "  ⚠️  Time preference not saved" -ForegroundColor Yellow
            $warnings += "Time preference not persisted"
        }
        
        # Check for broken characters in displayed date
        $dateDisplay = $verifiedOrder.installation_date
        if ($dateDisplay -match '\?') {
            Write-Host "  X Broken characters in displayed date!" -ForegroundColor Red
            $issues += "Broken characters in installation_date display"
        }
    } catch {
        Write-Host "  ❌ Verification failed: $($_.Exception.Message)" -ForegroundColor Red
        $issues += "Schedule verification failed"
    }
} else {
    Write-Host "`n[4/5] SKIPPED: No job_id to test scheduling" -ForegroundColor Yellow
    Write-Host "[5/5] SKIPPED: Cannot verify schedule" -ForegroundColor Yellow
}

# SUMMARY REPORT
Write-Host "`n`n" -NoNewline
Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║                    COMPREHENSIVE RESULTS                       ║" -ForegroundColor Magenta
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Magenta

Write-Host "`nPERFORMANCE TIMINGS:" -ForegroundColor White
foreach ($timing in $timings) {
    $ms = [math]::Round($timing.time, 0)
    $color = if ($ms -lt 2000) { "Green" } elseif ($ms -lt 5000) { "Yellow" } else { "Red" }
    Write-Host "  $($timing.operation): ${ms}ms" -ForegroundColor $color
}

if ($warnings.Count -gt 0) {
    Write-Host "`nWARNINGS: $($warnings.Count)" -ForegroundColor Yellow
    foreach ($warning in $warnings) {
        Write-Host "  ⚠️  $warning" -ForegroundColor Yellow
    }
}

if ($issues.Count -eq 0 -and $warnings.Count -eq 0) {
    Write-Host "`n✅ PERFECT - No issues or warnings" -ForegroundColor Green
    Write-Host "   • Portal.html has no character encoding issues" -ForegroundColor Green
    Write-Host "   • Job metadata is complete and clean" -ForegroundColor Green
    Write-Host "   • Schedule save performance is good" -ForegroundColor Green
    Write-Host "   • Data persistence working correctly" -ForegroundColor Green
    exit 0
} elseif ($issues.Count -eq 0) {
    Write-Host "`n⚠️  GOOD - Minor warnings only" -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "`n❌ CRITICAL ISSUES FOUND: $($issues.Count)" -ForegroundColor Red
    foreach ($issue in $issues) {
        Write-Host "  • $issue" -ForegroundColor Red
    }
    exit 1
}
