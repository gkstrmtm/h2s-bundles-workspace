# SYSTEM_CURRENT_STATE.md
**Last Updated:** December 30, 2025  
**Status:** Live Production System (As-Is Documentation)

---

## 1. What Exists Today

### Job Creation Flow
**Purchase Flow:**
- Customer visits bundles.html (Home2Smart-Dashboard/bundles.html)
- Selects service bundle (TV mounting, camera install, etc.)
- Stripe checkout initiated via `/api/shop` endpoint
- Order created in `h2s_orders` table with:
  - order_id (UUID)
  - session_id (Stripe session)
  - customer details (name, phone, email, address)
  - service_name, items_json (cart details)
  - order_total, order_subtotal
  - metadata (JSON blob with cart, items, pricing)

**Scheduling Flow:**
- Customer selects delivery date/time after payment
- `/api/schedule-appointment` endpoint creates dispatch job
- Job record created in `h2s_dispatch_jobs` table

### Where Job Records Live
**Primary Database:** Supabase (PostgreSQL)
- **h2s_orders** - Customer orders from checkout
- **h2s_dispatch_jobs** - Dispatch jobs for technicians
- **h2s_dispatch_job_assignments** - Job-to-technician assignments

**Tables:**
```
h2s_orders:
  - order_id (UUID, primary key)
  - session_id (Stripe session)
  - customer_name, customer_phone, customer_email
  - service_address, service_city, service_state, service_zip
  - service_name, items_json
  - order_total, order_subtotal
  - scheduled_date
  - metadata (JSONB)

h2s_dispatch_jobs:
  - job_id (UUID, primary key)
  - order_id (links to h2s_orders)
  - status (pending, scheduled, accepted, in_progress, completed)
  - customer_name, customer_phone, customer_email
  - service_address, service_city, service_state, service_zip
  - geo_lat, geo_lng (geocoded location)
  - start_iso, end_iso (scheduled time window)
  - metadata (JSONB - duplicates order data for portal access)
  - created_at, updated_at, completed_at

h2s_dispatch_job_assignments:
  - assignment_id (UUID, primary key)
  - job_id (links to h2s_dispatch_jobs)
  - pro_id (technician UUID)
  - state (offered, accepted, declined)
  - offer_sent_at, accepted_at
```

### Where Jobs Are Rendered

**1. Tech Portal (portal.html)**
- **Location:** Home2Smart-Dashboard/portal.html
- **URL:** Accessed via login (tech portal)
- **Sections:**
  - Available Offers (unassigned jobs)
  - Upcoming Jobs (accepted/scheduled jobs)
  - Completed Jobs (finished jobs)
- **Data Source:** `/api/portal_jobs` endpoint
- **What Tech Sees:**
  - Service name (enriched from metadata.items_json)
  - Payout amount (from metadata.estimated_payout)
  - Customer name, phone (click-to-call)
  - Service address with map link
  - Scheduled date/time
  - Job details modal with full information

**2. Dispatch View (dispatch.html)**
- **Location:** Home2Smart-Dashboard/dispatch.html
- **Purpose:** Admin/dispatch overview
- **Data Source:** Direct Supabase queries (not yet confirmed in code)
- **Current Status:** ⚠️ Not verified in conversation - needs inspection

**3. Customer Account View**
- **Location:** bundles.html (account section)
- **Purpose:** Customer views their order history
- **Data Source:** ⚠️ Not confirmed - likely h2s_orders table
- **Current Status:** ⚠️ Not verified - needs inspection

### What Data Each UI Currently Receives

**Portal (Available Offers):**
```javascript
{
  job_id: "uuid",
  status: "pending_assign",
  customer_name: "John Doe",
  customer_phone: "864-123-4567",
  customer_email: "customer@example.com",
  service_address: "123 Main St",
  service_city: "Greenville",
  service_state: "SC",
  service_zip: "29601",
  geo_lat: 34.8526,
  geo_lng: -82.3940,
  start_iso: "2025-12-31T17:00:00.000Z",
  end_iso: "2025-12-31T20:00:00.000Z",
  metadata: {
    items_json: [{name: "Full Perimeter", quantity: 1, ...}],
    estimated_payout: 769,
    order_total: 2199,
    ...
  }
}
```

