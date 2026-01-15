import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/auth';

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

function normalizeBody(raw: any) {
  const subject = String(raw?.subject || '').trim();
  const message = String(raw?.message || '').trim();
  const category = String(raw?.category || 'General').trim() || 'General';
  const severity = String(raw?.severity || 'Normal').trim() || 'Normal';
  const current_tab = String(raw?.current_tab || raw?.currentTab || '').trim();
  const app_version = String(raw?.app_version || raw?.appVersion || '').trim();
  const user_agent = String(raw?.user_agent || raw?.userAgent || '').trim();
  return { subject, message, category, severity, current_tab, app_version, user_agent };
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

const SUPPORT_TABLE_CANDIDATES = [
  'Support_Tickets',
  'support_tickets',
  'h2s_support_tickets',
  'portal_support_tickets',
  'h2s_portal_support_tickets',
  'h2s_support',
  'support',
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

    const _auth = await verifyPortalToken(token);
      if (!_auth.ok || !_auth.payload) {
        return NextResponse.json({ ok: false, error: _auth.error || 'Invalid token', error_code: _auth.errorCode || 'bad_session' }, { status: 401, headers: corsHeaders(request) });
      }
      const payload = _auth.payload;
    if (!payload?.sub) {
      return NextResponse.json(
        { ok: false, error: 'Invalid session', error_code: 'bad_session' },
        { status: 401, headers: corsHeaders(request) }
      );
    }

    const normalized = normalizeBody(body);
    if (!normalized.subject || !normalized.message) {
      return NextResponse.json(
        { ok: false, error: 'Missing subject or message', error_code: 'missing_fields' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const client = getSupabase();
    const nowIso = new Date().toISOString();
    const userAgent = normalized.user_agent || request.headers.get('user-agent') || '';

    const ticketId = cryptoRandomId('sup');

    const pro_id = String(payload.sub);
    const pro_email = String(payload.email || '');

    const candidateRows: Record<string, any>[] = [
      // Snake_case (matches legacy GAS storage shape)
      {
        ticket_id: ticketId,
        pro_id,
        pro_email: pro_email || null,
        subject: normalized.subject,
        message: normalized.message,
        category: normalized.category,
        severity: normalized.severity,
        status: 'open',
        created_at: nowIso,
        source: 'portal',
        user_agent: userAgent || null,
        current_tab: normalized.current_tab || null,
        app_version: normalized.app_version || null,
      },
      // Common camelCase schemas
      {
        ticketId,
        proId: pro_id,
        proEmail: pro_email || null,
        subject: normalized.subject,
        message: normalized.message,
        category: normalized.category,
        severity: normalized.severity,
        status: 'open',
        createdAt: nowIso,
        source: 'portal',
        userAgent: userAgent || null,
        currentTab: normalized.current_tab || null,
        appVersion: normalized.app_version || null,
      },
      // Minimal row (for very simple schemas)
      {
        id: ticketId,
        pro_id,
        subject: normalized.subject,
        message: normalized.message,
        created_at: nowIso,
        source: 'portal',
      },
    ];

    for (const table of SUPPORT_TABLE_CANDIDATES) {
      for (const row of candidateRows) {
        const inserted = await tryInsert(client, table, row);
        if (inserted.ok) {
          return NextResponse.json(
            {
              ok: true,
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
          'Support ticket storage is not configured on this backend (no writable support tickets table found).',
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
