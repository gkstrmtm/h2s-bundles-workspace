const test = require('node:test');
const assert = require('node:assert/strict');
const { id } = require('./helpers/commercial_operations_fixture.cjs');
const { createOperationsFixture } = require('./helpers/commercial_operations_fixture.cjs');
const { createCalendarFixture } = require('./helpers/commercial_calendar_fixture.cjs');
const actor = { id: id(9), name: 'Fixture Admin' };
const window = { start: '2099-01-01T15:00:00Z', end: '2099-01-01T16:00:00Z', timezone: 'America/New_York',
  expiresAt: '2098-12-31T20:00:00Z', reason: 'Fixture agreement', customerAgreed: true };
let sequence = 36000;
async function rpc(f, name, args) {
  const result = await f.client.rpc(name, args);
  if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.data;
}
const book = (f, lead, revision, action, payload = window, key = id(++sequence)) =>
  rpc(f, 'commercial_record_reservation', { p_lead_id: id(lead), p_revision: revision, p_operation_id: key,
    p_actor: actor, p_action: action, p_payload: payload });
const workload = (f, revision, intent, extra = {}, key = id(++sequence)) => ({
  leadId: id(1), revision, operationId: key, action: 'workload',
  payload: { intent, responsibleId: id(10), nextFollowUpAt: '2099-01-02T15:00:00Z',
    outcome: 'won', reason: 'Fixture action', ...extra },
});
test('036 shared calendar and workload execute with default-deny, authenticated history and no outbound effects', async t => {
  const f = await createCalendarFixture();
  try {
    await t.test('review verifies schema, exact functions, trigger enforcement and grants', async () => {
      assert.equal((await require('../lib/commercial_calendar_review.cjs').inspect(f.db,true)).atomicCapacityVerified,true);
      await f.db.exec('set role service_role');
      await assert.rejects(f.db.exec("update commercial_calendar set name='Bypass'"), /permission denied/);
      await f.db.exec('reset role');
    });

    await t.test('036 adoption rejects incomplete/overlapping legacy windows atomically instead of guessing or overwriting', async t => {
      for (const overlap of [false,true]) await t.test(overlap?'overlapping existing windows':'missing end time',async()=>{
        const f=await createOperationsFixture({LEGACY_SCHEMA_FIXTURE:true});
        try {
          assert.equal((await f.client.rpc('commercial_record_operation',{p_lead_id:id(1),p_revision:0,p_operation_id:id(++sequence),
            p_actor:{id:id(9),name:'Fixture Admin'},p_action:'link',p_payload:{orderId:id(100),jobId:id(101)}})).error,null);
          await f.db.query("update h2s_dispatch_jobs set due_at=$1 where job_id=$2",[window.start,id(101)]);
          if (overlap) {
            await f.db.query("update h2s_orders set metadata_json=metadata_json||$1::jsonb where id=$2",
              [JSON.stringify({scheduled_end:window.end,scheduled_tz:'UTC'}),id(100)]);
            await f.db.query("insert into h2s_orders(id,order_id,total,currency,customer_email,metadata_json) values($1,'ORD-SECOND',1200,'usd','fixture@example.invalid',$2::jsonb)",
              [id(110),JSON.stringify({scheduled_end:window.end,scheduled_tz:'UTC'})]);
            await f.db.query("insert into h2s_dispatch_jobs(job_id,order_id,status,due_at) values($1,'ORD-SECOND','queued',$2)",[id(111),window.start]);
            assert.equal((await f.client.rpc('commercial_record_operation',{p_lead_id:id(2),p_revision:0,p_operation_id:id(++sequence),
              p_actor:{id:id(9),name:'Fixture Admin'},p_action:'link',p_payload:{orderId:id(110),jobId:id(111)}})).error,null);
          }
          await f.db.exec('BEGIN');
          const sql=require('node:fs').readFileSync(require('node:path').join(__dirname,'..','migrations','036_commercial_calendar_workload.sql'),'utf8');
          await assert.rejects(f.db.exec(sql),overlap?/time is reserved/:/complete valid start\/end/);
          await f.db.exec('ROLLBACK');
          assert.equal((await f.db.query("select to_regclass('public.commercial_calendar') name")).rows[0].name,null);
          assert.equal(Date.parse((await f.db.query('select due_at from h2s_dispatch_jobs where job_id=$1',[id(101)])).rows[0].due_at),Date.parse(window.start));
        }finally{await f.db.close();}
      });
    });
    await t.test('calendar API enforces authentication, role, valid inputs and explicit agreement', async () => {
      for (const [token,status] of [['missing',401],['fixture-va',403]]) {
        assert.equal((await f.calendarRequest('GET',null,token)).status,status);
        assert.equal((await f.calendarRequest('POST',{},token)).status,status);
      }
      const input={leadId:id(1),revision:0,operationId:id(++sequence),action:'confirm',payload:{...window,customerAgreed:false}};
      assert.equal((await f.calendarRequest('POST',input)).status,400);
      assert.equal((await f.calendarRequest('POST',{...input,payload:{...window,timezone:'Wrong/Zone'}})).status,400);
      assert.equal((await f.calendarRequest('GET',null,'fixture-admin',{start:'not-a-date'})).status,400);
      assert.equal((await f.calendarRequest('GET',null,'fixture-admin',{end:'2100-01-01T00:00:00Z'})).status,400);
      assert.equal((await f.calendarRequest('POST',{...input,payload:window})).status,200);
      const result=await (await f.calendarRequest('GET')).json();
      assert.equal(result.calendar.booking.state,'confirmed');
      assert.equal(result.calendar.history[0].actor_name,'Fixture Admin');
      assert.equal((await f.calendarRequest('POST',{...input,leadId:id(2),operationId:id(++sequence),payload:window})).status,409);
      await f.db.exec('delete from commercial_calendar_activity; delete from commercial_reservations;');
    });
    const clear = () => f.db.exec('delete from commercial_calendar_activity; delete from commercial_reservations;');
    await t.test('holds block across leads; adjacent windows do not overlap; confirmation requires agreement', async () => {
      const hold = await book(f,1,0,'hold');
      assert.equal(hold.state,'tentative');
      await assert.rejects(book(f,2,0,'confirm'), { code:'23P01' });
      await assert.rejects(book(f,1,1,'confirm',{ ...window,customerAgreed:false }), /agreement/);
      assert.equal((await book(f,1,1,'confirm')).state,'confirmed');
      assert.equal((await book(f,2,0,'confirm',{ ...window,start:window.end,end:'2099-01-01T17:00:00Z' })).state,'confirmed');
      const counts = (await f.db.query('select count(*)::int n from h2s_orders')).rows[0].n;
      assert.equal(counts,2);
      assert.equal((await f.db.query('select count(*)::int n from h2s_dispatch_jobs')).rows[0].n,2);
      assert.deepEqual(f.calls.stripe,[]);
      assert.deepEqual(f.calls.mail,[]);
      await clear();
    });
    await t.test('concurrently submitted conflicting writes have exactly one winner; replay is idempotent', async () => {
      const results = await Promise.allSettled([book(f,1,0,'confirm'),book(f,2,0,'confirm')]);
      assert.equal(results.filter(result => result.status==='fulfilled').length,1);
      assert.equal(results.find(result => result.status==='rejected').reason.code,'23P01');
      await clear();
      const key = id(++sequence);
      const saved = await book(f,1,0,'hold',window,key);
      assert.deepEqual(await book(f,1,0,'hold',window,key),saved);
      await assert.rejects(book(f,1,0,'hold',{...window,reason:'Different'},key), /key reused/);
      assert.equal((await f.db.query('select count(*)::int n from commercial_calendar_activity')).rows[0].n,1);
      await clear();
    });
    await t.test('expiry releases capacity by the clock, without a scheduler or mutation on read', async () => {
      await book(f,1,0,'hold');
      await f.db.exec("update commercial_reservations set expires_at=now()-interval '1 second'");
      const snapshot = await rpc(f,'commercial_calendar_snapshot',{
        p_start:'2099-01-01T00:00:00Z',p_end:'2099-01-02T00:00:00Z',p_lead_id:id(1),
      });
      assert.equal(snapshot.booking.effective_state,'expired');
      assert.equal(snapshot.history.length,1);
      await book(f,2,0,'confirm');
      await assert.rejects(book(f,1,1,'reschedule'), /new hold/);
      await clear();
    });
    await t.test('reschedule and cancel release old capacity, use revisions and preserve before/after history', async () => {
      await book(f,1,0,'confirm');
      await assert.rejects(book(f,1,1,'reschedule',{...window,customerAgreed:false}), /agreement/);
      await book(f,1,1,'reschedule',{...window,start:'2099-01-01T18:00:00Z',end:'2099-01-01T19:00:00Z'});
      await book(f,2,0,'hold');
      await assert.rejects(book(f,1,1,'cancel',{reason:'Stale'}), {code:'40001'});
      await book(f,1,2,'cancel',{reason:'Customer cancelled'});
      const events=(await f.db.query('select * from commercial_calendar_activity where lead_id=$1 order by created_at',[id(1)])).rows;
      assert.equal(events.length,3);
      assert.equal(events[2].before_state.state,'confirmed');
      assert.equal(events[2].after_state.state,'cancelled');
      assert.equal(events[2].actor_id,actor.id);
      await clear();
    });
    await t.test('timestamps represent instants across DST and offsets; no business-hour or duration assumptions', async () => {
      await book(f,1,0,'confirm',{...window,start:'2099-03-08T01:30:00-05:00',end:'2099-03-08T03:30:00-04:00'});
      await assert.rejects(book(f,2,0,'hold',{...window,start:'2099-03-08T06:45:00Z',end:'2099-03-08T07:15:00Z'}), {code:'23P01'});
      await clear();
      await book(f,1,0,'confirm',{...window,start:'2099-01-01T15:00:00Z',end:'2099-01-03T17:00:00Z'});
      await clear();
    });
    await t.test('hold/close/reopen persist an authoritative owner, due date and outcome without cancelling consultation', async () => {
      for (const [token,expected] of [['',401],['fixture-va',403]]) {
        assert.equal((await f.request('POST',workload(f,0,'hold'),token)).status,expected);
      }
      let request=workload(f,0,'hold'), response=await f.request('POST',request);
      assert.equal(response.status,200);
      let result=await response.json();
      assert.equal(result.state.responsible_name,'Fixture Staff');
      assert.ok(result.state.hold_until);
      assert.equal((await f.request('POST',request)).status,200);
      response=await f.request('POST',workload(f,1,'close'));
      assert.equal(response.status,200);
      result=await response.json();
      assert.equal(result.state.disposition,'closed');
      assert.equal(result.state.closure_outcome,'won');
      assert.equal(result.state.sales_chasing_paused,true);
      assert.equal(result.state.next_follow_up_at,null);
      assert.equal(result.state.hold_until,null);
      assert.equal(result.routing.consultationStatus,'approved');
      assert.equal(result.routing.consultationOrderId,'APPT-COM-FIXTURE');
      assert.equal((await f.request('POST',workload(f,2,'reopen'))).status,200);
      result=await (await f.request('GET')).json();
      assert.equal(result.state.disposition,'open');
      assert.equal(result.state.closure_outcome,null);
      assert.equal(result.state.sales_chasing_paused,true);
      assert.equal(result.history.length,3);
      assert.equal(result.history[0].actor_name,'Fixture Admin');
      assert.equal((await f.request('POST',workload(f,3,'hold',{nextFollowUpAt:''}))).status,400);
    });
    await t.test('confirmed reservations remain in the agenda independently of lead closure', async () => {
      await book(f,1,0,'confirm');
      assert.equal((await f.request('POST',workload(f,3,'close'))).status,200);
      const snapshot=await rpc(f,'commercial_calendar_snapshot',{p_start:'2099-01-01T00:00:00Z',p_end:'2099-01-02T00:00:00Z',p_lead_id:id(1)});
      assert.equal(snapshot.entries[0].effective_state,'confirmed');
    });
    await t.test('existing linked installation windows and agenda writes share one atomic schedule', async () => {
      const current=await (await f.request('GET')).json();
      const response=await f.request('POST',{leadId:id(1),revision:current.state.revision,operationId:id(++sequence),
        action:'link',payload:{orderId:id(100),jobId:id(101)}});
      assert.equal(response.status,200);
      let next=await (await f.request('GET')).json();
      assert.equal(Date.parse(next.installation.job.due_at),Date.parse(window.start));
      let booking=(await f.db.query('select * from commercial_reservations where lead_id=$1',[id(1)])).rows[0];
      await book(f,1,booking.revision,'reschedule',{...window,start:'2099-01-01T18:00:00Z',end:'2099-01-01T19:00:00Z'});
      next=await (await f.request('GET')).json();
      assert.equal(Date.parse(next.installation.job.due_at),Date.parse('2099-01-01T18:00:00Z'));
      const oldSchedule={start:'2099-01-02T18:00:00Z',end:'2099-01-02T19:00:00Z',timezone:'America/New_York',
        expectedJobUpdatedAt:next.installation.job.updated_at,expectedOrderUpdatedAt:next.installation.order.updated_at};
      const legacy=await f.request('POST',{leadId:id(1),revision:next.state.revision,operationId:id(++sequence),action:'schedule',payload:oldSchedule});
      assert.equal(legacy.status,200);
      booking=(await f.db.query('select * from commercial_reservations where lead_id=$1',[id(1)])).rows[0];
      assert.equal(Date.parse(booking.starts_at),Date.parse(oldSchedule.start));
      await book(f,1,booking.revision,'cancel',{reason:'Fixture released window'});
      next=await (await f.request('GET')).json();
      assert.equal(next.installation.job.due_at,null);
      assert.equal(next.installation.order.metadata_json.scheduled_end,undefined);
      assert.equal(next.installation.job.status,'queued');
      booking=(await f.db.query('select * from commercial_reservations where lead_id=$1',[id(1)])).rows[0];
      await book(f,1,booking.revision,'confirm',{...window,start:oldSchedule.start,end:oldSchedule.end});
      await assert.rejects(f.db.query("update h2s_dispatch_jobs set status='done' where job_id=$1",[id(101)]),/staff-controlled/);
      assert.equal((await f.db.query('select state from commercial_reservations where lead_id=$1',[id(1)])).rows[0].state,'confirmed');
    });
    await t.test('resuming sales chasing requires an explicit review of a pending future consultation', async () => {
      await f.db.query("insert into commercial_consultation_requests(request_id,lead_id,status,selected_slot_start,metadata) values($1,$2,'pending','2099-01-01T15:00:00Z','{}')",
        [id(250),id(2)]);
      const call=(revision,intent,extra={})=>f.request('POST',{...workload(f,revision,intent,extra),leadId:id(2)});
      assert.equal((await call(0,'hold')).status,200);
      assert.equal((await call(1,'reopen')).status,200);
      assert.equal((await f.db.query('select sales_chasing_paused from commercial_lead_operations where lead_id=$1',[id(2)])).rows[0].sales_chasing_paused,true);
      assert.equal((await call(2,'next_action',{resumeConsultationChasing:true})).status,200);
      assert.equal((await f.db.query('select sales_chasing_paused from commercial_lead_operations where lead_id=$1',[id(2)])).rows[0].sales_chasing_paused,false);
      await f.db.query("update commercial_consultation_requests set selected_slot_start='2000-01-01' where request_id=$1",[id(250)]);
      assert.equal((await call(3,'next_action',{resumeConsultationChasing:true})).status,400);
    });
  } finally { await f.db.close(); }
});
