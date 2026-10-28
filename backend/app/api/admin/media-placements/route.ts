import { NextResponse } from 'next/server';
import { getDashboardAuthUserFromSession } from '@/lib/dashboardAuth';
import { getSupabase } from '@/lib/supabase';
import { MEDIA_AREAS, MEDIA_PAGES, getMediaPage, parseMediaPlacement } from '@/lib/mediaPlacements';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function headers(request: Request) {
  return {
    'Access-Control-Allow-Origin': request.headers.get('origin') || '*',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: headers(request) });
}

async function handle(request: Request) {
  const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: headers(request) });
  try {
    const user = await getDashboardAuthUserFromSession(request);
    if (!user) return reply({ ok: false, error: 'Sign in to the dashboard to manage placements' }, 401);
    if (user.role !== 'ADMIN') return reply({ ok: false, error: 'Only administrators can manage page placements' }, 403);
    const client = getSupabase();
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      const source = params.get('asset_source');
      const assetId = params.get('asset_id');
      if ((source !== 'proof_asset' && source !== 'owner_media') || !assetId) {
        return reply({ ok: false, error: 'Media source and asset ID are required' }, 400);
      }
      const { data, error } = await client.from('media_placements').select('*')
        .eq('asset_source', source).eq('asset_id', assetId);
      if (error) {
        console.error('[media-placements] Could not load saved settings', error);
        return reply({
          ok: false, error: 'Saved placements could not be loaded. Check the media_placements migration and database connection.',
          areas: MEDIA_AREAS, pages: MEDIA_PAGES,
        }, 503);
      }
      return reply({ ok: true, areas: MEDIA_AREAS, pages: MEDIA_PAGES, placements: data || [], capabilities: { replace: true } });
    }

    let placement;
    let replacement;
    try {
      const body = await request.json();
      placement = parseMediaPlacement(body);
      if (body.replace !== undefined) {
        if (request.method !== 'PUT' || !placement.enabled || placement.surface !== 'commercial_intake'
          || !['commercial_security_rail', 'commercial_display_rail'].includes(placement.area)) {
          throw new Error('Replacement requires an included Commercial rail placement');
        }
        replacement = parseMediaPlacement({ ...placement, asset_source: body.replace?.asset_source,
          asset_id: body.replace?.asset_id, enabled: false });
        if (replacement.asset_source === placement.asset_source && replacement.asset_id === placement.asset_id) {
          throw new Error('Choose a different asset to replace this media');
        }
      }
    } catch (error) {
      return reply({ ok: false, error: error instanceof Error ? error.message : 'Invalid placement' }, 400);
    }
    if (request.method === 'DELETE') {
      const { error } = await client.from('media_placements').delete()
        .eq('asset_source', placement.asset_source).eq('asset_id', placement.asset_id)
        .eq('surface', placement.surface).eq('area', placement.area);
      if (error) throw new Error(error.message);
      return reply({ ok: true });
    }
    const { data: asset, error: assetError } = placement.asset_source === 'proof_asset'
      ? await client.from('proof_assets').select('asset_id, is_visible, service, media_kind')
        .eq('asset_id', placement.asset_id).maybeSingle()
      : await client.from('owner_media_uploads')
        .select('asset_id, review_state, usage_rights_status, qa_hold, customer_media_opt_in, service_type, media_kind')
        .eq('asset_id', placement.asset_id).maybeSingle();
    if (assetError) throw new Error(assetError.message);
    if (!asset) return reply({ ok: false, error: 'Media asset no longer exists' }, 404);
    if (placement.enabled) {
      const eligible = 'is_visible' in asset ? asset.is_visible === true
        : asset.review_state === 'published' && asset.usage_rights_status === 'social_allowed'
          && asset.qa_hold === false && asset.customer_media_opt_in !== 'declined';
      if (!eligible) return reply({ ok: false, error: 'Publish and approve usage rights before showing this asset on a public page' }, 409);
      const service = String('service' in asset ? asset.service : asset.service_type || '');
      if (!['tv_mounting', 'cameras'].includes(service)) {
        return reply({ ok: false, error: 'Set the asset service to tv_mounting or cameras before placing it' }, 409);
      }
      const area = getMediaPage(placement.surface)?.areas.find((entry) => entry.key === placement.area);
      if (area?.photoOnly && asset.media_kind !== 'photo') {
        return reply({ ok: false, error: 'This display area requires an installation photo, not video' }, 409);
      }
      if (area?.service && service !== area.service) {
        return reply({ ok: false, error: 'The asset service does not match this display area' }, 409);
      }
    }
    const { asset_source, asset_id, ...settings } = placement;
    const record = {
      ...settings,
      proof_asset_id: asset_source === 'proof_asset' ? asset_id : null,
      owner_asset_id: asset_source === 'owner_media' ? asset_id : null,
      updated_at: new Date().toISOString(), updated_by: user.userId,
    };
    if (replacement) {
      const { data: previous, error: readError } = await client.from('media_placements').select('*')
        .eq('asset_source', replacement.asset_source).eq('asset_id', replacement.asset_id)
        .eq('surface', placement.surface).eq('area', placement.area).maybeSingle();
      if (readError) throw new Error(readError.message);
      const excluded = {
        ...record, enabled: false,
        display_order: previous?.display_order ?? 100, fit: previous?.fit ?? 'cover',
        focal_x: previous?.focal_x ?? 50, focal_y: previous?.focal_y ?? 50, zoom: previous?.zoom ?? 1,
        proof_asset_id: replacement.asset_source === 'proof_asset' ? replacement.asset_id : null,
        owner_asset_id: replacement.asset_source === 'owner_media' ? replacement.asset_id : null,
      };
      // One PostgREST statement: include the replacement and exclude the old media together.
      const { data, error } = await client.from('media_placements')
        .upsert([record, excluded], { onConflict: 'asset_source,asset_id,surface,area' }).select('*');
      if (error) throw new Error(error.message);
      return reply({ ok: true, placement: data?.find(row => row.asset_source === asset_source && row.asset_id === asset_id),
        replaced: data?.find(row => row.asset_source === replacement.asset_source && row.asset_id === replacement.asset_id) });
    }
    const { data, error } = await client.from('media_placements').upsert({
      ...record,
    }, { onConflict: 'asset_source,asset_id,surface,area' }).select('*').single();
    if (error) throw new Error(error.message);
    return reply({ ok: true, placement: data });
  } catch (error) {
    console.error('[media-placements]', error);
    return reply({ ok: false, error: 'Could not persist or load page placements. Check the media_placements migration and database connection.' }, 500);
  }
}

export const GET = handle;
export const PUT = handle;
export const DELETE = handle;
