# Home2Smart Sales System Progress

Single persistent tracker for the [execution plan](SALES_SYSTEM_EXECUTION_PLAN.md), grounded in the [alignment audit](SALES_SYSTEM_ALIGNMENT.md).

**Current state: independently executable engineering, including configurable installation proof, is implemented; final 38-file regression selection passes332/332, exact-index TypeScript/12-file lint/Next build pass. Final verified development preservation is underway. Native integration, business policies and production actions remain blocked.**

Audit baseline: `retro-dev`, `0176651f6bfb43c4050b2773bc4d697746ffaf39`. Approved execution starts from verified planning commit `19227325e42d36c1e8d84a804ceecb265c774c66`. Original specification PDF unavailable; supplied requirements govern remaining work.

## Status and evidence rules

- `COMPLETE`: required outcome and tests/demo are recorded; distinguish code/test completion from production activation.
- `IN_PROGRESS`: approved implementation actually underway.
- `OUTSTANDING`: not implemented; engineering scope is approved, while policy/production gates remain separate.
- `BLOCKED`: name the missing prerequisite/authorization; do not block unrelated ready work.
- Never record mock responses as native integration proof, exported/approved compensation as paid, or plan approval as deployment authority.
- After approval, update this document for each meaningful integrated delivery with commit, exact tests/results, runtime/demo evidence, remaining defects and policy/activation gates. Keep one tracker rather than new phase plans.

## Existing foundations

| Foundation | Code status | Limits / evidence |
|---|---|---|
| Management dashboard, Customer Queue and Operations | COMPLETE foundation | Existing central application; isolated regressions below. No fresh production-runtime certification. Historical queue fixture failure was corrected and retested in the approved delivery. |
| SALES accounts, owned prospects, assessments/private photos | COMPLETE / inactive foundation | Role/ownership/configuration contracts tested in isolation. Five real accounts not enrolled; native grants/storage/session proof outstanding. |
| Server catalog, immutable quotes and ADMIN exception approval | COMPLETE / inactive foundation | Existing mechanisms retained. Approved comprehensive launch matrix/publication unverified; proposed pricing remains off. |
| Exact-quote customer agreement and Stripe bridge | COMPLETE / inactive | Existing page, exact copies/retrieval,25%/balance, canonical receipt/fee/concurrency and controlled live code implemented. Approved notices/delivery and native provider certification remain blocked. |
| Company calendar/preparation and managed offers/responses | COMPLETE / assignment inactive | Shared authorities now joined through explicit new-sale enrollment/legal/proof gates and canonical compensation identity. Native activation/provenance require approval. |
| Legacy technician portal/payout contracts | COMPLETE legacy functionality, not sales payout proof | Portal must remain compatible. Completion rollback and linked-guard integration risks documented in audit; no actual sales payout execution. |
| Offline pricing/commission modeling | COMPLETE / proposed, estimate-only | 308 pricing tests pass. Models are not approved prices, actual expenses or operational commission ledger. |
| Synthetic visual preview | COMPLETE preview-only | Saved app checked at desktop/390/320; no production transactions or native integration proof. Legacy Dispatch mobile clipping remains. |

## Remaining delivery tracker

