import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveOrderReference, OperationsContractError } from '@/lib/operationsFoundation';
import { readManagementSource, boundManagementRows, available, review, object, ManagementReadError, type Evidence } from '@/lib/managementOperations';

type Job = { job_id: string; order_id: string | null; status: string; due_at: string | null; updated_at: string };
type Assignment = { assign_id: string; job_id: string; pro_id: string; state: string | null; updated_at: string };
type Order = { id: string; order_id: string; metadata_json: unknown; commercial_request_id: string | null; service_name: string | null; customer_email: string | null;
  customer_name?: string | null; address?: string | null; city?: string | null };
type Pro = { pro_id: string; name: string | null; is_active: boolean };
type DispatchPro = { pro_id: string; status: string | null };
type Legacy = { job_id: string; customer_email: string | null };
type Link = { dispatch_job_id: string; legacy_job_id: string; evidence_basis: string; evidence_reference: string; reviewed_by_user_id: string; reviewed_at: string };
type Payout = { payout_id: string; job_id: string | null; pro_id: string; payout_type: string; status: string | null; state: string | null };
type Reservation = { lead_id: string; revision: number; state: string; starts_at: string; ends_at: string; expires_at: string | null; timezone: string };
type Operation = { lead_id: string; installation_job_id: string | null; order_id: string | null };
type Day = { avail_id: string; pro_id: string; date_local: string | null; type: string; weekday: string | null; start_time_local: string | null; end_time_local: string | null };
type Capacity = { capacity_id: string; pro_id: string; date_local: string; time_slot: string; max_jobs: number; booked_jobs: number; available_spots: number | null; blocked: boolean };
export type PlanningSnapshot = {
  jobs: Evidence<Job[]>; assignments: Evidence<Assignment[]>; orders: Evidence<Order[]>; pros: Evidence<Pro[]>;
  dispatchPros: Evidence<DispatchPro[]>; legacy: Evidence<Legacy[]>; links: Evidence<Link[]>; payouts: Evidence<Payout[]>;
  reservations: Evidence<Reservation[]>; operations: Evidence<Operation[]>; days: Evidence<Day[]>; capacity: Evidence<Capacity[]>;
};
type RecordEvidence = { source: string; id: string; fields: Record<string, unknown> };
export type ReviewIssue = { id: string; fingerprint: string; category: string; status: 'unresolved' | 'needs_investigation';
  reason: string; remediation: string; records: RecordEvidence[] };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const ref = (value: string) => uuid.test(value) ? value.toLowerCase() : value;
const same = (a: string, b: string) => ref(a) === ref(b);
const terminal = (state: string) => ['completed', 'done', 'cancelled', 'canceled'].includes(state);
const unclosed = (state: string | null) => !state || !['declined', 'expired', 'cancelled', 'canceled', 'completed', 'done', 'rejected'].includes(state);
const accepted = (state: string | null) => !!state && ['accepted', 'assigned', 'scheduled', 'in_progress'].includes(state);
const rows = <T>(source: Evidence<T[]>): T[] => source.status === 'available' ? source.value : [];
const record = (source: string, id: string, fields: object): RecordEvidence => ({ source, id, fields: { ...fields } });
const instant = (value: unknown) => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/i.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, canonical(item)]));
  return value;
}
function zone(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return value; } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'RangeError') return null;
    throw error;
  }
}
function localDays(start: number, end: number, timezone: string): string[] | null {
  const day = (time: number) => {
    const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(time);
    return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)!.value).join('-');
  };
  const first = day(start), last = day(end - 1), result: string[] = [];
  for (let cursor = Date.parse(first + 'T00:00:00Z'); result.length < 32; cursor += 86400000) {
    const key = new Date(cursor).toISOString().slice(0, 10); result.push(key);
    if (key === last) return result;
  }
  return null;
}
export const planningFilters = {
  schedule: ['all', 'upcoming', 'scheduled', 'unscheduled', 'attention', 'conflicts'],
  reconciliation: ['all', 'orphan_assignment', 'technician_identity', 'legacy_relationship', 'assignment_conflict', 'payout_association', 'source_unavailable'],
} as const;

