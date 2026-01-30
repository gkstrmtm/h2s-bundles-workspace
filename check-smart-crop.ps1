# Check if smart_crop_details is saved in the database for a specific asset

$assetId = "d7769fe4-4b9a-444a-b5a8-2724aac3fd72"

Write-Host "`n=== Checking smart_crop_details in database ===" -ForegroundColor Cyan
Write-Host "Asset ID: $assetId`n" -ForegroundColor Yellow

# Create SQL query
$query = @"
SELECT 
  asset_id,
  smart_crop_details,
  media_kind,
  width_px,
  height_px,
  updated_at
FROM proof_assets
WHERE asset_id = '$assetId';
"@

Write-Host "Executing query..." -ForegroundColor Gray
Write-Host $query -ForegroundColor DarkGray
Write-Host ""

# Save query to temp file
$queryFile = Join-Path $env:TEMP "check-smart-crop.sql"
$query | Out-File -FilePath $queryFile -Encoding utf8

# Run with psql (assumes connection via environment variables or .pgpass)
$result = psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qmaxftxklcxskbpvmewq -d postgres -f $queryFile 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "=== Query Result ===" -ForegroundColor Green
    $result | ForEach-Object { Write-Host $_ }
} else {
    Write-Host "=== Query Failed ===" -ForegroundColor Red
    Write-Host "Error: $result" -ForegroundColor Red
    Write-Host "`nMake sure psql is in your PATH and connection credentials are configured." -ForegroundColor Yellow
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan
