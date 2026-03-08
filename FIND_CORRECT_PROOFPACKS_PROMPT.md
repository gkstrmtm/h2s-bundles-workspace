# Find Correct ProofPacks Version - Search Prompt

## CONTEXT

We have a **version regression problem** with the ProofPacks tab in our dashboard. The current deployed version (212KB skeleton) is NOT the correct one. We need to locate a previous deployment where the ProofPacks editor functionality was working perfectly.

## THE PERFECT VERSION HAD:

### ✅ Working Features:
1. **Hero Banner Framing** - Images displayed with proper framing (no cutoff, full image visible)
2. **Editor Functionality** - Click-to-edit worked correctly from both:
   - Library grid (right-click or click asset)
   - "Live on Bundles Page" preview section
3. **Instant Reflection** - Edits saved and immediately reflected on shop.home2smart.com/bundles
4. **Cross-Session State** - Framing changes persisted after refresh/logout
5. **Transform Sync** - `smart_crop_details` (pan, tilt, scale) applied identically on dash editor AND bundles page
6. **Drag-to-Reposition** - Could drag image within frame to adjust position
7. **Save Framing Button** - Updated backend with new crop data

### 🚫 What's Broken Now:
- Images are cut off or improperly framed
- Editor might not open when clicking assets
- Framing changes don't persist or don't sync to bundles page
- Communication between dashboard → backend → bundles page is broken

## CONSTRAINTS - CRITICAL MERGE STRATEGY

### ✅ What to KEEP from Current File (212KB skeleton):
- **All Other Tabs**: Jobs, Candidates, Checkout, Dispatch, Funnel, Admin Dashboard, etc.
- **Navigation System**: Tab switching, sidebar, header
- **Offer Library**: Any library/system outside of ProofPacks
- **Backend Integrations**: API connections for non-ProofPacks features
- **Auth/Login**: User authentication system

### 🎯 What to EXTRACT from Old Working Deployment:
- **ONLY the ProofPacks Tab** (`#proofpacks-pane` section)
- **ProofPacks JavaScript**: Functions like `beginEditAssetMedia()`, `editAssetFromLive()`, `buildProofMediaStyle()`
- **ProofPacks CSS**: Styles specific to `.pp-*` classes (pp-library-grid, pp-editor-modal, etc.)
- **ProofPacks Backend Calls**: API logic for `/api/admin/proof-assets`, `/api/proof-slots`

### 📋 Merge Plan:
When you find the working version, you'll have TWO files to merge:
1. **File A** (current 212KB): Everything EXCEPT ProofPacks tab
2. **File B** (old deployment): ONLY the ProofPacks tab

The final result = File A (other tabs) + File B (ProofPacks tab)

## YOUR TASK

Create an **organized MD file** with Vercel deployment history that lets the user click through old versions to find when ProofPacks was working.

### Step 1: Fetch Vercel Deployments

```bash
cd c:\Users\tabar\h2s-bundles-workspace\frontend
vercel ls --yes
```

Get the last **50-100 deployments** from the `h2s-bundles-frontend` project.

### Step 2: Organize by Timeframe

Group deployments into time windows based on when the issue likely started:

- **Last 24 hours** - Recent (probably broken)
- **2-7 days ago** - Recent developments
- **1-2 weeks ago** - Likely candidate window
- **2-4 weeks ago** - Earlier stable version
- **1-2 months ago** - Original working version

### Step 3: Create MD File Structure

Generate a file: `PROOFPACKS_DEPLOYMENT_HISTORY.md`

