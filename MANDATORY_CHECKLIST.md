# MANDATORY PRE-WORK CHECKLIST
# AGENT: READ THIS EVERY TIME BEFORE TOUCHING ANYTHING

## ⚠️ CRITICAL: ENVIRONMENT VARIABLES

**SOURCE OF TRUTH**: `h2s-backend` Vercel project has ALL correct environment variables

**Required Variables** (must be copied from h2s-backend → backend project):
1. `SUPABASE_URL` - Main database (ulbzmgmxrqyipclrbohi.supabase.co)
2. `SUPABASE_ANON_KEY` - Public API key
3. `SUPABASE_SERVICE_KEY` - Admin/service role key  
4. `SUPABASE_URL_MGMT` - Management database (ngnskohzqijcmyhzmwnm.supabase.co)
5. `DATABASE_URL` - Direct Postgres connection string
6. `STRIPE_SECRET_KEY` - Payment processing
7. `OPENAI_API_KEY` - AI features
8. `DISPATCH_ADMIN_TOKEN` - Admin authentication

**Validation Command**: `.\validate-env-vars.ps1`
- Run this BEFORE any backend changes
- ALL 8 variables must show PASS
- If any FAIL, copy from h2s-backend Vercel dashboard

**NEVER assume env vars exist in backend project - h2s-backend is the source of truth**

---

## CRITICAL RULE
**RUN `.\validate-system.ps1` BEFORE MAKING ANY CHANGES**

If validation fails, DO NOT proceed until issues are fixed.

## WHY WE BROKE THE SYSTEM BEFORE
1. **Deployed frontend manually** → Created empty deployments → Both domains returned 404
2. **Wrong backend project** → Used `backend` instead of verifying which had correct DB
3. **Wrong database credentials** → Backend pointed to management DB, not main DB with h2s_pros
4. **No functional tests** → Thought domains being "up" meant they worked
5. **Changed portal backend URL** → But old version was still deployed, so users saw old broken version

## WHAT CAUSES 2-DAY OUTAGES
- Deploying without testing portal signup actually works
- Changing backend URL without deploying new portal version
- Breaking domain aliases by manual deployment
- Not verifying database tables exist before deploying code that uses them

## THE SYSTEM WE'RE BUILDING

### Data Flow (What MUST work)
```
Shop Checkout → Creates Order → Triggers Job Creation
                     ↓
              h2s_jobs table (Supabase)
                     ↓
           Portal fetches jobs → Tech sees jobs → Tech accepts
                     ↓
            Updates job status → Customer notified
```

### Critical Dependencies
1. **Frontend** (h2s-bundles-frontend Vercel project)
   - portal.html → portal.home2smart.com
   - bundles.html → shop.home2smart.com
   - MUST deploy via Git push (manual deploy creates empty deployments)

2. **Backend** (backend Vercel project - NOT h2s-backend)
   - portal_signup_step1 endpoint
   - portal_login endpoint  
   - portal_jobs endpoint (fetches jobs for tech)
   - checkout → job creation flow

3. **Database** (Supabase: ulbzmgmxrqyipclrbohi.supabase.co)
   - h2s_pros (technician accounts)
   - h2s_jobs (jobs from checkout)
   - h2s_customers (customer data)
   - h2s_job_offers (job assignments to techs)

### What's NOT Implemented Yet
- Checkout → Job creation flow (needs to be built)
- Portal job listing endpoint (exists but may need testing)
- Job acceptance/status update flow
- Customer notifications when job accepted

## BEFORE TOUCHING ANY CODE

### Step 1: Validate System Health
```powershell
cd c:\Users\tabar\h2s-bundles-workspace
.\validate-system.ps1
```

If this fails with red errors, STOP. Fix them first.

### Step 2: Understand What You're Changing
Ask yourself:
- What system component does this affect?
- Could this break the signup flow?
- Am I changing backend URL or database connection?
- Will this require redeploying frontend?

### Step 3: Check Current State
```powershell
# See what's deployed
vercel ls h2s-bundles-frontend | Select-Object -First 3
vercel ls backend | Select-Object -First 3

# See what's live
.\verify-frontend-live.ps1
```

