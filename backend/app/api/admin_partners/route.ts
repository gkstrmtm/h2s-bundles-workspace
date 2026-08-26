import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';
import { PARTNER_STATUSES, publicPartner } from '@/lib/partnerProgram';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const client = getSupabase();
    const auth = await requireAdmin({ request, body, supabaseClient: client });
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error, error_code: auth.error_code }, { status: auth.status, headers: corsHeaders(request) });
    const requestedStatus = String(body.status || 'all');
    let query = client.from('h2s_realtor_partners').select('*').order('created_at', { ascending: false }).limit(500);
    if (requestedStatus !== 'all' && PARTNER_STATUSES.includes(requestedStatus as any)) query = query.eq('status', requestedStatus);
    const { data, error } = await query;
    if (error) throw error;
    const partners = (data || []).map(publicPartner);
    const summary = partners.reduce((acc: Record<string, number>, row: any) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {});
    return NextResponse.json({ ok: true, partners, count: partners.length, summary }, { headers: corsHeaders(request) });
  } catch (error: any) {
    const missingTable = String(error?.message || '').includes('h2s_realtor_partners');
    return NextResponse.json({ ok: false, error: missingTable ? 'Partner program migration is not installed' : (error?.message || 'Failed to load partners'), error_code: missingTable ? 'partner_schema_missing' : 'admin_partners_failed' }, { status: missingTable ? 503 : 500, headers: corsHeaders(request) });
  }
}
