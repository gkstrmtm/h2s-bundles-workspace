# Phase 6: Field Sales foundation

Base: `71600bd3fd6584763606eb935dfb28eef65e3fc8`, branch `retro-dev`.

## Status and operational boundaries

Implemented inside the existing dashboard, not a separate CRM or application.
This is development-only, disabled-by-default foundation work, **not approval to
activate salesperson access in production**.

- Application gate: `H2S_FIELD_SALES_ENABLED` must equal `true`.
- Database gate: `field_sales_settings.enabled` defaults to `false`.
- Representatives require an enabled existing dashboard user with role `SALES`
  and an explicitly active representative record. Account creation is disabled
  by default; enabling is a separate ADMIN action.
- Migration 043 was executed only in isolated, synthetic PGlite databases. It was
  not applied to production. No production accounts, leads, photos or records
  were created or changed.
- Both management assignment gates remain untouched and disabled. No Dispatch,
  technician portal, checkout, pricing, payout or notification handlers changed.
- No deployment or paid dependency was introduced.
- Read-only production boundary checks found unchanged frontend/backend
  production deployment IDs, absent Field Sales/management-assignment
  application flags and `404 PGRST205` for the Field Sales setup relation.

## Screens and workflows

The existing dashboard loads an optional Field Sales module. A missing module
does not block existing ADMIN/VA startup; SALES startup fails closed rather than
opening staff panes. SALES startup returns before hiring, tasks, training,
Operations or staff refresh setup. SALES receives an isolated mobile shell,
text-led navigation and sign-out. ADMIN retains the existing shell.

1. **My Dashboard:** assigned prospects, loaded due follow-ups, current opportunity
   states and links to assessments.
2. **New Prospect:** customer name/phone, property address/city, market,
   configurable service interests, notes and timezone-bearing follow-up.
3. **Property Assessment:** configured service questions, equipment preferences,
   quantities/installation requirements, draft/submission, saved photo permission,
   labeled private photos and shared prospect history.
4. **My Opportunities:** ownership-scoped worklist, service interests, assessment
   state, review state and follow-up activity.
5. **ADMIN oversight:** all representatives' opportunities, representative filter,
   exact existing Customer Queue inquiry attachment with evidence, reassignment
   with reason, review/needs-information/closed classifications, disabled account
   creation and explicit enable/disable with session revocation.

Lists load the latest 100 matching opportunities and expose the total. The UI
labels that boundary; this phase does not implement full-list pagination or
server-side search. ADMIN can use Customer Queue for complete inquiry review.
Photo requirements are visible evidence requests; missing photos do not
silently become evidence or an approved quote. A reviewed assessment is explicitly
not quote approval.

Operational Compact guidance was retrieved before styling. Scoped styles use the
existing tokens and typography, two-column desktop forms, single-column phone
forms, 16px phone inputs and at least 44px phone buttons. Selects explicitly use
the repository's native-control opt-out for predictable phone input; no new
select framework or calendar was introduced.

## Authentication and server-enforced ownership

- Both existing dashboard session readers now explicitly distinguish ADMIN, VA
  and opt-in SALES. Unknown/future roles no longer inherit VA.
- Existing ADMIN/VA credentials, role behavior, session TTL and staff capabilities
  remain intact. Existing staff session consumers do not opt into SALES.
- SALES login uses the existing PBKDF2-SHA256/120,000-round credential contract,
  random salt and hashed bearer sessions. New temporary credentials require at
  least 16 characters; the ADMIN form generates a random 32-character credential.
- SALES sessions expire after eight hours. Tokens carry the `h2s-sales:` namespace;
  the legacy v1 API rejects them except for `dashboardMe` and logout. The client
  never attaches a saved legacy ADMIN key to those requests. SALES startup clears
  any previous saved/verified ADMIN proof and fails closed if that cleanup fails.
- Legacy impersonation cannot target SALES. A migration trigger prevents legacy
  account editors from converting SALES into VA, or another role into SALES.
- Account enable/disable revokes existing sessions. Each business request checks
  the authenticated database user, enrollment and both feature gates. No actor ID
  or claimed role from the request body is trusted.
- SALES-created prospects are owned by the authenticated representative,
  regardless of a submitted owner. Only ADMIN can attach existing inquiries,
  reassign records, review assessments or manage accounts.
