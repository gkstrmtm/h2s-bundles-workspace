import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/portalTokens';
import { getArtifacts } from '@/lib/portalArtifacts';

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

async function handle(request: Request, token: string, jobId: string, type?: string) {
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Missing token', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
  }
  if (!jobId) {
    return NextResponse.json({ ok: false, error: 'Missing job_id', error_code: 'bad_request' }, { status: 400, headers: corsHeaders(request) });
  }

  let payload: any;
  try {
    payload = verifyPortalToken(token);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Invalid token', error_code: 'bad_session' },
      { status: 401, headers: corsHeaders(request) }
    );
  }

  if (payload.role !== 'pro' && payload.role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Bad session', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
  }

  const dispatchClient = getSupabaseDispatch();
  if (!dispatchClient) {
    return NextResponse.json(
      { ok: false, error: 'Dispatch database not configured', error_code: 'dispatch_db_not_configured' },
      { status: 503, headers: corsHeaders(request) }
    );
  }

  const sb: any = dispatchClient as any;
  const out = await getArtifacts(sb, payload, { job_id: jobId, type: (type as any) || undefined });
  if (!out.ok) {
    return NextResponse.json(out, { status: out.error_code === 'forbidden' ? 403 : 400, headers: corsHeaders(request) });
  }

  return NextResponse.json({ ok: true, artifacts: out.artifacts }, { headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';

    const token =
      url.searchParams.get('token') ||
      url.searchParams.get('admin_token') ||
      url.searchParams.get('adminToken') ||
      bearer ||
      '';
    const jobId = url.searchParams.get('job_id') || '';
    const type = url.searchParams.get('type') || undefined;
    return await handle(request, token, jobId, type);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error' }, { status: 500, headers: corsHeaders(request) });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';

    const token = String(body?.token || body?.admin_token || body?.adminToken || bearer || '').trim();
    const jobId = String(body?.job_id || '').trim();
    const type = body?.type ? String(body.type) : undefined;
    return await handle(request, token, jobId, type);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error' }, { status: 500, headers: corsHeaders(request) });
  }
}
