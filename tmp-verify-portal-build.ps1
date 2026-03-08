$ErrorActionPreference = 'Stop'

$base = 'https://portal.home2smart.com'
$paths = @('/', '/dash', '/dash.html', '/portal.html')

foreach ($path in $paths) {
  $url = ($base.TrimEnd('/') + $path)
  Write-Host "" 
  Write-Host ("=== FETCH " + $url + " ===")
  $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 -Uri $url
  $html = $resp.Content

  Write-Host ("STATUS=" + $resp.StatusCode)
  try {
    if ($resp.BaseResponse -and $resp.BaseResponse.ResponseUri) {
      Write-Host ("FINAL_URL=" + $resp.BaseResponse.ResponseUri.AbsoluteUri)
    }
  } catch {
    # ignore
  }
  Write-Host ("LEN=" + $html.Length)

  $build = [regex]::Match($html, 'PORTAL_BUILD_[A-Za-z0-9_]+').Value
  $js = [regex]::Match($html, 'dash\.PORTAL_BUILD_[A-Za-z0-9_]+\.js').Value
  $anyDashJs = [regex]::Match($html, "dash[^`"']*\.js").Value

  Write-Host ("BUILD_ID=" + $build)
  Write-Host ("STAMPED_JS=" + $js)
  Write-Host ("ANY_DASH_JS=" + $anyDashJs)

  if ($build -or $js -or $anyDashJs) {
    $snippetLen = [Math]::Min(400, $html.Length)
    Write-Host "---HTML_SNIPPET_START---"
    Write-Host ($html.Substring(0, $snippetLen))
    Write-Host "---HTML_SNIPPET_END---"
  }

  if (-not [string]::IsNullOrWhiteSpace($js)) {
    $jsUrl = ($base.TrimEnd('/') + '/' + $js)
    $outPath = Join-Path $PSScriptRoot ('_live_' + $js)
    Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 -Uri $jsUrl -OutFile $outPath | Out-Null
    $jsText = Get-Content -Raw -LiteralPath $outPath
    Write-Host ("JS_URL=" + $jsUrl)
    Write-Host ("JS_SAVED=" + $outPath)
    Write-Host ("JS_HAS_isValidTrainingVideoUrl=" + ($jsText -match 'isValidTrainingVideoUrl'))
    Write-Host ("JS_HAS_getTrainingEffectiveVideos=" + ($jsText -match 'getTrainingEffectiveVideos'))
    Write-Host ("JS_HAS_normalizeTrainingVideoUrl=" + ($jsText -match 'normalizeTrainingVideoUrl'))
    Write-Host ("JS_HAS_renderTrainingResourcesHelpers=" + ($jsText -match 'getTrainingEffectiveVideos\('))

    $matches = @('normalizeTrainingVideoUrl','isValidTrainingVideoUrl','getTrainingEffectiveVideos')
    foreach ($m in $matches) {
      $hit = Select-String -LiteralPath $outPath -Pattern $m -SimpleMatch -List
      Write-Host ("GREP_" + $m + "=" + [bool]$hit)
    }
  }
}
