# Home2Smart Unified Sales Execution Plan

Authority: [alignment audit](SALES_SYSTEM_ALIGNMENT.md). Persistent status: [progress tracker](SALES_SYSTEM_PROGRESS.md).

**Awaiting plan approval.** This is one connected delivery plan, not another sequence of numbered development phases. All new application work is outstanding. Plan approval does not authorize production migrations, account enrollment, payments, assignment writes, deployment, email or historical repairs.

## Target and scope

Five representatives use the existing application to sell approved TV/camera services; management fulfills installations through the existing calendar/technician portal; customers pay 25% before eligible scheduling and the net remaining 75% after completion; commissions qualify only after completion and verified final payment and enter the next eligible Friday run.

One relationship chain:

`existing customer / lead -> immutable quote -> exact agreement and notices -> verified deposit -> enrolled order -> existing reservation / job / technician -> completion and actual expenses -> verified balance -> commission -> reviewed Friday run -> reconciled settlement`

References are verified identifiers, not name/email similarity. Attribution and policy snapshots are immutable; current lead ownership can change without rewriting them. Keep existing customer/order identities and one calendar. New finance/lifecycle records extend those relationships, not create another customer database or rewrite historical Dispatch.

### Required for initial operation

- Five authorized SALES accounts, ADMIN oversight, own-record isolation and shared lead/customer identity.
- Approved configurable TV/camera pricing, existing exception approval and exact customer quote/agreement/notices.
- Integrated deposit/legal/readiness/scheduling/assignment/completion/balance states with actionable representative, manager, technician and customer screens.
- Actual equipment/material quantities/cost evidence, hours, verified fees and separate technician compensation.
- 55/50/45 tenure policy, immutable sales earnings/adjustments, minimal performance reporting and reviewed/reconciled Friday runs.

### Required before real customer data or money

All initial-operation contracts plus native schema/grants/storage/session proof, approved price/legal/compensation policies, lawful cancellation/refund handling, immutable customer-copy delivery evidence, payment and payout reconciliation, restricted live-mode configuration and operational rollback.

Synthetic certification does not satisfy this gate. Real customer data, production migrations, account enrollment, assignment/payment activation and deployment each require explicit approval. No credentials, personal records or bank evidence enter Git.

### Can wait

Bonus execution, new/unpublished offers, extra roles, automatic payouts/dispatch optimization, historical mass repair, full legacy Dispatch mobile redesign, offline/native apps, broad bundle/auth refactors and email notifications. No new paid software.

## Dependency graph

```text
launch-contracts ----> sale-to-deposit ----> fulfillment-to-balance ----> commission-Friday ----> pilot-certification
       |                       |                       |
       +-> cost/rate/run fixtures can start independently from fulfillment UI
       +-> isolated native-schema and access certification can start immediately
```

Edges mean integrated acceptance dependencies, not a requirement to idle on independent fixture/UI work. Commission math and payout-run tests can proceed after identity/money contracts while fulfillment is being connected. Legal or payout-policy approval may block **activation** without blocking safe synthetic implementation.

## Delivery batches

### `launch-contracts` - freeze identities, catalog and test boundaries

**Outcomes**

- Establish new-order enrollment discriminator and exact lead/customer/quote/order/job/technician relationships. Retain immutable creator/originating-rep identifiers, mutable current ownership and separately versioned commission credit/rate policy.
- Reuse representative account management and assessments. Validate approved TV/camera variation coverage and prepare a draft launch catalog; never automatically publish proposed JSON or $599 package.
- Define policy/configuration records for 25%, legal notices/deadlines, tenure start/event, actual-cost categories and Friday settlement. Approval/version evidence is explicit; unset policy fails closed.
- Verify existing native schema/client co-location/grants/storage with isolated data. Fix or accurately isolate the known fixture failure; make the configured TypeScript check pass using a justified supported target after implementation approval.

**Components:** [043](../backend/migrations/043_field_sales.sql), [044](../backend/migrations/044_field_sales_transactions.sql), new additive migrations as needed, [Field Sales API](../backend/app/api/field-sales/route.ts), [fieldSales](../backend/lib/fieldSales.ts), [dashboardAuth](../backend/lib/dashboardAuth.ts), [fieldQuote](../backend/lib/fieldQuote.ts), [catalog preparation](../backend/tools/prepare_field_sales_catalog.cjs), [Field Sales UI](../frontend/field-sales.js), [tests](../backend/tests), [TypeScript configuration](../backend/tsconfig.json).

