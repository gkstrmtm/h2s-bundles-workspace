# Ecosystem Map (Checkout → Orders → Dispatch → Pro Portal)

**Goal of this doc:** A stable “source of truth” map of *where logic lives* (current TypeScript backend vs legacy JS), and what data must exist for jobs/offers/payouts to show up in the Pro Portal.

**Last updated:** 2025-12-23

---

## 1) What is actually deployed (today)

### ✅ Deployed backend (current)
This repo’s actively-deployed backend is the Next.js App Router project under:
- `backend/`

The API routes that Vercel runs are:
- `backend/app/api/**/route.ts`

TypeScript vs JavaScript is *not* what determines what runs. What runs is whatever code is reachable from those Next.js route files.

### 🧩 Legacy / reference code (not necessarily executed in production)
There is older “Home2smart-backend” code that contains prior implementations of dispatch logic (offers, cascades, payouts, etc). It is extremely useful as a *reference* for expected behavior and concepts, but it is **not automatically executed** by the deployed `backend/` Next.js API unless we intentionally port/bridge it.

Key legacy folders to treat as “reference canon”:
- `Home2smart-backend/Backend Tweaks/Operations.js` (historical dispatch + payout policies, cascade rules)
- `Home2smart-backend/api/*.js` (older API handlers for portal/admin/dispatch)
- `Home2smart-backend/dispatch.html`, `Home2smart-backend/dispatch_test.html` (older UI expectations)

---

## 2) High-level flow (the thing you care about)

### A) Checkout writes durable state
From the storefront page:
- `Home2Smart-Dashboard/bundles.html`

Important constants (production):
- `API = https://h2s-backend.vercel.app/api/shop`
- `APIV1 = https://h2s-backend.vercel.app/api/schedule-appointment`
- `DASH_URL = https://h2s-backend.vercel.app/api/track`

The “state” that must be written durably (DB rows) for downstream dispatch:
1) **Order row** in `h2s_orders`
2) **Dispatch job row** in `h2s_dispatch_jobs` (created/updated when scheduling)
3) **Offer/assignment row** in `h2s_dispatch_job_assignments` (this is what makes offers appear in the pro portal)

### B) Dispatch routes jobs to the correct technician
Routing/assignment is primarily handled in the database via an RPC:
- `auto_assign_job_to_pro` (Supabase Postgres function)

The backend calls it from scheduling flows.

### C) Pro Portal sees offers/jobs
The pro portal UI is:
- `Home2Smart-Dashboard/portal.html`

The portal retrieves offers/jobs via backend endpoints like:
- `/api/portal_jobs` (list offers/upcoming/completed)
- `/api/portal_accept` (accept offer)
- `/api/portal_decline` (decline offer)
- `/api/portal_mark_done` (mark job completed)

Portal also tries realtime subscription:
- `postgres_changes` on `h2s_dispatch_jobs` + `h2s_dispatch_job_assignments`

---

## 3) Current “source of truth” files (the map)

### 3.1 Checkout + scheduling (writes the order + scheduling state)
- `backend/app/api/shop/route.ts`
  - Contains shop/checkout related actions (e.g. `create_checkout_session`, reschedule handler).
  - This is where “checkout” server-side work happens for storefront.

- `backend/app/api/schedule-appointment/route.ts`
  - This is the critical bridge from **order** → **dispatch job** → **assignment offer**.
  - Looks up the order (by `id`, `order_id`, or `session_id`), writes `delivery_date`/`delivery_time`, and upserts `h2s_dispatch_jobs`.
  - Calls `auto_assign_job_to_pro`.
  - After auto-assign returns a pro, it ensures an *assignment* row exists (so the portal can show an offer).

Supporting helper:
- `backend/lib/dispatchOfferAssignment.ts`
  - `ensureDispatchOfferAssignment(...)` inserts or finds a matching row in the assignments table.
  - `setDispatchJobOfferState(...)` updates job status (best-effort).

### 3.2 Dispatch schema discovery (important when columns differ across environments)
- `backend/lib/dispatchSchema.ts`
  - Discovers which tables/columns exist for jobs + assignments.
  - Supports env overrides (e.g. `PORTAL_ASSIGNMENTS_TABLE`, `PORTAL_ASSIGNMENTS_PRO_COL`, etc).

### 3.3 Pro portal endpoints (what the portal UI calls)
- `backend/app/api/portal_jobs/route.ts`
  - **Key fact:** offers are driven primarily by **assignment rows** for the pro.
  - If there are no assignment rows matching the pro’s token identity, offers will be empty even if jobs exist.

- `backend/app/api/portal_accept/route.ts`
  - Marks an assignment row as `accepted`.

