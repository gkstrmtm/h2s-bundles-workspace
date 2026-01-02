import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders, pickTokenFrom, requireAdmin } from '@/lib/adminAuth';

const PAYOUT_TABLE_CANDIDATES = [
  'h2s_payouts_ledger',
  'h2s_dispatch_payouts_ledger',
  'h2s_dispatch_payouts',
  'dispatch_payouts',
  'h2s_payouts',
  'payouts',
];

function startOfWeekIso(raw: any): string {
  const s = String(raw || '').trim();
  if (!s) {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday.toISOString().split('T')[0];
  }
  // Expect YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try to parse
  const dt = new Date(s);
  if (!Number.isFinite(dt.getTime())) return startOfWeekIso('');
  dt.setHours(0, 0, 0, 0);
  return dt.toISOString().split('T')[0];
}

async function trySelect(sb: any, table: string, sinceIso: string, untilIso: string) {
  try {
    // Prefer created_at range filter
    const { data, error } = await sb
      .from(table)
      .select('*')
      .gte('created_at', sinceIso)
      .lt('created_at', untilIso)
      .limit(2000);
    if (!error && Array.isArray(data)) {
      // IMPORTANT: If the week window returns 0 rows, don't assume the table is empty.
      // Older pending payouts often exist outside the selected week.
      if (data.length) return { ok: true as const, table, rows: data };
    }
  } catch {
    // ignore
  }

  // Fallback: no date filtering
  try {
    const { data, error } = await sb.from(table).select('*').limit(2000);
    if (!error && Array.isArray(data)) return { ok: true as const, table, rows: data };
  } catch {
    // ignore
  }

  return { ok: false as const };
}

function normPayout(p: any) {
  const payout_id = String(p?.payout_id || p?.entry_id || p?.id || '').trim();
  const job_id = String(p?.job_id || p?.dispatch_job_id || p?.work_order_id || '').trim();
  const pro_id = String(
    p?.pro_id ||
      p?.tech_id ||
      p?.assigned_pro_id ||
      p?.technician_id ||
      p?.pro_email ||
      p?.tech_email ||
      p?.email ||
      ''
  ).trim();
  const amount = Number(p?.amount ?? p?.total_amount ?? p?.payout_amount ?? 0) || 0;
  const vals = [p?.payout_status, p?.status, p?.state]
    .map((v) => String(v || '').trim().toLowerCase())
    .filter(Boolean);
  const has = (needle: string) => vals.some((v) => v === needle || v.includes(needle));
  const status = has('paid') || has('sent') || has('processed') ? 'paid' : has('approved') || has('approve') ? 'approved' : has('rejected') || has('reject') || has('declined') || has('decline') ? 'rejected' : 'pending';
  const created_at = p?.created_at || p?.earned_at || null;

  return { ...p, payout_id, job_id, pro_id, amount, status, created_at };
}

async function loadProsIndex(sb: any): Promise<Map<string, any>> {
  const index = new Map<string, any>();

  const tryLoad = async (table: string) => {
    try {
      const { data, error } = await sb.from(table).select('*').limit(2000);
      if (error || !Array.isArray(data)) return false;
      for (const p of data) {
        const proId = String(p?.pro_id || p?.tech_id || p?.id || '').trim();
        const email = String(p?.email || p?.pro_email || p?.tech_email || '').trim().toLowerCase();
        if (proId) index.set(proId, p);
        if (email) index.set(email, p);
      }
      return true;
    } catch {
      return false;
    }
  };

  if (await tryLoad('h2s_dispatch_pros')) return index;
  await tryLoad('h2s_pros');
  return index;
}

