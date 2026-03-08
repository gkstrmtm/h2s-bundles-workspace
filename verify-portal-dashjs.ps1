$ErrorActionPreference = 'Stop'

$expectedBuild = $env:EXPECTED_BUILD
if (-not $expectedBuild) { $expectedBuild = '' }

$dashUrl = 'https://portal.home2smart.com/dash.html'
$dash = Invoke-WebRequest -UseBasicParsing -Uri $dashUrl -Headers @{ 'Cache-Control' = 'no-cache' }
$html = $dash.Content

$hasExpected = $false
if ($expectedBuild) { $hasExpected = $html.Contains($expectedBuild) }

$jsFile = ''
$jsV = ''
try {
  # Supports:
  # - /dash.js?v=BUILD
  # - /dash2.js?v=BUILD
  # - /dash.BUILD.js (build-stamped filename)
  $m = [regex]::Match($html, 'src="/([^\"\?]+\.js)(?:\?v=([^\"]+))?"')
  if ($m.Success) {
    $jsFile = $m.Groups[1].Value
    $jsV = $m.Groups[2].Value
  }
} catch {}

$jsHasStatus = $false
$jsHasStatusLoose = $false
$jsHasRequiredProgress = $false
$jsHasDashSignature = $false
$jsHasActiveOfferSot = $false
$jsSignature = ''
if ($jsV) {
  $jsUrl = 'https://portal.home2smart.com/' + $jsFile + '?v=' + $jsV
} elseif ($jsFile) {
  $jsUrl = 'https://portal.home2smart.com/' + $jsFile
}

if ($jsUrl) {
  $js = Invoke-WebRequest -UseBasicParsing -Uri $jsUrl -Headers @{ 'Cache-Control' = 'no-cache' }
  $jsText = $js.Content
  $jsHasStatus = $jsText.Contains('Status-driven modules (no checklist)')
  $jsHasStatusLoose = ($jsText -match 'Status-driven modules') -and ($jsText -match 'no checklist')
  $jsHasRequiredProgress = $jsText.Contains('Required progress')
  $jsHasDashSignature = $jsText.Contains('DASHJS_SIG_OFFER_FACTORY_STATUS_V1')
  $jsHasActiveOfferSot = $jsText.Contains('H2S_ACTIVE_OFFER_SOT_V1')

  try {
    $idx = $jsText.IndexOf('Required progress')
    if ($idx -ge 0) {
      $start = [Math]::Max(0, $idx - 80)
      $len = [Math]::Min(220, $jsText.Length - $start)
      $jsSignature = $jsText.Substring($start, $len)
    }
  } catch {}
}

[pscustomobject]@{
  expectedBuild = $expectedBuild
  dashHasExpectedBuild = $hasExpected
  dashJsFile = $jsFile
  dashJsV = $jsV
  dashJsUrl = $jsUrl
  jsHasStatusMarker = $jsHasStatus
  jsHasStatusLoose = $jsHasStatusLoose
  jsHasRequiredProgress = $jsHasRequiredProgress
  jsHasDashSignature = $jsHasDashSignature
  jsHasActiveOfferSot = $jsHasActiveOfferSot
  jsSignature = $jsSignature
} | Format-List | Out-String | Write-Output
