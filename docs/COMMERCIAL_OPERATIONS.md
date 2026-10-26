# Commercial operations: existing-order workflow

## Notification routing settings (local; not released)

Canonical dashboard location: **My Summary > Owner notifications**, in
`frontend/dash.html`. The existing ADMIN username/email + PIN session is required
for both reading and saving `/api/notification-routing`; neither a public review
token nor a VA account can read/change these settings.
The compact overview leads with the residential owner number and Edit.
Commercial technician requests and management escalation remain under
**Other routes (unchanged)**; recipient-change cautions appear beside Save,
not as repeated overview paragraphs. It is part of the existing full dashboard,
not a separate settings application.

Only **Residential owner alerts** are editable: new inquiry review texts,
callback reminders and installation owner reminders. Commercial technician
requests and management escalation show their existing effective recipients,
read-only. Their existing environment routes are unchanged. Public business
phones, Twilio sender, customer contacts, installer assignments and the separate
media-upload reminder recipient are not modified.

`notification_routing.route_key = residential_owner` is authoritative once saved.
Until its first save, the existing `RESIDENTIAL_REVIEWER_PHONE` is the explicit
default; reading never seeds or changes it. A saved number supersedes even a
different/invalid environment default. Database errors or invalid saved routing
fail closed: no silent use of the former recipient. A missing environment
default is shown as not configured and blocks residential SMS until configured.
The routing migration must precede a future matching application deployment.

Save normalizes US/international phone syntax, requires acknowledgment of
recipient-bound handling and checks the displayed revision. Simultaneous/stale
edits receive 409 without overwriting another administrator's change. The draft
is retained; Reload saved routing explicitly discards it after confirmation.
The server derives the actor from the authenticated ADMIN session; the atomic
SQL RPC stores prior/new phone, source, revision, actor and change time in
`notification_routing_activity`. Browser roles have no table/RPC privileges;
the application service role has SELECT and the reviewed RPC, not direct writes.
Saving does not send a text or verify number ownership. No test-SMS action was
added; a future test send requires separate explicit authorization.

Routing changes are **not customer or job handoffs**. New inquiries capture the
current saved recipient. Existing links still open their original customer and
existing ADMIN access remains unchanged, but token-only follow-up acceptance
for the old recipient is blocked by the existing assignment guard. Pending
notices for old assignments return `routing_review_required`, including customer
notices protected by the same guard; they are not redirected or resent. Existing
reservations/assignments are untouched. A separate authorized reconciliation is
required before those old notices/decisions can proceed; this setting does not
provide a reassignment or token-rotation action. Already sent messages cannot be
recalled. Requests, sends or reminder batches already in flight may finish with
their earlier routing/authorization snapshot.

Review-only prerequisite: `backend/migrations/039_notification_routing.sql`.
It is registered but absent from the production authorized scope, and its
`notification039.reviewOnly` remains `true`. No production deployment, migration,
message, test customer or live routing change is part of this increment.

Fixture validation: run `node --test --test-concurrency=1
tests/notification_routing.test.cjs tests/notification_routing_ui.test.cjs
tests/migration_runner.test.cjs` from `backend`. These cover actual SQL/API
permissions and audit, normalization, concurrent edits, environment fallback,
storage failure, saved-recipient inquiry/callback/installation delivery,
recipient-bound old links/reminders and UI Save/Cancel/reload/conflicts.
Read-only fixture inspection and saves were also browser-checked at 320/390px;
no horizontal overflow, 44px action targets and zero provider attempts.
The combined routing/residential/commercial/mobile/media regression passed
304 fixture tests; backend `npx --no-install tsc --noEmit --incremental false`
and dashboard syntax checks passed. These are local fixtures, not live delivery
or production acceptance results.

## Lightweight homeowner inquiries (released 2026-10-26)

Production release: `PORTAL_BUILD_20261026_190027_e70af30_residential`, built
from base commit `e70af30a6a39282277630af2741a0b6675144344` plus the scoped,
validated local residential/shared changes, not the entire dirty workspace.
Backend deployment: `dpl_37j66gfWDPqoSYUAnqcBhXcZuvD9`.
Frontend deployment: `dpl_54TeVtxRc8sn9Jy6Kd22UNEHkCJX`.
No commit or push was performed.

- Residential customers: <https://shop.home2smart.com/residential>
- Commercial customers: <https://shop.home2smart.com/commercial>
- Manager/owner: <https://shop.home2smart.com/dash>

The exact candidate passed 228 scoped fixture tests and its backend build.
Production checks verified 37 deployed source hashes, clean routes/assets,
the frontend API proxy, enabled intake readiness, invalid-token rejection,
ADMIN/maintenance access protection, and deployed reminder schedules.
Commercial routing configuration was unchanged. Both public customer pages
were read-only browser-checked at 320px and 390px without horizontal overflow
or uncaught page errors; no fixture markup appeared.
These checks did not submit a production inquiry, send a test SMS, create or
modify a customer/booking, charge a payment, or manually run reminder maintenance.
Real handset delivery and a controlled end-to-end booking/login/notification
acceptance test remain outstanding before scaling paid traffic.

- Customer page: `frontend/residential.html` (`/residential`), with its own
  CSS/JS. Service choices are TV mounting and security cameras; required fields
  are name, phone, and city. Notes and up to three preferred dates/broad periods
  are optional. No public prices, checkout, mandatory equipment questionnaire,
  automatic appointment, routing to Portal installers, or payment is added.
- `/api/residential-intake` uses an atomic, idempotent migration-037 wrapper
  around the existing lead/request RPCs. Records remain in `commercial_leads`
  and `commercial_consultation_requests`, with authoritative
  `attribution.market = residential` and `metadata.request_kind =
  residential_inquiry`. Legacy missing market means Commercial. The database
  prevents changing a lead's market and prevents homeowner requests from
  acquiring consultation windows, appointment links, or consultation reminders.
- Preferences live at `assessment_answers.availabilityPreferences`, as up to
  three `{date, period}` pairs; periods are morning/afternoon/evening/flexible.
  They express availability only, never capacity holds or promised arrival
  windows. Staff discuss timing and scope, check the shared calendar, and use
  its existing explicit hold/confirm/reschedule/cancel actions. Confirmation
  still requires recorded customer agreement; overlaps block across markets.
