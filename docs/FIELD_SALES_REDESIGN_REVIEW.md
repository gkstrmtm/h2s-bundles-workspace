# Field Sales interface review

## Guided homeowner offer assistant

The existing residential opportunity detail now includes **Find the Right Offer**
and a searchable product reference. Discovery is distinct from the existing
service assessment, management approval, signed agreement, payment and installation
evidence. Use **Review full service assessment** to complete the original review
requirements; discovery does not replace them or alter an accepted contract.

- `GET /api/field-sales-offers?leadId=<owned opportunity>` returns the exact saved
  discovery, its last ten immutable revisions, current quoting catalogs, controlled
  knowledge, accepted-contract lock and catalog/knowledge-change indicator.
- `POST` actions are `save`, `quote`, `knowledge` and optional `ask`. Saves require
  the expected discovery revision, current knowledge hash and selected catalog
  digest. Quote creation accepts no client totals, prices, lines or equipment.
  It recomputes the saved discovery with `calculateFieldQuote`, then atomically
  creates an ordinary draft using the existing transaction command.
- Reviewed additive migration `058_field_sales_offer_assistant.sql` adds
  append-only opportunity-scoped revisions and reference usage accounting.
  Anonymous/authenticated direct table and function access is revoked. The existing
  authenticated application and SQL ownership checks remain required. Retarget
  and apply only to the verified owned staging namespace; do not apply to
  production without separate approval. Existing quotes, accounts, financial
  settings and signed SC/NC document evidence are not rewritten.
- Additive migration `059_field_sales_offer_business_conflicts.sql` changes only
  the new save/quote functions' expected conflicts to PostgREST `PT409`. Real
  staging showed prompt PostgreSQL `40001` rejection but a timed-out REST
  response. Business conflicts now carry a nonretryable HTTP 409; append-only
  evidence guards and applied migration 058 remain unchanged.
- Product facts remain in `equipment.v1.json` and `residential-cameras.v1.json`.
  `field-offer-knowledge.v1.json` supplies versioned FAQs and explicit legacy
  scope bindings. Shared camera qualification and preference helpers are reused;
  the older offline camera price/commission calculator is **not** used for quotes.
  The saved recommendation retains selected equipment IDs, names and a controlled
  product-facts snapshot. Supplier check dates are historical, not live verification.
- A reviewed future catalog can attach offer `guidance`:
  `{"kind":"tv","ownership":"supplied","mountStyle":"fixed","equipmentId":"onn_fixed_32_86"}`
  or `{"kind":"camera","ownership":"supplied","equipmentId":"eufy_solocam_s220"}`.
  Customer-owned scope uses `ownership:"customer"`. A configured TV upgrade option
  can attach `guidance` with `mountStyle` and exact `equipmentId`. Generic
  equipment-included packages and mount labels never identify a particular SKU.
- Marginal TV discounts are an optional **catalog-owned** rule, not an assistant
  calculator or automatic pricing change. A residential-only `tv_mounting` service
  can explicitly define
  `{"tvMarginalDiscounts":{"basis":"highest_base_price_first_marginal","percentsByPosition":[0,10,15],"eligibleOfferIds":["reviewed-offer-id"]}}`.
  The existing quote calculator sorts eligible TVs by descending base price and
  rounds each unit's discount to cents. Upgrades are unchanged; unsupported offers
  or four-plus quantities require a custom quote. No existing catalog was
  published, annotated or repriced by this implementation.
- Private staging preparation includes this endpoint only inside the existing
  verified synthetic namespace/test-mode middleware gate. Application sign-in
  and opportunity ownership remain required; legacy routes stay quarantined.
- Drafts never produce a verified customer price. Staging estimates are explicitly
  synthetic. V2 and historical $199/$499/$749/$999 examples do not establish the
  current published quote price. Missing facts, solar exposure, power, recording
  media, hub/firmware compatibility, exact SKUs and unsupported quantities stay
  unresolved and prevent assistant quote creation.
