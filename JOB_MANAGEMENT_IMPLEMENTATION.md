# Home2Smart Job Management System - Implementation Plan

## Executive Summary
This document maps your **existing working systems** to the comprehensive job management standard. We're NOT rebuilding - we're **extending and standardizing** what already works.

---

## Current State Analysis

### ✅ What You Already Have (Working)

#### 1. **Database Tables** (Supabase)
```
h2s_dispatch_jobs          - Main job records
h2s_dispatch_job_assignments - Tech assignments
h2s_dispatch_job_lines     - Payout line items
h2s_dispatch_customers     - Customer profiles
h2s_dispatch_pros          - Tech profiles
h2s_payouts_ledger         - Payout tracking
h2s_orders                 - Purchase records
```

#### 2. **Job Creation Flow** (Working)
- `stripe_webhook.js` - Auto-creates jobs from purchases ✅
- `schedule-appointment.js` - Adds scheduling + creates jobs ✅
- `create_jobs_from_orders.js` - Batch job creation ✅

#### 3. **Dispatch Portal** (`dispatch.html`)
- Job cards with status
- Analytics dashboard
- Payout approval
- Tech assignment
- Job detail modal

#### 4. **API Endpoints** (route.ts + backend/*.js)
- `/admin_jobs_list` - Get all jobs
- `/admin_job_get` - Get job details
- `/admin_dispatch` - Assign techs
- `/admin_update_status` - Change job status
- `/admin_approve_payout` - Process payments

#### 5. **Current Job Schema** (from code)
```typescript
{
  job_id: string (UUID)
  status: string
  customer_name: string
  customer_email: string
  customer_phone: string
  service_id: string
  service_name: string
  service_address: string
  service_city: string
  service_state: string
  service_zip: string
  assigned_pro_id: string | null
  assigned_pro_name: string | null
  start_iso: string | null
  end_iso: string | null
  notes_from_customer: string | null
  resources_needed: string | null
  variant_code: string
  geo_lat: string | null
  geo_lng: string | null
  metadata: {
    order_id: string
    estimated_payout: number
    items_json: array
    source: string
    // ...extensible
  }
  created_at: string
  updated_at: string
  completed_at: string | null
}
```

---

## Gap Analysis: What's Missing

| Feature | Current State | Needed Action |
|---------|--------------|---------------|
| **Wire Management Level** | ❌ Not tracked | Add to metadata |
| **Wall Type** | ❌ Not tracked | Add to metadata |
| **Equipment Lane** | ❌ Not tracked | Add to metadata |
| **Order Plan** | ❌ Not structured | Add to metadata |
| **Pain Flags** | ❌ Not tracked | Add to metadata |
| **Audit Log** | ❌ Not tracked | New table or metadata array |
| **Status Guards** | ❌ Not enforced | Add to API logic |
| **Ordering Stage** | ❌ Not tracked | Add to metadata |

**Key Insight:** We can add ALL missing features through `metadata` field without schema changes!

---

## Implementation Plan (Phased)

### Phase 1: Extend Metadata Schema (NO DB MIGRATION)
**Goal:** Add standardized fields to existing `metadata` JSON column

