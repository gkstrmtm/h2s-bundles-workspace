import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function corsHeaders(request?: Request) {
  const origin = String(request?.headers?.get('origin') || '').trim();
  const allowOrigin = origin || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin === 'null' ? '*' : allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cache-Control, X-Requested-With, X-Admin-Key, x-admin-key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  } as Record<string, string>;
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

function chooseBucket(input: unknown): string {
  const raw = String(input ?? '').trim();
  if (!raw) return 'proof';
  if (!/^[a-z0-9._-]{1,64}$/i.test(raw)) return 'proof';
  return raw;
}

export async function POST(request: Request) {
  let body: any = null;
  try {
    body = await request.json();
  } catch {
    // ignore
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400, headers: corsHeaders(request) });
  }

  const bucket = chooseBucket(body.bucket);
  const rawPath = String(body.raw_path || '').trim();
  if (!rawPath) {
    return NextResponse.json({ ok: false, error: 'raw_path required' }, { status: 400, headers: corsHeaders(request) });
  }

  // For now: treat the staged raw object as the final object.
  // This unblocks large uploads immediately; conversion can be layered on later.
  const finalPath = rawPath;

  // Optional sanity check: object exists.
  try {
    const sb = getSupabase();
    const signed = await sb.storage.from(bucket).createSignedUrl(finalPath, 60);
    if (signed.error) {
      return NextResponse.json(
        { ok: false, error: `Uploaded object not found at ${bucket}/${finalPath}` },
        { status: 400, headers: corsHeaders(request) },
      );
    }
  } catch {
    // If storage is unavailable, still respond with a deterministic payload so UI can proceed.
  }

  const receivedConvertToMp4 = String(body.convert_to_mp4 ?? '').trim();
  const wantsConvert = receivedConvertToMp4 === '1' || receivedConvertToMp4.toLowerCase() === 'true';

  const mime = String(body.mime || body.content_type || '').trim();

  const warnings: string[] = [];
  if (wantsConvert) {
    warnings.push('MP4 conversion is not performed during staged finalize on this deployment. Raw upload stored as-is.');
  }

  let publicUrl: string | null = null;
  try {
    const sb = getSupabase();
    const pub = sb.storage.from(bucket).getPublicUrl(finalPath);
    publicUrl = String(pub?.data?.publicUrl || '').trim() || null;
  } catch {
    publicUrl = null;
  }

  return NextResponse.json(
    {
      ok: true,
      bucket,
      path: finalPath,
      public_url: publicUrl,
      content_type: mime || null,
      converted_to_mp4: false,
      received_convert_to_mp4: wantsConvert ? 'true' : 'false',
      warnings,
    },
    { headers: corsHeaders(request) },
  );
}
