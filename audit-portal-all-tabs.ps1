param(
  [string]$BackendBase = 'https://h2s-backend.vercel.app/api',
  [string]$Email = 'tech@home2smart.com',
  [string]$Zip = '29649',
  [switch]$SendFeedback,
  [string]$FeedbackMessage = '[AUTOMATED AUDIT] portal_submit_feedback health check',
  [string]$OutFile = 'portal_audit_results.json'
)

$ErrorActionPreference = 'Stop'

Write-Host "=== AGGRESSIVE PORTAL AUDIT (ALL TABS) ===" -ForegroundColor Cyan
Write-Host "Backend: $BackendBase" -ForegroundColor Gray
Write-Host "Auth: $Email ($Zip)" -ForegroundColor Gray
Write-Host "SendFeedback: $SendFeedback" -ForegroundColor Gray
Write-Host "" 

function Invoke-JsonPost {
  param(
    [Parameter(Mandatory=$true)][string]$Url,
    [Parameter(Mandatory=$true)][hashtable]$Body
  )
  $json = $Body | ConvertTo-Json -Depth 20
  return Invoke-RestMethod -Uri $Url -Method POST -ContentType 'application/json' -Body $json -TimeoutSec 30
}

function Invoke-JsonGet {
  param(
    [Parameter(Mandatory=$true)][string]$Url
  )
  return Invoke-RestMethod -Uri $Url -Method GET -ContentType 'application/json' -TimeoutSec 30
}

function Build-QueryString {
  param([hashtable]$Params)
  $pairs = @()
  foreach ($k in $Params.Keys) {
    $v = $Params[$k]
    if ($null -ne $v -and "$v".Length -gt 0) {
      $pairs += ("{0}={1}" -f [System.Uri]::EscapeDataString($k), [System.Uri]::EscapeDataString([string]$v))
    }
  }
  if ($pairs.Count -eq 0) { return '' }
  return ('?' + ($pairs -join '&'))
}

function Portal-Call {
  param(
    [Parameter(Mandatory=$true)][string]$Action,
    [Parameter(Mandatory=$true)][ValidateSet('GET','POST')][string]$Method,
    [hashtable]$Payload = @{},
    [string]$Note = ''
  )

  $url = "$BackendBase/$Action"

  try {
    $result = $null
    if ($Method -eq 'POST') {
      $result = Invoke-JsonPost -Url $url -Body $Payload
    } else {
      $qs = Build-QueryString $Payload
      $result = Invoke-JsonGet -Url ($url + $qs)
    }
    return @{ ok = $true; method = $Method; action = $Action; url = $url; note = $Note; result = $result }
  } catch {
    $msg = $_.Exception.Message
    return @{ ok = $false; method = $Method; action = $Action; url = $url; note = $Note; error = $msg }
  }
}

# Login (portal uses POST /api/portal_login with JSON body)
Write-Host "[AUTH] Logging in..." -ForegroundColor Yellow
$login = Portal-Call -Action 'portal_login' -Method 'POST' -Payload @{ email = $Email; zip = $Zip } -Note 'portal_login'
if (-not $login.ok -or -not $login.result.token) {
  Write-Host "❌ Login failed" -ForegroundColor Red
  if ($login.error) { Write-Host "  Error: $($login.error)" -ForegroundColor DarkRed }
  if ($login.result) { Write-Host ("  Response: " + ($login.result | ConvertTo-Json -Depth 6)) -ForegroundColor DarkGray }
  exit 1
}
$token = $login.result.token
Write-Host "  ✅ Token acquired" -ForegroundColor Green

# Results tracker
$results = [ordered]@{
  meta = [ordered]@{
    backend = $BackendBase
    email = $Email
    zip = $Zip
    when_utc = (Get-Date).ToUniversalTime().ToString('o')
  }
  tabs = [ordered]@{
    Dashboard = [ordered]@{}
    Customers = [ordered]@{}
    Schedule = [ordered]@{}
    Payouts = [ordered]@{}
    Reviews = [ordered]@{}
    Training = [ordered]@{}
    Feedback = [ordered]@{}
    Account = [ordered]@{}
  }
  extra = [ordered]@{
    BackendHealth = [ordered]@{}
    CustomerPhotos = [ordered]@{}
  }
}

# Backend health/build-id (non-tab but critical)
$results.extra.BackendHealth.health = Portal-Call -Action 'health' -Method 'GET' -Payload @{ _cb = [int][double]::Parse((Get-Date -UFormat %s)) } -Note 'api/health'
$results.extra.BackendHealth.build_id = Portal-Call -Action 'build-id' -Method 'GET' -Payload @{ _cb = [int][double]::Parse((Get-Date -UFormat %s)) } -Note 'api/build-id'

