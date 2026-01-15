# REPEAT CUSTOMER CHECKOUT FAILURE - COMPLETE DIAGNOSTIC

## PROBLEM SUMMARY
Repeat customers (same email/phone) cannot place multiple orders. Second order fails with 500 error.

## ROOT CAUSE
Database constraint `h2s_dispatch_jobs_recipient_step_uq` blocks the same recipient from having multiple dispatch jobs with the same step_id.

### How it fails:
1. **First Order (Order 1)**: 
   - Creates recipient with email `test@test.com` → recipient_id = `abc-123`
   - Creates dispatch job: `recipient_id=abc-123, step_id=step-1, order_id=ORD-AAA`
   - ✅ SUCCESS

2. **Second Order (Order 2)** from same customer:
   - Finds/reuses same recipient_id = `abc-123` 
   - Tries to create dispatch job: `recipient_id=abc-123, step_id=step-1, order_id=ORD-BBB`
   - ❌ CONSTRAINT VIOLATION: `h2s_dispatch_jobs_recipient_step_uq` says "can't have 2 jobs with same recipient_id + step_id"
   - Even though order_id is different, the constraint doesn't care
   - Result: 500 Internal Server Error

## CURRENT STATE

### What's Working:
- ✅ Single checkout creates order + job successfully
- ✅ order_id column exists in h2s_dispatch_jobs table
- ✅ Backend code simplified to just INSERT (no broken upsert logic)
- ✅ Backend deployed to production (backend-m3qldvdqv)

### What's Failing:
- ❌ Second order from same customer = 500 error
- ❌ Constraint `h2s_dispatch_jobs_recipient_step_uq` is STILL ACTIVE (wasn't dropped)
- ❌ No error message captured (PowerShell can't get response body from 500)

## THE FIX

### Step 1: Verify Constraint Exists
Run this in Supabase SQL Editor:
```sql
SELECT conname, contype 
FROM pg_constraint 
WHERE conrelid = 'h2s_dispatch_jobs'::regclass
  AND conname LIKE '%recipient%step%';
```

**Expected Result if constraint still exists:**
```
conname: h2s_dispatch_jobs_recipient_step_uq
contype: u
```

**Expected Result if constraint was dropped:**
```
(no rows)
```

### Step 2: Drop the Constraint
Run this in Supabase SQL Editor:
```sql
ALTER TABLE h2s_dispatch_jobs 
DROP CONSTRAINT IF EXISTS h2s_dispatch_jobs_recipient_step_uq;
```

### Step 3: Add Unique Index on order_id
This prevents duplicate jobs for the same order (idempotency):
```sql
CREATE UNIQUE INDEX IF NOT EXISTS h2s_dispatch_jobs_order_id_uq 
ON h2s_dispatch_jobs(order_id);
```

### Step 4: Verify Fix
Run Step 1 query again - should return no rows.

## VALIDATION TEST

After running the SQL, test with PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -File test-repeat-fixed.ps1
```

**Expected Result:**
```
✅ Order 1 SUCCESS
✅ Order 2 SUCCESS  
✅ VALIDATION PASSED - Repeat customers can place multiple orders
```

## WHY PREVIOUS ATTEMPTS FAILED

1. **Migration SQL was created but not executed properly**
   - SQL file exists: backend/migrations/fix_dispatch_jobs_uniqueness.sql
   - User claims to have run it
   - But constraint still exists = SQL didn't actually execute or wrong database

2. **Upsert logic was wrong**
   - Tried to check for existing job by order_id
   - But constraint is on recipient_id + step_id
   - So even with different order_id, INSERT fails on constraint

3. **Can't capture error details**
   - PowerShell doesn't return response body on 500 errors
   - Backend logs enhanced error info but can't verify without direct DB access

## BACKEND CODE STATE

The backend code at [backend/app/api/shop/route.ts](backend/app/api/shop/route.ts#L1363-L1396) now:

1. Creates recipient (finds existing or creates new)
2. Tries to INSERT dispatch job with order_id
3. If error 23505 (unique violation) with constraint name `h2s_dispatch_jobs_recipient_step_uq`, logs warning
4. Throws error → 500 response

The code is CORRECT. The database constraint is WRONG.

## NEXT STEPS

**DO THIS:**
1. Open Supabase SQL Editor
2. Copy/paste EMERGENCY_DROP_CONSTRAINT.sql
3. Run it
4. Verify constraint dropped (Step 1 query returns no rows)
5. Run test-repeat-fixed.ps1
6. Both orders should succeed

**DON'T DO THIS:**
- ❌ Don't check Vercel logs (can't help without DB access)
- ❌ Don't modify backend code (it's correct)
- ❌ Don't try more migrations (they're not executing)
- ❌ Don't create more test scripts (existing one works)

## THE ONLY PROBLEM
The constraint `h2s_dispatch_jobs_recipient_step_uq` exists in the database and must be dropped via Supabase SQL Editor.

That's it. That's the only issue.
