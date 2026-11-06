# Private staging and controlled launch preparation

Verified 2026-11-05. Application source: `retro-dev`,
`428c2cc527d3216b2f060960aeb8dc4c621205f4` (local and remote matched).

**Current decision, 2026-11-06 UTC: complete native synthetic paid TV and repeat
camera workflows passed, including four real Stripe Sandbox payments, signed
receipts, company completion, actual-cost review, independent commissions and
Friday allocation. Production activation remains a separate controlled release.**
No additional database/account/key or organization login is needed.
Only authenticated, UUID-run-scoped synthetic Field Sales routes and the existing
managed PIN-reset action are available. Other legacy APIs remain quarantined.
See the [current native evidence and exact-run cleanup procedure](INFRASTRUCTURE_REUSE_AUDIT.md#current-result-existing-database-connected-2026-11-06-utc).

The baseline commit is supplemented by explicitly owned native-scoping overlays;
the actual backend and overlay identifiers are in the provider table below.
Earlier dated entries and deployment identifiers describe historical
configuration, not current blockers. The current clean release is exported from
the verified `retro-dev` commit containing this revision, with source SHA and
generated overlay hashes in `staging-manifest.json` and Vercel metadata.

### Current paid certification and operating procedure

- TV total $179: $44.75 deposit / $134.25 balance, actual provider fees $5.79,
  equipment/material fixtures $27.88, 55% earning **$79.93**.
- Same canonical household, representative B, camera total $599: $149.75 /
  $449.25, fees $17.97, equipment/material fixtures $17, earning **$310.22**.
- Native signed completed events:
  `evt_1UYdO5LuMP6aPhGZHDpK5G3G`, `evt_1UYdfeLuMP6aPhGZIPIDb7JD`,
  `evt_1UYdhNLuMP6aPhGZWk56w57C`, `evt_1UYdhxLuMP6aPhGZ5Gq8b8J0`.
- Both installations used the exact authenticated company identity, personal
  job claim, private uploaded photo/signature fixtures, required checklist,
  completion time and two recorded hours. Fixtures explicitly assert no physical
  installation, real signature or supplier expenditure.
- Review only evidenced equipment/materials through **Approve immutable
  actual-cost snapshot**. Labor hours remain separate; do not insert wages as
  equipment/material rows or subtract wages from representative commission.
- Stripe can report paid before its fee transaction is available. If commission
  is held, use the existing management **Refresh payment** for that checkout,
  then **Review order**. Actual provider fee evidence is mandatory, never an
  estimate. This recovered the real delayed camera fees during certification.
- November 6 TV export and November 13 camera export were independently approved
  and exported through native authority. The earlier export was not rewritten.
  Allocated is not paid: **$390.15 allocated, $0 independently settled**, no transfer.
- Managed reset invalidated the old credential/session. Disabling immediately
  denied existing sessions; reactivation required a fresh valid login.
- Full source selection: **575 passed / 1 optional PostgreSQL fixture skipped /
  0 failed**, plus passing backend TypeScript. The skip requires independent
  native sessions and was not redirected to established public tables.

The staging-only configuration is explicitly authorized for testing, not live
publication. Pricing comes from `config/pricing/source/pricing.v1.json`
(`d612b8459013d8da2921d44d8b780926d83b766ac1cc129894da6681a085c86b`);
equipment assumptions come from `config/pricing/equipment.v1.json`
(`254973400e2730402e11edae001b33b07c8865bcb284b7ecc3a2dea38ed3828c`).
Catalog/agreement status is `staging_only`, production approval identities/times
are NULL, and every policy/document is marked nonproduction. The existing
zero-business-day cancellation **fixture** is not a legal cancellation decision.

### Exact production activation checklist

1. Select and publish an effective production catalog/digest resolving the
   source's proposed status, exact included camera equipment and conflicting
   marketing/package prices. Tested $179/$599 source tiers were not activated.
2. Provide effective customer agreement, cancellation/refund notices and the
   applicable cancellation calendar. Current text explicitly says synthetic;
   the zero-day fixture cannot be promoted as a consumer-rights determination.
3. Enroll the actual company installer under their own verified identity and
   approximately five real SALES accounts through existing managed enrollment.
   Synthetic identities are not employees. Retain the approved 55/50/45 tenure,
   25/75 payments, wage exclusion and opportunity attribution unchanged.
4. Configure the real manual settlement operating details through the existing
   reviewed method and require independent bank evidence; no automatic payouts.
5. Authorize the reviewed production migrations/grants/private storage and the
   verified release rollout to the existing production projects. The new native
   migrations were applied only to the UUID-owned test namespace. Record rollback
   deployment IDs before any separately authorized pilot; keep live payments and
   unrelated technician activation flags off until the controlled pilot gates pass.

No replacement Stripe key, new Stripe/Supabase account or separate database is
required. The complete staging workflow is verified; the actions above concern
effective production records and release authorization, not unresolved software
phases or requests to reapprove the established business model.

**Subsequent reuse audit, 2026-11-05:** the existing Home2Smart Stripe account and
existing Supabase/PostgreSQL connectivity are now verified read-only. No new
account is needed. Accessible credentials are for established/live targets, not
isolated staging. Both existing live webhooks are disabled. See the [authenticated infrastructure reuse
audit](INFRASTRUCTURE_REUSE_AUDIT.md) for precise evidence and missing connections.

## Actual staging URLs

**Test-key update, 2026-11-05 19:40 EST:** management supplied
`H2S_FIELD_STRIPE_TEST_SECRET_KEY` directly in Vercel. Its scope was corrected
from Production within the staging project to **Sensitive, Preview only**,
without reading the value. The backend was redeployed from the same verified
artifact and the stable staging alias updated. Deployment metadata includes the
test variable. Subsequent private-runtime testing at 19:50 EST verified the key
against the existing Home2Smart account and all ten bounded SDK read groups.
Quarantine remains enabled and transactions/live payments disabled.
Both original production deployment IDs remain unchanged.

**Webhook update, 2026-11-05 20:18 EST:** the existing Home2Smart test account now
has endpoint `we_1UYbioLuMP6aPhGZBXa9lU79`, subscribed to exactly the existing
handler's 13 events and **paused** pending native database/storage readiness.
Its signing secret is **Sensitive, Preview only**, under
`H2S_FIELD_STRIPE_TEST_WEBHOOK_SECRET`. A dedicated private ingress bypass is
configured directly in Stripe/Vercel; no secret is published here. The refreshed
clean backend below includes both test secrets and no temporary setup credentials.
Actual ingress reaches quarantine 503, while anonymous access still redirects
302. Stripe-delivered signature processing and paid reconciliation are not yet
certified. See the [complete configuration evidence](INFRASTRUCTURE_REUSE_AUDIT.md#test-webhook-configured-2026-11-05-2018-est).

Vercel Authentication is required before viewing either host. This provider
access check is separate from application account authentication.

| Purpose | URL | Verified boundary |
|---|---|---|
| Management | [Dashboard](https://h2s-staging-frontend-tabari-ropers-projects-6f2e090b.vercel.app/dash) | Current styled sign-in shell |
| Field Sales management | [Field Sales](https://h2s-staging-frontend-tabari-ropers-projects-6f2e090b.vercel.app/dash?tab=fieldsales) | Native accounts/leads/search/repeat/recovery verified through actual APIs |
| Independent representative | [Sales application](https://h2s-staging-frontend-tabari-ropers-projects-6f2e090b.vercel.app/sales.html) | Standalone sign-in, no management-dashboard dependency |
| Operations and scheduling | [Operations](https://h2s-staging-frontend-tabari-ropers-projects-6f2e090b.vercel.app/dash?tab=operations) | Company scheduling/completion passed through the Field Sales order workbench; unrelated legacy APIs remain quarantined |
| Technician | [Technician portal](https://h2s-staging-backend-tabari-ropers-projects-6f2e090b.vercel.app/portal) | Canonical packaged sign-in and installation assets |
| Customer intake | [Residential intake](https://h2s-staging-frontend-tabari-ropers-projects-6f2e090b.vercel.app/schedule-setup) | Responsive form shell; submission blocked |
| Customer documents/payment handoff | [Agreement entry](https://h2s-staging-frontend-tabari-ropers-projects-6f2e090b.vercel.app/field-agreement.html) | Actual private capability, staging-only documents, acceptance and Sandbox deposit/balance passed |
| Backend status | [Health](https://h2s-staging-backend-tabari-ropers-projects-6f2e090b.vercel.app/api/health) | Authenticated 503 quarantine, not healthy native integration |

Frontend `/portal` redirects to the protected backend portal. Customer Checkout
URLs are issued by the real test integration. Four actual paid Sandbox sessions
were verified; customer capabilities are private and are not published here.

## Provider and source evidence

Team: `team_4db6sonwmVW7iErASW4UlF6e`. Both final deployments are **READY**,
**preview** targets, protected by Vercel Authentication on **all** deployments.

| | Frontend | Backend |
|---|---|---|
| Project | `h2s-staging-frontend` | `h2s-staging-backend` |
| Project ID | `prj_Q042UB5JlTAIaCzIRDeGnLH9ylDx` | `prj_3IffA6b3863EMxPq79dgilxOgnVr` |
| Deployment ID | `dpl_7kTLqNhhLaQjBTBZxGVt2Hw12DDp` | `dpl_4Rk4uq9PumjAxUwng7nYP32f4nr7` |
| Immutable URL | [Frontend deployment](https://h2s-staging-frontend-jv5qr3lwt-tabari-ropers-projects-6f2e090b.vercel.app) | [Backend deployment](https://h2s-staging-backend-oakgc3l46-tabari-ropers-projects-6f2e090b.vercel.app) |
| Export root directory | `frontend` | `backend`, with outside-root canonical portal/assets included |
| Runtime | Node 24, static files and server-only staging proxy | Node 22, existing Next build and portal packager |
| Deployment overlay SHA-256 | `f37447f98f37eaefc8c113770b5aaaa6c74a207e0fb3ba1b6e658b8956fd0c9f` | `d3530232ee181426947abbf12792aa9e09a6cc2f7ace9f7587e1085f4bb93185` |

These are the verified application commit plus explicitly recorded staging-only
overlays, not a claim that generated deployment files are unmodified Git blobs.
New projects have no Git link or automatic branch deployment. Metadata records
`retro-dev` and the full source SHA. Existing production projects are Git-linked
to `main`; committed configuration disables automatic `retro-dev` deployment.

Vercel auto-classified each new project's first deployment as Production, even
with the CLI preview selection. Those isolated, private bootstrap deployments
were retired; **the final deployments above are verified previews**. No existing
production project or customer domain was promoted or rerouted.

### Packaging and preservation

- [Preparation tool](../tools/staging/prepare.cjs) operates on a new committed
  export, not the dirty workspace. It permits only staging origins, removes
  nonruntime maintenance files, rejects credential-like runtime content, rewrites
  production service origins and generates staging-only routing/quarantine.
  The immutable shared-Supabase identity guard is preserved verbatim: it is an
  approved provider allowlist, not an unscoped production request target.
  Hosted login verification caught and corrected the earlier blanket URL
  rewrite before final handoff.
- The [server-only proxy](../tools/staging/proxy.cjs) forwards to the fixed private
  staging backend using an encrypted provider bypass credential. It preserves
  application authorization and request bytes; it never exposes that credential
  in browser assets or follows an upstream redirect to production.
  Vercel's generated wildcard `path` capture is verified against the actual API
  route and removed before forwarding; mismatched/duplicate capture metadata is
  rejected. Actual authenticated hosted-history checks exposed this provider
  behavior, which local transport fixtures did not initially reproduce.
- Backend build uses the existing package/Prisma/Next commands. Constructor-only,
  invalid-provider placeholders are confined to the build child process; they
  are not runtime database or Stripe credentials. All native requests are blocked.
- Actual browser screenshots caught missing/stale stamped dashboard assets.
  Corrected before handoff using the committed frontend deployment script's
  **BuildOnly / KeepInjectedHtml** path, never its production-deploy path.
  Its exported staging copy omits only presence checks for absent `dash2.js` and
  `dash.bundle.js`, which the active committed dashboard does not reference.
  Neither untracked legacy file was substituted into the release.
  New checks require the HTML's actual stamped CSS/JS to exist and match the
  current canonical bytes. Final stamp: `PORTAL_BUILD_20261105_183516_428c2cc`.
- Sales/pagination/repeat/company-installation modules, core CSS and the two
  principal API routes match the verified commit after archive CRLF normalization.
  No redesign, pricing, legal, commission or financial-calculation changes.
- [Root portal](../portal.html) remains authoritative.
  [Existing packager](../backend/tools/package-portal.cjs) builds backend portal
  HTML and the installation JS/workflow CSS; both hosted assets return their
  real MIME types, not fallback HTML. See [packaging](PORTAL_PACKAGING.md).
- All seven pre-existing tracked local edits, including deployment configuration
  and portal mirrors, remain untouched. No local environment files were deployed.
  A legacy maintenance script failed the initial credential scan and was excluded
  by the runtime-only export; no credential values were printed/uploaded.
  Review/rotate any still-valid embedded legacy credentials separately.

## Native database and storage: connected in the existing project

Management explicitly authorized a private schema/run in the established
`nkccbnrduojnzjfrpwva` project. This is implemented, not an access request:
UUID-run schemas, a NOLOGIN owner, two real private buckets, structure-only
native baseline cloning and reviewed namespace-retargeted migrations.
No production customer rows were copied and no public business migration was
installed. Existing API schemas were preserved while adding only this run.

Existing credentials were reused securely. Main/management/dispatch use the
same provider and forced run profile. This is logical/shared-resource isolation,
not independent credentials or another database. Unrelated tracking/DB1 and
raw PostgreSQL-owner credentials remain absent from staging.

Environment mapping, **staging backend Preview only**:

| Purpose | Existing variable/authority |
|---|---|
| Main API | Existing `SUPABASE_URL`; existing service key as Sensitive `SUPABASE_SERVICE_KEY`, constrained by the test-only runtime transport. |
| Management API | Same `SUPABASE_URL_MGMT` and Sensitive `SUPABASE_SERVICE_KEY_MGMT`; identical forced run profile. |
| Dispatch | `getSupabaseDispatch()` already returns the main client. No extra dispatch key/database is required. If `SUPABASE_URL_DISPATCH` is set, the workflow guard requires it to match main. |
| Metadata preflight | Local secure `STAGING_PROJECT_REF`, `STAGING_SUPABASE_URL`, `STAGING_DATABASE_URL`, `MIGRATION_CA_CERT_PATH`; port 5432, verified CA, no disabled TLS verification. The preflight does not install migrations. |
| Runtime PostgreSQL consumers | Not configured. Verified local TLS PostgreSQL access prepares/removes only the authorized run; no owner connection is deployed. |
| Run identity | `H2S_STAGING_SANDBOX_RUN_ID=c6316381-64f5-4b67-b41f-41711416cdcc`; `H2S_STAGING_DATABASE_SCHEMA=h2s_test_c631638164f54b67b41f41711416cdcc`; synthetic-only, Preview-only, Stripe test/live-off guards. |

The older project-isolation preflight retains its stricter distinct-project
contract; it is not bypassed or claimed as certification of this different,
explicitly authorized schema-isolation mode.

Keep unrelated tracking/DB1 and production credentials out of staging. Do not
enable business gates simply because variables are present.

[Read-only native preflight](../backend/tools/staging-preflight.cjs) is prepared:

```powershell
node .\backend\tools\staging-preflight.cjs --manifest
# After separately configuring STAGING_PROJECT_REF, STAGING_SUPABASE_URL,
# STAGING_DATABASE_URL and MIGRATION_CA_CERT_PATH outside Git:
node .\backend\tools\staging-preflight.cjs <exact-new-staging-project-reference>
```

The first command passed and emits 18 exact LF-normalized SQL checksums:
007, the commercial-consultation 014, 031/032/035/036/037 and 041-051.
This is a **candidate prerequisite manifest, not a complete empty-project
bootstrap or apply authorization**. The second command was blocked before any
network connection because isolated target credentials are absent.

Before native application:

- Reconcile the actual native schema/ledger, baseline dependencies and exact
  checksums; do not install PGlite test scaffolding as a native schema.
  The existing guarded apply runner remains registered only through 039.
  Do not point it at production or pretend it installs 041-051. Exclude draft 040.
- Verify native account, lead, order, job, assignment and pro identities, including
  `h2s_dispatch_job_artifacts(artifact_id,job_id,pro_id,type,url,created_at)`.
  Do not create a replacement proof table just to pass completion.
- Check service-only RPC execution, fixed search paths, table grants/RLS,
  browser-role denial, constraints, concurrent sessions and rollback.
- Verify `commercial-private-files` privacy/limits and the actual job-artifact
  bucket, authenticated upload/download, cross-owner denial and retention.
  [Legacy artifact helper](../backend/lib/portalArtifacts.ts) tries public URLs
  before signed URLs and permits an inline fallback. A URL string or persisted
  row alone is **not** private-object certification. Prove readable authorized
  bytes and access after URL expiry; correct the existing adapter if needed,
  never make the bucket public or invent proof to pass the test.

Prepared prerequisite/grant/storage plan, not an executed bootstrap:

1. Obtain the actual native baseline using approved schema-only tooling, **no
   customer/account rows, fixture replacement tables or production seeds**.
   Reconcile the native types/keys for `Dashboard_Users`, `commercial_leads`,
   `h2s_orders.id/order_id`, `h2s_jobs`, dispatch jobs/assignments/pros and proof
   artifacts. Candidate SQL alone does not recreate that baseline.
2. Reconcile existing ledger/checksums before applying anything. Candidate
   prerequisite order is 007, commercial 014, 031, 032, 035, 036, 037, then
   041-051 in numeric order. Already-applied migrations must not be replayed.
   The guarded runner's 029-039 registration is not permission/support for
   blindly applying later files; require an exact staging target authorization.
3. Reuse 035's private `commercial-private-files` bucket: 3 MiB maximum,
   JPEG/PNG/WebP/PDF only, Storage object RLS enabled, default-deny browser
   policies. Its SQL explicitly refuses permissive browser policies and an
   unreconciled existing bucket. Do not relax those guards.
4. Reuse 043/044/046/051 service-only authority grants: browser/PUBLIC table and
   RPC access revoked; service role gets SELECT and the reviewed RPC execution,
   not direct financial-table writes. Inspect table grants/RLS, definer search
   paths and role denial through the prepared read-only preflight.
5. Job proof must use a private, working existing upload/download contract;
   preserve actor attribution and retention. The public-first legacy adapter
   remains a certification issue until authorized byte access, browser denial
   and URL expiry/retrieval are actually tested. Do not mark it certified from
   a bucket flag or fake object URL.

## Stripe test configuration prepared; processing blocked, not certified

`H2S_FIELD_STRIPE_MODE=test`; live, sales, transactions, workflow, catalog
administration, earnings and broad management assignment gates remain disabled.
The backend now has a management-supplied Sensitive Preview test key, included
in the refreshed deployment. No live Stripe key was copied and no cron activated.

Verified: actual private Vercel runtime authentication, correct Home2Smart account,
test-only mode, active card capability and ten SDK read groups. A temporary,
independently authorized diagnostic Preview was tested and deleted; its token
variables were removed without changing stable routing or business gates.
That earlier inspection returned zero test webhook endpoints. The subsequent
setup registered and immediately paused the test endpoint described above.

Missing:

- An isolated native database/storage target ready for event reconciliation;
  test webhook and secure signing secret/ingress are now configured.
- Approved exact customer documents/catalog/policies needed by native authorities.

Endpoint:
`https://h2s-staging-backend-tabari-ropers-projects-6f2e090b.vercel.app/api/field-sales-stripe-webhook`.
The registered Stripe URL additionally contains a secret provider-bypass query
parameter, stored only in provider configuration. Do not copy it into chat,
reports or browser assets. That bypass is project-scoped; application signature,
mode and authorization gates remain. Keep the endpoint paused while quarantine
or transaction processing is disabled; otherwise deliveries would receive 503.

No Checkout session, signed Stripe event, captured test deposit/balance, provider
fee, refund or dispute was verified. Invalid build-only SDK constructor values
are not Stripe test configuration. Never reuse live keys or disable signature
verification to make the certification pass.

## Verification results and limits

| Evidence | Actual result |
|---|---|
| Vercel build | Backend package/Prisma/Next compilation, type validation and 86 static pages passed; frontend build/function packaging passed. |
| Hosted checks | **29/29 passed**: both aliases and immutable URLs reject anonymous access; seven correct entry shells; canonical assets and actual current stamped bytes; technician assets; frontend-to-private-backend proxy; GET/POST quarantine; original production deployment preservation. |
| Actual browser checks | **12 screenshots**, six shells at 390/1280px; no horizontal overflow. Management/Operations actually execute current dashboard scripts and current stamped CSS. No production service request attempts; no static CDN interception failures. |
| Focused automated selection | **65 passed, 0 failed, 0 skipped**, command below. |
| Native account lifecycle | **Passed** against actual hosted APIs/native PostgreSQL: disabled enrollment, activation, login, owner isolation, disable/session revocation, management reset and reactivation. Synthetic enrollments were disabled afterward. |
| Actual Stripe test connectivity | **Passed**, including Stripe-delivered signed `payment_intent.canceled` correlated with native audit. The unconfirmed test intent received $0 and created no charge. Endpoint paused again; no paid-processing certification. |
| Runtime guard and financial regressions | **29/29 passed**: six temporary diagnostic guards plus 23 existing payment/workflow tests. Not native paid-transaction certification. |
| Webhook/preflight/financial selection | **33/33 passed**: six setup guards, four native preflight guards and 23 financial/workflow tests. Provider builds passed; registered events match the handler exactly; both actual production deployments unchanged. |
| Native pagination/repeat | **Passed** at 0/1/100/101/500/1000, both main and due pages; older customer search, independent TV/camera opportunities, canonical identity, original preservation and role-scoped history passed. Not an accepted/paid repeat-purchase certification. |
| Native end-to-end paid TV then camera sale | **Not run**: exact approved catalog/legal/compensation inputs and legitimate company-installer activation remain gated; native financial tables are empty. |
| Same-database regression selection | **72 passed**: namespace/client/cleanup/proof/dispatch plus existing financial/company-installation tests. Final clean backend compilation/type validation passed. |
| Actual native cleanup | Wrong confirmation/foreign marker refused; fresh disposable private Storage bytes/buckets and owned schemas/role successfully removed. Only the retained primary run remains. |
| Isolated connected pilot | Passed in the 65-test selection: shared login/API/SQL, TV deposit/completion/costs/balance/commission/Friday review and independent different-representative camera repeat. Uses PGlite/provider fixtures, not real native services or Stripe. |
| Production compatibility | Existing production deployment IDs unchanged; isolated compatibility checks passed. No authenticated/live production smoke transactions were attempted. |

```powershell
node --test .\backend\tests\field_sales_paging_repeat.test.cjs .\backend\tests\field_sales_owner_pilot.test.cjs .\backend\tests\field_sales_credentials.test.cjs .\backend\tests\portal_packaging.test.cjs .\tests\company-installation-ui.test.cjs .\tests\field-sales-redesign-ui.test.cjs .\tests\private-staging.test.cjs .\backend\tests\staging_preflight.test.cjs
```

The native certification still must prove deposit, legitimate company acceptance/
proof/completion, actual-cost approval, final balance/provider fees, commission,
Friday review and immutable repeat purchases, plus failures/retries and account
isolation. The quarantine cannot be cleared based on screenshots or fixture results.

## Controlled production release checklist

Management's architecture/lean-policy/enrollment choices are approved. The
following concrete evidence is still required; no new development phase is proposed.

1. **Connection work completed:** existing Supabase/PostgreSQL/private Storage
   and actual signed Stripe test ingress passed. No provider credential,
   additional database or organization login is missing for this work.
2. **Approval blocker:** record exact approved TV/camera catalog version/digest,
   size/quantity/equipment/scope/tax/territory, reviewed legal/cancellation/refund
   documents and M3/M4 attribution/cost/Friday rules. Existing compensation
   rates and 25%/75% calculations are unchanged; architecture approval does not
   invent missing legal text or policy values. Proposed equipment stays proposed.
3. **Certification blocker:** after exact business approvals, complete the real
   native deposit/completion/cost/balance/commission chain, concurrency and rollback.
   Native account lifecycle/isolation and signed ingress have already passed.
   Verify private proof retrieval rather than upload-shaped success.
4. **Operating blocker:** approve the actual company installer identity and
   recovery/reconciliation owners. Prepare five representative accounts disabled
   first; enroll/activate real personnel only after separate production approval.
5. **Release gate:** freeze exact production source/build/catalog/policy digests,
   reviewed native migration/grant plan (including the proven 052 shared-dispatch
   compatibility correction), backup/restore and compatible backend/
   frontend pair. Do not promote the quarantined staging artifacts to production.
6. **Rollback gate:** preserve current production backend
   `dpl_8RTmC8XK1YUs78sj5mshQNueE46M` and frontend
   `dpl_BRTZZG9tsPnwUFyMxqyjSSUwZkNC` as the recorded hosting baseline.
   After a separately authorized release, disable new capabilities and restore
   the reviewed compatible deployment pair if necessary. Retain additive schema,
   accepted contracts, payments, artifacts and earnings. Reconcile in-flight
   webhooks/legal/customer obligations; flags do not refund or erase liabilities.
7. **Final management gate:** approve the bounded pilot only after reviewing
   native evidence, operational support/monitoring and exact live-payment scope.
   Keep automated payouts and unrestricted technician assignments disabled.

Stopped for management review. No production credentials, records, migrations,
routing, live payments, real employee enrollment or payouts were changed.
