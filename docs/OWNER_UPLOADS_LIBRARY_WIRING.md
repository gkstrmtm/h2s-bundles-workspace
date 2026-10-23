# Visual Media Placement Wiring

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

This commit covers per-page framing and the migration foundation. The broader Owner Uploads metadata and upload-engine overhaul remains separate local work.

### Page-specific media placement (Bundles and Commercial)

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

Production project `nkccbnrduojnzjfrpwva` already has
[029_create_media_placements.sql](../backend/migrations/029_create_media_placements.sql)
and [030_owner_media_placement_fields.sql](../backend/migrations/030_owner_media_placement_fields.sql)
recorded with verified checksums. Do not rerun the SQL manually or modify an
applied migration. For another target, inspect and authorize the guarded runner
workflow first. The existing `proof_assets` and `owner_media_uploads` tables are
prerequisites. Backend and authoritative frontend changes need a coordinated
release; this commit does not deploy them.

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

### Validation and known limitations

The isolated commit snapshot passed 43 focused tests, including a strict-TLS,
rollback-only production database test, plus six JavaScript syntax checks and
an Owner Uploads administrator-card/shared-editor handoff check.

The full backend TypeScript check still fails: the isolated snapshot reports
27 existing errors versus 28 at its parent HEAD, with no introduced diagnostics.
The unchanged Owner Uploads database helper and reminder helper still lack
`pg` declarations. The separate local Owner Uploads overhaul is intentionally
not a dependency of this placement commit.

The Bundles responsive hero has the nominal-frame limitation described above.
Live video and a real Owner Uploads asset have not completed the full browser
acceptance flow. The Owner Uploads handoff check is mocked, not proof of live
Owner Uploads image/video playback or publication. Cross-browser/mobile checks
and a full production build remain unverified. No deployment was performed.
