# NEVER BREAK THIS SYSTEM AGAIN - Protection Rules

## CRITICAL: Run GUARDIAN.ps1 Before EVERY Deployment

```powershell
.\GUARDIAN.ps1
```

If it fails, **DO NOT DEPLOY**. Period.

---

## The 10 Commandments of This System

### 1. **NEVER Touch Relay Environment Variables Without Testing**
   - Relay STRIPE_SECRET_KEY must match the working Stripe key
   - Test locally first: `node backend/test-stripe-live-key.js`
   - If that works, then update Railway
   - **Wrong key = 100% checkout failure**

### 2. **NEVER Deploy Vercel Without These Variables**
   - `STRIPE_RELAY_URL` = `https://modest-beauty-production-2b84.up.railway.app`
   - `STRIPE_RELAY_SECRET` = `a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456`
   - `STRIPE_SECRET_KEY` = (your working Stripe key - not used anymore but keep it)
   - Missing = checkout breaks

### 3. **NEVER Change shop/route.ts Relay Code**
   - Lines 1030-1080 in `backend/app/api/shop/route.ts` are SACRED
   - This code calls the relay instead of Stripe directly
   - Vercel CANNOT call Stripe - proven fact
   - Touch this = everything breaks

### 4. **NEVER Delete promoCache.ts**
   - `backend/lib/promoCache.ts` contains hardcoded promo codes
   - Prevents Stripe API timeouts for validation
   - Contains `h2sqa-e2e-2025` with Stripe ID `promo_1SZWVsLuMP6aPhGZGhct6nRT`
   - Delete this = promo validation breaks

### 5. **ALWAYS Update Vercel Alias After Deploy**
   - After `vercel --prod`, the domain might cache old deployment
   - Force update: `vercel alias set [new-deployment-url] h2s-backend.vercel.app`
   - Cached alias = customers hit old broken code

### 6. **NEVER Create New Stripe Keys Without Testing in Relay**
   - If you rotate Stripe keys, update Railway FIRST
   - Test with GUARDIAN.ps1
   - Then update Vercel if needed
   - Wrong order = outage

### 7. **ALWAYS Check Railway Deployment Status**
   - After changing variables in Railway, wait for redeploy
   - Check: https://modest-beauty-production-2b84.up.railway.app/health
   - Must return `{"ok":true,"service":"h2s-stripe-relay"}`
   - No response = relay down = checkout dead

### 8. **NEVER Remove Idempotency Key Logic**
   - Order ID is generated BEFORE calling relay (line ~1030)
   - Used as idempotency key to prevent duplicate charges
   - Remove this = customers charged multiple times

### 9. **ALWAYS Test With simulateCheckoutPromo.mjs After Changes**
   - Located: `backend/scripts/simulateCheckoutPromo.mjs`
   - Tests 3 scenarios: no promo, valid promo, invalid promo
   - Must see status 200 for first two
   - Status 500 = broken

### 10. **NEVER Deploy If GUARDIAN.ps1 Fails**
    - Run `.\GUARDIAN.ps1` before every deployment
    - Tests relay health, Stripe integration, full checkout flow
    - Exit code 0 = safe to deploy
    - Exit code 1 = DO NOT DEPLOY

---

## What Each Component Does (Don't Break These)

