import { NextRequest, NextResponse } from 'next/server';
import { getOwnerMediaReminderStatus, sendOwnerMediaReminder } from '@/lib/ownerMediaReminder';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function getBearerToken(request: NextRequest): string {
  const auth = String(request.headers.get('authorization') || '').trim();
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const url = new URL(request.url);
  return String(url.searchParams.get('token') || '').trim();
}

function isAuthorized(request: NextRequest): boolean {
  const expected = String(process.env.CRON_SECRET || process.env.DISPATCH_ADMIN_TOKEN || '').trim();
  if (!expected) return false;
  return getBearerToken(request) === expected;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: corsHeaders() });
  }

  try {
    const url = new URL(request.url);
    const dryRun = url.searchParams.get('dryRun') === '1';
    if (dryRun) {
      return NextResponse.json({ ok: true, status: await getOwnerMediaReminderStatus() }, { headers: corsHeaders() });
    }
    const result = await sendOwnerMediaReminder({ force: false });
    return NextResponse.json(result, { headers: corsHeaders() });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 500, headers: corsHeaders() });
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: corsHeaders() });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const force = body?.force !== false;
    const result = await sendOwnerMediaReminder({ force });
    return NextResponse.json(result, { headers: corsHeaders() });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 500, headers: corsHeaders() });
  }
}
