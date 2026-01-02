import { NextResponse } from 'next/server';
import { issuePortalToken } from '@/lib/portalTokens';

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

function normalizeEmail(email: any): string {
  return String(email || '').trim().toLowerCase();
}

function normalizeZip(zip: any): string {
  return String(zip || '').trim();
}

function getAdminCreds() {
  return {
    email: normalizeEmail(process.env.PORTAL_ADMIN_EMAIL || 'dispatch@h2s.com'),
    zip: normalizeZip(process.env.PORTAL_ADMIN_ZIP || '29649'),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = normalizeEmail(body?.email);
    const zip = normalizeZip(body?.zip);

    if (!email || !zip) {
      return NextResponse.json({ ok: false, error: 'Email and ZIP required' }, { status: 400, headers: corsHeaders(request) });
    }

    const admin = getAdminCreds();
    if (email !== admin.email || zip !== admin.zip) {
      return NextResponse.json({ ok: false, error: 'Invalid admin credentials' }, { status: 401, headers: corsHeaders(request) });
    }

    const token = issuePortalToken({ sub: email, role: 'admin', email });

    return NextResponse.json({ ok: true, token }, { headers: corsHeaders(request) });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Internal error' }, { status: 500, headers: corsHeaders(request) });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const email = searchParams.get('email');
  const zip = searchParams.get('zip');
  return POST(
    new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ email, zip }),
    })
  );
}
