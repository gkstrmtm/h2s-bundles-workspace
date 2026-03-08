import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';
import { requireAuth, AuthError } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { resolveDispatchSchema } from '@/lib/dispatchSchema';
import { ensureCompletionSideEffects } from '@/lib/dataOrchestration';

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'http://localhost:3000',
    'http://localhost:8080'
  ];

  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';
  const config = getConfig();

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'X-Build-ID': config.buildId
  };

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  const cid = `complete_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const config = getConfig();
  
  try {
    const body = await request.json();
    const jobId = String(body?.job_id || '');

    console.log(`[COMPLETE_JOB_START] cid=${cid} job_id=${jobId} build=${config.buildId}`);

    if (!jobId) {
      console.error(`[COMPLETE_JOB_ERROR] cid=${cid} error=missing_job_id`);
      return NextResponse.json({ 
        ok: false, 
        error: 'Missing job_id', 
        error_code: 'bad_request', 
        build_id: config.buildId, 
        cid 
      }, { status: 400, headers: corsHeaders(request) });
    }

    // HARD AUTH CHECK - no fallbacks
    let payload;
    try {
      payload = await requireAuth(request, body);
    } catch (error) {
      if (error instanceof AuthError) {
        console.error(`[COMPLETE_JOB_AUTH_FAILED] cid=${cid} error=${error.message} code=${error.code}`);
        return NextResponse.json({ 
          ok: false, 
          error: error.message, 
          error_code: error.code, 
          build_id: config.buildId, 
          cid 
        }, { status: error.status, headers: corsHeaders(request) });
      }
      throw error;
    }
    
    const proId = payload.sub;
    console.log(`[COMPLETE_JOB_AUTH_OK] cid=${cid} pro_id=${proId}`);

    // 1. Setup Clients
    const dispatchClient = getSupabaseDispatch();
    if (!dispatchClient) {
      console.error(`[COMPLETE_JOB_ERROR] cid=${cid} error=dispatch_db_not_configured`);
      return NextResponse.json(
        { ok: false, error: 'Dispatch database not configured', error_code: 'dispatch_db_not_configured', build_id: config.buildId, cid },
        { status: 503, headers: corsHeaders(request) }
      );
    }
    const sb = dispatchClient;

    // Resolve schema (jobs table + assignments table) so ownership checks work across deployments.
    const schema = await resolveDispatchSchema(sb, { preferProValue: payload.sub, preferEmailValue: payload.email });
    const jobsTable = schema?.jobsTable || 'h2s_dispatch_jobs';
    const jobIdCol = schema?.jobsIdCol || 'job_id';
    const jobStatusCol = schema?.jobsStatusCol || 'status';

    const assignTable = schema?.assignmentsTable || 'h2s_dispatch_job_assignments';
    const assignJobCol = schema?.assignmentsJobCol || 'job_id';
    const assignProCol = schema?.assignmentsProCol || 'pro_id';
    const assignStateCol = schema?.assignmentsStateCol || 'assign_state';

    const proValues = Array.from(new Set([payload.sub, payload.email].filter(Boolean).map((v) => String(v).trim()).filter(Boolean)));
    const proCols = Array.from(
      new Set([
        assignProCol,
        'pro_id',
        'tech_id',
        'assigned_pro_id',
        'technician_id',
        'user_id',
        'pro_email',
        'tech_email',
        'email',
      ].filter(Boolean))
    );

    // Ownership enforcement:
    // - Prefer accepted/assigned rows in assignments table
    // - Fall back to checking common pro columns on the job row
    let ownershipOk = false;
    let ownershipDebug: any = { checked: [] as any[] };

    // 2a) Check assignments table first
    for (const col of proCols) {
      for (const val of proValues) {
        try {
          const probe = await sb.from(assignTable).select('*').eq(assignJobCol as any, jobId).eq(col as any, val).limit(5);
          if (!probe.error && Array.isArray(probe.data) && probe.data.length) {
            const rows = probe.data;
            const getState = (r: any) => String(r?.[assignStateCol] ?? r?.assign_state ?? r?.state ?? r?.status ?? '').toLowerCase().trim();
            const okStates = new Set(['accepted', 'assigned', 'scheduled', 'done']);
            const denyStates = new Set(['declined', 'rejected', 'cancelled', 'canceled']);

            // If the table has no usable state column, treat any match as ownership.
            const anyHasState = rows.some((r: any) => Boolean(getState(r)));
            if (!anyHasState) {
              ownershipOk = true;
              ownershipDebug.checked.push({ table: assignTable, mode: 'assignment_match_no_state', col, val, rows: rows.length });
              break;
            }

            // Otherwise require an allowed state and disallow explicit declines.
            const hasAllowed = rows.some((r: any) => okStates.has(getState(r)));
            const hasDenied = rows.some((r: any) => denyStates.has(getState(r)));
            ownershipDebug.checked.push({ table: assignTable, mode: 'assignment_match_with_state', col, val, rows: rows.length, hasAllowed, hasDenied });

            if (hasAllowed && !hasDenied) {
              ownershipOk = true;
              break;
            }
          } else {
            ownershipDebug.checked.push({ table: assignTable, mode: 'assignment_miss', col, val, error: probe.error?.message || null });
          }
        } catch (e: any) {
          ownershipDebug.checked.push({ table: assignTable, mode: 'assignment_probe_exception', col, val, error: e?.message || String(e) });
        }
      }
      if (ownershipOk) break;
    }

    // 2b) Fall back: check job row pro columns (some schemas store ownership on jobs)
    let jobRow: any = null;
    if (!ownershipOk) {
      try {
        const { data, error } = await sb.from(jobsTable).select('*').eq(jobIdCol as any, jobId).maybeSingle();
        if (!error && data) {
          jobRow = data;
          const jobProCols = [
            'pro_id',
            'tech_id',
            'assigned_pro_id',
            'technician_id',
            'user_id',
            'pro_email',
            'tech_email',
            'email',
            'assigned_email',
            'assigned_to_email',
            'assigned_to',
            'recipient_id',
          ];

          for (const c of jobProCols) {
            const v = String(jobRow?.[c] ?? '').trim();
            if (!v) continue;
            if (proValues.includes(v)) {
              ownershipOk = true;
              ownershipDebug.checked.push({ table: jobsTable, mode: 'job_row_match', col: c, val: v });
              break;
            }
          }
        }
      } catch (e: any) {
        ownershipDebug.checked.push({ table: jobsTable, mode: 'job_row_probe_exception', error: e?.message || String(e) });
      }
    }

    if (!ownershipOk) {
      console.error(`[COMPLETE_JOB_OWNERSHIP_FAILED] cid=${cid} job_id=${jobId} pro_id=${proId} ownership=0`);
      return NextResponse.json(
        {
          ok: false,
          error: 'Job not found or you do not own this job',
          error_code: 'not_authorized',
          build_id: config.buildId,
          cid,
        },
        { status: 403, headers: corsHeaders(request) }
      );
    }

    // 2. Update job status to done
    console.log(`[COMPLETE_JOB_UPDATE_START] cid=${cid} updating job status to done...`);

    const { data: updatedRows, error: updateError } = await sb
      .from(jobsTable)
      .update({
        [jobStatusCol]: 'done',
        updated_at: new Date().toISOString(),
      } as any)
      .eq(jobIdCol as any, jobId)
      .select();
    
    if (updateError) {
      console.error(`[COMPLETE_JOB_UPDATE_ERROR] cid=${cid} error=`, updateError);
      return NextResponse.json({ 
        ok: false, 
        error: `Failed to update job: ${updateError.message}`,
        error_code: updateError.code || 'update_failed',
        build_id: config.buildId,
        cid
      }, { status: 500, headers: corsHeaders(request) });
    }
    
    if (!updatedRows || updatedRows.length === 0) {
      console.error(`[COMPLETE_JOB_UPDATE_EMPTY] cid=${cid} job_id=${jobId} pro_id=${proId} rows_updated=0`);
      return NextResponse.json(
        {
          ok: false,
          error: 'Job not found',
          error_code: 'not_found',
          build_id: config.buildId,
          cid,
        },
        { status: 404, headers: corsHeaders(request) }
      );
    }
    
    const updatedJob = updatedRows[0];
    console.log(`[COMPLETE_JOB_UPDATE_SUCCESS] cid=${cid} rows_updated=${updatedRows.length} new_status=${updatedJob.status}`);

    // 3. FAIL-CLOSED PAYOUT: If payout creation fails, revert status
    let payoutOk = false;
    let payoutLedgerId: string | null = null;
    let payoutError: string | null = null;
    
    console.log(`[COMPLETE_JOB_PAYOUT_START] cid=${cid} triggering side effects...`);
    try {
      const sideEffectsResult = await ensureCompletionSideEffects({
        jobId: updatedJob.job_id,
        completedAtIso: new Date().toISOString(),
        actorType: 'pro',
        actorId: proId,
        requestId: cid
      });
      
      payoutOk = true;
      payoutLedgerId = sideEffectsResult?.payoutId || null;
      console.log(`[COMPLETE_JOB_PAYOUT_OK] cid=${cid} payout_ledger_id=${payoutLedgerId}`);
      
    } catch (catchedError: any) {
      console.error(`[COMPLETE_JOB_PAYOUT_FAIL] cid=${cid} error=${catchedError.message}`);
      payoutError = catchedError.message || 'Payout creation failed';
      
      // REVERT STATUS
      console.error(`[COMPLETE_JOB_REVERT_START] cid=${cid} reverting status due to payout failure...`);
      try {
        await sb.from('h2s_dispatch_jobs')
          .update({ status: 'scheduled', updated_at: new Date().toISOString() })
          .eq('job_id', jobId);
        console.error(`[COMPLETE_JOB_REVERT_OK] cid=${cid} reverted to status=scheduled`);
      } catch (revertErr: any) {
        console.error(`[COMPLETE_JOB_REVERT_FAIL] cid=${cid} revert_error=${revertErr.message}`);
      }
      
      return NextResponse.json({ 
        ok: false, 
        error: `Job marked incomplete - payout failed: ${payoutError}`,
        error_code: 'payout_failed',
        build_id: config.buildId,
        cid,
        status_persisted: false
      }, { status: 500, headers: corsHeaders(request) });
    }

    // 4. SUCCESS RESPONSE
    console.log(`[COMPLETE_JOB_SUCCESS] cid=${cid} job_id=${jobId} status=done payout_id=${payoutLedgerId}`);
    return NextResponse.json({
      ok: true,
      payout_ok: payoutOk,
      payout_ledger_id: payoutLedgerId,
      payout_error: payoutError,
      status_persisted: true,
      job_status: updatedJob.status,
      build_id: config.buildId,
      cid
    }, { headers: corsHeaders(request) });

  } catch (error: any) {
    console.error(`[COMPLETE_JOB_EXCEPTION] cid=${cid} error=${error.message}`, error);
    return NextResponse.json({ 
      ok: false, 
      error: error?.message || 'Internal error',
      error_code: 'server_error',
      build_id: getConfig().buildId,
      cid
    }, { status: 500, headers: corsHeaders(request) });
  }
}
