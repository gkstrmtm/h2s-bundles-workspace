# Guarded PostgreSQL migrations

The database runner uses `pg`, not application API keys or a custom SQL RPC.
Non-secret target configuration is in `backend/migration-targets.json`.
The workspace owner confirmed project `nkccbnrduojnzjfrpwva` is **production**
and authorized the two additive media migrations on 2026-10-16.
The owner separately authorized the ordered security-first production rollout
and reviewed migration 031 on 2026-10-20. Migration 031 was applied and verified
through this runner after the security deployment and legacy invocation drain.
This does not authorize arbitrary future migrations.

## Credentials and trusted TLS

Configure `DATABASE_URL_DIRECT` in the ignored `backend/.env.local` or the
terminal environment. Use the project's direct connection or session pooler
on port 5432, database `postgres`, with a schema-authorized database role.
The ignored `backend/.env.migrations.local` is also loaded for migration-specific
settings (without overriding the terminal environment). There is no fallback to
a different URL, MGMT connection, or production export.

Download the project's CA from Supabase Database Settings → SSL Configuration.
Keep it outside Git. Set `MIGRATION_CA_CERT_PATH` to its absolute path.
On this workstation the path is configured in that ignored migration-local
file and as a persistent Windows user environment variable, pointing to
`C:\Users\tabar\.postgresql\supabase-production-ca.crt`.
The local file works without restarting VS Code. An already-open PowerShell
can also load the user setting with:

```powershell
$env:MIGRATION_CA_CERT_PATH = [Environment]::GetEnvironmentVariable('MIGRATION_CA_CERT_PATH', 'User')
```

The runner validates the CA's type and expiry and verifies the server certificate
and hostname. URL SSL options cannot override this configuration.
`NODE_TLS_REJECT_UNAUTHORIZED=0` is rejected. Service-role/API keys are not
migration credentials. No Supabase access token is required for this workflow.

## Commands

From the repository root:

```powershell
node backend\apply_migration_pg.js inspect --target production
node backend\apply_migration_pg.js status --target production
node backend\apply_migration_pg.js apply --target production --confirm-project nkccbnrduojnzjfrpwva
node backend\apply_migration_pg.js verify --target production
node --test backend\tests\migration_runner.test.cjs backend\tests\media_placements.test.cjs
```

The opt-in database test exercises actual constraints and access checks using
temporary placement rows in a transaction that is always rolled back:

```powershell
$env:H2S_MEDIA_DB_TEST_TARGET = 'production'
$env:H2S_MEDIA_DB_TEST_PROJECT = 'nkccbnrduojnzjfrpwva'
node --test backend\tests\media_database.integration.test.cjs
```

Without those explicit test-target settings the integration test is skipped.

The equivalent `db:inspect`, `db:status`, `db:apply`, and `db:verify` npm scripts
run from `backend`; pass the same target/confirmation arguments after `--`.
Inspection, status, and verification run in a read-only transaction.
Apply requires a classified, explicitly authorized target, exact project
confirmation, matching database identity, and an inspected baseline/history.

## Baseline and tracking

The remote `owner_media_uploads` and `proof_assets` tables predate this runner.
Read-only inspection confirmed their keys/types, existing access controls, the
absence of `media_placements`, and the three missing owner-placement columns.
The target configuration records the SHA-256 of those inspected catalog
definitions and a separate digest of their existing grants/RLS/policies.
It is a scoped baseline, **not** a reconstruction of the entire database.

Older SQL files have duplicate numeric prefixes and no application migration
ledger. They are not automatically executed or marked applied. Reconcile each
separately before bringing it under management.

The explicit managed list currently contains:

1. `029_create_media_placements.sql`: independent page/area overrides,
   constraints, source foreign keys, RLS, backend-only grants and ordering index.
2. `030_owner_media_placement_fields.sql`: additive owner destination/order/
   weight columns and their indexes, with the existing application's defaults.
3. `031_commercial_reliability.sql`: explicitly authorized, applied and verified
   in production on 2026-10-20 after the security-first rollout.
