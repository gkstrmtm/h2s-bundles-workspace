import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';
import { sendMail } from '@/lib/mail';

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

  /* PS PATCH: mail robustness + idempotency + correct dates — start */
  if (updated && action === 'approve') {
    // Fire-and-forget email (don't block response)
    (async () => {
        try {
            const row = (updated as any).row;
            const clientName = (updated as any).client;
            const sb = clients.find(c => c.name === clientName)?.sb || getSupabase();
            
            // 1. Get Pro Email
            let email = row.pro_email || row.comm_email || row.tech_email;
            if (!email && (row.pro_id || row.tech_id)) {
                // Try finding pro table
                const proId = row.pro_id || row.tech_id;
                // Try standard tables
                for (const t of ['h2s_pros', 'pros', 'technicians']) {
                    const { data: pro } = await sb.from(t).select('email, comm_email').eq('id', proId).single();
                    if (pro) {
                        email = pro.comm_email || pro.email;
                        if (email) break;
                    }
                }
            }
            
            if (email) {
                const amount = Number(row.amount || row.total_amount || 0).toFixed(2);
                await sendMail({
                    to: email,
                    subject: `Payout Approved: $${amount}`,
                    html: `
                    <div style="font-family: sans-serif; color: #333;">
                        <h2>Payout Approved</h2>
                        <p>Your payout has been approved and is being processed.</p>
                        <p><strong>Amount:</strong> $${amount}</p>
                        <p><strong>Job:</strong> ${row.service_name || row.title || row.job_id || 'Service'}</p>
                        <p><strong>Reference:</strong> ${payoutId}</p>
                    </div>
                    `,
                    category: 'payout_approved',
                    idempotencyKey: `payout_approved:${payoutId}`,
                    meta: { payoutId, proId: row.pro_id || row.tech_id }
                });
            } else {
                console.warn('[PAYOUT_MAIL] Could not find email for pro', row.pro_id);
            }
        } catch (e) {
            console.error('[PAYOUT_MAIL] Failed to send approval email:', e);
        }
    })();
  }
  /* PS PATCH: mail robustness + idempotency + correct dates — end */

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
