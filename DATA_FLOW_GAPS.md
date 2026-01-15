# DATA FLOW GAPS - CRITICAL ISSUES FOUND

## Summary: What I Found

❌ **Stripe Webhook is DISABLED** - Order payment status never updates  
❌ **Job Creation is COMMENTED OUT** - Dispatch jobs not created at checkout  
❌ **Scheduling Date Not Attached** - Calendar dates stored in order, but NOT in job  
⚠️ **Two-Step Process** - Order created → User schedules later → Job created THEN

---

## The Complete Flow (AS IT EXISTS TODAY)

### Step 1: Customer Checks Out (Working ✅)
```
Frontend → Vercel Backend (/api/shop) → Railway Relay → Stripe → Checkout Session
```

**What Happens:**
- Order created in `h2s_orders` table with status: `pending`
- Fields populated: order_id, session_id, customer details, service details, items
- **Job creation code is COMMENTED OUT** (lines 1125-1250 in shop/route.ts)
- Customer redirects to Stripe checkout page
- After payment, redirects to: `?view=shopsuccess&session_id={CHECKOUT_SESSION_ID}`

**Database State After Step 1:**
```sql
h2s_orders:
  - order_id: ORD-XXXXX
  - status: 'pending' ← NEVER CHANGES TO 'paid'
  - delivery_date: NULL ← NOT SET YET
  - delivery_time: NULL ← NOT SET YET

h2s_dispatch_jobs:
  - NO RECORD CREATED
```

---

### Step 2: Success Page Shows Calendar (Working ✅)
```
Frontend bundles.js renderShopSuccessView() → Shows calendar widget
```

**What Happens:**
- Success page loads with session_id in URL
- Frontend calls `/api/shop` with `__action: 'get_session'` to fetch order details
- Calendar widget appears for user to select delivery date/time

**Problem:**
- This step is MANUAL - user must select date
- If user closes browser, they never schedule
- Order sits in `pending` status forever

---

### Step 3: User Selects Date (Working ✅)
```
Frontend → /api/schedule-appointment → Creates dispatch job NOW
```

**What Happens:**
- User clicks date/time on calendar
- Frontend calls `/api/schedule-appointment` with:
  ```json
  {
    "order_id": "ORD-XXXXX",
    "delivery_date": "2026-01-15",
    "delivery_time": "2:00 PM - 5:00 PM"
  }
  ```
- Backend updates `h2s_orders` table:
  ```sql
  UPDATE h2s_orders SET delivery_date = '2026-01-15', delivery_time = '2:00 PM - 5:00 PM'
  ```
- Backend creates job in `h2s_dispatch_jobs`:
  ```sql
  INSERT INTO h2s_dispatch_jobs (
    job_id, order_id, status, start_iso, service_address, customer_name, ...
  )
  ```

**This is when the job ACTUALLY gets created.**

---

## GAP #1: Webhook is Disabled (CRITICAL)

**File:** `backend/app/api/_disabled_stripe-webhook/route.ts`

**Problem:** The folder name starts with `_disabled_` which means Vercel/Next.js **ignores this endpoint**.

**Impact:**
- Stripe sends webhook to: `https://h2s-backend.vercel.app/api/stripe-webhook`
- Vercel returns: **404 Not Found**
- Webhook handler NEVER runs
- Order status stays `pending` forever (even after customer pays)
- You can't distinguish paid orders from abandoned carts

**What Webhook SHOULD Do:**
1. Receive `checkout.session.completed` event from Stripe
2. Update order status from `pending` to `paid`
3. Send management SMS notification
4. Trigger customer confirmation email

**How to Fix:**
```powershell
# Rename folder to enable it
Move-Item backend\app\api\_disabled_stripe-webhook backend\app\api\stripe-webhook
```

