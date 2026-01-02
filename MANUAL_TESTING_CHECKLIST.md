# 🧪 Manual Testing Checklist: Order → Job → Portal Flow

## Pre-Testing Setup

- [x] ✅ All code files verified present
- [x] ✅ Helper functions implemented
- [x] ✅ Webhook integration confirmed
- [x] ✅ API endpoints created
- [x] ✅ UI enhancements added
- [ ] Backend running (`cd backend && npm run dev`)
- [ ] h2s_dispatch_jobs table cleared for clean test

---

## Test Flow: Customer Checkout → Tech Portal

### Step 1: Simulate Customer Checkout
**Location**: https://home2smart.com/bundles (or localhost)

**Actions**:
1. Add a TV mounting package to cart (2-pack recommended)
2. Click "Checkout"
3. Fill in customer details:
   - Name: Test Customer
   - Email: test@example.com
   - Phone: 864-555-0100
   - Address: 123 Main St, Greenville, SC 29601
4. Choose mount options:
   - Select "We'll Provide Mounts" (triggers COMPANY_SUPPLIED)
   - Select mount types (tilt/full motion) 
5. Complete checkout with test card: `4242 4242 4242 4242`

**Expected Result**: ✅ Success page with order confirmation

---

### Step 2: Verify Job Creation in Database

**Check h2s_orders table**:
```sql
SELECT * FROM h2s_orders 
WHERE customer_email = 'test@example.com' 
ORDER BY created_at DESC 
LIMIT 1;
```

**Expected**:
- ✅ Order record exists
- ✅ Has `items` JSON with mount metadata

**Check h2s_dispatch_jobs table**:
```sql
SELECT 
  job_id, 
  service_id, 
  status,
  metadata->>'equipment_lane' as equipment_lane,
  metadata->>'order_required' as order_required,
  metadata->>'order_stage' as order_stage,
  metadata->'pain_flags' as pain_flags
FROM h2s_dispatch_jobs 
WHERE customer_email = 'test@example.com' 
ORDER BY created_at DESC 
LIMIT 1;
```

**Expected**:
- ✅ Job created with `status = 'pending'`
- ✅ `equipment_lane = 'COMPANY_SUPPLIED'` (if H2S providing mounts)
- ✅ `order_required = true` (if H2S providing mounts)
- ✅ `order_stage = 'PENDING_REVIEW'`
- ✅ `pain_flags` array has 2-3 flags (WIRE_MANAGEMENT_UNKNOWN, WALL_TYPE_UNKNOWN)

**⚠️ PITFALL CHECK**:
- ❌ If `equipment_lane = 'UNKNOWN'` → Metadata detection failed
- ❌ If `pain_flags = []` → evaluatePainFlags() not called
- ❌ If `metadata` is missing → getDefaultJobMetadata() not used

---

### Step 3: Check Portal Display

**Location**: https://home2smart.com/portal (or localhost portal)

**Actions**:
1. Sign in as a tech/pro
2. Navigate to "Jobs" tab
3. Look at "Pending offers" section

**Expected**:
- ✅ Test job appears in pending offers
- ✅ Service name displays correctly
- ✅ Location shows: Greenville, SC
- ✅ Estimated payout displays (≈ $179-$199)
- ✅ "Accept Job" button present

**Click "Details" button**:
- ✅ Modal opens with full job details
- ✅ Customer name and phone visible
- ✅ Address displayed
- ✅ Service items listed (2x TV Mounting)

**⚠️ PITFALL CHECK**:
- ❌ If job NOT appearing → Check portal API filter (may be filtering by status incorrectly)
- ❌ If cached old data → Clear localStorage and refresh
- ❌ If payout shows $0 → Check metadata.estimated_payout calculation

---

### Step 4: Accept Job

**Actions**:
1. Click "Accept Job" button
2. Observe UI transition

**Expected**:
- ✅ Job immediately disappears from "Pending offers"
- ✅ Job appears in "Upcoming jobs" section
- ✅ Toast notification: "Accepted"

**Check database**:
```sql
SELECT 
  job_id, 
  status,
  assign_state
FROM h2s_dispatch_jobs 
WHERE customer_email = 'test@example.com';
```

**Expected**:
- ✅ `status = 'accepted'` OR `assign_state = 'accepted'`

**Check assignment table** (if using separate assignments):
```sql
SELECT * FROM h2s_dispatch_job_assignments 
WHERE job_id = '<your_job_id>';
```

**Expected**:
- ✅ Assignment record created with `assign_state = 'accepted'`

**⚠️ PITFALL CHECK**:
- ❌ If job still in pending → Accept API may have failed
- ❌ If job disappeared but not in upcoming → Status update may have used wrong column
- ❌ If error toast appears → Check console for API response

