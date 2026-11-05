# Field Sales interface review

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

## Remaining review limitations

- VS Code's controller can read inactive editor tabs but sometimes cannot finish
  locator clicks while their document is hidden. Native browser clicks were
  separately exercised in the existing dedicated local review browser; this is
  not certification of every click in every integrated pane.
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
