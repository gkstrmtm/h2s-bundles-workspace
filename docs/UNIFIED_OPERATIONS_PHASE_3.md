# Phase 3: Technician assignment integration

Baseline: `9c7fde7` on `retro-dev`. Development implementation only:
**no deployment, production migration, flag activation, assignment, or record
repair**. The technician portal, existing Dispatch writers, pricing, Stripe
collection, salesperson permissions, compensation and email settings are unchanged.

## Verified relationships and active source

Verified on 2026-11-03 using actual source plus a TLS-verified PostgreSQL
`BEGIN READ ONLY` transaction against registered main project
`nkccbnrduojnzjfrpwva`. Queries inspected schema, constraints, triggers and aggregate
counts only; no customer/technician row contents were exported.

| Entity | Verified identity and behavior |
|---|---|
| Dispatch job | `h2s_dispatch_jobs.job_id` UUID; sparse job record; text `order_id` resolves to an order UUID string or public reference |
| Assignment | `h2s_dispatch_job_assignments.assign_id` text PK; text `job_id`/`pro_id`; no job/pro FKs or active-assignment uniqueness |
| Technician | `h2s_pros.pro_id` UUID; unique email; existing management directory uses named active profiles |
| Legacy job | `h2s_jobs.job_id` text; **not interchangeable with a dispatch UUID** |
| Payout | Ledger job FK points to legacy `h2s_jobs`; beneficiary FK points to `h2s_pros`; approval and settlement remain separate |
| Job lifecycle | CHECK permits queued, assigned, in_progress, completed, cancelled, done |
| Portal contract | Assignment `pending` appears in Offers; assignment `accepted` appears in Upcoming even if job remains queued |

Observed: 33 dispatch jobs, all queued; 95 assignments (90 `offer_sent`, five
`accepted`). There are 77 assignment job references without a matching dispatch
job, 90 unresolved technician references, three job keys with multiple unclosed
assignments, zero exact dispatch-to-legacy payout-job keys, and zero ambiguous/
unresolved dispatch order references. These aggregate findings are **not repaired
or reinterpreted** by this phase.

Inspected source SHA-1 values match the active backend deployment source for
[admin_dispatch](../backend/app/api/admin_dispatch/route.ts),
[portal_accept](../backend/app/api/portal_accept/route.ts),
[portal_jobs](../backend/app/api/portal_jobs/route.ts), and
[dispatchOfferAssignment](../backend/lib/dispatchOfferAssignment.ts).

The existing schema-guessing helper is not safe for this confirmed management
action: its check/insert is non-atomic, it can return an already-existing row
without changing its state, and its legacy admin caller requests `accepted` and
starts notification work. Existing commercial assignment writes `assigned`,
which also bypasses the new offer/acceptance distinction. Neither handler is
copied, called, or changed. Instead, the shared operation uses one atomic,
reviewed-schema RPC and reuses the established assignment table, technician IDs,
order-reference rules, portal acceptance endpoint and grouping contract.

## Shared operation and API

[managementAssignments.ts](../backend/lib/managementAssignments.ts) authenticates
the dashboard session, requires `operations.assign`, checks the default-off flag,
validates input and invokes the atomic RPC. Only ADMIN has this capability.
VA, OPERATIONS and SALES cannot call it; legacy Dispatch tokens are not accepted.
Actor User_ID is taken from the authenticated session, never the request body.

Two independent gates are required: server environment
`H2S_MANAGEMENT_ASSIGNMENTS_ENABLED` must equal the exact string `true`, and
`h2s_management_assignment_config.enabled` must be true. The migration inserts
false; the production environment variable was verified absent. No environment
file, Vercel variable or production database flag was changed.

`GET /api/management-assignments?jobId=<dispatch UUID>`:

- ADMIN-only, no-store; returns `{ok:true,enabled:false}` when disabled, without
  instantiating the Dispatch client or requiring the new schema.
- When enabled, returns `{ok,enabled,job,technicians,history}`. Job includes raw
  lifecycle, schedule, order reference, existing assignments, eligibility/reason,
  payout-bridge evidence and an opaque review context fingerprint.
- Eligible directory entries project only UUID/name; the last 20 audit events
  include state transitions, actor UUID/source, timestamp and management note.
- Eligibility is conservative: queued priced installation; one exact order;
  no existing unclosed/unknown assignment or offer; no pending/unpaid, cancelled,
  refunded or disputed order state. This preserves existing portal visibility
  rules; order status is **not represented as verified Stripe payment evidence**.
- Candidates must be named active technicians without another recorded unclosed
  job at the exact same scheduled instant. This is not a new geographic,
  service-certification, duration, travel-time or capacity policy.