### Step 4: Make Changes in Safe Order
1. **Backend changes** → Deploy backend first → Test endpoint works
2. **Frontend changes** → Update portal.html → Git push → Wait for auto-deploy → Verify
3. **Database changes** → Test locally first → Apply to production → Verify queries work

### Step 5: Validate After Changes
```powershell
.\validate-system.ps1
```

If signup test fails, you broke it. Rollback immediately.

## EMERGENCY ROLLBACK PROCEDURES

### If Portal/Shop Return 404
```powershell
# Rollback to known working deployment
echo "y" | vercel alias set h2s-bundles-frontend-ocfo1pksa-tabari-ropers-projects-6f2e090b.vercel.app portal.home2smart.com
echo "y" | vercel alias set h2s-bundles-frontend-ocfo1pksa-tabari-ropers-projects-6f2e090b.vercel.app shop.home2smart.com
```

### If Portal Signup Returns 501/500
```powershell
# Check which backend portal is using
grep "VERCEL_API" frontend/portal.html

# Should be: https://backend-azd9eq7wd-tabari-ropers-projects-6f2e090b.vercel.app/api
# If not, fix it and redeploy via git push
```

### If Database Connection Fails
```powershell
# Verify backend env vars
cd backend
vercel env ls

# SUPABASE_URL should be: https://ulbzmgmxrqyipclrbohi.supabase.co
# SUPABASE_SERVICE_KEY should be set

# If wrong, update:
vercel env rm SUPABASE_URL production --yes
echo "https://ulbzmgmxrqyipclrbohi.supabase.co" | vercel env add SUPABASE_URL production
vercel --prod --yes
```

## KEY LESSONS (Don't Forget)

### Lesson 1: Git Auto-Deploy is the ONLY Safe Way
Manual `vercel --prod` from frontend/ folder creates empty deployments. ALWAYS use git push.

### Lesson 2: Test the Function, Not Just the Domain
"Portal is up" ≠ "Portal signup works". Always test the actual signup endpoint.

### Lesson 3: There Are TWO Backend Projects
- `backend` = THE REAL ONE (use this)
- `h2s-backend` = BROKEN (all deploys fail, ignore it)

### Lesson 4: Database Credentials Matter
Main DB (ulbzmgmxrqyipclrbohi) has h2s_pros, h2s_jobs
Management DB (ngnskohzqij) has recruiting tables
Don't mix them up.

### Lesson 5: Domain Changes Take Time
After deploying, domains can take 5-30 seconds to update due to CDN caching.

## NEXT FEATURES TO BUILD

### Priority 1: Checkout → Job Creation
- When customer completes checkout on shop.home2smart.com
- Create entry in h2s_jobs table
- Include: customer info, service type, address, scheduled date
- Send notification to available techs

### Priority 2: Portal Job Listing  
- Endpoint: /api/portal_jobs (GET)
- Returns jobs available for tech to accept
- Filter by: tech's service area, availability, skills

### Priority 3: Job Acceptance Flow
- Tech clicks "Accept Job" in portal
- Creates h2s_job_offers entry
- Updates job status
- Notifies customer

### Priority 4: Status Updates
- Tech updates job progress (en route, started, completed)
- Customer sees real-time status
- Payment processing triggers

## VALIDATION SCRIPTS AVAILABLE

1. **validate-system.ps1** - Full system health check (RUN THIS FIRST)
2. **verify-frontend-live.ps1** - Check domains are accessible
3. **deploy-frontend-safe.ps1** - Prevent bad deployments
4. **validate-portal-deployment.ps1** - Check portal config matches reality

## DOCUMENTATION REFERENCES

- FRONTEND_DEPLOYMENT_RULES.md - Why manual deploys fail
- ECOSYSTEM_MAP.md - Overall system architecture
- Backend endpoints in: backend/app/api/*/route.ts

## REMEMBER
If you're about to make a change and you haven't run `.\validate-system.ps1`, **STOP**.
If validation fails, **FIX IT FIRST**.
If you break signup, **ROLLBACK IMMEDIATELY**.

This checklist exists because we spent 2 days fixing what could have been prevented with 30 seconds of validation.
