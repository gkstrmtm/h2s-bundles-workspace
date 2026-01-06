// Central API for sending management/internal notifications
// Handles SMS + Email to management team for critical events (job bookings, high-value orders, etc.)

import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import crypto from 'crypto';
import { getSupabase, getSupabaseDb1 } from '@/lib/supabase';

// Management contacts configuration
const MANAGEMENT_CONTACTS = {
  phones: [
    "+18644502445",  // Management 1
    "+18643239776",  // Management 2
    "+19513318992",  // Management 3
    "+18643235087"   // Management 4
  ],
  
  // Alert thresholds
  highValueThreshold: 500, // Orders over $500 trigger high-value alert
  
  // Alert preferences
  notifications: {
    newBookings: true,
    highValueOrders: true,
    proAssignmentFailures: true,
    quoteRequests: true
  }
};

// SMS Templates
const SMS_TEMPLATES: Record<string, string> = {
  newBooking: "NEW BOOKING: {service} for {customerName} in {city}, {state}. Order #{orderNumber} - ${amount}. Phone: {phone}",
  highValueOrder: "HIGH VALUE ORDER: {service} for {customerName} - ${amount}! Order #{orderNumber}. Phone: {phone}. Location: {city}, {state}",
  quoteRequest: "QUOTE REQUEST: {service} in {city}, {state}. Customer: {customerName} ({phone}). Email: {email}",
  proAssignmentFailure: "PRO ASSIGNMENT FAILED: Job #{jobId} for {service} in {city}, {state}. Needs manual assignment.",
  proDeclined: "PRO DECLINED: {proName} declined job #{jobId} ({service}). Reason: {reason}. Reassigning..."
};

// Initialize Twilio client
const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const EVENT_TYPE = 'mgmt_notify';
const UUID_V5_NAMESPACE = '1b0c2b6e-04b6-46b4-8a62-6bd2ddc4a8c9';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(buf: Buffer): string {
  const hex = buf.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

// Deterministic UUID from a name + namespace (UUIDv5, SHA-1)
function uuidv5(name: string, namespace: string): string {
  const ns = uuidToBytes(namespace);
  const hash = crypto.createHash('sha1');
  hash.update(ns);
  hash.update(Buffer.from(name, 'utf8'));
  const digest = hash.digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(bytes);
}

function normalizePhone(raw: string): string | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  // If already E.164-ish
  if (s.startsWith('+') && /^\+\d{10,15}$/.test(s)) return s;

  const digits = s.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return null;
}

function getManagementPhones(): string[] {
  const fromEnv = (process.env.DISPATCH_PHONES || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => normalizePhone(p))
    .filter((p): p is string => !!p);

  const base = fromEnv.length > 0 ? fromEnv : MANAGEMENT_CONTACTS.phones;
  return Array.from(new Set(base.map((p) => normalizePhone(p)).filter((p): p is string => !!p)));
}

function computeIdempotencyKey(type: string, data: any, explicit?: string): string {
  const raw = String(explicit || '').trim();
  if (raw) return raw;
  const orderNumber = String(data?.orderNumber || data?.order_id || data?.orderId || '').trim();
  const jobId = String(data?.jobId || data?.job_id || '').trim();
  const phone = String(data?.phone || data?.customerPhone || data?.customer_phone || '').trim();
  const amt = String(data?.amount || '').trim();
  const service = String(data?.service || '').trim();

  // Best-effort deterministic key for the common Stripe webhook path.
  const stableParts = [type, orderNumber || jobId || phone || service, amt].filter(Boolean);
  if (stableParts.length >= 2) return stableParts.join('|');
  return `${type}|${crypto.randomUUID()}`;
}

async function upsertNotificationEvent(params: {
  client: any;
  eventId: string;
  idempotencyKey: string;
  type: string;
  data: any;
  smsBody: string;
  phones: string[];
}) {
  const { client, eventId, idempotencyKey, type, data, smsBody, phones } = params;
  const eventTs = new Date().toISOString();

  const properties: any = {
    kind: EVENT_TYPE,
    idempotency_key: idempotencyKey,
    notification_type: type,
    data,
    sms: {
      body: smsBody,
      from: process.env.TWILIO_PHONE_NUMBER || null,
      phones: phones.map((to) => ({ to, status: 'pending', sid: null, error: null, attempts: 0 })),
    },
    status: 'pending',
    attempts: 0,
    created_at: eventTs,
    last_attempt_at: null,
    last_error: null,
  };

  const eventData: any = {
    id: eventId,
    event_id: eventId,
    visitor_id: 'system:notify-management',
    event_type: EVENT_TYPE,
    event_name: EVENT_TYPE,
    event_ts: eventTs,
    session_id: null,
    page_url: null,
    page_path: '/api/notify-management',
    revenue_amount: null,
    order_id: null,
    customer_email: null,
    customer_phone: null,
    properties,
  };

  const insertRes = await client
    .from('h2s_tracking_events')
    .insert(eventData)
    .select('id, event_id, properties')
    .single();

  if (!insertRes.error) return insertRes.data;

  // De-dupe: if we already logged this idempotency key, fetch existing.
  if (insertRes.error?.code === '23505') {
    const existing = await client
      .from('h2s_tracking_events')
      .select('id, event_id, properties')
      .eq('event_id', eventId)
      .maybeSingle();
    if (!existing.error && existing.data) return existing.data;
  }

  // If logging fails, do not block sending; return null.
  console.warn('[Notify Management] Failed to persist notification intent:', insertRes.error?.message);
  return null;
}

