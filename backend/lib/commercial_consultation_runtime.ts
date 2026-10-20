import twilio from 'twilio';
import { getSupabase } from '@/lib/supabase';

const commercialUtils = require('@/lib/commercial_consultation.js') as any;

const {
  buildApprovalLinks,
  buildCustomerConfirmedMessage,
  buildCustomerPendingMessage,
  buildEscalationMessage,
  buildTechnicianRequestMessage,
  canTransitionConsultationStatus,
  normalizePhone,
  normalizeText
} = commercialUtils;
const { hasCommercialSmsConsent, validateCommercialContact, isManualCommercialFollowUp, buildManualFollowUpMessage } = commercialUtils;

type SmsResult = {
  ok: boolean;
  to: string;
  sid?: string | null;
  status?: string | null;
  error?: string | null;
  accepted?: boolean;
  retrySafe?: boolean;
  persistenceError?: string;
};

export class CommercialConfigurationError extends Error {}

function safeTrim(value: any): string {
  return String(value || '').trim();
}

function isMissingCommercialRelationError(error: any): boolean {
  const code = safeTrim(error?.code).toUpperCase();
  const message = safeTrim(error?.message).toLowerCase();
  return code === 'PGRST205'
    || code === '42P01'
    || code === 'PGRST204'
    || code === '42703'
    || message.includes('commercial_leads') && message.includes('not found')
    || message.includes('commercial_consultation_requests') && message.includes('not found')
    || message.includes('relation') && (message.includes('commercial_leads') || message.includes('commercial_consultation_requests'));
}

export function commercialDatabaseErrorMessage(error: { code?: string; message?: string } | null | undefined) {
  if (isMissingCommercialRelationError(error)) {
    return 'Commercial database schema is missing or incompatible. An authorized operator must inspect the target and prepare a reviewed versioned migration using docs/DATABASE_MIGRATIONS.md. Request-time schema setup is disabled; do not run the legacy 014 SQL blindly.';
  }
  return error?.message || 'Commercial database operation failed';
}

export function corsHeaders(request?: Request, methods = 'GET, POST, OPTIONS') {
  const origin = request?.headers.get('origin') || '';
  const allowOrigin = origin || '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin === 'null' ? '*' : allowOrigin,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

export function getPublicBaseUrl() {
  const envBase = safeTrim(process.env.COMMERCIAL_PUBLIC_BASE_URL)
    || safeTrim(process.env.PUBLIC_SITE_URL)
    || safeTrim(process.env.NEXT_PUBLIC_SITE_URL);
  const configurationError = 'Configure COMMERCIAL_PUBLIC_BASE_URL (or PUBLIC_SITE_URL / NEXT_PUBLIC_SITE_URL) as a canonical HTTPS origin. Explicit HTTP loopback configuration is allowed only outside production.';
  if (!envBase) throw new CommercialConfigurationError(configurationError);
  let url: URL;
  try {
    url = new URL(envBase);
  } catch {
    throw new CommercialConfigurationError(configurationError);
  }
  const localHttp = url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && process.env.NODE_ENV !== 'production'
    && process.env.VERCEL_ENV !== 'production';
  if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new CommercialConfigurationError(configurationError);
  }
  return url.origin;
}

function uniquePhones(values: any[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values || []) {
    const phone = normalizePhone(value);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    out.push(phone);
  }
  return out;
}

export function getTechnicianPhones() {
  const phones: string[] = [];
  for (const name of ['COMMERCIAL_CONSULTATION_TECH_PHONE', 'COMMERCIAL_CONSULTATION_TECH_PHONES', 'DISPATCH_PHONES']) {
    for (const value of safeTrim(process.env[name]).split(',').map(item => item.trim()).filter(Boolean)) {
      const phone = normalizePhone(value);
      if (!phone) throw new CommercialConfigurationError(`Invalid technician phone configuration in ${name}`);
      if (!phones.includes(phone)) phones.push(phone);
    }
  }
  if (!phones.length) {
    throw new CommercialConfigurationError('Configure COMMERCIAL_CONSULTATION_TECH_PHONE, COMMERCIAL_CONSULTATION_TECH_PHONES, or DISPATCH_PHONES before requesting a consultation.');
  }
  return phones;
}

