# Phase 7: Quotes, agreements and Stripe integration

Base: `43beabf2a7f6a39c19510be7a7d1cf7065dde473`, branch `retro-dev`.
Verified November 3, 2026. **Development/test-only; not safe to activate live sales.**

## Delivered workflow

The existing Field Sales workspace now supports:

1. Select a backend catalog version and configurable service/installation offer.
2. Answer service-specific qualification questions, choose quantities and compatible
   equipment/add-ons, and calculate/save an immutable server-priced draft.
3. Review itemized equipment, installation scope, answers, exclusions, starting-price
   conditions, customer total, pricing authority and validity.
4. Submit a draft. Qualified published prices can produce an approved revision;
   exceptions/unpublished/unpriced selections require management review.
5. ADMIN approves/rejects a pending exception with a reason and scope confirmation.
   An optional approved final amount is an auditable adjustment in a new revision.
6. Prepare the exact-quote customer agreement using an approved legal version.
7. Present a secure customer handoff, record explicit acceptance, and start secure
   **test-mode** Checkout. No card fields are hosted by the representative interface.
8. Verify payment with Stripe and view the exact linked customer order, net
   collection, refunds, remaining balance and management-review fulfillment state.

ADMIN has a **Quotes & Payments** view inside Field Sales for draft/pending/approved
revisions, accepted agreements, pending payments, deposits, outstanding balances,
exceptions and representative attribution. Historical revisions are explicitly
not counted as separate sales. Quote details expose the saved agreement version
and text, including after the customer handoff expires.

No separate CRM, customer registry, management application or calendar was created.

## Pricing authority

- [v1](../config/pricing/home2smart.v1.json) remains
  `proposed_baseline_pending_approval`.
- [v2](../config/pricing/home2smart.v2.json) remains
  `proposed_reconciled_pending_approval`, with `activationAllowed:false`.
- Neither proposal authorizes payment. No production pricing file was modified.
- Current public `GET /api/bundles-data` exposes 18 services and eight active
  bundles, but does not supply complete approved market/scope/tax/equipment rules.
  The separate `/api/shop?action=catalog` uses different tables and currently
  returns empty arrays; those catalogs must not be conflated.
- Observed conflicts include the two-TV card/calculator price of $428 versus
  catalog $449, larger-TV eligibility, masonry inclusion/surcharges, commercial
  scope and procurement mapping. Storefront camera bundles with a doorbell/NVR
  are not the proposed equipment-inclusive S220 packages.
- The proposed $599 two-solar-camera offer remains inactive. It is not silently
  substituted for the $599 storefront camera/doorbell bundle.

[Draft preparation](../backend/tools/prepare_field_sales_catalog.cjs) reads v2 and
performs a GET-only public catalog inspection, or accepts an explicit snapshot:

```powershell
node backend\tools\prepare_field_sales_catalog.cjs
node backend\tools\prepare_field_sales_catalog.cjs storefront-snapshot.json
```

It prints two independent **draft-only** review documents to stdout, never writes
the database, never overwrites source catalogs and cannot publish. Verification
retained all 70 v2 tiers in 13 source groups, plus 18 storefront service definitions
and eight separately identified bundle offers. Unknown storefront markets remain
empty; missing prices remain null, not zero or inferred. Quote validity and
approval evidence remain unset. Multi-TV discounts, unpriced add-ons, taxes,
compatibility, scope and conflicting sources require explicit reconciliation.
The output is review material, not a catalog ready for publication.

The generic [quote engine](../backend/lib/fieldQuote.ts) supports residential and
commercial markets, per-unit/package pricing, quantities, size/installation
questions, optional equipment replacements, additions and qualification rules.
Future offers are data configuration, not service-specific frontend branches.
Competing equipment replacements are rejected. Price arithmetic uses bounded
integer cents. SALES requests cannot supply totals, unit prices or scope overrides.
No commissions or compensation policies were implemented.

Only a database catalog explicitly published with approval evidence, approver,
timestamp and validity may authorize payment. Published definitions are immutable;
changed prices require another version. SQL 044 seeds **no approved catalog**.

## Permissions and API contracts

All staff routes reuse existing dashboard sessions, Field Sales enrollment,
individual inquiry ownership and service-role infrastructure. ADMIN sees all;
SALES sees owned inquiries only; VA cannot use transaction APIs. SQL revalidates
ownership, eligibility and revisions under locks. Browser roles receive no table
write or RPC execution grants. Responses are private/no-store.

### `/api/field-sales-transactions`

GET returns explicit `enabled:false` without customer records when disabled.
Enabled GET accepts an optional exact `leadId`. It returns authorized catalogs,
quote revisions, agreement metadata, verified payments and exact order bridges.
The most recent 100 matching quote revisions are loaded; the management view
labels them as loaded revisions. Full quote pagination/search and comprehensive
large-volume financial reporting remain operational follow-up work.

