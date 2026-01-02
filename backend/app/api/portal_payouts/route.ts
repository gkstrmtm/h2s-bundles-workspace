import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/portalTokens';

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'http://localhost:3000',
    'http://localhost:8080',
  ];

  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (allowOrigin !== '*') headers['Access-Control-Allow-Credentials'] = 'true';
  return headers;
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

function readBearer(request: Request): string {
  const h = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || '').trim() : '';
}

function numOrZero(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizePayoutState(row: any): string {
  const r = row && typeof row === 'object' ? row : {};
  const vals = [r.payout_status, r.status, r.state]
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean);

  const has = (needle: string) => vals.some((v) => v === needle || v.includes(needle));

  if (has('paid') || has('sent') || has('processed')) return 'paid';
  if (has('approved') || has('approve')) return 'approved';
  if (has('rejected') || has('reject') || has('declined') || has('decline')) return 'rejected';
  return 'pending';
}

function normalizeRow(row: any) {
  const r = row && typeof row === 'object' ? row : {};
  const job_id = String(r.job_id ?? r.dispatch_job_id ?? r.work_order_id ?? r.workorder_id ?? r.ticket_id ?? r.order_id ?? '') || null;
  const state = normalizePayoutState(r);
  const amount = numOrZero(r.amount ?? r.total_amount ?? r.payout_amount ?? r.payout_total ?? 0);
  const total_amount = numOrZero(r.total_amount ?? r.amount ?? r.payout_amount ?? r.payout_total ?? 0);

  return {
    ...r,
    job_id,
    state,
    status: state,
    payout_status: state,
    amount,
    total_amount,
    created_at: r.created_at ?? r.createdAt ?? r.earned_at ?? r.earnedAt ?? r.completed_at ?? r.completedAt ?? null,
    earned_at: r.earned_at ?? r.earnedAt ?? r.completed_at ?? r.completedAt ?? r.created_at ?? r.createdAt ?? null,
    service_name: r.service_name ?? r.service ?? r.serviceTitle ?? r.title ?? null,
  };
}

async function tryFetchFromTable(sb: any, opts: { table: string; proId: string }): Promise<{ ok: boolean; rows?: any[]; source?: string; error?: string }> {
  const { table, proId } = opts;

  // Probe one row to infer columns (tables can be empty).
  let sampleKeys: Set<string> = new Set();
  try {
    const probe = await sb.from(table).select('*').limit(1);
    const sample = Array.isArray(probe?.data) ? probe.data[0] : null;
    if (sample && typeof sample === 'object') sampleKeys = new Set(Object.keys(sample));
  } catch {
    // ignore
  }

  const proCols = ['pro_id', 'tech_id', 'assigned_pro_id', 'technician_id', 'user_id'];
  const proCol = [...proCols].find((c) => sampleKeys.has(c)) || 'pro_id';

  const orderCols = ['created_at', 'earned_at', 'completed_at', 'updated_at'];
  const orderCol = [...orderCols].find((c) => sampleKeys.has(c)) || null;

  try {
    let q = sb.from(table).select('*').eq(proCol as any, proId);
    if (orderCol) q = q.order(orderCol as any, { ascending: false });
    const { data, error } = await q.limit(250);
    if (error) return { ok: false, error: error.message || 'Query failed' };
    const rows = (data || []).map(normalizeRow);
    return { ok: true, rows, source: table };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Query threw' };
  }
}

async function handle(request: Request, token: string) {
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Missing token', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
  }

  let payload: any;
  try {
    payload = verifyPortalToken(token);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Invalid token', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
  }

  if (payload.role !== 'pro') {
    return NextResponse.json({ ok: false, error: 'Not a pro session', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
  }

  const proId = String(payload.sub || '').trim();
  if (!proId) {
    return NextResponse.json({ ok: false, error: 'Missing pro id', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
  }

  const clients: Array<{ name: string; sb: any }> = [];
  try {
    const dispatch = getSupabaseDispatch();
    if (dispatch) clients.push({ name: 'dispatch', sb: dispatch as any });
  } catch {
    // ignore
  }
  try {
    const main = getSupabase();
    if (main) clients.push({ name: 'main', sb: main as any });
  } catch {
    // ignore
  }

  if (!clients.length) {
    return NextResponse.json(
      { ok: false, error: 'Database not configured (set SUPABASE_URL / SUPABASE_SERVICE_KEY)', error_code: 'db_not_configured' },
      { status: 503, headers: corsHeaders(request) }
    );
  }

  const tableCandidates = ['h2s_payouts_ledger', 'h2s_dispatch_payouts_ledger', 'h2s_dispatch_payouts', 'payouts'];
  const debug_report: string[] = [];

  let bestHit: { rows: any[]; source: { client: string; table: string } } | null = null;
  let firstOkEmpty: { rows: any[]; source: { client: string; table: string } } | null = null;

  for (const c of clients) {
    for (const table of tableCandidates) {
      const hit = await tryFetchFromTable(c.sb, { table, proId });
      if (hit.ok) {
        debug_report.push(`OK: ${c.name}.${table} -> ${hit.rows?.length || 0} rows`);
        const rows = hit.rows || [];
        const source = { client: c.name, table: hit.source || table };
        if (rows.length) {
          bestHit = { rows, source };
          break;
        }
        if (!firstOkEmpty) firstOkEmpty = { rows, source };
      } else {
        debug_report.push(`MISS: ${c.name}.${table} -> ${hit.error || 'unknown error'}`);
      }
    }
    if (bestHit) break;
  }

  const finalHit = bestHit || firstOkEmpty;
  if (finalHit) {
    return NextResponse.json(
      {
        ok: true,
        rows: finalHit.rows || [],
        source: finalHit.source,
        debug_report,
      },
      { headers: corsHeaders(request) }
    );
  }

  // Non-critical: show empty rather than failing hard.
  return NextResponse.json({ ok: true, rows: [], debug_report }, { headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token') || readBearer(request) || '';
  return handle(request, token);
}

export async function POST(request: Request) {
  const bearer = readBearer(request);
  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const token = String(body?.token || bearer || '').trim();
  return handle(request, token);
}
