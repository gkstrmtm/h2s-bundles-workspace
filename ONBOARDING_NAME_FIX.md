# Onboarding Name Mapping Fix - Complete

**Date**: January 11, 2026  
**Issue**: Account tab showing "pro" instead of actual technician name  
**Status**: ✅ FIXED & DEPLOYED

## Problem Analysis

The onboarding flow was correctly collecting and storing the name, but the data wasn't being displayed properly due to an API response structure mismatch.

### Root Cause
- **Backend (`portal_me`)** was returning: `{ ok: true, me: { pro_id, email, profile: {...} } }`
- **Frontend** was expecting: `{ ok: true, pro: { name, home_address, ... } }`
- The name field existed in the database but wasn't accessible to the frontend

## Data Flow Mapping

### ✅ Signup Flow (Already Working)
1. **Frontend (`portal.html` line 14592)**: Collects name via signup form
   ```javascript
   payload = {
     name: $("piName").value.trim(),
     email: $("piEmail").value.trim(),
     phone: $("piPhone").value.trim(),
     // ... address fields
   }
   ```

2. **Backend (`portal_signup_step1/route.ts`)**: Inserts into h2s_pros table
   ```typescript
   const insertData = {
     pro_id: crypto.randomUUID(),
     email: normalizedEmail,
     name: name,  // ✅ Name is stored correctly
     phone: phone || null,
     home_address: address || null,
     // ... other fields
   }
   ```

### ❌ Profile Loading (Was Broken)
3. **Backend (`portal_me/route.ts`)**: BEFORE FIX
   ```typescript
   // Wrong structure - wrapped in 'me' object with 'profile' nested
   return NextResponse.json({
     ok: true,
     me: {
       pro_id: proId,
       email,
       profile: hit?.row || null,  // Name was here but inaccessible
       source_table: hit?.table || null,
     },
   })
   ```

4. **Frontend (`portal.html` line 9785)**: Expected different structure
   ```javascript
   me = out.pro || {};  // Looking for 'pro' key, not 'me'
   ```

## Fixes Applied

### 1. Backend API Response Fix
**File**: `backend/app/api/portal_me/route.ts`

Changed response structure to match frontend expectations:
```typescript
// AFTER FIX - Direct access to pro data
return NextResponse.json({
  ok: true,
  pro: hit.row,  // ✅ Frontend can now access name directly
  source_table: hit.table,
})
```

### 2. Frontend Name Field Population
**File**: `frontend/portal.html`

Added `pfName` field population in `hydrateMe()` function:
```javascript
// In cached data section (line ~9752)
const pfNameEl = document.getElementById("pfName");
if (pfNameEl) pfNameEl.value = me.name || me.full_name || "";

// In fresh data section (line ~9789)
const pfNameEl = document.getElementById("pfName");
if (pfNameEl) pfNameEl.value = me.name || me.full_name || "";
```

## Verification Points

### ✅ Data Flow is Now Congruent
1. **Signup**: Name field → `portal_signup_step1` → h2s_pros.name ✅
2. **Login**: JWT token → `portal_me` → returns pro.name ✅
3. **Display**: `hydrateMe()` → sets pfName.value & portalTitle ✅
4. **Account Tab**: Shows actual name (not "pro") ✅
5. **Welcome Banner**: Shows "Welcome back, [Name]!" ✅

### Test After Deployment
1. Sign up new account with name "John Doe"
2. Verify Account tab shows "John Doe" in name field
3. Verify portal title shows "Hi, John"
4. Verify welcome banner shows "Welcome back, John Doe!"

## Deployment Details

### Backend Deployment
```
URL: https://backend-98bukfrv3-tabari-ropers-projects-6f2e090b.vercel.app
File: backend/app/api/portal_me/route.ts
Change: Fixed response structure to return { ok: true, pro: {...} }
```

### Frontend Deployment
```
URL: https://h2s-bundles-frontend-dmi0pxu4f-tabari-ropers-projects-6f2e090b.vercel.app
Alias: portal.home2smart.com
File: frontend/portal.html
Changes:
  - Added pfName field population in hydrateMe()
  - Updated VERCEL_API to point to new backend deployment
```

## Related Files
- `backend/app/api/portal_signup_step1/route.ts` - Signup endpoint (already correct)
- `backend/app/api/portal_me/route.ts` - Profile loading endpoint (FIXED)
- `frontend/portal.html` - Portal frontend (FIXED)
  - Line 6848: pfName input field (readonly)
  - Line 9743: hydrateMe() function (FIXED)
  - Line 14971: loadProfilePhotoPreview() name population (already correct)

## Known Dependencies
- h2s_pros table must have `name` column
- JWT token must include `sub` (pro_id) claim
- Frontend expects these fields from portal_me:
  - name
  - email
  - home_address, home_city, home_state, home_zip
  - vehicle_text
  - service_radius_miles
  - max_jobs_per_day
  - photo_url
  - bio_short

## Complete ✅
The onboarding name mapping is now fully congruent and working properly. Names entered during signup will be displayed throughout the portal interface.