- `H2S_FIELD_OFFER_AI_ENABLED=true` optionally uses the **existing**
  `OPENAI_API_KEY`; it is off by default. No new key is required. AI can only
  select up to three existing reference IDs; the server returns controlled text,
  never generated product facts or prices. Only recognized product vocabulary and
  selected equipment IDs are sent, not raw questions, customer records or
  discovery room labels. Chat is not retained. SQL limits AI attempts to ten per
  actor per fifteen minutes and all reference events to thirty. Provider calls
  have a ten-second timeout, no retries and bounded output; failures are explicit
  and leave saved discovery and product reference usable.
- Existing audit history includes `offer.started`, `offer.progress`,
  `offer.recommended`, `offer.quote`, `offer.knowledge` and `offer.ask`. Management
  can inspect the same saved discovery and revision history on the existing lead.
  Started discovery with no recommendation indicates incomplete work, not proof
  of abandonment. No automatic transfers, compensation changes or new enrollment.

Focused verification commands:

```powershell
Set-Location backend
node --test tests\field_offer_assistant.test.cjs tests\field_offer_ui.test.cjs tests\field_sales_ui.test.cjs tests\sales_app_ui.test.cjs tests\field_workflow_scheduling.test.cjs
node --test tests\field_commerce.test.cjs tests\field_commerce_ui.test.cjs tests\staging_sandbox.test.cjs tests\staging_sql_namespace.test.cjs tests\staging_sandbox_client.test.cjs
node --test ..\config\pricing\tests\recommendations.test.cjs
node --test ..\tests\private-staging.test.cjs
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
.\node_modules\.bin\next.cmd build
```

Browser verification uses actual frontend modules and authenticated API handlers
against an isolated synthetic local PostgreSQL fixture, not live payments or a
live AI connection. Production publication and optional AI activation remain
separate management actions.

## Approved visual direction implementation

Implemented on `retro-dev`, continuing from
`818f2ae6efd5468632c265d8a07772a7d21e4dd8`. The supplied reference guided the actual
interfaces: restrained bordered surfaces, clearer hierarchy, compact typography,
structured customer/payment/status information, contextual tabs and independent
mobile navigation. Reference amounts and policies were not copied.

### What changed

- Management has one navigation row with one active destination, a more consistent
  sidebar, aligned small icons and clearer Home2Smart branding. The existing Log
  Hours action now occupies the topbar instead of floating over application content.
- Orders show customer/service/status, deposit, balance, representative/team,
  next action and six structured overview summaries. Seven contextual views are
  **Overview, Quote, Customer Docs, Scheduling, Costs & Margin, Commission Review
  and Audit**. Existing cancellation, enrollment, policy and operational controls
  remain available in contextual views; primary workflows no longer require
  opening their former disclosure sections.
- Earnings retain authoritative financial cards and Qualification, Commissions,
  Adjustments and Friday review views, with a separate administrator Audit view.
  Friday approval/export remain explicitly distinct from confirmed payment.
- The independent representative application has compact metrics, customer-first
  order/status rows, concise next actions, full-card multi-service selection,
  explicit loading/empty states and five equal mobile footer destinations.
  Input retention, existing validation and account/session boundaries remain.
- Routine quote, payment and order information uses formatted amounts and readable
  statuses. Supplied representative names are preferred; missing names are
  explicitly unavailable rather than replaced with internal codes.

### Installation cancellation-period responses

The existing database scheduling/assignment guard remains authoritative. Its
specific legal/payment readiness rejection now returns HTTP 409 with
`INSTALLATION_CANCELLATION_HOLD` and `earliestSchedulingAt` only when a fresh,
authorized read verifies an accepted agreement, the database's active
cancellation hold, disabled scheduling gate and a future stored cancellation
deadline. This timestamp is the earliest possible scheduling time, not clearance:
the verified deposit and all other requirements still apply. Other instances of
the same readiness guard return `INSTALLATION_NOT_READY` without a date.
Unrelated database/authority failures still return 503.

Scheduling shows the existing hold with a timezone-labelled date. A definitive
hold response preserves form inputs but is not labelled an interrupted write;
uncertain failures retain the original identical-operation retry behavior.

### Customer dropdown: demonstrated cause and correction

The existing absolute-positioned popup had no viewport-aware bounds or flipping.
In an actual 390px-wide, 420px-high application viewport, its bottom reached
568.84px, placing 148.84px outside the viewport. Local stacking/scroll containers
could also clip the popup. Broad sales-button styling additionally overrode option
appearance. A literal oversized blank block was not reproduced at normal full
height; these are the rendering defects actually demonstrated and corrected.

