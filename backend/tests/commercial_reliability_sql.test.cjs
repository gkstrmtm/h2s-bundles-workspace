const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createFixture } = require('./helpers/commercial_contact_fixture.cjs');
const { buildSlotSuggestions } = require('../lib/commercial_consultation.js');
const review = require('../lib/commercial_migration_review.cjs');
const migrationSql = fs.readFileSync(path.join(__dirname, '..', 'migrations', review.version), 'utf8').replace(/\r\n/g, '\n');

async function rejected(db, sql, args, error) {
  await db.exec('savepoint boundary_attempt');
  await assert.rejects(() => db.query(sql, args), error);
  await db.exec('rollback to savepoint boundary_attempt; release savepoint boundary_attempt');
}

async function exerciseAppointmentBoundary(db, t) {
  const nonexistent = '10000000-0000-4000-8000-000000000031';
  const f = createFixture();
  await f.post('commercial-intake', { fullName: 'Relational SQL Fixture', phone: '+15550000005',
    contactPreference: 'sms', smsOptIn: true, serviceNeeds: ['Security Cameras'] });
  await db.exec('set local role service_role');
  const lead = (await db.query("select commercial_save_lead($1,0,$2,$3::jsonb) result",
    ['relational-sql-fixture-token-0001','relational-save-key-0001',JSON.stringify(f.tables.commercial_leads[0])])).rows[0].result.lead;
  const slot = buildSlotSuggestions(new Date(), 1)[0];
  const request = (await db.query('select commercial_submit_request($1,$2,$3::jsonb) result',
    [lead.lead_id,'relational-submit-key-0001',JSON.stringify({
      reference_code:'COM-RELATIONAL-SQL',response_token:'relational-response-token-0001',status:'pending',
      selected_slot_start:slot.startIso,selected_slot_end:slot.endIso,preferred_slots:[],metadata:{request_kind:'consultation'},
    })])).rows[0].result.request;
  await db.query("update commercial_consultation_requests set status='approved' where request_id=$1",[request.request_id]);
  const id = request.request_id;
  const values = requestId => [`APPT-COM-${requestId}`, requestId, JSON.stringify({commercial_consultation_request_id:requestId})];
  const insert = `insert into h2s_orders(order_id,commercial_request_id,metadata_json,customer_email,subtotal,total)
    values($1,$2,$3::jsonb,null,0,0)`;
  let appointment;
  await t.test('failed insert rolls back; approved phone-only request retries once and restores RPC scope', async () => {
    await db.query("select set_config('h2s.commercial_appointment_request_id','outer-scope',true)");
    await db.exec(`reset role;
      create function public.fixture_reject_appointment() returns trigger language plpgsql as $$
        begin raise exception 'Fixture appointment insert failure'; end $$;
      create trigger fixture_reject_appointment before insert on public.h2s_orders for each row
        execute function public.fixture_reject_appointment();
      set local role service_role;`);
    await rejected(db,'select commercial_create_appointment($1)',[id],/Fixture appointment insert failure/);
    assert.equal((await db.query('select related_order_id from commercial_consultation_requests where request_id=$1',[id])).rows[0].related_order_id,null);
    assert.equal((await db.query('select count(*)::int n from h2s_orders where commercial_request_id=$1',[id])).rows[0].n,0);
    assert.equal((await db.query("select current_setting('h2s.commercial_appointment_request_id',true) scope")).rows[0].scope,'outer-scope');
    await db.exec('reset role; drop trigger fixture_reject_appointment on public.h2s_orders; set local role service_role');
    appointment = (await db.query('select commercial_create_appointment($1) result',[id])).rows[0].result;
    assert.equal(appointment.commercial_request_id,id);
    assert.equal(appointment.customer_email,null);
    assert.equal((await db.query("select current_setting('h2s.commercial_appointment_request_id',true) scope")).rows[0].scope,'outer-scope');
    await db.query('select commercial_record_appointment_error($1,$2)',[id,'Fixture retry after lost response']);
    const replay = (await db.query('select commercial_create_appointment($1) result',[id])).rows[0].result;
    assert.equal(replay.id,appointment.id);
    assert.equal((await db.query('select metadata from commercial_consultation_requests where request_id=$1',[id])).rows[0].metadata.appointment_error,undefined);
    assert.equal((await db.query('select count(*)::int n from h2s_orders where commercial_request_id=$1',[id])).rows[0].n,1);
  });
  await db.exec('reset role');
  await t.test('foreign key and consistent typed identity reject nonexistent or forged links on insert and update', async () => {
    await rejected(db,insert,values(nonexistent),/h2s_orders_commercial_request_id_fkey/);
    for (const metadata of ['{}','{"commercial_consultation_request_id":null}',JSON.stringify({commercial_consultation_request_id:nonexistent}),'null',null]) {
      await rejected(db,insert,[`APPT-COM-${id}`,id,metadata],/h2s_orders_commercial_link/);
    }
    for (const email of [null,'fixture@example.invalid']) {
      await rejected(db,`insert into h2s_orders(order_id,customer_email,subtotal,total,metadata_json)
        values($1,$2,0,0,$3::jsonb)`,[`APPT-COM-${nonexistent}`,email,values(nonexistent)[2]],/h2s_orders_commercial_link/);
    }
    await db.query("insert into h2s_orders(order_id,customer_email,subtotal,total) values('ORD-BOUNDARY','fixture@example.invalid',0,0)");
    await rejected(db,`update h2s_orders set order_id=$1,commercial_request_id=$2,metadata_json=$3::jsonb,customer_email=null
      where order_id='ORD-BOUNDARY'`,values(nonexistent),/h2s_orders_commercial_request_id_fkey/);
    await rejected(db,"update h2s_orders set metadata_json='{\"commercial_consultation_request_id\":\"invented\"}' where order_id='ORD-BOUNDARY'",[],/h2s_orders_commercial_link/);
    await rejected(db,'update h2s_orders set commercial_request_id=$2,order_id=$3,metadata_json=$4::jsonb where id=$1',
      [appointment.id,nonexistent,`APPT-COM-${nonexistent}`,values(nonexistent)[2]],/identity cannot be changed/);
    await rejected(db,'update h2s_orders set metadata_json=null where id=$1',[appointment.id],/h2s_orders_commercial_link/);
    await rejected(db,"update h2s_orders set id=gen_random_uuid() where id=$1",[appointment.id],/identity cannot be changed/);
    await rejected(db,'delete from commercial_consultation_requests where request_id=$1',[id],/h2s_orders_commercial_request_id_fkey/);
    await rejected(db,insert,values(id),/h2s_orders_order_id_key/);
  });
  await db.exec(`create function public.fixture_definer_order_write(p_id uuid) returns void language sql security definer
    set search_path=public,pg_temp as $$update public.h2s_orders set status='forged' where id=p_id$$;
    grant execute on function public.fixture_definer_order_write(uuid) to anon,authenticated,service_role;`);
  for (const role of ['anon','authenticated','service_role']) {
    await db.exec(`set local role ${role}`);
    await t.test(`${role} cannot insert, edit, unlink, delete or truncate commercial appointments, including definer and GUC bypasses`, async () => {
      await db.query("select set_config('h2s.commercial_appointment_request_id',$1,true)",[id]);
      if (role === 'service_role') await db.query("select set_config('h2s.commercial_appointment_request_id','',true)");
      await rejected(db,insert,values(id),/authorized commercial workflow|scoped commercial RPC/);
      await rejected(db,insert,values(nonexistent),/authorized commercial workflow|scoped commercial RPC/);
      await rejected(db,`insert into h2s_orders(order_id,customer_email,subtotal,total,metadata_json) values($1,$2,0,0,$3::jsonb)`,
        [`APPT-COM-${nonexistent}`,'fixture@example.invalid',values(nonexistent)[2]],/authorized commercial workflow|scoped commercial RPC/);
      await rejected(db,'update h2s_orders set status=$2 where id=$1',[appointment.id,'forged'],/authorized commercial workflow|scoped commercial RPC/);
      await rejected(db,`update h2s_orders set commercial_request_id=null,order_id='UNLINKED',metadata_json=null,customer_email='fixture@example.invalid'
        where id=$1`,[appointment.id],/authorized commercial workflow|scoped commercial RPC/);
      await rejected(db,'delete from h2s_orders where id=$1',[appointment.id],/authorized commercial workflow|scoped commercial RPC/);
      await rejected(db,'select fixture_definer_order_write($1)',[appointment.id],/authorized commercial workflow|scoped commercial RPC/);
      await rejected(db,'truncate public.h2s_orders',[],/API roles cannot truncate/);
      if (role !== 'service_role') await rejected(db,'select commercial_create_appointment($1)',[id],/permission denied/);
    });
    await t.test(`${role} retains existing noncommercial CRUD and email requirement`, async () => {
      const key = `APPT-LEGACY-${role}`;
      await db.query(`insert into h2s_orders(order_id,customer_email,customer_phone,subtotal,total,metadata_json)
        values($1,$2,'+15550000005',0,0,'{"appointment_kind":"appointment","appointment_source":"direct_appointment"}')`,
      [key,'fixture@example.invalid']);
      await db.query('update h2s_orders set status=$2 where order_id=$1',[key,'paid']);
      assert.equal((await db.query('select status from h2s_orders where order_id=$1',[key])).rows[0].status,'paid');
      await rejected(db,'update h2s_orders set customer_email=null where order_id=$1',[key],/h2s_orders_email_required_except_commercial/);
      await db.query('delete from h2s_orders where order_id=$1',[key]);
    });
    await db.exec('reset role');
  }
  await db.exec('set local role service_role');
  await t.test('lost links recover the existing deterministic appointment; corrupt request links fail without reassignment', async () => {
    await db.query('update commercial_consultation_requests set related_order_id=null where request_id=$1',[id]);
    assert.equal((await db.query('select commercial_create_appointment($1) result',[id])).rows[0].result.id,appointment.id);
    const unrelated = (await db.query("select id from h2s_orders where order_id='ORD-BOUNDARY'")).rows[0].id;
    await db.query('update commercial_consultation_requests set related_order_id=$2 where request_id=$1',[id,unrelated]);
    await rejected(db,'select commercial_create_appointment($1)',[id],/does not match the commercial request/);
    await db.query('update commercial_consultation_requests set related_order_id=$2 where request_id=$1',[id,appointment.id]);
    assert.equal((await db.query('select commercial_create_appointment($1) result',[id])).rows[0].result.id,appointment.id);
  });
  await db.exec('reset role');
}

