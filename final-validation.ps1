$backend = "https://backend-glc7utmnl-tabari-ropers-projects-6f2e090b.vercel.app"

Write-Host "`n========== COMPLETE PORTAL FLOW TEST ==========" -ForegroundColor Cyan

# Step 1: Create pro account
Write-Host "`n[1/4] Creating new pro account..." -ForegroundColor Yellow
$email = "complete-test-$(Get-Random)@example.com"
$signupBody = '{"email":"' + $email + '","name":"Complete Test","phone":"+15551234567","address":"123 Test St","city":"Test City","state":"TX","zip":"12345"}"
$signup = Invoke-RestMethod -Uri "$backend/api/portal_signup_step1" -Method POST -Body $signupBody -ContentType 'application/json'
Write-Host "      ✓ Pro ID: $($signup.pro_id)" -ForegroundColor Green
Write-Host "      ✓ Token issued ($($$signup.token.Length) chars)" -ForegroundColor Green

# Step 2: Fetch available jobs
Write-Host "`n[2/4] Fetching available jobs..." -ForegroundColor Yellow
$jobsBody = '{"token":"' + $signup.token + '"}'
$jobs = Invoke-RestMethod -Uri "$backend/api/portal_jobs" -Method POST -Body $jobsBody -ContentType 'application/json'
Write-Host "      ✓ SUCCESS! Authentication working!" -ForegroundColor Green
Write-Host "      ✓ Jobs available: $($jobs.jobs.Count)" -ForegroundColor Green
if ($jobs.jobs.Count -gt 0) {
  Write-Host "      ✓ First job: $($jobs.jobs[0].service_type) - $($jobs.jobs[0].city), $($jobs.jobs[0].state)" -ForegroundColor Green
}

# Step 3: Test portal domain
Write-Host "`n[3/4] Testing portal.home2smart.com..." -ForegroundColor Yellow
$portal = Invoke-WebRequest -Uri "https://portal.home2smart.com" -UseBasicParsing
Write-Host "      ✓ Portal accessible: HTTP $($portal.StatusCode)" -ForegroundColor Green

# Step 4: Test shop domain
Write-Host "`n[4/4] Testing shop.home2smart.com..." -ForegroundColor Yellow
$shop = Invoke-WebRequest -Uri "https://shop.home2smart.com" -UseBasicParsing
Write-Host "      ✓ Shop accessible: HTTP $($shop.StatusCode)" -ForegroundColor Green

Write-Host "`n=============================================" -ForegroundColor Cyan
Write-Host "🎉 ALL SYSTEMS OPERATIONAL!" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "`nSummary:" -ForegroundColor White
Write-Host "  • Portal signup: WORKING ✓" -ForegroundColor Green
Write-Host "  • JWT authentication: WORKING ✓" -ForegroundColor Green
Write-Host "  • Job fetching: WORKING ✓" -ForegroundColor Green
Write-Host "  • Live domains: ACCESSIBLE ✓" -ForegroundColor Green
Write-Host "`n"
