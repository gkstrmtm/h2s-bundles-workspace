import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as any;
    const assetIdsRaw = body?.asset_ids || body?.assetIds || [];

    const assetIds = Array.from(new Set(
      (Array.isArray(assetIdsRaw) ? assetIdsRaw : [])
        .map((x) => String(x || '').trim())
        .filter(Boolean)
    ));

    if (!assetIds.length) {
      return NextResponse.json({ ok: true, edits: {} }, { headers: corsHeaders() });
    }

    // Keep payload bounded.
    if (assetIds.length > 200) {
      return NextResponse.json(
        { ok: false, error: 'too_many_asset_ids' },
        { status: 400, headers: corsHeaders() }
      );
    }

    const client = getSupabase();
    const { data, error } = await client
      .from('proof_assets')
      .select('asset_id, smart_crop_details')
      .in('asset_id', assetIds);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500, headers: corsHeaders() }
      );
    }

    const edits: Record<string, any> = {};
    (Array.isArray(data) ? data : []).forEach((r: any) => {
      const id = String(r?.asset_id || '').trim();
      if (!id) return;
      edits[id] = r?.smart_crop_details ?? null;
    });

    return NextResponse.json(
      { ok: true, edits },
      {
        headers: {
          ...corsHeaders(),
          // These are public-ish layout hints; safe to cache briefly.
          'Cache-Control': 'public, max-age=30, s-maxage=300, stale-while-revalidate=3600',
        },
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500, headers: corsHeaders() }
    );
  }
}
