param(
  [switch]$IncludeDashAssets
)

$ErrorActionPreference = 'Stop'

$now = Get-Date

# Touching dash.js while it is open in VS Code will frequently trigger
# "Unable to write file ... (Error: File Modified Since)" save conflicts.
# Default to touching only vercel.json; opt-in to touching dash.js/dash.css.
$paths = @('frontend\vercel.json')
if ($IncludeDashAssets) {
  $paths = @(
    'frontend\dash.js',
    'frontend\dash.css',
    'frontend\vercel.json'
  )
}

foreach ($p in $paths) {
  if (Test-Path -LiteralPath $p) {
    (Get-Item -LiteralPath $p).LastWriteTime = $now
    Write-Output ("touched " + $p)
  } else {
    Write-Output ("missing " + $p)
  }
}
