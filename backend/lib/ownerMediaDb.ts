import crypto from 'node:crypto';
import prisma from '@/lib/prisma';

export const OWNER_MEDIA_DB_BUCKET = 'owner-media-db';

type OwnerMediaUploadRow = {
  asset_id: string;
  filename: string;
  content_type: string | null;
  content_sha256: string | null;
  media_kind: string;
  file_size_bytes: number | null;
  file_size_kb: number | null;
  created_at: string;
  updated_at: string;
  captured_at_original: string | null;
  captured_at_source: string | null;
  uploaded_by_user_id: string | null;
  uploaded_by_username: string | null;
  uploaded_by_display_name: string | null;
  source_type: string;
  source_job_id: string | null;
  service_type: string | null;
  city: string | null;
  completion_date: string | null;
  customer_media_opt_in: string;
  usage_rights_status: string;
  media_team_visible: boolean;
  qa_hold: boolean;
  review_state: string;
  review_note: string | null;
  soft_location_label: string | null;
  capture_source: string | null;
  frontend_destinations: string[] | null;
  display_order: number | null;
  psychological_weight: number | null;
};

type OwnerMediaUploadBlobRow = OwnerMediaUploadRow & {
  blob_data: Buffer;
};

const OWNER_MEDIA_SELECT_COLUMNS = `
  asset_id, filename, content_type, content_sha256, media_kind, file_size_bytes, file_size_kb, created_at, updated_at,
  captured_at_original, captured_at_source,
  uploaded_by_user_id, uploaded_by_username, uploaded_by_display_name,
  source_type, source_job_id, service_type, city, completion_date, customer_media_opt_in, usage_rights_status,
  media_team_visible, qa_hold, review_state, review_note, soft_location_label, capture_source,
  frontend_destinations, display_order, psychological_weight
`;

const OWNER_MEDIA_SELECT_COLUMNS_WITH_BLOB = `${OWNER_MEDIA_SELECT_COLUMNS}, blob_data`;

type OwnerMediaListOptions = {
  state?: string | null;
  audience?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  dateField?: string | null;
  sortBy?: string | null;
};

type OwnerMediaListSummary = {
  total: number;
  pending: number;
  reviewed: number;
  approved: number;
  rejected: number;
  published: number;
  media_team_visible: number;
};

type OwnerMediaMetadataPatch = {
  sourceType?: string | null;
  sourceJobId?: string | null;
  serviceType?: string | null;
  city?: string | null;
  completionDate?: string | null;
  capturedAtOriginal?: string | null;
  capturedAtSource?: string | null;
  customerMediaOptIn?: string | null;
  usageRightsStatus?: string | null;
  mediaTeamVisible?: boolean | null;
  qaHold?: boolean | null;
  reviewState?: string | null;
  reviewNote?: string | null;
  softLocationLabel?: string | null;
  captureSource?: string | null;
  frontendDestinations?: string[] | string | null;
  displayOrder?: number | string | null;
  psychologicalWeight?: number | string | null;
};

let tableReady: Promise<void> | null = null;

type OwnerMediaDuplicateSummary = {
  asset_id: string;
  filename: string;
  created_at: string;
};

export class OwnerMediaDuplicateError extends Error {
  readonly code = 'OWNER_MEDIA_DUPLICATE';

  readonly status = 409;

  readonly existingUpload: OwnerMediaDuplicateSummary | null;

  constructor(existingUpload?: OwnerMediaDuplicateSummary | null) {
    super('This image has already been uploaded.');
    this.name = 'OwnerMediaDuplicateError';
    this.existingUpload = existingUpload || null;
  }
}

export function isOwnerMediaDuplicateError(error: unknown): error is OwnerMediaDuplicateError {
  return error instanceof OwnerMediaDuplicateError
    || (typeof error === 'object' && error != null && (error as { code?: unknown }).code === 'OWNER_MEDIA_DUPLICATE');
}

async function executeSql(query: string, params: unknown[] = []): Promise<number> {
  return prisma.$executeRawUnsafe(query, ...params);
}

async function queryRows<T>(query: string, params: unknown[] = []): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(query, ...params);
}

