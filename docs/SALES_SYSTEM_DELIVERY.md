# Unified Sales System: development delivery and launch boundary

Authority: [alignment](SALES_SYSTEM_ALIGNMENT.md), [execution plan](SALES_SYSTEM_EXECUTION_PLAN.md),
[current progress](SALES_SYSTEM_PROGRESS.md). Source navigation:
[repository map](REPOSITORY_REVIEW_MAP.md).

Branch: `retro-dev`. Foundation delivery:
`45ec8035bae2dde88db61f01db81225df8f9dba8`. Verified integrated delivery hashes
are recorded in [progress](SALES_SYSTEM_PROGRESS.md). **Not a production-readiness claim.**

## Implemented operation

The existing application now connects:

`owned inquiry -> authoritative quote -> exact approved documents/acceptance
->25% verified deposit -> cancellation clearance -> shared scheduling/readiness
-> accepted technician offer -> saved installation proof/actual costs/hours
->75% net remaining balance -> earned commission -> Friday review/export
-> independent manual settlement evidence`.

Existing customer/inquiry/order/calendar/technician authorities are reused.
No second CRM, customer database, scheduler or outgoing payout service exists.
Generic service definitions and versioned catalogs support TV mounting,
customer-owned/equipment-included cameras, residential/commercial work and
future approved offers. Draft/proposed pricing is not payable.

### Representatives and management

- Existing dashboard accounts/sessions enforce SALES isolation, active-account
  checks and assigned records. ADMIN manages accounts, reviews exceptions,
  policies, actual costs and Friday runs. VA/legacy permissions are preserved.
- Original representative identity is immutable. Current lead ownership and
  approved compensation attribution are distinct. Tenure start/evidence is
  explicitly audited/revisioned, not inferred from account creation.
- Existing Field Sales screens include prospects, follow-ups, assessments and
  consent-controlled photos, authoritative quotes, approvals, orders/next
  actions, performance and earned-compensation history.
- Management sees exact policy/digest evidence, documents/delivery, readiness,
  scheduling/assignment holds, separate technician/approved actual costs,
  balances, financial exceptions and reviewed Friday allocations.
- Unresolved policies have editable, versioned approval contracts. No legal
  language, deadline, refundability or classification is silently selected.

### Money and documents

- Only published/approved server catalogs calculate quote amounts. Client
  totals/unit prices are rejected. Quotes/acceptance/policies retain exact
  version/hash snapshots; later edits do not change accepted evidence.
- Enrolled deposits use integer-cent ceiling at2500 basis points. Final net
  balance complements verified captures/refunds; installation precedes balance.
- Exact approved customer copies/notices and customer retrieval/acceptance
  evidence feed the approved cancellation calendar. Staff delivery records do
  not replace customer retrieval. Accepted-document/balance links can be
  renewed for an explicitly configured finite duration without late acceptance
  or editing the original signed terms.
- Separate server-created Stripe reservations bind customer/quote/mode/amount.
  Signed webhooks and canonical provider receipts, not redirects, determine
  payment. Session creation, retries, failures/refunds and order reconciliation
  are idempotent. Actual processing fee evidence may be pending/unknown.
- Controlled live-mode code is present but disabled. No card numbers are
  collected/stored by these interfaces.

### Fulfillment and actual economics

- Explicit new-order enrollment joins existing reservations/preparation/jobs/
  pros. Deposit/legal/readiness/identity/offer gates are rechecked server-side.
  No historical repair or global assignment activation occurs.
- Verified root [portal.html](../portal.html) adds a narrowly enrolled-only
  installation component. Legacy photo/signature prompts remain first.
  Assignment metadata cannot overwrite canonical job enrollment metadata.
- Completion requires persisted photo and onsite signature belonging to the
  exact job/current accepted pro and captured after offer acceptance. Referenced
  artifacts are retained/frozen. Unknown/missing enrollment/proof/session/
  authority cannot fall back to legacy completion.
- Approved service `completionRequirements` pin additional photo/signature
  counts and affirmative checklist evidence into the immutable quote. Native
  bindings/checks support partial/full atomic replacement and fresh readiness;
  completion cannot weaken accepted requirements or share an artifact between
  two configured requirements. Management/SALES see counts/status, not raw
  candidate IDs or checklist evidence. The shared4,456,448-byte request cap
  rejects oversized saves and impossible minimum-proof quotes before payment.
- Technicians record actual equipment/material quantities, unit/total cents,
  evidence and hours. ADMIN separately approves actual costs. Missing evidence,
  inconsistent quantities or unattested zero cost cannot become payable inputs.
- Earnings qualify only after installation and verified final payment.
  Missing cost/fee review retains qualification time but blocks an amount.
  The base deducts actual equipment, materials and provider fees, **not wages**.
  Rates are55% days1-30,50%31-60,45%61+, with approved start/event/calendar rules.
- Immutable entries and reviewed corrections retain attribution/input hashes.
  Refunds/disputes/negative bases require review, not invented zero floors,
  employee debt or unauthorized clawback. No proposed100-dollar bonus.