# 1) DASHBOARD
Write-Host "[1/8] DASHBOARD" -ForegroundColor Cyan
$dash = Portal-Call -Action 'portal_jobs' -Method 'POST' -Payload @{ token = $token } -Note 'portal_jobs'
$results.tabs.Dashboard.portal_jobs = $dash
if ($dash.ok -and $dash.result) {
  $offers = @($dash.result.offers)
  $upcoming = @($dash.result.upcoming)
  $completed = @($dash.result.completed)
  $results.tabs.Dashboard.offers_count = $offers.Count
  $results.tabs.Dashboard.upcoming_count = $upcoming.Count
  $results.tabs.Dashboard.completed_count = $completed.Count

  Write-Host "  ✅ portal_jobs ok" -ForegroundColor Green
  Write-Host "  Offers: $($offers.Count) | Upcoming: $($upcoming.Count) | Completed: $($completed.Count)" -ForegroundColor Gray

  $sampleJob = $null
  if ($offers.Count -gt 0) { $sampleJob = $offers[0] }
  elseif ($upcoming.Count -gt 0) { $sampleJob = $upcoming[0] }
  elseif ($completed.Count -gt 0) { $sampleJob = $completed[0] }

  if ($sampleJob) {
    $j = $sampleJob
    $results.tabs.Dashboard.sample = [ordered]@{
      job_id = $j.job_id
      service_title = $j.service_title
      description = $j.description
      line_items_type = if ($null -eq $j.line_items) { 'null' } else { $j.line_items.GetType().FullName }
      line_items_count = if ($j.line_items -and ($j.line_items -is [System.Collections.IEnumerable]) -and ($j.line_items -isnot [string])) { @($j.line_items).Count } else { 0 }
      scheduled_date = $j.scheduled_date
      due_at = $j.due_at
      address = $j.service_address
      city = $j.service_city
      state = $j.service_state
      zip = $j.service_zip
      bucket = if ($offers.Count -gt 0 -and $j.job_id -eq $offers[0].job_id) { 'offers' } elseif ($upcoming.Count -gt 0 -and $j.job_id -eq $upcoming[0].job_id) { 'upcoming' } else { 'completed' }
    }

    # Extra: test customer_photos auth against a real job (this has produced 403 in the UI)
    if ($j.job_id) {
      $photos = Portal-Call -Action 'customer_photos' -Method 'GET' -Payload @{ token = $token; job_id = $j.job_id } -Note 'customer_photos'
      $results.extra.CustomerPhotos.sample_job_id = $j.job_id
      $results.extra.CustomerPhotos.call = $photos
    }
  }
} else {
  Write-Host "  ❌ portal_jobs failed" -ForegroundColor Red
  if ($dash.error) { Write-Host "  Error: $($dash.error)" -ForegroundColor DarkRed }
}

# 2) CUSTOMERS
Write-Host "[2/8] CUSTOMERS" -ForegroundColor Cyan
$cust = Portal-Call -Action 'portal_customers' -Method 'GET' -Payload @{ token = $token } -Note 'portal_customers'
$hist = Portal-Call -Action 'portal_customer_history' -Method 'GET' -Payload @{ token = $token } -Note 'portal_customer_history'
$results.tabs.Customers.portal_customers = $cust
$results.tabs.Customers.portal_customer_history = $hist
if ($cust.ok -and $cust.result) { $results.tabs.Customers.customer_count = @($cust.result.customers).Count }
if ($hist.ok -and $hist.result) { $results.tabs.Customers.customer_history_count = @($hist.result.customers).Count }
if ($cust.ok) { Write-Host "  ✅ portal_customers ok" -ForegroundColor Green } else { Write-Host "  ❌ portal_customers failed: $($cust.error)" -ForegroundColor Red }
if ($hist.ok) { Write-Host "  ✅ portal_customer_history ok" -ForegroundColor Green } else { Write-Host "  ❌ portal_customer_history failed: $($hist.error)" -ForegroundColor Red }

# 3) SCHEDULE
Write-Host "[3/8] SCHEDULE" -ForegroundColor Cyan
$availGet = Portal-Call -Action 'portal_availability' -Method 'GET' -Payload @{ token = $token; action = 'get' } -Note 'portal_availability(get)'
$results.tabs.Schedule.portal_availability_get = $availGet
if ($availGet.ok) { Write-Host "  ✅ portal_availability(get) ok" -ForegroundColor Green } else { Write-Host "  ❌ portal_availability(get) failed: $($availGet.error)" -ForegroundColor Red }

# 4) PAYOUTS
Write-Host "[4/8] PAYOUTS" -ForegroundColor Cyan
$payouts = Portal-Call -Action 'portal_payouts' -Method 'GET' -Payload @{ token = $token } -Note 'portal_payouts'
$instant = Portal-Call -Action 'portal_instant_withdrawals' -Method 'GET' -Payload @{ token = $token } -Note 'portal_instant_withdrawals'
$results.tabs.Payouts.portal_payouts = $payouts
$results.tabs.Payouts.portal_instant_withdrawals = $instant
if ($payouts.ok -and $payouts.result) { $results.tabs.Payouts.payout_rows = @($payouts.result.rows).Count }
if ($instant.ok -and $instant.result) { $results.tabs.Payouts.withdrawal_rows = @($instant.result.rows).Count }
if ($payouts.ok) { Write-Host "  ✅ portal_payouts ok" -ForegroundColor Green } else { Write-Host "  ❌ portal_payouts failed: $($payouts.error)" -ForegroundColor Red }
if ($instant.ok) { Write-Host "  ✅ portal_instant_withdrawals ok" -ForegroundColor Green } else { Write-Host "  ❌ portal_instant_withdrawals failed: $($instant.error)" -ForegroundColor Red }

