import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/portalTokens';

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'http://localhost:3000',
    'http://localhost:8080'
  ];

  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

const PRO_TABLE_CANDIDATES = [
  // Mixed-case table (quoted identifier) in some Supabase projects.
  'H2S_Pros',
  'h2s_dispatch_pros',
  'h2s_pros',
  'h2s_pro_profiles',
  'h2s_techs',
  'h2s_technicians',
];

const ID_COLUMNS = ['pro_id', 'Pro_ID', 'id', 'tech_id', 'Tech_ID'];

function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null && String(obj[k]).length) return obj[k];
  }
  return null;
}

async function tryGetProById(client: any, proId: string) {
  for (const table of PRO_TABLE_CANDIDATES) {
    for (const idCol of ID_COLUMNS) {
      try {
        const { data, error } = await client.from(table).select('*').eq(idCol as any, proId).limit(1);
        if (error) continue;
        const row = data?.[0];
        if (row) return { table, row };
      } catch {
        // ignore
      }
    }
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token') || '';

    if (!token) {
      return NextResponse.json(
        { ok: false, error: 'Missing token', error_code: 'bad_session' },
        { status: 401, headers: corsHeaders(request) }
      );
    }

    const payload = verifyPortalToken(token);
    if (payload.role !== 'pro') {
      return NextResponse.json(
        { ok: false, error: 'Not a pro session', error_code: 'bad_session' },
        { status: 401, headers: corsHeaders(request) }
      );
    }

    const dispatchClient = getSupabaseDispatch();
    if (!dispatchClient) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Dispatch database not configured (set SUPABASE_URL_DISPATCH / SUPABASE_SERVICE_KEY_DISPATCH)',
          error_code: 'dispatch_db_not_configured',
        },
        { status: 503, headers: corsHeaders(request) }
      );
    }

    const hit = await tryGetProById(dispatchClient, payload.sub);

    // Even if we can't fetch profile row, return a usable shape.
    const proId = payload.sub;
    const email =
      payload.email ||
      pickFirst(hit?.row, ['email', 'Email', 'pro_email', 'tech_email', 'professional_email', 'user_email']) ||
      '';

    return NextResponse.json(
      {
        ok: true,
        me: {
          pro_id: proId,
          email,
          profile: hit?.row || null,
          source_table: hit?.table || null,
        },
      },
      { headers: corsHeaders(request) }
    );
  } catch (error: any) {
    const msg = error?.message || 'Internal error';
    const isAuth = /token/i.test(msg) || /signature/i.test(msg) || /expired/i.test(msg);
    return NextResponse.json(
      { ok: false, error: msg, error_code: isAuth ? 'bad_session' : 'server_error' },
      { status: isAuth ? 401 : 500, headers: corsHeaders(request) }
    );
  }
}
