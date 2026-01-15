import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/auth';

async function validateLegacyAdminSession(client: any, token: string): Promise<string | null> {
  if (!token) return null;
  try {
    const { data, error } = await client
      .from('h2s_admin_sessions')
      .select('email')
      .eq('session_id', token)
      .single();
    if (error || !data) return null;
    return data.email ? String(data.email) : null;
  } catch {
    return null;
  }
}

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

const ANNOUNCEMENT_TABLE_CANDIDATES = [
  'h2s_dispatch_announcements',
  'dispatch_announcements',
  'h2s_portal_announcements',
  'portal_announcements',
  'team_announcements',
  'h2s_team_announcements',
  'h2s_announcements',
  'announcements',
];

function pickTokenFrom(req: Request): string {
  const url = new URL(req.url);
  return url.searchParams.get('token') || '';
}

function normalizeBody(raw: any) {
  const title = String(raw?.title || '').trim();
  const message = String(raw?.message || '').trim();
  const type = String(raw?.type || 'info').trim();
  const priorityRaw = raw?.priority;
  const priority = Number.isFinite(Number(priorityRaw)) ? Number(priorityRaw) : priorityRaw ?? 'normal';
  const video_url = String(raw?.video_url || raw?.videoUrl || '').trim();
  const expires_at = String(raw?.expires_at || raw?.expiresAt || '').trim();
  const is_active =
    raw?.is_active === false || raw?.is_active === 'false' || raw?.active === false || raw?.active === 'false'
      ? false
      : true;
  const created_by = String(raw?.created_by || raw?.createdBy || '').trim();

  return { title, message, type, priority, video_url, expires_at, is_active, created_by };
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

export async function POST(request: Request) {
  try {
    const token = pickTokenFrom(request) || '';

    const body = await request.json();
    const normalized = normalizeBody(body);

    // Legacy portal allows admin access either via explicit created_by OR via h2s_admin_sessions session token.
    const signed = token ? await verifyPortalToken(token) : null;
    const signedAdminEmail = signed?.role === 'admin' ? (signed.email || signed.sub || null) : null;

    if (!normalized.title || !normalized.message) {
      return NextResponse.json({ ok: false, error: 'Title and message are required', error_code: 'bad_request' }, { status: 400, headers: corsHeaders(request) });
    }

    const client = getSupabaseDispatch();
    if (!client) {
      return NextResponse.json({ ok: false, error: 'Database not configured', error_code: 'dispatch_db_not_configured' }, { status: 503, headers: corsHeaders(request) });
    }

    const adminEmail =
      normalized.created_by ||
      signedAdminEmail ||
      (await validateLegacyAdminSession(client as any, (body?.admin_token || token || '').toString()));

    if (!adminEmail) {
      return NextResponse.json({ ok: false, error: 'Admin access required', error_code: 'unauthorized' }, { status: 401, headers: corsHeaders(request) });
    }

    const nowIso = new Date().toISOString();

    // Preferred path (legacy backend contract)
    try {
      const announcementData: Record<string, any> = {
        title: normalized.title,
        message: normalized.message,
        type: normalized.type,
        priority: normalized.priority,
        video_url: normalized.video_url || null,
        expires_at: normalized.expires_at || null,
        is_active: normalized.is_active,
        created_by: adminEmail,
        created_at: nowIso,
        updated_at: nowIso,
      };

      const { data: announcement, error: insertError } = await (client as any)
        .from('h2s_announcements')
        .insert(announcementData)
        .select('*')
        .single();

      if (!insertError) {
        return NextResponse.json({ ok: true, announcement: announcement || null, source_table: 'h2s_announcements' }, { headers: corsHeaders(request) });
      }
    } catch {
      // fall through
    }

    // Try a few payload shapes that match common schemas.
    const candidateRows: Record<string, any>[] = [
      {
        announcement_id: cryptoRandomId(),
        title: normalized.title,
        message: normalized.message,
        type: normalized.type,
        priority: normalized.priority,
        video_url: normalized.video_url,
        expires_at: normalized.expires_at || null,
        is_active: normalized.is_active,
        created_by: adminEmail,
        created_at: nowIso,
      },
      {
        id: cryptoRandomId(),
        title: normalized.title,
        message: normalized.message,
        type: normalized.type,
        priority: normalized.priority,
        video_url: normalized.video_url,
        expires_at: normalized.expires_at || null,
        is_active: normalized.is_active,
        created_by: adminEmail,
        created_at: nowIso,
      },
    ];

    for (const table of ANNOUNCEMENT_TABLE_CANDIDATES) {
      for (const row of candidateRows) {
        const inserted = await tryInsert(client, table, row);
        if (inserted.ok) {
          return NextResponse.json({ ok: true, announcement: inserted.data?.[0] || row, source_table: table }, { headers: corsHeaders(request) });
        }
      }
    }

    return NextResponse.json(
      { ok: false, error: 'No announcements table found or insert failed', error_code: 'not_configured' },
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
  // Allow GET for compatibility with portal's GET(action,payload) convention.
  // Expects JSON body in POST normally; here we read query params as a fallback.
  const url = new URL(request.url);
  const payload = Object.fromEntries(url.searchParams.entries());
  return POST(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(payload) }));
}

function cryptoRandomId(): string {
  // lightweight random id without extra deps
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10) +
    '-' +
    Math.random().toString(36).slice(2, 10)
  );
}
