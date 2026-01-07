# HOME2SMART VERCEL ARCHITECTURE - DEFINITIVE GUIDE
**Last Updated:** January 6, 2026
**Status:** ⚠️ NEEDS CONSOLIDATION - Multiple backends causing confusion

## 🎯 THE PROBLEM
We have **TOO MANY** Vercel projects and backend directories. This causes:
- Confusion about which backend serves which frontend
- Duplicate API endpoints in multiple places
- Deployment failures because endpoints exist in wrong project
- Wasted time debugging the wrong backend

## 📊 CURRENT VERCEL PROJECTS

### 1. **h2s-bundles-frontend** ⭐ PRIMARY FRONTEND
- **URL:** https://shop.home2smart.com (shop), https://portal.home2smart.com (portal)
- **Purpose:** Serves BOTH shop (bundles.html) AND portal (portal.html)
- **Linked to workspace:** ✅ YES (this repo: h2s-bundles-workspace)
- **API Backend:** Uses `h2s-backend.vercel.app` for API calls
- **Node:** 24.x
- **Status:** ACTIVE - This is what customers see

### 2. **h2s-backend** ⭐ PRIMARY API BACKEND  
- **URL:** https://h2s-backend.vercel.app
- **Purpose:** API endpoints for shop AND portal
- **Source:** `/backend` directory in this workspace
- **Node:** 22.x
- **Contains:** All working portal API endpoints (portal_login, portal_jobs, etc.)
- **Status:** ACTIVE - This is where bundles.html sends API requests

### 3. **h2s-bundles-workspace**
- **URL:** https://h2s-bundles-workspace.vercel.app
- **Purpose:** Unknown/legacy?
- **Status:** ⚠️ UNCLEAR PURPOSE

### 4. **backend**
- **URL:** https://backend-tabari-ropers-projects-6f2e090b.vercel.app
- **Purpose:** Appears to be duplicate/old
- **Status:** ⚠️ POSSIBLY OBSOLETE

### 5. **home2smart-internal**
- **URL:** https://home2smart-internal.vercel.app
- **Purpose:** Internal tools
- **Last Updated:** 31 days ago
- **Status:** SEPARATE PROJECT (not related to shop/portal)

## 🗂️ DIRECTORY STRUCTURE IN THIS WORKSPACE

```
h2s-bundles-workspace/
├── frontend/           # ⚠️ WORKING DIRECTORY (we edit here)
│   ├── portal.html     # Portal UI source
│   └── bundles.html    # Shop UI source
│
├── backend/            # ⭐ DEPLOYED TO h2s-backend.vercel.app
│   ├── app/api/        # API routes (Next.js App Router)
│   │   ├── portal_login/
│   │   ├── portal_jobs/
│   │   ├── portal_signup_step1/
│   │   └── ... (30+ portal endpoints)
│   ├── lib/            # Shared libraries
│   │   ├── supabase.ts
│   │   ├── portalTokens.ts
│   │   └── ...
│   └── next.config.js
│
├── app/                # ❌ ATTEMPTED LOCAL API (doesn't deploy)
│   ├── api/            # Copied API routes (NOT DEPLOYED)
│   └── lib/            # Copied libraries (NOT DEPLOYED)
│
├── portal.html         # Deployed version (copied from frontend/)
├── bundles.html        # Deployed version (copied from frontend/)
└── vercel.json         # Routing config
```

## 🔄 CURRENT WORKFLOW (WHAT ACTUALLY WORKS)

### Frontend Deployment:
1. Edit `frontend/portal.html` or `frontend/bundles.html`
2. Copy to root: `Copy-Item frontend\portal.html portal.html`
3. Deploy: `vercel --prod --force`
4. Goes to: **h2s-bundles-frontend** project
5. Serves at: portal.home2smart.com and shop.home2smart.com

### Backend API:
- Already deployed at: **h2s-backend.vercel.app**
- Source: `/backend` directory
- Has all portal endpoints working
- Has Supabase env vars configured

## ❌ WHAT DOESN'T WORK

### Local `/api` Routes:
- We tried adding `app/api/*` routes to h2s-bundles-frontend
- **PROBLEM:** h2s-bundles-frontend doesn't have:
  - Supabase environment variables
  - Next.js dependencies properly configured
  - The right build setup

### Multiple Backends:
- `/backend` directory → h2s-backend.vercel.app (WORKS)
- `/app` directory → nowhere (DOESN'T DEPLOY)
- This duplication causes confusion

## ✅ THE SOLUTION - SINGLE SOURCE OF TRUTH

### DECISION: Use h2s-backend.vercel.app as API Backend

**Why:**
1. Already has all portal endpoints working
2. Has Supabase credentials configured
3. Bundles.html already uses it successfully
4. It's a dedicated API project with proper Next.js setup

**Implementation:**
1. Portal.html should use `https://h2s-backend.vercel.app/api` for ALL API calls
2. Remove the `/app` directory (it's not deploying anyway)
3. All API development happens in `/backend` directory
4. Deploy backend separately when API changes needed

## 🔧 CORRECTED API CONFIGURATION

### Portal.html should use:
```javascript
const VERCEL_API = "https://h2s-backend.vercel.app/api";
```

### Bundles.html uses (already correct):
```javascript
const endpoint = 'https://h2s-backend.vercel.app/api/track';
```

## 📋 ACTION ITEMS TO FIX ARCHITECTURE

- [ ] Change portal.html API from `/api` back to `https://h2s-backend.vercel.app/api`
- [ ] Remove `/app/api` directory (it's causing confusion)
- [ ] Remove `/app/lib` directory (duplicate of backend/lib)
- [ ] Document that `/backend` is the ONLY backend source
- [ ] Consider renaming `/backend` to `/api-backend` for clarity
- [ ] Test all portal functionality with h2s-backend.vercel.app
- [ ] Remove obsolete Vercel projects (h2s-bundles-workspace, backend)

## 🎯 SIMPLIFIED MENTAL MODEL

```
FRONTEND (h2s-bundles-frontend):
  - Serves portal.html at portal.home2smart.com
  - Serves bundles.html at shop.home2smart.com
  - Static HTML files only
  ↓
  API calls to:
  ↓
BACKEND (h2s-backend):
  - Serves all /api/* endpoints
  - Has Supabase connection
  - Handles auth, jobs, payments, etc.
```

## 🚨 CRITICAL RULE GOING FORWARD

**THERE IS ONLY ONE BACKEND: h2s-backend.vercel.app**

- All API endpoints live in `/backend/app/api/`
- Frontend calls `https://h2s-backend.vercel.app/api/*`
- NO local `/api` routes in frontend project
- If you see `/app/api` directory, DELETE IT

---

**Next Steps:** Revert portal.html to use h2s-backend.vercel.app and test all functionality.