export function getEscalationPhones() {
  const envPhones = [
    process.env.COMMERCIAL_ESCALATION_PHONES,
    process.env.DISPATCH_PHONES,
  ]
    .filter(Boolean)
    .flatMap(value => String(value || '').split(','));

  return uniquePhones(envPhones);
}

function getTwilioConfig() {
  const accountSid = safeTrim(process.env.TWILIO_ACCOUNT_SID);
  const authToken = safeTrim(process.env.TWILIO_AUTH_TOKEN);
  const fromPhone = normalizePhone(process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER || '');
  if (!accountSid || !authToken || !fromPhone) return null;
  return {
    client: twilio(accountSid, authToken),
    fromPhone,
  };
}

export function readJsonArray(value: any) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function getSlotLabel(startIso?: string | null, endIso?: string | null) {
  const start = safeTrim(startIso);
  if (!start) return 'requested consultation slot';
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return 'requested consultation slot';
  const endDate = endIso ? new Date(endIso) : null;
  const dateText = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit'
  }).format(startDate);
  if (!endDate || Number.isNaN(endDate.getTime())) return dateText;
  const endText = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit'
  }).format(endDate);
  return `${dateText} to ${endText} Eastern Time`;
}

export function serializeLead(row: any) {
  if (!row) return null;
  return {
    leadId: row.lead_id,
    publicToken: row.public_token,
    fullName: row.full_name,
    companyName: row.company_name,
    email: row.email,
    phone: row.phone,
    contactPreference: row.contact_preference,
    businessType: row.business_type,
    projectAddress: row.project_address,
    projectCity: row.project_city,
    projectState: row.project_state,
    projectPostalCode: row.project_postal_code,
    scopeSummary: row.scope_summary,
    timeline: row.timeline,
    budgetBand: row.budget_band,
    siteCount: row.site_count,
    serviceNeeds: Array.isArray(row.service_needs) ? row.service_needs : readJsonArray(row.service_needs),
    projectPhotoUrls: Array.isArray(row.project_photo_urls) ? row.project_photo_urls : readJsonArray(row.project_photo_urls),
    assessmentAnswers: row.assessment_answers || {},
    attribution: row.attribution || {},
    notes: row.notes || '',
    completenessScore: row.completeness_score,
    completenessBucket: row.completeness_bucket,
    priorityTier: row.priority_tier,
    lastSubmittedAt: row.last_submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revision: Number(row.revision || 0),
    lastSaveKey: row.last_save_key || null,
  };
}

