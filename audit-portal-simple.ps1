# Simple Portal & Save Audit
param()

$apiUrl = "https://h2s-backend.vercel.app/api"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  PORTAL & SAVE AUDIT" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$issues = @()

# 1. Check portal for broken characters
Write-Host "[1/3] Checking portal.html for broken characters..." -ForegroundColor Yellow
$portal = Get-Content "frontend\portal.html" -Raw
if ($portal -match '\s\?\s\$\{') {
    Write-Host "  FAIL: Found question marks where bullets should be" -ForegroundColor Red
    $issues += "Broken characters in portal.html"
} else {
    Write-Host "  PASS: No obvious broken characters" -ForegroundColor Green
}

# 2. Test checkout + job creation
Write-Host "`n[2/3] Testing checkout performance..." -ForegroundColor Yellow
$email = "audit-$(Get-Random)@test.com"
$start = Get-Date

$body = @{
    __action = "create_checkout_session"
    customer = @{ email = $email; name = "Test"; phone = "555-0100" }
    cart = @(@{ bundle_id = "bnd-welcome-to-h2s"; name = "Test"; price = 999; quantity = 1 })
    promotion_code = ""
    success_url = "https://test.com"
    cancel_url = "https://test.com"
} | ConvertTo-Json -Depth 10

$checkout = Invoke-RestMethod -Uri "$apiUrl/shop" -Method POST -Body $body -ContentType "application/json"
$checkoutTime = ((Get-Date) - $start).TotalMilliseconds

Write-Host "  Checkout time: $([math]::Round($checkoutTime))ms" -ForegroundColor Gray

if (!$checkout.ok) {
    Write-Host "  FAIL: Checkout failed" -ForegroundColor Red
    $issues += "Checkout failed"
} elseif (!$checkout.job_id) {
    Write-Host "  FAIL: No job_id returned" -ForegroundColor Red
    $issues += "Missing job_id"
} else {
    Write-Host "  PASS: Order $($checkout.order_id) with job $($checkout.job_id)" -ForegroundColor Green
}

# 3. Test schedule save
if ($checkout.job_id) {
    Write-Host "`n[3/3] Testing schedule save..." -ForegroundColor Yellow
    
    $scheduleDate = (Get-Date).AddDays(3).ToString("yyyy-MM-dd")
    $start = Get-Date
    
    $scheduleBody = @{
        order_id = $checkout.order_id
        scheduled_iso = "$scheduleDate`T10:00:00-05:00"
        timezone = "America/New_York"
        time_window = "9am - 12pm"
    } | ConvertTo-Json
    
    try {
        $result = Invoke-RestMethod -Uri "$apiUrl/customer_reschedule" -Method POST -Body $scheduleBody -ContentType "application/json" -TimeoutSec 20
        $saveTime = ((Get-Date) - $start).TotalMilliseconds
        
        Write-Host "  Save time: $([math]::Round($saveTime))ms" -ForegroundColor Gray
        
        if ($result.ok) {
            if ($saveTime -gt 5000) {
                Write-Host "  WARNING: Save is slow ($([math]::Round($saveTime/1000, 1))s)" -ForegroundColor Yellow
            } else {
                Write-Host "  PASS: Schedule saved" -ForegroundColor Green
            }
            
            # Verify it persisted
            Start-Sleep 2
            $orderBody = @{ customer_email = $email } | ConvertTo-Json
            $orders = Invoke-RestMethod -Uri "$apiUrl/customer_orders" -Method POST -Body $orderBody -ContentType "application/json"
            
            if ($orders.orders[0].installation_date) {
                Write-Host "  PASS: Schedule persisted to database" -ForegroundColor Green
            } else {
                Write-Host "  FAIL: Schedule NOT persisted (silent failure)" -ForegroundColor Red
                $issues += "Schedule silent failure"
            }
        } else {
            Write-Host "  FAIL: Schedule save returned ok=false" -ForegroundColor Red
            $issues += "Schedule save failed"
        }
    } catch {
        $saveTime = ((Get-Date) - $start).TotalMilliseconds
        Write-Host "  FAIL: Exception after $([math]::Round($saveTime))ms" -ForegroundColor Red
        Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Red
        
        if ($saveTime -gt 15000) {
            Write-Host "  CRITICAL: Timeout detected (silent failure risk)" -ForegroundColor Red
            $issues += "Schedule timeout"
        }
    }
}

Write-Host "`n========================================" -ForegroundColor Cyan
if ($issues.Count -eq 0) {
    Write-Host "  RESULT: ALL TESTS PASSED" -ForegroundColor Green
} else {
    Write-Host "  RESULT: $($issues.Count) ISSUES FOUND" -ForegroundColor Red
    foreach ($issue in $issues) {
        Write-Host "  - $issue" -ForegroundColor Red
    }
}
Write-Host "========================================`n" -ForegroundColor Cyan
