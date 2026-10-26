import { createHash } from 'node:crypto';
import {
  getConsultationByToken,
  getPublicBaseUrl, sendRecordedSms, sendCommercialCustomerSms,
} from '@/lib/commercial_consultation_runtime';
import { BusinessError, readJson, checked, text } from '@/lib/commercial_business';
import { getSupabase } from '@/lib/supabase';

const utils = require('@/lib/commercial_consultation.js');
type Availability = { date: string; period: 'morning' | 'afternoon' | 'evening' | 'flexible' };
type InquiryLead = {
  full_name: string | null; phone: string | null; project_city: string | null; service_needs: string[];
  assessment_answers?: {availabilityPreferences?: Availability[]}; contact_preference: string;
};
type InquiryRequest = {request_id: string; reference_code: string; response_token: string; assigned_technician_phone: string | null; status: string};
const periods = new Set(['morning','afternoon','evening','flexible']);
const services = new Set(['TV Mounting','Security Cameras']);
const tokenPattern = /^[A-Za-z0-9_-]{20,120}$/;
export const marketOf = (lead: { attribution?: { market?: string } } | null) => lead?.attribution?.market || 'commercial';
const customerMayText = (lead: {contact_preference?: string}) => lead.contact_preference==='sms' && utils.hasCommercialSmsConsent(lead);