export function projectManagementPlanning(snapshot: PlanningSnapshot, now: string) {
  if (instant(now) === null) throw new ManagementReadError('A verified read time is required.');
  if (snapshot.jobs.status !== 'available' || snapshot.assignments.status !== 'available') {
    throw new ManagementReadError('Complete dispatch jobs and assignments are required; no missing relationship can be inferred from a failed or truncated read.');
  }
  const jobs = snapshot.jobs.value, assignments = snapshot.assignments.value, issues: ReviewIssue[] = [];
  const sources = Object.entries(snapshot).map(([name, value]) => ({ name, status: value.status,
    count: value.status === 'available' ? value.value.length : null, detail: value.status === 'available' ? null : value.detail }));
  const issue = (category: string, key: string, reason: string, remediation: string, evidence: RecordEvidence[], status: ReviewIssue['status'] = 'unresolved') => {
    const records = evidence.slice().sort((a, b) => `${a.source}:${a.id}`.localeCompare(`${b.source}:${b.id}`));
    const id = `${category}:${key}`;
    issues.push({ id, fingerprint: createHash('sha256').update(JSON.stringify(canonical({ id, reason, records }))).digest('hex'),
      category, status, reason, remediation, records });
  };
  for (const source of sources) if (source.status !== 'available') issue('source_unavailable', source.name,
    source.detail!, 'Restore read-only access or provide a complete bounded dataset. Do not treat unavailable evidence as an empty table.',
    [record(source.name, 'source', { status: source.status })], 'needs_investigation');
  const person = (assignment: Assignment) => {
    if (snapshot.pros.status !== 'available' || snapshot.dispatchPros.status !== 'available') return { status: 'unverified', proId: null, name: null };
    const portal = rows(snapshot.pros).filter(pro => same(pro.pro_id, assignment.pro_id));
    const dispatch = rows(snapshot.dispatchPros).filter(pro => pro.pro_id === assignment.pro_id);
    if (portal.length === 1 && !dispatch.length) return {
      status: portal[0].is_active ? 'verified_portal_id' : 'inactive_portal_id', proId: portal[0].pro_id, name: portal[0].name,
    };
    return { status: portal.length && dispatch.length ? 'ambiguous_namespaces' : dispatch.length ? 'dispatch_only' : 'unresolved', proId: null, name: null };
  };
  for (const assignment of assignments) {
    const evidence = [record('h2s_dispatch_job_assignments', assignment.assign_id, assignment)];
    if (!jobs.some(job => same(job.job_id, assignment.job_id))) issue('orphan_assignment', assignment.assign_id,
      'Assignment job reference has no dispatch job in the complete read. A legacy or order identifier is not a replacement dispatch job.',
      'Recover source creation/deletion provenance; approve an exact restoration or archival disposition with an audit and rollback. Never auto-delete.', evidence);
    const identity = person(assignment);
    if (identity.status !== 'verified_portal_id') issue('technician_identity', assignment.assign_id,
      `Technician identity: ${identity.status}. Names and emails are not proof of a cross-directory relationship.`,
      'Verify the original portal identity and Dispatch directory provenance; propose an explicitly reviewed link or reoffer. Never reassign by name/email.',
      [...evidence, ...rows(snapshot.dispatchPros).filter(pro => pro.pro_id === assignment.pro_id).map(pro => record('h2s_dispatch_pros', pro.pro_id, pro)),
        ...rows(snapshot.pros).filter(pro => same(pro.pro_id, assignment.pro_id)).map(pro => record('h2s_pros', pro.pro_id, pro))], 'needs_investigation');
  }
  for (const key of new Set(assignments.map(assignment => ref(assignment.job_id)))) {
    const active = assignments.filter(a => ref(a.job_id) === key && unclosed(a.state));
    if (active.length > 1) issue('assignment_conflict', key, 'More than one unclosed assignment/offer references this job key.',
      'Identify authoritative offer/acceptance events, then explicitly approve superseding transitions; retain all history.',
      active.map(a => record('h2s_dispatch_job_assignments', a.assign_id, a)), 'needs_investigation');
  }
  function bridge(job: Job, order: Order | null, installation: boolean) {
    const matches = rows(snapshot.links).filter(link => same(link.dispatch_job_id, job.job_id));
    const link = matches.length === 1 ? matches[0] : null;
    const target = link ? rows(snapshot.legacy).filter(row => row.job_id === link.legacy_job_id) : [];
    const proof = !!link && ['source_record', 'reviewed_reconciliation'].includes(link.evidence_basis)
      && !!link.evidence_reference?.trim() && uuid.test(link.reviewed_by_user_id) && instant(link.reviewed_at) !== null;
    const otherOwner = link && rows(snapshot.links).some(other => other.dispatch_job_id !== link.dispatch_job_id && other.legacy_job_id === link.legacy_job_id);
    const customerConsistent = !!order?.customer_email?.trim() && target.length === 1
      && target[0].customer_email?.trim().toLowerCase() === order.customer_email.trim().toLowerCase();
    const verified = installation && !!order && snapshot.links.status === 'available' && snapshot.legacy.status === 'available'
      && proof && target.length === 1 && !otherOwner && customerConsistent;
    const reason = !order ? 'The dispatch order is unresolved.'
      : snapshot.links.status !== 'available' || snapshot.legacy.status !== 'available' ? 'Reviewed-link or legacy source evidence is unavailable.'
      : matches.length !== 1 ? 'Exactly one explicit reviewed link is required; matching identifiers alone do not prove a relationship.'
      : !proof ? 'The link lacks supported source evidence, reviewer identity or review time.'
      : target.length !== 1 ? 'The reviewed legacy target does not uniquely exist.'
      : otherOwner ? 'Another dispatch job claims the same legacy target.'
      : !customerConsistent ? 'The existing customer-consistency check is not satisfied. Contact agreement alone could not prove a link.'
      : !installation ? 'Consultations and unresolved orders are excluded from installation payout attribution.' : null;
    return { verified, reason, link, evidence: [...(link ? [record('h2s_dispatch_legacy_job_links', link.dispatch_job_id, link)] : []),
      ...target.map(row => record('h2s_jobs', row.job_id, row))] };
  }
  const schedule = jobs.map(job => {
    let order: Order | null = null;
    if (snapshot.orders.status === 'available') {
      try { order = resolveOrderReference(job.order_id || '', snapshot.orders.value.map(row => ({ ...row, orderId: row.order_id }))); }
      catch (error) {
        if (!(error instanceof OperationsContractError)) throw error;
      }
    }
    const meta = object(order?.metadata_json), start = instant(job.due_at), end = instant(meta.scheduled_end), timezone = zone(meta.scheduled_tz);
    const kind = !order ? 'unresolved' : order.commercial_request_id || order.order_id.startsWith('APPT-COM-')
      || meta.commercial_consultation_request_id ? 'consultation' : 'installation';
    const assigned = assignments.filter(a => same(a.job_id, job.job_id) && unclosed(a.state)).map(a => ({ ...a, identity: person(a) }));
    const windowState = job.due_at === null ? 'unscheduled' : start === null || end !== null && end <= start ? 'invalid'
      : end === null || !timezone ? 'incomplete' : 'complete';
    const attention: string[] = [], conflicts: { code: string; reference: string; detail: string }[] = [];
    if (!order) attention.push('Order relationship unresolved.');
    if (windowState !== 'complete') attention.push(`Installation window ${windowState}; no duration or timezone was invented.`);
    if (meta.scheduled_date && instant(meta.scheduled_date) !== start) attention.push('Order scheduled_date and dispatch start differ.');
    if (!terminal(job.status) && (assigned.length !== 1 || assigned.some(a => a.identity.status !== 'verified_portal_id'))) attention.push('A single active, verified portal technician is not established.');
    if (!terminal(job.status) && assigned.some(a => accepted(a.state))) attention.push('Acceptance is not bound to a schedule revision; rescheduling requires management review.');
    if (!terminal(job.status) && assigned.some(a => !accepted(a.state))) attention.push('Pending offer or unknown assignment state requires management attention.');
    if (terminal(job.status) && assigned.length) attention.push('Closed job retains unclosed assignment history.');
    const linked = rows(snapshot.operations).filter(op => op.installation_job_id && same(op.installation_job_id, job.job_id));
    const operation = linked.length === 1 && order && linked[0].order_id === order.id ? linked[0] : null;
    const reservations = operation ? rows(snapshot.reservations).filter(r => r.lead_id === operation.lead_id) : [];
    if (linked.length && !operation) attention.push('Commercial installation/lead/order link is contradictory or ambiguous.');
    const reservation = reservations.length === 1 ? reservations[0] : null;
    if (reservation && (instant(reservation.starts_at) !== start || instant(reservation.ends_at) !== end || reservation.timezone !== timezone)) {
      attention.push('Customer reservation and installation window differ.');
    }
    if (!terminal(job.status) && start !== null && end !== null && end > start) {
      for (const r of rows(snapshot.reservations)) {
        if (operation?.lead_id === r.lead_id) continue;
        const active = r.state === 'confirmed' || r.state === 'tentative' && (instant(r.expires_at) === null || Date.parse(r.expires_at!) > Date.parse(now));
        const rs = instant(r.starts_at), re = instant(r.ends_at);
        if (active && rs !== null && re !== null && rs < end && start < re) conflicts.push({
          code: 'company_calendar_overlap', reference: r.lead_id, detail: 'Overlaps a confirmed or active/expiry-unverified hold on the existing shared company calendar.',
        });
      }
    }
    const availability = assigned.map(a => {
      const days = windowState === 'complete' ? localDays(start!, end!, timezone!) : null;
      const profileDays = rows(snapshot.days).filter(row => a.identity.proId && same(row.pro_id, a.identity.proId));
      const blocks = days ? profileDays.filter(row => row.type === 'vacation' && row.date_local && days.includes(row.date_local)) : [];
      if (blocks.length) conflicts.push({ code: 'technician_day_block', reference: a.assign_id, detail: 'An established vacation/day block overlaps the installation in its recorded timezone.' });
      return { assignmentId: a.assign_id, status: !a.identity.proId || !days || snapshot.days.status !== 'available' ? 'unverified'
        : blocks.length ? 'blocked' : 'no_recorded_day_block',
      detail: 'Day-block evidence is not skills, travel, duration or capacity clearance.',
      records: profileDays.map(row => record('h2s_dispatch_pros_availability', row.avail_id, row)),
      dispatchCapacity: rows(snapshot.capacity).filter(row => row.pro_id === a.pro_id)
        .map(row => record('h2s_dispatch_pro_capacity', row.capacity_id, row)) };
    });
    const link = bridge(job, order, kind === 'installation');
    if (kind !== 'consultation' && !link.verified) issue('legacy_relationship', job.job_id,
      `Dispatch-to-legacy relationship unresolved: ${link.reason}`,
      'Obtain source-record evidence, a named reviewer and exact legacy target; approve mapping separately. Do not create legacy jobs or payouts automatically.',
      [record('h2s_dispatch_jobs', job.job_id, job), ...(order ? [record('h2s_orders', order.id,
        { order_id: order.order_id, customer_email: order.customer_email })] : []), ...link.evidence]);
    if (!terminal(job.status) && availability.some(a => a.status !== 'no_recorded_day_block')) attention.push('Technician availability is blocked or unverified.');
    if (snapshot.days.status !== 'available' || snapshot.capacity.status !== 'available' || snapshot.reservations.status !== 'available') attention.push('Availability/calendar source evidence is incomplete.');
    return { jobId: job.job_id, rawStatus: job.status, kind, orderId: order?.id || null, orderReference: order?.order_id || job.order_id,
      service: order?.service_name || null, customerName: order?.customer_name || null,
      address: order ? [order.address, order.city].filter(Boolean).join(', ') || null : null,
      window: { state: windowState, start: job.due_at, end: typeof meta.scheduled_end === 'string' ? meta.scheduled_end : null, timezone },
      assignments: assigned, availability, conflicts, attention, reservation: reservation ? record('commercial_reservations', reservation.lead_id, reservation) : null,
      reservationEvidence: snapshot.reservations.status !== 'available' || snapshot.operations.status !== 'available' ? 'unverified'
        : reservation ? reservation.state : 'not_linked',
      legacyLink: { verified: link.verified, legacyJobId: link.verified ? link.link!.legacy_job_id : null } };
  }).sort((a, b) => Number(terminal(a.rawStatus)) - Number(terminal(b.rawStatus))
    || (instant(a.window.start) ?? Infinity) - (instant(b.window.start) ?? Infinity) || a.jobId.localeCompare(b.jobId));
  for (const job of schedule.filter(j => !terminal(j.rawStatus))) {
    for (const other of schedule.filter(j => j.jobId > job.jobId && !terminal(j.rawStatus))) {
      const common = job.assignments.filter(a => a.identity.proId && other.assignments.some(b => b.identity.proId === a.identity.proId));
      if (!common.length) continue;
      const a = instant(job.window.start), b = instant(other.window.start), ae = instant(job.window.end), be = instant(other.window.end);
      if (a !== null && b !== null && (a === b || ae !== null && be !== null && a < be && b < ae)) {
        const pending = [...job.assignments, ...other.assignments].some(row => !accepted(row.state));
        for (const [current, related] of [[job, other], [other, job]]) current.conflicts.push({
          code: pending ? 'pending_offer_overlap' : 'technician_overlap', reference: related.jobId,
          detail: pending ? 'Overlapping pending offer/commitment; not a confirmed calendar reservation.' : 'Accepted technician commitments overlap.',
        });
      } else if (a === null || b === null || ae === null || be === null) {
        job.attention.push(`Conflict coverage is incomplete for technician commitment ${other.jobId}.`);
        other.attention.push(`Conflict coverage is incomplete for technician commitment ${job.jobId}.`);
      }
    }
  }
  for (const payout of rows(snapshot.payouts)) {
    if (payout.payout_type !== 'job') continue;
    const owners = payout.job_id ? schedule.filter(job => job.legacyLink.verified && job.legacyLink.legacyJobId === payout.job_id) : [];
    const owner = owners.length === 1 ? owners[0] : null;
    const eligible = owner ? assignments.filter(a => same(a.job_id, owner.jobId)
      && (accepted(a.state) || ['completed', 'done'].includes(owner.rawStatus) && ['completed', 'done'].includes(a.state || ''))) : [];
    const matchingPro = eligible.filter(a => {
      const identity = person(a); return identity.proId && same(identity.proId, payout.pro_id);
    });
    if (!owner || matchingPro.length !== 1 || eligible.length !== 1 || ['cancelled', 'canceled'].includes(owner.rawStatus)) issue('payout_association', payout.payout_id,
      'Job payout cannot be attributed to one current, reviewed job/technician relationship, or belongs to a closed job requiring settlement review.',
      'Verify original completion and beneficiary records, approval and settlement separately. Never create, cancel, approve or pay from this review.',
      [record('h2s_payouts_ledger', payout.payout_id, payout)], 'needs_investigation');
  }
  for (const job of schedule.filter(j => j.kind === 'installation' && ['completed', 'done'].includes(j.rawStatus))) {
    if (!job.legacyLink.verified || snapshot.payouts.status !== 'available'
      || !rows(snapshot.payouts).some(p => p.job_id === job.legacyLink.legacyJobId && p.payout_type === 'job')) issue('payout_association', `job:${job.jobId}`,
      'Completed installation has no verifiable linked job payout. This is not authorization to generate one.',
      'Review completion, the reviewed legacy link and the approved compensation record before separately authorized remediation.',
      [record('h2s_dispatch_jobs', job.jobId, { status: job.rawStatus, legacyLink: job.legacyLink })]);
  }
  const complete = sources.every(source => source.status === 'available');
  return { schedule, issues: issues.sort((a, b) => a.id.localeCompare(b.id)), sources, complete };
}

