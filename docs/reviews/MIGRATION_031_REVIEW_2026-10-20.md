# Migration 031 review package

## Subsequent authorized rollout

The owner subsequently approved the ordered production rollout. Security/build
deployment `dpl_6ngVyygN8t8FeEXP3V4pkemwxJrK` was verified live; six explicitly
approved unsafe legacy deployments were retired and their 300-second invocation
drain completed. The exact reviewed migration 031 was applied at
2026-10-20 05:23:32 UTC and independently verified with trusted TLS. Reliability
backend `dpl_7xaUuKubemNVifgojqDsEu6JqXSr` and frontend
`dpl_9gDXuHnYX83Ukkfqtm6vsFacvGpa` are now live. Canonical commercial routing
and the root approval-script asset were included as minimum local prerequisites.
The owner separately approved the existing 15-minute commercial maintenance
schedule; it is registered in the final backend without replacing owner-media
reminders. Final isolated validation passed 113 tests, type checking, and the
85-page production build. Live source/schema/HTTP checks passed; browser
navigation timed out, and real provider delivery was not tested.
See [current migration documentation](../DATABASE_MIGRATIONS.md) for current
authorization, live checks and rollback limitations.

The report below preserves the **historical pre-rollout review**, including the
then-unapproved state and blockers; it is not the current deployment status.

**Disposition: prepared and locally validated, NOT authorized or applied.**
Revision 2 replaces the metadata-only email exception with a real foreign key
and narrow appointment write guards. The redundant appointment-key index is
removed. The two ordered selective application snapshots are validated below.
**Production application remains blocked:** read-only Vercel inspection found
that the active backend still contains runtime DDL and permissive policy setup.
This report does not authorize its replacement or migration application.

Branch: `retro-dev`.
Base HEAD: `a32351104463c2eff679f2368836cd9ae870b044`.
Live inspection: October 20, 2026 (UTC), PostgreSQL 17.6, project
`nkccbnrduojnzjfrpwva`, explicitly classified **production** and shared by
development/production. No customer rows or attachments were downloaded.
All live queries used verified TLS and `BEGIN READ ONLY` / `ROLLBACK`.

No staging, commits, push, deployment, hosting changes, live test writes, real
notifications, appointment creation, or migration application were performed.
The production authorization still covers only migrations 029 and 030.

## 1. Exact original 36-file scope

Paths are repository-relative. A = build prerequisites; B = reliability.
Mixed files mean selected changes only, not whole working-tree files.

| # | Path | Proposed ownership |
|---|---|---|
| 1 | `.gitignore` | B: unignore only migration 031 |
| 2 | `backend/app/api/commercial-consultation-maintenance/route.ts` | B |
| 3 | `backend/app/api/commercial-consultation/route.ts` | B |
| 4 | `backend/app/api/commercial-intake/photo/route.ts` | B |
| 5 | `backend/app/api/commercial-intake/route.ts` | B |
| 6 | `backend/app/api/create_jobs_from_orders/route.ts` | A |
| 7 | `backend/app/api/portal_announcements_create/route.ts` | A |
| 8 | `backend/app/api/portal_announcements_delete/route.ts` | A |
| 9 | `backend/app/api/portal_announcements_update/route.ts` | A |
| 10 | `backend/app/api/portal_customer_history/route.ts` | A |
| 11 | `backend/app/api/portal_customers/route.ts` | A |
| 12 | `backend/app/api/portal_mark_done/route.ts` | A |
| 13 | `backend/app/api/portal_signup_step1/route.ts` | A |
| 14 | `backend/app/api/schedule-appointment/route.ts` | B: prevent commercial bypass |
| 15 | `backend/app/api/test-token/route.ts` | A |
| 16 | `backend/app/api/v1/route.ts` | A: type fixes; B: queue/timezone/admin recovery |
| 17 | `backend/lib/commercial_consultation.js` | B |
| 18 | `backend/lib/commercial_consultation_runtime.ts` | B |
| 19 | `backend/next.config.js` | A: enforce type checking only |
| 20 | `backend/package-lock.json` | A: pg declaration dependency |
| 21 | `backend/package.json` | A: pg declaration dependency only |
| 22 | `backend/tests/commercial_consultation.test.cjs` | B |
| 23 | `backend/tests/commercial_contact.test.cjs` | B |
| 24 | `backend/tests/commercial_protection.test.cjs` | B |
| 25 | `backend/tests/helpers/commercial_contact_fixture.cjs` | B |
| 26 | `backend/tools/validate-commercial-readiness.cjs` | B |
| 27 | `docs/DATABASE_MIGRATIONS.md` | B |
| 28 | `frontend/commercial-approval.js` | B |
| 29 | `frontend/commercial.html` | B: upload limits/types only |
| 30 | `frontend/commercial.js` | B: save/draft/submit/upload/error/timezone changes only |
| 31 | `frontend/dash.js` | B: commercial recovery/attention/timezone changes only |
| 32 | `package-lock.json` | B: embedded PostgreSQL dependency only |
| 33 | `package.json` | B: embedded PostgreSQL dependency only |
| 34 | `backend/migrations/031_commercial_reliability.sql` | B |
| 35 | `backend/tests/commercial_reliability.test.cjs` | B |
| 36 | `backend/tests/commercial_reliability_sql.test.cjs` | B |

