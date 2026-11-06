import { BusinessError } from '@/lib/commercial_business';
import { ForecastScenario, ForecastMarket, ForecastCatalogPrice, ForecastResearch, ForecastComparison,
  defaultForecastScenario, validateForecastScenario, hydrateForecastPrices, compareForecast } from '@/lib/forecast';
import { ForecastResearchProvider, FORECAST_UNCONNECTED_SOURCES } from '@/lib/forecastResearch';

export type ForecastCapabilities = { ai: { available: boolean; reason: string }; research: { available: boolean; reason: string };
  catalog: { available: boolean; reason: string } };
export type ForecastAiProvider = {
  interpret(input: { text: string; scenario: unknown; conversation: { role:'user'|'assistant';content:string }[] }): Promise<unknown>;
  advise?(input: { text: string; comparisons: unknown }): Promise<unknown>;
  diagnostics?(): Partial<Record<'interpretation'|'advice', { provider:'openai';model:string;httpStatus:number;requestId:string|null }>>;
};
export type ForecastDependencies = { capabilities: ForecastCapabilities; catalog: ForecastCatalogPrice[];
  research?: ForecastResearchProvider; ai?: ForecastAiProvider };
function invalid(): never { throw new BusinessError('AI returned an invalid or untrusted scenario. No changes were accepted.',502); }
function boundedText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}
function plain(value: unknown): value is Record<string,any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
const ownKeys = (value: Record<string,unknown>, keys: string[]) => Object.keys(value).every(k => keys.includes(k) && !['__proto__','constructor','prototype'].includes(k));
function rejectAuthority(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(rejectAuthority); return; }
  if (!plain(value)) return;
  for (const [k,v] of Object.entries(value)) {
    if (['provenance','sourceUrl','fetchedAt','evidence','approvedBy','catalogId','serviceId','offerId'].includes(k)
      || (k === 'kind' && v === 'approved') || ['__proto__','constructor','prototype'].includes(k)) invalid();
    rejectAuthority(v);
  }
}
function merge(target: any, changes: any): any {
  if (!plain(changes)) return changes;
  const output = {...target};
  for (const [key,value] of Object.entries(changes)) {
    const optionalBaseline = key === 'baselineServices' && Array.isArray(target.services) && typeof target.id === 'string';
    if ((!Object.hasOwn(target,key) && !optionalBaseline) || ['__proto__','constructor','prototype'].includes(key)) invalid();
    output[key] = plain(value) && plain(target[key]) ? merge(target[key],value) : value;
  }
  return output;
}
export function applyForecastAiPatch(previous: ForecastScenario, raw: unknown): ForecastScenario {
  if (!plain(raw) || !ownKeys(raw,['updates','newMarkets']) || !Array.isArray(raw.updates) || raw.updates.length > 20
    || (raw.newMarkets !== undefined && (!Array.isArray(raw.newMarkets) || raw.newMarkets.length > 6))) invalid();
  rejectAuthority(raw);
  const next = JSON.parse(JSON.stringify(previous)) as ForecastScenario;
  const changed = new Set<string>();
  for (const update of raw.updates) {
    if (!plain(update) || !ownKeys(update,['marketId','changes']) || !boundedText(update.marketId,80)
      || !plain(update.changes) || changed.has(update.marketId) || Object.hasOwn(update.changes,'id')) invalid();
    const index = next.markets.findIndex(m => m.id === update.marketId);
    if (index < 0) invalid();
    next.markets[index] = merge(next.markets[index],update.changes);
    changed.add(update.marketId);
  }
  if (raw.newMarkets) next.markets.push(...raw.newMarkets);
  try { return validateForecastScenario(next); } catch { return invalid(); }
}
function aiScenario(scenario: ForecastScenario) {
  return {version:1,markets:scenario.markets.map(m => {
    const sanitize = (rows: ForecastMarket['services']) => rows.map(r => ({...r,price:{kind:r.price.kind === 'approved' ? 'unknown' : r.price.kind,
      amountCents:r.price.kind === 'approved' ? null : r.price.amountCents},approvedSummaryCents:r.price.kind === 'approved' ? r.price.amountCents : null}));
    return {...m,services:sanitize(m.services),...(m.baselineServices ? {baselineServices:sanitize(m.baselineServices)} : {})};
  })};
}
export async function executeForecast(body: Record<string,unknown>, dependencies: ForecastDependencies) {
  if (!ownKeys(body,['action','text','scenario','conversation']) || !['interpret','calculate'].includes(String(body.action))) throw new BusinessError('Unsupported forecast operation.');
  let scenario = body.scenario === undefined ? defaultForecastScenario() : validateForecastScenario(body.scenario);
  const warnings = ['Forecast only. No prices were published, bookings created, payments charged or payroll changed.',
    'All funnel, staffing, sensitivity and collection inputs are explicit hypothetical management assumptions. Missing required money remains unknown.'];
  let conversation: {role:'user'|'assistant';content:string}[] = [];
  if (body.conversation !== undefined) {
    if (!Array.isArray(body.conversation) || body.conversation.length > 12) throw new BusinessError('Conversation is too long.');
    conversation = body.conversation.map(turn => {
      if (!plain(turn) || !ownKeys(turn,['role','content']) || !['user','assistant'].includes(turn.role) || !boundedText(turn.content,2000)) throw new BusinessError('Invalid management conversation.');
      return {role:turn.role,content:turn.content};
    });
  }
  if (body.text !== undefined && !boundedText(body.text,6000)) throw new BusinessError('Enter bounded management scenario text.');
  if (body.action === 'interpret') {
    if (!boundedText(body.text,6000)) throw new BusinessError('Enter a management scenario to interpret.');
    if (!dependencies.capabilities.ai.available || !dependencies.ai) throw new BusinessError('Conversational AI is unavailable. Use the editable assumptions and Calculate; no local parser is substituted.',503);
    // Rehydrate even the bounded numeric AI summary: submitted approved amounts are never trusted.
    scenario = hydrateForecastPrices(scenario,dependencies.catalog);
    let response: unknown;
    try { response = await dependencies.ai.interpret({text:body.text,scenario:aiScenario(scenario),conversation}); }
    catch (error) {
      if (error instanceof BusinessError) throw error;
      console.error('Forecast interpretation failed', {type:error instanceof Error ? error.name : 'UnknownError'});
      throw new BusinessError('Conversational AI is unavailable. Your previous scenario was not changed.',503);
    }
    scenario = applyForecastAiPatch(scenario,response);
    warnings.push('AI interpreted management intent; all returned assumptions require management review. AI does not verify research or approve prices.');
  }
  scenario = hydrateForecastPrices(scenario,dependencies.catalog);
  const research: Record<string,ForecastResearch> = {};
  await Promise.all(scenario.markets.map(async m => {
    let result: ForecastResearch = {facts:[],missing:['Public market research is disabled or not connected.']};
    if (dependencies.capabilities.research.available && dependencies.research) {
      try { result = await dependencies.research.research(m.geography.place,m.geography.state); }
      catch { result = {facts:[],missing:['Public market research unavailable.']}; }
    }
    research[m.id] = { facts:result.facts,missing:[...result.missing,...FORECAST_UNCONNECTED_SOURCES] };
  }));
  const comparisons = compareForecast(scenario,research);
  if (body.action === 'interpret' && dependencies.ai?.advise) {
    try {
      const advice = await dependencies.ai.advise({text:body.text as string,comparisons:comparisons.map(c => ({
        marketId:c.marketId,pricingContext:c.pricingContext,metrics:c.cases[1].metrics,missing:c.missing,evidence:c.evidence,
      }))});
      validateAdvice(advice,comparisons);
    } catch { warnings.push('AI advisory was unavailable or failed grounding checks; deterministic source-aware recommendations remain available.'); }
  }
  return {ok:true as const,scenario,comparisons,capabilities:dependencies.capabilities,warnings,
    aiExecution:dependencies.ai?.diagnostics?.()};
}
function validateAdvice(raw: unknown, comparisons: ForecastComparison[]) {
  // AI selects a bounded grounded advisory template. Financial calculations and prose are server-owned.
  const templates: Record<string,string> = {
    research_gap:'Validate the missing public/local evidence before making a market-entry commitment.',
    capacity:'Review technician capacity and travel assumptions before growing demand.',
    costs:'Obtain complete BOM, processing and compensation inputs before interpreting company profit.',
    experiment:'Run a bounded local acquisition experiment; do not treat public demographic facts as conversion evidence.',
  };
  if (!plain(raw) || !ownKeys(raw,['items']) || !Array.isArray(raw.items) || raw.items.length > 12) invalid();
  const resolved = raw.items.map((row: unknown) => {
    if (!plain(row) || !ownKeys(row,['marketId','reason','metric','observed']) || !templates[row.reason]
      || !boundedText(row.marketId,80) || !boundedText(row.metric,80) || (row.observed !== null && (typeof row.observed !== 'number' || !Number.isFinite(row.observed)))) invalid();
    const matches = comparisons.filter(c => c.marketId === row.marketId && Object.hasOwn(c.cases[1].metrics,row.metric) && c.cases[1].metrics[row.metric] === row.observed);
    if (!matches.length) invalid();
    if (row.reason === 'costs' && (row.metric !== 'operatingProfitCents' || row.observed !== null)) invalid();
    if (row.reason === 'research_gap' && matches.some(c => !c.missing.length)) invalid();
    if (row.reason === 'capacity' && matches.some(c => {
      const m = c.cases[1].metrics;
      return m.completedJobs === null || m.activeBookings === null || m.completedJobs >= m.activeBookings;
    })) invalid();
    return {matches,text:templates[row.reason]};
  });
  for (const {matches,text} of resolved) for (const comparison of matches) comparison.advisory.push({author:'ai',text:`AI-selected grounded advisory: ${text}`});
}
