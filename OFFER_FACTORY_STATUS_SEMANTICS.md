# Offer Factory — Status Semantics + Backend Contract

## Goal
Offer Factory must never show raw DB `Offers.Status` as “truth” (e.g. `DRAFT`) to normal users.

Instead the UI shows:
- A **Lifecycle** chip: what’s missing for this offer to be usable.
- A subtle **Health** dot: whether the snapshot is internally consistent.
- **Admin-only** diagnostics: deeper integrity + raw fields.

This keeps UX truthful while still letting admins debug.

---

## UI Semantics

### 1) Lifecycle chip (user-facing)
Computed from real payload completeness (Offer Builder data + brief/framework existence), not from DB status.

Current mapping (see frontend implementation):

| Lifecycle label | When it shows |
|---|---|
| `Lifecycle: Needs brief` | No brief linked/recognized (`briefExists` false) |
| `Lifecycle: Needs pricing` | No priced line item (qty > 0 and unit price > 0) |
| `Lifecycle: Needs frameworks` | No frameworks present (`hasFw` false) |
| `Lifecycle: Needs title` | Title flagged weak (`needsTitle` true) |
| `Lifecycle: Needs review` | `dataQuality.ok === false` (other inconsistency) |
| `Lifecycle: Ready` | Brief + pricing + frameworks + title are present and `dataQuality` is not failing |

Notes:
- `needsTitle` is a UI heuristic (not a backend field).
- Lifecycle ordering is intentional: it answers “what’s the next missing thing?”

### 2) Health dot (user-facing, subtle)
Derived from `dataQuality.ok`:
- `ok === true` → green dot (`Health: ok`)
- `ok === false` → amber dot (`Health: needs review`)
- missing/unknown → gray dot (`Health: unknown`)

### 3) Admin-only diagnostics
Clicking the health dot (admin only) opens diagnostics sourced from the workspace endpoint:
- `/api/workspace/offers/:offerId`

Diagnostics may include raw DB status and other debugging details.

---

## Backend Contract

### A) Offers index
Endpoint:
- `GET /api/offers`

Query params:
- `limit` (default 200, max 500)
- `vaName` or `createdBy`
- `full=1` / `includeFull=1` to return full rows (otherwise returns a slim projection)

Response shape:
```json
{
  "ok": true,
  "offers": [
    {
      "Offer_ID": "...",
      "Created_By": "...",
      "Updated_At": "...",
      "Status": "DRAFT",
      "briefExists": true,
      "dataQuality": {
        "ok": true,
        "issues": [],
        "summary": "Complete snapshot",
        "inferred": {
          "customerPrice": 249,
          "servicesCount": 2
        },
        "notes": []
      }
    }
  ]
}
```

`dataQuality.issues` can include:
- `missing_name`
- `missing_line_items`
- `missing_priced_line_item`
- `missing_offer_brief`

Important:
- The UI may compute a minimal `dataQuality` client-side if the index response is missing it (back-compat safety).

### B) Single-offer workspace diagnostics
Endpoint:
- `GET /api/workspace/offers/:offerId`

Query params (optional):
- `deliverablesLimit`, `deliverablesCursor`, `deliverablesStatus`, `deliverablesType`
- `creativesLimit`

Response includes:
- `offer` (raw row)
- `frameworks` (from AI_Analysis)
- `brief` (deterministically selected offer_brief deliverable)
- `deliverablesPage` (paged list)
- `creatives` (linked creatives)
- `integrity` (summary + issues)
- `errors` (section-level errors)
- `timings` (perf timings)

`integrity` shape:
```json
{
  "offerFound": true,
  "hasFrameworks": true,
  "deliverablesCount": 12,
  "briefSelected": { "Deliverable_ID": "...", "Title": "Offer Brief: ..." },
  "creativesCount": 4,
  "issues": []
}
```

---

## Why DB `Status` is diagnostic-only
`Offers.Status` is not consistently aligned with actual completeness (legacy records, partial saves, migrations).
Showing it as a primary UI state is misleading.

Offer Factory treats DB status as **debug info**, not lifecycle truth.