### Review-preparation additions, not part of the original 36

1. `backend/apply_migration_pg.js`: register review-only 031, preserve media
   fingerprints/history, verify pending and applied commercial states, and
   enforce authorization in programmatic apply as well as the CLI.
2. `backend/migration-targets.json`: separate commercial baseline/SQL checksums
   and `reviewOnly: true`. Existing authorization/list/media hashes unchanged.
3. `backend/lib/commercial_migration_review.cjs`: scoped catalog capture,
   read-only duplicate preflight, baseline and post-application assertions.
4. `backend/migration-baselines/031_commercial_reliability.json`: generated
   non-secret production catalog baseline; no customer records.
5. `backend/tests/migration_runner.test.cjs`: authorization, baseline, checksum,
   drift and zero-database-call rejection tests.
6. `docs/reviews/MIGRATION_031_REVIEW_2026-10-20.md`: this review.

Total proposed distinct paths including this preparation: **42**. A touches
13; B touches 30; `backend/app/api/v1/route.ts` is shared between them.

Revision 2 changes only these six already-proposed paths:

1. `backend/migrations/031_commercial_reliability.sql`: typed relationship,
   consistency/email CHECKs, narrow write guards, scoped insertion/reuse and
   removal of the proposed redundant index.
2. `backend/lib/commercial_migration_review.cjs`: verify the new column, FK,
   CHECKs, exact enabled guards/function/permissions, global uniqueness and
   legacy-link reconciliation preflight.
3. `backend/tests/commercial_reliability_sql.test.cjs`: production-schema
   role/relationship/failure-recovery regression coverage; minimal fixture now
   includes the actual global unique order-key constraint.
4. `backend/migration-targets.json`: updated reviewed SQL checksum only;
   review-only status and media-only authorization remain unchanged.
5. `docs/DATABASE_MIGRATIONS.md`: explain the revised invariants and known
   deployed-code blocker.
6. `docs/reviews/MIGRATION_031_REVIEW_2026-10-20.md`: this revised report.

No new dependency/package-lock change was required for these blocker fixes.

Unrelated Owner Uploads, media, dashboard login availability, all-leads,
commercial marketing/copy/layout, CSS, Supabase configuration/client changes,
hosting configuration, development memory settings, and root Supabase dependency
upgrades remain excluded. The existing manual-save button is retained in the
selective snapshot; the separate uncommitted clear-draft UI is not required.

## 2. Complete SQL and immutable review identity

The complete, unabridged SQL is
[031_commercial_reliability.sql](../../backend/migrations/031_commercial_reliability.sql).
The downloadable review package includes that exact file, not just excerpts.

- Normalized-LF SQL SHA-256:
  `c0e2425df45f7bea99fa6d45dc9becd0dd99ccac80cee95417c8add00de1b071`.
- Independent commercial catalog SHA-256:
  `71162e1e734c077c45d6415d1e0d2849485fd38daf2ceefb6660a2011f88e907`.
- The applied 029/030 SQL, checksums and media baseline/security fingerprints
  were not changed.

The initial review also corrected inherited grants: revoke inherited
`service_role` table privileges on the **new** effect table before granting
SELECT/INSERT/UPDATE. Production's actual default privileges grant ALL on new
tables to API roles. Merely granting a smaller set would not remove DELETE,
TRUNCATE, REFERENCES, TRIGGER or MAINTAIN inherited at creation. No existing
table's privileges are changed.

## 3. Every database change

### Columns and existing records

| Object | Change | Existing-row and compatibility effect |
|---|---|---|
| `commercial_leads.revision` | New bigint NOT NULL DEFAULT 0 | Existing leads read as revision 0. PostgreSQL's constant fast default avoids a normal heap rewrite. No customer data is merged or replaced. |
| `commercial_leads.last_save_key` | New nullable text | Existing leads start NULL; future saves persist the replay identity. |
| `commercial_leads.last_submitted_at` | Drop NOT NULL, retain existing default | Existing timestamps are not cleared or reclassified. New RPC draft inserts explicitly store NULL; submission sets the timestamp. Older writers can still stamp drafts. |
| `commercial_consultation_requests.submission_key` | New nullable text | Existing requests start NULL. Existing active requests are reused by the RPC; no synthetic keys are backfilled. |
| `h2s_orders.commercial_request_id` | New nullable UUID foreign key to `commercial_consultation_requests.request_id` | Existing noncommercial rows receive NULL. No guessed links or backfill. Referenced requests must actually exist on insert and update. Default NO ACTION prevents orphaning an appointment by deleting its request. |
| `h2s_orders.customer_email` | Drop NOT NULL and add the CHECK below | No existing emails are changed. Noncommercial null email remains rejected. Only a relationally linked commercial appointment qualifies. |

