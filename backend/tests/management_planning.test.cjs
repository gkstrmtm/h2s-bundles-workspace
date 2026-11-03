const test = require('node:test'), assert = require('node:assert/strict');
const { evaluate, id } = require('./helpers/commercial_operations_fixture.cjs');
const foundation = evaluate('lib\\operationsFoundation.ts', {});
const operations = evaluate('lib\\managementOperations.ts', { '@/lib/operationsFoundation': foundation });
const planning = evaluate('lib\\managementPlanning.ts', {
  'node:crypto': require('node:crypto'), '@/lib/operationsFoundation': foundation, '@/lib/managementOperations': operations,
});
const ok = value => ({ status: 'available', value });
const missing = { status: 'unavailable', detail: 'Fixture evidence unavailable' };
const now = '2026-11-03T20:00:00Z';
function snapshot() {
  return {
    jobs: ok([{ job_id: id(101), order_id: 'ORD-FIXTURE', status: 'queued', due_at: '2027-01-01T14:00:00Z', updated_at: now }]),
    assignments: ok([{ assign_id: 'offer-one', job_id: id(101), pro_id: id(500), state: 'pending', updated_at: now }]),
    orders: ok([{ id: id(100), order_id: 'ORD-FIXTURE', metadata_json: { scheduled_end: '2027-01-01T16:00:00Z', scheduled_tz: 'UTC' },
      commercial_request_id: null, service_name: 'TV installation', customer_email: 'fixture@example.invalid' }]),
    pros: ok([{ pro_id: id(500), name: 'Fixture Installer', is_active: true }]), dispatchPros: ok([]), legacy: ok([]), links: ok([]),
    payouts: ok([]), reservations: ok([]), operations: ok([]), days: ok([]), capacity: ok([]),
  };
}
const project = s => planning.projectManagementPlanning(s, now);
const addJob = (s, n = 102, start = '2027-01-01T15:00:00Z', state = 'accepted') => {
  s.jobs.value.push({ ...s.jobs.value[0], job_id: id(n), due_at: start });
  s.assignments.value.push({ ...s.assignments.value[0], assign_id: `offer-${n}`, job_id: id(n), state });
};
test('scheduled, unscheduled and incomplete windows retain separate assignment, customer reservation and availability evidence', () => {
  const s = snapshot(), before = JSON.stringify(s), p = project(s), row = p.schedule[0];
  assert.equal(row.window.state, 'complete'); assert.equal(row.reservationEvidence, 'not_linked');
  assert.equal(row.availability[0].status, 'no_recorded_day_block');
  assert.match(row.availability[0].detail, /not skills, travel/);
  assert.ok(row.attention.some(item => /Pending offer/.test(item)));
  assert.equal(JSON.stringify(s), before);
  s.jobs.value[0].due_at = null; assert.equal(project(s).schedule[0].window.state, 'unscheduled');
  s.jobs.value[0].due_at = '2027-01-01T14:00:00Z';
  delete s.orders.value[0].metadata_json.scheduled_tz;
  assert.equal(project(s).schedule[0].window.state, 'incomplete');
  s.orders.value[0].metadata_json.scheduled_tz = 'Invalid/Timezone';
  assert.equal(project(s).schedule[0].window.timezone, null);
});
test('pending offers and accepted commitments conflict across the entire dataset without reserving or editing the calendar', () => {
  const s = snapshot(); addJob(s);
  let p = project(s);
  assert.equal(p.schedule[0].conflicts[0].code, 'pending_offer_overlap'); assert.equal(p.schedule[1].conflicts[0].reference, id(101));
  assert.equal(s.reservations.value.length, 0);
  s.assignments.value[0].state = 'accepted'; p = project(s);
  assert.equal(p.schedule[0].conflicts[0].code, 'technician_overlap');
  delete s.orders.value[0].metadata_json.scheduled_end;
  s.jobs.value[1].due_at = '2027-01-02T15:00:00Z';
  assert.ok(project(s).schedule.every(row => row.attention.some(item => /Conflict coverage/.test(item))));
});
test('calendar overlap includes unlinked active holds, excludes expired holds, and links own reservations only through exact operation/order/job IDs', () => {
  const s = snapshot();
  s.reservations.value.push({ lead_id: id(1), revision: 1, state: 'tentative', starts_at: '2027-01-01T14:30:00Z',
    ends_at: '2027-01-01T15:00:00Z', expires_at: '2027-01-01T00:00:00Z', timezone: 'UTC' });
  assert.equal(project(s).schedule[0].conflicts[0].code, 'company_calendar_overlap');
  s.reservations.value[0].expires_at = '2026-01-01T00:00:00Z'; assert.equal(project(s).schedule[0].conflicts.length, 0);
  s.reservations.value[0] = { ...s.reservations.value[0], state: 'confirmed', starts_at: s.jobs.value[0].due_at, ends_at: s.orders.value[0].metadata_json.scheduled_end };
  s.operations.value.push({ lead_id: id(1), order_id: id(100), installation_job_id: id(101) });
  assert.equal(project(s).schedule[0].reservationEvidence, 'confirmed'); assert.equal(project(s).schedule[0].conflicts.length, 0);
  s.operations.value[0].order_id = id(999);
  assert.ok(project(s).schedule[0].attention.some(text => /contradictory/.test(text)));
  assert.equal(project(s).schedule[0].conflicts.length, 1);
});
test('vacation evidence uses all local dates in the half-open installation window, including DST and midnight boundaries', () => {
  const s = snapshot(); s.orders.value[0].metadata_json.scheduled_tz = 'Asia/Tokyo';
  s.days.value.push({ avail_id: id(20), pro_id: id(500), date_local: '2027-01-02', type: 'vacation' });
  assert.equal(project(s).schedule[0].availability[0].status, 'blocked');
  s.orders.value[0].metadata_json.scheduled_end = '2027-01-01T15:00:00Z';
  assert.equal(project(s).schedule[0].availability[0].status, 'no_recorded_day_block');
  s.jobs.value[0].due_at = '2027-03-14T06:30:00Z';
  s.orders.value[0].metadata_json = { scheduled_end: '2027-03-14T07:30:00Z', scheduled_tz: 'America/New_York' };
  s.days.value[0].date_local = '2027-03-14';
  assert.equal(project(s).schedule[0].availability[0].status, 'blocked');
  s.days.value[0].type = 'weekly'; assert.equal(project(s).schedule[0].availability[0].status, 'no_recorded_day_block');
  Object.assign(s.days.value[0], { weekday: 'Sunday', start_time_local: '09:00:00', end_time_local: '17:00:00' });
  assert.equal(project(s).schedule[0].availability[0].records[0].fields.start_time_local, '09:00:00');
  s.days = missing; assert.equal(project(s).schedule[0].availability[0].status, 'unverified');
});
test('orphan references and cross-directory collisions remain explicit; similar IDs, names or emails never supply a link', () => {
  const s = snapshot(); s.assignments.value[0].job_id = id(999);
  s.pros.value = [{ pro_id: id(501), name: 'Fixture Installer', email: 'same@example.invalid', is_active: true }];
  s.dispatchPros.value = [{ pro_id: id(500), name: 'Fixture Installer', email: 'same@example.invalid', status: 'active' }];
  let issues = project(s).issues;
  assert.ok(issues.some(i => i.category === 'orphan_assignment'));
  assert.match(issues.find(i => i.category === 'technician_identity').reason, /dispatch_only/);
  s.pros.value[0].pro_id = id(500);
  assert.match(project(s).issues.find(i => i.category === 'technician_identity').reason, /ambiguous_namespaces/);
  s.jobs = missing; assert.throws(() => project(s), /Complete dispatch jobs/);
});
test('reviewed legacy evidence requires a unique target and reviewer; matching keys alone do not prove a relationship', () => {
  const s = snapshot(); s.legacy.value.push({ job_id: id(101) });
  assert.equal(project(s).schedule[0].legacyLink.verified, false);
  s.legacy.value.push({ job_id: 'LEGACY-FIXTURE', customer_email: 'fixture@example.invalid' });
  s.links.value.push({ dispatch_job_id: id(101), legacy_job_id: 'LEGACY-FIXTURE', evidence_basis: 'reviewed_reconciliation',
    evidence_reference: 'Fixture approval source', reviewed_by_user_id: id(9), reviewed_at: now });
  assert.equal(project(s).schedule[0].legacyLink.legacyJobId, 'LEGACY-FIXTURE');
  s.legacy.value[1].customer_email = 'other@example.invalid';
  assert.equal(project(s).schedule[0].legacyLink.verified, false, 'Reviewed links still require the existing customer-consistency veto');
  s.legacy.value[1].customer_email = 'fixture@example.invalid';
  s.links.value.push({ ...s.links.value[0], dispatch_job_id: id(102) });
  assert.equal(project(s).schedule[0].legacyLink.verified, false);
  s.links.value.pop(); s.links.value[0].reviewed_by_user_id = '';
  assert.equal(project(s).schedule[0].legacyLink.verified, false);
});
test('review fingerprints are order-independent and invalidate when supporting records change', () => {
  const s = snapshot(), first = project(s).issues.find(i => i.category === 'legacy_relationship');
  s.jobs.value[0] = Object.fromEntries(Object.entries(s.jobs.value[0]).reverse());
  assert.equal(project(s).issues.find(i => i.id === first.id).fingerprint, first.fingerprint);
  s.jobs.value[0].updated_at = '2026-11-04T20:00:00Z';
  assert.notEqual(project(s).issues.find(i => i.id === first.id).fingerprint, first.fingerprint);
});
test('completed paid relationships are not mistaken for cancellation exceptions; missing or wrong-beneficiary payouts remain review cases', () => {
  const s = snapshot(); s.jobs.value[0].status = 'completed'; s.assignments.value[0].state = 'completed';
  s.links.value.push({ dispatch_job_id: id(101), legacy_job_id: 'LEGACY-FIXTURE', evidence_basis: 'source_record',
    evidence_reference: 'Fixture source', reviewed_by_user_id: id(9), reviewed_at: now });
  s.legacy.value.push({ job_id: 'LEGACY-FIXTURE', customer_email: 'fixture@example.invalid' });
  assert.ok(project(s).issues.some(i => i.category === 'payout_association'));
  s.payouts.value.push({ payout_id: id(600), job_id: 'LEGACY-FIXTURE', pro_id: id(500), payout_type: 'job', status: 'paid', state: 'approved' });
  assert.equal(project(s).issues.filter(i => i.category === 'payout_association').length, 0);
  s.payouts.value[0].pro_id = id(501);
  assert.ok(project(s).issues.some(i => i.id.endsWith(id(600))));
  s.payouts.value[0].payout_type = 'bonus';
  assert.equal(project(s).issues.filter(i => i.id.endsWith(id(600))).length, 0);
  s.payouts.value[0].payout_type = 'job'; s.orders.value[0].commercial_request_id = id(7);
  assert.equal(project(s).schedule[0].legacyLink.verified, false, 'Consultations never establish installation payout ownership');
});
function clientFixture(s = snapshot()) {
  const tables = { h2s_dispatch_jobs: 'jobs', h2s_dispatch_job_assignments: 'assignments', h2s_orders: 'orders', h2s_pros: 'pros',
    h2s_dispatch_pros: 'dispatchPros', h2s_jobs: 'legacy', h2s_dispatch_legacy_job_links: 'links', h2s_payouts_ledger: 'payouts',
    commercial_reservations: 'reservations', commercial_lead_operations: 'operations', h2s_dispatch_pros_availability: 'days', h2s_dispatch_pro_capacity: 'capacity' };
  const calls = [], faults = {};
  const client = {
    from(table) {
      assert.ok(Object.hasOwn(tables, table)); let fields, values, column, limit = 1001;
      const builder = {
        select(value, opts) {
          assert.equal(opts.count, 'exact'); assert.doesNotMatch(value, /phone|w9|address|reason|notes/);
          if (!['h2s_orders', 'h2s_jobs'].includes(table)) assert.doesNotMatch(value, /email/);
          fields = value.split(','); return builder;
        },
        in(key, input) { column = key; values = input; return builder; }, limit(value) { limit = value; return builder; }, returns() { return builder; },
        then(resolve, reject) {
          calls.push(['select', table]);
          const source = s[tables[table]];
          if (source.status !== 'available') return Promise.resolve({ error: { code: 'FIXTURE_UNAVAILABLE' }, data: null }).then(resolve, reject);
          const data = source.value.filter(row => !values || values.includes(row[column]));
          return Promise.resolve({ data: data.slice(0, limit).map(row => Object.fromEntries(fields.map(key => [key, row[key]]))),
            error: null, count: faults[table] === 'truncated' ? 1002 : data.length }).then(resolve, reject);
        },
      };
      return new Proxy(builder, { get(target, key) { assert.ok(key in target, `Write/unsupported operation blocked: ${String(key)}`); return target[key]; } });
    },
    async rpc(name, input) { assert.equal(name, 'h2s_job_readiness'); calls.push(['rpc', name, input]);
      return { data: faults.readiness ? {} : { ready: false, blockers: ['Review equipment'] }, error: null }; },
  };
  return { client, calls, faults, s };
}
test('adapter paginates after global conflicts, performs only bounded SELECTs/readiness reads, and rejects incomplete core evidence', async () => {
  const f = clientFixture(); addJob(f.s);
  const before = JSON.stringify(f.s);
  const result = await planning.readManagementPlanning(f.client, { view: 'schedule', filter: 'conflicts', offset: 0, limit: 1, now });
  assert.equal(result.page.total, 2); assert.equal(result.page.hasMore, true); assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].preparation.value.ready, false); assert.match(result.jobs[0].attention.join(' '), /preparation/);
  assert.equal(f.calls.filter(call => call[0] === 'rpc').length, 1); assert.equal(JSON.stringify(f.s), before);
  f.faults.h2s_dispatch_jobs = 'truncated';
  await assert.rejects(planning.readManagementPlanning(f.client, { view: 'schedule', filter: 'all', offset: 0, limit: 25, now }), /Complete dispatch jobs/);
});
test('missing optional tables/readiness failures are explicit, and empty reads never imply a repaired relationship', async () => {
  const f = clientFixture(); f.s.links = missing; f.faults.readiness = true;
  const result = await planning.readManagementPlanning(f.client, { view: 'schedule', filter: 'all', offset: 0, limit: 25, now });
  assert.equal(result.complete, false); assert.equal(result.jobs[0].preparation.status, 'needs_review');
  const review = await planning.readManagementPlanning(f.client, { view: 'reconciliation', filter: 'source_unavailable', offset: 0, limit: 25, now });
  assert.equal(review.issues.length, 1); assert.equal(review.issues[0].status, 'needs_investigation');
  f.s.jobs.value = []; f.s.assignments.value = [];
  const empty = await planning.readManagementPlanning(f.client, { view: 'schedule', filter: 'all', offset: 0, limit: 25, now });
  assert.equal(empty.jobs.length, 0); assert.equal(empty.complete, false);
});
test('planning API authenticates ADMIN before any reads, preserves VA/future-role boundaries and has no mutation handlers', async () => {
  let role = 'ADMIN', reads = 0, signedIn = true;
  const permissions = evaluate('lib\\dashboardPermissions.ts', { '@/lib/dashboardAuth': {
    async getDashboardAuthUserFromSession(_request, opts) { assert.equal(opts.touchSession, false); return signedIn ? { role, userId: id(9) } : null; },
  } });
  const route = evaluate('app\\api\\management-planning\\route.ts', {
    '@/lib/supabase': { getSupabase: () => { reads++; return {}; } }, '@/lib/adminAuth': { corsHeaders: () => ({}) },
    '@/lib/dashboardPermissions': permissions, '@/lib/managementOperations': operations,
    '@/lib/managementPlanning': { ...planning, readManagementPlanning: async (_db, opts) => ({ readOnly: true, options: opts }) },
  });
  const request = query => new Request('https://fixture.invalid/api/management-planning' + (query || ''));
  for (const value of ['VA', 'OPERATIONS', 'SALES', 'OTHER']) { role = value; assert.equal((await route.GET(request())).status, 403); }
  signedIn = false; assert.equal((await route.GET(request())).status, 401); signedIn = true; role = 'ADMIN';
  for (const query of ['?limit=0', '?limit=26', '?offset=-1', '?offset=1.5', '?offset=10001', '?view=other', '?view=schedule&filter=orphan_assignment',
    '?view=schedule&view=reconciliation', '?repair=true', '?proId=unscoped']) assert.equal((await route.GET(request(query))).status, 400, query);
  assert.equal(reads, 0);
  const response = await route.GET(request('?view=reconciliation&filter=technician_identity&offset=0&limit=25'));
  assert.equal(response.status, 200); assert.equal((await response.json()).reviewOwnerId, id(9));
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) assert.equal(route[method], undefined);
});
