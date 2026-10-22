# Commercial operations: compatible local increment

## Scope and release boundary

This increment extends the existing canonical [dashboard](../frontend/dash.html).
Migration [032](../backend/migrations/032_commercial_operations.sql) is **unapplied,
review-only and outside production authorization**. No production backfill, job
creation, charge, notification, permission expansion or deployment is part of this work.
Without 032, the new detail section reports that the migration is required; the
existing consultation queue remains usable. Never run legacy SQL to bypass this guard.

The selected payment scope is **existing priced orders only**. Leads without an
explicit linked installation display **Quote/payment setup required**. Payment
collection is not connected for those leads.

## Compatibility evidence and relationships

The registered production catalog was inspected in a verified-TLS, read-only
transaction. Applied migrations are 029, 030 and 031. Both `h2s_jobs` and
`h2s_dispatch_jobs` exist; their names are not interchangeable.

| Consumer | Established contract retained |
| --- | --- |
| [Bundles/catalog checkout](../backend/app/api/shop/route.ts) | Validated catalog cart creates Stripe checkout and order/dispatch records. No custom quote is forced into the cart contract. |
| [Checkout webhook](../backend/app/api/stripe-webhook/route.ts) | Existing checkout and payment-intent events remain in place. Migration 033 moves existing-order checkout updates and dispatch metadata linking into a service-role-only, row-locking merge. Current operational schedule fields take precedence over stale checkout metadata. Existing provider idempotency keys are retained. |
| [Job creation](../backend/app/api/create_jobs_from_orders/route.ts) | Uses dispatch rows linked by order reference. This increment never calls it or any backfill. |
| [Portal jobs](../backend/app/api/portal_jobs/route.ts) | No portal changes are included in this proposal. Future compatibility concern only; portal adoption is not required. |
| [Scheduling](../backend/app/api/schedule-appointment/route.ts) | The production-shaped contract is dispatch `due_at` plus order delivery fields/metadata. New scheduling updates only an explicitly linked existing job/order; it does not create appointments, send confirmations, or claim capacity/technician availability was checked. |
| [Technician completion](../backend/app/api/portal_mark_done/route.ts), admin handlers | Existing authentication, ownership checks, status meanings and global schema resolution are unchanged. |
| [Completion/payout orchestration](../backend/lib/dataOrchestration.ts) | Not imported or invoked by commercial operations. Historical callers and paid ledger entries are left alone. No commercial adapter or payout compatibility enhancement is included. |
| Proof | Existing `h2s_job_artifacts`, keyed by the linked job ID, provides read-only evidence links. Technician upload paths are unchanged. |
| Historical `h2s_jobs` | Retained as-is. No automatic selection, record copying, table replacement, or reconciliation/backfill. |

The production `h2s_dispatch_jobs` columns include `job_id` UUID, `order_id`,
`due_at`, `status`, dispatch recipient/sequence/step fields and processing fields.
It is shared operational infrastructure, not merely a notification queue.
Its existing status constraint permits `queued`, `assigned`, `in_progress`,
`completed`, `cancelled` and `done`. The new path uses those meanings; it does
not add a `scheduled` status or pretend nonexistent address/metadata columns exist.

Explicit relationships:

1. `commercial_leads.lead_id` -> consultation requests.
2. A consultation's `related_order_id` / order `commercial_request_id` identifies
   its separate zero-total `APPT-COM-*` appointment. Never installation/payment proof.
3. `commercial_lead_operations.order_id` -> an existing positive-total
   `h2s_orders.id`, and `installation_job_id` -> an existing dispatch `job_id`.
4. Linking requires the dispatch order reference to equal that order's UUID or
   textual order reference and the order contact to match the lead. Consultation
   markers are rejected. Unique links prevent attaching the same order/job to
   multiple leads. No job is fabricated or selected from a notification recipient.
5. Payment verification follows the linked order's Stripe session/intent, checks
   exact amount/currency and succeeded/received amount, and inspects refund/dispute
   evidence. A stored `paid` string, technician YES or opened checkout is not proof.
   Unknown/missing Stripe configuration or failed reads show unavailable/unverified,
   never paid. This read path does not change payment records.