export async function readManagementPlanning(db: Pick<SupabaseClient, 'from' | 'rpc'>,
  options: { view: 'schedule' | 'reconciliation'; filter: string; offset: number; limit: number; now?: string }) {
  const load = async <T>(table: string, columns: string) => boundManagementRows(await readManagementSource<T[]>(table,
    db.from(table).select(columns, { count: 'exact' }).limit(1001).returns<T[]>(), true), table);
  const [jobs, assignments, pros, dispatchPros, legacy, links, payouts, reservations, operations, days, capacity] = await Promise.all([
    load<Job>('h2s_dispatch_jobs', 'job_id,order_id,status,due_at,updated_at'),
    load<Assignment>('h2s_dispatch_job_assignments', 'assign_id,job_id,pro_id,state,updated_at'),
    load<Pro>('h2s_pros', 'pro_id,name,is_active'), load<DispatchPro>('h2s_dispatch_pros', 'pro_id,status'),
    load<Legacy>('h2s_jobs', 'job_id,customer_email'),
    load<Link>('h2s_dispatch_legacy_job_links', 'dispatch_job_id,legacy_job_id,evidence_basis,evidence_reference,reviewed_by_user_id,reviewed_at'),
    load<Payout>('h2s_payouts_ledger', 'payout_id,job_id,pro_id,payout_type,status,state'),
    load<Reservation>('commercial_reservations', 'lead_id,revision,state,starts_at,ends_at,expires_at,timezone'),
    load<Operation>('commercial_lead_operations', 'lead_id,installation_job_id,order_id'),
    load<Day>('h2s_dispatch_pros_availability', 'avail_id,pro_id,date_local,type,weekday,start_time_local,end_time_local'),
    load<Capacity>('h2s_dispatch_pro_capacity', 'capacity_id,pro_id,date_local,time_slot,max_jobs,booked_jobs,available_spots,blocked'),
  ]);
  const refs = [...new Set(rows(jobs).map(job => job.order_id).filter((value): value is string => !!value))];
  const orderColumns = 'id,order_id,metadata_json,commercial_request_id,service_name,customer_email,customer_name,address,city';
  const orderRead = (column: string, values: string[]) => values.length ? readManagementSource<Order[]>('Orders',
    db.from('h2s_orders').select(orderColumns, { count: 'exact' }).in(column, values).limit(1001), true) : Promise.resolve(available<Order[]>([]));
  const [publicOrders, uuidOrders] = await Promise.all([orderRead('order_id', refs), orderRead('id', refs.filter(value => uuid.test(value)))]);
  const orders = publicOrders.status === 'available' && uuidOrders.status === 'available'
    ? boundManagementRows(available([...new Map([...publicOrders.value, ...uuidOrders.value].map(row => [row.id, row])).values()]), 'Orders')
    : review('Order evidence is unavailable or incomplete.');
  const readAt = options.now || new Date().toISOString();
  const projected = projectManagementPlanning({ jobs, assignments, orders, pros, dispatchPros, legacy, links, payouts, reservations, operations, days, capacity }, readAt);
  const summary = { jobs: projected.schedule.length, issues: projected.issues.length,
    categories: Object.fromEntries(planningFilters.reconciliation.slice(1).map(category => [category, projected.issues.filter(issue => issue.category === category).length])) };
  const filteredJobs = projected.schedule.filter(job => options.filter === 'all' || options.filter === 'scheduled' && job.window.state !== 'unscheduled'
      || options.filter === 'unscheduled' && job.window.state === 'unscheduled'
      || options.filter === 'conflicts' && job.conflicts.length > 0
      || options.filter === 'attention' && (job.attention.length > 0 || job.conflicts.length > 0)
      || options.filter === 'upcoming' && job.kind === 'installation' && !terminal(job.rawStatus)
        && instant(job.window.start) !== null && Date.parse(job.window.start!) >= Date.parse(readAt));
  const filteredIssues = projected.issues.filter(issue => options.filter === 'all' || issue.category === options.filter);
  const selected = options.view === 'reconciliation' ? filteredIssues : filteredJobs;
  const page = { offset: options.offset, limit: options.limit, total: selected.length, hasMore: selected.length > options.offset + options.limit };
  const selectedJobs = options.view === 'schedule' ? filteredJobs.slice(options.offset, options.offset + options.limit) : [];
  const resultJobs = [];
  for (let i = 0; i < selectedJobs.length; i += 5) resultJobs.push(...await Promise.all(selectedJobs.slice(i, i + 5).map(async job => {
    const preparation = job.kind === 'installation' ? await readManagementSource<{ ready: boolean; blockers: string[] }>('Preparation',
      db.rpc('h2s_job_readiness', { p_job_id: job.jobId })) : review('Preparation requires a verified installation order.');
    const valid = preparation.status !== 'available' ? preparation : typeof preparation.value.ready === 'boolean'
      && Array.isArray(preparation.value.blockers) && preparation.value.blockers.every(item => typeof item === 'string')
      ? available({ ready: preparation.value.ready, blockers: preparation.value.blockers }) : review('Preparation evidence is incomplete.');
    return { ...job, preparation: valid, attention: [...job.attention,
      ...(valid.status !== 'available' || !valid.value.ready ? ['Installation preparation is not verified ready.'] : [])] };
  })));
  return { readOnly: true, readAt, view: options.view, page, summary,
    complete: projected.complete && resultJobs.every(job => job.preparation.status === 'available'),
    sources: projected.sources, jobs: resultJobs, issues: options.view === 'reconciliation' ? filteredIssues.slice(options.offset, options.offset + options.limit) : [],
    scope: 'At most 1000 complete rows per source; separate SELECTs, not an atomic snapshot. Revalidate before any approved repair. No availability clearance is implied.' };
}
