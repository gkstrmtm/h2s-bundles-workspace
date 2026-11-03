# Home2Smart repository review map

Start with [REMOTE_DEVELOPMENT_REVIEW.md](REMOTE_DEVELOPMENT_REVIEW.md) for status,
activation blockers, validation and preservation boundaries. This map identifies
source, not permission to deploy or run database mutations.

## Application shell, authentication and shared UI

| Purpose | Primary entry point | Dependencies / boundary |
|---|---|---|
| Central management application | [frontend/dash.html](../frontend/dash.html) | [dash.js](../frontend/dash.js) is the existing IIFE application; [dash.css](../frontend/dash.css) is the shared component library. Do not edit root `Dash.*` duplicates. |
| Navigation | [frontend/dash.js](../frontend/dash.js) | Native `?tab=operations`, `fieldsales`, `commercialqueue`, `admin`, `training`, `pipeline`; SALES receives the restricted sales shell. |
| Sessions and employee roles | [backend/lib/dashboardAuth.ts](../backend/lib/dashboardAuth.ts) | `Dashboard_Users`, `Dashboard_Sessions`, hashed bearer tokens, expiry/disabled-user checks; existing dashboard account handlers in [api/v1](../backend/app/api/v1/route.ts). |
| New Operations permissions | [backend/lib/dashboardPermissions.ts](../backend/lib/dashboardPermissions.ts) | ADMIN capabilities; VA retains legacy permissions but not these adapters. The policy table does not globally activate SALES or OPERATIONS. |
| Shared clients | [backend/lib/supabase.ts](../backend/lib/supabase.ts) | Main, optional management and optional tracking clients. Actual project co-location must be checked before activation. Never copy production environment files into a review checkout. |
| Notification preferences | [backend/lib/notification_routing.ts](../backend/lib/notification_routing.ts) | ADMIN controls remain in the dashboard and [api/v1](../backend/app/api/v1/route.ts); [migration 039](../backend/migrations/039_notification_routing.sql). Configuration is not authorization to activate sends. |

## Operations, scheduling and Dispatch

| Purpose | Primary entry point | Dependencies / boundary |
|---|---|---|
| Consolidated Operations UI | [frontend/management-operations.js](../frontend/management-operations.js) | [management-operations.css](../frontend/management-operations.css), mounted by the dashboard; dispatch records, scheduling and reconciliation views. |
| Read-only job/order projection | [api/management-operations](../backend/app/api/management-operations/route.ts) | [managementOperations.ts](../backend/lib/managementOperations.ts), [operationsFoundation.ts](../backend/lib/operationsFoundation.ts); exact identifiers, bounded source reads, explicit partial/unavailable evidence. |
| Schedule and reconciliation projection | [api/management-planning](../backend/app/api/management-planning/route.ts) | [managementPlanning.ts](../backend/lib/managementPlanning.ts); ADMIN-only GET. Review classifications are browser-session drafts, not operational database state. |
| Dormant managed offers | [api/management-assignments](../backend/app/api/management-assignments/route.ts) | [managementAssignments.ts](../backend/lib/managementAssignments.ts), [041](../backend/migrations/041_management_assignment.sql), [042](../backend/migrations/042_management_offer_reliability.sql). Both assignment gates must remain off. |
| Established company calendar | [frontend/commercial-calendar.js](../frontend/commercial-calendar.js) | [api/commercial-calendar](../backend/app/api/commercial-calendar/route.ts), [036](../backend/migrations/036_commercial_calendar_workload.sql); reservations, holds, revisions and installation preparation. |
| Commercial operating actions | [frontend/commercial-operations.js](../frontend/commercial-operations.js) | [api/commercial-operations](../backend/app/api/commercial-operations/route.ts), [032](../backend/migrations/032_commercial_operations.sql), [036](../backend/migrations/036_commercial_calendar_workload.sql). Not the new read-only adapters. |
| Existing separate Dispatch | [frontend/dispatch.html](../frontend/dispatch.html) | Existing [admin_jobs_list](../backend/app/api/admin_jobs_list/route.ts), [admin_pros_list](../backend/app/api/admin_pros_list/route.ts), and established Dispatch handlers. Comparison/reference surface, not replaced by a second scheduler. |
| Customer schedule changes | [api/customer_reschedule](../backend/app/api/customer_reschedule/route.ts) | Existing order/job scheduling contract; known legacy status incompatibilities are documented in [Phase 5](UNIFIED_OPERATIONS_PHASE_5.md). |
| Identity and payout investigation | [Phase 4 report](UNIFIED_OPERATIONS_PHASE_4.md) | [042 reviewed links](../backend/migrations/042_management_offer_reliability.sql); Dispatch directory identity, portal identity and legacy payout jobs are distinct. |