`h2s_orders_email_required_except_commercial` permits NULL only with a non-null
typed request link. The separate `h2s_orders_commercial_link` CHECK requires
that UUID, `APPT-COM-<UUID>` order key and metadata request ID agree. Missing,
SQL NULL or JSON null metadata cannot pass through CHECK's unknown-value rule.
A noncommercial row must have no typed link, reserved commercial key or request
metadata marker. Invented metadata does not qualify even with a supplied email.
Existing NOT NULL never validated email syntax; application validation continues
to do that. Approval/consent/window validation is performed by the sole allowed
service-role commercial appointment RPC, not claimed as a foreign-key property.

### Indexes and constraints

- `commercial_one_active_request`: unique partial index on request `lead_id`
  for pending, approved, customer_confirmed, escalated and reschedule_requested.
  Preflight raises on existing active duplicate groups without deleting or
  merging them. Declined/expired/cancelled history is not removed.
- `commercial_submission_key`: unique `(lead_id, submission_key)` only where
  the key is non-null. Existing NULL keys are excluded.
- No `commercial_appointment_order_key` index is created. Production's existing
  validated global `h2s_orders_order_id_key UNIQUE(order_id)` and valid backing
  index already prevent duplicate deterministic keys. The typed-link CHECK
  ensures one deterministic key per request. Existing indexes are preserved.
- `h2s_orders_commercial_request_id_fkey` and
  `h2s_orders_commercial_link` enforce existence and consistent identity on
  both inserts and updates; existing linked identity cannot be reassigned.
- `commercial_effects_pkey`: primary key `(request_id, kind)`, also creating
  its unique backing index.
- `commercial_effects_request_id_fkey`: request foreign key with default
  NO ACTION, not ON DELETE CASCADE. Once effects exist, parent request deletion
  (including a lead deletion cascading to requests) can be blocked. Define a
  separate retention/deletion procedure rather than silently losing the ledger.
- `commercial_effects_state_check`: processing, accepted, failed or uncertain.
- The order email CHECK is validated during this migration, scanning existing
  orders. Current read-only null-email and duplicate preflights are all zero.

### New effect table

`commercial_effects` starts empty. It contains UUID `request_id`, text `kind`,
text `state`, JSONB `details` DEFAULT `{}`, and timestamptz `updated_at`
DEFAULT now(); all are NOT NULL. Its key prevents two independent claims of the
same effect. Details hold provider acceptance/failure/audit metadata, not a
claim of delivery or customer acknowledgement.

Existing request timestamps and workflow metadata are not backfilled into this
table. The runtime recognizes an existing customer-confirmation timestamp and
does not resend that confirmation merely because the new ledger is empty.
Other historical effects require contextual review rather than inventing
provider outcomes. There is no generic automatic reconciliation of old sends.

### Eight RPCs, one trigger function, two new triggers

All are SECURITY INVOKER with fixed `search_path=public,pg_temp`, public-qualified
application tables and volatile behavior. No SECURITY DEFINER function is
introduced.

| Function / signature | Transactional behavior |
|---|---|
| `commercial_save_lead(text,bigint,text,jsonb)` | Advisory lock by public token and row lock; revision compare-and-swap; replay last key; insert/update one lead. Updates preserve concurrent attachments and last submission. Conflict returns authoritative lead instead of overwriting it. |
| `commercial_submit_request(uuid,text,jsonb)` | Advisory lock by lead; replay keyed or already-active request; otherwise insert one request and stamp lead submission together. |
| `commercial_reschedule_request(uuid,uuid,text,text,jsonb)` | Row lock; reschedule-key replay; guard expected token/status/no linked order; replace requested windows and approval token, reset response/reminders and merge metadata. New token invalidates the previous link for that rescheduled request. |
| `commercial_claim_effect(uuid,text)` | Insert processing or reclaim only failed; processing/accepted/uncertain cannot be reclaimed automatically. Mirror processing into request workflow metadata. |
| `commercial_finish_effect(uuid,text,text,jsonb)` | Finish only a processing claim or raise; persist result and mirror it into request workflow. |
| `commercial_attach_photo(uuid,text)` | Lock lead; replay identical URL; reject a ninth attachment; append atomically. |
| `commercial_create_appointment(uuid)` | Lock request; require approved/customer_confirmed consenting text request and a future supported weekday 30-minute Eastern window; reuse a correctly linked/deterministic appointment or insert one with the typed UUID; link request and clear appointment error together. Missing or mismatched existing links raise for reconciliation. Set a request-bound transaction-local write scope only around insertion and restore the prior setting. A failed statement rolls back insertion, request linkage and scope changes. |
| `commercial_record_appointment_error(uuid,text)` | Merge appointment error without replacing other workflow metadata. |
| `commercial_protect_appointment()` returns trigger | Reject anon/authenticated writes to OLD or NEW commercial rows; reject generic service-role writes outside the scoped commercial RPC; protect linked UUID/order/request identity; deny API-role TRUNCATE before statement execution. |

