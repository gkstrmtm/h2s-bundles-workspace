# Bundles Page - Lighthouse Performance Analysis

**Date**: January 1, 2026
**File**: Home2Smart-Dashboard/bundles.html (4,879 lines)
**Current State**: STABLE - DO NOT BREAK

---

## 🔍 CRITICAL ENDPOINT MAPPING (DO NOT CHANGE)

### Production Backend
- **Primary Origin**: `https://h2s-backend.vercel.app`
- **SHOP_ORIGIN**: Routes `/api/shop`, `/api/reviews`, `/api/quote`, `/api/promo_validate`, `/api/get-order-details`
- **SCHED_ORIGIN**: Routes `/api/bundles-data`, `/api/schedule-appointment`, `/api/get-availability`

### Fetch Rewrite Logic (Lines 13-217)
**TWO fetch shims exist** - one early (line 13) and one later (line 4127):
1. **Early shim** (priority: low for non-LCP resources)
2. **Main shim** (full URL rewriting)

Both rewrite requests from `h2s-backend.vercel.app` to appropriate deployments.

**CRITICAL**: These shims MUST stay intact - they prevent 404s and route API calls correctly.

---

## 📊 CURRENT FILE SIZES

### JavaScript Files (in directory)
```
bundles-logic-temp.js    466.43 KB  ⚠️ LARGEST
bundles-app.js           464.35 KB  ⚠️ LARGEST
Dashboard.js             244.04 KB
bundles.js               191.31 KB
bundles-inline-extracted.js  183.47 KB
bundles-inline-js.js      57.55 KB
bundles-checkout.js       57.49 KB
bundles-logic.js          55.33 KB
```

### CSS Files
```
bundles.css               48.18 KB
```

**Total JS**: ~1.7 MB (compressed likely ~400-500KB)

---

## 🎯 LIGHTHOUSE PERFORMANCE FACTORS

### 1. **Render-Blocking Resources**
**Current State**:
- ✅ Fonts loaded async (`media="print" onload="this.media='all'"`)
- ✅ Deferred UI styles (`<style media="print" onload="this.media='all'"`)
- ✅ Critical CSS inlined (lines 589-686)
- ❌ Multiple large `<script>` tags inline (shims, tracking, logic)

**Inline Scripts Found**:
- Line 13-217: Early fetch shim (~200 lines)
- Line 219-254: Safe-start stubs (~35 lines)
- Line 257-295: Base globals (~38 lines)
- Line 338-527: Tracking diagnostics (~189 lines)
- Line 1318+: Calendar fix
- Line 1323+: Initialization shim
- Line 1371+: Reviews logic
- Line 1450+: More initialization
- Line 3635+: Stripe setup
- Line 3653+: Deferred app logic
- Line 3689+: Fetch polyfill
- Line 4127+: Main fetch shim (duplicate)
- Line 4309+: Main application logic
- Line 4752+: Additional logic
- Line 4786+: Final scripts

**Total inline script**: ~3000+ lines embedded

### 2. **Main Thread Blocking**
- Large inline scripts execute during parse
- No code splitting visible
- All logic loaded upfront even if not needed

### 3. **Resource Priorities**
**Good**:
- Logo preloaded (`fetchpriority="high"`)
- DNS prefetch for critical origins
- Preconnect to Stripe, Facebook Pixel

**Bad**:
- `/api/bundles-data` preloaded but not critical for initial render
- Multiple JavaScript execution chains block paint

### 4. **Image Optimization**
- Logo uses `imagesrcset` and `imagesizes` ✅
- Preload with proper sizing ✅

### 5. **Critical Rendering Path**
**Current Flow**:
```
HTML Parse
  ↓
Inline CSS (critical) - GOOD
  ↓
Inline JS shims (200+ lines) - BLOCKS
  ↓
Inline tracking (189 lines) - BLOCKS
  ↓
More inline JS (~3000 lines total) - BLOCKS
  ↓
Deferred styles load
  ↓
External scripts (bundles-app.js 464KB) - BLOCKS if not deferred
  ↓
First Paint
```

