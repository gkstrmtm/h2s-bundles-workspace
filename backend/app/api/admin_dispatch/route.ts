import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';
import { resolveDispatchSchema } from '@/lib/dispatchSchema';
import { ensureDispatchOfferAssignment } from '@/lib/dispatchOfferAssignment';

async function bestEffortUpdateAssignedTo(sb: any, table: string, idCol: string, jobId: string, proValue: string) {
  const basePatch: any = { updated_at: new Date().toISOString() };

  // Try to set assigned_to if present
  try {
    const patch = { ...basePatch, assigned_to: proValue };
    const { error } = await sb.from(table).update(patch).eq(idCol as any, jobId);
    if (!error) return;
    const msg = String(error.message || '');
    if (!/assigned_to/i.test(msg)) throw error;
  } catch {
    // ignore, continue
  }

  // Try common pro columns on job row
  for (const col of ['assigned_pro_id', 'pro_id', 'tech_id', 'technician_id']) {
    try {
      const patch = { ...basePatch, [col]: proValue };
      const { error } = await sb.from(table).update(patch).eq(idCol as any, jobId);
      if (!error) return;
    } catch {
      // keep trying
    }
  }
}

async function handle(request: Request, body: any) {
  const jobId = String(body?.job_id || '').trim();
  const action = String(body?.action || '').trim().toLowerCase();
  const proId = String(body?.pro_id || '').trim();

  if (!jobId || !action) {
    return NextResponse.json({ ok: false, error: 'job_id and action are required', error_code: 'bad_request' }, { status: 400, headers: corsHeaders(request) });
  }
  if (action !== 'assign') {
    return NextResponse.json({ ok: false, error: 'Unsupported action', error_code: 'bad_request' }, { status: 400, headers: corsHeaders(request) });
  }
  if (!proId) {
    return NextResponse.json({ ok: false, error: 'pro_id is required', error_code: 'bad_request' }, { status: 400, headers: corsHeaders(request) });
  }

  const dispatchClient = getSupabaseDispatch();
  if (!dispatchClient) {
    return NextResponse.json(
      { ok: false, error: 'Dispatch database not configured', error_code: 'dispatch_db_not_configured' },
      { status: 503, headers: corsHeaders(request) }
    );
  }

  const auth = await requireAdmin({ request, body, supabaseClient: dispatchClient as any });
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error, error_code: auth.error_code }, { status: auth.status, headers: corsHeaders(request) });
  }

  const sb: any = dispatchClient as any;
  const schema = await resolveDispatchSchema(sb, { preferProValue: proId });
  const jobsTable = schema?.jobsTable || 'h2s_dispatch_jobs';
  const idCol = schema?.jobsIdCol || 'job_id';
  const statusCol = schema?.jobsStatusCol || 'status';

  // 1) Ensure assignment exists (so pro portal sees it)
  const assignmentResult = await ensureDispatchOfferAssignment(sb, {
    jobId,
    proValue: proId,
    state: 'accepted',
  });

  // 2) Update job row to reflect assignment
  try {
    // Set status to accepted (dispatch UI treats this as “scheduled tab” group)
    const patch: any = { updated_at: new Date().toISOString() };
    patch[statusCol] = 'accepted';

    // Try with status first
    try {
      const { error } = await sb.from(jobsTable).update(patch).eq(idCol as any, jobId);
      if (error) throw error;
    } catch {
      // If status column mismatched, best-effort assigned_to update only
    }

    await bestEffortUpdateAssignedTo(sb, jobsTable, idCol, jobId, proId);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Failed to dispatch job', error_code: 'dispatch_failed' },
      { status: 500, headers: corsHeaders(request) }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      job_id: jobId,
      pro_id: proId,
      assignment: assignmentResult,
      message: 'Job assigned',
    },
    { headers: corsHeaders(request) }
  );
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return await handle(request, body);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error' }, { status: 500, headers: corsHeaders(request) });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = Object.fromEntries(url.searchParams.entries());
  return POST(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(payload) }));
}
