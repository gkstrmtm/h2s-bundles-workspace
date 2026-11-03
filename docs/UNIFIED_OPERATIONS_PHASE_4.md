# Phase 4: Assignment reliability and scheduling readiness

Baseline: `92a8c2f` on `retro-dev`. Development-only changes. **Assignment
activation is NOT safe.** Neither production flag was enabled, neither migration
041 nor 042 was applied, and nothing was deployed. No production records,
technician UI, pricing, Stripe collection, compensation policy or email settings
were changed.

## Reconciliation: evidence and disposition

The registered main/Dispatch database `nkccbnrduojnzjfrpwva` was inspected using
verified TLS, a repeatable-read read-only transaction, statement timeout and final rollback.
The diagnostic exports counts and hashed case references, not names, addresses,
emails, tokens or customer records.

| Finding | Verified cause/classification | Disposition |
|---|---|---|
| 77 of 95 assignment rows reference missing dispatch jobs | Historical inconsistency; none resolves to a legacy job, order UUID/public reference or checkout session either. Assignment references have no job FK. The old acceptance fallback can insert without proving a job exists; reset/import/delete history is unavailable, so the specific historical event is **unproven**. | Retain and quarantine for management review; no guessed links or deletion. |
| 90 `offer_sent` rows do not resolve to portal technicians | Missing cross-directory relationship and writer contract defect: all 90 resolve exactly to `h2s_dispatch_pros`; none resolves to `h2s_pros`. There is one Dispatch profile, 12 portal profiles, zero shared IDs and zero shared emails. | Do not invent a technician match. Require reviewed identity reconciliation before reissuing affected offers. |
| Five `accepted` rows | All five resolve to portal technicians, but all five reference missing dispatch jobs. | Historical orphan acceptance; no job, scheduling or payout repair. |
| Three conflicting job keys | Each has one accepted row and one offer, with two distinct technician references. All three job keys are missing from current dispatch jobs. | Historical conflicts, not three current live-job collisions. Retain both histories pending review. |
| Zero legacy payout jobs | `h2s_jobs` is empty; none of 33 dispatch jobs can currently resolve to a legacy payout job. | Missing relationship/data prerequisite, not evidence that dispatch UUIDs are legacy IDs. No payout generation or approval. |
| Accepted assignment but queued job | Code defect: deployed acceptance attempted `scheduled`, then fallback `accepted`; both violate the actual dispatch status CHECK. Errors were ignored while success was returned. | Canonical managed response now commits accepted + assigned atomically. Legacy acceptance uses allowed `assigned` and reports status failures explicitly. |
| Nearby offers without prior assignment | Intentional legacy behavior: acceptance inserts an assignment; decline inserts a suppression record. | Preserved for unenrolled jobs after schema verification; not copied into the managed operation. |

Source evidence:
[assignment helper](../backend/lib/dispatchOfferAssignment.ts),
[order backfill](../backend/app/api/create_jobs_from_orders/route.ts),
[scheduling writer](../backend/app/api/schedule-appointment/route.ts),
[acceptance](../backend/app/api/portal_accept/route.ts),
[decline](../backend/app/api/portal_decline/route.ts).
The installed `auto_assign_job_to_pro` also selects from the Dispatch routing
directory, increments Dispatch capacity and writes its routing log. Source
existence proves the incompatible namespace mechanism, not which historic
invocation created each row.

The reconciliation output identifies individual cases using
`left(md5(assign_id),12)` and job cohorts using `left(md5(job_id),12)`.
Authorized operators can reproduce those expressions in the original database
to locate a review case without committing production identifiers to Git.

## Implemented contracts and compatibility

[respondToManagedOffer](../backend/lib/managedOfferResponse.ts) runs after the
existing pro JWT verification in the existing accept/decline endpoints. It never
takes technician identity from the request body or a Dispatch admin token.

1. Read existing assignment IDs. New management IDs use the opaque text namespace
   `h2s-management:`; any such history requires verified enrollment and the RPC,
   even with creation flags off. With creation enabled, enrollment is also checked
   for unmarked jobs. Migration 041 is verified unapplied and updated only to stamp
   this namespace on future IDs; no existing ID is renamed.
2. For unmarked/default-off legacy jobs, verify an existing eligible dispatch job before
   retaining the established legacy handler; malformed/missing job references
   cannot use the old arbitrary insert fallback.
