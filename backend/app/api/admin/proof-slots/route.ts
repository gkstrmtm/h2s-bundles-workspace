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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const surface = String(searchParams.get('surface') || 'bundles').trim();

  let client;
  try {
    client = getSupabase();
  } catch {
    return NextResponse.json({ ok: true, surface, slots: [] }, { status: 200, headers: corsHeaders(request) });
  }

  const { data, error } = await client.from('proof_slots').select('*').eq('surface', surface);
  if (error) {
    return NextResponse.json({ ok: true, surface, slots: [], message: error.message }, { status: 200, headers: corsHeaders(request) });
  }

  return NextResponse.json({ ok: true, surface, slots: data || [] }, { headers: corsHeaders(request) });
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
  const slotKey = String(body.slot_key || '').trim();
  const assetId = body.asset_id ? String(body.asset_id).trim() : '';
  const packId = body.pack_id ? String(body.pack_id).trim() : '';
  const status = String(body.status || 'active').trim();
  const priority = typeof body.priority === 'number' ? body.priority : Number(body.priority || 100);

  if (!service) {
    return NextResponse.json({ ok: false, error: 'service required' }, { status: 400, headers: corsHeaders(request) });
  }
  if (!slotKey) {
    return NextResponse.json({ ok: false, error: 'slot_key required' }, { status: 400, headers: corsHeaders(request) });
  }
  if (!assetId && !packId) {
    return NextResponse.json({ ok: false, error: 'asset_id or pack_id required' }, { status: 400, headers: corsHeaders(request) });
  }

  let client;
  try {
    client = getSupabase();
  } catch {
    return NextResponse.json({ ok: false, error: 'Database unavailable' }, { status: 503, headers: corsHeaders(request) });
  }

  const patch: Record<string, any> = {
    surface,
    service,
    slot_key: slotKey,
    status,
    priority: Number.isFinite(priority) ? priority : 100,
    asset_id: assetId || null,
    pack_id: packId || null,
    updated_at: new Date().toISOString(),
  };

  // Update-if-exists, else insert.
  const upd = await client
    .from('proof_slots')
    .update(patch)
    .eq('surface', surface)
    .eq('service', service)
    .eq('slot_key', slotKey)
    .select('*')
    .limit(1);

  if (!upd.error && Array.isArray(upd.data) && upd.data.length) {
    return NextResponse.json({ ok: true, slot: upd.data[0] }, { headers: corsHeaders(request) });
  }

  // If update failed due to missing updated_at column, retry without.
  if (upd.error && /updated_at/i.test(String(upd.error.message || ''))) {
    const patch2 = { ...patch };
    delete patch2.updated_at;
    const upd2 = await client
      .from('proof_slots')
      .update(patch2)
      .eq('surface', surface)
      .eq('service', service)
      .eq('slot_key', slotKey)
      .select('*')
      .limit(1);

    if (!upd2.error && Array.isArray(upd2.data) && upd2.data.length) {
      return NextResponse.json({ ok: true, slot: upd2.data[0] }, { headers: corsHeaders(request) });
    }
  }

  // Insert new slot
  const ins = await client.from('proof_slots').insert(patch).select('*').limit(1);
  if (!ins.error && Array.isArray(ins.data) && ins.data.length) {
    return NextResponse.json({ ok: true, slot: ins.data[0], created: true }, { headers: corsHeaders(request) });
  }

  if (ins.error && /updated_at/i.test(String(ins.error.message || ''))) {
    const patch2 = { ...patch };
    delete patch2.updated_at;
    const ins2 = await client.from('proof_slots').insert(patch2).select('*').limit(1);
    if (ins2.error) {
      return NextResponse.json({ ok: false, error: ins2.error.message }, { status: 500, headers: corsHeaders(request) });
    }
    const slot = Array.isArray(ins2.data) && ins2.data.length ? ins2.data[0] : null;
    return NextResponse.json({ ok: true, slot, created: true }, { headers: corsHeaders(request) });
  }

  return NextResponse.json({ ok: false, error: String(ins.error?.message || upd.error?.message || 'Unknown error') }, { status: 500, headers: corsHeaders(request) });
}
