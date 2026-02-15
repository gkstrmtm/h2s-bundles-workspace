# Job Cancellation Feature

## Overview
Allows technicians to cancel jobs they've already accepted, with mandatory reason collection for quality assurance and pattern tracking.

## User Flow

### 1. View Job Details
- Tech clicks "View Details" on an accepted/scheduled job
- Job details modal opens showing job information

### 2. Cancel Button Visibility
- "Cancel Job" button shown only for jobs in these states:
  - `accepted`
  - `confirmed`
  - `scheduled`
- Button is **hidden** for:
  - Pending offers (use "Decline" instead)
  - Completed jobs (can't cancel finished work)
  - Already cancelled jobs

### 3. Cancellation Modal
When tech clicks "Cancel Job":
- Modal opens with warning styling (red/dark theme)
- Displays clear message: "This will remove the job from your schedule and make it available for reassignment"
- Requires reason input (minimum 10 characters)
- Shows validation errors if reason is missing/too short
- Two actions:
  - **Confirm Cancellation** (red button) - proceeds with cancellation
  - **Keep Job** (ghost button) - closes modal without changes

### 4. Submission & Validation
Frontend validates:
- Reason not empty
- Reason at least 10 characters
- Job ID present

Backend validates:
- Valid session token
- Job exists and assigned to requesting tech
- Job in cancellable state
- Reason meets minimum length

### 5. Success Handling
On successful cancellation:
- Close cancellation modal
- Close job details modal
- Show success toast: "✅ Job cancelled successfully"
- Invalidate job list caches
- Reload jobs list after 1 second
- Job disappears from "Upcoming Jobs"
- Job returns to pending/available for reassignment

### 6. Error Handling
Displays specific error messages:
- "Invalid/expired session" → Prompts sign in
- "Job not found or not assigned to you"
- "Cannot cancel job in [state] state"
- "Cancellation reason required (minimum 10 characters)"
- Network/server errors with generic message

## Technical Implementation

### Frontend (portal.html)

#### Modal HTML
```html
<div id="cancelJobModal" class="modal">
  <div class="sheet">
    <h3>Cancel This Job?</h3>
    <textarea id="cancelJobReason" rows="4" placeholder="..."></textarea>
    <button id="confirmCancelJob">Confirm Cancellation</button>
    <button id="closeCancelModal">Keep Job</button>
    <div id="cancelJobErr"></div>
  </div>
</div>
```

#### JavaScript Functions
- `openCancelJobModal(jobId)` - Opens modal, sets job ID, clears form
- `closeCancelJobModal()` - Closes modal, clears state
- `cancelJob()` - Validates, calls API, handles response

#### Event Listeners
- Click outside modal to close
- Enter key to submit (Shift+Enter for new line)
- Button click handlers

### Backend (/api/portal_cancel_job)

#### Endpoint
- **Method**: POST only
- **Authentication**: Session token required
- **Rate limiting**: None (relies on user action)

#### Request Body
```json
{
  "token": "session_token",
  "job_id": "JOB-12345",
  "reason": "Schedule conflict - family emergency"
}
```

#### Response Success
```json
{
  "ok": true,
  "message": "Job cancelled successfully",
  "job_id": "JOB-12345",
  "cancelled_at": "2025-01-02T10:30:00Z"
}
```

#### Response Errors
```json
{
  "ok": false,
  "error": "Cancellation reason required (minimum 10 characters)",
  "error_code": "invalid_reason"
}
```

Error codes:
- `bad_session` - Invalid/expired token
- `missing_job_id` - No job_id provided
- `invalid_reason` - Reason missing or too short
- `job_not_found` - Job doesn't exist or not assigned to tech
- `invalid_state` - Job not in cancellable state
- `update_failed` - Database update failed
- `query_error` - Database query error
- `server_error` - Unexpected server error

### Database Operations

#### 1. Insert Cancellation Log
```sql
INSERT INTO h2s_job_cancellations (
  job_id, pro_id, assignment_id, reason, 
  previous_state, cancelled_at
) VALUES (...);
```

#### 2. Update Assignment
```sql
UPDATE h2s_dispatch_job_assignments
SET state = 'cancelled',
    cancelled_at = NOW(),
    cancellation_reason = $reason
WHERE assignment_id = $id;
```

#### 3. Update Job Status
```sql
UPDATE h2s_dispatch_jobs
SET status = 'pending',
    updated_at = NOW()
WHERE job_id = $id;
```

## Database Schema

### h2s_job_cancellations Table
```sql
CREATE TABLE h2s_job_cancellations (
  cancellation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id VARCHAR(255) NOT NULL,
  pro_id VARCHAR(255) NOT NULL,
  assignment_id UUID,
  reason TEXT NOT NULL,
  previous_state VARCHAR(50),
  cancelled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Indexes:**
- `idx_job_cancellations_job_id` - Find all cancellations for a job
- `idx_job_cancellations_pro_id` - Find all cancellations by a tech
- `idx_job_cancellations_cancelled_at` - Time-based queries
- `idx_job_cancellations_assignment_id` - Link to assignments

### h2s_dispatch_job_assignments Updates
Added columns:
- `cancelled_at TIMESTAMPTZ` - When assignment was cancelled
- `cancellation_reason TEXT` - Why it was cancelled

## Quality Assurance Queries

### Find Frequent Cancellers (Last 30 Days)
```sql
SELECT pro_id, COUNT(*) as cancellation_count, 
       ARRAY_AGG(reason ORDER BY cancelled_at DESC) as recent_reasons
FROM h2s_job_cancellations
WHERE cancelled_at > NOW() - INTERVAL '30 days'
GROUP BY pro_id
HAVING COUNT(*) > 3
ORDER BY cancellation_count DESC;
```

### Cancellation Patterns by Reason
```sql
SELECT 
  LOWER(SUBSTRING(reason FROM 1 FOR 50)) as reason_start,
  COUNT(*) as frequency,
  COUNT(DISTINCT pro_id) as unique_techs
FROM h2s_job_cancellations
WHERE cancelled_at > NOW() - INTERVAL '90 days'
GROUP BY reason_start
ORDER BY frequency DESC
LIMIT 20;
```

### Jobs With Multiple Cancellations
```sql
SELECT 
  j.job_id,
  j.service_name,
  COUNT(c.cancellation_id) as cancel_count,
  ARRAY_AGG(c.pro_id) as cancelled_by,
  ARRAY_AGG(c.reason ORDER BY c.cancelled_at) as reasons
FROM h2s_dispatch_jobs j
JOIN h2s_job_cancellations c ON j.job_id = c.job_id
GROUP BY j.job_id, j.service_name
HAVING COUNT(c.cancellation_id) > 1
ORDER BY cancel_count DESC;
```

## Future Enhancements

### Potential Features
1. **Cancellation Limits** - Restrict techs who cancel frequently
2. **Cooling Period** - Prevent immediate re-acceptance of cancelled jobs
3. **Penalty System** - Reduce job priority for frequent cancellers
4. **Admin Notifications** - Alert on suspicious patterns
5. **Reason Categories** - Dropdown with common reasons + "Other"
6. **Customer Notification** - Auto-notify customer when job cancelled
7. **Auto-Reassignment** - Immediately offer to next available tech

### Analytics Dashboard
Track metrics:
- Cancellation rate by tech
- Cancellation rate by service type
- Average time between acceptance and cancellation
- Most common reasons
- Jobs requiring multiple assignments due to cancellations

## Testing Checklist

### Frontend Testing
- [ ] Cancel button appears for accepted jobs
- [ ] Cancel button hidden for offers/completed jobs
- [ ] Modal opens with correct styling
- [ ] Reason field validation works (empty, too short)
- [ ] Enter key submits form
- [ ] Escape key closes modal
- [ ] Click outside closes modal
- [ ] Success toast displays
- [ ] Job list refreshes after cancellation
- [ ] Error messages display correctly

### Backend Testing
- [ ] Endpoint requires authentication
- [ ] Validates reason length
- [ ] Verifies job assignment
- [ ] Checks job state before cancelling
- [ ] Logs cancellation to tracking table
- [ ] Updates assignment state
- [ ] Updates job status
- [ ] Returns appropriate error codes
- [ ] Handles missing fields gracefully
- [ ] Concurrent cancellation attempts handled

### Database Testing
- [ ] Cancellation logged with all fields
- [ ] Assignment updated correctly
- [ ] Job status reverted to pending
- [ ] Indexes improve query performance
- [ ] No orphaned records
- [ ] Timestamps accurate

## Deployment Steps

1. **Database Migration**
   ```bash
   # Run SQL migration
   psql $DATABASE_URL -f backend/create_job_cancellations_table.sql
   ```

2. **Deploy Backend**
   ```bash
   # Deploy to Vercel
   cd Home2smart-backend
   vercel --prod
   ```

3. **Deploy Frontend**
   ```bash
   # Already part of portal.html - no separate deployment needed
   # Ensure latest portal.html served
   ```

4. **Verify Deployment**
   - Test cancellation on staging
   - Check database logs
   - Verify no errors in Vercel logs
   - Test error scenarios

## Support & Troubleshooting

### Common Issues

**Issue**: "Job not found or not assigned to you"
- **Cause**: Assignment removed before cancellation
- **Fix**: Refresh page and try again

**Issue**: "Cannot cancel job in [state] state"
- **Cause**: Job already completed or declined
- **Fix**: No action needed - state prevents invalid cancellation

**Issue**: Cancellation succeeds but job still shows
- **Cause**: Cache not invalidated
- **Fix**: Hard refresh (Ctrl+F5) or wait for cache expiry

**Issue**: Multiple cancellations logged
- **Cause**: Double-click on submit button
- **Fix**: Button disabled during API call (implement loading state)

### Monitoring
Check Vercel logs for:
- High cancellation rates
- Error spikes
- Unusual patterns (same tech/job repeatedly)

### Contact
For issues or questions:
- Backend errors: Check Vercel function logs
- Database issues: Query h2s_job_cancellations for audit trail
- User reports: Check both frontend console and backend logs