The same native-backed shared select now uses the browser popover top layer where
available, a fixed-position fallback, natural content height, bounded placement,
above/below fitting and refitting when option results change. Closed menus reserve
no area; empty lists have an explicit message. Long options wrap; long lists
scroll within a maximum 240px popup. Canonical option styles override generic
button rules. Native values/events, disabled state and ownership validation remain.
Keyboard typeahead, arrows, Home/End, Enter, Escape/focus return, outside clicks
and ancestor-scroll closing are covered.

### Final validation and review

- Combined command documented below: **221/221 passed**, no failures, skips or
  cancellations. The former baseline optional-script assertion was corrected to
  finish required shared-controls loading before exercising optional Operations
  failure; startup/error assertions remain.
- After correcting the review-only Quotes & Payments entry to the actual
  `transactions` portfolio destination:
  `node --test tools\dev-review\sales-preview.test.cjs` **3/3 passed**.
- Actual eight destinations at **320, 390, 768 and 1280px**:
  **32/32 exact application widths**, no document-wide horizontal overflow,
  no visible routine JSON blocks and exactly one active navigation destination.
  Screenshots were inspected, including scrolled order summaries, mobile forms,
  compact orders, desktop payments and tablet commissions.
- Actual pointer/keyboard checks exercised customer selection/typeahead and focus,
  full-card multi-selection, required-field blocking/focus, destination changes,
  unsaved customer/quote input retention, order contextual tabs and arrow navigation,
  and Friday review. Two services remained selected; invalid intake focused Phone;
  quantity and exception text survived Quotes / Orders roundtrips.
- Empty, one long-name and 80-option cases also exercised the real shared control
  in an isolated component fixture, distinct from the three actual seeded leads.
  Syntax and scoped whitespace checks passed.
- All eight final editor previews use the committed isolated gallery:
  `http://127.0.0.1:50276/sales-review?screen=` followed by `management`,
  `managementOrders`, `managementQuotes`, `commissions`, `home`, `leads`,
  `quotes` or `orders`. Management defaults to 1280px; representative views to 390px.

### Limitations and safety

Missing representative/team display names in existing read models remain visibly
unavailable/assigned; exact identities remain in authorized evidence. Technical
records, provider references and policy configuration remain secondary and may
use evidence disclosures; they are not primary workflow navigation. Detailed
assessments/legal/financial forms still require vertical scrolling. Management
navigation uses contained horizontal scrolling at narrower widths.

External-provider payments/storage responses and sessions are synthetic. Legacy
adapters unavailable in this isolated environment explicitly return 503; external
decorative assets may be CSP-blocked. No real payment, export delivery, bank
settlement or production integration is newly certified. This review did not
submit refund, cancellation, abandonment or settlement actions. The non-Popover
fallback is regression-tested, not separately certified in older browser engines.

No pricing, business permissions, 25/75 payment rules, commission accounting,
scheduling authority, payment verification, technician source or production gates
were changed. No deployment, production mutation, account activation or payout.
Unrelated local work is preserved.

### Changed files

- Presentation: [dash.html](../frontend/dash.html),
  [dash.css](../frontend/dash.css),
  [dashboard-controls.js](../frontend/dashboard-controls.js),
  [field-sales.js](../frontend/field-sales.js),
  [field-sales.css](../frontend/field-sales.css),
  [field-commerce.js](../frontend/field-commerce.js),
  [field-workflow.js](../frontend/field-workflow.js),
  [field-workflow.css](../frontend/field-workflow.css),
  [field-earnings.js](../frontend/field-earnings.js).
- Tests: [dashboard_controls.test.cjs](../backend/tests/dashboard_controls.test.cjs),
  [field_sales_ui.test.cjs](../backend/tests/field_sales_ui.test.cjs),
  [management_operations_ui.test.cjs](../backend/tests/management_operations_ui.test.cjs),
  [field-sales-integration-ui.test.cjs](../tests/field-sales-integration-ui.test.cjs),
  [field-sales-redesign-ui.test.cjs](../tests/field-sales-redesign-ui.test.cjs),
  [field-workflow-presentation.test.cjs](../tests/field-workflow-presentation.test.cjs).
