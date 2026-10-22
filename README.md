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

The canonical dashboard loads `commercial-labels.js`, `dash.js`, `media-placement-style.js`, `media-placements.js`, `dash-messages.js`,
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
Customer pages load only `frontend/media-placement-style.js` for saved framing.
The dashboard loads the same formatter plus the admin-only `frontend/media-placements.js`
editor. Customer pages do not download editor controls, preview labels, or destination-preview code.
Fixture images and crop-guide fixtures remain outside production source files.

Budget and timing identifiers are formatted by `frontend/commercial-labels.js`
without changing their stored values. The Commercial page uses the same timing
formatter for summaries and newly composed messages. Technician routing reports
current-window dispatch-effect counts, separately from a named assignment.
An accepted provider attempt does not establish delivery, reading, appointment
creation, customer confirmation, or completed customer follow-up. Older backend
snapshots without routing evidence explicitly leave notification status unverified.

Website Media remains a shared asset pool with independent source/asset/page/area
overrides for inclusion, order, fit, focus and zoom. Placement saves do not edit
the source asset or another placement. Fixture regressions cover save/reopen,
cancel, scoped exclusion/order, and the Bundles/Commercial consuming renderers:
`node --test backend\tests\media_placements.test.cjs`.
The existing workbench previews active destinations at desktop 1440x900 and mobile
390x844. It reads the actual local destination HTML/CSS, including deferred styles,
fonts, responsive content sizing, and overlays, into a script-disabled, read-only
frame. Page startup, tracking, forms, and inline handlers do not execute there.
The public renderer and editor share the same fit/focus/zoom CSS. The same saved
framing is previewed at both sizes; no mobile columns or production migration
are introduced. Live personalized/dynamic content is not run inside the preview.

The current Bundles layout has no installation rail or cart reassurance strip.
Those historical destinations are labeled unavailable and are not editable;
their saved overrides are neither deleted nor reassigned. Legacy slot diagnostics
are collapsed/read-only, not presented as a competing current-page editor.
For another developer-integrated page, register its surface/area in
`backend/lib/mediaPlacementCatalog.json` and its actual page/frame/consumer
classes in `frontend/media-placements.js` (or the catalog area's `preview`
metadata). A missing destination fails explicitly rather than inventing a frame.

Library updates retain usable items, keyed gallery nodes, filters, selection,
focus, scroll and open editor drafts. Same-scope requests are deduplicated;
superseded responses cannot replace the current asset or usage snapshot. Failed
updates retain data with contextual Retry. Initial placeholders are used only
without usable data. Read-only browsing no longer schedules write-backed video
thumbnail repair; upload/explicit optimization tools remain separate. Broken
thumbnails stop their error handler and show an unavailable label instead of an
invalid-data-URL retry loop.

Library counts describe the loaded shared library before filters, not all storage.
Captions sit below thumbnails. Image uploads, replacements and explicit optimization
use automatic AVIF/WebP selection, 72% quality and a 1920px maximum edge by default.
Optional advanced settings control format, quality and maximum size (including
original dimensions); disabling optimization preserves the upload. Videos bypass
image conversion. Unsupported AVIF falls back to correctly labeled WebP; an encoding
failure stops the upload rather than silently substituting the original.
The expandable Hero placement menu identifies Bundles/Commercial destinations and
saved inclusion/order for the selected asset, then opens the existing placement
editor without writing. An absent override does not imply the asset is unused:
automatic selection may still use it.

Gallery clicks, Enter/Space and Edit Asset open the existing shared-file editor.
Each tile's underlined Page placement action first asks for a supported page and
display area, with saved uses shown. An explicit page/area shortcut opens only that
destination; choosing or previewing never writes. Page heroes shows actual resolved
automatic or explicit media using the customer-safe `media-page-heroes.js` selection
rules shared with Bundles and Commercial. Choose media reuses the unchanged gallery
and carries that page's exact hero context into its Page placement action.
Page-use labels say “Shown on” rather than exposing internal override terminology.
Gallery captions show a quiet “In use” cue with the current page/display areas on
hover and in the tile's accessible description. These use resolved public page feeds,
not historical slots. Commercial rails accept up to four photos, videos, or a mix;
their camera/TV service restrictions are unchanged.
The embedded framing preview shows the selected candidate, not necessarily the
customer page's selected media; saved overrides are labeled separately. Its page
controls are inactive. Use the current customer-page link outside the frame to
inspect actual selection. Bundles retains its existing curated hero fallback when
no explicit hero applies, unless that asset is excluded. Historical slot data remains
untouched underneath but is not displayed. Technical tools are collapsed under Advanced
media tools; normal controls do not expose asset IDs or build diagnostics.

Fixture checks:
`node --test backend\tests\media_placements.test.cjs backend\tests\media_refresh.test.cjs backend\tests\commercial_queue.test.cjs`.

### Commercial media category extension - proposed, not implemented

Upload staging/storage does not itself guarantee placement eligibility. The
placement API and shared-edit service parser currently admit only `tv_mounting`
and `cameras`; the shared library loads those two services, and the public
Commercial security/display rails have matching service filters. Owner Uploads
stores `service_type` as text, but that does not bypass placement/public filters.
No new rejected dropdown options have been added.

The smallest compatible extension is a shared service registry used by upload
metadata/edit validation, library queries, placement eligibility/catalog and
public consumers. Review identifiers for networking/Wi-Fi, structured cabling
and access control first. Keep existing identifiers and service-specific rails
unchanged; allow approved new services in a general hero before proposing more
page sections. Reconcile actual remote `proof_packs`/`proof_assets` constraints
and legacy metadata before preparing any additive constraint migration; those
remote constraints have not been verified in this local-only pass. Rights,
visibility, optimization, source isolation and existing role checks must remain
unchanged. No category schema, permissions or production migration were changed.

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
