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
  // Keep this endpoint safe: do not return actual secrets.
  const has = (name: string) => !!process.env[name];

  return NextResponse.json(
    {
      ok: true,
      env: {
        DATABASE_URL: has('DATABASE_URL'),
        SUPABASE_URL: has('SUPABASE_URL'),
        SUPABASE_ANON_KEY: has('SUPABASE_ANON_KEY'),
        SUPABASE_SERVICE_KEY: has('SUPABASE_SERVICE_KEY') || has('SUPABASE_SERVICE_ROLE_KEY'),
        SUPABASE_URL_DB1: has('SUPABASE_URL_DB1'),
        SUPABASE_SERVICE_KEY_DB1: has('SUPABASE_SERVICE_KEY_DB1'),
        SUPABASE_URL_MGMT: has('SUPABASE_URL_MGMT'),
        SUPABASE_SERVICE_KEY_MGMT: has('SUPABASE_SERVICE_KEY_MGMT'),
        SUPABASE_URL_DISPATCH: has('SUPABASE_URL_DISPATCH'),
        SUPABASE_SERVICE_KEY_DISPATCH: has('SUPABASE_SERVICE_KEY_DISPATCH'),
        SUPABASE_ANON_KEY_DISPATCH: has('SUPABASE_ANON_KEY_DISPATCH'),
      },
      note: 'Values are redacted; only presence is reported.',
    },
    { headers: corsHeaders(request) }
  );
}
