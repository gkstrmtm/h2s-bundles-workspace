import { getSupabase } from '@/lib/supabase';
import { BusinessError, checked } from '@/lib/commercial_business';
import { residentialContext, residentialRouting } from '@/lib/residential_inquiry';
import { getPublicBaseUrl, sendSmsAndPersist } from '@/lib/commercial_consultation_runtime';

const utils = require('@/lib/commercial_consultation.js');
type Notice = { notice_id: string; lead_id: string; request_id: string; kind: string; version: number; due_at: string; state: string };
type NoticeContext = {
  action: string; notice: Notice;
  lead: { full_name: string; company_name: string; phone: string; project_city: string; service_needs: string[]; contact_preference: string; attribution: unknown };
  request: { response_token: string };
  callback: { next_follow_up_at: string };
  booking: { starts_at: string; ends_at: string; timezone: string } | null;
};
export async function residentialWorkspaceSetup() {
  if (process.env.RESIDENTIAL_WORKSPACE_ENABLED !== 'true') throw new BusinessError('Homeowner scheduling workspace is not enabled yet.', 503);
  const result = await getSupabase().rpc('h2s_residential_workspace_ready', {});
  if (result.error || result.data !== '038') {
    console.error('Residential workspace readiness failed', { code: result.error?.code || 'unexpected_version' });
    throw new BusinessError('Reviewed homeowner workspace migration 038 is required before scheduling.', 503);
  }
}
export async function readResidentialWorkspace(token: string) {
  const { lead, consultation } = await residentialContext(token), db = getSupabase();
  const operation = checked(await db.from('commercial_lead_operations')
    .select('residential_callback_revision,residential_callback_status,next_follow_up_at,disposition_reason')
    .eq('lead_id', lead.lead_id).maybeSingle());
  const booking = checked(await db.from('commercial_reservations').select('*').eq('lead_id', lead.lead_id).maybeSingle());
  const notices = checked(await db.from('residential_notices').select('kind,state,version,due_at,details')
    .eq('request_id', consultation.request_id).order('created_at', { ascending: false }).limit(30));
  return {
    leadId: lead.lead_id, reference: consultation.reference_code, reviewStatus: consultation.status,
    callback: { revision: operation?.residential_callback_revision || 0, status: operation?.residential_callback_status || 'none',
      dueAt: operation?.next_follow_up_at || null, note: operation?.disposition_reason || null },
    booking, notices,
  };
}
const gsmBasic = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà');
const gsmExtended = new Set('^{}\\[~]|€\f');
export function smsSegments(body: string) {
  let units = 0;
  for (const char of body) {
    if (gsmBasic.has(char)) units++;
    else if (gsmExtended.has(char)) units += 2;
    else return { encoding: 'UCS-2', segments: Math.ceil(body.length / (body.length <= 70 ? 70 : 67)) };
  }
  return { encoding: 'GSM-7', segments: Math.ceil(units / (units <= 160 ? 160 : 153)) };
}
function clock(instant: string, zone: string) {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(instant)).replace(/[\u00a0\u202f]/g, ' ');
}
const short = (value: string | null | undefined, max: number) => (value || '').replace(/\s+/g, ' ').trim().slice(0, max);
export function residentialNoticeMessage(context: NoticeContext) {
  const { notice, lead, booking, callback } = context;
  const person = short(lead.full_name || lead.company_name, 45);
  const business = lead.company_name && lead.company_name !== lead.full_name ? ` / ${short(lead.company_name, 35)}` : '';
  const job = short(lead.service_needs.join(' / '), 45), city = short(lead.project_city, 30);
  const link = `${getPublicBaseUrl()}/residential-review?token=${encodeURIComponent(context.request.response_token)}`;
  if (notice.kind === 'owner_callback') {
    return `Home2Smart: Callback ${clock(callback.next_follow_up_at, 'America/New_York')}. ${person}${business} | ${job} | ${city}. ${link}`;
  }
  if (!booking) throw new BusinessError('Installation reminder has no reservation. Review before sending.', 409);
  const window = `${clock(booking.starts_at, booking.timezone)} - ${clock(booking.ends_at, booking.timezone)}`;
  if (notice.kind === 'owner_installation') return `Home2Smart: Installation ${window}. ${person}${business} | ${job} | ${city}. ${link}`;
  if (notice.kind === 'customer_confirmation') return `Home2Smart: Your agreed ${job} installation window is ${window}. This replaces any earlier window. Contact us if plans change.`;
  if (notice.kind === 'customer_installation') return `Home2Smart reminder: Your ${job} installation window is ${window}. Contact us if plans change.`;
  if (notice.kind === 'customer_cancellation') return `Home2Smart: Your ${job} installation window ${window} has been cancelled. No replacement time is booked; contact us to agree on a new time.`;
  throw new BusinessError('Unknown residential notice kind. Review before sending.', 503);
}
export async function processResidentialNotices(options: { leadId?: string; now?: Date } = {}) {
  if (process.env.RESIDENTIAL_WORKSPACE_ENABLED !== 'true') return { enabled: false, needsReview: false, processed: [] };
  if (options.leadId) {
    const lead = checked(await getSupabase().from('commercial_leads').select('attribution').eq('lead_id', options.leadId).maybeSingle());
    if (lead?.attribution?.market !== 'residential') return { enabled: false, needsReview: false, processed: [] };
  }
  const routing = await residentialRouting();
  if (!routing.enabled) return { enabled: false, needsReview: false, processed: [] };
  await residentialWorkspaceSetup();
  getPublicBaseUrl();
  const db = getSupabase(), now = options.now || new Date();
  let query = db.from('residential_notices').select('notice_id,lead_id,request_id,kind,version,due_at,state')
    .eq('state', 'pending').lte('due_at', now.toISOString()).order('due_at', { ascending: true }).limit(100);
  if (options.leadId) query = query.eq('lead_id', options.leadId);
  const rows = checked(await query);
  if (!Array.isArray(rows)) throw new BusinessError('Residential notices returned an invalid result. Review before sending.', 503);
  const due: Notice[] = rows;
  // Confirmations precede same-window customer reminders, including bookings
  // made less than an hour before their agreed start.
  due.sort((a, b) => Number(b.kind === 'customer_confirmation') - Number(a.kind === 'customer_confirmation')
    || Date.parse(a.due_at) - Date.parse(b.due_at));
  const processed: { noticeId: string; kind: string; action: string; needsReview?: boolean; error?: string }[] = [];
  for (const notice of due) {
    try {
      const context: NoticeContext = checked(await db.rpc('h2s_claim_residential_notice', {
        p_notice_id: notice.notice_id, p_now: now.toISOString(), p_owner_phone: routing.phone,
      }));
      if (context.action !== 'send') {
        processed.push({ noticeId: notice.notice_id, kind: notice.kind, action: context.action,
          needsReview: ['routing_review_required', 'reconciliation_required'].includes(context.action) });
        continue;
      }
      const customer = notice.kind.startsWith('customer_');
      const to = customer ? utils.normalizePhone(context.lead.phone) : routing.phone;
      if (!to || customer && (context.lead.contact_preference !== 'sms' || !utils.hasCommercialSmsConsent(context.lead))) {
        checked(await db.rpc('h2s_finish_residential_notice', { p_notice_id: notice.notice_id,
          p_result: { ok: false, retrySafe: true, error: 'Recipient or consent changed; no message sent.' } }));
        processed.push({ noticeId: notice.notice_id, kind: notice.kind, action: 'contact_review_required', needsReview: true });
        continue;
      }
      const body = residentialNoticeMessage(context);
      const result = await sendSmsAndPersist(to, body, context.lead.full_name);
      checked(await db.rpc('h2s_finish_residential_notice', { p_notice_id: notice.notice_id,
        p_result: { ...result, ...smsSegments(body) } }));
      processed.push({ noticeId: notice.notice_id, kind: notice.kind, action: result.ok ? 'provider_accepted' : 'delivery_review_required',
        needsReview: !result.ok || !!result.persistenceError });
    } catch (error) {
      console.error('Residential notice requires reconciliation', { noticeId: notice.notice_id, error });
      processed.push({ noticeId: notice.notice_id, kind: notice.kind, action: 'reconciliation_required', needsReview: true,
        error: error instanceof Error ? error.message : 'Notification state could not be verified.' });
    }
  }
  return { enabled: true, needsReview: processed.some(item => item.needsReview), processed };
}
