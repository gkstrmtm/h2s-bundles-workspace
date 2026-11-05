# Final workflow clarity and shared UX refinement

## 1. Corrections and boundaries

Focused refinement of the approved management and independent Field Sales applications. Existing sidebar, cards, service selection, contextual order tabs and five-destination representative navigation are preserved.

- Removed routine data-refresh controls from Operations, Field Sales, quotes, orders, earnings, secure customer records, Bug Reports, Ad Resources and Owner Uploads preview.
- Retained dependency Retry, explicit provider verification and confirmed draft-discard actions. Discarding an interrupted operation is separate from discarding form inputs; uncertain operation keys are not silently replaced.
- No pricing definitions, quote calculations, deposit percentages, commission accounting, authorization, technician workflows, notification activation or production settings changed.
- No deployment, production mutation, live payment activation or real payout.

## 2. Style-placeholder root cause

The old extraction tool ran an HTML style-block regular expression across the entire original document **before extracting JavaScript**. It therefore matched `<style>` inside JavaScript template strings. Its temporary `%%H2S_STYLE_PLACEHOLDER%%` marker survived in the extracted Forecast renderer because final cleanup only covered HTML.

The extractor now uses actual HTML node locations, leaves JavaScript-template styles intact, and applies offset-based replacements without temporary tokens. Removed the leaked literal from the current renderer; no CSS hiding is used. Extraction and the canonical single-file build reject unresolved `%%UPPERCASE_TEMPLATE_TOKENS%%`.

The build now understands the current stylesheet bootstrap and serial script loader, safely escapes embedded script text, and supports `--output` outside the worktree. The dirty legacy source document and generated deployment files were not overwritten.

## 3. Automatic synchronization

`frontend/dashboard-sync.js` provides visible/active-screen synchronization, coalesced pending reads, default 60-second polling, 15-second focus throttling, mutation invalidation, honest failure/Retry feedback and bounded 15-second read signals.

An authorized active module performs its initial mount read even in a background editor panel, preventing an empty preview. Subsequent hidden-panel polling/focus reads and inactive/unauthorized mounts remain blocked.

Native screens reread after successful mutations and on return. Session, read-generation and edit-generation checks reject late responses. Dirty forms, interrupted operations, focused fields and open shared dropdowns pause unsafe updates. The shared-select guard covers actual `aria-haspopup` triggers, including search portals outside the module. Read-only contextual tabs and scroll position survive updates.

Existing Queue, media, Owner Uploads and legacy dashboard synchronization remains in place rather than adding competing loops. Archived duplicate bundles and the separate technician application were not migrated.

Additional protections:

- Incomplete quote, workflow, earnings, lead, catalog, Bug Report and Ad Resources responses are errors, not empty/current success.
- Finite customer/checkout links survive appropriate background rereads.
- Invalid/expired secure-customer authorization clears protected content and asks for finite-link renewal; it cannot enable late initial acceptance.
- Bug Report updates cannot reopen a closed modal or fetch an empty result twice during a cache-only rerender.
- Ad Resources aborts superseded reads and rejects closed-modal/session/stale responses.

## 4. Operations presentation

- Loaded-scope operational categories cover awaiting scheduling, recorded scheduled starts, pending technician acceptance, readiness, completion and management attention where evidence supports them. Unknown evidence remains explicit; counts are not organization-wide totals.
- Jobs show customer/service evidence, scheduling state, assignment, payment verification, preparation/readiness and concise next review actions.
- Requested/held/confirmed customer reservations are not equated with technician acceptance or completion. Recorded starts are labeled as such, not appointment confirmation.
- Dates use supplied timezone evidence; browser-timezone or unresolved-timezone evidence is labeled rather than invented.
- Reconciliation remains a separate historical-relationship review, with category-based priority, evidence/concern, affected relationships and recommended review. Priority is not presented as verified incident severity.
- Routine reconciliation relationship summaries no longer expose UUIDs. Exact identifiers, source records and bounded-read limitations remain in secondary technical evidence.
- Condensed repeated warnings and kept incomplete/unknown status visible. Session review drafts still do not repair records, authorize writes or resolve production cases.

### Subsequent Operations management correction

