$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "Testing Backend API Endpoints..." -ForegroundColor Green

# Test 1: Meta Pixel Events
Write-Host "`n1. Testing /api/v1?action=meta_pixel_events" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/v1?action=meta_pixel_events&exclude_test=1" -Method GET -ErrorAction Stop
    Write-Host "STATUS: SUCCESS" -ForegroundColor Green
    Write-Host "Response Keys:" ($response.PSObject.Properties.Name -join ", ")
    
    if ($response.meta_pixel_events) {
        $summary = $response.meta_pixel_events.summary
        Write-Host "Total Events: $($summary.total_events)"
        Write-Host "Unique Users: $($summary.unique_users)"
        Write-Host "Event Types: $($summary.by_event_type.PSObject.Properties.Name -join ', ')"
    }
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: Revenue
Write-Host "`n2. Testing /api/v1?action=revenue" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/v1?action=revenue&exclude_test=1" -Method GET -ErrorAction Stop
    Write-Host "STATUS: SUCCESS" -ForegroundColor Green
    Write-Host "Total Orders: $($response.revenue.total_orders)"
    Write-Host "Total Revenue: $($response.revenue.total_revenue)"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 3: Funnel
Write-Host "`n3. Testing /api/v1?action=funnel" -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/v1?action=funnel&exclude_test=1" -Method GET -ErrorAction Stop
    Write-Host "STATUS: SUCCESS" -ForegroundColor Green
    Write-Host "Funnel Stages:" ($response.funnel.stage_distribution.PSObject.Properties.Name -join ", ")
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`nTest Complete!" -ForegroundColor Green