**Dependencies:** Plan approval; existing foundations. M1-M4 final policy decisions are not prerequisites for policy interfaces or synthetic fixtures.

**Independent work:** Test-baseline repair, isolated fixtures, identity/access contracts, draft coverage matrix and configuration validation. No historical identity backfill from heuristics.

**Management gate:** M1 catalog/area/tax approval; M3 credit/start-event choice. Real account/customer enrollment remains separate authorization.

**Acceptance:** Five synthetic reps can authenticate and see only their own records/photos/transactions; disabled/expired sessions and VA/unrelated-rep requests fail. ADMIN can assign/review without changing immutable origin. Every launch service variant yields an authoritative itemized quote or explicit nonstandard approval requirement; client total/catalog tampering fails. Missing schema/policy is visibly unavailable, not empty success. Configured types pass; any unrelated baseline failure has exact reproduction.

**Demonstration:** ADMIN enrolls five isolated reps, creates/reassigns a synthetic lead and shows preserved origin, restricted rep access, configurable TV/camera assessment and draft catalog coverage.

### `sale-to-deposit` - approved customer documents and verified 25%

**Outcomes**

- Complete existing embedded quote/approval/agreement controls with a single next action and immutable, approved customer-facing copies/notices, delivery evidence and cancellation calendar.
- Enforce 2,500 basis points for enrolled new sales. Preserve accepted total, deposit/complement snapshots and server-created checkout authority.
- Record provider-verified receipts and actual processing-fee evidence, including unavailable/pending fee states. Preserve active-checkout locks, current-net balance, webhook idempotency and legacy flow discrimination.
- Implement a controlled production-capable payment configuration path, disabled by default, alongside isolated test mode; do not enable it or change existing checkout.
- Present signed quote, notice/copy status, verified deposit confirmation and management-review/eligibility reasons. No success based only on browser redirect.

**Components:** [fieldCommerce](../backend/lib/fieldCommerce.ts), [transactions API](../backend/app/api/field-sales-transactions/route.ts), [agreement API](../backend/app/api/field-sales-agreement/route.ts), [field webhook](../backend/app/api/field-sales-stripe-webhook/route.ts), [routing](../backend/lib/fieldStripeRouting.ts), [044](../backend/migrations/044_field_sales_transactions.sql), [commerce UI](../frontend/field-commerce.js), [customer agreement](../frontend/field-agreement.js).

**Dependencies:** `launch-contracts`; M1/M2 approved versions for any real transaction. Synthetic policy fixtures remain explicitly non-live.

**Independent work:** Notice/artifact/version contracts, deadline tests, checkout/fee/failure tests, customer document layout and disabled live-configuration validation.

**Management gate:** Legal content/applicability/delivery and catalog approval. No automatic waiver, nonrefundable policy, live key use or email notification.

**Acceptance:** 10,001-cent quote produces 2,501-cent deposit and 7,500-cent complement; no rounding overcharge. Standard/nonstandard approval order, expired/stale agreements and amount tampering are tested. Parallel checkouts/retries/duplicate or out-of-order provider events produce no duplicate collection/order. Failed/abandoned/pending/refunded/disputed states are explicit. Missing notice delivery/policy blocks clearance; deadlines use approved business-day/holiday/timezone rules, not 72 hours from payment. Actual fee unavailable is not estimated 3%.

**Demonstration:** Rep quotes TV and camera work, gets exception approval where needed, customer reviews/signs approved synthetic documents and pays 25% in isolated Stripe test mode; management sees receipt, copies and clearance/hold evidence.

### `fulfillment-to-balance` - eligible installation, actual evidence, then collection

**Outcomes**

- Enroll the new order into existing scheduling/preparation/job authority using exact IDs. Add manager order queue/filter and customer readiness/scheduling evidence without duplicating the calendar.
- Gate reservation confirmation/start/managed assignment appropriately on verified deposit, legal clearance, readiness and canonical active technician. Any planning-only hold must not imply clearance. Revalidate these states at each operational transition, including reschedule/cancel.
- Reuse managed offer response lifecycle and scoped new-order authorization; retain legacy behavior and default-off global activation.
- Add materials/equipment quantities, actual expenses/evidence, hours and completion to the existing technician job detail. Required completion evidence is configurable per approved service. Record technician compensation separately through a verified new-job association.
- Use a transactional, retry-safe completion authority compatible with existing guards; no false successful rollback after side-effect failure. **Completion does not require final 75% payment.**
- After completion, expose existing secure net-balance checkout and customer confirmation. Cancellation/refund/dispute changes create explicit scheduling/payment review, not silent job deletion.

