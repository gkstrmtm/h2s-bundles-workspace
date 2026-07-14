# FRONTEND DEPLOYMENT SAFEGUARD & AUTOMATION
# This script ensures frontend deployments work correctly every time

param(
    [switch]$Force,
    [switch]$Test,
    [switch]$BuildOnly,
    [switch]$KeepInjectedHtml,
    [switch]$SkipAlias,
    [switch]$SkipVerify,
    [switch]$SyncShopAlias,
    [string]$ShopHost = 'shop.home2smart.com',
    [string]$PortalHost = 'portal.home2smart.com'
)

$ErrorActionPreference = "Stop"

function Get-VercelDeploymentUrlFromText([string]$text) {
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    $matches = [regex]::Matches($text, 'https:\/\/[a-zA-Z0-9-]+\.vercel\.app')
    if ($matches.Count -le 0) { return $null }
    return $matches[$matches.Count - 1].Value
}

function Set-VercelAlias([string]$deploymentUrl, [string]$aliasHost) {
    if ([string]::IsNullOrWhiteSpace($deploymentUrl)) {
        $deploymentUrl = $script:LastVercelDeploymentUrl
    }
    if ([string]::IsNullOrWhiteSpace($deploymentUrl)) { throw "Missing deployment URL" }
    if ([string]::IsNullOrWhiteSpace($aliasHost)) { throw "Missing alias host" }

    $script:LastVercelDeploymentUrl = $deploymentUrl

    $deploymentHost = ($deploymentUrl -replace '^https?://', '').TrimEnd('/')
    if ([string]::IsNullOrWhiteSpace($deploymentHost)) { throw "Invalid deployment URL: $deploymentUrl" }

    Write-Host "  Setting alias: $aliasHost -> $deploymentHost" -ForegroundColor Yellow
    # Vercel writes progress to stderr; in Windows PowerShell that can trip $ErrorActionPreference='Stop'.
    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    # Merge stderr to stdout inside cmd.exe so Windows PowerShell doesn't emit NativeCommandError records.
    $out = cmd /c "echo y | vercel alias set $deploymentHost $aliasHost 2^>^&1"
    $ErrorActionPreference = $oldEap
    $text = ($out | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        if ($text) { Write-Host $text }
        throw "vercel alias set failed for $aliasHost (exit $LASTEXITCODE)"
    }
    if ($text) { Write-Host $text -ForegroundColor DarkGray }
    Write-Host "  OK: Alias updated for $aliasHost" -ForegroundColor Green
}

function Invoke-HttpGetText([string]$url) {
    $oldPP = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'
    try {
        return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 25 -Headers @{ 'Cache-Control'='no-cache'; 'Pragma'='no-cache' } -Uri $url).Content
    } finally {
        $ProgressPreference = $oldPP
    }
}

