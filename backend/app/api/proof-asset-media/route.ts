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
  // Use GET handler logic but avoid buffering.
  return GET(request);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const bucket = String(url.searchParams.get('bucket') || '').trim();
    const path = String(url.searchParams.get('path') || '').trim();

    if (!bucket || !path) {
      return NextResponse.json({ ok: false, error: 'bucket and path required' }, { status: 400, headers: corsHeaders() });
    }

    if (!isAllowed(bucket, path)) {
      return NextResponse.json({ ok: false, error: 'not_allowed' }, { status: 403, headers: corsHeaders() });
    }

    let upstream: Response;
    if (bucket === OWNER_MEDIA_DB_BUCKET) {
      const row = await getOwnerMediaUploadByAssetId(path);
      if (!row || !row.blob_data) {
        return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404, headers: corsHeaders() });
      }
      upstream = new Response(row.blob_data, {
        status: 200,
        headers: {
          'content-type': String(row.content_type || 'application/octet-stream'),
          'content-length': String(row.file_size_bytes || row.blob_data.length || ''),
        },
      });
    } else if (isOwnerMediaBucket(bucket)) {
      const download = await getOwnerMediaStorageClient().storage.from(bucket).download(path);
      if (download.error || !download.data) {
        return NextResponse.json({ ok: false, error: download.error?.message || 'not_found' }, { status: 404, headers: corsHeaders() });
      }
      const blob = download.data as Blob;
      upstream = new Response(blob.stream(), {
        status: 200,
        headers: {
          'content-type': String((blob as any).type || 'application/octet-stream'),
          'content-length': String(blob.size || ''),
        },
      });
    } else {
      const publicUrl = buildPublicUrl(bucket, path);
      if (!publicUrl) {
        return NextResponse.json({ ok: false, error: 'missing_supabase_url' }, { status: 500, headers: corsHeaders() });
      }

      const range = request.headers.get('range') || '';
      upstream = await fetch(publicUrl, {
        method: 'GET',
        headers: range ? { range } : undefined,
        cache: 'no-store',
      });
    }

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

    // Force cache behavior at our edge (safe because caller can cache-bust with v= token).
    headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');

    // Inline display; don’t encourage downloads.
    headers.set('Content-Disposition', 'inline');

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500, headers: corsHeaders() });
  }
}