**Components:** [Operations UI](../frontend/management-operations.js), [managementPlanning](../backend/lib/managementPlanning.ts), [calendar API](../backend/app/api/commercial-calendar/route.ts), [036](../backend/migrations/036_commercial_calendar_workload.sql), [041](../backend/migrations/041_management_assignment.sql), [042](../backend/migrations/042_management_offer_reliability.sql), [portal acceptance](../backend/app/api/portal_accept/route.ts), [completion](../backend/app/api/portal_mark_done/route.ts), [technician source](../frontend/portal.html), existing commerce/order UI.

**Dependencies:** `launch-contracts`, `sale-to-deposit`; verified new-order mappings and M2 clearance rules. Canonical new-job compensation relationship must be demonstrated before completion acceptance.

**Independent work:** Fixture enrollment, transition matrix, existing portal form integration and scoped retry/rollback contracts. Historical records remain untouched.

**Management gate:** Explicit production assignment/new-order enrollment authorization after certification, not a prerequisite for isolated implementation. No automatic historical repair.

**Acceptance:** Paid deposit without legal clearance cannot produce an eligible installation. Conflict/stale revision/disabled technician/pending-offer/accept/decline/reschedule/cancel cases preserve existing authority. New-order materials/hours/completion are durable and actor-scoped. Completion succeeds with balance outstanding; balance is unavailable before completion for this workflow. Failed completion side effects leave an accurate recoverable state; retries create one completion and no duplicate technician liability. Legacy portal contracts and unenrolled checkout/jobs remain unchanged.

**Demonstration:** Manager clears/readies/schedules a deposited TV/camera order; assigned tech accepts and records actual materials/hours/completion; customer then pays the net 75%. A separate non-cleared case stays blocked and historical Dispatch does not enter pilot counts.

### `commission-Friday` - actual economics, immutable earnings and settlement

**Outcomes**

- Compute the specified base from actual approved revenue/equipment/material/fee evidence, **excluding technician wages and modeled reserve**. Persist source evidence, policy, credited rep, tenure event, rate, rounding and input hash.
- Apply 55% days 1-30, 50% days 31-60, 45% day 61+ using approved start/event/calendar semantics. Record qualification only when installation completion and verified final payment are both present.
- Preserve qualification time even when amount needs cost/fee review. Never invent zero fees/costs, silently floor negative bases or relabel legal earnings due to missing management evidence.
- Create sales-only immutable earning entries and reviewed refund/dispute/correction adjustments. Existing technician payout rows keep their own meaning.
- Add compact rep orders/performance/commission views and manager performance/earnings/payout review within current surfaces. Separate pending qualification, amount review, earned, held, approved, exported and reconciled paid.
- Create the next eligible Friday run with unique entry allocation, cutoff/version, authorized review, export and settlement evidence through the approved existing payment method. App approval/export must never claim money was sent.

**Components:** Shared existing lead/quote/order/payment records; additive earnings/cost/run schema and server contracts; [commerce UI](../frontend/field-commerce.js), [Field Sales UI](../frontend/field-sales.js), dashboard management surfaces. Reuse validation patterns from [pricing reconciliation](../config/pricing/reconciliation/reconcile.cjs) and idempotency patterns from [000](../backend/migrations/000_unique_payout_ledger.sql), not their modeled/technician business rules.

**Dependencies:** `launch-contracts` for IDs/policies; `fulfillment-to-balance` for integrated qualification proof. Pure math, review states and run fixtures can be built earlier. M3/M4 approval is mandatory before real compensation.

**Independent work:** Pure money/rate tests, immutable ledger/run concurrency, permissions, reporting UI and synthetic settlement/adjustment cases.

**Management gate:** Rate-effective event/accounting/classification, lawful timing/holds, Friday calendar and payout method/authorization. Bonus remains off.