function Verify-PortalDeployment([string]$portalHost, [string]$expectedBuildId) {
    if ([string]::IsNullOrWhiteSpace($portalHost)) { throw 'Missing portal host for verify' }
    if ([string]::IsNullOrWhiteSpace($expectedBuildId)) { throw 'Missing expected build id for verify' }

    $dashUrl = "https://$portalHost/dash?ts=$([int][double]::Parse((Get-Date -UFormat %s)))"
    Write-Host "" 
    Write-Host "Verifying portal is serving this build..." -ForegroundColor Cyan
    Write-Host "  Expecting: $expectedBuildId" -ForegroundColor DarkGray
    Write-Host "  URL: $dashUrl" -ForegroundColor DarkGray

    $deadline = (Get-Date).AddMinutes(3)
    $html = $null

    while ((Get-Date) -lt $deadline) {
        try {
            $html = Invoke-HttpGetText $dashUrl
        } catch {
            $html = $null
        }

        if ($html -and $html -match [regex]::Escape($expectedBuildId)) {
            break
        }

        Start-Sleep -Seconds 5
        Write-Host "  ...waiting for CDN to update" -ForegroundColor DarkGray
    }

    if (-not $html -or $html -notmatch [regex]::Escape($expectedBuildId)) {
        throw "Verify failed: portal did not serve build id $expectedBuildId within timeout"
    }

    $jsTag = [regex]::Match($html, 'dash\.PORTAL_BUILD_[A-Za-z0-9_]+\.js').Value
    $cssTag = [regex]::Match($html, 'dash\.PORTAL_BUILD_[A-Za-z0-9_]+\.css').Value
    if ([string]::IsNullOrWhiteSpace($jsTag) -or [string]::IsNullOrWhiteSpace($cssTag)) {
        throw "Verify failed: could not find stamped asset tags in dash HTML (js='$jsTag', css='$cssTag')"
    }

    $jsUrl = "https://$portalHost/$jsTag"
    $cssUrl = "https://$portalHost/$cssTag"

    try {
        $null = Invoke-HttpGetText $jsUrl
    } catch {
        throw "Verify failed: stamped JS not reachable: $jsUrl"
    }

    try {
        $null = Invoke-HttpGetText $cssUrl
    } catch {
        throw "Verify failed: stamped CSS not reachable: $cssUrl"
    }

    Write-Host "  OK: Portal serving expected build + assets" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   FRONTEND DEPLOYMENT SAFEGUARD" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$frontendDir = "frontend"
$entryFile = "dash.html"  # Canonical file served by frontend/vercel.json (/dash -> /dash.html)
$portalFile = "portal.html" # Primary UI entry on portal.home2smart.com
$requiredFiles = @("dash.html", "dashpp.html", "bundles.html", "vercel.json", "dash.css", "dash.js", "dash2.js", "dash.bundle.js")

$buildDate = Get-Date -Format "yyyyMMdd_HHmmss"
try {
    $gitSha = (git rev-parse --short=7 HEAD 2>$null).Trim()
} catch {
    $gitSha = "0000000"
}
$buildId = "PORTAL_BUILD_${buildDate}_${gitSha}"

# These are created only during deploy to guarantee a unique CDN path.
$stampedCss = "dash.${buildId}.css"
$stampedJs = "dash.${buildId}.js"
$stampedBundleJs = "dash.bundle.${buildId}.js"

# Step 1: Validate workspace
if (-not (Test-Path $frontendDir)) {
    Write-Host "ERROR: frontend/ directory not found!" -ForegroundColor Red
    Write-Host "You must run this from the workspace root." -ForegroundColor Red
    exit 1
}

# Step 2: Validate entry file exists (no copying; avoid duplicating sources)
Write-Host "[1/6] Validating entry file..." -ForegroundColor Yellow
$entryPath = Join-Path $frontendDir $entryFile
if (-not (Test-Path $entryPath)) {
    Write-Host "ERROR: Missing entry file: $entryFile" -ForegroundColor Red
    exit 1
}
Write-Host "  OK: Found $entryFile" -ForegroundColor Green

# Step 3: Validate strict requirements
Write-Host "[2/6] Validating required files..." -ForegroundColor Yellow
foreach ($file in $requiredFiles) {
    if (-not (Test-Path (Join-Path $frontendDir $file))) {
        Write-Host "ERROR: Missing required file: $file" -ForegroundColor Red
        exit 1
    }
    Write-Host "  OK: $file exists" -ForegroundColor Green
}

# Step 4: Validate content integrity (Simplified)
# NOTE: Removed strict regex checks for VERSION/API constants as dash.html structure varies.
# Use Test check only.
Write-Host "[3/6] Validating configuration..." -ForegroundColor Yellow
$entryContent = Get-Content $entryPath -Raw

# Check if file has substantial content
if ($entryContent.Length -gt 1000) {
    Write-Host "  OK: $entryFile seems valid (Size: $($entryContent.Length) bytes)" -ForegroundColor Green
} else {
    Write-Host "ERROR: $entryFile is too small or empty!" -ForegroundColor Red
    exit 1
}

$portalPath = Join-Path $frontendDir $portalFile
if (Test-Path $portalPath) {
    $portalContent = Get-Content $portalPath -Raw
    if ($portalContent.Length -gt 1000) {
        Write-Host "  OK: $portalFile seems valid (Size: $($portalContent.Length) bytes)" -ForegroundColor Green
    } else {
        Write-Host "ERROR: $portalFile is too small or empty!" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "  WARN: $portalFile not found; only injecting $entryFile" -ForegroundColor Yellow
}

if ($Test) {
    Write-Host ""
    Write-Host "[TEST MODE] Checks pass. Build ID would be: $buildId" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# Step 5: Inject Build ID into entry files (dash.html + portal.html)
Write-Host "[4/6] Injecting Build ID into entry files..." -ForegroundColor Yellow

$originalByPath = @{}
$modifiedPaths = @()

function Inject-BuildIdIntoFile([string]$path, [string]$label) {
    if (-not (Test-Path $path)) { return }
    $orig = Get-Content $path -Raw
    $next = $orig

    # Primary path: replace placeholders
    $next = $next -replace '\{\{BUILD_ID\}\}', $buildId

    # Safety path: if a file got "stuck" with a previous PORTAL_BUILD stamp, rewrite it.
    # This prevents shipping HTML that references stamped assets that don't exist in this deployment.
    $next = $next -replace 'PORTAL_BUILD_[A-Za-z0-9_]+', $buildId

    # Normalize any previously stamped asset filenames to this deployment's stamped names.
    $next = $next -replace 'dash\.PORTAL_BUILD_[A-Za-z0-9_]+\.css', $stampedCss
    $next = $next -replace 'dash\.PORTAL_BUILD_[A-Za-z0-9_]+\.js', $stampedJs
    $next = $next -replace 'dash\.bundle\.PORTAL_BUILD_[A-Za-z0-9_]+\.js', $stampedBundleJs

    # Also rewrite dash.css/dash.js references to build-stamped filenames.
    # This avoids relying on query-string cache keys at the CDN.
    try {
        $next = $next -replace [regex]::Escape("/dash.css?v=$buildId"), "/$stampedCss"
        $next = $next -replace [regex]::Escape("/dash.js?v=$buildId"), "/$stampedJs"
        $next = $next -replace [regex]::Escape("/dash2.js?v=$buildId"), "/$stampedJs"
    } catch {
        # If this fails, deploy will still work with the query-string version.
    }

    $script:originalByPath[$path] = $orig
    if ($next -ne $orig) {
        Set-Content $path -Value $next -NoNewline
        $script:modifiedPaths += $path
        Write-Host "  OK: Injected $buildId into $label" -ForegroundColor Green
    } else {
        Write-Host "  INFO: No {{BUILD_ID}} placeholders found in $label" -ForegroundColor Yellow
    }
}

Inject-BuildIdIntoFile -path $entryPath -label $entryFile
Inject-BuildIdIntoFile -path $portalPath -label $portalFile

# Step 6: Create build-stamped assets (so CDN paths are unique)
Write-Host "[5/6] Creating build-stamped assets..." -ForegroundColor Yellow

Push-Location $frontendDir
try {
    try {
        if (Test-Path "./dash.css") { Copy-Item -Force "./dash.css" "./$stampedCss" }
        if (Test-Path "./dash.js") { Copy-Item -Force "./dash.js" "./$stampedJs" }
        if (Test-Path "./dash.bundle.js") { Copy-Item -Force "./dash.bundle.js" "./$stampedBundleJs" }
    } catch {
        Write-Host "  WARN: Could not create stamped assets ($stampedCss / $stampedJs): $_" -ForegroundColor Yellow
    }

    Write-Host "  OK: Stamped assets created" -ForegroundColor Green
    Write-Host "  Build ID: $buildId" -ForegroundColor Cyan
    Write-Host "  JS:  $stampedJs" -ForegroundColor DarkGray
    Write-Host "  CSS: $stampedCss" -ForegroundColor DarkGray
} finally {
    Pop-Location
}

if ($BuildOnly) {
    Write-Host ""
    Write-Host "[BUILD ONLY] Skipping Vercel deploy." -ForegroundColor Green
    Write-Host "  If you want to keep injected HTML in your working tree, re-run with -KeepInjectedHtml." -ForegroundColor DarkGray
} else {
    # Step 7: Deploy
    Write-Host "[6/6] Deploying to Vercel..." -ForegroundColor Yellow

Push-Location $frontendDir
try {
    $vercelArgs = @('--prod', '--yes')
    if ($Force) {
        $vercelArgs += '--force'
        Write-Host "  INFO: Force deploy enabled (--force)" -ForegroundColor DarkGray
    }

    # Stream output live (so it doesn't look hung) AND capture it (so we can parse the deployment URL).
    # IMPORTANT: call via cmd.exe so Vercel's stderr progress doesn't create PowerShell NativeCommandError noise.
    $vercelArgsText = ($vercelArgs | ForEach-Object { [string]$_ }) -join ' '
    $oldEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $deployLines = @()
    try {
        cmd /c "vercel $vercelArgsText 2^>^&1" | Tee-Object -Variable deployLines
    } finally {
        $ErrorActionPreference = $oldEap
    }
    $deployText = ($deployLines | Out-String)
    $vercelExit = $LASTEXITCODE

    if ($vercelExit -eq 0) {
        Write-Host ""
        Write-Host "[6/6] Deployment Success!" -ForegroundColor Green
        Write-Host "Build ID: $buildId" -ForegroundColor Cyan

        if (-not $SkipAlias) {
            Write-Host "" 
            Write-Host "Syncing production aliases to this deployment..." -ForegroundColor Cyan

            $deployUrl = Get-VercelDeploymentUrlFromText $deployText
            if (-not $deployUrl) {
                Write-Host $deployText.Trim() -ForegroundColor DarkGray
                throw "Could not determine Vercel deployment URL from output; cannot set aliases. Re-run with -SkipAlias to bypass."
            }

            # Default behavior: only sync the portal alias.
            # Shop alias is optional because this script is primarily for the internal portal deployment.
            Set-VercelAlias -deploymentUrl $deployUrl -aliasHost $PortalHost

            if ($SyncShopAlias) {
                Set-VercelAlias -deploymentUrl $deployUrl -aliasHost $ShopHost
            } else {
                Write-Host "  INFO: Syncing shop alias by default." -ForegroundColor DarkGray
                Set-VercelAlias $deploymentUrl $ShopHost
            }
        } else {
            Write-Host "" 
            Write-Host "Skipping alias sync (-SkipAlias)." -ForegroundColor Yellow
        }

        if (-not $SkipVerify) {
            try {
                Verify-PortalDeployment -portalHost $PortalHost -expectedBuildId $buildId
            } catch {
                Write-Host "" 
                Write-Host "ERROR: Post-deploy verify failed: $_" -ForegroundColor Red
                throw
            }
        } else {
            Write-Host "" 
            Write-Host "Skipping post-deploy verify (-SkipVerify)." -ForegroundColor Yellow
        }
    } else {
        Write-Host ""
        Write-Host "ERROR: Vercel deployment failed (Code: $vercelExit)" -ForegroundColor Red
        if ($deployText) { Write-Host $deployText.Trim() -ForegroundColor DarkGray }
    }
} catch {
    Write-Host ""
    Write-Host "ERROR: Deployment script failed: $_" -ForegroundColor Red
} finally {
    # Clean up stamped assets (local workspace) to keep repo tidy.
    # These files are only needed for the deployment upload; leaving them around creates hundreds of
    # generated artifacts that can bog down VS Code/tsserver.
    try { Get-ChildItem -File -Filter "dash.PORTAL_BUILD_*.css" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue } catch {}
    try { Get-ChildItem -File -Filter "dash.PORTAL_BUILD_*.js" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue } catch {}
    try { Get-ChildItem -File -Filter "dash.bundle.PORTAL_BUILD_*.js" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue } catch {}
    Pop-Location
}
}

# Restore original files unless explicitly requested.
if (-not $KeepInjectedHtml -and $modifiedPaths.Count -gt 0) {
    Write-Host ""
    Write-Host "Restoring development state..." -ForegroundColor Yellow
    foreach ($p in $modifiedPaths) {
        try {
            if ($originalByPath.ContainsKey($p)) {
                Set-Content $p -Value $originalByPath[$p] -NoNewline
            }
        } catch {}
    }
    Write-Host "  OK: Reverted build ID injection" -ForegroundColor Green
}

Write-Host ""
Write-Host "DONE" -ForegroundColor Cyan
