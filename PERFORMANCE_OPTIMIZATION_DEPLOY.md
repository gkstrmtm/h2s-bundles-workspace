# Performance Optimization - Deployment Guide

## Changes Made
Extracted 183KB inline JavaScript to external `bundles.js` file for better browser caching and parsing performance.

## Files to Deploy (BOTH REQUIRED)
1. **bundles.html** - 82.7 KB (was 266 KB)
2. **bundles.js** - 183.9 KB (extracted application code)

## Deployment Location
- **URL:** https://home2smart.com/bundles
- **Files:** Upload BOTH files to the same directory

## Performance Impact
- **Before:** 266 KB HTML with 183KB inline script blocking parse
- **After:** 82 KB HTML + 184 KB external JS (cacheable)
- **Lighthouse:** Expected improvement from 71 → 85-92

## Why This Works
1. **Faster HTML Parsing:** Browser can parse 82KB HTML 3x faster
2. **Browser Caching:** bundles.js cached forever, only loads once
3. **Parallel Loading:** JS loads in background while HTML renders
4. **Reduced Main Thread Blocking:** No 183KB inline script to execute during parse

## Verification Steps
1. Upload both files to same directory
2. Open https://home2smart.com/bundles
3. Check browser console for errors
4. Test checkout flow (add to cart → checkout → payment)
5. Run Lighthouse audit (expect 85+ score)

## Critical Functions Verified
✅ init() - Page initialization
✅ checkout() - Checkout flow  
✅ toggleCart() - Cart drawer
✅ h2sTrack() - Analytics
✅ renderShopSuccess() - Success page
✅ addPackageDirectToCart() - Add items
✅ paintCart() - Cart rendering
✅ showCheckoutModal() - Checkout modal

## API Endpoints Preserved
✅ h2s-backend.vercel.app/api/shop
✅ h2s-backend.vercel.app/api/track
✅ h2s-backend.vercel.app/api/bundles-data

## Rollback Plan
If issues occur, restore the 266KB version:
- Original backup: `bundles-backup.html` in root directory

## Testing Checklist
- [ ] Page loads without errors
- [ ] Add to cart works
- [ ] Cart drawer opens
- [ ] Checkout modal opens
- [ ] Stripe redirect works
- [ ] Success page shows order details
- [ ] Tracking fires (check Network tab)
- [ ] Lighthouse score 85+

## Notes
- Both files MUST be in the same directory
- The script tag uses relative path: `<script defer src="bundles.js"></script>`
- Works on any server (Vercel, Apache, Nginx, etc.)
- No server-side configuration needed
