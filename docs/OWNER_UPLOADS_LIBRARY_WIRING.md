# Owner Uploads Library Wiring

## Purpose

This document defines the current wiring contract for Owner Uploads as a centralized content library, while keeping it separate from the later Technician Job Media system.

## Website Media destination inspection

The canonical dashboard's Page media rows show Bundles Hero and Commercial Hero,
Security camera rail, and Display and TV rail. Their thumbnails and the unchanged
In use stamp/filter use `media-page-heroes.js`, shared with the customer renderer.
They describe selected feed inventory under this frontend build's rules, not an
observation of deployed rendering. Eligibility, explicit inclusion, an editor
candidate, and hero load-error alternatives alone never establish In use.
Commercial renders at most four items per rail in order. Its hero advances only
on load failure, not timed rotation; viewport changes framing/layout, not selection.

The context line identifies the frontend origin, API origin and feed-check time.
Links open the corresponding area in this frontend or on the deployed public page.
Rendering remains explicitly unverified in the interface; opening a page is not
verification. Read failures retain previews as unverified and pause In use filters.

Inspect saved settings is an explicit read-only ADMIN action using the existing
per-asset placement GET endpoint. It inspects at most the first 100 loaded Shared
library assets plus selected media/hero alternatives, not every Owner Upload.
Three concurrent requests maximum, in-flight deduplication, bounded timeouts and
stopping on authorization/schema failures prevent read storms. Each destination
can expand other loaded media to distinguish explicit inclusion, exclusions,
eligibility and selection. Failed reads remain unverified, never empty settings.
This inventory is not another ranking/selection system. Opening Page placement
uses the existing editor in the exact destination; no changes are saved by viewing.

Each selected Commercial rail item also has Replace. This immediately opens a
focused modal gallery of matching-service photos/videos from the loaded library,
with search, photo/video filters, recognizable previews and the original shown for
context. Media already selected in that area is disabled. Choosing a thumbnail
opens the existing framing editor directly; Cancel/Escape restores focus without
changing gallery filters, selection or scroll. Save replacement includes the candidate and excludes the original
from that area in one atomic placement upsert; neither source media nor another
destination changes. Existing explicit display order is carried over; as in normal
placement selection, explicit inclusions precede automatic items, so replacing an
automatic item can reorder that rail. Cancel/preview never writes. The updated
ADMIN placement API advertises replacement support; older deployments disable
replacement saving rather than silently treating it as an ordinary inclusion.
No database migration is needed.

Placement framing scales the actual destination frame to fill the available
workbench width, bounded to 58% of the visible viewport height. Small rail frames
can be enlarged for editing; their customer-page dimensions, aspect ratio and
saved framing do not change. Desktop/mobile preview switches and viewport resize
retain the draft. The editor footer stays outside the scrolling work area, touch
actions have 44px targets, and unsaved-change confirmations are viewport-centered
and independently scrollable. During device switches, the destination document
stays hidden until its layout and media have loaded and the selected area's crop
and scale have been applied; the uncropped customer page is never a loading preview.

Commercial proof-rail videos keep native controls, posters and inline playback.
An idle `preload="none"` video is not loading. Actual loading/buffering shows
static feedback only after 750ms; readiness or pause clears it, and media errors
remain visible. No decorative tile loading animation is used, including under
reduced motion. Native playback controls may still show their own buffering UI.

Enhanced dashboard selects retain the native element for values, form data and
validation, but only the custom control is interactive. Label activation is routed
to that control; unrelated DOM updates preserve open options/focus. Required
errors appear beside the custom control. The Commercial Queue's explicit
`data-custom-select="off"` filter remains native-only; the hidden `ppShotType`
model stays hidden. Multiple/listbox exceptions and date/file inputs are unchanged.
Desktop/mobile viewport fixtures do not establish physical iOS Safari behavior.

## Current Intent

Owner Uploads is the current owner/admin-controlled content pool.

It should support:

- manual owner/admin uploads
- lightweight review and approval
- centralized browsing for approved social-content assets
- policy control over whether media team users should ever see a given asset