- Dedicated reviewer texts include the homeowner name, services, city,
  preference summary and unique `/residential-review?token=...` link.
  Opening the page only reads. Accept follow-up / Needs another reviewer are
  explicit POST actions, with immutable activity in the existing lead history.
  Acceptance means responsibility for a conversation, not an appointment.
  Concurrent/repeated decisions are deduplicated; reversing one requires staff
  review rather than reusing the link for a conflicting action.
- Customer receipt/accepted-follow-up notices require explicit texting consent
  and Text first. Otherwise the inquiry requests a manual call and sends no
  customer SMS. The existing effect ledger, history and delivery callbacks are
  reused; provider acceptance is not delivery. Known rejections may retry
  without resending accepted messages; uncertain attempts require reconciliation.
  These intake notices do not book an appointment. The separately gated owner
  workspace below adds scheduling notices; SMS YES/NO decisions remain disabled.
- The existing dashboard pane retains its internal IDs but displays Customer
  Queue, with server-side market filtering, market badges and preferred dates.
  Administrators can load the inquiry's review link from its detail, without
  sending a text; the lead-ID lookup requires an authenticated ADMIN session
  and does not expose review tokens through the general Queue projection.
  Queue / Calendar is a mutually exclusive view switch; Queue is the default
  and the calendar loads on first use. Switching retains Queue search, cursors,
  selection and draft DOM, as well as the calendar's date, month/day view and
  reservation-state filter. Both views share the customer-market selector.
  Changing the calendar date updates the visible range immediately; there is
  no Show/refresh button. The existing 30-second visible-calendar refresh remains.
  Clearing the navigator retains the previous range with an explicit prompt;
  it never clears a reservation. Controls use consistent compact heights
  (larger touch targets on mobile), with reduced-motion support.
  The same company calendar offers a 42-day month and full day agenda.
  Market/state filters change visibility, never capacity. Mobile uses a compact
  seven-column month with tappable dates/counts rather than sideways scrolling;
  selecting a date now keeps the month visible, marks the selected date and
  shows its readable reservation list immediately below. No hover or long press
  is required. Day agenda remains an explicit focused view; neither view uses a
  sideways-scrolling table. The filter disclosure always names the active
  market and reservation state, with touch-sized choices inside. Calendar
  entries open the existing detail surface with a Back to calendar action.
  In the same-link owner workspace, Check reservation explains whether the time
  belongs to the current customer without switching the customer being scheduled.
  The shared component applies its styling class when mounted; homeowner section
  dividers are scoped to top-level workspace sections, not individual day cells.
  The calendar shows explicit holds/reservations, not unbooked inquiry preferences.
  Existing reservation drafts, revisions, agreement/history and operation-key
  retries remain intact.
- Equipment-included versus installation-only is settled during quoting, not
  assumed by the form. Residential versus Commercial offers remain separate.
  Existing Bundles prices/promises and the proposed offline pricing package
  are not approved prices for this funnel; no pricing module is imported.

### Same-link owner workspace (local implementation; not released)

Mobile controls use 16px editable text and 44px primary touch controls.
The owner page uses compact label/value rows with wrapping values, not stacked
full-height fields. The dashboard and both residential pages share `date-popup.js`:
it positions Flatpickr inside the visual viewport without reading cross-origin
stylesheet rules, follows viewport/keyboard changes while open, and permits
scrolling the popup on short screens. Vendor CSS precedes application overrides.
Commercial approval blocks repeat taps while saving and disables decisions
after completion. An interrupted response explicitly says the result is
uncertain and requires reopening/reloading the link to read the saved state;
it does not automatically repeat the decision or send another message.

The customer-specific review URL also hosts an ADMIN-authenticated owner
workspace. Accepting follow-up is still not a booking. The review token alone
does not grant calendar or scheduling access; the owner signs in through the
existing dashboard username/email + PIN session, without leaving the customer
context. This is staff authentication, not a customer login or a new credential
system. Valid sessions are reused across customer-specific links on the same
origin/device.

The current callback API and existing shared-calendar API both require the
existing `ADMIN` dashboard role; `VA` does not have scheduling permission.
This implementation does not introduce that restriction, change roles or
create accounts. A 401 requests sign-in; a 403 explains the existing permission
requirement without deleting a valid staff session or repeatedly asking the
same user to log in. Selecting another staff account is an explicit action.
Brandon does not currently have dashboard credentials, as confirmed by the
workspace owner; his account and appropriate permissions remain a separate
setup decision, not an implicit grant of administrator access.

The customer name leads the page, followed by service/city, operational status,
saved installation or callback time, a callable phone number, and one
state-dependent primary action. Confirmed jobs lead with the confirmed window
and Reschedule; completed jobs offer View installation, not new-booking
instructions. Callback-due jobs lead with Call customer. Reference, preferences
and notes remain visible in secondary Customer details. Saved callback and
installation summaries stay on the overview, alongside concise recent text
status. Set callback/Edit callback, Book installation/Reschedule, View calendar
and View history open one focused task dialog, not stacked disclosures. The
existing shared calendar retains customer context and its filters; its booking
history is shown with the supporting text records in Customer history.
Account is a header control, outside job content. Sign-in guidance only appears
when access is required; private saved times are cleared from the overview on
sign-out. The test server alone injects the fixture banner.
Its Preview options menu switches between fictional owner and homeowner
examples; it is not application navigation. The public homeowner intake and
customer-specific owner workspace remain separate pages, with scheduling
protected by the existing dashboard session.
Residential date fields show readable month/day/year dates and 12-hour times
without seconds. Separate hidden machine values retain the existing date
formats, and unchanged saved instants retain their original seconds and
timezone semantics. Picker-internal year/time inputs are excluded from the
full-size form-field styling so month/year controls remain legible on mobile.
Local fixture inspection covers unscheduled, callback-due, confirmed, cancelled
and completed customers at 320px and 390px, including focused editors and long
wrapped details. These responsive-browser checks do not certify physical
devices or live message delivery.
Customer availability remains separate from the authenticated
installation window: a preferred Tuesday-through-Thursday range is not a
booking. The calendar checks recorded conflicts when a time is saved; there
is no automatic preferred-window slot finder. Saved details update when the
page regains focus/visibility and after saves, without a routine refresh button.
Only one task panel is active. Callback and installation editors use a common
Save/Cancel footer. Cancel, Escape or switching tasks prompts before discarding
unsaved edits; Keep editing preserves them. Discard affects local drafts and
retry state, not a save that may already have reached the server. Busy saves
block task exit. Saving returns to the overview; closing restores its scroll
and initiating control. Unsaved drafts and uncertain/conflicting operations
remain protected. Text updates use plain labels; notices needing review remain
visible, with full records behind View history.