---

## 🚀 OPTIMIZATION OPPORTUNITIES (SAFE)

### Priority 1: Move Non-Critical Inline JS to External Files
**Target**: Lines with large inline `<script>` blocks
**Method**: Extract to separate files, load with `defer` or `async`
**Risk**: LOW if done carefully
**Files to create**:
- `bundles-tracking.js` (tracking diagnostics)
- `bundles-shims.js` (safe-start stubs, base globals)
- `bundles-fetch-rewrite.js` (consolidated fetch shim)

**Keep inline** (must execute immediately):
- Early fetch shim (lines 13-217) - prevents 404s
- Critical stubs for click handlers

### Priority 2: Code Splitting
**Target**: `bundles-app.js` (464KB), `bundles-logic-temp.js` (466KB)
**Method**: Split into:
- Core bundle (needed for initial render)
- Cart logic (lazy load when cart opened)
- Booking flow (lazy load when booking clicked)
- Reviews carousel (lazy load when scrolled into view)

**Risk**: MEDIUM - requires understanding dependencies
**Impact**: HIGH - reduces initial bundle by 60-70%

### Priority 3: Lazy Load Non-Critical Features
**Targets**:
- Reviews carousel (not above fold)
- Booking modal (only loads on click)
- Cart drawer (only loads on click)
- Facebook Pixel (can defer)
- Stripe (only needed at checkout)

**Risk**: LOW
**Impact**: MEDIUM

### Priority 4: Optimize CSS Delivery
**Current**: 48KB CSS file
**Method**:
- Inline only above-the-fold CSS
- Defer rest of styles
- Remove unused CSS rules

**Risk**: LOW
**Impact**: MEDIUM

### Priority 5: Remove Duplicate Logic
**Found**: Two fetch shim implementations (lines 13-217 and 4127-4300)
**Method**: Consolidate into one
**Risk**: MEDIUM - must test thoroughly
**Impact**: Reduces script size by ~200 lines

---

## ⚠️ DO NOT TOUCH (CRITICAL STABILITY)

1. **Endpoint routing logic** (lines 13-217, 4127-4300)
   - Routes API calls to correct deployments
   - Prevents 404s from deployment alias drift
   - Breaking this breaks checkout, reviews, scheduling

2. **SHOP_ORIGIN / SCHED_ORIGIN variables**
   - Must remain `https://h2s-backend.vercel.app`
   - Changing breaks API communication

3. **URL rewriting in fetch shim**
   - Pattern matching for `/api/*` paths
   - Hostname checks for `h2s-backend.vercel.app`
   - Query parameter handling for `orderpack` → `get-order-details`

4. **Priority injection logic** (line 189-204)
   - Sets `priority: 'low'` for non-LCP resources
   - Must execute before fetch calls

---

## 📋 SAFE OPTIMIZATION PLAN

### Phase 1: Extract Inline Scripts (NO RISK)
1. Create `bundles-tracking.js` - move tracking code
2. Create `bundles-reviews-init.js` - move review carousel setup
3. Keep fetch shims inline (required for correctness)
4. Load extracted files with `defer`

### Phase 2: Optimize Loading Strategy (LOW RISK)
1. Add `defer` to all non-critical `<script>` tags
2. Lazy load Stripe until checkout clicked
3. Lazy load Facebook Pixel after page interactive
4. Use Intersection Observer for reviews carousel

### Phase 3: Code Splitting (MEDIUM RISK - TEST THOROUGHLY)
1. Split `bundles-app.js` into:
   - `bundles-core.js` (50KB) - critical functions
   - `bundles-cart.js` (100KB) - cart drawer logic
   - `bundles-booking.js` (150KB) - scheduling flow
   - `bundles-reviews.js` (164KB) - carousel logic

2. Load modules dynamically:
   ```javascript
   // When cart opened
   import('./bundles-cart.js').then(mod => mod.openCart());
   
   // When booking clicked
   import('./bundles-booking.js').then(mod => mod.openBooking());
   ```