It should not yet assume the full technician proof-of-job workflow.

## Available Metadata

The Owner Uploads store now supports these fields per asset:

- `captured_at_original`
  - canonical original media timestamp when known
- `captured_at_source`
  - where that original media timestamp came from
  - current expected values: `exif`, `video_metadata`, `file_last_modified`, `manual`, `unknown`
- `source_type`
  - current default: `owner_manual`
  - future value: `technician_job`
- `source_job_id`
- `service_type`
- `city`
- `completion_date`
- `customer_media_opt_in`
  - supported values: `owner_admin_controlled`, `granted`, `declined`, `unknown`, `not_applicable`
- `usage_rights_status`
  - supported values: `pending_review`, `social_allowed`, `internal_only`, `remove_requested`
- `review_state`
  - supported values: `pending`, `reviewed`, `approved`, `rejected`, `published`
- `review_note`
- `media_team_visible`
- `qa_hold`
- `soft_location_label`
- `capture_source`

## Current Defaults For Owner Uploads

Manual owner/admin uploads currently register with these defaults:

- `source_type = owner_manual`
- `captured_at_original = file.lastModified when available`
- `captured_at_source = file_last_modified when that fallback is used`
- `customer_media_opt_in = owner_admin_controlled`
- `usage_rights_status = pending_review`
- `review_state = pending`
- `media_team_visible = false`

That keeps the current flow simple while still preserving a review boundary before broader media-library exposure.

## API Contract

### `GET /api/owner-media/uploads`

Current query support:

- `limit`
- `offset`
- `state`
  - `all`
  - `pending`
  - `reviewed`
  - `approved`
  - `rejected`
  - `published`
- `audience`
  - `all`
  - `media_team`
- `from`
- `to`
- `date_field`
  - `uploaded`
  - `captured`
- `sort_by`
  - `uploaded`
  - `captured`

Date behavior:

- `uploaded` uses the stored upload timestamp (`created_at`)
- `captured` uses `captured_at_original`
- for date-only filters like `from=2026-07-01&to=2026-07-07`, the upper bound is treated as the start of the next day for clean whole-day filtering

If `audience=media_team`, the API only returns assets that are safe for media-team/social-library access.

That view is automatically limited to assets where:

- `media_team_visible = true`
- `qa_hold = false`
- `review_state` is `approved` or `published`
- `usage_rights_status = social_allowed`
- `customer_media_opt_in` is not `declined`

### `POST /api/owner-media/uploads`

Current role:

- finalize/register an uploaded asset
- attach metadata at registration time

This is the current hook for owner/admin upload flow.

### `PATCH /api/owner-media/uploads`

Current role:

- admin-only metadata update for an existing asset

Required body field:

- `asset_id`

This is the current control point for later portal moderation tools.

Placement-related metadata supported on that PATCH surface:

- `frontend_destinations`
  - array of placement keys such as `commercial_security_rail` or `commercial_display_rail`
- `display_order`
  - lower number sorts first inside a destination
- `psychological_weight`
  - higher number floats stronger assets upward inside the same order band

### `GET /api/owner-media/public`

Current role:

- public-safe read surface for customer-facing media sections
- returns only published owner-media assets that passed the existing review, rights, and QA boundaries
- can fall back to proof-gallery assets where the consuming frontend chooses to do so

Current query support:

- `surface`
  - currently supports `commercial_intake`
- `limit`

Current commercial surface mapping:

- `commercial_security_rail`
- `commercial_display_rail`

## Recommended Portal Wiring

### Page-specific media placement (Bundles and Commercial)

The dashboard's **Page media** area reads the same public media feeds and shared
`H2SPageHeroes` selection helpers as the customer pages. It shows Bundles' hero
and Commercial's hero, security camera rail, and TV/display rail separately.
Rail thumbnails are the selected first four items, in display order, not the
entire eligible pool. Each identifies automatic selection or an explicit
choice for that area and opens the existing **Page placement** controls in
that exact destination. Viewing and choosing a destination do not save.

