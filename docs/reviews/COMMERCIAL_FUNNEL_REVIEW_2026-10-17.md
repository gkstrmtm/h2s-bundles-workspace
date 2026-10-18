# Commercial funnel review and incremental agent tasks

Reviewed commit: e3f88bab8c822061ee997d11a559f85973abc26b, retro-dev. Review date: 2026-10-17.
Scope: frontend/commercial.html and commercial.js; commercial-intake, commercial-intake/photo, commercial-consultation API routes; commercial_consultation_runtime.ts and commercial_consultation.js. No live customer submissions, SMS, database changes, deployment, or browser acceptance tests were performed.
The newer uncommitted intake/queue/all-leads work is unavailable here. Reconcile every finding against the local working tree before changing code. Do not overwrite newer implementations.
The dashboard fetch returned empty content through the connector; this review does not establish dashboard behavior or absence of queue handling. Guessed admin-route paths returning 404 do not prove those features are absent.

## First: protect dispatch and lead access

### C01 — Public input controls dispatch recipients and approval-link origin (high)
Evidence: backend/app/api/commercial-consultation/route.ts POST accepts assignedTechnicianPhone and assignedTechnicianName from the request body. Runtime getTechnicianPhones includes the supplied phone. sendTechnicianConsultationRequest sends the approval-token links to those recipients. Runtime getPublicBaseUrl prefers arbitrary Origin headers for most origins, even when a configured public base exists.
Impact: a public caller with a lead token can influence the destination for approval links; an attacker-controlled Origin can influence links sent to technicians. These are code-level trust-boundary defects, not a demonstrated production exploit.
Task: choose dispatch recipients server-side; reserve assignment overrides for an authenticated admin path. Build action links from validated configured origins, never arbitrary request Origin. Avoid exposing internal technician phone fields unnecessarily in public response serializers.
Acceptance: forged assignment fields cannot add recipients; forged Origin cannot change approval hosts; legitimate dispatch still works using a fake SMS transport. Do not send real messages for testing.

### C02 — RLS policy names do not enforce service-role-only access (high, actual exposure requires verification)
Evidence: backend/lib/commercial_consultation_runtime.ts ensureCommercialConsultationTables creates policies named "Service role has full access ..." with FOR ALL USING (true), without a TO role restriction, for commercial_leads and commercial_consultation_requests.
Impact: these policies themselves do not isolate the service role. Effective anon/authenticated access depends on grants and other database configuration not inspected here.
Task: inspect actual grants and policies on the live database read-only. If exposed, correct through a narrowly scoped versioned migration; retain legitimate server access. Remove conflicting permissive runtime policy creation so it cannot reintroduce the defect. Do not blindly revoke access used by other application paths.
Acceptance: real anon/authenticated clients cannot enumerate or mutate commercial records through direct table access; authorized backend routes work; policy migration and runtime source agree. Report exact verified role behavior.

## Then: reliable lead capture and booking

### C03 — Email-only visitors hit a late phone requirement (high)
Evidence: commercial.js validateStep(2) and saveLead accept phone OR email. Consultation POST rejects leads without a phone. The form offers "Email first", while sendCustomerPendingAcknowledgement and approval handling send SMS without checking contact_preference.
Impact: a visitor can complete five steps and then discover they cannot submit. Success copy promises follow-up using their chosen method, which these automated notification paths do not implement.
Task: preserve an email-only lead handoff for manual follow-up if scheduling requires SMS; or clearly request the required phone earlier with an explanation. Match contact-preference copy and operational behavior. Do not silently replace this with mandatory SMS for all visitors. Explicitly explain automated texts before submission and record the selected communication behavior without inventing legal guarantees.
Acceptance: email-only, call-first, and text-first flows each have a usable, honestly described outcome; automated notifications follow the implemented policy.

### C04 — Save/autosave requests race and can lose newer data (high)
Evidence: commercial.js maybeAutosave starts saveLead on blur whenever no token exists; there is no in-flight guard. saveLead adopts whichever response finishes last. Intake POST generates a new token when none supplied. After the first token exists, maybeAutosave skips server updates; fetchIntakeConfig hydrates the server record ahead of the local draft.
Impact: concurrent initial saves can create multiple leads; out-of-order saves can overwrite newer fields. Later local-only edits can be replaced by stale server data on refresh.
Task: introduce stable draft identity plus server-side idempotency; serialize/coalesce saves with revision handling; reconcile drafts and server state deliberately. Make local draft versus server-saved status visible. Preserve returning customer data.
Acceptance: delayed/reordered responses and rapid blur create one lead and retain latest edits; post-save edits survive refresh; invalid tokens have a clear recovery path.

### C05 — Consultation submission lacks atomic duplicate protection (high)
Evidence: commercial.js requestConsultation has no submitting guard or disabled submit state. Consultation POST checks findActiveConsultationForLead, then inserts separately. The inspected runtime-created schema has ordinary lead/status indexes, not an active-request uniqueness rule. Remote constraints were not inspected.
Impact: concurrent requests can pass the same check and generate duplicate requests/notifications unless an additional database constraint exists.
Task: add browser in-flight protection and server/database idempotency appropriate to consultation status. First inspect actual constraints. Return the same existing result for retries rather than a confusing generic failure.
Acceptance: two simultaneous requests yield one active request and one notification workflow; retry after a response timeout recovers the existing reference; guard re-enables on failure.

