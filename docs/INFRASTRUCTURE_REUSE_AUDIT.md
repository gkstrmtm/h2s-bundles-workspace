# Home2Smart infrastructure reuse audit

Verified 2026-11-05 EST / 2026-11-06 UTC, using authenticated existing provider
configuration. Baseline application source is `428c2cc527d3216b2f060960aeb8dc4c621205f4`,
with the explicitly recorded private native-staging overlays below.
**Existing Stripe account and native infrastructure connectivity are confirmed.
Complete synthetic paid processing, fulfillment, repeat purchase and commission
accounting are now verified. No new account or credential is required.**

## Completed paid certification, 2026-11-06 UTC

This section supersedes the earlier canceled-intent-only evidence below.
Existing run `c6316381-64f5-4b67-b41f-41711416cdcc` now contains two fully paid
synthetic orders for one canonical fictional household, served by different
representatives. The actual Stripe account remains `acct_1KgfHxLuMP6aPhGZ`;
all four payments have `livemode:false`.

| Opportunity | Deposit / balance | Verified provider fees | Native earned commission |
|---|---:|---:|---:|
| TV `a0962973-f9db-481d-90b9-9ca8981070f6` | $44.75 / $134.25 | $1.60 / $4.19 | $79.93 |
| Camera `6006bea8-757b-4a8a-a810-62f79cb1113e` | $149.75 / $449.25 | $4.64 / $13.33 | $310.22 |

Provider-completed event IDs correlate to exact checkout IDs in the private
native payment ledger: `evt_1UYdO5LuMP6aPhGZHDpK5G3G`,
`evt_1UYdfeLuMP6aPhGZIPIDb7JD`, `evt_1UYdhNLuMP6aPhGZWk56w57C`,
`evt_1UYdhxLuMP6aPhGZ5Gq8b8J0`. Provider fee availability was asynchronous for
the camera payments; the existing authenticated refresh authority retrieved
actual balance-transaction fees before commission review could succeed.
No manufactured receipt, estimated processing fee or $0 substitute was used.

Real native company claim/proof binding/completion and management actual-cost
approval passed with labeled synthetic private bytes and receipts. Both quote
hashes and the original customer legal/payment projections remain unchanged.
Independent orders/earnings and cross-representative denial were verified;
managed PIN reset/disable/revocation/reactivation passed again.

Friday native exports allocate $79.93 (November 6) and $310.22 (November 13).
These future-date synthetic accounting records do not assert transfers occurred.
Independent settled amount remains $0 and missing settlement proof was rejected.
No refunds, live charges, payouts, real employees or public business records were
created or changed.

Incremental 053 enables explicitly nonproduction configuration only after
verifying UUID schema/role/comment/ledger scope. Incremental 054 preserves real
homeowner-inquiry controls while recognizing authoritative Field Sales
order/job/canonical provenance, and correctly classifies premature-balance
denial. Both were retargeted and applied only to this owned run; public metadata
fingerprint remained unchanged. Fresh-run setup, real Storage bytes and complete
bucket/schema/role cleanup also passed through 053; 054 additionally passed
native paid scheduling and the focused fixture selection.

Final coordinated regression selection: **575 passed, 1 optional independent-
session PostgreSQL fixture skipped, 0 failed**; backend TypeScript passed.
Private staging is now built from a clean committed export with persistent
native-aware quarantine, not dirty local files or a permanent diagnostic API.
See [current release procedures and production-only checklist](STAGING_LAUNCH_PREPARATION.md)
and [consolidated operational evidence](OPERATIONAL_READINESS_ASSESSMENT.md).

## Current result: existing database connected, 2026-11-06 UTC

Historical connection/bootstrap evidence follows; paid counts, test endpoint
pause state and overlay-only deployment IDs here describe the earlier run stage.

Management authorized using the existing database with identifiable, removable
test data. No additional database, account, API key or organization login was
needed. Run `c6316381-64f5-4b67-b41f-41711416cdcc` uses:

- Private schema `h2s_test_c631638164f54b67b41f41711416cdcc`, its `_storage`
  metadata mirror and a dedicated `_owner` NOLOGIN role.
- Two actual private buckets, `h2s-test-c6316381-64f5-4b67-b41f-41711416cdcc-files`
  and the corresponding `-proof` bucket. The metadata mirror is not the object store.
- Eighteen structure-only native table clones, zero copied customer rows and 22
  reviewed namespace-retargeted migration sources. Migration 052 corrects the
  proven shared sequence/installation dispatch mismatch **only in this run**.
