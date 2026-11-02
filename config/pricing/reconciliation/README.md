# Proposed pricing reconciliation

[Canonical v2](../home2smart.v2.json) is the **recommended offline source of
truth**, not an approved/live feed. No application imports it. All effective
dates remain null, activation is forbidden, and quotes cannot be bookable.
Original [40-tier v1](../home2smart.v1.json), the equipment catalog, camera
selection definitions and sealed residential offers v1-v5 remain unchanged.
Future approved changes must create a new version, not rewrite these sources.

## Evidence and commands

- [Complete comparison/economics report](REPORT-2026-11-02.md): all 66 PDF rows,
  70 proposed tiers, public-price contradictions, source scopes, expense lines,
  reserves, commission scenarios, inflation/material/travel/payroll sensitivity,
  exact omissions and publishing blockers.
- [Original PDF](source/Home2Smart_Complete_Service_Pricing.pdf) and
  [faithful transcription](source/pdf-pricing.v1.json): primary Discord download
  returned HTTP 200 and matched the supplied local PDF, SHA-256
  `f7c8e510f69421949cd6e89279d215aefbceff66eabc36a5f377b6c8fbb05edd`.
- [Observed public prices](source/published-pricing.v1.json): read-only site/API
  observations, kept separate from local checkout candidates.
- [Supplier verification](equipment-verification.v1.json): exact-SKU observations
  checked 2026-11-02, preserved planning costs, conservative model costs and a
  **linked proposed** E50 kit. No existing product record is overwritten.
- [Schema](schema.v1.json), [engine](reconcile.cjs), [tests](reconcile.test.cjs)
  and [comparison command](report.cjs).

From the repository root:

```powershell
npm --prefix .\config\pricing run validate
npm --prefix .\config\pricing test
node .\config\pricing\reconciliation\report.cjs validate
node .\config\pricing\reconciliation\report.cjs compare
node .\config\pricing\reconciliation\report.cjs json
node .\config\pricing\reconciliation\report.cjs write
node --test .\config\pricing\offers\residential\tests\offers.test.cjs .\config\pricing\offers\residential\tests\tv-margin.test.cjs .\config\pricing\offers\residential\tests\launch.test.cjs
```

`write` regenerates the report for this proposal, never pricing/history.
`json` returns complete machine-readable comparisons and financials.
No Python/PDF dependency is required to validate the archived source or run
quotes; PDF extraction was an isolated research step.

## Offline quote contracts

```js
const { loadContext, quoteTier, quoteTvs, recommendQuote } = require('./reconcile.cjs');
const context = loadContext();
const estimate = quoteTier(context, 'cameras', 'residentialEquipmentIncluded', { quantity: 2 });
const tvEstimate = quoteTvs(context, [
  { inches: 60, customerSuppliedMount: false, compatibilityVerified: true },
  { inches: 60, customerSuppliedMount: false, compatibilityVerified: true },
]);
// consultation uses the unchanged recommendations.schema.json consultation contract.
const recommendation = recommendQuote(context, consultation);
```

- `quoteTier` is a **financial scenario**, not a substitute for a site survey.
  Size-based tiers require `inches`; quantity tiers require `quantity`. Unknown
  quantities produce an explicit custom quote, never padding/interpolation.
  Commercial TV bundles require `sameLocation: true` and exact `tvSizes`, all
  at most 65 inches. There is no commercial supplied-bracket selling tier.
- `quoteTvs` applies 0/10/15% **marginal** discounts highest-price-first, including
  mixed sizes/customer brackets. Four-plus, under-32-inch supplied-fixed mounts
  and 86-plus screens are custom quote. One trip budget per job.
  `mountUpgradeId` per TV (or tier-quote option) selects the exact proposed tilt
  or large-motion SKU at +$25/+$75, replacing the fixed mount cost. Upgrade
  prices are not discounted with installation. Supplier size limits are checked;
  unpriced small-motion or incompatible mounts remain custom quote.
- `recommendQuote` reuses the six-model suitability and compatible purchasing
  algorithm. S220-only selections use canonical S220 quantities; E40-only
  selections use the new premium tier. Other/mixed models remain custom quote.
  Alternatives get the SAME reconciled pricing, never stale generic margins.
  Unknown sun/Wi-Fi/power/mounting is not assumed suitable. MicroSD and HomeBase
  requirements remain model-specific; S380 reference is not procurement eligible.
- Documented `materialCosts: {id: {amount, notes}}`, `travelAllowance`,
  `extraMaterials`, `sellingPrice`, and `materialsTax: {percent, notes}` can model
  reviewed changes. Null costs propagate incompleteness. Zero requires explicit
  evidence, e.g. verified included/available charging supply. Consultation tax
  and shipping inputs are preserved, not silently ignored or counted as free.
