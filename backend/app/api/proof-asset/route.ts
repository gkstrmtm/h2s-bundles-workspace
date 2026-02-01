import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function buildPublicUrl(bucket: string, path: string) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const b = String(bucket || '').replace(/^\/+|\/+$/g, '');
  const p = String(path || '').replace(/^\/+/, '');
  if (!base || !b || !p) return '';
  return `${base}/storage/v1/object/public/${encodeURIComponent(b)}/${p
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const assetId = String(url.searchParams.get('asset_id') || '').trim();
    if (!assetId) {
      return NextResponse.json({ ok: false, error: 'asset_id required' }, { status: 400, headers: corsHeaders() });
    }

    const client = getSupabase();
    const { data, error } = await client.from('proof_assets').select('*').eq('asset_id', assetId).limit(1);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders() });
    }

    const row: any = Array.isArray(data) ? (data as any)[0] : null;
    if (!row) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, headers: corsHeaders() });
    }

    const publicUrl = row.direct_url || buildPublicUrl(row.storage_bucket, row.storage_path);

    return NextResponse.json(
      {
        ok: true,
        asset: {
          asset_id: row.asset_id,
          media_kind: row.media_kind,
          storage_bucket: row.storage_bucket,
          storage_path: row.storage_path,
          direct_url: row.direct_url,
          public_url: publicUrl,
          width_px: row.width_px,
          height_px: row.height_px,
          updated_at: row.updated_at,
          created_at: row.created_at,
          service: row.service,
          shot_type: row.shot_type,
          time_of_day: row.time_of_day,
        },
      },
      {
        headers: {
          ...corsHeaders(),
          // Safe to cache: this is public storage metadata.
          'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
        },
      }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500, headers: corsHeaders() });
  }
}
