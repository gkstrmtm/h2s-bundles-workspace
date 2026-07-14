import crypto from 'node:crypto';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseMgmt } from '@/lib/supabase';

export const OWNER_MEDIA_BUCKET = 'owner-media';
export const OWNER_MEDIA_PREFIX = 'uploads';

let ownerMediaBucketReady: Promise<void> | null = null;

function safeExtFromFilename(filename: string): string {
  const ext = path.extname(String(filename || '')).replace(/^\./, '').toLowerCase();
  if (!ext) return '';
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return '';
  return ext;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  const b64 = Buffer.from(binary, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function getOwnerMediaStorageClient(): SupabaseClient {
  return getSupabaseMgmt();
}

export async function ensureOwnerMediaBucket(client?: SupabaseClient): Promise<void> {
  if (ownerMediaBucketReady) return ownerMediaBucketReady;

  ownerMediaBucketReady = (async () => {
    const sb = client || getOwnerMediaStorageClient();
    try {
      const listed = await sb.storage.listBuckets();
      const buckets = Array.isArray(listed.data) ? listed.data : [];
      const exists = buckets.some((bucket: any) => String(bucket?.name || '').trim() === OWNER_MEDIA_BUCKET);
      if (exists) return;
    } catch {
      // Fall through and try createBucket directly.
    }

    const created = await sb.storage.createBucket(OWNER_MEDIA_BUCKET, {
      public: false,
      fileSizeLimit: '250MB',
    });

    if (created.error && !String(created.error.message || '').toLowerCase().includes('already exists')) {
      throw created.error;
    }
  })().catch((error) => {
    ownerMediaBucketReady = null;
    throw error;
  });

  return ownerMediaBucketReady;
}

export function buildOwnerMediaObjectPath(filename: string): string {
  const id = crypto.randomUUID();
  const ext = safeExtFromFilename(filename);
  return `${OWNER_MEDIA_PREFIX}/${id}${ext ? `.${ext}` : ''}`;
}

export function isOwnerMediaBucket(bucket: unknown): boolean {
  return String(bucket || '').trim() === OWNER_MEDIA_BUCKET;
}

export function inferAssetId(objectPath: string): string {
  return bytesToBase64Url(new Uint8Array(crypto.createHash('sha256').update(String(objectPath || ''), 'utf8').digest()));
}

export function inferContentType(item: any): string {
  const metadata = item && typeof item.metadata === 'object' ? item.metadata : {};
  return String(metadata?.mimetype || metadata?.contentType || item?.content_type || '').trim();
}

export function inferMediaKind(contentType: unknown, objectPath: unknown): 'photo' | 'video' {
  const type = String(contentType || '').trim().toLowerCase();
  const pathValue = String(objectPath || '').trim().toLowerCase();
  if (type.startsWith('video/') || /\.(mp4|mov|avi|webm|m4v|mkv)(\?|$)/i.test(pathValue)) return 'video';
  return 'photo';
}

export function inferFileSizeKb(item: any): number | null {
  const metadata = item && typeof item.metadata === 'object' ? item.metadata : {};
  const size = Number(metadata?.size ?? item?.size ?? 0);
  if (!Number.isFinite(size) || size <= 0) return null;
  return Math.max(1, Math.round(size / 1024));
}

export function inferTimestamp(item: any): string | null {
  return String(item?.updated_at || item?.created_at || '').trim() || null;
}