#### 1.1 Define Extended Metadata Structure
```typescript
// File: backend/lib/jobMetadataSchema.ts
interface JobMetadataV2 {
  // EXISTING (keep these)
  order_id: string;
  estimated_payout: number;
  items_json: any[];
  source: string;
  
  // NEW DETAIL FIELDS
  wire_management_required?: 'UNKNOWN' | 'NONE' | 'BASIC_CONCEAL' | 'FULL_INWALL' | 'CONCEAL_RACEWAY';
  wall_type?: 'UNKNOWN' | 'DRYWALL' | 'BRICK' | 'PLASTER' | 'TILE' | 'CONCRETE' | 'WOOD';
  mounting_surface_notes?: string;
  special_constraints?: string[]; // ['RENTER', 'HOA', 'NO_DRILLING']
  customer_priority_notes?: string;
  
  // EQUIPMENT & ORDERING
  equipment_lane?: 'BYO' | 'COMPANY_SUPPLIED' | 'HYBRID';
  order_required?: boolean;
  order_stage?: 'NOT_NEEDED' | 'PENDING_REVIEW' | 'READY_TO_ORDER' | 'ORDERED' | 'SHIPPED' | 'DELIVERED';
  order_plan?: {
    kit_type: string;
    components: Array<{
      sku: string;
      name: string;
      quantity: number;
      unit_cost: number;
      vendor: string;
      reason: string;
    }>;
    total_cost_estimate: number;
    vendor: string;
    notes: string;
    created_at: string;
    created_by: string;
  };
  
  // PAIN FLAGS
  pain_flags?: Array<{
    flag: 'WIRE_MANAGEMENT_UNKNOWN' | 'WALL_TYPE_UNKNOWN' | 'CUSTOMER_EXPECTATION_RISK' | 'ORDERING_AMBIGUOUS' | 'SCOPE_MISMATCH' | 'TEAM_REQUIRED_UNCONFIRMED' | 'ACCESS_DETAILS_MISSING' | 'SCHEDULE_CONFLICT';
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    message: string;
    added_at: string;
    resolved_at?: string;
  }>;
  
  // AUDIT LOG (Alternative: separate table)
  audit_log?: Array<{
    timestamp: string;
    user_id: string;
    user_name: string;
    action: string;
    field?: string;
    old_value?: any;
    new_value?: any;
    notes?: string;
  }>;
}
```

**Action:** Create this file and use it for type checking across your backend.

---

#### 1.2 Update Job Creation Logic
**Files to modify:**
1. `stripe_webhook.js` - Add default metadata on job creation
2. `schedule-appointment.js` - Same
3. `create_jobs_from_orders.js` - Same

**Example Change:**
```javascript
// In stripe_webhook.js (around line 240)
const jobData = {
  status: 'pending',
  service_id: serviceIdText,
  // ... existing fields ...
  metadata: {
    // EXISTING
    source: 'stripe_webhook',
    estimated_payout: estimatedPayout,
    order_id: orderId,
    stripe_session_id: session.id,
    
    // NEW DEFAULTS
    wire_management_required: 'UNKNOWN',
    wall_type: 'UNKNOWN',
    equipment_lane: determineEquipmentLane(parsedItems), // Helper function
    order_required: requiresOrdering(parsedItems), // Helper function
    order_stage: 'PENDING_REVIEW',
    pain_flags: [],
    audit_log: [{
      timestamp: new Date().toISOString(),
      user_id: 'system',
      user_name: 'System',
      action: 'job_created',
      notes: 'Created from purchase completion'
    }]
  }
};
```

**Helper Functions:**
```javascript
// backend/lib/jobHelpers.js
export function determineEquipmentLane(items) {
  const hasBYO = items.some(item => 
    item.metadata?.mount_type === 'customer_provided' ||
    item.metadata?.mount_provider === 'customer'
  );
  
  const hasCompanySupplied = items.some(item =>
    item.metadata?.mount_type && item.metadata?.mount_type !== 'customer_provided'
  );
  
  if (hasBYO && hasCompanySupplied) return 'HYBRID';
  if (hasBYO) return 'BYO';
  return 'COMPANY_SUPPLIED';
}

export function requiresOrdering(items) {
  return items.some(item => 
    item.metadata?.mount_type && 
    item.metadata?.mount_type !== 'customer_provided'
  );
}

export function evaluatePainFlags(job) {
  const flags = [];
  
  if (job.metadata?.wire_management_required === 'UNKNOWN') {
    flags.push({
      flag: 'WIRE_MANAGEMENT_UNKNOWN',
      severity: 'HIGH',
      message: 'Wire management level not determined',
      added_at: new Date().toISOString()
    });
  }
  
  if (job.metadata?.wall_type === 'UNKNOWN') {
    flags.push({
      flag: 'WALL_TYPE_UNKNOWN',
      severity: 'MEDIUM',
      message: 'Wall type not confirmed',
      added_at: new Date().toISOString()
    });
  }
  
  if (job.metadata?.order_required && !job.metadata?.order_plan) {
    flags.push({
      flag: 'ORDERING_AMBIGUOUS',
      severity: 'HIGH',
      message: 'Ordering required but no order plan created',
      added_at: new Date().toISOString()
    });
  }
  
  return flags;
}
```

