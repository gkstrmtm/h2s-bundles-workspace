# SUCCESS PAGE GUARDRAILS - READ BEFORE TOUCHING

## CRITICAL RULE: DO NOT DEPLOY SUCCESS PAGE CHANGES WITHOUT USER APPROVAL

### The Problem We Keep Creating:
**STACKED PAGES** - Success page content appears WITH shop content below it (two full pages stacked vertically)

### Root Cause:
- Success page writes HTML into `#outlet` 
- Shop HTML elements (header, hero, sections, footer) are SIBLINGS of `#outlet`
- If shop elements aren't hidden, both pages render at once

### Current Known-Working State:
**Deployment**: h2s-bundles-frontend-6wsndd0ph-tabari-ropers-projects-6f2e090b.vercel.app (5h old, commit 416bcb1)
- **Status**: Works but has white screen delay
- **URL**: shop.home2smart.com

---

## WHAT NOT TO DO:

### ❌ DO NOT add pre-renderers or overlays without checking if they HIDE shop content
### ❌ DO NOT modify bundles.html success logic without user testing first  
### ❌ DO NOT assume CSS in `<head>` will hide content if parse-time scripts override it
### ❌ DO NOT deploy "fixes" for white screen without validating stacked pages don't return

---

## IF YOU MUST CHANGE SUCCESS PAGE:

1. **ASK USER FIRST** - Describe exact change, get approval
2. **TEST LOCALLY** - User must verify no stacked pages
3. **DEPLOY TO TEST URL** - User tests before aliasing to shop.home2smart.com
4. **VERIFY BOTH**:
   - ✅ No white screen flash
   - ✅ No stacked pages (shop content hidden)

---

## Known Solutions That Failed:

### Attempt 1: CSS in `<head>` with `data-success-mode`
- Added CSS to hide `.header, .hero, .section, .footer` when `html[data-success-mode]` is set
- **Result**: UNKNOWN - reverted before testing

### Attempt 2: Parse-time pre-renderer overlay
- Added `#success-pre-overlay` fixed overlay in `<body>` 
- **Result**: BROUGHT BACK STACKED PAGES - reverted immediately

---

## Current Task:
User wants white screen eliminated WITHOUT breaking the working state.

**BEFORE ANY CHANGES**: User must describe the EXACT problem they see and approve the solution approach.