4. `032_commercial_operations.sql`: **pending, review-only and not authorized
   for production apply**. Adds accountable follow-up/activity and explicit links
   to existing installation/order records. Its single service-only record RPC
   supports ADMIN assignment/start and facts-only completion; no payout or
   communication processing RPC exists. Closed disposition requires a non-null,
   nonblank reason at table, RPC and API boundaries. New foreign keys intentionally
   block deletion of linked accountability records rather than cascading history.
   See [compatibility and scope](COMMERCIAL_OPERATIONS.md).
   Its separate authorization/checksum are unset; the runner blocks apply before
   connecting until the new scope is explicitly reviewed and authorized.

The two media scripts deliberately fail if untracked objects already exist; do not
replace that protection with `IF NOT EXISTS` or mark changes applied manually.
Only these four intended SQL paths are unignored. Although 031 uses conditional
DDL, the runner requires an exact commercial baseline with no colliding objects
before executing it. Never run that file directly to bypass this guard.

Apply takes a transaction-scoped advisory lock, checks schema drift and file
checksums, and executes pending SQL intact in one transaction. It verifies
schema/access controls before committing both DDL and the
`public.h2s_schema_migrations` records. Failure rolls back. Each record stores
version, checksum, target/environment, resulting schema digest, time and role.
Reapplying is a verified no-op; changing applied SQL is rejected.
The runner also requests a PostgREST schema-cache reload after successful DDL.

For future migrations, add a versioned file to the explicit list, narrowly
unignore it, and record authorization for the exact target/scope. Inspect drift
first. Do not rewrite an applied migration or update baseline hashes just to
silence a mismatch. Commit migration, non-secret configuration, relevant app
changes, and tests together after validation.

## Access-control boundary

### Commercial release preflight (2026-10-22, read-only)

Production has applied 029-031 only. Applied migration 031 correctly defines
`commercial_leads.revision` as `bigint`; the 032 prerequisite checker and local
SQL fixtures now require that actual type, rather than `integer`. Regression
coverage rejects an integer or missing revision column. This checker-only
correction does not alter production schema, migration SQL, baseline hashes,
or authorization. Commercial rollout remains blocked on explicit authorization
and application of 032/033. Do not change the production column to satisfy a
checker or modify applied 031.

Existing owner/proof policies and grants are fingerprinted and preserved.
Inspection found that `owner_media_uploads` already has RLS disabled and broad
API-role grants; this foundation intentionally does not silently change that
pre-existing boundary. Review it separately before widening access.
The new placements table has RLS enabled, no anonymous/authenticated grants or
policies, and CRUD grants for `service_role`; public application APIs apply the
existing visibility, rights, review, and QA eligibility rules.

Schema verification is not an editor acceptance test. Also verify actual image
loading, visual framing, cancel, save/reopen, independent scopes, and public
rendering before declaring media management complete.

## Commercial runtime boundary

Commercial request handlers and scheduled maintenance do not create tables,
functions, triggers, indexes, or policies. Missing relations/columns produce
an operational error directing an authorized operator to this workflow.
The existing production commercial tables have RLS enabled and no policies;
preserve that default-deny state. API-role table grants alone do not bypass RLS.
No commercial access-control migration is required for removing runtime DDL.

Legacy `014_create_commercial_consultation.sql` includes unrestricted policies.
It is not part of the managed list and must not be run blindly or marked applied.
For a target missing commercial schema, inspect its catalog and access controls,
then prepare and explicitly authorize a separate versioned migration that
preserves existing data and default-deny access. Do not rewrite historical SQL
or extend the existing media-only authorization to commercial changes.

### Commercial notification and maintenance configuration

Configure these outside Git, in the backend deployment environment or ignored
`backend/.env.local` for development:

- `COMMERCIAL_PUBLIC_BASE_URL` is the canonical public **origin**, without a
  path, credentials, query, or fragment. `PUBLIC_SITE_URL` and
  `NEXT_PUBLIC_SITE_URL` remain supported fallbacks. Approval links never use
  request Origin, Host, or forwarded headers. HTTPS is required except for
  explicitly configured HTTP `localhost`, `127.0.0.1`, or `[::1]` when neither
  `NODE_ENV` nor `VERCEL_ENV` is `production`.
- `COMMERCIAL_CONSULTATION_TECH_PHONE`, `COMMERCIAL_CONSULTATION_TECH_PHONES`,
  and `DISPATCH_PHONES` supply the deduplicated technician recipient list.
  At least one valid phone is required; invalid configured entries fail clearly.
  `COMMERCIAL_CONSULTATION_TECH_NAME` optionally labels the assignment. Public
  camelCase/snake_case assignment fields and historical stored phones cannot
  add notification recipients. No public administrative override is supported.