- Existing service credentials, stored Sensitive/Preview-only. Runtime transport
  forces REST into the run schema and Storage into its exact buckets, rejecting
  other providers/unscoped APIs. Anonymous schema access is denied.

This is **logical isolation inside the existing database**, with shared service
credentials and provider resources, not an independent security/database boundary.
The only additive shared API configuration exposes the run schema alongside the
previous `public, graphql_public`; existing exposed schemas were preserved.
Established public business tables and customer records were not modified.
The deterministic public metadata fingerprint remained
`8939f32b023162438bfc5e7d5d0bda71d8c0dab30b2be86dc84c55dec4445657`.
That fingerprint proves metadata preservation, not a row-by-row data audit.

### Actual verification

- Native REST authenticated successfully; anonymous private-schema access denied 401.
- Real private PNG upload/download matched bytes; anonymous object access denied;
  an expired signed URL failed and renewal retrieved the original bytes.
- Actual hosted management/representative enrollment, activation, isolation,
  disable/revocation, managed credential reset and reactivation passed.
- All normal and follow-up pages passed at 0, 1, 100, 101, 500 and 1,000
  opportunities. Older-record search and independently owned TV/camera repeat
  opportunities passed against the actual native database.
- Stripe itself delivered signed test event `evt_3UYcbhLuMP6aPhGZ0fgoEJ9w` to the
  canonical handler; its signature-verified event ID was correlated in the run's
  native audit table. Intent `pi_3UYcbhLuMP6aPhGZ0ycUxUOa` was never confirmed,
  received **$0**, created no charge and was canceled. This is delivery/connectivity
  evidence, **not deposit, balance or commission certification**.
- Test endpoint `we_1UYbioLuMP6aPhGZBXa9lU79` was paused again after verification.
  Both test secrets remain Sensitive/Preview-only. Both disabled live endpoints
  were left alone. Temporary privileged deployments and token variables were removed.
- **72 focused regression tests passed**; final backend build/type validation
  passed. Actual native financial quotes, agreements, checkouts and orders remain
  zero; all four synthetic representative enrollments are disabled after testing.

Final backend: `dpl_4Rk4uq9PumjAxUwng7nYP32f4nr7`, stable private staging alias
unchanged. Native overlay SHA-256:
`d3530232ee181426947abbf12792aa9e09a6cc2f7ace9f7587e1085f4bb93185`.
The original committed snapshot plus these owned overlays, not the dirty
workspace, was deployed. Neither actual production deployment changed.

### Exact-run cleanup, actually exercised

[Sandbox tooling](../backend/tools/staging-sandbox.cjs) derives every schema,
role and bucket from a validated UUID. `cleanupSandbox(client, {runId,
confirmRun, storageClient})` requires the exact matching run confirmation,
validates both ownership markers, the run ledger and external dependencies,
and refuses foreign namespaces. Only TOAST objects demonstrably attached to
that run's own tables are included as internal dependencies.

Stop all run writers before cleanup. The optional authenticated `storageClient`
must implement the existing Storage API's `emptyBucket` and `deleteBucket`.
Only the two validated run buckets can be passed; cleanup waits for actual object
metadata to empty, verifies bucket removal, restores only this run's API exposure,
then drops the two exact owned schemas and NOLOGIN role. It never disables
immutable financial triggers or directly deletes provider Storage metadata.
Provider cleanup is not atomic with PostgreSQL; any failure stops namespace
removal explicitly and the same exact run can be retried.

Wrong-confirmation and foreign-marker rejection, actual schema/role cleanup,
and complete fresh-run Storage-byte/bucket/schema/role cleanup all passed.
Disposable runs were removed; only the primary run remains. Preserve it until
management requests cleanup. A larger bucket that the provider cannot empty
will fail closed rather than report success.
Stripe retains the canceled test intent/event with the run metadata; database/
Storage cleanup does not delete Stripe's provider-side test history.

## Management inventory

| Question | Current result |
|---|---|
| Existing Stripe account confirmed | **Yes**, existing Home2Smart account |
| Existing live integration confirmed | **Connectivity/configuration only**; captured-payment reconciliation not certified |
| Existing test credentials accessible | **Yes**, reused inside Vercel |
| Field Sales configuration available | **Yes** for isolated native accounts/leads and signed test ingress |
| Staging connections completed | **Yes**; native paid-processing certification remains gated |
| Supabase reuse | **Completed** in the existing project using exact-run namespaces and private buckets |
| Missing provider credentials or organization login | **None for this work** |

## Historical checks before same-database authorization

The dated records below describe earlier states. Where they differ, the current
result above supersedes them.