## Persisted operations and concurrency

### Atomic webhook release correction (033)

[033](../backend/migrations/033_atomic_stripe_order_metadata.sql) is additive,
review-only, separately checksum-guarded, and not authorized for production.
Committed migration 032 remains unchanged. The guarded runner registers 033
after 032; both require explicit authorization before release. Apply/verify the
approved migrations before deploying the corrected webhook: a missing/failed
checkout RPC returns HTTP 500 for Stripe retry, not a successful acknowledgement
or dispatch/notification continuation.

`stripe_patch_order` locks the existing order inside the database transaction,
merges only the supplied patch into the current JSON object, and preserves
existing `scheduled_date`, `scheduled_end`, `scheduled_tz`, `time_window`,
`schedule_status`, `scheduled_at`, and `scheduled_via`, including explicit nulls.
Checkout values for these keys still initialize them when no current key exists.
Delivery date/window columns are untouched. The RPC advances `updated_at` so a
previously opened installation form detects intervening checkout changes.
Checkout payment/address/contact updates remain in the same transaction;
parsed job details still replace their stringified form. New-order insertion,
payment-intent-only events, dispatch behavior and management notification
idempotency are unchanged. Dispatch metadata linking uses the same merge without
changing payment/contact fields. It retains the existing logged, non-blocking
link-failure policy; no new downstream action is introduced.

The function is security-invoker, with EXECUTE denied to PUBLIC, anonymous and
authenticated clients and granted only to service_role. No table grants,
existing rows, foreign keys, or dashboard permissions change. It uses the existing
server-side `getSupabase()` credentials; no browser credential or new secret is
introduced. Non-object legacy metadata fails explicitly rather than being erased.

The new tables contain responsible staff, next customer follow-up, open/closed
disposition/reason, explicit installation link and completion actor/time.
Append-only activity records contain authenticated actor/time and contact
channel/outcome/notes. Assignment to a staff member does not grant queue access.
All new HTTP reads/writes require the existing dashboard ADMIN session; VA,
owner and unauthenticated access are not implicitly granted.

The service-only transaction locks the lead and its operations row, checks the
expected revision and stores a unique operation key. Identical retries replay;
changed content under the same key and stale revisions are rejected. Location
updates also check the exact lead timestamp and advance public-intake revision.
Installation edits check the job/order timestamps under row locks. Failed actions
roll back without appending history or partially changing the link/schedule.
Linking and every installation transition also fail closed for missing or
mismatched order references and null/nonfinite/nonpositive prices. Legacy
nullable dispatch order references cannot bypass relationship checks.

Client drafts survive background refresh, errors and navigation between leads.
Newer server data cannot overwrite a draft or a completed save with an older
in-flight response. Unchanged retries retain their operation key.
Forms reuse the dashboard's existing custom selects. A scoped signature guard
prevents unchanged operations selects being rebuilt by the global observer while
open; changed options, values, disabled state and viewport still rebuild normally.
Other dashboard selects retain their existing behavior.

Lead closure does not complete/cancel installation or consultation work, stop
consultation reminders, or prove customer confirmation. Technician YES, customer
confirmation, contact-attempt outcomes, installation completion and payment remain
separate. Attempt recipients come from persisted records, never installer
inference. A small expandable routing summary uses the existing runtime routing
helpers to identify configured technician-request and escalation recipients;
configuration failures are explicit and no notification is sent by reading it.
The read projection joins existing commercial effects to persisted
SMS status by the recorded provider reference. It performs no Twilio calls.
It distinguishes pending, provider accepted, delivered, failed and uncertain.
Missing receipt lookup, receipt timestamps and attempts are explicit limitations.
Attempt time is labelled separately from processing-record update time.
Latest communication and unresolved results lead a small expandable history;
no inbox, composer or new messaging system is introduced.

### ADMIN installation lifecycle

