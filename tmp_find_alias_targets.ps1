param(
  [string]$Scope = 'tabari-ropers-projects-6f2e090b',
  [string[]]$Patterns = @('shop.home2smart.com', 'portal.home2smart.com', 'h2s-bundles-frontend.vercel.app'),
  [int]$MaxPages = 25
)

$ErrorActionPreference = 'Stop'
$global:ProgressPreference = 'SilentlyContinue'

function Get-NextCursor {
  param([Parameter(Mandatory = $true)][string]$Text)
  $flat = $Text -replace "`r?`n", ' '
  $m = [regex]::Match($flat, '--next\s+(\d+)')
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}

$found = @{}
foreach ($p in $Patterns) { $found[$p] = $false }

$next = $null
for ($page = 1; $page -le $MaxPages; $page++) {
  $args = @('alias', 'list', '--scope', $Scope, '--no-color')
  if ($next) { $args += @('--next', $next) }

  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $outLines = & vercel @args 2>&1 | ForEach-Object { [string]$_ }
  } finally {
    $ErrorActionPreference = $prev
  }
  $out = ($outLines | Out-String)

  foreach ($p in $Patterns) {
    if (-not $found[$p] -and $out -match [regex]::Escape($p)) {
      $found[$p] = $true
    }
  }

  $matches = $outLines | Where-Object {
    $line = [string]$_
    foreach ($p in $Patterns) {
      if ($line -match [regex]::Escape($p)) { return $true }
    }
    return $false
  }

  if ($matches -and $matches.Count -gt 0) {
    Write-Host ("=== Page {0} ===" -f $page) -ForegroundColor Yellow
    $matches | ForEach-Object { Write-Host $_ }
    Write-Host ''
  }

  $next = Get-NextCursor -Text $out
  $all = $true
  foreach ($p in $Patterns) { if (-not $found[$p]) { $all = $false } }
  if ($all) { break }
  if (-not $next) { break }
}

Write-Host 'Found flags:' -ForegroundColor Cyan
foreach ($p in $Patterns) {
  Write-Host ("  {0}: {1}" -f $p, $found[$p])
}
