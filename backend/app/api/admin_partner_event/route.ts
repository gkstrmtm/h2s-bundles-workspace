import { NextResponse } from 'next/server';
import { corsHeaders, requireAdmin } from '@/lib/adminAuth';
import { recordPartnerEvent, type PartnerEventType } from '@/lib/partnerAttribution';
import { getSupabase } from '@/lib/supabase';

const ADMIN_EVENTS = new Set<PartnerEventType>([
  'satisfaction_confirmed',
  'partner_notified',
  'follow_up_completed',
]);

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const client = getSupabase();
    const auth = await requireAdmin({ request, body, supabaseClient: client });
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error, error_code: auth.error_code },
        { status: auth.status, headers: corsHeaders(request) },
      );
    }

    const eventType = String(body.event_type || '') as PartnerEventType;
    const orderId = String(body.order_id || '').trim() || null;
    const jobId = String(body.job_id || '').trim() || null;
    if (!ADMIN_EVENTS.has(eventType) || (!orderId && !jobId)) {
      return NextResponse.json(
        { ok: false, error: 'A supported event_type and order_id or job_id are required' },
        { status: 400, headers: corsHeaders(request) },
      );
    }

    const eventIdentity = orderId || jobId;
    const result = await recordPartnerEvent(client, {
      eventType,
      idempotencyKey: `${eventType}:${eventIdentity}`,
      orderId,
      jobId,
      metadata: {
        actor_email: auth.adminEmail,
        satisfaction_status: body.satisfaction_status === 'needs_attention' ? 'needs_attention' : 'satisfied',
        note: body.note ? String(body.note).slice(0, 1000) : undefined,
      },
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error || result.skipped || 'Partner event was not recorded' },
        { status: result.skipped === 'schema_missing' ? 503 : 409, headers: corsHeaders(request) },
      );
    }
    return NextResponse.json({ ok: true, result }, { headers: corsHeaders(request) });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to record partner event' },
      { status: 500, headers: corsHeaders(request) },
    );
  }
}
