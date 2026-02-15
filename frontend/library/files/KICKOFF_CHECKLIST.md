# Kickoff Checklist + Synopsis (Bundles + Proof Packs + Portal)

Date: 2026-01-31

This doc is meant to be a **single source of truth** you can link in Discord to brief another agent/teammate.

---

## TL;DR

We have an end-to-end Proof Packs system that supports:

- Admin portal assignment of assets to proof slots (hero + rails)
- Crop persistence without cross-contamination (hero crop and rail crop stored separately)
- Storefront `/bundles` renders hero from proof-slots, with safe fallbacks for any image
- Adaptive hero readability (overlay + mild filter tuning) and mobile scroll-lock stability
- Video thumbnail selection in admin (backend endpoint + storage upload)

Main remaining focus: **performance** (LCP/TTI/Speed Index).

---

## Canonical Files (Edit These)

### Storefront bundles page (PUBLIC)
- Primary served artifacts (must stay in sync):
  - `bundles.html` + `bundles.js`
  - `frontend/bundles.html` + `frontend/bundles.js`

Notes:
- Historically production sometimes served the **root** `bundles.html/bundles.js` (not the `frontend/` copies). We now keep both updated to avoid “wrong file served” regressions.

### Admin/Portal dashboard (PRIVATE)
- Source-of-truth editor (canonical): `Dash.html`
- Portal alias routes to the canonical Dash via host-based rewrites (no manual file-sync step).

Routing confirmation:
- Root deployment routes `/dash` → `/Dash.html` (see `vercel.json`)
- Frontend deployment (portal host) routes `/dash` → `https://h2s-bundles-workspace.vercel.app/Dash.html` (see `frontend/vercel.json`)

Deploy guardrails:
- Deploys run a guard that (1) validates `frontend/vercel.json` dash rewrites and (2) verifies live `https://portal.home2smart.com/dash?about=1` serves `Dash.html`.

---

## Key Endpoints / Data Flow

### Public storefront data
- Proof slots (public): `GET /api/proof-slots?surface=bundles&limit=6`
- Impression/event logging (public): `POST /api/proof-event`

### Admin writes
- Proof slot assignment (admin): `POST /api/admin/proof-slots`
- Video thumbnail capture/upload (admin): `POST /api/admin/proof-assets/set-thumbnail`

### Supabase hydration
- Storefront may fetch Supabase config via `GET /api/get_supabase_config`.
- Storefront hydrates `smart_crop_details` from Supabase in the background (non-blocking) and then re-renders proof sections.

---

## Proof Cropping + Rendering Rules (What’s Implemented)

### Crop persistence separation
- `smart_crop_details.hero_banner` stores hero framing
- `smart_crop_details.proof_rail` stores proof-rail framing

This prevents hero edits from overwriting rail edits (and vice versa).

### Hero “any image works” policy
Hero assignment is allowed for any image. If an image is not ideal for 16:9 cover-crop, the storefront uses a **non-destructive fallback**:

- `render_mode = fit_blur`
  - blurred background fill
  - contained foreground image

### Adaptive hero readability
The storefront samples the hero image tone (best-effort; fails silently if CORS-tainted) and applies:

- a capped overlay gradient for readability
- mild `brightness()/contrast()` (and gentle conditional `saturate()`)

### Mobile scroll stability
Scroll locking was rewritten to avoid accidentally locking random scrollable divs. A watchdog attempts to restore scroll if the page gets stuck and no overlay is actually open.

---

## Video Thumbnails (Feature)

Status: implemented and wired.

- Admin UI: right-click a video in the portal → “Set Thumbnail”
- Backend: `/api/admin/proof-assets/set-thumbnail`
  - uploads to Supabase Storage
  - writes `video_thumbnail_url` + `video_thumbnail_timestamp`
- Storefront: uses `video_thumbnail_url` as the video `poster` when available

DB migration:
- Run `ADD_VIDEO_THUMBNAIL_COLUMNS.sql` in Supabase if not yet applied.

Reference: `VIDEO_THUMBNAIL_DEPLOYED.md`

---

## Performance Notes (Current Focus)

- Proof hydration is intentionally **not** allowed to block initial paint/LCP.
- Always-on debug logging in proof rendering/hydration has been removed or gated.

Next likely wins:
- further defer non-critical scripts and long init chains
- reduce main-thread work during first render
- carefully audit 3rd-party scripts impact

Reference: `BUNDLES_LIGHTHOUSE_ANALYSIS.md`

---

## Verification Checklist (Run This)

### Storefront
- `/bundles` loads with hero section present
- hero image matches assigned proof hero (or uses fit+blur for non-16:9 assets)
- proof rail tiles render and match editor framing after hydration completes
- mobile scroll works reliably after opening/closing overlays

### Admin portal
- can assign any asset to hero
- hero and proof rail crops persist independently
- video thumbnail can be set and shows as poster on storefront

---

## Deployment

Reference: `FINAL_DEPLOYMENT_GUIDE.md`

### Frontend (shop + portal static)
VS Code tasks:
- “Deploy Frontend (safe TLS)”
- “Deploy Frontend (refresh CA + safe TLS)”

### Backend
- `cd backend` then deploy via Vercel as usual.

---

## Discord Message Template (Copy/Paste)

Here’s the concise message to send your partner:

"""
Latest state is pushed to GitHub. Use this kickoff checklist as the single source of truth:

- KICKOFF: `KICKOFF_CHECKLIST.md`

Key files:
- Storefront: `bundles.html`/`bundles.js` and `frontend/bundles.html`/`frontend/bundles.js`
- Portal editor: `Dash.html` (source) and `frontend/dash.html` (deploy artifact)

What works end-to-end:
- proof-slots-driven hero on /bundles, fit+blur fallback, adaptive readability
- separate crop persistence: smart_crop_details.hero_banner vs .proof_rail
- mobile scroll-lock fixed + watchdog
- video thumbnail endpoint wired (see VIDEO_THUMBNAIL_DEPLOYED.md; migration may be required)

Main remaining focus: performance (LCP/TTI/Speed Index)."
"""