- Save, reopen, complete or cancel a callback, with an explicit note. Callback
  times reuse `commercial_lead_operations.next_follow_up_at`; revisions and
  operation keys reject stale edits and deduplicate identical retries.
- The existing shared company calendar and reservation editor provide tentative
  holds, confirmed installation windows, rescheduling and cancellation. Other
  calendar entries do not replace the current customer's review link. Explicit
  customer agreement is required to confirm; preferences are not bookings.
  Capacity checks cover recorded company reservations, not personal calendars,
  staff availability, travel or inferred installation duration.
- Migration 038 persists versioned `residential_notices` and reuses the existing
  effect ledger and provider delivery tracking. Triggers cover writes from the
  review workspace and existing dashboard/reservation surfaces.

Approved notification policy:

| Event | Recipient and timing |
| --- | --- |
| Scheduled callback | Owner, 15 minutes before the saved callback. |
| Confirmed or rescheduled installation | Customer confirmation when saved, if consent permits. |
| Confirmed installation approaching | Owner and consenting customer, 60 minutes before the window starts. |
| Confirmed installation cancelled | Consenting customer receives cancellation; obsolete reminders stop. |

Tentative holds do not send booking texts. Unchanged installation windows do
not start another notice sequence. Rescheduling, cancellation and completion
supersede obsolete notices; callback completion/cancellation stops its reminder.
Owner texts contain name, services, general city, relevant time and the same
customer-specific link. Full addresses and owner credentials stay out of
customer texts. Text-first preference and current explicit SMS consent are
rechecked before each customer send.

The server processes due notices, not browser timers. Installation windows
booked less than 60 minutes ahead make both confirmation and reminder due;
confirmation is processed first. A callback saved less than 15 minutes ahead
also makes its notice immediately due. The maintenance cadence determines
actual dispatch; expired notices are not sent late. Do not promise exact
minute delivery. The proposed every-minute Vercel cron requires a hosting plan
that supports that cadence before release.

Provider acceptance is not handset delivery. GSM-7/UCS-2 segment estimates are
recorded for cost visibility. Failed or uncertain sends require review rather
than automatic resend; a lost processing result is reconciled after five
minutes without another provider call. Notification warnings do not disguise
a successfully saved calendar reservation as a failed save. A cancellation
cannot retract an SMS already accepted by the provider, including the small
race after the final transactional state check.

### Activation and future environment approval

All feature flags below default off. The owner separately authorized production
activation on 2026-10-26; the three residential flags are enabled there and the
dedicated recipient ends in 9776. Do not configure real recipients or enable
live intake/SMS as part of local fixture validation in other environments.

| Backend environment variable | Purpose |
| --- | --- |
| `RESIDENTIAL_INTAKE_ENABLED` | Explicit `true` enables submission only after the 037 readiness RPC succeeds. |
| `RESIDENTIAL_SMS_ENABLED` | Explicit `true` enables this funnel's recorded texts. |
| `RESIDENTIAL_WORKSPACE_ENABLED` | Explicit `true` enables the ADMIN workspace and notice processor only after migration 038 readiness succeeds. |
| `RESIDENTIAL_REVIEWER_PHONE` | Dedicated authorized reviewer; no fallback to Commercial recipients. |
| `CRON_SECRET` | Bearer secret authorizing scheduled `/api/residential-maintenance` invocations. |
| `RESIDENTIAL_MAINTENANCE_TOKEN` | Optional separate Bearer secret for authorized manual maintenance. |
| `COMMERCIAL_PUBLIC_BASE_URL` | Existing canonical HTTPS frontend origin, reused for review links. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Existing server-side application connection, not schema authority. |
| Existing Twilio sender/account/auth/callback settings | Existing transport and signed delivery/inbound handling, unchanged. |

Configure secrets/phone settings outside Git in the approved backend environment.
Before release, inspect/reconcile and separately authorize migrations 037/038 through
the guarded runner, configure the dedicated recipient, then deploy matching
frontend/backend code, verify cron eligibility/authentication, and explicitly
enable the features. Production migrations 037/038 were applied and independently
verified during the authorized release. The existing cron secret was preserved;
the residential schedule is every minute and Commercial remains every 15 minutes.
No public prices, checkout, ad tracking/attribution experiments or residential
offers were changed by this increment.

Local checks (no real database, provider, payment, or production messages):
`node --test tests/residential_inquiry.test.cjs tests/residential_ui.test.cjs
tests/residential_workspace.test.cjs tests/residential_workspace_ui.test.cjs
tests/migration_runner.test.cjs` from `backend`. The workspace SQL fixture runs
actual 031/032/034/036/037/038 functions under `service_role`, and verifies shared-calendar
capacity using the existing 036 fixture. Browser/DOM checks cover minimal
submission, popup date preferences, retry identity, review buttons, market
filters and the month/day toggle. Independent-session calendar concurrency
requires the existing dedicated local `H2S_CALENDAR_TEST_DATABASE_URL`; without
that variable its separate regression remains skipped.

The mobile pass also exercises commercial submission/approval, callback
save/reopen, installation confirmation/reschedule/cancellation, discarded
drafts, Queue/Calendar navigation and filters against isolated fake-data
servers. Responsive Chromium checks cover 320/390/430/768/1440px widths and
short landscape date popups. These checks do not certify physical iOS/Android,
real provider delivery, or production scheduler operation. Shared popup and
interrupted-approval regressions are in `tests/mobile_funnel_controls.test.cjs`.

## Staff-controlled business tools (released)

### Consultation review links and call reminders

