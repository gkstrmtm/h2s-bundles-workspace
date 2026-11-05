# Home2Smart operational readiness

Assessed 2026-11-05 against `retro-dev` commit
`672a29f0418492998eb462aa5836a322d6f0d865` (also the remote tip when assessed).

**Decision: not ready to onboard five representatives for unrestricted real-money
sales.** The connected workflow is substantially implemented and demonstrated in
isolation. Technician deployment packaging, production prerequisites and approvals
remain unresolved; ordinary lead access also stops at 100 loaded opportunities.
This is not a request for another redesign.

Assessment only: no application changes, deployment, activation, real accounts,
production writes or paid connections. Existing unrelated changes were preserved.
Production credentials, installed migrations and feature values were not inspected.

## Ready

Here, **ready means implemented and supported by the evidence below, not authorized
or certified for production**.

| Area | Implemented capability / evidence |
|---|---|
| Independent representative access | Dedicated [sales app](https://portal.home2smart.com/sales.html), with Home, Leads, Quotes, Orders and Earnings; routine work does not require the management dashboard. Standalone app tests passed. |
| Account control | ADMIN creates a SALES account with a strong temporary credential, initially disabled; activation is separate. Dedicated controls support disabling, session revocation and evidenced tenure. |
| Session and role boundaries | Salted PBKDF2 credentials, hashed random bearer tokens, eight-hour SALES sessions, request-time expiry/role/disabled checks and owned-record authorization. Logout and disable revocation were exercised in isolation. SALES is excluded from general dashboard APIs unless explicitly opted in. |
| Customer and sales work | Customer identity/contact/address, owned leads, service assessments, consent-bound private photos, revisions, follow-ups, server-priced TV/camera quotes, management review and immutable approved quote/acceptance snapshots. Listing limitations are below. |
| Agreements and payment workflow | Versioned customer copies, issued authorization links, acceptance/cancellation gates, reserved 25% deposit and remaining-balance identities, signed webhook handling and receipt reconciliation. Provider behavior was simulated, not certified with Stripe. |
| Management control | Immutable originating representative, controlled reassignment, financial oversight, approved actual costs/provider fees, deterministic commission qualification/corrections and Friday review/export. Export is not payment; settlement requires separate evidence. |
| Fulfillment engine | Deposit/legal eligibility, schedule/readiness checks, scoped assignment and technician offer acceptance, retained photo/signature/checklist evidence, actual costs/hours, completion and final-balance gates. Tested root technician UI is not the public package; see blocker 1. |
| Latest UI | Current tests and read-only integrated-browser checks confirm the chronological follow-up table, separate salesperson navigation, six equally sized order-summary cards, hidden successful-load stamp and readable Audit with exact Source JSON available separately. No redesign was introduced. |

Primary evidence: [standalone entry](../frontend/sales-app.js),
[shared authorization](../backend/lib/dashboardAuth.ts),
[account/lead authority](../backend/migrations/043_field_sales.sql),
[transactions](../backend/migrations/044_field_sales_transactions.sql),
[attribution](../backend/migrations/045_field_sales_launch_contracts.sql),
[workflow](../backend/migrations/046_field_sales_workflow.sql) and
[earnings](../backend/migrations/047_field_sales_earnings.sql).

Entry points: [management](https://portal.home2smart.com/dash?tab=fieldsales),
[Operations](https://portal.home2smart.com/dash?tab=operations) and
[technicians](https://portal.home2smart.com/portal). Customer agreements and payment
links must be issued by the application, not constructed manually. The
[complete URL inventory](ACCESS_URLS_AND_FORECAST_SETUP.md) remains applicable.

## Implemented but inactive

- Sales, transactions, workflow and catalog administration are default-off,
  separately ENV/DB-gated capabilities; earnings has a separate ENV gate.
  **Actual production state is unverified.** A reachable HTML page is not activation.
- Field Stripe mode defaults to test. Live requires its separate explicit ENV and
  DB authorization and separate field-specific live/webhook credentials.
- Workflow activation permits assignment of eligible enrolled new orders even
  while the global legacy assignment switch is off. It therefore needs assignment
  authorization, not merely permission to display Orders.
- Catalog publication requires an approved version/digest. Proposed equipment,
  offline JSON and storefront prices are not automatically approved Field Sales
  offers. Nothing in this assessment publishes or changes prices/commissions.
- No automatic bank payout is implemented or claimed. Friday review/export and
  evidenced manual settlement are distinct operations.

Exact switch names, origin/token settings, separate Stripe keys and rollback
contract are in [existing activation prerequisites](SALES_SYSTEM_DELIVERY.md#exact-gateconfiguration-contract).

## Missing or incomplete

| Gap | Exact boundary | Smallest safe correction / operating consequence |
|---|---|---|
| Technician hosting package | Committed [frontend routing](../frontend/vercel.json) sends public `/portal` to the backend static portal. Only [root portal](../portal.html) has the enrolled-installation integration. Committed [backend portal](../backend/public/portal.html) and [frontend mirror](../frontend/portal.html) lack it; backend public assets/build do not package the required module. Public `/portal` HTML also lacked the integration markers. Root-only wiring tests do not certify deployment. | Package the reviewed integration and all referenced assets in the actual serving target, or approve routing to a correctly packaged canonical target. Verify hosted offers, proof/cost capture and completion while preserving legacy jobs. Flags alone cannot fix this. |
| Lead/follow-up reachability | [SQL listing](../backend/migrations/043_field_sales.sql#L79) returns at most 100 newest-updated opportunities: per SALES owner, or across representatives for ADMIN. [GET API](../backend/app/api/field-sales/route.ts) has no pagination/search continuation; UI search and due work use only that subset. Isolated probe: total 101, returned 100; omitted lead fetched by exact ID, but `offset` rejected. | Add ownership-scoped server pagination/search and complete due-work retrieval through the existing list. No data loss was demonstrated, but older work becomes unreachable through normal navigation. Fix before unrestricted ongoing use; a deliberately capped supervised pilot requires explicit acceptance. |
| Repeat purchases | One opportunity per lead, normalized-phone duplicate rejection and accepted-contract/workflow constraints prevent a later independent accepted sale to that customer. Initial combined TV/camera orders work. | Add a separately identified repeat opportunity/order against the existing customer, preserving accepted snapshots and attribution. Until separately authorized, limit launch scope to first sales and hold subsequent orders; do not duplicate customers/phone numbers. |
| Self-service credentials | SALES cannot use dashboard self-change; the standalone app has no self-change, forced initial rotation or forgotten-credential flow. ADMIN reset exists, but reset alone does not revoke existing sessions. | Existing safe managed recovery is **disable through dedicated controls -> ADMIN reset with an explicit strong credential -> reactivate**. This revoked old sessions and allowed the new login in isolation. Management must staff/accept this process; self-service is an improvement, not an entirely missing recovery capability. |
| Legacy account wording | General directory renders SALES as VA and offers unsuitable generic role/invite controls. Database role guards reject SALES demotion; no successful role bypass was found. Generic Reset PIN defaults to a shorter generated PIN. | Use dedicated Field Sales onboarding/activation controls and explicit strong managed-reset credentials. Do not send the legacy dashboard invitation. Small correction later: accurately label SALES and suppress unsupported role/invite actions. |
| Older UI assertion | One existing test still queries removed `.field-sales__followup button`; it fails before checking the new table. | Update that test to the semantic table selector and rerun. Current table/order/action tests and browser evidence pass; this is test maintenance, not a demonstrated broken follow-up action. No test code was changed here. |

Recovery source: [login](../backend/app/api/v1/route.ts#L9304),
[self-change](../backend/app/api/v1/route.ts#L9494),
[ADMIN reset](../backend/app/api/v1/route.ts#L10728) and
[SALES role guard](../backend/migrations/043_field_sales.sql#L271).
No new recovery-email integration or broader CRM is required for the managed path.

## Requires management approval

1. **M1 - launch catalog:** exact residential TV/camera sizes, quantities,
   equipment, installation scope, territory, tax treatment and exception authority.
   Publish only reviewed prices/cost assumptions, not proposed bundles.
2. **M2 - customer/legal:** actual agreement and notices, applicable jurisdictions,
   door-to-door cancellation/refund requirements, delivery/retrieval and retention.
   A 25% deposit does not establish nonrefundability or a zero-day cancellation period.
3. **M3 - compensation/cost authority:** tenure evidence, rate event/timezone,
   attribution, actual-cost evidence and rounding. Existing 55%/50%/45% tenure
   rates and exclusion of wages from the commission basis remain unchanged.
4. **M4 - payout operations:** classification, lawful qualification/hold/correction
   timing, Friday cutoff/timezone/holidays, settlement method and independent proof.
5. **Explicit launch scope/owners:** managed credential recovery, first-sale-only
   limitation if accepted, field connectivity/support, reconciliation and exception
   owners; separately authorize schema/deployment, account creation, scoped
   assignment and eventually live payments. None was authorized by this assessment.

These are launch decisions, not defects to solve by changing approved pricing,
inventing legal policy or silently enabling switches.

## Requires external integration verification

| Dependency | Required evidence before activation |
|---|---|
| Database/migrations | Reviewed target, baseline and checksums for 043-048 and their existing 007/014/031/032/035/036/037/041/042 dependencies. [Guarded runner](../backend/apply_migration_pg.js) registers through 039, not the new sales migrations; 040 remains draft. Register/apply required reviewed migrations only with separate authorization. Prove native PostgreSQL constraints, grants/RLS, retries/concurrency and rollback gates; PGlite is not this certification. |
| Projects/storage | Verify main/management/dispatch co-location; private `commercial-private-files` photo access, consent and cross-owner denial. Validate canonical `h2s_dispatch_job_artifacts` identity/provenance/retention and real technician/customer access. No public-storage fallback. |
| Hosted identity/UI | Establish actual frontend/backend source commits and deployment roots, correct the technician package, and verify all role routes/assets. Rehearse native five-account activation, expiry, logout, disable and managed recovery. Verify edge/WAF login throttling; inspected login/middleware contain no in-route limiter, but deployed edge protection was not inspected. |
| Stripe test account | Real SDK/webhook signatures alone are insufficient. Exercise actual test checkout, matching mode/amount/customer/order, duplicate/late/retried events, provider fees, final balance, cancellation/refunds/disputes and outage recovery against the authorized native target. Verify the existing [field webhook](../backend/app/api/field-sales-stripe-webhook/route.ts) endpoint. Do not use live payments for certification. |
| Customer/field devices | Verify approved HTTPS origin, handoff signing/expiry, exact legal copies, customer retrieval/acceptance and payment return paths. Exercise real mobile photo uploads and technician evidence under field connectivity. Local viewport tests do not prove camera hardware or mobile-network delivery. |
| Rollback/operations | Rehearse disabling new gates without deleting accepted contracts, receipts, artifacts or earnings. Preserve legacy workflows, reconcile in-flight webhooks and outstanding customer/payment obligations. Switching off does not refund/cancel orders or erase earned obligations. Independently prove settlement access; no transfer was tested. |

### Launch blockers, in order

1. **Correct and certify the technician serving package.** Its tested integration
   is absent from the evidenced public package.
2. **Approve prerequisites and prove the hosted connected chain.** Native schema,
   grants/storage, actual test-mode Stripe and customer/technician handoffs remain
   uncertified. Do not enroll real employees or collect live deposits to test them.
3. **Obtain M1-M4 and explicit operating/activation approval.** Freeze source,
   catalog and policy versions and establish recovery/reconciliation ownership.
4. **Remove the 100-opportunity reachability limit before unrestricted launch.**
   A smaller supervised first-sale pilot is a management scope decision, not a
   claim that this limit or repeat purchasing is solved.
5. **Accept or correct the repeat-sale boundary.** It blocks unrestricted repeat
   business, not an initial combined-service sale. Close the stale UI assertion
   before declaring the regression gate completely green.

### Verification record and limits

- **Current connected/UI selection:** 43 files, **423 passed, 1 failed, 0 skipped**
  (424 tests). The failure is the stale selector described above, not a green run.
- **Standalone entry:** `node --test backend\tests\sales_app_ui.test.cjs`:
  **9 passed, 0 failed**.
- **Supplemental isolated source/SQL probes:** confirmed managed recovery,
  non-revoking reset alone, logout revocation, blocked SALES role mutation and the
  101/100 lead boundary. These used PGlite/authorized test stubs, not deployed auth.
- **Five-representative pilot:** real isolated API/SQL authorities with fake
  Stripe; two standalone service-price drafts per representative and five
  accepted combined TV/camera orders (four residential, one commercial), including
  proof/costs, balance and Friday accounting. This does not prove ten separately
  accepted sales, repeat purchases, real staff or native provider integration.
- **Real external observations:** public sales entry returned HTTP 200; public
  technician HTML lacked the integration markers. These are reachability/asset
  observations only, not authenticated production workflow proof.
- **UI preservation:** reviewed committed-preview status matched the assessed
  SHA, with production network/payments disabled. Current browser checks confirmed
  the table, role-specific destinations, equally sized six-card summary and
  structured Audit. Prior responsive screenshots cover 320/390/768/1024/1280;
  see [presentation evidence](WORKFLOW_REFINEMENT_REVIEW.md). Hidden integrated
  tabs prevented reliable native keyboard certification; it is not claimed.
- Synthetic preview/provider restrictions are **not production defects**.
  Forecast/AI availability is not a sales-launch dependency. No external
  database, storage, Stripe, email or settlement integration was authenticated
  during this assessment.

Reproduction command for the current 43-file selection, from repository root:

```powershell
$names = @(
  'field_sales','field_sales_ui','field_commerce','field_commerce_ui',
  'managed_offer_response','management_assignments','management_assignments_api',
  'management_assignments_ui','management_operations','management_operations_ui',
  'management_planning','management_planning_ui','operations_foundation',
  'commercial_compatibility','commercial_operations','commercial_calendar',
  'commercial_business','stripe_order_metadata','dashboard_controls',
  'dashboard_presentation','commercial_contact','residential_inquiry',
  'shared_address','residential_funnel','field_sales_catalog_admin',
  'field_sales_launch_contracts','field_sales_session_integration',
  'field_workflow','field_workflow_expiry','field_workflow_fees',
  'field_earnings','field_earnings_math','field_workflow_proof_requirements',
  'field_completion_catalog','sales_system_pilot'
)
$paths = @($names | ForEach-Object { 'backend\tests\' + $_ + '.test.cjs' })
$paths += @(
  'tests\field-portal-wiring.test.cjs','tests\field-sales-integration-ui.test.cjs',
  'tests\field-costs-authority-ui.test.cjs','tests\field-sales-controls-regression.test.cjs',
  'tests\field-sales-redesign-ui.test.cjs','tests\field-workflow-presentation.test.cjs',
  'tools\dev-review\sales-preview.test.cjs','tools\dev-review\dashboard-preview.test.cjs'
)
node --test --test-concurrency=2 @paths
```

**Management handoff:** review this decision and approve the specific corrective
and certification actions before any launch work. Only this document is delivered;
no additional implementation phase or production activation has been started.
