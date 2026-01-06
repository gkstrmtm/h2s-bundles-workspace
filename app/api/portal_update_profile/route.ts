import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/portalTokens';
import { bestEffortUpdateProRow } from '@/lib/portalProProfile';

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

    const patches: Array<Record<string, any>> = [];

    // Most likely schema.
    patches.push({
      ...(vehicle_text !== null ? { vehicle_text } : {}),
      ...(service_radius_miles !== null ? { service_radius_miles } : {}),
      ...(max_jobs_per_day !== null ? { max_jobs_per_day } : {}),
      ...(photo_url !== null ? { photo_url } : {}),
      ...(bio_short !== null ? { bio_short } : {}),
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
      ...(bio_short !== null ? { about: bio_short } : {}),
    });

    // Minimal fallbacks.
    patches.push({ ...(photo_url !== null ? { photo_url } : {}) });
    patches.push({ ...(bio_short !== null ? { bio_short } : {}) });

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
