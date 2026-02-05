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

function buildProxyUrl(bucket: string, path: string) {
  const b = String(bucket || '').replace(/^\/+|\/+$/g, '');
  const p = String(path || '').replace(/^\/+/, '');
  if (!b || !p) return '';
  // Relative path so it works from shop domain (which rewrites /api/* to backend).
  return `/api/proof-asset-media?bucket=${encodeURIComponent(b)}&path=${encodeURIComponent(p)}`;
}

function clampInt(v: string | null, def: number, min: number, max: number) {
  const n = Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function normalizeService(s: string) {
  const v = String(s || '').trim();
  if (v === 'tv_mounting' || v === 'cameras') return v;
  return '';
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

async function fetchAssetsForService(client: ReturnType<typeof getSupabase>, service: string, limit: number) {
  const baseQuery = client
    .from('proof_assets')
    .select('*')
    .eq('is_visible', true)
    .eq('service', service)
    .limit(limit);

  // Prefer recency of edit; fallback for schemas without updated_at.
  const r1 = await baseQuery.order('updated_at', { ascending: false }).order('created_at', { ascending: false });
  if ((r1 as any)?.error) {
    const r2 = await baseQuery.order('created_at', { ascending: false });
    return r2 as any;
  }
  return r1 as any;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = clampInt(url.searchParams.get('limit'), 60, 12, 200);

    const onlyService = normalizeService(url.searchParams.get('service') || '');

    const client = getSupabase();

    const services = onlyService ? [onlyService] : ['tv_mounting', 'cameras'];

    const out: Record<string, any[]> = {};

    for (const service of services) {
      const { data, error } = await fetchAssetsForService(client, service, limit);
      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders() });
      }

      const rows: any[] = Array.isArray(data) ? (data as any[]) : [];
      out[service] = rows.map((row: any) => {
        const proxyUrl = buildProxyUrl(row.storage_bucket, row.storage_path);
        const publicUrl = proxyUrl || row.direct_url || buildPublicUrl(row.storage_bucket, row.storage_path);

        // If the thumbnail URL points at Supabase public storage, proxy it too.
        const thumbUrl = (() => {
          try {
            const t = String(row.video_thumbnail_url || '').trim();
            if (!t) return '';
            const marker = '/storage/v1/object/public/';
            const idx = t.indexOf(marker);
            if (idx < 0) return t;
            const tail = t.substring(idx + marker.length).replace(/^\/+/, '');
            const parts = tail.split('/').filter(Boolean);
            if (parts.length < 2) return t;
            const bucket = parts[0];
            const path = parts.slice(1).join('/');
            return buildProxyUrl(bucket, path) || t;
          } catch (_) {
            return String(row.video_thumbnail_url || '').trim();
          }
        })();

        return {
          asset_id: row.asset_id,
          service: row.service,
          shot_type: row.shot_type,
          time_of_day: row.time_of_day,
          media_kind: row.media_kind,
          storage_bucket: row.storage_bucket,
          storage_path: row.storage_path,
          direct_url: row.direct_url,
          media_url: publicUrl,
          public_url: publicUrl,
          video_thumbnail_url: thumbUrl,
          video_thumbnail_timestamp: row.video_thumbnail_timestamp,
          width_px: row.width_px,
          height_px: row.height_px,
          created_at: row.created_at,
          updated_at: row.updated_at,
          city: row.city,
          state: row.state,
        };
      });
    }

    return NextResponse.json(
      {
        ok: true,
        categories: {
          tv_mounting: {
            title: 'TV Mounting',
            blurb: 'Recent TV installs and clean cable management.',
            items: out.tv_mounting || [],
          },
          cameras: {
            title: 'Security Cameras',
            blurb: 'Recent camera installs and tidy exterior runs.',
            items: out.cameras || [],
          },
        },
      },
      {
        headers: {
          ...corsHeaders(),
          'Cache-Control': 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',
        },
      }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500, headers: corsHeaders() });
  }
}
