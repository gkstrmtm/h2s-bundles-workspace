import { NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/adminAuth';
import { getSupabasePublic } from '@/lib/supabase';
import { normalizeEmail, partnerProgramUrl } from '@/lib/partnerProgram';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = normalizeEmail(body.email);
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ ok: false, error: 'Enter a valid email address' }, { status: 400, headers: corsHeaders(request) });
    }
    const { error } = await getSupabasePublic().auth.resetPasswordForEmail(email, {
      redirectTo: partnerProgramUrl('/account?recovery=1'),
    });
    if (error) console.warn('[Partner Password Reset]', error.message);
    return NextResponse.json({ ok: true, message: 'If a partner account exists, a recovery link is on the way.' }, { headers: corsHeaders(request) });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Password recovery failed' }, { status: 500, headers: corsHeaders(request) });
  }
}
