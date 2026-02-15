# Stripe Relay Deployment Checklist

## Phase 1: Deploy Relay Service to Railway

### 1. Install Railway CLI
```bash
npm install -g @railway/cli
railway login
```

### 2. Navigate to Relay Directory
```bash
cd relay/
```

### 3. Initialize Railway Project
```bash
railway init
# Project name: h2s-stripe-relay
railway link
```

### 4. Set Environment Variables in Railway
```bash
# Set Stripe secret key (same as used in Vercel)
railway variables set STRIPE_SECRET_KEY=sk_live_51KgfHxLuMP6aPhGZ...

# Generate and set relay authentication secret
railway variables set RELAY_SECRET=$(openssl rand -hex 32)

# Copy the RELAY_SECRET value for use in Vercel (step 5.2)
railway variables get RELAY_SECRET
```

### 5. Deploy to Railway
```bash
railway up
```

### 6. Get Railway Service URL
```bash
railway domain
# Example output: h2s-stripe-relay-production.up.railway.app
# Copy this URL for use in Vercel
```

### 7. Test Relay Health
```bash
curl https://your-service.railway.app/health
# Expected: {"ok":true,"service":"h2s-stripe-relay","timestamp":"2026-01-08T..."}
```

## Phase 2: Configure Vercel Backend

### 1. Navigate to Vercel Project Settings
Go to: https://vercel.com/your-team/h2s-backend/settings/environment-variables

### 2. Add STRIPE_RELAY_URL
- Name: `STRIPE_RELAY_URL`
- Value: `https://your-service.railway.app` (NO trailing slash)
- Environment: Production, Preview, Development (select all)

### 3. Add STRIPE_RELAY_SECRET
- Name: `STRIPE_RELAY_SECRET`
- Value: (paste the RELAY_SECRET from Railway step 4)
- Environment: Production, Preview, Development (select all)

### 4. Verify Environment Variables
Check that these exist in Vercel:
- ✓ STRIPE_RELAY_URL
- ✓ STRIPE_RELAY_SECRET
- ✓ STRIPE_SECRET_KEY (already exists, not used anymore but keep for read operations)
- ✓ SUPABASE_URL
- ✓ SUPABASE_ANON_KEY
- ✓ All other existing vars

## Phase 3: Deploy Updated Vercel Backend

### Option A: Via Git Push (Recommended)
```bash
cd backend/
git add app/api/shop/route.ts
git commit -m "Use Stripe relay to avoid Vercel timeout issues"
git push origin main
# Vercel will auto-deploy
```

### Option B: Via Vercel CLI
```bash
cd backend/
vercel --prod
```

### 3. Wait for Deployment
Monitor: https://vercel.com/your-team/h2s-backend/deployments

Expected logs should show:
```
[Checkout] Calling relay: https://your-service.railway.app/stripe/checkout (idempotency: ORD-ABC123)
[Checkout] ✓ Session created via relay: cs_...
```

## Phase 4: Test Checkout End-to-End

### 1. Run Simulation Script (Backend Test)
```bash
cd backend/scripts/
node simulateCheckoutPromo.mjs
```

Expected output:
```
Scenario 1: Checkout WITHOUT promo code
  Status: ✓ PASS (200)
  Response time: ~2000ms
  Session ID: cs_test_...
  
Scenario 2: Checkout WITH valid promo (h2sqa-e2e-2025)
  Status: ✓ PASS (200)
  Response time: ~2000ms
  Session ID: cs_test_...
  Discount applied: 100% off
  
Scenario 3: Checkout with INVALID promo
  Status: ✓ PASS (400)
  Error: PROMO_NOT_SUPPORTED
```

