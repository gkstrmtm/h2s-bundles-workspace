# CANONICAL BACKEND DEPLOY + VERIFY
# Usage:
#   .\deploy-backend-and-verify.ps1
#   .\deploy-backend-and-verify.ps1 -SkipDeploy
#   .\deploy-backend-and-verify.ps1 -SkipDeploy -RunMigrations
#   .\deploy-backend-and-verify.ps1 -SkipMigrations
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
  [switch]$SkipMigrations,
  # When running with -SkipDeploy (verify-only), migrations are skipped by default.
  # Use -RunMigrations to force applying migrations anyway.
  [switch]$RunMigrations,
  # Comma-separated list of migration files in backend/migrations.
  # Keep these idempotent (IF NOT EXISTS) so it's safe to re-run every deploy.
  [string]$MigrationFile = "007_create_dashboard_accounts.sql,008_create_offers.sql,009_alter_deliverables_add_metadata.sql,013_create_sms_inbox.sql,014_sms_inbox_sender_and_contacts.sql,015_create_sms_groups.sql,016_create_sms_hidden_conversations.sql,017_add_sms_messages_group_id.sql,018_add_tasks_assets.sql,019_training_asset_progress.sql,020_add_training_assets_meta.sql,021_training_asset_progress_video_fields.sql,022_training_asset_progress_add_video_id.sql,023_create_dashboard_messages.sql,024_add_tasks_available_from.sql,025_create_task_resources.sql",
  [int]$BundlePriceDollars = 2100,
  # UPDATED: Use dynamic date to avoid 409 conflicts on repeated runs
  [string]$DeliveryDate = (Get-Date).AddDays(2).ToString("yyyy-MM-dd"),
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

