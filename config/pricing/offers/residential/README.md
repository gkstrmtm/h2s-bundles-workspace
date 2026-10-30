# Residential offer development: offline only

This folder owns offer experiments, not catalog specifications, baseline pricing,
checkout or compensation policy. Nothing here is imported by live applications.
All scenarios remain `offline_proposal_pending_reconciliation_and_review` with
`activationAllowed: false`. An explicitly requested, validated offer-only commit
may be made on the development branch without staging concurrent camera work.
Shared camera dependencies still require separate reconciliation/review before
approval or any release. Nothing here authorizes push or deployment.

## Files and historical versions

- [v1-original.json](v1-original.json): original requested offer assumptions.
- [v2-margin-protected.json](v2-margin-protected.json): same TV prices; only the
  three/four-S220 offer prices increase by $50/$100. Its name is not a guarantee
  that any particular margin is protected.
- [v3-tv-margin-improvement.json](v3-tv-margin-improvement.json): proposed $199
  supplied-fixed-mount 56-65-inch tier, $378.10 for two and $547.25 for three.
- [v4-tv-219-experimental.json](v4-tv-219-experimental.json): **experimental, not
  approved**, $219 / $416.10 / $602.25 comparison using the same TV cost model.
- [v5-launch-proposed.json](v5-launch-proposed.json): handoff adaptation, parent
  v3, with combined camera incidentals, separate category invoice lines and both
  contribution floors. Committed for review on `retro-dev`; still **offline and
  unapproved**, with shared camera dependencies requiring separate reconciliation.
- [v1-original.sha256](v1-original.sha256) and
  [v2-margin-protected.sha256](v2-margin-protected.sha256): byte-level seals.
  New versions also have [v3](v3-tv-margin-improvement.sha256) and
  [v4](v4-tv-219-experimental.sha256) and [v5](v5-launch-proposed.sha256) seals. [Git attributes](.gitattributes)
  preserve v1/v2's original bytes without text conversion and keep newer
  checksum-protected JSON in LF form across Windows checkouts.
- [scenario.schema.json](scenario.schema.json): strict version, job, comparison,
  projection and review contracts.
- [engine.cjs](engine.cjs): reference validation, quotes, version creation,
  projections and append-only review records.
- [tv-financials.cjs](tv-financials.cjs): exact scoped TV arithmetic and monthly
  aggregation, without changing historical cent-rounded calculations.
- [offers.cjs](offers.cjs): CLI entry point.
- [tests/offers.test.cjs](tests/offers.test.cjs): isolated automated tests.
- [tests/tv-margin.test.cjs](tests/tv-margin.test.cjs): new tier, exact margins,
  scoped preservation and normalized comparisons.
- [launch.cjs](launch.cjs): optional v5 costing and order-level launch safeguards.
- [tests/launch.test.cjs](tests/launch.test.cjs): supplied handoff reconciliation,
  combined orders, actual camera consultations, floors and customer-copy checks.
- [handoff economics fixture](tests/fixtures/handoff-unit-economics.v1.json):
  unchanged supplied reference data, not a second pricing source.
- [customer price sheet](docs/customer-price-sheet-v5-draft.md): customer-safe,
  unpublished draft without internal economics.

Scenarios reference [baseline tiers](../../home2smart.v1.json), the
[equipment catalog](../../equipment.v1.json), [camera configuration](../../residential-cameras.v1.json)
and [camera recommendation algorithm](../../camera-recommendations.cjs).
They do **not** copy camera/mount specifications or modify shared files. The
baseline's semantic SHA-256 binds all 40 existing tiers. References use exact
equipment IDs and supplier product IDs.

Equipment **cost snapshots**, not product specifications, are frozen in each
offer: onn fixed mount `777842123` $24.88 and S220 `T8134121` $99.99. Current
catalog cost drift is flagged, never silently substituted into history.
Camera-recommender quotes instead use its current verified purchasing optimizer,
record source fingerprints and always require reconciliation. To preserve such
a result as business evidence, retain its output with the review/new experiment;
rerunning a linked camera consultation after catalog changes can change results.

