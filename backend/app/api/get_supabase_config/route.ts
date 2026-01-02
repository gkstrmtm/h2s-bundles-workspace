import { NextResponse } from 'next/server';

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

export async function GET(request: Request) {
  try {
    // Prefer dispatch/portal realtime project if configured; otherwise fall back to main project.
    const url = process.env.SUPABASE_URL_DISPATCH || process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY_DISPATCH || process.env.SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Supabase client config not set (SUPABASE_URL / SUPABASE_ANON_KEY)',
          hasUrl: !!url,
          hasAnonKey: !!anonKey,
        },
        { status: 500, headers: corsHeaders(request) }
      );
    }

    // Intentionally returns ONLY public client config (anon key), never service keys.
    return NextResponse.json(
      {
        ok: true,
        url,
        anonKey,
      },
      { headers: corsHeaders(request) }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Unknown error' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}