async function updateNotificationEvent(client: any, eventId: string, properties: any) {
  try {
    await client
      .from('h2s_tracking_events')
      .update({ properties })
      .eq('event_id', eventId);
  } catch (e) {
    console.warn('[Notify Management] Failed to update notification record:', e);
  }
}

async function sendSmsWithRetry(to: string, body: string) {
  const from = process.env.TWILIO_PHONE_NUMBER;
  const maxAttempts = 3;
  const delays = [0, 750, 2000];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (!twilioClient) throw new Error('Twilio client not configured');
      if (!from) throw new Error('Missing TWILIO_PHONE_NUMBER');
      const message = await twilioClient.messages.create({ body, from, to });
      return { ok: true as const, sid: message.sid, attempt };
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (attempt < maxAttempts) await sleep(delays[Math.min(attempt, delays.length - 1)]);
      else return { ok: false as const, error: msg, attempt };
    }
  }

  return { ok: false as const, error: 'Unknown send failure', attempt: maxAttempts };
}

async function drainPendingNotifications(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  const expected = process.env.NOTIFY_DRAIN_TOKEN || process.env.DISPATCH_ADMIN_TOKEN;
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: corsHeaders() });
  }

  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 25)));
  const client = getSupabaseDb1() || getSupabase();
  const { data: rows, error } = await client
    .from('h2s_tracking_events')
    .select('event_id, properties, event_ts')
    .eq('event_type', EVENT_TYPE)
    .order('event_ts', { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: corsHeaders() });
  }

  const results: any[] = [];
  for (const row of rows || []) {
    const props: any = row.properties || {};
    const status = String(props.status || 'pending');
    const attempts = Number(props.attempts || 0);
    if (status === 'sent') continue;
    if (attempts >= 8) continue;

    const sms = props.sms || {};
    const smsBody = String(sms.body || '').trim();
    const phones = Array.isArray(sms.phones) ? sms.phones : [];
    if (!smsBody || phones.length === 0) continue;

    const perPhone = [];
    let anyFailed = false;
    let anySent = false;

    for (const p of phones) {
      const to = String(p?.to || '').trim();
      if (!to) continue;
      if (p?.status === 'sent') {
        perPhone.push(p);
        anySent = true;
        continue;
      }

      const sendRes = await sendSmsWithRetry(to, smsBody);
      const next = {
        to,
        status: sendRes.ok ? 'sent' : 'failed',
        sid: sendRes.ok ? sendRes.sid : null,
        error: sendRes.ok ? null : sendRes.error,
        attempts: Number(p?.attempts || 0) + 1,
        last_attempt_at: new Date().toISOString(),
      };
      perPhone.push(next);
      if (sendRes.ok) anySent = true;
      else anyFailed = true;
    }

    const nextProps = {
      ...props,
      attempts: attempts + 1,
      last_attempt_at: new Date().toISOString(),
      status: anyFailed ? (anySent ? 'partial' : 'failed') : 'sent',
      last_error: anyFailed ? 'One or more recipients failed' : null,
      sms: { ...sms, phones: perPhone },
    };

    await updateNotificationEvent(client, row.event_id, nextProps);

    results.push({ event_id: row.event_id, status: nextProps.status });
  }

  return NextResponse.json({ ok: true, processed: results.length, results }, { headers: corsHeaders() });
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  if (action === 'drain') return drainPendingNotifications(request);
  return NextResponse.json({ ok: true }, { headers: corsHeaders() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, data, idempotency_key, dry_run } = body;

    if (!type || !data) {
      return NextResponse.json(
        { error: 'Missing required fields: type, data' },
        { status: 400 }
      );
    }

    // Check if this notification type is enabled
    const notificationEnabled = (MANAGEMENT_CONTACTS.notifications as any)[type] !== false;
    
    if (!notificationEnabled) {
      console.log(`[Notify Management] ${type} notifications disabled`);
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: 'notification_type_disabled'
      });
    }

    const results: any = {
      type,
      sms: []
    };

    const managementPhones = getManagementPhones();

    // Send SMS to all management phones
    if (managementPhones.length > 0) {
      // Get SMS template and populate with data
      let smsMessage = SMS_TEMPLATES[type] || `Alert: ${type} - ${JSON.stringify(data)}`;
      
      // Replace placeholders
      Object.keys(data).forEach(key => {
        const value = data[key] || '';
        smsMessage = smsMessage.replace(new RegExp(`{${key}}`, 'g'), String(value));
      });

      const sb = getSupabaseDb1() || getSupabase();
      const idemKey = computeIdempotencyKey(String(type), data, idempotency_key);
      const eventId = uuidv5(idemKey, UUID_V5_NAMESPACE);

      const logged = await upsertNotificationEvent({
        client: sb,
        eventId,
        idempotencyKey: idemKey,
        type: String(type),
        data,
        smsBody: smsMessage,
        phones: managementPhones,
      });

      const existingProps: any = logged?.properties || null;
      if (existingProps?.status === 'sent') {
        return NextResponse.json({
          ok: true,
          deduped: true,
          type,
          event_id: eventId,
          timestamp: new Date().toISOString(),
        }, { headers: corsHeaders() });
      }

      // Safety mode for production verification: persist the intent but do not send.
      if (dry_run === true) {
        const nextProps = {
          ...(existingProps || {}),
          status: 'dry_run',
          attempts: Number(existingProps?.attempts || 0),
          last_attempt_at: existingProps?.last_attempt_at || null,
          last_error: null,
          sms: {
            ...(existingProps?.sms || {}),
            body: smsMessage,
            from: process.env.TWILIO_PHONE_NUMBER || null,
            phones: Array.isArray(existingProps?.sms?.phones)
              ? existingProps.sms.phones
              : managementPhones.map((to) => ({ to, status: 'pending', sid: null, error: null, attempts: 0 })),
          },
        };
        await updateNotificationEvent(sb, eventId, nextProps);
        return NextResponse.json({
          ok: true,
          dry_run: true,
          type,
          event_id: eventId,
          idempotency_key: idemKey,
          preview: {
            sms_body: smsMessage,
            recipients: managementPhones,
          },
          timestamp: new Date().toISOString(),
        }, { headers: corsHeaders() });
      }

      const perPhone = Array.isArray(existingProps?.sms?.phones)
        ? existingProps.sms.phones
        : managementPhones.map((to) => ({ to, status: 'pending', sid: null, error: null, attempts: 0 }));

      let anyFailed = false;
      let anySent = false;

      for (const entry of perPhone) {
        const phone = String(entry?.to || '').trim();
        if (!phone) continue;

        if (entry.status === 'sent') {
          anySent = true;
          results.sms.push({ phone, success: true, sid: entry.sid, deduped: true });
          continue;
        }

        const sendRes = await sendSmsWithRetry(phone, smsMessage);
        if (sendRes.ok) {
          anySent = true;
          results.sms.push({ phone, success: true, sid: sendRes.sid });
          entry.status = 'sent';
          entry.sid = sendRes.sid;
          entry.error = null;
        } else {
          anyFailed = true;
          results.sms.push({ phone, success: false, error: sendRes.error });
          entry.status = 'failed';
          entry.error = sendRes.error;
        }
        entry.attempts = Number(entry.attempts || 0) + 1;
        entry.last_attempt_at = new Date().toISOString();
      }

      const nextProps = {
        ...(existingProps || {}),
        status: anyFailed ? (anySent ? 'partial' : 'failed') : 'sent',
        attempts: Number(existingProps?.attempts || 0) + 1,
        last_attempt_at: new Date().toISOString(),
        last_error: anyFailed ? 'One or more recipients failed' : null,
        sms: {
          ...(existingProps?.sms || {}),
          body: smsMessage,
          from: process.env.TWILIO_PHONE_NUMBER || null,
          phones: perPhone,
        },
      };
      await updateNotificationEvent(sb, eventId, nextProps);

      results.event_id = eventId;
      results.status = nextProps.status;
      if (!twilioClient || !process.env.TWILIO_PHONE_NUMBER) {
        results.warning = 'Twilio not configured; notification recorded for retry';
      }
    } else {
      console.warn('[Notify Management] Twilio not configured or no management phones');
      results.warning = 'Twilio not configured or no management phones';
    }

    return NextResponse.json({
      ok: true,
      ...results,
      timestamp: new Date().toISOString()
    }, { headers: corsHeaders() });

  } catch (error: any) {
    console.error('[Notify Management] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500, headers: corsHeaders() }
    );
  }
}

// Allow OPTIONS for CORS preflight
export async function OPTIONS(request: NextRequest) {
  return NextResponse.json({}, {
    headers: corsHeaders()
  });
}
