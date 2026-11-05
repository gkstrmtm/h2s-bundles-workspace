# Home2Smart Sales System Progress

Single persistent tracker for the [execution plan](SALES_SYSTEM_EXECUTION_PLAN.md), grounded in the [alignment audit](SALES_SYSTEM_ALIGNMENT.md).

**Current state: audit/planning complete; application execution not approved or started.**

Audit baseline: `retro-dev`, `0176651f6bfb43c4050b2773bc4d697746ffaf39`. This delivery changes planning documentation only; its commit is available through these files' Git history. Original specification PDF unavailable; supplied requirements govern remaining work.

## Status and evidence rules

- `COMPLETE`: required outcome and tests/demo are recorded; distinguish code/test completion from production activation.
- `IN_PROGRESS`: approved implementation actually underway.
- `OUTSTANDING`: not implemented. All new batches currently require plan approval.
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
| `launch-contracts` | OUTSTANDING / awaiting plan approval | Existing foundations | Stable original/current/credited rep identities; enrolled-order relationships; draft approved-catalog matrix; explicit policy interfaces; isolated grants/storage/session proof; test/type baseline resolution. | No implementation commit/tests/demo yet. |
| `sale-to-deposit` | OUTSTANDING / awaiting plan approval | `launch-contracts` | Approved customer copies/notices/delivery/deadlines, new-workflow 25%, verified receipts/fees, disabled controlled live path and actionable customer/rep UI. | No implementation commit/tests/demo yet. |
| `fulfillment-to-balance` | OUTSTANDING / awaiting plan approval | `launch-contracts`, `sale-to-deposit` | Existing calendar/job enrollment, legal/deposit/readiness gates, canonical scoped assignment, actual expenses/hours/completion, then verified net balance. | No implementation commit/tests/demo yet. |
| `commission-Friday` | OUTSTANDING / awaiting plan approval | `launch-contracts`; integrated completion depends on `fulfillment-to-balance` | Actual-cost wage-excluding 55/50/45 ledger/adjustments, qualification, rep/manager reporting, reviewed Friday allocation/export/settlement. Math/run fixtures can start earlier. | No implementation commit/tests/demo yet. |
| `pilot-certification` | OUTSTANDING / awaiting plan approval | All batches | Five-rep TV/camera journey, isolated native/test-Stripe/private-storage proof, full mobile/error checks, rollback and explicit launch checklist. | No implementation commit/tests/demo yet. |

**In progress:** none. **New application work completed by this audit:** none.

### Policy and activation gates

| Gate | Status | Blocks |
|---|---|---|
| Plan approval | BLOCKED / awaiting review | All new application implementation. |
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

Fresh audit results, November 4, 2026; isolated data, external database opt-ins cleared. No application files changed.

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
