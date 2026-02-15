# H2S Data Contract - Bundles → Checkout → Portal

**Date:** 2026-01-09  
**Status:** ENFORCED  
**Backend:** backend-qvcj94ue3

---

## 1. Order Record Contract (h2s_orders table)

When a checkout session is created and completed, the system MUST store:

### Required Fields (NOT NULL)
```typescript
{
  order_id: string;           // Primary key, format: ORD-XXXXXXXX
  session_id: string;          // Stripe checkout session ID
  customer_name: string;       // From checkout form
  customer_email: string;      // From checkout form
  customer_phone: string;      // From checkout form
  total: number;               // Total in cents (e.g., 39900 = $399.00)
  status: string;              // 'pending' | 'completed' | 'cancelled'
  created_at: string;          // ISO 8601 timestamp
}
```

### Metadata (metadata_json JSONB)
```typescript
{
  // Customer Info
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  
  // Service Location
  service_address: string;     // MUST NOT be empty
  service_city: string;
  service_state: string;
  service_zip: string;
  geo_lat?: number;            // Optional but preferred
  geo_lng?: number;            // Optional but preferred
  
  // Cart Details
  items_json: Array<{
    id: string;
    name: string;
    quantity: number;
    price: number;              // In cents
    metadata: object;           // Equipment details (mount_type, camera_type, etc.)
  }>;
  
  // Data Completeness (ENFORCED)
  job_details_summary: string;  // NEVER empty - auto-generated from cart
  equipment_provided: string;   // NEVER "?" - from cart metadata or derived
  schedule_status: string;      // 'Scheduling Pending' | 'Scheduled'
  
  // Optional Schedule Info
  scheduled_date?: string;      // ISO 8601 if user selected date
  timezone?: string;            // IANA timezone (e.g., 'America/New_York')
  time_window?: string;         // e.g., "9am - 12pm"
  
  // Promo Code
  promo_code?: string;          // Applied promo code
  discount?: number;            // Discount amount in cents
  
  // Linked Records
  dispatch_job_id?: string;     // Link to h2s_dispatch_jobs.job_id
  dispatch_recipient_id?: string;
}
```

### Data Completeness Rules

**job_details_summary** format:
```
"[Service Name] (x[qty]) • Customer: [Name] • Location: [Address, City, State] • Promo: [Code] • [Free Items]"
```

Example:
```
"2-Camera Installation Bundle (x1) • Customer: John Doe • Location: 123 Main St, Columbia, SC • Promo: SAVE20"
```

**equipment_provided** must be one of:
- Specific equipment list: "Wall Mount, 2x Indoor Cameras, Power Cables"
- Derived from service: "Standard installation equipment"
- NEVER: "?", "Unknown", "" (empty string)

**schedule_status** must be one of:
- "Scheduling Pending" (default, before user selects date)
- "Scheduled" (after user confirms date/time)

---

## 2. Dispatch Job Contract (h2s_dispatch_jobs table)

When an order is created, a dispatch job MUST be created with:

### Required Fields (NOT NULL)
```typescript
{
  job_id: string;              // Primary key (UUID)
  status: string;              // 'queued' | 'scheduled' | 'assigned' | 'completed'
  created_at: string;          // ISO 8601 timestamp
  due_at: string;              // ISO 8601 timestamp
  recipient_id: string;        // FK to recipients table
  sequence_id: string;         // Workflow sequence
  step_id: string;             // Workflow step
  
  // CRITICAL: Portal Display Fields (ENFORCED)
  job_details: string;         // NEVER empty - same as order job_details_summary
  customer_name: string;       // NEVER empty - from order
  service_address: string;     // NEVER empty - from order
  service_city: string;
  service_state: string;
  service_zip: string;
  geo_lat?: number;            // For routing
  geo_lng?: number;            // For routing
}
```

### Metadata (metadata JSONB)
```typescript
{
  // Link to Order
  order_id: string;
  stripe_session_id: string;
  
  // Customer Contact
  customer_email: string;
  customer_phone: string;
  customer_name: string;
  
  // Service Location
  service_address: string;
  service_city: string;
  service_state: string;
  service_zip: string;
  
  // Cart Details
  items_json: Array<CartItem>;  // Full cart items with metadata
  
  // Data Completeness Fields (FROM ORDER)
  job_details_summary: string;
  equipment_provided: string;
  schedule_status: string;
  scheduled_date?: string;
  timezone?: string;
  time_window?: string;
  
  // Promo
  promo_code?: string;
  discount?: number;
  
  // Equipment Details (extracted from cart)
  mount_type?: string;
  tv_size?: string;
  camera_type?: string;
  wire_management_required?: string;
  wall_type?: string;
}
```

### Lifecycle States

```
queued → scheduled → assigned → in_progress → completed
                       ↓
                   cancelled
```

**Status Rules:**
- `queued`: Job created, awaiting scheduling
- `scheduled`: Customer selected date/time on success page
- `assigned`: Pro accepted the job
- `in_progress`: Pro started work
- `completed`: Job finished and verified

---

## 3. Portal Display Contract

### Jobs Tab - List View

Each job card MUST display without requiring a click:
```typescript
{
  title: string;               // Service name
  customer: string;            // Customer name
  address: string;             // Full address (street, city, state)
  status: string;              // Visual badge (queued/scheduled/etc.)
  scheduledDate?: string;      // If scheduled
  equipmentBadge: string;      // Equipment status indicator
}
```

### Jobs Tab - Modal View