- SQL repeats ownership, active-user, revision, service-version and gate checks
  under transaction locks. Actor/user and representative locks precede lead and
  opportunity locks. Stale revisions and changed idempotency payloads conflict.
- New tables have RLS enabled, no browser grants and no browser-executable RPCs.
  The server service role can select configuration and execute scoped functions;
  it does not receive direct write grants on the extension tables.
- Responses are private/no-store. Token changes/reset discard records, pending
  views and object URLs; late JSON and photo blobs cannot render for a new session.

This preserves the existing bearer/local-storage session mechanism; it is not a
replacement authentication service or a comprehensive audit of every pre-existing
anonymous/legacy API surface.

## API and data contracts

### `/api/field-sales`

Authenticated ADMIN/SALES only. GET returns explicit `enabled:false` without
customer data when the application flag is off. Enabled GET lists authorized
opportunities or returns one exact `leadId` with its safe inquiry projection,
assessment, shared history/follow-up and photo metadata. Public inquiry tokens
are not returned.

POST requires a UUID `operationId`:

| Action | Contract |
|---|---|
| `account_create` | ADMIN; username, display name, temporary credential; creates disabled user/representative |
| `account_state` | ADMIN; user UUID and explicit active boolean; revokes sessions |
| `create` | Market, name, phone, address/city, selected service IDs, notes, follow-up; server determines SALES owner |
| `attach` | ADMIN; exact existing lead UUID, representative UUID and identity evidence |
| `save` | Owned lead UUID, expected revision, service IDs/answers, consent boolean/evidence, notes, follow-up, submit boolean |
| `assign` | ADMIN; lead, revision, active representative and reason |
| `review` | ADMIN; lead, revision, reviewed/needs_information/closed and reason |

Operations are transactionally audited and idempotent by actor, operation key and
semantic payload. Credential retries compare a fingerprint, not regenerated salt.
Replayed business writes revalidate current ownership. Follow-up and shared
history updates occur in the same SQL transaction. No success is returned after
an audit failure. Interrupted client saves retain the exact pending action for
manual retry, not an automatically rewritten payload.

### `/api/field-sales-photos`

POST accepts an owned lead, operation UUID, configured service/label and a bounded
JPEG/PNG/WebP data URL. The server validates base64, size, signature and digest;
the phone renderer resizes to 1600px/JPEG and removes original image metadata.
Current saved customer permission is required at reservation and completion.

Uses the existing **private** `commercial-private-files` bucket and
`commercial_business_files`, plus permission/label extension metadata. There is
no public bucket fallback, public media placement or returned signed URL.
Upload is pending -> private object -> ready; failed/uncertain uploads remain
pending for exact retry, not silent deletion or overwrite.

Only the first pending-to-ready completion advances the opportunity/Queue
revisions and appends photo history. New evidence invalidates ready/reviewed
assessment state. Ready retries audit once. SALES cannot add evidence to a closed
opportunity. GET is an authenticated private proxy that rechecks current
ownership, permission and revision after downloading. Ownership changes or
revoked permission deny future proxy reads; already downloaded images cannot be
retroactively recalled. Existing ADMIN business-file tooling retains its
established access.

## Customer identity and existing system reuse

`commercial_leads` is already the shared residential/commercial **inquiry**
infrastructure, not a new person/customer registry. The opportunity primary key
is that same `lead_id`. ADMIN attachment reuses an exact existing UUID and never
copies the inquiry. A normalized-phone collision is a conservative creation veto,
not proof that records describe the same person. Names, email and similar-looking
IDs never cause automatic merging.

The external CRM has no verified identity bridge; this phase does not guess one.
Existing non-Field-Sales intake writers do not participate in the new phone
advisory lock, so cross-channel/global de-duplication is not claimed.

- `commercial_lead_operations.next_follow_up_at` remains the single follow-up
  authority; the extension does not duplicate its calendar.
- `commercial_lead_activity` remains shared history, with Field Sales action
  names, actor, reason/evidence and revisions.
- Queue responsibility labels are not treated as authorization. The extension's
  explicit owner controls SALES access.
- Field-origin inquiry service labels stay synchronized with configured
  assessment selections. Attached pre-existing inquiries retain their original
  intake labels/data; the extension carries subsequent assessment interests.