function hashOwnerMediaBytes(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function toOwnerMediaDuplicateSummary(row: OwnerMediaUploadRow | null | undefined): OwnerMediaDuplicateSummary | null {
  if (!row) return null;
  return {
    asset_id: row.asset_id,
    filename: row.filename,
    created_at: row.created_at,
  };
}

async function backfillOwnerMediaContentHashes(): Promise<void> {
  const rows = await queryRows<{ asset_id: string; blob_data: Buffer }>(
    `
      select asset_id, blob_data
      from owner_media_uploads
      where content_sha256 is null
    `,
  );

  for (const row of rows) {
    const contentSha256 = hashOwnerMediaBytes(row.blob_data);
    await executeSql(
      `
        update owner_media_uploads
        set content_sha256 = $2
        where asset_id = $1
          and content_sha256 is null
      `,
      [row.asset_id, contentSha256],
    );
  }
}

async function getOwnerMediaUploadByContentHash(contentSha256: string): Promise<OwnerMediaUploadRow | null> {
  const rows = await queryRows<OwnerMediaUploadRow>(
    `
      select ${OWNER_MEDIA_SELECT_COLUMNS}
      from owner_media_uploads
      where content_sha256 = $1
      order by created_at asc
      limit 1
    `,
    [String(contentSha256 || '').trim()],
  );
  return rows[0] || null;
}

export async function ensureOwnerMediaTable(): Promise<void> {
  if (tableReady) return tableReady;

  tableReady = (async () => {
    const statements = [
      `
        create table if not exists owner_media_uploads (
          asset_id text primary key,
          filename text not null default '',
          content_type text,
          content_sha256 text,
          media_kind text not null default 'photo',
          file_size_bytes integer,
          file_size_kb integer,
          blob_data bytea not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          captured_at_original timestamptz,
          captured_at_source text,
          uploaded_by_user_id text,
          uploaded_by_username text,
          uploaded_by_display_name text,
          source_type text not null default 'owner_manual',
          source_job_id text,
          service_type text,
          city text,
          completion_date date,
          customer_media_opt_in text not null default 'owner_admin_controlled',
          usage_rights_status text not null default 'pending_review',
          media_team_visible boolean not null default false,
          qa_hold boolean not null default false,
          review_state text not null default 'pending',
          review_note text,
          soft_location_label text,
          capture_source text
        )
      `,
      `create index if not exists owner_media_uploads_created_at_idx on owner_media_uploads (created_at desc)`,
      `alter table owner_media_uploads add column if not exists source_type text not null default 'owner_manual'`,
      `alter table owner_media_uploads add column if not exists source_job_id text`,
      `alter table owner_media_uploads add column if not exists service_type text`,
      `alter table owner_media_uploads add column if not exists city text`,
      `alter table owner_media_uploads add column if not exists completion_date date`,
      `alter table owner_media_uploads add column if not exists content_sha256 text`,
      `alter table owner_media_uploads add column if not exists captured_at_original timestamptz`,
      `alter table owner_media_uploads add column if not exists captured_at_source text`,
      `alter table owner_media_uploads add column if not exists customer_media_opt_in text not null default 'owner_admin_controlled'`,
      `alter table owner_media_uploads add column if not exists usage_rights_status text not null default 'pending_review'`,
      `alter table owner_media_uploads add column if not exists media_team_visible boolean not null default false`,
      `alter table owner_media_uploads add column if not exists qa_hold boolean not null default false`,
      `alter table owner_media_uploads add column if not exists review_state text not null default 'pending'`,
      `alter table owner_media_uploads add column if not exists review_note text`,
      `alter table owner_media_uploads add column if not exists soft_location_label text`,
      `alter table owner_media_uploads add column if not exists capture_source text`,
      `alter table owner_media_uploads add column if not exists frontend_destinations text[] not null default '{}'::text[]`,
      `alter table owner_media_uploads add column if not exists display_order integer not null default 100`,
      `alter table owner_media_uploads add column if not exists psychological_weight integer not null default 20`,
      `create index if not exists owner_media_uploads_content_sha256_idx on owner_media_uploads (content_sha256)`,
      `create index if not exists owner_media_uploads_captured_at_original_idx on owner_media_uploads (captured_at_original desc)`,
      `create index if not exists owner_media_uploads_review_state_idx on owner_media_uploads (review_state, created_at desc)`,
      `create index if not exists owner_media_uploads_media_team_visible_idx on owner_media_uploads (media_team_visible, created_at desc)`,
      `create index if not exists owner_media_uploads_display_order_idx on owner_media_uploads (display_order asc, updated_at desc)`,
      `create index if not exists owner_media_uploads_frontend_destinations_idx on owner_media_uploads using gin (frontend_destinations)`,
      `
        update owner_media_uploads
        set
          source_type = coalesce(nullif(source_type, ''), 'owner_manual'),
          customer_media_opt_in = coalesce(nullif(customer_media_opt_in, ''), 'owner_admin_controlled'),
          usage_rights_status = coalesce(nullif(usage_rights_status, ''), 'pending_review'),
          review_state = coalesce(nullif(review_state, ''), 'pending'),
          media_team_visible = coalesce(media_team_visible, false),
          qa_hold = coalesce(qa_hold, false),
          frontend_destinations = coalesce(frontend_destinations, '{}'::text[]),
          display_order = coalesce(display_order, 100),
          psychological_weight = coalesce(psychological_weight, 20)
        where
          source_type is null
          or customer_media_opt_in is null
          or usage_rights_status is null
          or review_state is null
          or media_team_visible is null
          or qa_hold is null
          or frontend_destinations is null
          or display_order is null
          or psychological_weight is null
      `,
    ];

    for (const statement of statements) {
      await executeSql(statement);
    }

    await backfillOwnerMediaContentHashes();
  })().catch((error) => {
    tableReady = null;
    throw error;
  });

  return tableReady;
}

function normalizeMediaKind(value: unknown): 'photo' | 'video' {
  return String(value || '').trim().toLowerCase() === 'video' ? 'video' : 'photo';
}

function normalizeString(value: unknown, fallback = ''): string {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeSourceType(value: unknown): string {
  const normalized = normalizeString(value, 'owner_manual').toLowerCase();
  if (normalized === 'technician_job') return 'technician_job';
  if (normalized === 'imported') return 'imported';
  return 'owner_manual';
}

function normalizeReviewState(value: unknown): string {
  const normalized = normalizeString(value, 'pending').toLowerCase();
  if (normalized === 'reviewed') return 'reviewed';
  if (normalized === 'approved') return 'approved';
  if (normalized === 'rejected') return 'rejected';
  if (normalized === 'published') return 'published';
  return 'pending';
}

function normalizeCustomerMediaOptIn(value: unknown): string {
  const normalized = normalizeString(value, 'owner_admin_controlled').toLowerCase();
  if (normalized === 'granted') return 'granted';
  if (normalized === 'declined') return 'declined';
  if (normalized === 'unknown') return 'unknown';
  if (normalized === 'not_applicable') return 'not_applicable';
  return 'owner_admin_controlled';
}

function normalizeUsageRightsStatus(value: unknown): string {
  const normalized = normalizeString(value, 'pending_review').toLowerCase();
  if (normalized === 'social_allowed') return 'social_allowed';
  if (normalized === 'internal_only') return 'internal_only';
  if (normalized === 'remove_requested') return 'remove_requested';
  return 'pending_review';
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value !== 0 : fallback;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeFrontendDestinations(value: unknown): string[] {
  const input = Array.isArray(value)
    ? value
    : (typeof value === 'string'
      ? value.split(/\r?\n|,|\u2022|\u2023|\u25E6/)
      : []);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const normalized = String(raw ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9:_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= 24) break;
  }
  return out;
}

function normalizeDisplayOrder(value: unknown, fallback = 100): number {
  return normalizeInteger(value, fallback, 0, 999);
}

function normalizePsychologicalWeight(value: unknown, fallback = 20): number {
  return normalizeInteger(value, fallback, 0, 100);
}

function normalizeCompletionDate(value: unknown): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function normalizeOptionalTimestamp(value: unknown): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeDateBoundary(value: unknown, mode: 'start' | 'end'): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const suffix = mode === 'start' ? 'T00:00:00.000Z' : 'T00:00:00.000Z';
    const base = new Date(`${normalized}${suffix}`);
    if (Number.isNaN(base.getTime())) return null;
    if (mode === 'end') base.setUTCDate(base.getUTCDate() + 1);
    return base.toISOString();
  }
  return normalizeOptionalTimestamp(normalized);
}

