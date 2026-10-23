import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getSupabase } from '@/lib/supabase';
import { getDashboardAuthUserFromSession, getDashboardDb } from '@/lib/dashboardAuth';
import { corsHeaders } from '@/lib/adminAuth';
import { commercialCommunicationSummary } from '@/lib/commercial_communications';
import { followUpView, prepareFollowUp, FollowUpInputError } from '@/lib/commercial_follow_up';
import { canTransitionTo } from '@/lib/jobHelpers';
import { verifyCommercialPayment } from '@/lib/commercial_payment';
import { getTechnicianPhones, getEscalationPhones, CommercialConfigurationError } from '@/lib/commercial_consultation_runtime';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const schemaErrors = ['42P01','42703','42883','PGRST202','PGRST204','PGRST205'];
const orderColumns = 'id,order_id,total,currency,status,session_id,payment_intent_id,commercial_request_id,metadata_json,customer_name,customer_email,address,city,state,zip,delivery_date,delivery_time,updated_at';
class OperationError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'INVALID_OPERATION') { super(message); }
}
function checked<T>(result: { data: T; error: { message: string; code?: string } | null }, context: string): T {
  if (result.error) {
    const code = result.error.code;
    if (schemaErrors.includes(code || '')) {
      throw new OperationError('Commercial operations setup is unavailable. Existing records are retained.', 503, 'SCHEMA_UNAVAILABLE');
    }
    if (['42501','PGRST301','PGRST302'].includes(code || '')) {
      console.error('Commercial operations storage authorization unavailable', { context, code });
      throw new OperationError('Operational access unavailable. Administrator review required.', 403, 'PERMISSION_UNAVAILABLE');
    }
    if (code === '40001' || code === '23505') throw new OperationError('This record changed or is already linked. Reload before saving; your draft is retained.', 409);
    if (code === '22023') throw new OperationError(result.error.message);
    console.error('Commercial operations storage error', { context, code });
    throw new OperationError('Operational records are temporarily unavailable.', 503, 'TRANSIENT_READ');
  }
  return result.data;
}
function text(value: unknown, max: number, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    throw new OperationError('Invalid operation input.');
  }
  const clean = value.trim();
  if (required && !clean) throw new OperationError('Required information is missing.');
  return clean;
}
function present<T>(value: T | null, context: string): T {
  if (value === null) throw new OperationError(`${context}: invalid empty dataset.`, 500);
  return value;
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}
function timestamp(value: unknown) {
  const clean = text(value, 50, true);
  if (!/^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/.test(clean) || !Number.isFinite(Date.parse(clean))) {
    throw new OperationError('Use a valid date and time.');
  }
  return clean;
}
async function staff() {
  return present(checked(await getDashboardDb().from('Dashboard_Users')
    .select('User_ID,Display_Name,Username,Role').eq('Is_Disabled', false).in('Role', ['ADMIN','VA'])
    .order('Display_Name').limit(500), 'Unable to load responsible staff'), 'Unable to load responsible staff');
}
async function leadRecord(leadId: string) {
  const row = checked(await getSupabase().from('commercial_leads')
    .select('lead_id,email,phone,contact_preference,project_address,project_city,project_state,project_postal_code,updated_at')
    .eq('lead_id', leadId).maybeSingle(), 'Unable to load lead');
  if (!row) throw new OperationError('Lead not found.', 404);
  return row;
}
async function installers() {
  const rows = present(checked(await getSupabase().from('h2s_pros').select('*').eq('is_active', true).limit(500),
    'Unable to load installer directory'), 'Unable to load installer directory');
  return rows.map(row => ({ id: String(row.pro_id), name: String(row.name || row.full_name
    || [row.first_name,row.last_name].filter(Boolean).join(' ') || row.email || 'Name unavailable') }));
}
async function snapshot(leadId: string) {
  const db = getSupabase();
  const lead = await leadRecord(leadId);
  const state = checked(await db.from('commercial_lead_operations').select('*').eq('lead_id', leadId).maybeSingle(), 'Unable to load operations')
    || { lead_id: leadId, revision: 0, disposition: 'open' };
  const history = present(checked(await db.from('commercial_lead_activity').select('operation_id,revision,actor_name,action,payload,created_at')
    .eq('lead_id', leadId).order('revision', { ascending: false }).limit(51), 'Unable to load activity'), 'Unable to load activity');
  const consultation = checked(await db.from('commercial_consultation_requests')
    .select('request_id,status,selected_slot_start,next_reminder_at,reminder_count,related_order_id,metadata,response_at')
    .eq('lead_id', leadId).order('created_at', { ascending: false }).limit(1).maybeSingle(), 'Unable to load technician routing');
  const requests = checked(await db.from('commercial_consultation_requests').select('request_id')
    .eq('lead_id', leadId).order('created_at', { ascending: false }).limit(10), 'Unable to load communication history');
  const effects = await db.from('commercial_effects').select('kind,state,details,updated_at')
    .in('request_id', (requests || []).map(row => row.request_id)).order('updated_at', { ascending: false }).limit(100);
  const sids = Array.from(new Set((effects.data || []).map(row => row.details?.sid).filter((sid): sid is string => typeof sid === 'string')));
  const receipts = sids.length ? await db.from('sms_messages').select('twilio_sid,status,created_at').in('twilio_sid', sids).limit(100)
    : { data: [], error: null };
  const delivery = sids.length ? await db.from('sms_delivery_receipts').select('*').in('message_sid', sids).limit(100)
    : { data: [], error: null };
  if (effects.error || receipts.error || delivery.error) console.error('Commercial communication evidence unavailable', {
    code: effects.error?.code || receipts.error?.code || delivery.error?.code || 'MISSING_EVIDENCE',
  });
  let technicianRouting: { available: boolean; recipients: string[] } = { available: true, recipients: [] };
  try { technicianRouting.recipients = getTechnicianPhones(); }
  catch (error) {
    if (!(error instanceof CommercialConfigurationError)) throw error;
    console.error('Commercial technician notification routing unavailable: configuration needs review');
    technicianRouting = { available: false, recipients: [] };
  }
  const communications = { available: !effects.error, receiptLookupAvailable: !receipts.error && !delivery.error,
    events: commercialCommunicationSummary(effects.data || [], receipts.data || [], delivery.data || []),
    limited: (requests || []).length === 10 || (effects.data || []).length === 100,
    technicianRouting, escalationRecipients: getEscalationPhones() };
  let installation = null;
  if (state.order_id && state.installation_job_id) {
    const order = checked(await db.from('h2s_orders').select(orderColumns).eq('id', state.order_id).maybeSingle(), 'Unable to load linked order');
    const job = checked(await db.from('h2s_dispatch_jobs').select('job_id,order_id,status,due_at,updated_at')
      .eq('job_id', state.installation_job_id).maybeSingle(), 'Unable to load linked installation');
    if (!order || !job || !job.order_id || ![order.id, order.order_id].includes(job.order_id)
      || !Number.isFinite(Number(order.total)) || Number(order.total) <= 0
      || order.commercial_request_id || order.order_id?.startsWith('APPT-COM-')
      || order.metadata_json?.commercial_consultation_request_id) {
      throw new OperationError('The saved installation relationship needs reconciliation.', 409);
    }
    const artifacts = checked(await db.from('h2s_job_artifacts').select('artifact_id,artifact_type,url,caption,created_at')
      .eq('job_id', job.job_id).order('created_at', { ascending: false }).limit(50), 'Unable to load installation proof');
    let payment;
    try {
      const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;
      payment = await verifyCommercialPayment(order, stripe);
    } catch (error) {
      console.error('Commercial Stripe verification failed:', error instanceof Error ? error.name : 'Unknown Stripe error');
      payment = { status: 'unavailable', detail: 'Stripe verification unavailable; no payment status was changed.' };
    }
    const assignments = checked(await db.from('h2s_dispatch_job_assignments').select('pro_id,state')
      .eq('job_id', job.job_id).in('state', ['accepted','assigned','scheduled','in_progress']).limit(100), 'Unable to load installation assignment');
    installation = { order, job, artifacts, payment, assignments };
  }
  return { lead, state, staff: await staff(), history: history.slice(0, 50), hasOlderActivity: history.length > 50,
    installation, installers: installation ? await installers() : [], communications, followUp: await followUpView(leadId), routing: {
      nextReminderAt: consultation?.next_reminder_at || null, reminderCount: consultation?.reminder_count || 0,
      consultationStatus: consultation?.status || null, responseAt: consultation?.response_at || null,
      consultationOrderId: consultation?.related_order_id || null } };
}
async function handle(request: Request, write: boolean) {
  const headers = corsHeaders(request);
  try {
    const actor = await getDashboardAuthUserFromSession(request);
    if (!actor) throw new OperationError('Authentication required.', 401);
    if (actor.role !== 'ADMIN') throw new OperationError('Administrator access required.', 403);
    const url = new URL(request.url);
    const body = write ? await request.json().catch(() => { throw new OperationError('Invalid JSON request.'); }) : null;
    const leadId = write ? body?.leadId : url.searchParams.get('leadId');
    if (typeof leadId !== 'string' || !uuid.test(leadId)) throw new OperationError('Valid lead required.');
    const db = getSupabase();
    if (!write) {
      const ref = url.searchParams.get('orderRef');
      if (ref !== null) {
        await leadRecord(leadId);
        const order = checked(await db.from('h2s_orders').select(orderColumns).eq('order_id', text(ref, 150, true)).maybeSingle(), 'Unable to find order');
        if (!order || !Number.isFinite(Number(order.total)) || Number(order.total) <= 0 || order.commercial_request_id || order.order_id?.startsWith('APPT-COM-')
          || order.metadata_json?.commercial_consultation_request_id) throw new OperationError('Choose a priced installation order, not a consultation.');
        const jobs = checked(await db.from('h2s_dispatch_jobs').select('job_id,order_id,status,due_at,updated_at')
          .in('order_id', [order.id, order.order_id]).limit(100), 'Unable to find installation jobs');
        return NextResponse.json({ ok: true, order, jobs }, { headers });
      }
      return NextResponse.json({ ok: true, ...await snapshot(leadId) }, { headers });
    }
    if (!Number.isSafeInteger(body.revision) || body.revision < 0 || typeof body.operationId !== 'string' || !uuid.test(body.operationId)) {
      throw new OperationError('Revision and operation key required.');
    }
    const input = body.payload;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new OperationError('Operation details required.');
    const prior = checked(await db.from('commercial_lead_activity').select('actor_id,action,payload')
      .eq('operation_id', body.operationId).maybeSingle(), 'Unable to check duplicate operation');
    const payload: Record<string, unknown> = { input };
    if (prior) {
      if (prior.actor_id !== actor.userId || prior.action !== body.action || canonical(prior.payload.input) !== canonical(input)) {
        throw new OperationError('Operation key reused for different content.', 409);
      }
      Object.assign(payload, prior.payload);
    } else if (body.action === 'follow_up') {
      const people = await staff();
      const responsible = input.responsibleId ? people.find(person => person.User_ID === input.responsibleId) : null;
      if (input.responsibleId && !responsible) throw new OperationError('Choose an active staff member.');
      payload.responsibleId = responsible?.User_ID || '';
      payload.responsibleName = responsible ? responsible.Display_Name || responsible.Username : '';
      payload.nextFollowUpAt = input.nextFollowUpAt ? timestamp(input.nextFollowUpAt) : '';
      if (!['open','closed'].includes(input.disposition)) throw new OperationError('Choose open or closed.');
      payload.disposition = input.disposition;
      payload.reason = text(input.reason, 1000, input.disposition === 'closed');
      if (input.contact) {
        if (!['call','email','sms','other'].includes(input.contact.channel)
          || !['no_response','reached','left_message','requested_callback','other'].includes(input.contact.outcome)) {
          throw new OperationError('Choose the contact channel and outcome.');
        }
        payload.contact = { channel: input.contact.channel, outcome: input.contact.outcome, note: text(input.contact.note, 4000, true) };
      }
      try { await prepareFollowUp(leadId, body.operationId, payload, input.followUpMode); }
      catch (error) {
        if (!(error instanceof FollowUpInputError)) throw error;
        throw new OperationError(error.message);
      }
    } else if (body.action === 'location') {
      for (const key of ['address','city','state','postalCode']) payload[key] = text(input[key], key === 'address' ? 300 : 100);
      payload.expectedUpdatedAt = timestamp(input.expectedUpdatedAt);
    } else if (body.action === 'link') {
      if (!uuid.test(input.orderId) || !uuid.test(input.jobId)) throw new OperationError('Choose an existing order and installation job.');
      payload.orderId = input.orderId;
      payload.jobId = input.jobId;
    } else if (['schedule','assign','start','complete'].includes(body.action)) {
      payload.expectedJobUpdatedAt = timestamp(input.expectedJobUpdatedAt);
      payload.expectedOrderUpdatedAt = timestamp(input.expectedOrderUpdatedAt);
      if (body.action === 'schedule') {
        payload.start = timestamp(input.start);
        payload.end = timestamp(input.end);
        const timezone = text(input.timezone, 100, true);
        let date, window;
        try {
          const start = new Date(String(payload.start)), end = new Date(String(payload.end));
          const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(start);
          const part = (type: string) => parts.find(value => value.type === type)?.value;
          date = `${part('year')}-${part('month')}-${part('day')}`;
          const format = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
          window = `${format.format(start)} - ${format.format(end)}`;
        } catch { throw new OperationError('Choose a valid time zone.'); }
        Object.assign(payload, { timezone, date, window });
      } else if (body.action === 'assign') {
        const people = await installers();
        const pro = people.find(person => person.id === input.proId);
        if (!pro || pro.name === 'Name unavailable') throw new OperationError('Choose a named, active installer from the existing directory.');
        payload.proId = pro.id;
        payload.proName = pro.name;
        payload.note = text(input.note, 4000, true);
      } else {
        payload.note = text(input.note, 4000, true);
        // The assignment is authoritative; notification recipients never supply a technician identity.
        const state = checked(await db.from('commercial_lead_operations').select('installation_job_id')
          .eq('lead_id', leadId).maybeSingle(), 'Unable to load installation');
        const assignments = present(checked(await db.from('h2s_dispatch_job_assignments').select('pro_id')
          .eq('job_id', state?.installation_job_id || '').in('state', ['accepted','assigned','scheduled','in_progress']).limit(100), 'Unable to load installation assignment'), 'Unable to load installation assignment');
        const pros = Array.from(new Set(assignments.map(row => String(row.pro_id))));
        if (pros.length !== 1) throw new OperationError('One unambiguous recorded installation assignee is required.');
        payload.proId = pros[0];
        const job = state?.installation_job_id ? checked(await db.from('h2s_dispatch_jobs').select('status,order_id')
          .eq('job_id', state.installation_job_id).maybeSingle(), 'Unable to validate installation') : null;
        const operation = checked(await db.from('commercial_lead_operations').select('order_id')
          .eq('lead_id', leadId).maybeSingle(), 'Unable to validate linked order');
        const order = operation?.order_id ? checked(await db.from('h2s_orders').select('metadata_json')
          .eq('id', operation.order_id).maybeSingle(), 'Unable to validate work requirements') : null;
        if (!job || !order) throw new OperationError('Link an existing installation first.');
        const transition = canTransitionTo({
          status: job.status === 'assigned' ? 'accepted' : job.status,
          assigned_pro_id: pros[0], metadata: order.metadata_json || {},
        }, body.action === 'start' ? 'in_progress' : 'completed');
        if (!('ok' in transition) || transition.ok !== true) throw new OperationError(
          'error' in transition && typeof transition.error === 'string' ? transition.error : 'Installation transition is not allowed.');
      }
    } else throw new OperationError('Unknown commercial operation.');
    checked(await db.rpc(body.action === 'follow_up' ? 'commercial_record_follow_up' : 'commercial_record_operation', {
      p_lead_id: leadId, p_revision: body.revision, p_operation_id: body.operationId,
      p_actor: { id: actor.userId, name: actor.displayName || actor.username },
      ...(body.action === 'follow_up' ? {} : { p_action: body.action }), p_payload: payload,
    }), 'Unable to save commercial operation');
    return NextResponse.json({ ok: true, ...await snapshot(leadId) }, { headers });
  } catch (error) {
    if (!(error instanceof OperationError)) console.error('Commercial operations failed:', error);
    return NextResponse.json({ ok: false, code: error instanceof OperationError ? error.code : 'TRANSIENT_READ',
      error: error instanceof OperationError ? error.message : 'Commercial operations could not be loaded or saved. Your draft is retained.' },
      { status: error instanceof OperationError ? error.status : 500, headers });
  }
}
export function GET(request: Request) { return handle(request, false); }
export function POST(request: Request) { return handle(request, true); }
export function OPTIONS(request: Request) { return new NextResponse(null, { status: 204, headers: corsHeaders(request) }); }
