import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';

const COOKIE_NAME = 'h2s_hub_session';

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function safeTrim(value: any): string {
  return String(value || '').trim();
}

function getJwtSecret(): Uint8Array | null {
  const raw = safeTrim(process.env.HUB_GATE_JWT_SECRET);
  if (!raw) return null;
  return new TextEncoder().encode(raw);
}

function getExpectedPin(): string {
  // Keep naming flexible so this can be wired quickly in Vercel.
  return safeTrim(process.env.HUB_GATE_PIN || process.env.HUB_GATE_KEY || '');
}

function isGateEnabled(): boolean {
  return !!getExpectedPin();
}

async function verifyCookie(request: NextRequest): Promise<boolean> {
  const secret = getJwtSecret();
  if (!secret) return false;

  const token = safeTrim(request.cookies.get(COOKIE_NAME)?.value);
  if (!token) return false;

  try {
    await jwtVerify(token, secret, { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

async function issueCookie(): Promise<string> {
  const secret = getJwtSecret();
  if (!secret) throw new Error('Missing HUB_GATE_JWT_SECRET');

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60 * 24 * 7; // 7 days

  return await new SignJWT({ scope: 'hub' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secret);
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function GET(request: NextRequest) {
  // If the gate isn't configured yet, treat as open.
  if (!isGateEnabled() || !getJwtSecret()) {
    return NextResponse.json({ ok: true, gate: false }, { headers: corsHeaders() });
  }

  const ok = await verifyCookie(request);
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'Unauthorized', error_code: 'unauthorized' }, { status: 401, headers: corsHeaders() });
  }
  return NextResponse.json({ ok: true, gate: true }, { headers: corsHeaders() });
}

export async function POST(request: NextRequest) {
  try {
    const expectedPin = getExpectedPin();
    if (!expectedPin) {
      return NextResponse.json(
        { ok: false, error: 'Hub gate not configured', error_code: 'not_configured' },
        { status: 503, headers: corsHeaders() }
      );
    }

    const secret = getJwtSecret();
    if (!secret) {
      return NextResponse.json(
        { ok: false, error: 'Hub gate not configured', error_code: 'not_configured' },
        { status: 503, headers: corsHeaders() }
      );
    }

    const body = await request.json().catch(() => ({}));
    const pin = safeTrim(body?.pin || body?.key || body?.password);

    if (!pin || pin !== expectedPin) {
      return NextResponse.json({ ok: false, error: 'Invalid credentials', error_code: 'invalid' }, { status: 403, headers: corsHeaders() });
    }

    const token = await issueCookie();
    const res = NextResponse.json({ ok: true }, { headers: corsHeaders() });
    res.cookies.set({
      name: COOKIE_NAME,
      value: token,
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    return res;
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error', error_code: 'internal_error' }, { status: 500, headers: corsHeaders() });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true }, { headers: corsHeaders() });
  res.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
