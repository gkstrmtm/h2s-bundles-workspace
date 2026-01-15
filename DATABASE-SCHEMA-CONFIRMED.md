# DATABASE SCHEMA — CONFIRMED FROM PRODUCTION

## h2s_dispatch_jobs (ACTUAL COLUMNS)

**Confirmed via production query (get-real-schema.js):**

```
1.  job_id           (UUID, primary key)
2.  created_at       (timestamp)
3.  updated_at       (timestamp)
4.  recipient_id     (UUID, foreign key)
5.  sequence_id      (UUID)
6.  step_id          (UUID)
7.  due_at           (timestamp)
8.  status           (text)
9.  locked_at        (timestamp, nullable)
10. lock_owner       (text, nullable)
11. attempt_count    (integer)
12. last_error       (text, nullable)
13. order_id         (text) — Links to h2s_orders.order_id
```

**CRITICAL FINDINGS:**
- ❌ **NO `metadata` column exists**
- ❌ **NO `payout_estimated` column exists**
- ❌ **NO `start_iso` column exists**
- ❌ **NO `end_iso` column exists**
- ❌ **NO financial columns exist** (payout, job_value, etc.)
- ✅ **ONLY linkage**: `order_id` (text) → references h2s_orders.order_id

**IMPLICATIONS:**
1. All job metadata MUST be stored in h2s_orders.metadata_json
2. Payout calculation CANNOT be stored in dispatch_jobs table
3. Install date CANNOT be stored in dispatch_jobs table
4. Portal must read ALL job details from h2s_orders via order_id linkage

---

## h2s_orders (CONFIRMED FROM shop/route.ts INSERT)

**Confirmed columns from shop/route.ts lines 1347-1363:**

```sql
order_id         text (format: ORD-MKXXXXXXXX)
session_id       text (Stripe session ID, nullable initially)
customer_email   text (customer email)
customer_name    text (customer full name)
customer_phone   text (customer phone)
items            jsonb (array of cart items with id, name, price, qty)
subtotal         numeric (pre-discount total in DOLLARS)
total            numeric (post-discount total in DOLLARS)
currency         text (default: 'usd')
status           text ('pending_payment', 'paid', 'completed', etc.)
metadata_json    jsonb (ALL extended job/bundle data - SEE BELOW)
created_at       timestamp (ISO 8601 string)
address          text (service address)
city             text (service city)
state            text (service state)
zip              text (service zip code)
```

**Additional columns (set by schedule-appointment API):**
- `delivery_date` text (install date, e.g., '2026-01-15')
- `delivery_time` text (install window, e.g., '12:00 PM - 3:00 PM')

**Database internals:**
- `id` UUID (database primary key, auto-generated)
- `updated_at` timestamp (auto-updated)

---

## DATA OWNERSHIP & FLOW

### h2s_orders is the SOURCE OF TRUTH for:
1. **Bundle price** → `subtotal` (in DOLLARS, pre-discount)
2. **Customer info** → customer_email, customer_name, customer_phone
3. **Service location** → address, city, state, zip
4. **Install date** → `delivery_date` (set by schedule-appointment API)
5. **Install time** → `delivery_time` (set by schedule-appointment API)
6. **Job metadata** → `metadata_json` CURRENTLY contains:
   - From offerMeta: `customer_email`, `customer_name`, `service_address`, etc.
   - `job_details` (canonical job details payload)
   - `job_details_summary` (human-readable summary)
   - `equipment_provided` (equipment list)
   - `schedule_status` ('Scheduling Pending')
   - `cart_items_count`
   - `cart_total_items`
   
   **❌ MISSING FROM metadata_json (NEEDS TO BE ADDED):**
   - `job_value_cents` (210000 for $2,100)
   - `tech_payout_cents` (73500 for 35%)
   - `tech_payout_dollars` (735.00)
   - `payout_rate` (0.35)
   - `dispatch_job_id` (job UUID, set after dispatch job creation)

### h2s_dispatch_jobs is DERIVATIVE:
- **Purpose**: Job queue/workflow execution
- **Only stores**: Job ID, status, timing, recipient linkage, order_id reference
- **Links to orders via**: `order_id` field (text, matches h2s_orders.order_id)
- **Does NOT store**: Payout, job value, install details (must read from h2s_orders)

---

## CURRENT BUG ANALYSIS

### Bug #1: Payout Not Stored in metadata_json

**Root Cause**: Payout is CALCULATED but NOT STORED

