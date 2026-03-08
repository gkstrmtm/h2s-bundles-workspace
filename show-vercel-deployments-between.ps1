param(
  [Parameter(Mandatory = $true)][string]$StartDate,
  [Parameter(Mandatory = $true)][string]$EndDate,
  [string]$InputGlob,
  [int]$InspectTimeoutSec = 25
)

$ErrorActionPreference = 'Stop'

$vercelCmd = Get-Command vercel -ErrorAction SilentlyContinue
if (-not $vercelCmd) {
  throw "vercel CLI not found on PATH. Install Vercel CLI or open a shell where `vercel` works."
}

if (-not $InputGlob) {
  $InputGlob = Join-Path -Path $PSScriptRoot -ChildPath '_vercel_deployments_page*.txt'
} elseif (-not [System.IO.Path]::IsPathRooted($InputGlob)) {
  $InputGlob = Join-Path -Path $PSScriptRoot -ChildPath $InputGlob
}

$DeploymentUrlRegex = '^https://h2s-bundles-frontend-[a-z0-9]+-tabari-ropers-projects-6f2e090b\.vercel\.app$'

function Try-ParseVercelCreated {
  param([Parameter(Mandatory = $true)][string]$CreatedText)

  $t = ''
  if ($null -ne $CreatedText) { $t = $CreatedText.Trim() }
  if (-not $t) { return $null }

  if ($t -match '^([A-Za-z]{3})\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+GMT([+-])(\d{2})(\d{2})') {
    $monthMap = @{
      Jan = 1; Feb = 2; Mar = 3; Apr = 4; May = 5; Jun = 6;
      Jul = 7; Aug = 8; Sep = 9; Oct = 10; Nov = 11; Dec = 12
    }

    $monAbbrev = $matches[2]
    if (-not $monthMap.ContainsKey($monAbbrev)) { return $null }

    $day = [int]$matches[3]
    $year = [int]$matches[4]
    $hour = [int]$matches[5]
    $minute = [int]$matches[6]
    $second = [int]$matches[7]
    $sign = $matches[8]
    $offH = [int]$matches[9]
    $offM = [int]$matches[10]

    $offsetMinutes = ($offH * 60) + $offM
    if ($sign -eq '-') { $offsetMinutes = -1 * $offsetMinutes }
    $offset = [TimeSpan]::FromMinutes($offsetMinutes)

    try {
      $dto = New-Object System.DateTimeOffset($year, $monthMap[$monAbbrev], $day, $hour, $minute, $second, $offset)
      return $dto.LocalDateTime
    } catch {
      return $null
    }
  }

  return $null
}

function Parse-VercelInspectCreated {
  param([Parameter(Mandatory = $true)][string]$DeploymentUrl)

  # NOTE: Use a hard timeout so this script can't appear to "freeze".
  $cmdLine = 'vercel inspect "' + $DeploymentUrl + '" --no-color'

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = '/c ' + $cmdLine + ' 2^>^&1'
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true

  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  $null = $p.Start()

  if (-not $p.WaitForExit([Math]::Max(1, $InspectTimeoutSec) * 1000)) {
    try { $p.Kill() } catch {}
    throw "vercel inspect timed out after ${InspectTimeoutSec}s"
  }

  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $text = ($stdout + "`n" + $stderr)

  # Prefer the dedicated created line.
  $createdText = $null
  foreach ($line in ($text -split "`r?`n")) {
    if ($line -match '^\s*created\s+(.+?)\s+\[') {
      $createdText = $matches[1]
      break
    }
  }

  if (-not $createdText) {
    $m = [regex]::Match($text, 'created\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT[+-]\d{4}.*?\))\s+\[')
    if ($m.Success) { $createdText = $m.Groups[1].Value }
  }

  if (-not $createdText) { return $null }
  return Try-ParseVercelCreated -CreatedText $createdText
}

