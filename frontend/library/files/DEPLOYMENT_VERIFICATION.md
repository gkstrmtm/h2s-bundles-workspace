# DEPLOYMENT VERIFICATION SYSTEM

## 🎯 Purpose

Prevent deployment confusion by:
1. **Stamping each file with a unique version before deployment**
2. **Verifying the correct file is live on the correct URL**
3. **Checking console logs match the expected version**
4. **Preventing wrong file from being deployed to wrong domain**

## 🚨 The Problem This Solves

You said: *"A lot of times we try to deploy the associated correct file with portal.home2smart.com or the shop.home2smart.com/bundle, and you think that you deployed it correctly, or the right file is on a pop-up in the unique console logs may show what this deployment and it is a lot of times we had to go back and forth for that shit."*

**This system guarantees:**
- Portal.html always goes to portal.home2smart.com
- Bundles.html always goes to shop.home2smart.com
- Console logs show EXACTLY what version is live
- You can verify in 10 seconds what's deployed

---

## 📋 How It Works

### Version Stamps

Every deployment stamps both files with:
```javascript
// In portal.html:
console.log('🔧 PORTAL VERSION: 2026-01-06-143022');
console.log('🔧 Deployed to: portal.home2smart.com');
console.log('🔧 Backend: h2s-backend.vercel.app/api');

// In bundles.html:
console.log('🛒 SHOP VERSION: 2026-01-06-143022');
console.log('🛒 Deployed to: shop.home2smart.com');
console.log('🛒 Backend: h2s-backend.vercel.app/api');
```

### Verification Process

1. **Stamp** both files with timestamp version
2. **Deploy** to Vercel
3. **Wait** 20 seconds for CDN
4. **Fetch** portal.home2smart.com/portal and check console log
5. **Fetch** shop.home2smart.com/bundles and check console log
6. **Compare** versions - must match deployment version
7. **Alert** if wrong file is on wrong URL

---

## 🚀 Deployment Commands

### Option 1: Full Deploy with Verification (RECOMMENDED)

```powershell
.\deploy-and-verify.ps1
```

**What it does:**
1. Generates timestamp: `2026-01-06-143022`
2. Stamps portal.html with version
3. Stamps bundles.html with version
4. Copies both to root (Vercel deploys from root)
5. Shows git diff
6. Asks for confirmation
7. Commits and pushes to Git
8. Triggers Vercel deployment
9. Waits 20 seconds
10. Fetches portal.home2smart.com and verifies version
11. Fetches shop.home2smart.com and verifies version
12. Shows green ✅ if versions match
13. Shows red ❌ if versions don't match

**Example output:**
```
🚀 HOME2SMART DEPLOYMENT VERIFICATION SYSTEM

📋 Version: 2026-01-06-143022

📝 Stamping portal.html...
   ✅ Portal stamped with version: 2026-01-06-143022

📝 Stamping bundles.html...
   ✅ Shop stamped with version: 2026-01-06-143022

📋 Copying to root for deployment...
   ✅ Files copied to root

🚀 Deploying to Vercel...
   ✅ Pushed to Git
   ✅ Vercel deployment triggered

⏳ Waiting 20 seconds for CDN propagation...

🔍 VERIFICATION PHASE

📍 Checking portal.home2smart.com/portal...
   ✅ Portal version MATCHES: 2026-01-06-143022

📍 Checking shop.home2smart.com/bundles...
   ✅ Shop version MATCHES: 2026-01-06-143022

📍 Checking h2s-backend.vercel.app/api...
   ✅ Backend API is reachable

🎯 DEPLOYMENT COMPLETE - Version: 2026-01-06-143022
```

### Option 2: Quick Verification (No Deploy)

If you already deployed and just want to check what's live:

```powershell
.\verify-live-deployment.ps1
```

**What it does:**
1. Fetches portal.home2smart.com/portal
2. Extracts version from console log
3. Fetches shop.home2smart.com/bundles
4. Extracts version from console log
5. Shows what's actually live

**Example output:**
```
🔍 LIVE DEPLOYMENT VERIFICATION

📍 Checking portal.home2smart.com/portal...
   ✅ Portal is live
   📋 Version: 2026-01-06-143022
   🔗 Backend: h2s-backend.vercel.app/api

📍 Checking shop.home2smart.com/bundles...
   ✅ Shop is live
   📋 Version: 2026-01-06-143022
   🔗 Backend: h2s-backend.vercel.app/api

📍 Checking h2s-backend.vercel.app/api...
   ✅ Backend API is reachable

🎯 Both sites are live and serving correct pages

📊 Versions:
   Portal: 2026-01-06-143022
   Shop:   2026-01-06-143022

✅ Versions match - deployment synchronized
```

---

## ✅ Manual Verification (Browser)

After deployment, open DevTools console:

### Portal Check
1. Open **incognito window** (bypasses cache)
2. Go to `https://portal.home2smart.com/portal`
3. Open DevTools (F12) → Console tab
4. Look for:
   ```
   🔧 PORTAL VERSION: 2026-01-06-143022
   🔧 Deployed to: portal.home2smart.com
   🔧 Backend: h2s-backend.vercel.app/api
   ```

