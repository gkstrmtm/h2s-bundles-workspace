const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { evaluate, id } = require('./helpers/commercial_operations_fixture.cjs');
const contracts = evaluate('lib\\operationsFoundation.ts', {});
const adapter = evaluate('lib\\managementOperations.ts', { '@/lib/operationsFoundation': contracts });

function authFixture() {
  const user = { User_ID: id(9), Username: 'FIXTURE', Display_Name: 'Fixture', Role: 'ADMIN', Is_Disabled: false };
  const session = { Session_ID: id(90), User_ID: user.User_ID, Expires_At: '2099-01-01T00:00:00Z' };
  const calls = [];
  const db = { from(table) {
    calls.push(table);
    let tokenHash = null;
    const builder = {
      select() { return builder; },
      eq(column, value) { if (column === 'Token_Hash') tokenHash = value; return builder; },
      update() { calls.push('WRITE'); return builder; },
      async maybeSingle() {
        const valid = tokenHash === require('node:crypto').createHash('sha256').update('fixture-session').digest('base64url');
        return { data: table === 'Dashboard_Sessions' ? valid ? session : null : user, error: null };
      },
    };
    return builder;
  } };
  const auth = evaluate('lib\\dashboardAuth.ts', {
    'node:crypto': require('node:crypto'), '@/lib/supabase': { getSupabaseMgmt: () => db, getSupabase: () => db },
  }, { Buffer });
  const permissions = evaluate('lib\\dashboardPermissions.ts', { '@/lib/dashboardAuth': auth });
  return { user, session, calls, auth, permissions };
}
const request = (query = '', token = 'fixture-session') => new Request(`https://fixture.invalid/api/management-operations${query}`,
  { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test('new guards authorize ADMIN, deny VA/future roles and preserve existing session behavior', async () => {
  const f = authFixture();
  assert.equal((await f.permissions.requireDashboardCapability(request(), 'operations.read')).role, 'ADMIN');
  assert.ok(!f.calls.includes('WRITE'), 'Management authentication is read-only');
  await f.auth.getDashboardAuthUserFromSession(request());
  assert.equal(f.calls.filter(call => call === 'WRITE').length, 1, 'Legacy callers still touch the session');
  for (const role of ['VA', 'OPERATIONS', 'SALES', 'OTHER']) {
    f.user.Role = role;
    await assert.rejects(f.permissions.requireDashboardCapability(request(), 'operations.read'), { status: role === 'VA' ? 403 : 401 });
  }
  for (const role of ['OPERATIONS', 'SALES', '__proto__', 'constructor', '']) {
    assert.equal(f.permissions.hasDashboardCapability(role, 'operations.read'), false);
  }
  assert.equal(f.permissions.mayReadOwnedRecord({ role: 'VA', userId: id(9) }, 'quotes.owned.read', id(9)), false);
  assert.equal(f.permissions.mayReadOwnedRecord({ role: 'ADMIN', userId: id(9) }, 'customers.owned.read', null), true);
  f.user.Role = 'ADMIN'; f.user.Is_Disabled = true;
  await assert.rejects(f.permissions.requireDashboardCapability(request(), 'operations.read'), { status: 401 });
  f.user.Is_Disabled = false; f.session.Expires_At = '2000-01-01T00:00:00Z';
  await assert.rejects(f.permissions.requireDashboardCapability(request(), 'operations.read'), { status: 401 });
  await assert.rejects(f.permissions.requireDashboardCapability(request('', ''), 'operations.read'), { status: 401 });
  assert.equal(f.calls.filter(call => call === 'WRITE').length, 1);
});

test('management GET authenticates before reads, bounds input, rejects legacy tokens and never caches', async () => {
  const f = authFixture(); let reads = 0;
  const route = evaluate('app\\api\\management-operations\\route.ts', {
    stripe: class Stripe {},
    '@/lib/supabase': { getSupabase() { reads++; return {}; } },
    '@/lib/adminAuth': { corsHeaders: () => ({}) },
    '@/lib/dashboardPermissions': f.permissions,
    '@/lib/managementOperations': { ...adapter, readManagementOperations: async () => ({ jobs: [], readOnly: true }) },
    '@/lib/commercial_payment': { verifyCommercialPayment() { throw Error('Unexpected payment call'); } },
    '@/lib/managementAssignments': { managementAssignmentsEnabled: () => false },
  });
  for (const role of ['VA', 'OPERATIONS', 'SALES']) {
    f.user.Role = role;
    assert.equal((await route.GET(request())).status, role === 'VA' ? 403 : 401);
  }
  assert.equal((await route.GET(request('', ''))).status, 401);
  f.user.Role = 'ADMIN';
  for (const query of ['?limit=0', '?limit=26', '?offset=-1', '?offset=10001', '?offset=1.5', '?limit=NaN', '?write=true',
    '?jobId=invalid&limit=1', `?jobId=${id(101)}`, `?jobId=${id(101)}&limit=1&offset=25`, '?limit=1&limit=2']) {
    assert.equal((await route.GET(request(query))).status, 400, query);
  }
  assert.equal(reads, 0);
  const response = await route.GET(request('?offset=25&limit=25'));
  assert.equal(response.status, 200); assert.equal(reads, 1);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.match(response.headers.get('vary'), /Authorization/);
  assert.equal(f.calls.includes('WRITE'), false);
  assert.equal((await route.GET(request(`?jobId=${id(101)}&limit=1`))).status, 200);
  assert.equal(route.POST, undefined); assert.equal(route.PATCH, undefined); assert.equal(route.DELETE, undefined);
  // A fixed legacy token is not resolved through Dashboard_Sessions.
  assert.equal((await route.GET(request('', 'legacy-admin-token'))).status, 401);
});

async function databaseFixture() {
  const db = new PGlite(), calls = [], faults = {};
  await db.exec(`
    create table h2s_dispatch_jobs(job_id uuid primary key,order_id text,status text,due_at timestamptz,updated_at timestamptz default now());
    create table h2s_orders(id uuid primary key,order_id text unique,total numeric,currency text,session_id text,payment_intent_id text,
      customer_email text,customer_name text,service_name text,address text,city text,commercial_request_id uuid,items text,metadata_json jsonb);
    create table h2s_dispatch_job_assignments(assign_id text primary key,job_id text,pro_id text,state text);
    create table h2s_pros(pro_id uuid primary key,name text,email text unique);
    create table h2s_jobs(job_id text primary key,customer_email text);
    create table h2s_dispatch_legacy_job_links(dispatch_job_id uuid primary key,legacy_job_id text unique);
    create table h2s_payouts_ledger(payout_id uuid primary key,job_id text references h2s_jobs(job_id),
      pro_id uuid references h2s_pros(pro_id),status text,state text,amount numeric,payout_type text);
  `);
  async function seed() {
    await db.exec(`
      truncate h2s_dispatch_legacy_job_links,h2s_payouts_ledger,h2s_jobs,h2s_pros,h2s_dispatch_job_assignments,h2s_orders,h2s_dispatch_jobs;
      insert into h2s_dispatch_jobs values('${id(101)}','ORD-FIXTURE','assigned','2099-01-01T15:00:00Z',now());
      insert into h2s_orders values('${id(100)}','ORD-FIXTURE',1200,'usd','cs_fixture','pi_fixture',
        'fixture@example.invalid','Fixture Customer','TV installation','100 Fixture Lane','Fixture City',null,
        '[{"name":"TV mount","quantity":2}]','{"order_required":true,"order_stage":"delivered","private_secret":"must not project"}');
      insert into h2s_dispatch_job_assignments values('assignment-fixture','${id(101)}','${id(500)}','accepted');
      insert into h2s_pros values('${id(500)}','Fixture Installer','tech@example.invalid'),('${id(501)}','Other Installer','other@example.invalid');
      insert into h2s_jobs values('${id(101)}','fixture@example.invalid');
      insert into h2s_dispatch_legacy_job_links values('${id(101)}','${id(101)}');
      insert into h2s_payouts_ledger values('${id(600)}','${id(101)}','${id(500)}','pending','approved',420,'job');
    `);
    for (const key of Object.keys(faults)) delete faults[key];
    calls.length = 0;
  }
  const client = {
    from(table) {
      assert.match(table, /^h2s_/);
      let columns = '*', count = false, filters = [], params = [], orders = [], limit = 1000, offset = 0;
      const builder = {
        select(value, opts) { columns = value; count = opts?.count === 'exact'; return builder; },
        in(column, values) {
          filters.push(`"${column}" in (${values.map(value => { params.push(value); return '$' + params.length; }).join(',')})`); return builder;
        },
        order(column, options) { orders.push(`"${column}" ${options?.ascending === false ? 'desc' : 'asc'}`); return builder; },
        limit(value) { limit = value; return builder; },
        range(start, end) { offset = start; limit = end - start + 1; return builder; },
        async then(resolve, reject) {
          try {
            calls.push(['select', table]);
            if (faults[table] === 'throw') throw Error('Fixture source transport failure');
            if (faults[table] === 'error') return resolve({ data: null, error: { code: 'FIXTURE_UNAVAILABLE' } });
            const where = filters.length ? ' where ' + filters.join(' and ') : '';
            const sql = `select ${columns} from "${table}"${where}${orders.length ? ' order by ' + orders.join(',') : ''} limit ${limit} offset ${offset}`;
            const result = await db.query(sql, params);
            const total = count ? (await db.query(`select count(*)::int as n from "${table}"${where}`, params)).rows[0].n : null;
            return resolve({ data: result.rows, error: null, count: faults[table] === 'truncated' ? 1002 : total });
          } catch (error) { return reject(error); }
        },
      };
      return new Proxy(builder, { get(target, key) {
        assert.ok(key in target, `Write or unsupported database operation blocked: ${String(key)}`); return target[key];
      } });
    },
    rpc(name, args) {
      calls.push(['rpc', name, args]);
      assert.equal(name, 'h2s_job_readiness', 'Only the established SELECT-only readiness RPC is allowed');
      if (faults.readiness === 'error') return Promise.resolve({ data: null, error: { code: 'READINESS_UNAVAILABLE' } });
      return Promise.resolve({ data: faults.readiness === 'shape' ? {} : { ready: true, blockers: [] }, error: null });
    },
  };
  let paymentCalls = 0;
  const read = () => adapter.readManagementOperations(client, { offset: 0, limit: 25,
    async verifyPayment() { paymentCalls++; if (faults.payment) throw Error('Fixture Stripe unavailable');
      return { status: 'paid', detail: 'Verified fixture only' }; } });
  return { db, calls, faults, seed, client, read, paymentCalls: () => paymentCalls };
}

test('read-only adapter verifies sparse dispatch/order/assignment/payout relationships and failure states', async t => {
  const f = await databaseFixture();
  try {
    await t.test('selected job read targets its exact identity and never substitutes another page record', async () => {
      await f.seed();
      await f.db.exec(`insert into h2s_dispatch_jobs(job_id,order_id,status) values('${id(102)}','missing-order','queued')`);
      const read = jobId => adapter.readManagementOperations(f.client, { offset: 0, limit: 1, jobId,
        verifyPayment: async () => ({ status: 'unverified', detail: 'Fixture selected read' }) });
      assert.equal((await read(id(102))).jobs[0].jobId, id(102));
      assert.equal((await read(id(101))).jobs[0].order.value.customerName, 'Fixture Customer');
      assert.equal((await read(id(999))).jobs.length, 0);
      assert.ok(f.calls.every(call => ['select', 'rpc'].includes(call[0])));
    });
    await t.test('verified bridge retains equipment, schedule, assignment and separate approval/settlement evidence', async () => {
      await f.seed();
      const before = (await f.db.query('select * from h2s_payouts_ledger')).rows;
      const result = await f.read(), job = result.jobs[0];
      assert.equal(result.readOnly, true); assert.equal(job.order.value.id, id(100));
      assert.equal(job.assignments.value[0].proId, id(500)); assert.equal(job.equipment.value.required, true);
      assert.match(job.equipment.value.scope, /"quantity":2/); assert.ok(job.scheduledAt);
      assert.equal(job.preparation.value.ready, true); assert.equal(job.payment.status, 'paid');
      assert.equal(job.payouts.value[0].status, 'pending'); assert.equal(job.payouts.value[0].state, 'approved');
      assert.doesNotMatch(JSON.stringify(result), /private_secret|customer_email|session_id|payment_intent_id/);
      assert.deepEqual((await f.db.query('select * from h2s_payouts_ledger')).rows, before);
      assert.ok(f.calls.every(call => ['select', 'rpc'].includes(call[0])));
    });
    await t.test('UUID order reference resolves but ambiguous and missing references do not', async () => {
      await f.seed(); await f.db.exec(`update h2s_dispatch_jobs set order_id='${id(100)}'`);
      assert.equal((await f.read()).jobs[0].order.value.reference, 'ORD-FIXTURE');
      await f.db.exec(`insert into h2s_orders(id,order_id) values('${id(200)}','${id(100)}')`);
      assert.equal((await f.read()).jobs[0].order.status, 'needs_review');
      await f.db.exec("update h2s_dispatch_jobs set order_id='missing'");
      assert.equal((await f.read()).jobs[0].kind, 'unresolved');
    });
    await t.test('same email or same job key alone cannot create a payout bridge', async () => {
      await f.seed(); await f.db.exec(`update h2s_jobs set customer_email='wrong@example.invalid'`);
      assert.equal((await f.read()).jobs[0].payouts.status, 'needs_review');
      assert.ok(!f.calls.some(call => call[1] === 'h2s_payouts_ledger'));
      await f.db.exec(`delete from h2s_payouts_ledger; update h2s_jobs set job_id='different-legacy-job',customer_email='fixture@example.invalid'`);
      assert.equal((await f.read()).jobs[0].payouts.status, 'needs_review');
    });
    await t.test('wrong beneficiary, duplicate assignments and unresolved technicians require reconciliation', async () => {
      await f.seed(); await f.db.exec(`update h2s_payouts_ledger set pro_id='${id(501)}'`);
      assert.equal((await f.read()).jobs[0].payouts.status, 'needs_review');
      await f.db.exec(`insert into h2s_dispatch_job_assignments values('duplicate','${id(101)}','${id(501)}','assigned')`);
      assert.equal((await f.read()).jobs[0].assignments.value.length, 2);
      assert.equal((await f.read()).jobs[0].payouts.status, 'needs_review');
      await f.seed(); await f.db.exec(`update h2s_dispatch_job_assignments set pro_id='unknown-tech'`);
      assert.equal((await f.read()).jobs[0].assignments.value[0].proId, null);
      assert.equal((await f.read()).jobs[0].payouts.status, 'needs_review');
    });
    await t.test('exact legacy technician email resolves, and completed assignments retain payout attribution', async () => {
      await f.seed(); await f.db.exec(`update h2s_dispatch_job_assignments set pro_id='tech@example.invalid',state='completed';
        update h2s_dispatch_jobs set status='completed'`);
      assert.equal((await f.read()).jobs[0].payouts.value[0].pro_id, id(500));
    });
    await t.test('pending offers remain visible but are not accepted payout attribution', async () => {
      await f.seed(); await f.db.exec("update h2s_dispatch_job_assignments set state='pending'");
      const job = (await f.read()).jobs[0];
      assert.equal(job.assignments.value[0].rawState, 'pending');
      assert.equal(job.payouts.status, 'needs_review');
    });
    await t.test('same keys and email are insufficient; reviewed links can reference different legacy keys', async () => {
      await f.seed(); await f.db.exec('delete from h2s_dispatch_legacy_job_links');
      assert.equal((await f.read()).jobs[0].payouts.status, 'needs_review');
      await f.db.exec(`insert into h2s_jobs values('LEGACY-FIXTURE','fixture@example.invalid');
        update h2s_payouts_ledger set job_id='LEGACY-FIXTURE';
        insert into h2s_dispatch_legacy_job_links values('${id(101)}','LEGACY-FIXTURE');`);
      assert.equal((await f.read()).jobs[0].payouts.value[0].job_id, 'LEGACY-FIXTURE');
    });
    await t.test('consultations never masquerade as paid installations or run installation preparation', async () => {
      await f.seed(); const before = f.paymentCalls();
      await f.db.exec(`update h2s_orders set commercial_request_id='${id(201)}'`);
      const job = (await f.read()).jobs[0];
      assert.equal(job.kind, 'consultation'); assert.equal(job.payment.status, 'not_applicable');
      assert.equal(f.paymentCalls(), before); assert.ok(!f.calls.some(call => call[0] === 'rpc'));
    });
    await t.test('existing Stripe GET verifier distinguishes full payments, refunds and disputes', async () => {
      await f.seed();
      const { verifyCommercialPayment } = evaluate('lib\\commercial_payment.ts', {});
      for (const [refund, disputed, expected] of [[0,false,'paid'],[1,false,'partially_refunded'],[120000,false,'refunded'],[0,true,'disputed']]) {
        const stripe = {
          checkout: { sessions: { retrieve: async () => ({ amount_total: 120000, currency: 'usd', payment_intent: 'pi_fixture' }) } },
          paymentIntents: { retrieve: async () => ({ amount: 120000, amount_received: 120000, currency: 'usd', status: 'succeeded',
            latest_charge: { disputed, amount_refunded: refund } }) },
        };
        const result = await adapter.readManagementOperations(f.client, { offset: 0, limit: 25,
          verifyPayment: order => verifyCommercialPayment(order, stripe) });
        assert.equal(result.jobs[0].payment.status, expected);
      }
    });
    await t.test('missing auxiliary sources and provider failures are explicit, not false clear states', async () => {
      for (const [table, property] of [['h2s_orders','order'], ['h2s_dispatch_job_assignments','assignments'],
        ['h2s_pros','assignments'], ['h2s_jobs','payouts'], ['h2s_payouts_ledger','payouts'], ['h2s_dispatch_legacy_job_links','payouts']]) {
        await f.seed(); f.faults[table] = 'error';
        assert.notEqual((await f.read()).jobs[0][property].status, 'available', table);
      }
      await f.seed(); f.faults.readiness = 'error'; f.faults.payment = true;
      let job = (await f.read()).jobs[0];
      assert.equal(job.preparation.status, 'unavailable'); assert.equal(job.payment.status, 'unavailable');
      f.faults.readiness = 'shape'; job = (await f.read()).jobs[0];
      assert.equal(job.preparation.status, 'needs_review');
      await f.seed(); f.faults.h2s_orders = 'throw';
      assert.equal((await f.read()).jobs[0].order.status, 'unavailable');
    });
    await t.test('truncated relationships are rejected, primary failure fails the read, empty reads avoid auxiliary calls', async () => {
      await f.seed(); f.faults.h2s_dispatch_job_assignments = 'truncated';
      assert.equal((await f.read()).jobs[0].assignments.status, 'needs_review');
      await f.seed(); f.faults.h2s_dispatch_jobs = 'error';
      await assert.rejects(f.read(), /Dispatch jobs could not be verified/);
      await f.seed(); await f.db.exec('delete from h2s_dispatch_jobs');
      assert.equal((await f.read()).jobs.length, 0); assert.equal(f.calls.length, 1);
    });
    await t.test('bounded pages use existing updated_at, stable job IDs, and a lookahead row', async () => {
      await f.seed();
      const first = await adapter.readManagementOperations(f.client, { offset: 0, limit: 1, verifyPayment: async () => ({ status: 'unverified', detail: 'Fixture' }) });
      assert.equal(first.page.hasMore, false);
      await f.db.exec(`insert into h2s_dispatch_jobs(job_id,order_id,status) values('${id(102)}','ORD-FIXTURE','queued')`);
      const next = await adapter.readManagementOperations(f.client, { offset: 0, limit: 1, verifyPayment: async () => ({ status: 'unverified', detail: 'Fixture' }) });
      assert.equal(next.page.hasMore, true); assert.equal(next.jobs.length, 1);
    });
  } finally { await f.db.close(); }
});
