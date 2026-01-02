import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';
import { resolveDispatchSchema } from '@/lib/dispatchSchema';
import { evaluatePainFlags, addAuditEntry } from '@/lib/jobHelpers';

async function handle(request: Request, body: any) {
  const jobId = String(body?.job_id || '').trim();
  const { wire_management_required, wall_type, mounting_surface_notes, special_constraints } = body;

  if (!jobId) {
    return NextResponse.json(
      { ok: false, error: 'job_id is required' },
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

  try {
    const { data: job, error } = await sb.from(jobsTable).select('*').eq('job_id', jobId).single();
    if (error) throw error;

    let metadata = job?.metadata || {};

    // Update fields
    if (wire_management_required !== undefined) metadata.wire_management_required = wire_management_required;
    if (wall_type !== undefined) metadata.wall_type = wall_type;
    if (mounting_surface_notes !== undefined) metadata.mounting_surface_notes = mounting_surface_notes;
    if (special_constraints !== undefined) metadata.special_constraints = special_constraints;

    // Re-evaluate pain flags after update
    const fullJob = { ...job, metadata: metadata };
    const updatedFlags = evaluatePainFlags(fullJob);
    metadata.pain_flags = updatedFlags;

    // Add audit entry
    metadata = addAuditEntry(metadata, {
      user_id: body.admin_user || 'admin',
      user_name: body.admin_name || 'Admin',
      action: 'install_details_updated',
      notes: 'Updated wire management, wall type, and constraints'
    });

    // Update job
    await sb.from(jobsTable).update({
      metadata: metadata,
      updated_at: new Date().toISOString()
    }).eq('job_id', jobId);

    return NextResponse.json({ ok: true, pain_flags: updatedFlags }, { headers: corsHeaders(request) });
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