function pickProDisplay(proRow: any, proId: string) {
  const name = proRow?.name || proRow?.pro_name || proRow?.full_name || null;
  const email = proRow?.email || proRow?.pro_email || proRow?.tech_email || null;
  return {
    pro_id: proId,
    pro_name: name || (proId ? `Pro ${String(proId).slice(0, 8)}` : 'Unknown Pro'),
    pro_email: email || null,
    is_active: proRow?.is_active !== false && String(proRow?.status || '').toLowerCase() !== 'inactive',
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

  // Note: dipatch.html sends {admin_token: ADMIN_TOKEN}
  const auth = await requireAdmin({ request, body, supabaseClient: dispatchClient as any });
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error, error_code: auth.error_code }, { status: auth.status, headers: corsHeaders(request) });
  }

  const sb: any = dispatchClient as any;

  const weekStart = startOfWeekIso(body?.week_start);
  const since = new Date(`${weekStart}T00:00:00.000Z`);
  const until = new Date(since.getTime() + 7 * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();
  const untilIso = until.toISOString();

  let hit: { table: string; rows: any[] } | null = null;
  let firstOkEmpty: { table: string; rows: any[] } | null = null;
  for (const t of PAYOUT_TABLE_CANDIDATES) {
    const r = await trySelect(sb, t, sinceIso, untilIso);
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

  const payouts = (hit?.rows || []).map(normPayout);

  // Group by pro
  const byPro = new Map<string, any[]>();
  for (const p of payouts) {
    const proId = String(p.pro_id || '').trim();
    if (!proId) continue;
    if (!byPro.has(proId)) byPro.set(proId, []);
    byPro.get(proId)!.push(p);
  }

  const prosIndex = await loadProsIndex(sb);

  const pros = Array.from(byPro.entries()).map(([proId, list]) => {
    let base_payout = 0;
    let bonuses = 0;
    let adjustments = 0;
    let pending = 0;
    let approved = 0;
    let pending_jobs = 0;
    let approved_jobs = 0;
    let oldest_pending_ms: number | null = null;
    let newest_pending_ms: number | null = null;

    for (const p of list) {
      // If table has explicit bonus/adjustment columns, use them; otherwise treat everything as base.
      const bonus = Number(p?.bonus_amount ?? 0) || 0;
      const adj = Number(p?.adjustment_amount ?? 0) || 0;
      const base = Number(p?.base_amount ?? 0) || (p.amount - bonus - adj);

      base_payout += base;
      bonuses += bonus;
      adjustments += adj;

      if (p.status === 'approved') {
        approved += p.amount;
        approved_jobs += 1;
      }
      else if (p.status === 'rejected') {
        // ignore
      } else {
        pending += p.amount;
        pending_jobs += 1;

        const ts = p?.created_at ? new Date(String(p.created_at)).getTime() : NaN;
        if (Number.isFinite(ts)) {
          if (oldest_pending_ms === null || ts < oldest_pending_ms) oldest_pending_ms = ts;
          if (newest_pending_ms === null || ts > newest_pending_ms) newest_pending_ms = ts;
        }
      }
    }

    const total_due = pending + approved;
    const status = pending > 0 ? 'pending' : approved > 0 ? 'approved' : 'none';

    const proRow = prosIndex.get(proId) || null;
    const display = pickProDisplay(proRow, proId);

    return {
      ...display,
      jobs_completed: list.length,
      base_payout,
      bonuses,
      adjustments,
      total_due,
      status,
      pending_jobs,
      approved_jobs,
      oldest_pending_at: oldest_pending_ms !== null ? new Date(oldest_pending_ms).toISOString() : null,
      newest_pending_at: newest_pending_ms !== null ? new Date(newest_pending_ms).toISOString() : null,
    };
  });

  // Summary
  const total_pending = pros.reduce((acc, p) => acc + (p.status === 'pending' ? p.total_due : 0), 0);
  const total_approved = pros.reduce((acc, p) => acc + (p.status === 'approved' ? p.total_due : 0), 0);
  const week_total = pros.reduce((acc, p) => acc + p.total_due, 0);
  const jobs_count = payouts.filter((p) => p.job_id).length;

  return NextResponse.json(
    {
      ok: true,
      week_start: weekStart,
      summary: {
        total_pending,
        total_approved,
        week_total,
        pros_count: pros.length,
        jobs_count,
        bonuses_count: pros.reduce((acc, p) => acc + (p.bonuses > 0 ? 1 : 0), 0),
      },
      pros: pros.sort((a, b) => {
        // Default ordering: pending first; within pending, oldest waiting first.
        const aPending = a.status === 'pending';
        const bPending = b.status === 'pending';
        if (aPending !== bPending) return aPending ? -1 : 1;

        const aOld = a.oldest_pending_at ? new Date(String(a.oldest_pending_at)).getTime() : Number.POSITIVE_INFINITY;
        const bOld = b.oldest_pending_at ? new Date(String(b.oldest_pending_at)).getTime() : Number.POSITIVE_INFINITY;
        if (aOld !== bOld) return aOld - bOld;

        // Tie-breakers
        if (a.total_due !== b.total_due) return b.total_due - a.total_due;
        return String(a.pro_name || '').localeCompare(String(b.pro_name || ''));
      }),
      meta: {
        source_table: hit?.table || null,
        admin: auth.adminEmail,
        token_key_seen: pickTokenFrom(request, body) ? 'token' : 'missing',
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
