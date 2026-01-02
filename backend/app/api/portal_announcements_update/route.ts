import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/portalTokens';

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

function normalizeBody(raw: any) {
  const announcement_id = String(raw?.announcement_id || raw?.id || '').trim();
  const title = raw?.title !== undefined ? String(raw.title).trim() : undefined;
  const message = raw?.message !== undefined ? String(raw.message).trim() : undefined;
  const type = raw?.type !== undefined ? String(raw.type).trim() : undefined;
  const priority =
    raw?.priority !== undefined
      ? Number.isFinite(Number(raw?.priority))
        ? Number(raw.priority)
        : raw.priority
      : undefined;
  const video_url = raw?.video_url !== undefined ? String(raw.video_url || '').trim() : undefined;
  const expires_at = raw?.expires_at !== undefined ? String(raw.expires_at || '').trim() : undefined;
  const is_active = raw?.is_active !== undefined ? !(raw.is_active === false || raw.is_active === 'false') : undefined;

  return { announcement_id, title, message, type, priority, video_url, expires_at, is_active };
}

async function tryUpdate(client: any, table: string, idCol: string, id: string, patch: Record<string, any>) {
  try {
    const { data, error } = await client.from(table).update(patch).eq(idCol as any, id).select('*').limit(1);
    if (!error) return { ok: true as const, data };
  } catch {
    // ignore
  }
  return { ok: false as const };
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token') || '';

    const body = await request.json();
    const normalized = normalizeBody(body);

    if (!normalized.announcement_id) {
      return NextResponse.json({ ok: false, error: 'announcement_id required', error_code: 'bad_request' }, { status: 400, headers: corsHeaders(request) });
    }

    const client = getSupabaseDispatch();
    if (!client) {
      return NextResponse.json({ ok: false, error: 'Database not configured', error_code: 'dispatch_db_not_configured' }, { status: 503, headers: corsHeaders(request) });
    }

    // Legacy admin validation: allow explicit created_by OR a signed admin token OR a legacy admin session token.
    const signed = token ? verifyPortalToken(token) : null;
    const signedAdminEmail = signed?.role === 'admin' ? (signed.email || signed.sub || null) : null;
    const adminToken = String((body as any)?.admin_token || (body as any)?.token || token || '');
    const adminEmail = String((body as any)?.created_by || '').trim() || signedAdminEmail || (await validateLegacyAdminSession(client as any, adminToken));

    if (!adminEmail) {
      return NextResponse.json({ ok: false, error: 'Admin access required', error_code: 'unauthorized' }, { status: 401, headers: corsHeaders(request) });
    }

    const patch: Record<string, any> = {};
    for (const [k, v] of Object.entries({
      title: normalized.title,
      message: normalized.message,
      type: normalized.type,
      priority: normalized.priority,
      video_url: normalized.video_url,
      expires_at: normalized.expires_at === '' ? null : normalized.expires_at,
      is_active: normalized.is_active,
      updated_at: new Date().toISOString(),
    })) {
      if (v !== undefined) patch[k] = v;
    }

    // Preferred path (legacy backend contract): update h2s_announcements by announcement_id
    try {
      const { data, error } = await (client as any)
        .from('h2s_announcements')
        .update(patch)
        .eq('announcement_id', normalized.announcement_id)
        .select('*')
        .single();

      if (!error && data) {
        return NextResponse.json({ ok: true, announcement: data, source_table: 'h2s_announcements' }, { headers: corsHeaders(request) });
      }
    } catch {
      // fall through
    }

    for (const table of ANNOUNCEMENT_TABLE_CANDIDATES) {
      for (const idCol of ['announcement_id', 'id']) {
        const updated = await tryUpdate(client, table, idCol, normalized.announcement_id, patch);
        if (updated.ok) {
          return NextResponse.json({ ok: true, announcement: updated.data?.[0] || null, source_table: table }, { headers: corsHeaders(request) });
        }
      }
    }

    return NextResponse.json(
      { ok: false, error: 'Update failed (no matching table/id column)', error_code: 'not_found' },
      { status: 404, headers: corsHeaders(request) }
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
  const url = new URL(request.url);
  const payload = Object.fromEntries(url.searchParams.entries());
  return POST(new Request(request.url, { method: 'POST', headers: request.headers, body: JSON.stringify(payload) }));
}
