# Portal Build Identifier Specification

**Status:** Draft  
**Date:** January 14, 2026  
**Purpose:** Implement an unavoidable build identifier to detect stale cache issues and verify deployed code

---

## Overview

This specification defines a build identifier system that:
- Proves exactly what HTML the browser is running
- Makes stale cache immediately obvious to both humans and automated systems
- Provides simple verification commands for deployment validation

---

## Build ID Format

```
PORTAL_BUILD_<YYYYMMDD>_<HHMM>_<shortsha>
```

**Components:**
- `YYYYMMDD`: Build date (e.g., `20260114`)
- `HHMM`: Build time in 24-hour format (e.g., `1425`)
- `shortsha`: First 7 characters of git commit SHA (e.g., `a3f7b2c`)

**Example:**
```
PORTAL_BUILD_20260114_1425_a3f7b2c
```

---

## Implementation Steps

### Step 1: Generate Build ID at Build/Deploy Time

**Location:** Build script or deployment script

**PowerShell Implementation:**
```powershell
# Generate build ID
$buildDate = Get-Date -Format "yyyyMMdd_HHmm"
$gitSha = (git rev-parse --short=7 HEAD).Trim()
$buildId = "PORTAL_BUILD_${buildDate}_${gitSha}"

Write-Host "Generated Build ID: $buildId"
```

**Node.js Implementation:**
```javascript
// In build script (e.g., build-portal.js)
const { execSync } = require('child_process');

function generateBuildId() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const time = now.toTimeString().slice(0, 5).replace(':', '');
  const sha = execSync('git rev-parse --short=7 HEAD').toString().trim();
  return `PORTAL_BUILD_${date}_${time}_${sha}`;
}

const BUILD_ID = generateBuildId();
console.log('Build ID:', BUILD_ID);
```

---

### Step 2: Inject Build ID into portal.html

**Injection Method:** String replacement during build/deploy

The build script should replace a placeholder token in `portal.html` with the actual build ID.

**Placeholder in portal.html:**
```html
<!-- BUILD_ID_PLACEHOLDER -->
```

**After injection, this becomes:**
```html
<!-- PORTAL_BUILD_20260114_1425_a3f7b2c -->
```

**Implementation in build script:**
```powershell
# PowerShell
$buildId = "PORTAL_BUILD_${buildDate}_${gitSha}"
$htmlContent = Get-Content "portal.html" -Raw
$htmlContent = $htmlContent -replace "<!-- BUILD_ID_PLACEHOLDER -->", "<!-- $buildId -->"
$htmlContent = $htmlContent -replace "{{BUILD_ID}}", $buildId
Set-Content "portal.html" -Value $htmlContent
```

---

### Step 3: Add Meta Tag in HTML Head

**Location:** `<head>` section of `portal.html`

**Add this line:**
```html
<meta name="portal-build" content="{{BUILD_ID}}">
```

**After build injection:**
```html
<meta name="portal-build" content="PORTAL_BUILD_20260114_1425_a3f7b2c">
```

**Placement recommendation:**
```html
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="portal-build" content="{{BUILD_ID}}">
  <title>Home2Smart Portal</title>
  <!-- ... rest of head ... -->
</head>
```

---

### Step 4: Add Console Log on Page Load

**Location:** Early in the `<script>` section, before any other initialization

**Implementation:**
```javascript
// Add at the very top of your main script block
(function() {
  const buildId = document.querySelector('meta[name="portal-build"]')?.content || 'UNKNOWN';
  console.log(`%c🔨 ${buildId}`, 'color: #00ff00; font-weight: bold; font-size: 14px;');
  console.log(`Deployed: ${buildId.split('_')[2]}_${buildId.split('_')[3]}`);
  console.log(`Commit: ${buildId.split('_')[4]}`);
  
  // Store globally for later use
  window.PORTAL_BUILD_ID = buildId;
})();
```

**Alternative simpler version:**
```javascript
console.log('PORTAL_BUILD=' + (document.querySelector('meta[name="portal-build"]')?.content || 'UNKNOWN'));
```

---

### Step 5: Display in Footer

**Location:** Footer section of `portal.html`

**Add this element:**
```html
<footer style="position: fixed; bottom: 0; right: 0; padding: 8px 12px; 
               background: rgba(0,0,0,0.7); color: #888; font-size: 11px; 
               font-family: monospace; z-index: 1000; border-radius: 4px 0 0 0;">
  Build: <span id="build-id-display">{{BUILD_ID}}</span>
</footer>
```

