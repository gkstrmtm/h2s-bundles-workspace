param(
  [Parameter(Mandatory = $true)][string]$StartDate,
  [Parameter(Mandatory = $true)][string]$EndDate,
  [string]$Project = 'h2s-bundles-frontend',
  [string]$Scope = 'tabari-ropers-projects-6f2e090b',
  [string]$Status = 'READY',
  [int]$StopWhenAllOlderThanDays = 20,
  [int]$MaxPages = 10,
  [int]$InspectTimeoutSec = 25,
  [int]$MaxPerDay = 3,
  [int]$MaxTotal = 30,
  [switch]$SummaryOnly,
  [string]$OutFile
)

$ErrorActionPreference = 'Stop'

$vercelCmd = Get-Command vercel -ErrorAction SilentlyContinue
if (-not $vercelCmd) {
  throw 'vercel CLI not found on PATH.'
}

$vercelShim = $vercelCmd.Path
if (-not $vercelShim) {
  throw 'Could not resolve vercel CLI shim path.'
}

$vercelPowershell = (Get-Command powershell -ErrorAction SilentlyContinue).Path
if (-not $vercelPowershell) {
  throw 'powershell.exe not found on PATH.'
}

function Invoke-VercelTextWithTimeout {
  param(
    [Parameter(Mandatory = $true)][string]$VercelArgs,
    [Parameter(Mandatory = $true)][int]$TimeoutSec
  )

  # Use the vercel.ps1 shim so behavior matches interactive `vercel` in PS.
  $a = '-NoProfile -ExecutionPolicy Bypass -File "' + $vercelShim + '" ' + $VercelArgs
  return Invoke-ExeTextWithTimeout -FileName $vercelPowershell -Arguments $a -TimeoutSec $TimeoutSec
}

$start = [DateTime]::ParseExact($StartDate, 'yyyy-MM-dd', $null)
$end = [DateTime]::ParseExact($EndDate, 'yyyy-MM-dd', $null).AddDays(1).AddTicks(-1)

$maxAgeSec = [Math]::Max(1, $StopWhenAllOlderThanDays) * 86400

$deploymentUrlRegex = ('https://{0}-[a-z0-9]+-{1}\.vercel\.app' -f [regex]::Escape($Project), [regex]::Escape($Scope))

function Invoke-ExeTextWithTimeout {
  param(
    [Parameter(Mandatory = $true)][string]$FileName,
    [Parameter(Mandatory = $true)][string]$Arguments,
    [Parameter(Mandatory = $true)][int]$TimeoutSec
  )

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FileName
  $psi.Arguments = $Arguments
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true

  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi

  $null = $p.Start()
  if (-not $p.WaitForExit([Math]::Max(1, $TimeoutSec) * 1000)) {
    try { $p.Kill() } catch {}
    throw "Command timed out after ${TimeoutSec}s: $FileName $Arguments"
  }

  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  return ($stdout + "`n" + $stderr)
}

function Parse-AgeSeconds {
  param([Parameter(Mandatory = $true)][int]$N, [Parameter(Mandatory = $true)][string]$Unit)
  switch ($Unit) {
    's' { return $N }
    'm' { return $N * 60 }
    'h' { return $N * 3600 }
    'd' { return $N * 86400 }
    'w' { return $N * 604800 }
  }
  return $null
}

