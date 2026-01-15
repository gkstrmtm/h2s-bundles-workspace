# Backend Workflow Truth - Jan 13, 2026

## Architecture Overview

The backend has moved from a "Strict Relational" model (where a Job must explicitly exist in `h2s_dispatch_jobs`) to a **"Hybrid Congruence"** model. This ensures no data is ever "hidden" from operation views just because a workflow step hasn't triggered.

### 1. The "Source of Truth" Hierarchy

*   **Primary Truth:** `h2s_orders`
    *   This is the financial and customer commitment record.
    *   If it exists here, it **MUST** appear in the Dashboard and Dispatch List.
    *   *Status:* Immutable record of the transaction.
*   **Operational Truth:** `h2s_dispatch_jobs`
    *   This represents the *workflow state* (assigned, scheduled, in-progress).
    *   Used for: Technician assignments, sequence tracking, completion data.
*   **Virtual Truth (The Fix):** `Virtual Merge`
    *   At **Runtime** (API Layer), the system checks both tables.
    *   `Jobs List = (Real Dispatch Jobs) + (Orders without Jobs)`
    *   This guarantees 100% visibility without needing risky database migrations.

### 2. Data Flow: Order to Payout

1.  **Ingestion:**
    *   Customer purchases -> `h2s_orders` created.
    *   **Dashboard** immediately counts revenue ($).
    *   **Dispatch List** immediately shows "Pending/Unassigned" (via Virtual Job).

2.  **Assignment (Dispatch):**
    *   Admin assigns Pro -> `h2s_dispatch_jobs` record created/updated.
    *   Virtual Job becomes Real Job.
    *   Dashboard updates "Active Pros" and "Pending Jobs".

3.  **Completion:**
    *   Tech marks done -> Status: `completed`.
    *   Photos uploaded to Storage.
    *   Metrics: "Jobs Completed" increments.

4.  **Payout:**
    *   Job appears in Payouts Cockpit.
    *   Admin clicks "View" -> Modal fetches specific job details (bypassing filters).
    *   Admin approves -> Record created in `h2s_payouts_ledger`.

### 3. API Endpoints State

*   **`POST /api/admin_jobs_list`**:
    *   **New Feature:** `specific_job_id` param to bypass filters.
    *   **New Logic:** Merges `h2s_orders` into response if no job exists.
    *   **Limit:** Increased to 2000 items.

*   **`POST /api/admin_business_intelligence`**:
    *   **New Logic:** Queries `h2s_orders` directly for revenue stats.
    *   **Default:** 365 Days lookback (was 30).

### 4. Known Constraints
*   **Virtual Jobs:** Cannot be "edited" deeply (e.g. changing steps) until they are assigned and become "Real Jobs". This is intended behavior.
*   **Performance:** Fetching 2000 orders + jobs is fast now, but may need pagination in >1 year.

### 5. Final Verification
*   **Vercel Deployment:** Confirmed Active.
*   **Data Integrity:** Validated (Orders == Dashboard Total).