3. If enrolled, call only service-owned `h2s_management_respond_to_offer`.
4. On required lookup failure, missing migration, stale schema cache, invalid RPC output
   or ambiguous result, return an explicit failure; **never fall through to a
   schema-guessing mutation**.

Default-off legacy operation does not require the unapplied management tables.
A database trigger also rechecks enrolled transitions under the existing parent
lock: a legacy handler that observed "unenrolled" before an offer committed
cannot directly accept/decline that pending offer or insert a preaccepted
assignment afterward. It must retry through the authenticated atomic operation.

The atomic operation locks the dispatch job, active portal technician and exact
management-created assignment. It rejects wrong owners, conflicting assignments,
terminal jobs, nonpending transitions and same-start-time technician conflicts.
Acceptance stores `accepted_at` and updates the job to `assigned`; decline stores
`declined_at` and leaves the queued job queued. Replays return the existing result
without another transition/audit event. A later reviewed reoffer retains earlier
decline history. Acceptance is not completion, reservation confirmation or payout
authorization.

Existing POST body and GET query `token`/`job_id`, pro authentication, endpoint
names and `ok`, `created`, `assignment`, `meta`, `is_team_job`, `team_confirmed`
envelopes remain compatible. Managed replies additionally include `job_status`
and `replayed`, with private/no-store caching. The portal still groups pending
offers in Offers and accepted assignments in Upcoming; no portal HTML changed.

Technician transitions record `source=technician_response`, the authenticated
`actor_pro_id`, old/new states and assignment/job identities. Management actors
remain separate `actor_user_id` values. Atomic rollback includes these events.
No managed response invokes mail, payment, completion or payout services.

Creation still requires both existing gates: exact environment value
`H2S_MANAGEMENT_ASSIGNMENTS_ENABLED=true` **and**
`h2s_management_assignment_config.enabled=true`. Both remain disabled in
production. Responses intentionally do not depend on these creation gates:
turning off new offers must not strand an already-issued offer.

Legacy unenrolled acceptance remains a multirequest operation. Its status-write
failure now returns 503 `job_status_unconfirmed`, permitting a retry to repair
the status without claiming full success. Historical schema guessing and nearby
offer rules are retained, not certified as globally atomic. The new concurrency
guarantee covers enrolled jobs; it is not a retroactive repair or global
uniqueness claim.

## Explicit legacy relationship strategy

[Migration 042](../backend/migrations/042_management_offer_reliability.sql) adds
an initially empty, RLS-protected `h2s_dispatch_legacy_job_links` table:

- Dispatch UUID FK, independently typed legacy text FK, one-to-one uniqueness.
- Required source-record or reviewed-reconciliation evidence, reference,
  reviewer staff UUID and timestamp.
- Service SELECT only; no browser writes, automatic backfill or write RPC.
- No shared-email, same-ID, timestamp, amount or proximity auto-matching.

The management read adapter now follows this reviewed link before querying
legacy jobs/payouts, then additionally checks order/customer consistency and
the single accepted/completed beneficiary. It supports genuinely different job
keys. Missing tables, incomplete reads, missing links and contradictions remain
explicitly unavailable/needs-review, never paid or payable by inference.
Assignment preview's `legacyPayoutBridge` likewise requires the reviewed link.

Existing completion/payout orchestration is **not modified or wired to new
links**. Approved links do not authorize payout creation. The established
completion engine still has its own legacy prerequisites; enabling differently
keyed completion attribution requires a separately reviewed future change.
With zero legacy jobs, no production link can currently be populated.

## Genuine PostgreSQL verification

[Native runner](../backend/tools/test_operations_postgres.cjs) uses existing `pg`
and caller-supplied PostgreSQL binaries, with two disposable clusters/databases,
random local passwords, SCRAM authentication and 127.0.0.1-only listening. It
loads no production configuration, verifies server data-directory identity,
executes both native suites, stops each exact cluster and removes only its owned,
marked temporary directory. Cleanup failure is explicit and retains evidence.
No global service or package installation is required.

PostgreSQL 17.11, official EDB portable Windows binaries:
**2 native suites passed; 0 failed; 0 skipped**, including:

- Simultaneous different-technician management requests; the loser is stale.
- Existing competing accepted writer blocked by the enrolled-job guard.
- Stale unenrolled legacy updates cannot bypass an offer committed afterward;
  inserting an accepted row after a managed decline is also rejected.
