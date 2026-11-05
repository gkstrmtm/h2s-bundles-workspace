import { BusinessError } from '@/lib/commercial_business';

export type ForecastProvenance = 'approved' | 'hypothetical' | 'estimated' | 'market_fact' | 'internal_history' | 'unknown';
export type ForecastPrice = { kind: 'approved' | 'hypothetical' | 'unknown'; amountCents: number | null;
  catalogId?: string; serviceId?: string; offerId?: string };
export type ForecastService = { id: string; label: string; shareBps: number; jobMinutes: number;
  ownership: 'customer_owned' | 'supplied'; equipmentSku?: string; price: ForecastPrice; materialsCents: number | null };
export type ForecastSensitivity = { demandBps: number; cplBps: number; completionBps: number };
export type ForecastMarket = {
  id: string; label: string; geography: { place: string; state: string };
  context: { entry: string; property: string; household: string; channels: string; goals: string; constraints: string };
  reps: number; repTenureDays: number | null; technicians: number; workDays: number; hoursPerDay: number; productiveBps: number;
  travelMinutesPerJob: number | null; adBudgetCents: number; cplCents: number | null; repLeadsPerDay: number; organicLeads: number;
  bookingBps: number; cancellationBps: number; completionBps: number; depositCollectedBps: number; balanceCollectedBps: number;
  processingBps: number | null; processingFixedCents: number | null; techHourlyCents: number | null;
  techPerJobCents: number | null; overheadCents: number | null; services: ForecastService[]; baselineServices?: ForecastService[];
  sensitivities: { downside: ForecastSensitivity; best: ForecastSensitivity };
};
export type ForecastScenario = { version: 1; markets: ForecastMarket[] };
export type ForecastFact = { name: string; value: number; unit: string; provenance: 'market_fact'; sourceUrl: string;
  dataset: string; datasetYear: number; fetchedAt: string; stale: boolean };
export type ForecastResearch = { facts: ForecastFact[]; missing: string[] };
export type ForecastCatalogPrice = { catalogId: string; version: string; digest: string; serviceId: string; offerId: string;
  label: string; amountCents: number | null; markets: string[]; equipment: string[]; starting: boolean; qualified: boolean };
export type ForecastComparison = { market: string; marketId: string; pricingContext: 'existing_baseline' | 'market_proposal';
  confidence: string; missing: string[]; recommendations: string[]; advisory: { author: 'rules' | 'ai'; text: string }[];
  evidence: ForecastFact[]; cases: { name: 'downside' | 'base' | 'best'; metrics: Record<string, number | null> }[];
  audit: { path: string; provenance: ForecastProvenance; detail: string }[] };

