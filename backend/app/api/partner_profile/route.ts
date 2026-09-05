import { NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/adminAuth';
import { requirePartner } from '@/lib/partnerAuth';
import { publicPartner } from '@/lib/partnerProgram';
import { getSupabase } from '@/lib/supabase';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const client = getSupabase();
    const auth = await requirePartner(request, client);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
    const body = await request.json();
    const update = {
      first_name: String(body.first_name || auth.partner.first_name).trim().slice(0, 80),
      last_name: String(body.last_name || auth.partner.last_name).trim().slice(0, 80),
      brokerage: String(body.brokerage || auth.partner.brokerage).trim().slice(0, 160),
      market: String(body.market || auth.partner.market).trim().slice(0, 120),
      phone: String(body.phone || auth.partner.phone).trim().slice(0, 40),
      instagram: body.instagram ? String(body.instagram).trim().slice(0, 160) : null,
      profile_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await client.from('h2s_realtor_partners').update(update).eq('id', auth.partner.id).select('*').single();
    if (error) throw error;
    return NextResponse.json({ ok: true, partner: publicPartner(data) }, { headers: corsHeaders(request) });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Profile update failed' }, { status: 500, headers: corsHeaders(request) });
  }
}
