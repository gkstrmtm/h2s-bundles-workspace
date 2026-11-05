import { corsHeaders } from '@/lib/adminAuth';
import { salesActor, salesAccess, salesChecked, BusinessError, readJson } from '@/lib/fieldSales';
import { getSupabase } from '@/lib/supabase';
import { validateQuoteCatalog, QuoteCatalog } from '@/lib/fieldQuote';
import { defaultForecastScenario, ForecastCatalogPrice } from '@/lib/forecast';
import { ForecastCapabilities, executeForecast } from '@/lib/forecastService';
import { createCensusForecastProvider } from '@/lib/forecastResearch';
import { createOpenAiForecastProvider } from '@/lib/forecastProviders';

export const dynamic = 'force-dynamic';
const headers = (request: Request) => ({...corsHeaders(request),'Cache-Control':'private, no-store',Vary:'Authorization, Origin'});
// One process-local research provider retains bounded TTL and in-flight caches across requests.
let census: ReturnType<typeof createCensusForecastProvider> | undefined;
async function actorFor(request: Request) {
  const actor = await salesActor(request);
  if (actor.role !== 'ADMIN') throw new BusinessError('Administrator required for Forecast.',403);
  return actor;
}
async function context(actorId: string) {
  const aiEnabled = process.env.H2S_FORECAST_AI_ENABLED === 'true' && !!process.env.OPENAI_API_KEY;
  const researchEnabled = process.env.H2S_FORECAST_RESEARCH_ENABLED !== 'false';
  const researchConfigured = researchEnabled && !!process.env.CENSUS_API_KEY?.trim();
  const capabilities: ForecastCapabilities = {
    ai:{available:aiEnabled,reason:aiEnabled ? 'Conversational OpenAI enabled; advisory only.' : 'AI unavailable: explicit Forecast AI gate and existing key required. Manual Calculate remains available.'},
    research:{available:researchConfigured,reason:!researchEnabled ? 'Public research explicitly disabled; no geographic assumptions substituted.' :
      researchConfigured ? 'Official Census ACS connector enabled with a configured server key; source availability is verified per request. Wages, competition, tax and advertising providers are not connected.' :
      'Census key required: connector enabled but CENSUS_API_KEY is not configured. Public facts are unavailable; labeled management assumptions remain editable.'},
    catalog:{available:false,reason:'Published catalog read is disabled or unavailable. Prices remain unknown unless explicitly hypothetical.'},
  };
  const catalog: ForecastCatalogPrice[] = [];
  if (process.env.H2S_FIELD_CATALOG_ADMIN_ENABLED === 'true' && process.env.H2S_FIELD_SALES_ENABLED === 'true') {
    await salesAccess(actorId);
    const records = salesChecked<{catalogs: (QuoteCatalog & {approved_by?:string|null;published_at?:string|null})[];total:number} | null>(
      await getSupabase().rpc('field_sales_catalog_admin_read',{p_actor:actorId,p_catalog:null}));
    if (!records || !Array.isArray(records.catalogs) || records.catalogs.length > 100) throw new BusinessError('Authorized catalog summary unavailable.',503);
    for (const row of records.catalogs) {
      if (row.status !== 'published' || !row.approved_by || !row.published_at || !Number.isFinite(Date.parse(row.published_at))
        || !/^[a-f0-9]{64}$/.test(row.digest)) continue;
      validateQuoteCatalog(row);
      for (const service of row.definition.services) for (const offer of service.offers) if (offer.enabled) {
        catalog.push({catalogId:row.catalog_id,version:row.version,digest:row.digest,serviceId:service.id,offerId:offer.id,
          label:`${service.label}: ${offer.label}`,amountCents:offer.unitCents,markets:service.markets,equipment:offer.equipment,
          starting:offer.starting,qualified:offer.minimum !== 1 || offer.qualifications.length > 0 || offer.questions.some(q => q.required)});
      }
    }
    capabilities.catalog = {available:catalog.length > 0,reason:catalog.length ? 'Read-only authorized published catalog; exact eligible IDs only. Starting/qualified offers remain unknown.' : 'No authorized published offers available.'};
  }
  return {capabilities,catalog};
}
function failure(request: Request, error: unknown) {
  return Response.json({ok:false,error:error instanceof BusinessError ? error.message : 'Forecast service unavailable. No business records were changed.'},
    {status:error instanceof BusinessError ? error.status : 503,headers:headers(request)});
}
export async function OPTIONS(request: Request) { return Response.json({}, {headers:headers(request)}); }
export async function GET(request: Request) {
  try {
    const actor = await actorFor(request);
    if ([...new URL(request.url).searchParams.keys()].length) throw new BusinessError('Unsupported forecast query.');
    const result = await context(actor.userId);
    return Response.json({ok:true,...result,scenario:defaultForecastScenario()},{headers:headers(request)});
  } catch (error) { return failure(request,error); }
}
export async function POST(request: Request) {
  try {
    const actor = await actorFor(request), body = await readJson(request,65536);
    const result = await context(actor.userId);
    if (result.capabilities.research.available && !census) census = createCensusForecastProvider({enabled:true,apiKey:process.env.CENSUS_API_KEY});
    const output = await executeForecast(body,{...result,research:result.capabilities.research.available ? census : undefined,
      ai:body.action === 'interpret' ? createOpenAiForecastProvider() : undefined});
    return Response.json(output,{headers:headers(request)});
  } catch (error) { return failure(request,error); }
}
