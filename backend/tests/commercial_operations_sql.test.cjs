const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const id = n => `03200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = { id: id(9), name: 'Fixture Admin' };

test('032 executes against the sparse production dispatch contract without changing legacy lifecycle contracts', async t => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table commercial_leads(lead_id uuid primary key,email text,phone text,project_address text,project_city text,
      project_state text,project_postal_code text,revision integer not null default 0,updated_at timestamptz not null default now());
    create table h2s_orders(id uuid primary key,order_id text unique,total numeric,currency text,
      commercial_request_id uuid,metadata_json jsonb,customer_email text,customer_phone text,phone text,address text default '100 Fixture Lane',
      delivery_date date,delivery_time text,updated_at timestamptz not null default now());
    create table h2s_dispatch_jobs(job_id uuid primary key,order_id text,status text check(status in
      ('queued','assigned','in_progress','completed','cancelled','done')),due_at timestamptz,updated_at timestamptz not null default now());
    create table h2s_dispatch_job_assignments(assign_id text primary key default gen_random_uuid()::text,job_id text,pro_id text,state text,
      created_at timestamptz default now(),updated_at timestamptz default now());
    create table h2s_pros(pro_id uuid primary key,is_active boolean);
    insert into h2s_pros values('${id(500)}',true),('${id(501)}',false);
    create table h2s_jobs(job_id text primary key,status text,completed_at timestamptz);
    insert into h2s_jobs values('historical-installation','done','2026-01-01');
    insert into commercial_leads(lead_id,email,phone,updated_at) values
      ('${id(1)}','fixture@example.invalid','+15550000005','2026-01-01T00:00:00.123456Z'),
      ('${id(2)}','fixture@example.invalid','+15550000005','2026-01-01'),
      ('${id(3)}','unrelated@example.invalid','+15550000009','2026-01-01');
    insert into h2s_orders(id,order_id,total,currency,customer_email) values
      ('${id(100)}','ORD-FIXTURE',1200,'usd','fixture@example.invalid');
    insert into h2s_orders(id,order_id,total,currency,commercial_request_id) values
      ('${id(200)}','APPT-COM-FIXTURE',0,'usd','${id(201)}');
    insert into h2s_dispatch_jobs(job_id,order_id,status) values
      ('${id(101)}','ORD-FIXTURE','queued'),('${id(202)}','APPT-COM-FIXTURE','queued');
    insert into h2s_dispatch_job_assignments(job_id,pro_id,state) values('${id(101)}','${id(500)}','accepted');
  `);
  const review = require('../lib/commercial_operations_review.cjs');
  assert.equal((await review.inspect(db,false)).applied,false);
  await db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '032_commercial_operations.sql'), 'utf8'));
  assert.equal((await review.inspect(db,true)).defaultDenyVerified,true);
  await db.exec('set role service_role');
  let sequence = 1000;
  const record = async (action, payload, revision, lead = id(1), key = id(++sequence)) => {
    const result = await db.query('select commercial_record_operation($1,$2,$3,$4::jsonb,$5,$6::jsonb) state',
      [lead,revision,key,JSON.stringify(actor),action,JSON.stringify(payload)]);
    return result.rows[0].state;
  };
  const follow = { responsibleId: id(9), responsibleName: actor.name, nextFollowUpAt: '2026-01-01T10:00:00Z',
    disposition: 'open', reason: '', contact: { channel: 'call', outcome: 'no_response', note: 'Fixture attempt only' } };
  await t.test('follow-up persists actor/time/contact history and duplicate replay cannot overwrite it', async () => {
    const key = id(++sequence);
    const saved = await record('follow_up', follow, 0, id(1), key);
    assert.equal(saved.revision, 1);
    assert.equal(saved.responsible_id, actor.id);
    assert.equal(saved.disposition, 'open');
    assert.ok(Date.parse(saved.next_follow_up_at) < Date.now());
    assert.equal((await record('follow_up', follow, 0, id(1), key)).revision, 1);
    await assert.rejects(record('follow_up', { ...follow, reason: 'Different input' }, 0, id(1), key), /key reused/);
    await assert.rejects(record('follow_up', follow, 0), /Lead changed/);
    const history = (await db.query('select * from commercial_lead_activity')).rows;
    assert.equal(history.length, 1);
    assert.equal(history[0].actor_name, actor.name);
    assert.ok(history[0].created_at);
    assert.equal(history[0].payload.contact.outcome, 'no_response');
  });
  await t.test('closing requires a reason, preserves history, and never completes work', async () => {
    for (const reason of [undefined,null,'','   ','\t\n\r']) {
      await assert.rejects(record('follow_up', { ...follow, disposition: 'closed', reason }, 1), /Disposition/);
      await db.exec('reset role');
      await assert.rejects(db.query("update commercial_lead_operations set disposition='closed',disposition_reason=$1 where lead_id=$2",
        [reason || null,id(1)]), /check constraint/);
      await db.exec('set role service_role');
    }
    await assert.rejects(record('follow_up', { ...follow, contact: { channel: 'call', note: 'Missing outcome' } }, 1), /Disposition/);
    const saved = await record('follow_up', { ...follow, disposition: 'closed', reason: 'Customer deferred' }, 1);
    assert.equal(saved.disposition, 'closed');
    assert.equal(saved.completed_at, null);
    assert.equal(saved.order_id, null);
    assert.equal((await db.query('select count(*)::int n from commercial_lead_activity')).rows[0].n, 2);
  });
  await t.test('location uses exact microsecond CAS and failure is atomic', async () => {
    const payload = { address: '100 Fixture Lane', city: 'Fixture City', state: 'NC', postalCode: '00000',
      expectedUpdatedAt: '2026-01-01T00:00:00.123456Z' };
    assert.equal((await record('location', payload, 2)).revision, 3);
    await assert.rejects(record('location', { ...payload, address: 'Stale overwrite' }, 3), /location changed/);
    await db.exec('reset role');
    assert.equal((await db.query('select project_address from commercial_leads where lead_id=$1', [id(1)])).rows[0].project_address, payload.address);
    await db.exec('set role service_role');
  });
  await t.test('only explicitly matched existing priced orders/jobs link; consultations and contact mismatch are rejected', async () => {
    await assert.rejects(record('link', { orderId: id(200), jobId: id(202) }, 3), /priced installation/);
    await assert.rejects(record('link', { orderId: id(100), jobId: id(202) }, 3), /priced installation/);
    await db.exec(`reset role; update h2s_orders set order_id=null where id='${id(100)}'; set role service_role`);
    await assert.rejects(record('link', { orderId: id(100), jobId: id(202) }, 3), /priced installation/);
    await db.exec(`reset role; update h2s_orders set order_id='ORD-FIXTURE' where id='${id(100)}'; set role service_role`);
    await assert.rejects(record('link', { orderId: id(100), jobId: id(101) }, 0, id(3)), /contact does not match/);
    const saved = await record('link', { orderId: id(100), jobId: id(101) }, 3);
    assert.equal(saved.order_id, id(100));
    assert.equal(saved.installation_job_id, id(101));
    await assert.rejects(record('link', { orderId: id(100), jobId: id(101) }, 0, id(2)), /unique constraint/);
    await assert.rejects(record('link', { orderId: id(100), jobId: id(101) }, 4), /already linked/);
  });
  async function versions() {
    await db.exec('reset role');
    const job = (await db.query('select updated_at from h2s_dispatch_jobs where job_id=$1', [id(101)])).rows[0];
    const order = (await db.query('select updated_at from h2s_orders where id=$1', [id(100)])).rows[0];
    await db.exec('set role service_role');
    return { expectedJobUpdatedAt: job.updated_at.toISOString(), expectedOrderUpdatedAt: order.updated_at.toISOString() };
  }
  await t.test('installation scheduling preserves job status and consultation; stale external updates conflict', async () => {
    const versionsBefore = await versions();
    const start = new Date(Date.now() + 86400000).toISOString();
    const end = new Date(Date.now() + 90000000).toISOString();
    const saved = await record('schedule', { ...versionsBefore, start, end, date: start.slice(0,10), window: '10 AM - 11 AM', timezone: 'UTC' }, 4);
    assert.equal(saved.revision, 5);
    for (const alteration of [
      `update h2s_dispatch_jobs set order_id=null where job_id='${id(101)}'`,
      `update h2s_orders set order_id=null where id='${id(100)}'; update h2s_dispatch_jobs set order_id='WRONG-ORDER' where job_id='${id(101)}'`,
      `update h2s_orders set total=null where id='${id(100)}'`,
    ]) {
      await db.exec(`reset role; ${alteration}; set role service_role`);
      await assert.rejects(record('schedule', { ...await versions(), start, end, date:start.slice(0,10), window:'10 AM - 11 AM', timezone:'UTC' }, 5), /relationship changed/);
      await db.exec(`reset role; update h2s_dispatch_jobs set order_id='ORD-FIXTURE' where job_id='${id(101)}'; update h2s_orders set order_id='ORD-FIXTURE',total=1200 where id='${id(100)}'; set role service_role`);
    }
    await assert.rejects(record('schedule', { ...versionsBefore, start, end, date: start.slice(0,10), window: 'Stale', timezone: 'UTC' }, 5), /changed/);
    await db.exec('reset role');
    const jobs = (await db.query('select job_id,status,due_at from h2s_dispatch_jobs order by job_id')).rows;
    assert.equal(jobs[0].status, 'queued');
    assert.equal(jobs[0].due_at.toISOString(), start);
    assert.equal(jobs[1].due_at, null);
    assert.equal((await db.query('select status from h2s_jobs')).rows[0].status, 'done');
    await db.exec('set role service_role');
  });
  await t.test('ADMIN assignment/start use existing records, guards and sparse lifecycle without a portal', async () => {
    let version = await versions();
    await assert.rejects(record('assign', {...version,proId:id(501),note:'Inactive installer'},5),/active installer/);
    await record('assign', {...version,proId:id(500),note:'Explicit ADMIN assignment'},5);
    version = await versions();
    await db.exec(`reset role; update h2s_orders set metadata_json='{"order_required":true,"order_stage":"ORDERED"}'; set role service_role`);
    await assert.rejects(record('start',{...version,proId:id(500),note:'Starting'},6),/Equipment/);
    await db.exec(`reset role; update h2s_orders set metadata_json='{"order_required":true,"order_stage":"DELIVERED"}'; set role service_role`);
    await record('start',{...version,proId:id(500),note:'Equipment delivered; starting'},6);
  });
  await t.test('completion records facts only, preserves paid order separation and prevents repeated transitions', async () => {
    let version = await versions();
    await db.exec(`reset role; update h2s_orders set metadata_json='{"pain_flags":[{"severity":"CRITICAL"}]}' where id='${id(100)}'; set role service_role`);
    await assert.rejects(record('complete', { ...version, note: 'Completed installation', proId: id(500) }, 7), /critical/);
    await db.exec(`reset role; update h2s_orders set metadata_json='{}' where id='${id(100)}'; set role service_role`);
    const key = id(++sequence), payload = { ...version, note: 'Completed installation', proId: id(500) };
    const saved = await record('complete', payload, 7, id(1), key);
    assert.equal(saved.revision, 8);
    assert.equal(saved.disposition, 'closed'); // The prior disposition was retained, not set by completion.
    assert.equal(saved.completed_by.id, actor.id);
    assert.ok(saved.completed_at);
    assert.equal((await record('complete', payload, 7, id(1), key)).revision, 8);
    await assert.rejects(record('complete', {...payload,...await versions()},8),/in-progress/);
    assert.equal(Object.hasOwn(saved,'completion_processing'),false);
    await db.exec('reset role');
    assert.equal((await db.query("select count(*)::int n from h2s_orders where total>0")).rows[0].n, 1);
    assert.equal((await db.query('select status from h2s_dispatch_jobs where job_id=$1',[id(101)])).rows[0].status, 'completed');
    await db.exec('set role service_role');
  });
  await t.test('retention intentionally restricts linked parent deletion and leaves unrelated cleanup possible', async () => {
    await db.exec('reset role');
    for (const [table,column,value] of [['commercial_leads','lead_id',id(1)],['h2s_orders','id',id(100)],['h2s_dispatch_jobs','job_id',id(101)]]) {
      await assert.rejects(db.query(`delete from ${table} where ${column}=$1`,[value]),/foreign key constraint/);
    }
    await db.query('delete from h2s_dispatch_jobs where job_id=$1',[id(202)]);
    await db.query('delete from h2s_orders where id=$1',[id(200)]);
    await db.exec('set role service_role');
  });
  for (const role of ['anon','authenticated','service_role']) {
    await t.test(`${role} cannot rewrite activity or bypass the workflow`, async () => {
      await db.exec(`reset role; set role ${role}`);
      await assert.rejects(db.exec("update commercial_lead_activity set actor_name='Forged'"), /permission denied/);
      await assert.rejects(db.exec('delete from commercial_lead_activity'), /permission denied/);
      await assert.rejects(db.exec('update commercial_lead_operations set revision=0'), /permission denied/);
      if (role !== 'service_role') await assert.rejects(record('follow_up', follow, 6), /permission denied/);
    });
  }
  await db.close();
});