| ID | Status / approval | Integrated dependency | Exact outstanding outcome | Completion evidence |
|---|---|---|---|---|
| `launch-contracts` | COMPLETE engineering / native certification blocked | Existing foundations | Immutable origin/credit/start evidence, catalog administration, actual five synthetic sessions and baseline type/fixture fixes implemented. Approved launch publication/native grants remain gated. | Five real synthetic login tokens; authority/ownership/photo/catalog regression coverage. |
| `sale-to-deposit` | COMPLETE authority / activation blocked | `launch-contracts` | Exact copies/retrieval/acceptance, approved cancellation calendar, enrolled25%, canonical receipts/actual fees and inactive controlled live mode. | Real APIs/SQL and signed synthetic Stripe events, retries, failures/refunds and finite accepted-link tests. |
| `fulfillment-to-balance` | COMPLETE engineering / activation blocked | `launch-contracts`, `sale-to-deposit` | Shared scheduling/preparation, enrolled-only assignment, pinned configurable/native retained proof, actual expenses/hours, completion before verified net balance. | Five multi-service configured-proof orders pass. Real capture commands save partial/full proof into actual SQL and refresh completion gates. Root host/API/320/390/1280 layouts pass. |
| `commission-Friday` | COMPLETE engineering / activation blocked | `launch-contracts`, `fulfillment-to-balance` | Actual approved cost/fee base, wage exclusion, immutable qualification/rates/adjustments, unique Friday allocation, audited abandonment/export/reconciled settlement. | Actual SQL/API math, dispute/source-review holds, settlement timestamp and allocation recovery regressions pass. Export never counts as paid. |
| `pilot-certification` | COMPLETE isolated engineering validation / external certification BLOCKED | All batches | Native PostgreSQL/Supabase/storage/Stripe test access, hosted source provenance and approval remain outstanding. | Five customers/representatives each sell TV plus equipment cameras; ten standalone service drafts; full connected pilot included in332/332. Actual root layout and launch/rollback documentation complete. |

**Remaining engineering boundary:** the demonstrated one-accepted-contract-per-lead limitation requires an additive repeat-opportunity design for repeat customers; duplicate identities are not a workaround. Native integration certification is blocked by external access, not silently replaced with fixture evidence. No other independently executable approved delivery item is outstanding.

### Verified development deliveries

- `45ec8035bae2dde88db61f01db81225df8f9dba8`, pushed to `retro-dev` and remote SHA verified: immutable originating identities, explicit audited representative start-date contracts, separately gated ADMIN catalog administration and the coupled session/fixture/type validation. Thirty-one focused tests passed; full configured backend types passed on isolated exact-index sources without environment files. No production actions occurred. Workflow, fulfillment, earnings and integrated interfaces continue automatically; this is not certification of an entire delivery batch.

### Policy and activation gates

| Gate | Status | Blocks |
|---|---|---|
| Plan approval | COMPLETE / approved November 4, 2026 | Authorizes all independent engineering in the unified plan, not production actions. |
| M1 approved offer/scope/equipment/tax/area matrix | BLOCKED / approval outstanding | Real payable catalog/transactions; draft fixtures may proceed after plan approval. |
| M2 approved legal documents/applicability/delivery/cancellation calendar | BLOCKED / approval outstanding | Real agreements, clearance and installation; synthetic policy/artifact contracts may proceed. |
| M3 approved tenure event/credit/actual-cost accounting | BLOCKED / approval outstanding | Real compensation snapshots/accounting; specified rate/wage-exclusion tests may proceed. |
| M4 lawful classification/timing/Friday calendar/settlement method | BLOCKED / approval outstanding | Real earned-compensation holds/payment runs and settlement; synthetic run mechanics may proceed. |
| Actual isolated database, storage and Stripe test evidence | OUTSTANDING / unverified | Production certification. No production credential/data inspection occurred. |
| Production migrations, account/customer enrollment, deployment | BLOCKED / not authorized | Any production action, including seeding the five real accounts. |
| Live Stripe and scoped management assignment activation | BLOCKED / not authorized | Real collection/assignment through the new workflow. Existing behavior must stay unchanged. |
| Email, proposed prices/bonus, paid software, historical repairs | BLOCKED / outside approved scope | Remain off; not dependencies for independent lean-sales development. |

Historical identity/payout inconsistencies remain separately reviewable; they are not a global blocker to new-order development. A verified new-job/technician relationship is required for new fulfillment acceptance.

## Validation evidence

### Approved engineering evidence

- Final38-file selection: **332/332 passed**,0 failed/0 skipped. This supersedes
  the earlier321-test result below and includes the configured five-rep pilot,
  actual frontend proof saves and catalog/API proof-budget checks. Exact command:

