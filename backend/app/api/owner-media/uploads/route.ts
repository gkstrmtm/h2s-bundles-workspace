import { NextResponse } from 'next/server';
import { getOwnerMediaAuthUser } from '@/lib/ownerMediaAuth';
import {
  OWNER_MEDIA_DB_BUCKET,
  deleteOwnerMediaUploadByAssetId,
  getOwnerMediaUploadByAssetId,
  listOwnerMediaUploadsFromDb,
  updateOwnerMediaUploadMetadata,
} from '@/lib/ownerMediaDb';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const OWNER_UPLOAD_DESTINATION = 'owner_upload_inbox';

function corsHeaders(request?: Request) {
  const origin = String(request?.headers?.get('origin') || '').trim();
  const allowOrigin = origin || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin === 'null' ? '*' : allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cache-Control, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  } as Record<string, string>;
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function buildProxyUrl(bucket: string, objectPath: string) {
  const safeBucket = String(bucket || '').trim().replace(/^\/+|\/+$/g, '');
  const safePath = String(objectPath || '').trim().replace(/^\/+/, '');
  if (!safeBucket || !safePath) return '';
  return `/api/proof-asset-media?bucket=${encodeURIComponent(safeBucket)}&path=${encodeURIComponent(safePath)}`;
}

function getFriendlyErrorMessage(message: string, fallback: string) {
  const raw = String(message || '').trim();
  if (!raw) return fallback;
  return raw;
}

function shapeUploadFromRow(row: any) {
  const assetId = String(row?.asset_id || '').trim();
  const createdAt = String(row?.created_at || '').trim() || null;
  const updatedAt = String(row?.updated_at || row?.created_at || '').trim() || createdAt;
  const reviewState = String(row?.review_state || '').trim().toLowerCase() || 'pending';
  const mediaTeamVisible = !!row?.media_team_visible;
  return {
    asset_id: assetId,
    content_sha256: String(row?.content_sha256 || '').trim() || '',
    pack_id: '',
    service: String(row?.service_type || '').trim() || '',
    media_kind: String(row?.media_kind || '').trim() === 'video' ? 'video' : 'photo',
    storage_bucket: OWNER_MEDIA_DB_BUCKET,
    storage_path: assetId,
    preview_url: buildProxyUrl(OWNER_MEDIA_DB_BUCKET, assetId),
    poster_url: '',
    direct_url: '',
    is_visible: mediaTeamVisible || reviewState === 'published',
    content_type: String(row?.content_type || '').trim() || null,
    width_px: null,
    height_px: null,
    duration_seconds: null,
    file_size_kb: Number.isFinite(Number(row?.file_size_kb)) ? Number(row.file_size_kb) : null,
    customer_intent: String(row?.source_type || '').trim() === 'technician_job' ? 'result_proof' : 'social_content_pool',
    city: String(row?.city || '').trim(),
    state: '',
    created_at: createdAt,
    updated_at: updatedAt,
    note: '',
    job_label: String(row?.source_job_id || '').trim(),
    capture_source: String(row?.capture_source || '').trim(),
    captured_at_original: String(row?.captured_at_original || '').trim() || '',
    captured_at_source: String(row?.captured_at_source || '').trim() || '',
    client_reference: '',
    review_state: reviewState,
    submitted_at: createdAt,
    submitted_by_user_id: String(row?.uploaded_by_user_id || '').trim() || 'owner-media-shared',
    submitted_by_username: String(row?.uploaded_by_username || '').trim() || 'OWNERMEDIA',
    submitted_by_display_name: String(row?.uploaded_by_display_name || '').trim() || 'Owner Uploads',
    reviewed_at: null,
    reviewed_by_username: '',
    review_note: String(row?.review_note || '').trim(),
    source_type: String(row?.source_type || '').trim() || 'owner_manual',
    source_job_id: String(row?.source_job_id || '').trim() || '',
    service_type: String(row?.service_type || '').trim() || '',
    completion_date: String(row?.completion_date || '').trim() || '',
    customer_media_opt_in: String(row?.customer_media_opt_in || '').trim() || 'owner_admin_controlled',
    usage_rights_status: String(row?.usage_rights_status || '').trim() || 'pending_review',
    media_team_visible: mediaTeamVisible,
    qa_hold: !!row?.qa_hold,
    soft_location_label: String(row?.soft_location_label || '').trim() || '',
    frontend_destinations: Array.isArray(row?.frontend_destinations) ? row.frontend_destinations.filter((value: unknown) => typeof value === 'string' && value) : [],
    display_order: Number.isFinite(Number(row?.display_order)) ? Number(row.display_order) : 100,
    psychological_weight: Number.isFinite(Number(row?.psychological_weight)) ? Number(row.psychological_weight) : 20,
  };
}

