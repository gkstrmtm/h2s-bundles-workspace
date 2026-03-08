# Deploy the CRM (Internal) app to the existing Vercel project: h2s-campaign-intake
# This assumes you've already run `vercel pull` in imports/h2s-campaign-intake (done once).

param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$dir = Join-Path $PSScriptRoot 'imports\h2s-campaign-intake'
if (-not (Test-Path $dir)) {
  throw "Missing folder: $dir"
}

Push-Location $dir
try {
  $args = @('deploy', '--prod', '--yes')
  if ($Force) { $args += '--force' }
  & vercel @args
  if ($LASTEXITCODE -ne 0) { throw "Vercel deploy failed (exit $LASTEXITCODE)" }
}
finally {
  Pop-Location
}
