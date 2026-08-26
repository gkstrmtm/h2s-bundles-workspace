import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';
import { normalizeEmail, publicPartner } from '@/lib/partnerProgram';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const required = ['first_name', 'last_name', 'brokerage', 'market', 'email', 'phone'];
    const missing = required.filter(key => !String(body?.[key] || '').trim());
    if (missing.length) {
      return NextResponse.json({ ok: false, error: `Missing required fields: ${missing.join(', ')}` }, { status: 400, headers: corsHeaders(request) });
    }

    const email = normalizeEmail(body.email);
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ ok: false, error: 'A valid work email is required' }, { status: 400, headers: corsHeaders(request) });
    }

    const client = getSupabase();
    const row = {
      first_name: String(body.first_name).trim().slice(0, 80),
      last_name: String(body.last_name).trim().slice(0, 80),
      brokerage: String(body.brokerage).trim().slice(0, 160),
      market: String(body.market).trim().slice(0, 120),
      email,
      phone: String(body.phone).trim().slice(0, 40),
      instagram: body.instagram ? String(body.instagram).trim().slice(0, 160) : null,
      brokerage_approval_confirmed: Boolean(body.brokerage_approval_confirmed),
      status: 'pending',
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await client
      .from('h2s_realtor_partners')
      .insert(row)
      .select('*')
      .single();
    if (error?.code === '23505') {
      return NextResponse.json({ ok: false, error: 'An application already exists for this email', error_code: 'partner_email_exists' }, { status: 409, headers: corsHeaders(request) });
    }
    if (error) throw error;
    return NextResponse.json({ ok: true, partner: publicPartner(data) }, { headers: corsHeaders(request) });
  } catch (error: any) {
    const missingTable = String(error?.message || '').includes('h2s_realtor_partners');
    return NextResponse.json({ ok: false, error: missingTable ? 'Partner program migration is not installed' : (error?.message || 'Application failed'), error_code: missingTable ? 'partner_schema_missing' : 'partner_apply_failed' }, { status: missingTable ? 503 : 500, headers: corsHeaders(request) });
  }
}
