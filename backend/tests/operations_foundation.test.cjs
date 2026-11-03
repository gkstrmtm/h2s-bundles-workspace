const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, id, createOperationsFixture } = require('./helpers/commercial_operations_fixture.cjs');
const contracts = evaluate('lib\\operationsFoundation.ts', {});
const { inspect, main } = require('../tools/inspect_operations_foundation.cjs');
const order = { id: id(100), orderId: 'ORD-FIXTURE' };
const quote = { leadId: id(1), quoteOperationId: id(700), businessRevision: 1 };
const link = () => ({
  customer: { leadId: id(1), market: 'residential', crmContact: null }, order: { ...order },
  job: { jobId: id(101), orderReference: order.orderId }, quote: { ...quote },
});

test('order references preserve UUID and public-reference identity without contact matching', () => {
  for (const reference of [order.id, order.id.toUpperCase(), order.orderId]) {
    assert.equal(contracts.resolveOrderReference(reference, [order]), order);
  }
  for (const reference of ['missing', 'fixture@example.invalid']) {
    assert.throws(() => contracts.resolveOrderReference(reference, [order]), { code: 'UNRESOLVED_ORDER' });
  }
  const collision = { id: id(101), orderId: order.id };
  assert.throws(() => contracts.resolveOrderReference(order.id, [order, collision]), { code: 'AMBIGUOUS_ORDER' });
  assert.throws(() => contracts.resolveOrderReference(order.id, [order, order]), { code: 'AMBIGUOUS_ORDER' });
});

test('installation and quote contracts reject incomplete, mismatched and lossy identity', () => {
  for (const reference of [order.id, order.orderId]) {
    const value = link(); value.job.orderReference = reference;
    const before = structuredClone(value);
    contracts.validateInstallationLink(value);
    assert.deepEqual(value, before);
  }
  const withoutQuote = link(); withoutQuote.quote = null;
  contracts.validateInstallationLink(withoutQuote);
  const differentLead = link(); differentLead.quote.leadId = id(2);
  assert.throws(() => contracts.validateInstallationLink(differentLead), { code: 'INVALID_RELATIONSHIP' });
  const mismatchedOrder = link(); mismatchedOrder.job.orderReference = id(200);
  assert.throws(() => contracts.validateInstallationLink(mismatchedOrder), { code: 'UNRESOLVED_ORDER' });
  for (const invalid of ['', ' '+order.id, order.id+' ', 'bad-id', 'id\n']) {
    const value = link(); value.customer.leadId = invalid;
    assert.throws(() => contracts.validateInstallationLink(value), { code: 'INVALID_IDENTITY' });
  }
  for (const revision of [0, -1, 1.5, '1', NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => contracts.validateQuoteReference({ ...quote, businessRevision: revision }),
      { code: 'INVALID_IDENTITY' });
  }
});

test('new roles remain proposals and job status is not inferred from assignment, booking or payment', () => {
  for (const role of ['ADMIN', 'VA']) assert.equal(contracts.isExistingStaffRole(role), true);
  for (const role of ['OPERATIONS', 'SALES', 'pro', '', null]) assert.equal(contracts.isExistingStaffRole(role), false);
  for (const [raw, lifecycle] of [
    ['pending_payment','pending_payment'], ['queued','queued'], ['assigned','assigned'],
    ['in_progress','in_progress'], ['completed','completed'], ['done','completed'],
    ['cancelled','cancelled'], ['canceled','cancelled'],
    ['accepted','unmapped'], ['paid','unmapped'], ['scheduled','unmapped'], ['future_state','unmapped'],
  ]) {
    const observation = contracts.classifyJobStatus(raw);
    assert.equal(observation.raw, raw);
    assert.equal(observation.lifecycle, lifecycle);
  }
});

test('cross-project CRM references require explicit configured provenance, not a second customer registry', () => {
  const projectRef = 'abcdefghijklmnopqrst';
  const value = link();
  value.customer.crmContact = { projectRef, contactId: id(800) };
  assert.throws(() => contracts.validateInstallationLink(value), { code: 'INVALID_RELATIONSHIP' });
  assert.throws(() => contracts.validateInstallationLink(value, 'tsrqponmlkjihgfedcba'), { code: 'INVALID_RELATIONSHIP' });
  contracts.validateInstallationLink(value, projectRef);
});

test('existing dashboard authentication keeps ADMIN/VA behavior and rejects expired or disabled sessions', async () => {
  const user = { User_ID: id(9), Username: 'FIXTURE', Display_Name: 'Fixture Staff', Role: 'ADMIN', Is_Disabled: false };
  const session = { Session_ID: id(90), User_ID: id(9), Expires_At: '2099-01-01T00:00:00Z' };
  let lastSeenWrites = 0;
  const db = { from(table) {
    const builder = {
      select() { return builder; }, eq() { return builder; },
      async maybeSingle() { return { data: table === 'Dashboard_Sessions' ? session : user, error: null }; },
      update() { lastSeenWrites++; return builder; },
    };
    return builder;
  } };
  const auth = evaluate('lib\\dashboardAuth.ts', {
    'node:crypto': require('node:crypto'), '@/lib/supabase': { getSupabaseMgmt: () => db, getSupabase: () => db },
  }, { Buffer });
  const request = new Request('http://fixture.invalid', { headers: { Authorization: 'Bearer fixture-only' } });
  for (const [stored, expected] of [['ADMIN','ADMIN'], ['VA','VA'], ['OPERATIONS','VA'], ['SALES','VA']]) {
    user.Role = stored;
    assert.equal((await auth.getDashboardAuthUserFromSession(request)).role, expected);
  }
  assert.equal(lastSeenWrites, 4, 'Existing authenticated-read side effect is preserved only in a local mock');
  session.Expires_At = '2000-01-01T00:00:00Z';
  assert.equal(await auth.getDashboardAuthUserFromSession(request), null);
  session.Expires_At = '2099-01-01T00:00:00Z'; user.Is_Disabled = true;
  assert.equal(await auth.getDashboardAuthUserFromSession(request), null);
  assert.equal(await auth.getDashboardAuthUserFromSession(new Request('http://fixture.invalid')), null);
  assert.equal(lastSeenWrites, 4);
});