function normalizeCapturedAtSource(value: unknown): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  if (['exif', 'video_metadata', 'file_last_modified', 'manual', 'unknown'].includes(lower)) return lower;
  return normalized;
}

function normalizeDateField(value: unknown): 'uploaded' | 'captured' {
  return String(value || '').trim().toLowerCase() === 'captured' ? 'captured' : 'uploaded';
}

function normalizeSortBy(value: unknown): 'uploaded' | 'captured' {
  return String(value || '').trim().toLowerCase() === 'captured' ? 'captured' : 'uploaded';
}

function canBeVisibleToMediaTeam(input: {
  reviewState: string;
  usageRightsStatus: string;
  customerMediaOptIn: string;
  qaHold: boolean;
}): boolean {
  if (input.qaHold) return false;
  if (input.customerMediaOptIn === 'declined') return false;
  if (input.usageRightsStatus !== 'social_allowed') return false;
  return input.reviewState === 'approved' || input.reviewState === 'published';
}

function buildListWhereClause(options?: OwnerMediaListOptions) {
  const params: Array<string | number | boolean> = [];
  const clauses: string[] = [];
  const normalizedState = normalizeString(options?.state || 'all', 'all').toLowerCase();
  const normalizedAudience = normalizeString(options?.audience || 'all', 'all').toLowerCase();
  const normalizedDateField = normalizeDateField(options?.dateField);

  if (normalizedState !== 'all') {
    params.push(normalizeReviewState(normalizedState));
    clauses.push(`review_state = $${params.length}`);
  }

  if (normalizedAudience === 'media_team') {
    clauses.push(`media_team_visible = true`);
    clauses.push(`coalesce(qa_hold, false) = false`);
    clauses.push(`review_state in ('approved', 'published')`);
    clauses.push(`usage_rights_status = 'social_allowed'`);
    clauses.push(`customer_media_opt_in <> 'declined'`);
  }

  const dateColumn = normalizedDateField === 'captured'
    ? 'captured_at_original'
    : 'created_at';
  const dateFrom = normalizeDateBoundary(options?.dateFrom, 'start');
  const dateTo = normalizeDateBoundary(options?.dateTo, 'end');
  if (dateFrom) {
    params.push(dateFrom);
    clauses.push(`${dateColumn} >= $${params.length}`);
  }
  if (dateTo) {
    params.push(dateTo);
    clauses.push(`${dateColumn} < $${params.length}`);
  }

  return {
    params,
    whereSql: clauses.length ? `where ${clauses.join(' and ')}` : '',
  };
}