- Identical concurrent operation-key retry creates one offer.
- Concurrent acceptance retry produces one technician audit transition.
- Acceptance versus decline serializes; decline cannot be reversed by a retry.
- Wrong-technician acceptance is rejected.
- Rolled-back management transaction permits the identical waiting retry.
- Audit insertion failure rolls back acceptance and job status.
- Deferred job/status trigger failure rolls back the entire statement and audit.
- Retrying either failed response succeeds once after the fault is removed.
- Repeatable-read stale snapshots abort rather than create a second active row.
- Final aggregate: no job has multiple unclosed assignments; no payout created.
- Existing independent-session calendar conflict/stale-snapshot suite passes.

The managed contract also composes with the existing commercial calendar and
preparation schema: offer and acceptance preserve reservation contents and do
not create payouts. Synthetic fault triggers and rows exist only locally.

## Phase 5: precise scheduling integration sequence

1. **Read-only schedule contract first.** Reuse dispatch `due_at` as start, order
   `metadata_json.scheduled_end` as end and `scheduled_tz` as IANA timezone.
   Return unresolved if the end, timezone, order relationship or confirmed
   customer agreement is missing; do not manufacture a duration or appointment.
   Show assignment acceptance separately from reservation confirmation/readiness.
2. **Preserve the existing calendar authority.**
   [Migration 036](../backend/migrations/036_commercial_calendar_workload.sql)
   owns `commercial_reservations`, revision/idempotency checks, overlap locks,
   deferred order/job synchronization and audit. Reservations currently enforce
   a single shared company-wide capacity lane, not per-technician capacity.
   Reuse this calendar and commercial lead/order/job links; do not create fake
   commercial leads to schedule residential jobs or build a second calendar.
3. **Reconcile availability namespaces before scheduling writes.**
   [portal_availability](../backend/app/api/portal_availability/route.ts) stores
   authenticated portal `sub` day blocks in `h2s_dispatch_pros_availability`;
   routing uses Dispatch directory/capacity IDs. Prove an explicit reviewed
   identity relationship before consulting those rows for a portal technician.
   Legacy [get-availability](../backend/app/api/get-availability/route.ts) parses
   APPT order items and filters order creation dates; it is not authoritative
   installer availability. Never call `auto_assign_job_to_pro` from a read:
   it changes booked capacity and routing logs. Existing capacity is consumed
   during routing, not acceptance; the shared service must avoid double counting
   and explicitly reconcile release/hold behavior before adoption.
4. **Build one server-owned scheduling service around existing records.**
   ADMIN only, disabled by default, operation ID + expected job/order/calendar/
   assignment revisions. Require an accepted assignment, explicit agreed
   start/end/timezone, complete order identity, current availability and overlap
   checks. Establish deterministic order/job/pro/calendar lock ordering against
   all existing writers before enabling it. Extend existing reservation storage
   additively for residential identities only after a migration/rollback review.
5. **Compatibility before adoption.**
   [schedule-appointment](../backend/app/api/schedule-appointment/route.ts) uses
   a non-atomic three-orders-per-slot check and best-effort writes.
   [schedule_confirm](../backend/app/api/schedule_confirm/route.ts) and
   [customer_reschedule](../backend/app/api/customer_reschedule/route.ts) still
   attempt unsupported dispatch `scheduled` status. Their session/order-based
   customer interfaces must be preserved while routing future writes through
   the shared service; do not expose these handlers as dashboard authorization.
   Existing customer consent is not technician acceptance and vice versa.
6. **Preparation and management views last.** Reuse `h2s_job_readiness`,
   `h2s_record_job_preparation` and the existing start guard. Scope, equipment,
   access or schedule changes invalidate preparation context. Feed the current
   management calendar and Operations read model, not a new calendar/UI system.
   Test reschedule/cancel/accept races, DST, incomplete windows, day blocks,
   stale revisions, preparation invalidation and legacy portal responses.

Business approval is required for reconciling historical identities/records,
reservation capacity policy (existing global lane versus technician lanes),
travel buffers or service durations not already configured, and any production
migration/activation. These are not silently chosen as new business policies.

## Migration, rollback and activation gate

**The updated 041 then 042 must be reviewed/applied together before any management
offer is enabled**, with creation gates still off and the service schema cache
refreshed. Neither SQL file is registered for automatic production application.
Unmarked/default-off legacy operation remains compatible before these migrations;
a marked offer with missing schema intentionally returns 503 rather than risking
legacy fallback. Read-only payout-link evidence remains unavailable until 042.