- Dispatch Records, Scheduling Visibility and Reconciliation Review now share a searchable, selectable list/detail workbench. Selection is independent of list order; changing pages or narrowing search never silently substitutes another selected job.
- Search is explicitly limited to the loaded page. Scheduling and reconciliation category filters run over the backend's bounded dataset before pagination; Dispatch categories filter its loaded page. Page controls and counts distinguish these scopes from all authorized organizational records.
- Installation detail has Overview, Schedule, Technician, Readiness, Payments and Completion sections. Exact-linked customer/address evidence is included in scheduling. Contextual next-review controls focus the relevant section; they do not perform scheduling, payment or readiness writes.
- Audit / Technical Evidence is a separate contextual view, not an accordion. Exact identifiers, source limitations, historical relationships and read timestamps remain accessible there.
- Scheduling retrieves the selected job's payment/equipment evidence with the existing authorized reader and an exact UUID query. Timeout, abort, read-generation, identity and authorization checks prevent a late or different job from replacing the selection. Failed reads retain explicit Retry; revoked access clears protected content.
- Existing shared synchronization remains bounded and protects active inputs, shared dropdowns, assignment operations and reconciliation drafts. A retained historical review draft does not freeze synchronization after switching to installation management. List position and selected context survive safe rereads.
- Order-level paid verification is not a deposit receipt or balance ledger. Missing order status, assigned representative, deposit allocation, outstanding balance, actual costs and completion artifacts remain explicitly unavailable. Scheduling and selected-detail reads are separate, non-atomic observations.
- Assignment management remains behind its existing server-side feature flag and authorization. Default-off environments expose no offer-management control. No assignment activation, schedule write, production reconciliation repair, technician-portal change or live financial behavior change is included.
- Isolated previews exercise the native read adapters with configurable 0-1000 synthetic jobs, including unscheduled, pending/accepted offers, conflicts, readiness blockers, completed installations, unverified payments and historical relationship exceptions. No external payment verification or production connection is used.

Correction validation: coordinated Operations, Planning, Assignment, dashboard, Field Sales financial/workflow, Forecast, template and isolated-preview regressions passed **215 tests, with 1 existing independent-PostgreSQL-session concurrency test skipped**. Final focused Operations/preview checks passed **34 tests**. Scoped backend TypeScript reported zero diagnostics; frontend syntax, canonical single-file build and whitespace checks passed. Actual rendered views were inspected with live resizing at 390, 768, 1024 and 1280 CSS pixels, including selection, page 2, empty search, shared category dropdown placement, keyboard selection, contextual evidence and reconciliation input preservation. The test fixture also covers 0, 1, 10 and 60 jobs. These are isolated synthetic validations, not a production end-to-end installation or payment test.

## 5. Sales chronology and attribution

Follow-ups and leads prioritize open work and earliest due contact; quote actions prioritize approval/draft work; installation and earnings records use consistent chronological ordering. Concise next actions replace repeated lifecycle paragraphs.

Customer identity is separate from originating salesperson and current assigned salesperson. Names come only from representative profiles, never synthetic customer labels. Missing historical origin/profile evidence is explicit. Technician assignment remains authoritative in Orders. Immutable origin and commission-credit rules are unchanged.

## 6. Financial terminology

The UI distinguishes approved/proposed quote total, deposit required, verified deposit-session collections, total verified payments net of refunds, verified refunds and outstanding balance. Checkout reservations remain explicitly **not proof of collection**.

Earnings distinguishes commission pending qualification, earned, allocated-not-paid and independently paid. Existing exact-cent calculations, 25%/75% obligations, qualification, approved rates and Friday settlement controls remain unchanged. Technician compensation is still separate.

## 7. Forecast findings and approval plan

See [Forecast integration plan](./FORECAST_INTEGRATION_PLAN.md).

The existing engine has generic AOV/margin/payout assumptions, capacity-as-sales behavior, incomplete direct/operating costs and disconnected preset/chart assumptions. The plan identifies exact later changes to its inputs, evaluator, scenarios, storage and result presentation; a small pure modeling seam; existing authenticated read contracts; and a conditional read-only backend projection only if completeness cannot be proved.

It specifies service/equipment mix, customer-owned equipment, cost provenance, approved representative policy versus separate technician expense, variable/fixed processing fees, exact deposits/balances, booked versus collected amounts, contribution and operating assumptions.

Proposed v1/v2 catalogs are not approved offers. Proposed, approved, estimated, actual, hypothetical and unknown inputs remain distinct. The Forecast engine was **not integrated or replaced**; only its leaked template literal was removed.

## 8. Validation and remaining limitations

### Automated

