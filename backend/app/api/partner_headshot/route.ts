import { NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/adminAuth';
import { requirePartner } from '@/lib/partnerAuth';
import { getSupabase } from '@/lib/supabase';

const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const client = getSupabase();
    const auth = await requirePartner(request, client);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: 'Choose an image to upload' }, { status: 400, headers: corsHeaders(request) });
    const extension = TYPES[file.type];
    if (!extension || file.size < 1 || file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: 'Use a JPG, PNG, or WebP image smaller than 2 MB' }, { status: 400, headers: corsHeaders(request) });
    }
    const objectPath = `${auth.user.id}/headshot.${extension}`;
    const { error: uploadError } = await client.storage.from('h2s-partner-headshots').upload(objectPath, await file.arrayBuffer(), { contentType: file.type, upsert: true, cacheControl: '3600' });
    if (uploadError) throw uploadError;
    const { data: publicUrl } = client.storage.from('h2s-partner-headshots').getPublicUrl(objectPath);
    const headshotUrl = `${publicUrl.publicUrl}?v=${Date.now()}`;
    const { error: updateError } = await client.from('h2s_realtor_partners').update({ headshot_url: headshotUrl, updated_at: new Date().toISOString() }).eq('id', auth.partner.id);
    if (updateError) throw updateError;
    return NextResponse.json({ ok: true, headshot_url: headshotUrl }, { headers: corsHeaders(request) });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Headshot upload failed' }, { status: 500, headers: corsHeaders(request) });
  }
}
