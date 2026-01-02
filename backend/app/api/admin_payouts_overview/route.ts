import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';

const PAYOUT_TABLE_CANDIDATES = [
  'h2s_payouts_ledger',
  'h2s_dispatch_payouts_ledger',
  'h2s_dispatch_payouts',
  'dispatch_payouts',
  'h2s_payouts',
  'payouts',
];

async function trySelectPayouts(sb: any, table: string, limit = 500) {
  try {
    const { data, error } = await sb.from(table).select('*').order('created_at', { ascending: false }).limit(limit);
    if (!error && Array.isArray(data)) return { ok: true as const, table, rows: data };
  } catch {
    // ignore
  }
  try {
    const { data, error } = await sb.from(table).select('*').limit(limit);
    if (!error && Array.isArray(data)) return { ok: true as const, table, rows: data };
  } catch {
    // ignore
  }
  return { ok: false as const };
}

function normalizePayoutStatus(row: any): string {
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

function normalizeRow(p: any) {
  const payout_id = String(p?.payout_id || p?.entry_id || p?.id || '').trim();
  const entry_id = String(p?.entry_id || p?.payout_id || p?.id || '').trim();
  const job_id = String(p?.job_id || p?.dispatch_job_id || p?.work_order_id || p?.ticket_id || '').trim();
  const pro_id = String(p?.pro_id || p?.tech_id || p?.assigned_pro_id || '').trim();
  const amount = Number(p?.amount ?? p?.total_amount ?? p?.payout_amount ?? 0) || 0;
  const status = normalizePayoutStatus(p);
  const created_at = p?.created_at || p?.earned_at || p?.updated_at || null;

  return {
    ...p,
    payout_id,
    entry_id,
    job_id,
    pro_id,
    amount,
    status,
    created_at,
  };
}

async function handle(request: Request, body: any) {
  const dispatchClient = getSupabaseDispatch();
  if (!dispatchClient) {
    return NextResponse.json(
      { ok: false, error: 'Dispatch database not configured', error_code: 'dispatch_db_not_configured' },
      { status: 503, headers: corsHeaders(request) }
    );
  }

  const auth = await requireAdmin({ request, body, supabaseClient: dispatchClient as any });
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error, error_code: auth.error_code }, { status: auth.status, headers: corsHeaders(request) });
  }

  const sb: any = dispatchClient as any;
  let hit: { table: string; rows: any[] } | null = null;
  let firstOkEmpty: { table: string; rows: any[] } | null = null;

  for (const t of PAYOUT_TABLE_CANDIDATES) {
    const r = await trySelectPayouts(sb, t);
    if ((r as any).ok) {
      const rows = (r as any).rows || [];
      if (Array.isArray(rows) && rows.length) {
        hit = { table: (r as any).table, rows };
        break;
      }
      if (!firstOkEmpty) firstOkEmpty = { table: (r as any).table, rows };
    }
  }

  if (!hit && firstOkEmpty) hit = firstOkEmpty;

  const rows = (hit?.rows || []).map(normalizeRow);

  // Optional filtering, keep it simple.
  const status = String(body?.status || 'all').toLowerCase();
  const filtered = status === 'all' ? rows : rows.filter((r) => String(r.status || '').toLowerCase() === status);

  return NextResponse.json(
    {
      ok: true,
      rows: filtered,
      meta: {
        source_table: hit?.table || null,
        admin: auth.adminEmail,
      },
    },
    { headers: corsHeaders(request) }
  );
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const payload = Object.fromEntries(url.searchParams.entries());
  return POST(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(payload) }));
}
