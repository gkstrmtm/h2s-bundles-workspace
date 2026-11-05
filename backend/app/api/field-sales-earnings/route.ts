import { corsHeaders } from '@/lib/adminAuth';
import { earningsActor, earningsRead, earningsCommand, BusinessError, identifier, readJson } from '@/lib/fieldEarnings';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = (request: Request) => ({ ...corsHeaders(request), 'Cache-Control': 'private, no-store', Vary: 'Authorization, Origin' });
function failure(request: Request, error: unknown) {
  return Response.json({ ok: false, error: error instanceof BusinessError ? error.message : 'Earnings evidence unavailable; no payment success is implied.' },
    { status: error instanceof BusinessError ? error.status : 503, headers: headers(request) });
}
export async function OPTIONS(request: Request) { return Response.json({}, { headers: headers(request) }); }
export async function GET(request: Request) {
  try {
    const actor = await earningsActor(request), query = new URL(request.url).searchParams;
    for (const key of query.keys()) if (!['representativeId', 'quoteId'].includes(key) || query.getAll(key).length !== 1) throw new BusinessError('Unsupported earnings parameter.');
    const result = await earningsRead(actor.userId, query.has('representativeId') ? identifier(query.get('representativeId')) : null, query.has('quoteId') ? identifier(query.get('quoteId')) : null);
    return Response.json({ ok: true, enabled: true, externalPaymentInitiated: false, ...result }, { headers: headers(request) });
  } catch (error) { return failure(request, error); }
}
export async function POST(request: Request) {
  try { return Response.json({ ok: true, externalPaymentInitiated: false, ...await earningsCommand(await earningsActor(request), await readJson(request)) }, { headers: headers(request) }); }
  catch (error) { return failure(request, error); }
}
