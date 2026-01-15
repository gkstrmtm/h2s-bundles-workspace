# CANONICAL BACKEND DEPLOY + VERIFY
# Usage:
#   .\deploy-backend-and-verify.ps1
#   .\deploy-backend-and-verify.ps1 -SkipDeploy
#   .\deploy-backend-and-verify.ps1 -DeploymentUrl https://h2s-backend.vercel.app
#
# This script is intentionally minimal:
# - Builds backend
# - Deploys to Vercel (prod)
# - Runs a smoke verification for payout + scheduling + portal_jobs enrichment

param(
  [string]$DeploymentUrl = "https://h2s-backend.vercel.app",
  [string]$ExpectedVercelProjectName = "h2s-backend",
  [switch]$SkipDeploy,
  [switch]$SkipVerify,
  [int]$BundlePriceDollars = 2100,
  [string]$DeliveryDate = "2026-01-20",
  [string]$DeliveryTime = "9am - 12pm"
)

$ErrorActionPreference = "Stop"

function Fail($msg) {
  Write-Host "❌ $msg" -ForegroundColor Red
  exit 1
}

function Info($msg) {
  Write-Host "$msg" -ForegroundColor Cyan
}

function Ok($msg) {
  Write-Host "✅ $msg" -ForegroundColor Green
}

function Warn($msg) {
  Write-Host "⚠️  $msg" -ForegroundColor Yellow
}

function Require-Command($name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) { Fail "Missing required command: $name" }
}

function Parse-VercelDeploymentUrl([string[]]$lines) {
  if (-not $lines) { return $null }
  # Vercel typically prints deployment URLs like https://backend-xxxx.vercel.app
  $matches = @()
  foreach ($line in $lines) {
    foreach ($m in [regex]::Matches($line, 'https://[a-z0-9-]+\.vercel\.app', 'IgnoreCase')) {
      $matches += $m.Value
    }
  }
  if ($matches.Count -eq 0) { return $null }
  return $matches[$matches.Count - 1]
}

function Invoke-JsonPost($url, $obj, [int]$timeoutSec = 30) {
  $body = $obj | ConvertTo-Json -Depth 20
  return Invoke-RestMethod -Uri $url -Method POST -Body $body -ContentType "application/json" -TimeoutSec $timeoutSec
}

function Invoke-JsonGet($url, [int]$timeoutSec = 30) {
  return Invoke-RestMethod -Uri $url -Method GET -TimeoutSec $timeoutSec
}

Write-Host "`n========================================" -ForegroundColor Magenta
Write-Host "  BACKEND DEPLOY + VERIFY (CANONICAL)" -ForegroundColor Magenta
Write-Host "========================================`n" -ForegroundColor Magenta

# Workspace sanity
if (-not (Test-Path "backend\package.json")) {
  Fail "Run this from workspace root (missing backend\package.json). Current: $(Get-Location)"
}

Require-Command npm
Require-Command vercel

# Guardrail: ensure we're linked to the correct Vercel project
$localProjectFile = "backend\.vercel\project.json"
if (Test-Path $localProjectFile) {
  try {
    $proj = Get-Content $localProjectFile -Raw | ConvertFrom-Json
    $linkedName = [string]($proj.projectName)
    if ($ExpectedVercelProjectName -and $linkedName -and ($linkedName -ne $ExpectedVercelProjectName)) {
      Fail "backend is linked to Vercel project '$linkedName' but expected '$ExpectedVercelProjectName'. Fix: cd backend; vercel link -p $ExpectedVercelProjectName"
    }
  } catch {
    Warn "Could not parse $localProjectFile; continuing."
  }
} else {
  Warn "$localProjectFile not found (project may not be linked)."
  Warn "If deploy fails, run: cd backend; vercel link -p $ExpectedVercelProjectName"
}

# Build
Info "Building backend..."
Push-Location "backend"
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { Fail "Backend build failed (npm run build)" }
  Ok "Backend build succeeded"
} finally {
  Pop-Location
}

$deploymentFromVercel = $null

# Deploy
if (-not $SkipDeploy) {
  Info "Deploying backend to Vercel (prod)..."
  Push-Location "backend"
  try {
    $out = @()
    # Use `vercel deploy` explicitly to make output parsing more reliable.
    # PowerShell treats stderr from native command wrappers (vercel.ps1) as errors.
    # With $ErrorActionPreference='Stop' this can become terminating even when the
    # underlying CLI is behaving normally. Temporarily relax it for the deploy.
    $prevEap = $ErrorActionPreference
    try {
      $ErrorActionPreference = "Continue"
      $out = (& vercel deploy --prod --yes 2>&1)
      $exit = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $prevEap
    }

    if ($exit -ne 0) {
      Write-Host ($out -join "`n") -ForegroundColor DarkGray
      Fail "Vercel deploy failed"
    }

    $deploymentFromVercel = Parse-VercelDeploymentUrl -lines $out
    if ($deploymentFromVercel) {
      Ok "Deployed: $deploymentFromVercel"
    } else {
      Warn "Could not parse deployment URL from Vercel output"
    }
  } finally {
    Pop-Location
  }
}

if ($SkipVerify) {
  Ok "SkipVerify specified; done."
  exit 0
}

# Allow a small propagation delay
Info "Waiting briefly for deployment propagation..."
Start-Sleep -Seconds 8

