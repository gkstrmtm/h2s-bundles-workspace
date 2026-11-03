# Phase 5: scheduling visibility and reconciliation review

Base: `18afa64f14e6012edc1bf438a10b5a974304de18`, branch `retro-dev`.
Read-only production verification: 2026-11-03. No deployment, migration,
production repair, live assignment, notification or new role activation.

## Implemented boundary

The existing Operations module now has three views:

- **Dispatch records:** established Phase 2/3 functionality is preserved.
- **Scheduling visibility:** upcoming installations, scheduled starts,
  unscheduled jobs, management attention and observed conflicts. Shows assignment
  states, customer reservation evidence, preparation blockers, portal day blocks
  and raw Dispatch capacity evidence separately.
- **Reconciliation review:** ADMIN-only cases for orphan assignments, technician
  identity, legacy job links, conflicting assignment states, payout associations
  and unavailable source evidence. Each case includes record identifiers, source
  tables, a concrete reason, evidence and proposed remediation.

This is not a new calendar, CRM or scheduling writer. The existing job/technician
offer review remains available through its established disabled-by-default
endpoint. No Dispatch or technician portal code was copied or modified.

### API and read safety

`GET /api/management-planning?view=schedule&filter=all&offset=0&limit=25`
or `view=reconciliation`. Supported filters are exported as `planningFilters`.
Offsets are 0-10000; page sizes are 1-25. Unknown/repeated parameters are rejected.

The existing `operations.read` guard authenticates before database access,
requires ADMIN and does not touch session last-seen. VA retains existing
permitted functionality but cannot access this endpoint; SALES and OPERATIONS
remain inactive/unauthorized. Responses are private/no-store. There are no
POST, PUT, PATCH or DELETE handlers, review writes or routing/assignment RPCs.

The adapter reuses existing bounded read helpers and the exact order resolver.
It reads the main management/Dispatch project, not the separate external CRM
or an assumed DB1. Each source requires an exact count and at most 1000 complete
rows. Failed/truncated jobs or assignments fail the request rather than creating
false orphans. Optional failures remain explicit partial evidence and review
cases, not empty-table success. Filters/conflict detection precede pagination.
Only the selected scheduling page invokes the existing read-only
`h2s_job_readiness`, five concurrent reads at a time.

Sources: dispatch jobs/assignments, referenced orders, portal and Dispatch
profiles, legacy jobs, reviewed legacy links, payout ledger, commercial
reservations/operation links, portal availability and Dispatch capacity.
No technician payment credentials, tax records, availability notes or private
block reasons are selected. Customer email is used only for the existing
customer-consistency veto after explicit reviewed linkage, never to discover or
prove a relationship.

The HTTP adapter uses separate SELECTs, not an atomic snapshot. Results can age
while being read; any future authorized action must re-read and validate current
versions transactionally. This bounded review is not exhaustive conflict or
availability clearance. Over 1000 rows requires a future complete window/read
strategy; incomplete sources are not silently accepted.

### Review classifications are not operational state

`unresolved`, `needs investigation` and `reviewed` are browser-session drafts.
Reviewed requires notes and an evidence reference. Drafts retain the authenticated
reviewer ID, source evidence fingerprint, client timestamp and local history.
Changed evidence invalidates the displayed draft classification. Logout, account/
token changes and permission denial clear drafts; nothing uses localStorage or
a production review table.

An explicit JSON export has `draftOnly: true` and `approval: false`.
It is **untrusted reviewer input**, not a signed server audit, approval, imported
repair command or persistent multi-user case system. Client time is not an
authoritative audit timestamp. Export before reload/sign-out if needed and
handle source evidence through approved internal channels. Reviewed never means
resolved, and classifications do not hide or alter operational cases.

This intentionally avoids a schema migration or production review-table writes.
Shared durable review storage requires separately approved migration, grants,
audit and rollback design; no such persistence is claimed here.

## Verified scheduling and assignment relationships