The hero shows its primary selection; Commercial's additional candidates are
collapsed as load-error alternatives, not claimed to be currently displayed.
There is no timed rotation in this renderer. Desktop/mobile change framing
and layout, not the selected media list. An individual customer's load failures
can advance the hero to an alternative; this dashboard is a selection snapshot,
not telemetry from that customer's browser.

The gallery **In use** stamp and **In use / Not selected** filters share this
supported-destination inventory. Legacy slot eligibility, exclusions, and
hero-only load-error alternatives do not count as selected. Source identity
is preserved, so an Owner Uploads ID does not mark a different proof asset.
On incomplete reads, retained destination thumbnails are labelled unverified
and usage filters pause until selections can be verified; drafts and the
chosen filter are retained. Thumbnail errors do not remove saved assignments
or prevent opening their placement controls.

Use **Page placement** on a Website Media grid item, in its shared-media editor,
or on an Owner Uploads item (administrator only). Select **Page**, then **Display
area**. Settings are saved independently for each asset/page/area:

- show/prioritize this asset, or exclude it from this area only
- display order (lower first within the area's service group)
- fill frame or fit whole photo
- drag on the existing visual editor canvas to reposition; wheel or slider to zoom
- optional precise horizontal/vertical focus and order under **Advanced**

**Save this placement** persists only the active page/display-area selection.
The footer identifies that scope and reports unsaved, saving, saved, or failed;
saved is shown only after the API confirms the requested settings.

Switching page or display area with a draft offers **Save and switch**,
**Discard and switch**, and **Keep editing**. Failed saves preserve the draft
and stay in the original placement. Clean switches happen directly. Cancel,
the Close buttons, backdrop, and Escape share the same protection, with
**Save and close**, **Discard and close**, and **Keep editing**.

**Reset framing** centers the draft and resets zoom to 100%, retaining fit,
inclusion, order, and the override. It does not persist until saved.
The compact **Restore automatic selection** action instead confirms deletion
of only that saved override (and discards any current draft); it does not hide
or delete the shared asset or change another placement. The state then reports
automatic selection, not a saved override. Both precise framing and display
order remain inside Advanced.

This is a placement scope in the existing visual workbench, not a separate
editor. Its undo/redo and Cancel affect only unsaved placement framing. Shared
classification, source crop/rotation/filters, and Delete Asset are not exposed
in this scope. The header identifies the active page/area. Saving does not
replace the shared source or change another placement.

Preview URLs use URL query parameters for cache-busting, preserving the media
proxy's `bucket` and `path` parameters on initial load and post-edit reload.
Failed media loading disables Save and offers Retry; failed placement loading
does not silently substitute defaults for saved settings.

### Developer-integrated pages

Register page titles, area keys, nominal frame ratios, limits, and optional
service restrictions in `backend/lib/mediaPlacementCatalog.json`.
The admin API returns that catalog; the same visual workbench handles every
registered page. Customers cannot create pages or author layouts.

Additional pages can read `GET /api/media-placements?surface=<registered-key>`.
It returns approved public-safe explicit assets in `sections[area].items`.
Load `frontend/media-placements.js` before the page script, apply
`H2SMediaPlacements.style(item.media_placement)` to the image/video, and give
the media element `width:100%; height:100%` inside an overflow-hidden frame.
Use the registered frame ratio in the page's CSS. An unregistered page is a
400 error, not an empty success.

Bundles and Commercial retain their existing legacy-selection endpoints and
fallback rules, merged with exact-area overrides/exclusions. Bundles' hero is
a responsive full-section background rather than a fixed-ratio photo tile:
its 16:9 editor frame is nominal, and the visible crop varies with the actual
viewport/content height. Commercial's hero and the proof tiles use 4:3 frames.
Do not confuse identical saved focal/zoom rendering rules with pixel-identical
crops across different responsive aspect ratios.

### Database migrations

See [Guarded PostgreSQL migrations](DATABASE_MIGRATIONS.md) for target
authorization, trusted TLS, the inspected baseline, apply/status/verify commands,
and credentials kept outside Git. Both the Owner Uploads placement-field
migration and the media-placements migration are required before releasing the
corresponding local API changes.

Supported areas:

| Page | Area keys |
| --- | --- |
| Bundles | `hero`, `mid_proof_rail`, `pre_cta` |
| Commercial | `commercial_hero`, `commercial_security_rail`, `commercial_display_rail` |

These non-destructive settings do not update the shared `storage_path`,
`smart_crop_details`, or legacy destination/weight fields. Shared-media edits
(including the older baked crop editor) still affect the common source file;
use Page placement for a change intended for only one page.

#### Schema and release order

Apply [029_create_media_placements.sql](../backend/migrations/029_create_media_placements.sql)
to the main media database **before deploying the backend changes**. It requires
the existing `proof_assets` and `owner_media_uploads` tables. Then deploy the
backend and the authoritative frontend sources together.

`media_placements` has a composite primary key of
`(asset_source, asset_id, surface, area)`, source-specific foreign keys with
cascading deletes, bounded framing fields, and valid page/area constraints.
Row-level security blocks direct public writes/reads; server-side service access
is used. Missing schema and query failures are reported as errors, not successful
empty placement lists.

Absence of a row preserves legacy behavior. Enabled placements rank before legacy
fallback media; disabled rows exclude only that asset in that exact area. Other
assets can still fill the area. A placement is not a request to clear an entire
area or to replace its whole rotation. Hero areas show the first eligible asset.

#### API contract

`GET /api/admin/media-placements?asset_source=proof_asset|owner_media&asset_id=...`
returns the area catalog and all saved placements for that asset.

`PUT /api/admin/media-placements` accepts:

```json
{
  "asset_source": "proof_asset",
  "asset_id": "11111111-1111-4111-8111-111111111111",
  "surface": "bundles",
  "area": "mid_proof_rail",
  "enabled": true,
  "display_order": 10,
  "fit": "cover",
  "focal_x": 50,
  "focal_y": 50,
  "zoom": 1
}
```

`DELETE` accepts the same shape and restores automatic selection for that key.
All admin operations require a dashboard administrator bearer session; the shared
owner-upload PIN session is not sufficient. Assignment does not bypass publication,
usage rights, QA holds, or service compatibility.

Public consumers:

- `/api/proof-slots?surface=bundles` merges per-area settings into each returned
  asset's `media_placement`, and returns `hero_media` for an explicitly selected
  hero plus `hero_exclusions` for the legacy curated background.
- `/api/owner-media/public?surface=commercial_intake` merges the two rails and
  returns an independent `commercial_hero` section. A hero that falls back to a
  rail asset does **not** inherit that rail's framing.
- Both pages use [media-placements.js](../frontend/media-placements.js) for the
  same bounded framing styles used by the editor preview. Legacy assets with no
  override keep their previous rendering.

Validation: `node --test backend/tests/media_placements.test.cjs`.

### For admin or owner review views

Use:

- `GET /api/owner-media/uploads?state=all`
- `GET /api/owner-media/uploads?state=all&date_field=uploaded&from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/owner-media/uploads?state=all&date_field=captured&from=YYYY-MM-DD&to=YYYY-MM-DD`

This should be the operational view where review, rights, deletion, and visibility decisions are made.

This is also the current path for questions like:

- "What was uploaded this week?"
- "What was actually captured this week?"

### For VA/media-team library views

Use:

- `GET /api/owner-media/uploads?audience=media_team`

This should be treated as the safe social-content surface, not the raw intake view.

## Policy Boundary

If a customer does not opt in to media usage, the media-team-facing library should never expose that asset.

For that reason, later portal moderation should treat these fields as the core policy boundary:

- `customer_media_opt_in`
- `usage_rights_status`
- `review_state`
- `media_team_visible`
- `qa_hold`

## Future Bridge To Technician Job Media

Technician Job Media should later populate the same downstream library concepts, but from a stricter source workflow.

That later system should:

- bind uploads to exact jobs
- record technician/service/city/completion context at intake
- treat proof-of-work as the primary purpose
- only feed approved, rights-safe assets into Owner Uploads or equivalent social-library views