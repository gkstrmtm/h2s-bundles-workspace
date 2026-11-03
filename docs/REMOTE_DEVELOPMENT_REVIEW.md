# Home2Smart remote development review

## Snapshot and non-negotiable boundary

Development branch: `retro-dev`. This preservation follows Phase 7 commit
`55e47c24ede81a9246e2b6e2c7d254b5ba83fcda` and preserves reviewed, previously
uncommitted Home2Smart work. Use `git log` for the final preservation commits.
This is a development snapshot, **not a release or production-readiness claim**.
No deployment, production query/mutation, account activation, payment activation,
assignment activation, migration application or notification activation was
performed for this handoff.

The [source navigation map](REPOSITORY_REVIEW_MAP.md) provides exact entry points.
Older phase/release notes describe their historical scope; they do not prove the
current production environment matches this checkout.

Established constraints:

- [frontend/dash.html](../frontend/dash.html) is the central application foundation;
  authoritative dashboard assets live in `frontend/`, not root `Dash.*` duplicates.
- Consolidate Dispatch incrementally; preserve existing scheduling and technician
  contracts. The technician portal is not being redesigned.
- Field Sales is company-wide: TV mounting, customer-owned cameras,
  equipment-included cameras, residential/commercial work and future configurable
  services. It shares the existing backend and customer infrastructure.
- Production assignment activation remains blocked. Never automatically repair
  historical relationships, merge identities, create legacy payout jobs or enable
  assignment flags.
- Proposed pricing, including the $599 solar-camera proposal, is not approved for
  publication. Email activation is deferred. No additional paid software is
  authorized. Preserve existing integrations and historical records.

## What exists

Status definitions: **Implemented/tested** means supported by code and the stated
automated/isolated validation, not proven production operation.
**Implemented/inactive** means code exists behind disabled gates.
**Preview-only** means synthetic fixtures or local adapters.
**Incomplete** requires further implementation/policy.
**Unverified** lacks actual dependency/runtime proof. An area can have several statuses.

| Area | Current capability | Status / limits |
|---|---|---|
| Management dashboard | Existing administration, employee accounts, hiring pipeline, training, tasks, communications, Customer Queue and media management; established ADMIN/VA flows retained. | Implemented/tested for covered contracts. Actual legacy integrations were not revalidated. Preview legacy lists are minimal synthetic/empty reads; unsupported actions fail explicitly. |
| Consolidated Operations | Job/order/payment evidence, preparation readiness, scheduling visibility, technician/availability evidence, conflicts and ADMIN reconciliation cases. | Implemented/tested read models. Not a replacement calendar or authorization to assign. Payment/availability unknowns remain unknown. |
| Reconciliation | Orphan references, portal/directory identity mismatches, missing reviewed job relationships, conflicting states and payout associations with evidence/remediation suggestions. | Implemented/tested. Review classifications are browser-session drafts/exportable untrusted input, not persistent shared audit records or production repairs. |
| Field Sales | Restricted mobile shell, representative management, owned prospects, follow-ups, configurable assessments, consent-controlled private photos, opportunities and management review. | Implemented/tested; production-inactive. No representative was activated. Not a standalone CRM. |
| Customer Queue / public intake | Residential and commercial inquiries share `commercial_leads`; existing return/review links, staff tools and scheduling relationships are reused. Preserved work includes shared address entry/provenance, residential attribution, funnel and media refinements. | Implemented/tested with fixtures. Optional Places integration and real-world delivery/runtime behavior remain unverified. Address selection alone is not booking/coverage proof. |
| Quotes | Server-calculated cents, quantities/options/qualification, draft/exception workflow, ADMIN approval, immutable versioned quote snapshots and expiry. | Implemented/tested; inactive. No approved payable production catalog is seeded by migration 044. Catalog publication still requires an approved operating procedure. |
| Agreements | Exact quote/policy linkage, customer acceptance evidence, version/hash, timestamp and expiry. | Implemented/tested mechanics; inactive. Legal language, cancellation information and electronic delivery remain unapproved. Synthetic policy text is not a usable customer agreement. |
| Payments and customer orders | Server-created test Checkout, canonical amount/identity verification, retries/idempotency, failure/refund reconciliation, remaining balance and duplicate-order protection. | Implemented/tested against fixtures and a fake provider using actual Stripe SDK signature verification. No real Stripe account round trip; no live-key support or activated transactions. |
| Fulfillment | Verified sale can create the existing customer order with explicit management-review handoff. | Implemented/tested order linkage. Automatic scheduling/assignment is intentionally absent; safe approved fulfillment remains incomplete. No commissions. |
| Existing technician portal | Existing login, jobs, offer responses, availability, completion/proof and payout dependencies remain the integration boundary. | Contracts regression-tested where covered; no portal UI change is included in this preservation. Historical identity/payout repair remains blocked. |
| Pricing/configuration | Comprehensive offline v1/v2 proposals, schemas, equipment and camera definitions; generic backend sales service definitions and versioned commerce catalogs. | Offline proposals validated, not published. Existing storefront pricing is a separate authority requiring reconciliation/approval. |

