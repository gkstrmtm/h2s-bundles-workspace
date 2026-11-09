# Customer service agreement and digital acceptance

Status: **nonproduction only; not a legal opinion or production approval**.

The versioned wording is in [customerAgreement.v1.json](../backend/lib/customerAgreement.v1.json).
The existing quote, agreement, workflow artifact/delivery, customer capability and
Stripe checkout infrastructure is reused. No separate agreement system is introduced.
Existing signed evidence must not be overwritten.

## Sources reviewed

- South Carolina Code 37-2-501 through 37-2-503:
  https://www.scstatehouse.gov/Archives/CodeofLaws2025/t37c002.php
- FTC rule landing page (automated retrieval returned HTTP 403):
  https://www.ftc.gov/legal-library/browse/rules/cooling-period-sales-made-home-or-other-locations
- Rule text independently read, including the notice form in its HTML tables:
  https://www.law.cornell.edu/cfr/text/16/429.0
  https://www.law.cornell.edu/cfr/text/16/429.1
- E-SIGN:
  https://www.law.cornell.edu/uscode/text/15/7001

## Engineering requirements mapped to the sources

- SC 37-2-501 includes qualifying home-solicitation credit/card-funded sales.
  FTC coverage includes qualifying personally solicited residential sales of at
  least $25, including some invited visits. Do not treat an online signature
  after an in-person solicitation as automatically exempt. This implementation
  conservatively treats its SC residential solicitation scenario as covered.
- SC 37-2-503 requires the buyer's signed writing, actual transaction/signature
  date, seller name and mailing address, and a copy at signing. Its subsection
  (2)(a) permits the applicable FTC notice; the state alternative statement is
  also retained prominently. Noncompliance can extend cancellation rights under
  subsection (3); the system must not declare those rights expired.
- FTC 429.1 requires a completed contract copy, a conspicuous cancellation
  statement adjacent to the signature, and **two** completed cancellation forms.
  Required notice text uses at least 10-point bold type; generated HTML and print
  styles use 12-point bold. Cancellation forms contain the seller, mailing
  address, transaction date and deadline, plus a blank cancellation date/signature
  area for later cancellation. They are not an additional contract signature.
- FTC 429.1(e) requires oral cancellation information at signing. A digital
  checkbox does not perform that oral communication. Preparation requires
  recorded sales-presentation language and oral-notice evidence; the synthetic
  fixture is not proof that a real customer was orally informed.
- FTC 429.0(f) excludes Sundays and federal holidays; ordinary Saturdays count.
  The protocol uses America/New_York, three business days after signing, and
  midnight following the final counted day. Actual and observed federal
  holidays are conservatively excluded, including Juneteenth. Missing/unreviewed
  calendars must block clearance, not shorten the period.
- No emergency exception, cancellation waiver or automatically nonrefundable
  deposit is implemented. Scheduling/assignment/performance remain blocked
  during the applicable cancellation period, independently of deposit payment.
- E-SIGN 7001(c) requires affirmative electronic-record consent, paper/withdrawal
  options and disclosed procedures, scope, costs and hardware/software needs.
  A downloaded HTML access demonstration supplies a code to confirm access to
  the same format used for customer records. A download click is not proof of
  saving a file or reading every word. Withdrawal affects future delivery, not
  already executed records, and is distinct from cancellation.
- Only English documents are implemented. Preparation with another presentation
  language blocks until qualified translations and corresponding delivery are
  reviewed. Do not silently substitute English for the actual sales language.

## Signature and evidence

The customer reviews the exact quote and dated document bundle, acknowledges
agreement acceptance, both cancellation copies, electronic-record consent and
signature intent separately, supplies a typed full name, and presses the explicit
signature action. Reaching the document end is an accessibility/UI step, not proof
of reading or a server acceptance event.

The server verifies exact versions/hashes, current signing date, required
acknowledgments, format-access code, signature intent and authenticated retrieval
before immutable acceptance. Server timestamps and individually identified
acknowledgment events are retained. Reviewed documents and executed copies are
stored in existing immutable artifacts. Customer retrieval is recorded separately;
no email delivery is claimed without provider evidence. Later edits require new
quote/document versions; renewed finite capabilities only retrieve existing copies.

## Specific qualified-review and management decisions before production

1. Confirm the legal seller name and a valid business mailing/cancellation address.
   The existing public contact number is 864-387-8413; confirm the staffed
   workmanship, paper-copy, consent-withdrawal and cancellation processes.
   Synthetic names/addresses must never appear in production documents.
2. Confirm SC/FTC applicability for each actual acquisition and contracting
   channel, payment method and invitation/solicitation pattern, including any
   other applicable notices. Unknown eligibility must not become an exemption.
3. Confirm that the proposed electronic delivery, duplicate forms, access
   demonstration, signing-time copies and paper fallback satisfy the specific
   notice/delivery rules. Review the different treatment of informational
   electronic previews before consent versus final delivery after consent.
4. Confirm the SC business-day interpretation, federal observed-holiday
   treatment, midnight convention and extended rights for noncompliant delivery.
5. Review final cancellation/refund procedures, equipment-return obligations,
   any additional state-law timing, and post-cooling-off cancellation terms.
   This draft establishes no automatic deposit forfeiture or cancellation fee.
6. Approve final workmanship procedures and commencement on actual completion,
   preserving negligent-installation responsibility and statutory rights.
7. Approve required translations and staff oral-notice scripts/evidence,
   retention/access periods, paper delivery, consent withdrawal/contact updates,
   and dispute/cancellation routing before opening real customer transactions.

All document versions remain staging-only. No live payment settings or production
document activation are authorized by this implementation.
