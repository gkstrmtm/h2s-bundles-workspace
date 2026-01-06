import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/portalTokens';
import { resolveDispatchSchema } from '@/lib/dispatchSchema';

function corsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('origin') || '';
  const allowedOrigins = [
    'https://home2smart.com',
    'https://www.home2smart.com',
    'http://localhost:3000',
    'http://localhost:8080'
  ];

  const allowOrigin = allowedOrigins.includes(origin) ? origin : '*';

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

async function handle(request: Request, token: string, jobId: string) {
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Missing token', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
  }
  if (!jobId) {
    return NextResponse.json({ ok: false, error: 'Missing job_id', error_code: 'bad_request' }, { status: 400, headers: corsHeaders(request) });
  }

  const payload = verifyPortalToken(token);
  if (payload.role !== 'pro') {
    return NextResponse.json({ ok: false, error: 'Not a pro session', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
  }

  const dispatchClient = getSupabaseDispatch();
  if (!dispatchClient) {
    return NextResponse.json(
      { ok: false, error: 'Dispatch database not configured', error_code: 'dispatch_db_not_configured' },
      { status: 503, headers: corsHeaders(request) }
    );
  }

  const proId = payload.sub;
  const sb: any = dispatchClient as any;

  const schema = await resolveDispatchSchema(sb, { preferProValue: payload.sub, preferEmailValue: payload.email });
  const assignTable = schema?.assignmentsTable || 'h2s_dispatch_job_assignments';
  const proCol = schema?.assignmentsProCol;
  const jobCol = schema?.assignmentsJobCol || 'job_id';
  const stateCol = schema?.assignmentsStateCol || 'assign_state';

  const isEmailCol = (c: string) => /email/i.test(String(c || ''));
  const pickProValueForCol = (c: string) => {
    if (isEmailCol(c)) return payload.email || payload.sub;
    return payload.sub || payload.email;
  };

  const proValues = Array.from(new Set([payload.sub, payload.email].filter(Boolean).map((v) => String(v))));
  const proCols = Array.from(new Set([proCol, 'pro_id', 'tech_id', 'assigned_pro_id', 'technician_id', 'pro_email', 'tech_email', 'email'].filter(Boolean)));

  for (const col of proCols) {
    for (const val of proValues) {
      try {
        const { data, error } = await sb
          .from(assignTable)
          .update(({ [stateCol]: 'declined' } as any))
          .eq(jobCol as any, jobId)
          .eq(col as any, val)
          .select('*')
          .limit(1);

        // Supabase returns an empty array when the UPDATE matched 0 rows.
        // Treat that as "not found" and keep searching.
        if (!error && Array.isArray(data) && data.length) {
          return NextResponse.json(
            {
              ok: true,
              created: false,
              assignment: data[0] || null,
              meta: schema
                ? {
                    assignments_table: schema.assignmentsTable,
                    assignments_pro_col: schema.assignmentsProCol,
                    assignments_job_col: schema.assignmentsJobCol,
                    assignments_state_col: schema.assignmentsStateCol,
                  }
                : null,
            },
            { headers: corsHeaders(request) }
          );
        }
      } catch {
        // continue
      }
    }
  }

  // If no assignment exists yet, create a declined record so it won't keep showing.
  const insertProCols = Array.from(
    new Set([proCol, 'pro_id', 'tech_id', 'assigned_pro_id', 'technician_id', 'pro_email', 'tech_email', 'email'].filter(Boolean))
  ) as string[];

  for (const col of insertProCols) {
    const proVal = pickProValueForCol(col);
    if (!proVal) continue;
    try {
      const payloadRow: any = { [jobCol]: jobId, [col]: String(proVal), [stateCol]: 'declined' };
      const { data, error } = await sb.from(assignTable).insert(payloadRow).select('*').limit(1);
      if (!error) {
        return NextResponse.json(
          {
            ok: true,
            created: true,
            assignment: data?.[0] || null,
            meta: schema
              ? {
                  assignments_table: schema.assignmentsTable,
                  assignments_pro_col: schema.assignmentsProCol,
                  assignments_job_col: schema.assignmentsJobCol,
                  assignments_state_col: schema.assignmentsStateCol,
                }
              : null,
          },
          { headers: corsHeaders(request) }
        );
      }
    } catch {
      // try next column
    }
  }

  return NextResponse.json(
    { ok: false, error: 'Assignment not found and could not be created', error_code: 'not_found' },
    { status: 404, headers: corsHeaders(request) }
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return await handle(request, body?.token || '', String(body?.job_id || ''));
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Internal error' }, { status: 500, headers: corsHeaders(request) });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    return await handle(request, searchParams.get('token') || '', searchParams.get('job_id') || '');
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Internal error' }, { status: 500, headers: corsHeaders(request) });
  }
}
