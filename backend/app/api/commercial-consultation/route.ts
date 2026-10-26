import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import {
  CommercialConfigurationError,
  commercialDatabaseErrorMessage,
  commercialRpc,
  corsHeaders,
  findActiveConsultationForLead,
  getLeadByToken,
  getPublicBaseUrl,
  getReminderDelayMinutes,
  getTechnicianPhones,
  nextReminderIso,
  notifyManagementEscalation,
  sendCustomerPendingAcknowledgement,
  sendTechnicianConsultationRequest,
  serializeConsultation,
  serializeLead,
} from '@/lib/commercial_consultation_runtime';

const commercialUtils = require('@/lib/commercial_consultation.js') as any;

const {
  generateConsultationReference,
  generateResponseToken,
  normalizeText,
  validateCommercialContact,
  validateConsultationWindow,
} = commercialUtils;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalizeSlots(input: any[]) {
  const slots = Array.isArray(input) ? input : [];
  return slots
    .map((slot: any) => ({
      startIso: normalizeText(slot?.startIso || slot?.start || '', 64),
      endIso: normalizeText(slot?.endIso || slot?.end || '', 64),
    }))
    .filter((slot: any) => slot.startIso);
}

function activeStatusMessage(status: string) {
  return status === 'approved' || status === 'customer_confirmed'
    ? 'A consultation has already been confirmed for this lead.'
    : 'A consultation request is already in progress for this lead.';
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({}, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const publicToken = normalizeText(body.publicToken || '', 120);
    if (!publicToken) {
      return NextResponse.json({ ok: false, error: 'Missing publicToken' }, { status: 400, headers: corsHeaders(request) });
    }

    getPublicBaseUrl();
    const technicianPhones = getTechnicianPhones();
    const lead = await getLeadByToken(publicToken);
    if (!lead) {
      return NextResponse.json({ ok: false, error: 'Commercial lead not found' }, { status: 404, headers: corsHeaders(request) });
    }
    if (lead.attribution?.market==='residential') return NextResponse.json({ok:false,error:'Homeowner inquiries do not book Commercial consultations.'},
      {status:409,headers:corsHeaders(request)});
    const contactError = validateCommercialContact(lead);
    if (contactError) {
      return NextResponse.json({ ok: false, error: contactError.message, field: contactError.field }, { status: 400, headers: corsHeaders(request) });
    }
    const manualFollowUp = lead.contact_preference === 'email' || lead.contact_preference === 'call';
    const submissionMetadata = {
      request_kind: manualFollowUp ? 'manual_follow_up' : 'consultation',
      contact_preference: lead.contact_preference || 'sms',
      submitted_at: new Date().toISOString(),
    };

    const selectedSlotStart = normalizeText(body.selectedSlotStart || body.selected_slot_start || '', 64);
    const selectedSlotEnd = normalizeText(body.selectedSlotEnd || body.selected_slot_end || '', 64);
    const preferredSlots = normalizeSlots(body.preferredSlots || body.preferred_slots || []);
    const assignedTechnicianPhone = technicianPhones[0];
    const assignedTechnicianName = normalizeText(process.env.COMMERCIAL_CONSULTATION_TECH_NAME || '', 120) || null;
    const mode = normalizeText(body.mode || 'create', 32).toLowerCase();
    const slotStart = selectedSlotStart || preferredSlots[0]?.startIso || '';
    const slotEnd = selectedSlotEnd || preferredSlots[0]?.endIso || '';

    if (mode !== 'create' && mode !== 'reschedule') {
      return NextResponse.json({ ok: false, error: 'Unsupported submission mode.' }, { status: 400, headers: corsHeaders(request) });
    }
    if (mode === 'create') {
      const active = await findActiveConsultationForLead(lead.lead_id);
      if (active) return NextResponse.json({
        ok: true, replayed: true, consultation: serializeConsultation(active), lead: serializeLead(lead),
        notifications: { technician: [], customer: { skipped: true }, manualReviewRequired: manualFollowUp },
      }, { headers: corsHeaders(request) });
    }
    if (!slotStart && !manualFollowUp) {
      return NextResponse.json({ ok: false, error: 'At least one consultation slot is required.' }, { status: 400, headers: corsHeaders(request) });
    }
    const windowError = validateConsultationWindow(slotStart, slotEnd);
    if (windowError) return NextResponse.json({ ok: false, error: windowError, field: 'slotGrid' }, {
      status: 400, headers: corsHeaders(request),
    });

    const sb = getSupabase();

    let consultation: any = null;
    if (mode === 'reschedule') {
      const requestId = normalizeText(body.requestId || body.request_id || '', 120);
      if (!requestId) {
        return NextResponse.json({ ok: false, error: 'requestId is required for reschedule mode.' }, { status: 400, headers: corsHeaders(request) });
      }
      const { data: previous, error: previousError } = await sb
        .from('commercial_consultation_requests').select('*')
        .eq('request_id', requestId).eq('lead_id', lead.lead_id).maybeSingle();
      if (previousError) throw new Error(commercialDatabaseErrorMessage(previousError));
      if (!previous) {
        return NextResponse.json({ ok: false, error: 'Consultation request not found' }, { status: 404, headers: corsHeaders(request) });
      }
      if (previous.related_order_id || !['pending', 'escalated', 'reschedule_requested'].includes(previous.status)) {
        return NextResponse.json({ ok: false, error: 'This request needs staff review before rescheduling an appointment.' }, {
          status: 409, headers: corsHeaders(request),
        });
      }

      const rescheduled = await commercialRpc('commercial_reschedule_request', {
        p_request_id: requestId, p_lead_id: lead.lead_id, p_expected_token: previous.response_token,
        p_key: normalizeText(body.submissionKey || '', 120) || `reschedule:${slotStart}:${slotEnd}:${lead.contact_preference}`,
        p_patch: {
          status: 'pending',
          preferred_slots: preferredSlots,
          selected_slot_start: slotStart || null,
          selected_slot_end: slotEnd || null,
          assigned_technician_name: assignedTechnicianName,
          assigned_technician_phone: assignedTechnicianPhone,
          response_channel: null,
          response_note: null,
          response_at: null,
          reminder_count: 0,
          last_reminder_at: null,
          next_reminder_at: manualFollowUp ? null : nextReminderIso(),
          response_token: generateResponseToken(),
          metadata: submissionMetadata,
          updated_at: new Date().toISOString(),
        },
      });
      consultation = rescheduled.request;
      if (rescheduled.replayed) return NextResponse.json({
        ok: true, replayed: true, consultation: serializeConsultation(consultation), lead: serializeLead(lead),
        notifications: { technician: [], customer: { skipped: true }, manualReviewRequired: manualFollowUp },
      }, { headers: corsHeaders(request) });
    } else {
      const saved = await commercialRpc('commercial_submit_request', {
        p_lead_id: lead.lead_id,
        p_key: normalizeText(body.submissionKey || '', 120) || generateResponseToken(),
        p_patch: {
          reference_code: generateConsultationReference(),
          response_token: generateResponseToken(),
          status: 'pending',
          preferred_slots: preferredSlots,
          selected_slot_start: slotStart || null,
          selected_slot_end: slotEnd || null,
          assigned_technician_name: assignedTechnicianName,
          assigned_technician_phone: assignedTechnicianPhone,
          next_reminder_at: manualFollowUp ? null : nextReminderIso(),
          metadata: {
            ...submissionMetadata,
            reminder_delay_minutes: getReminderDelayMinutes(),
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      });
      consultation = saved.request;
      if (!saved.created) return NextResponse.json({
        ok: true, replayed: true, consultation: serializeConsultation(consultation), lead: serializeLead(lead),
        notifications: { technician: [], customer: { skipped: true }, manualReviewRequired: manualFollowUp },
      }, { headers: corsHeaders(request) });
    }

    const technicianNotice = await sendTechnicianConsultationRequest(consultation, lead);
    const anyTechSent = technicianNotice.results.some((item: any) => item.ok);
    const customerAck = await sendCustomerPendingAcknowledgement(consultation, lead);

    if (!anyTechSent) {
      const management = await notifyManagementEscalation(consultation, lead);
      const { data: escalated, error: escalationError } = await sb
        .from('commercial_consultation_requests')
        .update({
          status: 'escalated',
          escalated_at: new Date().toISOString(),
          management_notified_at: management.some(item => item.ok) ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('request_id', consultation.request_id)
        .eq('status', consultation.status)
        .eq('response_token', consultation.response_token)
        .select('*')
        .maybeSingle();
      if (escalationError || !escalated) throw new Error(escalationError ? commercialDatabaseErrorMessage(escalationError) : 'Request changed during dispatch. Reload its current status.');
      consultation = escalated;
    }

    return NextResponse.json(
      {
        ok: true,
        consultation: serializeConsultation(consultation),
        lead: serializeLead(lead),
        notifications: {
          technician: technicianNotice.results,
          customer: customerAck,
          manualReviewRequired: manualFollowUp || !anyTechSent,
        },
      },
      { status: mode === 'reschedule' ? 200 : 201, headers: corsHeaders(request) }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to submit consultation request' },
      { status: error instanceof CommercialConfigurationError ? 503 : 500, headers: corsHeaders(request) }
    );
  }
}