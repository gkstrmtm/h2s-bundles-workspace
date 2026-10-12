# Home2Smart Commercial Readiness Report

Generated: 2026-10-12

## Scope

- Footer refinement on the commercial intake page.
- Commercial backend route behavior for intake, photo upload, consultation request, consultation response, maintenance, owner media, and inbound SMS.
- Database and communications readiness using safe, no-live-send validation.

## Code changes made

- Reworked the commercial footer from a translucent card into a structural page-ending band.
- Removed the Prisma-gated schema bootstrap from commercial read helpers so unknown-token and missing-row read paths can fail cleanly instead of hard-500ing on direct Postgres auth.
- Added a repeatable readiness harness: `backend/tools/validate-commercial-readiness.cjs`.
- Added a local-only real persistence exercise harness: `backend/tools/exercise-commercial-persistence.cjs`.

## Commands used

```powershell
Push-Location backend; npm run build; Pop-Location
Push-Location backend; node --test tests/commercial_consultation.test.cjs; Pop-Location
Push-Location backend; node tools/check-commercial-rest-tables.cjs; Pop-Location
Push-Location backend; node tools/check-db-env-connection.cjs; Pop-Location
Push-Location backend; npx next start -p 3001
Push-Location backend; node tools/validate-commercial-readiness.cjs http://127.0.0.1:3001; Pop-Location
Push-Location backend; node tools/validate-commercial-readiness.cjs https://h2s-backend.vercel.app; Pop-Location
Push-Location backend; node tools/exercise-commercial-persistence.cjs http://127.0.0.1:3001; Pop-Location
```

## Raw artifacts

- `artifacts/commercial-audit/commercial-readiness-local.json`
- `artifacts/commercial-audit/commercial-readiness-live.json`
- `artifacts/commercial-audit/commercial-persistence-local.json`
- `artifacts/commercial-audit/commercial-consultation-tests.txt`

## What was tested

### Frontend footer

- Footer markup and CSS were updated to establish a clear page ending without repeating the floating-card language used by the main work surfaces.
- Mobile spacing overrides were checked and corrected so the footer band stays flush instead of inheriting generic section padding.

### Frontend assessment flow

- Code-path inspection confirmed the current implementation still contains:
  - service-driven conditional cards (`renderConditionalCards`)
  - step validation and navigation guards (`validateStep`, `moveToStep`)
  - save-progress failure handling (`saveLead`)
  - consultation request failure handling (`requestConsultation`)
- No browser-automation harness exists in this repo for the commercial wizard, so step-by-step UI interaction was inspected in code rather than exercised by automated E2E.

### Backend and communications

- Backend build completed successfully with the current workspace code.
- Existing commercial logic unit tests passed.
- Supabase REST table existence was verified against the configured real backend database.
- Direct Postgres connectivity was tested against configured env files.
- Pooled and direct Postgres paths were separated during validation:
  - pooled `DATABASE_URL` / `DATABASE_URL_MGMT` reject auth
  - direct `*_DIRECT` hosts fail local DNS resolution with `ENOTFOUND`
- Safe route-level probes were executed locally against the current workspace code and against the current deployed backend alias.
- No probe intentionally sent a live SMS or placed a live call.
- A real persistence harness was prepared and run locally; it blocked on the first lead insert because `commercial_leads` is absent.

## Phase 1 findings

### Intended schema source of truth

- The commercial persistence schema already exists in the repo as raw SQL: `backend/migrations/014_create_commercial_consultation.sql`.
- The SQL in `backend/lib/commercial_consultation_runtime.ts` mirrors that migration and acts as a runtime bootstrap fallback, not the canonical schema source.
- Prisma is not the CRUD source of truth for commercial entities:
  - no Prisma models for `commercial_leads`
  - no Prisma models for `commercial_consultation_requests`
  - commercial routes use Supabase REST for lead and consultation operations

### Why the tables are missing

- `014_create_commercial_consultation.sql` exists, but the canonical deploy script’s default `MigrationFile` list does not include it.
- The fallback runtime bootstrap could not compensate because it depends on direct PostgreSQL access through Prisma.
- Result: the app expected the tables, but the canonical deployment path never applied the commercial migration and the runtime self-heal path could not authenticate.

### Commercial storage/runtime matrix

- Lead create/update/load: Supabase REST against `commercial_leads`
- Photo upload metadata update: Supabase REST against `commercial_leads`
- Consultation create/update/load: Supabase REST against `commercial_consultation_requests`
- Approval/decline transitions: Supabase REST against `commercial_consultation_requests`
- SMS persistence: Supabase REST against `sms_threads` and `sms_messages`
- Schema creation fallback: Prisma direct DB connection only

### PostgreSQL authentication diagnosis

- The configured pooled URLs fail with `password authentication failed for user "postgres"`.
- The configured direct URLs fail locally with `getaddrinfo ENOTFOUND db.nkccbnrduojnzjfrpwva.supabase.co`.
- Practical meaning:
  - pooled access is reachable but the current credentials are not accepted
  - direct-host fallback is not usable from this environment
