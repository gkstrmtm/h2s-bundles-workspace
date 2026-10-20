# Home2Smart Platform

Production backend API and frontend for Home2Smart home services business.

## Collaboration Model

- Stable branch: [main](docs/PORTAL_BRANCH_WORKFLOW.md)
- Foundational media-engine branch: `retro-dev`
- Other major portal changes should use separate feature branches, not `main`

Start here before making portal changes:

- [docs/PORTAL_BRANCH_WORKFLOW.md](docs/PORTAL_BRANCH_WORKFLOW.md)
- [docs/PORTAL_WORKSTREAMS.md](docs/PORTAL_WORKSTREAMS.md)
- [docs/OWNER_UPLOADS_ENGINE.md](docs/OWNER_UPLOADS_ENGINE.md)

## Kickoff / Handoff

- Primary handoff doc: [KICKOFF_CHECKLIST.md](KICKOFF_CHECKLIST.md)
- Deployment guide: [FINAL_DEPLOYMENT_GUIDE.md](FINAL_DEPLOYMENT_GUIDE.md)

## 📁 Repository Structure

```
home2smart-platform/
├── backend/                    # Next.js TypeScript API
│   ├── app/api/               # 50+ API routes
│   │   ├── v1/route.ts       # Analytics & insights
│   │   ├── stripe-webhook/   # Payment processing
│   │   ├── notify-management/ # SMS notifications
│   │   └── shop/             # Product catalog
│   └── package.json
│
├── frontend/                   # Static HTML/CSS/JS pages
│   ├── bundles.html           # Service packages
│   ├── funnel-track.html      # Analytics dashboard
│   └── Home2Smart-Dashboard/
│
└── docs/                       # Architecture docs
```

## 🚀 Quick Start

### Backend Development
```bash
cd backend
npm install
npm run dev              # http://localhost:3000
vercel --prod           # Deploy to production
```

**Live API**: https://h2s-backend.vercel.app

### Frontend Pages
Static files - deploy to any host (Vercel, Netlify, GitHub Pages)

## 🔑 Environment Setup

Create `backend/.env.production.vercel`:

```env
# Supabase (2 databases)
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
SUPABASE_URL_MGMT=
SUPABASE_SERVICE_KEY_MGMT=

# Payments
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Communications
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# AI
OPENAI_API_KEY=
```

## Dashboard navigation and admin access

The canonical dashboard uses a mobile navigation drawer at widths up to 1024px.
Menu opens it; Close, Escape, the backdrop, or selecting a destination closes it.
Focus stays inside the open drawer, and desktop resizing restores the normal sidebar.
Navigation destinations are keyboard-operable buttons.
Mobile Log Hours remains an icon-only, accessibly labeled control; shared Logout
typography must not restore its hidden text. Back to queue is a left-aligned
text control above the selected detail, retaining a 44px touch target.

ADMIN access follows the account returned by `dashboardLogin` or `dashboardMe`,
not a role cached in local storage. The legacy shared credential remains supported,
but is checked by a read-only Commercial Queue request before access is granted.
Backend authorization is unchanged; this does not add VA or owner permissions.

Regression checks: `node --test backend\tests\dashboard_shell.test.cjs`.

## Dashboard messaging dependencies

The canonical dashboard loads `dash.js`, `media-placements.js`, `dash-messages.js`,
then `sms-no-flicker.js` in order. Session startup and login wait for the required
scripts; a load failure is reported at the login gate instead of silently falling
back to customer SMS handlers.

`dash-messages.js` adapts the existing messaging UI to account-based internal
conversations using the authenticated `messages*` endpoints. It retains teammate
selection, conversation naming, drafts, unread state, pagination, draft polishing,
Gmail compose, and admin-only deletion. It does not send customer SMS.
`sms-no-flicker.js` only deduplicates unchanged conversation-list rendering,
including the current search, names, unread state, and selection. Thread scroll
preservation belongs to the internal refresh handler, not another wrapper.

One cancellable messaging poll runs while the pane is active, skips network work
while hidden, and awaits requests before scheduling another tick. Unauthorized
responses disable composing; stale responses cannot restore access. Sends are
guarded against concurrent submission and preserve failed or newly edited drafts.
Both support scripts are versioned runtime dependencies, not generated artifacts.

Fixture-only regression checks:
`node --test backend\tests\dashboard_messaging.test.cjs`.

## Commercial Queue