export function defaultForecastScenario(): ForecastScenario {
  return { version: 1, markets: [{
    id: 'market-1', label: 'Management scenario', geography: { place: '', state: '' },
    context: { entry: 'Hypothetical market entry', property: 'residential', household: '', channels: 'Paid, representative prospecting and organic leads are distinct; deduplicated inputs only', goals: '', constraints: '' },
    reps: 5, repTenureDays: null, technicians: 2, workDays: 20, hoursPerDay: 8, productiveBps: 7500,
    travelMinutesPerJob: null, adBudgetCents: 1000000, cplCents: null, repLeadsPerDay: 2, organicLeads: 0,
    bookingBps: 2000, cancellationBps: 1000, completionBps: 10000, depositCollectedBps: 10000, balanceCollectedBps: 10000,
    processingBps: null, processingFixedCents: null, techHourlyCents: null, techPerJobCents: null, overheadCents: null,
    services: [{ id: 'tv', label: 'TV installation — scope requires review', shareBps: 5000, jobMinutes: 120, ownership: 'customer_owned',
      price: { kind: 'unknown', amountCents: null }, materialsCents: null },
    { id: 'eufy', label: 'eufy installation — exact SKU requires review', shareBps: 5000, jobMinutes: 180, ownership: 'supplied',
      price: { kind: 'unknown', amountCents: null }, materialsCents: null }],
    sensitivities: { downside: { demandBps: 8000, cplBps: 12500, completionBps: 8000 },
      best: { demandBps: 12000, cplBps: 8000, completionBps: 10000 } },
  }] };
}
const fail = (path: string): never => { throw new BusinessError(`Invalid forecast field: ${path}.`); };
function object(value: unknown, keys: string[], path: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) return fail(path);
  return value as Record<string, any>;
}
function string(value: unknown, max: number, path: string, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) return fail(path);
  return value;
}
function integer(value: unknown, max: number, path: string, nullable = false, min = 0): number | null {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) return fail(path);
  return value as number;
}
function services(value: unknown, path: string): ForecastService[] {
  if (!Array.isArray(value) || !value.length || value.length > 12) return fail(path);
  const rows = value.map((v, index) => {
    const p = `${path}.${index}`, r = object(v, ['id','label','shareBps','jobMinutes','ownership','equipmentSku','price','materialsCents'], p);
    string(r.id, 80, p + '.id'); string(r.label, 200, p + '.label');
    integer(r.shareBps, 10000, p + '.shareBps'); integer(r.jobMinutes, 2880, p + '.jobMinutes', false, 1);
    if (!['customer_owned','supplied'].includes(r.ownership)) fail(p + '.ownership');
    if (r.equipmentSku !== undefined) string(r.equipmentSku, 200, p + '.equipmentSku');
    integer(r.materialsCents, 100000000, p + '.materialsCents', true);
    const price = object(r.price, ['kind','amountCents','catalogId','serviceId','offerId'], p + '.price');
    if (!['approved','hypothetical','unknown'].includes(price.kind)) fail(p + '.price.kind');
    integer(price.amountCents, 100000000, p + '.price.amountCents', true);
    if (price.kind === 'unknown' && price.amountCents !== null) fail(p + '.price.amountCents');
    for (const key of ['catalogId','serviceId','offerId']) if (price[key] !== undefined) string(price[key], 100, p + '.' + key);
    if (price.kind === 'approved' && (!price.catalogId || !price.serviceId || !price.offerId)) fail(p + '.price.identifiers');
    return r as ForecastService;
  });
  if (rows.reduce((sum, r) => sum + r.shareBps, 0) !== 10000 || new Set(rows.map(r => r.id)).size !== rows.length) fail(path + '.mix');
  return rows;
}
export function validateForecastScenario(value: unknown): ForecastScenario {
  const s = object(value, ['version','markets'], 'scenario');
  if (s.version !== 1 || !Array.isArray(s.markets) || !s.markets.length || s.markets.length > 6) fail('scenario');
  const template = defaultForecastScenario().markets[0];
  for (const [index, raw] of s.markets.entries()) {
    const path = `markets.${index}`, m = object(raw, [...Object.keys(template), 'baselineServices'], path);
    string(m.id, 80, path + '.id'); string(m.label, 120, path + '.label');
    const g = object(m.geography, ['place','state'], path + '.geography');
    string(g.place, 100, path + '.geography.place', true); string(g.state, 80, path + '.geography.state', true);
    const c = object(m.context, Object.keys(template.context), path + '.context');
    for (const k of Object.keys(template.context)) string(c[k], 1000, path + '.context.' + k, true);
    for (const k of ['reps','technicians']) integer(m[k], 1000, path + '.' + k);
    integer(m.repTenureDays, 36500, path + '.repTenureDays', true, 1);
    integer(m.workDays, 31, path + '.workDays', false, 1); integer(m.hoursPerDay, 24, path + '.hoursPerDay', false, 1);
    integer(m.repLeadsPerDay, 1000, path + '.repLeadsPerDay'); integer(m.organicLeads, 1000000, path + '.organicLeads');
    integer(m.travelMinutesPerJob, 1440, path + '.travelMinutesPerJob', true);
    for (const k of ['productiveBps','bookingBps','cancellationBps','completionBps','depositCollectedBps','balanceCollectedBps']) integer(m[k], 10000, path + '.' + k);
    for (const k of ['adBudgetCents','cplCents','processingFixedCents','techHourlyCents','techPerJobCents','overheadCents'])
      integer(m[k], 100000000, path + '.' + k, k !== 'adBudgetCents', k === 'cplCents' ? 1 : 0);
    integer(m.processingBps, 10000, path + '.processingBps', true);
    services(m.services, path + '.services'); if (m.baselineServices !== undefined) services(m.baselineServices, path + '.baselineServices');
    const sensitivity = object(m.sensitivities, ['downside','best'], path + '.sensitivities');
    for (const name of ['downside','best']) {
      const r = object(sensitivity[name], ['demandBps','cplBps','completionBps'], path + '.' + name);
      for (const k of ['demandBps','cplBps','completionBps']) integer(r[k], k === 'completionBps' ? 10000 : 30000, path + '.' + name + '.' + k, false, k === 'cplBps' ? 1 : 0);
      if (name === 'downside' && (r.demandBps > 10000 || r.cplBps < 10000 || r.completionBps > m.completionBps)) fail(path + '.downside.order');
      if (name === 'best' && (r.demandBps < 10000 || r.cplBps > 10000 || r.completionBps < m.completionBps)) fail(path + '.best.order');
    }
  }
  if (new Set(s.markets.map((m: ForecastMarket) => m.id)).size !== s.markets.length) fail('markets.ids');
  return JSON.parse(JSON.stringify(s)) as ForecastScenario;
}

