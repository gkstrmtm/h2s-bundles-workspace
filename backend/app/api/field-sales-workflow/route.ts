import { corsHeaders } from '@/lib/adminAuth';
import { salesActor, identifier, readJson, BusinessError } from '@/lib/fieldSales';
import { workflowActor, workflowEnabled, workflowRead, workflowCommand, InstallationHoldError } from '@/lib/fieldWorkflow';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = (request: Request) => ({ ...corsHeaders(request), 'Cache-Control': 'private, no-store', Vary: 'Authorization, Origin' });
function failure(request: Request, error: unknown) {
  console.error('Field workflow request failed', { type: error instanceof Error ? error.name : 'Unknown' });
  return Response.json({ ok: false, error: error instanceof BusinessError ? error.message : 'Workflow schema or authority unavailable. No lifecycle success is implied.',
    ...(error instanceof InstallationHoldError ? { code: error.code, earliestSchedulingAt: error.earliestSchedulingAt } : {}) },
    { status: error instanceof BusinessError ? error.status : 503, headers: headers(request) });
}
export async function OPTIONS(request: Request) { return Response.json({}, { headers: headers(request) }); }
export async function GET(request: Request) {
  try {
    await salesActor(request);
    if (!workflowEnabled()) return Response.json({ ok: true, enabled: false }, { headers: headers(request) });
    const actor = await workflowActor(request), query = new URL(request.url).searchParams;
    for (const key of query.keys()) if (!['lead_id', 'quote_id'].includes(key) || query.getAll(key).length !== 1) throw new BusinessError('Unsupported workflow parameter.');
    const result = await workflowRead(actor.userId, query.has('lead_id') ? identifier(query.get('lead_id')) : null,
      query.has('quote_id') ? identifier(query.get('quote_id')) : null);
    return Response.json({ ok: true, enabled: true, ...result }, { headers: headers(request) });
  } catch (error) { return failure(request, error); }
}
export async function POST(request: Request) {
  try {
    const actor = await workflowActor(request);
    return Response.json({ ok: true, ...await workflowCommand(actor, await readJson(request)) }, { headers: headers(request) });
  } catch (error) { return failure(request, error); }
}
