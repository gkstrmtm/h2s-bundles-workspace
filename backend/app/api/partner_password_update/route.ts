import { NextResponse } from 'next/server';
import { corsHeaders } from '@/lib/adminAuth';
import { requirePartner } from '@/lib/partnerAuth';
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
    const password = String(body.password || '');
    if (password.length < 8 || password.length > 128) {
      return NextResponse.json({ ok: false, error: 'Password must be between 8 and 128 characters' }, { status: 400, headers: corsHeaders(request) });
    }
    const { error } = await client.auth.admin.updateUserById(auth.user.id, { password });
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers: corsHeaders(request) });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Password update failed' }, { status: 500, headers: corsHeaders(request) });
  }
}
