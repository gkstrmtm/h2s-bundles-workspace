# Home2Smart pricing: proposed reference and internal planning

## Current recommended reconciliation

[Home2Smart v2](home2smart.v2.json) is the new **pending, offline recommended
matrix**, not live pricing. See the [reconciliation workspace](reconciliation/README.md)
and [complete 70-tier report](reconciliation/REPORT-2026-11-02.md) for PDF versus
v1 versus published prices, equipment, estimated economics and review blockers.
The original 40-tier v1, catalog and camera definitions below are preserved as
historical/reference inputs; v2 does not activate or rewrite them.

Default `npm run validate` now checks both original inputs and v2. `npm test`
includes reconciliation tests; `npm run compare` prints the complete report.
Shared catalog/selection dependencies make the development-branch checkout
self-contained. The internal administrator forecast now consumes V2 through the
[linked business profile](forecast-business.v1.json) and a validated build-time
snapshot; website/Stripe/checkout and actual compensation policy are unchanged.

This is a version-controlled **business proposal**, not an approved or deployed
price feed. Status remains `proposed_baseline_pending_approval`; `effectiveDate`
remains `null`. The administrator-only planning API uses V2 automatically; no
public website, database pricing activation or live checkout imports it.
Do not serve supplier-cost scenarios to public pages.

### Internal forecasting contract

[forecast-business.v1.json](forecast-business.v1.json) is the human-editable
planning entry point. It links V2 instead of duplicating its prices, equipment,
cost lines, tax, processing, reserve and retained-margin floors. It also records
the existing 25%/75% payment structure and native commission/Friday-review
reference separately from V2's modeled commission-after-reserve assumption.
No reference in this file approves or changes actual compensation.

`npm --prefix backend run package:forecast` (from the repository root) validates
V2 and its archived evidence and derives all 70 base-tier financials with the
existing exact-money engine. Install/build regenerate the ignored runtime
snapshot; invalid/missing sources fail instead of loading historical prices.
The authenticated forecast returns source hashes and a digest.
Calculation works without AI, research, a published catalog or financial
context pasted into a prompt. AI interprets operating intent; the server always
rehydrates exact scope IDs and protected economics.

Default owner-operated scenarios do not impute wages. Explicit paid-crew costs
remain separate, and retained floors are rechecked with those costs.
Reserve is company-held money, not a cash expense: estimated operating profit
and spendable funds after reserve are distinct. Per-job floors do not guarantee
monthly profit after advertising/overhead. Unknown costs stay unknown and
starting/custom scopes remain nonbinding.

Selectors cover base tiers, not mount-upgrade combinations, mixed camera
models or discounted multi-TV quotes; those need reviewed custom quotes.
Switching to an editable custom hypothesis is explicit and loses V2
safeguards. Unlinked historical saved scenarios are rejected rather than
silently treated as current V2.

## Files and source mapping

- [Original pricing](source/pricing.v1.json) and
  [original handoff](source/AGENT_HANDOFF.v1.md): complete attachments, archived
  byte-for-byte and checked against the received files with SHA-256.
- [Baseline](home2smart.v1.json): all original fields and values **except**
  `offers`, which is extracted to keep temporary promotions outside the standard
  pricing definition. All 40 rows, group names, costs, formulas and flags remain
  unchanged. The source-preservation test checks this entire mapping.
- [Experimental overlay](promotions/experiments.v1.json):
  `offers.newHomeSetupBundleDiscount: 50` becomes the
  `new_home_setup_bundle_discount` fixed-dollar offer. Its original
  `proposed_not_active` status is preserved. Eligibility is explicitly unknown
  (`null`), not "all customers." Baseline version and USD currency must match.
- [Baseline schema](baseline.schema.json) and
  [promotion schema](promotions.schema.json): strict structure, known markets,
  groups and service scope. Unknown fields and attempts to activate this proposal
  fail validation. Schema IDs are identifiers, not published endpoints.
- [Offline helpers](pricing.cjs), [validator](validate.cjs),
  [tests](tests/pricing.test.cjs), and isolated package/lockfile: Ajv remains a
  build-time pricing dependency, not a browser/runtime pricing dependency.
- [Comparison and connection plan](COMPARISON.md): local implementation evidence,
  unresolved decisions and proposed future adapters.