test('legacy Dispatch authorization does not gain access through dashboard sessions', async () => {
  let legacyLookups = 0;
  const auth = evaluate('lib\\adminAuth.ts', {}, { process: { env: {} } });
  const db = { from(table) {
    assert.equal(table, 'h2s_admin_sessions');
    const builder = { select() { return builder; }, eq() { return builder; },
      async single() { legacyLookups++; return { data: null, error: null }; } };
    return builder;
  } };
  const result = await auth.requireAdmin({ request: new Request('http://fixture.invalid', {
    headers: { Authorization: 'Bearer dashboard-fixture-not-a-dispatch-session' },
  }), supabaseClient: db });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(legacyLookups, 1);
});

test('metadata inspection uses read-only transaction, bound table names, rollback and no business row reads', async () => {
  const calls = [];
  const client = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes('to_regclass')) return { rows: [{ name: null }] };
    return { rows: [] };
  } };
  const result = await inspect(client);
  assert.equal(calls[0].sql, 'BEGIN READ ONLY');
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  await assert.rejects(main(['apply']), /Usage:/);
  await assert.rejects(main(['--target', 'production', '--apply']), /Usage:/);
  assert.ok(calls.slice(2, -1).every(call => /^\s*select\b/i.test(call.sql)));
  assert.ok(calls.filter(call => call.params).every(call => call.sql.includes('$1')));
  assert.equal(result.migrations, null);
  assert.ok(result.tables.every(table => table.present === false));
  calls.length = 0;
  client.query = async sql => {
    calls.push({ sql });
    if (/information_schema/.test(sql)) throw new Error('fixture metadata failure');
    return { rows: [] };
  };
  await assert.rejects(inspect(client), /fixture metadata failure/);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
});

test('contracts and schema inspector accept existing sparse dispatch fixture without changing rows', async t => {
  const f = await createOperationsFixture();
  t.after(() => f.db.close());
  const before = (await f.db.query('select to_jsonb(j) as row from h2s_dispatch_jobs j order by job_id')).rows;
  const metadata = await inspect(f.db);
  assert.equal(metadata.tables.find(table => table.name === 'h2s_dispatch_jobs').present, true);
  assert.equal(metadata.tables.find(table => table.name === 'Dashboard_Sessions').present, false);
  assert.ok(metadata.functions.some(fn => fn.name === 'commercial_record_operation'));
  const savedOrder = (await f.db.query('select id,order_id from h2s_orders where id=$1', [order.id])).rows[0];
  const savedJob = (await f.db.query('select job_id,order_id from h2s_dispatch_jobs where job_id=$1', [id(101)])).rows[0];
  contracts.validateInstallationLink({
    customer: { leadId: id(1), market: 'commercial', crmContact: null },
    order: { id: savedOrder.id, orderId: savedOrder.order_id },
    job: { jobId: savedJob.job_id, orderReference: savedJob.order_id }, quote: null,
  });
  assert.deepEqual((await f.db.query('select to_jsonb(j) as row from h2s_dispatch_jobs j order by job_id')).rows, before);
});

test('technician payout response preserves its envelope, ownership filter and approval/settlement distinction', async t => {
  const f = await createOperationsFixture();
  t.after(() => f.db.close());
  await f.db.exec("alter table h2s_payouts_ledger add column state text");
  await f.db.query(`insert into h2s_jobs(job_id,status) values($1,'completed')`, [id(102)]);
  await f.db.query(`insert into h2s_payouts_ledger(job_id,pro_id,payout_type,amount,total_amount,status,state)
    values($1,$2,'job',420,420,'pending','approved'),($3,$4,'job',99,99,'pending','pending')`,
  [id(101),id(500),id(102),id(502)]);
  const route = evaluate('app\\api\\portal_payouts\\route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/supabase': { getSupabase: () => f.client, getSupabaseDispatch: () => f.client },
    '@/lib/auth': { verifyPortalToken: async token => token === 'fixture-pro'
      ? { ok: true, payload: { role: 'pro', sub: id(500) } } : { ok: false } },
  });
  const invoke = token => route.GET(new Request('http://fixture.invalid/api/portal_payouts', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }));
  assert.equal((await invoke(null)).status, 401);
  const response = await invoke('fixture-pro'), body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0].pro_id, id(500));
  assert.equal(body.rows[0].state, 'approved');
  assert.equal(body.rows[0].payout_status, 'approved');
  assert.equal(body.rows[0].amount, 420);
  const saved = (await f.db.query('select status,state from h2s_payouts_ledger where pro_id=$1', [id(500)])).rows[0];
  assert.equal(saved.status, 'pending', 'Portal response normalization is not a recorded transfer');
  assert.equal(saved.state, 'approved');
});
