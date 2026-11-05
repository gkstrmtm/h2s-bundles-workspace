# Home2Smart Sales System Progress

Single persistent tracker for the [execution plan](SALES_SYSTEM_EXECUTION_PLAN.md), grounded in the [alignment audit](SALES_SYSTEM_ALIGNMENT.md).

**Current state: development execution approved November 4, 2026; integrated engineering underway. Production actions remain unauthorized.**

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
| Management dashboard, Customer Queue and Operations | COMPLETE foundation | Existing central application; isolated regressions below. No fresh production-runtime certification. Queue fixture failure retained separately. |
| SALES accounts, owned prospects, assessments/private photos | COMPLETE / inactive foundation | Role/ownership/configuration contracts tested in isolation. Five real accounts not enrolled; native grants/storage/session proof outstanding. |
| Server catalog, immutable quotes and ADMIN exception approval | COMPLETE / inactive foundation | Existing mechanisms retained. Approved comprehensive launch matrix/publication unverified; proposed pricing remains off. |
| Exact-quote customer agreement and test-only Stripe bridge | COMPLETE / inactive foundation | Existing customer page, verified receipt/net balance and concurrency contracts. Approved notices/delivery, 25% workflow enforcement and controlled live capability outstanding. |
| Company calendar/preparation and managed offers/responses | COMPLETE foundation / assignment inactive | Existing authorities reusable. New-sale enrollment/legal/completion joins and canonical new-job compensation association outstanding. |
| Legacy technician portal/payout contracts | COMPLETE legacy functionality, not sales payout proof | Portal must remain compatible. Completion rollback and linked-guard integration risks documented in audit; no actual sales payout execution. |
| Offline pricing/commission modeling | COMPLETE / proposed, estimate-only | 308 pricing tests pass. Models are not approved prices, actual expenses or operational commission ledger. |
| Synthetic visual preview | COMPLETE preview-only | Saved app checked at desktop/390/320; no production transactions or native integration proof. Legacy Dispatch mobile clipping remains. |

## Remaining delivery tracker

| ID | Status / approval | Integrated dependency | Exact outstanding outcome | Completion evidence |
|---|---|---|---|---|
| `launch-contracts` | IN_PROGRESS / engineering approved | Existing foundations | Stable original/current/credited rep identities; enrolled-order relationships; draft approved-catalog matrix; explicit policy interfaces; isolated grants/storage/session proof; test/type baseline resolution. | Additive identities/start evidence and catalog administration implemented; focused validation underway. |
| `sale-to-deposit` | IN_PROGRESS / engineering approved | `launch-contracts` | Approved customer copies/notices/delivery/deadlines, new-workflow 25%, verified receipts/fees, disabled controlled live path and actionable customer/rep UI. | Integrated authority and existing customer/rep surfaces being implemented; no completion claim yet. |
| `fulfillment-to-balance` | IN_PROGRESS / engineering approved | `launch-contracts`, `sale-to-deposit` | Existing calendar/job enrollment, legal/deposit/readiness gates, canonical scoped assignment, actual expenses/hours/completion, then verified net balance. | New-order-only authority and actual-evidence completion integration underway. |
| `commission-Friday` | IN_PROGRESS / engineering approved | `launch-contracts`; integrated completion depends on `fulfillment-to-balance` | Actual-cost wage-excluding 55/50/45 ledger/adjustments, qualification, rep/manager reporting, reviewed Friday allocation/export/settlement. Math/run fixtures can start earlier. | Independent math, policy/ledger/run contracts underway; no real compensation initiated. |
| `pilot-certification` | OUTSTANDING / engineering approved | All batches | Five-rep TV/camera journey, isolated native/test-Stripe/private-storage proof, full mobile/error checks, rollback and explicit launch checklist. | Waiting for integrated implementation. Native PostgreSQL tools are unavailable on this machine; no external test credentials supplied. |

**In progress:** launch contracts, workflow authority, independent earnings contracts and existing-surface UI integration. No batch is certified complete yet.

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

- Launch identity/date/catalog/legacy regression command:
  `node --test --test-concurrency=2 backend\tests\field_sales_launch_contracts.test.cjs backend\tests\field_sales_catalog_admin.test.cjs backend\tests\field_sales.test.cjs backend\tests\commercial_contact.test.cjs`: **30/30 passed**.
- `node --test backend\tests\field_sales_session_integration.test.cjs`: **1/1 passed**. Actual dashboard login token hashing/expiry and the shared authentication module feed the actual Sales API against isolated SQL records, including cross-owner, expired/disabled and legacy-route denial. This is not certification against deployed Supabase.
- Strict ES2020 launch dependency-graph check and full configured backend check on the exact selected-index source snapshot: **passed** (`node node_modules\typescript\bin\tsc --noEmit --project backend\tsconfig.json --incremental false`, working directory isolated index snapshot, no environment files copied). The earlier ES5 target was corrected; whole integrated-project validation remains required as concurrent work finishes.
- Catalog administration is separately default-off in environment and database. Draft creation/publication/retirement requires ADMIN, version/digest and explicit approval evidence; no production catalog was touched.
- Immutable new-lead originating representative reuses existing `created_by`; historical origins remain unknown. Representative start dates are explicit, revisioned and audited; no tenure/rate event is guessed.

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
