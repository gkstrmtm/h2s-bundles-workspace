# Deployment Summary - Portal Logic Fixes

**Date:** 2026-01-14
**Reason:** Fix "East Coast jobs in LA" (Geofencing) and "[object Object]" address display (Data Integrity).

## Changes

1.  **Geofencing Guardrail (Backend):**
    -   File: `backend/app/api/portal_jobs/route.ts`
    -   Action: Closed the "Flood Gate" in `fetchAvailableOffers`.
    -   Logic: If geocoding fails (no coordinates) and ZIP codes do not match strictly, the job is now DROPPED instead of included. This prevents cross-country job leakage when geocoding is incomplete.

2.  **Address Data Sanitization (Backend):**
    -   File: `backend/app/api/portal_jobs/route.ts`
    -   Action: Added `resolveAddr` helper in enrichment loops.
    -   Logic: Detects if `service_address` (from Orders or Jobs) is a JSON object. If so, extracts `formatted_address` or `line1` instead of blindly casting to string (which produced `[object Object]`).

## Verification Steps

1.  **Geofencing:**
    -   Check logs for `[Portal Jobs] Job X: DROPPED zip mismatch`.
    -   Verify East Coast pro does not see LA jobs.

2.  **Data Integrity:**
    -   Verify Job Details page no longer shows `[object Object]` in the address field.

## Files Modified
- `backend/app/api/portal_jobs/route.ts`