| Question | Existing authority and Phase 5 behavior |
|---|---|
| Appointment required before assignment? | No. Existing managed offers can target an eligible queued priced installation without `due_at`. The view shows it as unscheduled, not a confirmed appointment. |
| Installation window? | Dispatch `due_at` is the canonical start; resolved order `metadata_json.scheduled_end` and `scheduled_tz` supply end/timezone. Missing or invalid values stay unresolved; no duration or timezone is invented. Display uses the recorded timezone, or explicit ISO instants when it is unknown. |
| Technician availability? | Portal availability uses authenticated portal `pro_id`; Dispatch capacity belongs to a separate directory. Only exact verified portal identity permits interpreting established dated `vacation` rows as day blocks. All local dates in the half-open installation interval are considered, including midnight/DST. Weekly/time-window fields remain source evidence, not an invented permission rule. |
| Pending offers? | Unclosed commitments participate in overlap warnings and existing exact-start assignment eligibility. They do not create or confirm customer reservations or automatically consume a new calendar slot. |
| Acceptance/decline? | Phase 4's atomic response remains authoritative: pending offer to accepted plus job `assigned`; decline leaves the queued job queued. Customer agreement, preparation and schedule confirmation remain separate. No Phase 5 response-handler changes. |
| Customer reservation? | Existing `commercial_reservations` and revision/audit/overlap services remain authoritative. Link only through exact commercial operation lead/installation-job/order IDs. No name/email association or synthetic residential commercial lead is created. |
| Calendar overlap? | Existing reservations enforce one shared company-wide lane. Confirmed and live tentative holds count; expired holds do not. Unknown hold expiry remains conservative. This does not establish per-technician capacity. |
| Rescheduling? | Existing commercial reservation service requires explicit customer agreement and synchronizes linked job/order times. Accepted assignments are not bound to reservation/schedule revisions and are not automatically reconfirmed. Divergent order `scheduled_date` and dispatch start are surfaced. |
| Cancellation/completion? | Existing deferred commercial synchronization ends/cancels linked reservations for terminal jobs. That is not authorization to settle, reverse or create payouts. Terminal jobs retaining unclosed assignment history remain review cases. |
| Preparation? | Existing `h2s_job_readiness` only. Equipment/preparation readiness is not payment clearance, customer consent or availability approval. |

Relevant existing authorities:
[calendar/preparation migration](../backend/migrations/036_commercial_calendar_workload.sql),
[managed offer migration](../backend/migrations/041_management_assignment.sql),
[atomic response/reviewed links](../backend/migrations/042_management_offer_reliability.sql),
[portal availability](../backend/app/api/portal_availability/route.ts),
[customer reschedule](../backend/app/api/customer_reschedule/route.ts).

Known pre-existing integration defects are not repaired by these read views:
legacy customer rescheduling and schedule confirmation attempt unsupported
Dispatch `scheduled` updates, potentially leaving order/job schedules divergent.
Legacy appointment availability based on APPT order creation/item data is not
technician availability. `auto_assign_job_to_pro` writes capacity/routing records
and is never called here. Routing capacity hold/release, travel/duration buffers,
reschedule reacceptance and payout cancellation policy remain unsettled.

## Fresh reconciliation findings and disposition

Two verified-TLS, repeatable-read **READ ONLY** PostgreSQL inspections were rolled
back. The committed diagnostic reproduced Phase 4's cohorts. The actual new
projection was also executed through a narrowly SELECT-only PostgreSQL bridge;
this verifies schemas/data/model behavior, **not the undeployed HTTP endpoint**.
Only aggregate/anonymized results were retained.

| Category | Observed | Classification and disposition |
|---|---:|---|
| Missing Dispatch job references | 77 of 95 assignments | Historical data inconsistency/missing targets; 72 `offer_sent`, five `accepted`. No legacy job, order UUID/public reference or checkout session substitute was proven. Original deletion/import provenance remains unknown. Investigate; never auto-delete or synthesize jobs. |
| Dispatch-only technician references | 90 offers | Separate namespace/legacy integration mismatch. One Dispatch profile; no exact portal ID or shared-email overlap with 12 portal profiles. No inferred identity link or reassignment. |
| Inactive exact portal references | Five accepted assignments | Exact portal identity exists but `is_active=false`; all five also lack their Dispatch jobs. These are not five missing identities. Review historical employment/assignment context without automatically activating profiles. |
| Multiple unclosed assignment states | Three job keys | Historical conflicting accepted/offer states, all referencing missing Dispatch jobs. Preserve both records until event provenance and disposition are approved. |
| Installation legacy relationships | 33 jobs unverified | Missing explicit relationship plus unapplied reviewed-link schema. `h2s_jobs` has zero rows. Same-key/contact agreement cannot supply a link. Do not generate legacy jobs or payouts. |
| Payout association cases | Zero current ledger rows/cases | Not payout readiness: no verifiable legacy installation bridge exists. Tests cover missing completed-job payouts, wrong beneficiaries and excluded non-job payouts. |
| Missing source | Reviewed-link table | Expected release dependency: migration 042 is unapplied. Explicit incomplete evidence, not a fabricated empty table or an automatic migration. |

