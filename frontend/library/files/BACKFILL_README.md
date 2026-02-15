# Job Metadata Backfill Script

This script updates existing jobs in the database with missing payout and service details.

## What It Does

1. **Fetches all jobs** from `h2s_dispatch_jobs` table
2. **Checks each job** for missing metadata:
   - `estimated_payout` - calculated from order subtotal
   - `items_json` - service items from the order
3. **Fetches related orders** to get the missing data
4. **Updates jobs** with complete metadata

## Prerequisites

- Node.js installed
- `@supabase/supabase-js` package installed (run `npm install @supabase/supabase-js` if needed)
- Internet connection to access Supabase

## Usage

### 1. Dry Run (Test Mode - No Changes Made)

```bash
node backfill-job-metadata.js --dry-run
```

This will show you what changes would be made without actually updating the database.

### 2. Live Run (Apply Changes)

```bash
node backfill-job-metadata.js
```

This will update all jobs with missing metadata in the production database.

## Environment Variables (Optional)

You can override the default Supabase connection by setting:

```bash
# Windows PowerShell
$env:NEXT_PUBLIC_SUPABASE_URL="your-supabase-url"
$env:SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
node backfill-job-metadata.js

# Linux/Mac
NEXT_PUBLIC_SUPABASE_URL="your-supabase-url" SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" node backfill-job-metadata.js
```

## Output

The script will show detailed progress:

```
[Backfill] Starting job metadata update...
[Mode] LIVE - Will update jobs

[Backfill] Found 15 jobs to process

→ [Process] Job JOB-001 (order: H2S17670396058254UCIU)
  ✓ Found order: H2S17670396058254UCIU (subtotal: $199.00)
  + Adding payout: $69.65
  + Adding 2 items: 1x TV Mounting, 1x Wire Concealment
  ✓ [Success] Job JOB-001 updated

✓ [Skip] Job JOB-002 - already has complete metadata (payout: $45.00, items: 1)

============================================================
=== BACKFILL COMPLETE ===
============================================================
Total jobs processed: 15
✓ Updated: 12
→ Skipped: 3 (already complete)
✗ Errors: 0

✅ All updates applied to production database.
```

## What Gets Updated

### Payout Calculation
- **Base**: 35% of order subtotal
- **Minimum**: $35 (cost to roll a truck)
- **Maximum**: 45% of order total (to maintain business margin)
- **Special**: $45 minimum for mounting services

### Items Added
- Service name (e.g., "TV Mounting", "Wire Concealment")
- Quantity for each item
- Any metadata (size, mount type, etc.)

## After Running

Once the backfill is complete:

1. **Portal will display**:
   - Correct payout amounts ($XX.XX instead of $0)
   - Service details for technicians
   - Item quantities and descriptions

2. **All new jobs going forward** will automatically have this metadata included

## Troubleshooting

### "Failed to fetch jobs: TypeError: fetch failed"
- Check internet connection
- Verify Supabase is accessible
- Ensure credentials are correct

### "No matching order found for job XXX"
- Some jobs may not have corresponding orders in h2s_orders
- These jobs will be skipped automatically

### "Could not parse items for job XXX"
- The order may have malformed items data
- Job will be updated with payout only (if available)

## Files Modified

This script modifies only the `metadata` JSONB column in `h2s_dispatch_jobs` table. It does NOT:
- Delete any data
- Modify order records
- Change job status or assignments
- Affect any other columns

## Support

If you encounter issues, check the console output for specific error messages. The script is designed to be safe and will skip jobs it can't process rather than failing completely.