## Field Sales, customer intake and assessments

| Purpose | Primary entry point | Dependencies / boundary |
|---|---|---|
| Phone-first salesperson workspace | [frontend/field-sales.js](../frontend/field-sales.js) | [field-sales.css](../frontend/field-sales.css), dashboard shell; prospects, follow-ups, configurable assessments, photos and opportunities. |
| Sales accounts, ownership and assessment commands | [api/field-sales](../backend/app/api/field-sales/route.ts) | [fieldSales.ts](../backend/lib/fieldSales.ts), [043](../backend/migrations/043_field_sales.sql); ADMIN management, SALES own-record scope, revision checks and idempotent commands. |
| Private assessment photographs | [api/field-sales-photos](../backend/app/api/field-sales-photos/route.ts) | Same ownership/consent boundary; private storage, guarded retrieval and synthetic fixture coverage. These are not automatically public marketing media. |
| Shared Customer Queue | [frontend/dash.js](../frontend/dash.js) | `commercialQueue` tab and projection in [api/v1](../backend/app/api/v1/route.ts). Shared `commercial_leads`; residential records carry market attribution. |
| Commercial public intake | [frontend/commercial.html](../frontend/commercial.html) | [commercial.js](../frontend/commercial.js), [commercial.css](../frontend/commercial.css), [api/commercial-intake](../backend/app/api/commercial-intake/route.ts), [commercial_consultation.js](../backend/lib/commercial_consultation.js). |
| Residential public intake | [frontend/residential.html](../frontend/residential.html) | [residential.js](../frontend/residential.js), [residential.css](../frontend/residential.css), [api/residential-intake](../backend/app/api/residential-intake/route.ts), [residential_inquiry.ts](../backend/lib/residential_inquiry.ts). |
| Returning customer / staff inquiry workspace | [frontend/residential-workspace.js](../frontend/residential-workspace.js) | [api/residential-workspace](../backend/app/api/residential-workspace/route.ts), [residential_workspace.ts](../backend/lib/residential_workspace.ts), [038](../backend/migrations/038_residential_workspace.sql). |
| Residential review | [frontend/residential-review.html](../frontend/residential-review.html) | [residential-review.js](../frontend/residential-review.js), [api/residential-review](../backend/app/api/residential-review/route.ts); token/authorization boundaries remain distinct from sales ownership. |
| Shared address entry | [frontend/address-autocomplete.js](../frontend/address-autocomplete.js) | Optional browser-restricted Places key, manual fallback, address/unit normalization. Selection is not coverage, availability or booking proof. [040](../backend/migrations/040_residential_address_guards.sql) is review-only and not enrolled in the migration runner. |
| Residential attribution | [frontend/residential-tracking.js](../frontend/residential-tracking.js) | Whitelisted attribution and existing tracking endpoint; no new CRM. [residential_inquiry.ts](../backend/lib/residential_inquiry.ts) separates tracking from business idempotency. |
| Existing business tools | [frontend/commercial-business.js](../frontend/commercial-business.js) | [api/commercial-business](../backend/app/api/commercial-business/route.ts), [commercial_business.ts](../backend/lib/commercial_business.ts), [035](../backend/migrations/035_commercial_business_tools.sql). |

## Quotes, agreements, Stripe and pricing

