import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';
import { admin, BusinessError, checked, identifier, readJson, text } from '@/lib/commercial_business';
import { residentialWorkspaceSetup, readResidentialWorkspace } from '@/lib/residential_workspace';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
async function handle(request: Request, write: boolean) {
  const headers = { ...corsHeaders(request), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  try {
    const actor = await admin(request);
    await residentialWorkspaceSetup();
    const body = write ? await readJson(request, 4096) : null;
    const token = text(body ? body.token : new URL(request.url).searchParams.get('token'), 120);
    if (write && body) {
      if (!Number.isSafeInteger(body.revision) || Number(body.revision) < 0
        || !['schedule_callback','complete_callback','cancel_callback'].includes(String(body.action))) {
        throw new BusinessError('Valid callback revision and action required.');
      }
      const dueAt = body.action === 'schedule_callback' ? text(body.dueAt, 50) : null;
      if (dueAt && (!/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(dueAt) || !Number.isFinite(Date.parse(dueAt)))) {
        throw new BusinessError('Use a callback time with a time zone.');
      }
      checked(await getSupabase().rpc('h2s_record_residential_callback', {
        p_token: token, p_revision: body.revision, p_operation_id: identifier(body.operationId), p_actor: actor,
        p_action: body.action, p_due_at: dueAt, p_note: text(body.note, 1000),
      }));
    }
    return NextResponse.json({ ok: true, workspace: await readResidentialWorkspace(token) }, { headers });
  } catch (error) {
    if (!(error instanceof BusinessError)) console.error('Residential workspace request failed', error);
    return NextResponse.json({ ok: false, error: error instanceof BusinessError ? error.message : 'Workspace is unavailable. Reload before retrying.' },
      { status: error instanceof BusinessError ? error.status : 503, headers });
  }
}
export function GET(request: Request) { return handle(request, false); }
export function POST(request: Request) { return handle(request, true); }
export function OPTIONS(request: Request) { return new NextResponse(null, { status: 204, headers: corsHeaders(request) }); }