function Try-ParseVercelCreated {
  param([Parameter(Mandatory = $true)][string]$CreatedText)

  $t = ([string]$CreatedText).Trim()
  if (-not $t) { return $null }

  if ($t -match '^([A-Za-z]{3})\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+GMT([+-])(\d{2})(\d{2})') {
    $monthMap = @{ Jan = 1; Feb = 2; Mar = 3; Apr = 4; May = 5; Jun = 6; Jul = 7; Aug = 8; Sep = 9; Oct = 10; Nov = 11; Dec = 12 }

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

function Get-NextCursor {
  param([Parameter(Mandatory = $true)][string]$Text)
  # output can wrap, so flatten newlines
  $flat = $Text -replace "`r?`n", ' '
  $m = [regex]::Match($flat, '--next\s+(\d+)')
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}

Write-Host ("Listing deployments for {0}/{1} between {2} and {3}..." -f $Scope, $Project, $start.ToString('yyyy-MM-dd'), $end.ToString('yyyy-MM-dd')) -ForegroundColor Cyan

$urls = New-Object System.Collections.Generic.HashSet[string]
$next = $null

for ($page = 0; $page -lt $MaxPages; $page++) {
  $args = 'ls ' + $Project + ' --scope ' + $Scope + ' --no-color -y'
  if ($Status) { $args += ' --status ' + $Status }
  if ($next) { $args += ' --next ' + $next }

  $out = Invoke-VercelTextWithTimeout -VercelArgs $args -TimeoutSec 180
  $next = Get-NextCursor -Text $out

  # Strip whitespace so wrapped URLs become contiguous for matching
  $compact = $out -replace '\s+', ''

  $rowRegex = ('(\d+)([smhdw])(' + $deploymentUrlRegex + ')')
  $matches = [regex]::Matches($compact, $rowRegex)
  if (-not $matches -or $matches.Count -eq 0) {
    Write-Warning "No deployments parsed on page $($page + 1); stopping."
    break
  }

  $ageSecs = @()
  foreach ($m in $matches) {
    $n = [int]$m.Groups[1].Value
    $unit = $m.Groups[2].Value
    $u = $m.Groups[3].Value

    [void]$urls.Add($u)

    $sec = Parse-AgeSeconds -N $n -Unit $unit
    if ($null -ne $sec) { $ageSecs += $sec }
  }

  $minAge = ($ageSecs | Measure-Object -Minimum).Minimum
  $maxAge = ($ageSecs | Measure-Object -Maximum).Maximum

  $nextLabel = $next
  if (-not $nextLabel) { $nextLabel = '<none>' }
  Write-Host ("Page {0}: rows={1}; urls={2}; age(min/max)={3}/{4} sec; next={5}" -f ($page + 1), $matches.Count, $urls.Count, $minAge, $maxAge, $nextLabel) -ForegroundColor DarkCyan

  if ($minAge -gt $maxAgeSec) { break }
  if (-not $next) { break }
}

if ($urls.Count -eq 0) {
  throw 'No deployment URLs found.'
}

$uniqueUrls = New-Object string[] $urls.Count
$urls.CopyTo($uniqueUrls)
Write-Host ("Inspecting {0} unique deployments..." -f $uniqueUrls.Count) -ForegroundColor Cyan

$results = @()
$inspectErrors = 0
$idx = 0

foreach ($u in $uniqueUrls) {
  $idx++
  if (($idx % 25) -eq 0) {
    Write-Host ("  inspect {0}/{1} (errors so far: {2})" -f $idx, $uniqueUrls.Count, $inspectErrors) -ForegroundColor DarkGray
  }

  $inspectText = ''
  try {
    $inspectText = Invoke-VercelTextWithTimeout -VercelArgs ('inspect "' + $u + '" --no-color') -TimeoutSec $InspectTimeoutSec
  } catch {
    $inspectErrors++
    continue
  }

  $createdText = $null
  foreach ($line in ($inspectText -split "`r?`n")) {
    if ($line -match '^\s*created\s+(.+?)\s+\[') {
      $createdText = $matches[1]
      break
    }
  }

  if (-not $createdText) { continue }
  $created = Try-ParseVercelCreated -CreatedText $createdText
  if (-not $created) { continue }

  if ($created -ge $start -and $created -le $end) {
    $results += [pscustomobject]@{
      Created = $created
      Url = $u
      Dash = ($u.TrimEnd('/') + '/dash')
      DashHtml = ($u.TrimEnd('/') + '/dash.html')
    }
  }
}

if ($inspectErrors -gt 0) {
  Write-Warning ("Some deployments could not be inspected: {0}" -f $inspectErrors)
}

$results = $results | Sort-Object Created -Descending
Write-Host ("\nDeployments between {0} and {1}: {2}" -f $start.ToString('yyyy-MM-dd'), $end.ToString('yyyy-MM-dd'), $results.Count) -ForegroundColor Green

# Summary: counts per day + average
$byDay = $results | Group-Object { $_.Created.ToString('yyyy-MM-dd') } | Sort-Object Name -Descending
$days = [Math]::Max(1, ([DateTime]$end.Date - [DateTime]$start.Date).Days + 1)
$avg = if ($results.Count -gt 0) { [Math]::Round(($results.Count / [double]$days), 2) } else { 0 }
Write-Host ("Days in range: {0} - Avg deployments/day: {1}" -f $days, $avg) -ForegroundColor DarkCyan
Write-Host "Counts by day:" -ForegroundColor DarkCyan
$byDay | ForEach-Object { Write-Host ("  {0}: {1}" -f $_.Name, $_.Count) }

if ($SummaryOnly) {
  return
}

# Sample output to avoid huge pages of URLs
$sampled = @()
foreach ($g in $byDay) {
  $take = [Math]::Max(0, $MaxPerDay)
  if ($take -eq 0) { continue }
  $sampled += ($g.Group | Sort-Object Created -Descending | Select-Object -First $take)
}

$sampled = $sampled | Sort-Object Created -Descending
if ($MaxTotal -gt 0) {
  $sampled = $sampled | Select-Object -First $MaxTotal
}

Write-Host ("\nSample (maxPerDay={0}, maxTotal={1}): {2}" -f $MaxPerDay, $MaxTotal, $sampled.Count) -ForegroundColor Yellow
$sampled | ForEach-Object {
  Write-Host ("{0}  {1}" -f $_.Created.ToString('yyyy-MM-dd HH:mm:ss'), $_.Dash)
}

if ($OutFile) {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("# Frontend Deployments (Capped) - $($start.ToString('yyyy-MM-dd')) to $($end.ToString('yyyy-MM-dd'))")
  $lines.Add('')
  $lines.Add("Project: $Scope/$Project")
  $lines.Add("Status filter: $Status")
  $lines.Add("Total deployments in range: $($results.Count)")
  $lines.Add("Days in range: $days")
  $lines.Add("Average deployments/day: $avg")
  $lines.Add('')
  $lines.Add('## Counts by Day')
  $lines.Add('')
  foreach ($g in $byDay) { $lines.Add("- $($g.Name): $($g.Count)") }
  $lines.Add('')
  $lines.Add("## Sample (maxPerDay=$MaxPerDay, maxTotal=$MaxTotal)")
  $lines.Add('')
  foreach ($r in $sampled) {
    $lines.Add("- $($r.Created.ToString('yyyy-MM-dd HH:mm:ss')) - $($r.Dash)")
  }
  Set-Content -LiteralPath $OutFile -Value ($lines -join "`r`n") -Encoding UTF8
  Write-Host ("\nWrote: {0}" -f $OutFile) -ForegroundColor DarkGreen
}
