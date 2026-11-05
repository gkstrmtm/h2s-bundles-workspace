import { getSupabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';
import { salesActor, salesAccess, salesChecked, BusinessError, identifier, readJson, text } from '@/lib/fieldSales';
import { QuoteCatalog, validateQuoteCatalog } from '@/lib/fieldQuote';
export const dynamic = 'force-dynamic';
type CatalogRow = Omit<QuoteCatalog, 'digest'> & { digest: string; source_evidence: Record<string, unknown>;
  approved_by: string | null; published_at: string | null };
type CatalogRecords = { catalogs: CatalogRow[]; total: number };
const headers = (request: Request) => ({ ...corsHeaders(request), 'Cache-Control': 'private, no-store', Vary: 'Authorization, Origin' });
const enabled = () => process.env.H2S_FIELD_CATALOG_ADMIN_ENABLED === 'true';
async function actorFor(request: Request) {
  const actor = await salesActor(request);
  if (actor.role !== 'ADMIN') throw new BusinessError('Administrator required for catalog configuration.', 403);
  return actor;
}
async function catalogRecords(actorId: string, catalogId: string | null) {
  const result = salesChecked<CatalogRecords | null>(await getSupabase().rpc('field_sales_catalog_admin_read', {
    p_actor: actorId, p_catalog: catalogId,
  }));
  if (!result || !Array.isArray(result.catalogs) || !Number.isSafeInteger(result.total) || result.total < 0) {
    throw new BusinessError('Catalog administration returned invalid or incomplete records.', 503);
  }
  return result;
}
function failure(request: Request, error: unknown) {
  console.error('Field catalog administration failed', { type: error instanceof Error ? error.name : 'Unknown' });
  return Response.json({ ok: false, error: error instanceof BusinessError ? error.message : 'Catalog storage is unavailable. No publication is implied.' },
    { status: error instanceof BusinessError ? error.status : 503, headers: headers(request) });
}
export async function OPTIONS(request: Request) { return Response.json({}, { headers: headers(request) }); }
export async function GET(request: Request) {
  try {
    const actor = await actorFor(request);
    if (!enabled()) return Response.json({ ok: true, enabled: false, catalogs: [] }, { headers: headers(request) });
    await salesAccess(actor.userId);
    const query = new URL(request.url).searchParams;
    for (const key of query.keys()) if (key !== 'catalogId' || query.getAll(key).length !== 1) throw new BusinessError('Unsupported catalog parameter.');
    const records = await catalogRecords(actor.userId, query.has('catalogId') ? identifier(query.get('catalogId')) : null);
    return Response.json({ ok: true, enabled: true, ...records }, { headers: headers(request) });
  } catch (error) { return failure(request, error); }
}
export async function POST(request: Request) {
  try {
    const actor = await actorFor(request);
    if (!enabled()) throw new BusinessError('Catalog administration is disabled. No price was published.', 503);
    await salesAccess(actor.userId);
    const body = await readJson(request), action = text(body.action, 30), operationId = identifier(body.operationId);
    const catalogId = identifier(body.catalogId);
    let payload: Record<string, unknown>;
    if (action === 'create_draft') {
      if (!body.definition || typeof body.definition !== 'object' || Array.isArray(body.definition)
        || !body.sourceEvidence || typeof body.sourceEvidence !== 'object' || Array.isArray(body.sourceEvidence)) {
        throw new BusinessError('Draft definition and source evidence must be JSON objects.');
      }
      const version = text(body.version, 120);
      const candidate: QuoteCatalog = { catalog_id: catalogId, version, status: 'draft', digest: '',
        definition: body.definition as QuoteCatalog['definition'] };
      validateQuoteCatalog(candidate);
      payload = { catalogId, version, definition: candidate.definition, sourceEvidence: body.sourceEvidence };
    } else if (action === 'publish' || action === 'retire') {
      const expectedDigest = text(body.expectedDigest, 64);
      if (!/^[a-f0-9]{64}$/.test(expectedDigest)) throw new BusinessError('Current catalog digest required.');
      const record = (await catalogRecords(actor.userId, catalogId)).catalogs[0];
      if (!record) throw new BusinessError('Catalog version not found.', 404);
      if (action === 'publish') {
        validateQuoteCatalog({ ...record, status: 'published' });
        if (record.definition.services.some(service => !service.markets.length)) throw new BusinessError('Approve explicit service markets before publication.');
        const approvalEvidence = text(body.approvalEvidence, 2000);
        if (approvalEvidence.length < 3) throw new BusinessError('Management publication evidence required.');
        payload = { catalogId, expectedDigest, approvalEvidence };
      } else payload = { catalogId, expectedDigest };
    } else throw new BusinessError('Unsupported catalog action.');
    const result = salesChecked(await getSupabase().rpc('field_sales_catalog_admin_command', {
      p_actor: actor.userId, p_operation: operationId, p_action: action, p_payload: payload,
    }));
    return Response.json({ ok: true, ...result }, { headers: headers(request) });
  } catch (error) { return failure(request, error); }
}
