# COMPREHENSIVE SYSTEM AUDIT
# This script audits the entire checkout ecosystem like a paranoid security researcher

$ErrorActionPreference = "Continue"
$apiUrl = "https://h2s-backend.vercel.app/api/shop"

Write-Host @"

╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║          COMPREHENSIVE CHECKOUT SYSTEM AUDIT                   ║
║          Running like a paranoid security researcher           ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝

"@ -ForegroundColor Red

$issues = @()
$warnings = @()
$passed = @()

function Test-Scenario {
    param(
        [string]$Name,
        [scriptblock]$Test,
        [string]$Category = "GENERAL"
    )
    
    Write-Host "`n[$Category] $Name" -ForegroundColor Yellow
    Write-Host ("=" * 70) -ForegroundColor DarkGray
    
    try {
        $result = & $Test
        if ($result.success) {
            Write-Host "✅ PASS" -ForegroundColor Green
            $script:passed += $Name
        } elseif ($result.warning) {
            Write-Host "⚠️  WARNING: $($result.message)" -ForegroundColor Yellow
            $script:warnings += @{ test = $Name; message = $result.message }
        } else {
            Write-Host "❌ FAIL: $($result.message)" -ForegroundColor Red
            $script:issues += @{ test = $Name; message = $result.message; category = $Category }
        }
        return $result
    } catch {
        Write-Host "❌ EXCEPTION: $($_.Exception.Message)" -ForegroundColor Red
        $script:issues += @{ test = $Name; message = $_.Exception.Message; category = $Category }
        return @{ success = $false; message = $_.Exception.Message }
    }
}

