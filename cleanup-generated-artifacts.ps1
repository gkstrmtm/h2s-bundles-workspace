param(
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

function Remove-IfExists([string]$label, [string[]]$paths) {
    $existing = @($paths | Where-Object { Test-Path -LiteralPath $_ })
    if ($existing.Count -le 0) { return }

    Write-Host "Removing: $label" -ForegroundColor Yellow
    foreach ($p in $existing) {
        if ($WhatIf) {
            Write-Host "  WhatIf: $p" -ForegroundColor DarkGray
        } else {
            try {
                Remove-Item -LiteralPath $p -Force -Recurse -ErrorAction Stop
                Write-Host "  OK: $p" -ForegroundColor DarkGray
            } catch {
                Write-Host "  WARN: failed to remove $p ($_)" -ForegroundColor Yellow
            }
        }
    }
}

function Remove-ByGlob([string]$baseDir, [string[]]$globs, [string]$label) {
    if (-not (Test-Path -LiteralPath $baseDir)) { return }

    $items = @()
    foreach ($g in $globs) {
        try {
            $items += Get-ChildItem -LiteralPath $baseDir -File -Recurse -Filter $g -ErrorAction SilentlyContinue
        } catch {}
    }

    $items = $items | Sort-Object -Property FullName -Unique
    if ($items.Count -le 0) { return }

    Write-Host "Removing: $label ($($items.Count) files)" -ForegroundColor Yellow
    foreach ($it in $items) {
        if ($WhatIf) {
            Write-Host "  WhatIf: $($it.FullName)" -ForegroundColor DarkGray
        } else {
            try {
                Remove-Item -LiteralPath $it.FullName -Force -ErrorAction Stop
            } catch {
                Write-Host "  WARN: failed to remove $($it.FullName) ($_)" -ForegroundColor Yellow
            }
        }
    }
}

# Root-level scratch artifacts
Remove-IfExists -label 'root scratch files' -paths @(
    '.\\__copilot_fs_probe.txt',
    '.\\_tmp_backend_verify_latest.txt',
    '.\\_tmp_frontend_deploy_latest.txt',
    '.\\_tmp_verify_live_dash.js'
)

# Common scratch patterns in workspace root
Remove-ByGlob -baseDir '.' -globs @('_tmp_*.*','_live_*.*','_snip_*.*','_vercel_*.txt','.tmp_*.*') -label 'workspace-root generated dumps'

# Scratch directory
Remove-IfExists -label 'scratch directories' -paths @(
    '.\\.tmp'
)

# Frontend build-stamped assets (biggest culprit)
Remove-ByGlob -baseDir '.\\frontend' -globs @('dash.PORTAL_BUILD_*.js','dash.PORTAL_BUILD_*.css','dash.bundle.PORTAL_BUILD_*.js','*.map') -label 'frontend stamped assets + sourcemaps'

Write-Host ''
Write-Host 'DONE' -ForegroundColor Green
