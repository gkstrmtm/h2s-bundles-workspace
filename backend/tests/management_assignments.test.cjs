const test = require('node:test'), assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { evaluate, functions } = require('./helpers/commercial_operations_fixture.cjs');
const { schema, migration, reliability, preview, context, assign, respond, id } = require('./helpers/management_assignment_fixture.cjs');

async function fixture(t, enabled = true) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(schema); await db.exec(migration);
  if (enabled) await db.exec('update h2s_management_assignment_config set enabled=true');
  return db;
}
test('041 is default-off, service-only, and never alters existing jobs or payout records', async t => {
  const db = await fixture(t, false);
  assert.equal((await preview(db)).enabled, false);
  await assert.rejects(assign(db), { code: '42501' });
  assert.equal((await db.query('select count(*)::int n from h2s_management_assignment_requests')).rows[0].n, 0);
  const grants = (await db.query(`select has_function_privilege('anon','h2s_management_assign_technician(uuid,uuid,uuid,uuid,text,text)','execute') anon,
    has_function_privilege('authenticated','h2s_management_assign_technician(uuid,uuid,uuid,uuid,text,text)','execute') authenticated,
    has_function_privilege('service_role','h2s_management_assign_technician(uuid,uuid,uuid,uuid,text,text)','execute') service,
    has_table_privilege('service_role','h2s_management_assignment_activity','insert') direct_audit_write`)).rows[0];
  assert.equal(grants.anon, false); assert.equal(grants.authenticated, false);
  assert.equal(grants.service, true); assert.equal(grants.direct_audit_write, false);
  assert.equal((await db.query('select count(*)::int n from h2s_payouts_ledger')).rows[0].n, 0);
});
test('pending offers retain portal acceptance, audit identities, retry keys and original job/order/payout identities', async t => {
  const db = await fixture(t);
  const before = (await db.query('select * from h2s_orders')).rows;
  const review = await preview(db);
  assert.equal(review.job.eligible, true); assert.equal(review.technicians.length, 2);
  const input = { snapshot: review.job.context };
  const result = await assign(db, input);
  assert.equal(result.state, 'pending'); assert.equal(result.requiresAcceptance, true);
  assert.equal((await assign(db, input)).replayed, true);
  await assert.rejects(assign(db, { ...input, pro: id(501) }), { code: '23505' });
  assert.equal((await db.query('select count(*)::int n from h2s_dispatch_job_assignments')).rows[0].n, 1);
  const audit = (await db.query('select * from h2s_management_assignment_activity')).rows;
  assert.equal(audit.length, 1); assert.equal(audit[0].actor_user_id, id(9)); assert.equal(audit[0].operation_id, id(700));
  assert.equal(audit[0].new_state, 'pending'); assert.equal(audit[0].source, 'management');
  const portal = functions('app\\api\\portal_jobs\\route.ts', ['groupByState']);
  assert.equal(portal.groupByState([{ status: 'queued', assign_state: result.state }]).offers.length, 1);
  // Exercise the existing accept handler against the actual migrated schema.
  const builder = table => {
    let patch, filters = [], params = [];
    const b = { select() { return b; }, update(value) { patch = value; return b; },
      eq(key, value) { params.push(value); filters.push(`"${key}"=$${params.length}`); return b; },
      limit() { return b; },
      async then(resolve) {
        try {
          if (!patch) return resolve({ data: [], error: null });
          const sets = Object.entries(patch).map(([key, value]) => { params.push(value); return `"${key}"=$${params.length}`; });
          const rows = await db.query(`update "${table}" set ${sets.join(',')} where ${filters.join(' and ')} returning *`, params);
          resolve({ data: rows.rows, error: null });
        } catch (error) { resolve({ data: null, error }); }
      }, async single() { return { data: null, error: { code: 'FIXTURE_NO_EMAIL' } }; },
    }; return b;
  };
  const accept = evaluate('app\\api\\portal_accept\\route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/supabase': { getSupabaseDispatch: () => ({ from: builder }) },
    '@/lib/auth': { verifyPortalToken: async () => ({ ok: true, payload: { role: 'pro', sub: id(500), email: 'tech@example.invalid' } }) },
    '@/lib/config': { getConfig: () => ({}) },
    '@/lib/dispatchSchema': { resolveDispatchSchema: async () => ({
      assignmentsTable: 'h2s_dispatch_job_assignments', assignmentsProCol: 'pro_id', assignmentsJobCol: 'job_id',
      assignmentsStateCol: 'state', jobsTable: 'h2s_dispatch_jobs', jobsIdCol: 'job_id', jobsStatusCol: 'status',
    }) },
    '@/lib/mail': { sendMail: async () => assert.fail('Assignment test must never send mail') },
    '@/lib/managedOfferResponse': { respondToManagedOffer: async () => null },
  });
  const accepted = await accept.POST(new Request('https://fixture.invalid/api/portal_accept', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'fixture-pro', job_id: id(101) }) }));
  assert.equal(accepted.status, 200);
  const row = (await db.query('select * from h2s_dispatch_job_assignments')).rows[0];
  assert.equal(row.state, 'accepted');
  assert.equal(portal.groupByState([{ status: 'queued', assign_state: row.state }]).upcoming.length, 1);
  assert.equal((await db.query('select status from h2s_dispatch_jobs where job_id=$1', [id(101)])).rows[0].status, 'assigned',
    'Legacy acceptance now uses the actual dispatch CHECK status');
  await db.query("update h2s_dispatch_jobs set status='queued' where job_id=$1", [id(101)]);
  await db.exec(`create function fixture_legacy_status_failure() returns trigger language plpgsql as $$
    begin if NEW.status='assigned' then raise exception 'Fixture legacy status failure'; end if; return NEW; end$$;
    create trigger fixture_legacy_fail before update on h2s_dispatch_jobs for each row execute function fixture_legacy_status_failure();`);
  const retryRequest = () => new Request('https://fixture.invalid/api/portal_accept', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'fixture-pro', job_id: id(101) }) });
  assert.equal((await accept.POST(retryRequest())).status, 503, 'Legacy partial failures must not report success or create another assignment');
  await db.exec('drop trigger fixture_legacy_fail on h2s_dispatch_jobs');
  assert.equal((await accept.POST(retryRequest())).status, 200);
  assert.equal((await db.query('select count(*)::int n from h2s_dispatch_job_assignments')).rows[0].n, 1);
  const updatedAudit = (await db.query('select * from h2s_management_assignment_activity order by created_at,event_id')).rows;
  assert.equal(updatedAudit.length, 2);
  const external = updatedAudit.find(row => row.source === 'existing_assignment_handler');
  assert.equal(external.actor_user_id, null); assert.equal(external.new_state, 'accepted');
  const history = (await preview(db)).history;
  assert.equal(history.length, 2);
  assert.equal(history.find(event => event.source === 'management').note, input.note || 'Reviewed fixture technician offer');
  assert.deepEqual((await db.query('select * from h2s_orders')).rows, before);
  assert.equal((await db.query('select count(*)::int n from h2s_jobs')).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from h2s_payouts_ledger')).rows[0].n, 0);
});
test('eligibility rejects invalid technicians, stale reviews, consultations, duplicate offers and terminal jobs', async t => {
  const db = await fixture(t);
  for (const pro of [id(999), id(502), id(503)]) await assert.rejects(assign(db, { pro }), { code: '22023' });
  const old = await context(db);
  await db.exec(`update h2s_dispatch_jobs set due_at='2099-01-02T15:00:00Z' where job_id='${id(101)}'`);
  await assert.rejects(assign(db, { snapshot: old.context }), { code: '40001' });
  for (const status of ['assigned', 'in_progress', 'completed', 'done', 'cancelled']) {
    await db.query('update h2s_dispatch_jobs set status=$1 where job_id=$2', [status, id(101)]);
    await assert.rejects(assign(db), { code: '22023' });
  }
  await db.exec(`update h2s_dispatch_jobs set status='queued'; update h2s_orders set commercial_request_id='${id(201)}'`);
  await assert.rejects(assign(db), { code: '22023' });
  await db.exec(`update h2s_orders set commercial_request_id=null,total=0`);
  await assert.rejects(assign(db), { code: '22023' });
  await db.exec(`update h2s_orders set total=1200`);
  for (const status of ['pending_payment', 'unpaid', 'cancelled', 'refunded', 'disputed']) {
    await db.query('update h2s_orders set status=$1', [status]);
    await assert.rejects(assign(db), { code: '22023' });
  }
  await db.exec("update h2s_orders set status='paid'");
  await db.exec(`insert into h2s_dispatch_job_assignments(assign_id,job_id,pro_id,state) values('legacy-offer','${id(101)}','unknown-tech','offer_sent')`);
  assert.equal((await preview(db)).job.eligible, false);
  await assert.rejects(assign(db), { code: '22023' });
  assert.equal((await db.query('select count(*)::int n from h2s_management_assignment_requests')).rows[0].n, 0);
  const alphaOrder = 'abcdefab-0000-4000-8000-000000000100', alphaJob = 'abcdefab-0000-4000-8000-000000000101';
  await db.exec(`insert into h2s_orders(id,order_id,total) values('${alphaOrder}','ORD-CASE-FIXTURE',1200);
    insert into h2s_dispatch_jobs(job_id,order_id,status) values('${alphaJob}','${alphaOrder.toUpperCase()}','queued');
    insert into h2s_dispatch_job_assignments(assign_id,job_id,pro_id,state)
      values('uppercase-legacy-offer','${alphaJob.toUpperCase()}','unknown-tech','pending')`);
  const caseReview = await preview(db, alphaJob);
  assert.equal(caseReview.job.orderId, alphaOrder);
  assert.equal(caseReview.job.eligible, false, 'UUID casing cannot hide an existing offer');
});
test('queued competing requests serialize, managed legacy writes cannot duplicate, rollback is atomic', async t => {
  const db = await fixture(t);
  const snapshot = (await context(db)).context;
  const results = await Promise.allSettled([
    assign(db, { operation: id(701), snapshot }), assign(db, { operation: id(702), pro: id(501), snapshot }),
  ]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.filter(row => row.status === 'rejected').length, 1);
  await assert.rejects(db.exec(`insert into h2s_dispatch_job_assignments(assign_id,job_id,pro_id,state)
    values('conflicting-legacy','${id(101)}','${id(501)}','accepted')`), { code: '23505' });
  await assert.rejects(db.exec(`delete from h2s_dispatch_job_assignments where job_id='${id(101)}'`), { code: '23514' });
  await assert.rejects(db.exec(`update h2s_dispatch_job_assignments set pro_id='${id(501)}' where job_id='${id(101)}'`), { code: '23514' });
  assert.equal((await db.query('select count(*)::int n from h2s_management_assignment_requests')).rows[0].n, 1);
  assert.equal((await db.query('select count(*)::int n from h2s_management_assignment_activity')).rows[0].n, 1);
  await db.exec(`create function fixture_audit_fail() returns trigger language plpgsql as $$begin raise exception 'Fixture audit failure'; end$$;
    create trigger fixture_fail before insert on h2s_management_assignment_activity for each row execute function fixture_audit_fail();`);
  await assert.rejects(assign(db, { job: id(102), operation: id(703) }), /Fixture audit failure/);
  assert.equal((await db.query('select count(*)::int n from h2s_management_assignment_requests')).rows[0].n, 1);
  await db.exec('drop trigger fixture_fail on h2s_management_assignment_activity');
  assert.equal((await assign(db, { job: id(102), operation: id(703) })).state, 'pending');
});
test('041 composes with existing commercial assignment, calendar and preparation services without preaccepting a new offer', async t => {
  const { createOperationsFixture } = require('./helpers/commercial_operations_fixture.cjs');
  const f = await createOperationsFixture(); t.after(() => f.db.close());
  await f.db.exec(`alter table h2s_pros add column email text;
    alter table h2s_dispatch_job_assignments add column offer_sent_at timestamptz;
    alter table h2s_dispatch_job_assignments add column accepted_at timestamptz,add column declined_at timestamptz;
    delete from h2s_dispatch_job_assignments;`);
  await f.db.exec(migration);
  await f.db.exec(reliability);
  await f.db.exec(`update h2s_management_assignment_config set enabled=true;
    update h2s_orders set metadata_json=metadata_json||'{"scheduled_end":"2099-01-01T16:00:00Z","scheduled_tz":"UTC"}'::jsonb where id='${id(100)}';
    update h2s_dispatch_jobs set due_at='2099-01-01T15:00:00Z' where job_id='${id(101)}';`);
  await f.db.query('select commercial_record_operation($1,0,$2,$3::jsonb,$4,$5::jsonb)', [
    id(1), id(900), JSON.stringify({ id: id(9), name: 'Fixture Admin' }), 'link',
    JSON.stringify({ orderId: id(100), jobId: id(101) }),
  ]);
  const reservation = (await f.db.query('select * from commercial_reservations')).rows;
  const result = await assign(f.db);
  assert.equal(result.state, 'pending');
  assert.equal((await f.db.query('select status from h2s_dispatch_jobs where job_id=$1', [id(101)])).rows[0].status, 'queued');
  assert.equal((await f.db.query('select count(*)::int n from h2s_payouts_ledger')).rows[0].n, 0);
  assert.deepEqual((await f.db.query('select * from commercial_reservations')).rows, reservation);
  assert.equal((await respond(f.db)).job_status, 'assigned');
  assert.deepEqual((await f.db.query('select * from commercial_reservations')).rows, reservation);
  assert.equal((await f.db.query('select count(*)::int n from h2s_payouts_ledger')).rows[0].n, 0);
});
test('same-time technician conflicts and ambiguous order identities block assignment', async t => {
  const db = await fixture(t);
  await assign(db);
  await db.exec(`update h2s_dispatch_jobs set due_at='2099-01-01T15:00:00Z' where job_id='${id(102)}'`);
  const read = await preview(db, id(102));
  assert.equal(read.technicians.some(pro => pro.proId === id(500)), false);
  await assert.rejects(assign(db, { job: id(102), operation: id(701) }), { code: '22023' });
  await db.exec(`update h2s_dispatch_jobs set order_id='${id(100)}' where job_id='${id(102)}';
    insert into h2s_orders(id,order_id,total) values('${id(200)}','${id(100)}',1200)`);
  await assert.rejects(assign(db, { job: id(102), operation: id(702), snapshot: '0'.repeat(32) }), { code: '22023' });
});
