import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/auth';
import { resolveDispatchSchema } from '@/lib/dispatchSchema';

function readBearer(request: Request): string {
  const h = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || '').trim() : '';
}

function pickFirstKey(keys: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) if (keys.has(c)) return c;
  return null;
}

function asIsoDate(v: any): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function uniqueStrings(values: any[]): string[] {
  return Array.from(
    new Set(
      values
        .filter((x) => x !== null && x !== undefined)
        .map((x) => String(x))
        .map((x) => x.trim())
        .filter(Boolean)
    )
  );
}

async function probeColumns(sb: any, table: string): Promise<Set<string>> {
  try {
    const { data, error } = await sb.from(table).select('*').limit(1);
    if (error) return new Set<string>();
    const row = Array.isArray(data) ? data[0] : null;
    return row && typeof row === 'object' ? new Set(Object.keys(row)) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token') || readBearer(request) || '';
    const debug = searchParams.get('debug') === '1';

    if (!token) {
      return NextResponse.json({ ok: false, error: 'Missing token', error_code: 'bad_session' }, { status: 401 });
    }

    let payload: any;
    try {
      const _auth = await verifyPortalToken(token);
      if (!_auth.ok || !_auth.payload) {
        return NextResponse.json({ ok: false, error: _auth.error || 'Invalid token', error_code: _auth.errorCode || 'bad_session' }, { status: 401, headers: corsHeaders(request) });
      }
      payload = _auth.payload;
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid token', error_code: 'bad_session' }, { status: 401 });
    }
    if (payload.role !== 'pro') {
      return NextResponse.json({ ok: false, error: 'Not a pro session', error_code: 'bad_session' }, { status: 401 });
    }

    const dispatch = getSupabaseDispatch();
    if (!dispatch) {
      return NextResponse.json({ ok: true, customers: [], debug: debug ? { reason: 'dispatch_db_not_configured' } : undefined });
    }

    const sb: any = dispatch as any;
    const schema = await resolveDispatchSchema(sb, { preferProValue: payload.sub, preferEmailValue: payload.email });
    if (!schema) {
      return NextResponse.json({ ok: true, customers: [], debug: debug ? { reason: 'dispatch_schema_not_found' } : undefined });
    }

    const aCols = uniqueStrings([
      schema.assignmentsJobCol,
      schema.assignmentsStateCol || '',
    ]);

    const { data: assignments, error: aErr } = await sb
      .from(schema.assignmentsTable)
      .select(aCols.length ? aCols.join(',') : '*')
      .eq(schema.assignmentsProCol as any, String(payload.sub))
      .limit(2000);

    if (aErr) {
      return NextResponse.json({ ok: true, customers: [], debug: debug ? { reason: aErr.message || 'assignments_query_failed' } : undefined });
    }

    const rows = Array.isArray(assignments) ? assignments : [];
    const jobIds = uniqueStrings(rows.map((r: any) => r?.[schema.assignmentsJobCol]));

    if (!jobIds.length) {
      return NextResponse.json({ ok: true, customers: [], debug: debug ? { assignments: rows.slice(0, 25), jobs: [] } : undefined });
    }

    const keys = await probeColumns(sb, schema.jobsTable);

    const completedCol = pickFirstKey(keys, ['completed_at', 'done_at', 'completed_on']);
    const startCol = pickFirstKey(keys, ['start_iso', 'start_at', 'scheduled_at', 'scheduled_for', 'appointment_at', 'appointment_time', 'date']);
    const customerNameCol = pickFirstKey(keys, ['customer_name', 'name', 'customer', 'client_name', 'contact_name']);
    const customerPhoneCol = pickFirstKey(keys, ['customer_phone', 'phone', 'contact_phone', 'phone_number']);
    const customerEmailCol = pickFirstKey(keys, ['customer_email', 'email', 'contact_email']);
    const serviceNameCol = pickFirstKey(keys, ['service_name', 'service', 'service_title', 'title']);
    const addressCol = pickFirstKey(keys, ['service_address', 'address', 'street', 'full_address']);
    const cityCol = pickFirstKey(keys, ['service_city', 'city', 'town']);
    const stateCol = pickFirstKey(keys, ['service_state', 'state', 'province']);
    const amountCol = pickFirstKey(keys, ['amount_total', 'total_amount', 'amount', 'price_total']);

    const jobSelectCols = uniqueStrings([
      schema.jobsIdCol,
      'order_id',
      'created_at',
      completedCol || '',
      startCol || '',
      customerNameCol || '',
      customerPhoneCol || '',
      customerEmailCol || '',
      serviceNameCol || '',
      addressCol || '',
      cityCol || '',
      stateCol || '',
      amountCol || '',
    ].filter((c) => !keys.size || keys.has(c)));

    const { data: jobs, error: jErr } = await sb
      .from(schema.jobsTable)
      .select(jobSelectCols.length ? jobSelectCols.join(',') : '*')
      .in(schema.jobsIdCol as any, jobIds)
      .limit(1000);

    if (jErr) {
      return NextResponse.json({ ok: true, customers: [], debug: debug ? { assignments: rows.slice(0, 25), jobs: [], reason: jErr.message } : undefined });
    }

    const jobList = Array.isArray(jobs) ? jobs : [];

    const jobById = new Map<string, any>();
    for (const j of jobList) {
      const jid = String(j?.[schema.jobsIdCol] ?? '').trim();
      if (jid) jobById.set(jid, j);
    }

    const customersByKey = new Map<string, any>();

    for (const a of rows) {
      const assignState = String(a?.[schema.assignmentsStateCol || 'assign_state'] ?? a?.state ?? a?.status ?? '').toLowerCase();
      if (assignState && assignState !== 'completed') continue;

      const jobId = String(a?.[schema.assignmentsJobCol] || '').trim();
      if (!jobId) continue;

      const job = jobById.get(jobId);
      if (!job) continue;

      const lastJobDate = asIsoDate(
        (completedCol ? job?.[completedCol] : null) ||
          (startCol ? job?.[startCol] : null) ||
          job?.created_at
      );
      
      // Try column first, fallback to metadata (consistent with frontend portal.html logic)
      const metadata = (typeof job?.metadata === 'string' ? JSON.parse(job.metadata) : job?.metadata) || {};
      const customer_name = (customerNameCol ? job?.[customerNameCol] : null) || metadata?.customer_name || null;
      const customer_phone = (customerPhoneCol ? job?.[customerPhoneCol] : null) || metadata?.customer_phone || null;
      const customer_email = (customerEmailCol ? job?.[customerEmailCol] : null) || metadata?.customer_email || null;

      const last_service_name = (serviceNameCol ? job?.[serviceNameCol] : null) || metadata?.service_name || metadata?.service_id || null;
      const service_address = (addressCol ? job?.[addressCol] : null) || metadata?.service_address || metadata?.address || null;
      const service_city = (cityCol ? job?.[cityCol] : null) || metadata?.service_city || metadata?.city || null;
      const service_state = (stateCol ? job?.[stateCol] : null) || metadata?.service_state || metadata?.state || null;

      const amountRaw = amountCol ? job?.[amountCol] : null;
      const amountNumber = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw);
      const amount = Number.isFinite(amountNumber) ? amountNumber : 0;

      const key = String(customer_phone || customer_email || customer_name || jobId);
      const existing = customersByKey.get(key);
      if (!existing) {
        customersByKey.set(key, {
          customer_name,
          customer_phone,
          customer_email,
          total_jobs: 1,
          total_revenue: amount,
          last_job_date: lastJobDate,
          last_called_at: null,
          last_call_outcome: null,
          order_id: job?.order_id ?? jobId,
          last_service_name,
          service_address,
          service_city,
          service_state,
        });
      } else {
        existing.total_jobs = (existing.total_jobs || 0) + 1;
        existing.total_revenue = (existing.total_revenue || 0) + amount;
        if (lastJobDate && (!existing.last_job_date || String(lastJobDate) > String(existing.last_job_date))) {
          existing.last_job_date = lastJobDate;
          existing.order_id = job?.order_id ?? jobId;
          existing.last_service_name = last_service_name;
          existing.service_address = service_address;
          existing.service_city = service_city;
          existing.service_state = service_state;
        }
      }
    }

    const customers = Array.from(customersByKey.values()).sort((a, b) => String(b.last_job_date || '').localeCompare(String(a.last_job_date || '')));

    return NextResponse.json({
      ok: true,
      customers,
      debug: debug ? { schema } : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error' }, { status: 500 });
  }
}