**Subsequent configuration update, 2026-11-05 19:40 EST:** management entered
the test secret directly in Vercel. Its staging-project environment was corrected
to **Sensitive, Preview only**, without retrieving the value. Backend Preview
`dpl_EmfDmz4CSYAZrweuUKPe8BJhe811` is READY, includes the variable in deployment
metadata, and serves the existing stable private alias. Quarantine/disabled
payment gates and both actual production deployments are unchanged. The earlier
read-only audit below did not have this key. Subsequent runtime verification now
confirms it works; native webhook delivery remains unverified.

| Question | Result | Evidence / boundary |
|---|---|---|
| Existing Stripe account confirmed | **Yes** | `acct_1KgfHxLuMP6aPhGZ`, business name Home2Smart, US. Account reports charges/payouts enabled and details submitted. No money moved. |
| Existing live integration confirmed | **Unverified for captured payments and reconciliation** | Existing live configuration and authenticated API/SDK access are confirmed. Sampled completed Checkouts are zero-dollar, not capture evidence; both registered live webhooks are disabled. |
| Existing test credentials accessible | **Yes, verified inside Vercel Preview** | Management's Sensitive test key authenticated to the same Home2Smart account. Ten bounded SDK read groups passed; no key value was returned or retrieved outside Vercel. |
| Field Sales configuration available at that time | **Partially** | Native run isolation had not yet been authorized/prepared. |
| Staging configuration completed at that time | **No** | Superseded by current native connection evidence above. |
| Supabase reuse opportunities | **Yes** | The subsequently authorized same-database namespace approach is now implemented and verified. |

### Verified staging Stripe runtime, 2026-11-05 19:50 EST

A temporary Preview on the existing private staging backend project used the
actual Sensitive test variable. Its Stripe SDK successfully read all ten groups:
account, products, prices, payment-method configurations, Checkout sessions,
PaymentIntents, charges, balance transactions, refunds and webhook endpoints.
The account ID matches `acct_1KgfHxLuMP6aPhGZ`; card-payments capability is active.
Products/prices are readable. Checkout/intent/charge/fee/refund lists are empty,
which proves read connectivity, not a completed financial transaction.
**There are zero registered test webhook endpoints.**

Actual hosted protection checks: anonymous diagnostic access redirected 302;
provider-authenticated access without the independent diagnostic token returned
403. Fully authorized access returned 200 with test-only account evidence.
All business APIs, including the actual Field Sales webhook, stayed quarantined
at 503. No Checkout session, charge, refund, payout, webhook or database record
was created.

The temporary diagnostic deployment `dpl_uG9by73pwHLmrYXXmHPtjRr9dmWv` was deleted,
and its deletion independently verified through the provider. Temporary token/
expiry variables were removed. The stable alias never moved from clean
`dpl_EmfDmz4CSYAZrweuUKPe8BJhe811`; the original Sensitive test key remains
Preview only. Both actual production deployments are unchanged.
The diagnostic exception and route existed only in a separate temporary export,
not the repository application or active stable deployment.

### Test webhook configured, 2026-11-05 20:18 EST

Using the existing Sensitive key inside a temporary private Vercel runtime,
registered **test-only** endpoint `we_1UYbioLuMP6aPhGZBXa9lU79` on the existing
Home2Smart account. It was immediately paused and its disabled/test state
independently read back. It remains paused until native staging can safely
process events.

Canonical endpoint:
`https://h2s-staging-backend-tabari-ropers-projects-6f2e090b.vercel.app/api/field-sales-stripe-webhook`

Its actual registered destination includes a private
`x-vercel-protection-bypass` query parameter configured directly between the
providers. The value is not in this report or browser assets. A dedicated
Vercel automation bypass was added without replacing the existing staging/proxy
bypass. Vercel bypasses are project-scoped, not intrinsically route-scoped:
application authentication, raw-body Stripe verification, test-mode controls and
quarantine remain required. Anonymous requests still redirect **302**.
The registered ingress reaches application quarantine **503,
STAGING_NOT_CONFIGURED**, rather than provider sign-in; this is ingress
connectivity evidence, **not successful Stripe event processing**.

