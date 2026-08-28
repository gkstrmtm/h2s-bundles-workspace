import { NextResponse } from 'next/server';
import { getSupabase, getSupabasePublic } from '@/lib/supabase';
import { corsHeaders } from '@/lib/adminAuth';
import { normalizeEmail, publicPartner } from '@/lib/partnerProgram';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const required = ['first_name', 'last_name', 'brokerage', 'market', 'email', 'phone', 'password'];
    const missing = required.filter(key => !String(body?.[key] || '').trim());
    if (missing.length) {
      return NextResponse.json({ ok: false, error: `Missing required fields: ${missing.join(', ')}` }, { status: 400, headers: corsHeaders(request) });
    }

    const email = normalizeEmail(body.email);
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ ok: false, error: 'A valid work email is required' }, { status: 400, headers: corsHeaders(request) });
    }

    const password = String(body.password || '');
    if (password.length < 8 || password.length > 128) {
      return NextResponse.json({ ok: false, error: 'Password must be between 8 and 128 characters' }, { status: 400, headers: corsHeaders(request) });
    }

    if (body.brokerage_approval_confirmed !== true) {
      return NextResponse.json({ ok: false, error: 'Confirm that you can participate under your brokerage or broker-in-charge policies' }, { status: 400, headers: corsHeaders(request) });
    }

    const client = getSupabase();
    const { data: existingPartner } = await client.from('h2s_realtor_partners').select('id').eq('email', email).maybeSingle();
    if (existingPartner) {
      return NextResponse.json({ ok: false, error: 'An application already exists. Sign in to continue.', error_code: 'partner_email_exists' }, { status: 409, headers: corsHeaders(request) });
    }

    const { data: authCreated, error: authCreateError } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { h2s_account_type: 'realtor_partner' },
    });
    if (authCreateError || !authCreated.user) {
      const duplicate = /already|registered|exists/i.test(authCreateError?.message || '');
      return NextResponse.json({ ok: false, error: duplicate ? 'An account already exists. Sign in to continue.' : (authCreateError?.message || 'Could not create partner access'), error_code: duplicate ? 'partner_account_exists' : 'partner_auth_create_failed' }, { status: duplicate ? 409 : 500, headers: corsHeaders(request) });
    }
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
      auth_user_id: authCreated.user.id,
      profile_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await client
      .from('h2s_realtor_partners')
      .insert(row)
      .select('*')
      .single();
    if (error) await client.auth.admin.deleteUser(authCreated.user.id).catch(() => undefined);
    if (error?.code === '23505') {
      return NextResponse.json({ ok: false, error: 'An application already exists for this email', error_code: 'partner_email_exists' }, { status: 409, headers: corsHeaders(request) });
    }
    if (error) throw error;
    const publicClient = getSupabasePublic();
    const { data: signedIn, error: signInError } = await publicClient.auth.signInWithPassword({ email, password });
    if (signInError || !signedIn.session) throw signInError || new Error('Partner session was not created');
    return NextResponse.json({
      ok: true,
      partner: publicPartner(data),
      session: {
        access_token: signedIn.session.access_token,
        refresh_token: signedIn.session.refresh_token,
        expires_at: signedIn.session.expires_at,
      },
    }, { headers: corsHeaders(request) });
  } catch (error: any) {
    const missingTable = String(error?.message || '').includes('h2s_realtor_partners');
    return NextResponse.json({ ok: false, error: missingTable ? 'Partner program migration is not installed' : (error?.message || 'Application failed'), error_code: missingTable ? 'partner_schema_missing' : 'partner_apply_failed' }, { status: missingTable ? 503 : 500, headers: corsHeaders(request) });
  }
}
