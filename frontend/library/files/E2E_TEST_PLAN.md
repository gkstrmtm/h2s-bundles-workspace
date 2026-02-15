# END-TO-END SYSTEM TEST - Complete Flow Verification
**Date:** January 6, 2026  
**Purpose:** Verify entire ecosystem from customer booking → technician portal

---

## 🎯 CRITICAL PATHS TO TEST

### PATH 1: Customer Booking Flow (Shop)
**URL:** https://shop.home2smart.com

1. **Landing Page**
   - [ ] Shop loads at shop.home2smart.com
   - [ ] Bundle cards display with prices
   - [ ] "Get Started" buttons work
   
2. **Bundle Selection**
   - [ ] Click bundle → Goes to details
   - [ ] Add-ons show correctly
   - [ ] Price updates when selecting add-ons
   - [ ] "Continue" button works

3. **Customer Information**
   - [ ] Form fields all work (name, email, phone, address)
   - [ ] Address validation works
   - [ ] Email validation works
   - [ ] Phone formatting works

4. **Scheduling**
   - [ ] Calendar displays available dates
   - [ ] Time slots show correctly
   - [ ] Can select date + time
   - [ ] Unavailable dates are blocked

5. **Payment (Stripe)**
   - [ ] Stripe checkout loads
   - [ ] Test card works: 4242 4242 4242 4242
   - [ ] Payment processes successfully
   - [ ] Confirmation page shows

6. **Backend Job Creation**
   - [ ] Job record created in Supabase `h2s_jobs` table
   - [ ] Customer record created in `h2s_customers` table
   - [ ] Job status = 'scheduled' or 'pending'
   - [ ] Scheduled date/time saved correctly
   - [ ] Bundle details saved (name, price, add-ons)

**API Endpoints Used:**
- POST `/api/track` - Event tracking
- POST `/api/create-checkout-session` - Stripe payment
- POST `/api/schedule-appointment` - Job creation

---

### PATH 2: Technician Portal Account Creation
**URL:** https://portal.home2smart.com/portal

1. **Landing on Portal**
   - [ ] Portal loads at portal.home2smart.com/portal
   - [ ] Sign-in form displays
   - [ ] "Sign up" button visible

2. **Sign Up Flow**
   - [ ] Click "Sign up" button
   - [ ] Step 1: Enter name, email (confirm), phone
   - [ ] Validation works (email match, phone format)
   - [ ] Click "Continue" → Goes to address step
   
3. **Address Entry**
   - [ ] Enter address, city, state, ZIP
   - [ ] ZIP validation works
   - [ ] Click "Create account"
   
4. **Backend Account Creation**
   - [ ] Record created in `h2s_pros` table
   - [ ] Email saved (unique check works)
   - [ ] Token generated via `issuePortalToken()`
   - [ ] Status = 'pending' or 'active'
   - [ ] Address fields saved for job matching

5. **Post-Signup**
   - [ ] Redirects to portal dashboard
   - [ ] Token saved in localStorage
   - [ ] Shows "No jobs yet" or available offers

**API Endpoints Used:**
- POST `/api/portal_signup_step1` - Account creation
- POST `/api/portal_login` - Login after signup

---

### PATH 3: Job Assignment & Portal Display
**Critical Integration Point**

1. **Job Assignment (Backend Process)**
   - [ ] New job from shop appears in database
   - [ ] Dispatch system identifies available techs by ZIP/area
   - [ ] Job offered to technicians (status = 'offered')
   - [ ] Offer stored in `h2s_job_offers` table with tech_id

2. **Portal: View Offers**
   - [ ] Tech logs into portal
   - [ ] GET `/api/portal_jobs?token=xxx` called
   - [ ] "Pending offers" section shows new jobs
   - [ ] Job card displays:
     - Customer name
     - Address
     - Scheduled date/time
     - Bundle/service type
     - Price/earnings
   - [ ] "Accept" and "Decline" buttons visible

3. **Accept Job**
   - [ ] Click "Accept" button
   - [ ] POST `/api/portal_accept` called with job_id + token
   - [ ] Job moves from "Offers" to "Upcoming jobs"
   - [ ] Job status updates to 'accepted' in database
   - [ ] Other techs no longer see this offer

4. **Upcoming Jobs View**
   - [ ] Accepted job appears in "Upcoming jobs" section
   - [ ] Shows customer details
   - [ ] Shows scheduled date/time
   - [ ] Action buttons: "On my way", "Mark done", etc.