### Price comparison

| Example | v1-original | v2-margin-protected | v3 proposed | v4 experimental |
| --- | ---: | ---: | ---: | ---: |
| One 56-65-inch TV, fixed mount included | $179.00 | $179.00 | $199.00 | $219.00 |
| Two such TVs | $340.10 | $340.10 | $378.10 | $416.10 |
| Three such TVs | $492.25 | $492.25 | $547.25 | $602.25 |
| Two S220 cameras | $499.00 | $499.00 | $499.00 | $499.00 |
| Three S220 cameras | $699.00 | $749.00 | $749.00 | $749.00 |
| Four S220 cameras | $899.00 | $999.00 | $999.00 | $999.00 |

These are experiment prices, **not replacements for baseline camera prices**.
The three-camera experiment has no invented baseline quantity reference.

## Commands

Run from the repository root in PowerShell; use the existing pricing package's
installed Ajv dependency. No new dependencies or package-manager changes:

```powershell
node .\config\pricing\offers\residential\offers.cjs validate
node .\config\pricing\offers\residential\offers.cjs compare
node --test .\config\pricing\offers\residential\tests\offers.test.cjs .\config\pricing\offers\residential\tests\tv-margin.test.cjs .\config\pricing\offers\residential\tests\launch.test.cjs
```

`compare` returns JSON grouped by example, with all sealed versions side by side,
including full direct-expense lines, missing costs, commissions and margin flags.
An optional final `--input <file.json>` accepts:

```json
{
  "commissionPercent": 55,
  "costOverrides": {
    "cameraSuppliesPerCamera": {"amount": 3, "notes": "TEST ONLY hypothetical supplies."},
    "solarChargingPerCamera": {"amount": 0, "notes": "TEST ONLY verified compatible supplies available."},
    "travelPerVisit": {"amount": 20, "notes": "TEST ONLY hypothetical travel expense."},
    "shippingPerVisit": {"amount": 0, "notes": "TEST ONLY verified free supplier shipping."}
  }
}
```

Save that input separately and run:

```powershell
node .\config\pricing\offers\residential\offers.cjs compare v1-original v2-margin-protected --input .\comparison-input.json
```

Change `commissionPercent` to 50, 55 or 60 for sensitivity analysis.
No scenario file is edited. Invalid input fails with a nonzero exit code.

## TV selection and automatic discounts

`quoteOffer(scenario, job, context?)` accepts `tvs` and `cameraPackageQuantity`:

```json
{
  "tvs": [
    {"inches": 60, "customerSuppliedMount": false, "compatibilityVerified": true},
    {"inches": 55, "customerSuppliedMount": true, "compatibilityVerified": true}
  ],
  "cameraPackageQuantity": 0
}
```

Each screen resolves its residential included-fixed-mount or installation-only
tier from the baseline. Customer-supplied mounts have no procurement charge,
but supplies and verified compatibility are still required.

Confirmed discount rule: sort TVs by highest base price first (input order
breaks ties), then apply **0%, 10%, 15%** to the first, second and third TV
respectively. Round each discount once, half-up, to cents. This reproduces
$179 + $161.10 + $152.15. Discounts apply only to TV revenue, not cameras.
Four-plus TVs, quote-only tiers, nonstandard/unknown compatibility, or an included
mount outside catalog size bounds require a custom quote. Size alone never
establishes VESA/weight/wall compatibility. Do not invent further discounts.

### Scoped TV margin improvement and exact precision

The new versions override only the **referenced residential 56-65-inch,
Home2Smart-supplied fixed-mount tier**, inside their scenario JSON. The shared
$179 baseline and all 40 tiers remain unchanged. Other sizes and customer-supplied
mount prices are not overridden. Mixed jobs still use the same marginal
highest-price-first pricing rule, with only the matching tier's base price changed.

In v3/v4, only TV-only jobs consisting entirely of matching 56-65-inch supplied-mount
installations use the new explicit cost model:

- Combined equipment and supplies: **$42.84 per installed TV**. This is a modeled
  total, not a new mount procurement price; the catalog and its snapshots remain
  intact. Do not also add the old mount cost or $3 supplies allowance.