The queue keeps its desktop split view. At 980px and below, selecting an intake
opens its detail; **Back to queue** restores the filters, selection, and scroll.
Contact links open the device's phone or email application; this view does not
send customer messages. Scope and additional notes are displayed separately.
Detail hierarchy is company/contact and actionable status, next action/contact
links, Requested work, then compact supporting rows. Preference labels read
Prefers email/call/text. Routing, provider/reminder information, and technical
recovery stay under Technical processing details; an accepted SMS is not proof
of delivery or customer acknowledgement. Missing notes do not add an empty panel.
The queue filter uses the existing native-select opt-out so dropdown synchronization
cannot replace its options or interrupt keyboard focus while filtering.
Host-container cleanup leaves the main content width to the shared responsive
stylesheet rather than imposing a desktop sidebar offset on phone layouts.

The ADMIN-only `commercialQueue` GET accepts `q`, `filter`, `limit` (1–250), and
an opaque `cursor`. Search runs across all commercial intakes, including their
up to eight service selections. Filters use the latest consultation per intake,
not any historical matching request. Stable submitted/created/ID cursors replace
the newest-150 cap. Each request examines at most 1,000 candidates; sparse
workflow filters can return a partial or empty page with **Continue search**.
This is continuation, not an assertion that no older matches exist.

Counts in the strip describe the current page. `pagination.totalMatches` is
exact for the unfiltered workflow view and deliberately `null` for derived
workflow filters; `totalCandidates` counts the server-side text-search dataset,
not the number matching a workflow filter. Pagination is not a transactional
snapshot: resubmitted records can move to the newest end between requests.
No new schema or permissions are required.

The queue reuses the existing technician SMS YES/NO and approval-link workflow,
not a separate messaging system. YES records approval, then appointment creation
and customer confirmation are shown independently from their persisted results.
NO keeps the decline and alternate-window/manual action visible even if a
notification fails. No response remains pending with existing reminders or
escalated for management review. Provider acceptance is not delivery, customer
acknowledgement, or completed follow-up; neither technician response marks a lead
handled. A revised window still requires the current approval link.

Website Media remains a shared asset pool with independent source/asset/page/area
overrides for inclusion, order, fit, focus and zoom. Placement saves do not edit
the source asset or another placement. Fixture regressions cover save/reopen,
cancel, scoped exclusion/order, and the Bundles/Commercial consuming renderers:
`node --test backend\tests\media_placements.test.cjs`.
Saved CSS framing is consumed independently on both pages. Pixel-identical
editor/site cropping is not yet verified: the Bundles hero uses a responsive
content-height frame, while its catalog preview is fixed at 16:9. Preserve the
shared pool and scoped overrides when reconciling that preview; do not change
all placements or the source crop to compensate.

Refresh runs on entry, stale focus/visibility, reconnect, after processing,
and every minute while this authorized view is visible. Requests are deduplicated;
superseded responses are ignored. Failed updates retain the last good results,
label their search/filter scope, and offer Retry. Unchanged detail content is
not rebuilt, preserving focus and expanded technical details. A 20-second request
deadline prevents stalled refreshes from blocking recovery indefinitely.

Deploy the reviewed backend and frontend together. An older backend is visibly
marked as a limited newest-25 snapshot, with search/pagination disabled; it must
not be presented as a complete commercial search.

Still proposed, not implemented: persisted responsibility, contact outcomes,
next follow-up and handled state; explicit server-enforced commercial capabilities
for VAs/limited owners; authorized attachment viewing and an appointment destination.
Keep follow-up separate from technician decisions and appointment status. Review
an append-only contact history, actor attribution, concurrency, and capability
checks before preparing any versioned migration. Do not apply schema changes or
grant additional access as part of this UI increment.

### Existing lead-to-job and payment integration boundaries

- Commercial intake persists the lead and consultation request. Technician approval
  uses the existing `commercial_create_appointment` RPC to create/link a zero-total
  `APPT-COM-*` consultation row in `h2s_orders`. That is an appointment, not a paid
  installation job. The queue reads its link and notification results; this release
  does not create a quote, checkout, invoice, deposit, payment or dispatch job.
- The existing shop `create_checkout_session` flow separately creates a
  `pending_payment` order and dispatch record, then a Stripe Checkout session.
  The Stripe webhook updates orders and activates/creates dispatch jobs. These
  paths already exist; they were not implemented or payment-tested in this release.
- No explicit commercial queue action currently converts a consultation into an
  authorized priced job/checkout or displays authoritative payment state. Reusing
  the existing checkout needs durable lead/request/order/job/payment linkage and
  approved pricing, collection, reconciliation and access rules; these remain
  proposals. Do not change the protected consultation row into a paid work order.