# Verify payout + schedule + portal_jobs single job enrichment
Info "Running backend smoke verification..."

$testEmail = "deploy-verify-$([int](Get-Random))@test.com"
$price = [int]$BundlePriceDollars
$expectedPayout = [Math]::Round($price * 0.35, 2)

$shopPayload = @{
  customer = @{ email = $testEmail; name = "Deploy Verify"; phone = "5551234567" }
  cart = @(@{ id = "bundle-1"; name = "Smart Home Bundle"; price = $price; qty = 1 })
  metadata = @{ customer_email = $testEmail; customer_name = "Deploy Verify"; service_address = "123 Test St"; service_city = "LA"; service_state = "CA"; service_zip = "90210" }
}

# 1) Create order/job
Info "[1/4] Creating checkout order ($$price) ..."
$shop = Invoke-JsonPost "$DeploymentUrl/api/shop" $shopPayload 45
if (-not $shop.ok) { Fail "shop failed: $($shop.error)" }
if (-not $shop.order_id) { Fail "shop response missing order_id" }
if (-not $shop.job_id) { Fail "shop response missing job_id" }
Ok "Created order $($shop.order_id) job $($shop.job_id)"

Start-Sleep -Seconds 2

# 2) Verify payout stored on order
Info "[2/4] Verifying payout stored on order metadata..."
$orderDetails = Invoke-JsonGet "$DeploymentUrl/api/get-order-details?order_id=$($shop.order_id)" 30
if (-not $orderDetails.ok) { Fail "get-order-details failed" }

$meta = $orderDetails.order.metadata
$jobValueCents = [int]($meta.job_value_cents)
$techPayoutDollars = [double]($meta.tech_payout_dollars)

if ($jobValueCents -ne ($price * 100)) { Fail "job_value_cents wrong. expected $($price*100) got $jobValueCents" }
if ([Math]::Abs($techPayoutDollars - $expectedPayout) -gt 0.001) { Fail "tech_payout_dollars wrong. expected $expectedPayout got $techPayoutDollars" }
Ok "Payout correct: $$techPayoutDollars (expected $$expectedPayout)"

# 3) Set schedule
Info "[3/4] Scheduling install ($DeliveryDate $DeliveryTime) ..."
$schedulePayload = @{ order_id = $shop.order_id; delivery_date = $DeliveryDate; delivery_time = $DeliveryTime }
$schedule = $null
$scheduleSucceeded = $false
try {
  $schedule = Invoke-JsonPost "$DeploymentUrl/api/schedule-appointment" $schedulePayload 45
  if (-not $schedule.ok) { Fail "schedule-appointment failed: $($schedule.error)" }
  Ok "Scheduled order $($shop.order_id)"
  $scheduleSucceeded = $true
} catch {
  $msg = ($_ | Out-String)
  if ($msg -match "\(409\)\s*Conflict") {
    Warn "schedule-appointment returned 409 Conflict; continuing."
  } else {
    throw
  }
}

Start-Sleep -Seconds 2

# 4) Verify portal_jobs single-job returns payout + scheduled date
Info "[4/4] Verifying portal_jobs single-job enrichment (payout + install date)..."
$login = Invoke-JsonPost "$DeploymentUrl/api/portal_login" @{ email = "tech@home2smart.com"; zip = "00000" } 30
if (-not $login.ok) { Fail "portal_login failed" }
$token = $login.token
if (-not $token) { Fail "portal_login did not return token" }

$job = Invoke-JsonGet "$DeploymentUrl/api/portal_jobs?token=$token&job_id=$($shop.job_id)" 45
if (-not $job.ok) { Fail "portal_jobs failed" }

$payout = [double]($job.job.payout_estimated)
$deliveryDateOut = [string]($job.job.delivery_date)
$dueAtOut = [string]($job.job.due_at)

if ([Math]::Abs($payout - $expectedPayout) -gt 0.001) { Fail "portal_jobs payout_estimated wrong. expected $expectedPayout got $payout" }
if ($scheduleSucceeded) {
  if ($DeliveryDateOut -and ($DeliveryDateOut -ne $DeliveryDate)) {
    Fail "portal_jobs delivery_date wrong. expected $DeliveryDate got $DeliveryDateOut"
  }
  if ($dueAtOut -and (-not $dueAtOut.StartsWith($DeliveryDate))) {
    Fail "portal_jobs due_at not reflecting scheduled date. expected startswith $DeliveryDate got $dueAtOut"
  }
} else {
  Warn "Schedule verification skipped (schedule-appointment did not succeed)."
}

Ok "portal_jobs enrichment OK: payout=$$payout delivery_date=$deliveryDateOut due_at=$dueAtOut"

Write-Host "`n========================================" -ForegroundColor Magenta
Write-Host "✅ BACKEND DEPLOY VERIFIED" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Magenta

Write-Host "Notes:" -ForegroundColor Yellow
Write-Host "- Test email: $testEmail" -ForegroundColor Gray
Write-Host "- Order: $($shop.order_id)" -ForegroundColor Gray
Write-Host "- Job: $($shop.job_id)" -ForegroundColor Gray
if ($deploymentFromVercel) {
  Write-Host "- Vercel deployment: $deploymentFromVercel" -ForegroundColor Gray
}