```powershell
$names = @(
  'field_sales','field_sales_ui','field_commerce','field_commerce_ui',
  'managed_offer_response','management_assignments','management_assignments_api',
  'management_assignments_ui','management_operations','management_operations_ui',
  'management_planning','management_planning_ui','operations_foundation',
  'commercial_compatibility','commercial_operations','commercial_calendar',
  'commercial_business','stripe_order_metadata','dashboard_controls',
  'dashboard_presentation','commercial_contact','residential_inquiry',
  'shared_address','residential_funnel','field_sales_catalog_admin',
  'field_sales_launch_contracts','field_sales_session_integration',
  'field_workflow','field_workflow_expiry','field_workflow_fees',
  'field_earnings','field_earnings_math','field_workflow_proof_requirements',
  'field_completion_catalog','sales_system_pilot'
)
$paths = @($names | ForEach-Object { 'backend\tests\' + $_ + '.test.cjs' })
$paths += @(
  'tests\field-portal-wiring.test.cjs',
  'tests\field-sales-integration-ui.test.cjs',
  'tests\field-costs-authority-ui.test.cjs'
)
node --test --test-concurrency=2 @paths
```

- Published service `completionRequirements` validate/pin photo, signature and
  affirmative checklist evidence. Requirements are per order/service, not
  implicitly multiplied by quantity. Native bindings/checks are atomic
  full-replacement saves; partial saves remain incomplete. Selected native
  artifacts cannot satisfy two configured requirements and are retained after
  completion. Management/SALES summaries omit artifact IDs/candidate URLs/raw
  checklist evidence. Baseline photo/onsite signature remain mandatory.
- Installation JSON body and minimum quote-proof feasibility share the exact
  **4,456,448-byte** cap. Oversized requests return413; quotes whose minimum
  full proof cannot fit are rejected before acceptance/payment. Tests measure
 100-by100 supported proof, impossible30-service combinations and repeated
  service deduplication; no truncation or impossible payable quote fallback.
- Actual root modal with configured proof and an unbroken long label retains
  the320/390/1280 overflow metrics below. All19 input/select/textarea controls
  have actual associated/wrapping/ARIA labels; selected-proof save is enabled,
  completion correctly disabled while configured bindings are missing.
- Updated isolated review verified at a separate local port: actual workflow/
  earnings reads and actual authorized private-photo binary PNG; one synthetic handler-verified
 25% deposit, no completion/earned entries/settlement. Six workflow/install/
  earnings/catalog/staff/customer checkout POST endpoints return423. This
  demonstrates inspection isolation, not real Stripe/private storage operation.
- Actual current management Orders (all details open;63 form controls),
  Performance and Commissions (Friday form open) at320/390/1280: page scroll
 312/382/1272, Field Sales client/scroll280/350/980. No horizontal overflow.
  Asynchronous actual reads were awaited before measuring, not empty loading states.
- Final exact-index configured TSC, focused12-source Next lint and Next14.2.18
  build: **passed** with no copied env files, synthetic/default-off environment,
  outbound socket guard, telemetry off and no Prisma regeneration. Commands:

```powershell
node node_modules\typescript\bin\tsc --noEmit --project backend\tsconfig.json --incremental false
# From backend in the same isolated selected-index snapshot:
node node_modules\next\dist\bin\next lint `
  --file app/api/field-sales-agreement/route.ts `
  --file app/api/field-sales-stripe-webhook/route.ts `
  --file app/api/field-sales-transactions/route.ts `
  --file app/api/field-sales-workflow/route.ts `
  --file app/api/field-sales-installation/route.ts `
  --file app/api/field-sales-earnings/route.ts `
  --file app/api/portal_jobs/route.ts --file app/api/portal_mark_done/route.ts `
  --file lib/fieldCommerce.ts --file lib/fieldWorkflow.ts `
  --file lib/fieldEarnings.ts --file lib/fieldQuote.ts
