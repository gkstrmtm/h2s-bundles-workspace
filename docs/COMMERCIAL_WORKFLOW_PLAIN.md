# Home2Smart commercial workflow

## Read this first

**Release status: deployed on 2026-10-23.** The phone-only Commercial page,
Queue/presentation improvements, manual quote/payment records and private
attachments are deployed at https://shop.home2smart.com/commercial and
https://portal.home2smart.com/dash.
Application source: `7bc101e8b54102a9ea86cde4823f3c66f7eb26d4`.
Dashboard/customer cache ID: `PORTAL_BUILD_20261023_160427_7bc101e`.
The latest update includes the reviewed Commercial copy/autosave cleanup,
Continue-only measured-header alignment and consistent Home2Smart SMS wording.

Database updates 029–035 are applied and independently verified. Backend and
matching frontend were deployed directly through Vercel; Git-triggered
deployments remain disabled. Commercial email is paused and not needed for this
release. Leave its enable setting absent or false. No email subscription or
provider setup is required for these phone-only changes.
A setup error means report and resolve setup, not assume a message was sent.

Evidence means three different things:

- **Fixture-tested:** Call/Text contact rules, optional email without marketing
  enrollment, unchanged historical Email-first records, saved manual quotes,
  deposit/balance and payment facts, and private attachment/proof rules.
  Tests use local records and fake email/payment services. Earlier fixture
  coverage includes intake/contact preferences, technician decisions and
  no-response handling, follow-up, installation rules, communication evidence,
  payment verification, Home2Smart branding, media framing and video failures. The
  latest isolated release passed 87 focused tests, five navigation scenarios,
  nine customer/dashboard fixture workflows, TypeScript and a production build.
- **Production-read-verified (this release):** both deployments identify the
  application source above; 11 checked page/assets match the committed or
  build-stamped bytes. Customer, dashboard and media routes load. Unauthorized
  requests are rejected; an authorized administrator-key read loads the queue.
  The database updates, service-only permissions, private Storage protections
  and read-only operations storage checks passed. All
  three Commercial media areas rendered, and the actual public Camera installs
  video played using native controls on desktop and touch Chromium, including
  pause, resume and seeking. No real media settings were saved.
- **Not yet live-tested:** private uploads, manual quote/payment records,
  both owners' sign-in/roles, signed-in installation
  details, real intake/uploads, technician replies, reminder delivery, customer
  messages, installation changes and real payment outcomes. Signed-in operations
  reads were deliberately left to acceptance testing: authentication updates
  session activity, which the strictly read-only release checks avoided.
  Physical iOS Safari is also unverified. Passing fixtures and viewing checks
  does not mean the whole business funnel works in production.

The release checks did not submit an inquiry, send a message, create a job,
charge anyone, invoke maintenance/recovery, or change media settings. Existing
scheduled processes remain configured; their message delivery was not tested.
The SMS status-callback URL is configured for future Commercial sends.
Historical provider acceptance is not upgraded to delivered without evidence.
Automatic internal follow-up remains disabled; staff still sets due times.

## The eight steps

### 1. The customer sends an inquiry

- **Who acts:** the customer opens the Commercial page, describes the work and
  chooses Call first or Text first. Both require a phone number.
- **Automatic:** valid contact details can save a draft before final submission.
  The final request saves the inquiry and requested consultation window. A
  request is not an installation booking or a price agreement.
- **Manual:** the customer submits the request. Texting requires the customer's
  texting choice/consent. Call preference requires a staff call; no phone call
  is automated. Email is optional, saved for possible future use, and does not
  subscribe the customer to marketing. Email-only follow-up and automatic
  customer emails are not offered in this release.

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
  consent also receives a pending acknowledgement. Call requests send
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
  Call requests are manual follow-up, not technician approval requests.
  Historical Email-first records remain unchanged and need staff review; do
  not silently switch their preference or send texts without permission.

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
- **Manual:** call the customer, or use the established text conversation only
  when texting is allowed. Record the actual outcome and next action in the
  Queue. The contact log itself does not make the call or send a message.
  Saved email is informational; no Queue email action or automatic email is
  available. Historical email evidence, if present, remains read-only.
- **Manual:** set a
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

**Proof and attachments:** open **Private attachments and work proof** to upload
JPEG, PNG, WebP or PDF, up to 3 MB. Choose contact note, quote document, payment
evidence or installation proof. A contact attachment can reference its recorded
contact attempt. Installation proof requires the correct already linked job.
Uploads do not complete work. Viewing links expire after five minutes; refresh
business records to renew them. No mandatory photo-count rule has been added.

### 7. Check payment without assuming money was collected

- **Who acts:** staff reviews the linked existing priced order's payment result.
- **Automatic:** the read check compares Stripe information with the actual
  order amount/currency and checks relevant refund/dispute evidence. It does
  not charge the customer or update payment records. Missing configuration or
  failed reads must show unavailable/unverified, not paid.
- **Manual:** investigate unknown, unpaid, refunded, disputed or mismatched
  results in the approved payment process. A technician YES, an opened checkout,
  or a stored "paid" label alone is not payment proof.

**Staff-controlled quoting and collection:** open **Quote and payment terms**.
Enter the actual written all-in quote, scope and reference. Choose full payment
or a deposit amount with the remaining balance. If recording customer approval,
state who approved, when and how. Attach the written quote for staff reference.
Arrange its delivery with the customer outside this email-disabled tool.
This is not an automatic quote calculator or online
customer approval page; the customer's budget is never an approved price.

Collect money using the established business process. Under **Manual payment
records**, record the amount, method, time, reference and how receipt was
checked. “Reported” does not reduce the displayed balance; staff-confirmed
receipt does. These are manual facts, never Stripe verification. Correcting a
record keeps its history and does not refund money. Quote pricing/terms cannot
be silently changed while active payment records exist.

Scheduling and payment collection stay separate and under staff control.
These records do not generate an installation job/order or a Stripe checkout,
charge a customer, calculate taxes or decide that payment is required before
scheduling. Link the actual existing priced installation before using its
assignment/start/completion controls.

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
- [ ] Confirm the new form offers only Call/Text and requires a phone. Optional
  email stays saved-only; there is no email composer or marketing enrollment.
  Any historical email evidence remains read-only.
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
  texts and schedule existing technician reminders for consented Text-first.
  Call-first remains a manual staff call. No new customer email is sent.
- [ ] Quote/payment saves, payment-record corrections and private attachments
  change real records. A payment-record correction is not a refund; uploading
  proof is not installation completion.
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
