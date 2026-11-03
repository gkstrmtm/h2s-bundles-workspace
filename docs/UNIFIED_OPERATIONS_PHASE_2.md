# Unified Operations: Phase 2

Development-only integration following Phase 1 commit
`caeaf9232ade2653ee9774f7e4444b3cf211b85b`. No deployment, database migration,
role activation, production record changes, email activation, or changes to
pricing, payment collection, Dispatch writers, or the technician portal.

## Authoritative boundaries

The [Phase 1 source and database map](UNIFIED_OPERATIONS_FOUNDATION.md) remains
the architectural baseline. This phase adds the following isolated boundary:

```text
frontend/dash.html -> management-operations.js + management-operations.css
                  -> existing dash.js navigation/session hooks
                          |
                 GET /api/management-operations
                          |
             dashboard session capability guard (MGMT client)
                          |
             readManagementOperations (main/Dispatch client)
                          |
             SELECTs + h2s_job_readiness + Stripe retrievals
```

MGMT/main were verified as the same Supabase project in Phase 1, but use their
existing distinct configuration helpers. External `/crm`, its database and
authentication, and technician authentication are not changed or reused as
dashboard authorization. No Dispatch legacy token is sent to the browser or
accepted by the new guard.

### Exact changed files

- [backend/lib/dashboardAuth.ts](../backend/lib/dashboardAuth.ts): opt-out session touch, default behavior preserved.
- [backend/lib/dashboardPermissions.ts](../backend/lib/dashboardPermissions.ts): new capability and ownership guards.
- [backend/lib/operationsFoundation.ts](../backend/lib/operationsFoundation.ts): comment updated for read-only validator reuse.
- [backend/lib/managementOperations.ts](../backend/lib/managementOperations.ts): read-only operational projection.
- [backend/app/api/management-operations/route.ts](../backend/app/api/management-operations/route.ts): new authenticated GET endpoint.
- [frontend/management-operations.js](../frontend/management-operations.js): isolated Operations module.
- [frontend/management-operations.css](../frontend/management-operations.css): token-based responsive styling.
- [frontend/dash.html](../frontend/dash.html): optional module loading.
- [frontend/dash.js](../frontend/dash.js): navigation, configuration and session reset hooks only.
- [backend/tests/management_operations.test.cjs](../backend/tests/management_operations.test.cjs): guard/adapter/endpoint contracts.
- [backend/tests/management_operations_ui.test.cjs](../backend/tests/management_operations_ui.test.cjs): module integration and failure/race tests.
- [backend/tests/dashboard_messaging.test.cjs](../backend/tests/dashboard_messaging.test.cjs): loader sequencing assertions updated to the declared asset list.
- This report, `docs/UNIFIED_OPERATIONS_PHASE_2.md`.

## Permissions

[dashboardPermissions.ts](../backend/lib/dashboardPermissions.ts) owns the new
capability checks. These do not replace existing route permissions.

| Stored role | New Operations read | Existing behavior |
|---|---|---|
| ADMIN | Allowed with a valid, enabled, unexpired dashboard session | Preserved |
| VA | Denied (403) | All existing routes retain their current permissions |
| OPERATIONS | Inactive; denied | No new accounts or role activation |
| SALES | Inactive; denied | No new accounts or role activation |
| Missing/invalid session or disabled user | Denied (401) | Existing auth unchanged |

Future OPERATIONS policy describes `operations.read`. Future SALES policy
describes `customers.owned.read` and `quotes.owned.read`, but both roles remain
inactive. The owned-record predicate requires the actor's existing dashboard
User_ID to equal an explicit persisted owner User_ID; ADMIN may read across
owners. No actual ownership mapping is inferred from employee names, lead
responsibility, customer email, or technician IDs. There is no new sales/customer
endpoint or grant in this phase.

Dashboard authentication has an optional `touchSession: false` mode. Only the
new guard uses it. Existing callers retain the default Last_Seen_At update and
ADMIN/VA role normalization. New management reads do not refresh sessions,
create users, or activate additional roles.

## Read-only endpoint and evidence contract

`GET /api/management-operations?offset=0&limit=25`:

- Authenticates before parsing/querying operational data; no POST/PATCH/DELETE.
- Offset is an integer 0-10000; limit is 1-25; unsupported parameters fail 400.
- Returns `{ok, readOnly, readAt, page:{offset,limit,hasMore}, jobs}`.
- Jobs are sorted by existing `updated_at` descending, then `job_id`, with a
  lookahead record. Pagination is not a transaction snapshot: concurrent updates
  can move records between pages; Refresh re-reads current evidence.
- The UI labels filters/counts as applying **only to the loaded page**, not global
  totals or a complete calendar. Larger windows need a separately designed
  server-side filter/cursor contract.
- Responses use `Cache-Control: private, no-store` and vary by authorization and
  origin. The module does not persist records/tokens in browser storage.

Each job projects its raw job status and `due_at` schedule, resolved order and
customer display fields, assignments, preparation, equipment, payment evidence,
and technician payout evidence. Relationship-dependent sections have:

```text
{status:"available", value:...}
{status:"unavailable", detail:"..."}
{status:"needs_review", detail:"..."}
```

Empty available arrays mean no matching records were returned from a complete,
successful source read, not that the source was inaccessible. Auxiliary queries
request exact counts; truncation or missing counts cannot become a false clear
state. Source windows are capped at 1001 and oversized/incomplete results require
review. A failed primary jobs read fails the request (503); auxiliary/provider
failures remain explicit at the affected section. Logs identify failing sources,
not credentials or raw customer/provider payloads.

