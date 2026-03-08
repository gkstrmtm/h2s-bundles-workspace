import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../../lib/supabase';
import { assertHubAuthIfEnabled } from '../../_lib/hubGate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await assertHubAuthIfEnabled(req);

    const sb = getSupabase();
    const { data, error } = await sb
      .from('sms_threads')
      .select('thread_id, contact_phone, contact_name, last_message_preview, last_message_at, unread_count')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(200);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, threads: data || [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    const status = (e as any)?.statusCode || 500;
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error' }, { status });
  }
}