# 5) REVIEWS
Write-Host "[5/8] REVIEWS" -ForegroundColor Cyan
$reviews = Portal-Call -Action 'portal_reviews_get' -Method 'GET' -Payload @{ token = $token } -Note 'portal_reviews_get'
$results.tabs.Reviews.portal_reviews_get = $reviews
if ($reviews.ok -and $reviews.result) { $results.tabs.Reviews.review_count = @($reviews.result.reviews).Count }
if ($reviews.ok) { Write-Host "  ✅ portal_reviews_get ok" -ForegroundColor Green } else { Write-Host "  ❌ portal_reviews_get failed: $($reviews.error)" -ForegroundColor Red }

# 6) TRAINING
Write-Host "[6/8] TRAINING" -ForegroundColor Cyan
$training = Portal-Call -Action 'portal_training' -Method 'GET' -Payload @{ token = $token; action = 'catalog' } -Note 'portal_training(catalog)'
$results.tabs.Training.portal_training_catalog = $training
if ($training.ok -and $training.result) {
  $results.tabs.Training.video_count = if ($training.result.videos) { @($training.result.videos).Count } else { $null }
}
if ($training.ok) { Write-Host "  ✅ portal_training(catalog) ok" -ForegroundColor Green } else { Write-Host "  ❌ portal_training(catalog) failed: $($training.error)" -ForegroundColor Red }

# 7) SUBMIT FEEDBACK
Write-Host "[7/8] SUBMIT FEEDBACK" -ForegroundColor Cyan
if ($SendFeedback) {
  $feedback = Portal-Call -Action 'portal_submit_feedback' -Method 'POST' -Payload @{ token = $token; message = $FeedbackMessage } -Note 'portal_submit_feedback(POST)'
  $results.tabs.Feedback.portal_submit_feedback = $feedback
  if ($feedback.ok) { Write-Host "  ✅ portal_submit_feedback ok" -ForegroundColor Green } else { Write-Host "  ❌ portal_submit_feedback failed: $($feedback.error)" -ForegroundColor Red }
} else {
  $results.tabs.Feedback.note = 'Skipped POST to avoid creating real feedback. Run with -SendFeedback to test endpoint.'
  Write-Host "  ⚠️ skipped POST (use -SendFeedback to test)" -ForegroundColor Yellow
}

# 8) ACCOUNT
Write-Host "[8/8] ACCOUNT" -ForegroundColor Cyan
$me = Portal-Call -Action 'portal_me' -Method 'GET' -Payload @{ token = $token } -Note 'portal_me'
$results.tabs.Account.portal_me = $me
if ($me.ok) { Write-Host "  ✅ portal_me ok" -ForegroundColor Green } else { Write-Host "  ❌ portal_me failed: $($me.error)" -ForegroundColor Red }

Write-Host "" 
Write-Host "=== AUDIT SUMMARY (API-level) ===" -ForegroundColor Cyan

function Summarize-Call($call) {
  if ($null -eq $call) { return 'missing' }
  if ($call.ok -eq $true) { return 'ok' }
  if ($call.error -match '404') { return '404' }
  return 'error'
}

$tabStatuses = [ordered]@{}
$tabStatuses.Dashboard = Summarize-Call $results.tabs.Dashboard.portal_jobs
$tabStatuses.Customers = (Summarize-Call $results.tabs.Customers.portal_customers) + '/' + (Summarize-Call $results.tabs.Customers.portal_customer_history)
$tabStatuses.Schedule = Summarize-Call $results.tabs.Schedule.portal_availability_get
$tabStatuses.Payouts = (Summarize-Call $results.tabs.Payouts.portal_payouts) + '/' + (Summarize-Call $results.tabs.Payouts.portal_instant_withdrawals)
$tabStatuses.Reviews = Summarize-Call $results.tabs.Reviews.portal_reviews_get
$tabStatuses.Training = Summarize-Call $results.tabs.Training.portal_training_catalog
$tabStatuses.Feedback = if ($SendFeedback) { Summarize-Call $results.tabs.Feedback.portal_submit_feedback } else { 'skipped' }
$tabStatuses.Account = Summarize-Call $results.tabs.Account.portal_me

$tabStatuses.GetEnumerator() | ForEach-Object {
  $k = $_.Key
  $v = $_.Value
  $color = if ($v -match 'error') { 'Red' } elseif ($v -match '404') { 'Yellow' } else { 'Green' }
  Write-Host ("  {0}: {1}" -f $k, $v) -ForegroundColor $color
}

# Save JSON
$results | ConvertTo-Json -Depth 30 | Out-File $OutFile -Encoding UTF8
Write-Host "" 
Write-Host "Saved detailed results to: $OutFile" -ForegroundColor Cyan
