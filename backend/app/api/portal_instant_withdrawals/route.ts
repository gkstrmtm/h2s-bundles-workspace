import { NextResponse } from 'next/server';
import { verifyPortalToken } from '@/lib/auth';

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'https://portal.home2smart.com',
    'http://localhost:3000',
    'http://localhost:8080',
  ];

  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (allowOrigin !== '*') headers['Access-Control-Allow-Credentials'] = 'true';
  return headers;
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

function readBearer(request: Request): string {
  const h = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || '').trim() : '';
}

async function handle(request: Request, token: string) {
  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'Missing token', error_code: 'bad_session' },
      { status: 401, headers: corsHeaders(request) }
    );
  }

  try {
    const auth = await verifyPortalToken(token);
    if (!auth.ok || !auth.payload) {
      return NextResponse.json(
        { ok: false, error: auth.error || 'Invalid token', error_code: auth.errorCode || 'bad_session' },
        { status: 401, headers: corsHeaders(request) }
      );
    }

    if (auth.payload.role !== 'pro') {
      return NextResponse.json(
        { ok: false, error: 'Not a pro session', error_code: 'bad_session' },
        { status: 401, headers: corsHeaders(request) }
      );
    }

    // This endpoint exists to support the Payouts "History" view in portal.html.
    // If/when instant withdrawals are implemented, replace this stub with a real table query.
    return NextResponse.json({ ok: true, rows: [] }, { headers: corsHeaders(request) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Invalid token', error_code: 'bad_session' },
      { status: 401, headers: corsHeaders(request) }
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token') || readBearer(request) || '';
  return handle(request, token);
}

export async function POST(request: Request) {
  const bearer = readBearer(request);
  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const token = String(body?.token || bearer || '').trim();
  return handle(request, token);
}
