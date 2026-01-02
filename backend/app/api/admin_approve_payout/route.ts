import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';

const PAYOUT_TABLE_CANDIDATES = [
  'h2s_payouts_ledger',
  'h2s_dispatch_payouts_ledger',
  'h2s_dispatch_payouts',
  'dispatch_payouts',
  'h2s_payouts',
  'payouts',
];

async function tryUpdateById(sb: any, table: string, idCol: string, id: string, patch: any) {
  try {
    const { data, error } = await sb.from(table).update(patch).eq(idCol as any, id).select('*').limit(1);
    if (!error && Array.isArray(data) && data.length) return { ok: true as const, table, row: data[0] };
  } catch {
    // ignore
  }
  return { ok: false as const };
}

async function handle(request: Request, body: any) {
  const payoutId = String(body?.payout_id || body?.entry_id || '').trim();
  const action = String(body?.action || '').trim().toLowerCase();

  if (!payoutId || !action) {
    return NextResponse.json(
      { ok: false, error: 'payout_id and action are required', error_code: 'bad_request' },
      { status: 400, headers: corsHeaders(request) }
    );
  }
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json(
      { ok: false, error: 'action must be approve or reject', error_code: 'bad_request' },
      { status: 400, headers: corsHeaders(request) }
    );
  }

  const dispatchClient = getSupabaseDispatch();
  let mainClient: any = null;
  try {
    mainClient = getSupabase();
  } catch {
    mainClient = null;
  }

  if (!dispatchClient && !mainClient) {
    return NextResponse.json(
      { ok: false, error: 'Database not configured', error_code: 'db_not_configured' },
      { status: 503, headers: corsHeaders(request) }
    );
  }

  // Use dispatch client for legacy session validation when available.
  const auth = await requireAdmin({ request, body, supabaseClient: (dispatchClient || mainClient) as any });
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error, error_code: auth.error_code }, { status: auth.status, headers: corsHeaders(request) });
  }

  const clients: Array<{ name: string; sb: any }> = [];
  if (dispatchClient) clients.push({ name: 'dispatch', sb: dispatchClient as any });
  if (mainClient && mainClient !== dispatchClient) clients.push({ name: 'main', sb: mainClient as any });
  const now = new Date().toISOString();
  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  const patches = [
    // Minimal patches first (some tables don't have updated_at/approved_at)
    { status: newStatus },
    { state: newStatus },
    { payout_status: newStatus },

    // Richer patches for schemas that support timestamps
    { status: newStatus, updated_at: now, approved_at: action === 'approve' ? now : null },
    { state: newStatus, updated_at: now, approved_at: action === 'approve' ? now : null },
    { payout_status: newStatus, updated_at: now, approved_at: action === 'approve' ? now : null },
  ];

  let updated: { client: string; table: string; row: any } | null = null;

  for (const c of clients) {
    for (const table of PAYOUT_TABLE_CANDIDATES) {
      for (const idCol of ['payout_id', 'entry_id', 'id']) {
        for (const patch of patches) {
          const r = await tryUpdateById(c.sb, table, idCol, payoutId, patch);
          if ((r as any).ok) {
            updated = { client: c.name, table: (r as any).table, row: (r as any).row };
            break;
          }
        }
        if (updated) break;
      }
      if (updated) break;
    }
    if (updated) break;
  }

  if (!updated) {
    return NextResponse.json(
      { ok: false, error: 'Payout not found or update failed', error_code: 'not_found' },
      { status: 404, headers: corsHeaders(request) }
    );
  }

  // Notification is optional; dispatch UI only displays it if present.
  const notification =
    action === 'approve'
      ? {
          sent: false,
          skipped: true,
          error: null,
          note: 'No notification provider configured',
        }
      : undefined;

  return NextResponse.json(
    {
      ok: true,
      message: `Payout ${newStatus}`,
      payout: updated.row,
      notification,
      meta: {
        source_client: updated.client,
        source_table: updated.table,
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