function buildOwnerMediaListOrderBy(options?: OwnerMediaListOptions): string {
  const sortBy = normalizeSortBy(options?.sortBy);
  if (sortBy === 'captured') {
    return 'order by coalesce(captured_at_original, created_at) desc, created_at desc, asset_id desc';
  }
  return 'order by coalesce(updated_at, created_at) desc, created_at desc, asset_id desc';
}

function buildDedupedOwnerMediaListCte(whereSql: string): string {
  return `
    with filtered_uploads as (
      select *
      from owner_media_uploads
      ${whereSql}
    ),
    ranked_uploads as (
      select
        *,
        row_number() over (
          partition by coalesce(nullif(content_sha256, ''), asset_id)
          order by
            case
              when media_team_visible = true or review_state = 'published' then 4
              when review_state = 'approved' then 3
              when review_state = 'reviewed' then 2
              when review_state = 'pending' then 1
              else 0
            end desc,
            coalesce(updated_at, created_at) desc,
            created_at desc,
            asset_id desc
        ) as dedupe_rank
      from filtered_uploads
    ),
    deduped_uploads as (
      select *
      from ranked_uploads
      where dedupe_rank = 1
    )
  `;
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
  sourceType?: string | null;
  sourceJobId?: string | null;
  serviceType?: string | null;
  city?: string | null;
  completionDate?: string | null;
  capturedAtOriginal?: string | null;
  capturedAtSource?: string | null;
  customerMediaOptIn?: string | null;
  usageRightsStatus?: string | null;
  mediaTeamVisible?: boolean | null;
  qaHold?: boolean | null;
  reviewState?: string | null;
  reviewNote?: string | null;
  softLocationLabel?: string | null;
  captureSource?: string | null;
  frontendDestinations?: string[] | string | null;
  displayOrder?: number | string | null;
  psychologicalWeight?: number | string | null;
}): Promise<OwnerMediaUploadRow> {
  await ensureOwnerMediaTable();

  const assetId = crypto.randomUUID();
  const filename = String(input.filename || 'upload').trim() || 'upload';
  const contentType = String(input.contentType || '').trim() || null;
  const contentSha256 = hashOwnerMediaBytes(input.bytes);
  const mediaKind = normalizeMediaKind(input.mediaKind || contentType);
  const fileSizeBytes = Buffer.isBuffer(input.bytes) ? input.bytes.length : 0;
  const sourceType = normalizeSourceType(input.sourceType);
  const reviewState = normalizeReviewState(input.reviewState);
  const customerMediaOptIn = normalizeCustomerMediaOptIn(input.customerMediaOptIn);
  const usageRightsStatus = normalizeUsageRightsStatus(input.usageRightsStatus);
  const qaHold = normalizeBoolean(input.qaHold, false);
  const requestedMediaTeamVisible = normalizeBoolean(input.mediaTeamVisible, false);
  const mediaTeamVisible = requestedMediaTeamVisible && canBeVisibleToMediaTeam({
    reviewState,
    usageRightsStatus,
    customerMediaOptIn,
    qaHold,
  });
  const frontendDestinations = normalizeFrontendDestinations(input.frontendDestinations);
  const displayOrder = normalizeDisplayOrder(input.displayOrder, 100);
  const psychologicalWeight = normalizePsychologicalWeight(input.psychologicalWeight, 20);
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`select pg_advisory_xact_lock(hashtext($1))`, contentSha256);

    const existingRows = await tx.$queryRawUnsafe<OwnerMediaUploadRow[]>(
      `
        select ${OWNER_MEDIA_SELECT_COLUMNS}
        from owner_media_uploads
        where content_sha256 = $1
        order by created_at asc
        limit 1
      `,
      contentSha256,
    );

    if (existingRows[0]) {
      throw new OwnerMediaDuplicateError(toOwnerMediaDuplicateSummary(existingRows[0]));
    }

    return tx.$queryRawUnsafe<OwnerMediaUploadRow[]>(
      `
        insert into owner_media_uploads (
          asset_id,
          filename,
          content_type,
          content_sha256,
          media_kind,
          file_size_bytes,
          file_size_kb,
          blob_data,
          captured_at_original,
          captured_at_source,
          uploaded_by_user_id,
          uploaded_by_username,
          uploaded_by_display_name,
          source_type,
          source_job_id,
          service_type,
          city,
          completion_date,
          customer_media_opt_in,
          usage_rights_status,
          media_team_visible,
          qa_hold,
          review_state,
          review_note,
          soft_location_label,
          capture_source,
          frontend_destinations,
          display_order,
          psychological_weight
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10,$11,$12,$13,$14,$15,$16,$17,$18::date,$19,$20,$21,$22,$23,$24,$25,$26,$27::text[],$28,$29)
        returning ${OWNER_MEDIA_SELECT_COLUMNS}
      `,
      assetId,
      filename,
      contentType,
      contentSha256,
      mediaKind,
      fileSizeBytes,
      toKb(fileSizeBytes),
      input.bytes,
      normalizeOptionalTimestamp(input.capturedAtOriginal),
      normalizeCapturedAtSource(input.capturedAtSource),
      input.uploadedByUserId || null,
      input.uploadedByUsername || null,
      input.uploadedByDisplayName || null,
      sourceType,
      normalizeOptionalString(input.sourceJobId),
      normalizeOptionalString(input.serviceType),
      normalizeOptionalString(input.city),
      normalizeCompletionDate(input.completionDate),
      customerMediaOptIn,
      usageRightsStatus,
      mediaTeamVisible,
      qaHold,
      reviewState,
      normalizeOptionalString(input.reviewNote),
      normalizeOptionalString(input.softLocationLabel),
      normalizeOptionalString(input.captureSource),
      frontendDestinations,
      displayOrder,
      psychologicalWeight,
    );
  }).catch(async (error: any) => {
    if (isOwnerMediaDuplicateError(error)) throw error;
    if (String(error?.code || '').trim() === '23505' || /duplicate key|unique constraint/i.test(String(error?.message || ''))) {
      const existing = await getOwnerMediaUploadByContentHash(contentSha256);
      throw new OwnerMediaDuplicateError(toOwnerMediaDuplicateSummary(existing));
    }
    throw error;
  });
  return rows[0];
}

