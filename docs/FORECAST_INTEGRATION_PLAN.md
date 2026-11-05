# Forecast / Simulation integration plan

**Status: investigation and future approval proposal only — 2026-11-05.** No engine, backend, pricing, activation, payment, commission or deployment changes are authorized by this document. This Forecast investigation made no production or supplier queries. Citations describe the inspected working-tree sources; frontend line numbers may move during concurrent work. The calculator inspection covered `frontend\dash.js:30900-33700`.

## 1. Decision and evidence boundaries

Keep the current calculator as a hypothetical capacity simulator. Incrementally add versioned service mix, cost provenance and cash-flow projections; do **not** substitute a proposed pricing file for the production catalog or replace the engine wholesale.

Use these distinct labels on every input/result:

- **Approved:** an evidenced published catalog/policy version, not merely a JSON price or active storefront row.
- **Proposed:** pending-approval pricing/equipment/offer definitions; comparison only.
- **Estimated:** documented quantities, procurement allowances, fees, conversion and timing assumptions; never payable actuals.
- **Actual:** immutable accepted quote, verified payment/refund, reviewed invoiced costs, earning or independently evidenced settlement, with source identity and timestamp.
- **Hypothetical:** user-entered volume, mix, overrides or experiments. Combining actual prices with hypothetical volume still produces a forecast, not actual revenue/profit.
- **Unknown:** absent evidence stays null/incomplete, not zero. Approved selling prices do not establish approved procurement costs.

**Current production approval/enablement, live catalog contents, representative start dates, actual costs, actual payment fees and settled payroll are unknown in this investigation.** Local code proves contracts, not deployed configuration. No production query or supplier check was performed.

## 2. Source-of-truth map