| Purpose | Primary entry point | Dependencies / boundary |
|---|---|---|
| Sales and management transaction UI | [frontend/field-commerce.js](../frontend/field-commerce.js) | Mounted within Field Sales, not a separate CRM; quotes, approval, agreement/payment/order visibility. |
| Server pricing authority | [backend/lib/fieldQuote.ts](../backend/lib/fieldQuote.ts) | Integer cents, approved/published catalog snapshots, configurable quantities/options/qualification and immutable revisions. Frontend totals are not authoritative. |
| Transaction commands | [api/field-sales-transactions](../backend/app/api/field-sales-transactions/route.ts) | [fieldCommerce.ts](../backend/lib/fieldCommerce.ts), [044](../backend/migrations/044_field_sales_transactions.sql); ownership, approval and transaction gates. |
| Customer agreement | [frontend/field-agreement.html](../frontend/field-agreement.html) | [field-agreement.js](../frontend/field-agreement.js), [api/field-sales-agreement](../backend/app/api/field-sales-agreement/route.ts); exact quote hash, policy version, acceptance and expiry. Legal/delivery approval remains a blocker. |
| New test-only payment bridge | [api/field-sales-stripe-webhook](../backend/app/api/field-sales-stripe-webhook/route.ts) | [fieldCommerce.ts](../backend/lib/fieldCommerce.ts), [fieldStripeRouting.ts](../backend/lib/fieldStripeRouting.ts); canonical provider verification, idempotent events and orders. No live-key support. |
| Existing Stripe webhook | [api/stripe-webhook](../backend/app/api/stripe-webhook/route.ts) | Preserves legacy processing; signed field-sales events have a separate flow discriminator. Do not route new payments into old fulfillment inadvertently. |
| Current storefront | [frontend/bundles.html](../frontend/bundles.html) | [bundles.js](../frontend/bundles.js), [api/bundles-data](../backend/app/api/bundles-data/route.ts); backend also has existing public bundle assets. Not interchangeable with the offline comprehensive pricing proposal. |
| Comprehensive proposed pricing | [config/pricing/home2smart.v2.json](../config/pricing/home2smart.v2.json) | [v1 baseline](../config/pricing/home2smart.v1.json), [baseline schema](../config/pricing/baseline.schema.json), [pricing README](../config/pricing/README.md). Neither file is publication approval. |
| Proposed equipment / camera configurations | [equipment.v1.json](../config/pricing/equipment.v1.json) | [equipment schema](../config/pricing/equipment.schema.json), [residential-cameras.v1.json](../config/pricing/residential-cameras.v1.json), [camera schema](../config/pricing/residential-cameras.schema.json); proposed prices, supplier assumptions and inactive offers stay inactive. |
| Draft catalog preparation | [backend/tools/prepare_field_sales_catalog.cjs](../backend/tools/prepare_field_sales_catalog.cjs) | GET-only/supplied-snapshot preparation; draft output, not a catalog publication command. |

Commerce relationships: `commercial_leads.lead_id` -> `field_sales_opportunities`
-> versioned `field_sales_quotes` -> `field_sales_agreements` ->
`field_sales_checkouts` / `field_sales_payment_events` -> `field_sales_orders`
-> `h2s_orders.id`. Fulfillment is explicit management review, not automatic
assignment or a commission/payout pipeline.

## Owner uploads and public media

- Owner capture/library UI: [frontend/owner-media.js](../frontend/owner-media.js)
  and [owner-media.css](../frontend/owner-media.css).
- Placement and page consumers: [media-placements.js](../frontend/media-placements.js),
  [media-page-heroes.js](../frontend/media-page-heroes.js) and
  [residential-media.js](../frontend/residential-media.js).
- ADMIN placement boundary: [api/admin/media-placements](../backend/app/api/admin/media-placements/route.ts).
  Full storage/association contracts are in
  [OWNER_UPLOADS_ENGINE.md](OWNER_UPLOADS_ENGINE.md) and
  [OWNER_UPLOADS_LIBRARY_WIRING.md](OWNER_UPLOADS_LIBRARY_WIRING.md).
  Private sales assessments are not automatically approved public proof.

## Technician dependencies: preserve, do not redesign

- Existing UI: [backend/public/portal.html](../backend/public/portal.html).
- Existing contracts: [portal_login](../backend/app/api/portal_login/route.ts),
  [portal_me](../backend/app/api/portal_me/route.ts),
  [portal_jobs](../backend/app/api/portal_jobs/route.ts),
  [portal_accept](../backend/app/api/portal_accept/route.ts),
  [portal_decline](../backend/app/api/portal_decline/route.ts),
  [portal_availability](../backend/app/api/portal_availability/route.ts),
  [portal_mark_done](../backend/app/api/portal_mark_done/route.ts),
  [portal_payouts](../backend/app/api/portal_payouts/route.ts).