- New prospects create no consultation request, appointment, order, dispatch job,
  payment, payout or outbound message.

## Configurable service scope

Migration 043 seeds versioned assessment definitions for:

- TV mounting;
- customer-owned camera installation;
- equipment-included cameras;
- smart locks;
- soundbar mounting;
- smart-home setup.

Definitions include residential/commercial applicability, question types,
required answers, limits/options and photo labels. The latter three remain
**future service interests**, not activated offers. No prices or package prices
are copied into this module. The renderer accepts future backend definitions
without service-specific UI branches.

Malformed/empty configuration fails explicitly. Submissions validate required
answers; all saves validate configured questions, numeric bounds/options and
current definition versions. Unavailable selected definitions visibly block
editing instead of silently discarding an existing service.

## Migration and rollback preparation

Review-only [migration 043](../backend/migrations/043_field_sales.sql) requires
007/014/031/032/035/037 and verified co-location of dashboard and inquiry tables.
Configured main/MGMT project URLs must agree. It adds six extension/configuration
tables, scoped functions, browser restrictions, a SALES role-transition guard and
a narrowly extended inquiry market guard.

The market guard retains existing immutable market, residential availability and
non-field residential intake rules. Only field-origin descriptive service
interests gain the backend-configured labels. It does not activate pricing or
public offers. Field intake provenance cannot be changed through later updates.

Before any authorized staging/production application:

1. Keep both new gates off. Verify prerequisites, same-project credentials,
   existing migration/function checksums, private bucket and a restorable backup.
2. Rehearse on an isolated database with production-shaped schema, never by
   inserting synthetic customers into production. Review trigger compatibility
   with current Customer Queue writers.
3. Apply the reviewed transaction only after explicit approval, then inspect
   grants/defaults and validate disabled-account login.
4. Separate approval is required for enabling the database gate, application
   gate, representative enrollment and any subsequent deployment.

**Rollback before use:** verify there are no dependent customer/assessment/file
rows; restore the exact migration-037 market guard; remove the new role trigger
and trigger function, then photo/command/read/access functions and extension
tables in dependency order (photos, commands, opportunities, representatives,
services, settings). Retain the pre-change backup/checksums.

**Rollback after use:** disable access/writes and revoke SALES sessions first.
Retain inquiries, assessments, consent, files and audit history. Use an approved
forward/compensating migration with explicit evidence and rollback verification.
Never delete customer records or evidence as an application rollback.

## Validation results

Validation used synthetic accounts/data and the exact staged export, excluding
unrelated working changes.

| Validation | Result |
|---|---|
| `node --test backend\tests\field_sales.test.cjs backend\tests\field_sales_ui.test.cjs` | 12 new tests passed |
| Exact staged combined contract/integration/regression command below | 175 tests: 174 passed, 1 known unrelated styling failure, 0 skipped |
| Scoped TypeScript compiler API: strict, ES2020, CommonJS, Node resolution, noEmit, skipLibCheck | 0 diagnostics for both new routes, shared Field Sales library and dashboard session library |
| v1 TypeScript parser; `node --check frontend\dash.js`; `node --check frontend\field-sales.js` | Passed |
| Real browser, staged dashboard HTML/CSS and real module, synthetic local API | Dashboard, New Prospect, My Opportunities and assessment at 1440/390/320px passed |
| Phone layout measurements | No horizontal overflow; one form column, 16px inputs, buttons >=44px |
| Production GET-only deployment/environment/setup checks | Boundaries unchanged; feature remains unavailable |

The tests cover ADMIN/VA compatibility, opt-in SALES, unknown/disabled/expired
sessions, login TTL/token hashing, legacy staff denial, account revocation, owner
spoofing/isolation/reassignment, exact inquiry reuse, semantic retries, stale
revisions, catalog configuration, required/bounded answers, version drift,
permissioned photos, private bucket enforcement, photo/audit rollback, no
order/job/payout side effects, escaped rendering, late responses and object URL
revocation.

Browser layout tests deliberately blocked external resources and did not connect
to production APIs. They validate real staged layout and module behavior, not a
physical-phone camera or production end-to-end enrollment. PGlite verifies real
SQL transactions and rollback; it is not a new multi-connection PostgreSQL
concurrency proof.

