# AUDIT: Save Performance & Silent Failures
# Tests actual save times and checks for silent failures in the scheduling flow

$ErrorActionPreference = "Continue"
$apiUrl = "https://h2s-backend.vercel.app/api"

Write-Host @"

╔════════════════════════════════════════════════════════════════╗
║            SAVE PERFORMANCE & SILENT FAILURE AUDIT             ║
╚════════════════════════════════════════════════════════════════╝

"@ -ForegroundColor Cyan

$issues = @()
$timings = @()

# Step 1: Create a test order
Write-Host "`n[1/4] Creating test order..." -ForegroundColor Yellow
$testEmail = "save-audit-$(Get-Random)@test.com"

$checkoutStart = Get-Date
$checkoutBody = @{
    __action = "create_checkout_session"
    customer = @{
        email = $testEmail
        name = "Save Test"
        phone = "555-0100"
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
    
    if ($checkoutTime -gt 5000) {
        $issues += "Checkout took $([math]::Round($checkoutTime/1000, 1))s (>5s threshold)"
    }
} catch {
    Write-Host "  ❌ Checkout failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Start-Sleep 2

# Step 2: Retrieve the order from h2s_orders
Write-Host "`n[2/4] Checking h2s_orders table..." -ForegroundColor Yellow

$orderCheckStart = Get-Date
$orderBody = @{
    customer_email = $testEmail
} | ConvertTo-Json

try {
    $orders = Invoke-RestMethod -Uri "$apiUrl/customer_orders" -Method POST -Body $orderBody -ContentType "application/json" -TimeoutSec 10
    $orderCheckTime = ((Get-Date) - $orderCheckStart).TotalMilliseconds
    $timings += @{ operation = "Order Retrieval"; time = $orderCheckTime }
    
    Write-Host "  ⏱️  Time: $([math]::Round($orderCheckTime, 0))ms" -ForegroundColor Gray
    
    if ($orders.orders.Count -eq 0) {
        Write-Host "  ❌ Order not found in h2s_orders!" -ForegroundColor Red
        $issues += "Order missing from h2s_orders table"
    } else {
        $order = $orders.orders[0]
        Write-Host "  ✅ Found order: $($order.order_id)" -ForegroundColor Green
        
        # Check for job_id
        if ($order.job_id) {
            Write-Host "  ✅ Job ID present: $($order.job_id)" -ForegroundColor Green
        } else {
            Write-Host "  ⚠️  No job_id in order metadata!" -ForegroundColor Yellow
            $issues += "Missing job_id in order metadata"
        }
        
        # Check for metadata completeness
        $metadata = $order.job_metadata
        if ($metadata) {
            Write-Host "  ✅ Job metadata present" -ForegroundColor Green
            
            # Check for required fields
            $requiredFields = @('customer_name', 'customer_email', 'customer_phone')
            foreach ($field in $requiredFields) {
                if (!$metadata.$field) {
                    Write-Host "  ⚠️  Missing metadata field: $field" -ForegroundColor Yellow
                    $issues += "Missing metadata field: $field"
                }
            }
            
            # Check for broken characters
            $metadataJson = $metadata | ConvertTo-Json
            if ($metadataJson -match '\?' -or $metadataJson -match '�') {
                Write-Host "  ⚠️  Broken characters detected in metadata!" -ForegroundColor Yellow
                $issues += "Broken characters in job_metadata"
                Write-Host "     Metadata sample: $($metadataJson.Substring(0, [Math]::Min(200, $metadataJson.Length)))" -ForegroundColor Gray
            }
        } else {
            Write-Host "  ⚠️  No job_metadata!" -ForegroundColor Yellow
            $issues += "Missing job_metadata"
        }
    }
} catch {
    Write-Host "  ❌ Failed to retrieve order: $($_.Exception.Message)" -ForegroundColor Red
    $issues += "Order retrieval failed: $($_.Exception.Message)"
}

# Step 3: Test schedule save (if we have a valid job_id)
if ($checkout.job_id) {
    Write-Host "`n[3/4] Testing schedule save..." -ForegroundColor Yellow
    
    $scheduleDate = (Get-Date).AddDays(3).ToString("yyyy-MM-dd")
    $scheduleTime = "10:00 AM"
    
    $scheduleStart = Get-Date
    $scheduleBody = @{
        __action = "save_installation_date"
        job_id = $checkout.job_id
        installation_date = $scheduleDate
        time_preference = $scheduleTime
    } | ConvertTo-Json
    
    try {
        $scheduleResult = Invoke-RestMethod -Uri "$apiUrl/schedule_installation" -Method POST -Body $scheduleBody -ContentType "application/json" -TimeoutSec 15
        $scheduleTime = ((Get-Date) - $scheduleStart).TotalMilliseconds
        $timings += @{ operation = "Schedule Save"; time = $scheduleTime }
        
        Write-Host "  ⏱️  Time: $([math]::Round($scheduleTime, 0))ms" -ForegroundColor Gray
        
        if ($scheduleResult.success) {
            Write-Host "  ✅ Schedule saved successfully" -ForegroundColor Green
            
            if ($scheduleTime -gt 3000) {
                Write-Host "  ⚠️  Schedule save took $([math]::Round($scheduleTime/1000, 1))s (>3s threshold)" -ForegroundColor Yellow
                $issues += "Schedule save is slow: $([math]::Round($scheduleTime/1000, 1))s"
            }
        } else {
            Write-Host "  ❌ Schedule save failed" -ForegroundColor Red
            $issues += "Schedule save returned success=false"
        }
    } catch {
        Write-Host "  ❌ Schedule save error: $($_.Exception.Message)" -ForegroundColor Red
        $issues += "Schedule save exception: $($_.Exception.Message)"
        
        # Check if it's a timeout
        if ($_.Exception.Message -match "timeout") {
            Write-Host "  🔥 TIMEOUT DETECTED - This is a silent failure!" -ForegroundColor Red
            $issues += "CRITICAL: Schedule save timeout (silent failure)"
        }
    }
    
    # Step 4: Verify schedule was actually saved
    Write-Host "`n[4/4] Verifying schedule persisted..." -ForegroundColor Yellow
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
        
        if ($verifiedOrder.time_preference) {
            Write-Host "  ✅ Time preference persisted: $($verifiedOrder.time_preference)" -ForegroundColor Green
        } else {
            Write-Host "  ⚠️  Time preference not saved" -ForegroundColor Yellow
        }
    } catch {
        Write-Host "  ❌ Verification failed: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "`n[3/4] SKIPPED: No job_id to test scheduling" -ForegroundColor Yellow
    Write-Host "[4/4] SKIPPED: Cannot verify schedule" -ForegroundColor Yellow
}

# Summary Report
Write-Host "`n`n" -NoNewline
Write-Host "╔════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║                    PERFORMANCE SUMMARY                         ║" -ForegroundColor Cyan
Write-Host "╚════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

Write-Host "`nTIMINGS:" -ForegroundColor White
foreach ($timing in $timings) {
    $ms = [math]::Round($timing.time, 0)
    $color = if ($ms -lt 1000) { "Green" } elseif ($ms -lt 3000) { "Yellow" } else { "Red" }
    Write-Host "  $($timing.operation): ${ms}ms" -ForegroundColor $color
}

if ($issues.Count -eq 0) {
    Write-Host "`n✅ NO ISSUES DETECTED - System performing well" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n❌ ISSUES FOUND: $($issues.Count)" -ForegroundColor Red
    foreach ($issue in $issues) {
        Write-Host "  • $issue" -ForegroundColor Red
    }
    exit 1
}