- Shared legacy orchestration: [dataOrchestration.ts](../backend/lib/dataOrchestration.ts).
  Its preserved commercial-context experiment does not establish a reviewed
  Dispatch-to-legacy payout mapping; see the activation warning in the handoff.
- [TECHNICIAN_APP_ROADMAP.md](TECHNICIAN_APP_ROADMAP.md) is planning context,
  not authorization to change the portal or purchase software.

## Migrations and validation entry points

- Read [DATABASE_MIGRATIONS.md](DATABASE_MIGRATIONS.md) before considering
  [apply_migration_pg.js](../backend/apply_migration_pg.js).
  Presence of a SQL file is not authorization to apply it.
- Relevant sequence: [032](../backend/migrations/032_commercial_operations.sql)
  operations; [035](../backend/migrations/035_commercial_business_tools.sql)
  business tools; [036](../backend/migrations/036_commercial_calendar_workload.sql)
  calendar; [037](../backend/migrations/037_residential_inquiries.sql) intake;
  [038](../backend/migrations/038_residential_workspace.sql) workspace;
  [039](../backend/migrations/039_notification_routing.sql) routing preferences;
  [040](../backend/migrations/040_residential_address_guards.sql) draft address guards;
  [041](../backend/migrations/041_management_assignment.sql)/[042](../backend/migrations/042_management_offer_reliability.sql)
  managed offers/reviewed links; [043](../backend/migrations/043_field_sales.sql)
  Field Sales; [044](../backend/migrations/044_field_sales_transactions.sql)
  transactions.

| Validation area | Exact test entry points |
|---|---|
| Operations / scheduling / assignment | [management_operations.test.cjs](../backend/tests/management_operations.test.cjs), [management_planning.test.cjs](../backend/tests/management_planning.test.cjs), [management_assignments.test.cjs](../backend/tests/management_assignments.test.cjs), [managed_offer_response.test.cjs](../backend/tests/managed_offer_response.test.cjs), and corresponding API/UI suites in [backend/tests](../backend/tests). |
| Sales / ownership / photographs | [field_sales.test.cjs](../backend/tests/field_sales.test.cjs), [field_sales_ui.test.cjs](../backend/tests/field_sales_ui.test.cjs). |
| Quotes / agreements / payment reconciliation | [field_commerce.test.cjs](../backend/tests/field_commerce.test.cjs), [field_commerce_ui.test.cjs](../backend/tests/field_commerce_ui.test.cjs), [stripe_order_metadata.test.cjs](../backend/tests/stripe_order_metadata.test.cjs). |
| Intake / address / tracking | [residential_funnel.test.cjs](../backend/tests/residential_funnel.test.cjs), [shared_address.test.cjs](../backend/tests/shared_address.test.cjs), [residential_tracking.test.cjs](../backend/tests/residential_tracking.test.cjs), [commercial_contact.test.cjs](../backend/tests/commercial_contact.test.cjs). |
| Dashboard / media | [dashboard_controls.test.cjs](../backend/tests/dashboard_controls.test.cjs), [dashboard_presentation.test.cjs](../backend/tests/dashboard_presentation.test.cjs), [media_placements.test.cjs](../backend/tests/media_placements.test.cjs), [media_refresh.test.cjs](../backend/tests/media_refresh.test.cjs). |
| Fixtures, not external runtime proof | [field_commerce_fixture.cjs](../backend/tests/helpers/field_commerce_fixture.cjs), [commercial_operations_fixture.cjs](../backend/tests/helpers/commercial_operations_fixture.cjs); in-memory PGlite and stubbed dependencies. |
| Pricing | [validate.cjs](../config/pricing/validate.cjs), [pricing package scripts](../config/pricing/package.json). |
| Safe synthetic visual review | [tools/dev-review/server.cjs](../tools/dev-review/server.cjs), [bootstrap.js](../tools/dev-review/bootstrap.js). Manual local invocation only; never imported by the production application. |

The backend's default `npm test` runs only the task-creator suite. Use the
broader offline command and external-database safeguards in the
[remote development review](REMOTE_DEVELOPMENT_REVIEW.md).
