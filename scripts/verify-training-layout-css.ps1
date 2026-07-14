param(
  [string]$BaseUrl = 'https://portal.home2smart.com'
)

$ErrorActionPreference = 'Stop'

function Get-Text([string]$Url) {
  return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 -Uri $Url).Content
}

$ts = Get-Random
$dashUrl = "$($BaseUrl.TrimEnd('/'))/dash?ts=$ts"
$html = Get-Text $dashUrl

$cssRel = [regex]::Match($html, 'dash\.PORTAL_BUILD_\d{8}_\d{4,6}_[a-f0-9]{7}\.css').Value
if (-not $cssRel) {
  Write-Host "ERROR: Could not locate stamped CSS href in HTML from $dashUrl"
  exit 2
}

$jsRel = [regex]::Match($html, 'dash\.PORTAL_BUILD_\d{8}_\d{4,6}_[a-f0-9]{7}\.js').Value
if (-not $jsRel) {
  Write-Host "ERROR: Could not locate stamped JS src in HTML from $dashUrl"
  exit 2
}

$cssRel = $cssRel -replace '^\./', ''
$cssRel = $cssRel -replace '^/', ''
$cssUrl = "$($BaseUrl.TrimEnd('/'))/$cssRel"
$cssText = Get-Text $cssUrl

$jsRel = $jsRel -replace '^\./', ''
$jsRel = $jsRel -replace '^/', ''
$jsUrl = "$($BaseUrl.TrimEnd('/'))/$jsRel"
$jsText = Get-Text $jsUrl

$hasMinmax = [regex]::IsMatch($cssText, 'grid-template-columns:\s*minmax\(280px,\s*320px\)\s*minmax\(0,\s*1fr\)')
$hasClamp = [regex]::IsMatch($cssText, 'training-stage-media--pdf\s*\{[^}]*height:\s*clamp\(520px,\s*74vh,\s*980px\)')

$hasStageBtnPrimaryCss = [regex]::IsMatch($cssText, 'training-stage-btn--primary')
$hasStageBtnSecondaryCss = [regex]::IsMatch($cssText, 'training-stage-btn--secondary')
$hasCobaltInCss = [regex]::IsMatch($cssText, 'training-stage-actions[\s\S]*training-stage-btn--primary[\s\S]*var\(--cobalt\)')

$hasUnclampMarker = [regex]::IsMatch($jsText, 'TRAINING_SPLIT_VIEW_UNCLAMP')
$hasNoPdfMinutesMarker = [regex]::IsMatch($jsText, 'TRAINING_STAGE_META_NO_PDF_MINUTES')
$hasPrimaryClassInJs = [regex]::IsMatch($jsText, 'training-stage-btn--primary')
$hasSecondaryClassInJs = [regex]::IsMatch($jsText, 'training-stage-btn--secondary')
$garbledBullet = ([string]([char]0x00E2) + [string]([char]0x20AC) + [string]([char]0x00A2))
$hasGarbledBullet = $jsText.Contains($garbledBullet)
$hasGviewEmbed = [regex]::IsMatch($jsText, 'docs\.google\.com\/gview')
$hasDocsIframeSrc = [regex]::IsMatch($jsText, 'iframe\s+src=\\"https:\/\/docs\.google\.com')

Write-Host "Dash HTML: $dashUrl"
Write-Host "CSS:      $cssUrl"
Write-Host "JS:       $jsUrl"
Write-Host "Has Training minmax columns: $hasMinmax"
Write-Host "Has PDF clamp height:        $hasClamp"
Write-Host "Has stage btn primary CSS:   $hasStageBtnPrimaryCss"
Write-Host "Has stage btn secondary CSS: $hasStageBtnSecondaryCss"
Write-Host "Stage btns use --cobalt:     $hasCobaltInCss"
Write-Host "Has JS unclamp marker:       $hasUnclampMarker"
Write-Host "Has JS no-PDF-minutes:       $hasNoPdfMinutesMarker"
Write-Host "Has JS primary btn class:    $hasPrimaryClassInJs"
Write-Host "Has JS secondary btn class:  $hasSecondaryClassInJs"
Write-Host "Has garbled bullet sequence: $hasGarbledBullet"
Write-Host "Has gview embed (blocked):   $hasGviewEmbed"
Write-Host "Has docs iframe src:         $hasDocsIframeSrc"

if (-not $hasMinmax -or -not $hasClamp -or -not $hasStageBtnPrimaryCss -or -not $hasStageBtnSecondaryCss -or -not $hasCobaltInCss -or -not $hasUnclampMarker -or -not $hasNoPdfMinutesMarker -or -not $hasPrimaryClassInJs -or -not $hasSecondaryClassInJs -or $hasGarbledBullet -or $hasGviewEmbed -or $hasDocsIframeSrc) {
  exit 1
}