**JavaScript to populate (if using meta tag as source):**
```javascript
document.addEventListener('DOMContentLoaded', function() {
  const buildId = document.querySelector('meta[name="portal-build"]')?.content;
  const displayElement = document.getElementById('build-id-display');
  if (displayElement && buildId) {
    displayElement.textContent = buildId;
  }
});
```

---

## Verification Procedures

### Remote Verification (Production)

**PowerShell:**
```powershell
# Check what the server is serving
$response = Invoke-WebRequest -Uri "https://portal.home2smart.com/portal.html" -UseBasicParsing
$response.Content | Select-String "PORTAL_BUILD_"

# One-liner
(Invoke-WebRequest -Uri "https://portal.home2smart.com/portal.html" -UseBasicParsing).Content | Select-String "PORTAL_BUILD_"
```

**curl (if available):**
```bash
curl -s https://portal.home2smart.com/portal.html | findstr PORTAL_BUILD
```

**Expected output:**
```
<meta name="portal-build" content="PORTAL_BUILD_20260114_1425_a3f7b2c">
  Build: <span id="build-id-display">PORTAL_BUILD_20260114_1425_a3f7b2c</span>
```

### Local File Verification

**PowerShell:**
```powershell
Get-Content "portal.html" | Select-String "PORTAL_BUILD_"
```

### Browser Verification

1. Open Developer Console (F12)
2. Look for the console log: `🔨 PORTAL_BUILD_...`
3. Check footer in bottom-right corner
4. Verify meta tag:
   ```javascript
   document.querySelector('meta[name="portal-build"]').content
   ```

---

## Stale Cache Detector (Optional Enhancement)

### Implementation

**Add this script after the page loads:**

```javascript
async function checkForStaleCache() {
  try {
    const localBuildId = window.PORTAL_BUILD_ID || 
                         document.querySelector('meta[name="portal-build"]')?.content;
    
    if (!localBuildId || localBuildId === 'UNKNOWN' || localBuildId.includes('{{')) {
      console.warn('⚠️ No build ID found - running in dev mode?');
      return;
    }

    // Fetch the live portal.html and extract build ID
    const response = await fetch('/portal.html?cache-bust=' + Date.now(), {
      cache: 'no-store'
    });
    const html = await response.text();
    const match = html.match(/PORTAL_BUILD_\d{8}_\d{4}_[a-f0-9]{7}/);
    const serverBuildId = match ? match[0] : null;

    if (!serverBuildId) {
      console.warn('⚠️ Could not detect server build ID');
      return;
    }

    console.log('🔍 Cache Check:', {
      local: localBuildId,
      server: serverBuildId,
      match: localBuildId === serverBuildId
    });

    if (localBuildId !== serverBuildId) {
      showStaleCacheBanner(localBuildId, serverBuildId);
    }
  } catch (error) {
    console.error('Failed to check build ID:', error);
  }
}

function showStaleCacheBanner(localId, serverId) {
  const banner = document.createElement('div');
  banner.id = 'stale-cache-banner';
  banner.innerHTML = `
    <div style="position: fixed; top: 0; left: 0; right: 0; 
                background: #ff6b6b; color: white; padding: 12px; 
                text-align: center; z-index: 10000; font-family: system-ui;
                box-shadow: 0 2px 8px rgba(0,0,0,0.3);">
      <strong>⚠️ Stale Cache Detected</strong><br>
      <span style="font-size: 13px;">
        Your browser: <code style="background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 3px;">${localId}</code><br>
        Server has: <code style="background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 3px;">${serverId}</code><br>
        <button onclick="location.reload(true)" 
                style="margin-top: 8px; padding: 6px 16px; background: white; 
                       color: #ff6b6b; border: none; border-radius: 4px; 
                       font-weight: bold; cursor: pointer;">
          Clear Cache & Reload
        </button>
      </span>
    </div>
  `;
  document.body.insertBefore(banner, document.body.firstChild);
}

// Run check after page load (wait 2 seconds to avoid blocking initial render)
setTimeout(checkForStaleCache, 2000);
```

---

## Build Script Integration

### Example: deploy-portal.ps1