`POST /api/management-assignments` requires JSON:

```json
{
  "jobId": "<dispatch UUID>",
  "proId": "<existing technician UUID>",
  "operationId": "<UUID retained for retries>",
  "context": "<fingerprint from the reviewed GET>",
  "note": "<required, up to 2000 characters>"
}
```

Success: `{ok:true,assignment:{operationId,jobId,proId,assignmentId,
state:"pending",requiresAcceptance:true,replayed}}`. No job acceptance,
legacy job creation, payout calculation, ledger insertion or notification occurs.
The response describes the original offer operation; after replay the current
assignment may have advanced, so the dashboard re-reads operational evidence.

401/403 deny authentication/capability; 400 rejects malformed input; 404 means
missing job; 409 reports stale review, conflict or ineligibility; 503 covers
disabled flags, missing migration, database/transport failure. Errors include a
stable `code` and `retryable`. Ambiguous results require retrying the **identical**
operation UUID and payload; no automatic retry creates a new UUID.

## Atomicity, audit and migration boundary

[041_management_assignment.sql](../backend/migrations/041_management_assignment.sql)
is an unapplied, review-only additive draft. It is intentionally **not** added
to the production migration runner/target allowlist and does not depend on the
unrelated pending migration 040.

- Database flag defaults false; request and append-only activity tables are
  RLS-enabled. Browser roles cannot execute RPCs or write these tables.
  Service role gets SELECT and the two public RPCs, not direct audit/config writes.
- One transaction locks the operation key, dispatch job and technician, holds
  the order for share, rechecks context/eligibility, inserts a pending assignment
  and records the request/result/audit. No partial assignment survives audit failure.
- UUID reference casing is normalized for comparisons, without rewriting stored
  references or treating public order references/legacy payout keys as UUID aliases.
- Identical retry returns its recorded result; reusing a key with different
  actor/job/pro/context/note conflicts.
- All assignment writers lock an existing dispatch parent through a trigger.
  Conflict/history restrictions apply only to jobs enrolled by this operation.
  Other legacy rows are not normalized, deleted or reassigned.
- On enrolled jobs, a second unclosed assignment is rejected, identity changes/
  deletion are rejected, and state transitions are audited. Parent timestamp
  updates also protect against stale repeatable-read transactions.
- Existing acceptance updates the same assignment row to accepted. Such external
  transitions record source `existing_assignment_handler`, without falsely
  attributing them to the last manager or inventing a verified portal actor.
- RPC lock timeout is five seconds. Deadlock/timeout/transport errors are explicit
  retryable failures, not success-shaped fallbacks.

**Activation prerequisites:** separate production-risk approval; relationship
reconciliation; reviewed migration/checksum and guarded-runner registration;
independent-session concurrency validation; acceptance/status mismatch assessment;
deployment approval. None is granted or performed by this phase.

**Disable/rollback plan:** turn the application flag off first; database owner
sets the database flag false after approval. Drain in-flight requests. Keep
request/activity data for audit and preserve existing pending assignments.
Revert this source commit to remove the UI/API integration. If schema rollback
is later approved, drop only the two new assignment triggers and their functions,
then the three new management RPC/helpers, leaving the three tables read-only
for retention. Never drop existing assignment rows, jobs, orders or payout tables.
Removing the guards forfeits their enrolled-job conflict protection and requires
an explicit operational decision; disabling alone does not remove that protection.

## Dashboard implementation

The existing Operations module now opens a native modal dialog for a job.
It shows details/current assignments/audit, a radio list of eligible technicians,
a required note, then a separate proposed-offer review and explicit confirmation.
No native dropdown, Dispatch embed or copied admin handler is introduced.
The result shows pending acceptance and refreshes the Operations page.

Default-off deployments show a clear disabled message with no confirmation
control. Double submission is blocked. An uncertain request is retained in
memory across close/reopen with its original payload; it must be resolved before
another job can be proposed. Session reset clears private state and discards late
responses. Records/tokens are not added to browser storage. Styling uses existing
tokens, compact spacing and border-first hierarchy; the dialog fits desktop/mobile.

## Exact files changed

