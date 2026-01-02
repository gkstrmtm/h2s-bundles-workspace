import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/portalTokens';
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

function isUuidLike(value: any): boolean {
  const s = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function numOrZero(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function getProPayoutPercent(): number {
  const raw = process.env.PORTAL_PAYOUT_PERCENT || process.env.PRO_PAYOUT_PERCENT || '';
  const n = Number(raw);
  // Default = 35% (legacy JS: orderSubtotal * 0.35)
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.35;
}

function computeLegacyPercentPayout(opts: { subtotal: number; serviceHint?: string; qtyHint?: number }): number {
  const subtotal = numOrZero(opts.subtotal);
  if (!(subtotal > 0)) return 0;

  const payoutPct = getProPayoutPercent();
  const MIN_PAYOUT = Number(process.env.PORTAL_MIN_PAYOUT || 35) || 35;
  const MAX_PAYOUT_PCT = Number(process.env.PORTAL_MAX_PAYOUT_PCT || 0.45) || 0.45;
  const qty = Math.max(1, Math.floor(numOrZero(opts.qtyHint) || 1));

  // Legacy behavior: base = floor(subtotal * 0.35)
  let base = Math.floor(subtotal * payoutPct);

  // Legacy special-case: mounting jobs have a higher minimum.
  const svc = String(opts.serviceHint || '').toLowerCase();
  if (base < 45 && svc.includes('mount')) {
    base = 45 * qty;
  }

  let payout = Math.max(MIN_PAYOUT, base);

  // Legacy cap: do not exceed 45% of subtotal
  payout = Math.min(payout, subtotal * MAX_PAYOUT_PCT);
  return round2(payout);
}

function extractEstimatedPayout(jobRow: any): number {
  if (!jobRow || typeof jobRow !== 'object') return 0;

  const safeParseJson = (v: any) => {
    if (!v) return null;
    if (typeof v === 'object') return v;
    if (typeof v !== 'string') return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };

  const meta = safeParseJson(jobRow?.metadata) || safeParseJson(jobRow?.meta) || null;

  // Prefer explicit pro payout numbers when present.
  return (
    numOrZero(jobRow?.calc_pro_payout_total) ||
    numOrZero(jobRow?.pro_payout_total) ||
    numOrZero(jobRow?.tech_payout_total) ||
    numOrZero(jobRow?.estimated_payout) ||
    numOrZero(jobRow?.payout_estimated) ||
    numOrZero(meta?.calc_pro_payout_total) ||
    numOrZero(meta?.pro_payout_total) ||
    numOrZero(meta?.tech_payout_total) ||
    numOrZero(meta?.estimated_payout) ||
    numOrZero(meta?.payout_estimated)
  );
}

function bestEffortComputePayoutFromCustomerTotals(jobRow: any): number {
  if (!jobRow || typeof jobRow !== 'object') return 0;

  const safeParseJson = (v: any) => {
    if (!v) return null;
    if (typeof v === 'object') return v;
    if (typeof v !== 'string') return null;
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  };

  const meta = safeParseJson(jobRow?.metadata) || safeParseJson(jobRow?.meta) || {};
  const serviceHint = String(jobRow?.service_id || jobRow?.service_name || meta?.service_id || meta?.service_name || '');

  // Try to infer subtotal from items JSON.
  const items = (meta?.items_json || meta?.items || meta?.line_items || meta?.lineItems) as any;
  if (Array.isArray(items) && items.length) {
    let subtotal = 0;
    let qtySum = 0;
    for (const it of items) {
      if (!it || typeof it !== 'object') continue;
      const qty = Math.max(1, Math.floor(numOrZero((it as any).qty || (it as any).quantity || 1) || 1));
      const line =
        numOrZero((it as any).line_total) ||
        numOrZero((it as any).lineTotal) ||
        numOrZero((it as any).line_customer_total) ||
        numOrZero((it as any).lineCustomerTotal);
      const unit =
        numOrZero((it as any).unit_price) ||
        numOrZero((it as any).unitPrice) ||
        numOrZero((it as any).unit_customer_price) ||
        numOrZero((it as any).unitCustomerPrice) ||
        numOrZero((it as any).price);

      if (line > 0) subtotal += line;
      else if (unit > 0) subtotal += unit * qty;
      qtySum += qty;
    }
    const payout = computeLegacyPercentPayout({ subtotal, serviceHint, qtyHint: qtySum });
    if (payout > 0) return payout;
  }

  // Fallback: use job-level totals if present.
  const subtotal =
    numOrZero(meta?.subtotal) ||
    numOrZero(meta?.order_subtotal) ||
    numOrZero(meta?.orderSubtotal) ||
    numOrZero(jobRow?.subtotal) ||
    numOrZero(jobRow?.order_subtotal) ||
    numOrZero(jobRow?.amount_subtotal) ||
    0;

  if (subtotal > 0) {
    return computeLegacyPercentPayout({ subtotal, serviceHint, qtyHint: 1 });
  }

  // Absolute last resort: total (less ideal than subtotal, but keep 35% rule).
  const total =
    numOrZero(meta?.total) ||
    numOrZero(meta?.order_total) ||
    numOrZero(meta?.orderTotal) ||
    numOrZero(jobRow?.total) ||
    numOrZero(jobRow?.order_total) ||
    numOrZero(jobRow?.amount_total) ||
    numOrZero(jobRow?.total_amount) ||
    0;

  if (total > 0) {
    return computeLegacyPercentPayout({ subtotal: total, serviceHint, qtyHint: 1 });
  }

  return 0;
}

async function bestEffortComputePayoutFromLines(sb: any, jobId: string): Promise<number> {
  const id = String(jobId || '').trim();
  if (!id) return 0;
  try {
    const { data, error } = await sb
      .from('h2s_dispatch_job_lines')
      .select('*')
      .eq('job_id', id)
      .limit(500);
    if (error || !Array.isArray(data)) return 0;

    const rows = data as any[];
    const candidates = [
      'calc_pro_payout_total',
      'pro_payout_total',
      'tech_payout_total',
      'payout_total',
      'payout_amount',
      'calc_payout_total',
      'calc_payout',
      'pro_payout',
      'tech_payout',
    ];

    for (const key of candidates) {
      let sum = 0;
      let sawAny = false;
      for (const r of rows) {
        if (!r || typeof r !== 'object') continue;
        if (!(key in r)) continue;
        const n = Number((r as any)[key] ?? 0);
        if (Number.isFinite(n)) {
          sum += n;
          sawAny = true;
        }
      }
      if (sawAny && sum > 0) return sum;
    }

    return 0;
  } catch {
    return 0;
  }
}

async function bestEffortEnsureLegacyJobShim(sb: any, jobId: string, createdAtIso: string): Promise<{ ok: boolean; warning?: string }> {
  const id = String(jobId || '').trim();
  if (!id) return { ok: false, warning: 'Missing job_id' };
  try {
    const payload: any = {
      job_id: id,
      status: 'completed',
      service_id: 'svc_maintenance',
      created_at: createdAtIso,
    };
    const { error } = await sb.from('h2s_jobs').insert(payload);
    if (!error) return { ok: true };
    const msg = String(error.message || 'Shim insert failed');
    if (/duplicate key|already exists/i.test(msg)) return { ok: true };
    return { ok: false, warning: msg };
  } catch (e: any) {
    return { ok: false, warning: e?.message || 'Shim insert threw' };
  }
}

async function bestEffortEnsurePayoutLedgerRow(opts: {
  sb: any;
  proId: string;
  jobId: string;
  completedAtIso: string;
  amount: number;
}): Promise<{ ok: boolean; table?: string; warning?: string }> {
  const { sb, proId, jobId, completedAtIso, amount } = opts;
  if (!sb) return { ok: false, warning: 'No DB client' };
  if (!isUuidLike(proId)) return { ok: false, warning: 'Missing/invalid pro_id for payout creation' };
  if (!String(jobId || '').trim()) return { ok: false, warning: 'Missing job_id for payout creation' };
  if (!(amount > 0)) return { ok: false, warning: 'No positive payout amount available' };

  const payoutTables = ['h2s_payouts_ledger', 'h2s_dispatch_payouts_ledger', 'h2s_dispatch_payouts', 'payouts'];

  // Known schema fast-path: do not rely on sample rows (tables can be empty).
  // This matches the production h2s_payouts_ledger columns we expect.
  const isIso = (s: string) => !Number.isNaN(new Date(s).getTime());
  const completedIso = isIso(completedAtIso) ? completedAtIso : new Date().toISOString();
  const weekStart = (() => {
    const d = new Date(completedIso);
    // Compute Monday (UTC) as week start
    const day = d.getUTCDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1) - day;
    d.setUTCDate(d.getUTCDate() + diff);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  })();
  const weekStartIsoDate = weekStart.toISOString().slice(0, 10);
  const periodEnd = new Date(weekStart);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 6);
  const periodEndIsoDate = periodEnd.toISOString().slice(0, 10);

  try {
    // Existence check
    const existing = await sb
      .from('h2s_payouts_ledger')
      .select('payout_id, amount, total_amount')
      .eq('job_id', jobId)
      .eq('pro_id', proId)
      .eq('payout_type', 'job')
      .limit(1);
    if (existing?.error) {
      return { ok: false, table: 'h2s_payouts_ledger', warning: existing.error.message || 'Ledger select failed' };
    }
    if (!existing?.error && Array.isArray(existing?.data) && existing.data.length) {
      const row = existing.data[0] as any;
      const cur = numOrZero(row?.amount ?? row?.total_amount ?? 0);
      if (cur <= 0 && amount > 0) {
        try {
          const upd = await sb
            .from('h2s_payouts_ledger')
            .update({ amount, total_amount: amount })
            .eq('payout_id', row?.payout_id);
          if (upd?.error) {
            return { ok: true, table: 'h2s_payouts_ledger', warning: upd.error.message || 'Ledger update failed' };
          }
        } catch {
          return { ok: true, table: 'h2s_payouts_ledger', warning: 'Ledger update threw' };
        }
      }
      return { ok: true, table: 'h2s_payouts_ledger' };
    }

    const insertRes = await sb.from('h2s_payouts_ledger').insert({
      pro_id: proId,
      job_id: jobId,
      amount,
      total_amount: amount,
      payout_type: 'job',
      status: 'pending',
      state: 'pending',
      week_start: weekStartIsoDate,
      period_start: weekStartIsoDate,
      period_end: periodEndIsoDate,
      created_at: completedIso,
      note: 'Auto: portal_mark_done',
    });

    if (insertRes?.error) {
      const msg = String(insertRes.error.message || 'Ledger insert failed');

      // Legacy schema: h2s_payouts_ledger.job_id may have an FK to public.h2s_jobs (not dispatch jobs).
      // If so, insert a minimal shim row into h2s_jobs and retry once.
      if (/h2s_payouts_ledger_job_id_fkey/i.test(msg) || (/foreign key constraint/i.test(msg) && /job_id/i.test(msg))) {
        const shim = await bestEffortEnsureLegacyJobShim(sb, jobId, completedIso);
        if (shim.ok) {
          const retry = await sb.from('h2s_payouts_ledger').insert({
            pro_id: proId,
            job_id: jobId,
            amount,
            total_amount: amount,
            payout_type: 'job',
            status: 'pending',
            state: 'pending',
            week_start: weekStartIsoDate,
            period_start: weekStartIsoDate,
            period_end: periodEndIsoDate,
            created_at: completedIso,
            note: 'Auto: portal_mark_done (shimmed h2s_jobs)',
          });
          if (!retry?.error) return { ok: true, table: 'h2s_payouts_ledger' };
          return {
            ok: false,
            table: 'h2s_payouts_ledger',
            warning: String(retry.error?.message || msg),
          };
        }
        return { ok: false, table: 'h2s_payouts_ledger', warning: `${msg} (shim failed: ${shim.warning || 'unknown'})` };
      }

      return { ok: false, table: 'h2s_payouts_ledger', warning: msg };
    }

    return { ok: true, table: 'h2s_payouts_ledger' };
  } catch {
    return { ok: false, table: 'h2s_payouts_ledger', warning: 'Ledger access threw an exception' };
  }

  for (const table of payoutTables) {
    try {
      // Probe columns (best-effort). If table is empty we can't infer.
      const probe = await sb.from(table).select('*').limit(1);
      if (probe?.error) continue;
      const row = Array.isArray(probe?.data) ? probe.data[0] : null;
      const keys = row && typeof row === 'object' ? new Set(Object.keys(row)) : new Set<string>();

      const has = (k: string) => keys.has(k);
      const proCol = has('pro_id') ? 'pro_id' : has('tech_id') ? 'tech_id' : has('assigned_pro_id') ? 'assigned_pro_id' : null;
      const jobCol = has('job_id') ? 'job_id' : has('dispatch_job_id') ? 'dispatch_job_id' : has('work_order_id') ? 'work_order_id' : null;
      const amountCol = has('amount') ? 'amount' : has('total_amount') ? 'total_amount' : has('payout_amount') ? 'payout_amount' : null;

      if (!proCol || !jobCol || !amountCol) continue;

      // If this table has payout_type, we should use it to avoid duplicates.
      const payoutTypeCol = has('payout_type') ? 'payout_type' : null;
      const hasStatus = has('status');
      const hasState = has('state');

      try {
        let q = sb.from(table).select('*').eq(proCol, proId).eq(jobCol, jobId).limit(1);
        if (payoutTypeCol) q = q.eq(payoutTypeCol, 'job');
        const existing = await q;
        if (!existing?.error && Array.isArray(existing?.data) && existing.data.length) {
          return { ok: true, table };
        }
      } catch {
        // ignore and attempt insert anyway
      }

      const proKey = String(proCol);
      const jobKey = String(jobCol);
      const amountKey = String(amountCol);

      const insertRow: any = {
        [proKey]: proId,
        [jobKey]: jobId,
        [amountKey]: amount,
      };

      // If the table supports both amount and total_amount, set both for compatibility.
      if (has('amount') && has('total_amount')) {
        insertRow.amount = amount;
        insertRow.total_amount = amount;
      }
      if (payoutTypeCol) insertRow[String(payoutTypeCol)] = 'job';

      // Some schemas carry both `status` and `state`. Set both when present.
      if (hasStatus) insertRow.status = 'pending';
      if (hasState) insertRow.state = 'pending';

      if (has('created_at')) insertRow.created_at = completedAtIso;
      if (has('period_start')) insertRow.period_start = completedAtIso;
      if (has('period_end')) insertRow.period_end = completedAtIso;
      if (has('week_start')) insertRow.week_start = completedAtIso;

      const ins = await sb.from(table).insert(insertRow);
      if (ins?.error) {
        // If a constraint prevents insert, don't fail completion.
        return { ok: false, table, warning: ins.error.message || 'Payout insert failed' };
      }
      return { ok: true, table };
    } catch (e: any) {
      // Try next candidate
      continue;
    }
  }

  return { ok: false, warning: 'No payout table available for payout creation' };
}

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'http://localhost:3000',
    'http://localhost:8080'
  ];

  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
  try {
    const body = await request.json();
    const token = body?.token || '';
    const jobId = String(body?.job_id || '');

    if (!token) {
      return NextResponse.json({ ok: false, error: 'Missing token', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }
    if (!jobId) {
      return NextResponse.json({ ok: false, error: 'Missing job_id', error_code: 'bad_request' }, { status: 400, headers: corsHeaders(request) });
    }

    const payload = verifyPortalToken(token);
    if (payload.role !== 'pro') {
      return NextResponse.json({ ok: false, error: 'Not a pro session', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }

    const dispatchClient = getSupabaseDispatch();
    if (!dispatchClient) {
      return NextResponse.json(
        { ok: false, error: 'Dispatch database not configured', error_code: 'dispatch_db_not_configured' },
        { status: 503, headers: corsHeaders(request) }
      );
    }

    // Some deployments accidentally wire DISPATCH service key to an anon key.
    // Writes may then fail due to RLS/policy type mismatches. Try the main service client as a fallback.
    const clients: Array<{ name: string; sb: any }> = [{ name: 'dispatch', sb: dispatchClient as any }];
    try {
      const main = getSupabase();
      // Avoid duplicating identical instances.
      if (main && main !== dispatchClient) clients.push({ name: 'main', sb: main as any });
    } catch {
      // ignore
    }

    let lastAttempts: any[] = [];
    let lastJobTable = 'h2s_dispatch_jobs';
    let lastSchema: any = null;

    for (const c of clients) {
      const sb: any = c.sb;

      const schema = await resolveDispatchSchema(sb, { preferProValue: payload.sub, preferEmailValue: payload.email });
      lastSchema = schema;
      const jobTable = schema?.jobsTable || 'h2s_dispatch_jobs';
      lastJobTable = jobTable;

    // Do not trust a single inferred column. Some deployments have different id/status column names.
    const idCols = uniq([schema?.jobsIdCol, 'job_id', 'dispatch_job_id', 'work_order_id', 'workorder_id', 'ticket_id', 'order_id', 'id']);
    const statusCols = uniq([schema?.jobsStatusCol, 'status', 'job_status', 'state']);
    const completedAtCols = uniq(['completed_at', 'completedAt', 'completed_on', 'done_at', 'doneAt']);
    const updatedAtCols = uniq(['updated_at', 'updatedAt']);

      // Best-effort: infer obvious columns from a sample row.
      let inferredStatusCol: string | null = null;
      let inferredCompletedAtCol: string | null = null;
      let inferredUpdatedAtCol: string | null = null;
      try {
        const probe = await sb.from(jobTable).select('*').limit(1);
        const row = Array.isArray(probe?.data) ? probe.data[0] : null;
        if (row && typeof row === 'object') {
          const keys = new Set(Object.keys(row));
          inferredStatusCol = statusCols.find((c) => keys.has(c)) || null;
          inferredCompletedAtCol = completedAtCols.find((c) => keys.has(c)) || null;
          inferredUpdatedAtCol = updatedAtCols.find((c) => keys.has(c)) || null;
        }
      } catch {
        // ignore
      }

      const nowIso = new Date().toISOString();
      const attempts: Array<{ client: string; idCol: string; statusCol: string; error?: string }> = [];

      for (const idCol of uniq([schema?.jobsIdCol, ...idCols])) {
        for (const statusCol of uniq([inferredStatusCol, ...statusCols])) {
          try {
            const patch: any = { [statusCol]: 'completed' };
            if (inferredUpdatedAtCol) patch[inferredUpdatedAtCol] = nowIso;
            if (inferredCompletedAtCol) patch[inferredCompletedAtCol] = nowIso;

            let { data, error } = await sb.from(jobTable).update(patch).eq(idCol as any, jobId.trim()).select('*').limit(1);

            // If the error is about missing completed/updated columns, retry with a minimal patch.
            if (error) {
              const msg = String(error.message || '');
              if (
                (inferredCompletedAtCol && msg.includes(inferredCompletedAtCol) && /(does not exist|unknown|42703)/i.test(msg)) ||
                (inferredUpdatedAtCol && msg.includes(inferredUpdatedAtCol) && /(does not exist|unknown|42703)/i.test(msg))
              ) {
                const minimal: any = { [statusCol]: 'completed' };
                const retry = await sb.from(jobTable).update(minimal).eq(idCol as any, jobId.trim()).select('*').limit(1);
                data = retry.data;
                error = retry.error;
              }
            }

            if (!error && Array.isArray(data) && data.length) {
              // Best-effort: also mark the assignment as completed so grouping is consistent.
              if (schema?.assignmentsTable && schema?.assignmentsJobCol && schema?.assignmentsStateCol) {
                const proValues = uniq([payload.sub, payload.email]);
                for (const proValue of proValues) {
                  try {
                    await sb
                      .from(schema.assignmentsTable)
                      .update({ [schema.assignmentsStateCol]: 'completed' } as any)
                      .eq(schema.assignmentsJobCol as any, jobId.trim())
                      .eq(schema.assignmentsProCol as any, proValue);
                  } catch {
                    // ignore
                  }
                }
              }

              const payoutAmount = extractEstimatedPayout(data[0]);
              const payoutFromLines = payoutAmount > 0 ? 0 : await bestEffortComputePayoutFromLines(sb, jobId.trim());
              const payoutFromTotals = payoutAmount > 0 || payoutFromLines > 0 ? 0 : bestEffortComputePayoutFromCustomerTotals(data[0]);
              const finalPayoutAmount = payoutAmount > 0 ? payoutAmount : payoutFromLines > 0 ? payoutFromLines : payoutFromTotals;

              // Create payout ledger entry best-effort.
              // Important: some deployments split DBs (dispatch tables in one DB, payouts ledger in the main DB).
              // If ledger creation fails on the dispatch client, retry on the main client.
              let payoutAttempt = await bestEffortEnsurePayoutLedgerRow({
                sb,
                proId: String(payload.sub || ''),
                jobId: jobId.trim(),
                completedAtIso: nowIso,
                amount: finalPayoutAmount,
              });

              if (!payoutAttempt.ok) {
                try {
                  const main = getSupabase();
                  if (main && main !== sb) {
                    const retry = await bestEffortEnsurePayoutLedgerRow({
                      sb: main as any,
                      proId: String(payload.sub || ''),
                      jobId: jobId.trim(),
                      completedAtIso: nowIso,
                      amount: finalPayoutAmount,
                    });

                    if (retry.ok) {
                      payoutAttempt = {
                        ...retry,
                        warning: payoutAttempt.warning ? `dispatch: ${payoutAttempt.warning}` : retry.warning,
                      };
                    } else {
                      payoutAttempt = {
                        ...payoutAttempt,
                        warning: [payoutAttempt.warning, retry.warning].filter(Boolean).join(' | '),
                      };
                    }
                  }
                } catch {
                  // ignore
                }
              }

              return NextResponse.json(
                {
                  ok: true,
                  job: data[0] || null,
                  meta: {
                    mode: 'updated',
                    client_used: c.name,
                    jobs_table: jobTable,
                    job_id_col_used: idCol,
                    status_col_used: statusCol,
                    completed_at_col_used: inferredCompletedAtCol,
                    updated_at_col_used: inferredUpdatedAtCol,
                    payout: payoutAttempt,
                    discovered: schema
                      ? {
                          jobs_table: schema.jobsTable,
                          jobs_id_col: schema.jobsIdCol,
                          jobs_status_col: schema.jobsStatusCol,
                          assignments_table: schema.assignmentsTable,
                          assignments_pro_col: schema.assignmentsProCol,
                          assignments_job_col: schema.assignmentsJobCol,
                          assignments_state_col: schema.assignmentsStateCol,
                        }
                      : null,
                  },
                },
                { headers: corsHeaders(request) }
              );
            }

            if (error) attempts.push({ client: c.name, idCol, statusCol, error: error.message });
            else attempts.push({ client: c.name, idCol, statusCol, error: 'No rows updated (job id not found using this id col)' });
          } catch (e: any) {
            attempts.push({ client: c.name, idCol, statusCol, error: e?.message || 'Unknown error' });
          }
        }
      }

      lastAttempts = attempts;
    }

    // Final fallback: even if we can't update the job row, try to mark the pro's assignment as completed.
    // This keeps the portal UX functional (job moves to Completed) even if the jobs table update is blocked.
    try {
      const sb: any = (clients[0]?.sb || dispatchClient) as any;
      const schema = lastSchema;
      if (schema?.assignmentsTable && schema?.assignmentsJobCol && schema?.assignmentsProCol) {
        const proValues = uniq([payload.sub, payload.email]);
        const nowIso = new Date().toISOString();

        const stateCol = String(schema.assignmentsStateCol || 'state');
        const patch: any = { [stateCol]: 'completed' };

        // Best-effort: add completed_at if the column exists.
        try {
          const probe = await sb.from(schema.assignmentsTable).select('*').limit(1);
          const row = Array.isArray(probe?.data) ? probe.data[0] : null;
          if (row && typeof row === 'object') {
            const keys = new Set(Object.keys(row));
            const cAt = uniq(['completed_at', 'done_at', 'completedAt', 'doneAt']).find((k) => keys.has(k));
            if (cAt) patch[cAt] = nowIso;
          }
        } catch {
          // ignore
        }

        for (const proValue of proValues) {
          try {
            const { data, error } = await sb
              .from(schema.assignmentsTable)
              .update(patch)
              .eq(schema.assignmentsJobCol as any, jobId.trim())
              .eq(schema.assignmentsProCol as any, proValue)
              .select('*')
              .limit(1);

            if (!error && Array.isArray(data) && data.length) {
              return NextResponse.json(
                {
                  ok: true,
                  job: null,
                  assignment: data[0] || null,
                  meta: {
                    mode: 'assignment_only',
                    warning: 'Job row update failed; marked assignment completed instead.',
                    jobs_table: lastJobTable,
                    assignments_table: schema.assignmentsTable,
                    assignments_job_col: schema.assignmentsJobCol,
                    assignments_pro_col: schema.assignmentsProCol,
                    assignments_state_col: schema.assignmentsStateCol,
                    last_job_update_error: (lastAttempts || [])[0]?.error || null,
                  },
                },
                { headers: corsHeaders(request) }
              );
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }

    return NextResponse.json(
      {
        ok: false,
        error: 'Unable to mark done (schema mismatch)',
        error_code: 'schema_mismatch',
        meta: {
          jobs_table: lastJobTable,
          tried: (lastAttempts || []).slice(0, 12),
          hint:
            (lastAttempts || []).some((a: any) => /operator does not exist:\s*uuid\s*=\s*text/i.test(String(a?.error || '')))
              ? 'This often indicates RLS/policy or key issues. Verify Vercel uses a service_role key for SUPABASE_SERVICE_KEY(_DISPATCH).'
              : (lastAttempts || []).some((a: any) => /payout_type/i.test(String(a?.error || '')) && /check constraint|violates/i.test(String(a?.error || '')))
                ? "Your DB trigger likely inserted an invalid payout_type (allowed: job|bonus|adjustment|referral). Fix the trigger to use payout_type='job' or catch exceptions so completion cannot roll back."
              : null,
          discovered: lastSchema,
        },
      },
      { status: 400, headers: corsHeaders(request) }
    );
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Internal error' }, { status: 500, headers: corsHeaders(request) });
  }
}
