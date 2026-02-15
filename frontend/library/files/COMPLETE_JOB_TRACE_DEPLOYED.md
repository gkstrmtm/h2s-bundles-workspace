# Complete Job Bug Hunt - Instrumentation Deployed

**Date:** January 13, 2026  
**Build ID:** SHA-VERIFY-FINAL-1768357880  
**Deployment:** https://h2s-backend-mubwh04pb-tabari-ropers-projects-6f2e090b.vercel.app  
**Custom Domain:** https://portal.home2smart.com

**VERIFICATION:** Check console for:
```
[BUILD_ID] SHA-VERIFY-FINAL-1768357880
```
**OR** check bottom bar showing: `BUILD: SHA-VERIFY-FINAL-1768357880`

## What Was Deployed

### 1. Frontend Instrumentation (portal.html)

#### Global Error Handlers
- `[COMPLETE_JOB_GLOBAL_ERROR]` - Catches all uncaught JavaScript errors
- `[COMPLETE_JOB_UNHANDLED_REJECTION]` - Catches all unhandled promise rejections

#### Complete Job Flow Logs
- `[CLICK_COMPLETE_START]` - When user clicks "Complete Job" button
  - Includes: cid, job_id, hasPhotos, hasSignature
- `[CLICK_COMPLETE_REQUEST]` - Before sending API request
  - Includes: cid, endpoint, full payload JSON
- `[CLICK_COMPLETE_RESPONSE]` - After receiving API response
  - Includes: cid, status (OK/ERROR), full response JSON
- `[CLICK_COMPLETE_SUCCESS]` - If backend returns ok:true
  - Includes: cid, backend_cid, status_persisted, dispatch_job_id
- `[CLICK_COMPLETE_ERROR]` - If backend returns ok:false
  - Includes: cid, error message, error_code, full response
- `[CLICK_COMPLETE_UI_UPDATE]` - When moving job from upcoming to completed
  - Includes: cid, action description
- `[CLICK_COMPLETE_CLIENT_ERROR]` - If JavaScript exception occurs
  - Includes: cid, exception details

### 2. Backend Instrumentation (portal_mark_done/route.ts)

- `[COMPLETE_JOB_API_START]` - When API receives request
  - Includes: cid, job_id, has_token
- `[COMPLETE_JOB_API_ERROR]` - Any API error with stage and details
  - Includes: cid, error, error_code, stage, details
- `[COMPLETE_JOB_VALIDATE_AUTH_OK]` - After token verification
  - Includes: cid, pro_id
- `[COMPLETE_JOB_API_PREFLIGHT]` - Before fetching job from DB
  - Includes: cid
- `[COMPLETE_JOB_VALIDATE_JOB_OK]` - After finding job in DB
  - Includes: cid, current_status
- `[COMPLETE_JOB_API_UPDATE]` - Before updating job status
  - Includes: cid
- `[COMPLETE_JOB_DB_UPDATE_OK]` - After successful DB update
  - Includes: cid, status_persisted
- `[COMPLETE_JOB_DB_UPDATE_FAIL]` - If DB update fails
  - Includes: cid, error details, hint
- `[COMPLETE_JOB_PAYOUT_START]` - Before running side effects
  - Includes: cid
- `[COMPLETE_JOB_PAYOUT_OK]` - After side effects complete
  - Includes: cid
- `[COMPLETE_JOB_PAYOUT_FAIL]` - If side effects fail (non-fatal)
  - Includes: cid, error details
- `[COMPLETE_JOB_API_SUCCESS]` - Before returning success response
  - Includes: cid, status_persisted
- `[COMPLETE_JOB_API_CRASH]` - If unexpected exception occurs
  - Includes: cid, exception details

### 3. Key Changes from Previous Version

**REMOVED: Optimistic UI Updates**
- Previous version moved job to completed BEFORE backend confirmation
- This caused the "revert" symptom when backend failed silently
- **Now:** UI only updates AFTER receiving ok:true from backend

**ADDED: Correlation IDs (cid)**
- Frontend generates: `complete_{timestamp}_{random}`
- Backend generates: `req_{timestamp}_{random}`
- Both returned in responses for end-to-end tracing

**ADDED: Detailed Error Responses**
- All backend errors now include: cid, error_code, stage, details
- Frontend logs full request and response JSON
- User sees toast with cid for support correlation

## How to Use This for Debugging

### Step 1: Verify Deployment
Check console on portal load:
```
[BUILD_ID] SHA-VERIFY-003-TRACE 2026-01-13 18:45:00 FILE: portal.html
```

