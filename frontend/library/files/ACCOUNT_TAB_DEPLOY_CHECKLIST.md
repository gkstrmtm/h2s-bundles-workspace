# Account Tab Deploy & Validation Checklist

## Overview
Deploy and validate the 3 new Account tab endpoints:
- `/api/customer_orders` - Recent orders with enrichment
- `/api/customer_reschedule` - Schedule date/time updates
- `/api/customer_photos` - Image uploads (existing, verified bulletproof)

**Total Time: < 5 minutes**

---

## Pre-Deploy Checks

### 1. Code Review ✓
- [ ] customer_orders endpoint created in `backend/app/api/customer_orders/route.ts`
- [ ] customer_reschedule endpoint created in `backend/app/api/customer_reschedule/route.ts`
- [ ] customer_photos endpoint verified in `backend/app/api/customer_photos/route.ts`
- [ ] All endpoints have request_id, duration_ms, server_timestamp
- [ ] All endpoints have structured error responses with error codes
- [ ] CORS headers configured for all endpoints

### 2. Environment Variables Check
```bash
# Verify these are set in Vercel dashboard
cd backend
vercel env ls
```

**Required:**
- `SUPABASE_ORDERS_URL` ✓
- `SUPABASE_ORDERS_ANON_KEY` ✓
- `SUPABASE_DISPATCH_URL` ✓
- `SUPABASE_DISPATCH_SERVICE_KEY` ✓

**Optional (for customer_photos):**
- `ENABLE_CUSTOMER_PHOTOS=true`
- `MAX_PHOTO_SIZE_MB=10`
- `MAX_PHOTOS_PER_JOB=12`

### 3. Dependencies Check
```bash
cd backend
npm install
```
- [ ] No dependency errors
- [ ] TypeScript compiles successfully

### 4. Lint Check (Optional)
```bash
cd backend
npm run lint
```

---

## Deployment

### 1. Deploy Backend to Production
```bash
cd backend
vercel --prod --yes
```

**Expected Output:**
```
✓ Deployed to production
https://h2s-backend.vercel.app
```

**Deployment ID:** (Record this for rollback if needed)
```
_______________________________
```

### 2. Verify Deployment URL
```bash
curl -I https://h2s-backend.vercel.app/api/health
```
- [ ] Status: 200 OK
- [ ] Response time: < 500ms

---

## Post-Deploy Validation (< 2 minutes)

### Test 1: customer_orders (30 seconds)

**Quick Test:**
```bash
curl -X POST https://h2s-backend.vercel.app/api/customer_orders \
  -H "Content-Type: application/json" \
  -d '{"customer_email":"test@home2smart.com"}'
```

**Expected Response:**
```json
{
  "ok": true,
  "orders": [...],
  "count": 0,
  "request_id": "orders-...",
  "duration_ms": 150,
  "server_timestamp": "2026-01-09T..."
}
```

**Validation:**
- [ ] Status: 200
- [ ] Has request_id field
- [ ] Has duration_ms field
- [ ] Has server_timestamp field
- [ ] Returns orders array (empty is OK)

---

### Test 2: customer_reschedule (30 seconds)

**Quick Test (use a real session_id from recent checkout):**
```bash
curl -X POST https://h2s-backend.vercel.app/api/customer_reschedule \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "cs_test_YOUR_SESSION_ID",
    "scheduled_iso": "2026-02-01",
    "timezone": "America/Chicago",
    "time_window": "9am - 12pm"
  }'
```

**Expected Response (if order exists):**
```json
{
  "ok": true,
  "updated_order_id": "ord_...",
  "updated_job_id": "job_...",
  "scheduled_date": "2026-02-01",
  "timezone": "America/Chicago",
  "time_window": "9am - 12pm",
  "was_rescheduled": true,
  "request_id": "reschedule-...",
  "duration_ms": 200
}
```

**Expected Response (if order not found):**
```json
{
  "ok": false,
  "error": "Order not found",
  "error_code": "ORDER_NOT_FOUND",
  "request_id": "reschedule-...",
  "duration_ms": 100
}
```

**Validation:**
- [ ] Status: 200 or 404
- [ ] Has request_id field
- [ ] Has duration_ms field
- [ ] Error code present if failed
- [ ] Date validation works (try past date, should fail)

---

### Test 3: customer_photos (30 seconds)

**Quick Test (check feature flag):**
```bash
curl -X POST https://h2s-backend.vercel.app/api/customer_photos \
  -H "Content-Type: application/json" \
  -d '{
    "customer_email": "test@home2smart.com",
    "job_id": "job_test_123",
    "data": "data:image/jpeg;base64,/9j/4AAQ...",
    "filename": "test.jpg",
    "mimetype": "image/jpeg"
  }'
```