| Source | Verified meaning and integration consequence |
|---|---|
| `config\pricing\home2smart.v1.json:4-17,19-42` | Explicitly `proposed_baseline_pending_approval`, null effective date; installation-only versus specified supplied SKU; TV/camera residential/commercial tiers. Material profit excludes labor, travel, processing, tax, insurance and overhead. Historical $559.99/$999.99 equipment examples are unverified, not current invoices. |
| `config\pricing\baseline.schema.json:4-14,25-40,72-88` | Schema enforces proposed status and null effective date. It is not an approval or activation schema. `config\pricing\source\pricing.v1.json:39` additionally contains a proposed inactive $50 offer; do not import the source transcription as the validated baseline. |
| `config\pricing\pricing.cjs:35-50,53-124,140-147` | Existing exact-cent material-contribution calculation and shape/reference validation. Reuse semantics/tests, but material contribution is not full company profit. Baseline/equipment matching is validated, not published. |
| `config\pricing\equipment.v1.json:5-12,20-40,75-96` and `config\pricing\equipment.schema.json:4-28` | Proposed editable costs, excluding sales tax/shipping; supplier observation, cost assumption and compatibility review are separate. Fixed mount assumption $24.88; large full-motion assumption $54 versus observed $44.94. Never silently use the lower listing price or assume every TV fits. |
| `config\pricing\equipment.v1.json:317-345`; `config\pricing\home2smart.v2.json:150-153` | Legacy proposed consumables are $3/TV; equipment-catalog proposed tilt/full-motion customer upgrades are $20/$65, whereas v2 proposes $25/$75 and leaves small-motion unpriced. These are distinct versions, not interchangeable add-on prices or BOM budgets. |
| `config\pricing\residential-cameras.v1.json:4-19,34-39,90-110` | Proposed model/site/storage requirements; microSD, consumables, protection and electrical materials can be unknown. Illustrative commissions 40/50/60 and 3% processing here are **not** field-sales compensation/actual fees. |
| `config\pricing\home2smart.v2.json:5-37,48-61,103-119` | Reconciled proposal with `activationAllowed:false`, null approved commission policy; 8% materials tax, 3% processing, 5% reserve and 50/55/60 sensitivities are estimates. $199 supplied 56–65-inch TV, from-$599 two-S220 and premium E40/E50 tiers remain proposed. |
| `config\pricing\reconciliation\reconcile.cjs:31-43,215-258` | Offline loader ties v2 to v1/equipment/camera/v5/PDF/public observations/verification. Outputs retain `actualProfit:null`; technician cash, reserve and missing-cost flags stay separate. This is a proposal comparison engine, not an application price feed. |
| `config\pricing\offers\residential\README.md:24-31,258-285,326-342` | Sealed historical experiments are distinct from v2: $219 TV experiment is not selected; v5 $499 two-camera economics used combined incidentals. Do not mix v5 combined allowance with v2 separate supplies/trip budgets or import its commission formula into actual payroll. |
| `config\pricing\reconciliation\source\published-pricing.v1.json:2-35` | Archived **2026-11-02 observation**, not current approval: catalog TV $249/$449/$699; camera $599/$1199/$2199. Two-TV card/calculator $428 contradicts catalog $449. Camera packages include doorbell/NVR scope and customer-supplied devices; not the proposed S220 procurement packages. Commercial numeric catalog/mapping is unknown. |
| `backend\app\api\bundles-data\route.ts:27-32,48-54` | Storefront GET reads active `h2s_bundles`/`h2s_services`; exposes display catalog, not field publication/approval evidence or actual cost. |
| `backend\app\api\shop\route.ts:1165-1183` | Legacy storefront checkout maps cart item prices/quantities into Stripe line items. It is not the field quote catalog calculator; do not assume public display, cart estimate and field-approved total have been reconciled. This investigation establishes no live checkout parity. |
| `backend\tools\prepare_field_sales_catalog.cjs:9-10,34-55` | Proposed v2 and observed storefront can become **draft review artifacts only**, with unresolved scope/equipment/tax/market/validity questions. All generated offers are starting/qualification-gated. Do not run its default external-fetch path for this plan. |
| `backend\app\api\field-sales-catalog\route.ts:10-23,31-39,58-76`; `backend\migrations\048_field_sales_catalog_administration.sql:63-79` | Existing admin-only, separately gated catalog reads/publication. Published versions require current digest, explicit markets, validity and management evidence. Forecast reads must not invoke create/publish/retire. |
| `backend\lib\fieldQuote.ts:58-107,125-126`; `backend\migrations\044_field_sales_transactions.sql:204-225` | Server calculates package/per-unit/add-on prices, replaces upgrade equipment, validates scope/market and marks starting/missing prices for approval. Client price overrides are rejected; only published authorized quotes can become payable. Accepted quote snapshots, not today's catalog, control historical comparisons. |
| `backend\lib\fieldCommerce.ts:63-108`; `backend\migrations\046_field_sales_workflow.sql:184-214` | Exact checkout/quote/provider/mode identity and capture/refund verification; actual fees from Stripe balance transactions. Order facts sum captured minus refunded and fees across checkouts. `netPaidCents` is **customer collections after refunds, before fees**, not bank payout. |
| `backend\lib\fieldEarnings.ts:40-49,60-102`; `backend\migrations\047_field_sales_earnings.sql:210-264` | Approved-policy contract: inclusive tenure days 1–30 = 55%, 31–60 = 50%, 61+ = 45%; timezone and accepted/completed/qualified rate event are explicit. Basis is customer total less reviewed actual equipment/materials/provider fees, **not wages, reserve or overhead**. Negative basis goes to review, not a silent zero floor. |

## 3. Concrete disconnections in the current calculator