Job modal MUST display complete details:
```typescript
{
  // Header
  title: string;
  status: string;
  jobId: string;
  
  // Customer Info
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  
  // Service Location
  serviceAddress: string;
  serviceCity: string;
  serviceState: string;
  serviceZip: string;
  mapLink: string;             // Google Maps link
  
  // Job Details Section
  jobDetails: string;          // NEVER "None specified"
  equipmentProvided: string;   // NEVER "?"
  scheduleStatus: string;
  scheduledDate?: string;
  timeWindow?: string;
  
  // Cart Items
  items: Array<{
    name: string;
    quantity: number;
    metadata: object;
  }>;
  
  // Optional
  customerPhotos?: string[];   // Can be empty array
  promoCode?: string;
  notes?: string;
}
```

### Pro Management Tab

Pro profile MUST display:
```typescript
{
  // Basic Info
  proId: string;
  name: string;
  email: string;
  phone: string;
  photoUrl?: string;
  
  // Location
  homeAddress: string;
  homeCity: string;
  homeState: string;
  homeZip: string;
  serviceRadius: number;       // In miles
  
  // Status
  isActive: boolean;
  isAvailableNow: boolean;
  status: string;              // 'active' | 'pending' | 'inactive'
  
  // Stats
  totalJobs: number;
  totalEarned: number;
  rating: number;
  
  // Vehicle
  vehicleMakeModel?: string;
  
  // Bio
  bioShort?: string;
}
```

### Business Intelligence Dashboard

Dashboard metrics MUST:
- Show real data or explicit "N/A"
- NEVER show "0" due to broken queries
- Include data source attribution

```typescript
{
  revenue: {
    total: number;             // Real data or null
    margin: number;
    completed_total: number;
    trend: Array<{date, total}>;
  };
  
  operations: {
    jobs_completed: number;
    jobs_pending: number;
    completion_rate: number;
    bottlenecks: Array<Job>;   // Jobs stuck in queued
  };
  
  workforce: {
    active_pros: number;       // Count where is_active=true
    utilization_rate: number;
  };
  
  growth: {
    mom_growth: number;
    this_month_jobs: number;
    repeat_rate: number;
    unique_customers: number;
  };
}
```

---

## 4. Server-Side Guards

### Order Creation Guard
```typescript
// backend/app/api/shop/route.ts
if (!jobDetailsSummary || jobDetailsSummary.trim() === '') {
  throw new Error('job_details_summary cannot be empty');
}

if (!equipmentProvided || equipmentProvided === '?') {
  throw new Error('equipment_provided must be specified');
}
```

### Dispatch Job Creation Guard
```typescript
// backend/app/api/shop/route.ts
const insertJob = {
  // ... required fields
  job_details: jobDetailsSummary || 'Service not specified', // Fallback
  customer_name: metadata.customer_name || 'Unknown Customer',
  service_address: metadata.service_address || 'Address Not Provided',
  // ...
};

// Validate before insert
if (!insertJob.job_details || insertJob.job_details === 'None specified') {
  console.error('[Guard] job_details is invalid:', insertJob.job_details);
  // Use fallback but log error
}
```

### Portal Query Guard
```typescript
// backend/app/api/portal_jobs/route.ts
jobs.forEach(job => {
  if (!job.job_details && job.metadata?.job_details_summary) {
    job.job_details = job.metadata.job_details_summary;
  }
  
  if (!job.job_details) {
    job.job_details = 'Details not available';
  }
  
  if (job.equipment_provided === '?') {
    job.equipment_provided = job.metadata?.equipment_provided || 'Not specified';
  }
});
```

---

## 5. Testing Requirements

### Checkout Reliability Test
```bash
node scripts/test_checkout_reliability.mjs
```

**Success Criteria:**
- 100% success rate (50/50 attempts)
- Average < 1000ms
- p95 < 1500ms

### End-to-End Data Flow Test
```bash
node scripts/test_end_to_end_flow.mjs
```

**Success Criteria:**
- ✅ Checkout session created
- ✅ Order record exists with all required fields
- ✅ Dispatch job exists with job_details and equipment_provided
- ✅ Portal would display complete data (no "None specified" or "?")

### Manual Portal Verification

1. Complete real checkout flow
2. Check dispatch portal
3. Verify job shows:
   - ✅ Complete job details
   - ✅ Equipment list (not "?")
   - ✅ Customer name and address
   - ✅ Schedule status

---

## 6. Enforcement Checklist

Before deployment, verify:

- [ ] `generateJobDetailsSummary()` always returns non-empty string
- [ ] `generateEquipmentProvided()` never returns "?" or empty
- [ ] Dispatch job creation includes all required fields
- [ ] Portal queries have fallback logic for missing fields
- [ ] Automated tests pass 100%
- [ ] Manual portal check confirms no blanks

---

## 7. Rollback Procedure

If data quality issues occur:

1. **Check test output:**
```bash
node scripts/test_end_to_end_flow.mjs
```

2. **Review logs:**
```bash
vercel logs backend-qvcj94ue3 --follow
```

3. **Rollback if needed:**
```bash
cd backend
vercel rollback backend-qvcj94ue3 --yes
```

4. **Fix and redeploy:**
- Update dataCompleteness.ts utilities
- Update shop/route.ts dispatch job creation
- Redeploy: `vercel --prod --yes`

---

## 8. Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-09 | Initial data contract |
| 1.1 | 2026-01-09 | Added dispatch job metadata fields |
| 1.2 | 2026-01-09 | Enforced server-side guards |

---

**Maintained by:** GitHub Copilot  
**System Owner:** Tabari Roper  
**Backend:** https://h2s-backend.vercel.app  
**Frontend:** https://shop.home2smart.com
