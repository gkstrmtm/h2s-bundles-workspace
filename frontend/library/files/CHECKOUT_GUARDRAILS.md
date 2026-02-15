# CHECKOUT SYSTEM GUARDRAILS - DO NOT BREAK

**Last Verified Working**: January 12, 2026 00:30 UTC
**Status**: ✅ PRODUCTION STABLE

---

## 🚨 CRITICAL: THESE COMPONENTS ARE LOCKED

### Frontend (shop.home2smart.com)
**Project**: `h2s-bundles-frontend`
**Deployment**: https://h2s-bundles-frontend-po3up0lwt-tabari-ropers-projects-6f2e090b.vercel.app
**Files**: `frontend/bundles.html`, `frontend/bundles.js`

#### ❌ NEVER CHANGE:
1. **API Endpoint** (Line 55 in bundles.js):
   ```javascript
   const API = 'https://h2s-backend.vercel.app/api/shop';
   ```
   - This MUST point to production backend
   - Do NOT use development URLs

2. **Success URL** (Line 3717 in bundles.js):
   ```javascript
   success_url: 'https://shop.home2smart.com/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}'
   ```
   - {CHECKOUT_SESSION_ID} placeholder is REQUIRED for Stripe
   - query param `view=shopsuccess` triggers success page

3. **Static Success Page HTML** (Lines 3320-3520 in bundles.html):
   ```html
   <div id="staticSuccessPage" style="display:none;">
   ```
   - This HTML MUST exist in DOM at page load
   - Do NOT generate this with JavaScript
   - This prevents white screen flash

4. **Success Page CSS Trigger** (Line 82 in bundles.html):
   ```javascript
   if(p.get('view')==='shopsuccess'||p.has('shopsuccess')||p.has('session_id')){
     document.documentElement.setAttribute('data-success-mode','1');
   }
   ```
   - This MUST run BEFORE bundles.js loads
   - Inline script is REQUIRED for instant rendering

5. **Checkout Payload Structure** (Lines 3710-3750 in bundles.js):
   ```javascript
   {
     __action: 'create_checkout_session',
     customer: { name, email, phone },
     cart: cart, // MUST send full cart with metadata
     metadata: { customer_name, customer_email, service_address, ... }
   }
   ```
   - `cart` array is REQUIRED (not just price_id)
   - `metadata` is REQUIRED for job creation

### Backend (h2s-backend.vercel.app)
**Project**: `backend`
**Deployment**: https://backend-ndw3awloh-tabari-ropers-projects-6f2e090b.vercel.app
**File**: `backend/app/api/shop/route.ts`

#### ❌ NEVER CHANGE:

1. **Job Creation BEFORE Stripe** (Lines 1255-1510):
   ```typescript
   // === CRITICAL CHANGE: Create Order + Job BEFORE Stripe ===
   // Insert order with status="pending_payment"
   // Create dispatch job with status="pending_payment"
   // THEN create Stripe session
   ```
   - Order and job MUST be created BEFORE Stripe session
   - Status MUST be `pending_payment` (not `queued`)

2. **Job Status** (Line 1417):
   ```typescript
   status: 'pending_payment', // Wait for payment before showing to technicians
   ```
   - Do NOT use `queued` - it will spam portal with unpaid jobs
   - Webhook changes to `queued` after payment

3. **Stripe Relay Configuration** (Lines 1549-1550):
   ```typescript
   const relayUrl = process.env.STRIPE_RELAY_URL;
   const relaySecret = process.env.STRIPE_RELAY_SECRET;
   ```
   - These env vars MUST be set in Vercel
   - Do NOT call Stripe API directly (timeouts)

4. **Response Structure** (Lines 1679-1697):
   ```typescript
   return NextResponse.json({
     ok: true,
     order_id: orderId,    // REQUIRED for tracking
     job_id: jobId,        // REQUIRED for dispatch
     pay: { session_url, session_id }
   });
   ```
   - MUST return both `order_id` and `job_id`
   - Frontend expects this structure

### Webhook (Stripe → Backend)
**File**: `backend/app/api/stripe-webhook/route.ts`

#### ❌ NEVER CHANGE:

1. **Job Activation** (Lines 102-126):
   ```typescript
   // CRITICAL: Activate the dispatch job
   await dispatchClient
     .from('h2s_dispatch_jobs')
     .update({ status: 'queued' })
     .eq('order_id', orderId)
     .eq('status', 'pending_payment')
   ```
   - Webhook MUST change job status from `pending_payment` to `queued`
   - This makes job visible to technicians

2. **Non-Blocking Job Creation** (Lines 155-280):
   ```typescript
   try {
     // Job creation logic
   } catch (jobCreateErr: any) {
     console.error('[Stripe Webhook] Job creation exception:', jobCreateErr);
     // Continue - webhook should not fail if job creation fails
   }
   ```
   - Webhook MUST NOT fail if job creation fails
   - Continue processing even with errors

---

## 🛡️ DEPLOYMENT GUARDRAILS

### Pre-Deployment Checklist

Before deploying ANY changes:

1. **Run Validation Script**:
   ```powershell
   .\VALIDATE-CHECKOUT-SYSTEM.ps1
   ```
   - Checks all critical files exist
   - Validates API endpoints
   - Confirms no breaking changes

2. **Test Locally First**:
   ```powershell
   .\TEST-CHECKOUT-LOCAL.ps1
   ```
   - Creates test checkout
   - Verifies order and job creation
   - Confirms response structure

3. **Deploy in Order**:
   ```powershell
   # 1. Deploy backend first
   cd backend
   vercel --prod
   
   # 2. Wait 30 seconds for propagation
   Start-Sleep -Seconds 30
   
   # 3. Deploy frontend
   cd ../frontend
   vercel --prod
   ```

4. **Verify Production**:
   ```powershell
   .\VERIFY-PRODUCTION-CHECKOUT.ps1
   ```
   - Tests live production endpoints
   - Creates real checkout session
   - Validates Stripe integration

---

## 🔒 FILE CHANGE RESTRICTIONS

### NEVER EDIT WITHOUT VALIDATION:

1. **frontend/bundles.html**
   - Lines 78-90: Success page detection script
   - Lines 3320-3520: Static success page HTML
   - Lines 3324-3330: Success page CSS

2. **frontend/bundles.js**
   - Line 55: API endpoint
   - Lines 905-950: Checkout button handler
   - Lines 3498-3800: window.checkout function
   - Lines 3717, 3915: success_url configuration

3. **backend/app/api/shop/route.ts**
   - Lines 1255-1510: Job creation BEFORE Stripe
   - Lines 1410-1430: Job payload with pending_payment status
   - Lines 1549-1650: Stripe relay call
   - Lines 1679-1697: Response structure

4. **backend/app/api/stripe-webhook/route.ts**
   - Lines 70-130: Order update and job activation
   - Lines 155-280: Job creation safety net

---

## ⚠️ COMMON MISTAKES TO AVOID

### 1. Generating Success Page HTML with JavaScript
❌ **WRONG**:
```javascript
document.getElementById('successPage').innerHTML = '<div>Order Confirmed</div>';
```
✅ **CORRECT**: HTML exists in DOM from page load (bundles.html lines 3320-3520)

### 2. Creating Jobs with "queued" Status Initially
❌ **WRONG**:
```typescript
status: 'queued' // Shows in portal immediately, including abandoned checkouts
```
✅ **CORRECT**:
```typescript
status: 'pending_payment' // Hidden until webhook confirms payment
```

### 3. Calling Stripe API Directly from Vercel
❌ **WRONG**:
```typescript
const session = await stripe.checkout.sessions.create(...);
```
✅ **CORRECT**:
```typescript
const relayResponse = await fetch(`${relayUrl}/stripe/checkout`, {...});
```

### 4. Missing order_id or job_id in Response
❌ **WRONG**:
```typescript
return NextResponse.json({ ok: true, pay: { session_url } });
```
✅ **CORRECT**:
```typescript
return NextResponse.json({
  ok: true,
  order_id: orderId,
  job_id: jobId,
  pay: { session_url, session_id }
});
```