### Identity and side-effect rules

1. A dispatch job's text `order_id` must resolve to exactly one `h2s_orders.id`
   UUID or public `order_id`; conflicting references require review.
2. Equipment scope comes from existing order `items`, `order_required`, and
   `order_stage`, not invented columns on sparse dispatch jobs.
3. Assignments retain raw states. Technician references must resolve uniquely
   through existing UUIDs or exact legacy email references. Conflicts or directory
   failures cannot be labeled a verified assignment.
4. `h2s_job_readiness` is the established SELECT-only RPC. Only its validated
   `ready` boolean and string blockers are projected. Preparation-ready does not
   mean payment clearance or scheduling authorization.
5. Consultation identifiers exclude a record from installation preparation,
   payment verification, and installation payout attribution.
6. Existing `verifyCommercialPayment` retrieves Stripe checkout/intent/charge
   evidence and checks amount, currency, settlement, refunds, and disputes.
   Order status alone is not proof. This adapter's Stripe client uses a four-second
   timeout and no automatic retries; missing configuration/provider failure is
   unavailable, not paid/unpaid. Up to five job projections run concurrently.
7. Payout linkage requires an actual legacy `h2s_jobs` row with the exact dispatch
   job key **and** customer email matching the verified order, plus one resolved
   technician assignment. Completed/done assignments remain usable for completed
   jobs. This mirrors existing completion compatibility checks; it does not
   establish equivalence for all dispatch and legacy jobs.
8. Ledger beneficiaries must match that technician. Different keys, contact
   mismatch, multiple assignments, or a different beneficiary require review.
   Approval `state` remains distinct from settlement `status`.
9. No upsert/insert/update/delete, record_* RPC, completion orchestrator,
   notification function, payout calculator, or ledger generator is called.

The UI never embeds Dispatch. Its optional loader failure is logged without
blocking established dashboard startup; API failures are announced in the
Operations pane. Refresh/pagination are GET-only. Session changes clear records
and invalidate late requests. Content is escaped before rendering.

## Verification

Run from the repository root with installed repository dependencies:

```powershell
node --test --test-reporter=dot backend\tests\management_operations.test.cjs backend\tests\operations_foundation.test.cjs backend\tests\management_operations_ui.test.cjs backend\tests\dashboard_controls.test.cjs backend\tests\dashboard_presentation.test.cjs backend\tests\dashboard_messaging.test.cjs
node --test backend\tests\commercial_compatibility.test.cjs backend\tests\commercial_operations.test.cjs backend\tests\commercial_calendar.test.cjs backend\tests\commercial_calendar_concurrency.test.cjs backend\tests\commercial_business.test.cjs backend\tests\stripe_order_metadata.test.cjs
```

Results: 69 passed in the first group; 94 passed and one skipped in the second.
The skipped genuine independent-PostgreSQL concurrency test requires the existing
`H2S_CALENDAR_TEST_DATABASE_URL` disposable local fixture; production is not an
acceptable substitute. Strict TypeScript checks cover the new backend dependency
closure. JavaScript syntax and Git whitespace checks also pass.

Tests exercise actual dashboard authentication and the new route/guard, a local
PGlite sparse operational schema with a read-only query interface, the existing
Stripe verifier with GET-only fakes, and JSDOM UI integration. Existing suites
cover scheduling, order metadata, dashboard controls/messaging/presentation,
Dispatch enrichment, technician job grouping, and payout response compatibility.
An exported staged tree is also checked to exclude dependencies on unrelated
uncommitted work: **125 passed, one failed, one skipped** across the combined
selected suites. The failure is the existing
`explicit native, multiple, listbox and hidden-model selects remain unenhanced`
assertion in `dashboard_presentation.test.cjs`: the committed Customer Queue
filter lacks `data-custom-select="off"`. Running that same test against the
unmodified Phase 1 HEAD reproduces the identical failure. It is not caused by
Operations and is intentionally not repaired by staging unrelated local UI
changes. All 28 foundation/new Operations checks pass in the isolated tree.

A local synthetic browser fixture at 1440px and 390px confirmed three-column
desktop/single-column mobile details, no horizontal overflow, minimum 36px
buttons, and visible unknown-payment/legacy-link evidence. No production login,
customer reads, payment requests, or data writes were used for this validation.

## Remaining blockers and next phase

- Production completeness/orphans, legacy job mapping, multiple assignments,
  and real payment reference quality require a separately scoped read-only data
  audit. No guessed relationships or repair writes are introduced.
- Live integrated endpoint behavior is not verified: this phase explicitly
  forbids deployment. Local tests do not certify every production record.
- New roles remain inactive. Their activation and granular write grants require
  separate approval and explicit ownership persistence.
- Technician payout attribution is not sales commission attribution. No
  commission/payment policy, new deposit policy, or proposed $599 offer is active.

**Recommended Phase 3:** first run the approved relationship reconciliation
audit, then add one ADMIN-only assignment operation through a dashboard-session
capability guard and shared existing backend assignment service. Enforce
single-assignment/conflict checks atomically, retain existing technician job
visibility/API envelopes, and test conflict, ownership, stale-state, and rollback
cases before any separate deployment approval. Do not copy Dispatch's token or
browser write handlers. Expand scheduling/readiness writers only after that
vertical slice is validated.

No schema migration or database rollback is needed for Phase 2. A source revert
of this phase's commit removes the optional module, shell hooks, GET endpoint and
new guards; default authentication and existing operational endpoints remain
unchanged. No unrelated dirty files belong in that revert.
