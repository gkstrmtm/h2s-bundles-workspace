import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import path from 'node:path';
import { getSupabase } from '@/lib/supabase';
import { getOwnerMediaAuthUser } from '@/lib/ownerMediaAuth';
import { OWNER_MEDIA_DB_BUCKET, insertOwnerMediaUpload } from '@/lib/ownerMediaDb';
import {
  OWNER_MEDIA_BUCKET,
  buildOwnerMediaObjectPath,
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

function safeExtFromFilename(filename: string): string {
  const ext = path.extname(filename || '').replace(/^\./, '').toLowerCase();
  if (!ext) return '';
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return '';
  return ext;
}

function sanitizeBasename(filename: string): string {
  const base = path.basename(String(filename || 'upload'));
  return base
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 120) || 'upload';
}

function chooseBucket(input: unknown): string {
  const raw = String(input ?? '').trim();
  if (!raw) return 'proof';
  if (!/^[a-z0-9._-]{1,64}$/i.test(raw)) return 'proof';
  return raw;
}

export async function POST(request: Request) {
  // This endpoint is intentionally limited: it receives the file bytes directly,
  // so clients should use staged uploads for anything large.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid form data' }, { status: 400, headers: corsHeaders(request) });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'file required' }, { status: 400, headers: corsHeaders(request) });
  }

  const surface = String(form.get('surface') || '').trim().toLowerCase();
  if (surface === 'owner_media') {
    const authed = await getOwnerMediaAuthUser(request);
    if (!authed) {
      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const saved = await insertOwnerMediaUpload({
      filename: file.name || 'upload',
      contentType: file.type || 'application/octet-stream',
      mediaKind: String(form.get('media_kind') || '').trim() || (String(file.type || '').startsWith('video/') ? 'video' : 'photo'),
      bytes,
      uploadedByUserId: authed.userId,
      uploadedByUsername: authed.username,
      uploadedByDisplayName: authed.displayName,
    });

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
        received_convert_to_mp4: String(form.get('convert_to_mp4') || ''),
        warnings: [],
      },
      { headers: corsHeaders(request) },
    );
  }

  const bucket = chooseBucket(form.get('bucket'));
  const originalName = sanitizeBasename(file.name || 'upload');
  const ext = safeExtFromFilename(originalName);
  const objectPath = surface === 'owner_media'
    ? buildOwnerMediaObjectPath(originalName)
    : `uploads/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`;

  let client;
  try {
    if (surface === 'owner_media') {
      client = getOwnerMediaStorageClient();
      await ensureOwnerMediaBucket(client);
    } else {
      client = getSupabase();
    }
  } catch {
    return NextResponse.json({ ok: false, error: 'Storage unavailable' }, { status: 503, headers: corsHeaders(request) });
  }

  const targetBucket = surface === 'owner_media' ? OWNER_MEDIA_BUCKET : bucket;

  const bytes = Buffer.from(await file.arrayBuffer());
  const contentType = String(file.type || 'application/octet-stream');

  const up = await client.storage.from(targetBucket).upload(objectPath, bytes, {
    contentType,
    upsert: false,
  });
  if (up.error) {
    return NextResponse.json(
      { ok: false, error: up.error.message || 'Upload failed' },
      { status: 500, headers: corsHeaders(request) },
    );
  }

  let publicUrl: string | null = null;
  try {
    const pub = client.storage.from(targetBucket).getPublicUrl(objectPath);
    publicUrl = String(pub?.data?.publicUrl || '').trim() || null;
  } catch {
    publicUrl = null;
  }

  return NextResponse.json(
    {
      ok: true,
      bucket: targetBucket,
      path: objectPath,
      public_url: publicUrl,
      content_type: contentType,
      file_size_kb: Math.round(bytes.length / 1024),
      original_name: originalName,
      converted_to_mp4: false,
      received_convert_to_mp4: String(form.get('convert_to_mp4') || ''),
      warnings: [],
    },
    { headers: corsHeaders(request) },
  );
}
