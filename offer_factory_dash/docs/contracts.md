# Offer Factory — Backend Contract Spec

This document defines the **backend-facing contracts** expected by the Offer Factory Dash UI.

## Core principle

- The UI hydrates the Offer workspace with **one primary call**:
  - `GET /api/workspace/offers/{offerId}`

Secondary calls are allowed only for:
- Pagination
- Lazy body loading
- Signed URLs / thumbnails

## Auth + resilience requirements

- Backend returns `401` for unauthenticated requests.
- UI will **auth-lock** on the first `401` and will not retry until the user explicitly clicks Retry.
- Workspace endpoint must tolerate partial failures and report them in `errors[]`.

---

## 1) List offers

### `GET /api/offers?query=&cursor=&status=`

Response:
```json
{
  "items": [
    {
      "offerId": "offer_...",
      "offerName": "TV Mount - Standard Bundle",
      "status": "draft|active|paused|archived",
      "updatedAt": "2026-02-13T00:00:00Z",
      "snapshot": {
        "snapshotId": "snap_...",
        "summary": "...",
        "createdAt": "..."
      }
    }
  ],
  "nextCursor": "",
  "total": 123
}
```

Notes:
- Cursor is an opaque string.
- `status` is optional (empty means all).

---

## 2) Workspace aggregator (primary)

### `GET /api/workspace/offers/{offerId}`

Response:
```json
{
  "offer": {
    "offerId": "offer_...",
    "offerName": "...",
    "status": "draft|active|paused|archived",
    "snapshot": {
      "snapshotId": "snap_...",
      "summary": "...",
      "createdAt": "..."
    },
    "currentBriefDeliverableId": "del_...",
    "createdAt": "...",
    "updatedAt": "...",
    "provenance": { "source": "...", "createdBy": "..." }
  },

  "frameworks": {
    "items": [
      {
        "frameworkId": "fw_...",
        "title": "...",
        "bodyPreview": "...",
        "generatedFromSnapshotId": "snap_...",
        "provenance": { "generatedBy": "...", "generatedAt": "...", "model": "..." },
        "updatedAt": "..."
      }
    ],
    "generatedFromSnapshotId": "snap_..."
  },

  "brief": {
    "deliverableId": "del_...",
    "type": "offer_brief",
    "status": "draft|published",
    "title": "Offer Brief",
    "updatedAt": "...",
    "bodyPreview": "..."
  },

  "deliverables": {
    "items": [
      {
        "deliverableId": "del_...",
        "type": "deliverable|offer_brief|...",
        "status": "draft|published|archived",
        "title": "...",
        "updatedAt": "..."
      }
    ],
    "nextCursor": "",
    "total": 1000
  },

  "resources": {
    "items": [
      {
        "resourceId": "res_...",
        "filename": "hero.jpg",
        "mime": "image/jpeg|video/mp4",
        "tags": ["hero", "tv"],
        "thumbUrl": "https://... (display-ready signed URL)",
        "fileId": "file_...",
        "thumbFileId": "thumb_...",
        "createdAt": "...",
        "updatedAt": "..."
      }
    ],
    "nextCursor": "",
    "total": 1000
  },

  "integrity": {
    "warnings": [
      {
        "code": "BRIEF_DUPLICATES|BRIEF_POINTER_BROKEN|FRAMEWORK_SNAPSHOT_MISMATCH|...",
        "severity": "info|warning|error",
        "message": "...",
        "details": {}
      }
    ],
    "counts": {
      "deliverablesLinked": 123,
      "resourcesLinked": 45,
      "briefCandidates": 2,
      "unlinkedDeliverables": 10
    },
    "repair": {
      "unlinkedDeliverables": {
        "items": [
          {
            "deliverableId": "del_...",
            "type": "...",
            "status": "...",
            "title": "...",
            "updatedAt": "...",
            "suggestedOfferId": "offer_..."
          }
        ],
        "nextCursor": "",
        "total": 10
      }
    }
  },

  "errors": [
    {
      "section": "frameworks|resources|deliverables|brief|offer",
      "code": "TIMEOUT|AUTH|UPSTREAM_5XX|...",
      "message": "...",
      "retryable": true
    }
  ],

  "debug": {
    "correlationId": "<echoed from X-Correlation-Id>",
    "timingsMs": {
      "offer": 1,
      "frameworks": 2,
      "brief": 1,
      "deliverables": 4,
      "resources": 3,
      "total": 12
    }
  }
}
```

---

## 3) Regenerate frameworks

### `POST /api/offers/{offerId}/frameworks:generate`

Response:
```json
{ "ok": true }
```

---

## 4) Publish/replace brief (deterministic)

### `POST /api/offers/{offerId}/brief:publish_or_replace`

Body (choose one):
```json
{ "deliverableId": "del_..." }
```

or
```json
{ "body": "full brief markdown/text" }
```

Response:
```json
{ "ok": true, "currentBriefDeliverableId": "del_..." }
```

---

## 5) Deliverables pagination

### `GET /api/deliverables?offerId=&type=&cursor=`

Response:
```json
{ "items": [ ... ], "nextCursor": "", "total": 1000 }
```

---

## 6) Resource attach/detach

### `POST /api/resources:attach`
Body:
```json
{ "offerId": "offer_...", "resourceId": "res_..." }
```

### `POST /api/resources:detach`
Body:
```json
{ "offerId": "offer_...", "resourceId": "res_..." }
```

---

## 7) Signed URL

### `GET /api/files/{fileId}/signed-url`

Response:
```json
{ "fileId": "file_...", "url": "https://...", "expiresAt": "..." }
```

---

## 8) Resources pagination (for 1,000+ assets)

### `GET /api/resources?offerId=&cursor=&query=`

Response:
```json
{ "items": [ ... ], "nextCursor": "", "total": 1000 }
```

Notes:
- This endpoint is used only for paging/searching large resource libraries.
- The aggregator should return a first page to keep initial hydration single-call.

## Repair-only endpoint (required for UI repair mode)

### `POST /api/deliverables:attach`
Body:
```json
{ "offerId": "offer_...", "deliverableId": "del_..." }
```

This is how the UI relinks unlinked deliverables without relying on legacy metadata parsing.
