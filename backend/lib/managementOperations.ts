import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveOrderReference } from '@/lib/operationsFoundation';
import type { CommercialPaymentOrder } from '@/lib/commercial_payment';

type Evidence<T> = { status: 'available'; value: T }
  | { status: 'unavailable' | 'needs_review'; detail: string };
type Payment = { status: string; detail: string; checkedAt?: string };
type Job = { job_id: string; order_id: string | null; status: string; due_at: string | null };
type Order = CommercialPaymentOrder & {
  id: string; order_id: string; customer_email: string | null; customer_name: string | null;
  service_name: string | null; address: string | null; city: string | null;
  commercial_request_id: string | null; items: string | null; metadata_json: unknown;
};
type Assignment = { assign_id: string; job_id: string; pro_id: string; state: string };
type Pro = { pro_id: string; name: string | null; email: string | null };
type LegacyJob = { job_id: string; customer_email: string | null };
type LegacyLink = { dispatch_job_id: string; legacy_job_id: string };
type Payout = { payout_id: string; job_id: string; pro_id: string; status: string | null;
  state: string | null; amount: number | string | null; payout_type: string };
type Preparation = { ready: boolean; blockers: string[] };
type Result<T> = { data: T | null; error: { code?: string } | null; count?: number | null };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const activeStates = ['accepted', 'assigned', 'scheduled', 'in_progress'];
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === 'string' ? value : null;
const available = <T>(value: T): Evidence<T> => ({ status: 'available', value });
const review = (detail: string): Evidence<never> => ({ status: 'needs_review', detail });
const consultationOrder = (order: Order) => !!order.commercial_request_id
  || order.order_id.startsWith('APPT-COM-') || !!object(order.metadata_json).commercial_consultation_request_id;

export class ManagementReadError extends Error {}

async function source<T>(name: string, query: PromiseLike<Result<T>>, complete = false): Promise<Evidence<T>> {
  try {
    const result = await query;
    if (result.error || result.data === null) {
      console.error('Management read source unavailable', { source: name, code: result.error?.code || 'EMPTY_RESULT' });
      return { status: 'unavailable', detail: `${name} could not be verified. No records were changed.` };
    }
    if (complete && Array.isArray(result.data)
      && (typeof result.count !== 'number' || result.count !== result.data.length)) {
      console.error('Management read source is incomplete', { source: name });
      return review(`${name} results are incomplete; no complete relationship can be inferred.`);
    }
    return available(result.data);
  } catch {
    console.error('Management read source request failed', { source: name });
    return { status: 'unavailable', detail: `${name} request failed. Retry the read.` };
  }
}

function bounded<T>(result: Evidence<T[]>, name: string): Evidence<T[]> {
  if (result.status === 'available' && result.value.length > 1000) {
    console.error('Management read source exceeded bound', { source: name });
    return review(`${name} exceeds this read window; reconciliation is required.`);
  }
  return result;
}
export { source as readManagementSource, bounded as boundManagementRows, available, review, object };
export type { Evidence };