**Expected Response (feature enabled):**
```json
{
  "ok": true,
  "upload": {
    "upload_id": "upl_...",
    "job_id": "job_...",
    "file_url": "https://...",
    "file_mime": "image/jpeg",
    "file_size": 1234,
    "created_at": "2026-01-09T...",
    "analysis_status": "NOT_RUN"
  }
}
```

**Expected Response (feature disabled):**
```json
{
  "ok": false,
  "error": "Customer photo uploads not enabled",
  "error_code": "feature_disabled"
}
```

**Validation:**
- [ ] Status: 201 or 400
- [ ] Feature flag respected
- [ ] File size validation works (try oversized, should fail)
- [ ] MIME type validation works (try invalid type, should fail)

---

## Comprehensive Test Suites

### Run Image Upload Test Matrix (1 minute)
```bash
cd c:\Users\tabar\h2s-bundles-workspace
node scripts/test_account_image_upload.mjs
```

**Expected Output:**
```
╔═══════════════════════════════════════════════════════╗
║   ACCOUNT TAB - IMAGE UPLOAD TEST MATRIX             ║
╚═══════════════════════════════════════════════════════╝

━━━ Test 1: Upload 1 image (jpg) ━━━
✓ PASS: Single image uploaded successfully

━━━ Test 2: Upload 5 images (mixed jpg/png) ━━━
✓ PASS: All 5 images uploaded successfully

━━━ Test 3: Upload invalid file type ━━━
✓ PASS: Invalid file type rejected correctly

━━━ Test 4: Upload oversized file (>10MB) ━━━
✓ PASS: Oversized file rejected correctly

━━━ Test 5: Upload with missing linkage ━━━
✓ PASS: Missing linkage rejected correctly

━━━ Test 6: Persistence test ━━━
✓ PASS: Upload persisted successfully

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESULTS:
  Passed: 6/6
  Failed: 0/6
  Duration: 3421ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ ALL TESTS PASSED
```

**Validation:**
- [ ] All 6 tests pass
- [ ] Duration < 5000ms
- [ ] No errors or exceptions

---

### Run Rescheduling Test Matrix (1 minute)
```bash
cd c:\Users\tabar\h2s-bundles-workspace
node scripts/test_account_reschedule.mjs
```

**Expected Output:**
```
╔═══════════════════════════════════════════════════════╗
║   ACCOUNT TAB - RESCHEDULING TEST MATRIX             ║
╚═══════════════════════════════════════════════════════╝

━━━ Test 1: Reschedule Pending order → becomes Scheduled ━━━
✓ PASS: Pending order rescheduled successfully

━━━ Test 2: Reschedule Scheduled order → date changes ━━━
✓ PASS: Scheduled order rescheduled to new date

━━━ Test 3: Invalid date input → blocked with error ━━━
✓ PASS: All invalid inputs rejected correctly

━━━ Test 4: Persistence test → date persists ━━━
✓ PASS: Schedule persisted successfully

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESULTS:
  Passed: 4/4
  Failed: 0/4
  Duration: 2103ms
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ ALL TESTS PASSED
```

**Validation:**
- [ ] All 4 tests pass
- [ ] Duration < 3000ms
- [ ] No errors or exceptions

---

## Portal Congruency Check

### 1. Verify Dispatch Portal Shows Data
1. Navigate to dispatch portal: `https://h2s-dispatch-portal.vercel.app` (or local)
2. Log in as technician
3. Check that:
   - [ ] Jobs show complete job_details (no "None specified")
   - [ ] Jobs show equipment_provided (no "?")
   - [ ] Jobs show scheduled dates from customer_reschedule
   - [ ] Jobs show photo count from customer_photos
   - [ ] Customer info shows correctly (name, address, phone)

### 2. Verify Data Flow
```
Customer reschedules → customer_reschedule API → h2s_dispatch_jobs.due_at updates → Portal shows new date
Customer uploads photo → customer_photos API → job_customer_uploads table → Portal shows photo count
```

**Test Flow:**
1. Create test order via checkout
2. Reschedule via `/api/customer_reschedule`
3. Upload photo via `/api/customer_photos`
4. Check portal: date and photo count should appear immediately

**Validation:**
- [ ] Portal shows rescheduled date within 30 seconds
- [ ] Portal shows photo count within 30 seconds
- [ ] No "None specified" or "?" placeholders
- [ ] All data matches API responses

---

## Performance Validation