- Isolated preview: [sales-preview.html](../tools/dev-review/sales-preview.html),
  [sales-preview.test.cjs](../tools/dev-review/sales-preview.test.cjs),
  [walkthrough-server.cjs](../tools/dev-review/walkthrough-server.cjs).
- This report: [FIELD_SALES_REDESIGN_REVIEW.md](./FIELD_SALES_REDESIGN_REVIEW.md).

## Prior coordinated UX refinement (historical)

Continues from `5762901c38ea113f015fd48582f48c86eae9c0cf` on
`retro-dev`. The independent representative application and management dashboard
remain separate. Pricing, permissions, payment/commission calculations, scheduling
authority, technician workflows and production feature gates are unchanged.

### Changes delivered

| Former primary disclosure | Replacement |
|---|---|
| Order review & supporting records | Order Overview with visible status, financial summary and next action |
| Customer documents & installation readiness | Documents & readiness tab |
| Existing calendar and managed assignment | Scheduling & team tab |
| Cancellation or refund review | Cancellation & refunds tab |
| Run review and independent settlement | Friday review tab with contextual run actions and explicit settlement prerequisites |

Orders also expose conditional Actual costs and separate Enroll sale / Policy
management views. Earnings use Qualification, Commissions, Adjustments and Friday
review tabs. Linked ARIA panels support arrows, Home/End and roving focus; switching
panels keeps existing form nodes rather than rebuilding unsaved inputs.
Administrator-only technical evidence remains secondary. Unrelated applications'
disclosures are not removed.

- Representative mobile navigation has five equal-width icon/text destinations,
  active/focus states, 44px-or-larger targets, safe-area padding and content
  clearance. Fixed positioning is scoped to the independent sales application;
  management navigation stays in flow and no longer collides with its timer.
- Service selection uses full-label selectable cards, visible multi-select states
  and service-specific descriptions. Existing service and assessment rules remain.
- Intake, assessment answers/notes, pending photo inputs and quote quantities/
  exception notes survive internal navigation in session memory. Existing
  permission/save/upload requirements still apply; retention is not backend save.
  Account/reset boundaries clear private drafts; changed catalogs are not blindly
  restored.
- Orders show customer names and contextual actions. Zero balance reads
  **No balance due**, without asserting settlement; positive blocked, unknown and
  credit balances retain distinct safe wording.
- Operations keeps its established dedicated views. Primary job/team references
  are readable; exact identifiers remain in technical evidence. Unsubmitted
  reconciliation input survives view/filter changes but cannot become approved or
  exportable without existing actions. Changed evidence invalidates stale input.
- Review-only `managementOrders` opens the actual dashboard Orders destination.
  Width presets now remain exact inside narrow editors instead of silently
  clamping: the external review wrapper can scroll horizontally for a 1280px
  application viewport. This is not application-level horizontal overflow.

### Validation

Final combined default-concurrency run: **201 tests, 200 passed, one pre-existing
failure**, no skipped/cancelled tests. Exact PowerShell command:

```powershell
$files=@(Get-ChildItem 'tests\field*.test.cjs' | ForEach-Object {$_.FullName}) + @(Get-ChildItem 'backend\tests\*field*.test.cjs' | ForEach-Object {$_.FullName}) + @('backend\tests\sales_app_ui.test.cjs','backend\tests\dashboard_controls.test.cjs','backend\tests\task_creator.test.cjs','backend\tests\management_operations_ui.test.cjs','backend\tests\management_planning_ui.test.cjs','tools\dev-review\walkthrough-fixture.test.cjs','tools\dev-review\walkthrough-navigation.test.cjs','tools\dev-review\sales-preview.test.cjs')
node --test @files
```

The existing optional-script test in
[management_operations_ui.test.cjs](../backend/tests/management_operations_ui.test.cjs)
expects Operations to be the first queued script, but the committed baseline first
loads required shared controls. The same failure was reproduced before edits
(9 passed / 1 failed). It was not suppressed or modified to claim a green suite.

