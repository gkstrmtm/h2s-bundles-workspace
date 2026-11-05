import { getSupabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';
import { requireTransactions, tokenHash, salesChecked, readJson, identifier, text, BusinessError, customerPayment } from '@/lib/fieldCommerce';
export const dynamic = 'force-dynamic';
const headers = (request: Request) => ({ ...corsHeaders(request), 'Cache-Control': 'private, no-store', Vary: 'Authorization, Origin', 'Referrer-Policy': 'no-referrer' });
async function handle(request: Request, accept: boolean) {
  try {
    requireTransactions();
    if (process.env.H2S_FIELD_CUSTOMER_AGREEMENTS_ENABLED !== 'true') throw new BusinessError('Customer agreement activation requires approved legal and delivery configuration.', 503);
    if (new URL(request.url).search) throw new BusinessError('Agreement credentials must not be sent in URL parameters.');
    const token = request.headers.get('authorization')?.replace(/^Bearer /i, '') || '';
    if (!/^[a-f0-9]{64}$/.test(token)) throw new BusinessError('Secure customer agreement link required.', 401);
    let payload: Record<string, unknown> | null = null;
    if (accept) {
      const body = await readJson(request);
      if (body.action === 'checkout' || body.action === 'refresh_payment') {
        const result = await customerPayment(token, body);
        return Response.json({ ok: true, ...result }, { headers: headers(request) });
      }
      if (Object.keys(body).some(key => !['operationId','name','email','quoteHash','policyVersion','accepted','electronicDelivery'].includes(key))) throw new BusinessError('Unsupported agreement field.');
      payload = { operationId: identifier(body.operationId), name: text(body.name, 120), email: text(body.email, 254).toLowerCase(),
        quoteHash: text(body.quoteHash, 64), policyVersion: text(body.policyVersion, 100), accepted: body.accepted === true,
        electronicDelivery: body.electronicDelivery === true, acceptanceMethod: 'approved_customer_handoff' };
    }
    const result = salesChecked(await getSupabase().rpc('field_sales_customer_agreement', { p_token_hash: tokenHash(token), p_accept: payload }));
    return Response.json({ ok: true, ...result }, { headers: headers(request) });
  } catch (error) {
    console.error('Customer agreement request failed', { type: error instanceof Error ? error.name : 'Unknown' });
    return Response.json({ ok: false, error: error instanceof BusinessError ? error.message : 'Agreement unavailable; acceptance is not implied.' },
      { status: error instanceof BusinessError ? error.status : 503, headers: headers(request) });
  }
}
export async function GET(request: Request) { return handle(request, false); }
export async function POST(request: Request) { return handle(request, true); }
export async function OPTIONS(request: Request) { return Response.json({}, { headers: headers(request) }); }