5. **Complete Job**
   - [ ] Click "Mark done" when finished
   - [ ] POST `/api/portal_mark_done` called
   - [ ] Job moves to "Completed jobs" section
   - [ ] Job status = 'completed' in database
   - [ ] Payment/payout calculated

**API Endpoints Used:**
- GET `/api/portal_jobs` - Fetch all jobs for tech
- POST `/api/portal_accept` - Accept offer
- POST `/api/portal_decline` - Decline offer
- POST `/api/portal_mark_done` - Mark completed
- POST `/api/portal_on_my_way` - En route notification

---

## 🔥 CRITICAL INTEGRATION POINTS

### 1. Database Schema Consistency
**Tables that must exist and match:**

```sql
-- Jobs table
h2s_jobs (
  id, customer_id, service_type, scheduled_date, scheduled_time,
  status, address, city, state, zip, price, created_at
)

-- Pros (technicians) table
h2s_pros (
  id, email, name, phone, address, city, state, zip,
  status, created_at, token_hash
)

-- Job offers/assignments
h2s_job_offers (
  id, job_id, tech_id, status, offered_at, responded_at
)

-- Customers
h2s_customers (
  id, name, email, phone, address, city, state, zip, created_at
)
```

### 2. Token Authentication Flow
- [ ] Signup issues token via `issuePortalToken(email)`
- [ ] Token stored in localStorage as `h2s_portal_token`
- [ ] Every portal API call includes token in query or body
- [ ] Backend validates token in each endpoint
- [ ] Invalid token → 401 Unauthorized

### 3. Job Status State Machine
```
[customer books] → 'scheduled'
      ↓
[dispatch assigns] → 'offered' (to multiple techs)
      ↓
[tech accepts] → 'accepted'
      ↓
[tech marks done] → 'completed'
```

### 4. Geographic Matching
- [ ] Tech ZIP code stored during signup
- [ ] Jobs matched to techs by proximity
- [ ] Dispatch algorithm considers:
  - ZIP code distance
  - Tech availability
  - Current job load

---

## 🧪 MANUAL TEST PROCEDURE

### TEST 1: Complete Booking (15 mins)

```
1. Open incognito browser: https://shop.home2smart.com
2. Select "Smart Home Starter" bundle
3. Add "Security Camera Installation" add-on
4. Fill customer info:
   - Name: Test Customer
   - Email: test+TIMESTAMP@test.com (use unique email)
   - Phone: (555) 123-4567
   - Address: 123 Test St, Charlotte, NC 28202
5. Select tomorrow's date, 2pm slot
6. Use test card: 4242 4242 4242 4242
7. Complete payment
8. Note the confirmation/order ID

VERIFY IN DATABASE:
- Open Supabase h2s_jobs table
- Find job with customer email test+TIMESTAMP@test.com
- Confirm: scheduled_date, scheduled_time, status='scheduled'
```

### TEST 2: Tech Signup (5 mins)

```
1. Open new incognito: https://portal.home2smart.com/portal
2. Click "Sign up"
3. Enter:
   - Name: Test Tech
   - Email: tech+TIMESTAMP@test.com
   - Phone: (555) 987-6543
   - Address: 456 Tech Ave, Charlotte, NC 28202
   - Same ZIP as test job (28202)
4. Complete signup
5. Should redirect to dashboard

VERIFY IN DATABASE:
- Check h2s_pros table
- Find tech with email tech+TIMESTAMP@test.com
- Confirm: status='active' or 'pending'
```

### TEST 3: Job Assignment (Manual/Automatic)

**If automatic dispatch exists:**
```
- Wait 1-5 minutes
- Refresh portal dashboard
- Job should appear in "Pending offers"
```

**If manual dispatch needed:**
```
1. Open Supabase h2s_job_offers table
2. Create row:
   - job_id: (from TEST 1)
   - tech_id: (from TEST 2)
   - status: 'offered'
   - offered_at: NOW()
3. Refresh portal
4. Job appears in offers
```

### TEST 4: Accept & Complete Job (5 mins)

```
1. In portal, click "Accept" on test job
2. Verify:
   - Moves to "Upcoming jobs"
   - Shows customer details
   - Shows scheduled time
3. Click "Mark done"
4. Verify:
   - Moves to "Completed jobs"
   - Status updated in database
```

---

## 🚨 KNOWN FAILURE POINTS