- Set `CRON_SECRET` in Vercel for the existing scheduled maintenance GET.
  Vercel sends it automatically as `Authorization: Bearer <CRON_SECRET>`.
  `x-vercel-cron` is not authentication.
- Optional manual maintenance uses `COMMERCIAL_MAINTENANCE_TOKEN` in either
  `Authorization: Bearer <COMMERCIAL_MAINTENANCE_TOKEN>` or
  `x-maintenance-token`. Query-string tokens and the former `NOTIFY_DRAIN_TOKEN`
  / `DISPATCH_ADMIN_TOKEN` fallbacks are no longer accepted for this endpoint.
  Update any external manual caller accordingly. Missing authentication
  configuration returns 503; missing/invalid credentials return 401.

Canonical URL and technician configuration are checked before intake writes
(URL only), consultation writes, and authorized maintenance processing.
Existing Twilio transport variables remain required for actual SMS delivery.
Provider acceptance, delivery, appointment recovery, and historical token
revocation are separate concerns; these protections do not establish them.

Run the fake-transport protection tests without production credentials:

```powershell
node --test backend\tests\commercial_consultation.test.cjs backend\tests\commercial_protection.test.cjs
```

### Commercial reliability migration 031 (applied and verified)

The owner authorized this exact migration and ordered production rollout on
2026-10-20. The production `authorizedMigrations` list now includes 031,
`commercial031.reviewOnly` is false, and its separate authorization records the
verified security deployment and required legacy invocation drain. This does not
authorize other migrations. The reviewed normalized-LF SQL SHA-256 remains
`c0e2425df45f7bea99fa6d45dc9becd0dd99ccac80cee95417c8add00de1b071`.

`backend/migration-baselines/031_commercial_reliability.json` contains the
read-only production catalog baseline, not customer records. Its independent
checksum and the normalized-LF SQL checksum are bound in target configuration.
The existing media baseline/security hashes and historical ledger digests are
unchanged. Before application, status/inspect compared the commercial baseline
and ran read-only duplicate/null-email and legacy commercial-link preflights.
Application at 2026-10-20 05:23:32 UTC reported only 031 applied, verified TLS and
`verified: true`. A separate read-only verify returned
`commercial031.state: applied_verified`; zero-row PostgREST queries also
confirmed the new effects table and lead/order columns are visible.

Post-031 verification checks preserved columns/defaults/constraints/indexes,
grants, role flags, default privileges, RLS/policies and existing trigger bodies;
it also checks every new function's body/signature/fixed search path/execution
permissions, the effect ledger, request indexes, typed appointment foreign key,
strict identity/email CHECKs, both enabled appointment guards and the preserved
global order-key unique constraint/backing index.
These checks are exercised against a catalog-derived embedded PostgreSQL fixture.
The frontend and commercial write paths now require these functions; do not
deploy them before that migration is authorized, applied and verified.

The prepared scope is:

- Lead revisions, stable save keys, transactional revision checks and replay.
  Saved drafts keep `last_submitted_at` null; submission sets it atomically.
- One active request per lead and stable submission-key replay. Preflight stops
  on active duplicates without deleting or merging customer records.
- Locked rescheduling with fresh approval authority and replay protection.
  Rescheduling intentionally invalidates old approval links; existing unrelated
  tokens are not rotated and still have no automatic expiry. Rescheduled requests
  require the current approval link; a delayed reference-only SMS cannot approve
  a changed window.
- A backend-only effect ledger. Processing/uncertain provider attempts require
  reconciliation, not automatic resend. Only known rejected/failed attempts are
  retryable. Provider acceptance does not prove delivery or customer acknowledgement.
- Appointment creation/reuse and request linking in one transaction, before any
  customer booking confirmation. Only correctly typed, matching linked
  appointments are reused; missing or unrelated links fail for reconciliation.
- Atomic eight-attachment enforcement. Runtime uploads allow JPEG, PNG, WebP
  and PDF up to 3 MB, within a bounded 4.25 MB JSON request. Failed persistence
  removes the object; cleanup failure is an explicit operator task. A verified
  public-read bucket is currently required; private storage needs a separate
  signed/proxied-access design, not a silent bucket permission change.

