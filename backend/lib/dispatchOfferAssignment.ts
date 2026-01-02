import { resolveDispatchSchema } from '@/lib/dispatchSchema';

function uniq(list: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  for (const v of list) {
    const s = String(v || '').trim();
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

export async function ensureDispatchOfferAssignment(
  dispatchClient: any,
  params: {
    jobId: string;
    proValue: string;
    state?: string;
  }
): Promise<
  | { ok: true; table: string; jobCol: string; proCol: string; stateCol?: string; mode: 'already_exists' | 'inserted'; schemaUsed: boolean }
  | { ok: false; error: string }
> {
  const jobId = String(params.jobId || '').trim();
  const proValue = String(params.proValue || '').trim();
  const state = String(params.state || 'offer_sent');

  if (!dispatchClient) return { ok: false, error: 'Missing dispatch client' };
  if (!jobId) return { ok: false, error: 'Missing jobId' };
  if (!proValue) return { ok: false, error: 'Missing proValue' };

  const sb: any = dispatchClient as any;
  const schema = await resolveDispatchSchema(sb, { preferProValue: proValue });

  const table = schema?.assignmentsTable || 'h2s_dispatch_job_assignments';
  const jobCols = uniq([schema?.assignmentsJobCol, 'job_id', 'dispatch_job_id', 'work_order_id', 'ticket_id', 'id']);
  const proCols = uniq([
    schema?.assignmentsProCol,
    'pro_id',
    'tech_id',
    'assigned_pro_id',
    'technician_id',
    'pro_uuid',
    'tech_uuid',
    'user_id',
    'pro_email',
    'tech_email',
    'email',
  ]);
  const stateCols = uniq([schema?.assignmentsStateCol, 'assign_state', 'state', 'status', 'assignment_state']);

  for (const jobCol of jobCols) {
    for (const proCol of proCols) {
      try {
        const { data, error } = await sb.from(table).select('*').eq(jobCol as any, jobId).eq(proCol as any, proValue).limit(1);
        if (!error && Array.isArray(data) && data.length) {
          return { ok: true, table, jobCol, proCol, stateCol: schema?.assignmentsStateCol, mode: 'already_exists', schemaUsed: !!schema };
        }
      } catch {
        // keep trying
      }

      for (const stateCol of stateCols) {
        try {
          const row: any = {
            [jobCol]: jobId,
            [proCol]: proValue,
            [stateCol]: state,
          };

          const { error } = await sb.from(table).insert(row);
          if (!error) {
            return { ok: true, table, jobCol, proCol, stateCol, mode: 'inserted', schemaUsed: !!schema };
          }
        } catch {
          // keep trying
        }
      }
    }
  }

  return { ok: false, error: 'Could not insert offer assignment (schema mismatch or permissions)' };
}

export async function setDispatchJobOfferState(
  dispatchClient: any,
  params: { jobId: string; status?: string; assignedTo?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb: any = dispatchClient as any;
  const jobId = String(params.jobId || '').trim();
  if (!sb) return { ok: false, error: 'Missing dispatch client' };
  if (!jobId) return { ok: false, error: 'Missing jobId' };

  const schema = await resolveDispatchSchema(sb);
  const table = schema?.jobsTable || 'h2s_dispatch_jobs';
  const idCol = schema?.jobsIdCol || 'job_id';
  const statusCol = schema?.jobsStatusCol || 'status';

  const patch: any = { updated_at: new Date().toISOString() };
  if (params.status) patch[statusCol] = String(params.status);
  if (params.assignedTo) patch['assigned_to'] = String(params.assignedTo);

  try {
    const { error } = await sb.from(table).update(patch).eq(idCol as any, jobId);
    if (error) {
      const msg = String(error.message || '');
      // Some deployments do not have an assigned_to column.
      // Retry without it so we still update status/updated_at.
      if (params.assignedTo && /assigned_to/i.test(msg) && /(does not exist|unknown column|42703)/i.test(msg)) {
        const retryPatch: any = { ...patch };
        delete retryPatch['assigned_to'];
        const { error: retryError } = await sb.from(table).update(retryPatch).eq(idCol as any, jobId);
        if (retryError) return { ok: false, error: retryError.message };
        return { ok: true };
      }

      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Failed to update job status' };
  }
}

function pickAssignedProValueFromJobRow(jobRow: any): string | null {
  if (!jobRow || typeof jobRow !== 'object') return null;

  const candidates: Array<any> = [
    jobRow.assigned_to,
    jobRow.assigned_pro_id,
    jobRow.pro_id,
    jobRow.tech_id,
    jobRow.technician_id,
    jobRow.assigned_email,
    jobRow.assigned_pro_email,
    jobRow.pro_email,
    jobRow.tech_email,
    jobRow.email,
  ];

  for (const v of candidates) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return null;
}

export async function ensureDispatchOfferAssignmentForJob(
  dispatchClient: any,
  params: { jobId: string; proValue?: string | null; state?: string; status?: string }
): Promise<
  | {
      ok: true;
      proValue: string;
      assignment:
        | { ok: true; table: string; jobCol: string; proCol: string; stateCol?: string; mode: 'already_exists' | 'inserted'; schemaUsed: boolean }
        | { ok: false; error: string };
      jobUpdate?: { ok: true } | { ok: false; error: string };
      inferredFromJobRow: boolean;
    }
  | { ok: false; error: string }
> {
  const sb: any = dispatchClient as any;
  const jobId = String(params.jobId || '').trim();
  const desiredState = String(params.state || 'offer_sent');
  const desiredStatus = String(params.status || 'offer_sent');

  if (!sb) return { ok: false, error: 'Missing dispatch client' };
  if (!jobId) return { ok: false, error: 'Missing jobId' };

  let proValue = String(params.proValue || '').trim();
  let inferredFromJobRow = false;
  let jobRow: any = null;

  if (!proValue) {
    try {
      const schema = await resolveDispatchSchema(sb);
      const table = schema?.jobsTable || 'h2s_dispatch_jobs';
      const idCol = schema?.jobsIdCol || 'job_id';

      const { data, error } = await sb.from(table).select('*').eq(idCol as any, jobId).limit(1);
      if (!error && Array.isArray(data) && data.length) {
        jobRow = data[0];
        const inferred = pickAssignedProValueFromJobRow(jobRow);
        if (inferred) {
          proValue = inferred;
          inferredFromJobRow = true;
        }
      }
    } catch {
      // ignore
    }
  }

  // Final fallback: pick a pro from the dispatch pros table (simple routing)
  if (!proValue) {
    try {
      const jobLat = typeof jobRow?.geo_lat === 'number' ? jobRow.geo_lat : null;
      const jobLng = typeof jobRow?.geo_lng === 'number' ? jobRow.geo_lng : null;

      const { data: pros, error: prosErr } = await sb.from('h2s_dispatch_pros').select('*').limit(200);
      if (!prosErr && Array.isArray(pros) && pros.length) {
        const active = pros.filter((p: any) => {
          const st = String(p?.status ?? '').toLowerCase();
          return !st || st === 'active' || st === 'available' || st === 'enabled';
        });

        const list = active.length ? active : pros;

        const toRad = (d: number) => (d * Math.PI) / 180;
        const haversineMiles = (aLat: number, aLng: number, bLat: number, bLng: number) => {
          const R = 3958.7613;
          const dLat = toRad(bLat - aLat);
          const dLng = toRad(bLng - aLng);
          const s1 = Math.sin(dLat / 2);
          const s2 = Math.sin(dLng / 2);
          const aa = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
          return 2 * R * Math.asin(Math.min(1, Math.sqrt(aa)));
        };

        let best = list[0];
        if (jobLat !== null && jobLng !== null) {
          let bestDist = Number.POSITIVE_INFINITY;
          for (const p of list) {
            const pLat = typeof p?.geo_lat === 'number' ? p.geo_lat : null;
            const pLng = typeof p?.geo_lng === 'number' ? p.geo_lng : null;
            if (pLat === null || pLng === null) continue;
            const d = haversineMiles(jobLat, jobLng, pLat, pLng);
            if (d < bestDist) {
              bestDist = d;
              best = p;
            }
          }
        }

        proValue = String(
          best?.pro_id ||
            best?.tech_id ||
            best?.user_id ||
            best?.email ||
            best?.pro_email ||
            best?.tech_email ||
            ''
        ).trim();
      }
    } catch {
      // ignore
    }
  }

  if (!proValue) return { ok: false, error: 'No pro available to assign (RPC empty, no assigned_to, and no dispatch pros found)' };

  const assignment = await ensureDispatchOfferAssignment(sb, { jobId, proValue, state: desiredState });
  const jobUpdate = await setDispatchJobOfferState(sb, { jobId, status: desiredStatus, assignedTo: proValue });

  return { ok: true, proValue, assignment, jobUpdate, inferredFromJobRow };
}
