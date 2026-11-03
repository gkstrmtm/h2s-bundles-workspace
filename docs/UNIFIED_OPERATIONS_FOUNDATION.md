# Unified operations foundation - Phase 1

Verified 2026-11-03 on `retro-dev`, starting at
`0404ea72fc5b39bfb8073e1cb7e316131b570316`.

This is the ownership and compatibility baseline, not authorization to activate
roles, prices, payment policies, notifications, or database changes. This phase
adds only isolated contracts, a metadata inspector, tests, and this document.
Existing dirty application changes are intentionally excluded from its commit.

## 1. Authoritative source and deployment map

| Capability | Development authority | Deployment/compatibility owner |
|---|---|---|
| Management shell, hiring, tasks, time, training, accounts, messaging, media | [dash.html](../frontend/dash.html), [dash.js](../frontend/dash.js), [dash.css](../frontend/dash.css), [dash-messages.js](../frontend/dash-messages.js) | Frontend Vercel project `h2s-bundles-frontend`; `/dash` on portal/shop. Keep existing features. |
| Customer Queue, installation operations | [commercial-operations.js](../frontend/commercial-operations.js), [operations API](../backend/app/api/commercial-operations/route.ts) | Main backend, existing lead/order/job records and guarded operations RPCs |
| Quote/evidence records | [commercial-business.js](../frontend/commercial-business.js), [business API](../backend/app/api/commercial-business/route.ts), [file API](../backend/app/api/commercial-business-files/route.ts) | Main backend; private business evidence is not public website media |
| Calendar, workload, preparation | [commercial-calendar.js](../frontend/commercial-calendar.js), [calendar API](../backend/app/api/commercial-calendar/route.ts), [migration 036](../backend/migrations/036_commercial_calendar_workload.sql) | Shared reservations, job/order schedule, readiness and synchronization |
| Separate Dispatch management | [frontend/dispatch.html](../frontend/dispatch.html) | Current production bytes also match [backend/public/dispatch.html](../backend/public/dispatch.html); retain both until release ownership is consolidated |
| Technician experience | [backend/public/portal.html](../backend/public/portal.html), dedicated `portal_*` APIs | This copy byte-matches production. Do not edit the UI or promote the different [frontend copy](../frontend/portal.html) |
| Checkout/payment | [shop API](../backend/app/api/shop/route.ts), [Stripe webhook](../backend/app/api/stripe-webhook/route.ts), [payment verifier](../backend/lib/commercial_payment.ts) | Existing Stripe account/workflow and order records; unchanged |
| Technician earnings | [completion orchestration](../backend/lib/dataOrchestration.ts), [portal payouts](../backend/app/api/portal_payouts/route.ts) | Existing technician ledger and pro ownership; approval is not transfer |
| Contact CRM/campaigns | Existing [h2s-campaign-intake repository](https://github.com/gkstrmtm/h2s-campaign-intake/tree/b694eb1e0e694421c598bc6aa99127899e664cf9) | Separate Vercel project and Supabase project; not a new module/database to recreate |
| Proposed pricing | [v2 reconciliation](../config/pricing/home2smart.v2.json), [reconciliation engine](../config/pricing/reconciliation/reconcile.cjs), [equipment](../config/pricing/equipment.v1.json) | Draft authority only. v1 and v2 are proposed, not automatic checkout sources |

Routing authority: [frontend routing](../frontend/vercel.json) proxies `/api/*`
to `h2s-backend.vercel.app`, sends technician portal traffic to the backend static
portal, and redirects `/crm` to `https://h2s-campaign-intake.vercel.app/crm`.
The redirect returned 307 and the destination returned 200. It is not dashboard
SSO or a shared-record API.

[Backend routing](../backend/vercel.json) owns Next API/static routes and existing
crons. The root [routing configuration](../vercel.json) and root dashboard
duplicates are alternate/legacy deployment inputs, not the current frontend
release authority. The backend `/dash.html` serves an older build. Do not delete
duplicates or overwrite newer local files from deployed copies in this phase.

### Verified releases

| Project | Production deployment | Evidence |
|---|---|---|
| Frontend | `dpl_BRTZZG9tsPnwUFyMxqyjSSUwZkNC` | Dashboard build `PORTAL_BUILD_20261102_175205_mediafix` |
| Backend | `dpl_8RTmC8XK1YUs78sj5mshQNueE46M` | Fourteen inspected route/helper source hashes match the workspace |
| External CRM | `dpl_8riQeaRLERVFW7owekb8H2m7TKGw` | Production project metadata identifies Git commit `b694eb1e0e694421c598bc6aa99127899e664cf9`, branch `main`; repository source inspected at that commit |

Backend hash checks covered Supabase selection, all three authentication helpers,
payment verification, shop, webhook, commercial operations/business/calendar,
portal jobs/payouts/completion, and admin dispatch.

Dispatch SHA-256:
`3b1a07b98e3853c9df24431309ed869d510f76daed91e8956de54a040ebb9b01`.
Technician portal SHA-256:
`5ea81881b1b6c57eec46ee6e9f61b5689ee8498a272e8c1eb2f2c853bf97e3c6`.

Live dashboard HTML and the three commercial modules differ from local sources.
The newer local Overview/media/layout work is not established as deployed.
Deployment stamps are not Git revisions or proof that the entire dirty tree was
released. Future releases must stage a complete, explicitly selected tree.

## 2. Database ownership - verified, not inferred

Only public project references are recorded here. Credentials were kept in memory
and were neither printed nor committed.

| Configuration/system | Verified production project | Result |
|---|---|---|
| Backend `SUPABASE_URL` / main | `nkccbnrduojnzjfrpwva` | Main operational records |
| Backend `SUPABASE_URL_MGMT` | `nkccbnrduojnzjfrpwva` | Same project today, despite separate configuration and client |
| Dispatch client | Main project above | [getSupabaseDispatch](../backend/lib/supabase.ts) returns main |
| DB1 | No production URL configured | `getSupabaseDb1()` returns null; shop's DB1 preference currently falls back to main |
| External CRM `SUPABASE_URL` | `ulbzmgmxrqyipclrbohi` | Separate contact/campaign database; do not copy it into a new customer registry |

Production Vercel variable values were resolved read-only to project references.
The main/MGMT URL configurations predate the current deployment. Local direct
main and management connection references agree with the main project.

Main schema was inspected using verified TLS, `BEGIN READ ONLY`, catalog-only
SELECTs, a statement timeout and `ROLLBACK`. No customer/order/payment rows were
read. The applied migration ledger contains 029 through 039. All eight inspected
operations/business/calendar/preparation/Stripe RPC names are present. Presence
and history do not prove every function body, grant or existing data row is valid.
Draft migration 040 was not applied or included.

External CRM metadata was verified through a read-only PostgREST OpenAPI GET:
`crm_contacts`, `leads`, `crm_events`, `crm_contact_tags` and
`crm_message_outbox` exist. `crm_events.contact_id` references
`crm_contacts.contact_id`. No campaign endpoints or sends were invoked.

### Identifier and relationship map

| Domain | Existing authoritative identifier and relationships | Missing/unsafe assumption |
|---|---|---|
| Staff/session | `Dashboard_Users.User_ID` UUID; `Dashboard_Sessions.User_ID` FK; session ID separate from hashed bearer token | A staff account is not a pro profile or a customer |
| Contact/person | External CRM `crm_contacts.contact_id` | No verified durable bridge to an internal inquiry/order. Email/phone are search attributes, not foreign keys |
| CRM intake | External `leads.lead_id` | Not the same namespace as internal `commercial_leads.lead_id` |
| Service inquiry | Main `commercial_leads.lead_id`; residential/commercial market comes from attribution | One person can have multiple inquiries; do not collapse them or invent a second person ID |
| Consultation | `commercial_consultation_requests.request_id` FK to lead; `related_order_id` is UUID | Consultation orders are not priced installation orders |
| Queue/activity | Operations row keyed by lead; activity `operation_id` UUID; `(lead_id,revision)` unique | `responsible_id` is operational responsibility, not authenticated creator or future sales ownership |
| Quote/version | Current quote JSON keyed by lead. Immutable quote events use `commercial_business_activity.operation_id`, `lead_id`, `revision`, `action='quote'` | No independent quote table/ID; business revision also advances for non-quote events |
| Business payment evidence | `payments` JSON plus business activity operation IDs | Staff-recorded evidence is not verified Stripe settlement or a new balance ledger |
| Order | `h2s_orders.id` UUID PK; `order_id` unique public text reference; Stripe session/intent references stored on order | `user_id` is not a verified CRM contact link; amounts/status alone do not prove payment |
| Lead -> installation | Operations `order_id` UUID FK to order PK and `installation_job_id` UUID FK to dispatch job; both null or both present; each unique | Existing structure permits one linked installation per inquiry, not arbitrary multi-order conversion |
| Dispatch job | `h2s_dispatch_jobs.job_id` UUID; `order_id` text accepts UUID-text or public reference in existing code | No order FK on this text column. Resolve exactly one order; zero/multiple matches must block writes |
| Recipient | Job `recipient_id` FK to `h2s_recipients`; recipient has unique `recipient_key` and `external_lead_id` UUID | `external_lead_id` has no verified cross-project link. Never choose an arbitrary existing recipient |
| Assignment | `assign_id`, `job_id`, `pro_id`, `state` are text | Only PK is enforced on assignment table; no job/pro FKs or proven single-active-assignment constraint |
| Technician | `h2s_pros.pro_id` UUID, unique email | Resolve legacy text/email identities explicitly; never insert dashboard users into this table to enable commissions |
| Legacy job | `h2s_jobs.job_id` text PK | Distinct from dispatch jobs; equal-looking IDs are not an enforced bridge |
| Technician payout | `h2s_payouts_ledger.payout_id` UUID; `pro_id` required FK to pro; nullable `job_id` text FK to **h2s_jobs**; unique `(job_id,pro_id,payout_type)` | Dispatch completion must preserve/verify legacy-job compatibility before ledger writes |
| Attachments | Private `commercial_business_files.file_id`, lead/job FKs; customer uploads; portal dispatch artifacts; legacy job artifacts | Legacy `h2s_job_artifacts.job_id` references **h2s_jobs**. Portal also uses distinct `h2s_dispatch_job_artifacts`; do not conflate them |
| Scheduling/preparation | Reservation keyed by lead; preparation keyed by dispatch job UUID; activity uses operation IDs/revisions | Consultation acceptance, reservation, technician acceptance and completed installation are separate states |

Payout settlement `status` permits `pending`, `paid`, `cancelled`; separate `state`
is unconstrained text. Portal responses normalize approval states for display.
Do not write `approved` to the constrained settlement status or interpret a
normalized portal response as a bank transfer.

The main database has `h2s_services`/`h2s_bundles` but not `services`, `bundles` or
`price_tiers`, which the shop catalog handler attempts to read. Other catalog
paths and frontend fallbacks therefore remain separate evidence sources. This
phase records that gap; it does not repair pricing or switch public offers.

### End-to-end blockers

1. No verified CRM-contact -> internal inquiry/order bridge or approved identity
   matching process. Cross-project relationships cannot use ordinary Postgres FKs.
2. No priced, versioned offer -> immutable quote -> order/Stripe linkage.
3. Current quote approval is staff-recorded evidence, not an integrated acceptance
   record for exact calculated line items and scope.
4. No field-sales ownership/attribution contract wired to existing account IDs.
5. Dispatch -> legacy job/ledger/artifact compatibility is not enforced by a shared
   FK. Existing production data correspondence was deliberately not sampled.
6. Assignment text references and concurrent assignment consistency need guarded
   server operations; copying the legacy insert/check loop is insufficient.

## 3. Shared server-owned contracts

[operationsFoundation.ts](../backend/lib/operationsFoundation.ts) is deliberately
not imported by live handlers. It adds types and pure validators only.

| Contract | Meaning |
|---|---|
| `CustomerContext` | Existing inquiry UUID and market, plus nullable existing CRM contact reference with source project. Null means unresolved, not a new customer |
| `EmployeeReference` | Existing dashboard account UUID and existing role only |
| `OfferReference` | Service ID, offer ID and approved catalog version, server-resolved; proposed shape, not an available live catalog |
| `QuoteReference` | Lead UUID + persisted quote-event operation UUID + exact business-event revision |
| `OrderReference` | Database UUID `id` and distinct public `orderId`; retain both |
| `PaymentReference` | Canonical order UUID plus nullable existing Stripe session/intent IDs; no amounts, balances or duplicate payment ledger |
| `JobReference` | Dispatch UUID plus raw existing order reference |
| `TechnicianAssignment` | Existing assignment/pro/job identifiers; preserve raw assignment state independently |
| `TechnicianPayoutReference` | Existing ledger identity/pro/job/type; separate raw settlement and approval state |
| `ProposedSalesAttribution` | Existing representative account, exact quote event and nullable policy version; no commission calculation or payable promise |

`resolveOrderReference` supports existing UUID/public-reference joins and rejects
unresolved or ambiguous matches. `validateInstallationLink` checks identifiers,
market, order/job linkage and quote/inquiry consistency. A CRM reference requires
the configured source project, never a project supplied by an untrusted client.
These checks do **not** prove that an arbitrary supplied record exists: future
adapters must fetch authoritative rows, quote events and CRM contacts server-side.

`classifyJobStatus` is a read-model vocabulary only. It preserves raw values,
recognizes `done` as completion, and reports unknown/assignment/payment states as
`unmapped`. It does not change stored states or the technician portal's broader
historical grouping. Reservation, assignment, job lifecycle, payment and payout
settlement must remain independent.

All future writes must use authenticated actors, server-loaded records, optimistic
revisions/idempotency keys, exact currency and integer minor units at API boundaries.
Existing order money is numeric dollars; conversion must follow the existing
Stripe verifier, not reinterpret persisted amounts as cents.

## 4. Proposed roles and ownership - NOT activated

| Capability | ADMIN | OPERATIONS | SALES | VA |
|---|---|---|---|---|
| Account/role administration | Yes | No | No | No |
| Customer/operational records | All | Operational scope | Assigned/created inquiries only | Existing authorized tasks only |
| Assessments/photos | All | Operational scope | Owned inquiries; controlled upload/access | Existing explicit access only |
| Quotes | Authorized full control | Standard approved offers; exceptions require approval | Standard offers for owned inquiry; no arbitrary prices | No new access |
| Scheduling/dispatch/preparation | Yes | Yes within operations scope | Request/view own handoff, not assign technicians | No new access |
| Payment evidence | Authorized review | Operational payment status | Status/link for own authorized quote; no settlement override | No new access |
| Technician payout approval | Finance-authorized administrator | No by default | No | No |
| Pricing publication, commission policy | Explicitly authorized administrator | No | No | No |
| Commission view | Authorized management | Only explicit reporting permission | Own attribution/results only | No |

This is the recommended future policy, not grants implemented by this commit.
Existing `ADMIN`/`VA` behavior is preserved, including current unknown-role
coercion to VA. Do not store new role values until all parsers/guards are upgraded.

Use the existing dashboard session/account system for staff. Future backend
guards must verify account enabled/session validity, capability, record ownership,
and requested transition. Never trust a browser-provided owner/actor/role.
`responsible_id` does not itself grant permission. Global queries and private file
URLs must be ownership-filtered on the server, not just hidden in navigation.

Keep technician JWT authentication and assigned-job access unchanged. A future
management adapter authenticates dashboard sessions itself; it must not forward,
mint or expose legacy Dispatch admin tokens. The existing dispatch login/legacy
guard mismatch remains a separate compatibility issue, not permission to relax
authorization.

SQL business/operations RPCs also enforce ADMIN actors. A future operations role
requires narrowly reviewed SQL guard changes as well as TypeScript/API changes;
changing a navigation label or one role union is insufficient.

## 5. Dispatch consolidation boundary

| Capability | Reusable implementation/data | Boundary before a dashboard adapter |
|---|---|---|
| Job detail/lifecycle | Operations API, operations RPC, existing job/order joins | Explicit installation identity; preserve consultations; revision/transition guards |
| Assignment | Existing assignments/pros; [assignment helper](../backend/lib/dispatchOfferAssignment.ts), guarded operations | Retain accepted-offer visibility in portal; serialize conflict detection; do not copy schema-guessing writes |
| Equipment/preparation | Existing ordering metadata, `h2s_job_readiness`, `h2s_record_job_preparation` | Preserve delivered/not-needed semantics and context invalidation; ordering plans are not procurement |
| Scheduling | Calendar/reservation RPCs, existing schedule operation and Stripe metadata patch | Customer agreement, capacity, timezone, stale-write and synchronization guards |
| Payment status | `verifyCommercialPayment` and signed Stripe webhook | Verify exact linked order amount/currency/intent, refunds and disputes; no new checkout/deposit workflow |
| Technician payouts | `ensureCompletionSideEffects`, ledger, portal payout normalization | Existing pro/job FK and idempotency; settlement versus approval; no sales users in required pro FK |
| Reporting | Existing dashboard/dispatch read models and underlying facts | Server-scoped reads, documented metric definitions, unknown/missing data explicit |
| Customer assessment photos | Private business files and existing photo/artifact endpoints | Assigned-technician authorization and compatible projection, not public/private storage conflation |

Some code is reusable as behavior/reference rather than safe to invoke wholesale:
legacy assignment, payout approval and completion paths have notification side
effects. New adapters must separate authorization, state change and side effects;
they must not activate emails. Dispatch bulk payout approval is a UI placeholder,
not feature parity that exists today.

### Technician contracts that must survive

- `portal_login`/`portal_me`: established pro token and pro identity.
- `portal_jobs`: `{ok, offers, upcoming, completed, ...}`; preserve normalized job
  details, assignment state, job lifecycle, service location and payout estimates.
- `portal_accept`/`portal_decline`: existing assignment ownership and state behavior.
- `portal_mark_done`: authentication, assigned-pro ownership, completion proof
  behavior, completion effects, idempotency and existing response/error shape.
- `portal_payouts`: `{ok, rows, ...}` and existing numeric fields/normalized states;
  scope to authenticated pro; preserve settlement records.
- `portal_get_artifacts`: `{ok, artifacts}`; upload keeps top-level `artifact_id`.
- `customer_photos`: existing `uploads` envelope and assigned-technician access.
- Profile, training, announcements, customer history and on-my-way endpoints remain
  unchanged. UI retirement must not remove APIs merely because Dispatch used them.

No separate Dispatch screen is retired and no endpoint is replaced in Phase 1.

## 6. Future change/migration and rollback plans

No schema migration is necessary or supplied for this phase. Removing its isolated
files is sufficient rollback; no production record depends on them.

| Later change | Forward plan | Rollback plan |
|---|---|---|
| Contact bridge | Resolve existing CRM contact in its source project; persist a namespaced reference in existing inquiry attribution/order metadata through guarded operations, not a new registry | Disable bridge adapter; retain inert references/history; do not delete CRM contacts or roll back unrelated metadata |
| Quote/order attribution | Reuse quote activity operation ID and existing order metadata for exact quote/catalog/account references; require frozen source snapshots | Stop new conversion; retain paid-order references and history; never rewrite completed orders to old pricing |
| Role guards | Update every parser/account CRUD/API/SQL guard under a disabled activation gate; if function changes are needed use a reviewed versioned migration restoring prior grants/definitions exactly | Disable activation, revoke affected sessions and prevent new-role sign-in; restore previous function definitions only after ensuring no users can be accidentally coerced into broader legacy access |
| Assignment enforcement | First perform a separately approved read-only data audit. If required, plan additive canonical references/partial uniqueness only after resolving orphans/conflicts | Disable new writer; retain old columns and portal APIs; remove only newly introduced constraints/indexes after compatibility verification; never silently delete assignments |
| Legacy job bridge | Reuse established legacy rows and prove mapping before completion/payout; no new job system. Any added reference must be nullable/additive and explicitly backfilled under later approval | Disable bridge writes and retain existing job/ledger rows; do not repoint or drop payout/artifact FKs |
| Sales compensation | Keep attribution in existing quote/business history pending approved policy. Existing payout ledger requires a technician FK, so it cannot accept staff accounts unchanged | Keep commission activation off. A future reviewed attribution/recipient extension must preserve the technician ledger, not create a duplicate payment ledger or fictitious pro |

Any later DDL needs target/TLS verification, exact checksum, prerequisite and
data-conflict checks, transaction/locking review, compatible read/write rollout,
reversible SQL or explicit forward-only recovery, and separate production approval.
No backfill, role expansion, policy setting or paid-order mutation is authorized
by this document.

## 7. Development diagnostics and validation

The new [metadata inspector](../backend/tools/inspect_operations_foundation.cjs)
uses existing registered targets and verified CA configuration. From `backend`:

```powershell
node tools\inspect_operations_foundation.cjs --target production
```

It reads only schema metadata/migration versions, never customer rows. It accepts
no apply mode, runs in a read-only transaction, always rolls back, and emits no
connection strings or key values. It loads existing local migration/backend env
files without overwriting process variables. Required: registered
`DATABASE_URL_DIRECT`, valid `MIGRATION_CA_CERT_PATH`, and metadata-read access.
Do not use a disabled-TLS workaround. Missing tables are reported, not created.
The CLI must only be invoked deliberately; it is not part of app startup or tests.

From repository root, focused validation commands:

```powershell
node --check backend\tools\inspect_operations_foundation.cjs
node backend\node_modules\typescript\bin\tsc --noEmit --strict --skipLibCheck --target ES2020 --module commonjs backend\lib\operationsFoundation.ts
node --test --test-reporter=tap backend\tests\operations_foundation.test.cjs backend\tests\commercial_compatibility.test.cjs backend\tests\commercial_operations.test.cjs backend\tests\commercial_calendar.test.cjs backend\tests\commercial_calendar_concurrency.test.cjs backend\tests\commercial_business.test.cjs backend\tests\stripe_order_metadata.test.cjs
```

Contract tests cover ambiguous/UUID/public IDs, cross-project provenance, exact
quote revision, separate lifecycle states, existing dashboard/Dispatch auth
boundaries, read-only inspector rollback, existing sparse dispatch relationships,
and actual technician payout response ownership/normalization. Existing suites
cover linked orders, Stripe verification/metadata races, calendar conflicts,
assignment/completion ownership, business evidence and technician compatibility.
Tests use local fixtures/mocks; no production API writes or sends are exercised.

Validation results on 2026-11-03:

- Syntax check and strict standalone TypeScript check passed.
- Combined selected suites: **103 passed, 1 skipped, 0 failed** (104 tests,
  including nested tests).
- The skipped independent-PostgreSQL concurrency test requires
  `H2S_CALENDAR_TEST_DATABASE_URL` pointing to an isolated loopback fixture
  database. It was not configured; no production URL was substituted.
- All **9 new foundation tests also passed against an exported staged tree**
  using committed dependencies rather than unrelated working-tree modifications.
- The actual diagnostic CLI succeeded: verified TLS/read-only transaction,
  28 inspected table names, 25 present, 8 RPC names, 11 migration entries.
  The three missing catalog table names are listed above, not silently created.

### Remaining verification limits and exact next step

- No real-customer joins were sampled. Contact matching, orphan/duplicate
  assignments and dispatch/legacy-job correspondence need a separately scoped
  read-only data audit before affected writes are migrated.
- External CRM deployed source-file listing returned HTTP 404. The production
  Git revision was verified from project metadata and source inspected at that
  revision; a per-function deployed-source hash comparison was unavailable.
- CRM app-key/deployment-protection settings are not dashboard SSO. A
  server-to-server adapter still needs scoped credentials and explicit ownership
  authorization; no keys may be sent to a salesperson browser.
- No charge, refund, payout transfer, real login, upload, notification or
  operational acceptance mutation was performed. Existing unknown-role behavior
  is documented, not endorsed as the future access policy.

**Next implementation step:** Phase 2, add a shared dashboard-session capability
guard and read-only management adapter using current ADMIN/VA behavior first.
Contract-test forbidden roles and cross-record access; keep future role activation,
new writes and technician APIs unchanged until the expanded authorization path
(including SQL guards) is fully verified. Do not start screen migration first.