### Shop Check
1. Open **incognito window**
2. Go to `https://shop.home2smart.com/bundles`
3. Open DevTools (F12) → Console tab
4. Look for:
   ```
   🛒 SHOP VERSION: 2026-01-06-143022
   🛒 Deployed to: shop.home2smart.com
   🛒 Backend: h2s-backend.vercel.app/api
   ```

### ❌ Red Flags

If you see:
- `🔧 PORTAL VERSION` on shop.home2smart.com → **WRONG FILE!**
- `🛒 SHOP VERSION` on portal.home2smart.com → **WRONG FILE!**
- Old version timestamp → **CDN still cached**
- No version console logs → **Wrong deployment**

---

## 🔧 Troubleshooting

### "Versions don't match after deployment"

**Cause:** CDN caching (Vercel Edge Network takes up to 60 seconds to propagate)

**Fix:**
```powershell
# Wait 60 seconds, then re-verify
Start-Sleep -Seconds 60
.\verify-live-deployment.ps1
```

### "Portal is showing shop page" or vice versa

**Cause:** Vercel routing misconfigured or files copied wrong

**Fix:**
```powershell
# Check vercel.json routing
cat vercel.json

# Should have:
# portal.home2smart.com → /portal → portal.html
# shop.home2smart.com → /bundles → bundles.html

# Re-copy files
Copy-Item frontend\portal.html portal.html -Force
Copy-Item frontend\bundles.html bundles.html -Force

# Re-deploy
.\deploy-and-verify.ps1
```

### "Backend check failed"

**Cause:** h2s-backend.vercel.app might be down or CORS issue

**Fix:**
```powershell
# Check backend directly
curl https://h2s-backend.vercel.app/api/portal_login -Method OPTIONS -Verbose

# Should return 204 No Content
# If 404 or 500, backend has issues
```

### "No version marker found"

**Cause:** Old deployment without version stamps, or wrong file deployed

**Fix:**
1. Verify you're deploying from `h2s-bundles-workspace` root
2. Check `frontend\portal.html` and `frontend\bundles.html` have version markers
3. Run `.\deploy-and-verify.ps1` to re-stamp and deploy

---

## 📚 Integration with Other Safeguards

This system works with:

1. **Pre-commit hooks** (`.git/hooks/pre-commit.ps1`)
   - Blocks commits with `/app` directory
   - Blocks commits with wrong API URLs
   - Prevents architectural mistakes BEFORE deployment

2. **validate-system.ps1**
   - Checks local files for forbidden patterns
   - Validates API configuration
   - Ensures `.reference/` snapshots exist

3. **E2E_TEST_PLAN.md**
   - Full flow testing after deployment
   - Validates portal signup → job assignment → completion
   - Validates shop booking → payment → job creation

**Workflow:**
```
Edit files
   ↓
Git commit (pre-commit hook validates)
   ↓
.\deploy-and-verify.ps1 (stamps, deploys, verifies)
   ↓
Manual console check (confirm version)
   ↓
Run E2E tests (full flow validation)
```

---

## 🎯 Success Criteria

**Deployment is successful when:**

✅ `deploy-and-verify.ps1` shows all green checkmarks  
✅ Portal console shows correct version timestamp  
✅ Shop console shows correct version timestamp  
✅ Both versions match deployment timestamp  
✅ Backend API returns 204 on OPTIONS  
✅ No red error messages in verification output  

**If ANY of these fail, DO NOT PROCEED TO E2E TESTING.**

Fix the deployment first, then re-run `.\deploy-and-verify.ps1`.

---

## 📝 Version Format

Versions use timestamp format: `YYYY-MM-DD-HHMMSS`

Example: `2026-01-06-143022`
- **Date:** 2026-01-06 (January 6, 2026)
- **Time:** 14:30:22 (2:30:22 PM)

**Why timestamps?**
- Unique for every deployment
- Chronological ordering
- Easy to see when deployed
- No manual version incrementing

---

## 🚨 MANDATORY RULES

1. **ALWAYS use `deploy-and-verify.ps1` for deployments**
   - Never deploy manually with `git push` alone
   - Never skip version stamping

2. **ALWAYS verify in incognito mode**
   - Regular browser caches old versions
   - Incognito shows what users actually see

3. **ALWAYS check both portal AND shop**
   - Don't assume if one works, both work
   - They deploy together but could be cached differently

4. **ALWAYS wait 20-60 seconds after deploy**
   - CDN propagation takes time
   - Don't panic if immediate check fails

5. **NEVER edit portal.html or bundles.html in root**
   - Edit in `frontend/` directory only
   - Script copies to root automatically

---

## 📞 Quick Reference

| Command | Purpose |
|---------|---------|
| `.\deploy-and-verify.ps1` | Full deploy with verification |
| `.\verify-live-deployment.ps1` | Check what's currently live |
| `.\validate-system.ps1` | Pre-deploy health check |
| `git diff portal.html bundles.html` | See local changes |
| `vercel logs` | View Vercel deployment logs |

---

## 🎉 Summary

**You asked for a safeguard to prevent deployment confusion.**

**This system gives you:**
- ✅ Unique version on every deployment
- ✅ Automated verification that correct file is on correct URL
- ✅ Console logs showing EXACTLY what's live
- ✅ Red/green feedback in 30 seconds
- ✅ No more guessing if you deployed correctly

**Use `.\deploy-and-verify.ps1` for every deployment.**

No more back and forth. No more confusion. Deploy with confidence. 🚀
