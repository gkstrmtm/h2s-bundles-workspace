import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
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

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

function pickToken(req: Request, body?: any): string {
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const bearer = m?.[1] ? String(m[1]).trim() : '';
  const fromBody = body?.token ? String(body.token).trim() : '';
  const fromQuery = new URL(req.url).searchParams.get('token') || '';
  return bearer || fromBody || fromQuery;
}

function cryptoRandomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function tryInsert(client: any, table: string, row: Record<string, any>) {
  try {
    const { data, error } = await client.from(table).insert(row).select('*').limit(1);
    if (!error) return { ok: true as const, data };
  } catch {
    // ignore
  }
  return { ok: false as const };
}

const FEEDBACK_TABLE_CANDIDATES = [
  'h2s_pro_feedback',
  'portal_feedback',
  'Portal_Feedback',
  'h2s_portal_feedback',
  'portal_feedback_submissions',
  'feedback_submissions',
  'h2s_feedback',
];

// As a hard fallback, treat feedback as a support ticket if a support table exists.
const SUPPORT_TABLE_CANDIDATES = [
  'Support_Tickets',
  'support_tickets',
  'h2s_support_tickets',
  'portal_support_tickets',
  'h2s_portal_support_tickets',
];

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = pickToken(request, body);

    if (!token) {
      return NextResponse.json(
        { ok: false, error: 'Missing token', error_code: 'bad_session' },
        { status: 401, headers: corsHeaders(request) }
      );
    }

    const payload = verifyPortalToken(token);
    if (!payload?.sub) {
      return NextResponse.json(
        { ok: false, error: 'Invalid session', error_code: 'bad_session' },
        { status: 401, headers: corsHeaders(request) }
      );
    }

    const message = String(body?.message || '').trim();
    if (!message) {
      return NextResponse.json(
        { ok: false, error: 'Missing message', error_code: 'missing_fields' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const client = getSupabase();
    const nowIso = new Date().toISOString();
    const feedbackId = cryptoRandomId('fb');

    const pro_id = String(payload.sub);
    const pro_email = String(payload.email || '');
    const userAgent = request.headers.get('user-agent') || '';

    // Prefer legacy table + schema if present.
    // Legacy expects: h2s_pro_feedback(pro_id, pro_name, message)
    try {
      const { data: pro } = await client
        .from('h2s_pros')
        .select('first_name,last_name')
        .eq('pro_id', pro_id)
        .maybeSingle();

      const proNameRaw = [pro?.first_name, pro?.last_name].filter(Boolean).join(' ').trim();
      const pro_name = proNameRaw || pro_email || 'Unknown';

      const inserted = await tryInsert(client, 'h2s_pro_feedback', {
        pro_id,
        pro_name,
        message,
      });

      if (inserted.ok) {
        return NextResponse.json(
          { ok: true, feedback_id: feedbackId, source_table: 'h2s_pro_feedback' },
          { headers: corsHeaders(request) }
        );
      }
    } catch {
      // ignore and fallback to other candidates
    }

    const feedbackRows: Record<string, any>[] = [
      {
        feedback_id: feedbackId,
        pro_id,
        pro_email: pro_email || null,
        message,
        created_at: nowIso,
        source: 'portal',
        user_agent: userAgent || null,
      },
      {
        id: feedbackId,
        pro_id,
        message,
        created_at: nowIso,
        source: 'portal',
      },
      {
        feedbackId,
        proId: pro_id,
        proEmail: pro_email || null,
        message,
        createdAt: nowIso,
        source: 'portal',
        userAgent: userAgent || null,
      },
    ];

    for (const table of FEEDBACK_TABLE_CANDIDATES) {
      if (table === 'h2s_pro_feedback') continue;
      for (const row of feedbackRows) {
        const inserted = await tryInsert(client, table, row);
        if (inserted.ok) {
          return NextResponse.json(
            { ok: true, feedback_id: feedbackId, source_table: table },
            { headers: corsHeaders(request) }
          );
        }
      }
    }

    // Fallback: store as support ticket
    const ticketId = cryptoRandomId('sup');
    const supportRows: Record<string, any>[] = [
      {
        ticket_id: ticketId,
        pro_id,
        pro_email: pro_email || null,
        subject: 'Portal feedback',
        message,
        category: 'Feedback',
        severity: 'Normal',
        status: 'open',
        created_at: nowIso,
        source: 'portal',
        user_agent: userAgent || null,
      },
      {
        id: ticketId,
        pro_id,
        subject: 'Portal feedback',
        message,
        created_at: nowIso,
        source: 'portal',
      },
    ];

    for (const table of SUPPORT_TABLE_CANDIDATES) {
      for (const row of supportRows) {
        const inserted = await tryInsert(client, table, row);
        if (inserted.ok) {
          return NextResponse.json(
            {
              ok: true,
              feedback_id: feedbackId,
              stored_as: 'support_ticket',
              ticket_id: ticketId,
              source_table: table,
            },
            { headers: corsHeaders(request) }
          );
        }
      }
    }

    return NextResponse.json(
      {
        ok: false,
        error:
          'Feedback storage is not configured on this backend (no writable feedback/support table found).',
        error_code: 'not_configured',
      },
      { status: 500, headers: corsHeaders(request) }
    );
  } catch (error: any) {
    const msg = error?.message || 'Internal error';
    const isAuth = /token/i.test(msg) || /signature/i.test(msg) || /expired/i.test(msg) || /format/i.test(msg);

    return NextResponse.json(
      { ok: false, error: msg, error_code: isAuth ? 'bad_session' : 'server_error' },
      { status: isAuth ? 401 : 500, headers: corsHeaders(request) }
    );
  }
}

export async function GET(request: Request) {
  // Compatibility: allow GET with query params.
  const url = new URL(request.url);
  const payload = Object.fromEntries(url.searchParams.entries());
  return POST(
    new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(payload),
    })
  );
}