**Acceptance:** Day 30/31/60/61 rates exactly 55/50/50/45; invalid/missing start data requires review. Changing wages leaves commission unchanged. Illustrative test: 100,000-cent eligible revenue - 20,000 equipment - 5,000 materials - 3,000 verified fees = 72,000 base; first-band commission is 39,600 cents regardless of wages. Completion-only or deposit-only cannot qualify. Duplicate completion/payment/run/settlement requests create no duplicate earning/payment allocation. Historical amounts/rates do not change after ownership/catalog/policy edits; corrections append. Missing/negative cost evidence and refunds/disputes create explicit review. Friday cutoff, holiday and late-payment cases use approved rules; settlement must match amount/beneficiary/reference and cannot be inferred from an approval checkbox.

**Demonstration:** Rep sees completed-but-unpaid order, then earned commission after verified balance; manager reviews actual inputs, a refunded/disputed case, Friday run/export and independently reconciled synthetic payment evidence.

### `pilot-certification` - prove the whole operation and prepare approval

**Outcomes**

- Exercise five isolated representative accounts through both initial services, including a nonstandard approval, legal hold/cancellation, scheduling conflict, accepted/declined offer, completion with unpaid balance, final payment, earned commission, Friday settlement and adjustment.
- Certify migrations/grants/storage/session isolation on guarded native PostgreSQL/Supabase test infrastructure and real Stripe **test** sessions/webhooks. Use local/isolated databases and synthetic data only; preserve external-database test opt-in guards.
- Validate complete representative/customer/management/technician paths at 320px, 390px and desktop, including keyboard/error/long-content states, zero page-wide overflow and no mandatory legacy Dispatch detour.
- Provide role/money/transition regressions, configured build/type results, provider evidence, rollback rehearsal and operating instructions. No unverified native dependency becomes a green check.
- Produce one initial-launch checklist with exact deployment/configuration/account/data approvals and separate default-off gates. Keep email, bonus, unpublished pricing and historical repairs off.

**Components:** Existing [tests](../backend/tests), [preview infrastructure](../tools/dev-review/server.cjs) for visual checks only, real isolated integration harnesses, the existing frontend/backend/deployment boundaries and this tracker.

**Dependencies:** All delivery batches integrated; M1-M4 approved for final acceptance evidence. Approval to perform actual production activation is separate and remains required.

**Independent work:** Test harness/access proof/mobile regressions and rollout/rollback draft can start earlier.

**Management gate:** Review certification evidence and authorize any specific production action. If unavailable dependencies prevent proof, report an explicit blocked checklist item; never certify using synthetic responses.

**Acceptance/demo:** Every specified journey transition passes for each of the five synthetic reps and both service categories; adverse/concurrent events yield no duplicate monetary effects, cross-rep leaks or historical writes. Required tests/type/build/native/provider/mobile checks pass; independently reproduced unrelated failures are documented separately and do not conceal a launch-path failure. Demonstrate the entire sale -> installation -> balance -> Friday evidence chain, then request scoped launch authorization.

## Continuous execution contract

After explicit plan approval, an instruction such as **"Execute all approved outstanding work"** authorizes ready development items, not production activation.

1. Read the [tracker](SALES_SYSTEM_PROGRESS.md), approval/policy evidence and current Git status. Preserve unrelated edits and unsaved buffers.
2. Execute approved ready items in dependency order; integrate frontend, backend, additive schema and tests together. Use existing helpers/authorities, verified identifiers and explicit errors.
3. Continue independent approved fixture/UI/contract work when a policy blocks only real activation. Never fill missing policy with an invented financial/legal default.
4. Validate each meaningful integrated batch. Record exact commands/results, actual-runtime versus synthetic proof, changed paths, blockers and demonstrated outcomes in the same tracker.
5. Commit/push verified work to `retro-dev` normally, scoped to reviewed task files; update evidence/commit references. No force push, unrelated cleanup or new phase documents.
6. Continue without another prompt for each component. Stop only for a material business decision, security/financial authorization, production/data action requiring approval, or a blocker preventing safe progress. Report remaining executable work and blocked gates distinctly.

Engineering can independently implement the specified 25/75 math, server-authoritative state joins, exact IDs, configurable policy/artifact interfaces, completion/cost capture, fixed tenure bands, immutable ledger/run mechanics, minimal existing-surface UI and tests **after plan approval**. M1-M4 require decisions only where the specification leaves actual prices, legal applicability, event/accounting semantics or settlement practice open.