POST requires UUID `operationId` and exact `leadId`:

| Action | Server contract |
|---|---|
| `quote` | Catalog UUID and service/offer/quantity/answer/option lines; server calculates all prices |
| `submit` | Latest draft UUID; creates a new approved or pending-approval revision |
| `approve` | ADMIN; latest pending UUID, reason, scope confirmation, optional integer `amountCents` |
| `reject` | ADMIN; latest pending UUID and reason |
| `agreement` | Latest approved/unexpired quote; snapshots approved policy and exact payment plan |
| `agreement_link` | Re-presents an existing, unexpired owned agreement without creating another |
| `checkout` | Accepted quote UUID and `full`, `deposit` or `balance`; no client amount |
| `refresh_payment` | Owned checkout UUID; retrieves and verifies canonical Stripe facts |

Submitted, rejected or approved revisions cannot be re-submitted as drafts.
Accepted contracts block new quote revisions; amendments/cancellations require
a separately approved future process. Assessment/evidence changes invalidate
stale quoting/checkout eligibility rather than silently changing the contract.
Interrupted client actions retain their exact operation key/payload; changing to
a different operation requires retry or an explicit record refresh.

### `/api/field-sales-agreement`

Customer credentials are strong HMAC-derived handoff tokens whose hashes alone
are persisted. They bind agreement UUID and exact quote hash. The token travels
in a URL fragment, which the customer page immediately removes, and then only in
the Authorization header. It is not put in query parameters or browser storage.
Page exit clears the private view and in-memory handoff; late results are discarded.

GET returns only the exact quote, sanitized approved legal text/version, frozen
payment plan and acceptance evidence. It does not expose staff approver IDs,
approval evidence, staff session credentials or token hashes.

POST requires typed customer name/email, exact quote hash, exact policy version,
explicit acceptance and electronic-delivery consent, plus an operation UUID.
Acceptance is timestamped, audited and immutable. Semantic retries are safe;
different acceptance evidence conflicts. Expired/stale/unapproved contracts fail
closed. Staff can still inspect their saved agreement evidence in quote details.

This is a gated customer handoff, not proof of independently verified identity.
Existing technician signatures are job/portal-token-bound and mutate technician
job flags; they were deliberately not reused for pre-sale acceptance. The private
business-file infrastructure remains available for a later approved agreement
copy/delivery attachment workflow; no public photo bucket or duplicate file store
was introduced.

### `/api/field-sales-stripe-webhook`

Dedicated signed, test-only endpoint. It re-retrieves current Stripe session,
PaymentIntent and charge facts rather than trusting a redirect or event amount.
Checks include test mode, currency, exact reserved cents, customer/inquiry/quote/
agreement/hash metadata, session identity, captured charge and refund limits.

Supported events cover Checkout completion/async success/failure/expiry,
PaymentIntent success/failure/cancellation, refunds and disputes. The ledger
retains event type and canonical provider status, including cancellation.
Capture/refund totals are monotonic; disputes stay management-review exceptions.
Failures return retryable errors, not successful acknowledgements.

The existing legacy webhook has only an early, post-signature discriminator for
tagged `field_sales_v1` objects, before database/Dispatch initialization. Its
ordinary checkout, payment, notification and scheduling paths remain unchanged.

## Exact customer-to-order relationships

```text
commercial_leads.lead_id
  -> field_sales_opportunities.lead_id
  -> field_sales_quotes (immutable revision + catalog digest + snapshot hash)
  -> field_sales_agreements (exact quote/hash + approved policy/payment snapshot)
  -> field_sales_checkouts (reserved server amount + stable Stripe idempotency key)
  -> field_sales_payment_events (unique verified provider/manual event evidence)
  -> field_sales_orders -> h2s_orders.id
```

Existing inquiry UUIDs are reused. Phone/name/email similarity never creates or
proves another identity. Attribution is frozen on the quote; no commission is paid.

Checkout reservation is serialized by the shared lead lock, with a unique active
attempt constraint. Duplicate/concurrent requests reuse the same provider key.
An uncertain unbound attempt outside its safe retry window requires reconciliation,
not another charge. Expired canonical sessions can release an attempt safely.

Only a verified capture creates the ordinary `FS-<uuid>` order. One quote has one
exact order bridge. Deposits create a full-value order with separate collected/
remaining amounts; balance payments update that same order. Refunds/disputes
prevent automatic recollection. Order/event/ledger changes share one SQL
transaction, so injected order failure rolls back and webhook retry recovers.

Deposit policy is **unset by default**. An approved policy must reference the
approved agreement-policy UUID and include ADMIN approval/evidence/date. Its
calculation and exact deposit/balance amounts are frozen before customer acceptance.
Later configuration changes cannot add a deposit to an already accepted full-only
agreement or alter accepted deposit amounts. No nonrefundable rule, due date,
cancellation entitlement or refund policy is invented.

