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

  const bucket = chooseBucket(form.get('bucket'));
  const originalName = sanitizeBasename(file.name || 'upload');
  const ext = safeExtFromFilename(originalName);

  const id = crypto.randomUUID();
  const objectPath = `uploads/${id}${ext ? `.${ext}` : ''}`;

  let client;
  try {
    client = getSupabase();
  } catch {
    return NextResponse.json({ ok: false, error: 'Storage unavailable' }, { status: 503, headers: corsHeaders(request) });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const contentType = String(file.type || 'application/octet-stream');

  const up = await client.storage.from(bucket).upload(objectPath, bytes, {
    contentType,
    upsert: false,
  });
  if (up.error) {
    return NextResponse.json(
      { ok: false, error: up.error.message || 'Upload failed' },
      { status: 500, headers: corsHeaders(request) },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      bucket,
      path: objectPath,
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