### Response Time Checks
```bash
# customer_orders
time curl -X POST https://h2s-backend.vercel.app/api/customer_orders \
  -H "Content-Type: application/json" \
  -d '{"customer_email":"test@home2smart.com"}'

# customer_reschedule
time curl -X POST https://h2s-backend.vercel.app/api/customer_reschedule \
  -H "Content-Type: application/json" \
  -d '{"session_id":"cs_test_...","scheduled_iso":"2026-02-01","timezone":"America/Chicago","time_window":"9am - 12pm"}'

# customer_photos
time curl -X POST https://h2s-backend.vercel.app/api/customer_photos \
  -H "Content-Type: application/json" \
  -d '{"customer_email":"test@home2smart.com","job_id":"job_test_123","data":"data:image/jpeg;base64,...","filename":"test.jpg","mimetype":"image/jpeg"}'
```

**Performance SLAs:**
- [ ] customer_orders: < 300ms
- [ ] customer_reschedule: < 200ms
- [ ] customer_photos: < 2000ms (5MB file)

---

## Error Handling Validation

### Test Error Scenarios

#### 1. Missing Identifier
```bash
curl -X POST https://h2s-backend.vercel.app/api/customer_orders \
  -H "Content-Type: application/json" \
  -d '{}'
```
- [ ] Status: 400
- [ ] Error code: MISSING_IDENTIFIER

#### 2. Invalid Date Format
```bash
curl -X POST https://h2s-backend.vercel.app/api/customer_reschedule \
  -H "Content-Type: application/json" \
  -d '{"session_id":"cs_test_...","scheduled_iso":"01/15/2026","timezone":"America/Chicago","time_window":"9am - 12pm"}'
```
- [ ] Status: 400
- [ ] Error code: INVALID_DATE_FORMAT

#### 3. Oversized File
```bash
# (Generate 15MB base64 string)
curl -X POST https://h2s-backend.vercel.app/api/customer_photos \
  -H "Content-Type: application/json" \
  -d '{"customer_email":"test@home2smart.com","job_id":"job_test_123","data":"...15MB...","filename":"huge.jpg","mimetype":"image/jpeg"}'
```
- [ ] Status: 400
- [ ] Error code: file_too_large

---

## Rollback Procedure

### If Something Goes Wrong

1. **Identify the issue:**
   - Check Vercel logs: `vercel logs --prod`
   - Check specific endpoint: `curl -v https://h2s-backend.vercel.app/api/customer_orders`

2. **Rollback to previous version:**
   ```bash
   cd backend
   vercel rollback
   ```

3. **Verify rollback:**
   ```bash
   curl -I https://h2s-backend.vercel.app/api/health
   ```

4. **Fix the issue locally:**
   - Make corrections
   - Test locally: `npm run dev`
   - Re-deploy when fixed

---

## Sign-Off

### Deployment Complete ✓
- [ ] Backend deployed successfully
- [ ] All 3 endpoints responding
- [ ] Request tracking working (request_id, duration_ms)
- [ ] Error codes present and correct
- [ ] CORS headers configured

### Testing Complete ✓
- [ ] Image upload test matrix: 6/6 passed
- [ ] Rescheduling test matrix: 4/4 passed
- [ ] Performance benchmarks met
- [ ] Error handling validated

### Portal Congruency ✓
- [ ] Dispatch portal shows complete data
- [ ] No "None specified" or "?" placeholders
- [ ] Rescheduled dates appear in portal
- [ ] Photo counts appear in portal
- [ ] Data flow verified end-to-end

### Documentation Complete ✓
- [ ] API contracts documented (ACCOUNT_TAB_API_CONTRACTS.md)
- [ ] Test scripts created (test_account_image_upload.mjs, test_account_reschedule.mjs)
- [ ] Deploy checklist created (this file)
- [ ] Audit note created (ACCOUNT_TAB_AUDIT_2026-01-09.md)

---

## Quick Re-Run (< 2 minutes)

To verify everything is working after deployment:

```bash
# 1. Test all 3 endpoints (30 seconds)
curl -X POST https://h2s-backend.vercel.app/api/customer_orders -H "Content-Type: application/json" -d '{"customer_email":"test@home2smart.com"}'
curl -X POST https://h2s-backend.vercel.app/api/customer_reschedule -H "Content-Type: application/json" -d '{"session_id":"cs_test_...","scheduled_iso":"2026-02-01","timezone":"America/Chicago","time_window":"9am - 12pm"}'
curl -X POST https://h2s-backend.vercel.app/api/customer_photos -H "Content-Type: application/json" -d '{"customer_email":"test@home2smart.com","job_id":"job_test_123","data":"...","filename":"test.jpg","mimetype":"image/jpeg"}'

# 2. Run test matrices (90 seconds)
node scripts/test_account_image_upload.mjs
node scripts/test_account_reschedule.mjs

# Done! Total time: ~2 minutes
```

---

## Contact / Support

**If issues arise:**
- Check Vercel logs: `vercel logs --prod`
- Check Supabase dashboard for database errors
- Verify environment variables: `vercel env ls`
- Review API contracts: `ACCOUNT_TAB_API_CONTRACTS.md`
- Run test scripts to isolate issue
