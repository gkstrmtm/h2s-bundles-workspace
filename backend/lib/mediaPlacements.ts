import { getSupabase } from '@/lib/supabase';
import { OWNER_MEDIA_DB_BUCKET } from '@/lib/ownerMediaDb';
import catalog from './mediaPlacementCatalog.json';

type MediaArea = { key: string; title: string; aspect: string; limit: number; service?: string };
export const MEDIA_PAGES: Record<string, { title: string; areas: MediaArea[] }> = catalog;
export const MEDIA_AREAS: Record<string, MediaArea[]> = Object.fromEntries(
  Object.entries(MEDIA_PAGES).map(([key, page]) => [key, page.areas]),
);
export function getMediaPage(surface: string) {
  return Object.prototype.hasOwnProperty.call(MEDIA_PAGES, surface) ? MEDIA_PAGES[surface] : null;
}

export type MediaSource = 'proof_asset' | 'owner_media';
export type MediaSurface = keyof typeof MEDIA_AREAS;
export type MediaPlacement = {
  asset_source: MediaSource;
  asset_id: string;
  surface: MediaSurface;
  area: string;
  enabled: boolean;
  display_order: number;
  fit: 'cover' | 'contain';
  focal_x: number;
  focal_y: number;
  zoom: number;
};
export type PlacementAsset = Record<string, unknown> & {
  asset_id: string;
  source?: string;
  media_placement?: MediaPlacement;
};

export function parseMediaPlacement(value: unknown): MediaPlacement {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected placement settings');
  const row = value as Record<string, unknown>;
  if (row.asset_source !== 'proof_asset' && row.asset_source !== 'owner_media') throw new Error('Invalid media source');
  if (typeof row.asset_id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(row.asset_id)) throw new Error('Invalid asset ID');
  if (row.asset_source === 'proof_asset' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.asset_id)) {
    throw new Error('Proof asset ID must be a UUID');
  }
  if (typeof row.surface !== 'string' || !getMediaPage(row.surface)) throw new Error('Invalid page');
  if (!getMediaPage(row.surface)!.areas.some((area) => area.key === row.area)) throw new Error('Invalid display area for this page');
  if (typeof row.enabled !== 'boolean') throw new Error('Visibility must be true or false');
  if (row.fit !== 'cover' && row.fit !== 'contain') throw new Error('Invalid fit mode');
  const numberField = (key: string, min: number, max: number, integer = false) => {
    const number = row[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
      throw new Error(`Invalid ${key}: expected ${integer ? 'an integer' : 'a number'} from ${min} to ${max}`);
    }
    return number;
  };
  return {
    asset_source: row.asset_source, asset_id: row.asset_id, surface: row.surface,
    area: String(row.area), enabled: row.enabled, fit: row.fit,
    display_order: numberField('display_order', 0, 999, true),
    focal_x: numberField('focal_x', 0, 100), focal_y: numberField('focal_y', 0, 100),
    zoom: numberField('zoom', 1, 3),
  };
}

export async function readMediaPlacements(surface: MediaSurface) {
  const { data, error } = await getSupabase().from('media_placements').select('*').eq('surface', surface)
    .order('display_order').order('asset_id');
  if (error) throw new Error(`Could not read page placements: ${error.message}`);
  return (data || []) as MediaPlacement[];
}

export function mergeMediaPlacements(
  fallback: PlacementAsset[], explicit: PlacementAsset[], placements: MediaPlacement[],
  area: string, limit: number, service?: string,
) {
  const relevant = placements.filter((row) => row.area === area);
  const byAsset = new Map(relevant.map((row) => [`${row.asset_source}:${row.asset_id}`, row]));
  const seen = new Set<string>();
  const result: PlacementAsset[] = [];
  const orderedExplicit = explicit.slice().sort((a, b) =>
    Number(a.media_placement?.display_order ?? 100) - Number(b.media_placement?.display_order ?? 100)
    || a.asset_id.localeCompare(b.asset_id));
  for (const asset of orderedExplicit.concat(fallback)) {
    const source = asset.source || (asset.storage_bucket === OWNER_MEDIA_DB_BUCKET ? 'owner_media' : 'proof_asset');
    const key = `${source}:${asset.asset_id}`;
    const placement = byAsset.get(key);
    if (placement?.enabled === false || seen.has(key)) continue;
    if (service && String(asset.service || asset.service_type || '') !== service) continue;
    seen.add(key);
    const sharedAsset = { ...asset };
    delete sharedAsset.media_placement;
    result.push(placement ? { ...sharedAsset, media_placement: placement } : sharedAsset);
    if (result.length >= limit) break;
  }
  return result;
}

export async function resolvePlacementAssets(placements: MediaPlacement[], area: string) {
  const active = placements.filter((row) => row.area === area && row.enabled);
  if (!active.length) return [];
  const client = getSupabase();
  const result: PlacementAsset[] = [];
  for (const source of ['proof_asset', 'owner_media'] as const) {
    const ids = active.filter((row) => row.asset_source === source).map((row) => row.asset_id);
    if (!ids.length) continue;
    const query = source === 'proof_asset'
      ? client.from('proof_assets').select('*').in('asset_id', ids).eq('is_visible', true)
      : client.from('owner_media_uploads')
        .select('asset_id, media_kind, service_type, city, created_at, updated_at, soft_location_label')
        .in('asset_id', ids).eq('review_state', 'published').eq('qa_hold', false)
        .eq('usage_rights_status', 'social_allowed').neq('customer_media_opt_in', 'declined');
    const { data, error } = await query;
    if (error) throw new Error(`Could not load placed media: ${error.message}`);
    for (const row of (data || []) as PlacementAsset[]) {
      const bucket = source === 'owner_media' ? OWNER_MEDIA_DB_BUCKET : String(row.storage_bucket || '');
      const path = source === 'owner_media' ? row.asset_id : String(row.storage_path || '');
      const url = `/api/proof-asset-media?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
      result.push({
        ...row, source, storage_bucket: bucket, storage_path: path,
        service: row.service || row.service_type,
        media_url: url, preview_url: url, public_url: url,
        media_placement: active.find((placement) => placement.asset_source === source && placement.asset_id === row.asset_id),
      });
    }
  }
  return result;
}