- Friday allocations prevent duplicate claims. Draft/approved unexported runs
  can be abandoned with audited evidence, releasing effective claims while
  preserving history. Source-review/dispute holds also apply to adjustments.
  Approval/export is bookkeeping, not payment. Reconciled-paid status requires
  matching beneficiaries/amount, explicit valid settlement timestamp, method,
  reference and independent reconciliation proof. No transfer is initiated.

## Validation and what it proves

| Evidence | Result | Boundary |
|---|---|---|
|38-file coupled Sales/dashboard/Operations/calendar/portal/payment selection |332/332 passed, no skips | Actual routes/SQL and source tests with isolated fixtures; configured proof/catalog/API and existing behavior covered by these selectors. |
| Five-representative full pilot |1/1 passed, included in332 | Actual authorities; fake provider and synthetic records. Five configured-proof combined TV/camera orders, not ten invented identities. |
| Five actual synthetic dashboard login sessions | Included in regression selection | Real hashing/expiry/shared auth into actual Sales routes; not deployed Supabase verification. |
| Actual client payloads into workflow SQL | Included in regression selection | Cost math, explicit zero/evidence, policy digest/version, retained proof and role/lifecycle contracts. |
| Configured TypeScript,12-file Next lint and Next build | Passed | Exact selected-index snapshot; no env files, synthetic/default-off env, outbound socket guard, no Prisma regeneration. |
| Unchanged pricing/reference/model package |308/308 passed; JSON validation passed | Offline proposals/models, not supplier verification or approved publication. |
| Actual source-based installation layout |320/390/1280: no page/internal overflow;19 controls have associated names | Root modal/CSS/component, long configured label and actual isolated read; original bootstrap/external media blocked. |
| Updated synthetic review | Actual workflow/earnings/private PNG reads; six write endpoints423; Orders/Performance/Commissions320/390/1280 no overflow | One handler-verified synthetic25% deposit; no fabricated completion, earned entries or outgoing payment. |
| Native PostgreSQL/Supabase/storage/Stripe/settlement | Not run | External isolated access/approval unavailable; cannot be certified by PGlite/mock receipts. |

Exact selectors/commands and later endpoint/layout evidence are in
[progress](SALES_SYSTEM_PROGRESS.md). Expected negative-test log errors are not
successful transaction evidence. Coupled historical auth/workflow fixture
imports were corrected; no unrelated application repair was made.

The pilot verifies tenure days1/30/31/60/61, two standalone service-price drafts
per rep and a combined approved30004-cent order per customer. Deposit7501 and
remaining22503 sum exactly. Actual equipment1500, materials7 and verified
fees110 leave28387-cent basis; exact per-order rates/rounding are asserted.
Orders complete before final payment and unreviewed actual costs do not create
earnings. Friday export leaves reconciled-paid total zero.

## Remaining items, explicitly classified

| Classification | Requirement / current boundary |
|---|---|
| Management policy approval: M1 | Approve published TV/camera launch matrix, quantities/sizes/equipment/scope/area/tax treatment and exception authority. Reconcile storefront and offline proposals; do not publish the proposed599 package. |
| Management policy approval: M2 | Approve actual agreement/notices, jurisdiction/applicability, customer-copy delivery/retention and lawful cancellation/refund calendar.25/75 does not imply a nonrefundable deposit or a zero-day deadline. |
| Management policy approval: M3 | Approve evidenced tenure start and accepted/completed/qualified rate event/timezone, compensation attribution and actual-cost accounting/rounding. Specified rates and wage exclusion are implemented; no event is invented. |
| Management policy approval: M4 | Approve classification, lawful earnings/hold/correction timing, Friday cutoff/timezone/holidays and actual settlement method/independent proof. Export does not authorize a payout. |
| External account/integration access | Authorized isolated native database/grants/private storage and real Stripe test-account webhooks/refunds/disputes/fees. Verify canonical native artifacts and strict project co-location. No credentials or bank/customer records belong in Git. |
| Production authorization | Additive migration registration/application, feature configuration, hosted portal provenance, approved catalog/policies, five real accounts, new-order assignment, live Stripe and operating/payout access each require explicit authorization. |
| Demonstrated technical boundary | Existing one-opportunity/accepted-contract-per-lead model rejects subsequent accepted sales and duplicate-phone creation. Repeat purchases require an additive repeat-opportunity design, not duplicate customer records. The initial combined-service pilot does not claim this is solved. |
| Unverified hosted integration | Dirty portal mirrors/deployment configs were preserved. Establish which source the production alias serves before rollout; tested root source is not proof the hosted portal loads it. |
| Existing/out-of-scope limits | Legacy Dispatch mobile clipping, offline synchronization, durable reconciliation case storage, historical identity/payout repairs, email activation and automatic payouts are not silently introduced. |

## Exact gate/configuration contract

Keep all switches off until separately authorized:

- ENV `H2S_FIELD_SALES_ENABLED`, `H2S_FIELD_TRANSACTIONS_ENABLED`,
  `H2S_FIELD_WORKFLOW_ENABLED`; matching DB
  `field_sales_settings.enabled`, `field_sales_transaction_settings.enabled`,
  `field_sales_workflow_settings.enabled`.