- `equipmentIncreasePercent` and `commissionPercent: 50|55|60` are scenarios.
  `technicianCash: {amount, notes}` or
  `technicianOrderScenario: {percent, notes}` is entered separately, never both.
  No owner labor deduction. No payroll/commission application code changes.
- `actualProfit` always remains null. `modeledCompanyRetained` is after 5% held
  reserve and the illustrative rep commission. Paid-technician cash is separately
  deducted in `companyRetainedAfterTechnician`; gross and cash totals also show
  that impact. Reserve is not classified as cash spent; overhead is excluded.
- Exact arithmetic rounds only for display. Both **18% retained margin and $30**
  floors apply after any paid-technician input. Missing costs, insufficient
  dollars/margin, incompatible equipment and unpriced scope require review/custom
  quote. `minimumPriceForFloors` is an unrounded-threshold cent search, not a
  published price or approval. Under some stacked payout policies no price works.

## Why the recommended prices differ

Two S220s remain **from $599**, not the unapproved $499 experiment. With the new
explicit $20 supplementary-material budget plus separate $25 trip budget, $499
retains only **17.72%** after reserve/55% scenario; $599 retains **21.67%**.
Historical v5's $499/19.67% used a **combined** $25 incidental allowance that may
already cover supplies. Do not double count that allowance or silently claim
the two cost scopes are equal.

56-65-inch supplied-fixed TVs remain $199/$378.10/$547.25. Using PDF $10/TV
supplies instead of legacy $3, one $24.88 mount and $14.96 raceway kit now cost
$49.84/TV before tax; retained estimates are $53.66/$103.59/$149.39.
The higher $219 experiment is not automatically selected.

The proposed E50 from $3,299 is an explicitly **different premium procurement
model** from the PDF's unnamed $800 kit: exact E7100121 is $1,199.99. Cables,
ports/power and fasteners still need a surveyed BOM; 8/16-camera equipment costs
remain unknown. E40 premium prices remain quote-required until hub supplies,
compatibility and actual margin are verified.

Scope/eligibility, itemized material quantities, tax/payment/travel assumptions,
reserve/rep policy and actual technician compensation all require management
approval. A 55% rep scenario plus 35%-of-revenue technician payout cannot satisfy
18% retained margin at **any** selling price. The backfill payout is evidence,
not a newly approved policy. No deployment or public-price migration is included.

## Commit scope

Only these 34 pricing files belong to this reconciliation commit. Unrelated
frontend/backend, flyer-tracking, deployment and application changes stay out.

New deliverables:

- [pricing attributes](../.gitattributes)
- [recommended canonical v2](../home2smart.v2.json)
- [this README](README.md)
- [complete report](REPORT-2026-11-02.md)
- [equipment verification](equipment-verification.v1.json)
- [reconciliation engine](reconcile.cjs)
- [reconciliation tests](reconcile.test.cjs)
- [report generator](report.cjs)
- [reconciliation schema](schema.v1.json)
- [original PDF](source/Home2Smart_Complete_Service_Pricing.pdf)
- [PDF transcription](source/pdf-pricing.v1.json)
- [published snapshot](source/published-pricing.v1.json)

Previously untracked shared dependencies, now preserved and included so the
development-branch checkout can validate and quote without missing references:

- [original comparison](../COMPARISON.md)
- [pricing README](../README.md), with the new v2 pointer
- [baseline schema](../baseline.schema.json)
- [camera recommendation engine](../camera-recommendations.cjs)
- [equipment schema](../equipment.schema.json)
- [original equipment catalog](../equipment.v1.json)
- [original canonical baseline](../home2smart.v1.json)
- [lockfile](../package-lock.json)
- [pricing package](../package.json), with reconciliation commands/tests
- [original pricing helpers](../pricing.cjs)
- [promotion schema](../promotions.schema.json)
- [inactive promotion](../promotions/experiments.v1.json)
- [recommendation schema](../recommendations.schema.json)
- [camera schema](../residential-cameras.schema.json)
- [original camera configuration](../residential-cameras.v1.json)
- [original handoff](../source/AGENT_HANDOFF.v1.md)
- [original received pricing](../source/pricing.v1.json)
- [camera tests](../tests/cameras.test.cjs)
- [baseline tests](../tests/pricing.test.cjs)
- [recommendation tests](../tests/recommendations.test.cjs)
- [default validator](../validate.cjs), with linked v2 validation

The only previously tracked changed file is the
[offer-development README](../offers/residential/README.md), linking this
reconciliation. Existing scenario JSON, seals and offer engines are unchanged.

Validation on 2026-11-02: pricing/schema validation passed; **308 pricing tests**
(266 existing + 42 reconciliation) and **79 historical offer tests** passed,
**387 total, zero failures**. Generated report equality is tested. Original
source bytes and all historical scenario seals are preserved. No application
build/deployment or production writes were performed.