- Estimated 8% tax on that combined total, 3% payment processing and 5% service
  reserve on customer revenue, then 55% commission on positive contribution.
- **$10 once per job**, replacing separate modeled TV travel/shipping deductions,
  as explicitly confirmed. Actual coverage must be reviewed; it is not a promise
  that real travel or freight is free. No owner installation labor is deducted.
- Other sizes, customer mounts, camera-only and mixed TV/camera jobs retain the
  previous costing path, including any unknown cost flags.
- Four-plus TVs require a custom quote, never an extrapolated discount.

Use `tvCostOverrides` with documented `{amount, notes}` values for
`equipmentAndSuppliesPerTv` or `additionalJobAllowance` when testing alternatives.
Unknown amounts remain null. Conflicting legacy supplies/travel/shipping overrides
are rejected for these jobs instead of silently discarded or double charged.

The exact path uses BigInt fixed-point amounts with 14 decimal places, sufficient
to represent input cents, percentage expenses, commission and reinvestment
**without any intermediate rounding**. If an operation exceeds that precision,
it fails explicitly. Only output displays round to two decimals.
`exactFinancials` and expense/revenue-line `exactAmount` strings expose the raw
amounts; displayed line totals may differ by a cent from their displayed sum.
Margin thresholds use raw values, not displayed percentages.
v1/v2 and all nonmatching jobs keep their existing cent-rounded behavior.

Monthly projections multiply exact job amounts, not their displayed cents, and
subtract overhead before calculating reinvestment. Actual owner allocations are
cent-denominated: after the exact model is complete, allocate rounded available
cash less rounded reinvestment, then distribute residual cents equally in owner
slot order. Raw reinvestment and raw owner-pool amounts are retained separately.

To compare old/new prices fairly, supply this comparison input:

```json
{"tvCostModelFrom": "v3-tv-margin-improvement"}
```

```powershell
node .\config\pricing\offers\residential\offers.cjs compare v2-margin-protected v3-tv-margin-improvement v4-tv-219-experimental --input .\tv-comparison-input.json
```

Normalization borrows only the explicit TV cost model for the TV examples;
each version keeps its prices and financial rates. Output labels
`comparisonCostBasis` as normalized and historical scenarios are not changed.
Camera examples are never normalized. Without normalization, original TV
versions retain their genuinely unknown travel/shipping costs and null margins.

| TVs | Old $179 company / margin, normalized | v3 $199 company / margin | v4 $219 company / margin |
| --- | --- | --- | --- |
| 1 | $48.79 / 27.25% | **$57.07 / 28.68%** | $65.35 / 29.84% |
| 2 | $94.66 / 27.83% | **$110.39 / 29.20%** | $126.12 / 30.31% |
| 3 | $136.83 / 27.80% | **$159.60 / 29.16%** | $182.37 / 30.28% |

These are modeled contributions before monthly overhead, not approved/net-profit
claims. All exceed the exact 18% minimum at the initial 55% commission; 50% and
60% sensitivity scenarios remain supported. For example, v3 one-TV raw company
contribution is `57.06576`, not a result derived from rounded taxes or commissions.

## Cameras and custom configurations

Without a consultation, `cameraPackageQuantity: 2`, `3` or `4` models the S220
offer using frozen camera costs. Site suitability is explicitly **not surveyed**;
solar, Wi-Fi, mounting and installation still require review.

To use the existing recommender, add `cameraConsultation` following its
[consultation schema](../../recommendations.schema.json). Its location count must
match a nonzero `cameraPackageQuantity`; zero permits deriving the quantity from
the consultation. Supply complete site facts; unknown sunlight/power/connectivity
is never converted to compatibility. Requirements/features/storage are delegated
to the existing algorithm, not reimplemented here.

- If all selected models are S220 at a supported quantity, use that version's
  experiment price.
- E40 premium/mixed/other models retain the algorithm's **proposed** price and
  procurement combination, with a mandatory custom-quote flag. HB2 and S380 are
  not substituted by the offer engine.
