# STRIPE WEBHOOK CONFIGURATION - REQUIRED

## ✅ Step 1: Backend Deployed (DONE)

Webhook endpoint is now live at:
```
https://h2s-backend.vercel.app/api/stripe-webhook
```

---

## ⚠️ Step 2: Configure Stripe Dashboard (DO THIS NOW)

### Go to Stripe Dashboard:
https://dashboard.stripe.com/webhooks

### Click "Add endpoint"

**Endpoint URL:**
```
https://h2s-backend.vercel.app/api/stripe-webhook
```

**Events to send:**
- [x] `checkout.session.completed`
- [x] `payment_intent.succeeded`

### Click "Add endpoint"

---

## ⚠️ Step 3: Get Webhook Signing Secret

After creating the endpoint, Stripe will show you a **Signing secret** that looks like:
```
whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Copy this secret** - you'll need it for the next step.

---

## ⚠️ Step 4: Add Secret to Vercel

Run this command (replace with YOUR actual secret):

```powershell
cd backend
echo "whsec_YOUR_ACTUAL_SECRET_HERE" | vercel env add STRIPE_WEBHOOK_SECRET production
```

Example (DO NOT USE THIS - it's fake):
```powershell
echo "whsec_abc123xyz789secret456" | vercel env add STRIPE_WEBHOOK_SECRET production
```

---

## ⚠️ Step 5: Redeploy Backend

After adding the secret, redeploy so it takes effect:

```powershell
cd backend
vercel --prod --yes
vercel alias set [NEW_DEPLOYMENT_URL] h2s-backend.vercel.app
```

---

## ✅ Step 6: Test Webhook

### Option A: Use Stripe Test Mode
1. Go to: https://dashboard.stripe.com/test/webhooks
2. Find your webhook endpoint
3. Click "Send test webhook"
4. Select event: `checkout.session.completed`
5. Click "Send test webhook"
6. Check response - should see `200 OK`

### Option B: Real Test Order
```powershell
cd backend\scripts
node simulateCheckoutPromo.mjs
```

Open the checkout URL in your browser, complete with test card:
```
Card: 4242 4242 4242 4242
Expiry: Any future date
CVC: Any 3 digits
```

After payment, check your order in database - status should change to `paid`.

---

## Verify It's Working

### Check Webhook Logs in Stripe:
https://dashboard.stripe.com/webhooks/[YOUR_WEBHOOK_ID]

Should see:
- ✅ 200 responses
- ✅ `checkout.session.completed` events received
- ✅ No "signature verification failed" errors

### Check Vercel Logs:
https://vercel.com/tabari-ropers-projects-6f2e090b/backend/logs

Should see:
```
[Stripe Webhook] Checkout completed: { session_id: '...', customer_email: '...', amount_total: ... }
[Stripe Webhook] Updated existing order: ORD-XXXXXXXX
[Stripe Webhook] Management notification sent
```

### Check Database:
Order status should change from `pending` to `paid` after webhook processes.

---

## What the Webhook Does

When customer completes checkout:

1. **Updates Order Status**
   ```sql
   UPDATE h2s_orders 
   SET status = 'paid', payment_intent_id = '...' 
   WHERE session_id = '...'
   ```

2. **Fills in Missing Data**
   - Customer name, phone from Stripe checkout
   - Address details from metadata
   - Payment intent ID for reconciliation

3. **Sends Management Notification**
   - SMS to management for high-value orders (>$500)
   - Regular notification for standard orders
   - Calls `/api/notify-management` endpoint

4. **Logs Everything**
   - Order ID, customer name, total amount
   - Visible in Vercel logs for debugging

---

## Troubleshooting

### Webhook returns 400 "Webhook signature required"
**Problem:** `STRIPE_WEBHOOK_SECRET` environment variable not set.

**Fix:**
```powershell
echo "whsec_YOUR_SECRET" | vercel env add STRIPE_WEBHOOK_SECRET production
vercel --prod --yes
```

---

### Webhook returns 400 "Webhook Error: ..."
**Problem:** Signing secret is wrong or webhook secret doesn't match.

**Fix:**
1. Get correct secret from: https://dashboard.stripe.com/webhooks/[webhook_id]
2. Delete old secret: `vercel env rm STRIPE_WEBHOOK_SECRET production`
3. Add correct one: `echo "whsec_..." | vercel env add STRIPE_WEBHOOK_SECRET production`
4. Redeploy: `vercel --prod --yes`

---

### Order status stays "pending" after payment
**Problem:** Webhook not configured in Stripe dashboard.

**Fix:** Follow Steps 2-5 above to configure webhook endpoint.

---

### "Management notification failed"
**Problem:** `/api/notify-management` endpoint doesn't exist or Twilio not configured.

**Impact:** Non-critical - order still updates, just no SMS sent.

**Fix:** (Optional) Configure Twilio environment variables if you want SMS notifications.

---

## Status Checklist

- [x] Webhook code enabled (folder renamed)
- [x] Backend deployed with webhook endpoint
- [x] Custom domain aliased
- [ ] **Webhook configured in Stripe dashboard** ← YOU NEED TO DO THIS
- [ ] **STRIPE_WEBHOOK_SECRET added to Vercel** ← YOU NEED TO DO THIS
- [ ] Backend redeployed after adding secret
- [ ] Webhook tested and working

---

## Quick Commands

```powershell
# Check if webhook endpoint is accessible
Invoke-WebRequest https://h2s-backend.vercel.app/api/stripe-webhook -Method POST

# Should return 400 (expected - needs signature)
# If returns 404, webhook isn't deployed yet

# List environment variables
cd backend
vercel env ls

# Should see STRIPE_WEBHOOK_SECRET in production
```

---

## NEXT STEPS FOR YOU:

1. Go to: https://dashboard.stripe.com/webhooks
2. Add endpoint: `https://h2s-backend.vercel.app/api/stripe-webhook`
3. Select events: `checkout.session.completed`, `payment_intent.succeeded`
4. Copy the signing secret (starts with `whsec_`)
5. Run: `echo "whsec_..." | vercel env add STRIPE_WEBHOOK_SECRET production`
6. Run: `cd backend ; vercel --prod --yes`
7. Test by making a checkout

**Once you do this, orders will automatically update to "paid" status after customer pays.**