export async function readManagementOperations(
  db: Pick<SupabaseClient, 'from' | 'rpc'>,
  options: { offset: number; limit: number; jobId?: string; verifyPayment(order: CommercialPaymentOrder): Promise<Payment> }
) {
  let query = db.from('h2s_dispatch_jobs').select('job_id,order_id,status,due_at');
  if (options.jobId) query = query.in('job_id', [options.jobId]);
  const jobsResult = await source<Job[]>('Dispatch jobs', query.order('updated_at', { ascending: false })
    .order('job_id').range(options.offset, options.offset + options.limit));
  if (jobsResult.status !== 'available') throw new ManagementReadError(jobsResult.detail);
  const jobs = jobsResult.value.slice(0, options.limit);
  const page = { offset: options.offset, limit: options.limit, hasMore: jobsResult.value.length > options.limit };
  if (!jobs.length) return { page, jobs: [], readAt: new Date().toISOString(), readOnly: true };
  const ids = jobs.map(job => job.job_id), refs = Array.from(new Set(jobs.map(job => job.order_id).filter((id): id is string => !!id)));
  const orderColumns = 'id,order_id,total,currency,session_id,payment_intent_id,customer_email,customer_name,service_name,address,city,commercial_request_id,items,metadata_json';
  const [publicOrders, uuidOrders, assignmentResult, mappingResult] = await Promise.all([
    refs.length ? source<Order[]>('Orders', db.from('h2s_orders').select(orderColumns, { count: 'exact' }).in('order_id', refs).limit(1001), true) : available<Order[]>([]),
    refs.some(id => uuid.test(id)) ? source<Order[]>('Order UUID references', db.from('h2s_orders').select(orderColumns, { count: 'exact' })
      .in('id', refs.filter(id => uuid.test(id))).limit(1001), true) : available<Order[]>([]),
    source<Assignment[]>('Assignments', db.from('h2s_dispatch_job_assignments')
      .select('assign_id,job_id,pro_id,state', { count: 'exact' }).in('job_id', ids).limit(1001), true),
    source<LegacyLink[]>('Reviewed legacy job links', db.from('h2s_dispatch_legacy_job_links')
      .select('dispatch_job_id,legacy_job_id', { count: 'exact' }).in('dispatch_job_id', ids).limit(1001), true),
  ]);
  const assignments = bounded(assignmentResult, 'Assignments');
  const orders = publicOrders.status === 'available' && uuidOrders.status === 'available'
    ? bounded(available(Array.from(new Map([...publicOrders.value, ...uuidOrders.value].map(order => [order.id, order])).values())), 'Orders')
    : { status: 'unavailable' as const, detail: 'Order relationships could not be verified.' };
  const proRefs = assignments.status === 'available' ? Array.from(new Set(assignments.value.map(row => row.pro_id))) : [];
  const legacyIds = mappingResult.status === 'available' ? Array.from(new Set(mappingResult.value.map(link => link.legacy_job_id))) : [];
  const [proIds, proEmails, legacyResult] = await Promise.all([
    proRefs.some(id => uuid.test(id)) ? source<Pro[]>('Technicians', db.from('h2s_pros').select('pro_id,name,email', { count: 'exact' })
      .in('pro_id', proRefs.filter(id => uuid.test(id))).limit(1001), true) : available<Pro[]>([]),
    proRefs.some(id => id.includes('@')) ? source<Pro[]>('Legacy technician references', db.from('h2s_pros').select('pro_id,name,email', { count: 'exact' })
      .in('email', proRefs.filter(id => id.includes('@'))).limit(1001), true) : available<Pro[]>([]),
    legacyIds.length ? source<LegacyJob[]>('Legacy payout jobs', db.from('h2s_jobs')
      .select('job_id,customer_email', { count: 'exact' }).in('job_id', legacyIds).limit(1001), true) : available<LegacyJob[]>([]),
  ]);
  const pros = proIds.status === 'available' && proEmails.status === 'available'
    ? [...proIds.value, ...proEmails.value] : null;
  function linkedOrder(job: Job): Evidence<Order> {
    if (orders.status !== 'available') return orders;
    try {
      const match = resolveOrderReference(job.order_id || '', orders.value.map(order => ({ ...order, orderId: order.order_id })));
      return available(match);
    } catch { return review('The dispatch job must resolve to exactly one existing order.'); }
  }
  const links = new Map(jobs.map(job => [job.job_id, linkedOrder(job)]));
  function legacyLink(job: Job): Evidence<string> {
    const order = links.get(job.job_id);
    if (!order || order.status !== 'available') return review('Verify the order before linking a payout job.');
    if (consultationOrder(order.value)) return review('Consultations are excluded from installation payout attribution.');
    if (mappingResult.status !== 'available') return mappingResult;
    if (legacyResult.status !== 'available') return legacyResult;
    const mappings = mappingResult.value.filter(row => row.dispatch_job_id === job.job_id);
    if (mappings.length !== 1) return review('No reviewed legacy payout-job link. Identifiers and contact details are not proof.');
    const candidate = legacyResult.value.filter(row => row.job_id === mappings[0].legacy_job_id);
    if (candidate.length !== 1 || !order.value.customer_email
      || candidate[0].customer_email?.trim().toLowerCase() !== order.value.customer_email.trim().toLowerCase()) {
      return review('No verified legacy payout-job bridge. Matching contact details alone are insufficient.');
    }
    return available(candidate[0].job_id);
  }
  const legacyLinks = new Map(jobs.map(job => [job.job_id, legacyLink(job)]));
  const payoutIds = Array.from(legacyLinks.values()).flatMap(link => link.status === 'available' ? [link.value] : []);
  const payouts = payoutIds.length ? bounded(await source<Payout[]>('Technician payouts', db.from('h2s_payouts_ledger')
    .select('payout_id,job_id,pro_id,status,state,amount,payout_type', { count: 'exact' }).in('job_id', payoutIds).limit(1001), true), 'Technician payouts') : available<Payout[]>([]);
  const rows = [];
  for (let index = 0; index < jobs.length; index += 5) {
    rows.push(...await Promise.all(jobs.slice(index, index + 5).map(async job => {
      const order = links.get(job.job_id)!;
      const metadata = order.status === 'available' ? object(order.value.metadata_json) : {};
      const consultation = order.status === 'available' && consultationOrder(order.value);
      const kind = order.status !== 'available' ? 'unresolved' : consultation ? 'consultation' : 'installation';
      const assigned = assignments.status !== 'available' ? assignments : !pros
        ? { status: 'unavailable' as const, detail: 'Technician identities could not be verified.' } : available(assignments.value
        .filter(row => row.job_id === job.job_id && (!['declined', 'expired', 'cancelled', 'canceled', 'completed', 'done', 'rejected'].includes(row.state)
          || ['completed', 'done'].includes(job.status) && ['completed', 'done'].includes(row.state))).map(row => {
          const matches = pros ? Array.from(new Map(pros.filter(pro => pro.pro_id === row.pro_id
            || pro.email === row.pro_id).map(pro => [pro.pro_id, pro])).values()) : [];
          return { assignmentId: row.assign_id, rawState: row.state,
            proId: matches.length === 1 ? matches[0].pro_id : null,
            name: matches.length === 1 ? matches[0].name : null };
        }));
      const preparation = kind === 'installation' ? await source<Preparation>('Preparation',
        db.rpc('h2s_job_readiness', { p_job_id: job.job_id })) : review('Preparation requires a verified installation order.');
      const validatedPreparation = preparation.status !== 'available' ? preparation
        : typeof preparation.value.ready !== 'boolean' || !Array.isArray(preparation.value.blockers)
          || !preparation.value.blockers.every(item => typeof item === 'string')
          ? review('Preparation returned incomplete evidence.')
          : available({ ready: preparation.value.ready, blockers: preparation.value.blockers });
      let payment: Payment = { status: 'unverified', detail: 'Verify the installation order before checking payment.' };
      if (consultation) payment = { status: 'not_applicable', detail: 'Consultation order, not a priced installation.' };
      else if (order.status === 'available') {
        try { payment = await options.verifyPayment(order.value); }
        catch {
          console.error('Management payment verification unavailable', { jobId: job.job_id });
          payment = { status: 'unavailable', detail: 'Stripe verification failed. No payment state was changed.' };
        }
      }
      const bridge = legacyLinks.get(job.job_id)!;
      let payout: Evidence<Payout[]> = bridge.status !== 'available' ? bridge : payouts.status !== 'available' ? payouts
        : assigned.status !== 'available' ? assigned : assigned.value.length !== 1 || !assigned.value[0].proId
          || ![...activeStates, 'completed', 'done'].includes(assigned.value[0].rawState)
          ? review('A single verified technician assignment is required to attribute payouts.')
          : available(payouts.value.filter(row => row.job_id === bridge.value));
      if (payout.status === 'available' && assigned.status === 'available'
        && payout.value.some(row => row.pro_id !== assigned.value[0].proId)) {
        payout = review('Payout beneficiary differs from the verified assignment. Reconcile before attribution.');
      }
      return {
        jobId: job.job_id, rawStatus: job.status, scheduledAt: job.due_at, kind,
        order: order.status === 'available' ? available({ id: order.value.id, reference: order.value.order_id,
          customerName: order.value.customer_name, service: order.value.service_name,
          address: [order.value.address, order.value.city].filter(Boolean).join(', ') }) : order,
        assignments: assigned, preparation: validatedPreparation, payment, payouts: payout,
        equipment: order.status !== 'available' ? order : available({
          required: typeof metadata.order_required === 'boolean' ? metadata.order_required : null,
          stage: text(metadata.order_stage), scope: order.value.items,
        }),
      };
    })));
  }
  return { page, jobs: rows, readAt: new Date().toISOString(), readOnly: true };
}