### Step 2: Attempt to Complete a Job
1. Upload photos (if needed)
2. Get signature (if needed)
3. Click "Complete Job"
4. Click final "Complete Job" confirmation

### Step 3: Capture Console Logs
Open DevTools Console (F12) and look for:

**SUCCESS PATTERN:**
```
[CLICK_COMPLETE_START] cid=complete_... job_id=123 hasPhotos=true hasSignature=true
[CLICK_COMPLETE_REQUEST] cid=complete_... endpoint=portal_mark_done payload={"token":"...","job_id":"123"}
[CLICK_COMPLETE_RESPONSE] cid=complete_... status=OK response={"ok":true,"cid":"req_...","status_persisted":"done",...}
[CLICK_COMPLETE_SUCCESS] cid=complete_... backend_cid=req_... status_persisted=done
[CLICK_COMPLETE_UI_UPDATE] cid=complete_... moving job from upcoming to completed
```

**FAILURE PATTERNS:**

**Pattern A: Frontend never calls API**
- You see `[CLICK_COMPLETE_START]` but NO `[CLICK_COMPLETE_REQUEST]`
- **Root Cause:** JavaScript error before API call
- **Look for:** `[COMPLETE_JOB_CLIENT_ERROR]` or `[COMPLETE_JOB_GLOBAL_ERROR]`

**Pattern B: API returns error**
- You see `[CLICK_COMPLETE_REQUEST]` and `[CLICK_COMPLETE_RESPONSE]` with status=ERROR
- **Root Cause:** Backend validation failure, DB error, or auth issue
- **Look for:** `[CLICK_COMPLETE_ERROR]` with error_code and full response

**Pattern C: UI reverts after success**
- You see SUCCESS logs but job appears back in upcoming list after refresh
- **Root Cause:** Backend returned ok:true but DB didn't actually persist
- **Check:** `status_persisted` value in response (should be "done")

### Step 4: Capture Network Request
In DevTools Network tab:
1. Filter by "portal_mark_done"
2. Click on the request
3. Copy Request payload and Response

**Expected Response:**
```json
{
  "ok": true,
  "cid": "req_1736789100000_abc123",
  "dispatch_job_id": "job-uuid",
  "updated_job": {...},
  "status_persisted": "done",
  "build_id": "v1.2.1-FIXED-REVERT_abc1234_2026-01-13T18:45:00.000Z"
}
```

### Step 5: Check Backend Logs (Vercel)
1. Go to https://vercel.com/tabari-ropers-projects-6f2e090b/h2s-backend
2. Click "Logs" tab
3. Filter by the cid from console
4. Look for the full COMPLETE_JOB_* log sequence

## Required Evidence to Return

After completing a job (or attempting to), provide:

### 1. Root Cause
One sentence: "The exact point where completion flow breaks"

### 2. Console Logs
Copy all `[CLICK_COMPLETE_*]` and `[COMPLETE_JOB_*]` logs

### 3. Network Evidence
Paste the raw JSON request and response from DevTools Network tab

### 4. Persistence Test
After the completion attempt:
- Refresh the page
- Does the job stay in "Completed"?
- Or does it reappear in "Upcoming"?

### 5. Payout Verification
- Check "Payouts" tab
- Is there a payout row for this job?
- What is the status? (pending/approved/paid)

## Expected Outcomes

**If Bug is in Frontend:**
- `[CLICK_COMPLETE_START]` appears
- Then `[COMPLETE_JOB_CLIENT_ERROR]` or `[COMPLETE_JOB_GLOBAL_ERROR]`
- NO `[CLICK_COMPLETE_REQUEST]`

**If Bug is in API Call:**
- `[CLICK_COMPLETE_REQUEST]` shows wrong payload
- OR Network tab shows failed request (CORS, 404, etc.)

**If Bug is in Backend Auth:**
- `[COMPLETE_JOB_API_ERROR]` with error=not_pro_session or missing_token

**If Bug is in Backend DB Update:**
- `[COMPLETE_JOB_DB_UPDATE_FAIL]` with Postgres error
- Response includes error_code (23514 = constraint violation)

**If Bug is in Side Effects:**
- `[COMPLETE_JOB_PAYOUT_FAIL]` (non-fatal, job should still complete)
- Response is still ok:true

**If Bug is UI Revert from Polling:**
- All logs show SUCCESS
- But next `loadJobs()` fetches job still as "pending"
- Response shows status_persisted="done" but DB query returns status="pending"

## Deployment URL
Production: https://portal.home2smart.com
