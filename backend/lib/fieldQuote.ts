import { BusinessError } from '@/lib/commercial_business';

export type QuoteQuestion = { id: string; label: string; type: 'text' | 'number' | 'select'; required: boolean;
  min?: number; max?: number; options?: string[] };
export type QuoteOption = { id: string; label: string; amountCents: number; perUnit: boolean; equipment: string[]; replacesEquipment?: string[];
  guidance?: { mountStyle: 'tilt' | 'full_motion'; equipmentId: string } };
export type QuoteCompletionRequirement = { id: string; label: string; type: 'photo' | 'signature' | 'checklist'; minimumCount: number };
export type QuoteGuidance = { kind: 'tv' | 'camera'; ownership: 'supplied' | 'customer';
  mountStyle?: 'fixed' | 'tilt' | 'full_motion'; equipmentId?: string };
export type TvMarginalDiscounts = { basis: 'highest_base_price_first_marginal'; percentsByPosition: [0, 10, 15]; eligibleOfferIds: string[] };
export const FIELD_COMPLETION_PROOF_MAX_BYTES = 4456448;
export type QuoteOffer = { id: string; label: string; enabled: boolean; unitCents: number | null; basis: 'per_unit' | 'package';
  minimum: number; maximum: number; starting: boolean; equipment: string[]; scope: string[]; exclusions: string[];
  questions: QuoteQuestion[]; options: QuoteOption[]; qualifications: { question: string; allowed: (string | number)[]; reason: string }[];
  guidance?: QuoteGuidance };
export type QuoteCatalog = { catalog_id: string; version: string; status: 'draft' | 'published' | 'retired' | 'staging_only'; digest: string;
  definition: { currency: 'usd'; validForMinutes: number | null; services: { id: string; label: string; markets: string[];
    offers: QuoteOffer[]; completionRequirements?: QuoteCompletionRequirement[]; tvMarginalDiscounts?: TvMarginalDiscounts }[] } };
