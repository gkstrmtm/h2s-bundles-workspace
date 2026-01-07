import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/portalTokens';
import { bestEffortUpdateProRow } from '@/lib/portalProProfile';

// Helper to geocode a full address (address, city, state, zip)
async function geocodeAddress(address: string, city: string, state: string, zip: string): Promise<{ lat: number | null; lng: number | null }> {
  if (!address || !city || !state) return { lat: null, lng: null };
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { lat: null, lng: null };
  
  const fullAddress = `${address}, ${city}, ${state} ${zip || ''}`.trim();
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${encodeURIComponent(key)}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (data?.status === 'OK' && Array.isArray(data?.results) && data.results.length > 0) {
      const loc = data.results[0]?.geometry?.location;
      if (typeof loc?.lat === 'number' && typeof loc?.lng === 'number') {
        return { lat: loc.lat, lng: loc.lng };
      }
    }
  } catch {
    // non-fatal
  }
  return { lat: null, lng: null };
}

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'http://localhost:3000',
    'http://localhost:8080',
  ];

  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (allowOrigin !== '*') headers['Access-Control-Allow-Credentials'] = 'true';
  return headers;
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

function asNumOrNull(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = String(body?.token || '').trim();

    if (!token) {
      return NextResponse.json({ ok: false, error: 'Missing token', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }

    let payload: any;
    try {
      payload = verifyPortalToken(token);
    } catch (e: any) {
      return NextResponse.json({ ok: false, error: e?.message || 'Invalid token', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }

    if (payload.role !== 'pro') {
      return NextResponse.json({ ok: false, error: 'Not a pro session', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }

    const proId = String(payload.sub || '').trim();
    if (!proId) {
      return NextResponse.json({ ok: false, error: 'Missing pro id', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }

    const vehicle_text = body?.vehicle_text !== undefined ? String(body.vehicle_text || '').trim() : null;
    const service_radius_miles = asNumOrNull(body?.service_radius_miles);
    const max_jobs_per_day = asNumOrNull(body?.max_jobs_per_day);
    const photo_url = body?.photo_url !== undefined ? String(body.photo_url || '').trim() : null;
    const bio_short = body?.bio_short !== undefined ? String(body.bio_short || '').trim() : null;
    
    // Contact & Address fields
    const phone = body?.phone !== undefined ? String(body.phone || '').trim() : null;
    const home_address = body?.address !== undefined ? String(body.address || '').trim() : null;
    const home_city = body?.city !== undefined ? String(body.city || '').trim() : null;
    const home_state = body?.state !== undefined ? String(body.state || '').trim() : null;
    const home_zip = body?.zip !== undefined ? String(body.zip || '').trim() : null;
    const name = body?.name !== undefined ? String(body.name || '').trim() : null;

    const dispatch = getSupabaseDispatch();
    if (!dispatch) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Dispatch database not configured (set SUPABASE_URL_DISPATCH / SUPABASE_SERVICE_KEY_DISPATCH)',
          error_code: 'dispatch_db_not_configured',
        },
        { status: 503, headers: corsHeaders(request) }
      );
    }

    // Geocode address if provided (for service radius calculation)
    let geo_lat: number | null = null;
    let geo_lng: number | null = null;
    if (home_address && home_city && home_state && home_zip) {
      const geo = await geocodeAddress(home_address, home_city, home_state, home_zip);
      geo_lat = geo.lat;
      geo_lng = geo.lng;
      if (geo_lat !== null && geo_lng !== null) {
        console.log(`[Profile Update] Geocoded address for pro ${proId}: ${geo_lat}, ${geo_lng}`);
      }
    }

    const patches: Array<Record<string, any>> = [];

    // Most likely schema.
    patches.push({
      ...(vehicle_text !== null ? { vehicle_text } : {}),
      ...(service_radius_miles !== null ? { service_radius_miles } : {}),
      ...(max_jobs_per_day !== null ? { max_jobs_per_day } : {}),
      ...(photo_url !== null ? { photo_url } : {}),
      ...(bio_short !== null ? { bio_short } : {}),
      ...(phone !== null ? { phone } : {}),
      ...(home_address !== null ? { home_address } : {}),
      ...(home_city !== null ? { home_city } : {}),
      ...(home_state !== null ? { home_state } : {}),
      ...(home_zip !== null ? { home_zip } : {}),
      ...(name !== null ? { name } : {}),
      ...(geo_lat !== null ? { geo_lat } : {}),
      ...(geo_lng !== null ? { geo_lng } : {}),
    });

    // Common alternates.
    patches.push({
      ...(vehicle_text !== null ? { vehicle: vehicle_text } : {}),
      ...(service_radius_miles !== null ? { service_radius_miles } : {}),
      ...(service_radius_miles !== null ? { service_radius: service_radius_miles } : {}),
      ...(max_jobs_per_day !== null ? { max_jobs_per_day } : {}),
      ...(max_jobs_per_day !== null ? { daily_job_cap: max_jobs_per_day } : {}),
      ...(photo_url !== null ? { profile_photo_url: photo_url } : {}),
      ...(photo_url !== null ? { avatar_url: photo_url } : {}),
      ...(bio_short !== null ? { bio: bio_short } : {}),
      ...(geo_lat !== null ? { geo_lat } : {}),
      ...(geo_lat !== null ? { lat: geo_lat } : {}),
      ...(geo_lat !== null ? { latitude: geo_lat } : {}),
      ...(geo_lng !== null ? { geo_lng } : {}),
      ...(geo_lng !== null ? { lng: geo_lng } : {}),
      ...(geo_lng !== null ? { longitude: geo_lng } : {}),
      ...(bio_short !== null ? { about: bio_short } : {}),
      ...(phone !== null ? { phone } : {}),
      ...(phone !== null ? { mobile: phone } : {}),
      ...(phone !== null ? { pro_phone: phone } : {}),
      ...(home_address !== null ? { address: home_address } : {}),
      ...(home_address !== null ? { street_address: home_address } : {}),
      ...(home_city !== null ? { city: home_city } : {}),
      ...(home_state !== null ? { state: home_state } : {}),
      ...(home_zip !== null ? { zip: home_zip } : {}),
      ...(home_zip !== null ? { zipcode: home_zip } : {}),
      ...(home_zip !== null ? { postal_code: home_zip } : {}),
      ...(name !== null ? { name } : {}),
      ...(name !== null ? { full_name: name } : {}),
      ...(name !== null ? { pro_name: name } : {}),
    });

    // Minimal fallbacks.
    patches.push({ ...(photo_url !== null ? { photo_url } : {}) });
    patches.push({ ...(bio_short !== null ? { bio_short }
    patches.push({ ...(geo_lat !== null ? { geo_lat } : {}) });
    patches.push({ ...(geo_lng !== null ? { geo_lng } : {}) }); : {}) });
    patches.push({ ...(phone !== null ? { phone } : {}) });
    patches.push({ ...(home_address !== null ? { home_address } : {}) });
    patches.push({ ...(home_city !== null ? { home_city } : {}) });
    patches.push({ ...(home_state !== null ? { home_state } : {}) });
    patches.push({ ...(home_zip !== null ? { home_zip } : {}) });
    patches.push({ ...(name !== null ? { name } : {}) });

    const res = await bestEffortUpdateProRow(dispatch, proId, patches);

    // Even if we can't find a table/column match, keep the portal from breaking.
    if (!res.ok) {
      return NextResponse.json({ ok: true, stored: false }, { headers: corsHeaders(request) });
    }

    return NextResponse.json({ ok: true }, { headers: corsHeaders(request) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error', error_code: 'server_error' }, { status: 500, headers: corsHeaders(request) });
  }
}
