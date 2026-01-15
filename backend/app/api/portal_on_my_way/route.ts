import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/auth';
import { resolveDispatchSchema } from '@/lib/dispatchSchema';

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

function readBearer(request: Request): string {
  const h = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || '').trim() : '';
}

function pickFirstKey(keys: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) if (keys.has(c)) return c;
  return null;
}

export async function POST(request: Request) {
  try {
    const bearer = readBearer(request);
    const body = await request.json();

    const token = String(body?.token || bearer || '').trim();
    const jobId = String(body?.job_id || '').trim();

    if (!token) {
      return NextResponse.json({ ok: false, error: 'Missing token', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }
    if (!jobId) {
      return NextResponse.json({ ok: false, error: 'Missing job_id', error_code: 'bad_request' }, { status: 400, headers: corsHeaders(request) });
    }

    const _auth = await verifyPortalToken(token);
      if (!_auth.ok || !_auth.payload) {
        return NextResponse.json({ ok: false, error: _auth.error || 'Invalid token', error_code: _auth.errorCode || 'bad_session' }, { status: 401, headers: corsHeaders(request) });
      }
      const payload = _auth.payload;
    if (payload.role !== 'pro') {
      return NextResponse.json({ ok: false, error: 'Not a pro session', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }

    const dispatch = getSupabaseDispatch();
    if (!dispatch) {
      return NextResponse.json(
        { ok: false, error: 'Dispatch database not configured', error_code: 'dispatch_db_not_configured' },
        { status: 503, headers: corsHeaders(request) }
      );
    }

    const sb: any = dispatch as any;
    const schema = await resolveDispatchSchema(sb, { preferProValue: payload.sub, preferEmailValue: payload.email });
    if (!schema) {
      return NextResponse.json({ ok: false, error: 'Dispatch schema not found', error_code: 'dispatch_schema_not_found' }, { status: 503, headers: corsHeaders(request) });
    }

    // Probe job row for available columns
    let keys = new Set<string>();
    try {
      const probe = await sb.from(schema.jobsTable).select('*').eq(schema.jobsIdCol as any, jobId).limit(1);
      const row = Array.isArray(probe?.data) ? probe.data[0] : null;
      if (row && typeof row === 'object') keys = new Set(Object.keys(row));
    } catch {
      // ignore
    }

    const enRouteCol = pickFirstKey(keys, [
      'tech_en_route_at',
      'en_route_at',
      'on_my_way_at',
      'tech_on_my_way_at',
      'enroute_at',
    ]);

    const nowIso = new Date().toISOString();

    const patch: any = {};
    if (enRouteCol) patch[enRouteCol] = nowIso;

    // Optionally mark status if such a status exists; keep best-effort.
    const statusCol = schema.jobsStatusCol && keys.has(schema.jobsStatusCol) ? schema.jobsStatusCol : null;
    if (statusCol) {
      // Only set if it won't break workflows; use a safe value that existing logic can ignore.
      patch[statusCol] = 'en_route';
    }

    if (!Object.keys(patch).length) {
      return NextResponse.json(
        { ok: true, updated: false, warning: 'No en-route timestamp column detected on jobs table', meta: { jobs_table: schema.jobsTable } },
        { headers: corsHeaders(request) }
      );
    }

    const { data, error } = await sb.from(schema.jobsTable).update(patch).eq(schema.jobsIdCol as any, jobId).select('*').limit(1);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message || 'Update failed' }, { status: 500, headers: corsHeaders(request) });
    }

    return NextResponse.json(
      {
        ok: true,
        updated: true,
        job: Array.isArray(data) ? data[0] : null,
        meta: {
          jobs_table: schema.jobsTable,
          jobs_id_col: schema.jobsIdCol,
          en_route_col: enRouteCol,
          status_col: statusCol,
        },
      },
      { headers: corsHeaders(request) }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error' }, { status: 500, headers: corsHeaders(request) });
  }
}