$start = [DateTime]::ParseExact($StartDate, 'yyyy-MM-dd', $null)
$end = [DateTime]::ParseExact($EndDate, 'yyyy-MM-dd', $null).AddDays(1).AddTicks(-1)

$files = Get-ChildItem -Path $InputGlob -ErrorAction SilentlyContinue | Sort-Object Name
if (-not $files -or $files.Count -eq 0) {
  throw "No input files found matching $InputGlob"
}

Write-Host ("Input files: {0}" -f $files.Count) -ForegroundColor DarkCyan
Write-Host ("Inspect timeout: {0}s" -f $InspectTimeoutSec) -ForegroundColor DarkCyan

$urls = @()
$unexpectedUrls = @()
foreach ($f in $files) {
  $lines = Get-Content -LiteralPath $f.FullName
  foreach ($line in $lines) {
    $u = ([string]$line).Trim()
    if (-not $u) { continue }
    if ($u.EndsWith('/')) { $u = $u.TrimEnd('/') }
    if ($u -match $DeploymentUrlRegex) {
      $urls += $u
    } elseif ($u -match '^https://.+\.vercel\.app$') {
      $unexpectedUrls += $u
    }
  }
}
$urls = $urls | Select-Object -Unique

if ($unexpectedUrls.Count -gt 0) {
  Write-Warning ("Ignoring {0} unexpected vercel.app URL(s) that don't match the h2s-bundles-frontend pattern. First few examples:`n{1}" -f $unexpectedUrls.Count, (($unexpectedUrls | Select-Object -First 5) -join "`n"))
}

Write-Host ("Candidate deployment URLs: {0}" -f $urls.Count) -ForegroundColor DarkCyan
if (-not $urls -or $urls.Count -eq 0) {
  throw "No matching deployment URLs found. Expected lines like: https://h2s-bundles-frontend-<id>-tabari-ropers-projects-6f2e090b.vercel.app"
}

$results = @()
$idx = 0
$inspectErrors = 0
foreach ($u in $urls) {
  $idx++
  $created = $null
  try {
    $created = Parse-VercelInspectCreated -DeploymentUrl $u
  } catch {
    $created = $null
    $inspectErrors++
  }

  if ($created -and $created -ge $start -and $created -le $end) {
    $shortId = $null
    $m = [regex]::Match($u, 'h2s-bundles-frontend-([a-z0-9]+)-tabari-ropers-projects-6f2e090b\\.vercel\\.app')
    if ($m.Success) { $shortId = $m.Groups[1].Value }

    $results += [pscustomobject]@{
      Created = $created
      Id = $shortId
      DashUrl = ($u.TrimEnd('/') + '/dash')
    }
  }

  if (($idx % 25) -eq 0) {
    Write-Host ("Progress: {0}/{1} (inspect errors so far: {2})" -f $idx, $urls.Count, $inspectErrors) -ForegroundColor DarkGray
  }
}

if ($inspectErrors -gt 0) {
  Write-Warning ("Some deployments couldn't be inspected ({0} error(s)). Common causes: not logged into vercel, transient network issues, or inspect timeout." -f $inspectErrors)
}

$results = $results | Sort-Object Created -Descending

Write-Host "Deployments between $($start.ToString('yyyy-MM-dd')) and $($end.ToString('yyyy-MM-dd'))" -ForegroundColor Cyan
Write-Host ''

if (-not $results -or $results.Count -eq 0) {
  Write-Warning ("No deployments matched the requested range. (Inspect errors: {0})" -f $inspectErrors)
  return
}

$results | Group-Object { $_.Created.ToString('yyyy-MM-dd') } | Sort-Object Name -Descending | ForEach-Object {
  Write-Host ("=== {0} ===" -f $_.Name) -ForegroundColor Yellow
  $_.Group | Sort-Object Created -Descending | ForEach-Object {
    $id = if ($_.Id) { $_.Id } else { '?' }
    Write-Host ("{0}  {1}" -f $_.Created.ToString('HH:mm:ss'), $_.DashUrl)
  }
  Write-Host ''
}