| Finding | Exact evidence and required treatment |
|---|---|
| Generic economics, no service mix/BOM | `frontend\dash.js:31607-31630` defaults to $300 AOV, 40% margin, 35% technician payout, $50 equipment/$10 overhead per job. Services are metadata, not quantities or versioned service/offer rows. Treat these as legacy hypothetical inputs. |
| Unsourced prices override other defaults | `frontend\dash.js:31804-31853,32524-32545`: unweighted saved-offer average, tracking AOV and hardcoded TV $300/camera $800/doorbell $400/bundle $1200 can set AOV. Equal averaging of named services is not volume-weighted mix or approved pricing. |
| Tracking is not a collected-cash ledger | `backend\app\api\v1\route.ts:8887-8910` reads `h2s_tracking_events` for offer performance; `backend\app\api\v1\route.ts:7647-7650,7680-7729` separately derives revenue from positive normalized order amounts. Neither is the verified field checkout/refund ledger. `frontend\dash.js:31858-31866` fetches revenue but does not calculate CPC from it. |
| VA hours are not installation throughput | `frontend\dash.js:31870-31900`: all-VA hours divided by 30 days, four assumed hours/job and technician count estimates jobs/tech/day. No service completion, assigned-tech or job-duration linkage is established. |
| Capacity target masquerades as sales forecast | `frontend\dash.js:32950-32973`: completed jobs equal capacity; revenue never depends on affordable demand. `cities`, `cpm` and editable `grossMargin` do not participate in this calculation. Volume cannot be forecast by service, supply scope or market. |
| Acquisition dimensions are inconsistent | `frontend\dash.js:32959-32988`: `cpc` is treated as CPL, CAC is per booking while “break-even CAC” divides contribution by leads. Click-to-lead rate is missing. Completion/cancellation rates need explicit non-overlapping definitions; zero rates/techs/workdays can cause invalid divisions. |
| UI payout claim and arithmetic disagree | `frontend\dash.js:33283-33287,33562-33565` claim fixed 35% of original price, but `frontend\dash.js:32969` applies editable `techPayoutPct` to current AOV. No original-price/discount distinction or representative commission exists. `backend\backfill-orders-payout.js:18-38` is a historical estimator with minimums/cap, not evidence of a current approved blanket 35% policy. |
| Costs/profit omit material facts and cash obligations | `frontend\dash.js:32968-32975`: only technician percentage, equipment/job, overhead/job and ads are deducted. No supplies, separate representative commissions, provider fee, travel/shipping/tax, reserve, payment timing, refunds or actual-cost completeness. “Net Profit” is not verified operating/net profit. |
| Scenario paths disagree | `frontend\dash.js:32571-32582` hardcodes 35%, omits cancellations and keeps capacity-driven jobs while conversion/CPC vary. `frontend\dash.js:32669-32713` has another evaluator with different modifiers. Scenarios must share one economic evaluator and explicit target-versus-demand mode. |
| Preset cost denominator is wrong for job economics | `frontend\dash.js:33575-33587` applies whole-offer customer revenue but divides total equipment cost by summed line quantities, then treats that as equipment/job. A two-device job can therefore understate costs. `||` also discards a valid zero cost. |
| Persistence is not source/version aware | `frontend\dash.js:31911-31954` restores arbitrary prior input fields without catalog/provenance validation. Separate-tab `frontend\dash.js:33628-33648` saves zero placeholders; `frontend\dash.js:33676-33682` only toasts/closes, without restoring calculator inputs. Do not represent these as reproducible saved forecasts. |
| Natural-language extraction is not approval | `frontend\dash.js:32038-32073` calls AI then regex fallback; `backend\app\api\v1\route.ts:11803-11867` is an extraction contract, not price/compensation authorization. Parsed values must remain reviewable hypothetical inputs, never catalog or actual evidence. |

## 4. Proposed incremental financial contract

### A. Volume, approved price and service mix

Introduce a versioned **forecast input snapshot** alongside existing capacity inputs:

1. Period/timezone, scenario ID, source/checked-at timestamp, completeness and provenance per field; catalog ID/version/digest/status and quote IDs where applicable.
2. Service/market/offer rows with **jobs**, units per job, package versus per-unit basis, TV size/quantity or camera type/count, installation-only versus supplied scope, approved add-ons/replacements, net price/discount and mix weight. One multi-service order is one job for capacity/cash, with multiple service lines for revenue/material allocation; do not double-count it.
3. Use current evidenced published catalogs for new-plan approved prices; immutable approved/accepted quote snapshots for actual booked work. Drafts/v1/v2/v5/custom prices belong in separately labeled comparison scenarios. Starting prices are a lower-bound illustration, never a fixed approved total.
4. Compute `plannedRevenue = sum(plannedJobs × approvedOrHypotheticalJobPrice)`; weighted AOV is revenue / distinct planned jobs. Counts, scope and mix must reconcile. Catalog availability does not prove demand.
5. Preserve **capacity-target mode** as “jobs/leads required to fill capacity.” Add **demand-constrained mode**: paid leads = spend / estimated CPL, or clicks = spend / CPC followed by a separately evidenced click-to-lead rate; add separately sourced organic/rep demand. Bookings → cancellations → completions must each have one explicit denominator. Bound completions by service-duration/market staffing capacity; unknown durations prevent a credible capacity fit. Changing budget/conversion in demand mode must change achievable sales.