### Backend, identity and authorization

- [dashboardAuth.ts](../backend/lib/dashboardAuth.ts) uses `Dashboard_Users` and
  `Dashboard_Sessions`, hashed bearer tokens, expiry and disabled-account checks.
  SALES is explicitly opted into the sales handlers, not globally enabled across
  management routes. ADMIN sees representatives; SALES sees only owned records;
  VA keeps existing permissions but does not gain new Operations access.
- [supabase.ts](../backend/lib/supabase.ts) supports main, management and tracking
  clients. Their names do not prove separate/co-located real databases.
  [fieldSales.ts](../backend/lib/fieldSales.ts) rejects different configured main
  and management project URLs: accounts, opportunities and shared customers must
  satisfy the verified co-location contract before activation.
- Shared customer UUID -> `field_sales_opportunities` -> immutable
  `field_sales_quotes` -> `field_sales_agreements` -> `field_sales_checkouts` /
  `field_sales_payment_events` -> `field_sales_orders` -> existing `h2s_orders.id`.
  Commands enforce ownership, revisions and idempotency server-side. A redirect
  never proves payment; representatives do not submit authoritative totals.
- `h2s_orders.id` is not its public `order_id`. Dispatch jobs, `h2s_jobs` legacy
  payout jobs, portal `h2s_pros` and routing `h2s_dispatch_pros` have distinct
  identities. Similar IDs, names or emails are not sufficient matching evidence.

### Gates and migration status

| Capability | Required gates / prerequisites; keep disabled |
|---|---|
| Managed assignments | `H2S_MANAGEMENT_ASSIGNMENTS_ENABLED=true` **and** `h2s_management_assignment_config.enabled=true`; identity, eligibility and approved repair blockers still apply. |
| Field Sales | `H2S_FIELD_SALES_ENABLED=true`, `field_sales_settings.enabled`, active representative plus enabled SALES dashboard account; shared-project contract. |
| Transactions | `H2S_FIELD_TRANSACTIONS_ENABLED=true`, enabled transaction settings, approved/published catalog and approved agreement policy. Signing requires `H2S_FIELD_AGREEMENT_TOKEN_KEY` of at least 32 characters and approved `H2S_FIELD_SALES_ORIGIN`. |
| Stripe bridge | Separate `H2S_FIELD_STRIPE_TEST_SECRET_KEY` beginning `sk_test_` and test webhook configuration; this implementation is test-only. Deposit policy is unset until approved. |

These are code/default-off requirements and prior handoff boundaries, not a fresh
inspection of production environment values.

[040 address guards](../backend/migrations/040_residential_address_guards.sql)
is a review-only draft and is not enrolled in the guarded migration runner.
[043 Field Sales](../backend/migrations/043_field_sales.sql) and
[044 transactions](../backend/migrations/044_field_sales_transactions.sql)
were documented unapplied in production in the prior handoff; no fresh production
schema check occurred here. SQL existence is not application authorization.
Consult [DATABASE_MIGRATIONS.md](DATABASE_MIGRATIONS.md); do not run migrations to
make a review checkout resemble production.

## Unfinished work and activation blockers

