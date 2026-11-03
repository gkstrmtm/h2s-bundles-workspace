const test = require('node:test'), assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { evaluate, functions } = require('./helpers/commercial_operations_fixture.cjs');
const { schema, migration, reliability, context, assign, respond, id } = require('./helpers/management_assignment_fixture.cjs');
const service = evaluate('lib\\managedOfferResponse.ts', {});
async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(schema); await db.exec(migration); await db.exec(reliability);
  await db.exec('update h2s_management_assignment_config set enabled=true'); await assign(db);
  const state = { role: 'pro', sub: id(500), auth: true, rpcFailure: null, calls: 0 };
  const client = {
    from(table) {
      assert.ok(['h2s_management_assignment_requests', 'h2s_dispatch_jobs', 'h2s_dispatch_job_assignments'].includes(table));
      let job;
      const builder = { select() { return builder; }, eq(column, value) { assert.equal(column, 'job_id'); job = value; return builder; },
        async limit() { return { data: (await db.query(table === 'h2s_dispatch_jobs'
          ? 'select job_id,status from h2s_dispatch_jobs where job_id=$1 limit 1'
          : table === 'h2s_dispatch_job_assignments'
            ? 'select assign_id from h2s_dispatch_job_assignments where job_id=$1 limit 101'
            : 'select job_id from h2s_management_assignment_requests where job_id=$1 limit 1', [job])).rows }; } };
      return builder;
    },
    async rpc(name, input) {
      assert.equal(name, 'h2s_management_respond_to_offer'); state.calls++;
      if (state.rpcFailure === 'INVALID_SHAPE') return { data: { assignment: { state: 'accepted' } } };
      if (state.rpcFailure) return { error: { code: state.rpcFailure } };
      try { return { data: await respond(db, { job: input.p_job_id, pro: input.p_pro_id, action: input.p_action }) }; }
      catch (error) { return { error: { code: error.code } }; }
    },
  };
  const imports = {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/supabase': { getSupabaseDispatch: () => client },
    '@/lib/auth': { verifyPortalToken: async token => ({ ok: state.auth && !!token, payload: { role: state.role, sub: state.sub } }) },
    '@/lib/config': { getConfig: () => ({}) },
    '@/lib/dispatchSchema': { resolveDispatchSchema: () => assert.fail('Managed offers cannot use legacy mutation fallbacks') },
    '@/lib/mail': { sendMail: () => assert.fail('Managed responses must not send email') },
    '@/lib/managedOfferResponse': service,
  };
  const accept = evaluate('app\\api\\portal_accept\\route.ts', imports), decline = evaluate('app\\api\\portal_decline\\route.ts', imports);
  const request = (method = 'POST', token = 'fixture-pro') => new Request(`https://fixture.invalid/api/portal_accept?token=${token}&job_id=${id(101)}`,
    method === 'POST' ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, job_id: id(101) }) } : {});
  return { db, state, client, accept, decline, request };
}
test('managed responses preserve portal POST/GET envelopes, acceptance grouping, actor audit and flag-off completion', async t => {
  const f = await fixture(t);
  const { groupByState } = functions('app\\api\\portal_jobs\\route.ts', ['groupByState']);
  assert.equal(groupByState([{ status: 'queued', assign_state: 'pending' }]).offers.length, 1);
  await f.db.exec('update h2s_management_assignment_config set enabled=false');
  const result = await f.accept.POST(f.request());
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.ok, true); assert.equal(body.created, false); assert.equal(body.assignment.state, 'accepted');
  assert.equal(body.job_status, 'assigned'); assert.equal(body.replayed, false);
  assert.equal(groupByState([{ status: body.job_status, assign_state: body.assignment.state }]).upcoming.length, 1);
  assert.equal(body.meta.assignments_state_col, 'state'); assert.equal(body.is_team_job, false);
  assert.equal((await (await f.accept.GET(f.request('GET'))).json()).replayed, true);
  const audit = (await f.db.query("select * from h2s_management_assignment_activity where source='technician_response'")).rows;
  assert.equal(audit.length, 1); assert.equal(audit[0].actor_pro_id, id(500)); assert.equal(audit[0].actor_user_id, null);
  assert.equal((await f.db.query('select count(*)::int n from h2s_payouts_ledger')).rows[0].n, 0);
  assert.equal((await f.db.query("select accepted_at is not null stamped from h2s_dispatch_job_assignments")).rows[0].stamped, true);
  const calls = f.state.calls;
  assert.equal(await service.respondToManagedOffer(f.client, id(102), id(500), 'accept'), null);
  assert.equal(f.state.calls, calls, 'Existing unenrolled offers remain on their established handler');
  assert.equal((await service.respondToManagedOffer(f.client, id(999), id(500), 'accept')).status, 404);
  assert.equal((await service.respondToManagedOffer(f.client, 'arbitrary-legacy-key', id(500), 'decline')).status, 400);
});
test('managed decline is durable and idempotent, cannot become accepted, and can be offered again without erasing history', async t => {
  const f = await fixture(t);
  assert.equal((await f.decline.POST(f.request())).status, 200);
  assert.equal((await (await f.decline.GET(f.request('GET'))).json()).replayed, true);
  assert.equal((await f.accept.POST(f.request())).status, 409);
  assert.equal((await f.db.query('select status from h2s_dispatch_jobs where job_id=$1', [id(101)])).rows[0].status, 'queued');
  await assign(f.db, { operation: id(701) });
  assert.equal((await f.accept.POST(f.request())).status, 200);
  assert.equal((await f.db.query('select count(*)::int n from h2s_dispatch_job_assignments')).rows[0].n, 2);
});
test('unauthorized, inactive, wrong-owner, terminal and database-failure responses do not fall through or report success', async t => {
  const f = await fixture(t);
  for (const role of ['ADMIN', 'VA', 'OPERATIONS', 'SALES']) {
    f.state.role = role; assert.equal((await f.accept.POST(f.request())).status, 401);
  }
  f.state.role = 'pro';
  assert.equal((await f.accept.POST(f.request('POST', ''))).status, 401); assert.equal(f.state.calls, 0);
  for (const sub of [id(501), id(502), 'legacy-text-identity']) {
    f.state.sub = sub; assert.equal((await f.accept.POST(f.request())).status, 403);
  }
  f.state.sub = id(500);
  for (const code of ['PGRST202', '08006', '40001', '40P01', '55P03', 'INVALID_SHAPE']) {
    f.state.rpcFailure = code; const response = await f.accept.POST(f.request());
    assert.equal(response.status, ['40001', '40P01', '55P03'].includes(code) ? 409 : 503);
    assert.equal((await response.json()).ok, false);
  }
  f.state.rpcFailure = null;
  await f.db.query("update h2s_dispatch_jobs set status='cancelled' where job_id=$1", [id(101)]);
  assert.equal((await f.accept.POST(f.request())).status, 409);
  assert.equal((await f.db.query('select count(*)::int n from h2s_management_assignment_activity')).rows[0].n, 1);
});
test('missing migration or stale schema cache cannot bypass managed offer ownership, even with creation flags off', async () => {
  let rpc = 0;
  const missing = { from: () => ({ select() { return this; }, eq() { return this; }, async limit() { return { error: { code: '42P01' } }; } }),
    rpc() { rpc++; } };
  assert.equal((await service.respondToManagedOffer(missing, id(101), id(500), 'accept')).status, 503);
  const enabled = evaluate('lib\\managedOfferResponse.ts', {}, { process: { env: { H2S_MANAGEMENT_ASSIGNMENTS_ENABLED: 'true' } } });
  assert.equal((await enabled.respondToManagedOffer(missing, id(101), id(500), 'accept')).status, 503);
  assert.equal(rpc, 0);
  const legacyOnly = { from(table) {
    assert.ok(['h2s_dispatch_job_assignments', 'h2s_dispatch_jobs'].includes(table), 'Default-off legacy operation must not require unapplied tables');
    return { select() { return this; }, eq() { return this; },
      async limit() { return { data: table === 'h2s_dispatch_jobs' ? [{ job_id: id(101), status: 'queued' }] : [{ assign_id: 'legacy-offer' }] }; } };
  }, rpc() { assert.fail('Default-off legacy read cannot write'); } };
  assert.equal(await service.respondToManagedOffer(legacyOnly, id(101), id(500), 'accept'), null);
  const markedMissingSchema = { ...legacyOnly, from(table) {
    if (table === 'h2s_management_assignment_requests') return missing.from(table);
    return { select() { return this; }, eq() { return this; }, async limit() { return { data: [{ assign_id: 'h2s-management:fixture' }] }; } };
  } };
  assert.equal((await service.respondToManagedOffer(markedMissingSchema, id(101), id(500), 'accept')).status, 503);
});
test('042 mapping and response writes are service-only; no mapping is inferred or inserted by responses', async t => {
  const f = await fixture(t);
  const grants = (await f.db.query(`select
    has_function_privilege('authenticated','h2s_management_respond_to_offer(uuid,uuid,text)','execute') browser,
    has_function_privilege('service_role','h2s_management_respond_to_offer(uuid,uuid,text)','execute') service,
    has_table_privilege('service_role','h2s_dispatch_legacy_job_links','insert') link_write`)).rows[0];
  assert.equal(grants.browser, false); assert.equal(grants.service, true); assert.equal(grants.link_write, false);
  assert.equal((await f.db.query('select count(*)::int n from h2s_dispatch_legacy_job_links')).rows[0].n, 0);
  await f.db.query('insert into h2s_jobs values($1,$2)', [id(101), 'fixture@example.invalid']);
  assert.equal((await context(f.db)).legacyPayoutBridge, false, 'Matching IDs and email do not prove a payout bridge');
  await f.db.query(`insert into h2s_dispatch_legacy_job_links(dispatch_job_id,legacy_job_id,evidence_basis,evidence_reference,reviewed_by_user_id)
    values($1,$2,'reviewed_reconciliation','Isolated fixture review',$3)`, [id(101), id(101), id(9)]);
  assert.equal((await context(f.db)).legacyPayoutBridge, true);
});
