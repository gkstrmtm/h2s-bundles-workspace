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
      return reply({ ok: true, areas: MEDIA_AREAS, pages: MEDIA_PAGES, placements: data || [] });
    }

    let placement;
    try {
      placement = parseMediaPlacement(await request.json());
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
      ? await client.from('proof_assets').select('asset_id, is_visible, service')
        .eq('asset_id', placement.asset_id).maybeSingle()
      : await client.from('owner_media_uploads')
        .select('asset_id, review_state, usage_rights_status, qa_hold, customer_media_opt_in, service_type')
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
      if (area?.service && service !== area.service) {
        return reply({ ok: false, error: 'The asset service does not match this display area' }, 409);
      }
    }
    const { asset_source, asset_id, ...settings } = placement;
    const { data, error } = await client.from('media_placements').upsert({
      ...settings,
      proof_asset_id: asset_source === 'proof_asset' ? asset_id : null,
      owner_asset_id: asset_source === 'owner_media' ? asset_id : null,
      updated_at: new Date().toISOString(), updated_by: user.userId,
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