### Phase 4: CSS Optimization (LOW RISK)
1. Extract above-fold CSS to inline `<style>` (first ~10KB)
2. Load rest via `<link media="print" onload="...">`
3. Remove unused rules with PurgeCSS

---

## 🎯 EXPECTED LIGHTHOUSE IMPROVEMENTS

### Current Estimated Scores (based on analysis)
- **Performance**: 40-60 (large JS blocking, no code splitting)
- **FCP**: ~2.5s (inline scripts block paint)
- **LCP**: ~3.5s (large bundle delays interactive)
- **TBT**: ~800ms (main thread blocked by parsing)

### After Phase 1 (Extract Inline Scripts)
- **Performance**: 50-65 (+10)
- **FCP**: ~2.0s (-0.5s)
- **TBT**: ~600ms (-200ms)

### After Phase 2 (Optimize Loading)
- **Performance**: 60-75 (+15)
- **FCP**: ~1.5s (-0.5s)
- **LCP**: ~2.8s (-0.7s)

### After Phase 3 (Code Splitting)
- **Performance**: 75-85 (+15)
- **FCP**: ~1.2s (-0.3s)
- **LCP**: ~2.2s (-0.6s)
- **TBT**: ~300ms (-300ms)

### After Phase 4 (CSS Optimization)
- **Performance**: 80-90 (+5-10)
- **FCP**: ~1.0s (-0.2s)

---

## 🔒 TESTING CHECKLIST (BEFORE ANY DEPLOY)

### Critical Functionality
- [ ] Homepage loads without errors
- [ ] Package cards display correctly
- [ ] "Add to Cart" buttons work
- [ ] Cart drawer opens and updates
- [ ] Checkout flow initiates
- [ ] Reviews carousel rotates
- [ ] Booking modal opens
- [ ] Promo code validation works
- [ ] Stripe integration loads
- [ ] Facebook Pixel fires
- [ ] API calls route to correct deployments
- [ ] No 404 errors in console

### API Endpoints (test all)
- [ ] `/api/bundles-data` returns packages
- [ ] `/api/shop` handles cart operations
- [ ] `/api/reviews` returns testimonials
- [ ] `/api/quote` accepts inquiries
- [ ] `/api/promo_validate` checks codes
- [ ] `/api/schedule-appointment` books appointments
- [ ] `/api/get-availability` returns calendar

### Browser Compatibility
- [ ] Chrome/Edge (latest)
- [ ] Firefox (latest)
- [ ] Safari (iOS + macOS)
- [ ] Mobile browsers (iOS Safari, Chrome Android)

---

## 📝 IMPLEMENTATION NOTES

**DO**:
- ✅ Extract non-critical inline scripts to external files
- ✅ Add `defer` attribute to script tags
- ✅ Lazy load third-party scripts (Stripe, Facebook)
- ✅ Use Intersection Observer for below-fold content
- ✅ Split large bundles into smaller modules
- ✅ Test thoroughly after each change

**DON'T**:
- ❌ Change endpoint URLs or routing logic
- ❌ Modify fetch shim rewrite rules
- ❌ Remove early fetch shim (prevents 404s)
- ❌ Change SHOP_ORIGIN or SCHED_ORIGIN values
- ❌ Alter API path patterns (`/api/shop`, `/api/bundles-data`, etc.)
- ❌ Deploy without testing all critical flows
- ❌ Optimize prematurely - measure first

---

## 🎬 NEXT STEPS

1. **Measure Current Performance**
   - Run Lighthouse audit on live page
   - Record baseline metrics (FCP, LCP, TBT, CLS)
   - Capture waterfall in DevTools

2. **Start with Phase 1** (safest)
   - Extract tracking code to external file
   - Test all functionality
   - Deploy and measure improvement

3. **Iterate Carefully**
   - One phase at a time
   - Test between phases
   - Rollback plan ready

4. **Monitor Production**
   - Check error logs after deploy
   - Verify API success rates
   - Monitor conversion metrics

---

**End of Analysis** - Ready to proceed with optimizations when approved.