1. **Approve a narrow launch offer, not a narrow architecture.** TV mounting and
   camera installation need approved quantities/size/mount/surface rules,
   equipment ownership, installation scope, exclusions, direct costs, tax policy,
   service area and exceptions. v2's 70 proposed tiers and current storefront
   definitions are not interchangeable. Neither supplier assumptions nor legacy
   FAQ/payment copy establishes an approved Field Sales policy.
2. **Approve customer and payment policy.** Agreement language, cancellation/
   refund rules, electronic delivery, consent/retention and any deposit/balance
   rules remain blockers. Do not invent nonrefundable deposits or publish test
   agreement text.
3. **Prove the actual transaction dependencies in isolation.** Run an authorized
   Stripe test-account round trip, webhook registration/recovery and refunds;
   verify native PostgreSQL commerce concurrency/locking, grants and actual
   storage. PGlite/fake Stripe results are not substitutes.
4. **Complete approved fulfillment policy.** Existing company reservations remain
   authoritative. Assignment does not require an appointment; pending offers are
   not confirmed reservations. Accepted offers are not automatically reconfirmed
   after a reschedule. Availability evidence is not comprehensive clearance.
   Known legacy rescheduling/status mismatches require a separate scoped fix.
5. **Resolve identity/payout safety separately.** Historical Phase 4 evidence
   included 77/95 orphan assignment references, routing-only technician
   identities and missing legacy-job associations; these are historical counts,
   not a fresh audit. Repair requires explicit identifiers, evidence, approval,
   audit and rollback. Never infer a payout link from email.
6. **Preserved completion experiment is not activation-ready.**
   [dataOrchestration.ts](../backend/lib/dataOrchestration.ts) contains preexisting
   optional `commercialContext` work and mail-result warnings. The commercial
   branch checks same-ID legacy jobs/customer-email consistency and a portal pro,
   not migration 042's explicit reviewed mapping. No current API call site passes
   that optional context. Do not wire/enable it as a payout repair or treat its
   fixture tests as proof of the required identity contract.
7. **UX/operations gaps.** Legacy Dispatch clips internally on narrow screens;
   reconciliation review is not durable multi-user case storage; field-sales
   offline synchronization is not implemented. Catalog/policy administration and
   real notification/electronic delivery need approved procedures.
8. **Baseline validation debt.** The current broad suite has one independently
   reproduced preexisting fixture failure; the configured ES5 TypeScript target
   has nine independently reproduced diagnostics. See validation below; no
   unrelated repair was performed.

## Remote review without production credentials

Source and documentation can be reviewed directly on GitHub. For a local
synthetic preview on another Windows computer, use Node 22 (validated here with
22.21.0) and a fresh checkout:

```powershell
git clone --branch retro-dev --single-branch https://github.com/gkstrmtm/h2s-bundles-workspace.git
Set-Location h2s-bundles-workspace
npm ci --ignore-scripts
npm --prefix backend ci --ignore-scripts
npm --prefix config\pricing ci --ignore-scripts
node tools\dev-review\server.cjs
```

The fixture preview does not require generated Prisma clients or a database.
Ignoring install scripts avoids unrelated backend postinstall generation.
Normal backend development/build setup is separate and not certified by this
synthetic preview. No `.env` file, production credentials or paid service is
required. Existing fixture helpers contain Windows-relative paths; macOS/Linux
execution is unverified and may require path normalization.

Open `http://127.0.0.1:50267/`. If occupied, set
`$env:H2S_REVIEW_PORT='50268'` before starting. Stop your instance with Ctrl+C.
Loopback URLs on the primary computer are not accessible from another computer;
rerun the checked-in helper rather than exposing it publicly or deploying it.

| Interface | Local path at that origin |
|---|---|
| Management | `/dash.html` |
| Operations | `/dash.html?reviewTab=operations` |
| Salesperson mobile shell | `/dash.html?reviewRole=SALES` |
| Sales management | `/dash.html?reviewTab=fieldsales` |
| Quotes / payment review | `/dash.html?reviewTab=quotes` |
| Synthetic customer agreement | `/review-agreement` |
| Existing Dispatch comparison | `/dispatch.html` |
| Customer Queue | `/dash.html?reviewTab=commercialqueue` |