---

### Phase 2: Update Dispatch Portal UI

#### 2.1 Add Pain Flag Indicators to Job Cards
**File:** `dispatch.html` (around line 1738)

**Current:**
```html
<div class="job-card" onclick="openJobModal('${job.job_id}')">
  <div class="job-header">
    <span class="job-id">${job.job_id}</span>
    <span class="job-status status-${job.status}">${job.status}</span>
  </div>
  <!-- ... -->
</div>
```

**Updated:**
```html
<div class="job-card" onclick="openJobModal('${job.job_id}')">
  <div class="job-header">
    <span class="job-id">${job.job_id}</span>
    <span class="job-status status-${job.status}">${job.status}</span>
    ${job.metadata?.pain_flags?.length > 0 ? `
      <span class="pain-flag-badge" title="${job.metadata.pain_flags.length} active flags">
        ⚠️ ${job.metadata.pain_flags.length}
      </span>
    ` : ''}
  </div>
  <!-- ... -->
  ${job.metadata?.equipment_lane ? `
    <div class="meta-row">
      <svg class="meta-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path>
      </svg>
      <span class="equipment-badge equipment-${job.metadata.equipment_lane.toLowerCase()}">
        ${job.metadata.equipment_lane === 'BYO' ? '🏠 Customer Mounts' : 
          job.metadata.equipment_lane === 'COMPANY_SUPPLIED' ? '📦 H2S Supplies' : 
          '🔀 Hybrid'}
      </span>
    </div>
  ` : ''}
</div>
```

**Add CSS:**
```css
.pain-flag-badge {
  background: #fbbf24;
  color: #78350f;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 700;
  margin-left: 8px;
}

.equipment-badge {
  font-size: 13px;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 6px;
}

.equipment-byo {
  background: #d1fae5;
  color: #065f46;
}

.equipment-company_supplied {
  background: #dbeafe;
  color: #1e40af;
}

.equipment-hybrid {
  background: #fef3c7;
  color: #92400e;
}
```

---

#### 2.2 Enhance Job Detail Modal
**File:** `dispatch.html` (around line 1800-2000)

Add new sections to modal:

```javascript
// After existing job detail sections
let painFlagsHTML = '';
if (job.metadata?.pain_flags?.length > 0) {
  painFlagsHTML = `
    <div class="modal-section pain-flags-section">
      <h4 style="margin:0 0 12px 0; color:#f59e0b; font-weight:800; display:flex; align-items:center; gap:8px;">
        <span>⚠️ ATTENTION REQUIRED</span>
        <span style="background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:4px; font-size:11px;">
          ${job.metadata.pain_flags.length} FLAG${job.metadata.pain_flags.length > 1 ? 'S' : ''}
        </span>
      </h4>
      ${job.metadata.pain_flags.map(flag => `
        <div class="pain-flag-item severity-${flag.severity.toLowerCase()}">
          <div class="flag-header">
            <span class="flag-icon">${
              flag.severity === 'CRITICAL' ? '🔴' :
              flag.severity === 'HIGH' ? '🟡' :
              flag.severity === 'MEDIUM' ? '🔵' : '⚪'
            }</span>
            <span class="flag-type">${flag.flag.replace(/_/g, ' ')}</span>
          </div>
          <div class="flag-message">${flag.message}</div>
          <button class="btn-sm" onclick="resolvePainFlag('${job.job_id}', '${flag.flag}')">
            Resolve
          </button>
        </div>
      `).join('')}
    </div>
  `;
}

let equipmentHTML = '';
if (job.metadata?.equipment_lane) {
  equipmentHTML = `
    <div class="modal-section">
      <h4 style="margin:0 0 12px 0; color:var(--brand-azure); font-weight:800;">Equipment & Ordering</h4>
      <div class="detail-grid">
        <div class="detail-row">
          <span class="detail-label">Equipment Lane:</span>
          <span class="detail-value">
            <span class="equipment-badge equipment-${job.metadata.equipment_lane.toLowerCase()}">
              ${job.metadata.equipment_lane}
            </span>
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Order Required:</span>
          <span class="detail-value">${job.metadata.order_required ? '✅ YES' : '❌ NO'}</span>
        </div>
        ${job.metadata.order_required ? `
          <div class="detail-row">
            <span class="detail-label">Order Stage:</span>
            <span class="detail-value">
              <span class="order-stage-badge stage-${job.metadata.order_stage?.toLowerCase()}">
                ${job.metadata.order_stage || 'PENDING_REVIEW'}
              </span>
            </span>
          </div>
        ` : ''}
        ${job.metadata.order_plan ? `
          <div class="detail-row">
            <span class="detail-label">Kit Type:</span>
            <span class="detail-value">${job.metadata.order_plan.kit_type}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">Estimated Cost:</span>
            <span class="detail-value">$${(job.metadata.order_plan.total_cost_estimate / 100).toFixed(2)}</span>
          </div>
          <div class="detail-row full-width">
            <span class="detail-label">Components:</span>
            <div class="components-list">
              ${job.metadata.order_plan.components.map(comp => `
                <div class="component-item">
                  <span>${comp.quantity}x ${comp.name}</span>
                  <span class="component-price">$${(comp.unit_cost * comp.quantity / 100).toFixed(2)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
      ${job.metadata.order_required && !job.metadata.order_plan ? `
        <button class="btn btn-primary" onclick="generateOrderPlan('${job.job_id}')">
          Generate Order Plan
        </button>
      ` : ''}
    </div>
  `;
}

let installDetailsHTML = '';
if (job.metadata?.wire_management_required || job.metadata?.wall_type) {
  installDetailsHTML = `
    <div class="modal-section">
      <h4 style="margin:0 0 12px 0; color:var(--brand-azure); font-weight:800;">Installation Details</h4>
      <div class="detail-grid">
        <div class="detail-row">
          <span class="detail-label">Wire Management:</span>
          <span class="detail-value ${job.metadata.wire_management_required === 'UNKNOWN' ? 'warning-text' : ''}">
            ${job.metadata.wire_management_required?.replace(/_/g, ' ') || 'UNKNOWN'}
          </span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Wall Type:</span>
          <span class="detail-value ${job.metadata.wall_type === 'UNKNOWN' ? 'warning-text' : ''}">
            ${job.metadata.wall_type || 'UNKNOWN'}
          </span>
        </div>
        ${job.metadata.mounting_surface_notes ? `
          <div class="detail-row full-width">
            <span class="detail-label">Surface Notes:</span>
            <span class="detail-value">${job.metadata.mounting_surface_notes}</span>
          </div>
        ` : ''}
        ${job.metadata.special_constraints?.length > 0 ? `
          <div class="detail-row full-width">
            <span class="detail-label">Constraints:</span>
            <div class="constraints-list">
              ${job.metadata.special_constraints.map(c => `
                <span class="constraint-tag">${c}</span>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
      <button class="btn-sm" onclick="updateInstallDetails('${job.job_id}')">
        Update Details
      </button>
    </div>
  `;
}
```

**Add to modal HTML:**
```javascript
modalContent.innerHTML = `
  <div class="modal-header">
    <h3>Job Details: ${job.job_id}</h3>
    <button class="close-btn" onclick="closeModal()">&times;</button>
  </div>
  <div class="modal-body">
    ${painFlagsHTML}
    <!-- Existing sections -->
    ${equipmentHTML}
    ${installDetailsHTML}
    <!-- Rest of modal -->
  </div>
`;
```

---

### Phase 3: Add API Endpoints for New Features

#### 3.1 Pain Flag Resolution
**File:** `backend/app/api/resolve_pain_flag/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { job_id, flag, resolution_notes } = body;
    
    const supabase = getSupabaseDispatch();
    
    // Get current job
    const { data: job } = await supabase
      .from('h2s_dispatch_jobs')
      .select('metadata')
      .eq('job_id', job_id)
      .single();
    
    const metadata = job?.metadata || {};
    const painFlags = metadata.pain_flags || [];
    
    // Mark flag as resolved
    const updated Flags = painFlags.map(f => 
      f.flag === flag 
        ? { ...f, resolved_at: new Date().toISOString(), resolution_notes }
        : f
    );
    
    // Add audit entry
    const auditLog = metadata.audit_log || [];
    auditLog.push({
      timestamp: new Date().toISOString(),
      user_id: 'admin', // Replace with actual user from session
      user_name: 'Admin',
      action: 'pain_flag_resolved',
      field: 'pain_flags',
      old_value: flag,
      new_value: 'resolved',
      notes: resolution_notes
    });
    
    // Update job
    await supabase
      .from('h2s_dispatch_jobs')
      .update({
        metadata: {
          ...metadata,
          pain_flags: updatedFlags,
          audit_log: auditLog
        },
        updated_at: new Date().toISOString()
      })
      .eq('job_id', job_id);
    
    return NextResponse.json({ ok: true }, { headers: corsHeaders() });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers: corsHeaders() }
    );
  }
}
```

#### 3.2 Generate Order Plan
**File:** `backend/app/api/generate_order_plan/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { job_id } = body;
    
    const supabase = getSupabaseDispatch();
    
    const { data: job } = await supabase
      .from('h2s_dispatch_jobs')
      .select('*')
      .eq('job_id', job_id)
      .single();
    
    const metadata = job?.metadata || {};
    const items = metadata.items_json || [];
    
    // Generate order plan based on items
    const components = [];
    let total = 0;
    
    for (const item of items) {
      if (item.metadata?.mount_type && item.metadata?.mount_type !== 'customer_provided') {
        const mountCost = {
          fixed: 3500,
          tilt: 5000,
          full_motion: 8500
        }[item.metadata.mount_type] || 3500;
        
        components.push({
          sku: `MOUNT-${item.metadata.mount_type.toUpperCase()}-${item.metadata.tv_size}`,
          name: `${item.metadata.mount_type} mount for ${item.metadata.tv_size}" TV`,
          quantity: item.quantity || 1,
          unit_cost: mountCost,
          vendor: 'Amazon',
          reason: `Mount for ${item.service_name || 'TV'}`
        });
        
        total += mountCost * (item.quantity || 1);
      }
    }
    
    // Add wire management components
    if (metadata.wire_management_required === 'CONCEAL_RACEWAY') {
      components.push({
        sku: 'RACEWAY-KIT-STD',
        name: 'Raceway concealment kit',
        quantity: 1,
        unit_cost: 2500,
        vendor: 'Internal Stock',
        reason: 'Wire concealment via raceway'
      });
      total += 2500;
    } else if (metadata.wire_management_required === 'FULL_INWALL') {
      components.push({
        sku: 'INWALL-KIT-PRO',
        name: 'In-wall wire fishing kit',
        quantity: 1,
        unit_cost: 4500,
        vendor: 'Internal Stock',
        reason: 'Full in-wall wire routing'
      });
      total += 4500;
    }
    
    const orderPlan = {
      kit_type: determineKitType(job, metadata),
      components,
      total_cost_estimate: total,
      vendor: components[0]?.vendor || 'TBD',
      notes: `Auto-generated for ${job.service_name || 'service'}`,
      created_at: new Date().toISOString(),
      created_by: 'system'
    };
    
    // Update job
    await supabase
      .from('h2s_dispatch_jobs')
      .update({
        metadata: {
          ...metadata,
          order_plan: orderPlan,
          order_stage: 'READY_TO_ORDER'
        },
        updated_at: new Date().toISOString()
      })
      .eq('job_id', job_id);
    
    return NextResponse.json({ ok: true, order_plan: orderPlan }, { headers: corsHeaders() });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers: corsHeaders() }
    );
  }
}

