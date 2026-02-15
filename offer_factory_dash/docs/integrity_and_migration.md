# Integrity Rules + Migration/Repair Plan

## Deterministic rules (non-negotiable)

### Current Offer Brief (Option A)

- `offers.currentBriefDeliverableId` is the **single source of truth**.
- Workspace aggregator sets:
  - `brief = deliverables[currentBriefDeliverableId]` if it exists AND is linked to the offer.
  - Otherwise `brief = null` and `integrity.warnings[]` includes `BRIEF_POINTER_BROKEN`.

### Deliverables linkage upgrade

- Primary linkage is `deliverables.offerId` (real field).
- Legacy `deliverables.metadata.offerId` is **never used for display linkage**.
- Legacy metadata is used only to compute `integrity.repair.unlinkedDeliverables[].suggestedOfferId`.

### Offer ↔ Resource linkage

- Link table keyed by `(offerId, resourceId)` is authoritative.
- Workspace returns `resources` by joining through link table.

---

## Integrity checks returned by aggregator

The aggregator computes and returns:

- `BRIEF_DUPLICATES` (warning)
  - Condition: multiple deliverables with `type=offer_brief` linked to offer.
  - Resolution path: user can pick the correct one by setting `currentBriefDeliverableId` via `brief:publish_or_replace`.

- `BRIEF_POINTER_BROKEN` (error)
  - Condition: `currentBriefDeliverableId` missing or points to missing/unlinked deliverable.
  - Resolution: repair UI sets current brief or publishes a new one.

- `FRAMEWORK_SNAPSHOT_MISMATCH` (warning)
  - Condition: frameworks generated from snapshotId != offer.snapshot.snapshotId.
  - Resolution: regenerate frameworks.

- `UNLINKED_DELIVERABLES_PRESENT` (warning)
  - Condition: deliverables with `offerId IS NULL`.
  - Resolution: repair UI relinks using `POST /api/deliverables:attach`.

---

## Migration/backfill strategy (backend)

1) **Add hardened field**
- Add `deliverables.offerId` (nullable) + index.

2) **Backfill from legacy metadata**
- For rows where `deliverables.offerId IS NULL` and `metadata.offerId` is a valid offerId:
  - set `deliverables.offerId = metadata.offerId`
  - record provenance (e.g., `metadata.linkedBy = 'backfill'`).

3) **Flag remaining unlinked**
- Any deliverable still missing offerId is considered invalid linkage.
- Surface it via workspace `integrity.repair.unlinkedDeliverables`.

4) **Brief pointer migration**
- Add `offers.currentBriefDeliverableId`.
- For each offer:
  - Find deliverables where `offerId = offers.offerId` and `type = 'offer_brief'`.
  - Deterministically select one (e.g., published newest; else newest) and set pointer.
  - If multiple exist, keep all but emit `BRIEF_DUPLICATES` warning.

---

## Repair workflow (UI)

- Unlinked deliverables table shows `suggestedOfferId` when legacy metadata is present.
- Actions:
  - **Relink to selected offer**: `POST /api/deliverables:attach`.
  - **Set as current brief**: `POST /api/offers/{offerId}/brief:publish_or_replace` with `{deliverableId}`.

This makes linkage deterministic and removes reliance on free-form parsing.