export async function listOwnerMediaUploadsFromDb(
  limit: number,
  offset: number,
  options?: OwnerMediaListOptions,
): Promise<{ total: number; rows: OwnerMediaUploadRow[]; summary: OwnerMediaListSummary }> {
  await ensureOwnerMediaTable();
  const { whereSql, params } = buildListWhereClause(options);
  const dedupedCte = buildDedupedOwnerMediaListCte(whereSql);
  const orderBy = buildOwnerMediaListOrderBy(options);
  const totalRows = await queryRows<{ count: string }>(
    `
      ${dedupedCte}
      select count(*)::text as count from deduped_uploads
    `,
    params,
  );
  const summaryRows = await queryRows<{
    total: string;
    pending: string;
    reviewed: string;
    approved: string;
    rejected: string;
    published: string;
    media_team_visible: string;
  }>(
    `
      ${dedupedCte}
      select
        count(*)::text as total,
        count(*) filter (where review_state = 'pending')::text as pending,
        count(*) filter (where review_state = 'reviewed')::text as reviewed,
        count(*) filter (where review_state = 'approved')::text as approved,
        count(*) filter (where review_state = 'rejected')::text as rejected,
        count(*) filter (where review_state = 'published')::text as published,
        count(*) filter (where media_team_visible = true)::text as media_team_visible
      from deduped_uploads
    `,
    params,
  );
  const listRows = await queryRows<OwnerMediaUploadRow>(
    `
      ${dedupedCte}
      select ${OWNER_MEDIA_SELECT_COLUMNS}
      from deduped_uploads
      ${orderBy}
      limit $${params.length + 1} offset $${params.length + 2}
    `,
    [...params, limit, offset],
  );
  const summaryRow = summaryRows[0];
  return {
    total: Number.parseInt(String(totalRows[0]?.count || '0'), 10) || 0,
    rows: listRows,
    summary: {
      total: Number.parseInt(String(summaryRow?.total || '0'), 10) || 0,
      pending: Number.parseInt(String(summaryRow?.pending || '0'), 10) || 0,
      reviewed: Number.parseInt(String(summaryRow?.reviewed || '0'), 10) || 0,
      approved: Number.parseInt(String(summaryRow?.approved || '0'), 10) || 0,
      rejected: Number.parseInt(String(summaryRow?.rejected || '0'), 10) || 0,
      published: Number.parseInt(String(summaryRow?.published || '0'), 10) || 0,
      media_team_visible: Number.parseInt(String(summaryRow?.media_team_visible || '0'), 10) || 0,
    },
  };
}