Current workflow: the owner opens the request-specific review link,
reviews that consultation, and explicitly clicks Approve or Decline. SMS
YES/NO commands (with or without reference codes) no longer make decisions.
The link-only backend was deployed on 2026-10-24 as
`dpl_4WJeAgMosNvWZRfkCF3ARTAwedUW` at the existing
`https://h2s-backend.vercel.app` alias. All five deployed application source
hashes match the isolated build. The 108 focused working-tree fixtures,
TypeScript check and isolated production build passed. Production signature
rejection (403), signed empty-payload rejection (400), unknown review token
(404), and public approval-page loading (200) were verified without sending
messages or changing bookings. No frontend release, provider reconfiguration
or schema migration was needed. The notes below describe the earlier cutover;
the owner's individually paced live approval/reminder check is still pending.

The customer pre-window reminder was subsequently deployed as
`dpl_54aGoANx1RKqDuBwVB71GH4dX6Vo` at the same backend alias. Both changed
application source hashes were verified against the isolated build. All 111
focused working-tree fixtures, TypeScript and the isolated production build
passed; the same non-mutating production checks passed without a test send,
booking change, provider reconfiguration or migration.

The 2026-10-23 live SMS check found the business number's incoming SMS webhook
still pointed to PurelyAutomation. Its generic forwarding alert sent the owner's
YES to a number being used as the test customer; Home2Smart never received that
decision. Test roles were not reversed. Replacing this route is an explicit
provider configuration change, not something an application deployment does.

The selective five-file backend correction was deployed on 2026-10-24 at
03:20 UTC as `dpl_63vGp99v6vmngZND3nfSjuoUz7FU`, followed by the authorized
SMS webhook cutover. All five deployed source hashes match the tested overlay;
signature rejection and signed empty-payload rejection were checked without
creating messages or records. Voice/fallback settings were independently
unchanged. At that earlier release, application changes were uncommitted over
`f9c4a07`; the current selective source commit includes the correction and
the subsequent link-only decision workflow.
The fresh test `COM-F412A8` remained pending after cutover. Actual owner reply
and timed-reminder delivery require the owner's individually paced acceptance
test; the release did not replay the earlier YES or send additional SMS.

