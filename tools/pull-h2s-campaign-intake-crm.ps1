param(
  [string]$BaseUrl = 'https://h2s-campaign-intake.vercel.app',
  [string]$OutDir = (Join-Path $PSScriptRoot '..\imports\h2s-campaign-intake')
)

$ErrorActionPreference = 'Stop'

function Resolve-AssetUrl {
  param([string]$u)
  if ([string]::IsNullOrWhiteSpace($u)) { return $null }
  $u = $u.Trim()
  if ($u -match '^(?i)https?://') { return $u }
  if ($u.StartsWith('//')) { return ('https:' + $u) }
  if ($u.StartsWith('/')) { return ($BaseUrl.TrimEnd('/') + $u) }
  return $null
}

function Get-LocalPathForUrl {
  param([string]$absoluteUrl)
  $uri = [Uri]$absoluteUrl
  $path = $uri.AbsolutePath.TrimStart('/')
  if ([string]::IsNullOrWhiteSpace($path)) { $path = 'index.html' }
  return (Join-Path $OutDir $path)
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$crmUrl = $BaseUrl.TrimEnd('/') + '/crm.html'
$crmFile = Join-Path $OutDir 'crm.html'
Invoke-WebRequest -Uri $crmUrl -OutFile $crmFile

$html = Get-Content $crmFile -Raw

# Extract src/href values with single or double quotes
$attrPattern = @'
(?is)(?:src|href)\s*=\s*(?:"(?<u>[^"]+)"|'(?<u>[^']+)')
'@
$rawUrls = [regex]::Matches($html, $attrPattern) | ForEach-Object { $_.Groups['u'].Value }

$assetExtPattern = '(?i)\.(js|css|map|png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot)(\?|#|$)'
$assetUrls = $rawUrls |
  ForEach-Object { Resolve-AssetUrl $_ } |
  Where-Object { $_ -and ($_ -match $assetExtPattern) } |
  Sort-Object -Unique

$listFile = Join-Path $OutDir 'asset-urls.txt'
$assetUrls | Set-Content $listFile

$downloaded = 0
$failed = New-Object System.Collections.Generic.List[object]

foreach ($u in $assetUrls) {
  try {
    $local = Get-LocalPathForUrl $u
    $dir = Split-Path -Parent $local
    if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

    # Keep querystring out of the local filename
    $safeLocal = $local
    Invoke-WebRequest -Uri $u -OutFile $safeLocal
    $downloaded++
  }
  catch {
    $failed.Add([pscustomobject]@{ url = $u; error = $_.Exception.Message })
  }
}

$report = [pscustomobject]@{
  baseUrl = $BaseUrl
  outDir = $OutDir
  crmUrl = $crmUrl
  crmFile = $crmFile
  assetCount = $assetUrls.Count
  downloaded = $downloaded
  failedCount = $failed.Count
  failed = $failed
}

$reportFile = Join-Path $OutDir 'download-report.json'
$report | ConvertTo-Json -Depth 6 | Set-Content $reportFile

Write-Host "CRM saved: $crmFile"
Write-Host "Assets found: $($assetUrls.Count)"
Write-Host "Downloaded: $downloaded"
Write-Host "Failed: $($failed.Count)"
Write-Host "Report: $reportFile"