- `backend/app/api/portal_decline/route.ts`
  - Marks an assignment row as `declined`.

- `backend/app/api/portal_mark_done/route.ts`
  - Marks a job row `completed`.

### 3.4 Realtime config for the portal
- `backend/app/api/get_supabase_config/route.ts`
  - Provides anon Supabase config so `portal.html` can subscribe to realtime.

### 3.5 Dispatch routing smoke checks (terminal proof)
- `backend/scripts/check-dispatch-routing.js`
  - Probes dispatch tables.
  - Calls `auto_assign_job_to_pro` to verify the function exists/signature works.

---

## 4) Why jobs/offers might not appear in the portal (the concrete checklist)

If “booking works” but portal shows no offers, the most common root causes are:

1) **Order exists but no dispatch job exists**
   - Check if scheduling endpoint (`/api/schedule-appointment`) was called.

2) **Dispatch job exists but no assignment exists**
   - Portal offers require rows in `h2s_dispatch_job_assignments` tied to the pro.
   - The DB RPC might update `assigned_to` but not insert assignment rows (depends on DB function implementation).

3) **Assignments exist, but not in the DB/project the portal is connected to**
   - Portal realtime + portal_jobs must point at the same Supabase project/schema.
   - `backend/lib/supabase.ts` controls whether Dispatch uses `SUPABASE_URL_DISPATCH` or falls back to main.

4) **Assignments exist but column names differ**
   - `dispatchSchema.ts` attempts to discover columns, but if the environment diverged heavily, you’ll need env overrides.

5) **Dispatch DB has no pros to assign to (offers will always be empty)**
  - If `h2s_dispatch_pros` has **0 rows**, then `auto_assign_job_to_pro` returns `null` and no offer rows can be created.
  - Quick proof (terminal): `node backend/scripts/count-dispatch-pros.js`
  - Minimal server-side tool: `POST /api/admin_seed_pro` (admin token) to insert/update a pro profile in `h2s_dispatch_pros`.

---

## 5) Payout logic (what exists today + where to align)

There are multiple payout concepts floating around in the repo. The two biggest “anchors” are:

### A) Pro Portal payout policy (front-end anchor)
- `Home2Smart-Dashboard/portal.html`
  - Contains `PAYOUT_POLICY` and payout helpers (commented as “AUTHORITATIVE - mirrors Operations.js PAYOUT_POLICY”).
  - Variant tiers: `BYO`, `BASE`, `H2S`.

### B) Legacy dispatch policy + cascade (reference canon)
- `Home2smart-backend/Backend Tweaks/Operations.js`
  - Contains historical routing logic like:
    - `offerToNextCandidate_(jobId, reason)`
    - `assignIfNone_(jobId)`
    - `handleProAction(...)` (accept/decline behavior)
    - Admin offer creation/assignment
  - This is a key reference for “how it used to work” and what semantics we should preserve.

### C) Offer calculation probe (pricing/payout sanity)
- `test-offer-calculations.js`
  - Validates a 35% payout style math for offers/pricing baselines.

**Important:** payout policy in `portal.html` (tiered labor/material model) is *not the same thing* as the simple “35% of regular price” used in `test-offer-calculations.js`. Treat those as two distinct models that need reconciliation.

---

## 6) “Where are we in the flow?” (plain-English answer)

- Checkout/storefront runs from `Home2Smart-Dashboard/bundles.html` and hits deployed API routes in `backend/app/api/*`.
- The system “works” only insofar as the deployed Next.js routes write the required DB rows.
- Any older JS code in `Home2smart-backend/**` does **not** automatically run in production; it’s only helpful if we port its logic into `backend/app/api/**` or into DB functions.

---

## 7) Practical next debugging checkpoints (when we resume work)

When you book a job and it does not appear in the portal, the fastest way to locate the failure is:

1) Confirm `h2s_orders` row exists for the checkout/session/order id.
2) Confirm `h2s_dispatch_jobs` row exists with matching `order_id`.
3) Confirm `h2s_dispatch_job_assignments` row exists for that `job_id` and the intended pro id/email.
4) Call `/api/portal_jobs?token=...` and verify the returned `meta.mode` and whether it found assignment rows.

If #3 is missing, portal won’t show offers even if jobs exist.

---

## Appendix: Dynamic /api/<action> fallback

There is a dynamic fallback route:
- `backend/app/api/[action]/route.ts`

It intentionally returns JSON `{ ok:false, error_code:'NOT_IMPLEMENTED' }` for unknown `/api/<action>` calls so clients don’t crash when they do `res.json()`.

This is **not** the primary portal implementation; the primary portal endpoints are the dedicated routes (e.g. `/api/portal_jobs`).