- [Linked equipment catalog](equipment.v1.json) and
  [equipment schema](equipment.schema.json): proposed supplier SKUs, editable
  planning costs, estimated consumables and inactive customer upgrades. The
  catalog links back to the baseline by file/version; the baseline JSON and its
  strict schema remain unchanged.
- [Residential camera standard](residential-cameras.v1.json) and
  [camera configuration schema](residential-cameras.schema.json): linked
  selection rules, separately costed accessories and six inactive package drafts.
  Camera records live in the same equipment catalog under optional `cameraItems`;
  the original `items`, TV allowances and upgrades are unchanged. Legacy catalog
  JSON without either camera field still validates.

## Proposed equipment supplement: checked 2026-10-30

All items, allowances and upgrades remain `proposed_pending_approval`, with no
effective date. Linked base equipment costs now inform internal forecasting,
not checkout. These entries are not an approved SKU
allowlist. No checkout, commissions or baseline tier definitions change.

| Supplier item | Planning cost (USD) | Observed retail (USD) |
| --- | ---: | ---: |
| onn fixed 32-86 inches, Walmart `777842123` | 24.88 | 24.88 |
| onn tilt 50-86 inches, Walmart `299960224` | 25.24 | 25.24 |
| onn full-motion 50-86 inches, Walmart `866844895` | 54.00 | 44.94 |
| onn full-motion 19-50 inches, Walmart `990431788` | 26.96 | 26.96 |
| Wire Trak raceway kit, Walmart `342180027` | 14.96 | 14.96 |

Supplier product URLs and the price-check date are stored per item. The large
full-motion listing shows a rollback from $54.00; its proposed planning cost
deliberately stays $54.00. The smaller variant is confirmed as item `990431788`,
not the large mount's "options from" price. Wire Trak is a complete kit with
54 total inches of raceway, not one 54-inch piece or a price per fitting.
Retail observations are snapshots, not guaranteed quotes; sales tax and shipping
are excluded from planning costs.

Physical dimensions, wall-distance ranges, TV size/weight limits, stud spacing
and VESA bounds are recorded where supported by the supplier page. Unknown
values stay `null`. Compatibility highlights are supplier AI-generated summaries,
not manufacturer-manual verification. Exact VESA patterns remain unknown;
minimum/maximum envelopes do not imply every intermediate pattern fits.
Every item requires manual compatibility verification before selection.

Extra consumables are an editable **estimated $3 per TV**, separate from mount
and optional raceway costs. No automatic raceway quantity or customer surcharge
is defined. Proposed customer upgrade amounts are **tilt +$20** and
**large full-motion +$65**, with explicit equipment/replacement references.
`baselinePriceGroup: null` means market and base-package applicability remain
unapproved. No small full-motion customer price is invented. A future explicit
price-group reference may only identify the fixed-mount-inclusive residential
group, not installation-only or camera prices. Screen-size limits still apply;
the fixed mount does not cover TVs below 32 inches, the tilt/large full-motion
mounts do not cover TVs below 50 inches, and 86+ inches still require a quote.

The offline validator checks unique IDs, supplier item/URL agreement, real
calendar dates, safe cent amounts, compatibility bounds and upgrade equipment/
baseline references without computing or applying customer totals. Editing
`costAssumption.amount` never changes the supplier observation or baseline.

## Proposed residential Eufy standard: checked 2026-10-30

The equipment catalog records official single-camera SKUs separately from
retailer variants/bundles. Planning costs are proposals, **not approved
procurement prices**. `costAssumption.originalPlanningAmount` retains the initial
proposal while `amount` remains editable. Supplier and retailer observations
have their own amounts, dates and URLs.

| Model / US product ID | Planning cost | Verified key requirements |
| --- | ---: | --- |
| Wired Cam C31 / `T817L121` (`T817L`) | $59.99 | Continuous 5V/1A camera USB-C adapter, 2m cable, IP66, 2.4GHz; microSD up to 256GB or HomeBase Mini/3; no built-in storage. Do not confuse the camera adapter with HomeBase Mini's 5V/2A adapter, or this camera with Doorbell C31. |
| SoloCam E30 / `T8171121` (`T8171`) | $149.99 | Rechargeable 10,000mAh battery, removable solar panel included, IP65, 2.4GHz; microSD up to 128GB. Official page lists HomeBase S380/2 alternatives. Motion-event recording, not an assumed 24/7 wired-camera equivalent. |
| Floodlight E30 / `T8426121` (`T8426`) | $149.99 | Hardwired 100-240V AC, 50-60Hz; UL-listed junction box; IP65; 2,000 lumens; 2.4GHz only; microSD up to 128GB or HomeBase S380. USB-C is for setup only, not permanent power. |

