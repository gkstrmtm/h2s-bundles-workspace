import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import {
  corsHeaders,
  findActiveConsultationForLead,
  getLeadByToken,
  getReminderDelayMinutes,
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
  normalizePhone,
  normalizeText,
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

    const lead = await getLeadByToken(publicToken);
    if (!lead) {
      return NextResponse.json({ ok: false, error: 'Commercial lead not found' }, { status: 404, headers: corsHeaders(request) });
    }
    if (!lead.phone) {
      return NextResponse.json({ ok: false, error: 'A mobile phone number is required before a consultation can be requested.' }, { status: 400, headers: corsHeaders(request) });
    }

    const selectedSlotStart = normalizeText(body.selectedSlotStart || body.selected_slot_start || '', 64);
    const selectedSlotEnd = normalizeText(body.selectedSlotEnd || body.selected_slot_end || '', 64);
    const preferredSlots = normalizeSlots(body.preferredSlots || body.preferred_slots || []);
    const assignedTechnicianPhone = normalizePhone(body.assignedTechnicianPhone || body.assigned_technician_phone || process.env.COMMERCIAL_CONSULTATION_TECH_PHONE || '');
    const assignedTechnicianName = normalizeText(body.assignedTechnicianName || body.assigned_technician_name || process.env.COMMERCIAL_CONSULTATION_TECH_NAME || '', 120) || null;
    const mode = normalizeText(body.mode || 'create', 32).toLowerCase();
    const slotStart = selectedSlotStart || preferredSlots[0]?.startIso || '';
    const slotEnd = selectedSlotEnd || preferredSlots[0]?.endIso || '';

    if (!slotStart) {
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

      const { data, error } = await sb
        .from('commercial_consultation_requests')
        .update({
          status: 'pending',
          preferred_slots: preferredSlots,
          selected_slot_start: slotStart,
          selected_slot_end: slotEnd || null,
          assigned_technician_name: assignedTechnicianName,
          assigned_technician_phone: assignedTechnicianPhone,
          response_channel: null,
          response_note: null,
          response_at: null,
          reminder_count: 0,
          last_reminder_at: null,
          next_reminder_at: nextReminderIso(),
          updated_at: new Date().toISOString(),
        })
        .eq('request_id', requestId)
        .eq('lead_id', lead.lead_id)
        .select('*')
        .single();
      if (error || !data) {
        return NextResponse.json({ ok: false, error: error?.message || 'Failed to reschedule consultation' }, { status: 500, headers: corsHeaders(request) });
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
          selected_slot_start: slotStart,
          selected_slot_end: slotEnd || null,
          assigned_technician_name: assignedTechnicianName,
          assigned_technician_phone: assignedTechnicianPhone,
          next_reminder_at: nextReminderIso(),
          metadata: {
            reminder_delay_minutes: getReminderDelayMinutes(),
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('*')
        .single();
      if (error || !data) {
        return NextResponse.json({ ok: false, error: error?.message || 'Failed to create consultation request' }, { status: 500, headers: corsHeaders(request) });
      }
      consultation = data;
    }

    const technicianNotice = await sendTechnicianConsultationRequest(request, consultation, lead);
    const anyTechSent = technicianNotice.results.some((item: any) => item.ok);
    const customerAck = await sendCustomerPendingAcknowledgement(consultation, lead);

    if (!anyTechSent) {
      const managementNotice = await notifyManagementEscalation(consultation, lead);
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
      technicianNotice.management = managementNotice;
    }

    return NextResponse.json(
      {
        ok: true,
        consultation: serializeConsultation(consultation),
        lead: serializeLead(lead),
        notifications: {
          technician: technicianNotice.results,
          customer: customerAck,
          manualReviewRequired: !anyTechSent,
        },
      },
      { status: mode === 'reschedule' ? 200 : 201, headers: corsHeaders(request) }
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to submit consultation request' },
      { status: 500, headers: corsHeaders(request) }
    );
  }
}