### B. Equipment and materials

- **Customer-owned:** zero company acquisition cost only when verified; installation consumables, adapters, storage and compatibility may still cost money. **Company-supplied:** exact eligible SKU/kit, quantities and replacement options. **Company inventory already owned:** cash procurement this month may be zero, but consumed inventory cost is not automatically zero. Distinguish inventory consumption from cash purchasing.
- Store estimated BOM quantity/unit cost, assumption source/date and actual quantity/unit cost/invoice/reviewer separately. Include mounts/raceway, fasteners, camera storage/hub/power/weatherproofing, surveyed wired cabling/ports and travel/shipping/material tax as applicable. Never invent camera dependencies from a generic $50/job.
- Apply kit/hub/shared-trip costs once per job/system, not once per service line. Do not add combined incidentals to their already-covered supplies/travel. Track coverage explicitly.
- Missing required costs propagate null contribution and a list of missing inputs. A known partial subtotal can be displayed as such; it must not become a complete margin. Actual zero requires the contract's reviewed attestation.

### C. Representative commission, technician expense and profit

Maintain separate amounts and cash dates:

```text
R = job/customer revenue on the applicable approved basis
E, M, F = equipment, materials and provider fees on the same cost basis
approved rep basis = R - E - M - F
rep commission = approved basis × approved tenure rate, rounded per contract
job contribution = R - E - M - F - rep commission
                   - separately modeled technician expense - other direct costs
operating profit estimate = job contribution - advertising - period operating overhead
```

The approved commission calculation remains the backend's authority; forecast arithmetic is an estimate/reconciliation, not an earning entry. Do not deduct wages/reserve/overhead from the **approved rep basis**. Do not reapply material tax already included in actual equipment/material amounts. Separate paid technician expense from owner labor; owner-performed work does not justify inventing a cash wage, but optional economic owner-time valuation must be disclosed.

Keep contribution, operating profit estimate and actual result distinct. Insurance/software/rent/payroll burden/travel/accounting completeness and revenue-recognition policy require management/accounting evidence; absent that evidence, do not claim actual operating or net profit. A service reserve is retained/earmarked cash, not automatically a spent cost. The offline proposal's commission-after-5%-reserve formula is a different hypothetical policy, not the approved 55/50/45 contract.

Qualification requires completion **and** verified full payment without refund/dispute, actual-cost review, provider fees and evidenced start/policy (`backend\lib\fieldEarnings.ts:60-102`). Forecast pending liability, earned commission and settled cash separately. Friday scheduling depends on approved timezone/cutoff/holiday/method policy; exporting a run is not settlement (`backend\lib\fieldEarnings.ts:107-162`; `backend\app\api\field-sales-earnings\route.ts:12-21` explicitly initiates no external payment).

### D. 25/75 obligations and cash timing

For **enrolled field workflow only**, use immutable agreed total:

```text
depositCents = ceil(totalCents × 2500 / 10000)
agreedBalanceCents = totalCents - depositCents
verifiedCustomerCollections = sum(capturedCents - refundedCents)
currentOutstanding = totalCents - verifiedCustomerCollections
```

Enrollment stores that exact split (`backend\migrations\046_field_sales_workflow.sql:625-631`). Verified deposit is required for scheduling; balance collection is gated until completion, and then uses remaining actual net balance, not a second independently rounded 75% (`backend\migrations\046_field_sales_workflow.sql:466-468,1003-1035`). Legal acceptance/delivery/cancellation rules and refund/dispute holds still apply. Legacy non-enrolled checkout has its own approved policy; do not impose 25/75 on all historic storefront orders (`backend\migrations\044_field_sales_transactions.sql:240-258`; `backend\migrations\046_field_sales_workflow.sql:1003-1004`).

