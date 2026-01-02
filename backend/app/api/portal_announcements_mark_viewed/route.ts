import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/portalTokens';

async function validateLegacyProSession(client: any, token: string): Promise<string | null> {
  if (!token) return null;
  try {
    const { data, error } = await client
      .from('h2s_sessions')
      .select('pro_id, expires_at')
      .eq('session_id', token)
      .single();

    if (error || !data) return null;
    if (data.expires_at && new Date() > new Date(data.expires_at)) return null;
    return data.pro_id ? String(data.pro_id) : null;
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

const VIEW_TABLE_CANDIDATES = [
  'h2s_dispatch_announcement_views',
  'h2s_dispatch_announcement_viewed',
  'h2s_announcement_views',
  'announcement_views',
  'h2s_dispatch_announcement_reads',
  'announcement_reads',
];

async function tryInsertViewed(client: any, table: string, row: Record<string, any>) {
  try {
    const { error } = await client.from(table).insert(row);
    if (!error) return { ok: true };
  } catch {
    // ignore
  }
  return { ok: false };
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || '').trim());
}

async function handle(request: Request) {
  const dispatchClient = getSupabaseDispatch();

  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  const announcementId = url.searchParams.get('announcement_id') || url.searchParams.get('id') || '';

  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'Missing token', error_code: 'bad_session' },
      { status: 401, headers: corsHeaders(request) }
    );
  }

  if (!announcementId) {
    return NextResponse.json(
      { ok: false, error: 'Missing announcement_id', error_code: 'bad_request' },
      { status: 400, headers: corsHeaders(request) }
    );
  }

  const payload = verifyPortalToken(token);
  const isSignedPro = payload?.role === 'pro' && !!payload?.sub;

  // If we cannot persist viewed state, treat as non-critical and still return ok.
  if (!dispatchClient) {
    return NextResponse.json({ ok: true }, { headers: corsHeaders(request) });
  }

  const proId = isSignedPro ? String(payload.sub) : await validateLegacyProSession(dispatchClient as any, token);
  if (!proId) {
    return NextResponse.json(
      { ok: false, error: 'Invalid/expired session', error_code: 'bad_session' },
      { status: 401, headers: corsHeaders(request) }
    );
  }

  const proEmail = isSignedPro ? payload.email || null : null;

  // Preferred path (legacy backend contract): upsert into h2s_announcement_views
  try {
    const { error } = await (dispatchClient as any)
      .from('h2s_announcement_views')
      .upsert(
        {
          announcement_id: announcementId,
          pro_id: proId,
          viewed_at: new Date().toISOString(),
        },
        { onConflict: 'announcement_id,pro_id' }
      );

    if (!error) {
      return NextResponse.json({ ok: true, stored: true, source_table: 'h2s_announcement_views' }, { headers: corsHeaders(request) });
    }
  } catch {
    // fall through to best-effort insertion attempts
  }

  // Try a few common schemas; whichever insert succeeds wins.
  const candidateRows: Record<string, any>[] = [
    { announcement_id: announcementId, pro_id: proId, pro_email: proEmail, viewed_at: new Date().toISOString() },
    { announcement_id: announcementId, pro_id: proId, pro_email: proEmail },
    { announcement_id: announcementId, pro_id: proId },
    { announcement_id: announcementId, pro_email: proEmail },
    { announcement_id: announcementId, viewer_id: proId },
    { announcement_id: announcementId, viewer_email: proEmail },
    // Some tables store UUIDs for announcement ids; if input is UUID-like we can map to id too.
    ...(isUuidLike(announcementId) ? [{ id: announcementId, pro_id: proId }] : []),
  ].filter((r) => Object.values(r).some((v) => v !== null && v !== undefined && String(v).length));

  for (const table of VIEW_TABLE_CANDIDATES) {
    for (const row of candidateRows) {
      const inserted = await tryInsertViewed(dispatchClient, table, row);
      if (inserted.ok) {
        return NextResponse.json({ ok: true, stored: true, source_table: table }, { headers: corsHeaders(request) });
      }
    }
  }

  return NextResponse.json({ ok: true, stored: false }, { headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  try {
    return await handle(request);
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
  // Portal currently calls this via GET; POST is kept for flexibility.
  return GET(request);
}