The RPCs trust their service-role caller to perform public-token, contact-format
and server-owned dispatch checks; they are not a new public authorization API.
The appointment RPC additionally rejects manual follow-up, call/email preference
and missing boolean SMS opt-in itself.

Existing triggers were read from production, including their function bodies:
`trg_commercial_leads_touch_updated_at`,
`trg_commercial_consultation_requests_touch_updated_at`, and
`update_h2s_orders_updated_at`. They only assign `updated_at=now()` and return
NEW, do not inspect email, and remain unchanged. Baseline verification includes
their definitions, enabled state, function bodies and security configuration.

The new `commercial_appointment_write_guard` is BEFORE INSERT/UPDATE/DELETE,
FOR EACH ROW on orders. Checking OLD as well as NEW prevents clearing markers
to escape protection. `commercial_appointment_truncate_guard` is BEFORE TRUNCATE,
FOR EACH STATEMENT; a row trigger alone would not cover that existing grant.
TRUNCATE is denied to all three API roles even when the table is empty. Ordinary
noncommercial SELECT/INSERT/UPDATE/DELETE and existing grants/RLS are unchanged.
The public application has no legitimate table-wide truncation path; the
separate project-cloning tool uses a direct owner connection, not an API role.

The guard checks both `current_user` and the actual `SET ROLE` setting so a
SECURITY DEFINER wrapper running as owner cannot hide its anon/authenticated
API caller. JWT claims are not used as database-role authentication. A spoofed
custom GUC does not let anon/authenticated through. The request-bound GUC is an
internal service-role scope, **not a secret or a new authentication credential**:
trusted database owners or privileged arbitrary SQL can still set it or change
the schema. No public arbitrary-SQL or set-config RPC is added.

## 4. Nullable email: justification, resolved blockers and consumers

Email-only and call-first requests are manual follow-up and do not create
appointments. The actual reason for nullable appointment email is a valid
**phone-only, text-first customer with explicit SMS permission**. Inventing a
placeholder email would falsify contact information and could misroute mail.
The normal commercial RPC produces `APPT-COM-<request UUID>` and matching request
metadata and a typed foreign key, then links the existing request atomically.

### Original blockers resolved in the prepared SQL

1. A nonexistent UUID fails the real request foreign key. Metadata-only,
   inconsistent and missing-marker attempts fail independently of email.
2. Production orders retain **RLS disabled** and broad existing grants, but
   narrow triggers deny anon/authenticated commercial writes. Generic privileged
   HTTP handlers also cannot write these rows without the scoped appointment RPC.
3. The redundant partial order-key index is removed; the inspected global
   constraint and backing index remain the uniqueness authority.

Fresh live read-only aggregates found zero commercial requests, zero orders
with the reserved key/metadata marker, and zero non-null request order links.
Both runner preflight and SQL stop if a legacy commercial footprint appears
before application. They do not invent a backfill, rewrite orders or delete data.
The original unrestricted noncommercial write boundary is not broadly repaired
or represented as secure by this narrow migration.

### Focused tests performed locally

- Valid approved/consenting text request with no email creates one real local
  SQL appointment; repeated creation reuses its UUID/order.
- Noncommercial NULL email, a deterministic-looking key without request
  metadata, and mismatched key/metadata are rejected.
- Nonexistent typed links, invented metadata, marker-only rows and mismatched
  links fail on inserts and updates under the production-schema fixture.
- Anon/authenticated insert/update/unlink/delete attempts fail, including a
  spoofed scope GUC and an owner-executing SECURITY DEFINER wrapper.
- Generic service-role commercial writes and API-role TRUNCATE fail; existing
  noncommercial CRUD and required email remain usable for each API role.
- A historical noncommercial APPT row seeded before migration survives with all
  original values unchanged; legacy-shaped APPT rows retain CRUD for all three
  API roles, not just ordinary checkout order keys.
- An injected SQL insert failure leaves no appointment or request link and
  restores the outer scope; retry, lost-response replay and missing-link recovery
  reuse the same appointment. A corrupt unrelated link fails rather than adopts
  an unrelated order. Parent request deletion cannot orphan the appointment.
- Actual SQL appointment creation rejects email/call preference and false
  texting consent, including retries against an already-linked appointment.
- Existing fixture tests cover public/API contact validation and manual-request
  exclusion from approval, appointment and reminder processing.
- Existing-column/default/trigger compatibility and transaction rollback are
  tested against a schema reconstructed from the read-only production catalog.

### Downstream consumers inspected