- Catalog administration is independently default-off:
  `H2S_FIELD_CATALOG_ADMIN_ENABLED` and `field_sales_catalog_admin_settings.enabled`; ADMIN publication
  requires the exact viewed digest and explicit approval evidence.
- Earnings API has its own default-off environment capability:
  `H2S_FIELD_EARNINGS_ENABLED`; approved workflow/commission/settlement policies
  are still required for meaningful payable entries/runs.
- `H2S_FIELD_STRIPE_MODE` defaults to `test`. Live additionally requires ENV
  `H2S_FIELD_STRIPE_LIVE_ENABLED=true` and DB
  `field_sales_workflow_settings.live_enabled=true`.
- Field test keys: `H2S_FIELD_STRIPE_TEST_SECRET_KEY` (`sk_test_` prefix) and
  `H2S_FIELD_STRIPE_TEST_WEBHOOK_SECRET`. Field live keys:
  `H2S_FIELD_STRIPE_LIVE_SECRET_KEY` (`sk_live_`) and
  `H2S_FIELD_STRIPE_LIVE_WEBHOOK_SECRET`. These are separate from legacy general
  Stripe keys. Marker `h2s_flow=field_sales_v1` and immutable reserved mode must
  agree with signatures/provider receipts.
- Customer handoffs require `H2S_FIELD_AGREEMENT_TOKEN_KEY` minimum32 characters,
  approved `H2S_FIELD_SALES_ORIGIN`, and explicitly configured
  `H2S_FIELD_AGREEMENT_HANDOFF_MINUTES` integer1-1440.
- Main/dispatch/management project URLs must satisfy the verified co-location
  contract: `SUPABASE_URL`, `SUPABASE_URL_DISPATCH`, `SUPABASE_URL_MGMT`.
- Keep existing `H2S_MANAGEMENT_ASSIGNMENTS_ENABLED` and
  `h2s_management_assignment_config.enabled` off. **Enabling the workflow DB
  permits scoped assignment of explicitly enrolled, scheduled/readied new
  orders through existing authority even with the global switch off.**
  Workflow activation therefore requires explicit new-order assignment approval,
  not just permission to preview or accept deposits.

These are code contracts, not inspected production values.

## Authorized-isolation certification and launch checklist

1. Freeze commit/catalog/policy digests and approvals. Establish real portal
   source/hosting provenance without overwriting unrelated mirrors.
2. Obtain an explicitly authorized synthetic native target. Review actual036/
   041/042 and043/044/045 dependencies, native job/pro/customer/order schema and
   `h2s_dispatch_job_artifacts(artifact_id,job_id,pro_id,type,url,created_at)`.
   046 requires this existing proof authority and installs retention protection.
   Never create a substitute proof table to make production appear compatible.
3. Register reviewed041-048 only after native preflight/checksum approval.
   Existing guarded runner's production-authorized scope remains through039;
   this delivery does not alter that authorization.040 stays a draft.
   Apply additive dependencies046 then047 and independent048 to the authorized
   isolated target; test private grants/functions/storage and default-off flags.
4. Reproduce five native synthetic accounts, owned-photo isolation, acceptance/
   copy retrieval, legal holds, real test-mode deposit/fees/webhook retries,
   calendar conflicts/offers/proof/completion, final balance, refunds/disputes,
   ledger correction/recovery and independent settlement evidence. Rehearse
   late/duplicate/outage recovery; preserve original records.
5. Record actual evidence and restore/rehearse gates. Approve M1-M4 and explicit
   environment/schema/account/data/assignment/live-payment authorizations
   separately. Publish only the approved catalog/documents.
6. Launch with authorized operators and reconciliation monitoring; no email,
   historical repairs, proposed prices/bonus, paid services or automatic payouts.

### Rollback / recovery

- Disable relevant new ENV/DB capabilities; preserve schema, immutable quotes/
  agreements/receipts/costs/earnings/run history and artifact retention triggers.
  Never drop ledger data or roll an enrolled job into legacy completion.
- Flags do not cancel Stripe sessions, void agreements, refund customers,
  revoke earned compensation or resolve legal deadlines. Review outstanding
  money/customer obligations with authorized management.
- Disabled reconciliation may fail/retry outstanding signed events; track them
  and reconcile canonically before/after controlled restoration. Keep legacy
  unenrolled traffic separate. Repeated requests must not double book funds.
- Abandon only unexported draft/approved runs through the audited command.
  Exported/settled liabilities need reviewed corrections and actual evidence,
  not claim deletion or invented employee debt.
- Native backup/restore, real provider recovery and operational timing cannot be
  certified here. Do not launch until this rehearsal is evidenced on the
  authorized isolated integrations.

## Preservation

No deployment, production migration/data write, real account enrollment,
live collection, actual payout, notification or paid service was performed.
The seven preexisting unrelated tracked edits and51 unrelated untracked paths
remain local and untouched. Unsaved editor buffers were not inspected, discarded,
saved or claimed as committed. Temporary build/layout helpers are not deliverables.