function determineKitType(job: any, metadata: any): string {
  if (job.service_name?.toLowerCase().includes('tv')) {
    return metadata.wire_management_required === 'FULL_INWALL'
      ? 'PREMIUM_TV_KIT'
      : 'STANDARD_TV_KIT';
  }
  if (job.service_name?.toLowerCase().includes('camera')) {
    return 'STANDARD_CAMERA_KIT';
  }
  return 'CUSTOM_KIT';
}
```

#### 3.3 Update Install Details
**File:** `backend/app/api/update_install_details/route.ts`

```typescript
import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';
import { evaluatePainFlags } from '@/lib/jobHelpers';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { job_id, wire_management_required, wall_type, mounting_surface_notes, special_constraints } = body;
    
    const supabase = getSupabaseDispatch();
    
    const { data: job } = await supabase
      .from('h2s_dispatch_jobs')
      .select('metadata')
      .eq('job_id', job_id)
      .single();
    
    const metadata = job?.metadata || {};
    
    // Update fields
    const updatedMetadata = {
      ...metadata,
      wire_management_required,
      wall_type,
      mounting_surface_notes,
      special_constraints
    };
    
    // Re-evaluate pain flags after update
    const fullJob = { ...job, metadata: updatedMetadata };
    updatedMetadata.pain_flags = evaluatePainFlags(fullJob);
    
    // Add audit entry
    const auditLog = metadata.audit_log || [];
    auditLog.push({
      timestamp: new Date().toISOString(),
      user_id: 'admin',
      user_name: 'Admin',
      action: 'install_details_updated',
      notes: 'Updated wire management, wall type, and constraints'
    });
    updatedMetadata.audit_log = auditLog;
    
    // Update job
    await supabase
      .from('h2s_dispatch_jobs')
      .update({
        metadata: updatedMetadata,
        updated_at: new Date().toISOString()
      })
      .eq('job_id', job_id);
    
    return NextResponse.json({ ok: true }, { headers: corsHeaders() });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers: corsHeaders() }
    );
  }
}
```

---

### Phase 4: Status Transition Guards

#### 4.1 Enforce Status Rules
**File:** `backend/app/api/admin_update_status/route.ts` (modify existing)

```typescript
// Add guard functions at top
function canTransitionTo(job: any, newStatus: string): { ok: boolean; error?: string } {
  const currentStatus = job.status;
  const metadata = job.metadata || {};
  
  // Define allowed transitions
  const validTransitions: Record<string, string[]> = {
    'pending': ['pending_scheduling', 'accepted', 'cancelled'],
    'pending_scheduling': ['accepted', 'scheduled', 'cancelled'],
    'accepted': ['scheduled', 'in_progress', 'cancelled'],
    'scheduled': ['in_progress', 'cancelled'],
    'in_progress': ['completed', 'cancelled'],
    'completed': ['paid'],
    'paid': [],
    'cancelled': []
  };
  
  if (!validTransitions[currentStatus]?.includes(newStatus)) {
    return { ok: false, error: `Cannot transition from ${currentStatus} to ${newStatus}` };
  }
  
  // Special guards for specific transitions
  if (newStatus === 'in_progress') {
    if (!job.assigned_pro_id) {
      return { ok: false, error: 'Job must be assigned to a tech before starting' };
    }
    
    if (metadata.order_required && metadata.order_stage !== 'DELIVERED') {
      return { ok: false, error: 'Equipment must be delivered before starting job' };
    }
  }
  
  if (newStatus === 'completed') {
    const criticalFlags = metadata.pain_flags?.filter((f: any) => f.severity === 'CRITICAL' && !f.resolved_at);
    if (criticalFlags?.length > 0) {
      return { ok: false, error: 'Cannot complete job with unresolved critical pain flags' };
    }
  }
  
  return { ok: true };
}