**Portal API Enrichment:**
- `enrichServiceName()` function extracts service name from metadata.items_json
- Example: "Full Perimeter" or "2x TV Mount" or "Standard Perimeter + Doorbell"
- Payout calculated from metadata.estimated_payout
- Line items parsed from metadata.items_json for display

---

## 2. Core Entities and IDs

### Primary Identifiers

**order_id** (UUID)
- Created by `/api/shop` during checkout
- Links h2s_orders → h2s_dispatch_jobs
- Format: `d9d17430-07bc-46c1-b67b-78e584ae8a78`

**job_id** (UUID)
- Created by `/api/schedule-appointment` when job is scheduled
- Primary key in h2s_dispatch_jobs
- Used by portal to fetch/update job details
- Format: `e05bf02a-8dac-4239-9a31-5efde0ad8617`

**session_id** (Stripe Session ID)
- Created by Stripe checkout
- Stored in h2s_orders
- Format: `cs_live_a1GGzmWJx8mzkl9kJp2ismuNiURB0wfBwnIbwzqTXNqx1kb3ouuJme8h2m`

**pro_id** (UUID)
- Technician/professional identifier
- Stored in portal JWT token
- Used to filter jobs in `/api/portal_jobs`
- Links via h2s_dispatch_job_assignments

**assignment_id** (UUID)
- Created when job offered/assigned to tech
- Links job_id → pro_id in h2s_dispatch_job_assignments
- Tracks assignment state (offered, accepted, declined)

### Relationship Map
```
┌─────────────┐
│  Customer   │
│   Checkout  │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│   h2s_orders        │
│   order_id (PK)     │──┐
│   session_id        │  │
│   customer_*        │  │
│   items_json        │  │
└─────────────────────┘  │
                         │ order_id links
                         │
                         ▼
              ┌─────────────────────┐
              │ h2s_dispatch_jobs   │
              │ job_id (PK)         │──────┐
              │ order_id (FK)       │      │
              │ customer_*          │      │ job_id links
              │ metadata            │      │
              └─────────────────────┘      │
                                           ▼
                              ┌──────────────────────────┐
                              │ h2s_dispatch_job_        │
                              │ assignments              │
                              │ assignment_id (PK)       │
                              │ job_id (FK)              │
                              │ pro_id (FK)              │
                              │ state                    │
                              └──────────────────────────┘
```

---

## 3. Job Data Model

### What We Store Today

**Customer Information:**
- ✅ customer_name (first-class column)
- ✅ customer_phone (first-class column)
- ✅ customer_email (first-class column)
- ✅ service_address (first-class column)
- ✅ service_city (first-class column)
- ✅ service_state (first-class column)
- ✅ service_zip (first-class column)

