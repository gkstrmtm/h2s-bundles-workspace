# 🔧 DEPLOYED CODE FIXES - Quick Reference

## Current Status: 62.5% Pass Rate (10/16 tests)

---

## 🚨 ISSUE #1: Event Tracking Schema Mismatch (CRITICAL)

### The Problem
```
GitHub Code:      eventData.event_name = "page_view"
Database Schema:  event_type TEXT NOT NULL, event_name TEXT (optional)
Result:           💥 500 Error: "null value in column 'event_type' violates not-null constraint"
```

### Root Cause
The database was created with BOTH columns:
- `event_type` (NOT NULL) - **Required by database**
- `event_name` (nullable) - Written by code

The GitHub code writes to `event_name` but leaves `event_type` as NULL, violating the NOT NULL constraint.

### The Fix (3 Options)

#### **Option A: Fix the Code** ⭐ RECOMMENDED
Update `backend/app/api/track/route.ts` to write to BOTH columns:

```typescript
// BEFORE (line ~227):
const eventData: any = {
  event_id: eventId,
  visitor_id: visitorId,
  event_name: eventName,  // ❌ Only writes to event_name
  event_ts: eventTs,
  ...
};

// AFTER (add event_type):
const eventData: any = {
  event_id: eventId,
  visitor_id: visitorId,
  event_type: eventName,   // ✅ Write to event_type (required)
  event_name: eventName,   // ✅ Also write to event_name (legacy)
  event_ts: eventTs,
  ...
};
```

Then redeploy to Vercel.

#### **Option B: Fix the Database** (requires migration)
Run this SQL in Supabase SQL Editor:

```sql
-- Make event_type nullable
ALTER TABLE h2s_tracking_events 
  ALTER COLUMN event_type DROP NOT NULL;

-- Copy event_name to event_type for existing rows
UPDATE h2s_tracking_events 
SET event_type = event_name 
WHERE event_type IS NULL AND event_name IS NOT NULL;

-- Add default value
ALTER TABLE h2s_tracking_events 
  ALTER COLUMN event_type SET DEFAULT 'unknown';
```

⚠️ **Warning**: This changes production database schema.

#### **Option C: Rename Column** (requires code + DB change)
1. Rename database column from `event_type` to `event_name`
2. Keep the GitHub code as-is

Not recommended - too invasive.

---

## 🚨 ISSUE #2: Missing 'offers' Endpoint

### The Problem
```
GitHub Code:      case 'offers': (line 2761 in backend/app/api/v1/route.ts)
Deployed Code:    ❌ Does not have this case
Test Result:      400 "Invalid action"
```

### The Fix
The GitHub code HAS the `offers` endpoint, but it's not deployed. You need to:

1. **Verify GitHub code has it** ✅ (confirmed at line 2761)
2. **Redeploy the backend** to Vercel
3. **Retest** to confirm endpoint appears

```bash
# In the backend directory:
git add .
git commit -m "Sync deployed code with GitHub"
git push

# Vercel will auto-deploy
```

---

## ℹ️ ISSUE #3: Missing Deliverables Table (Low Priority)

### The Problem
```
Endpoint:      /api/v1?action=deliverables
Error:         "Could not find table 'public.Deliverables' in schema cache"
Impact:        Low - optional feature
```

### The Fix (if needed)
Run SQL script to create table:

```sql
-- See: backend/add_deliverables_table.sql
CREATE TABLE IF NOT EXISTS "Deliverables" (
    "Deliverable_ID" TEXT NOT NULL,
    "Title" TEXT NOT NULL,
    "Description" TEXT,
    "Status" TEXT DEFAULT 'DRAFT',
    "Created_By" TEXT,
    "Created_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_At" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Deliverables_pkey" PRIMARY KEY ("Deliverable_ID")
);
```

---

## 📋 ACTION PLAN (Recommended Order)

### Step 1: Fix Event Tracking (Option A)
1. Open `backend/app/api/track/route.ts`
2. Find line ~227: `event_name: eventName,`
3. Add ABOVE it: `event_type: eventName,`
4. Save file
5. Commit and push to GitHub
6. Wait for Vercel auto-deploy (2-3 minutes)

### Step 2: Verify Offers Endpoint Deployed
1. Check if GitHub commit includes line 2761 with `case 'offers':`
2. If yes, wait for Vercel deploy from Step 1
3. If no, the endpoint was never pushed - need to copy from local backend folder

### Step 3: Retest Everything
```bash
node test-backend-comprehensive.js
```

Expected result: **87.5% pass rate (14/16 tests)**
- ✅ Event tracking: 4 tests fixed
- ✅ Offers: 1 test fixed
- ⚠️ Deliverables: Still failing (optional)

---

## 🎯 Expected Results After Fixes

### Before Fixes (Current)
- ✅ 10 passing
- ❌ 6 failing
- **62.5% success rate**

### After Issue #1 Fix (Event Tracking)
- ✅ 14 passing (Track Page View, Track Lead, Track Purchase, Health Check)
- ❌ 2 failing (Offers, Deliverables)
- **87.5% success rate**

### After Issue #2 Fix (Offers Endpoint)
- ✅ 15 passing
- ❌ 1 failing (Deliverables - optional)
- **93.75% success rate**

### After All Fixes
- ✅ 16 passing
- ❌ 0 failing
- **100% success rate** 🎉

---

## 📞 Quick Test After Code Fix

```bash
# Test event tracking specifically:
node test-deployed-tracking.js

# Test all endpoints:
node test-backend-comprehensive.js
```

---

## 🔍 Verification Queries

### Check if event_type is being populated:
```sql
SELECT event_id, event_type, event_name, occurred_at 
FROM h2s_tracking_events 
ORDER BY occurred_at DESC 
LIMIT 10;
```

### Check if offers endpoint works:
```bash
curl "https://h2s-backend.vercel.app/api/v1?action=offers"
```

---

## 💡 Why This Happened

The deployed Vercel backend is running **different code** than the GitHub repository:

1. **Database schema** was created with both `event_type` (required) and `event_name` (optional)
2. **GitHub code** only writes to `event_name` 
3. **Database rejects** inserts because `event_type` is NULL (violates NOT NULL constraint)
4. **Offers endpoint** exists in GitHub but wasn't deployed to Vercel

This is a classic deployment drift issue - code and database schema are out of sync.
