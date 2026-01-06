import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/portalTokens';

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = ['https://home2smart.com', 'https://www.home2smart.com', 'http://localhost:3000', 'http://localhost:8080'];
  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (allowOrigin !== '*') headers['Access-Control-Allow-Credentials'] = 'true';
  return headers;
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

function normalizeEmail(email: any): string {
  return String(email || '').trim().toLowerCase();
}

function normalizeZip(zip: any): string {
  return String(zip || '').trim();
}

async function tryInsertOrUpdatePro(dispatch: any, pro: {
  pro_id?: string;
  email: string;
  zip: string;
  name?: string;
  geo_lat?: number | null;
  geo_lng?: number | null;
  service_radius_miles?: number | null;
  status?: string;
}) {
  const table = 'h2s_dispatch_pros';

  const idValue = String(pro.pro_id || pro.email).trim();

  const base = {
    pro_id: idValue,
    email: pro.email,
    zip: pro.zip,
    status: pro.status || 'active',
    name: pro.name || null,
    geo_lat: typeof pro.geo_lat === 'number' ? pro.geo_lat : null,
    geo_lng: typeof pro.geo_lng === 'number' ? pro.geo_lng : null,
    service_radius_miles: typeof pro.service_radius_miles === 'number' ? pro.service_radius_miles : null,
    updated_at: new Date().toISOString(),
  } as any;

  const insertAttempts: any[] = [
    { pro_id: base.pro_id, email: base.email, zip: base.zip, status: base.status },
    { ...base },
    // Common schema variations
    { tech_id: base.pro_id, email: base.email, zip: base.zip, status: base.status, name: base.name, geo_lat: base.geo_lat, geo_lng: base.geo_lng, service_radius_miles: base.service_radius_miles },
    { id: base.pro_id, email: base.email, zip: base.zip, status: base.status, name: base.name, geo_lat: base.geo_lat, geo_lng: base.geo_lng, service_radius_miles: base.service_radius_miles },
    { pro_id: base.pro_id, pro_email: base.email, zip: base.zip, status: base.status, name: base.name, geo_lat: base.geo_lat, geo_lng: base.geo_lng, service_radius_miles: base.service_radius_miles },
    { pro_id: base.pro_id, tech_email: base.email, zip: base.zip, status: base.status, name: base.name, geo_lat: base.geo_lat, geo_lng: base.geo_lng, service_radius_miles: base.service_radius_miles },
  ];

  for (const row of insertAttempts) {
    try {
      const { data, error } = await dispatch.from(table).insert(row).select('*').maybeSingle();
      if (!error) return { mode: 'inserted', row: data || row };

      const msg = String(error.message || '');
      // If the insert failed due to duplicates, attempt best-effort update by email.
      if (/(duplicate key|unique constraint)/i.test(msg)) {
        const updateAttempts: Array<{ matchCol: string; row: any }> = [
          { matchCol: 'email', row: base },
          { matchCol: 'pro_email', row: { ...base, pro_email: base.email } },
          { matchCol: 'tech_email', row: { ...base, tech_email: base.email } },
        ];

        for (const u of updateAttempts) {
          try {
            const { data: upd, error: updErr } = await dispatch
              .from(table)
              .update(u.row)
              .eq(u.matchCol as any, base.email)
              .select('*')
              .maybeSingle();
            if (!updErr) return { mode: 'updated', row: upd || u.row };
          } catch {
            // keep trying
          }
        }
      }
    } catch {
      // keep trying
    }
  }

  return { mode: 'failed', row: null };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const token = String(body?.token || '').trim();
    if (!token) {
      return NextResponse.json({ ok: false, error: 'Missing token', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }

    const payload = verifyPortalToken(token);
    if (payload.role !== 'admin') {
      return NextResponse.json({ ok: false, error: 'Not an admin session', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }

    const dispatch = getSupabaseDispatch();
    if (!dispatch) {
      return NextResponse.json(
        { ok: false, error: 'Dispatch database not configured', error_code: 'dispatch_db_not_configured' },
        { status: 503, headers: corsHeaders(request) }
      );
    }

    const email = normalizeEmail(body?.email);
    const zip = normalizeZip(body?.zip);
    const pro_id = String(body?.pro_id || body?.id || '').trim();

    if (!email || !zip) {
      return NextResponse.json(
        { ok: false, error: 'email and zip required', error_code: 'bad_request' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const name = String(body?.name || '').trim() || undefined;
    const geo_lat = typeof body?.geo_lat === 'number' ? body.geo_lat : null;
    const geo_lng = typeof body?.geo_lng === 'number' ? body.geo_lng : null;
    const service_radius_miles = typeof body?.service_radius_miles === 'number' ? body.service_radius_miles : null;

    // Handle is_active toggle for Pro Management UI
    if (pro_id && typeof body?.is_active === 'boolean') {
      try {
        const { error: updateError } = await dispatch
          .from('h2s_pros')
          .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
          .eq('pro_id', pro_id);

        if (updateError) throw updateError;

        return NextResponse.json(
          {
            ok: true,
            mode: 'updated',
            pro_id,
            is_active: body.is_active,
          },
          { headers: corsHeaders(request) }
        );
      } catch (err: any) {
        return NextResponse.json(
          { ok: false, error: `Failed to update is_active: ${err.message}` },
          { status: 500, headers: corsHeaders(request) }
        );
      }
    }

    const result = await tryInsertOrUpdatePro(dispatch, {
      pro_id: pro_id || undefined,
      email,
      zip,
      name,
      geo_lat,
      geo_lng,
      service_radius_miles,
      status: 'active',
    });

    if (result.mode === 'failed') {
      return NextResponse.json(
        { ok: false, error: 'Could not insert/update pro row (schema mismatch or permissions)', error_code: 'write_failed' },
        { status: 500, headers: corsHeaders(request) }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        mode: result.mode,
        pro: {
          email,
          zip,
          pro_id: pro_id || email,
          name: name || '',
        },
        row: result.row,
      },
      { headers: corsHeaders(request) }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Internal error', error_code: 'server_error' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const email = searchParams.get('email');
  const zip = searchParams.get('zip');
  const name = searchParams.get('name');

  return POST(
    new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ token, email, zip, name }),
    })
  );
}