---

### Step 5: Test Dispatch Portal (Admin View)

**Location**: dispatch.html or admin dashboard

**Actions**:
1. Open dispatch portal as admin
2. Find the accepted job
3. Click to open job details modal

**Expected Job Modal Sections**:
- ✅ **Pain Flags Section** displays with colored badges
  - 🟡 WIRE_MANAGEMENT_UNKNOWN (MEDIUM)
  - 🟡 WALL_TYPE_UNKNOWN (MEDIUM)
- ✅ **Equipment & Ordering Section** shows:
  - Equipment Lane: 🏠 COMPANY_SUPPLIED
  - Order Stage: PENDING_REVIEW
  - "Generate Order Plan" button visible
- ✅ **Installation Details Section** shows:
  - Wire Management: UNKNOWN
  - Wall Type: UNKNOWN
  - "Update Details" button visible

**Test Pain Flag Resolution**:
1. Click "Resolve" on WIRE_MANAGEMENT_UNKNOWN
2. Enter resolution notes: "Customer confirmed basic concealment OK"
3. Confirm

**Expected**:
- ✅ Pain flag badge updates to show "Resolved"
- ✅ Flag has `resolved_at` timestamp in database
- ✅ Audit log entry added

**Test Order Plan Generation**:
1. Click "Generate Order Plan"
2. Review suggested components

**Expected**:
- ✅ Modal shows mount types and components
- ✅ Total cost estimate displayed
- ✅ Plan saved to `metadata.order_plan`
- ✅ Order stage transitions to READY_TO_ORDER

**Test Install Details Update**:
1. Click "Update Details"
2. Select Wire Management: BASIC_CONCEAL
3. Select Wall Type: DRYWALL
4. Confirm

**Expected**:
- ✅ Details update in database
- ✅ Related pain flags auto-resolve
- ✅ Audit log entry added

**⚠️ PITFALL CHECK**:
- ❌ If sections don't appear → Check if modal rendering picks up metadata fields
- ❌ If buttons don't work → Check browser console for API 404s (endpoints not deployed)
- ❌ If updates don't save → Check API routes are accessible

---

### Step 6: Test Status Transition Guards

**Actions**:
1. In dispatch portal, try to mark job as "Completed"
2. (Should be prevented if critical pain flags exist)

**Expected**:
- ✅ If critical flags exist → Blocked with error message
- ✅ If all resolved → Allowed to complete

**Test in console** (optional):
```javascript
// In dispatch.html, call status update API directly
updateJobStatus('your_job_id', 'completed');
```

**Expected**:
- ✅ If ACCESS_DETAILS_MISSING flag exists → Rejected
- ✅ If all critical flags resolved → Status updates

---

## Common Pitfalls to Watch For

### 🔴 Critical Issues:
- ❌ Jobs created without standardized metadata
- ❌ Pain flags not evaluated on job creation
- ❌ Equipment lane always showing UNKNOWN
- ❌ Portal not displaying jobs (check status filter)
- ❌ Accept button not working (API routing issue)

### 🟡 Medium Issues:
- ⚠️  Pain flags UI not appearing in dispatch modal
- ⚠️  Order plan generation showing 404
- ⚠️  Status transition guards not enforcing
- ⚠️  Audit log not recording changes

### 🟢 Minor Issues:
- ⚠️  Cached data in portal (clear localStorage)
- ⚠️  Payout calculation slightly off
- ⚠️  UI styling inconsistencies

---

## Success Criteria

**✅ PASS** if all of these work:
1. Checkout creates job in h2s_dispatch_jobs
2. Job has complete metadata structure
3. Pain flags are detected and displayed
4. Equipment lane is correctly identified
5. Job appears in portal pending offers
6. Accept flow works (pending → upcoming)
7. Dispatch modal shows all new sections
8. Pain flag resolution works
9. Order plan generation works
10. Status guards prevent invalid transitions

**❌ FAIL** if any critical system doesn't work

---

## Quick Database Cleanup

After testing, clean up test data:

```sql
-- Delete test jobs
DELETE FROM h2s_dispatch_jobs 
WHERE customer_email LIKE 'test%@%';

-- Delete test orders
DELETE FROM h2s_orders 
WHERE customer_email LIKE 'test%@%';

-- Delete test assignments (if separate table)
DELETE FROM h2s_dispatch_job_assignments 
WHERE pro_id = 'test_pro_id';
```

---

## Notes During Testing

**Issues Found**:
- [ ] 
- [ ] 
- [ ] 

**Things That Worked**:
- [ ] 
- [ ] 
- [ ] 

**Questions**:
- [ ] 
- [ ] 
- [ ] 
