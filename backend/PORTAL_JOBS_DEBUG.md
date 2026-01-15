# Portal Jobs Debug Analysis

## Current Situation
**Endpoint:** `/api/portal_jobs`  
**Tech:** h2sbackend@gmail.com (34.8526, -82.394, ZIP 29649)  
**Expected:** 3 jobs within 47.3 miles  
**Actual:** 0 offers returned (mode: "no_rows")  

## Verified Facts

### ✅ Database Schema
- **h2s_dispatch_jobs**: Queue table with 8 jobs (status: "queued")
  - Contains: job_id, recipient_id, sequence_id, step_id, status, timestamps
  - Does NOT contain: addresses, geo coordinates, service details
  - Links to orders via recipient_id or metadata

- **h2s_orders**: Main database, 22 orders with full details
  - Contains: addresses, geo coordinates, customer info, line items
  - Links to jobs via metadata.dispatch_job_id

- **h2s_pros**: 39 technicians (correct table)
  - h2sbackend@gmail.com has geo coordinates: 34.8526, -82.394

### ✅ Enrichment Logic (Tested Locally)
Direct test shows enrichment WORKS:
```
Jobs with offer status: 8
Orders mapped to jobs: 6
Final filtered offers: 3 (jobs within 47.3 miles)
```

Jobs that should appear:
- 71b53bfd: 117 King Cir, Greenwood, SC 29649 (34.1954, -82.1618) - 47.3 miles
- 97efa744: 117 king cir, greenwood, SC 29649 (34.1954, -82.1618) - 47.3 miles  
- 371814c0: 117 king cir, greenwood, SC 29649 (34.1954, -82.1618) - 47.3 miles

### ✅ Code Changes Made
1. Fixed broken emoji characters in portal.html (20+ instances)
2. Updated fetchAvailableOffers to accept ordersClient parameter
3. Added main database client (getSupabase) for orders enrichment
4. Fixed geo coordinate reading: `j.geo_lat` before `j[latCol]`
5. Passed main client to both fetchAvailableOffers calls

## Problem: Code Path Not Reaching fetchAvailableOffers

The endpoint returns `mode: "no_rows"` which means it's hitting the fallback response at the end of the handle function, NOT the fetchAvailableOffers path.

### Code Flow Analysis

```typescript
// Line ~655: Should trigger when no assignments found
if (!assignmentsHit || !assignmentsHit.rows.length) {
  try {
    console.log('[Portal Jobs] No assignments found...');
    const offers = await fetchAvailableOffers(sb, main, {...});
    
    if (offers.length) {
      return NextResponse.json({ ok: true, offers, ... });
    }
  } catch {
    // Silently falls through
  }
}

// Line ~770: Fallback "no_rows" response
return NextResponse.json({ ok: true, offers: [], meta: { mode: 'no_rows' } });
```

**Hypothesis:** One of these is happening:
1. `assignmentsHit` has rows (but shouldn't - tech has no assignments)
2. `fetchAvailableOffers` is throwing an error (swallowed by try-catch)
3. `fetchAvailableOffers` returns 0 offers despite local test showing 3
4. Code takes a different path before reaching this block

## Required Investigation

### 1. Add Aggressive Logging
Need console.log at EVERY decision point:
- assignmentsHit value and row count
- fetchAvailableOffers entry/exit with counts
- Any errors being thrown
- Which database clients are null/undefined

### 2. Test Each Layer Separately
Create diagnostic endpoints:
- `/api/test-assignments` - Check if tech has assignments
- `/api/test-jobs-raw` - Fetch jobs from h2s_dispatch_jobs
- `/api/test-orders-raw` - Fetch orders from h2s_orders  
- `/api/test-enrichment` - Test enrichment logic
- `/api/test-geo-match` - Test geo filtering

### 3. Check Database Connection
Verify both database clients work:
```javascript
const sb = getSupabaseDispatch(); // h2s_dispatch_jobs
const main = getSupabase();        // h2s_orders
```

If `main` is null, enrichment fails silently.

## Likely Root Causes (Ranked)

### 🔴 MOST LIKELY: Main database client is null
The code does:
```typescript
let main: any | null = null;
try {
  main = getSupabase() as any;
} catch {
  main = null; // Error swallowed
}
```

If getSupabase() throws or returns null:
- ordersClient is null
- Enrichment skips: `if (jobIds.length > 0 && ordersClient)`
- Jobs have no addresses/geo
- Geo filtering excludes all jobs
- Returns 0 offers

**TEST:** Add `console.log('Main client:', main ? 'OK' : 'NULL')` before fetchAvailableOffers

### 🟡 SECOND: fetchAvailableOffers throws error
Possible errors:
- ordersClient.from() fails
- Enrichment logic throws
- Geo calculation throws
- Filtering throws

**FIX:** Replace `catch { }` with `catch (err) { console.error(...) }`

### 🟢 LESS LIKELY: assignmentsHit has unexpected data
Tech shouldn't have assignments, but maybe:
- Old assignments exist
- Assignment table has orphaned records
- Pro_id column matching wrong value

**TEST:** Log assignmentsHit before the if statement

## Immediate Action Plan

1. **Deploy with detailed logging** at every decision point
2. **Create direct test script** that calls fetchAvailableOffers with both clients
3. **Verify environment variables** for main database connection
4. **Check if getSupabase() actually works** in portal_jobs context

## Environment Check Needed

```bash
# Vercel environment variables
SUPABASE_URL=?
SUPABASE_SERVICE_KEY=?
SUPABASE_URL_DISPATCH=?
SUPABASE_SERVICE_KEY_DISPATCH=?
```

Both sets must be configured for enrichment to work.
