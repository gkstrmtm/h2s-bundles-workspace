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
    const partnerIds = partners.map((row: any) => row.id);
    let attributionRows: any[] = [];
    if (partnerIds.length) {
      const { data: attributions, error: attributionError } = await client
        .from('h2s_partner_attributions')
        .select('partner_id,status,completed_at,follow_up_status')
        .in('partner_id', partnerIds)
        .limit(10000);
      if (attributionError) throw attributionError;
      attributionRows = attributions || [];
    }
    const metricsByPartner = attributionRows.reduce((acc: Record<string, any>, row: any) => {
      const key = String(row.partner_id);
      const metric = acc[key] || { introductions: 0, bookings: 0, completed: 0, follow_up_ready: 0 };
      metric.introductions += 1;
      if (row.status === 'converted') metric.bookings += 1;
      if (row.completed_at) metric.completed += 1;
      if (row.follow_up_status === 'ready') metric.follow_up_ready += 1;
      acc[key] = metric;
      return acc;
    }, {});
    const metrics = {
      introductions: attributionRows.length,
      bookings: attributionRows.filter((row: any) => row.status === 'converted').length,
      completed: attributionRows.filter((row: any) => Boolean(row.completed_at)).length,
      follow_up_ready: attributionRows.filter((row: any) => row.follow_up_status === 'ready').length,
    };
    return NextResponse.json({ ok: true, partners: partners.map((row: any) => ({ ...row, metrics: metricsByPartner[String(row.id)] || { introductions: 0, bookings: 0, completed: 0, follow_up_ready: 0 } })), count: partners.length, summary: { ...summary, metrics } }, { headers: corsHeaders(request) });
  } catch (error: any) {
    const missingTable = String(error?.message || '').includes('h2s_realtor_partners');
    return NextResponse.json({ ok: false, error: missingTable ? 'Partner program migration is not installed' : (error?.message || 'Failed to load partners'), error_code: missingTable ? 'partner_schema_missing' : 'admin_partners_failed' }, { status: missingTable ? 503 : 500, headers: corsHeaders(request) });
  }
}
