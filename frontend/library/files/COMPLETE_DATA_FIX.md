# Complete Data Visibility Fix - Jan 10 2026

## Objective
Fix system-wide data "filtering" issues where valid jobs and metrics were hidden from the UI due to arbitrary limits (30 days, 500 items).

## Changes Implemented

### 1. Payout Approvals "View" Context
*   **Problem:** The "View" button failed for older jobs because `getJobData` called the API with a 180-day filter. If the job was older, it returned no data.
*   **Fix:** 
    *   **Backend (`admin_jobs_list`):** Added support for `specific_job_ids` parameter. When provided, it **bypasses** date filters and limits to find the exact job.
    *   **Frontend (`dispatch.html`):** Updated `getJobData(jobId)` to request the specific ID instead of searching a large list.

### 2. Dispatch Jobs List ("Show Reality")
*   **Problem:** The list was limited to 500 items and sometimes 30 days, hiding valid booked jobs. Orders were also fetched with a 500 limit, causing missing "link" details.
*   **Fix:**
    *   **Backend:** Increased `admin_jobs_list` default limit from **500 -> 2000**.
    *   **Backend:** Increased `h2s_orders` fetch limit from **500 -> 2000** to ensure order details (customer name, price) are linked.
    *   **Frontend (`dispatch.html`):** Increased default fetch window from **30 days -> 365 days**.

### 3. Dashboard Metrics (Business Intelligence)
*   **Problem:** The Dashboard hardcoded `const days = 30`, significantly undercounting total revenue and job completion stats.
*   **Fix:**
    *   **Backend (`admin_business_intelligence`):** Changed default from 30 days to **365 days** (or user-provided value) to reflect accurate YTD/All-time reality.

## Verification
1.  **Payouts:** Click "View" on any historic payout. It will now load the job details successfully.
2.  **Dispatch List:** The list will now populate up to 2000 recent jobs (approx 1 year volume), showing orders that were previously hidden by the 500 limit.
3.  **Dashboard:** Revenue and Completed Job counts should increase significantly to match database reality.

## File artifacts
- `backend/app/api/admin_jobs_list/route.ts`
- `backend/app/api/admin_business_intelligence/route.ts`
- `frontend/dispatch.html`