- This is consistent with a stale or rotated pooled database password plus an unusable direct-host path from the current machine/runtime.

### Isolated migration-test availability

- No isolated disposable commercial database was available in the repo configuration.
- Docker was not available in this environment, so a disposable local Postgres test target could not be created here.
- Because of that, the migration procedure was prepared but not executed against an isolated database in this workspace.

## What passed

### Local workspace code

- `npm run build` passed.
- `node --test tests/commercial_consultation.test.cjs` passed all 5 tests.
- `GET /api/owner-media/public?surface=commercial_intake&limit=4` returned `200` locally.
- `GET /api/commercial-intake` returned `200` locally.
- `GET /api/commercial-intake?token=missing-readiness-token` returned `200` locally with `lead: null`.
- `POST /api/commercial-intake` with missing contact returned `400` locally.
- `POST /api/commercial-intake/photo` with unknown token returned `404` locally.
- `POST /api/commercial-consultation` with missing `publicToken` returned `400` locally.
- `POST /api/commercial-consultation` with an unknown token returned `404` locally.
- `GET /api/commercial-consultation-response?token=missing-readiness-token` returned `404` locally.
- `POST /api/commercial-consultation-response` with invalid payload returned `400` locally.
- `GET /api/commercial-consultation-maintenance` without auth returned `401` locally.
- The local persistence harness reached `GET /api/commercial-intake` successfully, then failed at the first actual insert with `Could not find the table 'public.commercial_leads' in the schema cache`.

### Current live backend alias

- `GET /api/owner-media/public?surface=commercial_intake&limit=4` returned `200`.
- `GET /api/commercial-intake` returned `200`.
- `POST /api/commercial-intake` with missing contact returned `400`.
- `POST /api/commercial-consultation` with missing `publicToken` returned `400`.
- `POST /api/commercial-consultation-response` with invalid payload returned `400`.
- `GET /api/commercial-consultation-maintenance` without auth returned `401`.
- `POST /api/twilio/inbound-sms` with an invalid signature returned `403` on the live alias.

## What failed and was corrected

### Corrected locally

- Unknown-token commercial read paths were incorrectly hard-failing through `ensureCommercialConsultationTables()` and Prisma direct DB auth.
- The local fix was applied in `backend/lib/commercial_consultation_runtime.ts` so read helpers now query Supabase directly and treat missing commercial tables as missing rows instead of forcing a Prisma bootstrap first.
- Evidence of the correction: the local readiness harness now gets `404 Consultation not found` for the unknown-token consultation-response probe, where the current live backend still returns a Prisma auth `500`.

### Failed and not corrected yet

- `commercial_leads` does not exist in the configured real database.
- `commercial_consultation_requests` does not exist in the configured real database.
- Direct Postgres auth fails with `password authentication failed for user "postgres"` in both `.env.production.local` and `.env.vercel.production` checks.
- Direct-host fallback also fails locally with `getaddrinfo ENOTFOUND db.nkccbnrduojnzjfrpwva.supabase.co`.
- The live alias still returns Prisma-auth `500`s for these safe unknown-token probes:
  - `GET /api/commercial-intake?token=missing-readiness-token`
  - `POST /api/commercial-intake/photo` with unknown token
  - `POST /api/commercial-consultation` with unknown token
  - `GET /api/commercial-consultation-response?token=missing-readiness-token`

## Database verification boundary

### Verified against a real configured database

- `sms_threads` exists.
- `sms_messages` exists.
- `owner_media_uploads` exists.
- `commercial_leads` is missing.
- `commercial_consultation_requests` is missing.

### Not verified against an isolated test database

- Commercial lead create/update persistence.
- Commercial photo upload persistence.
- Consultation request row creation.
- Consultation approval/decline state transitions backed by real commercial rows.

Reason: no isolated commercial test database or seeded commercial schema was available, and the configured direct DB credentials are invalid.

## Prepared migration and verification procedure

### Idempotent schema change source

- Apply exactly one existing migration file: `backend/migrations/014_create_commercial_consultation.sql`
- Do not invent a second schema and do not create Prisma models for these tables as part of the repair.

### Verification sequence after credentials are fixed

1. Verify pooled `DATABASE_URL` connectivity from a non-production shell.
2. Apply `014_create_commercial_consultation.sql` once against the main/shared commercial database.
3. Verify table existence through `backend/tools/check-commercial-rest-tables.cjs`.
4. Re-run `backend/tools/validate-commercial-readiness.cjs` locally and against the live alias.
5. Re-run `backend/tools/exercise-commercial-persistence.cjs` locally against a safe backend with outbound Twilio disabled or absent.
6. Only after those pass, consider a controlled non-production communications validation.

### Proposed execution commands once authorized