Combined exact-staged regression command:

```powershell
node --test backend\tests\field_sales.test.cjs backend\tests\field_sales_ui.test.cjs backend\tests\managed_offer_response.test.cjs backend\tests\management_assignments.test.cjs backend\tests\management_assignments_api.test.cjs backend\tests\management_assignments_ui.test.cjs backend\tests\management_operations.test.cjs backend\tests\management_operations_ui.test.cjs backend\tests\management_planning.test.cjs backend\tests\management_planning_ui.test.cjs backend\tests\operations_foundation.test.cjs backend\tests\commercial_compatibility.test.cjs backend\tests\commercial_operations.test.cjs backend\tests\commercial_calendar.test.cjs backend\tests\commercial_business.test.cjs backend\tests\stripe_order_metadata.test.cjs backend\tests\dashboard_controls.test.cjs backend\tests\dashboard_presentation.test.cjs backend\tests\dashboard_messaging.test.cjs
```

Known unrelated failure, unchanged:
`dashboard_presentation.test.cjs` -
`explicit native, multiple, listbox and hidden-model selects remain unenhanced; date/file inputs are untouched`.
Its committed Customer Queue markup does not satisfy the existing styling
assertion. Unrelated dirty HTML/test fixes were deliberately excluded.
Existing tests that expected unknown roles to inherit VA were updated to verify
intentional fail-closed behavior; valid ADMIN/VA behavior is still tested.

## Exact files changed

Backend:

- [field-sales route](../backend/app/api/field-sales/route.ts)
- [private-photo route](../backend/app/api/field-sales-photos/route.ts)
- [existing v1 route: authentication-only changes](../backend/app/api/v1/route.ts)
- [shared dashboard session reader](../backend/lib/dashboardAuth.ts)
- [shared Field Sales library](../backend/lib/fieldSales.ts)
- [review-only migration 043](../backend/migrations/043_field_sales.sql)

Frontend:

- [dashboard HTML: optional module loader only](../frontend/dash.html)
- [dashboard JavaScript: scoped auth/shell integration only](../frontend/dash.js)
- [Field Sales module](../frontend/field-sales.js)
- [scoped Field Sales styles](../frontend/field-sales.css)

Tests/documentation:

- [Field Sales integration tests](../backend/tests/field_sales.test.cjs)
- [Field Sales DOM tests](../backend/tests/field_sales_ui.test.cjs)
- [isolated SQL/API/login fixture](../backend/tests/helpers/field_sales_fixture.cjs)
- [dashboard loader/messaging regression](../backend/tests/dashboard_messaging.test.cjs)
- [management permission regressions](../backend/tests/management_operations.test.cjs)
- [foundation authentication regression](../backend/tests/operations_foundation.test.cjs)
- This report.

## Remaining blockers and recommended Phase 7

**Do not activate production Field Sales yet.** Remaining gates include approved
migration/deployment, staging enrollment, real-phone image/camera testing,
lost-credential reset/reissue policy, photo consent/retention/access policy,
full-list navigation needs, cross-channel identity ambiguity and final approved
offer/catalog scope. No automatic existing-user enrollment is provided.
Legacy API surfaces need a separate system-wide authorization readiness review;
this scoped phase is not a claim that every historical endpoint is secured.
The prior assignment identity/reconciliation blockers remain unresolved and
assignment activation is still unsafe.

For Phase 7:

1. Link the same inquiry/opportunity UUID to existing business records and
   versioned quote infrastructure; pin assessment/definition versions and use
   approved pricing authority, never proposed service costs.
2. Add ADMIN-reviewed, immutable quote versions and customer agreements with
   explicit acceptance evidence, audit history and invalidation on material edits.
3. Reuse existing Stripe/payment authority and webhook/idempotency contracts for
   approved quotes/deposits. Resolve deposit, expiration, cancellation/refund and
   customer-verification policies before live collection.
4. Preserve order -> appointment -> Dispatch relationships. Payment success must
   not bypass scheduling, technician acceptance or unresolved legacy links.
5. Carry creator/owner attribution as evidence for future commission design;
   implement no compensation rules or payouts without separate policy approval.
6. Rehearse the full flow in isolation/staging behind default-off gates before
   requesting production activation.
