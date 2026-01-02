# Lighthouse Performance Baseline - bundles.html

## Current State (Pre-Optimization)
- **Reported Score**: ~61 (mobile)
- **File Size**: 4,715 lines (estimated ~235 KB uncompressed)
- **Analysis Date**: Pre-optimization

## Performance Bottleneck Analysis

### Top 5 Performance Issues (Evidence-Based)

#### 1. **Massive Inline JavaScript Blocking (CRITICAL)**
- **Location**: Lines 1309-4588
- **Size**: ~3,280 lines of inline JavaScript (~165 KB estimated)
- **Impact**: Blocks main thread, delays FCP/LCP by ~800-1200ms
- **Evidence**:
  - Line 1309: Starts `<script defer>` with entire app logic
  - Contains full cart system, checkout flow, calendar rendering, review carousel
  - Includes duplicate Meta Pixel logic (lines 1315-1320)
  - Heavy DOM manipulation functions (renderShop, renderCheckout, etc.)
- **Risk**: High - Moving this could break functionality if not tested
- **Recommendation**: Extract to external `/bundles-app-inline.js` with defer attribute

#### 2. **Early Fetch Shim Overhead (HIGH)**
- **Location**: Lines 13-219 (207 lines before any content)
- **Impact**: Delays initial render by ~150-250ms
- **Evidence**:
  - Synchronous script execution before `<body>`
  - API endpoint rewriting logic runs before user sees anything
  - Blocks HTML parsing until completion
- **Risk**: Medium - Required for API calls, but timing is wrong
- **Recommendation**: Move to end of `<body>` or make async with careful load order

#### 3. **Font Loading Strategy (MEDIUM)**
- **Location**: Line 536
- **Current Method**: `media="print" onload="this.media='all'"` hack
- **Impact**: 100-200ms delay in text rendering, potential CLS
- **Evidence**:
  ```html
  <link rel="stylesheet" 
        href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;900&display=swap" 
        media="print" onload="this.media='all'">
  ```
  - `font-display: swap` already set (good!)
  - But async load causes FOUT (Flash of Unstyled Text)
- **Risk**: Low - Font swap is already graceful
- **Recommendation**: Add `font-display: optional` for faster perceived performance

#### 4. **No Image Lazy Loading (MEDIUM)**
- **Location**: Throughout document (grep found images at lines 602, etc.)
- **Impact**: ~300-500ms wasted loading below-fold images
- **Evidence**:
  - Logo has `fetchpriority="high"` (correct for LCP candidate)
  - Other images likely lack `loading="lazy"` attribute
  - Bundle images, review avatars, icons all load eagerly
- **Risk**: Very Low - Adding lazy loading is safe
- **Recommendation**: Add `loading="lazy"` to all non-critical images

#### 5. **Calendar Rendering Logic in Main Thread (MEDIUM)**
- **Location**: Lines 3527-4588 (calendar widget, time slots, scheduling)
- **Impact**: ~200-400ms blocking during initial load
- **Evidence**:
  - Complex date calculations (`renderCalendar()`, `updateTimeSlots()`)
  - DOM-heavy operations for calendar grid generation
  - Runs inline, not deferred or web-worker-eligible
  - **December Bug Location**: Calendar rendering generates day numbers without spacing constraints
- **Risk**: Medium - Calendar is critical for order success flow
- **Recommendation**: Defer calendar initialization until user interaction

---

## December Calendar Bug Analysis

### Bug Description
- **Issue**: Double-digit dates (10-31) in December render vertically stacked on mobile
- **Example**: "10" displays as "1" on top of "0" instead of side-by-side
- **Affected Dates**: 10, 11, 12, ... 30, 31 (all double-digit days)
- **Platform**: Mobile only (viewport < 768px likely)

### Root Cause (Predicted)
Calendar day cells likely have:
```css
.cal-day {
  padding: 12px;
  font-size: 14px;
  /* Missing: white-space: nowrap; */
  /* OR: width too narrow for 2 digits */
}
```

### Fix Strategy
1. **Find calendar grid CSS** (not yet located in HTML head)
2. **Add December-specific class** dynamically:
   ```javascript
   // In renderCalendar() function (around line 3700)
   if (currentMonth === 11) { // December is month 11
     cal.classList.add('is-december');
   }
   ```
3. **Add mobile-only CSS**:
   ```css
   @media (max-width: 767px) {
     .is-december .cal-day {
       white-space: nowrap;
       min-width: 40px; /* Force room for 2 digits */
       line-height: 1;
     }
   }
   ```

---

## Estimated Performance Gains

### Phase 1: Quick Wins (Low Risk)
| Change | Expected Gain | Risk | Effort |
|--------|---------------|------|--------|
| Extract inline JS to external file | +8-12 points | Low | 30 min |
| Add lazy loading to images | +3-5 points | Very Low | 15 min |
| Defer fetch shim to end of body | +2-4 points | Medium | 20 min |
| Font-display: optional | +1-2 points | Low | 5 min |

**Total Estimated Gain**: +14-23 points (score 61 → 75-84)

### Phase 2: December Calendar Fix
| Change | Expected Gain | Risk | Effort |
|--------|---------------|------|--------|
| Add .is-december class + CSS | 0 points (UX fix) | Very Low | 10 min |

---

## Next Steps

### Before Making Changes
1. ✅ **Baseline documented** (this file)
2. ⏳ **Identify all `<img>` tags** for lazy loading
3. ⏳ **Locate inline styles/scripts** to optimize
4. ⏳ **Test calendar rendering** in December view

### Implementation Order
1. **Phase 1A**: Extract inline JS (biggest win, moderate risk)
2. **Phase 1B**: Add image lazy loading (safe, quick)
3. **Phase 1C**: Move fetch shim to bottom (test API calls work)
4. **Phase 1D**: Update font-display strategy
5. **Phase 2**: Fix December calendar stacking
6. **Verification**: Re-run Lighthouse, smoke test all flows

---

## Files to Modify
- `bundles.html` (primary target)
- Create: `bundles-app-inline.js` (extracted JavaScript)
- Test: Checkout flow, calendar scheduling, cart operations

## Testing Checklist
- [ ] Checkout completes successfully
- [ ] Cart add/remove works
- [ ] Calendar loads and date selection works
- [ ] December mobile calendar shows "10" correctly
- [ ] Order details modal opens
- [ ] Promo code validation works
- [ ] No console errors on page load