| Consumer | Effect of no email / verification boundary |
|---|---|
| `backend/app/api/schedule-appointment/route.ts`, generic POST/existing-order mode | Generic POST still requires name/email/phone and rejects commercial payloads. The existing-order service-client write is now also protected by the database guard, before subsequent dispatch. Not a fallback for commercial creation or editing. |
| `backend/app/api/customer_reschedule/route.ts`, `backend/app/api/schedule_confirm/route.ts` | Public HTTP routes use service clients, so checking only anon at the database was insufficient. Their commercial order UPDATE now fails explicitly before dispatch/message updates; noncommercial SQL behavior is retained. A future legitimate commercial reschedule/edit requires its own administrator-authorized, validated RPC, not reopening generic writes. |
| `backend/app/api/shop/route.ts`, `backend/app/api/stripe-webhook/route.ts` | Checkout generates ordinary order keys and requires email. The webhook verifies Stripe's signature but uses an anon Supabase client. Both retain noncommercial writes; commercial markers cannot be forged through their existing order writes. No real Stripe request was sent. |
| `backend/tools/backfill_orders_to_jobs.js`, geocoding tools | Generic service-role metadata/address writes are not an approved commercial editing path and will now be rejected for commercial rows. The legacy backfill creates jobs before an unchecked metadata update, so it must not be used to reconcile new commercial appointments. If needed, a separate small integration should exclude commercial rows before side effects or provide an explicitly authorized commercial job-link RPC. No backfill/geocoding tool was run. |
| `backend/app/api/customer_orders/route.ts` | Queries by email or checkout session ID. A null-email commercial appointment has no checkout session set by the new RPC, so generic email/session order history will not identify it. Commercial token status/queue remain separate. |
| `backend/app/api/shop/route.ts` | Email-filtered account/order lookups do not match null-email rows; no phone-linked customer-account history was added. |
| `backend/app/api/customer_photos/route.ts` | Email-based ownership checks cannot identify a customer with no email. No alternate ownership mechanism was implemented here. |
| `backend/app/api/portal_accept/route.ts`, `sendCustomerNotification` | Explicitly logs/skips if the job lacks customer email; no acceptance email is promised for these customers. |
| `backend/lib/dataOrchestration.ts`, post-completion review mail | Explicitly skips absent/invalid customer email. Null-safe normalization exists, but email-dependent follow-up is unavailable. |
| `backend/app/api/create_jobs_from_orders/route.ts`, `backend/lib/jobHelpers.js`, portal customer history | Contact normalization tolerates missing email and can use phone; history probes available schema columns. Live `h2s_dispatch_jobs` has no email-named column, so generic downstream job/mail support must not be inferred from a build or this order migration. No live job creation was tested. |
| `public.h2s_orders_view` | Definition simply projects customer_email with other order fields; no email filter or email-required computation. It will expose NULL to its callers. |
| `public.get_h2s_orders_revenue` | Read function simply selects order fields including email; no email-required operation. Downstream clients of its nullable result still need an approved integration check. |

No end-to-end production checkout history, technician dispatch, exports,
customer-photo authorization, email delivery or customer acknowledgement was
tested. Build success cannot establish those operational behaviors.

## 5. Permissions and RLS

- Existing commercial leads/requests: RLS enabled, FORCE RLS false, no policies.
  Existing broad API table grants remain but do not bypass default-deny RLS.
  Inspected anon/authenticated roles have neither SUPERUSER nor BYPASSRLS.
- Existing orders: RLS disabled, broad table/column grants unchanged.
  Narrow commercial row guards and API-role TRUNCATE protection are added.
  Existing anon/authenticated SELECT access, including future commercial rows,
  is not restricted by these write guards. This is not a privacy/RLS redesign.
- New effects: RLS enabled, FORCE RLS false, no policies. ALL table rights are
  revoked from PUBLIC/anon/authenticated/service_role, then only
  SELECT/INSERT/UPDATE are granted to service_role. Owner remains privileged.
- All nine functions (eight RPCs plus trigger function): ALL execution rights revoked from
  PUBLIC/anon/authenticated; EXECUTE granted to service_role (owner retains
  its rights). Actual inherited default grants are reproduced in local tests.
- `service_role` has BYPASSRLS in the inspected project. Invoker functions do
  not grant anonymous callers that role or bypass application authorization.
- The explicit public/pg_temp path is fixed; implicit pg_catalog lookup remains
  in effect. Live public-schema CREATE is denied to anon/authenticated.
- Existing default privileges, commercial policies/table/column ACLs, API-role
  flags and trigger definitions are fingerprinted. Post-verification also
  checks effective anon/authenticated/service-role routine and effect access.

## 6. Old code, new code and rollout

Read-only Vercel CLI 48.12.0 and authenticated deployment/file GETs identified
the production alias `h2s-backend.vercel.app`:

- Deployment: `dpl_5GYHkEYGTYER1Cz6BJmzUEziGZUT`, Ready, production, created
  October 15, 2026 at 21:53:46 UTC.
- Uploaded-source Git metadata: `35391b66a6bbd62e777b00212d62132dc57af031`,
  ref `HEAD`, **gitDirty=1**. That SHA alone cannot reproduce this dirty upload.