- Combined root Field Sales and backend field/dashboard/media/management/commercial/Operations suites plus isolated-preview regressions: **763 passed, 2 skipped, 0 failed**.
- Final focused native UI/template/synchronization/preview suite, including subsequent popup, modal-race, background-mount and scroll protections: **160 passed, 0 failed**.
- Operations/Planning/Assignment focused checks: **27 passed**.
- Two skips require genuinely independent PostgreSQL sessions; no external database was supplied. The live media-database integration suite was intentionally excluded.
- Canonical build passed:
  `npm run build:dash:singlefile -- --output <session-files>\workflow-dashboard-build.html`.
- Changed JavaScript syntax checks and `git diff --check` passed.

The combined selection uses `tests/field*.test.cjs`, backend `*field*`, `dashboard*`, `media*` excluding `media_database.integration`, `management_*`, `commercial_*`, Operations foundation, template, sales-app and task-creator tests, plus walkthrough fixture/navigation/sales/dashboard preview tests. No production environment was loaded.

### Actual rendered and interactive review

- Actual application screenshots and live iframe resizing at **320, 390, 768, 1024 and 1280px** across Operations overview, scheduling, reconciliation, management sales overview, Quotes & Payments, representative Home/Leads/Quotes/Orders/Earnings and the current Forecast.
- No application-wide horizontal overflow or rendered template tokens in the checked widths. Desktop testing also exercised the narrower available editor container, not just nominal browser width.
- Actual shared customer dropdown opened with real leads and a bounded menu; its open-state guard paused synchronization.
- Quote input survived Quotes -> Orders -> Quotes. During a real 62-second polling interval with a dirty form: quantity retained, **0 transaction rereads and 0 posts**.
- A synthetic quote save produced **1 POST and 1 authoritative transaction readback**, selecting the new revision. No approval or payment was activated.
- Three overlapping focus events during an injected unavailable read produced **1 GET**. Prior revision remained visible with failure/Retry; retry produced one successful read and retained the revision.
- Automated coverage also exercises zero/many/long customers, stale/session responses, incomplete reads, unknown readiness, permissions, interrupted retries, financial amounts and secure-customer behavior.

### Limits

- Scheduling's existing read projection does not supply customer detail for every job; the UI states this rather than fabricating a relationship.
- Missing representative profile names remain explicit. Synthetic customer labels are not employee attribution.
- Counts cover loaded/bounded records and may contain unknown evidence. Neither scheduling reads nor absence of observed conflicts proves availability clearance.
- Advanced authorized catalog/policy authoring and technical audits still contain exact identifiers/JSON in secondary views.
- Unsupported integrations remain unavailable in the isolated preview. No fake production success, provider capture, calendar authorization or payout was introduced.
- The legacy Forecast remains an unintegrated hypothetical calculator pending separate approval of the linked plan.

## Changed paths

- Frontend: `dashboard-sync.js`, `dash.html`, `dash.js`, `sales.html`, `field-sales.js`, `field-commerce.js`, `field-workflow.js`, `field-earnings.js`, `field-agreement.html`, `field-agreement.js`, `management-operations.js`, `management-operations.css`, `commercial-business.js`.
- Build/extraction: `scripts/build-dash-singlefile.js`, `tools/extract-portal-assets.js`, `tools/portal-template-check.cjs`.
- Preview: `tools/dev-review/bootstrap.js`, `sales-preview.html`, `sales-preview.test.cjs`, `walkthrough-server.cjs`.
- Backend test directory: `dashboard_messaging.test.cjs`, `dashboard_sync.test.cjs`, `dashboard_sync_consumers.test.cjs`, `portal_templates.test.cjs`, `field_sales_ui.test.cjs`, `field_commerce_ui.test.cjs`, `management_operations_ui.test.cjs`, `management_planning_ui.test.cjs`.
- Root test directory: `field-sales-integration-ui.test.cjs`, `field-sales-redesign-ui.test.cjs`, `field-workflow-presentation.test.cjs`.
- Documentation: this review and `docs/FORECAST_INTEGRATION_PLAN.md`.

## Local review destinations

Committed isolated review at `https://127.0.0.1:50275`; no production connection or real money:

- [Operations Overview](https://127.0.0.1:50275/sales-review?screen=operations)
- [Scheduling](https://127.0.0.1:50275/sales-review?screen=scheduling)
- [Reconciliation](https://127.0.0.1:50275/sales-review?screen=reconciliation)
- [Field Sales Overview](https://127.0.0.1:50275/sales-review?screen=management)
- [Orders & Payments — native Quotes & Payments review](https://127.0.0.1:50275/sales-review?screen=managementQuotes)
- [Forecast / Simulation — current engine](https://127.0.0.1:50275/sales-review?screen=forecast)
- [Independent representative Home](https://127.0.0.1:50275/sales-review?screen=home)
