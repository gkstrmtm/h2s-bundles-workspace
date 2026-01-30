import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function corsHeaders(request?: Request) {
  const origin = String(request?.headers?.get('origin') || '').trim();
  const allowOrigin = origin || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin === 'null' ? '*' : allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
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

async function safeOrderMostRecentFirst(query: any) {
  try {
    return await query.order('updated_at', { ascending: false }).order('created_at', { ascending: false });
  } catch {
    return await query.order('created_at', { ascending: false });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const assetId = String(searchParams.get('asset_id') || '').trim();
  const packId = String(searchParams.get('pack_id') || '').trim();
  const limit = clampInt(searchParams.get('limit'), 500, 1, 2000);
  const isVisibleParam = searchParams.get('is_visible');
  const isVisible = isVisibleParam === null ? null : (String(isVisibleParam).toLowerCase() === 'true' || String(isVisibleParam) === '1');

  let client;
  try {
    client = getSupabase();
  } catch {
    return NextResponse.json({ ok: true, assets: [], message: 'Database unavailable' }, { status: 200, headers: corsHeaders(request) });
  }

  if (assetId) {
    const { data, error } = await client.from('proof_assets').select('*').eq('asset_id', assetId).limit(1);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders(request) });
    }
    const asset = Array.isArray(data) && data.length ? data[0] : null;
    return NextResponse.json({ ok: true, asset }, { headers: corsHeaders(request) });
  }

  if (!packId) {
    return NextResponse.json({ ok: false, error: 'pack_id or asset_id required' }, { status: 400, headers: corsHeaders(request) });
  }

  let q: any = client.from('proof_assets').select('*').eq('pack_id', packId);
  if (isVisible !== null) q = q.eq('is_visible', isVisible);
  q = q.limit(limit);
  q = await safeOrderMostRecentFirst(q);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders(request) });
  }

  return NextResponse.json({ ok: true, pack_id: packId, assets: data || [] }, { headers: corsHeaders(request) });
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

  let client;
  try {
    client = getSupabase();
  } catch {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 503, headers: corsHeaders(request) });
  }

  const nowIso = new Date().toISOString();
  const insertRow: Record<string, any> = { ...body, created_at: body.created_at ?? nowIso, updated_at: body.updated_at ?? nowIso };

  const { data, error } = await client.from('proof_assets').insert(insertRow).select('*').limit(1);
  if (error) {
    // Retry without timestamps in case schema auto-handles or lacks columns.
    const { data: data2, error: error2 } = await client.from('proof_assets').insert(body).select('*').limit(1);
    if (error2) {
      return NextResponse.json({ ok: false, error: error2.message }, { status: 500, headers: corsHeaders(request) });
    }
    const asset = Array.isArray(data2) && data2.length ? data2[0] : null;
    return NextResponse.json({ ok: true, asset }, { headers: corsHeaders(request) });
  }

  const asset = Array.isArray(data) && data.length ? data[0] : null;
  return NextResponse.json({ ok: true, asset }, { headers: corsHeaders(request) });
}

export async function PATCH(request: Request) {
  let body: any = null;
  try {
    body = await request.json();
  } catch {
    // ignore
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400, headers: corsHeaders(request) });
  }

  const assetId = String(body.asset_id || '').trim();
  if (!assetId) {
    return NextResponse.json({ ok: false, error: 'asset_id required' }, { status: 400, headers: corsHeaders(request) });
  }

  const patch: Record<string, any> = { ...body };
  delete patch.asset_id;

  if (!Object.keys(patch).length) {
    return NextResponse.json({ ok: false, error: 'No fields to update' }, { status: 400, headers: corsHeaders(request) });
  }

  const nowIso = new Date().toISOString();

  let client;
  try {
    client = getSupabase();
  } catch {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 503, headers: corsHeaders(request) });
  }

  // Best-effort bump updated_at; fall back if schema does not have it.
  const patchWithTs = { ...patch, updated_at: nowIso };

  {
    const r = await client.from('proof_assets').update(patchWithTs).eq('asset_id', assetId).select('*').limit(1);
    if (!r.error) {
      const asset = Array.isArray(r.data) && r.data.length ? r.data[0] : null;
      return NextResponse.json({ ok: true, asset }, { headers: corsHeaders(request) });
    }

    const r2 = await client.from('proof_assets').update(patch).eq('asset_id', assetId).select('*').limit(1);
    if (r2.error) {
      return NextResponse.json({ ok: false, error: r2.error.message }, { status: 500, headers: corsHeaders(request) });
    }
    const asset = Array.isArray(r2.data) && r2.data.length ? r2.data[0] : null;
    return NextResponse.json({ ok: true, asset }, { headers: corsHeaders(request) });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const assetId = String(searchParams.get('asset_id') || '').trim();
  if (!assetId) {
    return NextResponse.json({ ok: false, error: 'asset_id required' }, { status: 400, headers: corsHeaders(request) });
  }

  let client;
  try {
    client = getSupabase();
  } catch {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 503, headers: corsHeaders(request) });
  }

  const { error } = await client.from('proof_assets').delete().eq('asset_id', assetId);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders(request) });
  }

  return NextResponse.json({ ok: true }, { headers: corsHeaders(request) });
}