Official eufy product pages show $59.99/$149.99/$149.99. Additional retailer
checks found a $59.99 black C31 listing (color-specific SKU unconfirmed), a
$299.99 SoloCam E30 **with HomeBase 3** (not comparable to the single camera),
and a $119.98 Floodlight E30 rollback (exact SKU/seller to reverify). None replaces
planning costs. Official product/support URLs and manual-mirror evidence are
stored in each record. Manual accessory illustrations can include optional
HomeBase bundles; verify the purchased single SKU, especially remaining
floodlight hardware, before procurement. Unknown charging or built-in-storage
specifications stay `null`. No subscription is required for the specified local
recording, but compatible recording media must be provisioned.

### Selection and site review

`selectResidentialCamera(config, catalog, baseline, siteFacts)` evaluates nine
explicit boolean-or-null facts documented in the configuration. Missing or
malformed facts fail rather than defaulting to suitable conditions.

- Prefer solar at outdoor locations with suitable exposure and tested 2.4GHz
  coverage; compatible wired power does not automatically override solar.
- C31 is a lower-cost candidate only when its specific adapter power, routing
  and protection are confirmed, never merely because an outlet exists.
- Consider Floodlight E30 only for requested lighting and compatible existing
  floodlight power; always require electrical/installation review.
- Insufficient/unknown sunlight, unassessed power, uncertain Wi-Fi, mounting or
  complexity return `manual_review`. A C31 alternative can still be listed for
  a shaded site, but is not automatically approved.
- Manufacturer sunlight guidance is not guaranteed solar autonomy. Site, season,
  panel placement, recording expectations, box contents and local electrical
  licensing remain manual checks.

### Draft packages and costing

All six drafts reference the unchanged residential equipment-inclusive baseline:
**two cameras from $599**, **four cameras $1,099**. Each location has an explicit
camera ID; optional calculation inputs may substitute another catalog camera at
that same location. Models and quantities, included accessories and additional
required materials are returned separately. All outputs are comparison-only,
pending approval and require review; they never create a quote or checkout.

| Draft | Camera combination | Equipment subtotal | Customer baseline |
| --- | --- | ---: | ---: |
| `front_back_solar` | 2 SoloCam E30 | $299.98 | From $599 |
| `front_back_mixed` | 1 SoloCam E30 + 1 C31 | $209.98 | From $599 |
| `front_back_floodlight` | 1 SoloCam E30 + 1 Floodlight E30 | $299.98 | From $599 |
| `perimeter_solar` | 4 SoloCam E30 | $599.96 | $1,099 |
| `perimeter_mixed` | 2 SoloCam E30 + 2 C31 | $419.96 | $1,099 |
| `perimeter_floodlight` | 3 SoloCam E30 + 1 Floodlight E30 | $599.96 | $1,099 |

Initial storage is explicitly **standalone microSD**, one compatible 128GB card
per camera, not an uncosted shared HomeBase. Required consumables and model-specific
power/electrical materials are separate editable assumptions. No approved costs
or card SKU were supplied: these costs remain `null`, so every initial package
has `costingComplete: false`, `totalEstimatedDirectMaterialsCost: null` and
`remainingContribution: null`. `knownMaterialsCost` is only a subtotal;
`contributionUpperBoundBeforeUncostedMaterials` is an upper bound, not a margin.
The estimated $3 TV allowance is not silently reused for cameras.

`calculateCameraPackage(config, catalog, baseline, packageId, inputs)` accepts:

- `locations`: the same front/back or front/back/left/right IDs, each with a
  catalog camera ID; quantity must match the referenced price tier.
- `materialUnitCosts`: known material IDs mapped to `{ amount, notes }`.
  Amounts use safe cent arithmetic; `null` remains unknown. Document any explicit
  zero, such as verified usable existing hardware; included accessories are not
  charged a second time.