- Incoming SMS must POST to
  `https://h2s-backend.vercel.app/api/twilio/inbound-sms`.
  Configure `TWILIO_INBOUND_SMS_WEBHOOK_URL` to that exact URL in the backend's
  production environment before deploying the matching handler. Keep the
  existing `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and owned sender settings.
  Do not disable signatures in production. Delivery callbacks remain at
  `/api/twilio/message-status`; inbound and delivery callbacks are different.
- Cut over only the number's SMS URL/method/application binding. Preserve its
  voice forwarding, voice application, fallback and other provider settings.
  Do not forward arbitrary incoming text to customer or staff phones. Ordinary
  customer replies stay in the existing dashboard Messages inbox.
- Initial and rescheduled owner messages offer the unique review link only.
  Opening a link loads its request without approving it. An explicit button
  action posts the token-bound decision. A reschedule rotates that token, so
  an old link cannot approve the revised window. References remain useful
  identifiers, not SMS commands.
- All signed incoming SMS, including owner YES/NO replies and replies to older
  messages, stay in the existing Messages inbox. They do not approve, decline,
  forward alerts, or send automatic replies.
- Link approval persists acceptance and the existing consultation appointment,
  then queues the customer's call-window confirmation. The review page displays
  the separate decision, appointment and notification results; it does not send
  the former SMS-reply acknowledgement. Appointment or customer-text failures
  produce review instructions instead. Provider acceptance is not proof of
  delivery. Existing communication history and signed callbacks are preserved.
- Newly booked consultations enroll the existing `next_reminder_at` field for
  an owner call reminder 15 minutes before the window and another at its start.
  The pre-window stage also sends one customer reminder, only when the original
  confirmation was accepted and current Text first/SMS consent still permits
  it. It states that this is a phone consultation, not an installation visit.
  Customers do not receive a second window-start reminder or a late catch-up
  reminder if the pre-window stage was missed. Customer reminders have their
  own effect key, delivery callbacks and Customer communication-history entry.
  Known customer-send rejections can retry before the window without repeating
  an accepted owner reminder; uncertain attempts are not automatically resent.
  A failed customer reminder does not block the owner's window-start reminder.
  The existing 15-minute maintenance cron drives these reminders; this is not a
  new sales-chasing policy or an exact-to-the-minute timer. Only the recorded,
  still-configured consultation owner receives the staff reminders.
  The linked appointment identity, state and window are
  checked, and the effect ledger prevents repeated sends across concurrent cron
  runs. A missed pre-window reminder is not sent together with the start reminder.
  In-flight provider messages cannot be recalled.
- Previously booked consultations with no reminder due time are not retroactively
  enrolled. Passed windows and ended appointments stop generating reminders.
  Sales Hold/Close does not silently cancel booked consultations or these call
  reminders. Invalid ownership or appointment state requires operator review.
  Internal installation reservations still do not send messages.
- The dashboard remains the record of responsibility, appointment and
  communication evidence. Do not substitute a bare SMS or provider acceptance
  for the saved record. With one initial reviewer, the full successful SMS path
  has three customer messages and three owner messages, with no inbound reply;
  additional initial reviewers add messages. SMS charges depend on segments and
  carrier fees, so dashboard-led review avoids redundant broadcasts and chasing.

No schema migration is required for this correction. It reuses the existing
consultation, appointment, SMS inbox, effect ledger and maintenance endpoint.
Local fixtures are not evidence that the provider webhook has been changed.
Record actual deployment and provider verification separately. Do not replay a
historical YES or send another acceptance test without the owner's instruction.

### Scheduling and workload increment

Migration `036_commercial_calendar_workload.sql` is additive. The owner authorized
its guarded production release on 2026-10-23 at 14:38 US Eastern; applied status
must be verified with the migration runner, not inferred from this document.
There is one shared Home2Smart installation calendar, not a crew-management
system. Its singleton row/name is configuration; no extra resources, business
hours, travel buffers or availability are inferred.

- Reserve directly from a lead without creating an order/job. A tentative hold
  blocks capacity until its required staff-selected expiry. Expiry releases
  capacity by database time without a cron run; the expired record and its
  selected expiry remain visible. Confirmed bookings require explicit customer
  agreement and remain reserved until explicitly rescheduled or cancelled.
- Half-open windows allow one booking to end exactly when another starts.
  Database serialization protects all reservations across leads, including
  concurrent requests and legacy linked-installation scheduling. Reschedule
  requires agreement again for confirmed windows; cancellation releases the
  window, not the job or appointment. There is no invented duration limit.
- Confirmed agenda changes update an explicitly linked installation's existing
  order/job window. Legacy window changes feed the same agenda. Adoption fails
  on incomplete or overlapping existing linked windows; reconcile those
  explicitly rather than guessing durations or discarding reservations.
  Already finished/cancelled jobs are not imported as new reservations. A later
  explicit job completion/cancellation is reflected in reservation history and
  releases calendar capacity; calendar actions never complete/cancel the job.
- Set next action/Hold until require a responsible staff member, future due time
  and reason. Close records an outcome/reason, clears internal due time and
  removes the lead from active/attention filters. All/Closed/search retain it.
  A held lead stays out of attention until due; due holds return without a
  scheduler. Closing a lead never hides its reserved installation from agenda.
- Hold/Close pause consultation sales chasing. Reopen/expiry do not silently
  resume it. Pending requests are flagged for review, not cancelled. Staff can
  explicitly resume reminders only after reviewing a pending future window.
  Booked consultations and their appointment reminders remain unchanged.
- Every action records authenticated staff identity, reason and history.
  Revisions and operation keys protect retries and stale saves. Booking actions
  do not send messages, collect money, assign installers or start installation.

The Queue email-label cleanup remains included: optional email appears
as `Email: ...`. The released customer Continue scroll behavior is untouched.

### Connected job preparation

Migration 036 includes shared `h2s_job_preparation` and immutable
preparation activity, keyed to the existing dispatch job ID. No new customer,
order, job or calendar is created. Existing Commercial lead-to-order/job links
remain the adapter; a future residential intake can call the same preparation
RPC without adopting Commercial intake or pricing rules.

- Agenda customer buttons open the same linked lead/job, including closed leads
  outside the current Queue page/filter. Back to calendar preserves its date and
  Queue search/cursors. Queue remains a responsibility/follow-up view.
- Job detail reuses existing order scope, work location, schedule, directory
  assignments, proof, completion and payment evidence. Scope/materials/site
  review and explicit blockers are internal facts, not booking or dispatch.
- Owner decision: preparation review is required and unresolved blockers prevent
  start. Scope, location, equipment or schedule changes invalidate the review.
  Edits serialize with start under the job lock, with revisions, context tokens,
  stable retry keys and authenticated before/after history.
- Lead location remains distinct from a job's agreed work site. The explicit
  "Also apply" choice copies it into the linked job/order in the same transaction,
  without retyping; preparation then needs review. After work starts this copy
  and reservation editing are unavailable.
- The database enforces preparation on Commercial starts and shared jobs that
  opt into preparation; unrelated existing jobs do not gain an invented gate.
  Linked Commercial completion uses the existing staff operation through a
  narrow RPC wrapper. Legacy completion paths that trigger payouts/mail cannot
  complete or replay completion of those jobs. No new automatic sends, payouts,
  payments or technician acceptance are authorized.
- Communications retains signed delivery evidence and distinguishes internal
  actions, provider acceptance, delivery and acknowledgement. The optional shared
  SMS preview reuses authenticated `smsMessages` reads; it does not mark read,
  create a thread, or send. Phone history may include other projects. New sends
  remain in Messages under its existing consent/retry protections.

No named staff, fixed seats, new crew system, inventory purchasing, residential
funnel, quote-to-order conversion, payment collection or technician-portal
execution redesign is included. Priced order/job creation and any reconciliation
of existing equipment metadata remain existing/manual workflows. Saving preparation
does not change the legacy equipment-delivery gate or claim payment received.

Earlier scheduling validation: 177 focused/compatibility tests passed, plus a native PostgreSQL
test using genuinely independent transactions (overlap rejection, adjacent windows,
stale-writer rejection). Production backend build and TypeScript passed. Full-shell
fixtures passed at 1440, 393 and 320 pixels in three timezones; the final mobile
agenda correction was rechecked with populated columns, not only root overflow.
Five customer Continue-scroll scenarios passed. All mutations were fixture-only;
physical iOS Safari and production scheduling adoption have not been tested.
Automatic follow-up and Commercial email remain disabled.

This phone-only increment and the Queue/presentation changes were directly
deployed through Vercel on 2026-10-23 from
`7bc101e8b54102a9ea86cde4823f3c66f7eb26d4`, using
`PORTAL_BUILD_20261023_160427_7bc101e`. Guarded migrations 034 then 035 are
applied and independently verified. Automatic internal follow-up remains
disabled, and no new outbound chase sequence or payment/scheduling gate exists.

- **Current release is phone-only:** new requests offer Text first or Call first
  and require a valid phone number. Text first still requires explicit texting
  consent. Optional email is saved but does not opt anyone into marketing.
- Email-first is rejected by both public APIs, including stale clients with a
  valid email and phone. Old Email-first records remain readable and unchanged;
  their preference and consent are never silently converted to Text or Call.
  Editing an old email-only draft requires choosing an available phone channel.
- No automatic customer email is connected to submission. The new Queue email
  composer/retry actions are hidden while `COMMERCIAL_EMAIL_ENABLED` is absent
  or false; saved email is plain text, not an action promising a send. Existing
  email evidence remains read-only. The dormant transport and signed-event code
  are retained for a separately reviewed future reactivation, not enabled now.
- Quotes record a staff-entered all-in USD amount, scope/reference, full-payment
  or deposit/balance terms, and explicit evidence for staff-recorded approval.
  There is no price/tax calculator, customer approval portal, automatic checkout
  or charge. Collect money using the existing business process.
- Manual payment facts distinguish reported from staff-checked receipt.
  Remaining balance uses staff-confirmed entries only, not reported amounts.
  These entries are never called Stripe verification. Corrections retain the
  original audit record and do not issue refunds. A quote with active payment
  records cannot be silently repriced.
- Admin-only contact-note attachments, quote/payment documents and installation
  proof use a private Storage bucket with five-minute signed viewing links.
  A contact attachment can reference the actual recorded contact attempt.
  Installation proof records its already linked job; uploading does not complete
  work. Original files and existing public media placements are not modified.
  JPEG, PNG, WebP and PDF are supported, up to 3 MB per file. Deferred email
  code supports three files and 3 MB combined; sending remains unavailable.

Deferred email configuration, outside Git (not required for this release):

| Name | Purpose |
| --- | --- |
| `SENDGRID_API_KEY` | Existing SendGrid sender credential; never committed. |
| `SENDGRID_FROM_EMAIL` | Existing verified Home2Smart sender. |
| `COMMERCIAL_EMAIL_REPLY_TO` | Monitored business mailbox for actual customer replies; `SENDGRID_REPLY_TO_EMAIL` is an alternative. |
| `COMMERCIAL_EMAIL_ENABLED` | Leave absent or `false`. Future staff sending requires separate approval; it does not restore public Email-first or automatic receipts. |
| `SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY` | SendGrid's ECDSA public verification key, not the API key or Twilio SMS token. |

If email is reactivated in a future release, signed SendGrid events target
`https://h2s-backend.vercel.app/api/commercial-email-events`. Preserve any existing
provider webhook integration when adding this consumer; do not blindly replace
another active webhook. Configure processed, delivered, deferred, bounce,
dropped, spam-report and unsubscribe events. Open/click events are not reading
or acknowledgement evidence; new Commercial messages disable tracking pixels
and click rewriting. Signed recipient/provider correlation and event IDs prevent
wrong-message updates and duplicate/out-of-order delivery regression. Opt-out
and bounce suppression blocks new sends pending address/consent review.