export function hydrateForecastPrices(scenario: ForecastScenario, catalog: ForecastCatalogPrice[]): ForecastScenario {
  const result = validateForecastScenario(scenario);
  for (const market of result.markets) for (const rows of [market.services, market.baselineServices || []]) for (const row of rows) {
    if (row.price.kind !== 'approved') continue;
    const matches = catalog.filter(p => p.catalogId === row.price.catalogId && p.serviceId === row.price.serviceId && p.offerId === row.price.offerId
      && p.markets.includes(market.context.property) && !p.starting && !p.qualified
      && (row.ownership !== 'supplied' || (!!row.equipmentSku && p.equipment.some(sku => sku.trim().toLowerCase() === row.equipmentSku!.trim().toLowerCase()))));
    row.price.amountCents = matches.length === 1 ? matches[0].amountCents : null;
  }
  return result;
}

function safe(value: number): number {
  if (!Number.isSafeInteger(value)) throw new BusinessError('Forecast exceeds safe integer bounds.');
  return value;
}
const cents = (value: number) => safe(Math.round(value));
const sum = (values: (number | null)[]) => values.some(v => v === null) ? null : safe((values as number[]).reduce((a,b) => a+b, 0));
const multiply = (a: number | null, b: number) => a === null ? null : cents(a * b);
function ratio(value: number | null, numerator: number, denominator: number): number | null {
  if (value === null) return null;
  const n = BigInt(safe(value))*BigInt(safe(numerator)), d = BigInt(safe(denominator));
  let q = n/d;
  const remainder = n%d;
  if (remainder*BigInt(2) >= d) q++;
  if (-remainder*BigInt(2) > d) q--;
  return safe(Number(q));
}
function allocate(total: number, rows: ForecastService[]): number[] {
  const counts = rows.map(r => Math.floor(total * r.shareBps / 10000));
  const order = rows.map((r,i) => ({ i, remainder: total * r.shareBps % 10000 })).sort((a,b) => b.remainder-a.remainder || a.i-b.i);
  for (let n = 0; n < total - counts.reduce((a,b) => a+b,0); n++) counts[order[n].i]++;
  return counts;
}
export function calculateForecastCase(m: ForecastMarket, rows: ForecastService[], sensitivity: ForecastSensitivity) {
  const effectiveCpl = m.cplCents === null ? null : Math.max(1, ratio(m.cplCents,sensitivity.cplBps,10000)!);
  const paidLeads = m.adBudgetCents === 0 ? 0 : effectiveCpl === null ? null : Math.floor(m.adBudgetCents / effectiveCpl);
  const repLeads = m.reps * m.workDays * m.repLeadsPerDay;
  const leads = sum([paidLeads, repLeads, m.organicLeads]);
  const bookings = leads === null ? null : Math.floor(leads * sensitivity.demandBps / 10000 * m.bookingBps / 10000);
  const cancellations = bookings === null ? null : Math.floor(bookings * m.cancellationBps / 10000);
  const active = bookings === null ? null : bookings - cancellations!;
  const weightedMinutes = rows.reduce((v,r) => v + r.jobMinutes*r.shareBps/10000,0);
  const capacityHours = m.technicians * m.workDays * m.hoursPerDay * m.productiveBps/10000;
  const capacityJobs = m.travelMinutesPerJob === null ? null : Math.floor(capacityHours * 60/(weightedMinutes + m.travelMinutesPerJob));
  const eligible = active === null ? null : Math.floor(active * sensitivity.completionBps/10000);
  let completed = eligible === null || capacityJobs === null ? null : Math.min(eligible, capacityJobs);
  // Whole-job mix allocations must fit actual service minutes, not merely weighted averages.
  if (completed !== null) while (completed > 0 && allocate(completed,rows).reduce((v,n,i) => v+n*(rows[i].jobMinutes+m.travelMinutesPerJob!),0) > capacityHours*60) completed--;
  const bookedCounts = active === null ? null : allocate(active, rows), completedCounts = completed === null ? null : allocate(completed, rows);
  const total = (counts: number[] | null, amount: (r: ForecastService) => number | null) =>
    counts === null ? null : sum(counts.map((n,i) => n === 0 ? 0 : multiply(amount(rows[i]), n)));
  const bookedRevenueCents = total(bookedCounts, r => r.price.amountCents);
  const completedRevenueCents = total(completedCounts, r => r.price.amountCents);
  const bookedDepositCents = total(bookedCounts, r => r.price.amountCents === null ? null : Math.ceil(r.price.amountCents/4));
  const completedDepositCents = total(completedCounts, r => r.price.amountCents === null ? null : Math.ceil(r.price.amountCents/4));
  const completedBalanceCents = completedRevenueCents === null || completedDepositCents === null ? null : completedRevenueCents-completedDepositCents;
  const depositsCollectedCents = ratio(bookedDepositCents,m.depositCollectedBps,10000);
  const balanceCollectionsCents = ratio(completedBalanceCents,m.balanceCollectedBps,10000);
  const cashCollectedCents = sum([depositsCollectedCents,balanceCollectionsCents]);
  const materialsCents = total(completedCounts,r => r.materialsCents);
  const feesPerJob = (r: ForecastService) => r.price.amountCents === null || m.processingBps === null || m.processingFixedCents === null ? null :
    ratio(Math.ceil(r.price.amountCents/4),m.processingBps,10000)! + ratio(r.price.amountCents-Math.ceil(r.price.amountCents/4),m.processingBps,10000)! + 2*m.processingFixedCents;
  const processingCents = total(completedCounts,feesPerJob);
  const repRateBps = m.repTenureDays === null ? null : m.repTenureDays <= 30 ? 5500 : m.repTenureDays <= 60 ? 5000 : 4500;
  const commissionBasisCents = completedRevenueCents === null || materialsCents === null || processingCents === null ? null :
    completedRevenueCents-materialsCents-processingCents;
  const representativeCommissionCents = commissionBasisCents === null || commissionBasisCents < 0 || repRateBps === null ? null : ratio(commissionBasisCents,repRateBps,10000);
  const techMinutes = completedCounts === null || m.travelMinutesPerJob === null ? null :
    completedCounts.reduce((v,n,i) => v+n*(rows[i].jobMinutes+m.travelMinutesPerJob!),0);
  const technicianCompensationCents = techMinutes === null || m.techHourlyCents === null || m.techPerJobCents === null ? null :
    safe(ratio(techMinutes,m.techHourlyCents,60)! + multiply(m.techPerJobCents,completed!)!);
  const grossContributionCents = commissionBasisCents === null || representativeCommissionCents === null || technicianCompensationCents === null ? null :
    commissionBasisCents-representativeCommissionCents-technicianCompensationCents;
  const operatingProfitCents = grossContributionCents === null || m.overheadCents === null ? null : grossContributionCents-m.adBudgetCents-m.overheadCents;
  const metrics = { paidLeads, repLeads, organicLeads: m.organicLeads, totalLeads: leads, bookings, cancellations, activeBookings: active,
    capacityJobs, capacityHours, completedJobs: completed, bookedRevenueCents, completedRevenueCents, bookedDepositCents,
    completedDepositCents, completedBalanceCents, depositsCollectedCents, balanceCollectionsCents, cashCollectedCents,
    materialsCents, processingCents, commissionBasisCents, repRateBps, representativeCommissionCents, technicianCompensationCents,
    grossContributionCents, adSpendCents:m.adBudgetCents, overheadCents:m.overheadCents, operatingProfitCents,
    cplCents: effectiveCpl, cacCents: completed ? ratio(m.adBudgetCents,1,completed) : null,
    breakEvenCacCents: completed && grossContributionCents !== null && m.overheadCents !== null ? ratio(grossContributionCents-m.overheadCents,1,completed) : null };
  for (const [key,value] of Object.entries(metrics)) if (value !== null && (!Number.isFinite(value)
    || (key.endsWith('Cents') && !Number.isSafeInteger(value)))) throw new BusinessError('Forecast exceeds safe numeric bounds.');
  return metrics;
}