export function serializeConsultation(row: any) {
  if (!row) return null;
  const preferredSlots = Array.isArray(row.preferred_slots) ? row.preferred_slots : readJsonArray(row.preferred_slots);
  return {
    requestId: row.request_id,
    leadId: row.lead_id,
    referenceCode: row.reference_code,
    status: row.status,
    preferredSlots,
    selectedSlotStart: row.selected_slot_start,
    selectedSlotEnd: row.selected_slot_end,
    slotLabel: getSlotLabel(row.selected_slot_start || preferredSlots?.[0]?.startIso, row.selected_slot_end || preferredSlots?.[0]?.endIso),
    assignedTechnicianName: row.assigned_technician_name,
    assignedTechnicianPhone: row.assigned_technician_phone,
    responseChannel: row.response_channel,
    responseNote: row.response_note,
    responseAt: row.response_at,
    reminderCount: row.reminder_count,
    nextReminderAt: row.next_reminder_at,
    escalatedAt: row.escalated_at,
    managementNotifiedAt: row.management_notified_at,
    customerConfirmationSentAt: row.customer_confirmation_sent_at,
    customerReminderSentAt: row.customer_reminder_sent_at,
    relatedOrderId: row.related_order_id,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getLeadByToken(publicToken: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('commercial_leads')
    .select('*')
    .eq('public_token', publicToken)
    .maybeSingle();
  if (error) {
    throw new Error(commercialDatabaseErrorMessage(error));
  }
  return data || null;
}

export async function commercialRpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await getSupabase().rpc(name, args);
    if (error) {
      const missing = error.code === 'PGRST202' || error.code === '42883' || error.code === '42703' || error.code === '42P01';
      throw new Error(missing
        ? 'Commercial reliability migration 031 is required. An authorized operator must review and apply it before enabling this workflow.'
        : `Commercial persistence failed: ${error.message}`);
    }

    return data;
}

export async function retryCommercialProcessing(request: Request, requestId: string) {
      const { data, error } = await getSupabase().from('commercial_consultation_requests').select('*').eq('request_id', requestId).maybeSingle();
      if (error) throw new Error(commercialDatabaseErrorMessage(error));
      if (!data) return { ok: false, error: 'Commercial request not found' };
      const lead = await getLeadById(data.lead_id);
      if (!lead) return { ok: false, error: 'Commercial lead not found' };
      if (!isManualCommercialFollowUp(data, lead) && data.selected_slot_start && new Date(data.selected_slot_start).getTime() <= Date.now()) {
        return { ok: false, error: 'Requested window has passed. Contact the customer to arrange a new window; do not retry the old window.' };
      }
      if (['approved', 'customer_confirmed', 'declined'].includes(data.status)) {
        return applyConsultationDecision({ request, consultation: data, lead, action: data.status === 'declined' ? 'decline' : 'approve', channel: 'manual' });
      }
      if (!['pending', 'escalated', 'reschedule_requested'].includes(data.status)) return { ok: false, error: 'This request is no longer pending.' };
      const notification = await sendTechnicianConsultationRequest(data, lead);
      const acknowledgement = await sendCustomerPendingAcknowledgement(data, lead);
      const management = data.status === 'escalated' ? await notifyManagementEscalation(data, lead) : [];
      return { ok: true, notification, acknowledgement, management };
    }

export async function getConsultationByToken(responseToken: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('commercial_consultation_requests')
    .select('*')
    .eq('response_token', responseToken)
    .maybeSingle();
  if (error) {
    throw new Error(commercialDatabaseErrorMessage(error));
  }
  if (!data) return null;
  const lead = await getLeadById(data.lead_id);
  return { consultation: data, lead };
}

export async function getLeadById(leadId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('commercial_leads')
    .select('*')
    .eq('lead_id', leadId)
    .maybeSingle();
  if (error) {
    throw new Error(commercialDatabaseErrorMessage(error));
  }
  return data || null;
}

export async function findActiveConsultationForLead(leadId: string) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('commercial_consultation_requests')
    .select('*')
    .eq('lead_id', leadId)
    .in('status', ['pending', 'approved', 'customer_confirmed', 'escalated', 'reschedule_requested'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(commercialDatabaseErrorMessage(error));
  }
  return data || null;
}

async function persistSmsMessage(params: { to: string; body: string; fromPhone: string; sid?: string | null; status?: string | null; contactName?: string | null }) {
  const sb = getSupabase();
  const nowIso = new Date().toISOString();
  const { data: thread, error: threadErr } = await sb
    .from('sms_threads')
    .upsert(
      {
        contact_phone: params.to,
        contact_name: params.contactName || null,
        last_message_preview: params.body.slice(0, 200),
        last_message_at: nowIso,
        unread_count: 0,
      },
      { onConflict: 'contact_phone' }
    )
    .select('*')
    .single();

  if (threadErr) {
    return { ok: false, error: threadErr.message };
  }

  const { error: messageErr } = await sb.from('sms_messages').insert({
    thread_id: thread.thread_id,
    direction: 'OUTBOUND',
    body: params.body,
    from_phone: params.fromPhone,
    to_phone: params.to,
    twilio_sid: params.sid || null,
    status: params.status || null,
    created_at: nowIso,
  });

  if (messageErr) {
    return { ok: false, error: messageErr.message };
  }

  return { ok: true };
}

export async function sendSmsAndPersist(to: string, body: string, contactName?: string | null): Promise<SmsResult> {
  const twilioConfig = getTwilioConfig();
  if (!twilioConfig) {
    return { ok: false, to, error: 'Twilio is not configured', retrySafe: true };
  }

  let message;
  try {
    message = await twilioConfig.client.messages.create({
      from: twilioConfig.fromPhone,
      to,
      body,
    });
  } catch (error: any) {
    await persistSmsMessage({
      to,
      body,
      fromPhone: twilioConfig.fromPhone,
      status: 'failed',
      contactName,
    }).catch((persistError: unknown) => {
      console.error('Commercial failed-message persistence error:', persistError);
      return null;
    });
    return {
      ok: false,
      to,
      status: 'failed',
      error: error?.message || 'Failed to send SMS',
      retrySafe: [400, 401, 403, 404, 422, 429].includes(Number(error?.status)),
    };
  }
  let persistenceError;
  try {
    const persisted = await persistSmsMessage({
      to, body, fromPhone: twilioConfig.fromPhone, sid: message.sid,
      status: message.status || 'queued', contactName,
    });
    if (!persisted.ok) persistenceError = persisted.error;
  } catch (error) {
    persistenceError = error instanceof Error ? error.message : 'SMS message persistence failed';
  }
  if (persistenceError) console.error('Commercial SMS accepted but local message persistence failed:', persistenceError);
  return { ok: true, accepted: true, to, sid: message.sid, status: message.status || 'queued', persistenceError };
}

async function sendRecordedSms(consultation: any, kind: string, to: string, body: string, name?: string | null) {
    const claimed = await commercialRpc('commercial_claim_effect', { p_request_id: consultation.request_id, p_kind: kind });
    if (!claimed) {
      const { data, error } = await getSupabase().from('commercial_effects').select('state,details')
        .eq('request_id', consultation.request_id).eq('kind', kind).maybeSingle();
      if (error) throw new Error(commercialDatabaseErrorMessage(error));
      return { ok: data?.state === 'accepted', accepted: data?.state === 'accepted', to, skipped: true,
        reason: 'Previously accepted or awaiting provider reconciliation; no automatic resend.' };
    }
    const result = await sendSmsAndPersist(to, body, name);
    await commercialRpc('commercial_finish_effect', {
      p_request_id: consultation.request_id, p_kind: kind,
      p_state: result.ok ? 'accepted' : result.retrySafe ? 'failed' : 'uncertain',
      p_details: result,
    });
    return result;
}

export async function sendBulkSms(phones: string[], body: string, contactName?: string | null) {
  const results: SmsResult[] = [];
  for (const phone of uniquePhones(phones)) {
    results.push(await sendSmsAndPersist(phone, body, contactName));
  }
  return results;
}

export function getReminderDelayMinutes() {
  const raw = Number.parseInt(String(process.env.COMMERCIAL_CONSULTATION_REMINDER_MINUTES || '15'), 10);
  if (!Number.isFinite(raw) || raw < 5) return 15;
  return raw;
}

export function getMaxReminderCount() {
  const raw = Number.parseInt(String(process.env.COMMERCIAL_CONSULTATION_MAX_REMINDERS || '2'), 10);
  if (!Number.isFinite(raw) || raw < 1) return 2;
  return raw;
}

export function nextReminderIso(fromDate = new Date()) {
  return new Date(fromDate.getTime() + getReminderDelayMinutes() * 60 * 1000).toISOString();
}

export async function maybeCreateAppointment(request: Request, consultation: any, lead: any) {
  if (isManualCommercialFollowUp(consultation, lead) || validateCommercialContact(lead)) {
    return { ok: false, skipped: 'contact_policy', error: 'Manual follow-up or updated contact details/texting permission are required before scheduling.' };
  }
  const startIso = safeTrim(consultation?.selected_slot_start || '');
  if (!startIso) return { ok: false, skipped: 'missing_slot' };
  if (!lead?.phone) return { ok: false, skipped: 'missing_phone' };
  try {
    const appointment = await commercialRpc('commercial_create_appointment', { p_request_id: consultation.request_id });
    return { ok: true, appointment };
  } catch (error: unknown) {
    return { ok: false, skipped: 'appointment_create_failed', error: error instanceof Error ? error.message : 'Appointment creation failed' };
  }
}

export async function loadConsultationContextByReference(referenceCode: string, technicianPhone?: string | null) {
  if (technicianPhone && !getTechnicianPhones().includes(normalizePhone(technicianPhone))) return null;
  const sb = getSupabase();
  let query = sb
    .from('commercial_consultation_requests')
    .select('*')
    .eq('reference_code', referenceCode)
    .order('created_at', { ascending: false })
    .limit(1);

  if (technicianPhone) {
    query = query.eq('assigned_technician_phone', technicianPhone);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(commercialDatabaseErrorMessage(error));
  }
  if (!data) return null;
  const lead = await getLeadById(data.lead_id);
  return { consultation: data, lead };
}

export function parseTechnicianReply(text: string) {
  const normalized = normalizeText(text, 200).toLowerCase();
  if (!normalized) return null;
  if (/\b(yes|y|approve|approved|accept|accepted)\b/.test(normalized)) return 'approve';
  if (/\b(no|n|decline|declined|reject|rejected)\b/.test(normalized)) return 'decline';
  return null;
}

export async function findConsultationForTechnicianReply(fromPhone: string, body: string) {
  if (!getTechnicianPhones().includes(normalizePhone(fromPhone))) return null;
  const refMatch = String(body || '').toUpperCase().match(/\bCOM-[A-Z0-9]{6,}\b/);
  if (refMatch) {
    return loadConsultationContextByReference(refMatch[0], fromPhone);
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from('commercial_consultation_requests')
    .select('*')
    .eq('assigned_technician_phone', fromPhone)
    .in('status', ['pending', 'escalated', 'reschedule_requested'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(commercialDatabaseErrorMessage(error));
  }
  if (!data) return null;
  const lead = await getLeadById(data.lead_id);
  return { consultation: data, lead };
}

export async function notifyManagementEscalation(consultation: any, lead: any) {
  const phones = getEscalationPhones();
  if (!phones.length) return [];
  const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(consultation.created_at).getTime()) / 60000));
  const body = isManualCommercialFollowUp(consultation, lead)
    ? buildManualFollowUpMessage(consultation, lead, getSlotLabel(consultation.selected_slot_start, consultation.selected_slot_end))
    : buildEscalationMessage({
    referenceCode: consultation.reference_code,
    companyName: lead?.company_name || lead?.full_name,
    ageMinutes,
  });
  const results = [];
  for (const phone of phones) results.push(await sendRecordedSms(consultation, `escalation:${phone}`, phone, body, lead?.company_name || lead?.full_name));
  return results;
}

