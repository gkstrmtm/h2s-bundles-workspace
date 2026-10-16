import { NextResponse } from 'next/server';
import { OWNER_MEDIA_DB_BUCKET, getOwnerMediaUploadByAssetId } from '@/lib/ownerMediaDb';
import { getOwnerMediaStorageClient, isOwnerMediaBucket } from '@/lib/ownerMediaStore';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Range',
  };
}

function parseSingleRange(rangeHeader: string, size: number) {
  const raw = String(rangeHeader || '').trim();
  if (!raw || !raw.toLowerCase().startsWith('bytes=')) return null;

  const spec = raw.slice(6).split(',')[0]?.trim() || '';
  if (!spec) return null;

  const [startRaw, endRaw] = spec.split('-');
  let start = startRaw ? Number.parseInt(startRaw, 10) : NaN;
  let end = endRaw ? Number.parseInt(endRaw, 10) : NaN;

  if (Number.isNaN(start) && Number.isNaN(end)) return null;

  if (Number.isNaN(start)) {
    const suffixLength = end;
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    if (start < 0 || start >= size) return null;
    if (Number.isNaN(end) || end >= size) end = size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
  return { start, end };
}

function applySharedHeaders(headers: Headers) {
  headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
  headers.set('Content-Disposition', 'inline');
  headers.set('Accept-Ranges', 'bytes');
}

async function serveRequest(request: Request, headOnly: boolean) {
  const url = new URL(request.url);
  const bucket = String(url.searchParams.get('bucket') || '').trim();
  const path = String(url.searchParams.get('path') || '').trim();

  if (!bucket || !path) {
    return NextResponse.json({ ok: false, error: 'bucket and path required' }, { status: 400, headers: corsHeaders() });
  }

  if (!isAllowed(bucket, path)) {
    return NextResponse.json({ ok: false, error: 'not_allowed' }, { status: 403, headers: corsHeaders() });
  }

  const requestRange = request.headers.get('range') || '';

  if (bucket === OWNER_MEDIA_DB_BUCKET) {
    const row = await getOwnerMediaUploadByAssetId(path);
    if (!row || !row.blob_data) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, headers: corsHeaders() });
    }

    const totalSize = Number(row.file_size_bytes || row.blob_data.length || 0);
    const range = parseSingleRange(requestRange, totalSize);
    const headers = new Headers(corsHeaders());
    headers.set('content-type', String(row.content_type || 'application/octet-stream'));
    applySharedHeaders(headers);

    if (range) {
      const chunkLength = range.end - range.start + 1;
      headers.set('content-length', String(chunkLength));
      headers.set('content-range', `bytes ${range.start}-${range.end}/${totalSize}`);
      return new NextResponse(headOnly ? null : new Uint8Array(row.blob_data.subarray(range.start, range.end + 1)), {
        status: 206,
        headers,
      });
    }

    headers.set('content-length', String(totalSize));
    return new NextResponse(headOnly ? null : new Uint8Array(row.blob_data), {
      status: 200,
      headers,
    });
  }

  let upstream: Response;
  if (isOwnerMediaBucket(bucket)) {
    const download = await getOwnerMediaStorageClient().storage.from(bucket).download(path);
    if (download.error || !download.data) {
      return NextResponse.json({ ok: false, error: download.error?.message || 'not_found' }, { status: 404, headers: corsHeaders() });
    }
    const blob = download.data as Blob;
    const headers = new Headers(corsHeaders());
    headers.set('content-type', String((blob as any).type || 'application/octet-stream'));
    if (blob.size) headers.set('content-length', String(blob.size));
    applySharedHeaders(headers);
    return new NextResponse(headOnly ? null : blob.stream(), {
      status: 200,
      headers,
    });
  }

  const publicUrl = buildPublicUrl(bucket, path);
  if (!publicUrl) {
    return NextResponse.json({ ok: false, error: 'missing_supabase_url' }, { status: 500, headers: corsHeaders() });
  }

  upstream = await fetch(publicUrl, {
    method: headOnly ? 'HEAD' : 'GET',
    headers: requestRange ? { range: requestRange } : undefined,
    cache: 'no-store',
  });

  const headers = new Headers(corsHeaders());
  const passthrough = [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'etag',
    'last-modified',
    'cache-control',
  ];

  passthrough.forEach((h) => {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  });

  applySharedHeaders(headers);

  return new NextResponse(headOnly ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

function buildPublicUrl(bucket: string, path: string) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const b = String(bucket || '').replace(/^\/+|\/+$/g, '');
  const p = String(path || '').replace(/^\/+/, '');
  if (!base || !b || !p) return '';
  return `${base}/storage/v1/object/public/${encodeURIComponent(b)}/${p
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

function isAllowed(bucket: string, path: string) {
  const b = String(bucket || '').trim();
  const p = String(path || '').trim().replace(/^\/+/, '');
  if (b === OWNER_MEDIA_DB_BUCKET) {
    if (!p) return false;
    if (p.includes('..')) return false;
    return true;
  }
  if (b === 'owner-media') {
    if (!p.startsWith('uploads/')) return false;
    if (p.includes('..')) return false;
    return true;
  }
  if (b !== 'proof') return false;
  // Keep this tight: only serve public proof media.
  if (!(p.startsWith('uploads/') || p.startsWith('bundles/') || p.startsWith('thumbnails/') || p.startsWith('raw/') || p.startsWith('ad_resources/'))) return false;
  // basic traversal protection
  if (p.includes('..')) return false;
  return true;
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders() });
}

export async function HEAD(request: Request) {
  try {
    return await serveRequest(request, true);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500, headers: corsHeaders() });
  }
}

export async function GET(request: Request) {
  try {
    return await serveRequest(request, false);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500, headers: corsHeaders() });
  }
}