- The generic administrator `create_jobs_from_orders` backfill scans recent orders
  without a commercial-appointment exclusion in its selection. Do not assume it is
  a verified commercial conversion path or run it as part of this release review.
  Remote database triggers and payment-provider state were not inspected here.
- Responsibility, contact history, next follow-up and handled state remain separate
  from technician approval, appointment status and payment status. None is completed
  by recording YES/NO or by an accepted notification.

Follow-up review proposal:
- One operational state per lead: responsible account, next follow-up, handled
  actor/time, and revision for optimistic concurrency.
- Append-only contact history: lead/request reference, authenticated actor/time,
  channel, outcome, note, and idempotency key. Store changes atomically; never
  infer completion from a technician approval or a notification's provider status.
  Technician YES/NO and no-response escalation remain inputs from the existing
  consultation workflow, not contact-history events claiming customer follow-up.
  A decline needs an alternate-window/manual action; appointment and confirmation
  failures after approval need processing review. Neither automatically handles
  the lead.
- Separate capabilities for commercial viewing, follow-up, assignment, and
  technical recovery. ADMIN retains existing access. VA/limited-owner grants and
  assigned-only versus all-commercial visibility require explicit approval;
  enforce both capabilities and record scope on the server.
- Before writing the next unused migration, inspect the configured target's
  migration ledger, account ID types, and existing schema. Do not backfill old
  manual requests as handled. No destructive change is proposed.
- Attachment viewing needs validated storage access, and appointment navigation
  needs an existing authorized destination; neither should expose a bearer token.

Fixture-only checks:
`node --test backend\tests\dashboard_shell.test.cjs backend\tests\commercial_queue.test.cjs backend\tests\commercial_contact.test.cjs backend\tests\commercial_reliability.test.cjs backend\tests\commercial_protection.test.cjs`.
Never run automated submissions, messaging, or recovery against the live preview.

## Business phone and call relay

The active local business number is **864-387-8413**. Public call links and
appointment support copy use this number, not the outdated website contact number.
Commercial intake prefers `COMMERCIAL_CALL_NUMBER`, then `PUBLIC_PHONE_NUMBER`,
then the configured Twilio sender (`TWILIO_FROM_NUMBER` / `TWILIO_PHONE_NUMBER`).

Voice forwarding is a published Twilio Studio flow, separate from customer SMS
preferences and technician/management dispatch lists. It calls one configured
recipient, displays the business line as caller ID, does not record calls, and
plays an unavailable message if the connection fails or goes unanswered.
Carrier voicemail can still count as an answered call.

Configure credentials and the relay destination outside Git:
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, and
`TWILIO_VOICE_FORWARD_TO`. From `backend`, validate without changing routing:

```powershell
node tools\configure-business-call-relay.cjs
```

Only after explicit authorization, publish and attach the verified flow:

```powershell
node tools\configure-business-call-relay.cjs --apply
```

The tool refuses unowned/nonvoice numbers, self-dialing, international targets,
existing voice applications, and unrelated voice handlers. It preserves and
verifies SMS settings. On an ambiguous provider update, read back the voice
configuration before retrying; do not delete a flow that may already be attached.
Keep the previous voice URL/method for rollback. Normal Twilio Voice and Studio
usage charges apply. Publishing this provider route does not deploy website
changes; those still require an explicitly authorized manual Vercel deployment.
Confirm actual ringing and conversation from a different phone than the relay
destination before marking end-to-end calling verified.

## 💡 Key Features

- Real-time analytics dashboard with Meta Pixel tracking
- Automated SMS notifications to management on bookings
- AI-powered marketing insights
- Stripe payment processing
- Tech portal for job management
- Customer photo uploads

## 🛠️ Tech Stack

- **Backend**: Next.js 14, TypeScript, Prisma
- **Database**: Supabase (PostgreSQL)
- **Payments**: Stripe
- **SMS**: Twilio
- **AI**: OpenAI GPT-4
- **Hosting**: Vercel

## 📊 Recent Updates

- ✅ Management notifications (SMS on every booking)
- ✅ Intelligent analytics insights (no loading states)
- ✅ TRUE database counts (removed 1000 cap)
- ✅ Time-based filtering (7/14/30/60/90 days)

## 🎯 Next: Performance Optimization

Focus areas for loading time improvements:
- Image lazy loading
- Code splitting
- Bundle optimization
- Caching strategies

---

**Production**: https://h2s-backend.vercel.app  
**Updated**: January 2, 2026