Actual production metadata was inspected through verified TLS in a read-only
transaction. `h2s_orders.id` is a UUID; `order_id` is a separate required text
reference; `items` is text. Queue `order_id` and `installation_job_id` must both
be present or both absent. Therefore this phase does **not** fill the Queue
order/job pair with an invented Dispatch relationship. The exact sale/order bridge
preserves traceability until fulfillment approval. Ordinary order insertion has
no verified automatic Dispatch trigger; the special APPT-COM rules are not reused.

Orders remain `field_sales_management_review`. No appointment, Dispatch job,
assignment, legacy payout job or technician payout is created by this workflow.

## Gates, migration and activation requirements

All are currently off/unconfigured; no deployment or migration was performed:

- Existing `H2S_FIELD_SALES_ENABLED` and `field_sales_settings.enabled`.
- New `H2S_FIELD_TRANSACTIONS_ENABLED` and
  `field_sales_transaction_settings.enabled` (SQL default `false`).
- Customer handoff additionally requires `H2S_FIELD_CUSTOMER_AGREEMENTS_ENABLED`,
  an approved legal policy, `H2S_FIELD_AGREEMENT_TOKEN_KEY` of at least 32 characters,
  and an explicitly configured `H2S_FIELD_SALES_ORIGIN`.
- Stripe requires **separate** `H2S_FIELD_STRIPE_TEST_SECRET_KEY` (`sk_test_` only)
  and `H2S_FIELD_STRIPE_TEST_WEBHOOK_SECRET`. Existing live Stripe credentials
  are never reused; live keys/events are rejected by this implementation.
- Both existing assignment gates remain disabled; Phase 4 activation blockers
  and unresolved Dispatch/legacy/payout relationships remain unresolved.

SQL 044 depends on the existing shared operations/Field Sales migrations, including
043. Apply only after review in an isolated/staging environment with all gates off.
Do not run a production migration runner for this phase. Test separate test-account
webhook registration and provider reconciliation before considering activation.
Turning gates off is the immediate application rollback; Stripe reconciliation
must then be explicitly managed because disabled webhooks return retryable errors.
Do not drop financial, quote or acceptance evidence as a rollback strategy.

Business/compliance blockers include approved complete pricing and tax treatment;
equipment/installation qualifications; legal agreement/cancellation language;
electronic delivery and durable customer copies; customer identity verification;
retention/privacy controls; deposit terms if desired; refund/cancellation authority;
and approved fulfillment identity mapping. A future live-mode bridge requires a
separate implementation/review, not substituting a live key into these settings.

## Validation

Validation used an isolated export of the exact staged index, not unrelated dirty
helpers/HTML/tests. No production business rows were used for destructive tests.

**Final result: 193 tests; 192 passed, one known unrelated failure, zero skipped.**
All **18 new transaction/UI tests passed**. Coverage includes server pricing and
tampering, all v2 tiers/draft preparation, ownership/VA denial, immutable revisions,
approval states, customer linkage/consent/replay, frozen deposit policies, duplicate
Checkout requests, signed webhook retries, failed/canceled/pending/expired sessions,
expanded Stripe identities, capture/refund/dispute reconciliation, transaction
rollback/retry, exact order uniqueness and unchanged Dispatch/payout contracts.

Exact regression command:

```powershell
node --test backend\tests\field_commerce.test.cjs backend\tests\field_commerce_ui.test.cjs backend\tests\managed_offer_response.test.cjs backend\tests\management_assignments.test.cjs backend\tests\management_assignments_api.test.cjs backend\tests\management_assignments_ui.test.cjs backend\tests\management_operations.test.cjs backend\tests\management_operations_ui.test.cjs backend\tests\management_planning.test.cjs backend\tests\management_planning_ui.test.cjs backend\tests\operations_foundation.test.cjs backend\tests\commercial_compatibility.test.cjs backend\tests\commercial_operations.test.cjs backend\tests\commercial_calendar.test.cjs backend\tests\commercial_business.test.cjs backend\tests\stripe_order_metadata.test.cjs backend\tests\dashboard_controls.test.cjs backend\tests\dashboard_presentation.test.cjs backend\tests\dashboard_messaging.test.cjs backend\tests\field_sales.test.cjs backend\tests\field_sales_ui.test.cjs
```

The existing `dashboard_presentation.test.cjs` failure is:
`explicit native, multiple, listbox and hidden-model selects remain unenhanced;
date/file inputs are untouched` -- the committed Customer Queue filter lacks the
asserted native-select opt-out. No unrelated styling/test fix was included.

Additional passed checks:

- Strict TypeScript `createProgram`: ES2020/CommonJS/Node10 resolution,
  `strict`, `noEmit`, `skipLibCheck`, `esModuleInterop`, existing `@/*` aliases;
  new three libraries and three API routes: zero diagnostics.
