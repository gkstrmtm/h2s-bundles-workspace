# Customer service agreement and digital acceptance

Status: **nonproduction only; not a legal opinion or production approval**.

## Current launch: North Carolina, initially Charlotte

The current versioned wording is
[customerAgreement.nc.v1.json](../backend/lib/customerAgreement.nc.v1.json):
`customer-service-nc-v1`, `nc-ftc-cancellation-v1`, and the existing
`electronic-records-v1`. The South Carolina template and migration 056 are
historical, not the current launch configuration. Additive migration 057 does
not rewrite signed SC agreements, retained artifacts, or their deadlines.

### NC and federal requirements

Official NC sources reviewed:

- https://www.ncleg.gov/EnactedLegislation/Statutes/PDF/BySection/Chapter_25A/GS_25A-38.pdf
- https://www.ncleg.gov/EnactedLegislation/Statutes/PDF/BySection/Chapter_25A/GS_25A-39.pdf
- https://www.ncleg.gov/EnactedLegislation/Statutes/PDF/BySection/Chapter_25A/GS_25A-40.pdf
- https://www.ncleg.gov/EnactedLegislation/Statutes/PDF/BySection/Chapter_25A/GS_25A-41.pdf
- https://www.ncleg.gov/EnactedLegislation/Statutes/PDF/BySection/Chapter_25A/GS_25A-2.pdf

NC 25A-38 is a **consumer-credit-sale** definition, not an unconditional rule
for every cash service sale. Counsel must determine its application to the
actual 25%-deposit/balance arrangement. No exemption is assumed: the staging
residential solicitation is treated as covered by both NC and FTC protections.
The FTC residential threshold is $25, regardless of credit financing.

NC 25A-39 provides cancellation until midnight of the third business day after
the buyer signs a compliant agreement, recognizes FTC-compliant documents, and
treats properly addressed, postage-prepaid mailed cancellation as given on
mailing. NC 25A-40 and FTC 429.1 require a completed dated contract, identified
seller/business address, a signature-adjacent cancellation statement, and two
completed, independently detachable cancellation forms in the presentation's
language. The NC signature statement is:

> You, the buyer, may cancel this transaction at any time prior to midnight of
> the third business day after the date of this transaction. See the attached
> Notice of Cancellation form for an explanation of this right.

The current separate forms preserve the FTC model's complete cancellation,
refund, security-interest, return/collection, 20-day and blank cancellation
signature/date provisions. NC 25A-41 requires restoring payments/evidence of
debt within 10 business days. Existing 12-point bold notice styling exceeds
the 10-point minimum. Oral notice at signing remains separate from electronic
acknowledgments. The stored oral-notice evidence is synthetic, not proof that
a real customer received an oral presentation.

FTC 429.0(f) counts Saturdays, but Chapter 25A does not itself define
"business day." **NC interpretation remains a legal-review question.** New NC
staging documents explicitly promise a customer-protective contractual
extension: exclude Saturdays, Sundays, and actual/observed federal holidays;
honor the printed later deadline. This is not presented as a verified NC
statutory definition. Holds end only at midnight following that printed day
in America/New_York, including DST. Historical SC calendars remain unchanged.

Electronic consent, format-access demonstration, four separately retained
executed documents, typed affirmative signature, immutable quote/hash/version
evidence, the 1-year workmanship guarantee, 25% deposit and financial gates
are preserved. Counsel must approve electronic substitute delivery, duplicate
detachable notices, signing-time receipt and the paper fallback under
15 USC 7001(c) before real use. No emergency or checkbox waiver is implemented.

### Charlotte: separately verified municipal requirements

The current official ordinance was read through an ordinary browser after
automated retrieval was denied:

https://library.municode.com/nc/charlotte/codes/code_of_ordinances?nodeId=PTIICOOR_CH6BUTR_ARTVIIIPE

- **6-431:** peddling involves retail merchandise offered on foot/from a
  vehicle with proposed **instant delivery upon receipt of the purchase price**.
  Do not assume a later-installed service is automatically classified as
  peddling, or that it is exempt from all other solicitation restrictions.
- **6-432:** required peddling licenses must be secured for applicable
  street/sidewalk sales and exhibited to an officer on demand.
- **6-433 through 6-435:** the free producer-peddler permit is for qualifying
  self/family-produced goods, not a generic permit for reselling ONN/Eufy goods.
- **6-436:** specified congested-business, coliseum and stadium districts have
  additional restrictions and limited event/market exceptions.
- **6-437:** peddling may not occupy a street space within one block or 300 feet
  for more than 30 minutes during a 24-hour period.
- **6-438:** residential-zoned peddling is prohibited 8 p.m.-8 a.m.; while
  daylight saving time applies, 9 p.m.-8 a.m. Do not substitute unverified
  secondary-source "9 a.m." claims or apply these hours to a different
  permit classification without review.

**No real solicitation authorization is asserted.** Management must obtain a
current classification/permit determination for Home2Smart's actual service,
address and representative, confirm any registration/badge/background-check
requirements and fees, and review no-soliciting/private-property restrictions.
A Charlotte mailing address/ZIP does not establish city limits. Unincorporated
Mecklenburg, Matthews, Mint Hill, Huntersville, Cornelius, Davidson and other
municipalities are not silently included. Their requirements need separate
review before territory expansion.

Only the UUID-owned native sandbox may use synthetic-only territory/permit
evidence. The NC document requires an exact quoted-address match, independent
address-review evidence and separate permit-review evidence. Explicit NC
state and door-to-door channel are server-validated; new SC door-to-door sales
are blocked in this launch. Other service channels are not globally disabled.
Production documents, real permits and live payments remain unactivated.

## Historical South Carolina implementation

The retained SC versioned wording is in [customerAgreement.v1.json](../backend/lib/customerAgreement.v1.json).
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
Customer-specific missing signing prerequisites return a clear HTTP 409 conflict,
not a misleading storage-outage response. Other lifecycle/payment errors are unchanged.

`customerAgreementPreparation` in `backend/lib/fieldAgreement.ts` generates the
existing agreement-policy fields, linked `customer_document`, separate required
notices and reviewed calendar from the central wording. Publish the existing
workflow's `requiredArtifacts`; do not replace the approved policy copy with a
separately assembled artifact or activate these staging documents in production.
Portable agreement copies place the 12-point bold cancellation statement next
to signature intent. Agreement downloads select the agreement by document kind,
not by the order of retained artifacts. Previously signed copies stay unchanged.

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
