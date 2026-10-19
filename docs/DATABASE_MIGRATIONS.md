# Guarded PostgreSQL migrations

The database runner uses `pg`, not application API keys or a custom SQL RPC.
Non-secret target configuration is in `backend/migration-targets.json`.
The workspace owner confirmed project `nkccbnrduojnzjfrpwva` is **production**
and authorized the two additive media migrations on 2026-10-16.
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

These scripts deliberately fail if untracked objects already exist; do not
replace that protection with `IF NOT EXISTS` or mark changes applied manually.
Only these two intended SQL paths are unignored.

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
