import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';
import { resolveDispatchSchema } from '@/lib/dispatchSchema';
import { resolvePainFlag, addAuditEntry } from '@/lib/jobHelpers';

async function handle(request: Request, body: any) {
  const jobId = String(body?.job_id || '').trim();
  const flag = String(body?.flag || '').trim();
  const resolutionNotes = body?.resolution_notes || '';

  if (!jobId || !flag) {
    return NextResponse.json(
      { ok: false, error: 'job_id and flag are required' },
      { status: 400, headers: corsHeaders(request) }
    );
  }

  const dispatchClient = getSupabaseDispatch();
  if (!dispatchClient) {
    return NextResponse.json(
      { ok: false, error: 'Dispatch database not configured' },
      { status: 503, headers: corsHeaders(request) }
    );
  }

  const auth = await requireAdmin({ request, body, supabaseClient: dispatchClient as any });
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
  }

  const sb: any = dispatchClient as any;
  const schema = await resolveDispatchSchema(sb);
  const jobsTable = schema?.jobsTable || 'h2s_dispatch_jobs';

  // Get current job
  try {
    const { data: job, error } = await sb.from(jobsTable).select('*').eq('job_id', jobId).single();
    if (error) throw error;

    let metadata = job?.metadata || {};
    const painFlags = metadata.pain_flags || [];

    // Mark flag as resolved
    const updatedFlags = resolvePainFlag(painFlags, flag, resolutionNotes);

    // Add audit entry
    metadata = addAuditEntry(metadata, {
      user_id: body.admin_user || 'admin',
      user_name: body.admin_name || 'Admin',
      action: 'pain_flag_resolved',
      field: 'pain_flags',
      old_value: flag,
      new_value: 'resolved',
      notes: resolutionNotes
    });

    metadata.pain_flags = updatedFlags;

    // Update job
    await sb.from(jobsTable).update({ 
      metadata: metadata,
      updated_at: new Date().toISOString()
    }).eq('job_id', jobId);

    return NextResponse.json({ ok: true }, { headers: corsHeaders(request) });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500, headers: corsHeaders(request) }
    );
  }
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