function extractMetadataPatch(body: any) {
  const patch: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body || {}, 'source_type')) patch.sourceType = body.source_type;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'source_job_id')) patch.sourceJobId = body.source_job_id;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'service_type')) patch.serviceType = body.service_type;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'city')) patch.city = body.city;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'completion_date')) patch.completionDate = body.completion_date;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'captured_at_original')) patch.capturedAtOriginal = body.captured_at_original;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'captured_at_source')) patch.capturedAtSource = body.captured_at_source;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'customer_media_opt_in')) patch.customerMediaOptIn = body.customer_media_opt_in;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'usage_rights_status')) patch.usageRightsStatus = body.usage_rights_status;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'media_team_visible')) patch.mediaTeamVisible = body.media_team_visible;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'qa_hold')) patch.qaHold = body.qa_hold;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'review_state')) patch.reviewState = body.review_state;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'review_note')) patch.reviewNote = body.review_note;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'soft_location_label')) patch.softLocationLabel = body.soft_location_label;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'capture_source')) patch.captureSource = body.capture_source;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'frontend_destinations')) patch.frontendDestinations = body.frontend_destinations;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'display_order')) patch.displayOrder = body.display_order;
  if (Object.prototype.hasOwnProperty.call(body || {}, 'psychological_weight')) patch.psychologicalWeight = body.psychological_weight;
  return patch;
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  const authed = await getOwnerMediaAuthUser(request);
  if (!authed) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
  }

  const url = new URL(request.url);
  const limit = clampInt(url.searchParams.get('limit'), 24, 1, 500);
  const offset = clampInt(url.searchParams.get('offset'), 0, 0, 5000);
  const state = String(url.searchParams.get('state') || 'all').trim();
  const audience = String(url.searchParams.get('audience') || 'all').trim();
  const dateFrom = String(url.searchParams.get('from') || '').trim();
  const dateTo = String(url.searchParams.get('to') || '').trim();
  const dateField = String(url.searchParams.get('date_field') || 'uploaded').trim();
  const sortBy = String(url.searchParams.get('sort_by') || 'uploaded').trim();

  try {
    const listed = await listOwnerMediaUploadsFromDb(limit, offset, { state, audience, dateFrom, dateTo, dateField, sortBy });
    const uploads = listed.rows.map(shapeUploadFromRow);

    return NextResponse.json(
      {
        ok: true,
        me: {
          userId: authed.userId,
          username: authed.username,
          displayName: authed.displayName,
          role: authed.role,
        },
        summary: listed.summary,
        groups: uploads.length,
        uploads,
      },
      { headers: corsHeaders(request) },
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: getFriendlyErrorMessage(error?.message, 'Recent uploads are temporarily unavailable.') },
      { status: 500, headers: corsHeaders(request) },
    );
  }
}

export async function POST(request: Request) {
  const authed = await getOwnerMediaAuthUser(request);
  if (!authed) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
  }

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const storageBucket = String(body?.storage_bucket || '').trim();
  const storagePath = String(body?.storage_path || '').trim();
  if (!storageBucket || !storagePath) {
    return NextResponse.json({ ok: false, error: 'storage_bucket and storage_path are required' }, { status: 400, headers: corsHeaders(request) });
  }

  if (storageBucket !== OWNER_MEDIA_DB_BUCKET) {
    return NextResponse.json({ ok: false, error: 'Owner uploads must use the owner-media upload store.' }, { status: 400, headers: corsHeaders(request) });
  }

  const stored = await getOwnerMediaUploadByAssetId(storagePath);
  if (!stored) {
    return NextResponse.json({ ok: false, error: 'Uploaded file not found.' }, { status: 404, headers: corsHeaders(request) });
  }

  const metadataPatch = extractMetadataPatch(body);
  const hasMetadataPatch = Object.keys(metadataPatch).length > 0;
  const uploadRow = hasMetadataPatch
    ? await updateOwnerMediaUploadMetadata(storagePath, metadataPatch)
    : stored;

  if (!uploadRow) {
    return NextResponse.json({ ok: false, error: 'Uploaded file not found.' }, { status: 404, headers: corsHeaders(request) });
  }

  return NextResponse.json({ ok: true, upload: shapeUploadFromRow(uploadRow) }, { headers: corsHeaders(request) });
}

export async function PATCH(request: Request) {
  const authed = await getOwnerMediaAuthUser(request);
  if (!authed) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
  }
  if (authed.role !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403, headers: corsHeaders(request) });
  }

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const assetId = String(body?.asset_id || '').trim();
  if (!assetId) {
    return NextResponse.json({ ok: false, error: 'asset_id is required' }, { status: 400, headers: corsHeaders(request) });
  }

  const updated = await updateOwnerMediaUploadMetadata(assetId, extractMetadataPatch(body));
  if (!updated) {
    return NextResponse.json({ ok: false, error: 'Upload not found' }, { status: 404, headers: corsHeaders(request) });
  }

  return NextResponse.json({ ok: true, upload: shapeUploadFromRow(updated) }, { headers: corsHeaders(request) });
}

export async function DELETE(request: Request) {
  const authed = await getOwnerMediaAuthUser(request);
  if (!authed) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
  }

  const url = new URL(request.url);
  const assetId = String(url.searchParams.get('asset_id') || '').trim();
  if (!assetId) {
    return NextResponse.json({ ok: false, error: 'asset_id required' }, { status: 400, headers: corsHeaders(request) });
  }

  try {
    const removed = await deleteOwnerMediaUploadByAssetId(assetId);
    if (!removed) {
      return NextResponse.json({ ok: false, error: 'Upload not found' }, { status: 404, headers: corsHeaders(request) });
    }

    return NextResponse.json({ ok: true, removed: true, asset_id: assetId }, { headers: corsHeaders(request) });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: getFriendlyErrorMessage(error?.message, 'Could not remove that upload right now.') },
      { status: 500, headers: corsHeaders(request) },
    );
  }
}