An ADMIN assigns an existing active installer from `h2s_pros`, with notes.
An existing conflicting assignee blocks reassignment rather than being silently
replaced. Assignment records staff action, not technician acceptance or delivery.
Start requires an assigned job, saved installation window, existing order address,
notes and the established equipment-delivered/not-needed rule. Completion requires
an in-progress job, one unambiguous recorded assignee, notes and no unresolved
CRITICAL flags. These reuse established lifecycle rules without calling legacy
dispatch/status endpoints that send emails or expect incompatible columns.
Existing proof links remain available; no mandatory photo-count rule was found,
so none is invented. Uploading new proof is not added in this increment.

Completion's entire write set is the dispatch status/update timestamp, authenticated
completion actor/time, operations revision and append-only activity. It never calls
payout orchestration, writes a payout, sends a review/receipt email, or sends any
customer/technician communication. A subsequent snapshot/Stripe read can fail
without undoing completion; an explicit identical save safely replays its operation
key. Existing paid payouts remain unchanged. No processing claim/retry RPC exists.
Historical payout reconciliation is outside this proposal; the ledger's job FK
still targets `h2s_jobs`, not dispatch jobs. No historical anchor is fabricated.

### Quiet read recovery and retention

Transient reads use one in-flight request and at most three delayed retries
(2, 5 and 15 seconds), then pause. Online, visible-document or active-view return
may rearm after a 60-second cooldown. Healthy visible reads poll every 45 seconds.
Authorization, missing endpoints and missing schema halt automatic recovery.
No mutation is automatically replayed. There is no visible Retry button.
Retained data/drafts, selection, focused inputs and scroll survive read failures;
reviewing latest explicitly discards a draft.

New operations/history foreign keys deliberately use `NO ACTION`: linked lead,
order or dispatch deletion is blocked rather than silently erasing accountability.
The consultation FK's existing cascade is unchanged, but a linked lead cannot
be deleted first. Checkout rollback in the shop handler and diagnostic/probe/test
cleanup scripts must not delete linked records; unrelated unlinked cleanup remains
valid. No cascade, data deletion or cleanup script is run by this increment.

## Migration/configuration and remaining limits

Use the [guarded database workflow](DATABASE_MIGRATIONS.md). 032 is registered as
pending but excluded from `authorizedMigrations`; its separate review flag and
checksum authorization are unset. The runner checks prerequisites, default-deny
RLS/table permissions and service-only RPC execution. Existing table access is not
changed. Review and explicit target/checksum authorization are required before apply.

Credentials remain outside Git:

- `DATABASE_URL_DIRECT`, `MIGRATION_CA_CERT_PATH`: ignored backend migration env or
  authorized terminal, with verified TLS.
- Existing `SUPABASE_URL` and service-role configuration: backend runtime.
- Existing optional management database configuration: dashboard identity directory;
  actor IDs are stored as durable text, not a fabricated cross-database foreign key.
- `STRIPE_SECRET_KEY`: backend runtime, needed only for authoritative read verification.
- No completion mail/payout credentials are required or used by this workflow.

No new priced job/order is created here. A missing, unmatched or ambiguous existing
job must be reconciled; neither a backfill nor an alternative source of truth is
used as a shortcut. Capacity checks, technician availability and customer scheduling
confirmation are not implied by saving an installation window.

## Smallest next extension: approved custom quote, full payment only

Add a versioned commercial quote with server-enforced ADMIN approval: line items,
currency, explicit approved amount in integer minor units, tax treatment, expiry,
approver/time, revision and idempotency key. The customer budget remains informational.
Create a separate Stripe full-payment checkout from that approved version, with
typed quote/lead/order references. Extend the verified webhook idempotently to
reconcile its order and exactly one installation relationship, without changing
catalog checkout behavior or creating jobs merely because a checkout was opened.
Retain authoritative payment/refund/dispute state and failed/expired checkout handling.

Business approval is still required for:

- Included labor/materials/travel, discounts and who may approve a price.
- Tax jurisdiction/rates, inclusive versus exclusive prices and shipping/materials.
- Collection timing (before scheduling, before installation or after completion).
- Quote expiry, cancellation, refunds and change orders.

Deposit/balance collection is deferred. No percentages, amounts, tax rules or
collection timing have been invented.
