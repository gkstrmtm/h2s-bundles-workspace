# Quick Start: Stripe Relay Deployment

**Time Required:** 15 minutes  
**Prerequisites:** Railway CLI, Vercel access, Stripe live key

---

## 1. Deploy Relay (5 min)

```bash
cd relay/
npm install
railway login
railway init
railway variables set STRIPE_SECRET_KEY=sk_live_51KgfHxLuMP6aPhGZ...
railway variables set RELAY_SECRET=$(openssl rand -hex 32)
railway up
```

Get your service URL:
```bash
railway domain
# Copy this URL (e.g., h2s-stripe-relay-production.up.railway.app)
```

---

## 2. Configure Vercel (3 min)

Go to: https://vercel.com/your-team/h2s-backend/settings/environment-variables

Add two variables:
1. **STRIPE_RELAY_URL**
   - Value: `https://your-service.railway.app` (from step 1, no trailing slash)
   - Environments: Production, Preview, Development

2. **STRIPE_RELAY_SECRET**
   - Get value: `railway variables get RELAY_SECRET`
   - Environments: Production, Preview, Development

---

## 3. Deploy Backend (2 min)

```bash
cd backend/
git add app/api/shop/route.ts
git commit -m "Use Stripe relay to avoid Vercel timeout issues"
git push origin main
```

Wait for Vercel to deploy: https://vercel.com/your-team/h2s-backend/deployments

---

## 4. Test (5 min)

```bash
cd backend/scripts/
node simulateCheckoutPromo.mjs
```

**Expected results:**
- ✅ Scenario 1 (no promo): 200 OK, session created
- ✅ Scenario 2 (h2sqa-e2e-2025): 200 OK, session with discount
- ✅ Scenario 3 (invalid): 400 error

**Manual test:**
1. Go to https://shop.home2smart.com/bundles
2. Add TV mount to cart
3. Click "Proceed to Checkout"
4. Should redirect to Stripe (no timeout)

---

## Troubleshooting

### "STRIPE_RELAY_URL or STRIPE_RELAY_SECRET not configured"
→ Add env vars in Vercel dashboard, redeploy backend

### "Unable to connect to payment system"
→ Check Railway is running: `curl https://your-service.railway.app/health`

### "Unauthorized" (401)
→ Verify RELAY_SECRET matches in both Railway and Vercel

### Still times out
→ Check Railway logs: `railway logs`

---

## Success Criteria

- ✅ Railway health check returns 200
- ✅ simulateCheckoutPromo.mjs passes all 3 scenarios
- ✅ Manual checkout redirects to Stripe (no timeout)
- ✅ Orders created in Supabase
- ✅ No 500 errors

---

**Full Guide:** [STRIPE_RELAY_DEPLOYMENT.md](STRIPE_RELAY_DEPLOYMENT.md)  
**Support:** Railway logs: `railway logs --follow`