### Issue 1: Portal Signup Returns 501
**Symptoms:** Clicking "Create account" → "Endpoint not implemented"  
**Cause:** h2s-backend missing environment variables  
**Fix:**
```powershell
cd backend
vercel env pull
# Verify SUPABASE_URL and SUPABASE_SERVICE_KEY exist
vercel --prod
```

### Issue 2: Jobs Don't Appear in Portal
**Symptoms:** Dashboard shows "No offers"  
**Possible Causes:**
1. Tech ZIP doesn't match job ZIP (no geographic match)
2. Job status not set to 'offered' for this tech
3. Token authentication failing
4. h2s_job_offers table missing rows

**Debug:**
```sql
-- Check if jobs exist
SELECT * FROM h2s_jobs WHERE status = 'scheduled' ORDER BY created_at DESC LIMIT 5;

-- Check if offers exist for your tech
SELECT * FROM h2s_job_offers WHERE tech_id = 'YOUR_TECH_ID' AND status = 'offered';

-- Check tech record
SELECT id, email, zip, status FROM h2s_pros WHERE email = 'YOUR_EMAIL';
```

### Issue 3: Bundles Payment Fails
**Symptoms:** Stripe checkout errors  
**Possible Causes:**
1. Stripe API keys not set in h2s-backend environment
2. Webhook not configured
3. Price amount calculation wrong

**Fix:**
```powershell
cd backend
vercel env add STRIPE_SECRET_KEY production
vercel env add STRIPE_WEBHOOK_SECRET production
```

---

## ✅ SUCCESS CRITERIA

**System is fully working when:**

1. [ ] Customer can book on shop.home2smart.com
2. [ ] Payment processes successfully  
3. [ ] Job appears in database with correct data
4. [ ] Tech can create account on portal.home2smart.com/portal
5. [ ] Tech account created in h2s_pros table
6. [ ] Job offer appears in portal dashboard
7. [ ] Tech can accept job
8. [ ] Job moves from offers → upcoming
9. [ ] Tech can mark job complete
10. [ ] Job status updates to completed

**All 10 steps must pass for full ecosystem validation.**

---

## 🔧 QUICK DIAGNOSTIC COMMANDS

```powershell
# Check if portal API is responding
Invoke-WebRequest -Uri "https://h2s-backend.vercel.app/api/portal_me" -Method OPTIONS

# Check if portal loads
Invoke-WebRequest -Uri "https://portal.home2smart.com/portal" -UseBasicParsing

# Check if shop loads
Invoke-WebRequest -Uri "https://shop.home2smart.com/bundles" -UseBasicParsing

# Validate current system
.\validate-system.ps1
```

---

## 📊 DATABASE ACCESS

**Supabase Dashboard:**
- URL: https://supabase.com/dashboard
- Project: (check backend/.env.local for SUPABASE_URL)
- Tables to monitor:
  - `h2s_jobs` - Customer bookings
  - `h2s_pros` - Technician accounts
  - `h2s_job_offers` - Job assignments
  - `h2s_customers` - Customer records

**Quick SQL Checks:**
```sql
-- Recent jobs
SELECT id, customer_id, service_type, scheduled_date, status, created_at 
FROM h2s_jobs 
ORDER BY created_at DESC 
LIMIT 10;

-- Active techs
SELECT id, email, name, zip, status, created_at 
FROM h2s_pros 
WHERE status = 'active' 
ORDER BY created_at DESC;

-- Pending offers
SELECT jo.*, j.service_type, j.scheduled_date, p.email as tech_email
FROM h2s_job_offers jo
JOIN h2s_jobs j ON jo.job_id = j.id
JOIN h2s_pros p ON jo.tech_id = p.id
WHERE jo.status = 'offered';
```

---

## 🎯 RECOMMENDED TEST ORDER

1. **Run system validation first:**
   ```powershell
   .\validate-system.ps1
   ```

2. **Verify APIs are responding:**
   - Test portal endpoints (portal_me, portal_jobs)
   - Test shop endpoints (track, schedule-appointment)

3. **Execute TEST 1:** Complete booking on shop
4. **Verify:** Check database for job record
5. **Execute TEST 2:** Tech signup on portal
6. **Verify:** Check database for tech record
7. **Execute TEST 3:** Manual job assignment (if needed)
8. **Execute TEST 4:** Accept and complete job flow

**Total time:** ~30 minutes for complete end-to-end test

---

**Next Step:** Run TEST 1 - Complete a booking and tell me if any step fails.