```powershell
# Generate Build ID
$buildDate = Get-Date -Format "yyyyMMdd_HHmm"
$gitSha = (git rev-parse --short=7 HEAD).Trim()
$buildId = "PORTAL_BUILD_${buildDate}_${gitSha}"

Write-Host "================================================"
Write-Host "Building Portal with ID: $buildId"
Write-Host "================================================"

# Read portal.html
$htmlContent = Get-Content "portal.html" -Raw

# Replace all instances of {{BUILD_ID}}
$htmlContent = $htmlContent -replace "\{\{BUILD_ID\}\}", $buildId

# Write to temp file
$tempFile = "portal.build.html"
Set-Content $tempFile -Value $htmlContent

Write-Host "✓ Build ID injected into $tempFile"
Write-Host "✓ Ready for deployment"

# Deploy (example - adjust to your deployment method)
# scp $tempFile user@server:/var/www/portal.html
```

---

## Acceptance Criteria

### ✅ Build ID Generation
- [ ] Build ID follows format: `PORTAL_BUILD_<YYYYMMDD>_<HHMM>_<shortsha>`
- [ ] Build ID is unique per deployment
- [ ] Git SHA is accurate and matches deployed commit

### ✅ HTML Integration
- [ ] Meta tag exists: `<meta name="portal-build" content="PORTAL_BUILD_...">`
- [ ] Meta tag is in `<head>` section
- [ ] All `{{BUILD_ID}}` placeholders are replaced

### ✅ Console Output
- [ ] Console log appears on page load
- [ ] Console log contains full build ID
- [ ] Console log is visible before other app initialization

### ✅ Footer Display
- [ ] Footer is visible in bottom-right corner
- [ ] Footer displays full build ID
- [ ] Footer is readable (not obscured by other elements)

### ✅ Verification Commands
- [ ] PowerShell command successfully retrieves build ID from production
- [ ] Retrieved build ID matches expected deployment
- [ ] Build ID can be extracted with simple string search

### ✅ Stale Cache Detection (Optional)
- [ ] Detector runs automatically after page load
- [ ] Banner appears when local ≠ server build ID
- [ ] Banner is dismissible or provides clear action
- [ ] Detection works across browser hard refresh (Ctrl+F5)

---

## Rollout Plan

### Phase 1: Add Placeholder (Safe)
1. Add `{{BUILD_ID}}` placeholders to portal.html
2. Add meta tag with placeholder
3. Add console log that reads from meta tag
4. Add footer with placeholder
5. Deploy - placeholders will be visible but harmless

### Phase 2: Build Script Integration
1. Create/update build script to inject build ID
2. Test locally with a test build
3. Verify all three locations show the same ID

### Phase 3: Production Deployment
1. Deploy with build ID injection enabled
2. Verify with curl/PowerShell command
3. Open portal in browser, verify footer + console
4. Document the build ID for this deployment

### Phase 4: Add Stale Cache Detector (Optional)
1. Add detection script to portal.html
2. Test by deploying, then serving old cached version
3. Verify banner appears correctly

---

## Troubleshooting

### Issue: Build ID shows as `{{BUILD_ID}}`
**Cause:** Build script didn't run or failed to replace placeholder  
**Fix:** Check build script execution, verify string replacement logic

### Issue: Different build IDs in console vs footer
**Cause:** Inconsistent injection or meta tag not updated  
**Fix:** Ensure all `{{BUILD_ID}}` tokens are replaced in a single pass

### Issue: Cannot find build ID with curl
**Cause:** CDN/proxy cache serving old version  
**Fix:** Add cache-busting parameter or wait for CDN cache expiry

### Issue: Stale detector always triggers
**Cause:** Regex not matching or server returning different format  
**Fix:** Verify regex pattern matches exact format, check response content-type

---

## Future Enhancements

- **Build Manifest API:** Create a `/api/build-info` endpoint returning JSON
- **Build History:** Track deployment history in a separate file
- **Environment Indicators:** Different colors for dev/staging/production
- **Auto-refresh:** Automatically reload when stale cache detected (after user confirmation)
- **Service Worker:** Integrate with service worker for better cache control

---

## References

- Git SHA retrieval: `git rev-parse --short=7 HEAD`
- PowerShell date format: `Get-Date -Format "yyyyMMdd_HHmm"`
- Meta tags: [MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/meta)
- Cache-Control headers: Consider adding for stricter cache management

---

**Document Version:** 1.0  
**Last Updated:** January 14, 2026
