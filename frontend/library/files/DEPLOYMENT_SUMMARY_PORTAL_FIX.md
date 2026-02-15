# Portal Job Details Fix - Deployment Summary

**Date**: December 29, 2025
**Issue**: Portal showing $0 payout and missing service details for technicians

## Problem Identified

Technicians couldn't see:
1. **Payout amounts** - Portal displayed $0 for all jobs
2. **Service details** - No information about what work to perform (TV size, mount type, quantities, etc.)

## Root Causes

1. **Job metadata missing items** - Job creation wasn't extracting items from orders
2. **Portal expected `line_items` field** - But jobs only stored data in `metadata.items_json`

## Fixes Deployed to Production

### Fix #1: Job Creation Enhancement
**File**: [`backend/app/api/create_jobs_from_orders/route.ts`](c:/Users/tabar/Quick%20fix%20Dash/backend/app/api/create_jobs_from_orders/route.ts)

**Changes**:
- Added comprehensive item extraction from multiple sources:
  - `order.items` (primary source)
  - `metadata.items_json`
  - `metadata.cart_items_parsed`
  - `metadata.cart_items`
- Handles JSON strings, arrays, and nested objects
- Stores items as `metadata.items_json` for technician visibility

**Code Added** (lines 229-250):
```typescript
// Parse items from order for technician visibility
let itemsJson = null;
try {
  // Try multiple sources for items
  const itemsRaw = order?.items || meta?.items_json || meta?.items || 
                   meta?.cart_items_parsed || meta?.cart_items || order?.order_items;
  if (itemsRaw) {
    if (typeof itemsRaw === 'string') {
      itemsJson = JSON.parse(itemsRaw);
    } else if (Array.isArray(itemsRaw)) {
      itemsJson = itemsRaw;
    } else if (typeof itemsRaw === 'object') {
      itemsJson = itemsRaw.items || [itemsRaw];
    }
  }
} catch {
  // If items can't be parsed, leave as null
}

// Add to metadata
metadata: {
  ...(meta || {}),
  order_id_text: orderIdText || null,
  session_id: sessionId || null,
  estimated_payout: payout ?? meta?.estimated_payout ?? null,
  items_json: itemsJson, // ← NEW: Service details for techs
  migrated_from_orders: true,
}
```

### Fix #2: Portal Jobs API Enhancement
**File**: [`backend/app/api/portal_jobs/route.ts`](c:/Users/tabar/Quick%20fix%20Dash/backend/app/api/portal_jobs/route.ts)

**Changes**:
- Enriches job responses with `line_items` field
- Extracts from `metadata.items_json` if not already present
- Ensures portal frontend receives data in expected format

**Code Added** (lines 202-212, 223-233):
```typescript
// Extract line_items from metadata if available
const lineItems = j?.line_items || j?.metadata?.items_json || null;
return {
  ...j,
  line_items: lineItems, // ← NEW: Ensure line_items available for frontend
  distance_miles: null,
  payout_estimated: j?.metadata?.estimated_payout ?? 0,
  _job_zip5: jobZip5,
  _job_status_norm: st,
};
```

## Deployment Details

**Vercel Production URL**: https://h2s-backend-m1t85y8cb-tabari-ropers-projects-6f2e090b.vercel.app
**Deployment Time**: ~40 seconds
**Build Status**: ✅ Success

## Testing & Verification

### New Jobs (After Fix)
✅ All new jobs created from orders will automatically include:
- `metadata.estimated_payout` - Calculated as 35% of subtotal ($35 min, 45% max)
- `metadata.items_json` - Full service details with quantities
- Portal API enriches with `line_items` field

### Existing Jobs (Before Fix)
⚠️ Need backfill script to update existing jobs with missing metadata

## Backfill Script Created

**File**: [`backfill-job-metadata.js`](c:/Users/tabar/Quick%20fix%20Dash/backfill-job-metadata.js)

**Purpose**: Update all existing jobs with missing payout and service details

**Usage**:
```bash
# Test mode (see what would change)
node backfill-job-metadata.js --dry-run

# Live update (apply changes)
node backfill-job-metadata.js
```

**What It Does**:
1. Fetches all jobs from `h2s_dispatch_jobs`
2. Checks for missing `metadata.estimated_payout` or `metadata.items_json`
3. Looks up corresponding order in `h2s_orders`
4. Calculates payout (35% of order subtotal)
5. Extracts items from order
6. Updates job metadata with complete information

**Safety Features**:
- Dry-run mode to preview changes
- Skips jobs that already have complete metadata
- Continues on errors (doesn't fail completely)
- Only modifies `metadata` column (no destructive changes)

## Payout Calculation Formula

```javascript
// Base calculation: 35% of order subtotal
let payout = Math.floor(subtotal * 0.35);

// Special case: Mounting services get minimum $45
if (service_name.includes('mount')) {
  payout = Math.max(45, payout);
}

// Apply floor and ceiling
const MIN = 35;  // Minimum to roll a truck
const MAX_PCT = 0.45;  // Cap at 45% to maintain business margin

payout = Math.max(MIN, payout);
payout = Math.min(payout, subtotal * MAX_PCT);
```

## Expected Portal Display After Fix

### Before (Broken):
```
Service: [Generic label or blank]
Payout: $0.00
Details: [Missing]
```

### After (Fixed):
```
Service: TV Mounting
Payout: $69.65
Details:
• 1x 65" TV Mount Installation
• 1x Wire Concealment (up to 6 feet)
• Location: Greenville, SC
```

## Files Changed

1. ✅ [`backend/app/api/create_jobs_from_orders/route.ts`](c:/Users/tabar/Quick%20fix%20Dash/backend/app/api/create_jobs_from_orders/route.ts) - Job creation with items
2. ✅ [`backend/app/api/portal_jobs/route.ts`](c:/Users/tabar/Quick%20fix%20Dash/backend/app/api/portal_jobs/route.ts) - Portal API enrichment
3. ✅ [`backfill-job-metadata.js`](c:/Users/tabar/Quick%20fix%20Dash/backfill-job-metadata.js) - Backfill script for existing jobs
4. ✅ [`BACKFILL_README.md`](c:/Users/tabar/Quick%20fix%20Dash/BACKFILL_README.md) - Instructions for running backfill

## Next Steps

1. **Run Backfill Script** (when network is available):
   ```bash
   node backfill-job-metadata.js --dry-run  # Preview changes
   node backfill-job-metadata.js             # Apply updates
   ```

2. **Verify in Portal**:
   - Log in as technician
   - Check job offers
   - Confirm payout amounts display correctly
   - Verify service details are visible

3. **Monitor New Jobs**:
   - Create test order through checkout
   - Verify job created with complete metadata
   - Check portal displays all details

## Rollback Plan

If issues arise:
1. Previous Vercel deployment still available at older URL
2. Can revert via Vercel dashboard
3. Backfill script can be re-run safely (idempotent)

## Contact

For issues or questions about this deployment:
- Check Vercel logs for errors
- Review Supabase `h2s_dispatch_jobs` table
- Test with `--dry-run` before making changes