After the final review-wrapper sizing correction,
`node --test tools\dev-review\sales-preview.test.cjs` passed **2/2**.
Changed JavaScript syntax checks and scoped whitespace checks passed.
The new bounded real-shared-controls regression also passed in the full run;
startup/render watchdogs accommodate concurrent JSDOM initialization while the
16-pass observer-settling limit remains unchanged.

Actual application evidence:

- Eight views at 320, 390, 768 and 1280: **32/32 exact child viewport widths**,
  zero application document-wide horizontal overflow. Representative mobile
  navigation had equal item widths, icons and targets of at least 44px.
- Visible integrated-browser pointer interactions exercised Home, Leads,
  New prospect, entire-card service selection, required-field blocking/focus,
  the shared customer dropdown and Quotes / Orders roundtrips. Quote quantity
  and exception notes remained intact.
- Assessment service toggles and Home / Leads / assessment roundtrips preserved
  camera quantity and notes. Order and Friday panel switches preserved the same
  unsaved input nodes; order keyboard navigation and cancellation/refund form
  availability were checked without submitting destructive actions.
- Friday review retained explicit approved-but-not-paid status and correctly
  blocked settlement without independent prerequisites. No export, cancellation,
  refund or settlement was submitted during these navigation checks.

### Remaining limitations

- Long multi-service assessments and detailed financial/legal evidence still
  require scrolling, particularly at 320px. Assessment progress describes saved
  records, not unsubmitted draft answers. Management remains desktop-first; its
  unchanged floating timer can obscure content in narrow management viewports.
- Hidden VS Code editor documents defer animation frames and can temporarily show
  native selects or stall pointer automation. Visible/focused browser checks
  confirmed shared dropdown enhancement and retained quote inputs at all four
  widths; no speculative production workaround was added.
- Legacy dashboard adapters outside the isolated fixture still return explicit
  503 responses, and external decorative assets may be CSP-blocked. Operations
  reconciliation retention is regression-tested with isolated UI fixtures, not
  certification of unavailable production integrations.
- External payment/storage responses and actor sessions remain synthetic.
  Real account access, photographic edge cases, physical export download delivery,
  bank settlement and production activation are not newly certified.

No deployment, real payment/account activation or payout is authorized by this
refinement. The sections below document the earlier standalone-interface baseline.

## Scope and safety

Development presentation changes on `retro-dev`; no deployment, production data,
real accounts, notifications, payments or transfers. Backend routes, migrations,
pricing, legal/compensation policies and technician source are unchanged.
Synthetic prices and legal/provider responses are not approved business terms.

The actual standalone application is [sales.html](../frontend/sales.html), with
existing server-verified dashboard authentication and five destinations: Home,
Leads, Quotes, Orders and Earnings. ADMIN/VA accounts retain their management
session but cannot acquire a salesperson workspace through this entry.
Management remains in [dash.html](../frontend/dash.html).

Shared native-backed dropdowns and date initialization moved from the dashboard
IIFE into [dashboard-controls.js](../frontend/dashboard-controls.js); both entries
reuse that implementation. Branding uses scoped Azure Strike/Royal Cobalt colors
and Archivo branding, with Inter controls/body and Space Grotesk anchors per
workspace typography guidance. Existing global dashboard colors are not replaced.

## Eight local review tabs

Base: `http://127.0.0.1:50276/sales-review?screen=`

| Screen suffix | Actual surface | Default width |
|---|---|---|
| `home` | Salesperson Home and loaded-lead activity | 390 |
| `leads` | New Prospect, contact/property and configured service selection | 390 |
| `assessment` | Camera service assessment and private photograph controls | 390 |
| `quotes` | Quote builder, itemized saved draft and approval controls | 390 |
| `orders` | Completed synthetic installation and verified payment projection | 390 |
| `earnings` | Personal earned/allocated/not-paid earnings | 390 |
| `management` | Actual dashboard Sales performance and management navigation | 1280 |
| `commissions` | Actual dashboard commissions and Friday review | 1280 |

These are labeled review wrappers around actual application documents, not
replacement mockups. All widths are selectable: 320, 390, 768 and 1280.
The isolated seed calls actual handlers to create three connected prospects, a
draft quote, a completed/collected TV installation, actual-cost review, earned
commission and approved Friday review. Approval is explicitly **not paid**.