node node_modules\next\dist\bin\next build
```

- Full coupled regression selection: **321/321 passed**,35 files,
  `node --test --test-concurrency=2 --test-reporter=spec` with the historical24
  selectors below plus launch/catalog/session, workflow3, earnings2 and the
  three root `tests` suites. No skips. Coupled commercial compatibility import
  fixture is repaired; no unrelated application behavior changed.
- `node --test --test-reporter=spec backend\tests\sales_system_pilot.test.cjs`:
  **1/1 passed**. Five reps at tenure days1/30/31/60/61, five shared inquiry
  identities, ten standalone TV/camera drafts and five combined accepted
  orders. Actual APIs/SQL enforce approval,25% deposits, cancellation clearance,
  shared reservations/readiness/accepted offers, retained photos/signatures,
  actual equipment/material amounts/hours, final balance, actual fee110 cents
  per order, wage-excluding earnings and Friday review/export. Provider/data
  are synthetic. No actual settlement is asserted or initiated.
- Pilot respects the existing one-accepted-contract-per-lead rule. A second
  quote on a completed accepted lead is rejected; duplicate phones are not a
  workaround. Repeat-opportunity/customer modeling is not implemented.
- Full configured TypeScript and Next14.2.18 build: **passed** on exact selected
  index sources, excluding environment files; explicit synthetic/default-off
  environment, outbound socket guard and telemetry disabled. Existing generated
  Prisma client reused; no shared dependency generation or production access.
  Temporary build snapshot/junctions were removed without touching dependencies.
- Actual root portal scripts/host lifecycle/canonical metadata/proof order:
  **6/6 passed**, included in321. Combined real-session/client/actual SQL cost
  authority selection: **36/36 passed**, also included, not additional tests.
- Source-based browser check caught a real doubled `/api/api/` installation
  URL not exposed by mocked-fetch selectors. All six frontend endpoint builders
  now normalize origin or `/api` bases/trailing slashes; exact GET/POST URL
  regression added,43/43 focused tests pass.
- Corrected actual root portal DOM/CSS plus actual component and isolated SQL
  ready response: widths320/390/1280 have page widths320/390/1280, sheet
  client/scroll271/341/803, component client/scroll231/301/739. No page or internal
  horizontal overflow. Original portal bootstrap and remote fonts/media disabled
  for safety; this is source-based layout proof, not native/hosted certification.
- Earlier exact plan-completeness review found baseline photo/signature requirements were
  hardcoded and pre-sale configurable photo labels did not configure installation
  completion. That gap is now closed and included in the final332-test selection:
  published requirements, immutable snapshots, native bindings/checklists,
  retention, partial/full capture and fresh completion gates all pass.

- Launch identity/date/catalog/legacy regression command:
  `node --test --test-concurrency=2 backend\tests\field_sales_launch_contracts.test.cjs backend\tests\field_sales_catalog_admin.test.cjs backend\tests\field_sales.test.cjs backend\tests\commercial_contact.test.cjs`: **30/30 passed**.
- `node --test backend\tests\field_sales_session_integration.test.cjs`: **1/1 passed**. Actual dashboard login token hashing/expiry and the shared authentication module feed the actual Sales API against isolated SQL records, including cross-owner, expired/disabled and legacy-route denial. This is not certification against deployed Supabase.
- Strict ES2020 launch dependency-graph check and full configured backend check on the exact selected-index source snapshot: **passed** (`node node_modules\typescript\bin\tsc --noEmit --project backend\tsconfig.json --incremental false`, working directory isolated index snapshot, no environment files copied). The earlier ES5 target was corrected; whole integrated-project validation remains required as concurrent work finishes.
- Catalog administration is separately default-off in environment and database. Draft creation/publication/retirement requires ADMIN, version/digest and explicit approval evidence; no production catalog was touched.
- Immutable new-lead originating representative reuses existing `created_by`; historical origins remain unknown. Representative start dates are explicit, revisioned and audited; no tenure/rate event is guessed.
- Fresh unchanged-pricing validation, working directory `config\pricing`: `node validate.cjs` and `node --test --test-reporter=dot tests\pricing.test.cjs tests\cameras.test.cjs tests\recommendations.test.cjs reconciliation\reconcile.test.cjs`: **308/308 passed**. Supplier/proposal/reference checks remain offline; no live offer or compensation model was activated.

### Historical audit baseline

Audit results, November 4, 2026, before implementation; isolated data, external database opt-ins cleared.

### Focused contracts

Exact command (PowerShell; run from repository root):

```powershell
node --test --test-concurrency=2 `
  backend\tests\field_sales.test.cjs backend\tests\field_sales_ui.test.cjs `
  backend\tests\field_commerce.test.cjs backend\tests\field_commerce_ui.test.cjs `
  backend\tests\managed_offer_response.test.cjs backend\tests\management_assignments.test.cjs `
  backend\tests\management_assignments_api.test.cjs backend\tests\management_assignments_ui.test.cjs `
  backend\tests\management_operations.test.cjs backend\tests\management_operations_ui.test.cjs `
  backend\tests\management_planning.test.cjs backend\tests\management_planning_ui.test.cjs `
  backend\tests\operations_foundation.test.cjs backend\tests\commercial_compatibility.test.cjs `
  backend\tests\commercial_operations.test.cjs backend\tests\commercial_calendar.test.cjs `
  backend\tests\commercial_business.test.cjs backend\tests\stripe_order_metadata.test.cjs `
  backend\tests\dashboard_controls.test.cjs backend\tests\dashboard_presentation.test.cjs `
  backend\tests\commercial_contact.test.cjs backend\tests\residential_inquiry.test.cjs `
  backend\tests\shared_address.test.cjs backend\tests\residential_funnel.test.cjs