test('031 guarded verification matches a catalog-derived production fixture and rejects post-migration drift', async t => {
  const db = new PGlite();
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'migration-baselines', '031_commercial_reliability.json'))).schema;
  const target = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'migration-targets.json'))).production;
  const quote = value => `"${value.replace(/"/g, '""')}"`;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin;`);
    for (const row of baseline.defaultPrivileges) {
      await db.exec(`alter default privileges for role ${quote(row.owner)} in schema public
        grant all on ${row.type === 'r' ? 'tables' : 'functions'} to postgres,anon,authenticated,service_role;`);
    }
    for (const table of baseline.relations) {
      const columns = baseline.columns.filter(row => row.table_name === table.name);
      await db.exec(`create table public.${quote(table.name)} (${columns.map(row =>
        `${quote(row.name)} ${row.type}${row.not_null ? ' not null' : ''}${row.default_value ? ` default ${row.default_value}` : ''}`).join(',')});`);
      if (table.rls) await db.exec(`alter table public.${quote(table.name)} enable row level security;`);
    }
    const constraints = [...baseline.constraints].sort((a, b) => Number(a.type === 'f') - Number(b.type === 'f'));
    for (const row of constraints) await db.exec(`alter table public.${quote(row.table_name)} add constraint ${quote(row.name)} ${row.definition};`);
    for (const row of baseline.indexes) {
      if (!baseline.constraints.some(constraint => ['p','u'].includes(constraint.type) && constraint.name === row.name)) await db.exec(row.definition);
    }
    const createdFunctions = new Set();
    for (const row of baseline.triggers) {
      const functionName = /EXECUTE FUNCTION (\w+)\(\)/.exec(row.definition)[1];
      if (!createdFunctions.has(functionName)) {
        await db.exec(`create function public.${quote(functionName)}() returns trigger language plpgsql as $$${row.function_body}$$;`);
        createdFunctions.add(functionName);
      }
      await db.exec(row.definition);
    }
    review.assertBaseline(await review.snapshot(db), target);
    const legacyAppointment = (await db.query(`insert into h2s_orders(order_id,customer_email,customer_phone,
      subtotal,total,delivery_date,appointment_confirmed,metadata_json)
      values('APPT-LEGACY-BEFORE-031','fixture@example.invalid','+15550000005',0,0,'2000-01-01',true,
        '{"appointment_kind":"appointment","appointment_source":"direct_appointment"}') returning *`)).rows[0];
    await db.exec('begin');
    await db.exec(migrationSql);
    assert.deepEqual((await db.query('select * from h2s_orders where id=$1',[legacyAppointment.id])).rows[0],
      {...legacyAppointment,commercial_request_id:null});
    const applied = await review.snapshot(db);
    review.assertPost(applied, target);
    assert.equal((await review.inspect(db, target, true)).state, 'applied_verified');
    for (const mutate of [
      s => { s.routines[0].body += '\n-- unreviewed'; },
      s => { s.routines[0].security_definer = true; },
      s => { s.routines[0].config = ['search_path=public']; },
      s => { s.routines[0].anon_execute = true; },
      s => { s.relations.find(r => r.name === 'commercial_effects').rls = false; },
      s => { s.columns.find(r => r.table_name === 'h2s_orders' && r.name === 'customer_email').not_null = true; },
      s => { s.indexes.find(r => r.name === 'commercial_one_active_request').predicate = 'true'; },
      s => { s.constraints.find(r => r.name === 'h2s_orders_email_required_except_commercial').definition = 'CHECK (true)'; },
      s => { s.triggers[0].function_body += '\n-- changed'; },
      s => { s.constraints.find(r => r.name === 'h2s_orders_commercial_request_id_fkey').definition = 'CHECK (true)'; },
      s => { s.triggers = s.triggers.filter(r => r.name !== 'commercial_appointment_write_guard'); },
      s => { s.triggers.find(r => r.name === 'commercial_appointment_truncate_guard').enabled = 'D'; },
      s => { s.indexes.find(r => r.name === 'h2s_orders_order_id_key').valid = false; },
    ]) {
      const changed = structuredClone(applied);
      mutate(changed);
      assert.throws(() => review.assertPost(changed, target));
    }
    await exerciseAppointmentBoundary(db,t);
    await db.exec('rollback');
    review.assertBaseline(await review.snapshot(db), target);
    await db.exec('begin');
    await db.query(`insert into h2s_orders(order_id,customer_email,subtotal,total,metadata_json)
      values('APPT-COM-legacy','fixture@example.invalid',0,0,'{"commercial_consultation_request_id":"invented"}')`);
    await assert.rejects(() => review.inspect(db,target,false),/preflight found conflicting existing records/);
    await assert.rejects(() => db.exec(migrationSql),/Reconcile existing commercial appointment markers/);
    await db.exec('rollback');
    review.assertBaseline(await review.snapshot(db), target);
  } finally {
    await db.close();
  }
});

test('migration 031 executes in local PostgreSQL and enforces revisions, identities, effects, attachment caps and appointment reuse', async () => {
  const db = new PGlite();
  try {
    const original = fs.readFileSync(path.join(__dirname, '..', 'migrations', '014_create_commercial_consultation.sql'), 'utf8');
    // Reuse table definitions only. Never install the historical permissive policies.
    await db.exec(original.split('alter table commercial_leads enable row level security;')[0]);
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      alter table commercial_leads enable row level security;
      alter table commercial_consultation_requests enable row level security;
      create table h2s_orders (
        id uuid primary key default gen_random_uuid(), order_id text not null unique, customer_email text not null,
        customer_name text, customer_phone text, name text, phone text, status text,
        delivery_date date, delivery_time text, service_name text, appointment_confirmed boolean,
        subtotal numeric not null, total numeric not null, items text, metadata_json jsonb,
        created_at timestamptz, updated_at timestamptz
      );
      grant select,insert,update on commercial_leads,commercial_consultation_requests,h2s_orders to service_role;
      grant select on commercial_leads,commercial_consultation_requests to anon,authenticated;
    `);
    await db.exec(migrationSql);
    const f = createFixture();
    await f.post('commercial-intake', {
      fullName: 'Local SQL Fixture', phone: '+15550000005', contactPreference: 'sms',
      smsOptIn: true, serviceNeeds: ['Security Cameras'],
    });
    const patch = f.tables.commercial_leads[0];
    const token = 'local-sql-fixture-token-0001';
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].result;
    await db.exec('set role service_role');
    const first = await rpc('select commercial_save_lead($1,0,$2,$3::jsonb) result', [token, 'local-save-key-000001', JSON.stringify(patch)]);
    assert.equal(first.lead.revision, 1);
    assert.equal(first.lead.last_submitted_at, null);
    const replay = await rpc('select commercial_save_lead($1,0,$2,$3::jsonb) result', [token, 'local-save-key-000001', JSON.stringify({ ...patch, notes: 'Must not overwrite replay' })]);
    assert.equal(replay.replayed, true);
    assert.equal(replay.lead.lead_id, first.lead.lead_id);
    const stale = await rpc('select commercial_save_lead($1,0,$2,$3::jsonb) result', [token, 'local-save-key-000002', JSON.stringify(patch)]);
    assert.equal(stale.conflict, true);
    const slot = buildSlotSuggestions(new Date())[0];
    const requestPatch = {
      reference_code: 'COM-LOCAL-SQL', response_token: 'local-approval-token-0001', status: 'pending',
      preferred_slots: [], selected_slot_start: slot.startIso, selected_slot_end: slot.endIso,
      metadata: { request_kind: 'consultation' },
    };
    const submitted = await rpc('select commercial_submit_request($1,$2,$3::jsonb) result', [first.lead.lead_id, 'local-submit-key-0001', JSON.stringify(requestPatch)]);
    assert.equal(submitted.created, true);
    const repeated = await rpc('select commercial_submit_request($1,$2,$3::jsonb) result', [first.lead.lead_id, 'local-submit-key-0002', JSON.stringify(requestPatch)]);
    assert.equal(repeated.created, false);
    assert.equal(repeated.request.request_id, submitted.request.request_id);
    const id = submitted.request.request_id;
    const reschedulePatch = { ...requestPatch, response_token: 'local-new-approval-token-0001' };
    const rescheduled = await rpc('select commercial_reschedule_request($1,$2,$3,$4,$5::jsonb) result',
      [id, first.lead.lead_id, requestPatch.response_token, 'local-reschedule-key-0001', JSON.stringify(reschedulePatch)]);
    assert.equal(rescheduled.request.response_token, reschedulePatch.response_token);
    const rescheduleReplay = await rpc('select commercial_reschedule_request($1,$2,$3,$4,$5::jsonb) result',
      [id, first.lead.lead_id, requestPatch.response_token, 'local-reschedule-key-0001', JSON.stringify(reschedulePatch)]);
    assert.equal(rescheduleReplay.replayed, true);
    await assert.rejects(() => db.query('select commercial_reschedule_request($1,$2,$3,$4,$5::jsonb)',
      [id, first.lead.lead_id, requestPatch.response_token, 'local-reschedule-key-0002', JSON.stringify(reschedulePatch)]), /Request changed/);
    for (const state of ['accepted', 'uncertain', 'failed']) {
      assert.equal(await rpc('select commercial_claim_effect($1,$2) result', [id, state]), true);
      assert.equal((await db.query('select metadata from commercial_consultation_requests where request_id=$1', [id])).rows[0].metadata.workflow[state].state, 'processing');
      assert.equal(await rpc('select commercial_claim_effect($1,$2) result', [id, state]), false);
      await db.query('select commercial_finish_effect($1,$2,$3,$4::jsonb)', [id, state, state, '{}']);
      assert.equal(await rpc('select commercial_claim_effect($1,$2) result', [id, state]), state === 'failed');
    }
    for (let i = 0; i < 8; i++) await db.query('select commercial_attach_photo($1,$2)', [first.lead.lead_id, `https://fixture.invalid/${i}`]);
    await assert.rejects(() => db.query('select commercial_attach_photo($1,$2)', [first.lead.lead_id, 'https://fixture.invalid/9']), /Maximum eight/);
    const savedAgain = await rpc('select commercial_save_lead($1,1,$2,$3::jsonb) result', [token, 'local-save-key-000003', JSON.stringify(patch)]);
    assert.equal(savedAgain.lead.project_photo_urls.length, 8);
    assert.ok(savedAgain.lead.last_submitted_at, 'Autosave must not turn a submitted request back into a draft');
    await db.query("update commercial_consultation_requests set status='approved' where request_id=$1", [id]);
    await db.query('select commercial_record_appointment_error($1,$2)', [id, 'Local recoverable error']);
    const appointment = await rpc('select commercial_create_appointment($1) result', [id]);
    const sameAppointment = await rpc('select commercial_create_appointment($1) result', [id]);
    assert.equal(appointment.id, sameAppointment.id);
    const recovered = (await db.query('select metadata from commercial_consultation_requests where request_id=$1', [id])).rows[0].metadata;
    assert.equal(recovered.appointment_error, undefined);
    assert.equal(recovered.workflow.accepted.state, 'accepted');
    assert.equal(appointment.customer_email, null);
    assert.equal(typeof appointment.items, 'string');
    assert.equal(JSON.parse(appointment.items)[0].type, 'appointment');
    assert.equal(appointment.delivery_time, new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(slot.startIso)));
    assert.equal((await db.query('select count(*)::int count from h2s_orders')).rows[0].count, 1);
    for (const changes of [
      { contact_preference: 'email', attribution: { communicationConsent: { smsOptIn: true } } },
      { contact_preference: 'call', attribution: { communicationConsent: { smsOptIn: true } } },
      { contact_preference: 'sms', attribution: { communicationConsent: { smsOptIn: false } } },
    ]) {
      await db.query('update commercial_leads set contact_preference=$2,attribution=$3::jsonb where lead_id=$1',
        [first.lead.lead_id, changes.contact_preference, JSON.stringify(changes.attribution)]);
      await assert.rejects(() => db.query('select commercial_create_appointment($1)', [id]), /approved text request with permission/);
    }
    await db.query('update commercial_leads set contact_preference=$2,attribution=$3::jsonb where lead_id=$1',
      [first.lead.lead_id, 'sms', JSON.stringify({ communicationConsent: { smsOptIn: true } })]);
    await assert.rejects(() => db.query("insert into h2s_orders(order_id,customer_email,subtotal,total) values('UNRELATED',null,0,0)"), /h2s_orders_email_required_except_commercial/);
    await assert.rejects(() => db.query(`insert into commercial_consultation_requests(lead_id,reference_code,response_token)
      values($1,'COM-DUPLICATE','duplicate-token')`, [first.lead.lead_id]), /commercial_one_active_request/);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`reset role; set role ${role}`);
      assert.equal((await db.query('select count(*)::int count from commercial_leads')).rows[0].count, 0);
      await assert.rejects(() => db.query('select commercial_claim_effect($1,$2)', [id, 'forbidden']), /permission denied/);
    }
    await db.exec('reset role');
    assert.equal((await db.query("select count(*)::int count from pg_policies where tablename in ('commercial_leads','commercial_consultation_requests','commercial_effects')")).rows[0].count, 0);
  } finally {
    await db.close();
  }
});
