import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import path from 'node:path';
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

function safeExtFromFilename(filename: string): string {
  const ext = path.extname(filename || '').replace(/^\./, '').toLowerCase();
  if (!ext) return '';
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return '';
  return ext;
}

function sanitizeBasename(filename: string): string {
  const base = path.basename(String(filename || 'upload'));
  // Keep it URL/path safe; storage supports unicode but keep it simple.
  return base
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 120) || 'upload';
}

function chooseBucket(input: unknown): string {
  const raw = String(input ?? '').trim();
  // Default to the bucket we already use for proof assets.
  if (!raw) return 'proof';
  // Guard: only allow simple bucket names.
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
  const filename = sanitizeBasename(String(body.filename || 'upload'));
  const ext = safeExtFromFilename(filename);

  // Use a stable, non-guessable storage path.
  // Keep uploads under a raw/ prefix so we can distinguish staged items.
  const id = crypto.randomUUID();
  const rawPath = `raw/${id}${ext ? `.${ext}` : ''}`;

  let client;
  try {
    client = getSupabase();
  } catch {
    return NextResponse.json({ ok: false, error: 'Storage unavailable' }, { status: 503, headers: corsHeaders(request) });
  }

  // Supabase signed upload URL
  // https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl
  const signed = await client.storage.from(bucket).createSignedUploadUrl(rawPath);
  if (signed.error || !signed.data?.signedUrl) {
    return NextResponse.json(
      { ok: false, error: signed.error?.message || 'Failed to create signed upload URL' },
      { status: 500, headers: corsHeaders(request) },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      bucket,
      raw_path: signed.data.path || rawPath,
      signed_url: signed.data.signedUrl,
      token: signed.data.token || null,
      filename,
    },
    { headers: corsHeaders(request) },
  );
}