### Railway Relay Service (`relay/`)
- **Purpose**: Proxies Stripe API calls from Vercel (Vercel can't reach Stripe)
- **Files**: `server.js`, `package.json`, `railway.json`
- **Environment Variables**:
  - `STRIPE_SECRET_KEY`: Your working Stripe secret key
  - `RELAY_SECRET`: Shared secret for authentication (must match Vercel)
  - `PORT`: Auto-set by Railway
- **URL**: https://modest-beauty-production-2b84.up.railway.app
- **If This Breaks**: Checkout dies completely

### Vercel Backend (`backend/`)
- **Purpose**: Handles checkout requests, calls relay instead of Stripe
- **Critical File**: `backend/app/api/shop/route.ts` (lines 1030-1080)
- **Environment Variables**:
  - `STRIPE_RELAY_URL`: Railway relay URL
  - `STRIPE_RELAY_SECRET`: Shared secret (must match Railway)
- **URL**: https://h2s-backend.vercel.app
- **If This Breaks**: Checkout returns 500 errors

### Promo Cache (`backend/lib/promoCache.ts`)
- **Purpose**: Hardcoded promo codes to avoid Stripe timeouts
- **Contains**: `h2sqa-e2e-2025` with Stripe promotion_code_id
- **Used By**: `promo_validate`, `promo_check_cart`, checkout handler
- **If This Breaks**: Promo validation times out

### Frontend (`frontend/`)
- **Purpose**: User interface for selecting services and checking out
- **Critical File**: `bundles.js` (handleCheckoutSubmit function)
- **URL**: https://shop.home2smart.com/bundles
- **If This Breaks**: Customers can't checkout

---

## Emergency Recovery Procedures

### If Checkout Returns 500 Errors:

1. **Check Relay Health**:
   ```powershell
   Invoke-RestMethod https://modest-beauty-production-2b84.up.railway.app/health
   ```
   - Should return `{"ok":true}`
   - If not: Check Railway logs, restart service

2. **Check Relay Stripe Key**:
   ```powershell
   cd backend
   node test-stripe-live-key.js
   ```
   - If this works locally but relay fails: Stripe key in Railway is wrong
   - Go to Railway → modest-beauty → Variables → STRIPE_SECRET_KEY → Update with working key

3. **Check Vercel Environment Variables**:
   ```powershell
   vercel env ls
   ```
   - Must have: STRIPE_RELAY_URL, STRIPE_RELAY_SECRET
   - If missing: Add them and redeploy

4. **Force Vercel Alias Update**:
   ```powershell
   vercel ls  # Get latest deployment URL
   vercel alias set [latest-deployment-url] h2s-backend.vercel.app
   ```

5. **Run Guardian**:
   ```powershell
   .\GUARDIAN.ps1
   ```
   - Will tell you exactly what's broken

### If Promo Codes Don't Work:

1. **Check promoCache.ts exists**:
   ```powershell
   Test-Path backend\lib\promoCache.ts
   ```

2. **Check cache contains h2sqa-e2e-2025**:
   ```powershell
   Select-String "h2sqa-e2e-2025" backend\lib\promoCache.ts
   ```

3. **Redeploy backend**:
   ```powershell
   cd backend
   vercel --prod
   ```

### If Frontend Can't Load:

1. **Check Vercel frontend deployment**:
   - Go to https://vercel.com → h2s-bundles-frontend
   - Check deployment status

2. **Check DNS**:
   ```powershell
   Resolve-DnsName shop.home2smart.com
   ```

---

## Testing Checklist (Do This After ANY Change)

```powershell
# 1. Run Guardian
.\GUARDIAN.ps1

# 2. Test checkout WITHOUT promo
cd backend\scripts
node simulateCheckoutPromo.mjs

# 3. Test actual frontend
# Go to: https://shop.home2smart.com/bundles
# Add service, fill form, click checkout
# Should redirect to Stripe (not timeout)

# 4. Test WITH promo code
# Go to: https://shop.home2smart.com/bundles
# Add service, enter h2sqa-e2e-2025
# Cart should show $0.00
# Click checkout - should work

# 5. Check Railway logs
cd relay
railway logs

# Should see: [Relay] ✓ Session created: cs_...
# Should NOT see: Invalid API Key
```

---

## File Locations (Don't Move These)

```
h2s-bundles-workspace/
├── GUARDIAN.ps1                           ← RUN THIS BEFORE DEPLOY
├── relay/
│   ├── server.js                         ← Relay service code
│   ├── package.json                      ← Dependencies
│   └── railway.json                      ← Railway config
├── backend/
│   ├── app/api/shop/route.ts            ← Lines 1030-1080 are CRITICAL
│   ├── lib/promoCache.ts                ← Promo code cache
│   ├── scripts/
│   │   ├── simulateCheckoutPromo.mjs    ← Test script
│   │   └── test-stripe-live-key.js      ← Stripe key validator
│   └── vercel.json                       ← Vercel config
└── frontend/
    └── bundles.js                        ← Frontend checkout handler
```

---

## Contact Points / URLs

- **Railway Relay**: https://modest-beauty-production-2b84.up.railway.app
- **Vercel Backend**: https://h2s-backend.vercel.app
- **Frontend**: https://shop.home2smart.com/bundles
- **Relay Health**: https://modest-beauty-production-2b84.up.railway.app/health
- **Railway Dashboard**: https://railway.app
- **Vercel Dashboard**: https://vercel.com
- **Stripe Dashboard**: https://dashboard.stripe.com

---

## Summary: What Actually Happened

**Problem**: Vercel serverless functions cannot connect to Stripe API (infrastructure timeout)

**Solution**: Created relay service on Railway that proxies Stripe calls

**Architecture**:
```
Frontend → Vercel Backend → Railway Relay → Stripe API ✓
```

**Why This Works**: Railway can reach Stripe, Vercel cannot. Relay bridges the gap.

**Why This Breaks**: If relay is down, has wrong Stripe key, or Vercel has wrong relay URL/secret.

**How to Keep It Working**: Run GUARDIAN.ps1 before every deployment. If it passes, you're safe.

---

## Final Warning

This system took hours to debug and fix. The relay service is NOT optional - it's the ONLY way checkout works from Vercel. If you remove it or break it, checkout dies instantly. 100% of customers will get 500 errors.

**Before you deploy ANYTHING:**
1. Run `.\GUARDIAN.ps1`
2. If it fails, fix the failure
3. Run it again
4. Only deploy when it passes

**No exceptions. Ever.**
