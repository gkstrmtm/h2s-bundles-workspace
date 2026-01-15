# DATABASE CONSTRAINT GUARDIAN
# Monitors database for bad constraints that could break repeat customers

$ErrorActionPreference = "Stop"

Write-Host "`n============================================" -ForegroundColor Cyan
Write-Host "DATABASE CONSTRAINT GUARDIAN" -ForegroundColor Cyan
Write-Host "============================================`n" -ForegroundColor Cyan

# Load env vars from backend
$envPath = "backend\.env.local"
if (-not (Test-Path $envPath)) {
    Write-Host "❌ Missing backend\.env.local file" -ForegroundColor Red
    Write-Host "Run: cd backend; vercel env pull .env.local" -ForegroundColor Yellow
    exit 1
}

$env:SUPABASE_URL = (Get-Content $envPath | Select-String "SUPABASE_URL=" | ForEach-Object { $_ -replace 'SUPABASE_URL=', '' }).Trim('"')
$env:SUPABASE_SERVICE_ROLE_KEY = (Get-Content $envPath | Select-String "SUPABASE_SERVICE_ROLE_KEY=" | ForEach-Object { $_ -replace 'SUPABASE_SERVICE_ROLE_KEY=', '' }).Trim('"')

Write-Host "Checking database: $env:SUPABASE_URL" -ForegroundColor Gray

# Create temp SQL file
$checkSQL = @"
-- Check for bad unique indexes on h2s_dispatch_jobs
SELECT 
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'h2s_dispatch_jobs'
  AND indexdef LIKE '%UNIQUE%'
ORDER BY indexname;
"@

$checkSQL | Out-File -FilePath "temp-check-constraints.sql" -Encoding UTF8

Write-Host "`nChecking unique indexes on h2s_dispatch_jobs..." -ForegroundColor Yellow

# You'll need to implement this with your Supabase client
# For now, output instructions
Write-Host "`nRun this SQL in Supabase SQL Editor:" -ForegroundColor Cyan
Write-Host "-------------------------------------" -ForegroundColor Gray
Write-Host $checkSQL -ForegroundColor White
Write-Host "-------------------------------------" -ForegroundColor Gray

Write-Host "`n✅ EXPECTED INDEXES (GOOD):" -ForegroundColor Green
Write-Host "  - h2s_dispatch_jobs_pkey (primary key on job_id)" -ForegroundColor White
Write-Host "  - h2s_dispatch_jobs_order_id_uq (unique on order_id)" -ForegroundColor White

Write-Host "`n❌ BAD INDEXES (DROP THESE):" -ForegroundColor Red
Write-Host "  - h2s_dispatch_jobs_recipient_step_uq (blocks repeat customers!)" -ForegroundColor White
Write-Host "  - Any other unique index on (recipient_id, step_id)" -ForegroundColor White

Write-Host "`nIf you see bad indexes, run:" -ForegroundColor Yellow
Write-Host "  DROP INDEX IF EXISTS h2s_dispatch_jobs_recipient_step_uq;" -ForegroundColor White

Remove-Item "temp-check-constraints.sql" -ErrorAction SilentlyContinue

Write-Host "`n✅ Guardian check complete" -ForegroundColor Green
Write-Host "Manually verify the SQL results above" -ForegroundColor Gray
