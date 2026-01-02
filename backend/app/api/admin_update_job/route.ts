import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';
import { resolveDispatchSchema } from '@/lib/dispatchSchema';
import { addAuditEntry } from '@/lib/jobHelpers';

/**
 * POST /api/admin_update_job
 * 
 * Purpose: Update job metadata fields (especially for equipment ordering workflow)
 * 
 * Body:
 * {
 *   token: string (ADMIN_TOKEN),
 *   job_id: string,
 *   metadata_updates: {
 *     equipment_ordered?: boolean,
 *     equipment_ordered_at?: string,
 *     equipment_ordered_by?: string,
 *     ...any other metadata fields
 *   }
 * }
 * 
 * Returns:
 * { ok: true, job_id: string } on success
 * { ok: false, error: string } on failure
 */
async function handle(request: Request, body: any) {
  const jobId = String(body?.job_id || '').trim();
  const metadataUpdates = body?.metadata_updates || {};

  if (!jobId) {
    return NextResponse.json(
      { ok: false, error: 'job_id is required' },
      { status: 400, headers: corsHeaders(request) }
    );
  }

  if (!metadataUpdates || typeof metadataUpdates !== 'object') {
    return NextResponse.json(
      { ok: false, error: 'metadata_updates object is required' },
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
    // Fetch existing job
    const { data: job, error: fetchError } = await sb
      .from(jobsTable)
      .select('*')
      .eq('job_id', jobId)
      .single();

    if (fetchError) throw fetchError;
    if (!job) {
      return NextResponse.json(
        { ok: false, error: 'Job not found' },
        { status: 404, headers: corsHeaders(request) }
      );
    }

    // Merge metadata updates into existing metadata
    let metadata = job?.metadata || {};
    metadata = {
      ...metadata,
      ...metadataUpdates
    };

    // Add audit entry for tracking
    metadata = addAuditEntry(metadata, {
      user_id: body.admin_user || auth.adminEmail || 'admin',
      user_name: body.admin_name || auth.adminEmail || 'Admin',
      action: 'metadata_updated',
      notes: `Updated fields: ${Object.keys(metadataUpdates).join(', ')}`
    });

    // Update job record
    const { error: updateError } = await sb
      .from(jobsTable)
      .update({
        metadata: metadata,
        updated_at: new Date().toISOString()
      })
      .eq('job_id', jobId);

    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, job_id: jobId }, { headers: corsHeaders(request) });
  } catch (error: any) {
    console.error('[admin_update_job] Error:', error);
    return NextResponse.json(
      { ok: false, error: error.message || 'Failed to update job' },
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
    return handle(request, body);
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400, headers: corsHeaders(request) }
    );
  }
}