- `siteFactsByLocation`: actual assessments, not evidence inferred from a draft.
  Missing, incompatible or uncertain assessments are flagged.

Only when every required material is costed does the result provide total direct
materials and remaining contribution. A starting customer price stays a starting
price, including in the contribution basis. Costs exceeding customer amounts
remain visible as losses; no price is changed. Labor, commissions, fees, tax,
shipping, travel, insurance and overhead are excluded, not calculated.

The baseline's four-camera historical example is **unverified**, not an approved
bill of materials or budget: $559.99 equipment plus $30 supplies. Four SoloCam
units, or three SoloCam plus one Floodlight, already cost $599.96 in hardware,
exceeding that equipment example by $39.97 before extra materials. These drafts
are flagged, as are C31/floodlight installation-scope changes, missing two-camera
cost assumptions, and all unapproved combinations. Hardware prices being equal
does not make floodlight electrical work part of the baseline installation.

## Six-model homeowner recommendations: offline draft

The original three records and six packages above are preserved, not reinterpreted.
The [recommendation engine](camera-recommendations.cjs), linked `recommendationPolicy`
in [camera configuration](residential-cameras.v1.json), and
[consultation/output schema](recommendations.schema.json) add a separate homeowner
path. Both paths use the same [equipment catalog](equipment.v1.json).
Nothing imports this into an application, creates an authorized customer quote,
changes commission policy or activates a package.

### Additional verified models and purchasing references

Official eufy product/structured offer snapshots, checked **2026-10-30**:

| Model / product ID | Initial planning | Observed | Standardized requirements |
| --- | ---: | ---: | --- |
| [S220 / T8134121](https://www.eufy.com/products/t8134121), model T8134 | $99.99 | $99.99 | Fixed 2K; integrated 0.9W solar, 6,500mAh battery; standalone 2.4GHz Wi-Fi; 8GB built-in; motion events, no 24/7 or microSD. USB-C cable/mount/screws listed. No tracking or color-night-vision promise. |
| [S340 / T81701W1](https://www.eufy.com/products/t81701w1), model T8170 | $199.99 | **$219.99** | Dual 3K/2K lenses, pan/tilt, tracking, 8x hybrid zoom, spotlight color night vision; removable 2.2W solar; 2.4GHz; 8GB built-in event storage. Verify panel/mount/cable box contents. |
| [E40 add-on / T8144121](https://www.eufy.com/products/t8144121), model T8144 | $149.99 | $149.99 | Fixed 2K/4MP, 130-degree field, MaxColor color night vision, integrated 0.7W solar; compatible HomeBase required for this standard. Verify camera-to-hub link **and** hub-to-router connection. Exact box hardware/charging supplies require review. |

Original costs remain editable independently of `originalPlanningAmount` and
observations. S340 procurement calculations use the observed $219.99, not a
silently replaced $199.99 planning value. All six models retain proposed status.

E40 has distinct catalog purchasing options:

| Purchase | Exact product reference | Observed price | Contents |
| --- | --- | ---: | --- |
| [HomeBase 2 kit](https://www.eufy.com/products/e8144121) | E8144121 | $279.99 | 2 E40 + HomeBase 2, 16GB included |
| [Single add-on](https://www.eufy.com/products/t8144121) | T8144121 | $149.99 | 1 E40, no hub |
| [Two add-ons](https://www.eufy.com/products/bundle-t8144121-2) | BUNDLE-T8144121-2 | $299.98 | 2 E40, no hub |
| [Four add-ons](https://www.eufy.com/products/bundle-t8144121-4) | BUNDLE-T8144121-4 | $599.96 | 4 E40, no hub |
| S380 kit comparison reference | E8144123 | $379.99 | 2 E40 + S380; **excluded from optimization**, exact purchasable variant URL not verified |

HomeBase 2 and S380 are not interchangeable. Included initial storage is 16GB,
not an assumed expansion drive. Firmware, capacity, retention and any expansion
require verification. E40 continuous recording needs a separately purchased
compatible direct-power cable; the initial solar path does **not** offer that
feature. Existing hubs are reusable only with matching type, verified
compatibility, sufficient available slots and confirmed router connection.

Sources disagree about S220 sun exposure (2 vs 3 hours), S340 exposure
(2 vs 3-4 hours), and some S220/S340 HomeBase compatibility/workflows.
The standard conservatively requires surveyed 3/4 hours respectively and uses
their built-in storage, not unverified HB2 integration. These are review flags,
not guaranteed solar autonomy. E40 has no invented hourly threshold: an explicit
site/season exposure assessment is required. Charging and mounting supplies,
model-specific radio connectivity, box contents and storage retention remain
manual checks. Official product/support source URLs are stored per camera.

### Consultation contract and selection

```js
const { recommendResidentialCameras } = require('./camera-recommendations.cjs');
const input = {
  locations: [{
    id: 'front', coverage: ['front_door'], outdoor: true,
    coveragePositionVerified: true, sunlightSuitable: true, directSunHours: 5,
    batteryMaintenanceAccepted: true, c31PowerCompatible: false,
    floodlightPowerCompatible: false, wifiConfirmed: true,
    homebaseLinkConfirmed: true, mountingCompatible: true,
    standardInstallation: true, requiredFeatures: [], preferredEquipmentId: null
  }],
  preferences: {
    priority: 'balanced', storage: 'no_preference', homebaseType: 'homebase_2'
  },
  budget: null,
  existingHub: {
    type: 'none', compatibilityVerified: false, availableCameraSlots: null
  },
  hubRouterConnectionConfirmed: true
};
const result = recommendResidentialCameras(config, catalog, baseline, input);
```

`config`, `catalog`, `baseline` are the parsed versioned JSON files. Supply one
entry for **each independently surveyed coverage position**, not for each
advertised package. A position may list multiple requested areas only after
verifying a shared fixed field of view. Rotating cameras are not allowed to
collapse separate areas; they do not view all directions simultaneously.
The result reports the requested count even when some positions remain unresolved;
null camera IDs are not selected equipment. Two, three and four positions produce
two, three and four installed cameras, never padding to an advertised package.

All site facts are explicit booleans or `null` (unknown); omitted fields fail
validation. `directSunHours` is 0-24 or null. Power compatibility means the
specific model's voltage/adapter or hardwired circuit/box/routing requirements
were confirmed, not merely that an outlet exists. Outdoor conditions, mounting
and installation complexity must be verified before an equipment assignment.
Uncertain/false solar suitability blocks solar; sufficient known hours are also
required where the model has published guidance. Battery maintenance must be
accepted. Standalone cameras require verified router Wi-Fi; E40 instead requires
verified camera-to-HomeBase and HomeBase-to-router connectivity.

Hard requirements are checked before model preferences or price:

- Balanced multiple fixed locations: E40 is a strong default; S220 is a meaningful
  lower-cost standalone alternative. Balanced single position: budget S220.
- `priority: 'budget'`: lowest known eligible single-camera equipment price per
  position, **not** a claim of lowest installed cost when materials are unknown.
  `premium` prefers S340 when it meets all site/feature constraints.
- E30 supplies solar pan/tilt; S340 supplies tracking/zoom detail. C31 is an
  economical compatible-wired alternative, including shaded locations.
- Floodlight E30 requires both requested floodlighting and confirmed compatible
  power; electrical scope always requires a custom quote.
- `storage: 'standalone'` excludes E40; `shared_homebase` uses only the verified
  E40 path. Unknown shared compatibility is not inferred for other models.
- A `preferredEquipmentId` cannot override incompatibility. Unknown IDs fail.
  An eligible explicit model preference takes precedence over budget-mode ranking.
- `budget` constrains the proposed customer total, not the equipment subtotal.
  Below-baseline budgets require a custom quote; starting prices cannot guarantee
  budget feasibility. No surcharge or discount is invented.

Output includes per-position model IDs, eligible candidates, selection reasons,
unverified conditions, procurement/accessory/storage lines, proposed customer
price, financial calculations, alternatives, manual-review and custom-quote flags.
Every result stays comparison-only and requires approval. Premium S340,
floodlights, nonstandard/unknown installations, unavailable compatible hub
purchases, losses, and costs exceeding the unverified historical four-camera
assumption require a custom quote. More than four cameras have no invented price.

### Purchasing and financial estimates

For the selected model quantities, bounded dynamic programming chooses the lowest
**observed catalog** equipment cost that covers those counts with a verified
compatible hub. It considers kits/multipacks, not market-wide offers or unknown
shipping discounts. Installed counts remain distinct from purchased counts:
surplus cameras/hubs are flagged, fully charged to the estimate and receive no
assumed resale credit. An unavailable S380 kit cannot be substituted with HB2.
Camera materials apply to installed positions, not unused inventory.

| Suitable balanced surveyed home | Purchase combination | Equipment cost | Proposed customer amount | Processing at 3% |
| --- | --- | ---: | ---: | ---: |
| Two fixed locations | E40 HB2 kit | $279.99 | From $599 | $17.97 |
| Exactly three fixed locations | E40 HB2 kit + add-on | $429.98 | **$849 unapproved draft** | $25.47 |
| Four fixed locations | 2 E40 HB2 kits; 1 unused hub | $559.98 | $1,099 baseline | $32.97 |

Three-camera pricing exists only in recommendation policy, not the unchanged
40-tier baseline. None of these prices approves every possible combination.
Budget S220 equipment alternatives cost $199.98/$299.97/$399.96 for 2/3/4,
with 8GB built into each camera and no separate microSD. Mixing models retains
their own storage: C31/E30/Floodlight need separate microSD lines in this path;
S220/S340 use built-in memory; E40 requires a compatible hub.

**Actual total materials/direct cost and contribution remain null/incomplete**
until camera consumables, compatible solar initial-charging supplies, any hub
installation supplies, microSD and power/electrical extras, sales tax and shipping
are explicitly costed. No approved camera consumable allowance is inferred from
the existing $3 TV allowance.

Optional inputs:

- `materialUnitCosts`: known material IDs -> `{amount, notes}`, or null amount.
  Includes legacy material IDs plus `solar_initial_charging_materials` and
  `homebase_installation_materials`. An explicit zero needs documented verified
  included/available supplies. Included hub/memory are not charged twice.
- `salesTax: {percent, notes}`: null by default, never silently zero.
  Planning tax applies to all equipment plus separate materials; verify local
  taxability, shipping taxes and treatment of installation service separately.
- `shipping: {amount, notes}`: unknown by default; free shipping must be verified.

Integer-cent arithmetic rounds tax, fees and each illustrative percentage
half-up once. Estimated direct cost includes equipment, materials, tax and
shipping. Remaining before commission subtracts that total and the **3% planning
processing fee** from the proposed customer amount. Illustrative rep commissions
are 40/50/60% of positive remaining contribution; company contribution is remaining
minus commission. Losses stay negative with zero scenario commission. These are
**not approved compensation policy**. Owner labor and technician payroll are not
deducted; remaining contribution is not net profit.

For reproducible **test-only** complete examples, assume $3 camera consumables
per installed camera, verified included/available charging and hub supplies ($0),
7% planning sales tax on materials and verified free shipping:

| Installed E40 count | Materials before tax | Tax | Total direct cost | Before commission after fee | Company at illustrative 40% / 50% / 60% rep rates |
| --- | ---: | ---: | ---: | ---: | --- |
| 2 | $285.99 | $20.02 | $306.01 | $275.02 | $165.01 / $137.51 / $110.01 |
| 3 | $438.98 | $30.73 | $469.71 | $353.82 | $212.29 / $176.91 / $141.53 |
| 4 | $571.98 | $40.04 | $612.02 | $454.01 | $272.41 / $227.00 / $181.60 |

Those inputs are fixtures, **not adopted catalog assumptions or approved prices**.
The 3% fee is $17.97/$25.47/$32.97 respectively. All calculations remain proposed
even when costing is complete. Legacy helpers/notes above continue to describe
their original, narrower material-only calculation.

## Preserved meaning and operating policy

- Only TV mounting and security camera installation are in this pricing scope.
  Residential and commercial have different named groups; there is no fallback
  between markets or installation-only/equipment-inclusive groups.
- `price` is a fixed proposed amount for the stated standard scope.
  `priceFrom` is a starting amount, **not** a fixed checkout total. A quote-only
  row has `quoteRequired: true` and no amount. Large TV tiers explicitly require
  a quote even when they have a starting amount.
- Prices are USD **dollars**. Future Stripe/quote adapters must convert to integer
  cents explicitly. Quantity rows are listed packages, not unit prices to
  multiply or interpolate. The commercial TV bundle group applies only up to
  65 inches; it is not permission to combine arbitrary TV tiers.
- Core zone: Greenwood, Greenville and Spartanburg, SC; reach is up to three
  hours one way from Greenwood, subject to travel charges and project minimums.
  Neither the travel fee schedule nor project minimums were supplied.
- Standard accessible TV installations assume a customer-supplied bracket unless
  explicitly included. The residential included-mount group is **standard fixed**
  mount only; it does not establish tilt/full-motion or commercial mount pricing.
- Camera installation-only means compatible customer-supplied equipment. eufy is
  preferred, not exclusive. Equipment-inclusive pricing requires an eligible
  specified SKU. **No verified SKU allowlist was supplied**, so no helper treats
  a proposed equipment-inclusive amount as an authorized sale.
- Nonstandard mounting, difficult wall materials/cable runs, high mounts, complex
  commercial work, large systems and unverified equipment require individual
  quotes. Do not invent surcharges or automatically price missing quantities
  outside the explicitly unapproved offline three-camera draft.
- Local-recording eufy models may avoid required cloud subscriptions. Do not
  promise professional monitoring or no fees for every third-party device.
  Verify licensing, insurance and applicable installation requirements before
  activating commercial security work.
- Smart locks, soundbar mounting and smart-home setup remain future/inactive in
  this proposal. Existing application service choices are not changed.

## Financials and offer comparisons

`calculateMaterialFinancials({ sellingPrice, equipmentCost, suppliesCost })` uses:

```text
materialContribution = sellingPrice - equipmentCost - suppliesCost
materialMarginPercent = materialContribution / sellingPrice * 100
```

The source's `grossMaterialProfit` means **material contribution**, not net
profit; `suppliesCostEstimate` maps to the helper's `suppliesCost`.
Owner labor, travel, payment fees, taxes, insurance and overhead remain excluded.
Historical illustrative equipment costs are explicitly unverified, not current
supplier quotes. Formula text is validated, never evaluated as code.

Amounts use safe integer cents internally. Percentage discounts round once,
half-up, to cents; displayed margin rounds to two decimals. Losses are retained.
Zero selling price has `materialMarginPercent: null` because division by zero
is undefined. Missing inputs, sub-cent amounts and unsafe arithmetic fail.

`compareOfferScenario(scenario, offer)` returns separate `standard` and
`experimental` financials with `comparisonOnly: true`. Fixed-dollar and
percentage experiments are supported without changing baseline or equipment/
supplies costs. Discounts exceeding the selling price fail rather than silently
clamping. It does not resolve eligibility, stack offers, apply a margin floor,
price a bundle, create a quote or activate a promotion. No such rules were
approved. The proposed $50 new-home offer does not activate the future
smart-home-setup service.

## Validate and update

From the repository root:

```powershell
Set-Location .\config\pricing
npm ci --ignore-scripts --no-audit --no-fund
npm run validate
npm test
```

The validator also accepts explicit baseline and overlay file paths:
`node .\validate.cjs <baseline.json> <promotions.json> [equipment.json] [cameras.json]`.
Omitting the third path validates the bundled equipment proposal. A linked camera
configuration defaults to its path relative to the equipment file; a legacy
catalog without cameras does not require that file.
Tests run with Node's existing built-in test runner; Ajv is the isolated,
development-only JSON Schema dependency. Validation compiles the baseline,
promotion, equipment, camera and recommendation schemas;
the backend's `package:forecast` build step consumes these validated helpers
for internal planning. This package does not publish a live price feed.

1. Preserve received source records. Draft new versioned baselines/overlays
   rather than overwriting an approved standard for a promotion.
2. Recompute scenario contribution and margin whenever price/costs change.
   Never edit the illustrative output to hide a calculation failure.
3. Preserve market, equipment, size, quantity and quote semantics; verify
   commercial scope, SKU compatibility, supplier evidence and travel policy.
4. Run validation/tests and review the comparison. v1 provenance tests intentionally
   reject changing the archived proposal's values without a reviewed new version.
5. Obtain explicit business approval and an effective date. Activation requires
   separately reviewed schema/consumer changes; changing a JSON status is not
   a release mechanism. Obtain separate approval before commit, push, migration
   or deployment. This integration performs none of those actions.
