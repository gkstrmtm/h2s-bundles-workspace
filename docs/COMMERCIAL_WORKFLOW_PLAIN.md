# Home2Smart commercial workflow

## Read this first

**Release status: deployed.** Checked October 22, 2026, at approximately
11:43 p.m. US Eastern (October 23, 03:43 UTC).

The approved database updates were applied and verified. The matching backend
and customer/dashboard pages were deployed directly to Vercel, backend first.
Git-triggered deployments remain disabled. Reload an already open dashboard
once to get the new controls. A message saying the database update is required
still means stop and report it, not work around it.

Evidence means three different things:

- **Fixture-tested:** intake/contact preferences, technician decisions and
  no-response handling, follow-up, installation rules, communication evidence,
  payment verification, Home2Smart branding, media framing and video failures
  were exercised using made-up data and fake message/payment services. The
  reviewed release also passed its production build and focused tests.
- **Production-read-verified:** deployed files match the release. Unauthorized
  requests are rejected; an authorized administrator-key read loads the queue.
  The database updates, permissions and operations storage reads passed. All
  three Commercial media areas rendered, and the actual public Camera installs
  video played using native controls on desktop and mobile Chromium, including
  pause, resume and seeking. No real media settings were saved.
- **Not yet live-tested:** both owners' sign-in/roles, signed-in installation
  details, real intake/uploads, technician replies, reminder delivery, customer
  messages, installation changes and real payment outcomes. Signed-in operations
  reads were deliberately left to acceptance testing: authentication updates
  session activity, which the strictly read-only release checks avoided.
  Physical iOS Safari is also unverified. Passing fixtures and viewing checks
  does not mean the whole business funnel works in production.

The release checks did not submit an inquiry, send a message, create a job,
charge anyone, invoke maintenance/recovery, or change media settings. Existing
scheduled processes remain configured; their message delivery was not tested.

## The eight steps

### 1. The customer sends an inquiry

- **Who acts:** the customer opens the Commercial page, describes the work and
  chooses email, call or text.
- **Automatic:** valid contact details can save a draft before final submission.
  The final request saves the inquiry and requested consultation window. A
  request is not an installation booking or a price agreement.
- **Manual:** the customer submits the request. Texting requires the customer's
  texting choice/consent. Email and call preferences need staff follow-up;
  there is no automatic commercial customer email or phone call.

Optional customer photos/plans are implemented: JPEG, PNG, WebP or PDF, up to
3 MB each and eight files total. This is not an unlimited attachment inbox,
document interpretation service or installation proof upload. Production
upload/reopening has not been live-tested for this release.

### 2. Staff finds the inquiry and checks notifications

- **Who acts:** staff signs into the Home2Smart dashboard and opens
  **Commercial Queue**. Drafts and submitted requests must not be mistaken for
  the same stage.
- **Automatic:** a consultation submission attempts a staff text to the
  configured consultation/dispatch recipients. A text-preferring customer with
  consent also receives a pending acknowledgement. Email/call requests send
  staff a manual-follow-up alert instead of an approval request.
- **Manual:** check the customer's preference, request status and recorded
  communication results. The routing summary identifies configured recipients;
  do not assume both owners or every technician receives each alert.

An alert accepted by the message provider is not proof it was delivered, read,
or acknowledged. Failed, unavailable or uncertain results need review.

### 3. The technician responds YES, NO, or does not respond

- **Who acts:** the configured technician reviews the request and uses its
  approval link or replies with the request reference.
- **Automatic:** YES records approval and attempts to create the separate
  consultation appointment. A customer confirmation text is attempted only
  after appointment creation succeeds and texting is allowed. NO records a
  decline, attempts the allowed customer update and alerts management to
  follow up. It does not book a replacement time.
- **Manual:** staff reviews appointment creation and communication results.
  YES alone does not prove an appointment or customer confirmation succeeded.
  Email/call requests are manual follow-up, not technician approval requests.

With no response, the scheduled maintenance process can remind the technician
and then escalate to configured management recipients. Defaults are a
15-minute interval and two reminders, but configuration can change them.
An expired requested window also needs review; silence never confirms it.
Actual cron execution and message delivery have not been live-tested here.
After a reschedule, use the current approval link: a delayed text reply must
not approve the old window.

### 4. Staff records contact and the next follow-up

- **Who acts:** an authorized administrator opens the inquiry's
  **Update follow-up** section.
- **Automatic:** saving records responsibility, next follow-up, open/closed
  status and an activity history. Selecting **Log a contact attempt** records
  the chosen channel, outcome and notes. It does not send the contact.
- **Manual:** actually make the call, send the email/text through the approved
  business channel, then record what happened and the next action. Set a
  responsible person and due time; assigning responsibility does not grant
  dashboard access.

Closing a lead does not complete an installation, confirm the customer or stop
separate consultation reminders. A follow-up date is a work reminder on the
record, not an automatic customer contact.

### 5. Keep consultation and installation scheduling separate

- **Who acts:** the technician/staff handles the consultation; an administrator
  handles the installation.
- **Automatic:** successful consultation approval creates a consultation
  appointment. It is not a paid installation order. Saving an installation
  window updates only the explicitly linked existing installation/order.
- **Manual:** agree installation timing with the customer and installer, check
  availability and equipment, then save the installation window. The save does
  not check capacity or send a customer confirmation.

Check the displayed time zone before saving. Changing the inquiry address does
not automatically change an existing order's work address.