function Invoke-Checkout {
    param($email, $name = "Test", $phone = "555-0100")
    
    $body = @{
        __action = "create_checkout_session"
        customer = @{
            email = $email
            name = $name
            phone = $phone
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
    
    return Invoke-RestMethod -Uri $apiUrl -Method POST -Body $body -ContentType "application/json" -TimeoutSec 30
}

# ============================================
# CATEGORY 1: BASIC FUNCTIONALITY
# ============================================

Test-Scenario -Name "Single customer checkout" -Category "BASIC" -Test {
    $email = "audit-basic-$(Get-Random)@test.com"
    $result = Invoke-Checkout -email $email
    
    if ($result.ok -and $result.order_id -and $result.job_id) {
        return @{ success = $true }
    } else {
        return @{ success = $false; message = "Missing order_id or job_id" }
    }
}

Start-Sleep 2

Test-Scenario -Name "Repeat customer (same email)" -Category "BASIC" -Test {
    $email = "audit-repeat-$(Get-Random)@test.com"
    $r1 = Invoke-Checkout -email $email
    Start-Sleep 2
    $r2 = Invoke-Checkout -email $email
    
    if ($r1.ok -and $r2.ok -and $r1.order_id -ne $r2.order_id) {
        return @{ success = $true }
    } else {
        return @{ success = $false; message = "Repeat customer failed or same order_id" }
    }
}

Start-Sleep 2

# ============================================
# CATEGORY 2: ORDER ID INTEGRITY
# ============================================

Test-Scenario -Name "Order IDs are unique across rapid requests" -Category "ORDER_ID" -Test {
    $email = "audit-rapid-$(Get-Random)@test.com"
    $orders = @()
    
    for ($i = 0; $i -lt 3; $i++) {
        $result = Invoke-Checkout -email "$email-$i"
        $orders += $result.order_id
        Start-Sleep 1
    }
    
    $unique = $orders | Select-Object -Unique
    if ($unique.Count -eq $orders.Count) {
        return @{ success = $true }
    } else {
        return @{ success = $false; message = "Found duplicate order IDs: $($orders -join ', ')" }
    }
}

Start-Sleep 2

Test-Scenario -Name "Order IDs have correct format (ORD-XXXX)" -Category "ORDER_ID" -Test {
    $result = Invoke-Checkout -email "audit-format-$(Get-Random)@test.com"
    
    if ($result.order_id -match '^ORD-[A-Z0-9]+$') {
        return @{ success = $true }
    } else {
        return @{ success = $false; message = "Invalid order_id format: $($result.order_id)" }
    }
}

Start-Sleep 2

Test-Scenario -Name "Order IDs are NOT deterministic (should vary)" -Category "ORDER_ID" -Test {
    $email = "audit-deterministic@test.com"
    $r1 = Invoke-Checkout -email $email
    Start-Sleep 5  # Wait past any time bucket
    $r2 = Invoke-Checkout -email $email
    
    if ($r1.order_id -ne $r2.order_id) {
        return @{ success = $true }
    } else {
        return @{ success = $false; message = "Order IDs are deterministic! Both = $($r1.order_id)" }
    }
}

Start-Sleep 2

# ============================================
# CATEGORY 3: JOB CREATION INTEGRITY
# ============================================

Test-Scenario -Name "Job ID exists for every order" -Category "JOB" -Test {
    $results = @()
    for ($i = 0; $i -lt 3; $i++) {
        $r = Invoke-Checkout -email "audit-job-$i-$(Get-Random)@test.com"
        $results += @{ order = $r.order_id; job = $r.job_id; has_job = ![string]::IsNullOrEmpty($r.job_id) }
        Start-Sleep 1
    }
    
    $missing = $results | Where-Object { !$_.has_job }
    if ($missing.Count -eq 0) {
        return @{ success = $true }
    } else {
        return @{ success = $false; message = "Found orders without jobs: $($missing.order)" }
    }
}

Start-Sleep 2

Test-Scenario -Name "Job IDs are UUID format" -Category "JOB" -Test {
    $result = Invoke-Checkout -email "audit-job-uuid-$(Get-Random)@test.com"
    
    if ($result.job_id -match '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') {
        return @{ success = $true }
    } else {
        return @{ success = $false; message = "Invalid job_id format: $($result.job_id)" }
    }
}

Start-Sleep 2

Test-Scenario -Name "Same recipient can have multiple jobs" -Category "JOB" -Test {
    $email = "audit-multi-job-$(Get-Random)@test.com"
    $r1 = Invoke-Checkout -email $email
    Start-Sleep 2
    $r2 = Invoke-Checkout -email $email
    Start-Sleep 2
    $r3 = Invoke-Checkout -email $email
    
    if ($r1.job_id -and $r2.job_id -and $r3.job_id -and 
        $r1.job_id -ne $r2.job_id -and $r2.job_id -ne $r3.job_id) {
        return @{ success = $true }
    } else {
        return @{ success = $false; message = "Multiple jobs for same recipient failed" }
    }
}

Start-Sleep 2

# ============================================
# CATEGORY 4: EDGE CASES & ERROR HANDLING
# ============================================

Test-Scenario -Name "Empty email rejection" -Category "VALIDATION" -Test {
    try {
        $body = @{
            __action = "create_checkout_session"
            customer = @{ email = ""; name = "Test"; phone = "555-0100" }
            cart = @(@{ bundle_id = "bnd-welcome-to-h2s"; name = "Test"; price = 999; quantity = 1 })
            promotion_code = ""
            success_url = "https://example.com/success"
            cancel_url = "https://example.com/cancel"
        } | ConvertTo-Json -Depth 10
        
        $result = Invoke-RestMethod -Uri $apiUrl -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop
        return @{ success = $false; message = "Should have rejected empty email!" }
    } catch {
        # Should throw 400 error
        if ($_.Exception.Response.StatusCode -eq 400) {
            return @{ success = $true }
        } else {
            return @{ success = $false; message = "Wrong error code: $($_.Exception.Response.StatusCode)" }
        }
    }
}

Test-Scenario -Name "Invalid email format" -Category "VALIDATION" -Test {
    try {
        $body = @{
            __action = "create_checkout_session"
            customer = @{ email = "not-an-email"; name = "Test"; phone = "555-0100" }
            cart = @(@{ bundle_id = "bnd-welcome-to-h2s"; name = "Test"; price = 999; quantity = 1 })
            promotion_code = ""
            success_url = "https://example.com/success"
            cancel_url = "https://example.com/cancel"
        } | ConvertTo-Json -Depth 10
        
        $result = Invoke-RestMethod -Uri $apiUrl -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop
        
        # Some systems allow this, so it's a warning not a failure
        return @{ warning = $true; message = "System allows invalid email format" }
    } catch {
        return @{ success = $true }  # Correctly rejected
    }
}

Test-Scenario -Name "Empty cart rejection" -Category "VALIDATION" -Test {
    try {
        $body = @{
            __action = "create_checkout_session"
            customer = @{ email = "test@test.com"; name = "Test"; phone = "555-0100" }
            cart = @()  # Empty cart
            promotion_code = ""
            success_url = "https://example.com/success"
            cancel_url = "https://example.com/cancel"
        } | ConvertTo-Json -Depth 10
        
        $result = Invoke-RestMethod -Uri $apiUrl -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop
        return @{ success = $false; message = "Should have rejected empty cart!" }
    } catch {
        if ($_.Exception.Response.StatusCode -eq 400) {
            return @{ success = $true }
        } else {
            return @{ success = $false; message = "Wrong error code" }
        }
    }
}

# ============================================
# CATEGORY 5: PERFORMANCE & RELIABILITY
# ============================================

Test-Scenario -Name "Response time < 10 seconds" -Category "PERFORMANCE" -Test {
    $start = Get-Date
    $result = Invoke-Checkout -email "audit-perf-$(Get-Random)@test.com"
    $elapsed = ((Get-Date) - $start).TotalSeconds
    
    Write-Host "  Response time: $([math]::Round($elapsed, 2))s" -ForegroundColor Gray
    
    if ($elapsed -lt 10) {
        return @{ success = $true }
    } elseif ($elapsed -lt 15) {
        return @{ warning = $true; message = "Slow response: $([math]::Round($elapsed, 2))s" }
    } else {
        return @{ success = $false; message = "Too slow: $([math]::Round($elapsed, 2))s" }
    }
}

Start-Sleep 2

Test-Scenario -Name "Can handle 5 rapid requests" -Category "PERFORMANCE" -Test {
    $successes = 0
    $failures = 0
    
    for ($i = 0; $i -lt 5; $i++) {
        try {
            $r = Invoke-Checkout -email "audit-rapid-$i-$(Get-Random)@test.com"
            if ($r.ok) { $successes++ } else { $failures++ }
        } catch {
            $failures++
        }
    }
    
    Write-Host "  Successes: $successes, Failures: $failures" -ForegroundColor Gray
    
    if ($successes -eq 5) {
        return @{ success = $true }
    } elseif ($successes -ge 3) {
        return @{ warning = $true; message = "$failures failures out of 5" }
    } else {
        return @{ success = $false; message = "Too many failures: $failures out of 5" }
    }
}

Start-Sleep 2

# ============================================
# CATEGORY 6: STRIPE SESSION CHECKS
# ============================================

Test-Scenario -Name "Stripe session URL is present" -Category "STRIPE" -Test {
    $result = Invoke-Checkout -email "audit-stripe-$(Get-Random)@test.com"
    
    if ($result.pay -and $result.pay.session_url) {
        return @{ success = $true }
    } else {
        return @{ success = $false; message = "No Stripe session URL returned" }
    }
}

Start-Sleep 2

Test-Scenario -Name "Stripe session URL is valid format" -Category "STRIPE" -Test {
    $result = Invoke-Checkout -email "audit-stripe-url-$(Get-Random)@test.com"
    
    if ($result.pay.session_url -match '^https://checkout\.stripe\.com/') {
        return @{ success = $true }
    } else {
        return @{ success = $false; message = "Invalid Stripe URL: $($result.pay.session_url)" }
    }
}

Start-Sleep 2

Test-Scenario -Name "Stripe session ID is present" -Category "STRIPE" -Test {
    $result = Invoke-Checkout -email "audit-stripe-id-$(Get-Random)@test.com"
    
    if ($result.pay.session_id -match '^cs_') {
        return @{ success = $true }
    } else {
        return @{ success = $false; message = "Invalid or missing session_id" }
    }
}

# ============================================
# FINAL REPORT
# ============================================

Write-Host "`n`n" -NoNewline
Write-Host @"
╔════════════════════════════════════════════════════════════════╗
║                        AUDIT RESULTS                           ║
╚════════════════════════════════════════════════════════════════╝
"@ -ForegroundColor Red

Write-Host "`nPASSED: $($script:passed.Count)" -ForegroundColor Green
foreach ($test in $script:passed) {
    Write-Host "  ✅ $test" -ForegroundColor Green
}

if ($script:warnings.Count -gt 0) {
    Write-Host "`nWARNINGS: $($script:warnings.Count)" -ForegroundColor Yellow
    foreach ($warning in $script:warnings) {
        Write-Host "  ⚠️  $($warning.test)" -ForegroundColor Yellow
        Write-Host "     $($warning.message)" -ForegroundColor Gray
    }
}

if ($script:issues.Count -gt 0) {
    Write-Host "`nFAILURES: $($script:issues.Count)" -ForegroundColor Red
    foreach ($issue in $script:issues) {
        Write-Host "  ❌ [$($issue.category)] $($issue.test)" -ForegroundColor Red
        Write-Host "     $($issue.message)" -ForegroundColor Gray
    }
}

Write-Host "`n" -NoNewline
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Red

$totalTests = $script:passed.Count + $script:warnings.Count + $script:issues.Count
$score = [math]::Round(($script:passed.Count / $totalTests) * 100, 1)

Write-Host "`nSCORE: $score% ($($script:passed.Count)/$totalTests tests passed)" -ForegroundColor $(if ($score -ge 90) { "Green" } elseif ($score -ge 70) { "Yellow" } else { "Red" })

if ($script:issues.Count -eq 0 -and $script:warnings.Count -eq 0) {
    Write-Host "`n✅ SYSTEM IS ROCK SOLID - NO ISSUES FOUND" -ForegroundColor Green
    exit 0
} elseif ($script:issues.Count -eq 0) {
    Write-Host "`n⚠️  SYSTEM IS FUNCTIONAL - MINOR WARNINGS" -ForegroundColor Yellow
    exit 0
} else {
    Write-Host "`n❌ SYSTEM HAS CRITICAL ISSUES - FIX REQUIRED" -ForegroundColor Red
    exit 1
}
