import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getOwnerMediaAuthUser } from '@/lib/ownerMediaAuth';
import { OWNER_MEDIA_DB_BUCKET, insertOwnerMediaUpload, isOwnerMediaDuplicateError } from '@/lib/ownerMediaDb';
import {
  OWNER_MEDIA_BUCKET,
  ensureOwnerMediaBucket,
  getOwnerMediaStorageClient,
} from '@/lib/ownerMediaStore';

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
  const surface = String(body.surface || '').trim().toLowerCase();
  const rawPath = String(body.raw_path || '').trim();
  if (!rawPath) {
    return NextResponse.json({ ok: false, error: 'raw_path required' }, { status: 400, headers: corsHeaders(request) });
  }

  const targetBucket = surface === 'owner_media' ? OWNER_MEDIA_BUCKET : bucket;

  // For now: treat the staged raw object as the final object.
  // This unblocks large uploads immediately; conversion can be layered on later.
  const finalPath = rawPath;

  // Optional sanity check: object exists.
  try {
    const sb = surface === 'owner_media' ? getOwnerMediaStorageClient() : getSupabase();
    if (surface === 'owner_media') await ensureOwnerMediaBucket(sb);
    const signed = await sb.storage.from(targetBucket).createSignedUrl(finalPath, 60);
    if (signed.error) {
      return NextResponse.json(
        { ok: false, error: `Uploaded object not found at ${targetBucket}/${finalPath}` },
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
    const sb = surface === 'owner_media' ? getOwnerMediaStorageClient() : getSupabase();
    const pub = sb.storage.from(targetBucket).getPublicUrl(finalPath);
    publicUrl = String(pub?.data?.publicUrl || '').trim() || null;
  } catch {
    publicUrl = null;
  }

  if (surface === 'owner_media') {
    const authed = await getOwnerMediaAuthUser(request);
    if (!authed) {
      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
    }

    try {
      const sb = getOwnerMediaStorageClient();
      await ensureOwnerMediaBucket(sb);
      const downloaded = await sb.storage.from(OWNER_MEDIA_BUCKET).download(finalPath);
      if (downloaded.error || !downloaded.data) {
        return NextResponse.json(
          { ok: false, error: 'Uploaded file could not be finalized.' },
          { status: 400, headers: corsHeaders(request) },
        );
      }

      const bytes = Buffer.from(await downloaded.data.arrayBuffer());
      const saved = await insertOwnerMediaUpload({
        filename: String(body.filename || 'upload').trim() || 'upload',
        contentType: mime || downloaded.data.type || 'application/octet-stream',
        mediaKind: String(body.media_kind || '').trim() || (String(mime || downloaded.data.type || '').startsWith('video/') ? 'video' : 'photo'),
        bytes,
        capturedAtOriginal: String(body.captured_at_original || '').trim() || null,
        capturedAtSource: String(body.captured_at_source || '').trim() || null,
        uploadedByUserId: authed.userId,
        uploadedByUsername: authed.username,
        uploadedByDisplayName: authed.displayName,
      });

      try {
        await sb.storage.from(OWNER_MEDIA_BUCKET).remove([finalPath]);
      } catch {
        // Best effort cleanup only.
      }

      return NextResponse.json(
        {
          ok: true,
          bucket: OWNER_MEDIA_DB_BUCKET,
          path: saved.asset_id,
          public_url: `/api/proof-asset-media?bucket=${encodeURIComponent(OWNER_MEDIA_DB_BUCKET)}&path=${encodeURIComponent(saved.asset_id)}`,
          content_type: saved.content_type,
          file_size_kb: saved.file_size_kb,
          media_kind: saved.media_kind,
          original_name: saved.filename,
          converted_to_mp4: false,
          received_convert_to_mp4: wantsConvert ? 'true' : 'false',
          warnings,
        },
        { headers: corsHeaders(request) },
      );
    } catch (error: any) {
      if (isOwnerMediaDuplicateError(error)) {
        return NextResponse.json(
          {
            ok: false,
            error: 'This image has already been uploaded.',
            error_code: 'duplicate_owner_upload',
            existing_upload: error.existingUpload || null,
          },
          { status: 409, headers: corsHeaders(request) },
        );
      }

      return NextResponse.json(
        { ok: false, error: 'Uploaded file could not be finalized.' },
        { status: 500, headers: corsHeaders(request) },
      );
    }
  }

  return NextResponse.json(
    {
      ok: true,
      bucket: targetBucket,
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
