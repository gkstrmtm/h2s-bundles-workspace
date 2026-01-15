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

async function tryDelete(client: any, table: string, idCol: string, id: string) {
  try {
    const { error } = await client.from(table).delete().eq(idCol as any, id);
    if (!error) return { ok: true as const };
  } catch {
    // ignore
  }
  return { ok: false as const };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token') || '';
    const id = url.searchParams.get('announcement_id') || url.searchParams.get('id') || '';

    if (!id) {
      return NextResponse.json({ ok: false, error: 'announcement_id required', error_code: 'bad_request' }, { status: 400, headers: corsHeaders(request) });
    }

    const client = getSupabaseDispatch();
    if (!client) {
      return NextResponse.json({ ok: false, error: 'Database not configured', error_code: 'dispatch_db_not_configured' }, { status: 503, headers: corsHeaders(request) });
    }

    // Legacy admin validation: allow signed admin token or a legacy admin session token.
    const signed = token ? await verifyPortalToken(token) : null;
    const signedAdminEmail = signed?.role === 'admin' ? (signed.email || signed.sub || null) : null;
    const adminEmail = signedAdminEmail || (await validateLegacyAdminSession(client as any, token));

    if (!adminEmail) {
      return NextResponse.json({ ok: false, error: 'Admin access required', error_code: 'unauthorized' }, { status: 401, headers: corsHeaders(request) });
    }

    // Preferred path (legacy backend contract)
    try {
      const { error } = await (client as any).from('h2s_announcements').delete().eq('announcement_id', id);
      if (!error) {
        return NextResponse.json({ ok: true, deleted: true, source_table: 'h2s_announcements' }, { headers: corsHeaders(request) });
      }
    } catch {
      // fall through
    }

    for (const table of ANNOUNCEMENT_TABLE_CANDIDATES) {
      for (const idCol of ['announcement_id', 'id']) {
        const deleted = await tryDelete(client, table, idCol, id);
        if (deleted.ok) {
          return NextResponse.json({ ok: true, deleted: true, source_table: table }, { headers: corsHeaders(request) });
        }
      }
    }

    return NextResponse.json({ ok: false, error: 'Delete failed', error_code: 'not_found' }, { status: 404, headers: corsHeaders(request) });
  } catch (error: any) {
    const msg = error?.message || 'Internal error';
    const isAuth = /token/i.test(msg) || /signature/i.test(msg) || /expired/i.test(msg) || /format/i.test(msg);

    return NextResponse.json(
      { ok: false, error: msg, error_code: isAuth ? 'bad_session' : 'server_error' },
      { status: isAuth ? 401 : 500, headers: corsHeaders(request) }
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
