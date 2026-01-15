import { NextResponse } from 'next/server';
import { getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/auth';
import { addArtifact } from '@/lib/portalArtifacts';

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

  if (allowOrigin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const token = String(body?.token || '').trim();
    const jobId = String(body?.job_id || '').trim();
    const type = String(body?.type || 'other').trim().toLowerCase();
    const data = String(body?.data || '').trim();
    const filename = body?.filename ? String(body.filename) : undefined;
    const mimetype = body?.mimetype ? String(body.mimetype) : undefined;

    if (!token) {
      return NextResponse.json({ ok: false, error: 'Missing token', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }

    let payload: any;
    try {
      const _auth = await verifyPortalToken(token);
      if (!_auth.ok || !_auth.payload) {
        return NextResponse.json({ ok: false, error: _auth.error || 'Invalid token', error_code: _auth.errorCode || 'bad_session' }, { status: 401, headers: corsHeaders(request) });
      }
      payload = _auth.payload;
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
    const out = await addArtifact(sb, payload, {
      job_id: jobId,
      type: type as any,
      data,
      filename,
      mimetype,
    });

    if (!out.ok) {
      const status = out.error_code === 'forbidden' ? 403 : 400;
      return NextResponse.json(out, { status, headers: corsHeaders(request) });
    }

    // portal.html expects artifact_id at the top-level
    return NextResponse.json(
      {
        ok: true,
        artifact_id: out.artifact.artifact_id,
        storage_url: out.artifact.storage_url || null,
        artifact: out.artifact,
      },
      { headers: corsHeaders(request) }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error' }, { status: 500, headers: corsHeaders(request) });
  }
}
