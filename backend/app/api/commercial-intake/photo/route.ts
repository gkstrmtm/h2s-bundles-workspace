import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { commercialRpc, corsHeaders, getLeadByToken } from '@/lib/commercial_consultation_runtime';

const commercialUtils = require('@/lib/commercial_consultation.js') as any;
const { normalizeText, generateResponseToken } = commercialUtils;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function parseDataUrl(input: string) {
  const text = String(input || '').trim();
  const match = text.match(/^data:([^;]+);base64,(.+)$/i);
  if (match) {
    return { mimeType: String(match[1] || '').trim(), base64: String(match[2] || '').trim() };
  }
  return { mimeType: '', base64: text };
}

function extensionFromMime(mimeType: string) {
  const value = String(mimeType || '').toLowerCase();
  if (value.includes('png')) return 'png';
  if (value.includes('webp')) return 'webp';
  if (value.includes('gif')) return 'gif';
  if (value.includes('pdf')) return 'pdf';
  return 'jpg';
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  let uploadedPath = '';
  try {
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ ok: false, error: 'Missing upload body' }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4.25 * 1024 * 1024) {
        await reader.cancel();
        return NextResponse.json({ ok: false, error: 'Upload request exceeds the 3 MB file limit.' }, { status: 413, headers: corsHeaders(request) });
      }
      chunks.push(part.value);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return NextResponse.json({ ok: false, error: 'Invalid upload JSON.' }, { status: 400, headers: corsHeaders(request) }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({
      ok: false, error: 'Upload body must be a JSON object.',
    }, { status: 400, headers: corsHeaders(request) });
    const publicToken = normalizeText(body.publicToken || '', 120);
    const image = String(body.data || body.image || '').trim();

    if (!publicToken || !image) {
      return NextResponse.json(
        { ok: false, error: 'Missing publicToken or image data' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const lead = await getLeadByToken(publicToken);
    if (!lead || lead.attribution?.market==='residential') {
      return NextResponse.json(
        { ok: false, error: 'Commercial lead not found' },
        { status: 404, headers: corsHeaders(request) }
      );
    }
    if ((lead.project_photo_urls || []).length >= 8) return NextResponse.json({
      ok: false, error: 'A maximum of eight attachments is allowed.',
    }, { status: 409, headers: corsHeaders(request) });

    const { mimeType, base64 } = parseDataUrl(image);
    const allowedTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);
    const effectiveMime = String(mimeType || body.mimetype || '').toLowerCase().replace('image/jpg', 'image/jpeg');
    if (!allowedTypes.has(effectiveMime)) {
      return NextResponse.json(
        { ok: false, error: 'Unsupported file type' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    if (!base64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
      return NextResponse.json({ ok: false, error: 'Invalid base64 attachment.' }, { status: 400, headers: corsHeaders(request) });
    }
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length > 3 * 1024 * 1024) {
      return NextResponse.json(
        { ok: false, error: 'File exceeds 3 MB limit' },
        { status: 400, headers: corsHeaders(request) }
      );
    }
    const signature = effectiveMime === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : effectiveMime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : effectiveMime === 'image/webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
      : bytes.toString('ascii', 0, 5) === '%PDF-';
    if (!signature) return NextResponse.json({ ok: false, error: 'File contents do not match the declared type.' }, { status: 400, headers: corsHeaders(request) });

    const sb = getSupabase();
    const bucket = sb.storage.from('h2s-job-artifacts');
    const access = await sb.storage.getBucket('h2s-job-artifacts');
    if (access.error || !access.data?.public) throw new Error('Commercial attachment storage requires verified public-read access; no storage settings were changed.');
    const objectPath = `commercial-leads/${lead.lead_id}/${generateResponseToken()}.${extensionFromMime(effectiveMime)}`;
    const upload = await bucket.upload(objectPath, bytes, {
      contentType: effectiveMime,
      upsert: false,
    });

    if (upload.error) {
      return NextResponse.json(
        { ok: false, error: upload.error.message || 'Upload failed' },
        { status: 500, headers: corsHeaders(request) }
      );
    }
    uploadedPath = objectPath;

    const publicUrl = bucket.getPublicUrl(objectPath)?.data?.publicUrl;
    if (!publicUrl) throw new Error('Storage did not return a readable attachment URL.');
    const data = await commercialRpc('commercial_attach_photo', { p_lead_id: lead.lead_id, p_url: publicUrl });
    uploadedPath = '';

    return NextResponse.json(
      {
        ok: true,
        photoUrl: publicUrl,
        lead: {
          publicToken: data.public_token,
          projectPhotoUrls: data.project_photo_urls || [],
        },
      },
      { status: 201, headers: corsHeaders(request) }
    );
  } catch (error: any) {
    if (uploadedPath) {
      try {
        const cleanup = await getSupabase().storage.from('h2s-job-artifacts').remove([uploadedPath]);
        if (cleanup.error) throw new Error(cleanup.error.message);
      } catch (cleanupError) {
        console.error('Commercial orphan attachment requires cleanup:', uploadedPath, cleanupError);
        return NextResponse.json({ ok: false, error: 'Attachment persistence failed and storage cleanup needs operator review.' }, { status: 500, headers: corsHeaders(request) });
      }
    }
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to upload commercial project photo' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}