import { NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/adminAuth';
import { getSupabasePublic } from '@/lib/supabase';

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const client = getSupabasePublic();
    const action = String(body.action || 'login');
    const result = action === 'refresh'
      ? await client.auth.refreshSession({ refresh_token: String(body.refresh_token || '') })
      : await client.auth.signInWithPassword({ email: String(body.email || '').trim().toLowerCase(), password: String(body.password || '') });
    if (result.error || !result.data.session) {
      return NextResponse.json({ ok: false, error: action === 'refresh' ? 'Session expired. Sign in again.' : 'Email or password is incorrect' }, { status: 401, headers: corsHeaders(request) });
    }
    return NextResponse.json({ ok: true, session: {
      access_token: result.data.session.access_token,
      refresh_token: result.data.session.refresh_token,
      expires_at: result.data.session.expires_at,
    } }, { headers: corsHeaders(request) });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Partner session failed' }, { status: 500, headers: corsHeaders(request) });
  }
}
