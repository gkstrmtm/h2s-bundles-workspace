import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { getSupabase, getSupabaseMgmt } from '../../../../lib/supabase';
import { normalizePhone } from '../../_lib/phone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function xmlResponse(body: string, status: number = 200) {
  return new NextResponse(body, {
    status,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function getRequiredEnv(name: string): string {
  const v = String(process.env[name] || '').trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export async function POST(req: NextRequest) {
  try {
    const authToken = getRequiredEnv('TWILIO_AUTH_TOKEN');
    const signature = req.headers.get('x-twilio-signature') || '';

    const form = await req.formData();
    const params: Record<string, string> = {};
    form.forEach((v, k) => {
      params[String(k)] = String(v);
    });

    const urlCandidates = [
      String(process.env.TWILIO_INBOUND_SMS_WEBHOOK_URL || '').trim(),
      String(req.url || '').trim(),
    ].filter(Boolean);

    // Allow turning off validation for local debugging only.
    const disableSig = String(process.env.TWILIO_DISABLE_SIGNATURE_VALIDATION || '').trim() === '1';
    if (!disableSig) {
      const ok = urlCandidates.some((u) => {
        try {
          return twilio.validateRequest(authToken, signature, u, params);
        } catch {
          return false;
        }
      });
      if (!ok) {
        return xmlResponse('<Response></Response>', 403);
      }
    }

    const fromPhone = normalizePhone(params.From || '');
    const toPhone = normalizePhone(params.To || '');
    const body = String(params.Body || '').trim();
    const sid = String(params.MessageSid || '').trim();

    if (!fromPhone || !toPhone || !body) {
      return xmlResponse('<Response></Response>', 200);
    }

    const sb = (() => {
      try {
        return getSupabaseMgmt();
      } catch {
        return getSupabase();
      }
    })();

    // Upsert thread by contact phone (the external number), preserving unread_count.
    const { data: existingThread } = await sb
      .from('sms_threads')
      .select('thread_id, unread_count')
      .eq('contact_phone', fromPhone)
      .maybeSingle();

    const nextUnread = (existingThread && typeof (existingThread as any).unread_count === 'number')
      ? Math.max(0, Number((existingThread as any).unread_count) || 0) + 1
      : 1;

    const { data: thread, error: threadErr } = await sb
      .from('sms_threads')
      .upsert(
        {
          contact_phone: fromPhone,
          last_message_preview: body.slice(0, 200),
          last_message_at: new Date().toISOString(),
          unread_count: nextUnread,
        },
        { onConflict: 'contact_phone' }
      )
      .select('*')
      .single();

    if (threadErr) {
      console.error('[twilio inbound] thread upsert error:', threadErr);
      return xmlResponse('<Response></Response>', 500);
    }

    // Insert message
    const { error: msgErr } = await sb.from('sms_messages').insert({
      thread_id: thread.thread_id,
      direction: 'INBOUND',
      body,
      from_phone: fromPhone,
      to_phone: toPhone,
      twilio_sid: sid || null,
      status: 'received',
      created_at: new Date().toISOString(),
    });

    if (msgErr) {
      console.error('[twilio inbound] message insert error:', msgErr);
      return xmlResponse('<Response></Response>', 500);
    }

    return xmlResponse('<Response></Response>', 200);
  } catch (e: any) {
    console.error('[twilio inbound] error:', e?.message || e);
    return xmlResponse('<Response></Response>', 500);
  }
}