const slug = /^[a-z][a-z0-9_-]{0,79}$/;
const money = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100000000;
const label = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100 && value.every(item => typeof item === 'string' && item.length > 0 && item.length <= 2000);
export function validateQuoteCatalog(catalog: QuoteCatalog): QuoteCatalog {
  const d = catalog?.definition;
  if (!catalog || !['draft','published','retired','staging_only'].includes(catalog.status) || !d || d.currency !== 'usd'
    || !Array.isArray(d.services) || !d.services.length || d.services.length > 100
    || (catalog.status !== 'draft' && (!Number.isSafeInteger(d.validForMinutes) || Number(d.validForMinutes) < 1 || Number(d.validForMinutes) > 43200))) {
    throw new BusinessError('Quote catalog configuration requires management review.', 503);
  }
  const unique = (ids: string[]) => new Set(ids).size === ids.length && ids.every(id => typeof id === 'string' && slug.test(id));
  if (!unique(d.services.map(s => s?.id))) throw new BusinessError('Service identifiers are invalid.', 503);
  for (const service of d.services) {
    if (!service || !label(service.label) || !strings(service.markets) || service.markets.some(m => !['residential','commercial'].includes(m))
      || !Array.isArray(service.offers) || !service.offers.length || !unique(service.offers.map(o => o?.id))) throw new BusinessError('Service configuration is incomplete.', 503);
    if (service.completionRequirements !== undefined && (!Array.isArray(service.completionRequirements)
      || service.completionRequirements.length > 100 || !unique(service.completionRequirements.map(requirement => requirement?.id))
      || service.completionRequirements.some(requirement => !requirement || !label(requirement.label)
        || !['photo','signature','checklist'].includes(requirement.type) || !Number.isSafeInteger(requirement.minimumCount)
        || requirement.minimumCount < 1 || requirement.minimumCount > 100
        || (requirement.type === 'checklist' && requirement.minimumCount !== 1)
        || Object.keys(requirement).some(key => !['id','label','type','minimumCount'].includes(key))))) {
      throw new BusinessError('Service completion evidence configuration requires management review.', 503);
    }
    for (const o of service.offers) {
      if (!o || !label(o.label) || typeof o.enabled !== 'boolean' || typeof o.starting !== 'boolean' || !['per_unit','package'].includes(o.basis)
        || (o.unitCents !== null && !money(o.unitCents)) || !Number.isSafeInteger(o.minimum) || !Number.isSafeInteger(o.maximum)
        || o.minimum < 1 || o.maximum < o.minimum || o.maximum > 10000 || !strings(o.equipment) || !strings(o.scope) || !strings(o.exclusions)
        || !Array.isArray(o.questions) || !Array.isArray(o.options) || !Array.isArray(o.qualifications)
        || !unique(o.questions.map(q => q?.id)) || !unique(o.options.map(option => option?.id))
        || o.questions.some(q => !q || !label(q.label) || typeof q.required !== 'boolean' || !['text','number','select'].includes(q.type)
          || (q.type === 'select' && (!strings(q.options) || !q.options.length))
          || (q.type === 'number' && ((q.min !== undefined && !Number.isFinite(q.min)) || (q.max !== undefined && !Number.isFinite(q.max)) || (q.min ?? 0) > (q.max ?? 100000))))
        || o.options.some(option => !option || !label(option.label) || !money(option.amountCents) || typeof option.perUnit !== 'boolean' || !strings(option.equipment)
          || (option.replacesEquipment !== undefined && (!strings(option.replacesEquipment) || option.replacesEquipment.some(item => !o.equipment.includes(item))))
          || (option.guidance !== undefined && (!option.guidance || !['tilt','full_motion'].includes(option.guidance.mountStyle)
            || !slug.test(option.guidance.equipmentId) || Object.keys(option.guidance).some(key => !['mountStyle','equipmentId'].includes(key)))))
        || o.qualifications.some(rule => !rule || !o.questions.some(q => q.id === rule.question) || !Array.isArray(rule.allowed)
          || !rule.allowed.length || rule.allowed.some(v => typeof v !== 'string' && (typeof v !== 'number' || !Number.isFinite(v))) || !label(rule.reason))) {
        throw new BusinessError('Offer, equipment or qualification configuration is invalid.', 503);
      }
      if (o.guidance !== undefined && (!o.guidance || !['tv','camera'].includes(o.guidance.kind)
        || !['supplied','customer'].includes(o.guidance.ownership)
        || (o.guidance.mountStyle !== undefined && !['fixed','tilt','full_motion'].includes(o.guidance.mountStyle))
        || (o.guidance.equipmentId !== undefined && !slug.test(o.guidance.equipmentId))
        || Object.keys(o.guidance).some(key => !['kind','ownership','mountStyle','equipmentId'].includes(key)))) {
        throw new BusinessError('Offer knowledge linkage requires management review.', 503);
      }
    }
    const discounts = service.tvMarginalDiscounts;
    if (discounts !== undefined && (!discounts || service.id !== 'tv_mounting'
      || service.markets.length !== 1 || service.markets[0] !== 'residential'
      || discounts.basis !== 'highest_base_price_first_marginal'
      || JSON.stringify(discounts.percentsByPosition) !== '[0,10,15]'
      || !Array.isArray(discounts.eligibleOfferIds) || !discounts.eligibleOfferIds.length || !unique(discounts.eligibleOfferIds)
      || discounts.eligibleOfferIds.some(id => !service.offers.some(offer => offer.id === id && offer.basis === 'per_unit' && !offer.starting && offer.unitCents !== null))
      || Object.keys(discounts).some(key => !['basis','percentsByPosition','eligibleOfferIds'].includes(key)))) {
      throw new BusinessError('Residential marginal TV discount configuration requires management review.', 503);
    }
  }
  return catalog;
}
export function calculateFieldQuote(catalog: QuoteCatalog, input: unknown, market: string) {
  validateQuoteCatalog(catalog);
  if (!Array.isArray(input) || !input.length || input.length > 30) throw new BusinessError('Select 1-30 service lines.');
  const approvalReasons: string[] = [], lines: Record<string, unknown>[] = [];
  const proofServices = new Map<string, QuoteCompletionRequirement[]>();
  let total = 0, unpriced = false;
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BusinessError('Invalid service line.');
    const row = raw as Record<string, unknown>;
    if (Object.keys(row).some(key => !['serviceId','offerId','quantity','answers','options','exceptionNote'].includes(key))) throw new BusinessError('Client prices, scope and equipment overrides are not accepted.');
    const service = catalog.definition.services.find(s => s.id === row.serviceId && s.markets.includes(market));
    const offer = service?.offers.find(o => o.id === row.offerId && o.enabled);
    if (!service || !offer || !Number.isSafeInteger(row.quantity) || Number(row.quantity) < offer.minimum || Number(row.quantity) > offer.maximum) {
      throw new BusinessError('Select an available service/offer and an eligible whole quantity.');
    }
    if (service.completionRequirements) proofServices.set(service.id, service.completionRequirements);
    if (!Array.isArray(row.options) || new Set(row.options).size !== row.options.length
      || row.options.some(id => !offer.options.some(o => o.id === id))) throw new BusinessError('Choose distinct configured equipment/add-ons.');
    if (!row.answers || typeof row.answers !== 'object' || Array.isArray(row.answers)) throw new BusinessError('Service answers are required.');
    const answers = row.answers as Record<string, unknown>, clean: Record<string, string | number> = {};
    if (Object.keys(answers).some(key => !offer.questions.some(q => q.id === key))) throw new BusinessError('Unknown quote question.');
    for (const q of offer.questions) {
      const value = answers[q.id];
      if (value === undefined || value === '') { if (q.required) approvalReasons.push(`${service.label}: ${q.label} needs qualification.`); continue; }
      if (q.type === 'number') {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < (q.min ?? 0) || value > (q.max ?? 100000)) throw new BusinessError(`Review ${q.label}.`);
        clean[q.id] = value;
      } else {
        if (typeof value !== 'string' || value.length > 2000 || (q.type === 'select' && !q.options?.includes(value))) throw new BusinessError(`Review ${q.label}.`);
        clean[q.id] = value.trim();
        if (q.required && !clean[q.id]) approvalReasons.push(`${service.label}: ${q.label} needs qualification.`);
      }
    }
    for (const rule of offer.qualifications) if (!rule.allowed.includes(clean[rule.question])) approvalReasons.push(rule.reason);
    if (offer.starting) approvalReasons.push(`${service.label}: starting price requires final scope/price approval.`);
    if (row.exceptionNote !== undefined && (typeof row.exceptionNote !== 'string' || row.exceptionNote.length > 2000)) throw new BusinessError('Review the exception description.');
    if (row.exceptionNote) approvalReasons.push(String(row.exceptionNote));
    const selected = offer.options.filter(o => (row.options as unknown[]).includes(o.id)), quantity = Number(row.quantity);
    const replaced = selected.flatMap(o => o.replacesEquipment || []);
    if (new Set(replaced).size !== replaced.length) throw new BusinessError('Choose compatible equipment upgrades, not competing replacements.');
    const baseCents = offer.unitCents === null ? null : offer.unitCents * (offer.basis === 'per_unit' ? quantity : 1);
    const additions = selected.map(option => ({ id: option.id, label: option.label, amountCents: option.amountCents * (option.perUnit ? quantity : 1), equipment: option.equipment }));
    const lineTotal = baseCents === null ? null : baseCents + additions.reduce((sum, item) => sum + item.amountCents, 0);
    if (lineTotal === null) { unpriced = true; approvalReasons.push(`${service.label}: approved pricing is missing.`); }
    else { if (!money(lineTotal)) throw new BusinessError('Quote exceeds supported limits.'); total += lineTotal; }
    lines.push({ serviceId: service.id, offerId: offer.id, service: service.label, description: offer.label, quantity, answers: clean,
      answerLabels: Object.fromEntries(offer.questions.map(question => [question.id, question.label])),
      baseCents, addOns: additions, totalCents: lineTotal, equipment: [...offer.equipment.filter(item => !replaced.includes(item)), ...selected.flatMap(o => o.equipment)],
      scope: offer.scope, exclusions: offer.exclusions, starting: offer.starting,
      ...(service.completionRequirements !== undefined
        ? { completionRequirements: service.completionRequirements.map(requirement => ({ ...requirement })) } : {}) });
  }
  for (const service of catalog.definition.services) {
    const policy = service.tvMarginalDiscounts;
    if (!policy || market !== 'residential') continue;
    const selected = lines.filter(line => line.serviceId === service.id);
    if (selected.reduce((count,line) => count+Number(line.quantity),0)>3) {
      unpriced = true;
      approvalReasons.push('TV quantities or offers outside the configured marginal discount schedule require a custom quote.');
      continue;
    }
    const units = selected.flatMap((line, index) => Array.from({ length: Number(line.quantity) }, () => ({
      index, baseCents: Number(line.baseCents) / Number(line.quantity), offerId: String(line.offerId)
    })));
    if (units.length > 3 || units.some(unit => !policy.eligibleOfferIds.includes(unit.offerId))) {
      unpriced = true;
      approvalReasons.push('TV quantities or offers outside the configured marginal discount schedule require a custom quote.');
      continue;
    }
    units.sort((a, b) => b.baseCents - a.baseCents || a.index - b.index);
    for (const [position, unit] of units.entries()) {
      const discount = Math.round(unit.baseCents * policy.percentsByPosition[position] / 100);
      const line = selected[unit.index];
      line.discountCents = Number(line.discountCents ?? 0) + discount;
      line.totalCents = Number(line.totalCents) - discount;
      total -= discount;
    }
  }
  const bindings: { serviceId: string; requirementId: string; artifactIds: string[] }[] = [];
  const checklists: { serviceId: string; requirementId: string; affirmed: boolean; evidence: { reference: string } }[] = [];
  const identifier = '00000000-0000-4000-8000-000000000000';
  for (const [serviceId, requirements] of proofServices) for (const requirement of requirements) {
    if (requirement.type === 'checklist') checklists.push({ serviceId, requirementId: requirement.id,
      affirmed: true, evidence: { reference: 'ref' } });
    else bindings.push({ serviceId, requirementId: requirement.id, artifactIds: Array(requirement.minimumCount).fill(identifier) });
  }
  // Slug/UUID identifiers and this minimal payload are ASCII, so JSON length is its exact UTF-8 byte size.
  const minimumProofBytes = JSON.stringify({ job_id: identifier, operationId: identifier, workflowRevision: 2147483647,
    action: 'proof_record', bindings, checklists }).length;
  if (minimumProofBytes > FIELD_COMPLETION_PROOF_MAX_BYTES) {
    throw new BusinessError('Required completion evidence exceeds the supported record size. Management must review the service configuration.');
  }
  if (!money(total) || (!unpriced && total < 1)) throw new BusinessError('A positive supported quote total is required.');
  return { currency: 'usd', catalogVersion: catalog.version, lines, totalCents: unpriced ? null : total,
    approvalReasons: [...new Set(approvalReasons)], pricingStatus: catalog.status === 'staging_only' ? 'staging_only' : catalog.status === 'published' ? 'published' : 'unpublished_not_payable' };
}