```

Result: **258 tests; 257 passed, 1 failed, 0 skipped**. Failure: `actual queue GET keeps administrator authorization and dashboard wiring`, error `getBearerToken is not defined`, in the commercial-contact fixture. Previously independently reproduced at baseline; no unrelated application repair during audit. This is not permission to ship a broken real queue.

### Pricing and types

- Pricing package scripts, working directory `config\pricing`: `node validate.cjs` and `node --test tests\pricing.test.cjs tests\cameras.test.cjs tests\recommendations.test.cjs reconciliation\reconcile.test.cjs`: **308/308 pricing tests passed**; proposal/reference/model checks only.
- `node node_modules\typescript\bin\tsc --noEmit --project backend\tsconfig.json --incremental false`: **failed, nine TS2802 diagnostics**, matching previously archived baseline ES5 iteration incompatibility.
- Same command with `--target ES2020`: **passed** without changing configuration. Configured-target correction/validation remains outstanding after implementation approval.

### Visual/runtime boundaries

- Actual synthetic representative UI at 1440px/390px/320px and Quotes at 390px/320px: no page-wide horizontal overflow; existing quote/approval/agreement actions present.
- Legacy Dispatch main content clips on mobile: 390px client122/scroll232; 320px client60/scroll232. Desktop usable.
- No customer acceptance/payment/completion records submitted in browser. Synthetic errors/blocked integrations are labeled.
- Native PostgreSQL, real Stripe test-account, private storage, legally approved customer delivery and real compensation settlement: **not certified**.

## Completion record template

For each implemented batch, replace the outstanding evidence cell and add:

```text
Batch / approval reference:
Development commit(s) / pushed branch:
Affected source, schema and UI paths:
Exact validation commands and results:
Demonstrated journey / actual dependency evidence:
Synthetic-only or unverified evidence:
Remaining defects / policy and activation gates:
Next ready approved work:
```

After every delivery, continue through ready approved work without requesting a prompt per component. Pause only at the boundaries in the execution plan. No phase numbering, silent policy defaults, fake settlement or implicit production authorization.
