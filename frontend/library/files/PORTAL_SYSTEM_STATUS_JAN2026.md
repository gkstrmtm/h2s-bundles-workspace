# Portal System Status - Jan 13, 2026

## Status: STABLE & VERIFIED

### Overview
The "Portal" ecosystem (Customer Portal, Technician Portal, and Admin Dispatch) is currently in a "Green" state. The core infrastructure supporting user interactions, job management, and file uploads is functioning as expected.

### Key Components

#### 1. Customer Portal (`portal.html`)
*   **Function:** Allows customers to view appointment details, reschedule, and upload photos.
*   **Current State:** Fully operational. 
*   **Data Source:** Reads directly from `h2s_orders` (metadata) and `h2s_dispatch_jobs` (scheduling).

#### 2. Technician Portal
*   **Function:** Allows pros to view assigned jobs, upload completion photos, and mark jobs as done.
*   **Current State:** Operational.
*   **Critical Link:** Uses `getJobData` logic which now correctly resolves both "Real" (assigned) and "Virtual" (unassigned/order-only) jobs.

#### 3. Admin Dispatch (`dispatch.html`)
*   **Function:** The command center for operations.
*   **Current State:** **CONGRUENT**.
    *   **Visibility:** Now displays **100% of Orders** (via Virtual Merge), not just the subset that has been manually dispatched.
    *   **History:** Default view extended to **365 Days**.
    *   **Payouts:** "View" Modal is fixed to load details for *any* job, regardless of age or list position.
    *   **Metrics:** Dashboard Revenue & Job Counts now match the Database Truth.

### Deployment
*   **Frontend:** Deployed to Vercel Production (`h2s-bundles-frontend`).
*   **Backend:** Deployed to Vercel Production (`h2s-dashboard-backend`).
*   **Version:** v1.3.0 (Congruence Update).
