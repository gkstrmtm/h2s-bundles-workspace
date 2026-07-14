import crypto from 'node:crypto';
import { Pool } from 'pg';

export const OWNER_MEDIA_DB_BUCKET = 'owner-media-db';

type OwnerMediaUploadRow = {
  asset_id: string;
  filename: string;
  content_type: string | null;
  media_kind: string;
  file_size_bytes: number | null;
  file_size_kb: number | null;
  created_at: string;
  updated_at: string;
  uploaded_by_user_id: string | null;
  uploaded_by_username: string | null;
  uploaded_by_display_name: string | null;
};

type OwnerMediaUploadBlobRow = OwnerMediaUploadRow & {
  blob_data: Buffer;
};

let pool: Pool | null = null;
let tableReady: Promise<void> | null = null;

function getDatabaseUrl(): string {
  const value = String(process.env.DATABASE_URL || '').trim();
  if (!value) throw new Error('DATABASE_URL is not configured');
  return value;
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl(),
      ssl: { rejectUnauthorized: false },
      max: 4,
    });
  }
  return pool;
}

export async function ensureOwnerMediaTable(): Promise<void> {
  if (tableReady) return tableReady;

  tableReady = (async () => {
    const sql = `
      create table if not exists owner_media_uploads (
        asset_id text primary key,
        filename text not null default '',
        content_type text,
        media_kind text not null default 'photo',
        file_size_bytes integer,
        file_size_kb integer,
        blob_data bytea not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        uploaded_by_user_id text,
        uploaded_by_username text,
        uploaded_by_display_name text
      );
      create index if not exists owner_media_uploads_created_at_idx on owner_media_uploads (created_at desc);
    `;
    await getPool().query(sql);
  })().catch((error) => {
    tableReady = null;
    throw error;
  });

  return tableReady;
}

function normalizeMediaKind(value: unknown): 'photo' | 'video' {
  return String(value || '').trim().toLowerCase() === 'video' ? 'video' : 'photo';
}

function toKb(bytes: number | null): number | null {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return null;
  return Math.max(1, Math.round(Number(bytes) / 1024));
}

export async function insertOwnerMediaUpload(input: {
  filename: string;
  contentType?: string | null;
  mediaKind?: string | null;
  bytes: Buffer;
  uploadedByUserId?: string | null;
  uploadedByUsername?: string | null;
  uploadedByDisplayName?: string | null;
}): Promise<OwnerMediaUploadRow> {
  await ensureOwnerMediaTable();

  const assetId = crypto.randomUUID();
  const filename = String(input.filename || 'upload').trim() || 'upload';
  const contentType = String(input.contentType || '').trim() || null;
  const mediaKind = normalizeMediaKind(input.mediaKind || contentType);
  const fileSizeBytes = Buffer.isBuffer(input.bytes) ? input.bytes.length : 0;
  const result = await getPool().query<OwnerMediaUploadRow>(
    `
      insert into owner_media_uploads (
        asset_id,
        filename,
        content_type,
        media_kind,
        file_size_bytes,
        file_size_kb,
        blob_data,
        uploaded_by_user_id,
        uploaded_by_username,
        uploaded_by_display_name
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      returning asset_id, filename, content_type, media_kind, file_size_bytes, file_size_kb, created_at, updated_at,
        uploaded_by_user_id, uploaded_by_username, uploaded_by_display_name
    `,
    [
      assetId,
      filename,
      contentType,
      mediaKind,
      fileSizeBytes,
      toKb(fileSizeBytes),
      input.bytes,
      input.uploadedByUserId || null,
      input.uploadedByUsername || null,
      input.uploadedByDisplayName || null,
      ],
  );
  return result.rows[0];
}

export async function listOwnerMediaUploadsFromDb(limit: number, offset: number): Promise<{ total: number; rows: OwnerMediaUploadRow[] }> {
  await ensureOwnerMediaTable();
  const totalResult = await getPool().query<{ count: string }>('select count(*)::text as count from owner_media_uploads');
  const listResult = await getPool().query<OwnerMediaUploadRow>(
    `
      select asset_id, filename, content_type, media_kind, file_size_bytes, file_size_kb, created_at, updated_at,
        uploaded_by_user_id, uploaded_by_username, uploaded_by_display_name
      from owner_media_uploads
      order by created_at desc
      limit $1 offset $2
    `,
    [limit, offset],
  );
  return {
    total: Number.parseInt(String(totalResult.rows[0]?.count || '0'), 10) || 0,
    rows: listResult.rows,
  };
}

export async function getOwnerMediaUploadByAssetId(assetId: string): Promise<OwnerMediaUploadBlobRow | null> {
  await ensureOwnerMediaTable();
  const result = await getPool().query<OwnerMediaUploadBlobRow>(
    `
      select asset_id, filename, content_type, media_kind, file_size_bytes, file_size_kb, created_at, updated_at,
        uploaded_by_user_id, uploaded_by_username, uploaded_by_display_name, blob_data
      from owner_media_uploads
      where asset_id = $1
      limit 1
    `,
    [String(assetId || '').trim()],
  );
  return result.rows[0] || null;
}

export async function deleteOwnerMediaUploadByAssetId(assetId: string): Promise<boolean> {
  await ensureOwnerMediaTable();
  const result = await getPool().query('delete from owner_media_uploads where asset_id = $1', [String(assetId || '').trim()]);
  return Number(result.rowCount || 0) > 0;
}