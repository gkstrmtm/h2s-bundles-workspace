param(
    [switch]$NoEnter,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

function Write-Info([string]$Message) {
    if (-not $Quiet) {
        Write-Host $Message -ForegroundColor Cyan
    }
}

function Write-Ok([string]$Message) {
    if (-not $Quiet) {
        Write-Host $Message -ForegroundColor Green
    }
}

function Write-WarnLine([string]$Message) {
    if (-not $Quiet) {
        Write-Host $Message -ForegroundColor Yellow
    }
}

function Get-RepoRelativePath([string]$Root, [string]$FullPath) {
    $resolvedRoot = ([string](Resolve-Path -LiteralPath $Root)).TrimEnd('\')
    $resolvedPath = [string](Resolve-Path -LiteralPath $FullPath)
    $prefix = $resolvedRoot + '\'
    if ($resolvedPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $resolvedPath.Substring($prefix.Length).Replace('\', '/')
    }
    return $resolvedPath.Replace('\', '/')
}

function Convert-ToFrontendRelativeAssetPath([string]$RawPath) {
    if ([string]::IsNullOrWhiteSpace($RawPath)) {
        $candidate = ''
    } else {
        $candidate = $RawPath.Trim()
    }
    if (-not $candidate) { return $null }
    if ($candidate -match '^(?:https?:|data:|mailto:|tel:|javascript:|//)') { return $null }

    $candidate = ($candidate -split '#', 2)[0]
    $candidate = ($candidate -split '\?', 2)[0]
    $candidate = $candidate.Trim()
    if (-not $candidate) { return $null }
    if ($candidate.StartsWith('../')) { return $null }

    if ($candidate -match '^/dash\.PORTAL_BUILD_[A-Za-z0-9_]+\.css$') { return 'dash.css' }
    if ($candidate -match '^/dash\.PORTAL_BUILD_[A-Za-z0-9_]+\.js$') { return 'dash.js' }
    if ($candidate -match '^/dash\.bundle\.PORTAL_BUILD_[A-Za-z0-9_]+\.js$') { return 'dash.bundle.js' }

    $normalized = $candidate.TrimStart('/')
    if ($normalized.StartsWith('./')) {
        $normalized = $normalized.Substring(2)
    }

    if (-not $normalized) { return $null }
    return $normalized.Replace('\', '/')
}

function Get-LocalAssetDependencies([string]$HtmlPath) {
    $found = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $content = Get-Content -LiteralPath $HtmlPath -Raw
    $matches = [regex]::Matches($content, '(?i)(?:href|src|data)\s*=\s*["'']([^"'']+)["'']')
    foreach ($match in $matches) {
        $pathValue = Convert-ToFrontendRelativeAssetPath $match.Groups[1].Value
        if ($pathValue) {
            $null = $found.Add($pathValue)
        }
    }
    return @($found | Sort-Object)
}

function New-HardLinkFile([string]$SourcePath, [string]$TargetPath) {
    $targetDir = Split-Path -Parent $TargetPath
    if (-not (Test-Path -LiteralPath $targetDir)) {
        try {
            [System.IO.Directory]::CreateDirectory($targetDir) | Out-Null
        } catch {
            throw "Failed to create target directory. Source='$SourcePath' Target='$TargetPath' TargetDir='$targetDir' Error=$($_.Exception.Message)"
        }
    }
    if (Test-Path -LiteralPath $TargetPath) {
        Remove-Item -LiteralPath $TargetPath -Force
    }
    New-Item -ItemType HardLink -Path $TargetPath -Target $SourcePath | Out-Null
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [string](Resolve-Path (Join-Path $scriptDir '..\\..'))
$frontendDir = Join-Path $repoRoot 'frontend'
$workbenchDir = Join-Path $repoRoot '.html-terminal-env'
$workspaceDir = Join-Path $workbenchDir 'workspace'
$manifestPath = Join-Path $workbenchDir 'manifest.json'
$readmePath = Join-Path $workbenchDir 'README.txt'

function Normalize-WorkbenchRelativePath([string]$PathValue) {
    if ([string]::IsNullOrWhiteSpace($PathValue)) { return $null }

    $candidate = $PathValue.Trim().Replace('\', '/')
    $repoPrefix = ($repoRoot.TrimEnd('\') + '\').Replace('\', '/')
    $frontendPrefix = ($frontendDir.TrimEnd('\') + '\').Replace('\', '/')

    if ($candidate.StartsWith($frontendPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        $candidate = $candidate.Substring($frontendPrefix.Length)
    } elseif ($candidate.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        $candidate = $candidate.Substring($repoPrefix.Length)
        if ($candidate.StartsWith('frontend/', [System.StringComparison]::OrdinalIgnoreCase)) {
            $candidate = $candidate.Substring('frontend/'.Length)
        }
    }

    $candidate = $candidate.TrimStart('/')
    if (-not $candidate) { return $null }
    return $candidate
}

if (-not (Test-Path -LiteralPath $frontendDir)) {
    throw "frontend/ directory not found at $frontendDir"
}

$sourceHtmlFiles = Get-ChildItem -LiteralPath $frontendDir -File -Filter '*.html' |
    Where-Object {
        $_.Name -notmatch '^(?:temp|test-|_)' -and
        $_.Name -notmatch '\.bak(?:\.|$)'
    } |
    Sort-Object Name

$manualSupportFiles = @(
    'dashboard-design-system.css',
    'dash.css',
    'dash.js',
    'dash.bundle.js',
    'dash2.js',
    'dash-messages.js',
    'sms-no-flicker.js',
    'bundles.js',
    'bundles-core.js',
    'bundles-app.js',
    'bundles-deferred.js',
    'vercel.json'
)

$linkedRelativePaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$sourceHtmlRelativePaths = @()

foreach ($file in $sourceHtmlFiles) {
    $relativeHtml = Normalize-WorkbenchRelativePath (Get-RepoRelativePath -Root $frontendDir -FullPath $file.FullName)
    if (-not $relativeHtml) { continue }
    $sourceHtmlRelativePaths += $relativeHtml
    $null = $linkedRelativePaths.Add($relativeHtml)

    foreach ($assetPath in (Get-LocalAssetDependencies -HtmlPath $file.FullName)) {
        $normalizedAssetPath = Normalize-WorkbenchRelativePath $assetPath
        if (-not $normalizedAssetPath) { continue }
        $fullAssetPath = Join-Path $frontendDir ($normalizedAssetPath.Replace('/', '\'))
        if (Test-Path -LiteralPath $fullAssetPath -PathType Leaf) {
            $null = $linkedRelativePaths.Add($normalizedAssetPath)
        }
    }
}

foreach ($assetPath in $manualSupportFiles) {
    $normalizedAssetPath = Normalize-WorkbenchRelativePath $assetPath
    if (-not $normalizedAssetPath) { continue }
    $fullAssetPath = Join-Path $frontendDir ($normalizedAssetPath.Replace('/', '\'))
    if (Test-Path -LiteralPath $fullAssetPath -PathType Leaf) {
        $null = $linkedRelativePaths.Add($normalizedAssetPath)
    }
}

$supportAssetRelativePaths = @($linkedRelativePaths | Where-Object { $_ -notin $sourceHtmlRelativePaths } | Sort-Object)

$mirrorTargets = foreach ($relativeHtml in ($sourceHtmlRelativePaths | Sort-Object)) {
    $fileName = Split-Path -Leaf $relativeHtml
    $targets = @()
    $rootMirror = Join-Path $repoRoot $fileName
    $backendMirror = Join-Path $repoRoot (Join-Path 'backend\\public' $fileName)

    if (Test-Path -LiteralPath $rootMirror) {
        $targets += (Get-RepoRelativePath -Root $repoRoot -FullPath $rootMirror)
    }
    if (Test-Path -LiteralPath $backendMirror) {
        $targets += (Get-RepoRelativePath -Root $repoRoot -FullPath $backendMirror)
    }

    if ($targets.Count -gt 0) {
        [ordered]@{
            source = ('frontend/' + $relativeHtml)
            mirrors = @($targets | Sort-Object -Unique)
        }
    }
}

Write-Info 'Refreshing focused HTML workbench...'
if (Test-Path -LiteralPath $workspaceDir) {
    Remove-Item -LiteralPath $workspaceDir -Recurse -Force
}
New-Item -ItemType Directory -Path $workspaceDir -Force | Out-Null

foreach ($relativePath in ($linkedRelativePaths | Sort-Object)) {
    $normalizedRelativePath = Normalize-WorkbenchRelativePath $relativePath
    if (-not $normalizedRelativePath) { continue }
    $nativeRelativePath = $normalizedRelativePath.Replace('/', '\')
    $sourcePath = Join-Path $frontendDir $nativeRelativePath
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { continue }
    $targetPath = Join-Path $workspaceDir $nativeRelativePath
    New-HardLinkFile -SourcePath $sourcePath -TargetPath $targetPath
}

$manifest = [ordered]@{
    createdAt = (Get-Date).ToString('o')
    workbench = '.html-terminal-env/workspace'
    sourceOfTruth = 'frontend/'
    sourceHtmlFiles = @($sourceHtmlRelativePaths | Sort-Object)
    supportAssets = @($supportAssetRelativePaths | Sort-Object)
    mirrorTargets = @($mirrorTargets)
    suggestedCommands = [ordered]@{
        syncMirrors = 'powershell -NoProfile -ExecutionPolicy Bypass -File .\\tools\\sync-workspace.ps1'
        rebuildDashArtifact = 'node .\\scripts\\build-dash-singlefile.js'
        reopenWorkbench = 'powershell -NoProfile -ExecutionPolicy Bypass -File .\\tools\\html-terminal-env\\enter-html-terminal-env.ps1'
    }
}

$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

$readmeLines = @(
    'Focused HTML terminal workbench',
    '',
    'Edit files inside .html-terminal-env\\workspace\\',
    'Those files are hardlinks to frontend\\ source files.',
    '',
    'Primary source of truth:',
    '  frontend\\',
    '',
    'Mirrors and artifacts are listed in manifest.json.',
    '',
    'Useful commands:',
    '  powershell -NoProfile -ExecutionPolicy Bypass -File .\\tools\\sync-workspace.ps1',
    '  node .\\scripts\\build-dash-singlefile.js'
)
$readmeLines | Set-Content -LiteralPath $readmePath -Encoding UTF8

Write-Ok ("Linked {0} source HTML files and {1} support assets." -f $sourceHtmlRelativePaths.Count, $supportAssetRelativePaths.Count)
Write-Ok ("Manifest: {0}" -f $manifestPath)

if (-not $NoEnter) {
    Set-Location -LiteralPath $workspaceDir
    Write-Info ("Current directory: {0}" -f (Get-Location).Path)
} else {
    Write-WarnLine ("Workbench ready at {0}" -f $workspaceDir)
}