- The actual uploaded runtime source was read, not inferred from that SHA.
  `src/lib/commercial_consultation_runtime.ts` defines
  `ensureCommercialConsultationTables` at line 46, table DDL at 53/89 and
  permissive policy recreation at 124/129 (`FOR ALL USING (true)`).
  It executes statements through `prisma.$executeRawUnsafe`.
- Uploaded `src/app/api/commercial-consultation-maintenance/route.ts` calls
  that function at line 33 and still accepts `x-vercel-cron: 1` at line 17.
  No live maintenance/request endpoint was invoked to test this dangerous path.
- Runtime source SHA-256:
  `416d2e04ac10636ad713d13b28afec5ec3a303cafe036cdcb53d2b2f52c479fd`.
  Maintenance source SHA-256:
  `f7ab56b06da3c9d44ffd78f73b3b90ecd8849d45414bc59f2ee2c7740d858bf5`.

This is a **confirmed deployment-order blocker**, not a missing-access guess.
Current live catalog inspection still shows default-deny commercial policies;
source presence does not prove that DDL is currently successful or has run.
Migration 031 cannot remove an active legacy server's Prisma SQL executor.
The frontend alias/revision and hosting environment values were not verified;
`home2smart.com` did not resolve as a deployment in the authenticated CLI scope.

| Code/database combination | Expected behavior |
|---|---|
| Old deployed code, before 031 | Existing behavior remains, including old concurrency/confirmation limitations. This review did not redeploy it. |
| Old deployed code, after 031 | **Not a supported rollout.** Legacy runtime can recreate permissive commercial policies. Old commercial appointment inserts lack the typed link/scoped RPC and fail; generic service-role edits are rejected. Old saves still do not advance revisions; racing request inserts can hit uniqueness errors. Noncommercial inserts retain their existing shape/email requirement. |
| New code, before 031 | Commercial write RPCs are missing. Routes fail explicitly with migration-required errors; no runtime DDL or silently unsafe fallback. Do not deploy this application scope before approved schema application. |
| New code, after 031 | Revision/replay RPCs, unique requests, effect claims and deterministic appointment linking become available. Appointment precedes booking confirmation; acceptance, delivery and acknowledgement remain separate. Pending/uncertain sends require reconciliation instead of automatic resend. |

Build commit A does not require 031; build success is not deployment approval
or proof that required hosting variables exist. Application commit B requires
A first and a separately approved migration/rollout plan.
Do not mix old commercial writers/maintenance with new writers and assume CAS
or effect-ledger guarantees apply to the old code. Coordinate the future cutover
and inspect legacy outstanding requests/provider history if present; do not
invent a production write pause or change hosting in this review.

Smallest future authorized sequence: deploy/verify the already-committed C01/C02/
C03 protections plus build prerequisite A (no 031 dependency); verify the live
uploaded sources no longer execute runtime DDL, check default-deny catalog and
account for in-flight old invocations; coordinate the commercial writer cutover;
separately authorize/apply/verify the exact reviewed 031; then deploy B. These
are proposed future actions only. B must not be deployed against missing RPCs,
and the known legacy deployment must not be left running through application.

Existing approval tokens are not globally expired or revoked by 031. Only an
explicit reschedule changes that request's response token. Historical tokens
still have no general automatic expiry/revocation mechanism.

## 7. Locks, transaction boundaries, failure recovery and rollback

The runner uses one transaction for pending SQL and ledger rows, takes a
transaction-scoped migration advisory lock, sets `lock_timeout=5s`, and uses
`statement_timeout=60000` on the client. Statement timeout is not a total
migration wall-clock guarantee.
The standalone SQL is supplied for inspection, not direct execution outside
the guarded runner's baseline checks, authorization and transaction.

ALTER TABLE takes ACCESS EXCLUSIVE locks. The two order CHECKs and new foreign
key validate existing orders; FK validation also locks the request relation.
Their scans and the ordinary, non-CONCURRENT unique index builds can block
application writes. Earlier ALTER locks remain until commit. Observed table
statistics were small, but are estimates and are not a duration/SLA guarantee.
Schedule a reviewed low-write cutover; do not assume an advisory lock stops old
application writers.

Existing active duplicates abort with an actionable error; unique index builds
also reject conflicting data. Current preflight counts are zero for active
duplicate groups, deterministic appointment duplicate groups, NULL order emails
and short legacy public tokens. Fresh commercial marker/request-link counts
are also zero. Re-run them at the authorized apply time.
No rows are automatically deduplicated, deleted, merged or token-rotated.

Baseline checks reject untracked same-name columns/indexes/functions/tables
before 031's IF NOT EXISTS / CREATE OR REPLACE statements can adopt or overwrite
them. Catalog, SQL checksum, access or verification failures roll back DDL and
ledger recording together. PostgREST cache reload NOTIFY is delivered only on
successful commit. A cache reload is not itself a verified live RPC request.

Each application RPC is atomic, but external SMS acceptance cannot be atomic
with its surrounding database transactions. A crash between provider acceptance
and ledger completion can leave processing/uncertain state and requires manual
provider reconciliation. This is not an exactly-once delivery guarantee.