Start the existing review server with `H2S_REVIEW_WALKTHROUGH=true`,
`H2S_REVIEW_SALES_GALLERY=true`, `H2S_REVIEW_PORT=50275`,
`H2S_REVIEW_HTTP_PORT=50276` and locally generated TLS key/cert paths in
`H2S_REVIEW_TLS_KEY`/`H2S_REVIEW_TLS_CERT`. Run
`node tools/dev-review/server.cjs`. Use a sanitized environment without production
credentials. Certificates, browser profiles and screenshots stay outside Git.
By default application assets are pinned to startup HEAD. Optional
`H2S_REVIEW_WORKTREE=true` reads only the explicit reviewed sales asset allowlist,
never unrelated dirty files.

The optional HTTP listener binds only loopback, validates Host/Origin and serves
only isolated data. It avoids VS Code's self-signed-certificate issue without
changing OS trust or disabling secure application checks. Customer agreement
links and backend contracts remain HTTPS. Browser/controller tab openings must
be serialized: parallel openings aborted some initial loads; sequential retry
successfully opened the eight labeled interfaces.

## Validation and findings

- Final combined related regression command: PowerShell collects
  `tests\field*.test.cjs` and `backend\tests\*field*.test.cjs`, then runs
  `node --test @files` together with
  `backend\tests\sales_app_ui.test.cjs`,
  `backend\tests\dashboard_controls.test.cjs`,
  `backend\tests\task_creator.test.cjs`,
  `tools\dev-review\walkthrough-fixture.test.cjs`,
  `tools\dev-review\walkthrough-navigation.test.cjs` and
  `tools\dev-review\sales-preview.test.cjs`: **168/168 passed**.
- Changed JavaScript `node --check` and scoped `git diff --check`: passed.
- All eight actual views measured at 320/390/768/1280, without document-wide
  horizontal overflow or uncaught browser exceptions. Screenshots reviewed for
  mobile intake/assessment/quotes and desktop management.
- Actual native mouse/keyboard input at 390 verified required-field blocking,
  prospect creation into the assessment, assessment draft action, unobstructed
  final buttons, shared quote dropdown open/Escape behavior and saved itemized
  quote (55-inch drywall example, $129 synthetic labor).
- Fixed QA defects: a follow-up metric falsely labeled as installation
  scheduling; duplicate initial requests that aborted each other; mobile bottom
  navigation covering the final form action; review-wrapper scrollbar reducing
  the requested width. Updated stale presentation assertions without removing
  financial/ownership checks.
- HTTP rejects foreign Host and Origin with 403; status explicitly reports
  isolated data, production network false and outgoing payments false.
- Final integrated-editor checks confirmed all eight labeled tabs loaded their
  intended synthetic state, with 390px representative and emulated 1280px
  management viewports. The persistent server serves committed assets only.

## Remaining review limitations

- VS Code's controller can read inactive editor tabs but sometimes cannot finish
  locator clicks while their document is hidden. Native browser clicks were
  separately exercised in the existing dedicated local review browser; this is
  not certification of every click in every integrated pane.
- The legacy management shell still makes background requests outside the
  fixture's supported adapters, returning explicit 503 responses. Some external
  decorative icons are intentionally blocked by preview CSP. The eight sales
  panes loaded successfully; unrelated dashboard integrations are not thereby
  certified or made available in this fixture.
- Assessment forms are still long on 320px when several services are selected.
  Configured service names, evidence requirements and quote exclusions can be
  verbose. Management performance and Friday review still share substantial
  financial detail; management should review density before further changes.
- Draft save was exercised; not every photographic consent/error/upload
  combination was re-run in this presentation pass. Existing isolated contract
  tests cover privacy, retries and required evidence.
- Real authentication infrastructure, Supabase deployment, real Stripe events,
  legal terms, bank settlement and production feature activation were not
  certified. Provider receipts, private storage and synthetic actor sessions are
  isolated substitutes. Approved Friday allocation is not bank settlement.
- Saved download delivery in the embedded browser is not independently
  certified; no new claim of a physical export download or money transfer.

No further design phase is implied. Review the real interfaces before authorizing
additional visual or functional changes.