The helper serves actual saved frontend files and actual fixture-backed
sales/commerce handlers and Operations/Queue projections. It does not proxy
production, load environment files or bypass production authentication.
Synthetic authentication exists only inside this separate loopback process.
Stripe, webhook processing, assignment writes, email/SMS, account administration
and unsupported legacy writes fail explicitly. Synthetic drafts/assessments/
photos/quotes/agreements can change only disposable in-memory data. State resets
on restart. Five quote revisions, one unaccepted agreement and **zero payments/
sales orders** are initially seeded; no successful sale is fabricated.

External API/media connections are blocked; permitted public font/script CDNs
still need internet. Some legacy screens need unavailable dependencies and are
not fully functional here. Do **not** substitute
[tools/local-frontend-preview-server.js](../tools/local-frontend-preview-server.js):
its existing production API proxy is inappropriate for this isolated review.
The prior visual review checked desktop, 390px and 320px consolidated screens;
that was synthetic layout evidence, not production/runtime certification.

## Preservation boundaries

Preserved application work was already present on disk: residential intake/
tracking/address guards and tests; commercial/shared address handling; dashboard
controls/mobile recovery and media workflows; owner/public media wiring and
tests; notification-routing tests; backend configuration/dependency updates;
public bundle assets and related documentation/planning. No application feature
or redesign was added during preservation. New work here is this handoff, the
source map and repository-relative copies of the existing isolated preview.

The following remain local, deliberately uncommitted; none was discarded:

- Deployment/privacy-routing changes: `deploy-frontend-safe.ps1`,
  root `vercel.json`, `frontend/vercel.json`; no deployment behavior was executed
  or approved. Frontend configuration removes some `no-referrer` headers, which
  requires separate review.
- `README.md` additions contain production release/routing verification claims
  not independently corroborated for this preservation. They remain local with
  the held deployment changes. The two portal workstream/workflow documents are
  independent conceptual guidance and are preserved.
- Preexisting technician UI error-message patch:
  `backend/public/portal.html`; generated/stamped duplicate
  `frontend/portal.html`; unrelated whitespace-only `frontend/shop-home.html`.
- Unknown/unsafe-to-export material: `.tmp-owner-upload-test.txt`,
  `Commercial H2S/file.jpe`, `artifacts/commercial-audit/` diagnostics/downloads,
  and `postgresql-17.10-2-windows-x64.exe`.
- Unreviewed data/proof tooling: `backend/tools/clone_supabase_project.js`,
  `backend/tools/report_bundle_proof_assignments.js`,
  `backend/tools/sync_proof_storage.js`. Do not run these to prepare a review.

These held files are not available in a remote clone. There was no safe editor
API for enumerating/saving unsaved buffers; tabs and unsaved content were left
untouched and **are not claimed committed**. Save/review any such buffers on the
primary machine before relying on GitHub as their backup. Session-only logs and
the original running preview remain local; generated audit/test data is not
committed. The checked-in preview contains source fixture definitions, not an
export of customers or runtime preview state.

## Validation evidence

Offline regression command (PowerShell; clear external database opt-ins first):

```powershell
Remove-Item Env:H2S_ASSIGNMENT_TEST_DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:H2S_CALENDAR_TEST_DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:H2S_MEDIA_DB_TEST_TARGET -ErrorAction SilentlyContinue
$tests = Get-ChildItem backend\tests\*.test.cjs
node --test --test-concurrency=2 @($tests.FullName)
```

- Full working-tree run: **762 tests; 758 passed, 1 failed, 3 skipped**.
  External/native database suites were deliberately not activated.
- Failure: `commercial_contact.test.cjs`, `actual queue GET keeps administrator
  authorization and dashboard wiring`: `getBearerToken is not defined`.
  Its VM extracts route functions without that imported dependency. Independently
  reproduced from archived `55e47c2`; do not infer a production authorization
  failure from this incomplete fixture.
- Baseline reproduction: `node --test backend\tests\commercial_contact.test.cjs
  backend\tests\dashboard_presentation.test.cjs` against archived `55e47c2`:
  **32 tests, 30 passed, 2 failed**. The second was the previously documented
  native-select presentation assertion; it passes with the preserved existing
  dashboard work.