### 5. Wrong Success URL Format
❌ **WRONG**:
```javascript
success_url: 'https://shop.home2smart.com/success'
```
✅ **CORRECT**:
```javascript
success_url: 'https://shop.home2smart.com/bundles?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}'
```

---

## 📊 MONITORING & ALERTS

### Daily Health Check
```powershell
# Run every morning
.\HEALTH-CHECK-CHECKOUT.ps1
```
- Validates production endpoints
- Tests checkout creation
- Verifies job creation
- Checks success page rendering

### Real-Time Monitoring
```sql
-- Check for abandoned checkouts (orders without jobs)
SELECT order_id, customer_email, created_at
FROM h2s_orders
WHERE metadata_json->>'dispatch_job_id' IS NULL
  AND created_at > NOW() - INTERVAL '1 hour';

-- Check for unpaid jobs older than 1 hour (potential webhook failures)
SELECT job_id, order_id, created_at
FROM h2s_dispatch_jobs
WHERE status = 'pending_payment'
  AND created_at < NOW() - INTERVAL '1 hour';
```

---

## 🆘 ROLLBACK PROCEDURE

If checkout breaks after a deployment:

1. **Identify Which Deployment Failed**:
   ```bash
   vercel list | head -5
   ```

2. **Rollback to Last Working Deployment**:
   
   **Frontend**:
   ```bash
   cd frontend
   vercel alias set h2s-bundles-frontend-po3up0lwt shop.home2smart.com
   ```
   
   **Backend**:
   ```bash
   cd backend
   vercel alias set backend-ndw3awloh h2s-backend.vercel.app
   ```

3. **Verify Rollback**:
   ```powershell
   .\VERIFY-PRODUCTION-CHECKOUT.ps1
   ```

4. **Document What Broke**:
   - Add to `CHECKOUT_INCIDENTS.md`
   - Update this guardrails document

---

## 📝 CHANGE LOG

### January 12, 2026 - PRODUCTION STABLE
- ✅ Jobs created BEFORE Stripe (prevents orphan orders)
- ✅ Jobs start with `pending_payment` status (prevents portal spam)
- ✅ Webhook activates jobs to `queued` after payment
- ✅ Success page renders instantly (static HTML, no white screen)
- ✅ Frontend deployed: h2s-bundles-frontend-po3up0lwt
- ✅ Backend deployed: backend-ndw3awloh

---

## 🔐 PROTECTED ENVIRONMENT VARIABLES

These MUST be set in Vercel:

### Backend Environment:
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_RELAY_URL=https://h2s-stripe-relay.railway.app
STRIPE_RELAY_SECRET=<relay-auth-token>
SUPABASE_URL=https://...supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Frontend Environment:
```
(None required - uses production backend URL hardcoded)
```

---

## ✅ VALIDATION TESTS

Run these tests before ANY deployment:

1. **API Endpoint Test**:
   ```powershell
   Invoke-RestMethod -Uri "https://h2s-backend.vercel.app/api/shop?action=catalog"
   # Should return: { ok: true, bundles: [...] }
   ```

2. **Checkout Creation Test**:
   ```powershell
   .\TEST-CHECKOUT-CREATION.ps1
   # Should return: order_id, job_id, session_url
   ```

3. **Success Page Test**:
   ```powershell
   $response = Invoke-WebRequest -Uri "https://shop.home2smart.com/bundles?view=shopsuccess"
   $response.Content -match 'data-success-mode="1"'
   # Should be: True
   ```

4. **Webhook Test** (requires Stripe CLI):
   ```bash
   stripe trigger checkout.session.completed
   # Check logs for: "✅ Activated dispatch job"
   ```

---

## 🎯 SUCCESS CRITERIA

System is working correctly when:
- ✅ Checkout button creates Stripe session
- ✅ Response includes order_id and job_id
- ✅ Order saved in h2s_orders with status='pending_payment'
- ✅ Job saved in h2s_dispatch_jobs with status='pending_payment'
- ✅ After payment, webhook changes job status to 'queued'
- ✅ Success page renders instantly with no white screen
- ✅ Technicians can see paid jobs in portal

---

**REMEMBER**: If you're not sure if a change will break something, DON'T MAKE IT. Run validation scripts first.
