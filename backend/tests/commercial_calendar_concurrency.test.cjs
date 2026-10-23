const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { Client } = require('pg');
const id = n => `03600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const connectionString = process.env.H2S_CALENDAR_TEST_DATABASE_URL;
test('036 genuine independent PostgreSQL sessions serialize conflicting bookings and stale snapshots', { skip: !connectionString }, async () => {
  const url = new URL(connectionString);
  assert.equal(url.hostname,'127.0.0.1');
  assert.match(url.pathname,/^\/h2s_calendar_fixture_[a-z0-9_]+$/);
  const first = new Client({connectionString}), second = new Client({connectionString}), observer = new Client({connectionString});
  await Promise.all([first.connect(),second.connect(),observer.connect()]);
  try {
    const backend=path.resolve(__dirname,'..');
    const fixture=fs.readFileSync(path.join(__dirname,'helpers','commercial_operations_fixture.cjs'),'utf8');
    const schema=/await db\.exec\((`[\s\S]*?`)\);/.exec(fixture);
    assert.ok(schema);
    await first.query(vm.runInNewContext(schema[1],{id}));
    await first.query('BEGIN');
    for (const name of ['032_commercial_operations.sql','034_commercial_followup_delivery.sql','036_commercial_calendar_workload.sql']) {
      await first.query(fs.readFileSync(path.join(backend,'migrations',name),'utf8'));
    }
    await first.query('COMMIT');
    const input={start:'2099-01-01T15:00:00Z',end:'2099-01-01T16:00:00Z',timezone:'UTC',
      customerAgreed:true,reason:'Concurrent fixture booking'};
    const book=(client,lead,payload=input)=>client.query('select commercial_record_reservation($1,0,$2,$3::jsonb,$4,$5::jsonb)',
      [id(lead),crypto.randomUUID(),JSON.stringify({id:id(9),name:'Fixture Admin'}),'confirm',JSON.stringify(payload)]);
    async function waitForLock() {
      const deadline=Date.now()+5000;
      while(Date.now()<deadline) {
        const rows=await observer.query("select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'",[second.processID]);
        if(rows.rowCount) return;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      assert.fail('Second independent session did not wait for the calendar capacity lock');
    }
    await first.query('BEGIN');
    await book(first,1);
    const competing=book(second,2).then(()=>({ok:true}),error=>({error}));
    await waitForLock();
    await first.query('COMMIT');
    assert.equal((await competing).error?.code,'23P01');
    assert.equal((await observer.query('select count(*)::int n from commercial_reservations')).rows[0].n,1);
    await book(second,2,{...input,start:input.end,end:'2099-01-01T17:00:00Z'});
    await observer.query('delete from commercial_calendar_activity; delete from commercial_reservations');
    await second.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    await second.query('select * from commercial_calendar');
    await first.query('BEGIN');
    await book(first,1);
    const stale=book(second,2).then(()=>({ok:true}),error=>({error}));
    await waitForLock();
    await first.query('COMMIT');
    assert.equal((await stale).error?.code,'40001');
    await second.query('ROLLBACK');
    await assert.rejects(book(second,2),{code:'23P01'});
    assert.equal((await observer.query('select count(*)::int n from commercial_reservations')).rows[0].n,1);
    await first.query('select commercial_record_operation($1,0,$2,$3::jsonb,$4,$5::jsonb)',
      [id(1),crypto.randomUUID(),JSON.stringify({id:id(9),name:'Fixture Admin'}),'link',JSON.stringify({orderId:id(100),jobId:id(101)})]);
    const state=async()=>({
      context:(await observer.query('select h2s_job_readiness($1) value',[id(101)])).rows[0].value.context,
      ...(await observer.query('select j.updated_at::text "expectedJobUpdatedAt",o.updated_at::text "expectedOrderUpdatedAt" from h2s_dispatch_jobs j join h2s_orders o on o.order_id=j.order_id where j.job_id=$1',[id(101)])).rows[0],
    });
    let payload={...await state(),scopeReviewed:true,materials:'ready',access:'ready',blockers:'',note:'Native concurrent staff preparation'};
    const operation=crypto.randomUUID();
    const prepare=(client,revision,key,body,actor=9)=>client.query('select h2s_record_job_preparation($1,$2,$3,$4::jsonb,$5::jsonb)',
      [id(101),revision,key,JSON.stringify({id:id(actor),name:`Fixture Admin ${actor}`}),JSON.stringify(body)]);
    await first.query('BEGIN');
    await prepare(first,0,operation,payload);
    const preparationConflict=prepare(second,0,crypto.randomUUID(),payload,12).then(()=>({ok:true}),error=>({error}));
    await waitForLock();await first.query('COMMIT');
    assert.equal((await preparationConflict).error?.code,'40001');
    await prepare(first,0,operation,payload);
    assert.equal((await observer.query('select count(*)::int n from h2s_job_preparation_activity')).rows[0].n,1);
    payload={...payload,...await state(),materials:'blocked',blockers:'Delivery not ready'};
    await first.query('BEGIN');
    await prepare(first,1,crypto.randomUUID(),payload);
    const starting=second.query("update h2s_dispatch_jobs set status='in_progress' where job_id=$1",[id(101)])
      .then(()=>({ok:true}),error=>({error}));
    await waitForLock();await first.query('COMMIT');
    assert.equal((await starting).error?.code,'22023');
    assert.match((await observer.query('select h2s_job_readiness($1) value',[id(101)])).rows[0].value.blockers.join(' '),/materials/i);
  } finally {
    await Promise.all([first.query('ROLLBACK').catch(()=>{}),second.query('ROLLBACK').catch(()=>{})]);
    await Promise.all([first.end(),second.end(),observer.end()]);
  }
});
