import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '../../../../lib/supabase';
import { assertHubAuthIfEnabled } from '../../_lib/hubGate';
import { normalizePhone } from '../../_lib/phone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await assertHubAuthIfEnabled(req);

    const url = new URL(req.url);
    const contactPhone = normalizePhone(url.searchParams.get('phone') || '');
    if (!contactPhone) {
      return NextResponse.json({ ok: false, error: 'Missing phone' }, { status: 400 });
    }

    const sb = getSupabase();

    const { data: thread, error: threadErr } = await sb
      .from('sms_threads')
      .select('thread_id, contact_phone, contact_name, unread_count')
      .eq('contact_phone', contactPhone)
      .single();

    if (threadErr || !thread) {
      return NextResponse.json({ ok: false, error: 'Thread not found' }, { status: 404 });
    }

    const { data: messages, error: msgErr } = await sb
      .from('sms_messages')
      .select('message_id, direction, body, from_phone, to_phone, status, created_at')
      .eq('thread_id', thread.thread_id)
      .order('created_at', { ascending: true })
      .limit(500);

    if (msgErr) {
      return NextResponse.json({ ok: false, error: msgErr.message }, { status: 500 });
    }

    return NextResponse.json(
      { ok: true, thread, messages: messages || [] },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e: any) {
    const status = (e as any)?.statusCode || 500;
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error' }, { status });
  }
}
