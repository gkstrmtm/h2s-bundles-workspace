# FRONTEND DEPLOYMENT CRITICAL RULES

## THE PROBLEM
Manual deployments from `frontend/` folder via `vercel --prod` create EMPTY deployments that break both domains.

## WHY IT BREAKS
- Vercel deploys the folder structure but doesn't serve the HTML files correctly
- The "Builds: . [0ms]" indicates no build step ran
- Portal and shop domains point to these empty deployments and return 404

## THE SOLUTION
**USE GIT-TRIGGERED AUTO-DEPLOY ONLY**

The h2s-bundles-frontend project must be configured in Vercel dashboard with:
- **Root Directory**: `frontend`
- **Git Integration**: Enabled, watching `main` branch
- **Auto-deploy**: On push to main

## VERIFIED WORKING DEPLOYMENT
```
h2s-bundles-frontend-ocfo1pksa-tabari-ropers-projects-6f2e090b.vercel.app
Created: Jan 6 2026 18:06 EST
Status: WORKING ✓
```

## DEPLOYMENT WORKFLOW

### Option 1: Git Auto-Deploy (RECOMMENDED - ONLY METHOD THAT WORKS)
```powershell
cd c:\Users\tabar\h2s-bundles-workspace

# Make changes to frontend/portal.html or frontend/bundles.html

# Validate before committing
.\deploy-frontend-safe.ps1 -Test

# Commit and push (triggers auto-deploy)
git add -A
git commit -m "Update frontend"
git push

# Wait 15 seconds, then verify
.\verify-frontend-live.ps1
```

### Option 2: Manual Rollback (IF AUTO-DEPLOY FAILS)
```powershell
# Rollback to known working deployment
echo "y" | vercel alias set h2s-bundles-frontend-ocfo1pksa-tabari-ropers-projects-6f2e090b.vercel.app portal.home2smart.com
echo "y" | vercel alias set h2s-bundles-frontend-ocfo1pksa-tabari-ropers-projects-6f2e090b.vercel.app shop.home2smart.com

# Verify
.\verify-frontend-live.ps1
```

## CRITICAL: DO NOT DO THIS
```powershell
# ❌ NEVER DO THIS - Creates empty deployment
cd frontend
vercel --prod --yes
```

## SAFEGUARD SCRIPTS

### deploy-frontend-safe.ps1
- Validates all required files exist
- Checks portal.html version and backend URL
- Verifies vercel.json domain routing
- **PREVENTS manual deployment** (explains why it fails)

Usage:
```powershell
.\deploy-frontend-safe.ps1 -Test    # Validate only, no deploy
.\deploy-frontend-safe.ps1           # Shows git workflow instructions
```

### verify-frontend-live.ps1
- Tests portal.home2smart.com accessibility
- Tests shop.home2smart.com accessibility
- Shows current deployment URL
- Provides rollback instructions if broken

Usage:
```powershell
.\verify-frontend-live.ps1
```

## REQUIRED FILES IN FRONTEND/
- portal.html (Technician portal UI)
- bundles.html (Shop/bundles page)  
- vercel.json (Domain routing configuration)
- All .js files referenced by the HTML

## DOMAIN ROUTING (vercel.json)
```json
{
  "rewrites": [
    {
      "source": "/",
      "has": [{"type": "host", "value": "portal.home2smart.com"}],
      "destination": "/portal.html"
    },
    {
      "source": "/",
      "has": [{"type": "host", "value": "shop.home2smart.com"}],
      "destination": "/bundles.html"
    }
  ]
}
```

## CURRENT BACKEND CONFIGURATION
Portal uses: `backend-azd9eq7wd-tabari-ropers-projects-6f2e090b.vercel.app/api`
Database: `https://ulbzmgmxrqyipclrbohi.supabase.co` (Main DB with h2s_pros, h2s_jobs, etc.)

## IF BOTH DOMAINS RETURN 404
1. Check latest deployment: `vercel ls h2s-bundles-frontend | Select-Object -First 3`
2. If latest is < 1 hour old, it's probably empty
3. Rollback to working deployment (see Option 2 above)
4. DO NOT deploy manually again - wait for git auto-deploy fix

## VERCEL DASHBOARD LINKS
- Project settings: https://vercel.com/tabari-ropers-projects-6f2e090b/h2s-bundles-frontend/settings
- Git integration: https://vercel.com/tabari-ropers-projects-6f2e090b/h2s-bundles-frontend/settings/git
- Deployment protection: https://vercel.com/tabari-ropers-projects-6f2e090b/h2s-bundles-frontend/settings/deployment-protection (MUST BE OFF)
