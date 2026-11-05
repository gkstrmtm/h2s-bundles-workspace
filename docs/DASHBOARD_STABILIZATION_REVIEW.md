# Dashboard stabilization review

Corrective development work on `retro-dev`, based on
`34984b4aa443d61ff932f50d102b9df5e5b7578e`. No deployment or production mutation.

## Causes and corrections

- The isolated review wrapper forced a 1280px application into an editor with
  1210px available. The application itself correctly allocated 228px to its
  sidebar and 1044px to main content. The fixed review-canvas contract was
  introduced in `818f2ae`; this was not evidence that the recent sidebar redesign
  broke every native module. Review width presets now set a maximum, fitting
  the actual editor width without zooming or concealing overflow.
- Native Admin content also had genuine narrow-width defects: a 260px learning
  profile label, automatic minimum sizes in forecast grid tracks, and fixed
  three-column financial totals. The label and tracks now shrink naturally;
  forecast columns respond to the Admin content container, not the browser
  width. Financial totals wrap into available columns. These constraints also
  existed in the earlier `5762901` snapshot.
- Removed structural horizontal-overflow masking from main/content/active-pane
  containers. Existing intentional table/navigation scrollers remain local.
  Shared select shells now stay fluid instead of retaining a measured pixel
  width after a parent resize; popup and keyboard contracts are unchanged.
- No dashboard destinations, business calculations, pricing, permissions,
  payment/deposit logic, scheduling authority or technician workflows changed.
  The approved independent sales application and management presentation remain.

## Website Media and Customer Queue

No production media or inquiry backend regression was demonstrated. The former
isolated walkthrough did not support their native reads and returned explicit
503 errors. Those preview gaps were separate from layout sizing.

- Customer Queue now uses its actual inquiry projection against two explicitly
  synthetic residential/commercial relationships. Native market filtering,
  search, empty results and long customer names were verified.
- Media pack/asset/slot reads execute the native handlers against memory tables.
  Public placement feeds and thumbnail storage are explicitly synthetic
  adapters, not verified production rendering or storage operations. Thumbnails
  use the local origin; the preview no longer constructs production storage URLs.
  Media search, service filtering, narrow gallery behavior and retained search
  during mobile-to-desktop resizing worked.
- Operations/planning use their actual readers against one synthetic queued
  installation. Payment remains unverified; unavailable readiness is not approval.
  Admin/task/training read collections are labeled synthetic fixture responses.
- Supported read adapters require the isolated administrator actor. Unsupported
  writes still reach explicit unavailable responses; no fake successful upload,
  booking, assignment, payment or payout was added.

## Verification

- **442/442 passed:** combined dashboard, media, Queue, Field Sales, task,
  Operations UI/planning UI and isolated-preview regressions.
- **80/80 passed:** additional native Operations/foundation/commercial tests.
- Updated obsolete tests to load the extracted shared controls and assert the
  current sequential script loader and topbar Log Hours contract. No failing
  application assertions were suppressed.
- Added guards for fluid select sizing, shared layout boundaries, Admin container
  tracks, responsive review widths/routes, native fixture filtering/pagination,
  administrator restrictions and rejected writes.
- Actual browser: 13 sections through
  1440 -> 1280 -> 1024 -> 768 -> 390 -> 320 -> 1440 without reloading each section:
  Admin, Website Media, Customer Queue, Field Sales, Operations, Tasks, Training,
  My Summary, Deliverables, Pipeline, Screening, Tech Interview, Candidate Review.
  All 91 checks had no document-wide horizontal overflow.
- A further 35 checks across the five delivery screens at all six required
  widths, growing and shrinking without reload, had no visible uncontained
  descendants. The initial geometric checker counted a non-visible advanced
  media setting; visible-state checks and opening that setting confirmed it fits.
- Inspected actual screenshots at 320, 390, 768, 1024, 1280 and 1440, including
  the formerly clipped 320px forecast totals. Expanded desktop navigation,
  mobile menu opening/Escape closing, the Log Hours overlay, open selects and
  keyboard selection were checked. Unsaved Log Hours text survived resizing.
- JavaScript syntax checks and scoped `git diff --check` passed.

Commands used (PowerShell):

```powershell
$files=@(Get-ChildItem tests\field*.test.cjs | ForEach-Object {$_.FullName}) + @(Get-ChildItem backend\tests\*field*.test.cjs | ForEach-Object {$_.FullName}) + @(Get-ChildItem backend\tests\dashboard*.test.cjs | ForEach-Object {$_.FullName}) + @(Get-ChildItem backend\tests\media*.test.cjs | Where-Object {$_.Name -ne 'media_database.integration.test.cjs'} | ForEach-Object {$_.FullName}) + @('backend\tests\commercial_queue.test.cjs','backend\tests\commercial_queue_increment.test.cjs','backend\tests\sales_app_ui.test.cjs','backend\tests\task_creator.test.cjs','backend\tests\management_operations_ui.test.cjs','backend\tests\management_planning_ui.test.cjs','tools\dev-review\walkthrough-fixture.test.cjs','tools\dev-review\walkthrough-navigation.test.cjs','tools\dev-review\sales-preview.test.cjs','tools\dev-review\dashboard-preview.test.cjs')
$files=$files | Sort-Object -Unique
node --test @files
node --test backend\tests\operations_foundation.test.cjs backend\tests\management_operations.test.cjs backend\tests\commercial_operations.test.cjs backend\tests\commercial_operations_sql.test.cjs
node --check frontend\dash.js
node --check frontend\dashboard-controls.js
node --check tools\dev-review\bootstrap.js
node --check tools\dev-review\dashboard-preview-fixture.cjs
node --check tools\dev-review\walkthrough-server.cjs
git diff --check -- frontend\dash.css frontend\dash.js frontend\dashboard-controls.js tools\dev-review backend\tests\dashboard* backend\tests\helpers\commercial_contact_fixture.cjs
```

## Remaining limitations

- Customer Queue's secondary operational workspace and company calendar remain
  unavailable in this isolated adapter. The calendar explicitly reports
  `commercial-calendar:GET` unavailable; no appointment is implied.
- Upload/save/assignment/contact-provider integrations were not certified
  end-to-end. No live APIs, database integration test, real payments or payouts
  were used. `media_database.integration.test.cjs` was intentionally not run.
- Existing external training/empty-state icon URLs are blocked by preview CSP.
  Their missing decorative icons are not a production integration verdict.
- Established spacious Admin cards and truncated narrow topbar titles remain;
  this pass did not redesign them. No remaining shared sizing defect was found
  in the tested scenarios; this is not exhaustive certification of every modal,
  historic record or unsupported integration.

## Changed paths

- `frontend/dash.css`, `frontend/dash.js`, `frontend/dashboard-controls.js`
- `tools/dev-review/sales-preview.html`, `tools/dev-review/sales-preview.test.cjs`
- `tools/dev-review/bootstrap.js`, `tools/dev-review/walkthrough-server.cjs`
- `tools/dev-review/dashboard-preview-fixture.cjs`,
  `tools/dev-review/dashboard-preview.test.cjs`
- `backend/tests/dashboard_controls.test.cjs`,
  `backend/tests/dashboard_shell.test.cjs`,
  `backend/tests/dashboard_messaging.test.cjs`,
  `backend/tests/dashboard_presentation.test.cjs`
- `backend/tests/helpers/commercial_contact_fixture.cjs`
- This report. All unrelated working-tree changes were preserved.
