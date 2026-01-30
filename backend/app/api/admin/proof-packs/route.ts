import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function corsHeaders(request?: Request) {
  const origin = String(request?.headers?.get('origin') || '').trim();
  const allowOrigin = origin || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin === 'null' ? '*' : allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cache-Control, X-Requested-With, X-Admin-Key, x-admin-key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  } as Record<string, string>;
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const n = parseInt(String(value || ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const surface = String(searchParams.get('surface') || 'bundles').trim();
  const service = String(searchParams.get('service') || '').trim();
  const limit = clampInt(searchParams.get('limit'), 200, 1, 500);

  if (!service) {
    return NextResponse.json({ ok: false, error: 'service required' }, { status: 400, headers: corsHeaders(request) });
  }

  let client;
  try {
    client = getSupabase();
  } catch {
    return NextResponse.json({ ok: true, packs: [], message: 'Database unavailable' }, { status: 200, headers: corsHeaders(request) });
  }

  // Prefer week_of desc (most recent rotation week first). Fall back to created_at if schema differs.
  let rows: any[] = [];
  try {
    const { data, error } = await client
      .from('proof_packs')
      .select('*')
      .eq('surface', surface)
      .eq('service', service)
      .order('week_of', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json({ ok: true, packs: [], message: error.message }, { status: 200, headers: corsHeaders(request) });
    }
    rows = (data || []) as any[];
  } catch (e: any) {
    return NextResponse.json({ ok: true, packs: [], message: String(e?.message || e) }, { status: 200, headers: corsHeaders(request) });
  }

  return NextResponse.json({ ok: true, surface, service, packs: rows }, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  let body: any = null;
  try {
    body = await request.json();
  } catch {
    // ignore
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400, headers: corsHeaders(request) });
  }

  const surface = String(body.surface || 'bundles').trim();
  const service = String(body.service || '').trim();
  const weekOf = String(body.week_of || '').trim();
  const title = body.title === null || body.title === undefined ? null : String(body.title).trim();
  const status = String(body.status || 'draft').trim();

  if (!service) {
    return NextResponse.json({ ok: false, error: 'service required' }, { status: 400, headers: corsHeaders(request) });
  }
  if (!weekOf) {
    return NextResponse.json({ ok: false, error: 'week_of required' }, { status: 400, headers: corsHeaders(request) });
  }

  let client;
  try {
    client = getSupabase();
  } catch {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 503, headers: corsHeaders(request) });
  }

  const insertRow: Record<string, any> = {
    surface,
    service,
    week_of: weekOf,
    title,
    status,
  };

  const { data, error } = await client.from('proof_packs').insert(insertRow).select('*').limit(1);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders(request) });
  }

  const pack = Array.isArray(data) && data.length ? data[0] : null;
  return NextResponse.json({ ok: true, pack }, { headers: corsHeaders(request) });
}
