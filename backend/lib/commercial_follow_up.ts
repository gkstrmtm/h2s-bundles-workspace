import { getSupabase } from '@/lib/supabase';
import { followUpDecision, followUpOperationId, readFollowUpPolicy, type FollowUpMode } from '@/lib/internal_follow_up';

export function isFollowUpMode(value: unknown): value is FollowUpMode {
  return value === 'automatic' || value === 'manual' || value === 'customer_callback';
}
export class FollowUpInputError extends Error {}
function data<T>(result: { data: T; error: { code?: string; message: string } | null }): T {
  if (result.error) throw Object.assign(new Error('Internal follow-up storage unavailable'), { code: result.error.code });
  return result.data;
}
export async function loadFollowUpContext(leadId: string) {
  const db = getSupabase();
  const state = data(await db.from('commercial_lead_operations').select('*').eq('lead_id', leadId).maybeSingle())
    || { revision: 0, disposition: 'open', next_follow_up_at: null };
  const latest = data(await db.from('commercial_lead_activity').select('operation_id,payload,created_at')
    .eq('lead_id', leadId).eq('action', 'follow_up').order('revision', { ascending: false }).limit(1).maybeSingle());
  const contact = data(await db.from('commercial_lead_activity').select('operation_id,payload,created_at')
    .eq('lead_id', leadId).eq('action', 'follow_up').contains('payload', { contact: {} })
    .order('revision', { ascending: false }).limit(1).maybeSingle());
  const submitted = data(await db.from('commercial_consultation_requests').select('request_id,created_at')
    .eq('lead_id', leadId).order('created_at', { ascending: false }).limit(1).maybeSingle());
  const job = state.installation_job_id
    ? data(await db.from('h2s_dispatch_jobs').select('status').eq('job_id', state.installation_job_id).maybeSingle()) : null;
  if (state.installation_job_id && !job) throw new Error('Linked installation unavailable for follow-up review');
  const completed = !!state.completed_at || ['completed','done','cancelled'].includes(job?.status);
  const mode = isFollowUpMode(latest?.payload.followUp?.mode) ? latest.payload.followUp.mode
    : latest || state.next_follow_up_at ? 'manual' : 'automatic';
  const event = contact && (!submitted || Date.parse(contact.created_at) >= Date.parse(submitted.created_at))
    ? { id: contact.operation_id, at: contact.created_at, outcome: contact.payload.contact.outcome }
    : submitted ? { id: submitted.request_id, at: submitted.created_at, outcome: 'new_request' } : null;
  return { state, latest, context: { disposition: state.disposition, completed, nextAt: state.next_follow_up_at, mode, event } };
}
export async function followUpView(leadId: string) {
  const policy = readFollowUpPolicy(), loaded = await loadFollowUpContext(leadId);
  const decision = followUpDecision(loaded.context, policy);
  return { enabled: policy.enabled, mode: loaded.context.mode, proposedAt: decision.dueAt,
    reason: loaded.latest?.payload.followUp?.reason || decision.reason,
    proposedReason: decision.reason, policyTimeZone: policy.timeZone, completed: loaded.context.completed };
}
export async function prepareFollowUp(leadId: string, operationId: string, payload: Record<string, unknown>, rawMode: unknown) {
  const policy = readFollowUpPolicy(), loaded = await loadFollowUpContext(leadId);
  const contact = payload.contact as { outcome: string } | undefined;
  let mode: FollowUpMode = isFollowUpMode(rawMode) ? rawMode : 'manual';
  if (rawMode !== undefined && !isFollowUpMode(rawMode)) throw new FollowUpInputError('Choose a valid follow-up scheduling mode');
  if (contact?.outcome === 'requested_callback') mode = 'customer_callback';
  if (mode === 'automatic' && !policy.enabled) throw new FollowUpInputError('Automatic follow-up timing requires approval and explicit policy activation');
  const context = { ...loaded.context, disposition: String(payload.disposition), mode,
    nextAt: typeof payload.nextFollowUpAt === 'string' ? payload.nextFollowUpAt : null,
    event: contact ? { id: operationId, at: new Date().toISOString(), outcome: contact.outcome } : loaded.context.event };
  if (mode === 'customer_callback' && !context.nextAt && context.disposition !== 'closed') {
    throw new FollowUpInputError('Enter the exact customer-requested callback time');
  }
  const decision = followUpDecision(context, policy);
  payload.nextFollowUpAt = decision.dueAt || '';
  payload.followUp = { mode, reason: decision.reason, sourceKey: decision.sourceKey, sourceEventId: context.event?.id || null };
}
export async function applyAutomaticFollowUp(leadId: string) {
  const policy = readFollowUpPolicy();
  if (!policy.enabled) return 'disabled';
  const loaded = await loadFollowUpContext(leadId);
  if (loaded.context.mode !== 'automatic') return 'manual_override';
  const decision = followUpDecision(loaded.context, policy);
  if ((loaded.context.nextAt ? Date.parse(loaded.context.nextAt) : null) === (decision.dueAt ? Date.parse(decision.dueAt) : null)) return 'unchanged';
  const payload = {
    responsibleId: loaded.state.responsible_id || '', responsibleName: loaded.state.responsible_name || '',
    disposition: loaded.state.disposition, reason: loaded.state.disposition_reason || '', nextFollowUpAt: decision.dueAt || '',
    followUp: { mode: 'automatic', reason: decision.reason, sourceKey: decision.sourceKey, sourceEventId: loaded.context.event?.id || null },
  };
  const key = decision.sourceKey || `${leadId}:terminal:${loaded.state.revision}`;
  const result = await getSupabase().rpc('commercial_record_follow_up', {
    p_lead_id: leadId, p_revision: loaded.state.revision, p_operation_id: followUpOperationId(leadId + ':' + key + ':' + loaded.state.revision),
    p_actor: { id: 'internal-follow-up-policy', name: 'Internal follow-up policy' }, p_payload: payload,
  });
  if (result.error?.code === '40001') return 'changed_during_review';
  data(result);
  return 'updated';
}
