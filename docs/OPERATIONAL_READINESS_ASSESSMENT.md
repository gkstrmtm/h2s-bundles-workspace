# Home2Smart operational readiness

Updated 2026-11-05 on `retro-dev`, continuing from assessment commit
`e22082d4bace80517ad5800e2af97807b8199c12`. This revision includes the coordinated
sales-readiness corrections, not another redesign.

**Current decision, 2026-11-06 UTC: the complete synthetic paid workflow passed
against private Vercel, native PostgreSQL/private Storage and Home2Smart's
existing Stripe Sandbox. This is not authorization to activate production.**
One canonical fictional household completed independent TV and returning-camera
purchases attributed to two representatives. Both accepted exact documents,
paid real Stripe **test-mode** deposits/balances, completed personally claimed
company installations with explicitly synthetic evidence, and received
management-approved actual-cost snapshots and separate earned commissions.

| Synthetic purchase | Total | Deposit / balance | Actual Stripe fees | Equipment / materials fixtures | Commission basis / 55% earning |
|---|---:|---:|---:|---:|---:|
| TV, 60-inch fixed | $179.00 | $44.75 / $134.25 | $1.60 + $4.19 | $24.88 / $3.00 | $145.33 / $79.93 |
| Returning customer, two included wireless cameras | $599.00 | $149.75 / $449.25 | $4.64 + $13.33 | $15.00 / $2.00 | $564.03 / $310.22 |

All four provider-generated `checkout.session.completed` event IDs correlate
with signed native receipts. Camera fees were initially unavailable at webhook
arrival: commission correctly stayed held. Existing authenticated **Refresh
payment** retrieved actual Stripe balance-transaction evidence, after which
native review earned $310.22; no estimated fee or synthetic webhook was used.
The first immutable Friday export allocates $79.93 for November 6; the independent
second export allocates $310.22 for November 13. These are synthetic future-Friday
accounting exercises, not bank transfers. Independent paid settlement remains
**$0.00**; missing settlement proof was rejected.

The original quote hashes and six-field customer legal/payment projections
remain unchanged after the repeat purchase. Accepted reads intentionally expose
additional locked policy metadata; this DTO difference is not a changed legal
snapshot. Separate orders, completion records, receipts and representative
earnings were verified. Each representative was denied the other's lead,
quotes, orders/history and earnings, and management/company actions. Managed
credential reset, old-credential denial, immediate disable/revocation and fresh
login after reactivation passed against hosted routes.

Native testing exposed and corrected the real residential-inquiry trigger
incompatibility with properly enrolled Field Sales bookings (054), without
fabricating intake consent or bypassing legal/deposit/booking gates. Premature
balance remains blocked, now with the correct HTTP 400 rather than a misleading
setup/storage 503. Staging-only catalog/legal/policy status is namespace-guarded
(053); no proposed configuration is marked production-approved.

**575 regression tests passed, 1 optional independent-session PostgreSQL fixture
skipped, 0 failed (576 total); backend TypeScript passed.** The optional fixture
was not pointed at shared public tables. Actual native booking, company proof,
payment and accounting authorities were exercised separately. Prior native
0/1/100/101/500/1000 pagination, Storage expiry/renewal and exact-run cleanup
evidence remains valid; fresh staging-only setup/Storage cleanup also passed.

The clean committed staging builder now retains only run-scoped authenticated
sales/authentication routes and keeps other APIs quarantined even if an old
quarantine flag is false. Release source is bound by the generated staging
manifest and Vercel deployment metadata; earlier overlay-only deployment IDs
below are historical. See [current infrastructure evidence](INFRASTRUCTURE_REUSE_AUDIT.md)
and [URLs, operating procedures and exact production gates](STAGING_LAUNCH_PREPARATION.md).
There is **no missing provider credential, database account or Supabase login**.
Real customer records, production deployments and live finances are untouched.

## Historical infrastructure timeline

The dated updates below describe earlier states and are superseded by the
current decision above, not requests for another database or credentials.

