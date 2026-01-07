$backendUrl = "https://backend-kk96scq2m-tabari-ropers-projects-6f2e090b.vercel.app"

Write-Host "`n========== TESTING COMPLETE PORTAL FLOW ==========" -ForegroundColor Cyan

# Step 1: Create pro account
Write-Host "`n1. Creating new pro account..." -ForegroundColor Yellow
$signupData = @{
  email = "flow-test-$(Get-Random)@example.com"
  name = "Flow Test Pro"
  phone = "+15551234567"
  address = "123 Test St"
  city = "Test City"
  state = "TX"
  zip = "12345"
} | ConvertTo-Json

$signup = Invoke-RestMethod -Uri "$backendUrl/api/portal_signup_step1" -Method POST -Body $signupData -ContentType "application/json"
Write-Host "   ✓ Pro created: $($signup.pro_id)" -ForegroundColor Green

# Step 2: Fetch jobs
Write-Host "`n2. Fetching available jobs..." -ForegroundColor Yellow
$headers = @{ "Authorization" = "Bearer $($signup.token)" }
try {
  $jobs = Invoke-RestMethod -Uri "$backendUrl/api/portal_jobs" -Method GET -Headers $headers
  Write-Host "   ✓ SUCCESS! Portal jobs endpoint working!" -ForegroundColor Green
  Write-Host "   ✓ Jobs fetched: $($jobs.jobs.Count) jobs" -ForegroundColor Green
  if ($jobs.jobs.Count -gt 0) {
    Write-Host "   ✓ First job ID: $($jobs.jobs[0].job_id)" -ForegroundColor Green
  }
}
catch {
  Write-Host "   ✗ FAILED: $($_.Exception.Message)" -ForegroundColor Red
  if ($_.ErrorDetails) {
    $errorObj = $_.ErrorDetails.Message | ConvertFrom-Json
    Write-Host "   Error: $($errorObj.error)" -ForegroundColor Yellow
    if ($errorObj.details) {
      Write-Host "   Details: $($errorObj.details)" -ForegroundColor Yellow
    }
  }
}

Write-Host "`n========== FLOW TEST COMPLETE ==========" -ForegroundColor Cyan
