# Quick Deployment Guide - Job Cancellation Feature

## Prerequisites
- Access to production database
- Vercel CLI installed and authenticated
- Backend repository at `Home2smart-backend/`

---

## Step 1: Database Setup (5 minutes)

### Option A: Direct SQL (Recommended)
```bash
# Connect to production database
psql $DATABASE_URL

# Run migration script
\i backend/create_job_cancellations_table.sql

# Verify table created
SELECT COUNT(*) FROM h2s_job_cancellations;
# Should return: 0

# Verify columns added to assignments
\d h2s_dispatch_job_assignments
# Should show: cancelled_at and cancellation_reason columns
```

### Option B: Automated Script
```bash
# Ensure .env has SUPABASE_SERVICE_ROLE_KEY
node setup-cancellation-feature.js
```

---

## Step 2: Deploy Backend (3 minutes)

```bash
# Navigate to backend
cd Home2smart-backend

# Deploy to production
vercel --prod

# Wait for deployment
# ✅ Production: https://h2s-backend.vercel.app

# Verify endpoint exists
curl https://h2s-backend.vercel.app/api/portal_cancel_job \
  -X OPTIONS \
  -H "Origin: https://portal.home2smart.com"

# Should return: 200 OK
```

---

## Step 3: Verify Frontend (1 minute)

The frontend changes are already in `portal.html` and served directly.

```bash
# Test locally first (optional)
cd Home2Smart-Dashboard
# Open portal.html in browser
# Login as tech
# Accept a job
# Click "View Details"
# Verify "Cancel Job" button appears (red)
```

---

## Step 4: Production Test (5 minutes)

### Test Scenario 1: Happy Path
1. Login to tech portal as test tech
2. Accept a test job (or use existing accepted job)
3. Click "View Details" on accepted job
4. Verify "Cancel Job" button appears (red)
5. Click "Cancel Job"
6. Verify modal opens with warning message
7. Enter cancellation reason (at least 10 characters)
8. Click "Confirm Cancellation"
9. Verify success toast: "✅ Job cancelled successfully"
10. Verify job disappears from "Upcoming Jobs"

### Test Scenario 2: Validation
1. Open cancel modal
2. Leave reason empty, click Confirm
3. Verify error: "⚠️ Please provide a reason for cancellation"
4. Enter short reason (5 characters)
5. Verify error: "⚠️ Please provide more details (at least 10 characters)"
6. Enter valid reason
7. Click "Keep Job" (ghost button)
8. Verify modal closes without cancelling

### Test Scenario 3: Database Verification
```sql
-- Check cancellation was logged
SELECT * FROM h2s_job_cancellations 
ORDER BY cancelled_at DESC 
LIMIT 5;

-- Check assignment updated
SELECT job_id, state, cancelled_at, cancellation_reason 
FROM h2s_dispatch_job_assignments 
WHERE state = 'cancelled' 
ORDER BY cancelled_at DESC 
LIMIT 5;

-- Check job status reset
SELECT job_id, status, updated_at 
FROM h2s_dispatch_jobs 
WHERE status = 'pending' 
AND updated_at > NOW() - INTERVAL '10 minutes'
ORDER BY updated_at DESC;
```

---

## Step 5: Monitor (24 hours)

### Vercel Logs
```bash
# Watch function logs
vercel logs --follow

# Look for:
# - [portal_cancel_job] Request: {jobId, hasReason}
# - [portal_cancel_job] ✅ Job cancelled successfully
```

### Database Checks
```sql
-- Count cancellations in last 24 hours
SELECT COUNT(*) as total_cancellations
FROM h2s_job_cancellations
WHERE cancelled_at > NOW() - INTERVAL '24 hours';

-- Check for errors (high failure rate)
-- If many cancellations but no success logs, investigate
```

### User Reports
Monitor support channels for:
- "Can't cancel job" reports
- Error messages
- Unexpected behavior

---

## Rollback Plan (If Needed)

### If Major Issues Occur

1. **Disable Cancel Button** (Quick Fix)
   ```javascript
   // In portal.html, comment out line ~7637
   // <button id="md-cancel-job" ...>Cancel Job</button>
   
   // Or hide via CSS injection in browser console
   document.getElementById('md-cancel-job').style.display = 'none';
   ```

2. **Revert Backend Endpoint**
   ```bash
   # Find previous deployment
   vercel rollback h2s-backend
   ```

3. **Database Cleanup** (If corrupt data)
   ```sql
   -- Delete invalid cancellations
   DELETE FROM h2s_job_cancellations 
   WHERE reason IS NULL OR reason = '';
   
   -- Reset affected assignments
   UPDATE h2s_dispatch_job_assignments
   SET state = 'accepted', 
       cancelled_at = NULL,
       cancellation_reason = NULL
   WHERE state = 'cancelled' 
     AND cancelled_at > NOW() - INTERVAL '1 hour';
   ```

---

## Success Criteria

✅ **Deployment Successful If**:
- Database table created with indexes
- Backend endpoint responds (200/4xx, not 500)
- Cancel button appears for accepted jobs
- Modal opens and collects reason
- Cancellation succeeds with valid reason
- Job removed from tech's upcoming list
- Cancellation logged in h2s_job_cancellations
- Assignment updated to 'cancelled'
- Job status reset to 'pending'

❌ **Rollback If**:
- 500 errors on endpoint
- Database write failures
- Jobs not being released
- Frequent user reports of issues

---

## Post-Deployment Tasks

### Immediate (Day 1)
- [ ] Test all scenarios on production
- [ ] Verify database logs populating
- [ ] Check Vercel function logs
- [ ] Monitor support channels

### Week 1
- [ ] Review cancellation patterns (query h2s_job_cancellations)
- [ ] Identify most common reasons
- [ ] Check for abuse (frequent cancellers)
- [ ] Gather tech feedback

### Week 2
- [ ] Analyze cancellation rate
- [ ] Compare to decline rate
- [ ] Identify problem jobs (multiple cancellations)
- [ ] Plan improvements based on data

---

## Quick Reference

### Key Endpoints
- **Cancel Job**: POST `https://h2s-backend.vercel.app/api/portal_cancel_job`
- **Get Jobs**: GET `https://h2s-backend.vercel.app/api/portal_jobs`

### Key Database Tables
- **Cancellations**: `h2s_job_cancellations`
- **Assignments**: `h2s_dispatch_job_assignments`
- **Jobs**: `h2s_dispatch_jobs`

### Key Files
- **Frontend**: `Home2Smart-Dashboard/portal.html` (lines ~7620-7660, ~10545-10653, ~13728-13743)
- **Backend**: `Home2smart-backend/api/portal_cancel_job.js`
- **SQL**: `backend/create_job_cancellations_table.sql`

### Support Contacts
- **Backend Issues**: Check Vercel logs
- **Database Issues**: Query h2s_job_cancellations for audit trail
- **Frontend Issues**: Browser console + network tab

---

## Estimated Timeline

| Task | Duration | When |
|------|----------|------|
| Database Setup | 5 min | Now |
| Backend Deploy | 3 min | Now |
| Frontend Verify | 1 min | Now |
| Production Test | 5 min | Now |
| **Total Deployment** | **~15 min** | **Now** |
| Monitoring | 24 hours | Ongoing |
| Analysis | 1 hour | End of Week 1 |

---

## Done! 🎉

Your job cancellation feature is now live. Techs can cancel accepted jobs with required reason collection, and all data is logged for quality assurance.

**Next**: Monitor usage for 24-48 hours and review cancellation patterns.
