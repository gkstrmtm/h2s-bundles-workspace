# DEPLOYMENT RULES - NEVER BREAK THESE
**Created:** January 6, 2026  
**Updated:** January 6, 2026 - Added deployment verification system  
**Purpose:** Prevent confusion and ensure clean deployments

## 🚨 THE ONE RULE TO RULE THEM ALL

**THERE ARE ONLY 2 VERCEL PROJECTS. PERIOD.**

1. **h2s-bundles-frontend** - Serves HTML files
2. **h2s-backend** - Serves API endpoints

If you see any other Vercel project mentioned, DELETE IT or IGNORE IT.

---

## ⚠️ CRITICAL: ALWAYS USE THE VERIFICATION SCRIPT

**NEVER deploy manually. ALWAYS use:**

```powershell
.\deploy-and-verify.ps1
```

**This script prevents deployment confusion by:**
1. ✅ Stamping unique versions on both portal.html and bundles.html
2. ✅ Deploying to Vercel automatically
3. ✅ Verifying correct files are on correct URLs
4. ✅ Showing console log versions for confirmation
5. ✅ Catching deployment mistakes in 30 seconds

**See [DEPLOYMENT_VERIFICATION.md](DEPLOYMENT_VERIFICATION.md) for complete documentation.**

---

## 📂 DIRECTORY STRUCTURE (ENFORCED)

```
h2s-bundles-workspace/
├── frontend/              ← EDIT HERE (your working directory)
│   ├── portal.html        ← Edit portal UI here
│   └── bundles.html       ← Edit shop UI here
│
├── backend/               ← API BACKEND (separate deployment)
│   ├── app/api/           ← All API endpoints live here
│   └── lib/               ← Shared backend utilities
│
├── portal.html            ← DEPLOYED VERSION (copied from frontend/)
├── bundles.html           ← DEPLOYED VERSION (copied from frontend/)
├── vercel.json            ← Routing rules
│
├── deploy-and-verify.ps1  ← DEPLOYMENT SCRIPT (use this!)
└── verify-live-deployment.ps1  ← Quick check what's live
````

**FORBIDDEN DIRECTORIES:**
- ❌ `/app` - DELETE IT if it exists
- ❌ `/api` - APIs belong in `/backend/app/api`
- ❌ Any other backend-looking folder at root

---

## 🔄 DEPLOYMENT WORKFLOW

### When you change PORTAL or SHOP UI:

```powershell
# 1. Edit in frontend/
code frontend/portal.html

# 2. Copy to root for deployment
Copy-Item "frontend\portal.html" "portal.html" -Force
# OR for shop:
Copy-Item "frontend\bundles.html" "bundles.html" -Force

# 3. Commit and deploy
git add -A
git commit -m "Update portal/shop UI"
git push
vercel --prod --force
```

**Result:** Deploys to `h2s-bundles-frontend` → Serves at portal.home2smart.com & shop.home2smart.com

### When you change API ENDPOINTS:

```powershell
# 1. Navigate to backend
cd backend

# 2. Edit API files
code app/api/portal_login/route.ts

# 3. Deploy backend separately
vercel --prod --force

# 4. Go back to root
cd ..
```

**Result:** Deploys to `h2s-backend` → APIs available at h2s-backend.vercel.app/api/*

---

## ✅ API CONFIGURATION (CARVED IN STONE)

### Both portal.html AND bundles.html use:
```javascript
const VERCEL_API = "https://h2s-backend.vercel.app/api";
```

**NEVER CHANGE THIS TO:**
- ❌ `/api` (local routing doesn't work)
- ❌ `https://backend.vercel.app` (wrong project)
- ❌ `https://portal.home2smart.com/api` (frontend has no APIs)

---

## 🧪 VERIFICATION CHECKLIST

Before saying "it's deployed", run these tests:

```powershell
# Test 1: Portal page loads
Invoke-WebRequest -Uri "https://portal.home2smart.com/portal" -UseBasicParsing

# Test 2: Shop page loads  
Invoke-WebRequest -Uri "https://shop.home2smart.com/bundles" -UseBasicParsing

# Test 3: Backend API responds
Invoke-WebRequest -Uri "https://h2s-backend.vercel.app/api/portal_me" -Method OPTIONS -UseBasicParsing

# Test 4: Check what API portal uses
$r = Invoke-WebRequest -Uri "https://portal.home2smart.com/portal" -UseBasicParsing
if($r.Content -match 'const VERCEL_API = "(.*?)"'){$matches[1]}
# Should output: https://h2s-backend.vercel.app/api
```