**Staging update, 2026-11-05:** dedicated private frontend/backend hosting is now
deployed from `428c2cc527d3216b2f060960aeb8dc4c621205f4`, with staging-only
routing/quarantine and correctly built current assets. Native database/storage,
Stripe test access and the native transaction/account certification remain
unavailable; sign-in/transaction APIs intentionally return 503. See the
[staging evidence and controlled-release checklist](STAGING_LAUNCH_PREPARATION.md)
for actual URLs, deployment IDs, 65 passing focused tests, hosted/visual evidence
and exact remaining blockers. This does not authorize production activation.

**Infrastructure reuse update, 2026-11-05:** authenticated read-only inspection
confirms Home2Smart's existing Stripe account, Supabase service access and local
TLS-verified PostgreSQL access. The native ledger matches migrations 029-039;
Field Sales tables/functions are not installed. No accessible test Stripe key
or authorized isolated database target was found. Both registered live webhooks
are disabled; no production setting was changed. See the
[reuse audit](INFRASTRUCTURE_REUSE_AUDIT.md), including 23 passing payment/
workflow regressions and explicit limits of the zero-dollar historical samples.
No separate Stripe account is required.

**Test-key update, 2026-11-05 19:40 EST:** management supplied the secret directly
to Vercel. It is now Sensitive, Preview only, in `h2s-staging-backend`; refreshed
backend deployment `dpl_EmfDmz4CSYAZrweuUKPe8BJhe811` is READY and includes the
variable. Its value was not retrieved outside Vercel. Subsequent private-runtime
checks authenticated to the same Home2Smart account in test mode; all ten SDK
read groups passed and card capability is active. There are zero registered test
webhook endpoints. Actual webhook delivery/database certification remain pending.
Twenty-nine guard/financial tests passed, including six temporary probe guards.
The diagnostic Preview and its token variables were removed; stable routing,
quarantine and payment-disable gates
remain in force; actual production was not redeployed.

**Staging connections update, 2026-11-05 20:18 EST:** the existing Home2Smart
test account now has Field Sales endpoint `we_1UYbioLuMP6aPhGZBXa9lU79`, with
exactly the handler's 13 events. It is **paused** pending native readiness.
`H2S_FIELD_STRIPE_TEST_WEBHOOK_SECRET` is securely stored Sensitive/Preview-only;
the existing API key was reused inside Vercel, not retrieved or requested again.
Clean backend `dpl_3TobVNnAAum6mE3WyY3A5nJqmzxo` is READY at the same private
alias; dedicated ingress reaches quarantine 503 and anonymous access remains
302. Setup deployment/token variables were removed. Both actual production
deployments and live webhook settings were untouched.
The current webhook/preflight/financial selection passed **33/33**.

Remaining infrastructure access: the existing Supabase organization cannot yet
be inspected with an authenticated management session/token. Its saved service
keys authenticate established databases, not project/branch provisioning.
Management can use its normal browser and existing account; no new Supabase
account or replacement Stripe key is needed. An authorized isolated target,
native baseline/migrations/grants and verified private proof bytes are still
required. No Stripe-delivered event or native deposit/balance/completion/
commission/repeat-purchase cycle is claimed. Exact approved catalog/legal/
commission policy inputs and authorized company installer identity remain
separate activation gates. See the [staging preparation and mapping](STAGING_LAUNCH_PREPARATION.md)
and [provider evidence](INFRASTRUCTURE_REUSE_AUDIT.md).

## Ready

Here, ready means implemented and verified in isolation, not activated in production.