```markdown
# ProofPacks Version History - Click to Test

## How to Use This File
1. Click a deployment URL below
2. Navigate to the ProofPacks tab
3. Test these features:
   - [ ] Click an asset in library → Editor opens
   - [ ] Drag to reposition image
   - [ ] Click "Save Framing"
   - [ ] Go to shop.home2smart.com/bundles
   - [ ] Verify framing matches what you set in editor
4. If it works perfectly, note the deployment ID
5. **IMPORTANT**: Check that OTHER tabs (Jobs, Candidates, etc.) still work in current file - we're keeping those

---

## Quick Reference: What Each File Is For

| File | Purpose | Keep/Replace |
|------|---------|--------------|
| **Current dash.html (212KB)** | All tabs EXCEPT ProofPacks are good | ✅ KEEP all non-ProofPacks code |
| **Old deployment URL** | ProofPacks tab was working here | 🎯 EXTRACT only ProofPacks tab |
| **Final merged dash.html** | Best of both worlds | ✅ Other tabs from current + ProofPacks from old |

---

## Last 24 Hours (Probably Broken)

### Deployment: abc123xyz (2026-02-22 11:45 PM)
- **URL**: https://h2s-bundles-frontend-abc123xyz-tabari-ropers-projects-6f2e090b.vercel.app/dash
- **Size**: 212.8 KB (skeleton version)
- **Status**: ❌ Known broken - just deployed
- **Notes**: Reverted to 204KB skeleton, missing editor functionality

### Deployment: def456uvw (2026-02-22 9:30 PM)
- **URL**: https://h2s-bundles-frontend-def456uvw-tabari-ropers-projects-6f2e090b.vercel.app/dash
- **Size**: 1609 KB (full dashpp.html)
- **Status**: ⚠️ Wrong version - too much stuff
- **Notes**: Deployed wrong file with extra features

---

## 2-7 Days Ago (Recent Changes)

### Deployment: ghi789rst (2026-02-21 8:15 PM)
- **URL**: https://h2s-bundles-frontend-ghi789rst-tabari-ropers-projects-6f2e090b.vercel.app/dash
- **Notes**: Check if editor opens, test framing

### Deployment: jkl012mno (2026-02-21 2:40 PM)
- **URL**: https://h2s-bundles-frontend-jkl012mno-tabari-ropers-projects-6f2e090b.vercel.app/dash
- **Notes**: Verify transform sync with bundles page

---

## 1-2 Weeks Ago (Likely Working Version)

### Deployment: pqr345stu (2026-02-15 10:20 AM)
- **URL**: https://h2s-bundles-frontend-pqr345stu-tabari-ropers-projects-6f2e090b.vercel.app/dash
- **Notes**: HIGH PRIORITY - check this timeframe first

### Deployment: vwx678yza (2026-02-14 5:30 PM)
- **URL**: https://h2s-bundles-frontend-vwx678yza-tabari-ropers-projects-6f2e090b.vercel.app/dash
- **Notes**: Test hero banner framing

---

## 2-4 Weeks Ago (Earlier Stable)

### Deployment: bcd901efg (2026-02-08 3:15 PM)
- **URL**: https://h2s-bundles-frontend-bcd901efg-tabari-ropers-projects-6f2e090b.vercel.app/dash
- **Notes**: Original implementation?

---

## How to Download Correct Version

Once you find the working deployment:

```bash
# Get the deployment ID from the URL
# Example: h2s-bundles-frontend-pqr345stu-tabari... → pqr345stu is the ID

cd c:\Users\tabar\h2s-bundles-workspace\frontend

# Download the file from that deployment
vercel inspect <DEPLOYMENT_ID> --yes

# Or manually download from browser:
# 1. Open working deployment URL
# 2. Right-click → View Page Source
# 3. Save entire HTML to: frontend/dash-WORKING.html
```

Then compare with current version to see what changed.
```

### Step 4: Add Technical Details Section

Include this at the end of the MD file:

```markdown
---

## File Structure Guide - What Goes Where

### Current File (212KB) Contains:
```
dash.html (KEEP THESE PARTS)
├── HTML Structure
│   ├── <div class="pane" id="jobs-pane"> ✅ KEEP
│   ├── <div class="pane" id="candidates-pane"> ✅ KEEP
│   ├── <div class="pane" id="checkout-pane"> ✅ KEEP
│   ├── <div class="pane" id="dispatch-pane"> ✅ KEEP
│   ├── <div class="pane" id="admin-pane"> ✅ KEEP
│   └── <div class="pane" id="proofpacks-pane"> ❌ REPLACE THIS
│
├── JavaScript
│   ├── const jobsManager = {...} ✅ KEEP
│   ├── const candidateManager = {...} ✅ KEEP
│   ├── const checkoutManager = {...} ✅ KEEP
│   └── const proofPacks = {...} ❌ REPLACE THIS
│
└── CSS
    ├── .nav-* styles ✅ KEEP
    ├── .pane styles ✅ KEEP
    ├── .card, .btn general styles ✅ KEEP
    └── .pp-* ProofPacks styles ❌ REPLACE THIS
```

### Working File (from old deployment) - Extract:
```
dash-WORKING.html (EXTRACT ONLY PROOFPACKS)
├── HTML: ONLY <div id="proofpacks-pane">...</div>
├── JavaScript: ONLY const proofPacks = {...}
└── CSS: ONLY .pp-* styles
```

### Final Merged File Structure:
```
dash.html (FINAL)
├── All other tabs (from current file) ✅
├── ProofPacks tab (from working file) ✅
├── All other JavaScript (from current file) ✅
├── ProofPacks JavaScript (from working file) ✅
├── Global CSS (from current file) ✅
└── ProofPacks CSS (from working file) ✅
```

---

## Technical Details - What to Look For

### JavaScript Functions That Must Exist:

```javascript
// In the working version, these functions should be present:
proofPacks.beginEditAssetMedia(assetId)
proofPacks.editAssetFromLive(assetId, placement)
proofPacks.buildProofMediaStyle(asset)
proofPacks.refreshLivePreview()
```

### HTML Elements That Must Exist:

```html
<!-- Library grid -->
<div class="pp-library-grid" id="ppAssetsGrid"></div>

<!-- Live preview section -->
<div id="ppLivePreviewContent"></div>

