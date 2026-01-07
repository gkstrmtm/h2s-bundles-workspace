# Validate Environment Variables Against h2s-backend
# Ensures all critical ecosystem vars are present in backend project

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "ENV VAR VALIDATION: backend project" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$criticalVars = @(
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY", 
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_URL_MGMT",
    "DATABASE_URL",
    "STRIPE_SECRET_KEY",
    "OPENAI_API_KEY",
    "DISPATCH_ADMIN_TOKEN"
)

Write-Host "[1/2] Checking backend project env vars..." -ForegroundColor Yellow

$backendEnv = @{}
if (Test-Path "backend\.env.production") {
    Get-Content "backend\.env.production" | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            $backendEnv[$matches[1]] = $matches[2]
        }
    }
    Write-Host "  Found $($backendEnv.Count) variables in backend" -ForegroundColor Green
} else {
    Write-Host "  No .env.production found" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[2/2] Validating critical variables..." -ForegroundColor Yellow

$missing = @()
$present = @()

foreach ($var in $criticalVars) {
    if ($backendEnv.ContainsKey($var) -and $backendEnv[$var] -ne "") {
        $present += $var
        Write-Host "  PASS $var" -ForegroundColor Green
    } else {
        $missing += $var
        Write-Host "  FAIL $var (MISSING)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "RESULT: $($present.Count)/$($criticalVars.Count) present" -ForegroundColor $(if ($missing.Count -eq 0) { "Green" } else { "Yellow" })
Write-Host "========================================" -ForegroundColor Cyan

if ($missing.Count -gt 0) {
    Write-Host ""
    Write-Host "MISSING ($($missing.Count)):" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "ACTION: Copy these from h2s-backend project in Vercel dashboard" -ForegroundColor Yellow
    exit 1
} else {
    Write-Host ""
    Write-Host "ALL CRITICAL ENV VARS PRESENT" -ForegroundColor Green
    exit 0
}
