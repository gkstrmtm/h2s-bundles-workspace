import { NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/adminAuth';
import { clientPartner, normalizeSlug } from '@/lib/partnerProgram';
import { getSupabase } from '@/lib/supabase';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  try {
    const slug = normalizeSlug(new URL(request.url).searchParams.get('slug'));
    if (!slug) return NextResponse.json({ ok: false, error: 'Partner alias is required' }, { status: 400, headers: corsHeaders(request) });
    const client = getSupabase();
    const { data, error } = await client.from('h2s_realtor_partners')
      .select('first_name,last_name,brokerage,market,headshot_url,public_slug')
      .eq('public_slug', slug).eq('status', 'approved').maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ ok: false, error: 'This partner page is not available' }, { status: 404, headers: corsHeaders(request) });
    return NextResponse.json({ ok: true, partner: clientPartner(data) }, { headers: { ...corsHeaders(request), 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Partner page failed' }, { status: 500, headers: corsHeaders(request) });
  }
}
