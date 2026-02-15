# Testing Path — Correctness + Resiliency

Validate these scenarios against either the mock backend (default) or your real backend.

## A. Workspace hydration (single call)

1) Load page → list offers loads.
2) Select an offer → exactly one call hydrates workspace:
   - `GET /api/workspace/offers/{offerId}`
3) Confirm all tabs render without additional calls.

## B. Auth calmness (no storms)

1) Start the app with forced 401:
   - set `OFFER_FACTORY_FORCE_401=1` in your environment, then click Search.
2) Confirm UI shows auth gate and stops calling.
3) Click Retry Load → lock resets (in real system, user should be logged in before retry).

## C. Partial failure tolerance

Backend behavior to test:
- Return workspace payload with `errors[]` for a single section (e.g., resources timed out).

UI expectations:
- Overview/frameworks/deliverables still render.
- The affected section shows an error card with retry.

## D. Deterministic brief selection

1) Create duplicate briefs in backend.
2) Confirm `brief` shown matches `offers.currentBriefDeliverableId`.
3) Confirm `BRIEF_DUPLICATES` warning is shown in Integrity tab.
4) Use Repair → “Set as Current Brief” on another candidate.
5) Confirm pointer changes and UI updates.

## E. Deliverables linkage upgrade + repair

1) Ensure there are deliverables with `offerId IS NULL` and legacy `metadata.offerId`.
2) Confirm they show up in Integrity → Repair list.
3) Select one and click “Relink to this Offer”.
4) Confirm it disappears from unlinked list and appears under Deliverables for the offer.

## F. Large payload performance

1) Seed > 1,000 deliverables and resources.
2) Confirm:
- Aggregator returns only a first page for each list.
- Pagination endpoint works:
  - `GET /api/deliverables?offerId=...&cursor=...`
- UI stays responsive.

## G. Observability

1) Open Inspector.
2) Confirm correlation ID is present.
3) Confirm per-section timings appear.
