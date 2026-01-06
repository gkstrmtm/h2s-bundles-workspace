import { NextResponse } from 'next/server';
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

export async function POST(request: Request) {
  try {
    const bearer = readBearer(request);
    const body = await request.json();

    const token = String(body?.token || bearer || '').trim();
    if (!token) {
      return NextResponse.json({ ok: false, error: 'Missing token', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }

    const payload = verifyPortalToken(token);
    if (payload.role !== 'pro') {
      return NextResponse.json({ ok: false, error: 'Not a pro session', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }

    // Best-effort: accept the log payload, but do not require a backing table.
    // This endpoint exists to keep the Customers tab from hard-failing.
    const accepted = {
      order_id: body?.order_id ?? null,
      customer_phone: body?.customer_phone ?? null,
      customer_email: body?.customer_email ?? null,
      customer_name: body?.customer_name ?? null,
      call_reason: body?.call_reason ?? null,
      call_outcome: body?.call_outcome ?? null,
      notes: body?.notes ?? null,
      follow_up_date: body?.follow_up_date ?? null,
    };

    return NextResponse.json({ ok: true, stored: false, accepted }, { headers: corsHeaders(request) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error' }, { status: 500, headers: corsHeaders(request) });
  }
}
