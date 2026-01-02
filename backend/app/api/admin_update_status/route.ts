import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';
import { resolveDispatchSchema } from '@/lib/dispatchSchema';
import { canTransitionTo, addAuditEntry } from '@/lib/jobHelpers';

async function handle(request: Request, body: any) {
  const jobId = String(body?.job_id || '').trim();
  const status = String(body?.status || '').trim();
  const adminUser = body?.admin_user || 'admin';
  const adminName = body?.admin_name || 'Admin';
  const notes = body?.notes || null;

  if (!jobId || !status) {
    return NextResponse.json(
      { ok: false, error: 'job_id and status are required', error_code: 'bad_request' },
      { status: 400, headers: corsHeaders(request) }
    );
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
  const schema = await resolveDispatchSchema(sb);
  const jobsTable = schema?.jobsTable || 'h2s_dispatch_jobs';
  const idCol = schema?.jobsIdCol || 'job_id';
  const statusCol = schema?.jobsStatusCol || 'status';

  // Fetch current job to validate transition
  let currentJob;
  try {
    const { data, error } = await sb.from(jobsTable).select('*').eq(idCol as any, jobId).single();
    if (error) throw error;
    currentJob = data;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'Job not found', error_code: 'job_not_found' },
      { status: 404, headers: corsHeaders(request) }
    );
  }

  // Validate status transition
  const canTransition = canTransitionTo(currentJob, status) as { ok: boolean; error?: string };
  if (!canTransition.ok) {
    return NextResponse.json(
      { ok: false, error: canTransition.error, error_code: 'invalid_transition' },
      { status: 400, headers: corsHeaders(request) }
    );
  }

  // Add audit log entry
  let metadata = currentJob.metadata || {};
  metadata = addAuditEntry(metadata, {
    user_id: adminUser,
    user_name: adminName,
    action: 'status_changed',
    field: 'status',
    old_value: currentJob.status,
    new_value: status,
    notes: notes
  });

  const patch: any = { 
    updated_at: new Date().toISOString(),
    metadata: metadata
  };
  patch[statusCol] = status;

  // Update job
  try {
    const { error } = await sb.from(jobsTable).update(patch).eq(idCol as any, jobId);
    if (error) throw error;
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Failed to update job status', error_code: 'update_failed' },
      { status: 500, headers: corsHeaders(request) }
    );
  }

  return NextResponse.json({ ok: true, job_id: jobId, status }, { headers: corsHeaders(request) });
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
