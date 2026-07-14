import { NextResponse } from 'next/server';
import { getOwnerMediaAuthUser, getOwnerMediaPin, createOwnerMediaSessionToken } from '@/lib/ownerMediaAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function corsHeaders(request?: Request) {
  const origin = String(request?.headers?.get('origin') || '').trim();
  const allowOrigin = origin || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin === 'null' ? '*' : allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cache-Control, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  } as Record<string, string>;
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  const me = await getOwnerMediaAuthUser(request);
  if (!me) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
  }

  return NextResponse.json(
    {
      ok: true,
      me: {
        userId: me.userId,
        username: me.username,
        displayName: me.displayName,
        role: me.role,
      },
    },
    { headers: corsHeaders(request) },
  );
}

export async function POST(request: Request) {
  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const pin = String(body?.pin || '').trim();
  const expectedPin = getOwnerMediaPin();

  if (!pin) {
    return NextResponse.json({ ok: false, error: 'PIN is required' }, { status: 400, headers: corsHeaders(request) });
  }
  if (pin !== expectedPin) {
    return NextResponse.json({ ok: false, error: 'Invalid PIN' }, { status: 401, headers: corsHeaders(request) });
  }

  const session = createOwnerMediaSessionToken();

  return NextResponse.json(
    {
      ok: true,
      token: session.token,
      expiresAt: session.expiresAt,
      me: session.me,
      accessMode: 'shared-owner-pin',
    },
    { headers: corsHeaders(request) },
  );
}

export async function DELETE(request: Request) {
  return NextResponse.json({ ok: true, loggedOut: true }, { headers: corsHeaders(request) });
}