Subscribed to exactly the existing handler's 13 events:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
payment_intent.succeeded
payment_intent.payment_failed
payment_intent.canceled
charge.refunded
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
refund.updated
refund.failed
```

The newly returned signing secret was encrypted inside Vercel to an ephemeral
RSA-OAEP-SHA256 public key, decrypted only in controller memory, and sent directly
to Vercel as **Sensitive, Preview only**:
`H2S_FIELD_STRIPE_TEST_WEBHOOK_SECRET`. Neither it nor the existing API key was
printed, persisted in source/reports or sent through chat. The existing Sensitive
API key never left Vercel. Local SDK signature acceptance/tamper rejection passed;
those locally generated events were **not** represented as Stripe deliveries.

Current clean backend: `dpl_3TobVNnAAum6mE3WyY3A5nJqmzxo`,
[immutable deployment](https://h2s-staging-backend-2lfiah6za-tabari-ropers-projects-6f2e090b.vercel.app).
It reuses the verified application source and staging overlay, not the setup
route or dirty worktree. A hosting assertion initially assumed environment
metadata was an object; actual provider metadata is an array. Corrected the
check, refreshed after temporary configuration removal, and verified credential
names/scopes without reading their values. All final checks passed.

Temporary setup deployment `dpl_2kQs3QMccz6Esv5JsgEMp97sMaZa` was deleted and
404 confirmed; temporary token/expiry variables were removed and excluded from
the current deployment. Neither disabled live webhook was modified; no live
credential was used in setup and no Checkout, payment, refund or payout created.

### Earlier read-only configuration audit

Inspected relevant environment metadata and Stripe/database values in memory
across ten current/legacy Home2Smart Vercel projects and eleven local private
environment files, plus relevant process variables. Enumerated the team's
projects to identify those relevant deployments. No secret values were printed,
persisted in reports, committed or transferred into staging.

The current `h2s-backend` and legacy `backend` projects hold the **same working
live Stripe key** in their Production environments. The current backend also
holds `STRIPE_WEBHOOK_SECRET`; the legacy backend holds relay configuration.
Existing Vercel authentication works; no new hosting account/token is needed.
Vercel's installed-integration listing returned no configurations for this team.
No authenticated Stripe/Supabase-specific tool or usable management token was
identified. Railway's existing stored token is present but rejected as
unauthorized; neither its CLI nor its read-only GraphQL query listed projects.

## Actual Stripe evidence and compatibility

Authenticated **GET** requests returned HTTP 200 for:

- `/v1/account`
- `/v1/products?limit=10&active=true`
- `/v1/prices?limit=10&active=true`
- `/v1/webhook_endpoints?limit=100`
- `/v1/payment_method_configurations?limit=10`

Products include TV and security-camera service names. Products, prices and
payment-method configurations were sampled, not exhaustively inventoried;
their responses have further pages. These legacy Stripe prices are **not**
substitutes for the approved Field Sales catalog and were not imported/changed.

The backend's actual Stripe SDK also successfully listed completed Checkout
sessions, retrieved an existing session, and listed PaymentIntents. The three
sampled completed live Checkouts have total zero and no linked PaymentIntent,
despite reporting `payment_status=paid`. The three sampled recent PaymentIntents
are canceled. These limited samples neither prove captured money nor establish
that all historical transactions failed. No new Checkout, including a $0
Checkout, was created. Captures, processing fees and payment reconciliation were
**not** certified.

Field Sales reservations require positive cents in
[migration 044](../backend/migrations/044_field_sales_transactions.sql). A new $0
Checkout would not exercise its actual deposit/balance contract.

### Same account, separate integration authorities

- [Shop checkout](../backend/app/api/shop/route.ts) prefers its configured relay,
  otherwise uses the existing direct Stripe client. The current `h2s-backend`
  environment has the live key but no relay variables; relay variables exist in
  the legacy backend and a local private configuration.
- [Field Sales commerce](../backend/lib/fieldCommerce.ts) uses the direct SDK,
  with explicit test/live credentials and a separate live gate. It can reuse
  **this same Stripe account**. Its approved quote amounts become inline
  `price_data`; importing the legacy Stripe product/price IDs is unnecessary.
- The [relay](../relay/server.js) implements Checkout creation, returning an ID
  and URL. It does not implement the session/intent/charge/fee reads, refunds and
  expiration operations used by Field Sales. Its configured `/health` and local
  `/r/health` URLs both returned 404. Operational relay connectivity is unverified;
  it is not a required dependency of the direct Field Sales implementation.
- Stripe reports two registered live endpoints, **both disabled**:
  the existing backend `/api/stripe-webhook` and a legacy Google Apps Script
  endpoint. Both subscribe only to `checkout.session.completed`. No setting was
  changed.
- The [legacy webhook](../backend/app/api/stripe-webhook/route.ts) deliberately
  acknowledges tagged Field Sales objects without processing or forwarding them.
  The [Field Sales webhook](../backend/app/api/field-sales-stripe-webhook/route.ts)
  needs its own correct-mode endpoint, signing secret and supported event
  subscriptions. Reusing the account does not make the legacy endpoint/secret
  interchangeable with this endpoint.
- [Existing smoke route](../backend/app/api/stripe_smoke/route.ts) is **not
  read-only**: its GET creates a $1 Checkout session with its configured key.
  It and all checkout-creation routes were deliberately not invoked.

Initial local SDK success did not prove outbound connectivity from Vercel.
The subsequent protected runtime checks above now prove that connectivity with
the supplied test key. Staging remains protected and business APIs quarantined.

## Actual Supabase and PostgreSQL evidence

- Existing main project `nkccbnrduojnzjfrpwva`: authenticated REST schema and
  storage-bucket metadata GETs both returned 200. No customer rows, object bytes
  or private documents were read.
- Local private PostgreSQL connections successfully used the existing trusted
  CA, verified TLS and transactions with `transaction_read_only=on`.
  The established database has 227 public tables, including `commercial_leads`.
  Its native migration ledger records 029-039; **all eleven recorded checksums
  match the local migration files**. Field Sales opportunities, quotes, checkouts,
  workflows and company-installer tables are absent, with no `field_sales_%`
  functions. No migrations or grants were applied.
- The current Vercel Production database connection values were also tried
  without modification: both distinct inspected connections returned PostgreSQL
  `28P01` (authentication failure). Working local connections do not make those
  stored values valid. Supabase REST service access works independently.
- `commercial-private-files` exists and is private. The existing
  `h2s-job-artifacts` bucket is public; its existence does not certify private
  installation-proof handling. No bucket policy or public flag was changed.
- The legacy preview management origin `ngnskohzqijcmyhzmwnm` was unreachable.
  Campaign project `ulbzmgmxrqyipclrbohi` has working provider-configured REST/
  storage access and an established schema; its development/preview/production
  environments share that target. Its older local import key failed. Neither
  target is a confirmed isolated staging database.

## Remaining native financial certification

No new Supabase target, provider credential or management-session login is
required. Connections, private bytes, native accounts/leads and actual signed
Stripe delivery are verified above. Exact approved catalog/legal/cancellation/
compensation inputs and an authorized company-installer identity are still
required before native paid TV-to-completion-to-balance-to-commission certification.
Those approvals were not invented or copied from fictional fixture policies.

These are business-approval/financial-certification gates, not missing accounts
or keys. Native transaction settings and customer-agreement activation remain
disabled. The Preview transaction environment gate permits signature verification;
it does not override the disabled native financial authorities.
Disabled live webhooks and hosted PostgreSQL authentication failures are findings
for management, not authorization to change production settings.

## Validation and preservation

**23 isolated tests passed, zero failures/skips**, across these two commands:

```powershell
node --test .\backend\tests\field_commerce.test.cjs .\backend\tests\field_sales_owner_pilot.test.cjs .\backend\tests\stripe_order_metadata.test.cjs
node --test .\backend\tests\field_workflow_fees.test.cjs .\backend\tests\field_workflow.test.cjs
```

Results: **16/16** and **7/7**, respectively. These cover real SDK signature
verification with synthetic secrets/events, receipt identity, mode/amount
rejection, idempotency, deposit/balance workflow, actual-fee accounting and legacy
handler separation. They are not actual Stripe-delivered webhook or paid
transaction certification.

The runtime test additionally ran those five selectors together with six
temporary-probe guard tests: **29/29 passed, no failures or skips**. Guard tests
cover malformed/expired authorization, non-Preview execution, dequarantine,
live-key/payment activation refusal, account mismatch, unexpected live objects,
and raw provider-error/secret suppression. Real hosted SDK reads are separate
from these isolated tests; actual Stripe-delivered signatures and native
deposit/balance processing are still not certified.

The webhook setup additionally passed **6/6** focused guards: Preview/test-only
authorization, encryption/input checks, exact account/event scope, duplicate
refusal, explicit pause recovery and live-endpoint refusal. The final combined
selection passed **33/33, no failures or skips**: these six, four native-preflight
guards and the existing 23 payment/workflow tests. Preflight now refuses all
three known established targets even when their API/database identities match,
checks the additional native order/job prerequisites, and prepares read-only
table-grant/RLS and Storage object-policy inspection. Native SQL/storage
certification is still blocked, not replaced by these isolated checks.

No production application code, pricing, accounts, records, credentials, routing,
webhook settings or deployments were changed. Production deployment IDs remain
`dpl_8RTmC8XK1YUs78sj5mshQNueE46M` (backend) and
`dpl_BRTZZG9tsPnwUFyMxqyjSSUwZkNC` (frontend). Existing private staging remains
`H2S_STAGING_QUARANTINE=true`, test mode, transactions/live payments disabled.
No card was requested; no charge, refund or payout was initiated.
