import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { corsHeaders, getLeadByToken } from '@/lib/commercial_consultation_runtime';

const commercialUtils = require('@/lib/commercial_consultation.js') as any;
const { normalizeText } = commercialUtils;

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
  try {
    const body = await request.json().catch(() => ({}));
    const publicToken = normalizeText(body.publicToken || '', 120);
    const image = String(body.data || body.image || '').trim();
    const filename = normalizeText(body.filename || 'commercial-photo.jpg', 180) || 'commercial-photo.jpg';

    if (!publicToken || !image) {
      return NextResponse.json(
        { ok: false, error: 'Missing publicToken or image data' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const lead = await getLeadByToken(publicToken);
    if (!lead) {
      return NextResponse.json(
        { ok: false, error: 'Commercial lead not found' },
        { status: 404, headers: corsHeaders(request) }
      );
    }

    const { mimeType, base64 } = parseDataUrl(image);
    const allowedTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']);
    const effectiveMime = String(mimeType || body.mimetype || 'image/jpeg').toLowerCase();
    if (!allowedTypes.has(effectiveMime)) {
      return NextResponse.json(
        { ok: false, error: 'Unsupported file type' },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const bytes = Buffer.from(base64, 'base64');
    const maxSizeMb = Number.parseInt(String(process.env.COMMERCIAL_PHOTO_MAX_MB || '10'), 10) || 10;
    if (bytes.length > maxSizeMb * 1024 * 1024) {
      return NextResponse.json(
        { ok: false, error: `File exceeds ${maxSizeMb}MB limit` },
        { status: 400, headers: corsHeaders(request) }
      );
    }

    const sb = getSupabase();
    const objectPath = `commercial-leads/${lead.lead_id}/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]+/g, '-')}.${extensionFromMime(effectiveMime)}`;
    const upload = await sb.storage.from('h2s-job-artifacts').upload(objectPath, bytes, {
      contentType: effectiveMime,
      upsert: false,
    });

    if (upload.error) {
      return NextResponse.json(
        { ok: false, error: upload.error.message || 'Upload failed' },
        { status: 500, headers: corsHeaders(request) }
      );
    }

    const publicUrl = sb.storage.from('h2s-job-artifacts').getPublicUrl(objectPath)?.data?.publicUrl || '';
    const projectPhotoUrls = Array.from(new Set([...(lead.project_photo_urls || []), publicUrl])).slice(0, 8);

    const { data, error } = await sb
      .from('commercial_leads')
      .update({ project_photo_urls: projectPhotoUrls, updated_at: new Date().toISOString() })
      .eq('lead_id', lead.lead_id)
      .select('*')
      .single();

    if (error || !data) {
      await sb.storage.from('h2s-job-artifacts').remove([objectPath]);
      return NextResponse.json(
        { ok: false, error: error?.message || 'Failed to save uploaded project photo' },
        { status: 500, headers: corsHeaders(request) }
      );
    }

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
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to upload commercial project photo' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}