Transactional DDL rollback was exercised locally. No destructive DOWN migration
was prepared. After commit and application writes, dropping functions/columns,
keys or effects can destroy replay/audit state; restoring NOT NULL will fail if
valid phone-only appointments now exist. Do not manufacture emails or remove
customer records to make rollback pass. Database rollback cannot unsend a
message, restore an old customer's understanding, or reverse an external action.
Any post-commit reversal needs a separately reviewed data-aware migration.

## 8. Runner changes and read-only commands

The old media snapshot scope and ledger `after_schema_sha256` semantics remain
unchanged; commercial objects use an independent baseline and explicit
post-migration structural/body/permission assertions. No old ledger rows are
edited or new ledger columns introduced. A future 031 ledger entry will retain
the media-scope digest, while commercial verification is performed separately.
The old 029/030-only runner cannot understand an added 031 history row; use the
updated runner after any future application.

Read-only, from repository root:

```powershell
node backend\apply_migration_pg.js inspect --target production
node backend\apply_migration_pg.js status --target production
node backend\apply_migration_pg.js verify --target production
```

Current verify result: `appliedHistoryVerified: true`, `verified: false`,
pending only `031_commercial_reliability.sql`,
`commercial031.state: reviewed_baseline_pending`, `applied: false`,
`authorized: false`. This is a verified pending baseline, not proof of migration
application or production readiness.

The CLI and exported `apply` both reject current authorization before any
database statement. No apply command was run against production. Tests exercise
rejection and a fictitious explicitly-authorized test target without granting
real production authorization.

Required migration configuration, outside Git:
`DATABASE_URL_DIRECT` and `MIGRATION_CA_CERT_PATH`, both present and usable for
this live read-only inspection. Configure them in ignored
`backend/.env.migrations.local`, ignored `backend/.env.local`, or the execution
environment. The database role must have schema-change authorization; an
application service-role key is not a migration credential.
No new migration secret or Supabase access token is needed.

## 9. Dependencies and exact proposed commit order

### A. `fix(build): restore strict backend type checking`

13 paths: the nine legacy API files marked A in the manifest,
`backend/app/api/v1/route.ts` type-only hunks, backend package/lock, and
`backend/next.config.js` type-check flag.

- Await and correctly unpack token/auth results; use existing token payload
  shapes; remove nonexistent corsHeaders references; fix dynamic-column generic
  instantiation and v1 tracking/assets/member-ID/fallback projection types.
- Disable the token diagnostic in production and remove token/service-key
  prefix output; this behavior change is explicit, not only a type adjustment.
- Set `ignoreBuildErrors: false`. Existing build-time ESLint skipping remains;
  no lint pass is claimed.
- Add backend dev dependency `@types/pg: ^8.23.1` and its single new backend
  lockfile package entry. The backend must build after an independent install;
  root-only declarations are not an adequate prerequisite.
- Exclude the unrelated memory-script changes and artifacts watcher change.
  Both proposed snapshots built with the existing 4096 MB script setting.

### B. `fix(commercial): make intake and consultation processing recoverable`

30 paths: the remaining original B scope (including v1's separate reliability
hunks), the five runner-preparation files, and this review.

- Include prepared 031, application changes, queue recovery, contact/protection/
  reliability fixtures/tests and directly related documentation together.
- Add root dev dependency `@electric-sql/pglite: ^0.5.10`, resolved 0.5.10,
  for actual embedded PostgreSQL execution of complete 031 and permissions.
  Its package has no new transitive dependencies in this lockfile.
- Only the root dev-dependency entry and PGlite lock entry are included.
  Unrelated `@supabase/ssr`, Supabase upgrades and their transitive lock churn are
  excluded; the snapshots install the HEAD-locked versions plus this dependency.

A must precede B because strict production builds of B need the legacy API/type
repairs and backend declarations. Both ordered snapshots pass independently of
excluded local work, so a single cohesive commit is **not required**. Neither
commit was created or staged, and preparing B is not authorization to migrate or
deploy it. Future database application remains blocked by the known active
legacy deployment in section 6 and requires separate explicit authorization.

## 10. Validation evidence and exact commands

Filesystem-only snapshots were exported from HEAD, then selected changes
overlaid without touching Git's index. A contains only A; B contains A plus B.
Clean dependency installs used:

```powershell
# In A root and backend, and B root, respectively:
npm ci --ignore-scripts --no-audit --no-fund
```

All three fresh installs passed. B reused A's clean backend dependency installation via a
junction because backend manifests/locks are identical; it did not use workspace
node_modules. Each root had its own clean locked install.

All `.env*` files were excluded from the snapshots. Inherited provider/database
credentials were removed; required variables used fixture-only invalid values.
Application tests/builds used a preload that rejects outbound sockets and
propagates through child processes, including build scripts overriding
NODE_OPTIONS. Prisma generation alone was bootstrapped with fixture credentials
as dependency tooling, without importing application code or migrating.

