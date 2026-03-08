param(
  [string]$ApiBase = 'https://h2s-backend.vercel.app',
  [int]$ScanLimit = 800,
  [int]$MinLen = 24,
  [ValidateSet('all','tof','bof')] [string]$Stage = 'all',
  [ValidateSet('updated_desc','updated_asc')] [string]$Order = 'updated_desc',
  [int]$MaxGroups = 30,
  [string]$AdminToken = $null
)

$token = if (-not [string]::IsNullOrWhiteSpace($AdminToken)) { $AdminToken } else { $env:H2S_ADMIN_TOKEN }
if ([string]::IsNullOrWhiteSpace($token)) {
  throw 'Missing admin token. Set $env:H2S_ADMIN_TOKEN or pass -AdminToken.'
}

$uri = "$ApiBase/api/v1?action=auditOfferModuleDuplicates"
$bodyObj = @{ scanLimit = $ScanLimit; minLen = $MinLen; stage = $Stage; order = $Order; maxGroups = $MaxGroups }
$bodyJson = $bodyObj | ConvertTo-Json -Depth 6

Write-Host "Calling $uri" -ForegroundColor Cyan
Write-Host "  scanLimit=$ScanLimit minLen=$MinLen stage=$Stage order=$Order maxGroups=$MaxGroups" -ForegroundColor DarkGray

try {
  $resp = Invoke-RestMethod -Method Post -Uri $uri -Headers @{
    'Content-Type' = 'application/json'
    'x-h2s-admin-key' = $token
  } -Body $bodyJson -TimeoutSec 120
} catch {
  if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
    $status = [int]$_.Exception.Response.StatusCode
    Write-Host "HTTP $status" -ForegroundColor Red
  }
  throw
}

if (-not $resp.ok) {
  throw ("Audit failed: " + ($resp.error | Out-String))
}

$groups = @($resp.duplicateGroups)
Write-Host "\nScanned: $($resp.scanned)/$($resp.scanLimit) offers" -ForegroundColor Green
Write-Host "Stages: $($resp.stages -join ', ')  minLen: $($resp.minLen)" -ForegroundColor Green
Write-Host "Duplicate groups returned: $($groups.Count)" -ForegroundColor Green

if ($groups.Count -eq 0) {
  Write-Host "\nNo duplicate module-copy groups detected (within scan window)." -ForegroundColor Green
  exit 0
}

Write-Host "\nTop duplicate groups:" -ForegroundColor Yellow

$idx = 0
foreach ($g in $groups) {
  $idx++
  $stage = $g.stage
  $moduleKey = $g.moduleKey
  $count = $g.count
  $fp = $g.fingerprint
  $hook = $g.sample.hook
  $primary = $g.sample.primary

  Write-Host "\n[$idx] $stage/$moduleKey  count=$count  fp=$fp" -ForegroundColor Yellow
  if (-not [string]::IsNullOrWhiteSpace($hook)) {
    Write-Host ("  Hook: " + $hook) -ForegroundColor Gray
  }
  if (-not [string]::IsNullOrWhiteSpace($primary)) {
    Write-Host ("  Primary: " + $primary) -ForegroundColor Gray
  }

  $offers = @($g.offers)
  if ($offers.Count -gt 0) {
    Write-Host "  Offers:" -ForegroundColor DarkGray
    foreach ($o in $offers | Select-Object -First 12) {
      $name = $o.offerName
      $id = $o.offerId
      $updated = $o.updatedAt
      Write-Host "    - $name ($id) updated=$updated" -ForegroundColor DarkGray
    }
    if ($offers.Count -gt 12) {
      Write-Host "    ... +$($offers.Count - 12) more" -ForegroundColor DarkGray
    }
  }
}
