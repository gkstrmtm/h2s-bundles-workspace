import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';
import { resolveDispatchRequiredIds } from '@/lib/dispatchRequiredIds';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const result: any = {
    timestamp: new Date().toISOString(),
    tests: []
  };

  try {
    const main = getSupabase();
    const dispatch = getSupabaseDispatch() || main;

    result.config = {
      has_main: !!main,
      has_dispatch: !!dispatch,
      dispatch_is_main: dispatch === main
    };

    const extractMissingColumn = (err: any): string | null => {
      const msg = String(err?.message || '');
      const m = msg.match(/Could not find the '([^']+)' column/i);
      return m?.[1] || null;
    };

    const extractNotNullColumn = (err: any): string | null => {
      const msg = String(err?.message || '');
      // Examples:
      // - null value in column "recipient_id" violates not-null constraint
      // - null value in column "recipient_id" of relation "h2s_dispatch_jobs" violates not-null constraint
      const m = msg.match(/null value in column\s+"([^"]+)"(?:\s+of\s+relation\s+"[^"]+")?\s+violates not-null constraint/i);
      return m?.[1] || null;
    };

    const computeNextSequenceId = async (): Promise<number | null> => {
      try {
        const { data, error } = await dispatch
          .from('h2s_dispatch_jobs')
          .select('sequence_id')
          .order('sequence_id', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) return null;
        const current = (data as any)?.sequence_id;
        const n = typeof current === 'number' ? current : Number(current);
        if (!Number.isFinite(n)) return 1;
        return Math.max(1, Math.floor(n) + 1);
      } catch {
        return null;
      }
    };

    const pickExistingSequenceId = async (): Promise<string | number | null> => {
      try {
        const { data, error } = await dispatch
          .from('h2s_dispatch_jobs')
          .select('sequence_id')
          .order('created_at', { ascending: false })
          .limit(5);
        if (error || !Array.isArray(data)) return null;
        for (const row of data) {
          const v = (row as any)?.sequence_id;
          if (v === null || v === undefined) continue;
          const s = String(v).trim();
          if (s) return v;
        }
        return null;
      } catch {
        return null;
      }
    };

    const pickDispatchSequenceId = async (): Promise<string | number | null> => {
      const fromEnv = String(process.env.DEFAULT_DISPATCH_SEQUENCE_ID || process.env.DISPATCH_DEFAULT_SEQUENCE_ID || '').trim();
      if (fromEnv) return fromEnv;

      const fromJobs = await pickExistingSequenceId();
      if (fromJobs !== null) return fromJobs;

      for (const table of [
        'h2s_dispatch_sequences',
        'dispatch_sequences',
        'h2s_sequences',
        'sequences',
        'h2s_job_sequences',
        'job_sequences'
      ]) {
        try {
          const { data, error } = await dispatch.from(table).select('*').limit(1);
          if (error) continue;
          const row = Array.isArray(data) ? data[0] : null;
          if (!row) continue;
          const candidates = [row.sequence_id, row.id, row.uuid];
          for (const c of candidates) {
            if (c === null || c === undefined) continue;
            const s = String(c).trim();
            if (s) return c;
          }
        } catch {
          // ignore
        }
      }

      return null;
    };

    const pickDispatchIdForColumn = async (column: string): Promise<string | null> => {
      const col = String(column || '').trim();
      if (!col) return null;

      // Env overrides first (most reliable).
      const envKeyA = `DEFAULT_DISPATCH_${col.toUpperCase()}`;
      const envKeyB = `DISPATCH_DEFAULT_${col.toUpperCase()}`;
      const envVal = String((process.env as any)?.[envKeyA] || (process.env as any)?.[envKeyB] || '').trim();
      if (envVal) return envVal;

      // If jobs exist, reuse a populated value.
      try {
        const { data, error } = await dispatch
          .from('h2s_dispatch_jobs')
          .select(col)
          .order('created_at', { ascending: false })
          .limit(5);
        if (!error && Array.isArray(data)) {
          for (const row of data) {
            const v = String((row as any)?.[col] ?? '').trim();
            if (v) return v;
          }
        }
      } catch {
        // ignore
      }

      // Guess lookup tables from the column name.
      const base = col.endsWith('_id') ? col.slice(0, -3) : col;
      const candidatesTables = Array.from(
        new Set([
          `h2s_dispatch_${base}s`,
          `dispatch_${base}s`,
          `${base}s`,
          `h2s_${base}s`,
          `h2s_dispatch_${base}`,
          `dispatch_${base}`,
          `${base}`,
          `h2s_${base}`,
        ])
      );

      for (const table of candidatesTables) {
        try {
          const { data, error } = await dispatch.from(table).select('*').limit(1);
          if (error) continue;
          const row = Array.isArray(data) ? data[0] : null;
          if (!row) continue;
          const idCandidates = [
            (row as any)?.[col],
            (row as any)?.[`${base}_id`],
            (row as any)?.id,
            (row as any)?.uuid,
          ];
          for (const c of idCandidates) {
            const s = String(c ?? '').trim();
            if (s) return s;
          }
        } catch {
          // ignore
        }
      }

      return null;
    };

    const pickExistingRecipientId = async (): Promise<string | null> => {
      try {
        const { data, error } = await dispatch
          .from('h2s_dispatch_jobs')
          .select('recipient_id')
          .order('created_at', { ascending: false })
          .limit(5);
        if (error || !Array.isArray(data)) return null;
        for (const row of data) {
          const rid = String((row as any)?.recipient_id ?? '').trim();
          if (rid) return rid;
        }
        return null;
      } catch {
        return null;
      }
    };

    const pickDispatchRecipientId = async (): Promise<string | null> => {
      const fromEnv = String(process.env.DEFAULT_DISPATCH_RECIPIENT_ID || process.env.DISPATCH_DEFAULT_RECIPIENT_ID || '').trim();
      if (fromEnv) return fromEnv;

      const fromJobs = await pickExistingRecipientId();
      if (fromJobs) return fromJobs;

      // Try a recipients table if one exists.
      for (const table of ['h2s_dispatch_recipients', 'dispatch_recipients', 'recipients']) {
        try {
          const { data, error } = await dispatch.from(table).select('*').limit(1);
          if (error) continue;
          const row = Array.isArray(data) ? data[0] : null;
          if (!row) continue;
          const candidates = [row.recipient_id, row.id, row.uuid, row.user_id];
          for (const c of candidates) {
            const s = String(c || '').trim();
            if (s) return s;
          }
        } catch {
          // ignore
        }
      }

      // Last try: pick an ID-like field from dispatch pros.
      try {
        const { data: pros, error } = await dispatch.from('h2s_dispatch_pros').select('*').limit(25);
        if (!error && Array.isArray(pros)) {
          for (const p of pros) {
            const candidates = [p?.pro_id, p?.tech_id, p?.user_id, p?.id];
            for (const c of candidates) {
              const s = String(c || '').trim();
              if (s) return s;
            }
          }
        }
      } catch {
        // ignore
      }

      return null;
    };

    // Test 1: Can we read from h2s_dispatch_jobs?
    // Don't assume specific columns; some dispatch schemas differ.
    const { data: jobs, error: readError } = await dispatch
      .from('h2s_dispatch_jobs')
      .select('*')
      .limit(3);

    result.tests.push({
      test: 'read_jobs',
      status: readError ? 'FAIL' : 'PASS',
      error: readError?.message,
      count: jobs?.length || 0,
      sample_keys: Array.isArray(jobs) && jobs[0] && typeof jobs[0] === 'object' ? Object.keys(jobs[0]).slice(0, 30) : []
    });

    // Probe: does PostgREST recognize step_id?
    try {
      const { error: stepColErr } = await dispatch.from('h2s_dispatch_jobs').select('step_id').limit(1);
      result.tests.push({
        test: 'probe_step_id_column',
        status: stepColErr ? 'FAIL' : 'PASS',
        error: stepColErr?.message
      });
    } catch (e: any) {
      result.tests.push({
        test: 'probe_step_id_column',
        status: 'ERROR',
        error: e?.message || String(e)
      });
    }

    // Probe: can we read any step rows to find a real step_id?
    try {
      const tables = [
        'h2s_sequence_steps',
        'h2s_dispatch_steps',
        'dispatch_steps',
        'h2s_steps',
        'steps',
        'h2s_dispatch_job_steps',
        'dispatch_job_steps',
        'h2s_job_steps',
        'job_steps',
        'h2s_dispatch_workflow_steps',
        'dispatch_workflow_steps',
        'workflow_steps',
      ];
      const probes: any[] = [];
      for (const t of tables) {
        try {
          const { data, error } = await dispatch.from(t).select('*').limit(1);
          if (error) {
            probes.push({ table: t, status: 'FAIL', error: error.message });
          } else {
            const row = Array.isArray(data) ? data[0] : null;
            probes.push({
              table: t,
              status: row ? 'PASS' : 'EMPTY',
              sample_keys: row && typeof row === 'object' ? Object.keys(row).slice(0, 30) : [],
              sample_ids: row
                ? {
                    step_id: (row as any)?.step_id ?? null,
                    id: (row as any)?.id ?? null,
                    uuid: (row as any)?.uuid ?? null,
                  }
                : null,
            });
          }
        } catch (e: any) {
          probes.push({ table: t, status: 'ERROR', error: e?.message || String(e) });
        }
      }
      result.tests.push({ test: 'probe_step_tables', status: 'INFO', probes });
    } catch (e: any) {
      result.tests.push({ test: 'probe_step_tables', status: 'ERROR', error: e?.message || String(e) });
    }

    // Probe: can we read canonical FK lookup tables?
    try {
      const probes: any[] = [];
      for (const t of ['h2s_recipients', 'h2s_sequences', 'h2s_sequence_steps']) {
        try {
          const { data, error } = await dispatch.from(t).select('*').limit(1);
          if (error) {
            probes.push({ table: t, status: 'FAIL', error: error.message });
          } else {
            const row = Array.isArray(data) ? data[0] : null;
            probes.push({
              table: t,
              status: row ? 'PASS' : 'EMPTY',
              sample_keys: row && typeof row === 'object' ? Object.keys(row).slice(0, 30) : [],
              sample_ids: row
                ? {
                    recipient_id: (row as any)?.recipient_id ?? null,
                    sequence_id: (row as any)?.sequence_id ?? null,
                    step_id: (row as any)?.step_id ?? null,
                  }
                : null,
            });
          }
        } catch (e: any) {
          probes.push({ table: t, status: 'ERROR', error: e?.message || String(e) });
        }
      }
      result.tests.push({ test: 'probe_fk_tables', status: 'INFO', probes });
    } catch (e: any) {
      result.tests.push({ test: 'probe_fk_tables', status: 'ERROR', error: e?.message || String(e) });
    }

    // Test 2: Can we insert a job?
    const testOrderId = `TEST_${Date.now()}`;

    // Try to seed realistic fields from a recent order/service.
    let sampleOrder: any = null;
    let sampleService: any = null;
    try {
      const { data } = await main.from('h2s_orders').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
      sampleOrder = data || null;
    } catch {
      // ignore
    }
    try {
      const { data } = await main.from('h2s_services').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
      sampleService = data || null;
    } catch {
      // ignore
    }

    const seededServiceId = String(sampleOrder?.service_id || sampleService?.service_id || sampleService?.id || '').trim() || null;
    const seededServiceName = String(sampleOrder?.service_name || sampleService?.name || '').trim() || null;
    const seededEmail = String(sampleOrder?.customer_email || sampleOrder?.email || '').trim() || null;
    const seededName = String(sampleOrder?.customer_name || sampleOrder?.name || '').trim() || null;
    const seededPhone = String(sampleOrder?.customer_phone || sampleOrder?.phone || '').trim() || null;
    const seededAddress = String(sampleOrder?.service_address || sampleOrder?.address || '').trim() || null;
    const seededCity = String(sampleOrder?.service_city || sampleOrder?.city || '').trim() || null;
    const seededState = String(sampleOrder?.service_state || sampleOrder?.state || '').trim() || null;
    const seededZip = String(sampleOrder?.service_zip || sampleOrder?.zip || '').trim() || null;
    const seededStartIso = sampleOrder?.delivery_date && sampleOrder?.delivery_time
      ? `${String(sampleOrder.delivery_date).trim()}T00:00:00`
      : null;

    // Keep this payload minimal so PostgREST schema drift doesn't mask the real issue.
    // The point of this endpoint is to prove whether the DB will accept a row once
    // required FK UUIDs are provided.
    const insertPayload: any = {
      status: 'queued',
      created_at: new Date().toISOString(),
      due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    // Prefer real FK UUIDs if the lookup tables are accessible.
    try {
      const picked = await resolveDispatchRequiredIds(dispatch);
      result.picked_required_ids = { ...picked.diagnostics, recipient_id: picked.recipientId, sequence_id: picked.sequenceId, step_id: picked.stepId };
      if (picked.recipientId) insertPayload.recipient_id = picked.recipientId;
      if (picked.sequenceId) insertPayload.sequence_id = picked.sequenceId;
      if (picked.stepId) insertPayload.step_id = picked.stepId;
    } catch (e: any) {
      result.picked_required_ids_error = e?.message || String(e);
    }

    let insertData: any = null;
    let insertError: any = null;
    const encounteredNotNull: string[] = [];
    const strippedColumns: string[] = [];
    let recipientIdUnresolved = false;
    let triedRecipientSentinel = false;
    let triedSequenceSentinel = false;
    const triedIdSentinelByCol: Record<string, boolean> = {};

    for (let i = 0; i < 10; i++) {
      const res = await dispatch
        .from('h2s_dispatch_jobs')
        .insert(insertPayload)
        .select('job_id')
        .single();
      insertData = res.data;
      insertError = res.error;
      if (!insertError) break;

      if (String(insertError?.code || '') === '23502') {
        const col = extractNotNullColumn(insertError);
        if (col && !encounteredNotNull.includes(col)) encounteredNotNull.push(col);
        if ((col === 'sequence_id' || col === 'recipient_id' || col === 'step_id') && (insertPayload as any)[col] == null) {
          const picked = await resolveDispatchRequiredIds(dispatch);
          if (col === 'sequence_id' && picked.sequenceId) {
            insertPayload.sequence_id = picked.sequenceId;
            continue;
          }
          if (col === 'recipient_id' && picked.recipientId) {
            insertPayload.recipient_id = picked.recipientId;
            continue;
          }
          if (col === 'step_id' && picked.stepId) {
            insertPayload.step_id = picked.stepId;
            continue;
          }

          if (col === 'recipient_id') recipientIdUnresolved = true;
          break;
        }

        // Generic: other required *_id columns (e.g., step_id).
        if (col && /_id$/i.test(col) && (insertPayload as any)[col] == null) {
          const picked = await pickDispatchIdForColumn(col);
          if (picked) {
            (insertPayload as any)[col] = picked;
            continue;
          }

          if (!triedIdSentinelByCol[col]) {
            triedIdSentinelByCol[col] = true;
            (insertPayload as any)[col] = '00000000-0000-0000-0000-000000000000';
            continue;
          }
        }
      }

      // If a NOT NULL autofill chose a numeric sequence_id but the column is UUID-typed,
      // Postgres returns 22P02. Retry once with a UUID sentinel.
      if (String(insertError?.code || '') === '22P02') {
        const msg = String(insertError?.message || '');
        if (!triedSequenceSentinel && typeof insertPayload.sequence_id === 'number' && /type\s+uuid/i.test(msg)) {
          triedSequenceSentinel = true;
          insertPayload.sequence_id = '00000000-0000-0000-0000-000000000000';
          continue;
        }
      }

      // Strip unknown columns and retry (schema drift / PostgREST cache).
      const missing = extractMissingColumn(insertError);
      if (missing && missing in insertPayload) {
        strippedColumns.push(missing);
        delete insertPayload[missing];
        continue;
      }

      break;
    }

    result.tests.push({
      test: 'insert_job',
      status: insertError ? 'FAIL' : 'PASS',
      job_id: insertData?.job_id || null,
      error: insertError?.message,
      error_code: insertError?.code,
      error_hint: insertError?.hint,
      error_details: insertError?.details,
      encountered_not_null: encounteredNotNull,
      stripped_columns: strippedColumns,
      inserted_payload_keys: Object.keys(insertPayload || {}),
      inserted_payload_preview: {
        recipient_id: (insertPayload as any)?.recipient_id ?? null,
        sequence_id: (insertPayload as any)?.sequence_id ?? null,
        step_id: (insertPayload as any)?.step_id ?? null,
      },
      recipient_id_unresolved: recipientIdUnresolved
    });

    // Actionable hints for prod configuration.
    const recommendations: string[] = [];
    if (dispatch === main) {
      recommendations.push(
        'Dispatch client is using main DB (dispatch_is_main=true). If dispatch is a separate Supabase project, set SUPABASE_URL_DISPATCH and SUPABASE_SERVICE_ROLE_KEY_DISPATCH (or SUPABASE_SERVICE_KEY_DISPATCH) in the backend Vercel env.'
      );
    }
    if (encounteredNotNull.includes('step_id')) {
      recommendations.push(
        'Dispatch insert requires step_id (NOT NULL). If steps tables are not exposed via PostgREST in this DB, set DEFAULT_DISPATCH_STEP_ID (or DISPATCH_DEFAULT_STEP_ID) to a valid UUID from your dispatch workflow/steps table.'
      );
    }
    if (encounteredNotNull.includes('recipient_id')) {
      recommendations.push(
        'Dispatch insert requires recipient_id (NOT NULL). You can set DEFAULT_DISPATCH_RECIPIENT_ID (or DISPATCH_DEFAULT_RECIPIENT_ID) to a valid UUID.'
      );
    }
    if (encounteredNotNull.includes('sequence_id')) {
      recommendations.push(
        'Dispatch insert requires sequence_id (NOT NULL UUID). You can set DEFAULT_DISPATCH_SEQUENCE_ID (or DISPATCH_DEFAULT_SEQUENCE_ID) to a valid UUID from h2s_sequences.'
      );
    }

    if ((result as any)?.picked_required_ids) {
      const picked = (result as any).picked_required_ids;
      if (picked.recipient_source === 'none') {
        recommendations.push(
          'No valid recipient_id could be found. Check that public.h2s_recipients has at least 1 row (and that PostgREST can read it), or set DEFAULT_DISPATCH_RECIPIENT_ID to a real UUID from that table.'
        );
      }
      if (picked.sequence_source === 'none') {
        recommendations.push(
          'No valid sequence_id could be found. Check that public.h2s_sequences has at least 1 row (and that PostgREST can read it), or set DEFAULT_DISPATCH_SEQUENCE_ID to a real UUID from that table.'
        );
      }
      if (picked.step_source === 'none') {
        recommendations.push(
          'No valid step_id could be found. Check that public.h2s_sequence_steps has at least 1 row (ideally tied to the chosen sequence_id), or set DEFAULT_DISPATCH_STEP_ID to a real UUID from that table.'
        );
      }
    }
    if (recommendations.length) {
      result.recommendations = recommendations;
    }

    // Clean up test job
    if (insertData?.job_id) {
      await dispatch.from('h2s_dispatch_jobs').delete().eq('job_id', insertData.job_id);
      result.tests.push({
        test: 'cleanup_test_job',
        status: 'PASS'
      });
    }

  } catch (err: any) {
    result.tests.push({
      test: 'overall',
      status: 'ERROR',
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 5)
    });
  }

  return NextResponse.json(result, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store'
    }
  });
}