export function compareForecast(scenario: ForecastScenario, research: Record<string, ForecastResearch> = {}): ForecastComparison[] {
  return scenario.markets.flatMap(m => {
    const facts = research[m.id] || { facts: [], missing: ['Public market research is unavailable.'] };
    const contexts: { name: ForecastComparison['pricingContext']; rows: ForecastService[] }[] = [{name:'market_proposal',rows:m.services}];
    if (m.baselineServices) contexts.unshift({name:'existing_baseline',rows:m.baselineServices});
    return contexts.map(context => {
      const missing = [...facts.missing];
      for (const key of ['repTenureDays','travelMinutesPerJob','cplCents','processingBps','processingFixedCents','techHourlyCents','techPerJobCents','overheadCents'] as const)
        if (m[key] === null) missing.push(`${key} is unknown.`);
      for (const row of context.rows) {
        if (row.price.amountCents === null) missing.push(`${row.label}: exact reviewed price unavailable.`);
        if (row.materialsCents === null) missing.push(`${row.label}: complete ${row.ownership === 'supplied' ? 'supplied BOM' : 'customer-owned consumables'} cost unknown.`);
      }
      const cases: ForecastComparison['cases'] = [{name:'downside',metrics:calculateForecastCase(m,context.rows,m.sensitivities.downside)},
        {name:'base',metrics:calculateForecastCase(m,context.rows,{demandBps:10000,cplBps:10000,completionBps:m.completionBps})},
        {name:'best',metrics:calculateForecastCase(m,context.rows,m.sensitivities.best)}];
      const base = cases[1].metrics;
      const recommendations = ['Sensitivity cases are explicit hypothetical ranges, not statistical confidence intervals.',
        'Use deduplicated paid, representative and organic leads; public household facts do not establish CPL or conversion.',
        'CPL is paid spend per acquired paid lead. CAC is blended ad spend per completed job across all channels; break-even CAC is contribution less monthly overhead per completed job, before ads.',
        'Cash assumes deposits on uncancelled bookings and balances on completed jobs in this month at the entered collection rates; no prior-month cash or cancellation refunds are inferred.',
        'Processing expense accrues two transactions per completed job; cash timing is distinct from accrued expense. Representative tenure policy is a projection, not payroll approval.',
        'Representative commission projects every completed job as representative-credited; it does not infer actual attribution from lead channel.',
        'Downside/best name demand assumptions, not guaranteed profit rankings; extra unprofitable jobs can reduce profit.'];
      for (const key of ['completedJobs','completedRevenueCents'] as const) {
        const values = cases.map(c => c.metrics[key]);
        if (values.every(v => v !== null) && (values[0]! > values[1]! || values[1]! > values[2]!)) {
          missing.push(`Sensitivity ${key} is non-monotonic due to whole-job service allocation; do not treat these as ordered financial bounds.`);
          recommendations.push('Review the explicit service mix: whole-job rounding prevents a reliable ordered sensitivity bound.');
        }
      }
      if (base.completedJobs !== null && base.activeBookings !== null && base.completedJobs < base.activeBookings) recommendations.push('Demand exceeds completed throughput: review technician hours, travel and completion timing before increasing advertising.');
      if (base.operatingProfitCents === null) recommendations.push('Complete all required costs, exact service prices and representative tenure before relying on profit or break-even CAC.');
      return { market:m.label,marketId:m.id,pricingContext:context.name,confidence: missing.length || facts.facts.some(f => f.stale) ? 'limited' : 'assumption_based',
        missing,recommendations,advisory:recommendations.map(text => ({author:'rules' as const,text})),evidence:facts.facts,cases,
        audit:[...Object.keys(m).filter(k => !['services','baselineServices'].includes(k)).map(path => ({path,provenance:'hypothetical' as const,detail:'Management scenario assumption; not verified local performance.'})),
          ...context.rows.flatMap(row => [{path:`services.${row.id}.price`,provenance:row.price.amountCents === null ? 'unknown' as const : row.price.kind,
            detail:row.price.kind === 'approved' ? `Server rehydrated exact published catalog IDs: ${row.price.catalogId}/${row.price.serviceId}/${row.price.offerId}; forecast only.` : 'Separate hypothetical comparison; no publication or payable quote.'},
          {path:`services.${row.id}.materialsCents`,provenance:row.materialsCents === null ? 'unknown' as const : 'hypothetical' as const,detail:'Management complete BOM/material allowance, not verified procurement.'}])] };
    });
  });
}