export function residentialRouting() {
  const enabled = process.env.RESIDENTIAL_SMS_ENABLED === 'true';
  const raw = String(process.env.RESIDENTIAL_REVIEWER_PHONE || '').trim();
  const phone: string | null = raw ? utils.normalizePhone(raw) : null;
  if ((raw && (!/^[+\d\s().-]+$/.test(raw) || !phone)) || enabled && !phone) {
    throw new BusinessError('Configure a valid RESIDENTIAL_REVIEWER_PHONE before enabling residential SMS.',503);
  }
  return { enabled, phone };
}
export async function residentialSetup() {
  const routing=residentialRouting();
  getPublicBaseUrl();
  const ready=await getSupabase().rpc('h2s_residential_intake_ready',{});
  if(ready.error || ready.data!=='037') {
    console.error('Homeowner schema readiness failed',{code:ready.error?.code || 'unexpected_version'});
    throw new BusinessError('Reviewed homeowner database setup 037 is required before taking inquiries.',503);
  }
  return routing;
}
function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new BusinessError(`Review ${label}.`);
  }
  const result = value.trim();
  if (!result) throw new BusinessError(`${label} is required.`);
  return result;
}
export function normalizeResidential(body: Record<string, unknown>, now = new Date()) {
  const fullName = requiredText(body.fullName,'Name',120);
  const city = requiredText(body.city,'City',120);
  const phone = requiredText(body.phone,'Phone number',40);
  if (!/^[+\d\s().-]+$/.test(phone) || !utils.normalizePhone(phone)) throw new BusinessError('Enter a valid phone number.');
  if (!Array.isArray(body.serviceNeeds) || !body.serviceNeeds.length || body.serviceNeeds.length>2
    || new Set(body.serviceNeeds).size!==body.serviceNeeds.length || body.serviceNeeds.some(value=>!services.has(value))) {
    throw new BusinessError('Choose TV mounting, security cameras, or both.');
  }
  if (typeof body.smsOptIn !== 'boolean') throw new BusinessError('Choose whether to allow project texts.');
  const preferences = body.availabilityPreferences ?? [];
  if (!Array.isArray(preferences) || preferences.length>3) throw new BusinessError('Choose up to three preferred days.');
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const availability: Availability[] = [];
  for (const entry of preferences) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new BusinessError('Review preferred availability.');
    const row = entry as Record<string, unknown>;
    if (typeof row.date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(row.date)
      || !Number.isFinite(Date.parse(row.date+'T12:00:00Z'))
      || new Date(row.date+'T12:00:00Z').toISOString().slice(0,10)!==row.date || row.date<today
      || typeof row.period !== 'string' || !periods.has(row.period)) throw new BusinessError('Choose a valid future day and broad availability window.');
    if (availability.some(value=>value.date===row.date)) throw new BusinessError('Choose each preferred day once.');
    availability.push({date:row.date,period:row.period as Availability['period']});
  }
  const normalized = {
    fullName, phone:utils.normalizePhone(phone), city,
    serviceNeeds:body.serviceNeeds as string[], smsOptIn:body.smsOptIn,
    notes:text(body.notes ?? '',1000,false), availabilityPreferences:availability,
  };
  return normalized;
}
export function availabilityLabel(lead: { assessment_answers?: { availabilityPreferences?: Availability[] } }) {
  return (lead.assessment_answers?.availabilityPreferences || []).map(value=>`${value.date} (${value.period})`).join(', ') || 'Discuss availability by phone';
}
async function notifyInitial(request: InquiryRequest, lead: InquiryLead) {
  const routing = residentialRouting();
  if (!routing.enabled || request.status!=='pending') return { enabled:routing.enabled, staff:null, customer:null };
  if (!routing.phone || !request.assigned_technician_phone || request.assigned_technician_phone!==routing.phone) {
    throw new BusinessError('Residential reviewer changed. Staff must review routing before any send.',409);
  }
  const link = `${getPublicBaseUrl()}/residential-review?token=${encodeURIComponent(request.response_token)}`;
  const staff = await sendRecordedSms(request,`owner_inquiry:${routing.phone}`,routing.phone,
    `Home2Smart | ${request.reference_code}\nHomeowner: ${lead.full_name}\nServices: ${lead.service_needs.join(', ')}\nCity: ${lead.project_city}\nPreferences (not booked): ${availabilityLabel(lead)}\nReview and accept follow-up:\n${link}`);
  const customer = customerMayText(lead) ? await sendCommercialCustomerSms(lead,
    `Home2Smart received your ${lead.service_needs.join(' / ')} request (${request.reference_code}). We will review your preferred days and contact you to agree on the work and timing. No installation is booked.`,
    request,'customer_inquiry_ack') : null;
  return { enabled:true, staff, customer };
}
export async function submitResidential(request: Request) {
  if (process.env.RESIDENTIAL_INTAKE_ENABLED!=='true') throw new BusinessError('Homeowner intake is not enabled yet. No request was submitted.',503);
  const body = await readJson(request,8192);
  const input = normalizeResidential(body);
  for (const key of ['publicToken','submissionKey']) {
    if (typeof body[key]!=='string' || !tokenPattern.test(body[key])) throw new BusinessError('Reload the homeowner form before submitting.');
  }
  const publicToken = body.publicToken as string, submissionKey = body.submissionKey as string;
  const routing = await residentialSetup();
  const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  if (routing.phone===input.phone) throw new BusinessError('Customer and residential reviewer must be different phone numbers.');
  const consent = { smsOptIn:input.smsOptIn, smsOptInSource:'residential-inquiry-form',
    smsOptInText:'I agree to project texts from Home2Smart, including automated updates. Consent is not a condition of purchase. Message and data rates may apply. Reply STOP to opt out.',
    ...(input.smsOptIn ? {smsOptInAt:new Date().toISOString()} : {}) };
  const normalized = utils.normalizeCommercialLeadInput({...input, projectCity:input.city,
    contactPreference:input.smsOptIn?'sms':'call', attribution:{market:'residential',communicationConsent:consent},
    assessmentAnswers:{availabilityPreferences:input.availabilityPreferences}});
  const submitted = checked(await getSupabase().rpc('h2s_submit_residential_inquiry',{
    p_token:publicToken,p_key:submissionKey,
    p_lead_patch:{
      public_token:publicToken,full_name:input.fullName,company_name:null,email:null,
      phone:input.phone,contact_preference:normalized.contactPreference,business_type:null,
      project_city:input.city,project_state:null,project_address:null,project_postal_code:null,
      service_needs:input.serviceNeeds,scope_summary:input.notes || null,notes:input.notes || null,
      site_count:1,project_photo_urls:[],assessment_answers:{availabilityPreferences:input.availabilityPreferences},
      attribution:{...normalized.attribution,market:'residential',communicationConsent:consent},
      completeness_score:0,completeness_bucket:'contact_only',priority_tier:'normal',
      created_at:new Date().toISOString(),updated_at:new Date().toISOString(),last_submitted_at:new Date().toISOString(),
    },
    p_request_patch:{
      reference_code:'HOME-'+utils.generateResponseToken().slice(0,8).toUpperCase(),
      response_token:utils.generateResponseToken(),status:'pending',preferred_slots:[],
      selected_slot_start:null,selected_slot_end:null,next_reminder_at:null,
      assigned_technician_phone:routing.phone,assigned_technician_name:null,
      metadata:{request_kind:'residential_inquiry',market:'residential',submission_fingerprint:fingerprint},
    },
  }));
  return { request:submitted.request,replayed:submitted.replayed,notifications:await notifyInitial(submitted.request,submitted.lead) };
}
export async function residentialContext(token: string) {
  if (!tokenPattern.test(token)) throw new BusinessError('Homeowner request not found.',404);
  const context = await getConsultationByToken(token);
  if (!context?.lead || marketOf(context.lead)!=='residential' || context.consultation.metadata?.request_kind!=='residential_inquiry') {
    throw new BusinessError('Homeowner request not found.',404);
  }
  return context;
}
export async function reviewResidential(request: Request) {
  const body = await readJson(request,4096);
  const token = requiredText(body.token,'Review link',120), action = body.action;
  if (!['approve','decline'].includes(String(action))) throw new BusinessError('Choose Accept follow-up or Needs another reviewer.');
  const context = await residentialContext(token), routing = residentialRouting();
  if (!routing.phone || context.consultation.assigned_technician_phone!==routing.phone
    || routing.phone===context.lead.phone) throw new BusinessError('Residential reviewer configuration needs staff review.',503);
  const result = checked(await getSupabase().rpc('h2s_review_residential_inquiry',{
    p_token:token,p_action:action,p_note:text(body.note ?? '',500,false),p_reviewer_phone:routing.phone,
  }));
  const customer = action==='approve' && routing.enabled && customerMayText(context.lead)
    ? await sendCommercialCustomerSms(context.lead,
      `Home2Smart accepted your request for follow-up (${context.consultation.reference_code}). We will contact you to discuss the work and agree on a time. Your preferred days are not a confirmed installation booking.`,
      result.request,'customer_inquiry_acceptance') : null;
  return { ...result, customer, bookingConfirmed:false };
}