// In main handler, before updating:
const { data: job } = await supabase
  .from('h2s_dispatch_jobs')
  .select('*')
  .eq('job_id', job_id)
  .single();

const canTransition = canTransitionTo(job, status);
if (!canTransition.ok) {
  return res.status(400).json({ ok: false, error: canTransition.error });
}

// Add audit entry
const metadata = job.metadata || {};
const auditLog = metadata.audit_log || [];
auditLog.push({
  timestamp: new Date().toISOString(),
  user_id: req.body.admin_user || 'admin',
  user_name: req.body.admin_name || 'Admin',
  action: 'status_changed',
  field: 'status',
  old_value: job.status,
  new_value: status,
  notes: req.body.notes || null
});

// Update with audit
const { error } = await supabase
  .from('h2s_dispatch_jobs')
  .update({ 
    status: status,
    updated_at: new Date().toISOString(),
    metadata: { ...metadata, audit_log: auditLog }
  })
  .eq('job_id', job_id);
```

---

### Phase 5: Testing & Rollout

#### 5.1 Test Checklist
```
□ Create test job via Stripe webhook
  → Verify default metadata fields populated
  → Verify pain flags generated for UNKNOWN fields
  
□ Update install details via UI
  → Verify pain flags resolve automatically
  → Verify audit log entries created
  