export async function applyConsultationDecision(params: {
  request: Request;
  consultation: any;
  lead: any;
  action: 'approve' | 'decline';
  channel: 'sms' | 'web' | 'manual';
  note?: string;
}) {
  const sb = getSupabase();
  const consultation = params.consultation;
  const lead = params.lead;
  const action = params.action;
  if (isManualCommercialFollowUp(consultation, lead)) {
    return { ok: false, error: 'This request requires manual customer follow-up. It is not a confirmed consultation; review the requested contact method in Commercial Queue.' };
  }
  if (action === 'decline' && consultation.related_order_id) return { ok: false, error: 'An appointment exists. Staff must review cancellation separately.' };
  const contactError = validateCommercialContact(lead);
  if (contactError) return { ok: false, error: contactError.message };
  const nextStatus = action === 'approve' ? 'approved' : 'declined';

  if (!canTransitionConsultationStatus(consultation.status, nextStatus)) {
    return { ok: false, error: `Cannot transition ${consultation.status} to ${nextStatus}` };
  }

  const patch: any = {
    status: nextStatus,
    response_channel: consultation.status === nextStatus ? consultation.response_channel || params.channel : params.channel,
    response_note: consultation.status === nextStatus ? consultation.response_note || null : normalizeText(params.note || '', 500) || null,
    response_at: consultation.status === nextStatus ? consultation.response_at || new Date().toISOString() : new Date().toISOString(),
    updated_at: new Date().toISOString(),
    next_reminder_at: null,
  };

  const decisionUpdate = sb
    .from('commercial_consultation_requests')
    .update(patch)
    .eq('request_id', consultation.request_id)
    .eq('status', consultation.status)
    .eq('response_token', consultation.response_token);
  if (action === 'decline') decisionUpdate.is('related_order_id', null);
  const { data: updated, error } = await decisionUpdate
    .select('*')
    .maybeSingle();

  if (error || !updated) return { ok: false, error: error?.message || 'The request changed. Reload its current status before acting.' };

  const result: any = {
    ok: true,
    consultation: updated,
  };

  if (action === 'approve') {
    const appointment = await maybeCreateAppointment(params.request, updated, lead);
    result.appointment = appointment;
    if (!appointment.ok) {
      await commercialRpc('commercial_record_appointment_error', {
        p_request_id: updated.request_id, p_error: appointment.error || appointment.skipped,
      });
      result.consultation = (await getConsultationByToken(updated.response_token))?.consultation || updated;
      result.recoveryRequired = true;
      return result;
    }
    const slotLabel = getSlotLabel(updated.selected_slot_start, updated.selected_slot_end);
    const customerBody = buildCustomerConfirmedMessage({
      slotLabel,
      referenceCode: updated.reference_code,
    });
    const customerSms = await sendCommercialCustomerSms(lead, customerBody, updated, 'customer_confirmation');
    result.customerSms = customerSms;

    const confirmPatch: any = {
      updated_at: new Date().toISOString(),
    };
    if (customerSms.ok) {
      confirmPatch.customer_confirmation_sent_at = new Date().toISOString();
    }
    if (appointment.ok && appointment.appointment?.id) {
      confirmPatch.related_order_id = appointment.appointment.id;
    }
    if (Object.keys(confirmPatch).length > 1) {
      const { data: confirmed, error: confirmError } = await sb
        .from('commercial_consultation_requests')
        .update(confirmPatch)
        .eq('request_id', updated.request_id)
        .select('*')
        .single();
      if (confirmError) throw new Error(commercialDatabaseErrorMessage(confirmError));
      result.consultation = confirmed;
    }
  } else {
    result.customerSms = await sendCommercialCustomerSms(
      lead,
      `Home Too Smart is reviewing another consultation window for ${updated.reference_code}. No revised time is confirmed yet.`,
      updated, 'customer_decline'
    );
    result.managementSms = await notifyManagementEscalation(updated, lead);
    const { error: escalationError } = await sb
      .from('commercial_consultation_requests')
      .update({
        management_notified_at: result.managementSms.some((item: SmsResult) => item.ok) ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('request_id', updated.request_id);
    if (escalationError) throw new Error(commercialDatabaseErrorMessage(escalationError));
  }

  return result;
}

export async function handleTechnicianReply(request: Request, fromPhone: string, body: string) {
  const action = parseTechnicianReply(body);
  if (!action) return { handled: false as const };
  const context = await findConsultationForTechnicianReply(fromPhone, body);
  if (!context?.consultation || !context?.lead) {
    return {
      handled: true as const,
      ok: false,
      replyText: 'No pending commercial consultation was found for that reply. Include the reference code or use the approval link in the original text.',
    };
  }
  if (context.consultation.metadata?.last_reschedule_key) {
    return { handled: true as const, ok: false, replyText: 'This consultation window changed. Use the current approval link to review the new window; a delayed text reply cannot approve it.' };
  }

  const outcome = await applyConsultationDecision({
    request,
    consultation: context.consultation,
    lead: context.lead,
    action,
    channel: 'sms',
    note: normalizeText(body, 500),
  });

  if (!outcome.ok) {
    return {
      handled: true as const,
      ok: false,
      replyText: outcome.error || 'We could not record that response. Please use the approval link or reply again with the reference code.',
    };
  }

  const reference = context.consultation.reference_code;
  return {
    handled: true as const,
    ok: true,
    replyText: action === 'approve'
      ? `${reference} approval recorded. Check Commercial Queue for appointment and customer communication results; approval alone does not confirm an appointment.`
      : `${reference} declined. Management has been notified for follow-up.`,
    outcome,
  };
}

export async function sendTechnicianConsultationRequest(consultation: any, lead: any, purpose = 'dispatch') {
  const baseUrl = getPublicBaseUrl();
  const technicianPhones = getTechnicianPhones();
  const manualFollowUp = isManualCommercialFollowUp(consultation, lead);
  const links = manualFollowUp ? null : buildApprovalLinks(baseUrl, consultation.response_token);
  const body = manualFollowUp
    ? buildManualFollowUpMessage(consultation, lead, getSlotLabel(consultation.selected_slot_start, consultation.selected_slot_end))
    : buildTechnicianRequestMessage({
    referenceCode: consultation.reference_code,
    customerName: lead.full_name,
    companyName: lead.company_name,
    slotLabel: getSlotLabel(consultation.selected_slot_start, consultation.selected_slot_end),
    baseUrl,
    responseToken: consultation.response_token,
    serviceNeeds: Array.isArray(lead.service_needs) ? lead.service_needs : [],
  }) + (consultation.metadata?.last_reschedule_key
    ? ' The window changed; use the current approval link. Text replies cannot approve a rescheduled window.'
    : ' Reply YES or NO to this text.');

  const results = [];
  for (const phone of technicianPhones) {
    results.push(await sendRecordedSms(consultation, `${purpose}:${consultation.selected_slot_start || 'manual'}:${consultation.metadata?.last_reschedule_key || 'initial'}:${phone}`, phone, body, lead.company_name || lead.full_name));
  }
  return { body, links, results, technicianPhones };
}

export async function sendCustomerPendingAcknowledgement(consultation: any, lead: any) {
  const body = buildCustomerPendingMessage({ referenceCode: consultation.reference_code });
  return sendCommercialCustomerSms(lead, body, consultation, `customer_acknowledgement:${consultation.metadata?.last_reschedule_key || 'initial'}`);
}

async function sendCommercialCustomerSms(lead: any, body: string, consultation: any, kind: string) {
  if ((lead?.contact_preference || 'sms') !== 'sms' || !hasCommercialSmsConsent(lead)) {
    return { ok: false, to: lead?.phone || '', skipped: true, reason: 'Customer texts are disabled for this contact preference or texting choice.' };
  }
  const contactError = validateCommercialContact(lead);
  if (contactError) return { ok: false, to: lead?.phone || '', error: contactError.message };
  if (kind === 'customer_confirmation' && consultation.customer_confirmation_sent_at) {
    return { ok: true, skipped: true, accepted: true, to: lead.phone, reason: 'Previously accepted; delivery and customer acknowledgement are not implied.' };
  }
  return sendRecordedSms(consultation, kind, lead.phone, body, lead.full_name || lead.company_name || null);
}