import { NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/adminAuth';
import { requirePartner } from '@/lib/partnerAuth';
import { publicPartner } from '@/lib/partnerProgram';
import { getSupabase } from '@/lib/supabase';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  try {
    const client = getSupabase();
    const auth = await requirePartner(request, client);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: corsHeaders(request) });
    const { data: referrals, error } = await client
      .from('h2s_partner_attributions')
      .select('status, follow_up_status, created_at, converted_at, completed_at')
      .eq('partner_id', auth.partner.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    const rows = referrals || [];
    return NextResponse.json({ ok: true, partner: publicPartner(auth.partner), activity: {
      introductions: rows.length,
      bookings: rows.filter(row => row.status === 'converted').length,
      completed: rows.filter(row => Boolean(row.completed_at)).length,
      follow_up_ready: rows.filter(row => row.follow_up_status === 'ready').length,
    } }, { headers: corsHeaders(request) });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Partner profile failed' }, { status: 500, headers: corsHeaders(request) });
  }
}