Recommended future procedure: production backup and schema snapshot; isolated
restore rehearsal; approve migration checksums/target; apply both transactions;
verify browser grants, default-off config, RPCs and schema discovery; exercise
read-only staging/compatibility checks; obtain separate reconciliation and
activation approval. No such production steps were executed in this phase.

Rollback before any management offers: revert Phase 4 backend/read adapter,
then drop the new response guard/trigger, RPC/link table/actor column and restore context/audit
function definitions from 041 in a reviewed transaction. Roll back 041 separately
only if no dependent requests/events exist. After any management offer, turn off
new creation but **retain atomic response handlers, history and schema** until
all outstanding offers are reconciled. Never delete assignment/audit/mapping
records as an automatic rollback, and never restore old handlers over live
pending management offers.

Activation remains blocked by the historical cases, disconnected technician
directories, absent legacy payout jobs, unreviewed migrations and incomplete
full-window availability enforcement. Exact next implementation: Phase 5 step 1,
the read-only accepted-assignment/schedule/availability projection with unresolved
states, followed by isolated shared scheduling-contract tests. Production record
reconciliation requires separate explicit authorization.

## Validation and exact changed files

- Focused managed-response/assignment/read-model tests: **26 passed**.
- Worktree regression/layout run: **185 passed**, no skips (includes unrelated
  pre-existing local improvements; not used as the commit's sole evidence).
- Exact staged regression/layout run: **147 passed, one known baseline failure,
  zero skips**. The Customer Queue native-select styling expectation in
  `dashboard_presentation.test.cjs` fails unchanged at baseline `92a8c2f`, as
  independently reproduced with the single named test. No styling fix was staged.
- Exact staged native PostgreSQL suites: **2 passed, zero skips**.
- Strict TypeScript on both portal routes and assignment/response/read-model
  modules, development-tool syntax and staged whitespace checks: passed.
- No live assignment/acceptance/completion call was made. Live behavior of these
  undeployed changes cannot be certified without the separately authorized
  schema/deployment and a safe test account/environment.

Commands from repository root (native command needs an existing binary path):

```powershell
node backend\tools\test_operations_postgres.cjs --bin <PostgreSQL-bin-directory>
node backend\tools\reconcile_assignments_readonly.cjs --read-only
node --test backend\tests\managed_offer_response.test.cjs backend\tests\management_assignments.test.cjs backend\tests\management_operations.test.cjs
node --test backend\tests\managed_offer_response.test.cjs backend\tests\management_assignments.test.cjs backend\tests\management_assignments_api.test.cjs backend\tests\management_assignments_ui.test.cjs backend\tests\management_operations.test.cjs backend\tests\management_operations_ui.test.cjs backend\tests\operations_foundation.test.cjs backend\tests\commercial_compatibility.test.cjs backend\tests\commercial_operations.test.cjs backend\tests\commercial_calendar.test.cjs backend\tests\commercial_business.test.cjs backend\tests\stripe_order_metadata.test.cjs backend\tests\dashboard_controls.test.cjs backend\tests\dashboard_presentation.test.cjs backend\tests\dashboard_messaging.test.cjs
node --test --test-name-pattern='explicit native, multiple, listbox and hidden-model' backend\tests\dashboard_presentation.test.cjs
git diff --cached --check
```

The read-only command passed with the counts above; the last named styling test
failed as expected on an exported baseline, not the dirty working tree.

1. [portal_accept](../backend/app/api/portal_accept/route.ts)
2. [portal_decline](../backend/app/api/portal_decline/route.ts)
3. [managedOfferResponse](../backend/lib/managedOfferResponse.ts)
4. [managementOperations](../backend/lib/managementOperations.ts)
5. [unapplied migration 041](../backend/migrations/041_management_assignment.sql)
6. [migration 042](../backend/migrations/042_management_offer_reliability.sql)
7. [assignment fixture](../backend/tests/helpers/management_assignment_fixture.cjs)
8. [managed response tests](../backend/tests/managed_offer_response.test.cjs)
9. [assignment compatibility tests](../backend/tests/management_assignments.test.cjs)
10. [native assignment concurrency tests](../backend/tests/management_assignments_concurrency.test.cjs)
11. [Operations read-model tests](../backend/tests/management_operations.test.cjs)
12. [read-only reconciliation tool](../backend/tools/reconcile_assignments_readonly.cjs)
13. [native PostgreSQL runner](../backend/tools/test_operations_postgres.cjs)
14. This report.