export async function getOwnerMediaUploadByAssetId(assetId: string): Promise<OwnerMediaUploadBlobRow | null> {
  await ensureOwnerMediaTable();
  const rows = await queryRows<OwnerMediaUploadBlobRow>(
    `
      select ${OWNER_MEDIA_SELECT_COLUMNS_WITH_BLOB}
      from owner_media_uploads
      where asset_id = $1
      limit 1
    `,
    [String(assetId || '').trim()],
  );
  return rows[0] || null;
}

export async function updateOwnerMediaUploadMetadata(assetId: string, patch: OwnerMediaMetadataPatch): Promise<OwnerMediaUploadRow | null> {
  await ensureOwnerMediaTable();
  const existing = await getOwnerMediaUploadByAssetId(assetId);
  if (!existing) return null;

  const reviewState = normalizeReviewState(patch.reviewState ?? existing.review_state);
  const customerMediaOptIn = normalizeCustomerMediaOptIn(patch.customerMediaOptIn ?? existing.customer_media_opt_in);
  const usageRightsStatus = normalizeUsageRightsStatus(patch.usageRightsStatus ?? existing.usage_rights_status);
  const qaHold = normalizeBoolean(patch.qaHold, existing.qa_hold);
  const requestedMediaTeamVisible = patch.mediaTeamVisible == null
    ? normalizeBoolean(existing.media_team_visible, false)
    : normalizeBoolean(patch.mediaTeamVisible, false);
  const mediaTeamVisible = requestedMediaTeamVisible && canBeVisibleToMediaTeam({
    reviewState,
    usageRightsStatus,
    customerMediaOptIn,
    qaHold,
  });
  const frontendDestinations = patch.frontendDestinations == null
    ? normalizeFrontendDestinations(existing.frontend_destinations || [])
    : normalizeFrontendDestinations(patch.frontendDestinations);
  const displayOrder = patch.displayOrder == null
    ? normalizeDisplayOrder(existing.display_order, 100)
    : normalizeDisplayOrder(patch.displayOrder, normalizeDisplayOrder(existing.display_order, 100));
  const psychologicalWeight = patch.psychologicalWeight == null
    ? normalizePsychologicalWeight(existing.psychological_weight, 20)
    : normalizePsychologicalWeight(patch.psychologicalWeight, normalizePsychologicalWeight(existing.psychological_weight, 20));

  const rows = await queryRows<OwnerMediaUploadRow>(
    `
      update owner_media_uploads
      set
        source_type = $2,
        source_job_id = $3,
        service_type = $4,
        city = $5,
        completion_date = $6::date,
        captured_at_original = $7::timestamptz,
        captured_at_source = $8,
        customer_media_opt_in = $9,
        usage_rights_status = $10,
        media_team_visible = $11,
        qa_hold = $12,
        review_state = $13,
        review_note = $14,
        soft_location_label = $15,
        capture_source = $16,
        frontend_destinations = $17::text[],
        display_order = $18,
        psychological_weight = $19,
        updated_at = now()
      where asset_id = $1
      returning ${OWNER_MEDIA_SELECT_COLUMNS}
    `,
    [
      String(assetId || '').trim(),
      normalizeSourceType(patch.sourceType ?? existing.source_type),
      normalizeOptionalString(patch.sourceJobId ?? existing.source_job_id),
      normalizeOptionalString(patch.serviceType ?? existing.service_type),
      normalizeOptionalString(patch.city ?? existing.city),
      normalizeCompletionDate(patch.completionDate ?? existing.completion_date),
      normalizeOptionalTimestamp(patch.capturedAtOriginal ?? existing.captured_at_original),
      normalizeCapturedAtSource(patch.capturedAtSource ?? existing.captured_at_source),
      customerMediaOptIn,
      usageRightsStatus,
      mediaTeamVisible,
      qaHold,
      reviewState,
      normalizeOptionalString(patch.reviewNote ?? existing.review_note),
      normalizeOptionalString(patch.softLocationLabel ?? existing.soft_location_label),
      normalizeOptionalString(patch.captureSource ?? existing.capture_source),
      frontendDestinations,
      displayOrder,
      psychologicalWeight,
    ],
  );

  return rows[0] || null;
}