<!-- Editor modal -->
<div id="ppLibraryEditor" class="pp-editor-modal is-hidden"></div>
```

### Click Handlers to Verify:

1. **Library Item Click**:
   ```html
   onclick="proofPacks.beginEditAssetMedia('asset-id')"
   ```

2. **Live Preview Click**:
   ```html
   onclick="proofPacks.editAssetFromLive('asset-id', 'hero')"
   ```

3. **Right-Click Context Menu**:
   ```html
   oncontextmenu="proofPacks.showLibraryContextMenu(event, 'asset-id'); return false;"
   ```

### Backend API Endpoints Used:

- `GET /api/admin/proof-assets` - Fetch library assets
- `GET /api/proof-slots?surface=bundles` - Get live bundles page data
- `POST /api/admin/proof-asset-edit` - Save framing changes
- `GET /api/proof-asset-media?bucket=proof&path=...` - Load images

### Transform Logic to Verify:

The working version should apply transforms like this:

```javascript
// In buildProofMediaStyle(asset):
const geom = asset.smart_crop_details?.geometry;
const panX = geom?.pan_x_pct ?? 0;
const panY = geom?.pan_y_pct ?? 0;
const tilt = geom?.tilt_deg ?? 0;
const scale = geom?.scale_pct ?? 100;

// Applied as:
transform: `translate(${panX}%, ${panY}%) rotate(${tilt}deg) scale(${scale / 100}) translateZ(0)`
```

This MUST match between:
- Dash editor preview
- Dash library card thumbnails
- Live bundles page rendering

---

## Next Steps After Finding Working Version

### Step 1: Save Both Files

```bash
cd c:\Users\tabar\h2s-bundles-workspace\frontend

# Current file (good for all other tabs)
Copy-Item dash.html dash-CURRENT-OTHER-TABS.html -Force

# Download working ProofPacks version from deployment
# Right-click → View Source → Save as dash-WORKING-PROOFPACKS.html
```

### Step 2: Identify ProofPacks Tab Boundaries

Open `dash-WORKING-PROOFPACKS.html` and find these markers:

**Start of ProofPacks Tab**:
```html
<!-- PROOF PACKS PANE -->
<div class="pane" id="proofpacks-pane">
```

**End of ProofPacks Tab**:
```html
</div> <!-- end #proofpacks-pane -->
```

Also look for ProofPacks JavaScript (usually near bottom):
```javascript
const proofPacks = {
    // ... all ProofPacks functions
};
```

And ProofPacks CSS:
```css
/* ProofPacks styles */
.pp-library-grid { ... }
.pp-editor-modal { ... }
.pp-video-stage { ... }
```

### Step 3: Extract ProofPacks Tab Code

Create extraction file with ONLY ProofPacks content:

```bash
# This will contain:
# 1. HTML: <div class="pane" id="proofpacks-pane">...</div>
# 2. JavaScript: const proofPacks = { ... }
# 3. CSS: .pp-* styles
```

Save to: `frontend/PROOFPACKS-TAB-ONLY.html`

### Step 4: Merge Into Current File

Open `dash-CURRENT-OTHER-TABS.html` and:

1. **Find the ProofPacks pane** (search for `id="proofpacks-pane"`)
2. **Replace ONLY that `<div class="pane" id="proofpacks-pane">...</div>` section** with the working version
3. **Find the ProofPacks JavaScript** (search for `const proofPacks = {` or `proofPacks.`)
4. **Replace ONLY the ProofPacks object/functions** with the working version
5. **Find ProofPacks CSS** (search for `.pp-library`, `.pp-editor`)
6. **Replace ONLY `.pp-*` styles** with the working version

**DO NOT TOUCH**:
- Other panes (`#jobs-pane`, `#candidates-pane`, `#checkout-pane`, etc.)
- Navigation/sidebar code
- Other tab JavaScript
- Global CSS/design system

### Step 5: Verify Merge

Check that you kept:
- ✅ All other tabs still work (Jobs, Candidates, etc.)
- ✅ Navigation/tab switching works
- ✅ ProofPacks tab now has working editor

### Step 6: Test and Deploy

```bash
# Save merged file
Copy-Item dash-CURRENT-OTHER-TABS.html dash.html -Force

# Test locally first if possible, then deploy
vercel --prod --yes
```

---

## Emergency Rollback

If you find the working version and need to deploy it NOW:

```bash
cd c:\Users\tabar\h2s-bundles-workspace\frontend

# Replace current with working version
Copy-Item dash-WORKING-[DATE].html dash.html -Force

# Deploy
vercel --prod --yes

# Verify
Invoke-WebRequest -Uri "https://portal.home2smart.com/dash" -UseBasicParsing
```
```

## OUTPUT FORMAT

**CRITICAL**: Your response MUST be a complete MD file, NOT a chat message. Structure it exactly as shown above with:

1. ✅ Clear timeframe sections
2. ✅ Clickable deployment URLs for testing
3. ✅ Notes/status for each deployment
4. ✅ Technical reference section
5. ✅ Step-by-step instructions

Save to: `c:\Users\tabar\h2s-bundles-workspace\PROOFPACKS_DEPLOYMENT_HISTORY.md`

---

## EXECUTION COMMAND

```bash
cd c:\Users\tabar\h2s-bundles-workspace\frontend
vercel ls --yes --limit 100 | ForEach-Object { 
  # Parse deployment data and generate MD file
  # Include URL, timestamp, and testing checklist
}
```

Generate the complete MD file with actual deployment data from Vercel.
