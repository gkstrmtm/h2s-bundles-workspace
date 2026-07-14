import { NextResponse } from 'next/server';
import { getOwnerMediaAuthUser } from '@/lib/ownerMediaAuth';
import {
  OWNER_MEDIA_DB_BUCKET,
  deleteOwnerMediaUploadByAssetId,
  getOwnerMediaUploadByAssetId,
  listOwnerMediaUploadsFromDb,
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
  const timestamp = String(row?.created_at || row?.updated_at || '').trim() || null;
  return {
    asset_id: assetId,
    pack_id: '',
    service: 'tv_mounting',
    media_kind: String(row?.media_kind || '').trim() === 'video' ? 'video' : 'photo',
    storage_bucket: OWNER_MEDIA_DB_BUCKET,
    storage_path: assetId,
    preview_url: buildProxyUrl(OWNER_MEDIA_DB_BUCKET, assetId),
    poster_url: '',
    direct_url: '',
    is_visible: false,
    content_type: String(row?.content_type || '').trim() || null,
    width_px: null,
    height_px: null,
    duration_seconds: null,
    file_size_kb: Number.isFinite(Number(row?.file_size_kb)) ? Number(row.file_size_kb) : null,
    customer_intent: 'result_proof',
    frontend_destinations: [OWNER_UPLOAD_DESTINATION],
    psychological_weight: 20,
    city: '',
    state: '',
    created_at: timestamp,
    updated_at: timestamp,
    note: '',
    job_label: '',
    capture_source: '',
    client_reference: '',
    review_state: 'pending',
    submitted_at: timestamp,
    submitted_by_user_id: String(row?.uploaded_by_user_id || '').trim() || 'owner-media-shared',
    submitted_by_username: String(row?.uploaded_by_username || '').trim() || 'OWNERMEDIA',
    submitted_by_display_name: String(row?.uploaded_by_display_name || '').trim() || 'Owner Uploads',
    reviewed_at: null,
    reviewed_by_username: '',
    review_note: '',
  };
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

  try {
    const listed = await listOwnerMediaUploadsFromDb(limit, offset);
    const uploads = listed.rows.map(shapeUploadFromRow);
    const summary = {
      total: listed.total,
      pending: listed.total,
      reviewed: 0,
      approved: 0,
      rejected: 0,
      published: 0,
    };

    return NextResponse.json(
      {
        ok: true,
        me: {
          userId: authed.userId,
          username: authed.username,
          displayName: authed.displayName,
          role: authed.role,
        },
        summary,
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

  return NextResponse.json({ ok: true, upload: shapeUploadFromRow(stored) }, { headers: corsHeaders(request) });
}

export async function PATCH(request: Request) {
  const authed = await getOwnerMediaAuthUser(request);
  if (!authed) {
    return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders(request) });
  }
  if (authed.role !== 'ADMIN') {
    return NextResponse.json({ ok: false, error: 'Admin only' }, { status: 403, headers: corsHeaders(request) });
  }

  return NextResponse.json({ ok: true, unchanged: true }, { headers: corsHeaders(request) });
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
