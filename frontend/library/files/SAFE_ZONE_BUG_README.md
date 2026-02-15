# Safe Zone Inconsistency Fix (2026-01-28)

## The Bug
The **Safe Zone** overlay in the Editor (`Dash.html`) was displaying a much larger area than the actual Frontend Tile (`bundles.html`). 
- **Editor**: Showed TV + Wall + Table + Floor (Loose Crop)
- **Frontend**: Showed JUST the TV screen (Tight Crop)

This led to user confusion where they thought their image was safe, but it was being cropped aggressively on the live site.

## The Root Cause
The Safe Zone logic in `Dash.html` was:
1. Taking the correct aspect ratio (4:3).
2. BUT, it was **scaling** the box to fill ~85% of the editor container (`Math.min(containerWidth * 0.85 ...)`).
3. This "fit to screen" logic made the box huge (e.g., 600px wide) relative to the image, misleading the user about the actual 160x120px pixel density required.

## The Fix
We enforced **EXACT** pixel dimensions in `Dash.html`.
- **File**: `Dash.html` ~line 20108
- **Logic**: Removed all scaling/fitting math.
- **Code**:
  ```javascript
  // OLD (Broken): Scale to fit container
  // const scale = Math.min(...)
  // safeWidth = targetDims.width * scale;
  
  // NEW (Fixed): Use exact frontend pixels
  let safeWidth = targetDims.width; // e.g., 160
  let safeHeight = targetDims.height; // e.g., 120
  
  rect.style.width = `${safeWidth}px`;
  rect.style.height = `${safeHeight}px`;
  ```

## System Setup & Deployment Guide

### Prerequisites
- Node.js (v18+)
- PowerShell (v7+)
- Vercel CLI (logged in)

### 1. Environment Setup
To replicate this environment:
```powershell
# Clone the repository (if not already)
git clone <repository-url>
cd h2s-bundles-workspace

# Install dependencies
npm install

# Ensure Vercel is linked
vercel link
```

### 2. Deployment
To deploy the fix and verify it immediately:

**Frontend (Portal/Editor):**
Run the automated deployment script which handles build, deploy, and HTTP 200 verification.
```powershell
./deploy-frontend-and-verify.ps1
```
*Target URL:* `https://portal.home2smart.com/dash`

**Backend (API):**
If API changes are needed (not for this specific UI fix):
```powershell
./deploy-backend-and-verify.ps1
```

### 3. Verification
1. Open `https://portal.home2smart.com/dash`
2. Click any editable asset.
3. Observe the **yellow Safe Zone box**.
4. **PASS CRITERIA**: The box should be small (approx 160x120 screen pixels) and tightly frame the area that will appear on the frontend. It should NOT fill the screen.

## Current Status
- **Fix Applied**: `Dash.html` updated.
- **Deployed**: Verified live at `https://portal.home2smart.com/dash`.
- **Git**: Changes committed to local workspace.