**Service Details:**
- ✅ service_id (first-class column, often NULL)
- ✅ metadata.items_json (array of line items with name, quantity, price)
- ✅ metadata.service_name (derived from items_json)
- ❌ **MISSING:** title column (doesn't exist in DB)
- ❌ **MISSING:** Structured service type field (TV vs Camera vs Other)

**Scheduling:**
- ✅ start_iso (scheduled start time, ISO format UTC)
- ✅ end_iso (scheduled end time, ISO format UTC)
- ❌ **MISSING:** scheduled_date column (doesn't exist in DB)
- ❌ **MISSING:** Timezone field (assumed America/New_York)
- ✅ metadata.delivery_date (original date string)
- ✅ metadata.delivery_time (original time window string)

**Pricing & Payout:**
- ✅ metadata.order_total (customer paid amount)
- ✅ metadata.order_subtotal (before tax/fees)
- ✅ metadata.estimated_payout (technician payout)
- ❌ **MISSING:** total_payout column (doesn't exist in DB)

**Location:**
- ✅ geo_lat, geo_lng (geocoded coordinates)
- ✅ Geocoding done during job creation

**Notes & Requirements:**
- ✅ notes_from_customer (first-class column, rarely populated)
- ✅ resources_needed (first-class column, NULL)
- ✅ resources_needed_override (first-class column, NULL)
- ✅ included_tech_source (first-class column, NULL)
- ❌ **MISSING:** Equipment mode (provided vs BYO)
- ❌ **MISSING:** Install specifics (wire concealment, attic run, etc.)
- ❌ **MISSING:** Coverage intent for cameras (faces/plates, perimeter, etc.)

**Customer Photos:**
- ❌ **MISSING:** No photo upload during checkout
- ❌ **MISSING:** No photo storage/linking to job_id
- ❌ **MISSING:** No photo display in tech portal

**Completion Assets:**
- ✅ completed_at (timestamp when marked complete)
- ✅ completed_requires_signature (boolean flag)
- ✅ completed_requires_photos (boolean flag)
- ✅ signature_on_file (boolean, tracked)
- ✅ photo_on_file (boolean, tracked)
- ✅ photo_count (integer)
- ❌ **MISSING:** Actual photo storage/retrieval system
- ❌ **MISSING:** Signature image storage/retrieval

**Team Jobs:**
- ✅ is_team_job (boolean in metadata)
- ✅ team_size (integer in metadata)
- ✅ teammate_name (string in metadata)
- ✅ payout_split (string like "50/50")

### What We Can Derive
- Service type from items_json[0].name (e.g., "Full Perimeter" → Camera Install)
- Quantity from items_json[0].quantity
- Display time from start_iso converted to America/New_York timezone
- Distance from tech location using geo_lat/geo_lng

### What Is Missing Today
1. **No structured service categorization** (TV, Camera, Doorbell, etc.)
2. **No equipment mode tracking** (provided vs customer-supplied)
3. **No install requirement details** (wire concealment, mounting surface, etc.)
4. **No customer photo uploads** before job assignment
5. **No completion photo storage/display** system
6. **No signature image storage** (only boolean flag)
7. **No camera-specific fields:**
   - Camera count (derivable from quantity but not explicit)
   - Coverage area preferences
   - View angle requirements
   - Recording/cloud preferences

---

## 4. Date/Time Standard

### Current Behavior

**Storage Format:**
- ✅ Stored as ISO 8601 UTC timestamps
- Example: `"2025-12-31T17:00:00.000Z"`
- Fields: start_iso, end_iso, created_at, updated_at, completed_at

**Timezone Handling:**
- ⚠️ **INCONSISTENT:** No timezone field stored with jobs
- ⚠️ **ASSUMED:** All times treated as America/New_York (Eastern Time)
- ⚠️ **RISK:** Multi-timezone operations not supported

**Display Format (Portal):**
```javascript
// Current portal code (showJobDetails function)
const d = new Date(job.start_iso);
const dateStr = d.toLocaleDateString('en-US', { 
  weekday: 'short', month: 'short', day: 'numeric' 
});
const timeStr = d.toLocaleTimeString('en-US', { 
  hour: 'numeric', minute: '2-digit' 
});
// Output: "Tue, Dec 31 • 5:00 PM" (browser timezone, not guaranteed ET)
```

**Problems:**
- ❌ Browser converts UTC to local timezone, not necessarily ET
- ❌ Dispatch.html may show different time than portal
- ❌ No explicit timezone indicator shown to user
- ❌ Confusing for techs in different timezones

### Target Standard

**Storage (No Change Needed):**
- Continue using ISO 8601 UTC: `2025-12-31T17:00:00.000Z`
- Add optional `timezone` field to h2s_dispatch_jobs (default: "America/New_York")

**Display Rule:**
```
Format: "Day, Mon DD at H:MM AM/PM ET"
Examples:
  - "Tue, Dec 31 at 5:00 PM ET"
  - "Wed, Jan 1 at 9:30 AM ET"
  - "Thu, Jan 2 at 12:00 PM ET"

Rules:
1. Always convert UTC → America/New_York explicitly
2. Always append "ET" to make timezone clear
3. Use 12-hour format with AM/PM
4. Consistent across portal, dispatch, customer views
```

**Implementation Requirements:**
```javascript
// Use moment-timezone or date-fns-tz
import { formatInTimeZone } from 'date-fns-tz';

const displayTime = formatInTimeZone(
  job.start_iso, 
  'America/New_York', 
  'EEE, MMM d \'at\' h:mm a'
) + ' ET';
// Output: "Tue, Dec 31 at 5:00 PM ET"
```

**Apply Everywhere:**
- ✅ Portal job cards
- ✅ Portal job details modal
- ✅ Dispatch.html job listings
- ✅ Customer order confirmation emails
- ✅ SMS reminders

---

## 5. Data Flow Map (End-to-End)

### Step 1: Customer Purchase
**Trigger:** Customer clicks "Proceed to Checkout" on bundles.html

**Process:**
1. Frontend collects cart items, customer info
2. POST to `/api/shop` with:
   ```json
   {
     "cart": [{id: "cam_premium", qty: 1, price: 2199}],
     "customer": {name, email, phone},
     "address": {street, city, state, zip},
     "source": "shop_rebuilt"
   }
   ```
3. Backend creates Stripe checkout session
4. Backend inserts into h2s_orders:
   - order_id generated
   - customer_* fields populated
   - items_json serialized from cart
   - metadata blob created
   - status = 'pending_payment'

**Data Written:**
- h2s_orders record created
- Stripe session created

**Rendered:**
- Customer redirected to Stripe checkout
- Success/cancel URLs configured

---

### Step 2: Scheduling Selection
**Trigger:** Customer completes payment, lands on scheduling page

**Process:**
1. Customer selects delivery date and time window
2. POST to `/api/schedule-appointment` with:
   ```json
   {
     "order_id": "uuid",
     "delivery_date": "2025-12-31",
     "delivery_time": "5:00 PM - 8:00 PM"
   }
   ```
3. Backend fetches order from h2s_orders
4. Backend computes start_iso/end_iso from date + time window
5. Backend geocodes service address → geo_lat, geo_lng

**Data Written:**
- h2s_orders.scheduled_date updated
- h2s_orders.status = 'scheduled'

---

### Step 3: Job Creation
**Trigger:** `/api/schedule-appointment` called after scheduling

**Process:**
1. Check if job already exists for order_id
2. If not, create new h2s_dispatch_jobs record:
   ```javascript
   insertJob = {
     job_id: crypto.randomUUID(),
     order_id: order.order_id,
     status: 'scheduled',
     customer_name: order.customer_name,
     customer_phone: order.customer_phone,
     customer_email: order.customer_email,
     service_address: order.service_address,
     service_city: order.service_city,
     service_state: order.service_state,
     service_zip: order.service_zip,
     geo_lat: geocoded_lat,
     geo_lng: geocoded_lng,
     start_iso: computed_start_utc,
     end_iso: computed_end_utc,
     metadata: {
       ...order.metadata,
       order_id_text: order.order_id,
       session_id: order.session_id,
       scheduled_via: 'api/schedule-appointment',
       estimated_payout: calculatePayout(order),
       items_json: order.items_json,
       customer_name, customer_email, customer_phone,
       service_address, service_city, service_state, service_zip
     }
   }
   ```

**Data Written:**
- h2s_dispatch_jobs record created
- job_id minted and returned

---

### Step 4: Assignment to Technician
**Trigger:** Automatic (job appears as available offer) or Manual (admin assigns)

**Process:**
1. Portal calls `/api/portal_jobs` with tech's token
2. Backend extracts pro_id from JWT
3. Backend queries:
   - Available offers (no assignment, status=pending/open)
   - Upcoming jobs (assigned to pro_id, status=accepted/scheduled)
   - Completed jobs (assigned to pro_id, status=completed)
4. Tech clicks "Accept" on offer
5. POST to `/api/portal_accept` with job_id
6. Backend creates h2s_dispatch_job_assignments:
   ```javascript
   {
     assignment_id: crypto.randomUUID(),
     job_id: job.job_id,
     pro_id: tech_pro_id,
     state: 'accepted',
     offer_sent_at: now(),
     accepted_at: now()
   }
   ```
7. Backend updates h2s_dispatch_jobs.status = 'accepted'

**Data Written:**
- h2s_dispatch_job_assignments record created
- h2s_dispatch_jobs.status updated
- h2s_dispatch_jobs.assigned_pro_id updated (maybe, not confirmed)

---

### Step 5: Portal Rendering
**Trigger:** Tech opens portal, auto-refreshes every 30s

**Process:**
1. Portal calls GET `/api/portal_jobs?token=xxx`
2. Backend returns:
   ```json
   {
     "ok": true,
     "offers": [...unassigned jobs],
     "upcoming": [...tech's accepted jobs],
     "completed": [...tech's finished jobs]
   }
   ```
3. For each job, portal calls `enrichServiceName(job)`:
   - Extracts items_json from metadata
   - Builds display name: "Full Perimeter" or "2x TV Mount"
   - Returns enriched service_name
4. Portal renders job cards with:
   - Service name (enriched)
   - Payout (from metadata.estimated_payout)
   - Scheduled time (from start_iso, converted to local)
   - Distance (calculated from tech location + geo_lat/lng)
5. Tech clicks "Details" button
6. Portal calls `showOfferDetails(job)` or `showJobDetails(job)`
7. Modal populated with:
   - Title: job.service_name
   - Payout: $metadata.estimated_payout
   - Date: formatted from start_iso
   - Address: service_address, city, state zip
   - Customer: customer_name + customer_phone (click-to-call)
   - Resources: built from metadata.items_json line items

**Data Read:**
- h2s_dispatch_jobs (all fields)
- h2s_dispatch_job_assignments (for filtering)

**Rendered:**
- Job cards in 3 sections (offers, upcoming, completed)
- Job details modal with full information

---

### Step 6: Customer Uploads Photos (NOT IMPLEMENTED)
**Current Status:** ❌ No photo upload during checkout or after

**Intended Flow (Not Built):**
1. Customer lands on "upload photos" page after scheduling
2. Customer selects photos from device
3. POST to `/api/upload-customer-photos` with:
   ```json
   {
     "order_id": "uuid",
     "photos": ["base64_image_1", "base64_image_2"]
   }
   ```
4. Backend stores photos in Supabase Storage:
   - Bucket: `customer-photos`
   - Path: `{job_id}/{timestamp}-{index}.jpg`
5. Backend creates photo records:
   - Table: `h2s_customer_photos` (doesn't exist)
   - Fields: photo_id, job_id, storage_url, uploaded_at
6. Backend updates h2s_dispatch_jobs.photo_count

**Where It Would Be Stored:**
- Supabase Storage bucket (not created yet)
- Database table to link photo_id → job_id (doesn't exist)

**How It Would Be Linked:**
- job_id foreign key
- Each photo has unique photo_id
- Array of photo URLs in job metadata (alternative approach)

---

### Step 7: Tech Views Customer Photos (NOT IMPLEMENTED)
**Current Status:** ❌ Portal does not display customer photos

**Intended Flow (Not Built):**
1. Portal fetches job details
2. Portal calls `/api/job-photos?job_id=xxx`
3. Backend returns:
   ```json
   {
     "customer_photos": [
       {photo_id, storage_url, uploaded_at},
       ...
     ]
   }
   ```
4. Portal renders photo gallery in job modal:
   - Thumbnails with tap-to-expand
   - Label: "Customer Photos (3)"
   - Lightbox for full-size view

---

### Step 8: Tech Uploads Completion Photos + Signature
**Current Status:** ⚠️ Partially implemented, needs verification

**Process (As Understood):**
1. Tech clicks "Mark Complete" in portal
2. Portal prompts for signature (canvas element exists: id="sig")
3. Tech draws signature
4. Portal prompts for completion photos (not confirmed if built)
5. POST to `/api/portal_mark_done` or similar with:
   ```json
   {
     "job_id": "uuid",
     "signature": "base64_image",
     "photos": ["base64_image_1", "base64_image_2"]
   }
   ```
6. Backend stores completion assets
7. Backend updates h2s_dispatch_jobs:
   - status = 'completed'
   - completed_at = now()
   - signature_on_file = true
   - photo_on_file = true
   - photo_count = N

**Where Stored:**
- ⚠️ Supabase Storage (bucket needs confirmation)
- ⚠️ Database table linking completion_photo_id → job_id

**AI Analysis Placeholder:**
- Future: Run image analysis on completion photos
- Detect: equipment installed, cable management quality, mounting level
- Flag: quality issues for review
- Score: installation quality 1-10
- **Not implemented yet**

---

## 6. Known Pain Points

### Confirmed Issues (From Live Testing)

**1. Job Details Sometimes Minimal**
- ✅ **FIXED** (Dec 30, 2025): Portal modal .kv section had inline `display:none`
- Root Cause: Unknown JS was hiding customer detail section
- Fix: Force `.kv` section to `display:grid` in showOfferDetails()
- Status: Working now, customer name/phone/address visible

**2. dispatch.html Not Showing Correct Detail**
- ⚠️ **NOT VERIFIED:** Need to inspect dispatch.html code
- Likely Issue: May not call enrichServiceName() to parse items_json
- Likely Issue: May not access metadata.estimated_payout
- Status: Needs investigation

**3. Customer Photos Not Visible to Tech**
- ❌ **NOT IMPLEMENTED:** No photo upload in checkout flow
- ❌ **NOT IMPLEMENTED:** No photo storage system
- ❌ **NOT IMPLEMENTED:** No photo display in portal
- Status: Entire feature missing

**4. Service Detail Clarity (Camera Jobs)**
- ⚠️ **VAGUE:** "Full Perimeter" doesn't tell tech camera count or coverage
- Issue: items_json has bundle name but not install specifics
- Issue: No structured fields for equipment, mounting, wire routing
- Status: Needs metadata collection + display enhancement

**5. Date/Time Display Inconsistency**
- ⚠️ **POTENTIAL ISSUE:** Portal converts to browser timezone, not ET
- Issue: No explicit timezone shown to tech
- Issue: Different views may show different times
- Status: Needs consistent ET formatting

**6. No Completion Photo System**
- ⚠️ **UNCLEAR:** Boolean flags exist but storage system not verified
- Issue: Portal has signature canvas but photo upload flow unknown
- Issue: No display of completion photos in admin view
- Status: Needs investigation + potential build-out

**7. Missing Equipment Mode**
- ❌ **NOT TRACKED:** System doesn't record if we're providing cameras or customer is
- Impact: Tech arrives not knowing what to bring
- Status: Needs metadata field + checkout collection

---

## 7. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                      CUSTOMER FLOW                            │
└──────────────────────────────────────────────────────────────┘

bundles.html                  Stripe Checkout
     │                              │
     │ POST /api/shop              │
     ├─────────────────────────────▶
     │                              │
     │                        Payment Success
     │                              │
     │                              ▼
     │                    POST /api/schedule-appointment
     │                              │
     │                              ▼
     │                      ┌────────────────┐
     │                      │  h2s_orders    │
     │                      │  h2s_dispatch  │
     │                      │     _jobs      │
     │                      └────────────────┘
     │
     ▼
[Order Confirmation Page]


┌──────────────────────────────────────────────────────────────┐
│                    TECHNICIAN FLOW                            │
└──────────────────────────────────────────────────────────────┘

portal.html
     │
     │ GET /api/portal_jobs?token=xxx
     ├─────────────────────────────▶
     │
     │ ◀─── {offers, upcoming, completed}
     │
     ├─── enrichServiceName() (client-side)
     │    └─── Parses metadata.items_json
     │         Builds: "Full Perimeter" from bundle data
     │
     ├─── Render Job Cards
     │    - Service name (enriched)
     │    - Payout (metadata.estimated_payout)
     │    - Time (start_iso → local)
     │    - Distance (calculated)
     │
     ├─── Click "Details"
     │    └─── showOfferDetails(job)
     │         - Populate modal
     │         - Display customer info
     │         - Show resources
     │
     ├─── Click "Accept"
     │    └─── POST /api/portal_accept
     │         - Create assignment
     │         - Update job status
     │
     └─── Click "Mark Complete"
          └─── POST /api/portal_mark_done
               - Upload signature
               - Upload photos (?)
               - Update status → completed


┌──────────────────────────────────────────────────────────────┐
│                     ADMIN/DISPATCH FLOW                       │
└──────────────────────────────────────────────────────────────┘

dispatch.html
     │
     │ [Data Source Unknown - Needs Inspection]
     │
     └─── Display jobs
          - Possibly direct Supabase query
          - Possibly /api endpoint
          - Status: Not verified in conversation
```

---

## 8. API Endpoints Reference

### `/api/shop` (POST)
**Purpose:** Create order during checkout  
**Auth:** None (public endpoint)  
**Input:**
```json
{
  "cart": [{id, qty, price}],
  "customer": {name, email, phone},
  "address": {street, city, state, zip},
  "source": "shop_rebuilt"
}
```
**Output:**
```json
{
  "ok": true,
  "session_url": "https://checkout.stripe.com/...",
  "order_id": "uuid"
}
```
**Side Effects:**
- Creates h2s_orders record
- Creates Stripe checkout session

---

### `/api/schedule-appointment` (POST)
**Purpose:** Create dispatch job after scheduling  
**Auth:** None (uses order_id for auth)  
**Input:**
```json
{
  "order_id": "uuid",
  "delivery_date": "2025-12-31",
  "delivery_time": "5:00 PM - 8:00 PM"
}
```
**Output:**
```json
{
  "ok": true,
  "job_id": "uuid",
  "order_was_scheduled": true
}
```
**Side Effects:**
- Creates h2s_dispatch_jobs record
- Updates h2s_orders.scheduled_date
- Geocodes address → geo_lat/lng

---

### `/api/portal_jobs` (GET)
**Purpose:** Fetch jobs for technician  
**Auth:** JWT token (pro_id extracted)  
**Input:**
```
?token=xxx
&job_id=xxx (optional, fetch single job)
```
**Output:**
```json
{
  "ok": true,
  "offers": [...unassigned jobs],
  "upcoming": [...tech's accepted jobs],
  "completed": [...tech's finished jobs]
}
```
**Processing:**
- Queries h2s_dispatch_jobs
- Joins h2s_dispatch_job_assignments
- Filters by pro_id from token
- Calls enrichServiceName() for each job (server-side)
- Returns categorized job lists

---

### `/api/portal_accept` (POST)
**Purpose:** Tech accepts an offer  
**Auth:** JWT token  
**Input:**
```json
{
  "token": "xxx",
  "job_id": "uuid"
}
```
**Output:**
```json
{
  "ok": true,
  "is_team_job": false
}
```
**Side Effects:**
- Creates h2s_dispatch_job_assignments
- Updates h2s_dispatch_jobs.status = 'accepted'

---

### `/api/portal_mark_done` (POST)
**Purpose:** Mark job complete  
**Auth:** JWT token  
**Input:**
```json
{
  "token": "xxx",
  "job_id": "uuid",
  "signature": "base64_image",
  "photos": ["base64_image_1"]
}
```
**Output:**
```json
{
  "ok": true,
  "job_id": "uuid"
}
```
**Side Effects:**
- Updates h2s_dispatch_jobs:
  - status = 'completed'
  - completed_at = now()
  - signature_on_file = true
  - photo_on_file = true
  - photo_count = N

---

## 9. Next Steps (Based on This Map)

### Immediate Priorities
1. **Camera Job Clarity:** Add structured metadata collection + display
2. **Customer Photo System:** Build upload → storage → display pipeline
3. **DateTime Consistency:** Standardize to "Dec 31 at 5:00 PM ET" everywhere
4. **dispatch.html Audit:** Verify what it shows, fix inconsistencies
5. **Completion Photo System:** Verify storage, build admin view

### Not Urgent
- AI image analysis (placeholder only)
- Multi-timezone support (all current jobs in ET)
- Advanced resource tracking

---

## 10. Document Maintenance

**Update Triggers:**
- Database schema changes (new tables/columns)
- New API endpoints added
- Frontend UI changes (new pages/modals)
- Data flow modifications

**Owner:** Engineering team  
**Review Frequency:** After each major feature deployment  
**Last Reviewed:** December 30, 2025
