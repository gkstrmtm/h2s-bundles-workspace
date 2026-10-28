import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { OWNER_MEDIA_DB_BUCKET } from '@/lib/ownerMediaDb';
import { readMediaPlacements, resolvePlacementAssets, mergeMediaPlacements, type MediaPlacement } from '@/lib/mediaPlacements';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type PublicSectionConfig = {
  key: string;
  title: string;
  service: 'cameras' | 'tv_mounting';
  photoOnly?: boolean;
};

const SURFACE_CONFIG: Record<string, PublicSectionConfig[]> = {
  residential: [
    { key: 'residential_tv_proof', title: 'TV mounting', service: 'tv_mounting', photoOnly: true },
    { key: 'residential_camera_proof', title: 'Security cameras', service: 'cameras', photoOnly: true },
  ],
  commercial_intake: [
    { key: 'commercial_security_rail', title: 'Security camera work', service: 'cameras' },
    { key: 'commercial_display_rail', title: 'Display and TV work', service: 'tv_mounting' },
  ],
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function buildProxyUrl(bucket: string, path: string) {
  const safeBucket = String(bucket || '').trim().replace(/^\/+|\/+$/g, '');
  const safePath = String(path || '').trim().replace(/^\/+/, '');
  if (!safeBucket || !safePath) return '';
  return `/api/proof-asset-media?bucket=${encodeURIComponent(safeBucket)}&path=${encodeURIComponent(safePath)}`;
}

function buildPublicUrl(bucket: string, path: string) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const safeBucket = String(bucket || '').trim().replace(/^\/+|\/+$/g, '');
  const safePath = String(path || '').trim().replace(/^\/+/, '');
  if (!base || !safeBucket || !safePath) return '';
  return `${base}/storage/v1/object/public/${encodeURIComponent(safeBucket)}/${safePath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

function normalizeSurface(value: string) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  return normalized || 'commercial_intake';
}

function mapOwnerMediaItem(row: any, sectionKey: string) {
  const mediaUrl = buildProxyUrl(OWNER_MEDIA_DB_BUCKET, String(row?.asset_id || '').trim());
  return {
    source: 'owner_media',
    section_key: sectionKey,
    asset_id: String(row?.asset_id || '').trim(),
    media_kind: String(row?.media_kind || '').trim() === 'video' ? 'video' : 'photo',
    storage_bucket: OWNER_MEDIA_DB_BUCKET,
    storage_path: String(row?.asset_id || '').trim(),
    media_url: mediaUrl,
    public_url: mediaUrl,
    preview_url: mediaUrl,
    direct_url: '',
    city: String(row?.city || '').trim(),
    state: '',
    label: String(row?.soft_location_label || row?.city || row?.service_type || 'Approved install').trim(),
    service_type: String(row?.service_type || '').trim(),
    review_state: String(row?.review_state || '').trim(),
    display_order: Number.isFinite(Number(row?.display_order)) ? Number(row.display_order) : 100,
    psychological_weight: Number.isFinite(Number(row?.psychological_weight)) ? Number(row.psychological_weight) : 20,
    created_at: String(row?.created_at || '').trim(),
    updated_at: String(row?.updated_at || row?.created_at || '').trim(),
  };
}

function mapProofItem(row: any, sectionKey: string) {
  const proxyUrl = buildProxyUrl(String(row?.storage_bucket || '').trim(), String(row?.storage_path || '').trim());
  const mediaUrl = proxyUrl || String(row?.direct_url || '').trim() || buildPublicUrl(String(row?.storage_bucket || '').trim(), String(row?.storage_path || '').trim());
  return {
    source: 'proof_asset',
    section_key: sectionKey,
    asset_id: String(row?.asset_id || '').trim(),
    media_kind: String(row?.media_kind || '').trim() === 'video' ? 'video' : 'photo',
    storage_bucket: String(row?.storage_bucket || '').trim(),
    storage_path: String(row?.storage_path || '').trim(),
    media_url: mediaUrl,
    public_url: mediaUrl,
    preview_url: mediaUrl,
    direct_url: String(row?.direct_url || '').trim(),
    city: String(row?.city || '').trim(),
    state: String(row?.state || '').trim(),
    label: String(row?.city || row?.shot_type || 'Recent install').trim(),
    shot_type: String(row?.shot_type || '').trim(),
    service: String(row?.service || '').trim(),
    created_at: String(row?.created_at || '').trim(),
    updated_at: String(row?.updated_at || row?.created_at || '').trim(),
  };
}

type OwnerMediaPublicRow = {
  asset_id: string;
  media_kind: string | null;
  city: string | null;
  service_type: string | null;
  review_state: string | null;
  display_order: number | null;
  psychological_weight: number | null;
  created_at: string;
  updated_at: string | null;
  soft_location_label: string | null;
  content_sha256: string | null;
};

async function fetchOwnerMediaRows(sectionKey: string, limit: number, serviceType: string, photoOnly = false) {
  let client;
  try {
    client = getSupabase();
  } catch {
    return [];
  }

  let query = client
    .from('owner_media_uploads')
    .select('asset_id, media_kind, city, service_type, review_state, display_order, psychological_weight, created_at, updated_at, soft_location_label, content_sha256')
    .contains('frontend_destinations', [sectionKey])
    .eq('qa_hold', false)
    .eq('review_state', 'published')
    .eq('usage_rights_status', 'social_allowed')
    .neq('customer_media_opt_in', 'declined')
    .eq('service_type', serviceType);
  if (photoOnly) query = query.eq('media_kind', 'photo');
  const { data, error } = await query
    .order('display_order', { ascending: true, nullsFirst: false })
    .order('psychological_weight', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(Math.max(limit * 3, limit));

  if (error || !Array.isArray(data)) return [];

  const deduped: OwnerMediaPublicRow[] = [];
  const seen = new Set<string>();
  for (const row of data as OwnerMediaPublicRow[]) {
    const dedupeKey = String(row.content_sha256 || row.asset_id || '').trim();
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    deduped.push(row);
    if (deduped.length >= limit) break;
  }

  return deduped.map((row) => mapOwnerMediaItem(row, sectionKey));
}

async function fetchProofFallback(sectionKey: string, service: 'cameras' | 'tv_mounting', limit: number, photoOnly = false) {
  let client;
  try {
    client = getSupabase();
  } catch {
    return [];
  }

  let baseQuery = client
    .from('proof_assets')
    .select('*')
    .eq('is_visible', true)
    .eq('service', service)
    .limit(limit);
  if (photoOnly) baseQuery = baseQuery.eq('media_kind', 'photo');

  const recent = await baseQuery.order('updated_at', { ascending: false }).order('created_at', { ascending: false });
  const fallback = recent.error ? await baseQuery.order('created_at', { ascending: false }) : recent;
  const rows = Array.isArray((fallback as any)?.data) ? (fallback as any).data : [];
  return rows.map((row: any) => mapProofItem(row, sectionKey));
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const surface = normalizeSurface(url.searchParams.get('surface') || 'commercial_intake');
  const limit = clampInt(url.searchParams.get('limit'), 4, 1, 8);
  const sections = SURFACE_CONFIG[surface];
  if (!sections) return NextResponse.json({ ok: false, error: 'Unsupported public media page' }, { status: 400, headers: corsHeaders() });
  let placements: MediaPlacement[];
  try {
    placements = await readMediaPlacements(surface);
  } catch (error) {
    console.error('[owner-media/public] Placement read failed', error);
    return NextResponse.json({ ok: false, error: 'Could not load page placements' }, { status: 503, headers: corsHeaders() });
  }

  const payloadSections: Record<string, { title: string; items: any[] }> = {};

  for (const section of sections) {
    let ownerItems: any[] = [];
    try {
      ownerItems = await fetchOwnerMediaRows(section.key, limit, section.service, section.photoOnly);
    } catch {
      ownerItems = [];
    }

    let items = ownerItems.slice(0, limit);
    if (items.length < limit) {
      const proofItems = await fetchProofFallback(section.key, section.service, limit - items.length, section.photoOnly);
      items = items.concat(proofItems);
    }

    try {
      const explicit = await resolvePlacementAssets(placements, section.key);
      payloadSections[section.key] = {
        title: section.title,
        items: mergeMediaPlacements(items, section.photoOnly ? explicit.filter(item => item.media_kind === 'photo') : explicit,
          placements, section.key, limit, section.service),
      };
    } catch (error) {
      console.error('[owner-media/public] Placed media failed', error);
      return NextResponse.json({ ok: false, error: 'Could not load placed media' }, { status: 503, headers: corsHeaders() });
    }
  }

  if (surface === 'commercial_intake') try {
    const hero = await resolvePlacementAssets(placements, 'commercial_hero');
    const railItems = sections.flatMap((section) => payloadSections[section.key].items);
    const fallback = railItems.filter((item) => item.media_kind !== 'video')
      .concat(railItems.filter((item) => item.media_kind === 'video'));
    payloadSections.commercial_hero = {
      title: 'Hero photo',
      items: mergeMediaPlacements(fallback, hero, placements, 'commercial_hero', 6),
    };
  } catch (error) {
    console.error('[owner-media/public] Hero placement failed', error);
    return NextResponse.json({ ok: false, error: 'Could not load hero placement' }, { status: 503, headers: corsHeaders() });
  }

  return NextResponse.json(
    {
      ok: true,
      surface,
      sections: payloadSections,
    },
    {
      headers: {
        ...corsHeaders(),
        'Cache-Control': 'no-store',
      },
    },
  );
}