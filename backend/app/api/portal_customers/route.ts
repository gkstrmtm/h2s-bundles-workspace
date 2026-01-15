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

    // Fetch assignments for this pro
    const aCols = uniqueStrings([
      schema.assignmentsJobCol,
      schema.assignmentsStateCol || '',
    ]);
    const { data: assignments, error: aErr } = await sb
      .from(schema.assignmentsTable)
      .select(aCols.length ? aCols.join(',') : '*')
      .eq(schema.assignmentsProCol as any, String(payload.sub))
      .limit(1000);

    if (aErr) {
      return NextResponse.json({ ok: true, customers: [], debug: debug ? { reason: aErr.message || 'assignments_query_failed' } : undefined });
    }

    const rows = Array.isArray(assignments) ? assignments : [];
    const jobIds = uniqueStrings(rows.map((r: any) => r?.[schema.assignmentsJobCol]));

    if (!jobIds.length) {
      return NextResponse.json({ ok: true, customers: [], debug: debug ? { assignments: rows.slice(0, 25), jobs: [] } : undefined });
    }

    const keys = await probeColumns(sb, schema.jobsTable);
    const startCol = pickFirstKey(keys, ['start_iso', 'start_at', 'scheduled_at', 'scheduled_for', 'appointment_at', 'appointment_time', 'date']);
    const customerNameCol = pickFirstKey(keys, ['customer_name', 'name', 'customer', 'client_name', 'contact_name']);
    const customerPhoneCol = pickFirstKey(keys, ['customer_phone', 'phone', 'contact_phone', 'phone_number']);
    const customerEmailCol = pickFirstKey(keys, ['customer_email', 'email', 'contact_email']);
    const serviceNameCol = pickFirstKey(keys, ['service_name', 'service', 'service_title', 'title']);
    const addressCol = pickFirstKey(keys, ['service_address', 'address', 'street', 'full_address']);
    const amountCol = pickFirstKey(keys, ['amount_total', 'total_amount', 'amount', 'price_total']);

    const jobSelectCols = uniqueStrings([
      schema.jobsIdCol,
      schema.jobsStatusCol || '',
      'order_id',
      'created_at',
      startCol || '',
      customerNameCol || '',
      customerPhoneCol || '',
      customerEmailCol || '',
      serviceNameCol || '',
      addressCol || '',
      amountCol || '',
      'notes',
      'included_tech_source',
      'items',
      'line_items',
      'metadata',
    ].filter((c) => !keys.size || keys.has(c)));

    const { data: jobs, error: jErr } = await sb
      .from(schema.jobsTable)
      .select(jobSelectCols.length ? jobSelectCols.join(',') : '*')
      .in(schema.jobsIdCol as any, jobIds)
      .limit(500);

    if (jErr) {
      return NextResponse.json({ ok: true, customers: [], debug: debug ? { assignments: rows.slice(0, 25), jobs: [], reason: jErr.message } : undefined });
    }

    const jobList = Array.isArray(jobs) ? jobs : [];

    const jobById = new Map<string, any>();
    for (const j of jobList) {
      const jid = String(j?.[schema.jobsIdCol] ?? '').trim();
      if (jid) jobById.set(jid, j);
    }

    // Customers-to-call = accepted/scheduled jobs in next 7 days.
    const now = new Date();
    const weekAhead = new Date(now);
    weekAhead.setDate(now.getDate() + 7);

    const customers = [] as any[];

    for (const a of rows) {
      const assignState = String(a?.[schema.assignmentsStateCol || 'assign_state'] ?? a?.state ?? a?.status ?? '').toLowerCase();
      if (assignState && assignState !== 'accepted' && assignState !== 'scheduled') continue;

      const jobId = String(a?.[schema.assignmentsJobCol] || '').trim();
      if (!jobId) continue;

      const job = jobById.get(jobId);
      if (!job) continue;

      const startIso = startCol ? asIsoDate(job?.[startCol]) : null;
      if (!startIso) continue;
      const start = new Date(startIso);
      if (start < now || start > weekAhead) continue;

      // Try column first, fallback to metadata (consistent with frontend portal.html logic)
      const metadata = (typeof job?.metadata === 'string' ? JSON.parse(job.metadata) : job?.metadata) || {};
      const customer_name = (customerNameCol ? job?.[customerNameCol] : null) || metadata?.customer_name || null;
      const customer_phone = (customerPhoneCol ? job?.[customerPhoneCol] : null) || metadata?.customer_phone || null;
      const customer_email = (customerEmailCol ? job?.[customerEmailCol] : null) || metadata?.customer_email || null;
      const service_name = (serviceNameCol ? job?.[serviceNameCol] : null) || metadata?.service_name || metadata?.service_id || null;
      const service_address = (addressCol ? job?.[addressCol] : null) || metadata?.service_address || metadata?.address || null;
      const amount_total = (amountCol ? job?.[amountCol] : null) || metadata?.order_total || metadata?.total || null;

      customers.push({
        order_id: job?.order_id ?? jobId,
        job_id: jobId,
        customer_name,
        customer_phone,
        customer_email,
        service_name,
        service_address,
        amount_total,
        start_iso: startIso,
        context: 'Upcoming Appointment',
        notes: job?.notes ?? null,
        included_tech_source: job?.included_tech_source ?? null,
        items: (job as any)?.items ?? (job as any)?.line_items ?? (metadata?.items || metadata?.items_json || null),
      });
    }

    // Sort soonest-first
    customers.sort((a, b) => String(a.start_iso).localeCompare(String(b.start_iso)));

    return NextResponse.json({
      ok: true,
      customers,
      debug: debug
        ? {
            schema,
            assignments: rows.slice(0, 50),
            jobs: jobList.slice(0, 50),
          }
        : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error' }, { status: 500 });
  }
}
