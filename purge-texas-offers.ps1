param(
  [Parameter(Mandatory=$true)]
  [string]$ApiUrl,

  [int]$Limit = 2000,

  [switch]$Apply,

  [string]$Reason = "purge_texas_seeded_offers_2026-02-14",

  [string]$AdminKey = $env:H2S_ADMIN_TOKEN
)

$ErrorActionPreference = 'Stop'

if (-not $AdminKey -or $AdminKey.Trim().Length -lt 6) {
  throw "Missing admin key. Set env var H2S_ADMIN_TOKEN or pass -AdminKey."
}

function Invoke-Purge($applyFlag) {
  $body = @{ action = 'purgeTexasOffers'; limit = $Limit; apply = $applyFlag; reason = $Reason } | ConvertTo-Json
  $headers = @{ 'Content-Type' = 'application/json'; 'x-h2s-admin-key' = $AdminKey }
  Invoke-RestMethod -Method Post -Uri $ApiUrl -Headers $headers -Body $body
}

Write-Host "[purge-texas-offers] Previewing candidates..." -ForegroundColor Cyan
$preview = Invoke-Purge $false

if (-not $preview.ok) {
  throw ($preview.error | Out-String)
}

Write-Host ("Scanned: {0} | Matches: {1}" -f $preview.scanned, $preview.matches) -ForegroundColor Yellow
if ($preview.preview) {
  $preview.preview | Select-Object -First 25 | Format-Table -AutoSize
}

if (-not $Apply) {
  Write-Host "Dry-run complete. Re-run with -Apply to delete." -ForegroundColor Green
  exit 0
}

Write-Host "[purge-texas-offers] APPLYING deletions..." -ForegroundColor Red
$result = Invoke-Purge $true

if (-not $result.ok) {
  throw ($result.error | Out-String)
}

Write-Host ("Deleted: {0} / Matches: {1}" -f $result.deleted, $result.matches) -ForegroundColor Green
if ($result.errors -and $result.errors.Count -gt 0) {
  Write-Host "Some deletions failed:" -ForegroundColor DarkYellow
  $result.errors | Format-Table -AutoSize
  exit 2
}

exit 0
