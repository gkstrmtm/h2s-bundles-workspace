import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/auth';
import { bestEffortUpdateProRow, sanitizeFilename } from '@/lib/portalProProfile';

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

function parseDataUrl(input: string): { base64: string; mimetype: string | null } {
  const s = String(input || '').trim();
  const m = s.match(/^data:([^;]+);base64,(.+)$/i);
  if (m) return { mimetype: String(m[1] || '').trim() || null, base64: String(m[2] || '').trim() };
  return { mimetype: null, base64: s };
}

function safeRandomId(): string {
  return (globalThis.crypto as any)?.randomUUID
    ? (globalThis.crypto as any).randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const token = String(body?.token || '').trim();
    const file = String(body?.file || '').trim();
    const filename = sanitizeFilename(String(body?.filename || 'w9.pdf'));
    const mimetypeHint = body?.mimetype ? String(body.mimetype).trim() : null;

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
      return NextResponse.json({ ok: false, error: e?.message || 'Invalid token', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }

    if (payload.role !== 'pro') {
      return NextResponse.json({ ok: false, error: 'Not a pro session', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }

    const proId = String(payload.sub || '').trim();
    if (!proId) {
      return NextResponse.json({ ok: false, error: 'Missing pro id', error_code: 'bad_session' }, { status: 401, headers: corsHeaders(request) });
    }

    if (!file) {
      return NextResponse.json({ ok: false, error: 'Missing file', error_code: 'bad_request' }, { status: 400, headers: corsHeaders(request) });
    }

    const parsed = parseDataUrl(file);
    const base64 = parsed.base64;
    const mimetype = mimetypeHint || parsed.mimetype || 'application/pdf';

    if (!base64) {
      return NextResponse.json({ ok: false, error: 'Missing file data', error_code: 'bad_request' }, { status: 400, headers: corsHeaders(request) });
    }

    const sbMain = getSupabase();
    const bucket = 'w9-forms';

    const objectPath = `${proId}/w9_${Date.now()}_${safeRandomId()}_${filename}`;
    const bytes = Buffer.from(base64, 'base64');

    const up = await sbMain.storage.from(bucket).upload(objectPath, bytes, {
      contentType: mimetype,
      upsert: false,
    });

    if (up?.error) {
      return NextResponse.json({ ok: false, error: up.error.message || 'Upload failed', error_code: 'upload_failed' }, { status: 500, headers: corsHeaders(request) });
    }

    const uploadedAt = new Date().toISOString();

    // Prefer signed URL for W9s (often private buckets).
    let w9Url: string | null = null;
    try {
      const signed = await sbMain.storage.from(bucket).createSignedUrl(objectPath, 60 * 60 * 24 * 365);
      if (!signed?.error && signed?.data?.signedUrl) w9Url = signed.data.signedUrl;
    } catch {
      // ignore
    }

    if (!w9Url) {
      try {
        const pub = sbMain.storage.from(bucket).getPublicUrl(objectPath);
        w9Url = pub?.data?.publicUrl || null;
      } catch {
        // ignore
      }
    }

    if (!w9Url) {
      return NextResponse.json({ ok: false, error: 'Failed to generate URL', error_code: 'upload_failed' }, { status: 500, headers: corsHeaders(request) });
    }

    const w9Status = 'uploaded';

    // Best-effort persist into dispatch pro profile row (so refresh keeps it).
    try {
      const dispatch = getSupabaseDispatch();
      if (dispatch) {
        await bestEffortUpdateProRow(dispatch, proId, [
          { w9_file_url: w9Url, w9_status: w9Status, w9_uploaded_at: uploadedAt },
          { w9_url: w9Url, w9_status: w9Status, w9_uploaded_at: uploadedAt },
          { w9_form_url: w9Url, w9_status: w9Status, w9_uploaded_at: uploadedAt },
          { w9_file_url: w9Url },
          { w9_url: w9Url },
          { w9_form_url: w9Url },
        ]);
      }
    } catch {
      // ignore
    }

    // Match portal.html expectations.
    return NextResponse.json(
      {
        ok: true,
        w9_file_url: w9Url,
        w9_status: w9Status,
        w9_uploaded_at: uploadedAt,
      },
      { headers: corsHeaders(request) }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error', error_code: 'server_error' }, { status: 500, headers: corsHeaders(request) });
  }
}
