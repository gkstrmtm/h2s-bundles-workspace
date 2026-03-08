import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { getSupabase } from '../../../../lib/supabase';
import { assertHubAuthIfEnabled } from '../../_lib/hubGate';
import { normalizePhone } from '../../_lib/phone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function safeTrim(value: any): string {
  return String(value || '').trim();
}

function getRequiredEnv(name: string): string {
  const v = safeTrim(process.env[name]);
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export async function POST(req: NextRequest) {
  try {
    await assertHubAuthIfEnabled(req);

    const body = await req.json().catch(() => ({}));
    const toPhone = normalizePhone(body?.to || body?.phone || '');
    const text = safeTrim(body?.body || body?.message);

    if (!toPhone || !text) {
      return NextResponse.json({ ok: false, error: 'Missing to/body' }, { status: 400 });
    }

    const accountSid = getRequiredEnv('TWILIO_ACCOUNT_SID');
    const authToken = getRequiredEnv('TWILIO_AUTH_TOKEN');
    const fromPhone = normalizePhone(getRequiredEnv('TWILIO_FROM_NUMBER'));

    const client = twilio(accountSid, authToken);

    const msg = await client.messages.create({
      from: fromPhone,
      to: toPhone,
      body: text,
    });

    const sb = getSupabase();

    // Upsert thread by contact phone
    const { data: thread, error: threadErr } = await sb
      .from('sms_threads')
      .upsert(
        {
          contact_phone: toPhone,
          last_message_preview: text.slice(0, 200),
          last_message_at: new Date().toISOString(),
          unread_count: 0,
        },
        { onConflict: 'contact_phone' }
      )
      .select('*')
      .single();

    if (threadErr) {
      return NextResponse.json({ ok: false, error: threadErr.message }, { status: 500 });
    }

    const { error: insertErr } = await sb.from('sms_messages').insert({
      thread_id: thread.thread_id,
      direction: 'OUTBOUND',
      body: text,
      from_phone: fromPhone,
      to_phone: toPhone,
      twilio_sid: msg.sid,
      status: msg.status || 'sent',
      created_at: new Date().toISOString(),
    });

    if (insertErr) {
      return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, sid: msg.sid }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    const status = (e as any)?.statusCode || 500;
    return NextResponse.json({ ok: false, error: e?.message || 'Internal error' }, { status });
  }
}
