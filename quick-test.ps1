$backendUrl = "https://backend-kk96scq2m-tabari-ropers-projects-6f2e090b.vercel.app"

Write-Host "`nCreating pro account..." -ForegroundColor Cyan
$email = "test-$(Get-Random)@example.com"
$body = "{`"email`":`"$email`",`"name`":`"Test User`",`"phone`":`"+15551234567`",`"address`":`"123 Test St`",`"city`":`"Test City`",`"state`":`"TX`",`"zip`":`"12345`"}"
$signup = Invoke-RestMethod -Uri "$backendUrl/api/portal_signup_step1" -Method POST -Body $body -ContentType "application/json"
Write-Host "✓ Pro ID: $($signup.pro_id)" -ForegroundColor Green

Write-Host "`nFetching jobs..." -ForegroundColor Cyan
$headers = @{"Authorization" = "Bearer $($signup.token)"}
$jobs = Invoke-RestMethod -Uri "$backendUrl/api/portal_jobs" -Method GET -Headers $headers
Write-Host "✓ SUCCESS! Jobs: $($jobs.jobs.Count)" -ForegroundColor Green
