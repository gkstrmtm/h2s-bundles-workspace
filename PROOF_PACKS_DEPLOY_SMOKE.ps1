param(
  [string]$BackendBase = "https://h2s-backend.vercel.app"
)

$ErrorActionPreference = "Stop"

function Ok($msg) { Write-Host "✅ $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "⚠️  $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "❌ $msg" -ForegroundColor Red; exit 1 }

function Get-Json($url) {
  $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -Headers @{
    "Cache-Control" = "no-cache"
    "Accept" = "application/json"
  }
  return ($resp.Content | ConvertFrom-Json)
}

function Post-Json($url, $obj) {
  $body = ($obj | ConvertTo-Json -Depth 10)
  $resp = Invoke-WebRequest -Method POST -Uri $url -UseBasicParsing -Headers @{
    "Cache-Control" = "no-cache"
    "Accept" = "application/json"
    "Content-Type" = "application/json"
  } -Body $body
  return ($resp.Content | ConvertFrom-Json)
}

Write-Host "" 
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "  PROOF PACKS DEPLOY SMOKE" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ("Backend: " + $BackendBase) -ForegroundColor Gray
Write-Host "" 

# 1) Health
try {
  $health = Get-Json ("$BackendBase/api/health")
  if (-not $health.ok) { Fail "health returned ok=false" }
  Ok ("health OK (build_id=" + $health.build_id + ")")
} catch {
  Fail ("health check failed: " + $_.Exception.Message)
}

# 2) Public proof slots
try {
  $slots = Get-Json ("$BackendBase/api/proof-slots?surface=bundles&limit=3")
  if (-not $slots.ok) { Fail "proof-slots returned ok=false" }
  $count = 0
  if ($slots.slots) { $count = @($slots.slots).Count }
  Ok ("proof-slots OK (slots=" + $count + ")")
} catch {
  Fail ("proof-slots check failed: " + $_.Exception.Message)
}

# 3) Public proof event
try {
  $evt = Post-Json ("$BackendBase/api/proof-event") (@{
    event_type = "impression"
    surface = "bundles"
    slot_key = "pre_cta"
    service = "cameras"
    session_id = ("smoke-" + [int](Get-Random))
    page_url = "smoke-script"
  })
  if (-not $evt.ok) { Fail "proof-event returned ok=false" }
  Ok "proof-event OK"
} catch {
  Fail ("proof-event check failed: " + $_.Exception.Message)
}

# 4) Admin route presence (we accept 401/403/400/405 here; we just don't want 404/501)
$adminUrl = "$BackendBase/api/admin/proof-packs?surface=bundles&service=cameras"
try {
  $resp = Invoke-WebRequest -Uri $adminUrl -UseBasicParsing -Headers @{
    "Cache-Control" = "no-cache"
    "Accept" = "application/json"
  }
  # If it succeeds, great.
  Ok "admin/proof-packs reachable (unexpectedly authorized)"
} catch {
  $status = $null
  try { $status = [int]$_.Exception.Response.StatusCode } catch {}

  if ($status -eq 404 -or $status -eq 501) {
    Fail ("admin/proof-packs returned " + $status + " (route missing/broken)")
  }

  if ($status) {
    Ok ("admin/proof-packs route exists (HTTP " + $status + ")")
  } else {
    Warn "admin/proof-packs check: could not read status code, but request errored (check manually if needed)"
  }
}

Write-Host "" 
Ok "Proof Packs smoke checks passed"
