import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import twilio from 'twilio';
import { getSupabase } from '@/lib/supabase';
import { deliveryStatuses, smsStatusCallbackUrl } from '@/lib/sms_delivery';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  const reply = (status: number, error?: string) => NextResponse.json({ ok: status < 300, ...(error ? { error } : {}) },
    { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    const url = smsStatusCallbackUrl(), token = process.env.TWILIO_AUTH_TOKEN?.trim(), account = process.env.TWILIO_ACCOUNT_SID?.trim();
    if (!url || !token || !account) {
      console.error('[sms delivery] Callback configuration unavailable');
      return reply(503, 'Delivery callback configuration unavailable');
    }
    if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return reply(415, 'Expected form-encoded callback');
    const body = await request.text();
    if (body.length > 16000) return reply(413, 'Callback too large');
    const fields = new URLSearchParams(body), params: Record<string, string> = {};
    let duplicate = false;
    fields.forEach((value, key) => {
      if (Object.hasOwn(params, key)) duplicate = true;
      params[key] = value;
    });
    if (duplicate) return reply(400, 'Duplicate callback field');
    if (!twilio.validateRequest(token, request.headers.get('x-twilio-signature') || '', url, params)) {
      console.warn('[sms delivery] Rejected invalid callback signature');
      return reply(403, 'Invalid callback signature');
    }
    if (params.AccountSid !== account || !/^AC[a-f0-9]{32}$/i.test(params.AccountSid)
      || !/^(SM|MM)[a-f0-9]{32}$/i.test(params.MessageSid || '')
      || !deliveryStatuses.some(status => status === params.MessageStatus)
      || !/^\+\d{7,15}$/.test(params.To || '') || !/^\+\d{7,15}$/.test(params.From || '')
      || (params.SmsSid && params.SmsSid !== params.MessageSid)
      || (params.SmsStatus && params.SmsStatus !== params.MessageStatus)) return reply(400, 'Invalid callback identity or status');
    const event = {
      accountSid: params.AccountSid, messageSid: params.MessageSid, status: params.MessageStatus,
      to: params.To, from: params.From, errorCode: (params.ErrorCode || '').slice(0, 32),
      errorMessage: (params.ErrorMessage || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 500),
    };
    const key = createHash('sha256').update(JSON.stringify(event)).digest('hex');
    const result = await getSupabase().rpc('sms_record_delivery', { p_event_key: key, p_event: event });
    if (result.error) {
      console.error('[sms delivery] Receipt persistence failed', { code: result.error.code || 'UNKNOWN' });
      return reply(503, 'Delivery receipt persistence unavailable; retry required');
    }
    return reply(200);
  } catch (error) {
    console.error('[sms delivery] Callback failed', { type: error instanceof Error ? error.name : 'Unknown' });
    return reply(503, 'Delivery callback unavailable; retry required');
  }
}