- Unresolved equipment/material requirements keep costs incomplete.
- The adapter uses only the algorithm's equipment and material lines. Its own
  tax/fee/commission results are not imported; offer financials are recomputed
  once using the offer assumptions, avoiding double charges.
- Camera consumables and initial-charging allowances map to the corresponding
  material IDs only when the consultation has not explicitly supplied those
  costs. They are not added a second time.
- A documented `customPrice: {amount, notes}` can model a manually proposed total,
  including a combined TV/camera visit. It never approves the scope or replaces
  missing equipment costs. Unsupported quantities never interpolate a price.

Every quote is comparison-only, requires review and records baseline, catalog,
camera-configuration and camera-algorithm fingerprints.

## Financial definitions

Initial explicit assumptions:

- Equipment: frozen costs above, or current linked camera procurement.
- Materials tax: **8% estimated**, on equipment plus supplies/accessories.
  Travel and shipping are modeled as nontaxable; confirm local taxability,
  shipping taxes and any service-tax obligations before approval.
- Processing: **3% of customer revenue**.
- Service reserve: **5% of customer revenue**, before commission. This is a
  modeled retained allocation, not an actual procurement outflow. It is already
  excluded from the following contribution; do not deduct it again.
- TV supplies: existing **$3 per TV** estimate, not a camera allowance.
- Camera supplies, solar initial-charging extras, travel per visit and shipping
  per visit: **unknown (`null`)** until documented.
- Commission: **55% initial**, with supported 50/55/60% scenarios, never an
  approved compensation policy.
- Monthly overhead: separately entered, unknown by default.
- **No owner installation labor or technician payroll deduction.**

```text
direct expenses = equipment + supplies/accessories + estimated materials tax
                  + travel + shipping + processing + service reserve
contribution before commission = revenue - direct expenses
commission = max(0, contribution before commission) * scenario commission %
company contribution = contribution before commission - commission
company contribution margin = company contribution / revenue * 100
```

The legacy path uses safe integer cents and half-up percentage rounding.
The scoped v3/v4 TV path uses exact arithmetic as documented above.
Retain losses; do not pay
negative commissions. Zero revenue has an undefined/null margin and a review
flag. The 18% threshold is checked against unrounded ratios, not displayed
two-decimal percentages. Exactly 18% passes.

Missing required costs make direct expenses, commission, company contribution
and margin **null**, with `missing_costs` and explicit missing-cost IDs.
`knownDirectExpenses` is only a subtotal, not a completed expense estimate.
An undefined customer price also prevents finalized contributions.
Every offer below the threshold is flagged; the name "margin-protected" cannot
override this test.

### Reproducible illustrative comparison, not adopted assumptions

Using the test-only input above ($3 supplies/camera, $0 verified available
charging supplies, $20 travel, $0 verified shipping), the 55% scenario gives:

| S220 quantity | v1 direct expenses | v1 company / margin | v2 direct expenses | v2 company / margin |
| --- | ---: | --- | ---: | --- |
| 2 | $282.38 | $97.48 / 19.54% | $282.38 | $97.48 / 19.54% |
| 3 | $409.61 | $130.23 / 18.63% | $413.61 | $150.93 / 20.15% |
| 4 | $536.84 | $162.97 / 18.13% | $544.84 | $204.37 / 20.46% |

These figures exclude separately entered monthly overhead. At **60% commission**,
all v1 camera examples fall below 18%; v2 two/three-camera examples also fall
below 18%, while v2 four-camera reaches 18.18%. Actual defaults remain incomplete;
do not present the illustrative figures as approved margins.

## v5 launch handoff reconciliation

The source is `Home2Smart_Offers_Agent_Handoff.zip`, SHA-256
`34623cd9ac08803873cc925e9852933dedd77f1c7ebb1f62266dba7014cf306a`.
Its standalone launch JSON was adapted into a new sealed child of v3, not copied
over an earlier version. Only its economics fixture was imported unchanged.
No shared camera/pricing files, live offers or compensation settings were edited.