Read-only inspection confirmed the current `h2s-job-artifacts` bucket is public;
this did not download customer attachments or prove end-to-end storage access.

Read-only production inspection found UUID appointment IDs, `items` stored as
text, JSONB metadata, and a required `customer_email`. To support text-first
requests without inventing an email, 031 relaxes that column's NOT NULL but adds
`h2s_orders_email_required_except_commercial`: every noncommercial order still
requires email. The null exception requires a new typed `commercial_request_id`
UUID foreign key to a real commercial request. `h2s_orders_commercial_link`
requires matching typed UUID, deterministic order key and metadata ID on inserts
and updates; missing/NULL or invented metadata alone cannot qualify. No redundant
partial appointment-key index is created: existing global order-key uniqueness
already supplies that guarantee.

Orders retain their existing RLS setting and table/column grants. A narrow
BEFORE INSERT/UPDATE/DELETE guard rejects anon/authenticated commercial writes,
checks OLD and NEW so markers cannot be cleared to escape, and preserves linked
identity. Generic backend routes use service-role clients, so commercial writes
also require the appointment RPC's transaction-local request-bound scope. It
restores that scope; a failed statement rolls it back. This is an internal scope,
not an environment variable or secret. A separate BEFORE TRUNCATE guard denies
all API roles; noncommercial CRUD retains existing behavior. Both current_user
and the actual SET ROLE setting are checked, including owner-executing wrappers.
No broad RLS enablement or existing grant revocation is made.
Existing order SELECT access remains unchanged; these are write guards,
not a new order-data privacy boundary.

Generic scheduling/rescheduling handlers cannot edit commercial appointments
through their service client. Approved commercial creation/recovery uses its RPC.
Legacy generic backfill/geocoding tools are not commercial reconciliation tools;
in particular, the old job backfill performs side effects before an unchecked
order update. Do not run it for commercial rows. A future commercial editing or
job-link flow needs a narrow authorized/validated RPC or an explicit exclusion
before generic tooling side effects, not a bypass of the guard.

This remains a reviewed constraint relaxation, not a data deletion. No existing
rows are rewritten. Fresh live aggregate counts found no commercial requests,
commercial appointment markers or request/order links. SQL and runner preflight
stop if that footprint appears rather than invent a backfill. Existing timestamp
triggers remain unchanged; the two guards are additional. Downstream integrations
and real multi-connection behavior still need an approved integration check.

The new effect table has RLS enabled and no policies; its grants are reset before
granting only SELECT/INSERT/UPDATE to service_role, including removal of inherited
service-role defaults. The eight RPCs plus trigger function are SECURITY INVOKER with fixed
`search_path=public,pg_temp`, not SECURITY DEFINER; PUBLIC/anon/authenticated
execution is revoked. Existing commercial default-deny policies remain unchanged.
API keys cannot apply this migration. The established
`DATABASE_URL_DIRECT` and `MIGRATION_CA_CERT_PATH` remain the authorized migration
connection; no additional secret is required.

Local validation uses fake transports and embedded PostgreSQL, never production
test writes:

```powershell
node --test backend\tests\commercial_consultation.test.cjs backend\tests\commercial_contact.test.cjs backend\tests\commercial_protection.test.cjs backend\tests\commercial_reliability.test.cjs backend\tests\commercial_reliability_sql.test.cjs
node --test backend\tests\migration_runner.test.cjs backend\tests\media_placements.test.cjs
node backend\apply_migration_pg.js status --target production
node backend\apply_migration_pg.js verify --target production
```

The embedded tests execute actual SQL against both minimal tables and a
catalog-derived production-schema fixture, including actual default grants,
existing indexes/constraints and trigger functions. They verify transactional
DDL rollback, real request linkage, role guards, spoofed metadata/GUCs, definer
wrappers, failed insertion/retry, duplicate recovery and noncommercial CRUD.
They are not evidence of live application behavior, real concurrent connections,
provider delivery, or customer acknowledgement. Production schema application
and read-only verification are separately recorded above.