- `node --check frontend\field-sales.js`
- `node --check frontend\field-commerce.js`
- `node --check frontend\field-agreement.js`
- `node --check backend\tools\prepare_field_sales_catalog.cjs`
- `.git\hooks\pre-commit.ps1`: existing architecture rules passed.
- GET-only draft preparation: two drafts, 70 v2 tiers, 18 current service
  definitions/eight independent storefront bundles, no publication.
- Real browser with staged dashboard HTML/CSS/modules, synthetic isolated SQL/API
  and fake Stripe provider: draft -> pending exception -> ADMIN approval ->
  customer acceptance -> reserved Checkout -> signed receipt -> verified order.
  Management displayed accepted agreement and verified collection.
- At 1440/390/320px, document widths were 1432/382/312px (no horizontal overflow).
  Phone inputs were 16px and visible buttons at least 44px. Customer handoff
  immediately removed its fragment and never asserted payment from a redirect.
  Synthetic orders increased from 2 to 3; jobs stayed 2 and payouts stayed 0.
  The fixture was stopped and browser cleared afterward.

**Stripe limitation:** No authorized test-account credential was available.
Tests used an in-process fake provider plus genuine Stripe SDK HMAC signature
generation/verification. No live key or real Stripe transaction was used.
A real Stripe test-account round trip remains required; it has not passed.
PGlite executes actual SQL but is not native multi-connection PostgreSQL proof;
repeat concurrency/failure exercises in isolated native PostgreSQL before activation.

Production boundary checks found unchanged deployments
`dpl_BRTZZG9tsPnwUFyMxqyjSSUwZkNC` (frontend) and
`dpl_8RTmC8XK1YUs78sj5mshQNueE46M` (backend), no production Field Sales/
assignment environment keys, and no Field Sales settings/transaction settings/
quotes relations. SQL 043/044 remain unapplied.

## Exact changed paths

1. [SQL 044](../backend/migrations/044_field_sales_transactions.sql)
2. [Quote engine](../backend/lib/fieldQuote.ts)
3. [Commerce orchestration](../backend/lib/fieldCommerce.ts)
4. [Stripe discriminator](../backend/lib/fieldStripeRouting.ts)
5. [Staff transactions API](../backend/app/api/field-sales-transactions/route.ts)
6. [Customer agreement API](../backend/app/api/field-sales-agreement/route.ts)
7. [Dedicated Stripe webhook](../backend/app/api/field-sales-stripe-webhook/route.ts)
8. [Legacy webhook: import and early guard only](../backend/app/api/stripe-webhook/route.ts)
9. [Draft preparation tool](../backend/tools/prepare_field_sales_catalog.cjs)
10. [Guided commerce module](../frontend/field-commerce.js)
11. [Field Sales integration](../frontend/field-sales.js)
12. [Scoped styles](../frontend/field-sales.css)
13. [Optional module loader only](../frontend/dash.html)
14. [Customer handoff page](../frontend/field-agreement.html)
15. [Customer handoff logic](../frontend/field-agreement.js)
16. [Transaction tests](../backend/tests/field_commerce.test.cjs)
17. [Commerce/customer UI tests](../backend/tests/field_commerce_ui.test.cjs)
18. [Isolated SQL/API/provider fixture](../backend/tests/helpers/field_commerce_fixture.cjs)
19. [Commercial replay test: discriminator mock only](../backend/tests/commercial_operations.test.cjs)
20. [Stripe metadata test: discriminator mock only](../backend/tests/stripe_order_metadata.test.cjs)
21. [Dashboard loader test: new dependency only](../backend/tests/dashboard_messaging.test.cjs)
22. This report.

Unrelated working changes were preserved and excluded from this commit. No
pricing/catalog source, existing Checkout handler, Dispatch handler, technician
portal, notification implementation, production customer record or compensation
policy was changed.

## Recommended Phase 8

1. Reconcile and formally approve complete pricing, scope, equipment and tax rules;
   approve agreement language, identity verification, delivery/retention and any
   deposit/refund policy. Keep proposed offers inactive until separately approved.
2. Stage migrations with gates off and execute genuine Stripe test-account,
   native-PostgreSQL concurrency, webhook recovery and durable delivery tests.
   Add financial-list pagination/search and exception-operating procedures.
3. Implement an auditable approved-order -> existing scheduling/Dispatch handoff
   using verified relationship identifiers and rollback evidence. Preserve the
   existing calendar/technician acceptance/payout contracts; do not infer IDs.
4. Resolve existing assignment activation blockers separately. Do not equate paid
   order creation with approval to create assignments, payouts or notifications.
5. Only after explicit authorization, design/review live-mode activation with
   separate gates, monitoring, reconciliation and a controlled rollback plan.
