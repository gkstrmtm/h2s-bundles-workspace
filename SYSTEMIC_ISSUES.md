# 🚨 SYSTEMIC ISSUES IDENTIFIED

## ROOT CAUSE
The backend `/api/shop` endpoint was **partially migrated** from Pages Router to App Router, but **80% of the actions are missing**.

## WHAT'S BROKEN (And Why)

### Critical (Page Won't Work):
1. **Checkout Session** - Works partially, but fails validation on empty body
2. **Schedule Appointment** - Returns 500 error, endpoint exists but broken
3. **Track Event** - Returns 400, missing required fields

### Missing Features (10+ actions):
The frontend calls these `/api/shop` POST actions that **DON'T EXIST**:
- `promo_check_cart`
- `signin`
- `create_user`
- `request_password_reset`
- `reset_password`
- `upsert_user`
- `change_password`

The frontend calls these `/api/shop` GET actions that **DON'T EXIST**:
- `action=user`
- `action=orders`
- `action=orderpack`

## THE PATTERN
When you moved from **Pages Router** (`backend/pages/api/shop.js`) to **App Router** (`backend/app/api/shop/route.ts`), you only implemented:
- GET: `catalog`, `ai_sales`
- POST: `create_checkout_session`

But the OLD `shop.js` had **15+ actions** the frontend relies on.

## SOLUTION OPTIONS

### Option 1: Complete Migration (RECOMMENDED)
Copy ALL actions from `Home2Smart-Dashboard/backend/pages/api/shop.js` to `backend/app/api/shop/route.ts`

**Actions to add:**
```typescript
POST actions:
- promo_check_cart
- signin
- create_user  
- request_password_reset
- reset_password
- upsert_user
- change_password

GET actions:
- action=user (get user profile)
- action=orders (get order history)
- action=orderpack (post-checkout data)
```

### Option 2: Quick Fix (TEST CHECKOUT ONLY)
1. Fix checkout validation (allow test calls)
2. Fix schedule-appointment endpoint
3. Fix track endpoint
4. Leave auth features broken (users can't sign in, but checkout works)

### Option 3: Hybrid
Keep Pages Router `shop.js` running alongside App Router for backward compatibility.

## WHY THIS KEEPS BREAKING
You're making "minor tweaks" but the real issue is: **you're building on an incomplete foundation**. The frontend expects 15+ endpoints but you only built 3.

## WHAT TO FIX RIGHT NOW (Priority Order)

1. **Track endpoint** - Add missing validation for tracking events
2. **Checkout validation** - Fix to accept test payloads
3. **Schedule appointment** - Fix database schema/validation errors
4. **Add all missing shop POST handlers** - Copy from pages/api/shop.js
5. **Add all missing shop GET actions** - Copy from pages/api/shop.js

## FILES INVOLVED
- Source: `Home2Smart-Dashboard/backend/pages/api/shop.js` (HAS EVERYTHING)
- Target: `backend/app/api/shop/route.ts` (MISSING 80%)
- Also: `backend/app/api/schedule-appointment/route.ts` (BROKEN)
- Also: `backend/app/api/track/route.ts` (VALIDATION ISSUES)