All tests must pass before you're done.

---

## 🛡️ PREVENTING FUTURE CONFUSION

### Red Flags That Mean You're Doing It Wrong:

1. **"Let me create /app/api directory..."** → STOP. APIs go in `/backend/app/api`
2. **"Let me add Next.js to package.json..."** → STOP. Frontend is static HTML only
3. **"Let me create tsconfig.json..."** → STOP. No TypeScript in frontend project
4. **"Let me add environment variables to h2s-bundles-frontend..."** → STOP. Env vars go in h2s-backend
5. **"I'll make portal.html call /api/..."** → STOP. Must call h2s-backend.vercel.app/api

### Safety Checks Before Any Deployment:

```powershell
# Check 1: No /app directory exists
if(Test-Path "app"){Write-Host "❌ DELETE /app directory first!"}else{Write-Host "✅ Clean"}

# Check 2: Portal uses correct API
$content = Get-Content "frontend\portal.html" -Raw
if($content -match 'h2s-backend\.vercel\.app/api'){Write-Host "✅ Correct API"}else{Write-Host "❌ Fix API URL!"}

# Check 3: Linked to correct project
$project = (Get-Content ".vercel\project.json" | ConvertFrom-Json).projectId
if($project -eq "prj_FMOGDbCZbZofImzL1PlMd5kwdiYe"){Write-Host "✅ Correct project"}else{Write-Host "❌ Wrong project!"}
```

---

## 📊 WHAT I LEARNED (Jan 6, 2026)

### The Problem:
- Created `/app/api` directory thinking frontend could serve APIs
- Added 40+ API endpoint files that never deployed
- Portal was calling `/api/*` which returned 404
- Spent hours debugging "missing endpoints" that existed but weren't deployed
- Had 5 Vercel projects when only 2 were needed

### The Root Cause:
- **Confusion between frontend and backend**
- Frontend project (h2s-bundles-frontend) is STATIC HTML ONLY
- Backend project (h2s-backend) is SEPARATE and already working
- Bundles.html was already using h2s-backend correctly
- I tried to reinvent the wheel instead of copying what works

### The Fix:
1. Deleted `/app` directory (removed 8,883 lines of duplicate code)
2. Changed portal.html API from `/api` to `https://h2s-backend.vercel.app/api`
3. Documented the actual architecture in ARCHITECTURE_TRUTH.md
4. Created this deployment guide

### How to Prevent Repeat:
1. **ALWAYS check bundles.html first** - it's the reference implementation
2. **NEVER create directories at root** - only edit `/frontend` or `/backend`
3. **RUN VERIFICATION TESTS** before saying "it's done"
4. **READ THIS FILE** before making any architectural changes

---

## 🎯 THE GOLDEN PATH (Copy This Every Time)

```powershell
# EDITING PORTAL:
code frontend\portal.html                    # Edit here
Copy-Item frontend\portal.html portal.html   # Copy to root
git add -A && git commit -m "Update portal"  # Commit
git push && vercel --prod --force            # Deploy

# EDITING SHOP:
code frontend\bundles.html                   # Edit here  
Copy-Item frontend\bundles.html bundles.html # Copy to root
git add -A && git commit -m "Update shop"    # Commit
git push && vercel --prod --force            # Deploy

# EDITING APIS:
cd backend                                   # Go to backend
code app/api/portal_login/route.ts          # Edit here
vercel --prod --force                        # Deploy backend
cd ..                                        # Back to root
```

---

## 🔒 FINAL WORD

**If you're confused, ask yourself:**
- "Am I editing HTML?" → Use `/frontend`
- "Am I editing APIs?" → Use `/backend`  
- "Do I need a new directory?" → NO, you don't.

**If something doesn't work:**
1. Check if bundles.html has the same feature working
2. Copy what bundles.html does
3. Don't create new architecture

**Remember:** The system was working with bundles.html. Portal just needed to follow the same pattern.
