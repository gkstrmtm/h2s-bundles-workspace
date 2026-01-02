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

  const jobsTable = schema?.jobsTable || 'h2s_dispatch_jobs';
  const jobIdCol = schema?.jobsIdCol || 'job_id';
  const jobStatusCol = schema?.jobsStatusCol || 'status';

  const isEmailCol = (c: string) => /email/i.test(String(c || ''));
  const isUuidLike = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
  const pickProValueForCol = (c: string) => {
    if (isEmailCol(c)) return payload.email || payload.sub;
    // Prefer stable id if it looks like an id/uuid.
    if (payload.sub && (isUuidLike(payload.sub) || payload.sub.length <= 64)) return payload.sub;
    return payload.sub || payload.email;
  };

  const proValues = Array.from(new Set([payload.sub, payload.email].filter(Boolean).map((v) => String(v))));
  const proCols = Array.from(new Set([proCol, 'pro_id', 'tech_id', 'assigned_pro_id', 'technician_id', 'pro_email', 'tech_email', 'email'].filter(Boolean)));

  for (const col of proCols) {
    for (const val of proValues) {
      try {
        const { data, error } = await sb
          .from(assignTable)
          .update(({ [stateCol]: 'accepted' } as any))
          .eq(jobCol as any, jobId)
          .eq(col as any, val)
          .select('*')
          .limit(1);

        // Supabase returns an empty array when the UPDATE matched 0 rows.
        // Treat that as "not found" and keep searching.
        if (!error && Array.isArray(data) && data.length) {
          const row = data[0] || null;

          // Best-effort: mark the job as accepted so it won't show up as a public offer.
          try {
            await sb
              .from(jobsTable)
              .update(({ [jobStatusCol]: 'accepted' } as any))
              .eq(jobIdCol as any, jobId);
          } catch {
            // ignore
          }

          return NextResponse.json(
            {
              ok: true,
              created: false,
              assignment: row,
              is_team_job: !!(row?.is_team_job),
              team_confirmed: !!(row?.team_confirmed),
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

  // If no assignment exists yet, create one so accept is durable.
  const insertProCols = Array.from(
    new Set([proCol, 'pro_id', 'tech_id', 'assigned_pro_id', 'technician_id', 'pro_email', 'tech_email', 'email'].filter(Boolean))
  ) as string[];

  for (const col of insertProCols) {
    const proVal = pickProValueForCol(col);
    if (!proVal) continue;
    try {
      const payloadRow: any = { [jobCol]: jobId, [col]: String(proVal), [stateCol]: 'accepted' };
      const { data, error } = await sb.from(assignTable).insert(payloadRow).select('*').limit(1);
      if (!error) {
        const row = data?.[0] || null;

        // Best-effort: mark job accepted.
        try {
          await sb
            .from(jobsTable)
            .update(({ [jobStatusCol]: 'accepted' } as any))
            .eq(jobIdCol as any, jobId);
        } catch {
          // ignore
        }

        return NextResponse.json(
          {
            ok: true,
            created: true,
            assignment: row,
            is_team_job: !!(row?.is_team_job),
            team_confirmed: !!(row?.team_confirmed),
            meta: schema
              ? {
                  assignments_table: schema.assignmentsTable,
                  assignments_pro_col: schema.assignmentsProCol,
                  assignments_job_col: schema.assignmentsJobCol,
                  assignments_state_col: schema.assignmentsStateCol,
                  jobs_table: schema.jobsTable,
                  jobs_id_col: schema.jobsIdCol,
                  jobs_status_col: schema.jobsStatusCol,
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
