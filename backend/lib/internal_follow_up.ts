import { createHash } from 'node:crypto';

export type FollowUpMode = 'automatic' | 'manual' | 'customer_callback';
type Event = { id: string; at: string; outcome: string };
export type FollowUpContext = {
  disposition: string; completed: boolean; nextAt?: string | null;
  mode?: FollowUpMode; event?: Event | null;
};
export type FollowUpPolicy = {
  enabled: boolean; timeZone: string; localHour: number;
  businessDays: { new_request: number; no_response: number; left_message: number };
};
export const proposedFollowUpPolicy: FollowUpPolicy = {
  enabled: false, timeZone: 'America/New_York', localHour: 9,
  businessDays: { new_request: 1, no_response: 1, left_message: 2 },
};
export function readFollowUpPolicy(raw = process.env.INTERNAL_FOLLOW_UP_POLICY_JSON): FollowUpPolicy {
  if (!raw) return { ...proposedFollowUpPolicy, businessDays: { ...proposedFollowUpPolicy.businessDays } };
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid internal follow-up policy');
  const input = value as Record<string, unknown>;
  const days = input.businessDays as Record<string, unknown> | undefined;
  if (typeof input.enabled !== 'boolean' || typeof input.timeZone !== 'string'
    || typeof input.localHour !== 'number' || !Number.isInteger(input.localHour) || input.localHour < 0 || input.localHour > 23
    || !days || ['new_request','no_response','left_message'].some(key =>
      typeof days[key] !== 'number' || !Number.isInteger(days[key]) || Number(days[key]) < 1 || Number(days[key]) > 30)) {
    throw new Error('Configure explicit enabled, timeZone, localHour and businessDays for internal follow-up');
  }
  new Intl.DateTimeFormat('en-US', { timeZone: input.timeZone }).format();
  return { enabled: input.enabled, timeZone: input.timeZone, localHour: input.localHour,
    businessDays: { new_request: Number(days.new_request), no_response: Number(days.no_response), left_message: Number(days.left_message) } };
}
function parts(at: number, timeZone: string) {
  const values = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const part = (name: string) => Number(values.find(value => value.type === name)?.value);
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute'), second: part('second') };
}
function nextBusinessInstant(event: Event, days: number, policy: FollowUpPolicy) {
  const at = Date.parse(event.at);
  if (!Number.isFinite(at)) throw new Error('Follow-up source event has no valid persisted timestamp');
  const start = parts(at, policy.timeZone);
  const day = new Date(Date.UTC(start.year, start.month - 1, start.day));
  while (days > 0) {
    day.setUTCDate(day.getUTCDate() + 1);
    if (![0, 6].includes(day.getUTCDay())) days--;
  }
  const wall = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), policy.localHour);
  let guess = wall;
  for (let attempt = 0; attempt < 4; attempt++) {
    const local = parts(guess, policy.timeZone);
    const delta = wall - Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    if (!delta) return new Date(guess).toISOString();
    guess += delta;
  }
  throw new Error('Configured follow-up hour does not exist in the policy timezone on this date');
}
export function followUpDecision(context: FollowUpContext, policy: FollowUpPolicy) {
  if (['closed','lost'].includes(context.disposition) || context.completed) {
    return { dueAt: null, reason: context.completed ? 'Installation completed; no automatic follow-up.' : 'Lead closed/lost; no automatic follow-up.', sourceKey: null };
  }
  if (context.mode && context.mode !== 'automatic') {
    return { dueAt: context.nextAt || null, reason: context.mode === 'customer_callback'
      ? 'Customer-requested callback time takes precedence.' : 'Explicit staff override; automatic scheduling will not replace it.', sourceKey: null };
  }
  const event = context.event;
  if (!event || !Object.hasOwn(policy.businessDays, event.outcome)) {
    return { dueAt: null, reason: event?.outcome === 'requested_callback'
      ? 'Record the exact customer-requested callback time; no time is guessed.'
      : 'No automatic follow-up rule for this outcome; staff review or an explicit callback is required.', sourceKey: null };
  }
  const days = policy.businessDays[event.outcome as keyof FollowUpPolicy['businessDays']];
  const dueAt = nextBusinessInstant(event, days, policy);
  const sourceKey = createHash('sha256').update(JSON.stringify([event.id, event.at, event.outcome,
    policy.timeZone, policy.localHour, policy.businessDays])).digest('hex');
  return { dueAt, sourceKey, reason: `${event.outcome.replace(/_/g, ' ')}: ${days} business day${days === 1 ? '' : 's'} later at ${policy.localHour}:00 ${policy.timeZone}. Internal task only.` };
}
export function followUpOperationId(source: string) {
  const hex = createHash('sha256').update('internal-follow-up:' + source).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