- `npm --prefix config\pricing run validate`: **passed**, proposed catalogs and
  linked references; `npm --prefix config\pricing test`: **308/308 passed**.
  No pricing publication occurred.
- `node node_modules\typescript\bin\tsc --noEmit --project
  backend\tsconfig.json --incremental false`: **failed, nine TS2802 diagnostics**.
  Archived `55e47c2` independently produces the same nine diagnostics, with no
  differences. Existing ES5 target/iterator incompatibility; not changed here.
- The same command with `--target ES2020`: **passed** with strict project options.
  This is a validation override, not a configuration change or full Next build.
- All **40 selected standalone JavaScript/CommonJS files** passed `node --check`.
  The selected application files matched their staged content.
- Preserved preview on a separate verification port: actual sales/services,
  Operations and planning reads succeeded; payment/assignment/webhook writes
  returned **423**, SALES legacy Queue access **403**; five quotes/one agreement,
  zero payments/orders. The original inspection instance stayed responsive.
- Exact selected-index snapshot, independently exported outside the working tree:
  the same broad offline command produced **762 tests; 758 passed, the same
  preexisting fixture failure, 3 skipped**. Strict project TypeScript with the
  explicit ES2020 validation override also **passed** on that snapshot.
- Both new guides' local Markdown links resolved. The existing local
  `.git\hooks\pre-commit.ps1` architecture guard **passed**; that local-only hook is
  not part of a remote clone.
- `git diff --cached --check`: **two preexisting working-tree trailing-whitespace
  warnings**, preserved as found in `frontend/bundles.js` and
  `backend/public/bundles.js`. No unrelated formatting repair was made.
- Added-content credential/private-data screening found no new credentials or
  customer records. Contact matches were reserved synthetic fixtures, `.invalid`
  addresses or existing public company contact copy. The intentionally reused
  company logo contains branding only and no private metadata.

No real Stripe transaction, native commerce concurrency run, deployed smoke
test or full production-connected Next build is claimed.

## Recommended next priorities and consultation decisions

Engineering order: (1) approve/configure a limited TV/camera launch catalog and
customer policies in the company-wide architecture; (2) certify actual isolated
database/Stripe/storage dependencies and close baseline validation debt;
(3) implement the approved order-to-existing-calendar/Dispatch handoff with
assignments still off until identity and lifecycle blockers are resolved.

| Management decision | Recommended choice | Why / what changes with the answer |
|---|---|---|
| Which services and equipment-ownership models launch first? | Start with explicitly scoped TV mounting and camera installation, identifying customer-owned versus supplied equipment; keep commercial/unusual work review-required. | Reduces launch risk without limiting future services. Determines published catalog entries, required questions and escalation rules. |
| Which prices, scope and exception authority are approved? | Approve a versioned price/scope matrix, equipment assumptions, exclusions, tax handling and exception authority before publishing. Keep all current proposals inactive meanwhile. | Prevents underquoting and accidental publication. Determines payable catalog contents and required approvals, not frontend arithmetic. |
| Full payment or deposits, and which cancellation/refund rules? | Prefer one approved full-payment workflow for standard pilot jobs after legal/fulfillment approval; keep deposits unavailable unless separately approved. Do not infer policy from old checkout copy. | Determines agreement terms, full/deposit/balance configuration, refunds and fulfillment clearance. Nothing is collected until activation is explicitly approved. |
| How are agreements delivered and photographs permitted/retained? | Obtain approved agreement/cancellation/electronic-delivery wording; keep assessment photos private, with explicit separate permission for public use and an approved retention policy. | Determines acceptance evidence, delivery implementation and storage/access/retention operations. |
| Who authorizes fulfillment and historical repairs? | Begin with explicit management scheduling review; authorize any historical repair separately with evidence, audit and rollback. Keep assignment writes disabled. | Determines who can confirm readiness/schedule, when a sale enters fulfillment, and whether a separately reviewed repair project may proceed. |

No additional implementation phase starts from this document. Review the
preserved interfaces and policies first.
