# Local application comparison and future integration

Inspected 2026-10-25 against the local tree on `retro-dev`, HEAD `e70af30`,
including existing uncommitted changes. No remote catalog/Stripe/database state
was queried. These are **local code observations**, not verified live prices,
supplier quotes, compliance claims or evidence of customer conversion.

## Existing prices versus this proposal

| Local implementation | Proposed v1 | Reconciliation needed |
| --- | --- | --- |
| [Residential storefront](../../frontend/bundles.html) TV packages: 1 TV $249, 2 TVs $428, 3-4 TVs from $699, 5+ quote. [TV modal](../../frontend/bundles.js) selects $699 for 3 and $899 for 4. | Residential installation-only: $109/$129/$149/$179/$229 by size through 85 inches; 86+ from $299, quote required. | Different size-based versus TV-count model. No automatic ID mapping or price replacement. v1 supplies no residential multi-TV bundle discount. |
| Storefront hardware FAQ says mounting brackets, hardware and materials are included. The TV modal separately distinguishes customer/H2S mount provider and adds $0 fixed / $25 tilt / $75 full-motion. | Standard accessible TV rates assume customer bracket; separate residential standard-fixed-mount rates $139/$159/$179/$219/$279; 86+ quote. | Resolve current inclusion claims and modal behavior. v1 does not establish tilt/full-motion add-ons or commercial supplied-mount prices. |
| Storefront FAQ says brick/stone/concrete use the same flat-rate pricing; marketing says no hidden fees and "the price you see is the price you pay." | Nonstandard mounting, difficult walls/runs, high mounts, travel and complex projects need scope/quote review. | Review these promises before public adoption. No surcharge or travel/minimum formula was supplied. |
| Camera coverage packages: `cam_basic` $599, `cam_standard` $1,199, `cam_premium` $2,199; custom quote. Frontend describes coverage outcomes, not a verified SKU/quantity mapping. FAQ says customers own equipment. | Residential wireless installation-only: 1/$129, 2/$229, 4/$399. Equipment included: 1/from $299, 2/from $599, 4/$1,099, 6/from $1,599, 8/from $2,099. Wired 4/from $1,699. | Do not infer that a coverage package equals a camera count, or that old prices include equipment. Need explicit product/SKU and installation scope mappings. |
| [Commercial intake](../../frontend/commercial.html) and [script](../../frontend/commercial.js) collect services, budget, scope and call preferences; no published installation rate calculator was found. They also offer cabling, Wi-Fi and access-control-related work. | Commercial TV installation-only $159/$189/$219/$269/$349; 86+ from $449, quote. Bundles up to 65 inches: 2/$399, 4/$749, 6/$1,099, 8/$1,399. Commercial camera rows are separately defined in the baseline. | Keep consultation requests/budget distinct from approved installation pricing. Additional existing services are outside v1 pricing, not silently removed or newly activated. |
| [Commercial business tools](../../backend/lib/commercial_business.ts) accept staff-entered quotes and full/deposit terms in integer cents; [workflow docs](../../docs/COMMERCIAL_WORKFLOW_PLAIN.md) describe manual quote/customer-approval/payment evidence. | Proposed dollar-denominated business configuration; no quote-generating consumer. | A future adapter may suggest staff-reviewed lines. Preserve existing revision/history, approval, payment and linked-job contracts. A budget is not an approved quote. |
| [Promo cache](../../backend/lib/promoCache.ts) contains an active-marked `NEWYEAR50` $50 code with a placeholder provider ID and a QA 100% code; shop checkout separately handles Stripe promotions and Roku fulfillment metadata. | Inactive proposed $50 new-home bundle discount, now in a separate experiment overlay with unknown eligibility. | These are NOT the same campaign merely because both are $50. Do not activate/update a Stripe code or fulfillment bonus from this proposal. Provider state was not checked. |

## Current catalog and checkout boundaries