### 6. Link and record an existing installation

- **Who acts:** an administrator, using an already priced order and its
  existing installation job.
- **Automatic:** **Find existing order** reads a possible match. Linking checks
  the customer and order/job relationship; it rejects consultation appointments,
  unmatched records and conflicting links. It does not create an order or job.
- **Manual:** verify and explicitly link the correct records, then record an
  existing active installer with notes. This records assignment, not technician
  acceptance, a notification or a portal action.

To record a start, the job needs its assignment, saved window, work address,
notes and the required equipment-delivered/not-needed condition. To record
completion, work must be in progress with one clear installer, completion notes
and no unresolved critical flags. These buttons record business facts.

Completion does **not** pay the technician, send a receipt/review request, or
message the customer. Staff must handle any required downstream business work
separately.

**Proof limit:** existing recorded work-evidence links can be viewed. Commercial
Queue does not upload new installation proof or attach files to a contact note.
An empty evidence list is not proof photos exist elsewhere. No mandatory
photo-count rule has been added.

### 7. Check payment without assuming money was collected

- **Who acts:** staff reviews the linked existing priced order's payment result.
- **Automatic:** the read check compares Stripe information with the actual
  order amount/currency and checks relevant refund/dispute evidence. It does
  not charge the customer or update payment records. Missing configuration or
  failed reads must show unavailable/unverified, not paid.
- **Manual:** investigate unknown, unpaid, refunded, disputed or mismatched
  results in the approved payment process. A technician YES, an opened checkout,
  or a stored "paid" label alone is not payment proof.

**Unfinished:** custom commercial quotes, quote approval, custom payment
collection, pricing/tax rules, deposits and balances are not connected here.
Without an existing priced installation, expect **Quote/payment setup required**.
Do not improvise a price, create a fake order, or treat the customer's budget as
an approved quote.

### 8. Change Website Media deliberately

- **Who acts:** an administrator opens **Website Media** and the destination:
  Commercial Hero, Camera/security area, or TV/display area.
- **Automatic:** destination thumbnails use the customer renderer's selection
  rules. The context shows which page/API was checked and when. **In use** means
  selected feed inventory under those rules, not independent proof of what is
  currently visible on the deployed website. Included/eligible is not the same
  as displayed. Commercial shows up to four items per rail; hero alternatives
  are tried on load failure, not on a timed rotation.
- **Manual:** open the correct destination's placement editor or **Replace**,
  choose the asset, drag/zoom its frame, and explicitly save. Cancel makes no
  media-setting change. Replacement changes that destination's selection, not
  the original file or another placement.

Use placement framing for one destination. **Shared media edits** have a wider
asset scope; do not confuse them with that destination's independent frame.

Saved database-backed placement changes can be read by customer pages without
a code deployment. The compatible frontend/backend must already be deployed;
an old open page can need a reload or cache refresh. Opening the editor or
selecting a thumbnail does not publish it. Reopen the saved placement, then
check the actual customer page on the intended device. Local previews are not
proof of deployed rendering. The public page now includes the native-video-control
correction. The original video was preserved; playback still depends on the
device's support for its format, and unsupported/failed media shows a fallback.

## Two-person acceptance checklist

Use separate authorized accounts. One person operates while the other checks
the displayed result; then swap. Do not share passwords or use real customer
actions just to demonstrate a screen.

### Viewing checks: no business-record changes

Signing in and authenticated viewing update session activity, not customer or
installation records. Do not type into a customer form or press a save/action
button while doing these checks.

- [ ] Both people can sign in with their intended permissions; unauthorized
  users cannot access protected dashboard data.
- [ ] Open an owner-approved existing inquiry. Compare its contact preference,
  consultation state, follow-up and communication evidence without saving.
- [ ] Confirm operations loads rather than showing a database
  update required. Read existing order/job/payment details without linking or
  changing them. Opening details can make read-only Stripe checks.
- [ ] Open the Commercial form **without typing**: valid contact entry can
  autosave a real draft.
- [ ] Inspect all three media destinations and their origin/check time. Open a
  placement, inspect it, then Cancel; do not save a replacement.
- [ ] On the deployed customer page, click/tap native video Play, pause, resume
  and seek. Check desktop and a real phone. Record iOS results separately;
  mobile Chromium fixtures do not count as Safari testing.

Some production reads and video checks above were performed during release.
This remains a two-person acceptance checklist for your actual accounts and
devices; leave each item unchecked until both people have checked it.

### Actions that change records or may send messages

Do these only after a separate agreement about the customer/technician,
recipients, timing and expected effects. Prefer fixtures first.

- [ ] Typing valid production contact details, submitting an inquiry, or uploading
  customer files creates/changes real records. Submission may send staff/customer
  texts and schedule reminders.
- [ ] YES/NO, approval links, rescheduling, maintenance/recovery/retry controls
  may change requests, create consultation appointments or send real messages.
  They are not viewing checks.
- [ ] Follow-up saves, contact logs, closure, linking, installation scheduling,
  assignment, start and completion all write real records, even where no
  notification is sent.
- [ ] Saving Website Media changes what customer pages can serve.
- [ ] Do not create test orders/jobs, run payment checkout, charge customers,
  trigger payouts or send messages as a release smoke test.

Keep a short record of who checked each item, which environment/page they used,
when it was checked and what actually happened. Leave untested items unchecked.