### 2. Test via Frontend (shop.home2smart.com)
1. Go to https://shop.home2smart.com/bundles
2. Add TV mount (1x65", Wall) to cart
3. Fill out form (name, email, phone, address)
4. **WITHOUT promo code:**
   - Click "Proceed to Checkout"
   - Should redirect to Stripe checkout page
   - Total: $149.00
5. **WITH promo code:**
   - Enter `h2sqa-e2e-2025` in promo field
   - Cart should update to show $0.00
   - Click "Proceed to Checkout"
   - Should redirect to Stripe checkout with 100% discount

### 3. Monitor Railway Logs
```bash
railway logs --follow
```

Expected logs:
```
[Relay] Creating checkout session with idempotency key: ORD-ABC123
[Relay] Line items count: 1
[Relay] Promo code: promo_1SZWVsLuMP6aPhGZGhct6nRT
[Relay] ✓ Session created: cs_test_..., URL: https://checkout.stripe.com/...
```

### 4. Monitor Vercel Logs
```bash
vercel logs h2s-backend --follow
```

Expected logs:
```
[Checkout] Promo code requested: h2sqa-e2e-2025
[Checkout] Using cached promo ID: promo_1SZWVsLuMP6aPhGZGhct6nRT
[Checkout] Calling relay: https://your-service.railway.app/stripe/checkout
[Checkout] ✓ Session created via relay: cs_test_...
```

## Phase 5: Validate No Regressions

### Test Cases:
- ✓ Promo validation still works (frontend form)
- ✓ Cart totals update when promo applied
- ✓ Checkout works without promo code
- ✓ Checkout works with valid promo code
- ✓ Invalid promo returns 400 error (not 500)
- ✓ Order is created in Supabase
- ✓ Dispatch job is created for pros
- ✓ Customer receives order confirmation email
- ✓ Success page shows order details

## Rollback Plan

If relay fails, revert to direct Stripe calls (will still timeout but restores old behavior):

### 1. Revert shop/route.ts
```bash
cd backend/
git revert HEAD
git push origin main
```

### 2. Or Manual Rollback
Edit `backend/app/api/shop/route.ts` line ~1030:
```typescript
// Comment out relay code
// const relayResponse = await fetch(...);

// Restore direct Stripe call
const session = await stripe.checkout.sessions.create(sessionParams);
```

### 3. Redeploy
```bash
vercel --prod
```

## Troubleshooting

### Error: "STRIPE_RELAY_URL or STRIPE_RELAY_SECRET not configured"
**Cause:** Environment variables not set in Vercel  
**Fix:** Add env vars in Vercel dashboard, then redeploy

### Error: "Unable to connect to payment system"
**Cause:** Railway service is down or unreachable  
**Fix:** 
```bash
railway logs  # Check for errors
railway restart  # Restart service
curl https://your-service.railway.app/health  # Test health
```

### Error: "Unauthorized" (401 from relay)
**Cause:** STRIPE_RELAY_SECRET mismatch  
**Fix:** Verify secrets match in both Railway and Vercel
```bash
# Railway
railway variables get RELAY_SECRET

# Vercel
vercel env ls
```

### Checkout still times out
**Cause:** Stripe API issue or relay timeout  
**Fix:**
- Check Railway logs: `railway logs`
- Increase relay timeout (edit server.js: stripe timeout to 30000ms)
- Verify Stripe key is valid: test locally with `test-stripe-live-key.js`

### Duplicate orders being created
**Cause:** Idempotency key collision or not working  
**Fix:** 
- Verify order ID generation is unique
- Check Railway logs for duplicate idempotency keys
- Stripe dashboard → Developers → Logs to see duplicate prevention

## Success Criteria

- ✓ Relay service is live on Railway (health check returns 200)
- ✓ Vercel has STRIPE_RELAY_URL and STRIPE_RELAY_SECRET configured
- ✓ Vercel backend deployed with relay integration
- ✓ simulateCheckoutPromo.mjs passes all 3 scenarios
- ✓ Frontend checkout works with/without promo
- ✓ Railway logs show successful session creation
- ✓ Vercel logs show relay calls instead of direct Stripe
- ✓ No 500 errors, no timeouts
- ✓ Orders created in Supabase with correct totals
- ✓ No regressions to promo, cart, dispatch, or pro accounts

## Monitoring After Deployment

### Daily Checks (first week):
```bash
# Railway uptime
railway status

# Recent errors
railway logs --tail 100 | grep -i error

# Vercel errors
vercel logs h2s-backend --tail 100 | grep -i error
```

### Metrics to Watch:
- Checkout success rate (should be ~100%)
- Average checkout response time (should be <3s)
- Railway service uptime (should be 99.9%+)
- Stripe API errors in Railway logs (should be 0)
- 500 errors from Vercel checkout (should be 0)

### Alert Setup:
Configure Railway alerts for:
- Service downtime
- High error rate (>1% of requests)
- High response time (>5s average)

## Next Steps (Future Improvements)

1. **Add more relay endpoints** as needed:
   - POST /stripe/retrieve-session (for get-order-details)
   - POST /stripe/list-promo-codes (for promo_validate fallback)

2. **Implement retry logic** in Vercel backend:
   - Retry relay calls on network errors
   - Exponential backoff

3. **Add monitoring dashboard:**
   - Track relay call latency
   - Monitor idempotency key usage
   - Alert on failure rate

4. **Consider multi-region deployment:**
   - Deploy relay to multiple regions for redundancy
   - Use load balancing between relay instances

## Contact Information

**Railway Support:** https://railway.app/help  
**Stripe Support:** https://support.stripe.com  
**Vercel Support:** https://vercel.com/support
