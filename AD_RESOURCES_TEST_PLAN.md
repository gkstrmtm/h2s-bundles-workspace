# Ad Resources — Test Plan

## Prereqs
- Apply schema: run `AD_RESOURCES_SCHEMA_2026-02-12.sql` in the MGMT/Deliverables Supabase project (same DB used by `Deliverables` / dashboard accounts).
- Sign into the dashboard so requests include `Authorization: Bearer <session>`.

## API Smoke Tests (manual)

### 1) Create a creative
- `POST /api/v1?action=adCreativeUpsert`
- Body:
  ```json
  {
    "title": "TV Mount Myth-bust — Studs vs Anchors",
    "stage": "tof",
    "status": "draft",
    "brief": "Educational TOF: reduce DIY mistakes + build trust"
  }
  ```
- Expect: `{ ok: true, creative: { creative_id, ... } }`

### 2) List creatives (recent)
- `GET /api/v1?action=adCreatives&limit=50`
- Expect: `{ ok: true, creatives: [...] }`

### 3) Search + filter
- `GET /api/v1?action=adCreatives&q=studs&stage=tof&status=all`
- Expect: filtered results

### 4) Detail view
- `GET /api/v1?action=adCreativeDetail&creative_id=<uuid>`
- Expect:
  - `creative`
  - `assets: []`
  - `tags: []`
  - `links: []`
  - `performance: []`

### 5) Attach asset URL (dedupe)
- `POST /api/v1?action=adCreativeAttachAsset`
- Body:
  ```json
  {
    "creative_id": "<uuid>",
    "asset": { "url": "https://example.com/hero.jpg", "media_kind": "photo" },
    "slot_key": "hero"
  }
  ```
- Expect:
  - first run: `{ ok: true, deduped: false, asset: {...} }`
  - second run (same URL/hash/storage): `{ ok: true, deduped: true, asset: {...} }`

### 6) Add tags
- `POST /api/v1?action=adCreativeSetTags`
- Body:
  ```json
  { "creative_id": "<uuid>", "tags": ["tv_mounting", "myth_bust", "tof"] }
  ```
- Expect: `{ ok: true, tags: [...] }`

### 7) Link to an offer/deliverable/framework angle
- `POST /api/v1?action=adCreativeLink`
- Body (offer):
  ```json
  { "creative_id": "<uuid>", "offer_id": "<offer_uuid>", "notes": "Used for TOF tests" }
  ```
- Body (framework angle):
  ```json
  {
    "creative_id": "<uuid>",
    "framework_version": "h2s_offer_frameworks_v1",
    "framework_stage": "tof",
    "framework_pillar_key": "proof",
    "framework_ad_type_key": "before_after"
  }
  ```
- Expect: `{ ok: true, link: {...} }`

### 8) Upsert performance + perf sorting
- `POST /api/v1?action=adCreativePerformanceUpsert`
- Body:
  ```json
  {
    "creative_id": "<uuid>",
    "source": "meta",
    "period_start": "2026-02-01",
    "period_end": "2026-02-07",
    "impressions": 12000,
    "clicks": 310,
    "leads": 22,
    "spend": 340
  }
  ```
- Then `GET /api/v1?action=adCreatives&sort=perf&limit=50`
- Expect: response includes `perf` and `perf_score`, and list is perf-ordered.

## UI Smoke Tests (dash.html)
- Open Offer Builder → Offer Library → click **Ad Resources**.
- Create a creative → confirm it appears in the list.
- Select it → add tags → attach a URL asset.
- If you opened from Offer Builder with a current offer loaded, click **Link to current offer** and confirm the link appears in the Links section.

## Failure Modes to Verify
- Not logged in → endpoints return 401 and UI shows toast.
- Schema not applied → endpoints return 500 with table missing; apply SQL and retry.
- Duplicate title → API returns 409 `possible_duplicate`; UI offers Force Create.