Production read-only preflight found existing SendGrid API/from configuration,
but no Commercial enable/reply-to or signed-webhook key. The actual sender key
has `mail.send` only; sender-verification and webhook administration reads return
403. A separate temporary `SENDGRID_WEBHOOK_ADMIN_API_KEY`, configured outside
Git in the ignored `backend/.env.migrations.local` or the setup process
environment, is needed to inspect/configure the signed webhook. It is a setup
credential, not a new application runtime secret; keep the production sender
key restricted. This setup is deferred, not a phone-only release prerequisite.
Supabase Storage has RLS
and no browser-role object policies. Migration 035 checks that default-deny
boundary before adding its private bucket; it does not grant browser storage
access or require taking ownership of Supabase-managed Storage tables.

Behavior is fixture-validated, not live-message/payment acceptance. Production
read-only checks verified source/build identity, 11 page/assets, guarded access,
an authorized queue read, operations storage and private Storage protections.
Commercial images and native video playback/pause/seek passed desktop/touch
Chromium checks. Physical iOS Safari is not available in this environment.
No customer records, messages, payments or media settings were changed by smokes.

## Queue follow-up and delivery (released)

This focused increment preserves the existing queue layout, Upcoming actions,
Recorded activity, mobile navigation, staff dropdown and independent consultation,
installation and payment facts. It adds no customer-contact cadence, quoting,
payment collection, new recipients or permissions.

The same selective proposal includes a presentation-only sign-in refinement:
a compact border-first surface, smaller existing logo, persistent field labels,
solid primary Sign in button and secondary expandable admin account creation.
Authentication requests, account-creation permissions, PIN handling and bootstrap
behavior are unchanged. No separate deployment boundary is introduced.

Queue pagination is hidden only on the first page when the server supplies no
continuation. Previous history and sparse filtered-search continuation remain
available, even for an empty result segment. Controls are neutral/compact, with
explicit loading and disabled states; displayed page numbers describe cursor
history, never an invented total. Stable footer controls preserve keyboard
focus across updates without changing existing filters, cursor traversal,
selection or list-scroll rules. Header Sign out uses a transparent 44px icon
control with keyboard focus and a native desktop tooltip; logout requests,
session clearing and reload behavior are unchanged. The approved sign-in is
preserved, within the same unreleased selective proposal.

Email-first requires a valid email on both intake and submission, persists the
preference on the lead and submitted manual-follow-up request, and restores
both after reload. Its receipt says "We'll follow up by email." Staff alerts
use the existing configured consultation/dispatch phone routing and identify
manual email follow-up, not technician approval. Customer SMS, technician
approval and technician reminders are skipped for these requests, including
when an optional phone and earlier texting consent exist. Queue exposes the
email link/manual action. Contact-log channel defaults to the lead's preference
but remains editable to record what actually happened; logging is not sending.
Follow-up saves do not replace the customer's preference.

The original manual-only proposal did not send customer email. The later email
implementation is retained but deferred from this phone-only release. No
initial receipt or Queue email send is active. A manual contact log still is
not proof an email was sent or delivered.
Live submission/staff delivery/customer follow-up remain authorized acceptance
checks, not production-verified behavior.

The same proposal includes narrow Commercial customer-page corrections:
all seven custom dropdowns cancel wrapping-label activation before option
synchronization, hide their backing selects, and redirect validation/label
focus to the accessible custom trigger. Native file controls and explicitly
native selects remain native. Property-type labels are clearer; stored values
are unchanged.

The green receipt uses the saved lead contact preference (request metadata is
the legacy fallback), never an unsaved form selection. Email promises manual
email follow-up, Call manual calling, and Text asks customers to check texts
without claiming delivery. Technician approval without an appointment link is
not a booking. An expired unresolved window explicitly needs staff follow-up;
approaching a window does not imply approval or successful contact. Provider
acceptance is not delivery or acknowledgement. Receipt facts refresh on load,
submission and saved edits; there is no new status-polling or outbound sender.
Same-request editing and explicit separate-project clearing are preserved.
Intake reloads return the latest request for the token-authorized lead, including
declined/expired requests, so a resolved receipt does not silently become a draft
with a fresh submit button. The active-request lookup used for submission replay
and duplicate prevention is unchanged. No broader read permission is added.
To avoid trapping a device on an old receipt, the proposal also carries forward
the existing local clear/new-project control and reset handler, without the
unrelated wizard scrolling or marketing edits. After submission it is labeled
"Start a separate project" and requires confirmation. It clears only this
device's form/token, never the server request; cancelling keeps the same project.

