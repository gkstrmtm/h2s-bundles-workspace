import { corsHeaders } from '@/lib/adminAuth';
import { salesActor, commerceActor, transactionEnabled, transactionRead, command, identifier, readJson, BusinessError } from '@/lib/fieldCommerce';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = (request: Request) => ({ ...corsHeaders(request), 'Cache-Control': 'private, no-store', Vary: 'Authorization, Origin' });
function failure(request: Request, error: unknown) {
  console.error('Field transaction request failed', { type: error instanceof Error ? error.name : 'Unknown' });
  return Response.json({ ok: false, error: error instanceof BusinessError ? error.message : 'Transaction setup/provider unavailable. No payment success is implied.' },
    { status: error instanceof BusinessError ? error.status : 503, headers: headers(request) });
}
export async function OPTIONS(request: Request) { return Response.json({}, { headers: headers(request) }); }
export async function GET(request: Request) {
  try {
    await salesActor(request);
    if (!transactionEnabled()) return Response.json({ ok: true, enabled: false }, { headers: headers(request) });
    const actor = await commerceActor(request), query = new URL(request.url).searchParams;
    for (const key of query.keys()) if (key !== 'leadId' || query.getAll(key).length !== 1) throw new BusinessError('Unsupported transaction parameter.');
    const result = await transactionRead(actor.userId, query.has('leadId') ? identifier(query.get('leadId')) : null);
    return Response.json({ ok: true, enabled: true, mode: 'test_only', ...result }, { headers: headers(request) });
  } catch (error) { return failure(request, error); }
}
export async function POST(request: Request) {
  try { const actor = await commerceActor(request); return Response.json({ ok: true, ...await command(actor, await readJson(request)) }, { headers: headers(request) }); }
  catch (error) { return failure(request, error); }
}
