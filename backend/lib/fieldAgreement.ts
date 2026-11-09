import { createHash } from 'node:crypto';
import template from '@/lib/customerAgreement.nc.v1.json';
import historicalTemplate from '@/lib/customerAgreement.v1.json';
import { BusinessError } from '@/lib/commercial_business';

type JsonObject = Record<string, unknown>;
export type AgreementDocument = { kind: string; version: string; label: string; html: string; text: string; contentHash: string };
export type AgreementSeller = { name: string; mailingAddress: string; phone: string };
export type AgreementTerritory = { state: 'NC'; municipality: 'Charlotte'; verifiedAddress: string; addressEvidence: string;
  permitReviewEvidence: string; solicitationAuthorized: true; syntheticOnly: true };
export type AgreementPresentation = { language: string; oralNoticeEvidence: string; territory: AgreementTerritory };
const object = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value);
const requiredText = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 40000) throw new BusinessError(`${label} is unavailable; acceptance remains blocked.`, 503);
  return value;
};
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c);
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const money = (value: unknown) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new BusinessError('Exact quote amount unavailable.', 503);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) / 100);
};
export const signatureIntent = template.signatureIntent;
const supportedProtocol = (value: unknown) => value === template.protocol || value === historicalTemplate.protocol;
function validateTerritory(snapshot: JsonObject, value: unknown): asserts value is AgreementTerritory {
  if (!object(value) || value.state !== 'NC' || value.municipality !== 'Charlotte'
    || value.solicitationAuthorized !== true || value.syntheticOnly !== true)
    throw new BusinessError('Reviewed Charlotte, North Carolina territory and synthetic-only solicitation authorization are required.', 503);
  for (const key of ['verifiedAddress', 'addressEvidence', 'permitReviewEvidence']) requiredText(value[key], `Territory ${key}`);
  if (object(snapshot.customer) && (snapshot.customer.state !== 'NC' || typeof snapshot.customer.city !== 'string'
    || snapshot.customer.city.trim().toLowerCase() !== 'charlotte'
    || snapshot.customer.address !== value.verifiedAddress))
    throw new BusinessError('The verified NC territory must match the exact quoted installation address.', 409);
}
export function prepareAgreementArtifacts(snapshot: JsonObject, seller: AgreementSeller, presentation: AgreementPresentation) {
  for (const [key, value] of Object.entries(seller)) requiredText(value, `Seller ${key}`);
  if (presentation.language !== 'en') throw new BusinessError('Reviewed documents in the actual sales-presentation language are required.', 503);
  requiredText(presentation.oralNoticeEvidence, 'Recorded oral cancellation notice');
  validateTerritory(snapshot, presentation.territory);
  const content = { protocol: template.protocol, version: template.version, status: template.status, seller,
    sale: { jurisdiction: 'NC', location: 'residence', personalSolicitation: true, oralPresentationLanguage: presentation.language,
      oralNoticeEvidence: presentation.oralNoticeEvidence, cancellationEligibility: 'covered', territory: presentation.territory },
    text: template.sections.map(section => section.title + '\n\n' + section.text).join('\n\n'),
    signatureNotice: template.signatureNotice, ncNotice: template.ncNotice };
  return [
    { kind: 'quote', label: 'Exact approved quote', content: snapshot },
    { kind: 'agreement', label: 'Home2Smart North Carolina Customer Service Agreement v1', content },
    ...[1, 2].map(copy => ({ kind: 'notice', label: `Notice of cancellation - copy ${copy}`,
      content: { protocol: template.protocol, version: template.noticeVersion, copy, text: template.cancellationNotice } })),
    { kind: 'notice', label: 'Electronic records disclosure', content: { protocol: template.protocol, version: template.consentVersion, text: template.electronicConsent } }
  ];
}
export function customerCancellationCalendar(year: number) {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new BusinessError('Cancellation calendar year is invalid.');
  const holidays = new Set<string>();
  const date = (value: Date) => value.toISOString().slice(0, 10);
  const fixed = (y: number, month: number, day: number) => {
    const value = new Date(Date.UTC(y, month - 1, day)); holidays.add(date(value));
    if (value.getUTCDay() === 6) value.setUTCDate(value.getUTCDate() - 1);
    else if (value.getUTCDay() === 0) value.setUTCDate(value.getUTCDate() + 1);
    holidays.add(date(value));
  };
  const weekday = (y: number, month: number, day: number, occurrence: number) => {
    const value = new Date(Date.UTC(y, month - 1, 1));
    value.setUTCDate(1 + (day - value.getUTCDay() + 7) % 7 + 7 * (occurrence - 1)); holidays.add(date(value));
  };
  for (let y = year - 1; y <= year + 10; y++) {
    for (const [month, day] of [[1, 1], [6, 19], [7, 4], [11, 11], [12, 25]]) fixed(y, month, day);
    weekday(y, 1, 1, 3); weekday(y, 2, 1, 3); weekday(y, 9, 1, 1); weekday(y, 10, 1, 2); weekday(y, 11, 4, 4);
    const memorial = new Date(Date.UTC(y, 5, 0));
    memorial.setUTCDate(memorial.getUTCDate() - (memorial.getUTCDay() + 6) % 7); holidays.add(date(memorial));
  }
  return { timezone: 'America/New_York', businessDays: 3, deadlineLocalTime: '23:59', startEvent: 'acceptance',
    excludedWeekdays: [6, 7], holidays: [...holidays].sort(), coverageYears: { first: year - 1, last: year + 10 },
    convention: 'NC staging voluntarily extends the FTC minimum by excluding Saturdays, Sundays and federal actual/observed holidays; NC-specific statutory interpretation remains subject to counsel review. Deadline is the midnight following the printed final day.' };
}
export function customerAgreementPreparation(snapshot: JsonObject, seller: AgreementSeller,
  presentation: AgreementPresentation, calendarYear: number) {
  const artifacts = prepareAgreementArtifacts(snapshot, seller, presentation);
  const customerDocument = artifacts[1].content;
  return {
    agreementPolicy: {
      version: template.version, status: template.status,
      terms: requiredText(customerDocument.text, 'Service agreement'),
      cancellation_information: template.ncNotice + '\n\n' + template.signatureNotice,
      electronic_delivery: template.electronicConsent,
      payment_terms: template.sections[0].text,
      customer_document: customerDocument
    },
    requiredNotices: artifacts.filter(artifact => artifact.kind === 'notice')
      .map(artifact => ({ label: artifact.label, content: artifact.content })),
    cancellationCalendar: customerCancellationCalendar(calendarYear),
    productionApproved: false
  };
}
function htmlDocument(label: string, text: string, notice: boolean, agreement: boolean, signatureNotice: string) {
  const signatureTail = '\n\n' + signatureNotice + '\n\n' + signatureIntent;
  if (agreement && !text.endsWith(signatureTail)) throw new BusinessError('Signature-adjacent cancellation statement is unavailable.', 503);
  const body = agreement
    ? `<pre>${escape(text.slice(0, -signatureTail.length))}</pre><p class="notice">${escape(signatureNotice)}</p><p>${escape(signatureIntent)}</p>`
    : `<pre${notice ? ' class="notice"' : ''}>${escape(text)}</pre>`;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + `<title>${escape(label)} | Home2Smart</title><style>body{font:16px/1.6 Arial,sans-serif;color:#172033;max-width:760px;margin:0 auto;padding:24px}h1{font-size:24px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}.notice{font-size:12pt;font-weight:700}@media print{body{padding:0}h1{font-size:18pt}.notice{font-size:12pt;font-weight:700}}</style></head><body>`
    + `<h1>${escape(label)}</h1><main>${body}</main></body></html>`;
}
function quoteSummary(snapshot: JsonObject, seller: JsonObject, quote: JsonObject, reviewDate: string) {
  if (!object(snapshot.customer) || !Array.isArray(snapshot.lines) || !snapshot.lines.length) throw new BusinessError('Exact customer scope unavailable.', 503);
  const total = snapshot.totalCents;
  if (!Number.isSafeInteger(total) || Number(total) < 1) throw new BusinessError('Exact agreed total unavailable.', 503);
  const deposit = Math.ceil(Number(total) / 4);
  const state = typeof snapshot.customer.state === 'string' && snapshot.customer.state.trim() ? ', ' + snapshot.customer.state : '';
  return [
    'STAGING ONLY - fictional transaction; not production-approved legal terms or a real customer obligation.',
    `Seller: ${requiredText(seller.name, 'Seller name')}`,
    `Seller mailing address: ${requiredText(seller.mailingAddress, 'Seller mailing address')}`,
    `Contact telephone: ${requiredText(seller.phone, 'Seller telephone')}`,
    `Transaction/signing date: ${reviewDate} (America/New_York)`,
    `Customer: ${requiredText(snapshot.customer.name, 'Customer name')}`,
    `Installation location: ${requiredText(snapshot.customer.address, 'Installation address')}, ${requiredText(snapshot.customer.city, 'Installation city')}${state}`,
    `Exact approved quote: ${requiredText(quote.quote_id, 'Quote identity')}; revision ${quote.revision}; hash ${requiredText(quote.quote_hash, 'Quote hash')}`,
    ...snapshot.lines.map(line => {
      if (!object(line) || !Array.isArray(line.scope) || !Array.isArray(line.equipment) || !Array.isArray(line.exclusions))
        throw new BusinessError('Approved installation scope is incomplete.', 503);
      return `${requiredText(line.service, 'Service')}: ${requiredText(line.description, 'Scope description')}\nQuantity: ${line.quantity}; line price: ${money(line.totalCents)}\nIncluded equipment/materials: ${line.equipment.map(String).join('; ') || 'Only those expressly stated in the approved quote'}\nInstallation scope: ${line.scope.map(String).join('; ')}\nExclusions/conditions: ${line.exclusions.map(String).join('; ') || 'None stated'}`;
    }),
    `Total agreed price: ${money(total)}\n25% deposit: ${money(deposit)}\nRemaining agreed balance after installation: ${money(Number(total) - deposit)}`
  ].join('\n\n');
}
export function withCustomerDocuments(value: unknown): JsonObject {
  if (!object(value) || !object(value.quote) || !object(value.agreement)) throw new BusinessError('Agreement response is incomplete.', 503);
  if (value.agreement.accepted_at) return { ...value, signatureRequired: false };
  const workflow = object(value.workflow) ? value.workflow : null;
  const artifacts = workflow && Array.isArray(workflow.documents) ? workflow.documents.filter(object) : [];
  const source = artifacts.find(doc => doc.kind === 'agreement' && object(doc.content)
    && (supportedProtocol(doc.content.protocol) || object(doc.content.customer_document) && supportedProtocol(doc.content.customer_document.protocol)));
  if (!workflow || !source || !object(source.content)) {
    return { ...value, signatureRequired: !value.agreement.accepted_at,
      signatureUnavailableReason: 'Updated customer agreement and separate cancellation documents require management preparation. New acceptance is blocked.' };
  }
  const content = object(source.content.customer_document) ? source.content.customer_document : source.content;
  if (content.status !== 'staging_only' || !object(content.seller) || !object(content.sale)
    || content.sale.jurisdiction !== (content.protocol === template.protocol ? 'NC' : 'SC')
    || content.sale.oralPresentationLanguage !== 'en' || content.sale.cancellationEligibility !== 'covered')
    throw new BusinessError('Customer legal eligibility or reviewed language is unresolved. Acceptance is blocked.', 503);
  if (content.protocol === template.protocol) {
    if (!object(value.quote.snapshot)) throw new BusinessError('Exact quoted NC address is unavailable.', 503);
    validateTerritory(value.quote.snapshot, content.sale.territory);
  }
  if (!object(value.quote.snapshot) || typeof workflow.reviewDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(workflow.reviewDate)
    || typeof workflow.cancellationPreviewDeadline !== 'string' || !Number.isFinite(Date.parse(workflow.cancellationPreviewDeadline)))
    throw new BusinessError('Server cancellation date is unresolved. Acceptance is blocked.', 503);
  const date = workflow.reviewDate;
  const deadline = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'long', day: 'numeric' })
    .format(new Date(Date.parse(workflow.cancellationPreviewDeadline) - 1));
  const values: Record<string, string> = { SELLER_NAME: requiredText(content.seller.name, 'Seller name'),
    SELLER_ADDRESS: requiredText(content.seller.mailingAddress, 'Seller mailing address'),
    SELLER_PHONE: requiredText(content.seller.phone, 'Seller telephone'), TRANSACTION_DATE: date, CANCELLATION_DATE: deadline };
  const fill = (text: string) => text.replace(/\{\{([A-Z_]+)\}\}/g, (_, key: string) => {
    if (!Object.hasOwn(values, key)) throw new BusinessError('Unresolved required document field.', 503);
    return values[key];
  });
  const summary = quoteSummary(value.quote.snapshot, content.seller, value.quote, date);
  const documents: AgreementDocument[] = [];
  function document(kind: string, version: unknown, label: string, text: string) {
    const html = htmlDocument(label, text, kind === 'notice', kind === 'agreement', requiredText(content.signatureNotice, 'Signature-adjacent cancellation notice'));
    documents.push({ kind, version: requiredText(version, 'Document version'), label, html, text, contentHash: hash(html) });
  }
  document('agreement', content.version, 'Home2Smart Customer Service Agreement',
    summary + '\n\n' + requiredText(content.text, 'Service agreement') + '\n\n'
    + fill(requiredText(content.protocol === template.protocol ? content.ncNotice : content.scNotice, 'State cancellation statement')) + '\n\n'
    + requiredText(content.signatureNotice, 'Signature-adjacent cancellation notice') + '\n\n' + signatureIntent);
  for (const copy of [1, 2]) {
    const artifact = artifacts.find(doc => doc.kind === 'notice' && object(doc.content) && doc.content.copy === copy);
    if (!artifact || !object(artifact.content)) throw new BusinessError('Both separate cancellation notice copies are required.', 503);
    document('notice', artifact.content.version, `Notice of cancellation - copy ${copy}`, fill(requiredText(artifact.content.text, 'Cancellation notice')));
  }
  const consent = artifacts.find(doc => object(doc.content) && doc.content.version === template.consentVersion);
  if (!consent || !object(consent.content)) throw new BusinessError('Electronic-record disclosure is unavailable.', 503);
  document('electronic_consent', consent.content.version, 'Electronic records disclosure', fill(requiredText(consent.content.text, 'Electronic-record disclosure')));
  const bundleHash = hash(documents.map(doc => doc.contentHash).join('|') + '|' + value.quote.quote_hash + '|' + date);
  const code = bundleHash.slice(0, 8).toUpperCase();
  const demonstration = documents[0].html.replace('</body>', `<aside><h2>Electronic access demonstration</h2><p>Enter this code on the agreement page: <strong>${code}</strong></p><p>This demonstrates access to HTML records, not that every word was read.</p></aside></body>`);
  return { ...value, signatureRequired: true, workflow: { ...workflow, signatureProtocol: content.protocol,
    reviewDocuments: documents, reviewedBundleHash: bundleHash, accessDemonstrationHtml: demonstration } };
}
export function acceptanceEvidence(body: JsonObject, facts: ReturnType<typeof withCustomerDocuments>, request: Request) {
  if (object(facts.agreement) && facts.agreement.accepted_at && object(facts.agreement.acceptance)) {
    const recorded = facts.agreement.acceptance;
    const submitted = { ...body, accessCode: typeof body.accessCode === 'string' ? body.accessCode.trim().toUpperCase() : body.accessCode };
    for (const [key, value] of Object.entries(submitted)) {
      if (recorded[key] !== value) throw new BusinessError('Acceptance is already recorded with different evidence.', 409);
    }
    return recorded;
  }
  if (!object(facts.workflow) || !supportedProtocol(facts.workflow.signatureProtocol)
    || !Array.isArray(facts.workflow.reviewDocuments)) throw new BusinessError('Required versioned customer documents are unavailable.', 409);
  for (const key of ['accepted', 'electronicDelivery', 'agreementAccepted', 'cancellationNoticeReceived', 'electronicRecordsConsent', 'signatureIntent']) {
    if (body[key] !== true) throw new BusinessError('Each separate acknowledgment and affirmative signature is required.', 400);
  }
  if (body.reviewedBundleHash !== facts.workflow.reviewedBundleHash || body.reviewDate !== facts.workflow.reviewDate)
    throw new BusinessError('Documents or signing date changed. Review the exact current copies before signing.', 409);
  if (body.signatureIntentText !== signatureIntent || typeof body.accessCode !== 'string'
    || body.accessCode.trim().toUpperCase() !== String(facts.workflow.reviewedBundleHash).slice(0, 8).toUpperCase())
    throw new BusinessError('Open the electronic access demonstration and affirm your intent to sign.', 400);
  if (typeof body.name !== 'string' || body.name.trim().split(/\s+/u).length < 2) throw new BusinessError('Enter your full signature name.', 400);
  return { ...body, name: body.name.trim(), accessCode: body.accessCode.trim().toUpperCase(),
    acceptanceMethod: 'typed_name_affirmative_signature_v1',
    acceptedDocuments: facts.workflow.reviewDocuments.map(doc => {
      if (!object(doc)) throw new BusinessError('Required customer copy is incomplete.', 503);
      return { kind: doc.kind, version: doc.version, label: doc.label, html: doc.html, contentHash: doc.contentHash };
    }),
    artifactHashes: facts.workflow.originalArtifactHashes,
    acknowledgments: ['agreement', 'cancellation_notice', 'electronic_records', 'signature_intent'].map(kind => ({ kind, affirmed: true })),
    requestMetadata: { userAgent: (request.headers.get('user-agent') || '').slice(0, 300),
      origin: (request.headers.get('origin') || '').slice(0, 200), authenticatedCustomerLink: true }
  };
}
