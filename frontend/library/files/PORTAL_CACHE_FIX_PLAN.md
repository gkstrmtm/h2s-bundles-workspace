# Portal.html Cache Prevention Implementation Plan

## Problem Statement
Despite successful Vercel deployments and correct aliasing, browsers serve stale cached versions of `portal.html` from January 13, causing users to see old build IDs and syntax errors that have been fixed. PowerShell/curl fetches show the correct new HTML on the server, but Chrome serves an old disk-cached copy.

## Root Cause
Vercel's default behavior allows browsers to cache HTML files. Without explicit `Cache-Control: no-store` headers, Chrome and other browsers can cache `portal.html` indefinitely across hard refreshes, service worker unregistrations, and even alias changes.

---

## Solution: Vercel.json Headers Configuration

### Step 1: Create/Update vercel.json

Add the following to `backend/vercel.json`:

```json
{
  "headers": [
    {
      "source": "/portal.html",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "no-store, no-cache, must-revalidate, max-age=0"
        },
        {
          "key": "Pragma",
          "value": "no-cache"
        },
        {
          "key": "Expires",
          "value": "0"
        },
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        }
      ]
    },
    {
      "source": "/(.*).html",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "no-store, no-cache, must-revalidate, max-age=0"
        },
        {
          "key": "Pragma",
          "value": "no-cache"
        },
        {
          "key": "Expires",
          "value": "0"
        }
      ]
    }
  ]
}
```

**Header Breakdown:**
- `Cache-Control: no-store` - Prevents ANY caching (disk, memory, CDN)
- `no-cache` - Requires revalidation before using cached copy
- `must-revalidate` - Forces revalidation of stale responses
- `max-age=0` - Expires immediately
- `Pragma: no-cache` - HTTP/1.0 backward compatibility
- `Expires: 0` - Legacy header for old browsers

**Why Both Rules:**
1. First rule specifically targets `/portal.html` (most specific)
2. Second rule catches any other HTML files as a safety net

### Step 2: Verify Existing vercel.json

Check if `backend/vercel.json` already exists:
```bash
cat backend/vercel.json
```

If it exists, **merge** the headers array with existing config. If it has `headers` already, add these rules to the existing array.

### Step 3: Deploy with Headers

```bash
cd backend
vercel --prod --yes
```

Extract deployment URL from output:
```
✅  Production: https://backend-XXXXX-tabari-ropers-projects-6f2e090b.vercel.app
```

### Step 4: Alias to Production Domains

```bash
vercel alias set backend-XXXXX-tabari-ropers-projects-6f2e090b.vercel.app h2s-backend.vercel.app
vercel alias set backend-XXXXX-tabari-ropers-projects-6f2e090b.vercel.app portal.home2smart.com
```

---

## Verification Commands

### Check Headers on Specific Deployment
```bash
curl -I https://backend-XXXXX-tabari-ropers-projects-6f2e090b.vercel.app/portal.html
```

### Check Headers on Aliased Production Domain
```bash
curl -I https://h2s-backend.vercel.app/portal.html
curl -I https://portal.home2smart.com/portal.html
```

### Expected Response Headers:
```
HTTP/2 200
cache-control: no-store, no-cache, must-revalidate, max-age=0
pragma: no-cache
expires: 0
x-vercel-cache: MISS
x-vercel-id: iad1::xxxxx
content-type: text/html; charset=utf-8
```

### Key Indicators of Success:
1. ✅ `cache-control: no-store, no-cache, must-revalidate, max-age=0`
2. ✅ `pragma: no-cache`
3. ✅ `expires: 0`
4. ✅ `x-vercel-cache: MISS` (not BYPASS, not HIT)
5. ✅ `content-type: text/html`

### Red Flags (indicates problem):
- ❌ `cache-control: public, max-age=3600` or similar
- ❌ Missing `no-store` directive
- ❌ `x-vercel-cache: HIT` (means Vercel edge is serving cached copy)

---

## Verification in Browser

### Chrome DevTools Method:
1. Open DevTools (F12)
2. Go to **Network** tab
3. Check "Disable cache" checkbox
4. Hard refresh (Ctrl+Shift+R)
5. Click on `portal.html` request
6. Check **Response Headers**:
   - Must show `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`
7. Check **Size** column:
   - Should say "from server" or actual size (e.g., "22.1 KB")
   - Must NOT say "disk cache" or "memory cache"

