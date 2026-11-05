# Interactive sales review

## Entry point and boundaries

Local walkthrough: **https://127.0.0.1:50271/**, opened in a dedicated isolated Chrome window.

Select **A: TV mounting**, **B: equipment-included cameras**, or **C: nonstandard installation**. The separate 21-step navigator provides perspectives, previous/next, current customer, reset, optional sample input and synthetic photograph selection. Users still submit application forms, confirm photographs and explicitly acknowledge agreements, proof, actual costs and reconciliation.

The application assets were tested from committed `retro-dev` source **0e809f33d9d7255645f2e61c6dfec6c1189406c6**. Only development review infrastructure and this report changed. The launch server pins application assets to its startup commit; `/walkthrough/status` reports that SHA.

This is **not production certification**. The local fixture uses actual application handlers and isolated database contracts, with synthetic actors, configuration, customers and financial records. Production access, real accounts, payment initiation, payouts, email and global assignment activation remain disabled. Pricing, legal terms, cancellation clearance and settlement policies shown here are synthetic test configuration, not management approval.

## What worked

| Surface | Observed application interactions |
|---|---|
| Representative | Isolated session, lead view, prospect/contact/address/service intake, assessment and photograph permission, labeled property upload, itemized immutable quote, submission and agreement presentation |
| Customer | Exact quote and customer copies, explicit acceptance, 25% deposit reservation, verified synthetic receipt, completed-installation view and remaining 75% reservation |
| Management | Nonstandard scope approval, enrollment, customer-copy publication, calendar scheduling, readiness, scoped technician assignment, actual-cost review, Friday run creation/approval/export and settlement recording |
| Existing technician portal | Assigned offer/detail, acceptance, native photograph preview/upload, signature canvas/save, configured proof bindings/checklist, actual equipment/material costs, hours and enrolled installation completion |
| Representative earnings | Qualification and immutable earnings after completion, actual-cost review and verified final receipt; technician wages remain separate |

**Standard TV was exercised through the browser end to end**, including synthetic independent settlement evidence. One consistent customer, quote, order and job remained connected:

- Total **$129.00**; deposit **$32.25**; balance **$96.75**.
- Evidenced synthetic equipment/material costs **$37.00**, provider fees **$4.35**.
- Commission base **$87.65**, approved synthetic tenure day 40/rate 50%, earning **$43.83**.
- Final fixture state: `reconciled_paid`. **No external payment was initiated.**

Camera browser coverage included actual intake, assessment, photo and automatically approved two-camera quote (**$398.00**, synthetic). Nonstandard browser coverage demonstrated approval blocking, a new management-approved immutable revision, customer/deposit, scheduling, assignment and native job detail. The connected automated contracts exercised all three complete scenarios; camera was not separately walked through every downstream browser screen.

## Failed, fixed, unavailable and unverified

- Fixed review-only dashboard session-envelope and native technician token/profile-fixture mismatches.
- Fixed synthetic native photograph selection when asynchronous job rendering replaced the file input. The actual native upload preview and confirmation remain required.
- Fixed stale payment-provider returns stealing a newer perspective, including returns arriving while navigation awaited status. Regression tests cover both races.
- Missing customer acceptance forms now fail explicitly instead of claiming sample entry succeeded.
- **Export:** the application produced its reviewed **JSON** export and native download link. The link was clicked, but a saved file in the isolated guest browser was **not independently verified**. The download link was not retained after reloading the management surface. Do not describe this as a verified durable download.
- Real sign-in/OTP, training, announcements, availability, On My Way, mail/maps, external withdrawals and unsupported legacy actions are unavailable in this isolated adapter and return explicit errors. Their production behavior was not certified.

**Simulated external dependencies:** payment-provider sessions, successful/failed provider receipts, storage backing synthetic photos/signatures, and bank/beneficiary reconciliation evidence. Signed webhook processing, native evidence contracts and bookkeeping validation were exercised with those fixtures; actual Stripe, Supabase production storage, banking, legal validity and live integrations were not verified.

## Usability findings — recorded, not redesigned

1. Management forms expose policy/record UUIDs, JSON evidence, hashes and integer cents. Enrollment and financial review remain too technical for routine staff use.
2. Assessment and quote answers require repeated entry rather than dependable prepopulation. Mount preferences can disagree with unchecked quote options.
3. Customer copies expose long technical JSON/proof requirements rather than a concise customer document.
4. Native technician proof and expense forms are lengthy, with many distinct attestations and narrow fields at 320px. The existing welcome tour also adds navigation overhead.
5. Scheduling requires careful interpretation of device time and explicit policy timezone.
6. Export recovery/re-download needs review. Role changes and explicit screen refreshes can discard unsaved form input; scenario resets are intentionally destructive only to disposable fixture state.

No actual application screen, technician portal, pricing definition or production feature gate was redesigned or changed.

## Validation

- `node --test --test-concurrency=1 tools\dev-review\walkthrough-navigation.test.cjs tools\dev-review\walkthrough-fixture.test.cjs` — **15/15 passed**, no failures/skips.
- `node --check` for the review entry server, walkthrough server, bootstrap, navigator and fixture — **passed**.
- `git diff --check -- tools\dev-review` — **passed**.
- Browser checks at **320, 390 and 1280px** covered expanded intake, assessment/photo, quote, exception approval, customer quote/payment, management settlement and assigned native technician proof/cost forms. No outer or application-document horizontal overflow was measured. This does not certify every legacy screen.
- Existing production frontend, backend, migrations, pricing and technician source were not changed by this review.

## Source and restart

Review-only files are under `tools/dev-review/`: `walkthrough.html`, `walkthrough.js`, `walkthrough-provider.html`, `walkthrough-server.cjs`, `walkthrough-fixture.cjs`, their two test files, and the opt-in changes to `server.cjs`/`bootstrap.js`.

Start the existing server with `H2S_REVIEW_WALKTHROUGH=true`, `H2S_REVIEW_PORT=50271`, and `H2S_REVIEW_TLS_KEY`/`H2S_REVIEW_TLS_CERT` pointing to locally generated loopback TLS files, then `node tools\dev-review\server.cjs`. Run without production environment variables. HTTPS is required by the actual customer-link defenses; those defenses were not weakened. The temporary certificate/private key, guest browser profile, synthetic runtime state, downloads and test logs are not repository deliverables.

The running local review is disposable and resets to scenario A for management inspection. A restart/reset loses synthetic state, never production records. Certificates and browser setup must be regenerated on another computer. Development is paused pending management's visual feedback; no launch authorization is implied.