export async function listOwnerMediaPublicDestination(
  destination: string,
  limit: number,
  options?: { serviceType?: string | null },
): Promise<OwnerMediaUploadRow[]> {
  await ensureOwnerMediaTable();

  const normalizedDestination = normalizeFrontendDestinations([destination])[0] || '';
  if (!normalizedDestination) return [];

  const params: Array<string | number> = [normalizedDestination];
  let serviceClause = '';

  const normalizedServiceType = normalizeOptionalString(options?.serviceType);
  if (normalizedServiceType) {
    params.push(normalizedServiceType);
    serviceClause = `and service_type = $${params.length}`;
  }

  params.push(Math.max(1, Math.min(24, Number(limit || 0) || 4)));

  return queryRows<OwnerMediaUploadRow>(
    `
      with filtered_uploads as (
        select *
        from owner_media_uploads
        where $1 = any(coalesce(frontend_destinations, '{}'::text[]))
          and coalesce(qa_hold, false) = false
          and review_state = 'published'
          and usage_rights_status = 'social_allowed'
          and customer_media_opt_in <> 'declined'
          ${serviceClause}
      ),
      ranked_uploads as (
        select
          *,
          row_number() over (
            partition by coalesce(nullif(content_sha256, ''), asset_id)
            order by
              coalesce(display_order, 100) asc,
              coalesce(psychological_weight, 20) desc,
              coalesce(updated_at, created_at) desc,
              created_at desc,
              asset_id desc
          ) as dedupe_rank
        from filtered_uploads
      ),
      deduped_uploads as (
        select *
        from ranked_uploads
        where dedupe_rank = 1
      )
      select ${OWNER_MEDIA_SELECT_COLUMNS}
      from deduped_uploads
      order by
        coalesce(display_order, 100) asc,
        coalesce(psychological_weight, 20) desc,
        coalesce(updated_at, created_at) desc,
        created_at desc,
        asset_id desc
      limit $${params.length}
    `,
    params,
  );
}

export async function deleteOwnerMediaUploadByAssetId(assetId: string): Promise<boolean> {
  await ensureOwnerMediaTable();
  const deleted = await executeSql('delete from owner_media_uploads where asset_id = $1', [String(assetId || '').trim()]);
  return Number(deleted || 0) > 0;
}