# Critical Portal & Checkout Fix Deployment

## 1. Checkout Flow Fixes (`api/shop`)
- **Automatic Recipient Creation**: Now checks `h2s_recipients` for existing user or creates a new one to avoid Unique Constraint violations on `(recipient_id, step_id)`.
- **Status Correction**: Jobs are now created with `status: 'queued'` instead of `'pending'`.
- **Address Data**: Orders now explicitly save `service_address`, `city`, `state`, `zip` to `metadata_json` (and columns) so the Portal can geocode them.

## 2. Portal Visibility Fixes (`api/portal_jobs`)
- **Status Grouping**: Added `'queued'` to the allowed "Offers" status list (previously only 'pending', 'open' etc).
- **Enrichment**: Logic updated to ensure jobs read address data correctly from linked Orders.

## 3. Verification
- Verified with `tools/verify_checkout_flow_v2.js`.
- Confirmed Job Creation matches unique recipient.
- Confirmed Job appears in "Queued" status.
- Confirmed Order has Zip Code for Geo-filtering.
