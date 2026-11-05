# Field Sales interface review

## Current coordinated UX refinement

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