- [backend/lib/dashboardPermissions.ts](../backend/lib/dashboardPermissions.ts)
- [backend/lib/managementAssignments.ts](../backend/lib/managementAssignments.ts)
- [backend/lib/managementOperations.ts](../backend/lib/managementOperations.ts)
- [backend/app/api/management-assignments/route.ts](../backend/app/api/management-assignments/route.ts)
- [backend/migrations/041_management_assignment.sql](../backend/migrations/041_management_assignment.sql)
- [frontend/management-operations.js](../frontend/management-operations.js)
- [frontend/management-operations.css](../frontend/management-operations.css)
- [backend/tests/helpers/management_assignment_fixture.cjs](../backend/tests/helpers/management_assignment_fixture.cjs)
- [backend/tests/management_assignments.test.cjs](../backend/tests/management_assignments.test.cjs)
- [backend/tests/management_assignments_api.test.cjs](../backend/tests/management_assignments_api.test.cjs)
- [backend/tests/management_assignments_concurrency.test.cjs](../backend/tests/management_assignments_concurrency.test.cjs)
- [backend/tests/management_assignments_ui.test.cjs](../backend/tests/management_assignments_ui.test.cjs)
- [backend/tests/management_operations.test.cjs](../backend/tests/management_operations.test.cjs)
- This report, `docs/UNIFIED_OPERATIONS_PHASE_3.md`.

## Validation and blockers

| Check | Result |
|---|---|
| Workspace selected regression suites | 179 passed, zero failed, two skipped |
| Exact staged snapshot, same suites | 141 passed, one pre-existing failure, two skipped |
| Foundation/Operations/assignment subset in staged snapshot | 44 passed, zero failed, one native-concurrency skip |
| Untouched `9c7fde7` styling test reproduction | Same single Customer Queue assertion fails |
| Strict TypeScript on new/changed backend dependency closure | Passed, including staged source |
| JavaScript syntax and staged whitespace checks | Passed |
| Synthetic browser fixture, 1440px and 390px | Passed: modal fits, no horizontal overflow, explicit review/confirmation, refreshed pending offer |

Regression command (from the repository root, and repeated inside the exported
staged tree with the repository's existing dependencies):

```powershell
node --test backend\tests\management_assignments.test.cjs backend\tests\management_assignments_api.test.cjs backend\tests\management_assignments_concurrency.test.cjs backend\tests\management_assignments_ui.test.cjs backend\tests\management_operations.test.cjs backend\tests\management_operations_ui.test.cjs backend\tests\operations_foundation.test.cjs backend\tests\commercial_compatibility.test.cjs backend\tests\commercial_operations.test.cjs backend\tests\commercial_calendar.test.cjs backend\tests\commercial_calendar_concurrency.test.cjs backend\tests\commercial_business.test.cjs backend\tests\stripe_order_metadata.test.cjs backend\tests\dashboard_controls.test.cjs backend\tests\dashboard_presentation.test.cjs backend\tests\dashboard_messaging.test.cjs
```

Isolated PGlite tests execute the actual migration/RPC/trigger SQL; tests cover
default-off/service-only privileges, ADMIN/VA restrictions, invalid/disabled/
unnamed technicians, stale/ineligible jobs, duplicates, competing queued
requests, rollback on audit failure, identical retry, audit history, portal
acceptance/grouping and existing commercial calendar/preparation compatibility.
UI tests cover disabled state, selection/note/review/confirmation, escaping,
network uncertainty, retry identity, stale reload, session changes and double click.

Two genuine PostgreSQL concurrency suites require dedicated disposable local
databases and are skipped when absent:
`H2S_ASSIGNMENT_TEST_DATABASE_URL` and `H2S_CALENDAR_TEST_DATABASE_URL`.
The new test only accepts 127.0.0.1 and `/h2s_assignment_fixture_*`.
PGlite queues competing statements; **it is not proof of independent-session
locking**. That validation remains an activation blocker, not a claimed pass.

The committed baseline Customer Queue native-select styling test remains
separately reproducible in the isolated committed tree. It is unrelated to
assignment and no styling or dirty dashboard shell changes are included to fix it.

Existing acceptance also tries to set a job to `scheduled`, which the verified
CHECK rejects, after updating the assignment to accepted. Tests reproduce this:
assignment acceptance and Upcoming grouping still work. No portal/status-schema
change is made; review this discrepancy separately before activation.
The missing legacy payout bridges remain a completion/payout blocker.

No live integrated write is tested, because production assignments, migration
application, flag activation and deployment are explicitly excluded.

## Recommended Phase 4

Complete scoped relationship reconciliation and independent-session/staging
validation before expanding controls. Define an approved mapping/repair plan for
orphan assignments and legacy payout-job identities; resolve the acceptance/status
discrepancy without changing portal UX or compensation. Validate the gated
pending-offer vertical slice with the established portal and rollback plan.
Only after separate approval should migration/deployment/activation occur.
Then add a guarded scheduling operation through existing calendar services;
do not introduce more operational writers while these prerequisites are unresolved.
