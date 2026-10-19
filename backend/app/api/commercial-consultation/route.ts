import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import {
  CommercialConfigurationError,
  commercialDatabaseErrorMessage,
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

    if (!slotStart && !manualFollowUp) {
      return NextResponse.json({ ok: false, error: 'At least one consultation slot is required.' }, { status: 400, headers: corsHeaders(request) });
    }

    const sb = getSupabase();

    if (mode !== 'reschedule') {
      const active = await findActiveConsultationForLead(lead.lead_id);
      if (active) {
        return NextResponse.json(
          {
            ok: false,
            error: activeStatusMessage(active.status),
            existingRequest: serializeConsultation(active),
          },
          { status: 409, headers: corsHeaders(request) }
        );
      }
    }

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

      const { data, error } = await sb
        .from('commercial_consultation_requests')
        .update({
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
          metadata: { ...(previous.metadata || {}), ...submissionMetadata },
          updated_at: new Date().toISOString(),
        })
        .eq('request_id', requestId)
        .eq('lead_id', lead.lead_id)
        .select('*')
        .single();
      if (error || !data) {
        return NextResponse.json({ ok: false, error: error ? commercialDatabaseErrorMessage(error) : 'Failed to reschedule consultation' }, { status: 500, headers: corsHeaders(request) });
      }
      consultation = data;
    } else {
      const { data, error } = await sb
        .from('commercial_consultation_requests')
        .insert({
          lead_id: lead.lead_id,
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
        })
        .select('*')
        .single();
      if (error || !data) {
        return NextResponse.json({ ok: false, error: error ? commercialDatabaseErrorMessage(error) : 'Failed to create consultation request' }, { status: 500, headers: corsHeaders(request) });
      }
      consultation = data;
    }

    const technicianNotice = await sendTechnicianConsultationRequest(consultation, lead);
    const anyTechSent = technicianNotice.results.some((item: any) => item.ok);
    const customerAck = await sendCustomerPendingAcknowledgement(consultation, lead);

    if (!anyTechSent) {
      await notifyManagementEscalation(consultation, lead);
      const { data: escalated } = await sb
        .from('commercial_consultation_requests')
        .update({
          status: 'escalated',
          escalated_at: new Date().toISOString(),
          management_notified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('request_id', consultation.request_id)
        .select('*')
        .single();
      consultation = escalated || consultation;
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