| Area | Delivered behavior |
|---|---|
| Representative access | Standalone [sales application](https://portal.home2smart.com/sales.html), with Home, Leads, Quotes, Orders and Earnings. Ordinary representative work does not require the management dashboard. |
| Account control | Disabled-first SALES creation; separate activation; immediate disable/session revocation; strong management-controlled credential reset. SALES is correctly labeled in the general account directory and cannot use its administrative controls. |
| Lead reachability | Ownership-scoped server pagination, indexed customer/phone/address prefix search, management representative filtering, complete-scope counts and separately paged chronological overdue work. No 100-opportunity ceiling or whole-customer-registry browser download. |
| Returning customers | Explicitly verified additional opportunities under one immutable canonical customer anchor, including a different representative. Each sale retains separate quotes, agreements, payments, orders, completion and commission evidence. |
| Company installations | Existing authorized company personnel can personally accept and complete an eligible installation through native assignment, proof and completion authorities; no fabricated outside installer or impersonation. Actual costs and final-balance verification remain separate gates. |
| Financial rules | Existing customer prices, 25% deposit/75% balance, legal/cancellation protections, immutable snapshots, attribution, actual-cost basis, 55%/50%/45% tenure rates, Stripe verification and Friday review are unchanged. No automatic payout service. |
| Technician compatibility | Reviewed root portal and required installation assets are deterministically packaged into the actual backend serving layout during build. Existing technician controls are not redesigned or broadly activated. |
| Presentation | Approved standalone navigation, chronological follow-up table, management order cards, contextual panels and structured audit are retained. Orders outside the current lead page obtain the customer name from their own approved quote, not an unrelated loaded record. |

### How lead retrieval works

[Migration 049](../backend/migrations/049_field_sales_opportunities.sql),
[list API](../backend/app/api/field-sales/route.ts) and
[sales UI](../frontend/field-sales.js) implement:

- Bounded keyset pages: 25 by default, maximum 100 per request. Normal order is
  immutable creation time descending, then opportunity ID; due work is next-contact
  time ascending, then ID. Changing filters invalidates an old cursor.
- Database-enforced owner/customer authorization on every page and exact detail.
  ADMIN can search/filter authorized representatives; SALES cannot broaden its scope.
- Indexed prefix terms across customer, phone and property fields. This is not
  arbitrary browser-only substring search.
- Counts cover the entire matching authorized scope. Home retrieves overdue work
  separately, including older opportunities; its selected due-page cursor survives
  automatic synchronization. Previous/Next controls state the current page and total.
- Request/session guards prevent stale reads from replacing newer state. Genuine
  failures remove stale page content and offer Retry; forms and private files are
  protected during automatic synchronization. No routine Refresh button was added.

### Returning-customer procedure

Open the verified existing customer assessment, review **Customer service history**,
then select **Additional service for this customer** and record identity evidence.
Management can assign the new opportunity to another active representative.
Representatives can create another opportunity only from their own authorized sale.

The existing inquiry/work ledger remains intact: each repeat creates a new native
inquiry/work row and opportunity, while `customer_id` points to the original
canonical customer anchor. These work rows are not new canonical customer identities.
Normal duplicate-phone protection remains; uncertain matches are not merged.
Each opportunity has its own immutable originating representative and separately
approved commission credit. SALES sees only its authorized history; management sees
both purchases. Previously accepted quote/agreement snapshots are not overwritten.

### Management-operated installation procedure

1. Separately provision/verify the actual owner's or company installer's existing
   active native installer profile. Its email must match that person's ADMIN account
   exactly. Do not invent an outside person or grant ADMIN just to perform an install.
   Existing non-admin company installers retain the legitimate technician portal.
2. In Orders -> Scheduling, authorize **my verified company identity**, with explicit
   identity evidence. The new company roster starts empty.
3. Confirm accepted customer documents, verified deposit, calendar eligibility and
   actual materials/access readiness. Personally select **I will perform this
   installation** before doing the work. This uses the native offer/acceptance
   authority; another person's assignment cannot be claimed here.
4. Upload the real installation photographs and customer signature image; bind
   all pinned service requirements and personally verify required checklists.
5. Record the actual installation date, actual hours and equipment/material
   quantities, unit/total costs and receipt/evidence descriptions. Record evidenced
   zero-cost categories explicitly. Completion cannot precede personal acceptance
   or be dated in the future; missing proof still blocks submission.
6. Submit completion. Separately review and approve actual costs in management.
   Native server completion time remains the financial event authority; the actual
   installation date and authenticated company/pro identities are retained in evidence.
7. Issue/collect the eligible final balance through the existing customer handoff.
   Commission eligibility still requires verified payment, provider fees, approved
   actual costs and all existing legal/qualification rules. Review Friday amounts;
   export/approval is not a bank transfer.

Authorities: [company API](../backend/app/api/field-sales-company-installation/route.ts),
[051](../backend/migrations/051_field_sales_company_installation.sql), existing
[workflow](../backend/migrations/046_field_sales_workflow.sql) and
[earnings](../backend/migrations/047_field_sales_earnings.sql).

### Five-representative account and recovery procedure

1. Sign in as ADMIN. Open Field Sales -> Representatives. Create the representative
   with the generated strong temporary credential; save/share it privately.
2. Verify the person and approved commission-start evidence; activate separately.
   Creation alone does not permit login.
3. Give the representative the standalone sales URL above. The sign-in field says
   PIN, but the managed credential is a strong credential, not an eight-digit default.
4. To suspend access, select **Disable and revoke sessions** in Representatives.
   Disabled/expired/role-changed sessions fail subsequent authorized requests.
5. For forgotten credentials, disable first if access must stay suspended; open the
   management account directory and choose that SALES user's **Reset credential**.
   Supply a unique credential of at least 16 characters and share it securely.
   Reset atomically revokes all sessions and does not reactivate the account.
6. Verify the recipient, then reactivate separately when appropriate. No email
   invitation, self-service recovery platform or generic SALES role change is used.

[050](../backend/migrations/050_field_sales_credentials.sql) also prevents a login
verified against an old hash from creating a session after a concurrent reset.
SALES sessions remain eight hours with request-time ownership and role checks.

## Implemented but inactive

- Sales, transactions, workflow and catalog administration retain their separate
  ENV/DB gates; earnings retains its ENV gate. Actual production state is unverified.
- Workflow activation permits eligible enrolled-order assignment even with the
  global legacy assignment switch off. Authorizing Orders is not merely read access.
- Company authorization is empty by default and requires real native identity
  provisioning. No unrelated recruiting/onboarding/assignment switch was enabled.
- Technician packaging is fixed in source/build, not claimed deployed. Canonical
  source is [root portal](../portal.html); generated target is
  [backend public portal](../backend/public/portal.html), with backend-origin
  installation JS/workflow CSS. Do not edit the frontend/backend mirrors to deploy.
  See [packaging procedure](PORTAL_PACKAGING.md).
- Stripe live mode, proposed pricing and bank payouts were not activated.

## Missing or incomplete

- No independently executable launch-critical correction remains identified in
  this assignment. The following are operating/certification boundaries, not a
  request for another development phase.
- No new self-service/email recovery or staff-management application is supplied;
  the approved initial operating procedure is managed recovery, not a launch blocker.
- Private staged hosting/current assets and actual native account workflows are
  verified. Native company identity provisioning, field-device uploads and the
  complete paid/completion/commission chain remain unverified; fixture success
  cannot certify those remaining requirements.
- Hidden integrated-browser tabs do not establish native keyboard certification.
  Real browser navigation/screenshots and automated interaction tests are separate
  evidence, not proof of mobile hardware or field connectivity.
- Forecast/AI availability and unsupported synthetic-preview provider actions
  are not sales-launch defects.

## Requires management approval

1. **M1 - launch catalog:** exact TV/camera sizes, quantities, equipment, installation
   scope, territory, tax handling and exceptions. Publish only approved version/digest;
   proposed equipment JSON/storefront prices do not activate Field Sales offers.
2. **M2 - customer/legal:** agreement/notices, jurisdictions, door-to-door cancellation,
   refunds, delivery/retrieval and retention. A deposit does not establish nonrefundability.
3. **M3 - compensation/cost authority:** tenure evidence, event/timezone, attribution,
   actual-cost evidence and rounding. Existing rates/basis remain unchanged.
4. **M4 - Friday operations:** classification, qualification/hold/correction timing,
   cutoff/timezone/holidays, manual settlement and independent payment proof.
5. Actual company installer identities, managed recovery/support ownership,
   deployment/schema authorization, scoped assignment and eventually live payments.

## Requires external integration verification

| Dependency | Required evidence before launch |
|---|---|
| Native database | Actual private native baseline, scoped migrations through 052, account/lead/repeat authorities and exact-run cleanup passed. Public business migrations remain unapplied; review/authorize the production plan separately. Paid-chain/concurrency/rollback still need certification. 040 remains draft. |
| Storage/projects | Main/management/dispatch co-location; private assessment photos/consent and cross-owner denial; canonical native installation artifact identity, actual byte persistence, provenance, retention and customer/installer access. |
| Hosted identity/package | Private deployed sources/package, native synthetic lifecycle, managed recovery and provider protection passed. Five actual employee enrollments, legitimate installer identity and login-throttling certification remain production release gates. |
| Existing Stripe account, test mode | Real test checkout/webhook chain, mode/amount/customer/order matching, duplicate/late/retried events, provider fees, balance, refunds/disputes and outage recovery. Isolated signed fake-provider events are not actual Stripe certification. |
| Customer/devices | Approved HTTPS origin, exact legal copies, issued/expiring customer links, acceptance/payment returns, actual mobile photos/signatures and field connectivity. |
| Rollback/operations | Rehearse gate disablement without deleting accepted contracts, receipts, artifacts or earnings. Reconcile in-flight webhooks and obligations; disablement does not refund orders or erase earned amounts. No bank transfer was tested. |

### Prioritized remaining launch actions

1. Approve M1-M4, company identities and accountable support/reconciliation owners.
2. Private hosting, existing-database run isolation, Storage and actual signed
   Stripe test connectivity are verified. No additional key/database/login is
   needed. Record the approved business inputs; keep real employees/live payments inactive.
   Production schema/deployment activation still needs separate authorization.
3. Certify the connected workflow against authorized native services and Stripe
   **test mode**, including failures, concurrency, disable/recovery and rollback.
4. Review the evidence, then separately authorize five real accounts, operating
   scope and live payment activation. Do not use real deposits to discover gaps.

### Validation record

- Latest same-database selection: **72 passed** plus actual hosted native
  accounts/pagination/repeat/recovery, private byte/expiry checks, fresh-run
  provider/schema cleanup and actual Stripe-delivered signed audit correlation.
  Final clean backend compilation/type validation passed. Not paid-processing certification.
- Complete connected/compatibility selection: **50 files, 462 passed, 0 failed,
  0 skipped** using `node --test --test-concurrency=2`. It includes representative
  authorization, account/session recovery, transactions, immutable history,
  scheduling/completion, costs/commissions, Friday review, dashboard and technician
  compatibility, standalone entry and preview fixtures.
- Paging/search tests exercise **0, 1, 100, 101, 500 and 1,000** opportunities,
  bounded complete retrieval, ownership denial, exact totals and cursor/filter
  consistency. Home due-page synchronization and real follow-up selection/save
  assertions replace the obsolete selector.
- After final company-only evidence wording/automatic-read and exact server-order
  refinements: **88/88** focused sales/company UI, technician wiring, workflow
  presentation, actual-cost authority, management controls and packaging checks passed.
  Technician portal behavior remains unchanged; company proof has no routine
  Refresh, only Retry after a genuine failure. Retry preserves entered actual date.
- Configured backend TypeScript, four changed backend-file Next lint, changed
  frontend JS syntax and the isolated selected-index Next build passed. Build used
  synthetic constructor credentials, no environment files, no Prisma regeneration,
  blocked outbound sockets/HTTP and two workers; dirty portal mirrors were untouched.
- Real rendered checks captured **26 screenshots**, covering sales Home/Leads/Quotes/
  Orders, management Orders and company evidence at **390, 768, 1024 and 1280px**,
  plus customer history. Actual search finds the older returning household; its two
  opportunities open independently. Lead page two contains nine of 34 opportunities;
  chronological follow-ups support Next/Previous. Company acceptance is native;
  missing proof keeps completion disabled. Screenshots were inspected, not just
  overflow measurements. Hidden integrated tabs remain an explicit keyboard limit.

The connected isolated pilot exercises real shared session checks and API/SQL
authorities: account creation/activation/login, TV quote/accepted documents,
signed synthetic deposit, legitimate company identity/acceptance, native photo/
signature/checklist evidence, actual costs/approval, verified synthetic balance,
earned commission and Friday review; then a camera purchase for a different
representative under the same canonical customer, preserving the first snapshots.
Cross-representative lead/history/transaction/order/earnings access is checked.

No authenticated production integration, deployment, employee enrollment, real
payment or payout is implied by any passing test.