```powershell
Push-Location backend
node apply_migration_pg.js 014_create_commercial_consultation.sql
node tools/check-commercial-rest-tables.cjs
node tools/validate-commercial-readiness.cjs http://127.0.0.1:3001
node tools/exercise-commercial-persistence.cjs http://127.0.0.1:3001
Pop-Location
```

Notes:

- The intended target is the main/shared commercial database used by `getSupabase()`.
- In this workspace `DATABASE_URL_MGMT` currently points at the same project, but commercial persistence is not conceptually a separate MGMT-only schema.
- I did not change the canonical deploy script’s default migration list yet because that would alter future production migration behavior before authorization.

## SMS and voice verification boundary

### Commercial SMS architecture findings

- Commercial outbound SMS content is constructed in `backend/lib/commercial_consultation.js`:
  - technician approval request
  - customer pending acknowledgement
  - customer confirmed message
  - management escalation message
- Commercial outbound sends flow through `sendSmsAndPersist()` and `sendBulkSms()` in `backend/lib/commercial_consultation_runtime.ts`.
- Commercial inbound SMS is handled in `backend/app/api/twilio/inbound-sms/route.ts`.
- Technician reply matching is implemented by:
  - matching a `COM-...` reference in the SMS body, or
  - falling back to the latest pending consultation assigned to the sending technician phone
- Customer identity matching for inbound commercial SMS is not implemented as a dedicated commercial flow; the webhook stores the message in shared `sms_threads` / `sms_messages`, but commercial automation only branches on technician replies.
- Commercial SMS retry/idempotency is limited:
  - outbound commercial sends are persisted with Twilio SID/status
  - there is no commercial-specific retry queue or idempotency key around `sendSmsAndPersist()`
  - the separate `notify-management` system does have retry/idempotency behavior, but the commercial consultation runtime does not currently reuse that framework

### Verified through provider/config behavior or safe automation

- Live inbound SMS signature rejection path exists on the deployed backend: invalid signature returned `403`.
- SMS storage tables exist: `sms_threads`, `sms_messages`.
- Local env readiness is incomplete for Twilio: account SID, auth token, and from number were absent in the checked local production env, causing the local inbound SMS probe to fail as `500 Missing TWILIO_AUTH_TOKEN`.

### Not live-validated

- Outbound technician notification SMS send.
- Outbound customer acknowledgement SMS send.
- Management escalation SMS send.
- Customer confirmation SMS after approval.

Reason: the validation intentionally did not send live communications.

### Voice / call routing status

- No backend Twilio voice route was found in `backend/app/api/**`.
- No dedicated incoming-call routing, missed-call fallback, or forwarding endpoint was found.
- No ElevenLabs integration files were found in the workspace.
- Existing call-related behavior appears limited to portal-side call logging UI, not commercial telephony orchestration.

## Media status

- Owner media public route is reachable both locally and on the live alias.
- In both local and live harness results, the returned commercial rail items are currently `proof_asset` items, not `owner_media` items.
- That means the route is operational, but the configured dataset is still resolving to proof-gallery fallback for the tested commercial surface.

## Unresolved blockers

1. Provision `commercial_leads` and `commercial_consultation_requests` in the real database.
2. Fix the direct Postgres credentials used by Prisma/bootstrap paths.
3. Resolve the unusable direct-host fallback path from this environment or stop relying on it for operational repair steps.
4. Deploy the local commercial read-path fix so the live backend stops returning Prisma-auth `500`s for safe unknown-token lookups.
5. Provide a controlled non-production Twilio configuration or isolated test recipient plan before validating outbound SMS flows.
6. Decide whether commercial telephony needs actual incoming-call routing, forwarding, missed-call handling, and ElevenLabs. Those capabilities were not found in this repo.

## Authorization-required proposed changes

I have not executed these because they change production-impacting schema or credential behavior.

1. Repair the pooled database credentials used by `DATABASE_URL` and `DATABASE_URL_MGMT` for the commercial Supabase project.
2. Apply the existing idempotent migration `backend/migrations/014_create_commercial_consultation.sql` to the main/shared commercial database.
3. After successful schema creation, rerun the database-backed persistence harness locally before any deploy.
4. After local persistence passes, deploy the already-prepared commercial read-path fix so live unknown-token reads stop surfacing Prisma-auth `500`s.

## Controlled production smoke-test readiness

Status: **Not ready for a controlled production smoke test yet.**

Reason:

- Core commercial persistence tables are absent.
- Direct DB credentials are invalid.
- Current live read paths still surface `500` Prisma auth failures for safe unknown-token lookups.
- Outbound communications were not exercised live, by design.
- Voice-routing capabilities requested in the audit were not present to validate.

## Footer design decision

- The footer was intentionally shifted from a translucent card to a restrained structural band with a top rule and compact branded copy.
- This matches the page’s operational-compact system better than another floating panel, preserves the phone/text actions, and gives the commercial page an unambiguous endpoint without adding decorative clutter.