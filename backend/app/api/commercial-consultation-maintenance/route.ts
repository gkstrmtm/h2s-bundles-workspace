import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getSupabase } from '@/lib/supabase';
const { isManualCommercialFollowUp } = require('@/lib/commercial_consultation.js');
import {
  CommercialConfigurationError,
  commercialDatabaseErrorMessage,
  corsHeaders,
  getLeadById,
  getMaxReminderCount,
  getPublicBaseUrl,
  getTechnicianPhones,
  nextReminderIso,
  notifyManagementEscalation,
  sendTechnicianConsultationRequest,
  sendConsultationCallReminder,
} from '@/lib/commercial_consultation_runtime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(request: Request) {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const manualSecret = String(process.env.COMMERCIAL_MAINTENANCE_TOKEN || '').trim();
  if (!cronSecret && !manualSecret) {
    throw new CommercialConfigurationError('Configure CRON_SECRET for scheduled commercial maintenance or COMMERCIAL_MAINTENANCE_TOKEN for manual maintenance.');
  }
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '')?.[1] || '';
  const manualToken = String(request.headers.get('x-maintenance-token') || '').trim();
  const matches = (provided: string, expected: string) => {
    if (!provided || !expected) return false;
    const left = Buffer.from(provided, 'utf8');
    const right = Buffer.from(expected, 'utf8');
    return left.length === right.length && timingSafeEqual(left, right);
  };
  return matches(bearer, cronSecret) || matches(bearer, manualSecret) || matches(manualToken, manualSecret);
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: { ...corsHeaders(request), 'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Maintenance-Token' } });
}

async function processMaintenance(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: corsHeaders(request) });
  }

  getPublicBaseUrl();
  getTechnicianPhones();
  const sb = getSupabase();
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from('commercial_consultation_requests')
    .select('*')
    .in('status', ['pending', 'escalated', 'reschedule_requested'])
    .lte('next_reminder_at', nowIso)
    .order('next_reminder_at', { ascending: true })
    .limit(25);

  if (error) {
    return NextResponse.json({ ok: false, error: commercialDatabaseErrorMessage(error) }, { status: 500, headers: corsHeaders(request) });
  }

  const processed: any[] = [];

  for (const consultation of data || []) {
    if (['manual_follow_up','residential_inquiry'].includes(consultation.metadata?.request_kind)) continue;
    const lead = await getLeadById(consultation.lead_id);
    if (!lead) continue;
    if (isManualCommercialFollowUp(consultation, lead)) continue;
    const { data: workload, error: workloadError } = await sb.from('commercial_lead_operations')
      .select('disposition,hold_until,sales_chasing_paused').eq('lead_id', consultation.lead_id).maybeSingle();
    if (workloadError) throw new Error(commercialDatabaseErrorMessage(workloadError));
    if (workload?.sales_chasing_paused || workload?.disposition === 'closed' || Date.parse(workload?.hold_until || '') > Date.now()) {
      processed.push({ requestId: consultation.request_id, action: 'sales_chasing_paused',
        consultationReviewRequired: !consultation.related_order_id, appointmentsUnchanged: true });
      continue;
    }

    const maxReminders = getMaxReminderCount();
    const windowExpired = consultation.selected_slot_start && new Date(consultation.selected_slot_start).getTime() <= Date.now();
    if ((consultation.reminder_count || 0) >= maxReminders || windowExpired) {
      const management = await notifyManagementEscalation(consultation, lead);
      const { data: escalated, error: escalationError } = await sb
        .from('commercial_consultation_requests')
        .update({
          status: 'escalated',
          escalated_at: new Date().toISOString(),
          management_notified_at: management.some(item => item.ok) ? new Date().toISOString() : null,
          next_reminder_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('request_id', consultation.request_id)
        .eq('status', consultation.status)
        .eq('response_token', consultation.response_token)
        .eq('reminder_count', consultation.reminder_count || 0)
        .select('request_id').maybeSingle();
      if (escalationError) throw new Error(commercialDatabaseErrorMessage(escalationError));
      processed.push({ requestId: consultation.request_id, action: escalated ? 'escalated' : 'changed_during_processing', notifications: management });
      continue;
    }

    const sent = await sendTechnicianConsultationRequest(consultation, lead, `reminder:${consultation.reminder_count || 0}`);
    if (!sent.results.some(item => item.ok)) {
      processed.push({ requestId: consultation.request_id, action: 'delivery_review_required', notifications: sent.results });
      continue;
    }
    const { data: reminded, error: reminderError } = await sb
      .from('commercial_consultation_requests')
      .update({
        reminder_count: Number(consultation.reminder_count || 0) + 1,
        last_reminder_at: new Date().toISOString(),
        next_reminder_at: nextReminderIso(),
        updated_at: new Date().toISOString(),
      })
      .eq('request_id', consultation.request_id)
      .eq('status', consultation.status)
      .eq('response_token', consultation.response_token)
      .eq('reminder_count', consultation.reminder_count || 0)
      .select('request_id').maybeSingle();
    if (reminderError) throw new Error(commercialDatabaseErrorMessage(reminderError));

    processed.push({ requestId: consultation.request_id, action: reminded ? 'reminded' : 'changed_during_processing', notifications: sent.results });
  }

  const { data: booked, error: bookedError } = await sb.from('commercial_consultation_requests').select('*')
    .in('status', ['approved','customer_confirmed']).lte('next_reminder_at', nowIso)
    .order('next_reminder_at', { ascending: true }).limit(25);
  if (bookedError) throw new Error(commercialDatabaseErrorMessage(bookedError));
  for (const consultation of booked || []) {
    const lead = await getLeadById(consultation.lead_id);
    if (!lead) {
      processed.push({ requestId: consultation.request_id, action: 'missing_lead_review_required' });
      continue;
    }
    const result = await sendConsultationCallReminder(consultation, lead, new Date(nowIso));
    const ended = ['window_passed','appointment_ended'].includes(result.action);
    if (ended) console.warn('Commercial call reminder ended without another send', { requestId: consultation.request_id, reason: result.action });
    if (ended || 'nextReminderAt' in result && result.notification?.ok) {
      const { error: updateError } = await sb.from('commercial_consultation_requests')
        .update({ next_reminder_at: 'nextReminderAt' in result ? result.nextReminderAt : null, updated_at: new Date().toISOString() })
        .eq('request_id', consultation.request_id).eq('status', consultation.status)
        .eq('response_token', consultation.response_token).eq('next_reminder_at', consultation.next_reminder_at);
      if (updateError) throw new Error(commercialDatabaseErrorMessage(updateError));
    }
    processed.push({ requestId: consultation.request_id, ...result });
  }
  return NextResponse.json({ ok: true, processed }, { headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  return handleMaintenance(request);
}

export async function POST(request: Request) {
  return handleMaintenance(request);
}

async function handleMaintenance(request: Request) {
  try {
    return await processMaintenance(request);
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Commercial maintenance failed' },
      { status: error instanceof CommercialConfigurationError ? 503 : 500, headers: corsHeaders(request) }
    );
  }
}