Report separately: proposed pipeline, accepted **booked value**, completed-work revenue estimate, deposit due/collected, post-completion balance due/collected, overdue/uncollected, refunds/disputes, provider fees, and cash available after dated procurement/tech/rep/overhead payments. Collections are not revenue recognition; booking is not collection; provider-net proceeds are not verified bank settlement. A checkout return URL/session alone is never collected cash (`backend\lib\fieldCommerce.ts:63-108`).

Estimate provider variable **and per-transaction fixed fees** with stated assumptions, including two transactions for deposit/balance; actual fees sum verified balance-transaction evidence. Unknown actual fees stay null. Bank payout timing/evidence and refund fee recovery remain unknown unless separately supplied.

**Synthetic acceptance fixture, not an approved offer:** $1,000 booked, $250 verified deposit, $750 balance outstanding. With estimated E=$200, M=$50, F=$30 and an explicitly assumed day-1 approved-policy-equivalent 55% rate, estimated rep basis=$720, commission=$396. Separate tech expense=$100 yields contribution=$224 before other direct/operating costs. Before completion/full payment/cost review, this is **not earned commission or actual profit**. $250 customer collections must not be reported as $1,000 cash or reduced to $220 without separately showing fee evidence/timing.

## 5. Exact future source changes — approval required

| Step | Proposed files and bounded change |
|---|---|
| 1 — normalization seam | Add `frontend\forecast-model.js` as a small pure normalization/mix/cash helper, not a replacement engine; add its load reference in `frontend\dash.html`. In `frontend\dash.js`, extend `adminForecastCalculator.inputs`, storage methods and `calculate()` to accept a versioned scenario snapshot. Preserve legacy capacity mode as explicitly hypothetical. Migrate old storage to `legacy_unverified`, retain user values, reject unknown/invalid fields and honor explicit zero/null. |
| 2 — one evaluator | In `frontend\dash.js` change `generateScenarios()`, `runScenarioAnalysis()`, preset adaptation and chart calculations to reuse the same evaluated snapshot. Stop hardcoded AOV/35% overrides; use whole-job costs and weighted mix. Validate rates/counts/money and return defined null/zero-denominator states. Label CPC/CPL/booking CAC/completed-job CAC correctly. |
| 3 — read-only sources | Add an authenticated read-only adapter in `frontend\forecast-model.js`, called by the calculator, using existing `/api/field-sales-catalog`, `/api/field-sales-transactions`, `/api/field-sales-workflow` and `/api/field-sales-earnings` GET contracts. Select exact versions/quotes; deduplicate lead/quote/order/job/checkouts and exclude test mode. Never call publication, quote approval, checkout, receipt, earning review or settlement commands for forecasting. Missing/disabled/unauthorized/truncated reads remain explicit unavailable sources, not zero totals. |
| 4 — conditional backend follow-up | Existing reads do not establish a complete period-wide forecast dataset: transaction GET accepts only `leadId` (`backend\app\api\field-sales-transactions\route.ts:12-19`), quotes are capped at 100 without pagination (`backend\migrations\044_field_sales_transactions.sql:152-154`), workflow GET accepts only `lead_id`/`quote_id` (`backend\app\api\field-sales-workflow\route.ts:13-21`), and earnings GET only representative/quote (`backend\app\api\field-sales-earnings\route.ts:12-16`). Prove completeness with bounded per-lead reads or separately approve a new admin-only `backend\app\api\forecast-data\route.ts` plus `backend\lib\forecastData.ts` read-only projection of existing authorities. Require explicit period/timezone, pagination/total/truncation, payment mode, source identity and snapshot completeness; no new pricing/payment/commission authority, mutations or migration assumed. Define its response schema and fixture coverage first. |
| 5 — result presentation | Update only calculator `renderInputs()`, `renderOutputs()`, `renderCharts()` and saved-scenario methods in `frontend\dash.js`: service/mix, price provenance, estimated-versus-actual cost columns, rep-versus-tech expense, booked-versus-collected amounts, contribution-versus-operating estimate, missing inputs and reproducible scenario restoration. Scope any later styles to this surface; obtain required design guidance before UI/CSS work. This document approves no UI implementation. |