The new model reports **209 overlapping review cases**: 77 orphan, 95 identity
(90 Dispatch-only plus five inactive portal references), 33 legacy relationship,
three assignment conflict and one unavailable-source case. These are not 209
distinct customer transactions.

All 33 Dispatch jobs resolve to orders in the inspected dataset. On the first
25 scheduling records, all windows are incomplete, all customer reservations are
not linked through the required operation/order/job relationship, and all require
attention. Preparation evidence was readable for all 25; readable does not mean
ready. The source set also contains two reservations, five commercial operation
records, three availability records, zero capacity rows and zero legacy jobs.
No production relationship, assignment, appointment or payout was changed.

### Deterministic matching and future remediation

- Dispatch UUID references use exact UUID equality (case normalization only for
  syntactically valid UUIDs); legacy/text keys retain their independent namespace.
- Orders use the established exact UUID/public-order resolver; ambiguous results
  stay unresolved. No names, email similarity or checkout-reference substitution.
- Portal identity requires one exact portal ID and no conflicting exact Dispatch
  identity. Inactive profiles remain explicit exceptions, not eligible defaults.
- Installation payout links require one explicit reviewed mapping, a unique
  existing legacy target, supported source evidence, reviewer UUID, review time,
  no competing owner and the existing customer-consistency check. Email agreement
  can only fail/pass that supplementary check; it cannot establish a mapping.
- Payout association additionally requires one verified accepted/completed
  beneficiary. Consultations/non-job payouts are not installation entitlements;
  completed paid jobs are not treated as cancellation exceptions.
- Case fingerprints canonically hash supporting source records. They detect
  evidence changes, not approval or resolution.

For **every future production repair**: obtain exact source/event evidence;
write a reviewed dry-run manifest with before-images, expected revisions, target
project/IDs and proposed disposition; obtain explicit authorized approval;
validate against current data in an isolated rehearsal; apply a separately
audited, idempotent, transactional operation; retain immutable before/after
records and verified postconditions. Rollback must restore approved before-images
only when versions still match; after dependent transitions, use an approved
compensating action rather than deleting history. Customer contact resemblance
must never substitute for evidence.

Category-specific proposals: recover or explicitly archive orphan history;
review a proven directory bridge or separately approved reoffer for identity
cases; establish the actual legacy source record before reviewing a link;
supersede conflicting offers only from authoritative event history; verify
completion, beneficiary and compensation approval before payout remediation.
None of these repairs is implemented or authorized by a review draft.

## Validation

- New planning/rules/API and UI tests: **15 passed, zero failed/skipped**.
- Worktree Phase 4 regression scope plus new tests: **200 passed, zero skipped**;
  unrelated local improvements are present and are not the sole commit evidence.
- Exact staged regression/layout run: **162 passed, one known baseline failure,
  zero skipped** (163 tests). The unchanged Customer Queue native-select test in
  `dashboard_presentation.test.cjs` still expects `commercialQueueFilter` near
  `data-custom-select="off"` in committed dashboard HTML. This is the previously
  documented styling failure, not a Phase 5 regression; the affected dashboard
  HTML/CSS and presentation test were not staged or changed by this phase.
- Strict scoped TypeScript and frontend JavaScript syntax on the exact staged
  snapshot: passed. TypeScript used strict/noEmit, ES2020, CommonJS, Node10
  resolution and the existing backend alias/dependency types.
- Synthetic browser layout checks: scheduling and reconciliation at 1440, 390
  and 320px, no horizontal overflow; two-column desktop review form and one
  column on mobile. Browser draft save/export enablement also verified.
  Shared-browser pointer delivery was unreliable, so layout/state checks used
  DOM-dispatched actions; JSDOM tests exercise the module event handlers.
- Read-only production inspections: passed; source incompleteness is reported
  explicitly. No live staff endpoint was called or session timestamp touched.
- Native independent-session PostgreSQL suites were not rerun: no SQL/write
  path changed in Phase 5; Phase 4's recorded two-suite native result remains
  historical evidence, not a new Phase 5 run.