### C06 — Scheduling depends on machine timezone and accepts arbitrary slot strings (high)
Evidence: buildSlotSuggestions in backend/lib/commercial_consultation.js uses local Date setHours/getDay. Browser formatSlot and runtime getSlotLabel omit an explicit timezone. Consultation POST normalizes strings but does not validate future dates, end-after-start, duration, or allowed windows. Suggestions are template times, not a calendar/capacity lookup.
Reproduction using the fetched utility, now=2026-10-19T12:00:00Z, count=2:
- TZ=UTC: 2026-10-19T15:30Z and 2026-10-20T09:30Z.
- TZ=America/New_York: 2026-10-19T15:00Z and 2026-10-19T17:30Z.
Task: explicitly generate business windows in America/New_York and label them consistently across UI, SMS, and appointments. Validate slot semantics server-side. Keep "requested window, pending approval" honest; do not advertise calendar availability without a capacity source.
Acceptance: same business windows across server/browser timezone changes and DST boundaries; invalid/past/reversed slots rejected; no automatic confirmation claim.

### C07 — Appointment creation and notification success are conflated (high)
Evidence: runtime applyConsultationDecision sends customer confirmation SMS BEFORE maybeCreateAppointment. Successful SMS sets status customer_confirmed independently of appointment success. Consultation POST persists the request before awaiting notifications; an exception afterward can return 500 for an already-saved request.
Impact: customer can receive confirmation with no appointment record; retries can produce confusing results. "customer_confirmed" records send success, not customer acknowledgement.
Task: distinguish persisted request, technician approval, appointment creation, notification submission/delivery, and customer acknowledgement. Make actions idempotent and retryable, with visible admin recovery for partial failure. Never mark notification delivered solely from provider acceptance.
Acceptance: injected appointment/SMS/provider failures leave truthful status and a recoverable queue item; retries do not duplicate appointments or confirmations.

## Photos and smaller funnel improvements

### C08 — Eighth-file limit is applied after storing a new object (medium)
Evidence: photo route uploads an object, then merges URLs with slice(0,8). With eight existing URLs, a ninth upload can succeed without retaining its URL. Read-modify-write updates can also lose concurrent attachment additions.
Task: enforce count before storing and atomically reserve/link attachments; clean up storage if persistence fails. Align browser accepted types with backend JPEG/PNG/WebP/PDF allowlist; image/* currently includes unsupported formats. Check actual hosting request limits before promising 10MB through base64 JSON.
Acceptance: ninth file rejected before upload; concurrent uploads retain both references or fail cleanly; unsupported/oversized files get early useful messages. Verify storage privacy separately: getPublicUrl alone does not prove the bucket is public.

### C09 — Errors can be invisible until the final step (medium)
Evidence: validateStep reports through setStatus; #formStatus resides inside hidden wizard step 5.
Task: use a visible current-step error region and focus the relevant field/summary. Keep errors accessible. Validate actual phone/email format before allowing progress, not just nonempty strings.
Acceptance: missing service/contact errors are visible on steps 1/2 without navigating forward; keyboard and screen-reader users receive useful feedback.

### C10 — Copy adds administrative friction (conversion hypothesis, not measured)
Evidence: hero says "Plan the right commercial install before you book it" and CTA "Start project assessment"; long labels include "Add the planning details that change the recommendation" and "Add photos if the environment benefits from them." Budget options "$10k+" and "$25k+" overlap.
Task: simplify around a clear consultation request. Example CTA: "Request a consultation"; photo heading: "Add photos or plans (optional)". Use non-overlapping budget bands, maintaining compatibility with stored values/reporting. Make optionality and pending approval explicit. Confirm service area, capabilities, and any response-time promise operationally before publishing.
Acceptance: concise copy without invented guarantees; saved historical budget values still display correctly. Treat conversion benefit as a hypothesis until measured.

## Sequence and handoff rules

Work one increment at a time:
1. Reconcile C01/C02 with current local files; fix verified access/dispatch issues.
2. Resolve C03 contact contract.
3. Resolve C04/C05 persistence and retry behavior.
4. Resolve C06/C07 scheduling and operational state.
5. Resolve C08/C09; then small copy changes C10.
6. After newer Commercial Queue/all-leads work is available, trace every state into the authenticated admin surface. Verify ownership, next action, failed notification recovery, duplicate merging, and scheduling visibility. Do not infer these from this review.

For each increment report exact changed paths, reproduced behavior, tests run, remaining uncertainty, and any migration applied. Preserve unrelated work and existing migrations. Use the authorized production migration workflow only for necessary additive or narrowly scoped corrective changes. No real customer SMS/bookings during tests. Do not deploy.

Before committing, report proposed scope and validation; wait for the user's commit instruction. Distinguish unit/mocked tests, actual database tests, browser verification, and deployment verification. Revalidate the isolated committed snapshot before push.
