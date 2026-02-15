# Deploys the frontend Vercel project and verifies the portal alias serves the canonical Dash.html.
# Canonical portal dashboard is served via host-based rewrites to:
#   https://h2s-bundles-workspace.vercel.app/Dash.html
# Verification uses the meta marker:
#   <meta name="h2s-source-file" content="Dash.html">

[CmdletBinding()]
param(
  [string]$PortalHost = 'portal.home2smart.com',
  [string]$ShopHost = 'shop.home2smart.com',
  [int]$MaxRetries = 12,
  [int]$RetryDelaySeconds = 5,
  [switch]$SkipDeploy,
  [switch]$SkipAlias
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

function Get-VercelDeploymentUrlFromText([string]$text) {
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  $vercelUrls = [regex]::Matches($text, 'https:\/\/[a-zA-Z0-9-]+\.vercel\.app')
  if ($vercelUrls.Count -le 0) { return $null }
  return $vercelUrls[$vercelUrls.Count - 1].Value
}

function Set-VercelAlias([string]$deploymentUrl, [string]$aliasHost) {
  if ([string]::IsNullOrWhiteSpace($deploymentUrl)) { Fail 'Missing deployment URL for alias set' }
  if ([string]::IsNullOrWhiteSpace($aliasHost)) { Fail 'Missing alias host for alias set' }

  $deploymentHost = ($deploymentUrl -replace '^https?://', '').TrimEnd('/')
  if ([string]::IsNullOrWhiteSpace($deploymentHost)) { Fail ("Invalid deployment URL: {0}" -f $deploymentUrl) }

  Write-Host ("  Setting alias: {0} -> {1}" -f $aliasHost, $deploymentHost) -ForegroundColor Yellow
  $oldEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = cmd /c "echo y | vercel alias set $deploymentHost $aliasHost" 2>&1
  $ErrorActionPreference = $oldEap
  $text = ($out | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    if ($text) { Write-Host $text }
    Fail ("vercel alias set failed for {0} (exit {1})" -f $aliasHost, $LASTEXITCODE)
  }
  if ($text) { Write-Host $text -ForegroundColor DarkGray }
  Write-Host ("  OK - alias updated: {0}" -f $aliasHost) -ForegroundColor Green
}

$root = (Get-Location).Path
$designCssSource = Join-Path $root 'dashboard-design-system.css'
$frontendDir = Join-Path $root 'frontend'
$designCssDest = Join-Path $frontendDir 'dashboard-design-system.css'
$vercelConfig = Join-Path $frontendDir 'vercel.json'
$guardScript = Join-Path $frontendDir 'scripts' | Join-Path -ChildPath 'portal-dash-guard.mjs'

Write-Host "" 
Write-Host "  DEPLOY FRONTEND (PORTAL ALIAS)" -ForegroundColor Cyan
Write-Host "  Verifying https://$PortalHost/dash serves canonical Dash.html" -ForegroundColor Gray
Write-Host "" 

Write-Step "[1/4] Validating inputs + workspace"
if (!(Test-Path $designCssSource)) { Fail "dashboard-design-system.css not found at $designCssSource" }
if (!(Test-Path $frontendDir)) { Fail "frontend/ directory not found at $frontendDir" }
if (!(Test-Path $vercelConfig)) { Fail "frontend/vercel.json not found at $vercelConfig" }
if (!(Test-Path $guardScript)) { Fail "Guard script not found at $guardScript" }

# Ensure the canonical served file is the deflated one (prevents VS Code crashes + giant deploys)
$dashEntry = Join-Path $frontendDir 'dash.html'
if (!(Test-Path $dashEntry)) { Fail "frontend/dash.html not found at $dashEntry" }
try {
  $dashLines = (Get-Content $dashEntry | Measure-Object -Line).Lines
  if ($dashLines -gt 8000) {
    Fail "frontend/dash.html is too large ($dashLines lines). Canonical /dash serves dash.html; keep it deflated (external dash.css + dash.js)."
  }
  $dashRaw = Get-Content $dashEntry -Raw
  if ($dashRaw -notmatch '\.\/dash\.css' -or $dashRaw -notmatch '\.\/dash\.js') {
    Fail "frontend/dash.html does not appear to reference ./dash.css and ./dash.js. Deflate the HTML before deploying."
  }
} catch {
  Fail "Could not validate frontend/dash.html size/refs: $_"
}

Write-Step "[2/4] Running canonical Dash guard (pre)"
try {
  Push-Location
  Set-Location $frontendDir
  $oldEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $out = cmd /c node .\scripts\portal-dash-guard.mjs pre 2>&1
  $ErrorActionPreference = $oldEap
  $text = ($out | Out-String)
  if ($LASTEXITCODE -ne 0) {
    Write-Host $text
    Fail "Pre-deploy guard failed. Fix frontend/vercel.json routing before deploying."
  }
  Write-Host $text.Trim() -ForegroundColor DarkGray
} finally {
  Pop-Location
}

Write-Step "[2/4] Syncing dashboard-design-system.css into frontend/"
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

if (-not $SkipAlias) {
  Write-Step "[3.5/4] Syncing production aliases to this deployment"
  $deployUrl = Get-VercelDeploymentUrlFromText $deployText
  if (-not $deployUrl) {
    Write-Host $deployText.Trim() -ForegroundColor DarkGray
    Fail 'Could not determine Vercel deployment URL from deploy output; cannot set aliases. Re-run with -SkipAlias to bypass.'
  }

  # Ensure both portal + shop are pinned to the exact deployment we just published.
  Set-VercelAlias -deploymentUrl $deployUrl -aliasHost $PortalHost
  Set-VercelAlias -deploymentUrl $deployUrl -aliasHost $ShopHost
} else {
  Write-Host "`nSkipAlias specified; not updating vercel aliases." -ForegroundColor Yellow
}

Write-Step "[4/4] Verifying live portal dash (post-deploy guard)"

for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
  Write-Host ("Attempt {0}/{1} - https://{2}/dash" -f $attempt, $MaxRetries, $PortalHost)
  try {
    Push-Location
    Set-Location $frontendDir
    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = cmd /c node .\scripts\portal-dash-guard.mjs post 2>&1
    $ErrorActionPreference = $oldEap
    $text = ($out | Out-String)
    if ($LASTEXITCODE -eq 0) {
      Write-Host $text.Trim() -ForegroundColor Green
      exit 0
    }
    Write-Host $text.Trim() -ForegroundColor Yellow
  } catch {
    Write-Host ("WARN: guard check errored: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
  } finally {
    Pop-Location
  }

  Start-Sleep -Seconds $RetryDelaySeconds
}

Fail "Post-deploy verification timed out: portal /dash did not confirm canonical Dash.html"