### PowerShell Verification:
```powershell
$response = Invoke-WebRequest -Uri 'https://portal.home2smart.com/portal.html' -UseBasicParsing
Write-Host "Cache-Control: $($response.Headers['Cache-Control'])"
Write-Host "Pragma: $($response.Headers['Pragma'])"
Write-Host "Expires: $($response.Headers['Expires'])"
$html = $response.Content
$buildId = ($html -split "`n" | Select-String -Pattern 'portal-' | Select-Object -First 1)
Write-Host "Build ID: $buildId"
```

Expected output should show:
- Cache-Control with `no-store`
- Build ID matching current timestamp format `portal-1768425XXXXX`

---

## Important Notes

### Header Precedence
If `portal.html` is served by a Next.js API route or serverless function (not static file):
- Headers set in the **function response** take precedence over `vercel.json`
- Check if `pages/portal.html.js` or similar exists
- If using Next.js middleware, headers set there override `vercel.json`

For our case: `portal.html` in `public/` directory → served as static file → `vercel.json` headers apply.

### Static Assets (JS/CSS) - DO NOT CHANGE
- Leave static assets with normal caching (we don't have hashed filenames currently)
- If we add webpack/vite with hashed builds later (e.g., `main.a3f2b1c.js`), use:
  ```json
  {
    "source": "/static/(.*)",
    "headers": [
      {
        "key": "Cache-Control",
        "value": "public, max-age=31536000, immutable"
      }
    ]
  }
  ```

### API Routes
API routes already have appropriate caching via our backend code. No changes needed.

---

## Rollback Plan

### If Headers Cause Issues:

**Immediate Rollback (under 2 minutes):**
1. Identify last working deployment:
   ```bash
   vercel ls --prod | head -20
   ```
2. Find deployment from before vercel.json change
3. Alias it back:
   ```bash
   vercel alias set backend-PREVIOUS-URL h2s-backend.vercel.app
   vercel alias set backend-PREVIOUS-URL portal.home2smart.com
   ```

**Permanent Rollback:**
1. Revert vercel.json changes:
   ```bash
   git checkout HEAD~1 backend/vercel.json
   ```
2. Deploy:
   ```bash
   cd backend
   vercel --prod --yes
   ```
3. Alias new deployment

### Symptoms That Require Rollback:
- ❌ Portal stops loading entirely (500 errors)
- ❌ Headers break Next.js routing
- ❌ Performance degradation (unlikely with these headers)

### Symptoms That Are EXPECTED (not rollback-worthy):
- ✅ Slightly slower first load (network fetch vs cache)
- ✅ More bandwidth usage (acceptable tradeoff for correctness)

---

## Acceptance Criteria

### Pre-Deployment Checks:
- [ ] `backend/vercel.json` exists with headers rules
- [ ] Headers target `/portal.html` specifically
- [ ] Headers include `no-store, no-cache, must-revalidate, max-age=0`
- [ ] Deployment command ready: `vercel --prod --yes`
- [ ] Alias commands ready for both domains

### Post-Deployment Checks:
- [ ] `curl -I https://portal.home2smart.com/portal.html` shows `Cache-Control: no-store`
- [ ] `curl -I https://h2s-backend.vercel.app/portal.html` shows same headers
- [ ] PowerShell fetch confirms headers present
- [ ] Browser DevTools shows "from server" not "disk cache"
- [ ] Dynamic build ID in footer updates on every page load
- [ ] Fresh Chrome profile (no cache) loads latest version immediately

### Final Validation (The Litmus Test):
1. Deploy a new change to portal.html (e.g., change footer text)
2. Run PowerShell verification → confirms new text
3. Open browser (existing session with old cache) → **MUST show new text**
4. Open fresh incognito window → **MUST show new text**
5. Hard refresh existing tab → **MUST show new text**

**Success Definition:**
"PowerShell sees new, browser sees old" is **impossible to reproduce**. Every browser request fetches the latest HTML from the server, regardless of cache state, service workers, or previous visits.

---

## Timeline

- **Preparation:** 5 minutes (create/update vercel.json)
- **Deployment:** 2 minutes (vercel deploy + alias)
- **Verification:** 3 minutes (curl checks + browser tests)
- **Total:** ~10 minutes

---

## Risk Assessment

**Risk Level:** **LOW**

**Why:**
- Headers are non-breaking (only affects caching, not functionality)
- No code changes to portal.html
- Easy rollback via aliasing
- Only affects HTML files, not critical API endpoints

**Worst Case:**
- Users always fetch fresh HTML (slight performance hit)
- Easily reverted via git + redeploy

**Best Case:**
- Permanent fix for cache staleness
- Every deployment immediately visible to all users
- No more "why doesn't my browser show the fix" conversations

---

## Post-Implementation Monitoring

### For Next 24 Hours:
1. Monitor Vercel deployment logs for errors
2. Check analytics for increased HTML request volume (expected)
3. Verify no user reports of portal not loading
4. Confirm build IDs in user sessions match latest deployment

### Success Metrics:
- Zero "stale cache" support tickets
- Build ID in user browsers matches production within 1 minute of deployment
- No increase in error rates

---

## Future Enhancements (Optional)

1. **Versioned Static Assets:**
   - Add webpack/vite with content hashing
   - Cache JS/CSS forever via hashed filenames
   - Only HTML needs no-store

2. **Service Worker for Offline:**
   - If we implement offline mode later
   - Use workbox's `networkFirst` strategy for HTML
   - Still respects no-store directive

3. **CDN Purging:**
   - Vercel automatically purges on deploy
   - No manual purge needed with no-store

---

## Appendix: Alternative Solutions (Not Recommended)

### Why Not Query Params?
```html
<script src="/portal.html?v=1234"></script>
```
- Doesn't work for root HTML document
- Browser cache ignores query params for HTML
- Not a standard solution

### Why Not Meta Tags?
```html
<meta http-equiv="Cache-Control" content="no-store">
```
- Only affects browser cache, not CDN
- Less reliable than HTTP headers
- Can be ignored by proxies

### Why Not Service Worker Cache Busting?
- Already implemented (we unregister service workers)
- Doesn't prevent disk cache
- HTTP headers are the correct layer

---

## Conclusion

Implementing `Cache-Control: no-store` headers in `vercel.json` is the **correct, permanent, standards-based solution** to prevent stale HTML from being served. This ensures every browser refresh fetches the latest deployment, eliminating the "PowerShell sees new, browser sees old" issue permanently.

The headers are safe, non-breaking, easily rolled back, and follow HTTP caching best practices. This is not a workaround—it's how you're supposed to handle dynamic HTML that must never be stale.