The customer page has an opaque root/body base matching the footer endpoint
and adds bottom safe-area padding inside the footer, without toolbar overlays
or sticky-header changes. Physical iOS Safari, its expanded/collapsed browser
controls and bottom overscroll remain unverified. Chromium fixtures are not
an iOS pass. After an authorized preview/release, on an iPhone record its model,
iOS version and tested build, then check all seven dropdowns (one picker per
selection), restored selections, native photo upload, each preference's receipt,
and the footer with Safari controls expanded/collapsed and during bottom bounce.
Use an approved fixture request rather than submitting production test data.

- Follow-up and installation start/end retain canonical `datetime-local` values,
  using the shared styled Flatpickr editor. Labels name the browser's
  timezone. Unchanged values retain their exact saved instant, including
  subsecond precision and the original occurrence of an ambiguous DST time.
  Edited nonexistent or twice-occurring clock-change times are rejected with
  an explanation rather than silently shifted; select an unambiguous time.
- Staff can choose a manual override (including no next date), an exact
  customer-requested callback, or the internal automatic policy when enabled.
  Callback outcomes require an exact time and take precedence. Existing dates
  and legacy follow-up activity are treated as manual, not silently enrolled.
- Proposed defaults, **inactive pending review**: submitted inquiry and
  `no_response` -> next business day at 09:00; `left_message` -> two business
  days at 09:00. Business days exclude weekends, not holidays. Policy timezone
  proposal: `America/New_York`; confirm this matches operations before enabling.
  `reached`/`other` create no automatic date. Closed/lost or completed/cancelled
  installations generate no automatic task. Explicit staff overrides are not
  replaced by the maintenance worker.
- Dates derive from persisted event time, not scheduler run time: overdue
  tasks do not roll forward on refresh. One existing next-action field is reused;
  CAS, deterministic operation keys and audited history prevent duplicate tasks
  from retries, saves or repeated worker runs. Automatic terminal cleanup
  affects only an automatic internal task, not consultation reminders,
  installation status or payment.
- Shared bright button streak pseudo-elements are removed at their source.
  Keyboard focus, neutral hover, disabled/saving states remain. Existing-order
  lookup alone receives narrower compact sizing; mobile keeps its prior
  minimum touch height.

### Configuration and release prerequisites

Migration [034](../backend/migrations/034_commercial_followup_delivery.sql) is
additive and **applied / verified**. It adds service-read/RPC-write SMS
receipts and an idempotent status-event ledger, plus a guarded follow-up RPC.
It does not alter 032/033, provider settings, cron schedules, stored historical
messages, media assets or operational records. Migration 035 is also applied
and verified; the runner reports no pending migrations. The first transaction
rolled back safely; 035 was corrected to revoke Supabase's inherited service-role
write grants, with a reproducing fixture and unchanged strict permission guards.
Exact checksums and authorization are in [database migrations](DATABASE_MIGRATIONS.md).
No new follow-up scheduler or customer-contact cadence is enabled.

Runtime settings belong in backend deployment environment variables, not Git:

```text
INTERNAL_FOLLOW_UP_POLICY_JSON={"enabled":false,"timeZone":"America/New_York","localHour":9,"businessDays":{"new_request":1,"no_response":1,"left_message":2}}
TWILIO_STATUS_CALLBACK_URL=https://h2s-backend.vercel.app/api/twilio/message-status
```

Policy configuration is optional; absence uses the disabled proposal.
Production leaves it disabled. `TWILIO_STATUS_CALLBACK_URL` is configured to the
canonical URL above; no provider account settings or real sends were changed.
An enabled policy requires the entire validated configuration. Activation
requires timing approval, then an authorized scheduler that POSTs to
`/api/commercial-follow-up-maintenance` using `Authorization: Bearer CRON_SECRET`.
It must drain `nextCursor` pages using `?after=<cursor>` until null, starting
from the beginning on the next cycle. No cron entry is installed by this change.
An invalid configuration/storage error is reported; no send/recovery endpoint
is called. Missing/invalid authorization is rejected.

### Why acceptance did not become delivery evidence

The commercial sender previously persisted Twilio's initial status/SID but
specified no per-message status callback; no local delivery-callback ingester
was implemented. This explains the local evidence gap. External Twilio
account/number/messaging-service callback settings remain uninspected:
missing receipts do **not** establish failed delivery.

When explicitly configured, new commercial SMS sends pass the canonical HTTPS
callback URL above to Twilio. The new POST endpoint requires valid signatures
against that configured URL, the expected `TWILIO_ACCOUNT_SID`, valid message
SID/status and exact recipient/sender identity. It uses `TWILIO_AUTH_TOKEN`
for validation and never honors the inbound-handler debug bypass.
Duplicate fields, invalid identity/signature and unsupported bodies are rejected.
Storage failures return a retryable error rather than acknowledging lost evidence.
Existing sends are unchanged if the callback URL is absent; an invalid configured
URL prevents a send and reports configuration failure.

Receipts can arrive before message/effect persistence and correlate later by
exact SID; a recipient mismatch is marked for review. Duplicate events are
idempotent. Late queued/sent updates cannot regress delivered/failure evidence.
Contradictory terminal evidence is retained and shown as **Status unavailable /
needs review**, with available error code/message, not guessed certainty.
The compact queue labels are Pending, Accepted by Twilio — delivery not confirmed,
Delivered, Delivery failed, and Status unavailable / needs review.
Timestamps distinguish application attempts from when a signed provider update
was received; no actual delivery instant is invented. Delivered does not mean
read, technician YES, consultation approval or customer acknowledgement.
Current recipient routing is shown separately and is not proof of a send.

This increment does not backfill historical statuses, poll Twilio, send test
messages or change production provider configuration. After a separately
authorized migration/backend/frontend release, configure the canonical callback
URL in the backend and verify webhook reachability with approved provider
testing. Older sends acquire evidence only if Twilio actually supplies a
callback to this endpoint; historical acceptance remains unconfirmed otherwise.

### Validation boundary