function Contains-EnvVar([string[]]$lines, [string]$name) {
  if (-not $lines -or -not $name) { return $false }
  foreach ($line in $lines) {
    if ($line -match ("^\s*" + [regex]::Escape($name) + "\s+")) { return $true }
    if ($line -match ("\b" + [regex]::Escape($name) + "\b")) { return $true }
  }
  return $false
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

function Normalize-Lines($out) {
  if ($null -eq $out) { return @() }
  if ($out -is [string[]]) { return $out }
  if ($out -is [string]) {
    return ($out -split "`r?`n")
  }
  try {
    return @($out | ForEach-Object { [string]$_ })
  } catch {
    return @([string]$out)
  }
}

function Output-Indicates-ExecSqlMissing([string[]]$lines) {
  if (-not $lines -or $lines.Count -eq 0) { return $false }
  $text = ($lines -join "\n")
  return (
    $text -match "exec_sql" -and (
      $text -match "does not exist" -or
      $text -match "Could not find the function" -or
      $text -match "schema cache" -or
      $text -match "PGRST" -or
      $text -match "not in the schema cache"
    )
  )
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

# Best-effort env sanity check (helps catch missing bootstrap + MGMT DB creds)
Info "Checking Vercel env vars (best-effort)..."
try {
  Push-Location "backend"
  $envOut = Normalize-Lines (cmd /c "vercel env ls 2>&1")
} catch {
  $envOut = @()
} finally {
  try { Pop-Location } catch {}
}

if ($envOut -and $envOut.Count -gt 0) {
  $hasMgmtUrl = Contains-EnvVar $envOut "SUPABASE_URL_MGMT"
  $hasMgmtKey = (Contains-EnvVar $envOut "SUPABASE_SERVICE_KEY_MGMT") -or (Contains-EnvVar $envOut "SUPABASE_SERVICE_ROLE_KEY_MGMT")
  $hasBootstrap = Contains-EnvVar $envOut "H2S_DASHBOARD_BOOTSTRAP_SECRET"
  $hasAdminKey = Contains-EnvVar $envOut "H2S_DASHBOARD_ADMIN_KEY"
  $hasAdminToken = Contains-EnvVar $envOut "H2S_ADMIN_TOKEN"

  if (-not $hasMgmtUrl -or -not $hasMgmtKey) {
    Warn "MGMT Supabase env vars may be missing (SUPABASE_URL_MGMT + SUPABASE_SERVICE_KEY_MGMT). Deliverables/accounts will fail without them."
  } else {
    Ok "MGMT Supabase env vars appear present"
  }

  if (-not $hasBootstrap -and -not $hasAdminKey -and -not $hasAdminToken) {
    Warn "No bootstrap/admin env var detected. You will not be able to create the first ADMIN user. Set H2S_DASHBOARD_BOOTSTRAP_SECRET (recommended) or H2S_DASHBOARD_ADMIN_KEY or H2S_ADMIN_TOKEN (break-glass)."
  } else {
    Ok "Bootstrap/Admin env var appears present"
  }
} else {
  Warn "Could not read Vercel env vars (vercel env ls). Continuing."
}

# Migrations (optional, safe to re-run because they use IF NOT EXISTS)
# New default behavior:
# - Migrations NEVER run automatically.
# - Use -RunMigrations to apply MGMT migrations (unless -SkipMigrations is also set).
$shouldRunMigrations = $false
if ($RunMigrations -and -not $SkipMigrations) {
  $shouldRunMigrations = $true
}

if ($shouldRunMigrations) {
  $migrationFiles = @()
  if ($MigrationFile) {
    $migrationFiles = ($MigrationFile -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  }

  if (-not $migrationFiles -or $migrationFiles.Count -eq 0) {
    Warn "No MigrationFile provided; skipping migrations."
  } else {
    Info "Applying MGMT migrations: $($migrationFiles -join ', ')"
  }

  if (-not (Test-Path "backend\apply_migration_rpc.js")) {
    Warn "backend\apply_migration_rpc.js not found; skipping migrations."
  } else {
    Push-Location "backend"
    try {
      $forcePg = $false
      foreach ($mf in $migrationFiles) {
        Info "Applying MGMT migration: $mf"
        $prevEap = $ErrorActionPreference
        try {
          # Node writes RPC failures to stderr which PowerShell can treat as a terminating error
          # when $ErrorActionPreference='Stop'. Relax it so we can fall back cleanly.
          $ErrorActionPreference = "Continue"
          if ($forcePg) {
            $out = @("(skipped RPC; exec_sql unavailable)")
            $LASTEXITCODE = 1
          } else {
            $out = (& node apply_migration_rpc.js $mf --mgmt 2>&1)
          }
        } finally {
          $ErrorActionPreference = $prevEap
        }
        Write-Host ($out -join "`n") -ForegroundColor DarkGray
        if ($LASTEXITCODE -ne 0) {
          if (-not $forcePg -and (Output-Indicates-ExecSqlMissing (Normalize-Lines $out))) {
            Warn "RPC exec_sql appears unavailable; switching remaining migrations to pg fallback."
            $forcePg = $true
          }

          Warn "RPC migration failed for $mf. Attempting direct Postgres migration fallback (pg)..."
          if (-not (Test-Path ".\apply_migration_pg.js")) {
            Fail "RPC migration failed for $mf and apply_migration_pg.js is missing. Cannot continue."
          }

          $prevEap2 = $ErrorActionPreference
          try {
            $ErrorActionPreference = "Continue"
            $out2 = (& node apply_migration_pg.js $mf --mgmt 2>&1)
          } finally {
            $ErrorActionPreference = $prevEap2
          }
          Write-Host ($out2 -join "`n") -ForegroundColor DarkGray
          if ($LASTEXITCODE -ne 0) {
            Fail "Migration failed for $mf via RPC and via pg fallback. Fix DB connectivity/credentials and retry."
          }
          Ok "Migration completed for $mf (pg fallback)"
        } else {
          Ok "Migration completed for $mf (RPC)"
        }
      }
    } finally {
      Pop-Location
    }
  }
} else {
  if ($SkipMigrations) {
    Ok "SkipMigrations specified; skipping migration step"
  } elseif (-not $RunMigrations) {
    Ok "Skipping migrations (default). Use -RunMigrations to apply MGMT migrations when you actually changed schema."
  } else {
    Ok "Skipping migrations"
  }
}

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
  # Next.js can fail with missing manifest files if a previous build left a partial .next directory.
  # Clean it before building to ensure a fresh, deterministic build.
  if (Test-Path ".next") {
    Info "Cleaning backend/.next..."
    try {
      Remove-Item -Recurse -Force ".next" -ErrorAction Stop
    } catch {
      Warn "Could not delete backend/.next (will still try to build): $($_.Exception.Message)"
    }
  }

  try {
    New-Item -ItemType Directory -Path ".next\server\pages" -Force | Out-Null
  } catch {
    Warn "Could not pre-create backend/.next/server/pages: $($_.Exception.Message)"
  }

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
    # Use cmd.exe to avoid PowerShell's NativeCommandError behavior from the vercel.ps1 shim.
    $out = Normalize-Lines (cmd /c "vercel deploy --prod --yes 2>&1")
    $exit = $LASTEXITCODE

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

# portal_jobs enrichment can be eventually consistent right after creating the order/job.
# Retry briefly so we don't fail a good deployment due to propagation delay.
$maxAttempts = 8
$sleepSeconds = 3
$verified = $false
$lastJob = $null

for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
  $job = Invoke-JsonGet "$DeploymentUrl/api/portal_jobs?token=$token&job_id=$($shop.job_id)" 45
  $lastJob = $job

  if (-not $job.ok) {
    Warn "portal_jobs failed on attempt $attempt/$maxAttempts."
    Start-Sleep -Seconds $sleepSeconds
    continue
  }

  $payoutRaw = $job.job.payout_estimated
  $payoutState = [string]($job.job.payout_state)

  # If payout is null/pending, PowerShell would coerce it to 0. Treat as 'not ready' and retry.
  if ($null -eq $payoutRaw -or [string]::IsNullOrWhiteSpace([string]$payoutRaw)) {
    Warn "portal_jobs payout not ready yet (attempt $attempt/$maxAttempts, payout_state='$payoutState')."
    Start-Sleep -Seconds $sleepSeconds
    continue
  }

  $payout = [double]$payoutRaw
  $deliveryDateOut = [string]($job.job.delivery_date)
  $dueAtOut = [string]($job.job.due_at)

  if ([Math]::Abs($payout - $expectedPayout) -gt 0.001) {
    Warn "portal_jobs payout mismatch (attempt $attempt/$maxAttempts). expected $expectedPayout got $payout"
    Start-Sleep -Seconds $sleepSeconds
    continue
  }

  if ($scheduleSucceeded) {
    if ($deliveryDateOut -and ($deliveryDateOut -ne $DeliveryDate)) {
      Warn "portal_jobs delivery_date mismatch (attempt $attempt/$maxAttempts). expected $DeliveryDate got $deliveryDateOut"
      Start-Sleep -Seconds $sleepSeconds
      continue
    }
    if ($dueAtOut -and (-not $dueAtOut.StartsWith($DeliveryDate))) {
      Warn "portal_jobs due_at mismatch (attempt $attempt/$maxAttempts). expected startswith $DeliveryDate got $dueAtOut"
      Start-Sleep -Seconds $sleepSeconds
      continue
    }
  } else {
    Warn "Schedule verification skipped (schedule-appointment did not succeed)."
  }

  Ok "portal_jobs enrichment OK: payout=$$payout delivery_date=$deliveryDateOut due_at=$dueAtOut"
  $verified = $true
  break
}

if (-not $verified) {
  try {
    $payoutRaw2 = $lastJob.job.payout_estimated
    $payoutState2 = [string]($lastJob.job.payout_state)
    Fail "portal_jobs enrichment not ready after $maxAttempts attempts. payout_estimated='$payoutRaw2' payout_state='$payoutState2'"
  } catch {
    Fail "portal_jobs enrichment not ready after $maxAttempts attempts."
  }
}

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