- [Bundles JS](../../frontend/bundles.js) has local package/TV-modal prices and
  fetches catalog data. [Bundles data API](../../backend/app/api/bundles-data/route.ts)
  reads `h2s_bundles` and `h2s_services`.
- [Shop catalog fallback](../../backend/app/api/shop/route.ts) instead reads
  `services`, `bundles` and `price_tiers`. These differently named sources need
  reconciliation and stable product mappings before migration. Their remote
  contents were not inspected.
- The shop route constructs Stripe `unit_amount` from cart `item.price` in
  dollars (`Math.round(price * 100)`) and persists order items. Do not assume
  placing JSON in this directory changes or authoritatively reprices checkout.
  A future adoption must enforce approved amounts server-side, not merely change
  storefront text or trust a client-side baseline selection.
- Consultation approval and its zero-total consultation appointment remain
  separate from a priced installation quote, order, job and payment. No consumer,
  migration, backfill or operational record is changed by this package.

## Future connections: proposed only

1. **Approve the business baseline first.** Confirm effective date, SKU eligibility,
   current equipment/supplies evidence, supported scope, licensing/insurance,
   travel fees/project minimums, taxes and special-work quote rules. Decide
   whether the public offer is installation-only or equipment-inclusive.
2. **Catalog adapter.** Explicitly map residential/commercial service,
   equipment mode, size/quantity bands and bundle limits to existing product IDs.
   Reject missing bands and unsupported SKUs; never fall back across markets.
   Do not interpolate quantities or sell a `priceFrom`/quote-only row as fixed.
   Retain baseline version and a snapshot of the agreed quote.
3. **Website/marketing.** Deliberately choose one approved public price feed
   and reconcile database catalog, static cards, modal add-ons and FAQs together.
   Keep scope/starting-price disclosures accurate. Residential/commercial UI
   should reuse a stable-height container if switching markets; no calculator
   or market toggle is built in this task.
4. **Dashboard/quoting.** Use a separate authenticated adapter to suggest line
   items and show material contribution under clearly unverified cost labels.
   Preserve staff approval and existing quote/payment history; do not rewrite
   consultation appointments as paid installation records. Costs/margins are
   internal, never part of the public catalog response.
5. **Checkout.** Resolve immutable approved quote/baseline/offer references
   server-side, explicitly convert USD dollars to cents, and retain existing
   payment/webhook idempotency. Deposits, tax, travel and final scope need their
   own approved terms. Require a separately approved release/migration plan.
6. **Promotions.** Define eligibility, market/service/SKU applicability,
   dates, redemption limits, stacking, budget and any material-margin floor.
   Compare experiments against the same unchanged baseline and verify current
   costs before approving an offer. None of those rules is inferred from the
   supplied $50 amount.

## Validation evidence

- `npm run validate` from `config\pricing`: passed; both schemas compile,
  10 groups / 40 tiers / 2 unverified scenarios / 1 inactive offer validate.
- `npm test` from `config\pricing`: 64 tests passed. Covers complete source
  mapping, status/currency, schema shape, ranges, duplicates, market/equipment
  separation, fixed/from/quote-only rows, recomputed margins, cent arithmetic,
  zero-price undefined margin, cost edits, isolated fixed/percentage experiments,
  invalid offer combinations and CLI failure exits.
- `node --test --test-reporter=dot tests\commercial_business.test.cjs tests\commercial_consultation.test.cjs`
  from `backend`: 28 existing tests passed.
- No application build was run: application code and its manifests were not
  changed; the new package's validation compiles its schemas. No live purchase,
  quote, message, checkout, data update, migration or deployment was performed.

## Approval gates still open

The baseline, effective date and source evidence are not approved. No equipment
SKUs or actual offer eligibility were provided. Commercial scope/compliance,
travel/minimums, taxes, special work and mapping of legacy packages still need
decisions. Existing public copy must be reconciled in a separately approved
implementation, not automatically corrected by this configuration task.

This work remains local and uncommitted. Explicit approval is required before
commit/push, and separately before consumer activation, migration or deployment.
