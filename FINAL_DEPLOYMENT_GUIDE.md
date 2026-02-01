# Final Deployment Guide (Portal + Shop + Backend + Funnel)

Date: 2026-02-01

This doc is the **one place** to deploy the correct artifacts without guessing which file is “live”.

---

## Canonical Files (What You Edit)

### Portal (Admin)
- Source-of-truth editor HTML: `Dash.html`
- Vercel deploy artifact: `frontend/dash.html`

Routing:
- Root deployment: `/dash` → `/Dash.html` (see `vercel.json`)
- Frontend deployment: `/dash` → `/dash.html` (see `frontend/vercel.json`)

### Shop (Public Bundles Page)
- Primary served artifacts (keep in sync):
  - `bundles.html` + `bundles.js`
  - `frontend/bundles.html` + `frontend/bundles.js`

Why two copies?
- We’ve previously seen production serve the **root** `bundles.html/bundles.js` (not the `frontend/` copies). Keeping both updated prevents “wrong file served” regressions.

### Funnel (Tracking Dashboard)
- Canonical dashboard: `funnel-track.html`
- Mirrors:
  - `frontend/funnel-track.html`
  - `backend/public/funnel-track.html`

Convenience aliases (redirect to the canonical file):
- `funnel.html`
- `frontend/funnel.html`
- `backend/public/funnel.html`

---

## Deploy: Frontend Static (Portal + Shop)

Preferred (VS Code tasks):
- Task: `Deploy Frontend (safe TLS)`
- Task: `Deploy Frontend (refresh CA + safe TLS)`

These run from `frontend/` and use `frontend/scripts/vercel-safe.sh`.

Alternative (PowerShell scripts):

1) **Portal alias deploy + verification**
- Script: `deploy-frontend-and-verify.ps1`
- What it does:
  - syncs `Dash.html` → `frontend/dash.html`
  - syncs `dashboard-design-system.css` → `frontend/dashboard-design-system.css`
  - deploys from `frontend/`
  - verifies `https://portal.home2smart.com/-` (and `/dash`) responds

2) **Frontend deployment safeguard**
- Script: `deploy-frontend-safe.ps1`
- What it does:
  - syncs `frontend/dash.html` → `frontend/portal.html`
  - injects a build id if `{{BUILD_ID}}` exists
  - deploys from `frontend/`

Notes:
- `frontend/vercel.json` controls host-based routing (portal vs shop).
- If you edit `Dash.html`, ensure `frontend/dash.html` is updated before deploying.

---

## Deploy: Backend (API)

- Directory: `backend/`
- Typical flow:
  - `npm install`
  - `vercel --prod`

Key API routes referenced by shop/portal:
- Public:
  - `/api/proof-slots`
  - `/api/proof-event`
  - `/api/get_supabase_config`
- Admin:
  - `/api/admin/proof-slots`
  - `/api/admin/proof-assets/set-thumbnail`

---

## Post-Deploy Verification (Quick)

### Shop
- Visit `/bundles`
- Confirm:
  - hero renders from proof slots
  - proof rail tiles appear
  - mobile scrolling works after opening/closing overlays

### Portal
- Visit `https://portal.home2smart.com/-` (or `/dash`)
- Confirm:
  - proof pack library loads
  - hero assignment works
  - crop editor is stable (no jitter)
  - video “Set Thumbnail” saves

### Funnel
- Visit `/funnel-track.html` (or `/funnel.html`)

---

## Common Gotchas

- **Editing the wrong file**: Portal source is `Dash.html`, but deployed file is `frontend/dash.html`.
- **Production serving root bundles**: Keep both root and `frontend/` bundles files updated.
- **Video thumbnails require DB migration**: run `ADD_VIDEO_THUMBNAIL_COLUMNS.sql` if not already applied.
- **Hydration is intentionally backgrounded**: proof-slot hydration should not block initial paint.

---

## Related Docs

- `KICKOFF_CHECKLIST.md` (handoff synopsis + status)
- `DEPLOYMENT_CHECKLIST.md` / `docs/DEPLOYMENT_CHECKLIST.md`
- `VIDEO_THUMBNAIL_DEPLOYED.md`
- `BUNDLES_LIGHTHOUSE_ANALYSIS.md`
- `HIGHLEVEL_FUNNEL_FIX.md`