**Current Code (shop/route.ts lines 1290-1293)**:
```typescript
const jobValueDollars = subtotal; // 2100
const jobValueCents = Math.round(jobValueDollars * 100); // 210000
const techPayoutCents = Math.round(jobValueCents * 0.35); // 73500
const techPayoutDollars = techPayoutCents / 100; // 735.00
```

**Current Code (shop/route.ts lines 1333-1340)** - metadata_json:
```typescript
const enhancedMetadata = {
  ...offerMeta,
  job_details: jobDetails,
  job_details_summary: jobDetailsSummary,
  equipment_provided: equipmentProvided,
  schedule_status: 'Scheduling Pending',
  cart_items_count: cart.length,
  cart_total_items: cart.reduce((sum, item) => sum + (item.qty || 1), 0),
  // ❌ MISSING: job_value_cents, tech_payout_cents, tech_payout_dollars
};
```

**Result**: Payout is calculated but NEVER stored in database!

**Portal Reads** (portal.html line 6396):
```javascript
job?.metadata?.payout_estimated
```
**Returns**: undefined (because metadata_json doesn't have payout fields)

### Bug #2: Attempted to Store in dispatch_jobs (Broken Code)

**Previous Broken Code (lines 1455-1476)** - DEPLOYED TO backend-fr6w4x288:
```typescript
const dispatchMetadata = {
  job_value_cents: jobValueCents,
  tech_payout_cents: techPayoutCents,
  // ... more fields
};

await dispatch.from('h2s_dispatch_jobs').insert({
  metadata: dispatchMetadata, // ❌ Column doesn't exist!
});
```

**Result**: INSERT will fail with SQL error "column metadata does not exist"

### Bug #3: Install Date Wrong

**Root Cause**: dispatch_jobs.due_at set to tomorrow, not actual install date

**Current Code (shop/route.ts line 1471)**:
```typescript
due_at: new Date(Date.now() + 24 * 60 * 60 * 1000) // Tomorrow
```

**Should Be**: Updated when customer schedules appointment
- h2s_orders.delivery_date set by schedule-appointment API
- h2s_dispatch_jobs.due_at should match delivery_date

**Portal Reads**: `job.due_at`
**Shows**: Tomorrow (wrong) instead of scheduled install date

---

## REQUIRED FIXES

### Fix #1: Store Payout in h2s_orders.metadata_json

**shop/route.ts** (checkout) - CHANGE lines 1333-1340:

**CURRENT (WRONG)**:
```typescript
const enhancedMetadata = {
  ...offerMeta,
  job_details: jobDetails,
  job_details_summary: jobDetailsSummary,
  equipment_provided: equipmentProvided,
  schedule_status: 'Scheduling Pending',
  cart_items_count: cart.length,
  cart_total_items: cart.reduce((sum, item) => sum + (item.qty || 1), 0),
};
```

**FIXED (CORRECT)**:
```typescript
const enhancedMetadata = {
  ...offerMeta,
  job_details: jobDetails,
  job_details_summary: jobDetailsSummary,
  equipment_provided: equipmentProvided,
  schedule_status: 'Scheduling Pending',
  cart_items_count: cart.length,
  cart_total_items: cart.reduce((sum, item) => sum + (item.qty || 1), 0),
  // ✅ ADD PAYOUT DATA
  job_value_cents: jobValueCents,        // 210000 for $2,100
  tech_payout_cents: techPayoutCents,    // 73500 (35%)
  tech_payout_dollars: techPayoutDollars, // 735.00
  payout_rate: 0.35,
};
```

Then insert into h2s_orders:
```typescript
await client.from('h2s_orders').insert({
  // ... other fields
  subtotal: jobValueDollars, // Source of truth for bundle price
  metadata_json: enhancedMetadata, // ✅ Contains payout data
});
```

**h2s_dispatch_jobs insert** - KEEP SIMPLE (no metadata):
```typescript
await dispatch.from('h2s_dispatch_jobs').insert({
  job_id: jobId,
  order_id: orderId, // ✅ ONLY linkage needed
  recipient_id: recipientId,
  status: 'pending_payment',
  created_at: new Date().toISOString(),
  due_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // Temporary
  sequence_id: DEFAULT_SEQUENCE_ID,
  step_id: DEFAULT_STEP_ID,
  attempt_count: 0,
});
```

### Fix #2: Update due_at When Scheduling & Add dispatch_job_id to Order

**schedule-appointment/route.ts**:
```typescript
// Update h2s_orders with install date AND job_id
await main.from('h2s_orders').update({
  delivery_date: '2026-01-15',
  delivery_time: '12:00 PM - 3:00 PM',
  metadata_json: {
    ...existingMetadata,
    dispatch_job_id: jobId, // ✅ Link back to dispatch job
    install_date: '2026-01-15', // Duplicate for convenience
    install_window: '12:00 PM - 3:00 PM',
  }
}).eq('order_id', orderId);

// Update h2s_dispatch_jobs.due_at to match
const installDateTime = new Date('2026-01-15T12:00:00');
await dispatch.from('h2s_dispatch_jobs').update({
  due_at: installDateTime.toISOString(),
  status: 'queued', // Activate job
}).eq('order_id', orderId);
```

### Fix #3: Portal Must Read from h2s_orders via order_id

**Portal needs to query BOTH tables and JOIN the data**:

Option A: Single query with JOIN (if Supabase client supports it):
```javascript
const { data: jobs } = await dispatch
  .from('h2s_dispatch_jobs')
  .select(`
    *,
    order:h2s_orders!order_id (
      subtotal,
      delivery_date,
      delivery_time,
      metadata_json
    )
  `)
  .eq('status', 'queued')
  .order('due_at');
  
// Access: 
// job.order.subtotal → 2100
// job.order.metadata_json.tech_payout_dollars → 735
// job.order.delivery_date → '2026-01-15'
```

Option B: Two queries (current approach):
```javascript
// 1. Get dispatch jobs
const { data: jobs } = await dispatch
  .from('h2s_dispatch_jobs')
  .select('*')
  .eq('status', 'queued');

// 2. Get order details for each job
for (const job of jobs) {
  const { data: order } = await main
    .from('h2s_orders')
    .select('subtotal, delivery_date, delivery_time, metadata_json')
    .eq('order_id', job.order_id)
    .single();
  
  // Merge data
  job.bundlePrice = order.subtotal;
  job.payout = order.metadata_json?.tech_payout_dollars || (order.subtotal * 0.35);
  job.installDate = order.delivery_date || job.due_at;
  job.installWindow = order.delivery_time || 'TBD';
}
```

**Portal display** (portal.html line ~6396):
```javascript
// CHANGE FROM:
const payout = job?.metadata?.payout_estimated || '$45.00';

// CHANGE TO:
const payout = job?.payout || job?.order?.metadata_json?.tech_payout_dollars || '$45.00';
```

---

## VERIFICATION QUERIES

### Check if payout is being stored:
```sql
SELECT 
  order_id,
  subtotal,
  metadata_json->>'tech_payout_dollars' as payout,
  metadata_json->>'job_value_cents' as job_value_cents
FROM h2s_orders
WHERE order_id = 'ORD-MKARDORG84B99C99';
```

Expected:
- subtotal = 2100
- payout = '735'
- job_value_cents = '210000'

### Check dispatch job linkage:
```sql
SELECT 
  j.job_id,
  j.order_id,
  j.due_at,
  j.status,
  o.subtotal,
  o.metadata_json->>'tech_payout_dollars' as payout
FROM h2s_dispatch_jobs j
LEFT JOIN h2s_orders o ON j.order_id = o.order_id
WHERE j.job_id = '2a27f341-1e2a-4071-b436-14653cf235cd';
```

Expected:
- order_id should match
- subtotal should be 2100
- payout should be '735'

---

## NEXT STEPS

1. ✅ **CONFIRMED**: h2s_dispatch_jobs schema (13 columns, NO metadata/payout columns)
2. ✅ **CONFIRMED**: h2s_orders schema from INSERT statement (18 columns)
3. ✅ **CONFIRMED**: metadata_json is MISSING payout data (calculated but not stored)
4. ⏸️ **PENDING**: Fix #1 - Add payout to metadata_json in shop/route.ts
5. ⏸️ **PENDING**: Fix #2 - Update due_at and link job_id in schedule-appointment
6. ⏸️ **PENDING**: Fix #3 - Portal must query h2s_orders via order_id
7. ⏸️ **PENDING**: Remove ALL references to dispatch_jobs.metadata (doesn't exist)
8. ⏸️ **PENDING**: Remove ALL references to dispatch_jobs.payout_estimated (doesn't exist)

**CRITICAL**: backend-fr6w4x288 is BROKEN (references non-existent columns)
**ACTION**: Deploy fixes in next deployment

---

## COMPLETE IMPLEMENTATION PLAN

### Phase 1: Fix Data Storage (shop/route.ts)

**File**: backend/app/api/shop/route.ts  
**Lines to change**: 1333-1340

```typescript
// ADD payout fields to enhancedMetadata
const enhancedMetadata = {
  ...offerMeta,
  job_details: jobDetails,
  job_details_summary: jobDetailsSummary,
  equipment_provided: equipmentProvided,
  schedule_status: 'Scheduling Pending',
  cart_items_count: cart.length,
  cart_total_items: cart.reduce((sum, item) => sum + (item.qty || 1), 0),
  // ✅ NEW: Payout calculation results
  job_value_cents: jobValueCents,
  tech_payout_cents: techPayoutCents,
  tech_payout_dollars: techPayoutDollars,
  payout_rate: 0.35,
};
```

**Lines to verify**: 1455-1476 (dispatch job insert)
- MUST NOT include `metadata` field
- MUST NOT include `payout_estimated` field
- ONLY: job_id, order_id, recipient_id, status, timestamps, due_at, sequence_id, step_id, attempt_count

### Phase 2: Fix Scheduling (schedule-appointment/route.ts)

**Add dispatch_job_id to order metadata** when scheduling:
```typescript
// Get existing order
const { data: existingOrder } = await main
  .from('h2s_orders')
  .select('metadata_json')
  .eq('order_id', orderId)
  .single();

// Update order with install info AND job link
await main.from('h2s_orders').update({
  delivery_date: selectedDate,
  delivery_time: selectedWindow,
  metadata_json: {
    ...(existingOrder.metadata_json || {}),
    dispatch_job_id: jobId,
    install_date: selectedDate,
    install_window: selectedWindow,
  }
}).eq('order_id', orderId);

// Update dispatch job due_at
await dispatch.from('h2s_dispatch_jobs').update({
  due_at: installDateTime,
  status: 'queued',
}).eq('order_id', orderId);
```

### Phase 3: Fix Portal Data Loading

**File**: frontend/portal.html  
**Function**: loadJobs() or similar

**Current (BROKEN)**:
```javascript
const { data: jobs } = await dispatch
  .from('h2s_dispatch_jobs')
  .select('*')
  .eq('status', 'queued');

// Portal reads: job.metadata.payout_estimated (undefined!)
```

**Fixed (CORRECT)**:
```javascript
// 1. Get dispatch jobs
const { data: jobs } = await dispatch
  .from('h2s_dispatch_jobs')
  .select('*')
  .eq('status', 'queued')
  .order('due_at');

// 2. Enrich with order data
const enrichedJobs = await Promise.all(jobs.map(async (job) => {
  if (!job.order_id) return job;
  
  const { data: order } = await main
    .from('h2s_orders')
    .select('subtotal, delivery_date, delivery_time, metadata_json, customer_name, customer_phone, address, city, state, zip')
    .eq('order_id', job.order_id)
    .single();
  
  if (!order) return job;
  
  return {
    ...job,
    // Merge order data for easy access
    bundlePrice: order.subtotal,
    payout: order.metadata_json?.tech_payout_dollars || (order.subtotal * 0.35),
    installDate: order.delivery_date || job.due_at,
    installWindow: order.delivery_time || 'TBD',
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    serviceAddress: `${order.address}, ${order.city}, ${order.state} ${order.zip}`,
    jobDetails: order.metadata_json?.job_details,
  };
}));

// 3. Use enrichedJobs to render UI
```

**Portal display (lines ~6390-6400)**:
```javascript
// CHANGE FROM:
const payout = job?.metadata?.payout_estimated || '$45.00';
const installDate = job?.due_at ? formatDate(job.due_at) : 'TBD';

// CHANGE TO:
const payout = job?.payout ? `$${job.payout.toFixed(2)}` : '$45.00';
const installDate = job?.installDate ? formatDate(job.installDate) : formatDate(job.due_at);
const installWindow = job?.installWindow || 'TBD';
```

---

## DEPLOYMENT CHECKLIST

Before deploying:
- [ ] Fix shop/route.ts metadata_json (add payout fields)
- [ ] Verify dispatch job insert has NO metadata/payout_estimated fields
- [ ] Fix schedule-appointment to update due_at and link job_id
- [ ] Fix portal to query h2s_orders and enrich job data
- [ ] Test with $2,100 bundle: expect $735 payout (35%)
- [ ] Verify no SQL errors about missing columns
- [ ] Verify portal displays correct payout
- [ ] Verify portal displays scheduled install date (not tomorrow)

**DO NOT PROCEED WITH CODE CHANGES UNTIL SCHEMA IS 100% CONFIRMED**