**Then configure Stripe:**
1. Go to: https://dashboard.stripe.com/webhooks
2. Add endpoint: `https://h2s-backend.vercel.app/api/stripe-webhook`
3. Select event: `checkout.session.completed`
4. Get signing secret (starts with `whsec_...`)
5. Add to Vercel:
   ```powershell
   echo "whsec_YOUR_SECRET_HERE" | vercel env add STRIPE_WEBHOOK_SECRET production
   ```

---

## GAP #2: Job Creation Commented Out (MAJOR)

**File:** `backend/app/api/shop/route.ts` (lines 1125-1250)

**Problem:** Code that creates dispatch jobs AT CHECKOUT is completely commented out:

```typescript
// Create a dispatch job immediately (even before scheduling) so ops/portal can see it.
// The schedule-appointment API will later find and update this job to `scheduled`.

/* 
   REMOVED: Attempting to write to h2s_dispatch_jobs caused failures because the table schema
   in Supabase (Queue System) does not match the Job Entity schema expected here.
   
   Logic has been disabled until the 'h2s_jobs' or 'h2s_dispatch_jobs' table is properly migrated.
   The Portal should rely on 'h2s_orders' for now.
*/
```

**Impact:**
- Jobs are ONLY created when user schedules appointment
- If user abandons after checkout, NO job record exists
- Portal can't see pending orders until user schedules
- Ops team has no visibility into unscheduled orders

**The code WAS re-enabled later (lines 1137-1250) but has bugs:**
- Tries to create recipient for every order (unique constraint violation)
- Uses hardcoded DEFAULT_SEQUENCE_ID and DEFAULT_STEP_ID
- Wrapped in try-catch that swallows all errors (console.warn only)

**Result:** Jobs fail silently, no error shown to user, checkout still succeeds.

---

## GAP #3: Scheduling Date NOT Attached to Job at Checkout

**Root Cause:** User doesn't select delivery_date/delivery_time until AFTER checkout.

**Flow Today:**
1. Checkout → Order created with delivery_date: NULL
2. User redirects to success page → sees calendar
3. User picks date → `/api/schedule-appointment` called
4. THEN job created with start_iso set

**Problem:** If job WAS created at checkout (when code is fixed), it would have:
```sql
h2s_dispatch_jobs:
  - start_iso: NULL
  - end_iso: NULL
  - status: 'pending'
```

**Why:** Calendar selection happens AFTER checkout, not during.

**This is by design** - your checkout doesn't ask for delivery date. Success page does.

---

## GAP #4: Two-Database Disconnect

**Databases:**
1. **Main DB** (`h2s_orders`, `h2s_services`) - Uses `SUPABASE_URL` + `SUPABASE_ANON_KEY`
2. **Dispatch DB** (`h2s_dispatch_jobs`, `h2s_recipients`) - Uses `SUPABASE_DISPATCH_URL` + `SUPABASE_DISPATCH_KEY`

**Problem:** Job creation requires:
- `recipient_id` from `h2s_recipients` table (Dispatch DB)
- `sequence_id` and `step_id` from workflow tables (Dispatch DB)
- But order data lives in Main DB

**Current Fix:** Code tries to create recipient on-the-fly if not exists. But this causes:
- Unique constraint violations (if recipient exists)
- Missing required fields (name, phone, etc.)
- Silent failures (wrapped in try-catch)

---

## GAP #5: Success Page "Timing to Success" Issue

**What User Mentioned:** "Timing to success on bundles page"

**My Analysis:**
Success page (`renderShopSuccessView`) does:
1. Paint UI shell immediately (fast)
2. Fetch order data from `/api/shop?__action=get_session` (slow)
3. Show calendar widget (slow - fetches availability)

**Performance Issues:**
- Order fetch can take 2-3 seconds
- Calendar widget loads async
- If API is slow, user sees spinner forever

**Code Location:** `frontend/bundles.js` line 408 (`renderShopSuccessView`)

**Potential Fixes:**
1. Show "Payment Successful!" immediately (before API call)
2. Load calendar in background
3. Add timeout fallback (show generic success if API fails)

