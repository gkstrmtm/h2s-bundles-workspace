# 🚀 QUICK START: VALIDATION SUITE

> **TL;DR:** Run `.\Run-AllValidations.ps1` before deploying anything

---

## ⚡ 30-Second Validation

```powershell
# Navigate to workspace
cd C:\Users\tabar\h2s-bundles-workspace

# Run basic validation (no credentials needed)
.\Validate-System.ps1

# ✅ Exit code 0 = Safe to deploy
# ❌ Exit code 1 = DO NOT DEPLOY
```

---

## 🔑 Full Validation (With Credentials)

### 1. Set Environment Variables

```powershell
# Admin token (for backend tests)
$env:H2S_ADMIN_TOKEN = "your_admin_token_here"

# Supabase credentials (for database tests)
$env:SUPABASE_URL = "https://ulbzmgmxrqyipclrbohi.supabase.co"
$env:SUPABASE_SERVICE_KEY = "your_service_key_here"
```

**How to get admin token:**
1. Go to https://portal.home2smart.com
2. Sign up as pro
3. Token returned in API response

**How to get Supabase credentials:**
1. Supabase Dashboard → Settings → API
2. Copy `service_role` key (NOT `anon`)

---

### 2. Run Master Validation

```powershell
.\Run-AllValidations.ps1 -Verbose
```

**Expected output:**
```
╔════════════════════════════════════════════════════════════════╗
║  FINAL VERDICT                                                 ║
╚════════════════════════════════════════════════════════════════╝

  🎉 SUCCESS! ALL VALIDATIONS PASSED
  System is healthy and ready for deployment
```

---

## 📋 What Gets Tested

### System Validation (`Validate-System.ps1`)
- ✅ Frontend domains (portal, shop)
- ✅ Backend API accessible
- ✅ Database connectivity
- ✅ Critical files exist

### Backend Enhancements (`Test-BackendEnhancements.ps1`)
- ✅ Priority scoring (jobs sorted correctly)
- ✅ Photo de-duplication (hash detection)
- ✅ Race condition protection (no double-assigns)
- ✅ Database schema (no empty fields)

### Database Integrity (`Test-DatabaseIntegrity.ps1`)
- ✅ Tables exist (h2s_orders, h2s_dispatch_jobs, etc.)
- ✅ Required columns present
- ✅ Data integrity (no empty job_details)
- ✅ Referential integrity (no orphaned records)

---

## 📊 Reports Generated

Every run creates timestamped JSON reports:

```
backend-enhancements-report-20250120-143055.json
database-integrity-report-20250120-144322.json
master-validation-report-20250120-145601.json
```

**View latest report:**
```powershell
Get-Content .\*-report-*.json -Tail 1 | ConvertFrom-Json | Format-List
```

---

## 🔥 Pre-Deployment Checklist

**NEVER deploy without running this:**

```powershell
# 1. Run validation
.\Run-AllValidations.ps1

# 2. Check exit code
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ VALIDATION FAILED - DO NOT DEPLOY"
    exit 1
}

# 3. Deploy
cd backend
vercel --prod --yes
cd ..

# 4. Verify post-deploy
.\Run-AllValidations.ps1
```

---

## ⚠️ Troubleshooting

### "Script not found"
```powershell
# Make sure you're in workspace root
cd C:\Users\tabar\h2s-bundles-workspace
Get-ChildItem -Filter "*.ps1"
```

### "Execution policy restricted"
```powershell
# Allow local scripts
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser

# Or run once
powershell -ExecutionPolicy Bypass -File .\Run-AllValidations.ps1
```

### "H2S_ADMIN_TOKEN required"
```powershell
# Set token
$env:H2S_ADMIN_TOKEN = "your_token"

# Verify
$env:H2S_ADMIN_TOKEN
```

### "Database connection failed"
```powershell
# Verify credentials (no spaces/newlines)
$env:SUPABASE_URL.Trim()
$env:SUPABASE_SERVICE_KEY.Trim().Length  # Should be ~200 chars
```

---

## 🎯 Common Scenarios

### Scenario 1: Quick Pre-Deployment Check
```powershell
.\Validate-System.ps1 && echo "✅ Safe to deploy"
```

### Scenario 2: Full Validation (Morning Routine)
```powershell
$env:H2S_ADMIN_TOKEN = "token"
.\Run-AllValidations.ps1 -Verbose | Out-File daily-check.log
```

### Scenario 3: Debug Production Issue
```powershell
# Test specific enhancement
.\Test-BackendEnhancements.ps1 -Verbose

# Review evidence
Get-Content .\backend-enhancements-report-*.json | ConvertFrom-Json | 
  Where-Object { !$_.Passed } | Format-List
```

### Scenario 4: Post-Migration Validation
```powershell
# Export schema before migration
.\Test-DatabaseIntegrity.ps1 -ExportSchema

# Run migration...

# Validate after
.\Test-DatabaseIntegrity.ps1 -Verbose
```

---

## 📚 Full Documentation

**Detailed guide:** `VALIDATION_SCRIPTS_DOCUMENTATION.md` (600+ lines)

**Sections:**
- Script inventory (all 4 scripts explained)
- Usage guide (scenario-based examples)
- Prerequisites (how to get credentials)
- Troubleshooting (common issues + solutions)
- Best practices (automation, security, monitoring)

---

## 🚨 Critical Rules

1. **ALWAYS** run validation before deploying
2. **NEVER** deploy if exit code is 1
3. **ALWAYS** run validation after deploying
4. **NEVER** commit credentials to Git
5. **ALWAYS** review JSON reports for failures

---

## ✅ Success Criteria

**Green light to deploy:**
- ✅ Exit code 0
- ✅ All required tests passed
- ✅ No critical failures in JSON reports

**Red light - DO NOT DEPLOY:**
- ❌ Exit code 1
- ❌ Required tests failed
- ❌ Critical failures in JSON reports

---

## 🔗 Quick Links

**Scripts:**
- [Validate-System.ps1](./Validate-System.ps1) - System health check
- [Test-BackendEnhancements.ps1](./Test-BackendEnhancements.ps1) - Enhancement validation
- [Test-DatabaseIntegrity.ps1](./Test-DatabaseIntegrity.ps1) - Database validation
- [Run-AllValidations.ps1](./Run-AllValidations.ps1) - Master orchestrator

**Documentation:**
- [VALIDATION_SCRIPTS_DOCUMENTATION.md](./VALIDATION_SCRIPTS_DOCUMENTATION.md) - Complete guide
- [ENHANCEMENTS_COMPLETE.md](./ENHANCEMENTS_COMPLETE.md) - Deployment summary

**Deployment:**
- Backend: https://h2s-backend.vercel.app
- Portal: https://portal.home2smart.com
- Shop: https://shop.home2smart.com

---

**Last Updated:** 2025-01-20  
**Status:** ✅ Production Ready  
**Next Action:** Run `.\Run-AllValidations.ps1`