Commands from repository root:

```powershell
node --test backend\tests\management_planning.test.cjs backend\tests\management_planning_ui.test.cjs
node backend\tools\reconcile_assignments_readonly.cjs --read-only
node --check frontend\management-operations.js
node --test backend\tests\managed_offer_response.test.cjs backend\tests\management_assignments.test.cjs backend\tests\management_assignments_api.test.cjs backend\tests\management_assignments_ui.test.cjs backend\tests\management_operations.test.cjs backend\tests\management_operations_ui.test.cjs backend\tests\management_planning.test.cjs backend\tests\management_planning_ui.test.cjs backend\tests\operations_foundation.test.cjs backend\tests\commercial_compatibility.test.cjs backend\tests\commercial_operations.test.cjs backend\tests\commercial_calendar.test.cjs backend\tests\commercial_business.test.cjs backend\tests\stripe_order_metadata.test.cjs backend\tests\dashboard_controls.test.cjs backend\tests\dashboard_presentation.test.cjs backend\tests\dashboard_messaging.test.cjs
```

Tests cover ADMIN/VA/unauthenticated/future-role boundaries, strict query errors,
no mutation methods, bounded SELECT-only retrieval, failed/empty/truncated data,
global pagination conflicts, exact identities, inactive/colliding namespaces,
reviewed links/customer contradiction, payout beneficiary/completion boundaries,
calendar holds, midnight/DST, unknown availability, recorded timezone rendering,
escaped evidence, draft requirements/export/history, fingerprint invalidation,
logout/token changes and late-response rejection. Existing acceptance, decline,
assignment, payment metadata, calendar, customer workflow and layout contracts
remain in the regression scope.

## Exact changed files

| Path | Change |
|---|---|
| [managementOperations.ts](../backend/lib/managementOperations.ts) | Export existing read helpers/types; no existing runtime behavior change. |
| [managementPlanning.ts](../backend/lib/managementPlanning.ts) | Bounded scheduling/reconciliation read model and deterministic evidence rules. |
| [planning route](../backend/app/api/management-planning/route.ts) | ADMIN GET-only API, strict inputs and private/no-store responses. |
| [Operations module](../frontend/management-operations.js) | Two new views, filters, evidence, session review drafts/export and timezone-correct display. |
| [Operations styles](../frontend/management-operations.css) | Compact scoped evidence/review form styles using existing tokens. |
| [planning tests](../backend/tests/management_planning.test.cjs) | Read models, relationships, failures, auth and no-write contracts. |
| [planning UI tests](../backend/tests/management_planning_ui.test.cjs) | Views, timezone, evidence, draft export, session and failure compatibility. |
| [this report](UNIFIED_OPERATIONS_PHASE_5.md) | Findings, lifecycle evidence, remediation, validation and next phase. |

No schema/dependency changes. Reverting the Phase 5 code commit is the code
rollback; there are no production data changes or new tables to undo.

## Activation recommendation and exact next step

**Assignment activation is still unsafe.** Both management creation gates remain
off: environment flag absent and assignment/config schema unapplied. Migrations
041/042, historical reconciliation, directory identity, complete windows,
customer consent, full-window availability, reschedule reacceptance and capacity/
cancellation/compensation policy remain release gates. Production frontend and
backend deployment IDs were verified unchanged.

Recommended **Phase 6: isolated scheduling-contract and reconciliation approval
rehearsal**, not activation. First implement/test one server-owned scheduling
command contract against isolated existing-calendar fixtures: exact job/order/
technician identity, explicit agreed window/timezone, expected job/assignment/
reservation revisions, conflict/availability evidence and stale-reschedule
rejection. Reuse migration 036's reservation/locking infrastructure; do not make
residential jobs masquerade as commercial leads or introduce a second calendar.
Rehearse the reconciliation manifest/approval/rollback process without production
repairs. Keep any future writer default-off.

Before a production writer, management must settle calendar capacity lanes,
duration/travel buffers, reconfirmation after reschedule, capacity hold/release
and cancellation/payout policy. A supported residential linkage/consent model
may require a separately reviewed migration and rollback plan. Durable shared
reviews likewise need explicit storage/audit approval. The undeployed HTTP
endpoint and live write lifecycle cannot be certified without an approved
staging/deployment environment and safe accounts; no such deployment occurred.