Fixtures cover business-day/DST calculation, overrides and terminal states,
repeat-safe saves/worker runs, real Twilio signature validation, SID correlation,
pre-persistence callbacks, retries/out-of-order/conflicting statuses, exact date
round-trips and the full dashboard on desktop/mobile viewports. These are not
production operational tests. Windows Edge native-picker invocation and keyboard
date entry are fixture-tested. Physical iOS Safari remains unverified; viewport
emulation is not an iOS pass. No live messages, jobs, payments, media saves,
provider changes, migration applications or deployments are part of validation.

## Scope and release boundary

This increment extends the existing canonical [dashboard](../frontend/dash.html).
The owner explicitly authorized migrations [032](../backend/migrations/032_commercial_operations.sql)
and [033](../backend/migrations/033_atomic_stripe_order_metadata.sql) for production
`nkccbnrduojnzjfrpwva`. They were applied in that order and verified on
2026-10-23 UTC, before the reviewed backend and matching frontend were deployed.
No production backfill, job creation, charge, notification or operational
recovery was triggered by the release checks; existing access controls were preserved.
Without 032, the new detail section reports that the migration is required; the
existing consultation queue remains usable. Never run legacy SQL to bypass this guard.

The selected payment scope is **existing priced orders only**. Leads without an
explicit linked installation display **Quote/payment setup required**. Payment
collection is not connected for those leads.

### Brand and customer copy (released)

System-authored Commercial page text, SMS prefills, technician/customer texts
and reply templates use **Home2Smart**, with the number 2. Regression coverage
rejects spoken-brand misspellings without rewriting customer-entered content
or historical messages. Call/Text instructions use plain next steps; a request
is not a confirmed appointment, and a consultation is not an installation.
Consent wording, recipients, approval links and send behavior are unchanged.
The reviewed page cleanup also clarifies service labels without changing stored
values and replaces the redundant manual Save progress action with an autosave
note. The isolated release passed 87 focused tests, five navigation scenarios,
nine customer/dashboard fixture workflows, TypeScript and a production build.

### Customer form navigation and returning visitors

The released navigation correction measures the sticky header after the new card
layout. Continue aligns the next step number and heading with a 16px header gap,
instead of adding the card's top padding to that gap. Back and step selection
keep their card-edge target; the submitted receipt keeps its existing target.
Focus behavior and reduced-motion support are unchanged. Short desktop steps
still respect the browser's page-bottom scroll limit rather than adding empty
space below the page. Production files match the release recorded above; actual
form submissions were tested with fixtures, not with live customer records.

The browser remembers a lead token and draft under `h2s_commercial_lead` and
`h2s_commercial_draft`; these are origin/browser-profile storage, not a device
identity or a one-project-per-device rule. Reopening loads the saved lead and its
active request. Answers remain visible/editable, while an active submission
disables another submit; the backend also replays an active request rather than
sending duplicate notifications. Editing details is not a new request.

The numbered stepper describes form progress, not business progress. Status is
loaded when the page initializes; it is not live-polled. There is no dedicated
submitted-summary/new-project flow. Closing operational follow-up does not
automatically close the separate consultation request or reset the browser.
Any future summary/edit/start-another-project UX must preserve the existing
request/reference, require an explicit new-project action, and retain server-side
duplicate protection; that behavior change is not implemented by this scroll fix.

### Commercial branding

New consultation requests, manual-follow-up alerts, acknowledgements,
confirmations, reminders, escalations and technician SMS replies use Home2Smart,
including decline, reschedule, safe recovery and error replies. The approval
page retains that visible brand on its loading and error states. Historical
message bodies, domains, references, consent records and provider/effect keys
are not rewritten; accepted/uncertain effects are not replayed for branding.
The business-tools increment retains dormant email implementation, but this
phone-only release does not offer Email-first or Queue email sending. Consultation
approval creates its appointment through the guarded RPC, not the legacy
schedule/checkout mail path. The shared mail sender already uses Home2Smart
Portal; no automatic ongoing email cadence or completion communication is enabled.
Branding fixtures do not verify real SMS/email delivery or provider configuration.

### Customer video playback

Proof-rail loading feedback must never intercept native video controls. An idle
`preload="none"` video must remain playable; a thumbnail is not playback evidence.
A loading/buffering episode that cannot reach playable data within 30 seconds
stops its media request and retains the poster with an explicit unavailable
message. Readiness and user pause cancel that deadline. Unsupported codecs use
the same error fallback; this does not transcode or overwrite original media.
The selected Camera installs MOV contains HEVC Main video and AAC-LC audio.
Its public proxy serves QuickTime MIME and valid byte ranges. HEVC playback
depends on the browser/OS; Chromium viewport emulation is not iOS Safari proof.

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

[033](../backend/migrations/033_atomic_stripe_order_metadata.sql) is additive and
separately checksum-guarded. Under explicit owner authorization, the guarded runner
applied and verified it after 032 in production on 2026-10-23 UTC. Both reviewed
migration SQL files and their checksums remain unchanged. Apply/verify the
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

Use the [guarded database workflow](DATABASE_MIGRATIONS.md). 032 and 033 are now
included in the exact production authorization, with separate owner-approval
records and normalized-LF SQL checksums. This authorizes no future migration.
The runner checks prerequisites, default-deny
RLS/table permissions and service-only RPC execution. Existing table access is not
changed. Review and explicit target/checksum authorization remain required before apply.

Production release checks verified exact deployed files, unauthorized dashboard
rejection, an administrator-key queue read, service-role operations storage reads,
RPC schema-cache availability, all three Commercial media areas and native video
playback in desktop/mobile Chromium. Signed-in operations details were not
requested because session authentication updates `Last_Seen_At`; no session was
created or touched by these read-only checks. Real provider delivery, actual
installation/payment transitions and physical iOS Safari remain unverified.
See the [business walkthrough and two-person acceptance checklist](COMMERCIAL_WORKFLOW_PLAIN.md).

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
# Shared dashboard date and dropdown controls

All dashboard date, time and local date/time inputs use the existing styled
Flatpickr popup, including dynamically rendered Commercial forms and Agenda.
The underlying named fields retain their machine-readable values and the
existing timezone/DST checks. Native file inputs remain unchanged.
The Queue filter now uses the same styled single-select as the other dashboard
dropdowns. Open date pickers and unsaved drafts defer background detail refresh.
Date popups support keyboard opening/dismissal, clearing, required fields,
disabled/read-only state and reduced-motion preferences.
