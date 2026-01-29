# Deploys the latest Dash.html behind the stable portal alias.
# Goal: mitigate live caching / rendering issues by hosting the exact Dash.html on the portal subdomain.
# Route: https://portal.home2smart.com/- (and /dash)

[CmdletBinding()]
param(
  [string]$PortalHost = 'portal.home2smart.com',
  [string]$PortalPath = '/-',
  [int]$MaxRetries = 12,
  [int]$RetryDelaySeconds = 5,
  [switch]$SkipDeploy,
  [switch]$KeepDashCopy
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Step([string]$msg) {
  Write-Host "`n$msg" -ForegroundColor Cyan
}

function Fail([string]$msg) {
  Write-Host "`nERROR: $msg" -ForegroundColor Red
  exit 1
}

function Get-HttpContent([string]$uri) {
  # Returns @{ ok = $true/$false; status = <int>; content = <string>; error = <string> }
  $result = @{ ok = $false; status = 0; content = ''; error = '' }
  try {
    $resp = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 20
    $result.ok = $true
    $result.status = [int]$resp.StatusCode
    $result.content = [string]$resp.Content
    return $result
  } catch {
    $result.error = [string]$_
    try {
      if ($_.Exception -and $_.Exception.Response) {
        $result.status = [int]$_.Exception.Response.StatusCode
        $stream = $_.Exception.Response.GetResponseStream()
        if ($stream) {
          $reader = New-Object System.IO.StreamReader($stream)
          $result.content = $reader.ReadToEnd()
          $reader.Close()
        }
      }
    } catch {}
    return $result
  }
}

$root = (Get-Location).Path
$dashSource = Join-Path $root 'Dash.html'
$designCssSource = Join-Path $root 'dashboard-design-system.css'
$frontendDir = Join-Path $root 'frontend'
$dashDest = Join-Path $frontendDir 'dash.html'
$designCssDest = Join-Path $frontendDir 'dashboard-design-system.css'
$vercelConfig = Join-Path $frontendDir 'vercel.json'

Write-Host "" 
Write-Host "  DEPLOY FRONTEND (PORTAL ALIAS)" -ForegroundColor Cyan
Write-Host "  Hosting Dash.html at https://$PortalHost$PortalPath" -ForegroundColor Gray
Write-Host "" 

Write-Step "[1/4] Validating inputs + workspace"
if (!(Test-Path $dashSource)) { Fail "Dash.html not found at $dashSource" }
if (!(Test-Path $designCssSource)) { Fail "dashboard-design-system.css not found at $designCssSource" }
if (!(Test-Path $frontendDir)) { Fail "frontend/ directory not found at $frontendDir" }
if (!(Test-Path $vercelConfig)) { Fail "frontend/vercel.json not found at $vercelConfig" }

# Sanity check that routing exists (we patch it in repo, but guard anyway)
try {
  $cfg = Get-Content $vercelConfig -Raw
  if ($cfg -notmatch '"source"\s*:\s*"/\-"' -or $cfg -notmatch '"destination"\s*:\s*"/dash\.html"') {
    Fail "frontend/vercel.json is missing the /- -> /dash.html rewrite."
  }
  if ($cfg -notmatch '"source"\s*:\s*"/dash"' -or $cfg -notmatch '"destination"\s*:\s*"/dash\.html"') {
    Fail "frontend/vercel.json is missing the /dash -> /dash.html rewrite."
  }
} catch {
  Fail "Could not read/parse frontend/vercel.json: $_"
}

Write-Step "[2/4] Syncing Dash.html -> frontend/dash.html (deploy artifact)"
try {
  $content = Get-Content $dashSource -Raw
  if ($content -notmatch 'proofpacks-pane') {
    Write-Host "  WARN: Could not find 'proofpacks-pane' marker; verification may be weaker." -ForegroundColor Yellow
  }

  # Write exact content (UTF-8) so Vercel serves the current implementation
  Set-Content -Path $dashDest -Value $content -NoNewline -Encoding utf8
  Write-Host "  OK - Wrote: $dashDest" -ForegroundColor Green
} catch {
  Fail "Failed to write frontend/dash.html: $_"
}

try {
  Copy-Item -Path $designCssSource -Destination $designCssDest -Force
  Write-Host "  OK - Synced: $designCssDest" -ForegroundColor Green
} catch {
  Fail "Failed to copy dashboard-design-system.css into frontend/: $_"
}

if ($SkipDeploy) {
  Write-Host "`nSkipDeploy specified; not running Vercel deploy." -ForegroundColor Yellow
  exit 0
}

Write-Step "[3/4] Deploying to Vercel (production)"
# Deploy from frontend/ so vercel.json and static routes are applied.
Push-Location
Set-Location $frontendDir

Write-Host ("  Deploying from: {0}" -f (Get-Location).Path) -ForegroundColor DarkGray

# Using cmd /c to avoid PATH issues with vercel.cmd on Windows.
# Note: Vercel sometimes writes informational output to stderr; don't let that trip $ErrorActionPreference='Stop'.
$oldEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$deployOut = cmd /c vercel --prod --yes 2>&1
$ErrorActionPreference = $oldEap

$deployText = ($deployOut | Out-String)

Pop-Location

if ($LASTEXITCODE -ne 0) {
  Write-Host $deployText
  Fail "Vercel deployment failed with exit code $LASTEXITCODE"
}

Write-Host "  OK - Deploy command finished" -ForegroundColor Green

# Try to extract the Vercel production URL for immediate verification
$prodUrl = ''
try {
  $m = [regex]::Match($deployText, 'Production:\s+(https?://\S+)', 'IgnoreCase')
  if ($m.Success) { $prodUrl = $m.Groups[1].Value.Trim() }
} catch {}

Write-Step "[4/4] Verifying live alias"

function Normalize-Path([string]$p) {
  $x = [string]$p
  if ([string]::IsNullOrWhiteSpace($x)) { return '/' }
  if (-not $x.StartsWith('/')) { $x = '/' + $x }
  return $x
}

$pathsToCheck = @(
  (Normalize-Path $PortalPath),
  '/dash',
  '/dashboard'
) | Select-Object -Unique

$urlsToCheck = @()
foreach ($p in $pathsToCheck) {
  $urlsToCheck += ('https://' + $PortalHost + $p)
}

if (-not [string]::IsNullOrWhiteSpace($prodUrl)) {
  foreach ($p in $pathsToCheck) {
    $urlsToCheck += ($prodUrl.TrimEnd('/') + $p)
  }
  $urlsToCheck = $urlsToCheck | Select-Object -Unique
}

for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
  foreach ($url in $urlsToCheck) {
    Write-Host ("Attempt {0}/{1} - {2}" -f $attempt, $MaxRetries, $url) -NoNewline
    $t = [int][double]::Parse((Get-Date -UFormat %s))
    $probeUrl = $url + '?t=' + $t
    $r = Get-HttpContent $probeUrl

    $status = $r.status
    $live = [string]$r.content

    $ok = ($live -match 'proofpacks-pane' -or $live -match 'id="proofpacks-pane"')
    if ($ok) {
      Write-Host (" OK (HTTP {0})" -f $status) -ForegroundColor Green
      Write-Host ("`nVERIFIED: Dash.html is live at {0}" -f $url) -ForegroundColor Green

      if (-not $KeepDashCopy) {
        Remove-Item -Force $dashDest -ErrorAction SilentlyContinue
        Remove-Item -Force $designCssDest -ErrorAction SilentlyContinue
        Write-Host "  OK - Cleaned up frontend/dash.html" -ForegroundColor DarkGray
      }

      exit 0
    }

    if ($status -gt 0) {
      Write-Host (" HTTP {0}" -f $status) -ForegroundColor Yellow
    } else {
      Write-Host " network/TLS error" -ForegroundColor Yellow
    }
  }

  Start-Sleep -Seconds $RetryDelaySeconds
}

Write-Host "`nVERIFICATION TIMED OUT" -ForegroundColor Red
Write-Host "- The deployment may still be propagating or cached." -ForegroundColor Gray
Write-Host "- Try incognito and confirm one of:" -ForegroundColor Gray
foreach ($u in $urlsToCheck) { Write-Host ("  - " + $u) -ForegroundColor Gray }

if (-not $KeepDashCopy) {
  Remove-Item -Force $dashDest -ErrorAction SilentlyContinue
  Remove-Item -Force $designCssDest -ErrorAction SilentlyContinue
}

exit 1
