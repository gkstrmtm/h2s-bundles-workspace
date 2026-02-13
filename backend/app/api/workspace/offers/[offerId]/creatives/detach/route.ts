import { NextRequest, NextResponse } from 'next/server';
import { assertAdminIfConfigured } from '@/app/api/_lib/admin';
import { getSupabase, getSupabaseMgmt } from '@/lib/supabase';

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
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-h2s-admin-token, x-h2s-admin-key, x-correlation-id, x-request-id',
  };

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

function getDeliverablesDb() {
  try {
    const mgmt = getSupabaseMgmt();
    if (mgmt) return mgmt;
  } catch {
    // ignore
  }
  return getSupabase();
}

export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ offerId: string }> }) {
  try {
    assertAdminIfConfigured(request);

    const { offerId } = await ctx.params;
    const body = await request.json();

    const creativeId = String(body?.creativeId || body?.creative_id || '').trim();
    if (!creativeId) {
      return NextResponse.json(
        { ok: false, error: 'creativeId is required' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const db = getDeliverablesDb();

    const { error } = await db
      .from('ad_creative_links')
      .delete()
      .eq('creative_id', creativeId)
      .eq('offer_id', offerId);

    if (error) {
      return NextResponse.json(
        { ok: false, error: `Failed to detach creative: ${error.message}` },
        { status: 500, headers: corsHeaders(request) }
      );
    }

    return NextResponse.json({ ok: true }, { headers: corsHeaders(request) });
  } catch (e: any) {
    const status = Number(e?.statusCode || 500);
    return NextResponse.json(
      { ok: false, error: e?.message || 'Unknown error' },
      { status, headers: corsHeaders(request) }
    );
  }
}