□ Generate order plan
  → Verify components calculated correctly
  → Verify order stage updated
  
□ Try invalid status transition
  → Verify blocked with error message
  
□ Complete job with unresolved critical flag
  → Verify blocked
  
□ View job in dispatch portal
  → Verify pain flag badges show
  → Verify equipment lane shows
  → Verify order plan displays
```

#### 5.2 Rollout Steps
1. Deploy new API endpoints
2. Update dispatch.html with new UI
3. Update job creation logic with defaults
4. Test with real orders
5. Monitor for issues
6. Document for team

---

## Notification Integration (Twilio)

You mentioned Twilio is already integrated. Here's how to tie it in:

**File:** `backend/lib/notifications.ts`

```typescript
import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

export async function sendJobNotification(
  phone: string,
  jobId: string,
  message: string
): Promise<{ sent: boolean; error?: string }> {
  try {
    await client.messages.create({
      body: message,
      to: phone,
      from: process.env.TWILIO_PHONE_NUMBER
    });
    return { sent: true };
  } catch (error: any) {
    return { sent: false, error: error.message };
  }
}

export function buildJobAssignedMessage(job: any, techName: string): string {
  return `🔔 New Job Assigned!\n\nJob: ${job.service_name}\nCustomer: ${job.customer_name}\nAddress: ${job.service_address}\n\nView details in your portal.`;
}

export function buildJobCompletedMessage(job: any): string {
  return `✅ Job ${job.job_id} marked complete!\n\nPayout approval pending.`;
}
```

**Usage in admin_dispatch.js:**
```javascript
// After assigning tech
const notification = await sendJobNotification(
  pro.phone,
  job.job_id,
  buildJobAssignedMessage(job, pro.name)
);

return res.json({
  ok: true,
  message: 'Job assigned successfully',
  notification
});
```

---

## Summary: What We're Doing

### ✅ Keeping (No Changes)
- Existing database schema
- All current API endpoints
- Dispatch portal HTML structure
- Job creation flows
- Payout system

### ➕ Adding (Extensions)
- Metadata fields for new features
- Pain flag system
- Order plan generation
- Status transition guards
- Enhanced UI sections

### 🔧 Modifying (Improvements)
- Job creation logic (add default metadata)
- Status update API (add guards)
- Dispatch portal UI (add new sections)
- Admin endpoints (add audit logging)

---

## Next Steps

1. **Review this document** - Make sure it aligns with your vision
2. **Create helper files** - `jobMetadataSchema.ts`, `jobHelpers.js`, `notifications.ts`
3. **Update job creation** - Add default metadata to all 3 creation points
4. **Enhance dispatch.html** - Add pain flag UI, equipment section, install details
5. **Deploy API endpoints** - Roll out new routes
6. **Test thoroughly** - Use checklist above
7. **Monitor & iterate** - Fix issues as they arise

This approach **preserves everything you've built** while adding the standardization and features needed for scale.
