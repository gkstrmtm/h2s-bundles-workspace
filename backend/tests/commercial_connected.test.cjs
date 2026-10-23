const test=require('node:test'),assert=require('node:assert/strict');
const {createCalendarFixture}=require('./helpers/commercial_calendar_fixture.cjs');
const {inspect}=require('../lib/commercial_calendar_review.cjs');
test('connected lead, agenda and existing job preserve preparation, lifecycle and communication boundaries',async t=>{
 const f=await createCalendarFixture(),id=f.id;let sequence=800,snapshot,winner;
 t.after(()=>f.db.close());
 const get=async()=>{const response=await f.request('GET');assert.equal(response.status,200,await response.clone().text());return response.json();};
 const versions=data=>({expectedJobUpdatedAt:data.installation.job.updated_at,expectedOrderUpdatedAt:data.installation.order.updated_at});
 const action=(name,data,payload)=>({leadId:id(1),revision:data.state.revision,operationId:id(++sequence),action:name,payload});
 const review=(data,overrides={})=>action('preparation',data,{...versions(data),
   preparationRevision:data.installation.preparation.record?.revision||0,context:data.installation.preparation.context,
   scopeReviewed:true,materials:'ready',access:'ready',blockers:'',note:'Scope, materials and site explicitly reviewed',...overrides});
 const save=async(body,token)=>{const response=await f.request('POST',body,token);return {status:response.status,data:await response.json()};};
 const calendar=async(body)=>{const response=await f.calendarRequest('POST',body);assert.equal(response.status,200,await response.clone().text());return response.json();};
 await t.test('link and confirm reuse existing order/job; preparation starts blocked',async()=>{
   assert.equal((await save({leadId:id(1),revision:0,operationId:id(++sequence),action:'link',payload:{orderId:id(100),jobId:id(101)}})).status,200);
   snapshot=await get();
   assert.equal(snapshot.installation.preparation.ready,false);
   await calendar({leadId:id(1),revision:0,operationId:id(++sequence),action:'confirm',payload:{
     start:'2099-01-01T15:00:00Z',end:'2099-01-01T16:00:00Z',timezone:'UTC',customerAgreed:true,reason:'Fixture agreement'}});
   snapshot=await get();
   const assigned=await save(action('assign',snapshot,{...versions(snapshot),proId:id(500),note:'Explicit staff assignment; no notification'}));
   assert.equal(assigned.status,200);snapshot=assigned.data;
   assert.equal((await save(action('start',snapshot,{...versions(snapshot),note:'Cannot start with unreviewed preparation'}))).status,400);
   assert.equal((await f.db.query('select count(*)::int n from h2s_orders')).rows[0].n,2);
 });
 await t.test('two authenticated staff saves have one winner; exact retries do not duplicate history',async()=>{
   const a=review(snapshot,{blockers:'Waiting for materials'}),b=review(snapshot,{blockers:'Waiting for access'});
   const results=await Promise.all([save(a,'fixture-admin'),save(b,'fixture-admin-two')]);
   assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
   const index=results.findIndex(x=>x.status===200);winner={body:[a,b][index],token:['fixture-admin','fixture-admin-two'][index]};
   assert.equal((await save(winner.body,winner.token)).status,200);
   assert.equal((await save({...winner.body,payload:{...winner.body.payload,note:'Changed content'}},winner.token)).status,400);
   const rows=(await f.db.query('select actor_id from h2s_job_preparation_activity')).rows;
   assert.equal(rows.length,1);assert.equal(rows[0].actor_id,id(index===0?9:12));
   snapshot=await get();assert.equal(snapshot.installation.preparation.ready,false);
 });
 await t.test('ready review becomes stale on reschedule; old context cannot be acknowledged as new',async()=>{
   let result=await save(review(snapshot));assert.equal(result.status,200);snapshot=result.data;
   assert.equal(snapshot.installation.preparation.ready,true);
   const previousContext=snapshot.installation.preparation.context;
   const booking=(await f.db.query('select revision from commercial_reservations where lead_id=$1',[id(1)])).rows[0];
   await calendar({leadId:id(1),revision:booking.revision,operationId:id(++sequence),action:'reschedule',payload:{
     start:'2099-01-01T17:00:00Z',end:'2099-01-01T18:00:00Z',timezone:'UTC',customerAgreed:true,reason:'Customer agreed new time'}});
   snapshot=await get();assert.equal(snapshot.installation.preparation.ready,false);
   assert.match(snapshot.installation.preparation.blockers.join(' '),/schedule changed/);
   assert.equal((await save(review(snapshot,{context:previousContext}))).status,409);
   result=await save(review(snapshot));assert.equal(result.status,200);snapshot=result.data;
 });
 await t.test('explicit work-location apply updates lead/order/agenda once and invalidates preparation',async()=>{
   const body=action('location',snapshot,{...versions(snapshot),expectedUpdatedAt:snapshot.lead.updated_at,
     address:'200 Agreed Work Site',city:'Fixture City',state:'NC',postalCode:'28000',applyToJob:true});
   let result=await save(body);assert.equal(result.status,200,JSON.stringify(result));snapshot=result.data;
   assert.equal(snapshot.lead.project_address,snapshot.installation.order.address);
   assert.equal(snapshot.installation.preparation.ready,false);
   const updated=snapshot.installation.order.updated_at;
   result=await save(body);assert.equal(result.status,200);assert.equal(result.data.installation.order.updated_at,updated);
   const agenda=await (await f.calendarRequest('GET')).json();
   assert.match(agenda.calendar.entries[0].location,/200 Agreed Work Site/);
   assert.equal(agenda.calendar.entries[0].job_id,id(101));
   assert.equal(agenda.calendar.entries[0].preparation.ready,false);
 });
 await t.test('lead closure does not complete/cancel job or booking; explicit completion sends nothing',async()=>{
   const closed=await save(action('workload',snapshot,{intent:'close',responsibleId:id(9),
     reason:'Won; installation is tracked independently',outcome:'won',nextFollowUpAt:''}));
   assert.equal(closed.status,200);snapshot=closed.data;
   assert.equal(snapshot.installation.job.status,'assigned');
   assert.equal((await f.db.query('select state from commercial_reservations where lead_id=$1',[id(1)])).rows[0].state,'confirmed');
   await f.db.query("update h2s_orders set status='pending' where id=$1",[id(100)]);
   f.faults.unpaid=true;
   snapshot=(await save(review(await get()))).data;
   const started=await save(action('start',snapshot,{...versions(snapshot),note:'Staff recorded work started'}));
   assert.equal(started.status,200,JSON.stringify(started));snapshot=started.data;
   await assert.rejects(f.db.query("update h2s_dispatch_jobs set status='done' where job_id=$1",[id(101)]),/staff-controlled/);
   const completed=await save(action('complete',snapshot,{...versions(snapshot),note:'Tested work; staff recorded completion'}));
   assert.equal(completed.status,200,JSON.stringify(completed));snapshot=completed.data;
   assert.equal(snapshot.installation.job.status,'completed');assert.equal(snapshot.installation.order.status,'pending');
   assert.equal(snapshot.installation.payment.status,'unpaid');
   assert.equal((await f.db.query('select state from commercial_reservations where lead_id=$1',[id(1)])).rows[0].state,'completed');
   assert.equal((await f.db.query('select count(*)::int n from h2s_payouts_ledger')).rows[0].n,0);
   assert.equal(f.calls.mail.length,0);
   assert.equal((await f.db.query('select count(*)::int n from commercial_effects')).rows[0].n,1);
 });
 await t.test('shared preparation is job-keyed; unrelated historical jobs do not acquire a new gate',async()=>{
   await f.db.query("update h2s_dispatch_jobs set status='in_progress' where job_id=$1",[id(202)]);
   assert.equal((await f.db.query('select count(*)::int n from h2s_job_preparation')).rows[0].n,1);
   assert.equal((await save(review(snapshot))).status,400,'Preparation cannot be edited after starting/completion');
 });
 await t.test('agenda exact lookup reaches a closed lead without altering normal queue filtering',async()=>{
   const queue=require('./helpers/commercial_contact_fixture.cjs').createFixture();
   const now=new Date().toISOString();
   queue.tables.commercial_leads.push({lead_id:id(1),company_name:'Closed booked fixture',created_at:now,last_submitted_at:now});
   queue.tables.commercial_lead_operations=(await f.db.query('select * from commercial_lead_operations')).rows;
   assert.equal((await queue.queue(new URLSearchParams({filter:'attention'}))).queue.length,0);
   const result=await queue.queue(new URLSearchParams({filter:'all',leadId:id(1),limit:'1'}));
   assert.equal(result.queue.length,1);assert.equal(result.queue[0].leadId,id(1));
   await assert.rejects(queue.queue(new URLSearchParams({filter:'all',leadId:'invalid'})),{status:400});
 });
 await t.test('default-deny permissions and enabled execution guard are verified',async()=>{
   const client={query:(...args)=>f.db.query(...args)};
   assert.equal((await inspect(client,true)).serviceOnlyVerified,true);
   await f.db.exec('alter table h2s_dispatch_jobs disable trigger h2s_job_preparation_start');
   await assert.rejects(inspect(client,true),/triggers changed/);
   await f.db.exec('alter table h2s_dispatch_jobs enable trigger h2s_job_preparation_start');
   await f.db.exec('set role service_role');
   await assert.rejects(f.db.exec('delete from h2s_job_preparation'),/permission denied/);
   await f.db.exec('reset role');
 });
});