V5 keeps v3 TV prices and $499/$749/$999 S220 prices. Its $42.84 TV material
assumption explicitly reconciles catalog references: $24.88 fixed mount +
$14.96 external raceway kit + $3 consumables. Standard run length and wall/mount
compatibility must be verified; additional raceway or unusual scope needs a
custom quote. Catalog specifications are not duplicated.

| Reference offer | Customer price | Materials | Incidentals | Company contribution | Margin |
| --- | ---: | ---: | ---: | ---: | ---: |
| One standard TV | $199.00 | $42.84 | $10 | $57.07 | 28.68% |
| Two standard TVs | $378.10 | $85.68 | $10 | $110.39 | 29.20% |
| Three standard TVs | $547.25 | $128.52 | $10 | $159.60 | 29.16% |
| Two S220 cameras | $499 | $199.98 | $25 | $98.15 | 19.67% |
| Three S220 cameras | $749 | $299.97 | $30 | $150.80 | 20.13% |
| Four S220 cameras | $999 | $399.96 | $35 | $203.46 | 20.37% |

These are full-precision reference calculations before monthly overhead, using
8% taxable-materials allowance, 3% processing, 5% reserve and 55% commission.
Incidentals are modeled non-taxable combined job allowances; local tax treatment
and actual supplies/travel/freight coverage still need verification. Every example
requires review; complete planning arithmetic is not site approval.

V5 uses the exact TV materials model for matching TV-only **and combined**
TV/camera orders. Other TV sizes/customer mounts retain their previous pricing
and costing path. Combined orders have separate TV and camera invoice lines,
zero cross-category discount, and one invoice-level tax/processing/reserve and
commission calculation. By explicit confirmation, default combined incidentals
conservatively **add** $10 TV allowance to $25/$30/$35 camera allowance; shared
travel savings are not assumed. A documented job `incidentalAllowance` replaces
that combined amount (or the sole category allowance). `null` stays incomplete.
Legacy `costOverrides`/`tvCostOverrides` cannot be mixed into this launch model;
use explicit consultation material costs, `incidentalAllowance` or a new version.
Launch-specific inputs fail explicitly outside supported launch-model TV scope.

With `cameraConsultation`, equipment comes from the existing location-based
recommender and verified procurement optimizer, not a forced S220 package.
Ordinary required camera materials stay unknown unless itemized or explicitly
verified covered by incidentals:

```json
{
  "allowanceCoverage": {
    "verified": true,
    "notes": "Document actual ordinary consumables and initial charging coverage."
  }
}
```

This field requires an actual consultation. It covers only `camera_consumables`
and `solar_initial_charging_materials`, rejects double-counted nonzero costs and
does not clear unknown cards, hub setup, wiring, mounting or other site costs.
Solar exposure, Wi-Fi, coverage and compatibility still require independent
verification. Premium/mixed equipment uses actual compatible purchasing costs
and needs a documented custom incidental allowance and reviewed price.
HB2/S380 are not interchangeable. The disabled E40 $649/$999/$1,299 candidates
are experiments, never automatic launch prices.

One-camera equipment-inclusive work retains the canonical $299 starting price;
installation-only retains $129/$229/$399 for 1/2/4 cameras, with unknown materials
and custom-quote requirements. Three-camera installations are fully supported;
only two/four-camera S220 packages are marked advertised in the draft metadata.

Both **18% margin and $30 company contribution per completed order** must pass.
Use unrounded figures, not rounded displays; unknown costs/price yield incomplete
results and a custom-quote/manual-review flag. Commission sensitivity 50/55/60%
remains illustrative. At 60%, the two-S220 offer fails the percentage floor.
`serviceReserveHeld` and `companyRetainedIncludingReserve` distinguish company-owned
reserve from expense cash outflow. Reserve is unavailable for routine owner
distribution; do not deduct it twice or count it as distributable contribution.
No installation labor/payroll is deducted.

The supplied 100-order mix yields displayed AOV $330.94 and average contribution
$90.52. Its $11,767.26 contribution at 130 hypothetical orders is reproducible
only by rounding each job's contribution first. The retained full-precision
weighted expectation is **$11,767.05**. Existing whole-visit apportionment at 130
orders instead gives counts **65/36/16/10/3** and **$11,828.86**, not fractional
jobs. The fixture intentionally preserves the source discrepancy. Conversion
and volume targets are unverified assumptions, not sales performance claims.
Actual overhead remains separately required before any owner allocation.

