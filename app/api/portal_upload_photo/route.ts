import { NextResponse } from 'next/server';
import { getSupabase, getSupabaseDispatch } from '@/lib/supabase';
import { verifyPortalToken } from '@/lib/portalTokens';
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

function extFromMime(mime: string | null): string {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  return 'jpg';
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
    const image = String(body?.image || '').trim();
    const filename = sanitizeFilename(String(body?.filename || 'profile.jpg'));

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

    if (!image) {
      return NextResponse.json({ ok: false, error: 'Missing image', error_code: 'bad_request' }, { status: 400, headers: corsHeaders(request) });
    }

    const { base64, mimetype } = parseDataUrl(image);
    if (!base64) {
      return NextResponse.json({ ok: false, error: 'Missing image data', error_code: 'bad_request' }, { status: 400, headers: corsHeaders(request) });
    }

    const sbMain = getSupabase();
    const bucket = 'profile-photos';

    const ext = extFromMime(mimetype);
    const filenameBase = filename.replace(/\.[a-z0-9]+$/i, '');
    const objectPath = `${proId}/profile_${Date.now()}_${safeRandomId()}_${filenameBase}.${ext}`.replace(/\.{2,}/g, '.');

    const bytes = Buffer.from(base64, 'base64');

    const up = await sbMain.storage.from(bucket).upload(objectPath, bytes, {
      contentType: mimetype || 'image/jpeg',
      upsert: false,
    });

    if (up?.error) {
      return NextResponse.json({ ok: false, error: up.error.message || 'Upload failed', error_code: 'upload_failed' }, { status: 500, headers: corsHeaders(request) });
    }

    // Bucket is expected to be public, but fall back to signed URL just in case.
    let url: string | null = null;
    try {
      const pub = sbMain.storage.from(bucket).getPublicUrl(objectPath);
      url = pub?.data?.publicUrl || null;
    } catch {
      // ignore
    }

    if (!url) {
      try {
        const signed = await sbMain.storage.from(bucket).createSignedUrl(objectPath, 60 * 60 * 24 * 365);
        if (!signed?.error && signed?.data?.signedUrl) url = signed.data.signedUrl;
      } catch {
        // ignore
      }
    }

    if (!url) {
      return NextResponse.json({ ok: false, error: 'Failed to generate URL', error_code: 'upload_failed' }, { status: 500, headers: corsHeaders(request) });
    }

    // Best-effort persist into dispatch pro profile row (so refresh keeps it).
    try {
      const dispatch = getSupabaseDispatch();
      if (dispatch) {
        await bestEffortUpdateProRow(dispatch, proId, [
          { photo_url: url },
          { profile_photo_url: url },
          { avatar_url: url },
          { photo: url },
          { headshot_url: url },
          { image_url: url },
        ]);
      }
    } catch {
      // ignore
    }

    return NextResponse.json({ ok: true, url }, { headers: corsHeaders(request) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error', error_code: 'server_error' }, { status: 500, headers: corsHeaders(request) });
  }
}
