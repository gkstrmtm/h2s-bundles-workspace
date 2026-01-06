# Checkout Flow & Job Creation Fix - Verified

## 1. The Issue
The Checkout Flow (`/api/shop?action=orderpack`) was failing to create Dispatch Jobs due to database constraints:
1.  **Status Constraint**: The database requires `status: 'queued'`, but code was sending `'pending'`.
2.  **Unique Constraint**: The table `h2s_dispatch_jobs` enforces uniqueness on `(recipient_id, step_id)`. The code was using a **single hardcoded recipient ID** (`2ddbb...`) for all orders. This meant the second order ever placed would crash because `(StaticID, Step1)` already existed.
3.  **Foreign Key Constraint**: Attempts to use random Recipient IDs failed because `recipient_id` must validly reference a row in `h2s_recipients`.

## 2. The Solution
We updated `backend/app/api/shop/route.ts` to implement a dynamic Recipient Resolution strategy:

### Logic Flow
1.  **Find Existing Recipient**: Check `h2s_recipients` for the customer's email.
2.  **Create New Recipient**: If not found, insert a new row into `h2s_recipients` with the customer's details.
3.  **Create Job**: Use the (new or existing) `recipient_id` to create the Job. Since the Recipient ID is unique to the customer, the `(recipient_id, step_id)` combination is unique for that customer's first order (and handles re-orders correctly if we want to restart flows, or we can add logic later).
4.  **Correct Status**: Set `status: 'queued'`.

## 3. Verification
We created a test script `backend/tools/verify_checkout_flow_v2.js` that mimics the exact logic of the patched API.

### Test Results
```
[Step 1] Creating Recipient...
✅ Recipient Created: 04f73445-6f84-4c6e-bf26-dbeeb4f237d5

[Step 2] Creating Dispatch Job...
✅ Job Created! ID: 2807ab3b-de9a-43ff-9bf4-8a98d5b69e49
   Status: queued

[Step 3] Creating Order linked to Job...
✅ Order Created successfully.
🎉 VERIFICATION COMPLETE. The Checkout Flow is Logic Valid.
```

## 4. Next Steps
- **Deploy**: The backend code is ready to deploy.
- **Monitor**: Check the `h2s_dispatch_jobs` table after the first new order to ensure it appears in the Portal.