Future move-in bundles, the $219 TV comparison, E40 price tests and commission
variations remain explicitly disabled. No campaign, price sheet or offer is
approved, published or activated.

## Monthly volume, sales mix and owner allocations

`projectMonth(scenario, input, context?)`, or:

```powershell
node .\config\pricing\offers\residential\offers.cjs project v1-original v2-margin-protected --input .\monthly-input.json
```

Projection input example (costs intentionally remain unknown unless supplied):

```json
{
  "monthlyVolume": 30,
  "salesMix": [
    {"id": "two-camera", "percent": 50, "job": {"tvs": [], "cameraPackageQuantity": 2}},
    {"id": "four-camera", "percent": 50, "job": {"tvs": [], "cameraPackageQuantity": 4}}
  ],
  "overhead": {"amount": null, "notes": "Enter monthly operating overhead separately."}
}
```

Mix percentages must sum to 100. Whole visits are allocated using largest
remainders; ties follow mix order, and counts always total monthly volume.
Legacy job-level rounded expenses/commissions are multiplied by actual visit counts.
When an active job uses exact TV or launch financials, its raw amounts are aggregated and
legacy camera/other job cents remain unchanged.
Zero-weight/zero-volume jobs do not add expenses or missing costs.
Add `costOverrides` and `commissionPercent` to individual jobs to test different
cost/commission assumptions.

```text
post-overhead amount = monthly company contribution - entered monthly overhead
reinvestment = 25% of max(0, post-overhead amount)
owner pool = max(0, post-overhead amount) - reinvestment
each owner's allocation = owner pool / 3
```

Reserve has already been deducted. Owner slots 1/2/3 are equal except unavoidable
cent rounding: residual cents go to the first slots in order. Their sum exactly
matches the 75% owner pool. A post-overhead loss is retained with zero
reinvestment/distributions. Missing overhead or active-job costs makes downstream
allocations null; zero overhead must be explicitly documented.

## New experiments and review workflow

Do not edit or reseal historical JSON. Checksums are integrity checks and
create-only commands, not filesystem access control or protection against a
person deliberately editing both files. The tests additionally pin the original
four historical checksums.

Create a patch JSON, for example:

```json
{
  "id": "v6-travel-tested",
  "parentVersion": "v2-margin-protected",
  "createdDate": "2026-10-30",
  "assumptions": {
    "allowances": {"travelPerVisit": {"amount": 20, "notes": "Proposed test travel allowance; verify."}}
  },
  "changeNotes": "New experiment with an explicit proposed travel assumption."
}
```

```powershell
node .\config\pricing\offers\residential\offers.cjs create v2-margin-protected .\new-experiment.json
```

Objects merge recursively; arrays replace in full. Creation validates before
writing, requires a new increasing version number and explicit parent, and uses
exclusive writes. Existing versions/numbers cannot be overwritten. Files without
matching seals fail validation. If a filesystem failure interrupts creation,
the command fails explicitly; investigate the incomplete new version rather than
resealing existing history.

After costs, scope and concurrent camera work are reconciled and reviewed,
record a **separate** review using `offers.cjs review <review.json>`.
The [review contract](scenario.schema.json) requires:

- New review ID, scenario ID and exact scenario-byte SHA-256.
- Current `sourceFingerprints` (available in quote output).
- `decision`: `approved_for_offline_planning`, `changes_requested` or `rejected`.
- `cameraWorkReconciled`, real review date, reviewer role and notes.
- `activationAllowed: false`, always.

Approval is rejected without reconciliation or with stale source fingerprints.
Review records and seals are created exclusively under `reviews/`; no scenario
is rewritten. Future source changes leave historical reviews intact but validation
marks them stale for current use and requires a new review. An offline-planning
approval **never activates** pricing, checkout or commissions and does not
authorize commit/push/deployment. No approval records are created by this task.