---

## What Needs to Happen (Priority Order)

### 1. ENABLE WEBHOOK (CRITICAL)
```powershell
# Rename folder
Move-Item backend\app\api\_disabled_stripe-webhook backend\app\api\stripe-webhook

# Configure Stripe webhook endpoint
# Add STRIPE_WEBHOOK_SECRET to Vercel
echo "whsec_..." | vercel env add STRIPE_WEBHOOK_SECRET production

# Redeploy
cd backend
vercel --prod
```

**Why:** Without webhook, orders never show as "paid". You can't tell real orders from abandoned carts.

---

### 2. FIX JOB CREATION AT CHECKOUT (HIGH)
**Options:**
- **Option A:** Keep current flow (job created when user schedules) ← SAFER
- **Option B:** Create "placeholder" job at checkout with status='awaiting_schedule' ← COMPLEX

**Recommendation:** Option A (current flow) is fine IF:
- Webhook is enabled (so you can see paid vs pending)
- Portal shows BOTH `h2s_orders` AND `h2s_dispatch_jobs`
- Ops team knows to follow up with unscheduled paid orders

---

### 3. ADD DATABASE VALIDATION TO GUARDIAN (HIGH)
Enhance `GUARDIAN.ps1` to test:
- Order creation
- Job creation via schedule-appointment
- Database connectivity to both Main and Dispatch DBs
- Webhook endpoint reachable

---

### 4. FIX SUCCESS PAGE PERFORMANCE (MEDIUM)
Optimize `renderShopSuccessView()`:
- Show confirmation UI instantly
- Fetch order data async (don't block)
- Add 5-second timeout fallback

---

## Testing the Full Flow (Do This Now)

```powershell
# 1. Create test order
cd backend\scripts
node simulateCheckoutPromo.mjs

# Get session_url from output, open in browser
# Complete payment with Stripe test card: 4242 4242 4242 4242

# 2. After redirect to success page, check database:
# Should see order with status='pending' (will be 'paid' when webhook is enabled)

# 3. Select delivery date on calendar
# Should call /api/schedule-appointment

# 4. Check database again:
# Should see h2s_orders updated with delivery_date/delivery_time
# Should see NEW record in h2s_dispatch_jobs with start_iso

# 5. Verify job shows in Portal
# Go to: https://portal.home2smart.com (or wherever portal is)
# Look for job with matching order_id
```

---

## Summary Table

| Gap | Status | Impact | Priority | Est. Fix Time |
|-----|--------|--------|----------|---------------|
| Webhook disabled | ❌ | Orders never marked as paid | CRITICAL | 10 min |
| Job creation commented out | ⚠️ | Works via schedule-appointment | LOW | N/A (by design) |
| Scheduling date not at checkout | ✅ | By design - user picks after payment | N/A | N/A |
| Two-database sync issues | ⚠️ | Silent failures on recipient creation | MEDIUM | 1 hour |
| Success page performance | ⚠️ | Slow load times | MEDIUM | 30 min |

---

## Next Steps

1. **Enable webhook** (10 min) - Do this NOW
2. **Test full flow** (15 min) - Verify webhook updates order status
3. **Update GUARDIAN.ps1** (30 min) - Add database validation
4. **Optimize success page** (30 min) - Improve timing to success
5. **Document flow** (done ✅) - This file

**Total Time to Fix Critical Issues:** ~1-2 hours

---

## Questions for You

1. **Webhook:** Do you want me to enable it now? (Requires Stripe dashboard access to get webhook secret)
2. **Job Creation:** Are you OK with jobs being created when user schedules (not at checkout)? Or do you need placeholder jobs?
3. **Success Page:** What "timing to success" issue are you seeing? Slow page load? Calendar not appearing?
4. **Portal:** Does the portal show orders from `h2s_orders` table? Or only jobs from `h2s_dispatch_jobs`?

Once you answer these, I'll implement the fixes.