Do not edit baseline/schema statuses to make proposals approved, bundle server-only CJS/fs loaders into the browser, overwrite sealed offers, activate v2, or change any compensation/payment policy. If comparison data is exposed later, use a separately versioned validated proposal snapshot; do not copy anonymous prices into dashboard constants.

## 6. Tests, gates and acceptance evidence

**Future focused tests:** add `backend\tests\forecast_model.test.cjs` for pure helper math and `backend\tests\forecast_integration.test.cjs` for calculator/GET adapter fixtures. If a read endpoint is approved, add `backend\tests\forecast_data.test.cjs`.

- Volume/mix/package-vs-unit math; mixed-service single-job dedup; market restrictions; starting/custom quote exclusion; discount and equipment replacement; no proposed-to-approved promotion; exact catalog/quote version/digest binding.
- Customer-owned versus supplied versus inventory-consumed equipment; shared kit/hub/travel allocation; explicit zero; unknown storage/material cost; cost-completeness propagation; whole-offer preset cost; no double tax or incidental allowance.
- Approved 55/50/45 day 30/31/60/61 boundaries, timezone/event policy, half-cent rounding, wages excluded from commission basis but deducted separately from contribution; negative actual basis remains review; missing approvals never yield payable amounts.
- One-cent/odd-cent 25/75 splits; deposit-only booked/collected distinction; completion before balance; duplicate receipts, refunds/disputes, unknown/zero actual fees, two transaction fixed-fee estimates; bank payout not inferred; earned/exported/settled distinctions.
- Capacity-target versus demand-constrained scenarios, zero rates/capacity, spend/CPC/CPL dimensional consistency, service-duration limits, consistent scenario/chart totals, versioned storage restore and stale source invalidation.
- GET-only access, admin/rep scope, test/live exclusion, pagination/truncation/error/disabled contracts; no forecast path can publish pricing or initiate any financial operation.

**Exact commands for the later implementation gate (repository root):**

```powershell
node --test .\backend\tests\forecast_model.test.cjs .\backend\tests\forecast_integration.test.cjs
node --test .\backend\tests\field_commerce.test.cjs .\backend\tests\field_workflow.test.cjs .\backend\tests\field_workflow_fees.test.cjs .\backend\tests\field_earnings_math.test.cjs .\backend\tests\field_earnings.test.cjs .\backend\tests\field_sales_catalog_admin.test.cjs
npm --prefix .\config\pricing run validate
npm --prefix .\config\pricing test
node --test .\config\pricing\offers\residential\tests\offers.test.cjs .\config\pricing\offers\residential\tests\tv-margin.test.cjs .\config\pricing\offers\residential\tests\launch.test.cjs
node --check .\frontend\forecast-model.js
node --check .\frontend\dash.js
```

First command/helper checks intentionally name **future** files; not runnable until approved implementation. Existing commands follow `config\pricing\package.json:6-11` and existing focused backend tests; `backend\package.json:16` alone runs only task-creator tests and is insufficient.

**Release gates:** management resolves catalog scope/price contradictions and approves published versions; procurement verifies SKU/BOM/cost evidence; accounting confirms tax/fees/overhead/revenue and inventory treatment; commission/legal/settlement policies and representative origin evidence are approved through existing controls. Then pass focused tests and authenticated fixture/browser checks for admin/rep isolation, stale/missing data and saved scenarios; demonstrate exact synthetic-fixture reconciliation; review diff to confirm unchanged pricing/policy/checkout authorities. Separate explicit authorization is still required for any backend implementation, activation or deployment.

**Validation of this Forecast investigation:** source-citation existence/ranges and document whitespace were checked locally. No Forecast implementation, provider calls or migrations were performed. Runtime/production correctness is deliberately not claimed. Separate UX implementation and regression results are documented in [the workflow refinement review](./WORKFLOW_REFINEMENT_REVIEW.md).
