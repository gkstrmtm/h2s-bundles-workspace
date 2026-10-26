import { NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/adminAuth';
import { admin, BusinessError, checked, readJson } from '@/lib/commercial_business';
import { getSupabase } from '@/lib/supabase';
import { normalizeRoutingPhone, readOwnerRouting, routingSummary } from '@/lib/notification_routing';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
async function handle(request: Request, write: boolean) {
  const headers = { ...corsHeaders(request), 'Cache-Control': 'no-store' };
  try {
    const actor = await admin(request);
    if (!write) return NextResponse.json({ ok: true, routing: routingSummary(await readOwnerRouting()) }, { headers });
    const body = await readJson(request, 2048);
    const phone = normalizeRoutingPhone(body.phone);
    if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0 || body.acknowledgeRecipientChange !== true) {
      throw new BusinessError('Review the saved routing and acknowledge that existing links and reminders are not reassigned.');
    }
    const current = await readOwnerRouting();
    const saved = checked(await getSupabase().rpc('h2s_save_notification_routing', {
      p_phone: phone, p_revision: body.revision, p_actor: actor,
      p_fallback_phone: current.source === 'environment' ? current.phone : null,
    }));
    return NextResponse.json({ ok: true, owner: saved, verified: false }, { headers });
  } catch (error) {
    if (!(error instanceof BusinessError)) console.error('Notification routing request failed', error);
    return NextResponse.json({ ok: false, error: error instanceof BusinessError ? error.message : 'Notification routing is unavailable. Reload saved routing before retrying.' },
      { status: error instanceof BusinessError ? error.status : 503, headers });
  }
}
export function GET(request: Request) { return handle(request, false); }
export function POST(request: Request) { return handle(request, true); }
export function OPTIONS(request: Request) { return new NextResponse(null, { status: 204, headers: corsHeaders(request) }); }
