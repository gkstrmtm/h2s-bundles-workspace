# Home2Smart Pricing v1.0 — VS Code Agent Handoff

## Objective
Establish a permanent, version-controlled pricing source of truth for Home2Smart. Core active scope: TV mounting and security camera installation, each separated into residential and commercial. eufy is the preferred camera system, but other compatible customer-requested equipment is supported. Do not activate other service categories yet.

## Repository tasks
1. Inspect repository architecture, existing service catalogs, price sources, checkout/quote calculations, residential and commercial funnels, and tests. Report conflicts before making changes.
2. Add the accompanying `pricing.json` under an appropriate version-controlled business configuration path (suggested `config/pricing/home2smart.v1.json`). Preserve baseline data verbatim unless a schema adaptation is required, and document mappings.
3. Add a short README explaining scope, formulas, assumptions, source verification status, effective-date approval, and update procedures. Keep experimental offers in a separate versioned overlay, never mutate baseline values for a temporary promotion.
4. Add schema validation and automated tests for currency, ranges, unique tiers, ascending size boundaries, residential/commercial isolation, `price` vs `priceFrom` semantics, quote-required flags, and margin math. Do not hardcode illustrative profit numbers into business logic.
5. Produce a read-only comparison of current app prices and this proposal. Identify any public copy or flows that would be affected. Do not alter live pricing, checkout, production database, or deployment.
6. Maintain stable UI layout when toggling residential/commercial; do not render shifting-height calculators without layout controls.
7. Run available tests/build and present a concise diff, discrepancies, and approval questions. Do NOT commit, push, migrate, or deploy without explicit user approval.

## Financial definitions
Material contribution = selling price - equipment cost - consumable supplies. Material margin = material contribution / selling price. This is NOT net profit; owner labor, travel, fees, taxes, insurance and overhead remain excluded. Illustrative costs in JSON are unverified and must not be represented as current supplier quotes.

## Operating policy
- Core service zone: Greenwood, Greenville, Spartanburg, SC, with up to 3-hour one-way reach from Greenwood subject to travel charges and project minimums.
- TV rates: standard accessible installations; customer-supplied bracket unless explicitly included.
- Camera installation-only rates: customer supplies compatible equipment. Equipment-inclusive rates apply only to eligible specified SKUs.
- Complex commercial installations, difficult wall materials/cable runs, high mounts, and large systems require individual quotes.
- No claim of professional monitoring or guaranteed zero fees for every third-party device. eufy models with local recording may avoid required cloud subscriptions.
- Verify licensing, insurance and applicable installation requirements before activating commercial security work.
- No unapproved live changes.

## Next-step deliverables
1. Repository location and file list.
2. Existing-versus-proposed pricing conflict report.
3. Validation/test output.
4. A proposed integration plan for funnels, dashboards, quoting, marketing copy, and promotions, without implementing it yet.
5. Explicit request for approval to commit and push.