**Resolved deployment-order blocker (2026-10-20):**
the previously active `h2s-backend.vercel.app` deployment
`dpl_5GYHkEYGTYER1Cz6BJmzUEziGZUT` is a dirty upload based on Git SHA
`35391b66a6bbd62e777b00212d62132dc57af031`. Its actual uploaded runtime still
contains `ensureCommercialConsultationTables`, Prisma raw DDL and unrestricted
commercial policy creation. Its maintenance route calls that function and still
trusted `x-vercel-cron: 1`. Under explicit owner approval, security/build release
`dpl_6ngVyygN8t8FeEXP3V4pkemwxJrK` replaced it. Uploaded source matched the
isolated security snapshot, and forged cron/invalid bearer probes returned 401.
The six separately approved unsafe legacy deployments were retired and verified
404, then drained for at least the configured 300-second function timeout before
031 was applied. Do not restore those unsafe releases.

The final reliability backend is
`dpl_7xaUuKubemNVifgojqDsEu6JqXSr`; the final frontend is
`dpl_9gDXuHnYX83Ukkfqtm6vsFacvGpa`, serving both shop and portal aliases.
Frontend verification caught missing commercial routing prerequisites and an
obsolete approval-script prefix; only those existing local prerequisites were
selected, preserving noncommercial routing. The legacy deployment helper also
required absent unused assets, so the isolated frontend was stamped equivalently
and deployed from its actual root with explicit `--local-config .\vercel.json`.
Live canonical routes and stamped assets matched deployed source bytes, and both
frontend API proxies retained forged-cron rejection. `COMMERCIAL_PUBLIC_BASE_URL`
was the sole approved deployment-environment addition; secret values were not
changed. No production test customers, appointments, or notifications were created.

The owner separately authorized the existing 15-minute commercial maintenance
cron prerequisite. Its exact path is `/api/commercial-consultation-maintenance`
with schedule `*/15 * * * *`; the existing owner-media reminder is unchanged.
The final deployment's registered cron configuration and uploaded configuration
bytes match the isolated release. Vercel uses the existing production
`CRON_SECRET`; no secret was added or rotated. Maintenance was not manually
invoked with valid production credentials for testing. Scheduled execution and
real provider delivery have not been observed as part of these checks.

Final isolated validation passed 113 tests (fake transports and embedded
PostgreSQL), all targeted syntax checks, zero TypeScript diagnostics, the strict
production build (85/85 pages), and Eastern-time tests under Honolulu and Tokyo.
Live checks separately verified schema/history with trusted TLS, PostgREST
schema visibility using `limit=0`, backend source hashes, forged-auth rejection,
and canonical frontend route/asset bytes. Browser navigation in the integrated
browser timed out; no live browser-rendering pass is claimed. Existing build
configuration skips lint; this is not a lint pass.

For the subsequent Git reconciliation, the owner explicitly approved a
repository-root `vercel.json` guard with
`git.deploymentEnabled: { "retro-dev": false }`. All three repository-linked
Vercel projects currently use the repository root for Git builds. This guard
prevents branch pushes from creating preview deployments; it does not disable
manual CLI deployments or change the running production releases. The guard and
this reconciliation note are post-deployment metadata, not changes to the
deployed application source. Generated portal build stamps/assets and environment
files are excluded from the reconciliation commit.

The security-only release is retained, but reverting code is not a database
rollback: old commercial writes may be rejected by the new guards, and old saves
do not implement revision comparison. Review compatibility and recovery before
rolling back. Do not remove 031 or rewrite its recorded checksum to undo it.

### Contact rules preserved by reliability work

Email first requires a valid email; Call first requires a valid phone. Both
submit for manual follow-up, without automated customer SMS/email or appointment
creation. Text first requires a valid phone and an explicit boolean texting
choice. All supplied contact details are validated, including optional details.
Customer acknowledgement and approval paths enforce the same contact rules.
Internal notifications still use server-owned recipients, independent of the
customer's selected communication method.

The earlier C03 contact rules needed no schema migration: existing `contact_preference` and consent in
lead `attribution.communicationConsent` are reused. Explicit submission creates
a request linked to that lead, with `metadata.request_kind`,
`metadata.contact_preference`, and `metadata.submitted_at`. Manual requests
remain pending review, have no automatic reminder time, and cannot be approved
into appointments. A saved lead alone is a draft, not a submitted request.
This increment includes the administrator-protected, read-only Commercial Queue
endpoint, navigation, pane, widget, and styles needed to display contact details
and the next manual action. Unrelated dashboard changes are not prerequisites.
No email delivery system is introduced.