### A: exact test command, 83 passed

```powershell
node --test backend\tests\commercial_consultation.test.cjs backend\tests\commercial_contact.test.cjs backend\tests\commercial_protection.test.cjs backend\tests\migration_runner.test.cjs backend\tests\media_placements.test.cjs
```

### B: exact test command, 110 passed

```powershell
node --test backend\tests\commercial_consultation.test.cjs backend\tests\commercial_contact.test.cjs backend\tests\commercial_protection.test.cjs backend\tests\migration_runner.test.cjs backend\tests\media_placements.test.cjs backend\tests\commercial_reliability.test.cjs backend\tests\commercial_reliability_sql.test.cjs
```

The two SQL tests execute complete migration SQL inside embedded PostgreSQL:
one against a catalog-derived fixture with actual default grants, constraints,
indexes and trigger functions, and one exercising all eight RPCs on minimal
tables matching live types. Thirteen post-migration drift variants are rejected.
The catalog-derived test also rolls back the complete DDL and re-verifies the
original baseline. Other tests use local/fake transports and fixtures; they
are not live database or provider delivery tests.

The focused SQL command also passed in the current working tree: 11 tests,
including nine production-schema boundary/recovery subtests, zero failures.

```powershell
node --test backend\tests\commercial_reliability_sql.test.cjs
```

The commands above were executed under a session-owned outbound-network-blocking
Node preload. The exact isolated command arguments, exit statuses, source
hashes and logs are included in the downloadable evidence.

### Syntax: all commands below passed in both snapshots

```powershell
node --check frontend\commercial.js
node --check frontend\commercial-approval.js
node --check frontend\dash.js
node --check backend\lib\commercial_consultation.js
node --check backend\apply_migration_pg.js
node --check backend\tests\commercial_consultation.test.cjs
node --check backend\tests\commercial_contact.test.cjs
node --check backend\tests\commercial_protection.test.cjs
node --check backend\tests\migration_runner.test.cjs
node --check backend\tests\helpers\commercial_contact_fixture.cjs
node --check backend\tools\validate-commercial-readiness.cjs
node --check backend\next.config.js
```

B additionally passed:

```powershell
node --check backend\lib\commercial_migration_review.cjs
node --check backend\tests\commercial_reliability.test.cjs
node --check backend\tests\commercial_reliability_sql.test.cjs
```

### Strict types and production builds: both passed

From each snapshot's backend:

```powershell
node node_modules\prisma\build\index.js generate
node node_modules\typescript\bin\tsc --noEmit --incremental false --pretty false
npm run build
```

Both have zero TypeScript diagnostics, compile successfully, and generate
85/85 static pages. Validation supplies a fake legacy `SUPABASE_SERVICE_KEY`
as well as `SUPABASE_SERVICE_ROLE_KEY`, without changing application sources.
The clean snapshots deliberately retain the HEAD configuration requiring that
name rather than relying on the excluded local key-alias fallback. Which
variables are configured in hosting remains unverified.

B timezone commands, each selected Eastern-windows test passed:

```powershell
$env:TZ='Pacific/Honolulu'
node --test --test-name-pattern='Eastern windows' backend\tests\commercial_reliability.test.cjs
$env:TZ='Asia/Tokyo'
node --test --test-name-pattern='Eastern windows' backend\tests\commercial_reliability.test.cjs
```

Package-install warnings include the already-locked Next.js 14.2.18 advisory
and deprecated packages. No dependency-security upgrade or audit pass is claimed.

### Live read-only versus local evidence

Live: inspected 112 columns, existing constraints/indexes, owners/ACLs/RLS,
policies, default privileges, API role flags, three trigger functions, routine
name collisions, order-email dependent view/function and aggregate preflights.
No new effect table or any of the nine new routines exists in the baseline.
Media history verification passes unchanged.

Local: complete SQL execution, RPC behavior, privilege enforcement, rollback,
drift rejection, fixture frontend/backend behavior, timezone tests and builds.
No browser rerun was needed for this migration review. Previously completed
browser work is not recast as testing these selective snapshots.

Not verified: live migration execution, real concurrent PostgreSQL connections,
PostgREST schema-cache refresh/RPC invocation after application, provider
delivery, customer acknowledgement, hosting settings or downstream dispatch/
account/photo integrations with null-email commercial appointments.

Scoped patch whitespace, credential-pattern checks and source-preservation
results are included with the downloadable patch/validation evidence. Those
checks do not constitute an exhaustive secret/security audit.

## 11. Exact next action

Review the attached revised SQL, actual selective patches and validation
evidence. The relational-link, narrow write-boundary and redundant-index
blockers are resolved in prepared code, not production. Decide the separately
authorized rollout for replacing the known legacy backend before applying 031;
do not enable B or add production migration authorization yet.
Refresh the catalog baseline only if independently inspected, legitimate live
schema changes require reconciliation, never to make a mismatch disappear.
All unrelated working-tree changes remain local and unstaged.
