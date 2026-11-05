import { createHash } from 'node:crypto';
import { getSupabase } from '@/lib/supabase';
import { salesActor, salesAccess, salesChecked, BusinessError, identifier, readJson } from '@/lib/fieldSales';
export { salesActor, BusinessError, identifier, readJson };

export type CommissionPolicy = {
  timezone: string; rateEffectiveEvent: 'accepted' | 'completed' | 'qualified';
  creditPolicy: 'approved_attribution'; accountingPolicy: 'customer_revenue_less_actual_equipment_materials_provider_fees';
  rounding: 'half_away_from_zero';
  rates: { throughDay: number | null; basisPoints: number }[];
};
export type OrderFacts = {
  quoteId: string; orderId: string; leadId: string; representativeId: string;
  totalCents: number; netPaidCents: number; acceptedAt: string | null; completedAt: string | null;
  verifiedPaidAt: string | null; eligibleEventId: string | null; disputed: boolean; refundedCents: number;
  costsComplete: boolean; costReviewEvidence: unknown; costApprovedBy: string | null; costApprovedAt: string | null;
  expenses: { category: 'equipment' | 'materials' | 'wages'; quantity?: number; unitCents?: number; amountCents: number;
    evidence: unknown; actual: boolean; zeroCostAttestation?: string }[];
  processingFeeCents: number | null; processingFeeEvidence: unknown;
};
export function cents(value: unknown, signed = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > 100000000
    || (!signed && value < 0)) throw new BusinessError('Actual cents must be an exact supported integer.');
  return value;
}
export function calendarDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BusinessError('A valid calendar date is required.');
  const parsed = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new BusinessError('A valid calendar date is required.');
  return parsed / 86400000;
}
export function zonedDate(instant: string, timezone: string): string {
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(instant) || !Number.isFinite(Date.parse(instant))) throw new BusinessError('Event requires an explicit valid timezone.');
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant));
    const part = (name: string) => parts.find(p => p.type === name)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch { throw new BusinessError('Approved timezone is invalid.'); }
}
export function commissionRate(startDate: string, eventAt: string, policy: CommissionPolicy) {
  if (policy.creditPolicy !== 'approved_attribution' || policy.accountingPolicy !== 'customer_revenue_less_actual_equipment_materials_provider_fees'
    || policy.rounding !== 'half_away_from_zero' || !['accepted', 'completed', 'qualified'].includes(policy.rateEffectiveEvent)
    || !Array.isArray(policy.rates) || policy.rates.length !== 3
    || policy.rates.some((rate, i) => rate.throughDay !== [30, 60, null][i] || rate.basisPoints !== [5500, 5000, 4500][i])) {
    throw new BusinessError('Approved commission accounting/rate policy requires review.');
  }
  const tenureDay = calendarDate(zonedDate(eventAt, policy.timezone)) - calendarDate(startDate) + 1;
  if (tenureDay < 1) throw new BusinessError('Rate event precedes representative start date.');
  return { tenureDay, basisPoints: tenureDay <= 30 ? 5500 : tenureDay <= 60 ? 5000 : 4500 };
}
function evidenced(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0 && value.every(evidenced);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return 'evidence' in object ? evidenced(object.evidence) : Object.values(object).some(evidenced);
  }
  return false;
}
export function calculateEarning(facts: OrderFacts, startDate: string | null, startEvidence: string | null, policy: CommissionPolicy | null) {
  const qualified = Boolean(facts.completedAt && facts.verifiedPaidAt && facts.eligibleEventId && facts.netPaidCents === facts.totalCents && !facts.disputed && facts.refundedCents === 0);
  if (!qualified) return { state: 'pending_qualification' as const, qualifiesAt: null, reasons: ['Completion and verified full net payment are required.'] };
  const qualifiesAt = new Date(Math.max(Date.parse(facts.completedAt!), Date.parse(facts.verifiedPaidAt!))).toISOString();
  const reasons: string[] = [];
  try {
    if (!policy || !startDate || !startEvidence?.trim()) throw new BusinessError('Approved commission policy and evidenced representative start date are required.');
    const eventAt = policy.rateEffectiveEvent === 'accepted' ? facts.acceptedAt : policy.rateEffectiveEvent === 'completed' ? facts.completedAt : qualifiesAt;
    if (!eventAt) throw new BusinessError('Approved rate event is unavailable.');
    const rate = commissionRate(startDate, eventAt, policy);
    if (facts.costsComplete !== true || !evidenced(facts.costReviewEvidence)
      || (facts.costReviewEvidence as Record<string, unknown>)?.actualCostsReviewed !== true
      || typeof (facts.costReviewEvidence as Record<string, unknown>)?.reference !== 'string'
      || !String((facts.costReviewEvidence as Record<string, unknown>).reference).trim()
      || !facts.costApprovedBy || !facts.costApprovedAt
      || !Number.isFinite(Date.parse(facts.costApprovedAt))) throw new BusinessError('Management-approved actual cost completeness and evidence are required; technician entries alone are not payable costs.');
    if (!Array.isArray(facts.expenses) || facts.expenses.some(row => !['equipment', 'materials', 'wages'].includes(row.category))) {
      throw new BusinessError('Approved actual cost categories require review.');
    }
    const costs = { equipment: 0, materials: 0 };
    for (const category of ['equipment', 'materials'] as const) {
      const rows = facts.expenses.filter(e => e.category === category);
      if (!rows.length) throw new BusinessError(`Actual ${category} evidence is unavailable.`);
      for (const row of rows) {
        if (row.actual !== true || !row.evidence || typeof row.evidence !== 'object' || Array.isArray(row.evidence) || !evidenced(row.evidence)) throw new BusinessError(`Actual ${category} evidence is unavailable.`);
        const quantity = row.quantity;
        if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0 || quantity > 100000 || !Number.isSafeInteger(quantity * 1000000)
          || row.unitCents === undefined) throw new BusinessError('Approved actual quantity and unit cost are required.');
        const product = BigInt(cents(row.unitCents)) * BigInt(quantity * 1000000);
        if (product % BigInt(1000000) !== BigInt(0) || product / BigInt(1000000) !== BigInt(cents(row.amountCents))) {
          throw new BusinessError('Actual quantity, unit cost and amount do not reconcile exactly.');
        }
        if (row.amountCents === 0 && (!row.zeroCostAttestation || row.zeroCostAttestation.trim().length < 3)) throw new BusinessError('Explicit reviewed zero-cost attestation is required.');
        costs[category] += cents(row.amountCents);
      }
    }
    if (facts.processingFeeCents === null || !evidenced(facts.processingFeeEvidence)) throw new BusinessError('Actual provider fee evidence is unavailable.');
    const basisCents = cents(facts.totalCents) - costs.equipment - costs.materials - cents(facts.processingFeeCents);
    if (basisCents < 0) throw new BusinessError('Negative actual commission basis requires reviewed adjustment; no floor applied.');
    const amountCents = Number((BigInt(basisCents) * BigInt(rate.basisPoints) + BigInt(5000)) / BigInt(10000));
    return { state: 'earned' as const, qualifiesAt, reasons, eventAt, ...rate, basisCents, amountCents,
      inputHash: createHash('sha256').update(JSON.stringify({ facts, startDate, startEvidence, policy })).digest('hex') };
  } catch (error) {
    reasons.push(error instanceof BusinessError || error instanceof Error ? error.message : 'Calculation evidence requires review.');
    return { state: 'calculation_review' as const, qualifiesAt, reasons };
  }
}
export type SettlementPolicy = { timezone: string; cutoff: string; holidayConvention: 'skip' | 'previous_business_day' | 'next_business_day'; holidays: string[]; method: string; classification: string };
export function fridayRunDate(qualifiesAt: string, policy: SettlementPolicy): string {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(policy.cutoff) || !['skip', 'previous_business_day', 'next_business_day'].includes(policy.holidayConvention)
    || !policy.method?.trim() || !policy.classification?.trim() || !Array.isArray(policy.holidays)) throw new BusinessError('Approved Friday settlement policy requires review.');
  policy.holidays.forEach(calendarDate);
  const date = zonedDate(qualifiesAt, policy.timezone), day = calendarDate(date);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: policy.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(qualifiesAt));
  const time = parts.find(p => p.type === 'hour')!.value + ':' + parts.find(p => p.type === 'minute')!.value;
  const iso = (n: number) => new Date(n * 86400000).toISOString().slice(0, 10);
  let friday = day + (5 - new Date(day * 86400000).getUTCDay() + 7) % 7;
  if (friday === day && time >= policy.cutoff) friday += 7;
  for (let attempts = 0; attempts < 104; attempts++, friday += 7) {
    let candidate = friday;
    if (policy.holidays.includes(iso(friday))) {
      if (policy.holidayConvention === 'skip') continue;
      const direction = policy.holidayConvention === 'previous_business_day' ? -1 : 1;
      do { candidate += direction; } while ([0, 6].includes(new Date(candidate * 86400000).getUTCDay()) || policy.holidays.includes(iso(candidate)));
    }
    if (candidate > day || (candidate === day && time < policy.cutoff)) return iso(candidate);
  }
  throw new BusinessError('No eligible Friday settlement date in approved calendar.');
}
export async function earningsActor(request: Request) {
  const actor = await salesActor(request); await salesAccess(actor.userId); return actor;
}
export async function earningsRead(actor: string, representativeId: string | null, quoteId: string | null) {
  return salesChecked(await getSupabase().rpc('field_sales_earnings_read', { p_actor: actor, p_representative: representativeId, p_quote: quoteId }));
}
export async function earningsCommand(actor: { userId: string; role: string }, body: Record<string, unknown>) {
  if (actor.role !== 'ADMIN') throw new BusinessError('Administrator earnings review required.', 403);
  const fields: Record<string, string[]> = { review_order: ['quoteId'], review_adjustment: ['entryId', 'amountCents', 'reason', 'evidence'],
    create_run: ['settlementPolicyId', 'runDate'], approve_run: ['runId', 'evidence'], export_run: ['runId', 'evidence'],
    abandon_run: ['runId', 'reason', 'evidence'], record_settlement: ['runId', 'proof'] };
  const action = String(body.action), allowed = fields[action];
  if (!allowed || Object.keys(body).some(key => !['action', 'operationId', ...allowed].includes(key))) throw new BusinessError('Unsupported earnings command.');
  for (const key of allowed) if (!(key in body)) throw new BusinessError('Earnings command is incomplete.');
  for (const key of ['quoteId', 'entryId', 'runId', 'settlementPolicyId']) if (key in body) identifier(body[key]);
  if ('amountCents' in body) cents(body.amountCents, true);
  if ('runDate' in body) calendarDate(String(body.runDate));
  if (action === 'abandon_run' && (typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.trim().length > 2000
    || !evidenced(body.evidence))) throw new BusinessError('Abandonment reason and audit evidence required.');
  if (action === 'record_settlement') {
    if (!body.proof || typeof body.proof !== 'object' || Array.isArray(body.proof)) throw new BusinessError('Independent settlement proof must be an object.');
    const value = (body.proof as Record<string, unknown>).settledAt;
    if (typeof value !== 'string'
      || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:[0-5]\d)$/.test(value)
      || !Number.isFinite(Date.parse(value)) || Date.parse(value) > Date.now()) throw new BusinessError('Explicit valid settlement timestamp with timezone, not in the future, is required.');
    calendarDate(value.slice(0, 10));
  }
  const input = Object.fromEntries(allowed.map(key => [key, body[key]]));
  const result = await getSupabase().rpc('field_sales_earnings_command', { p_actor: actor.userId, p_operation: identifier(body.operationId), p_action: action, p_input: input });
  if (result.error && ['P0001', '55000', '40001', '23505'].includes(result.error.code)) {
    throw new BusinessError(result.error.code === '23505' ? 'Earning/run/settlement identity already exists; reconcile the existing record.' : result.error.message, 409);
  }
  return salesChecked(result);
}
