const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const { createOperationsFixture, evaluate, id } = require('./helpers/commercial_operations_fixture.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
let sequence = 5000;
const action = (name, revision, payload, leadId = id(1)) => ({ leadId, action:name, revision, payload, operationId:id(++sequence) });
const follow = { responsibleId:id(10), responsibleName:'Caller must not control identity', nextFollowUpAt:'2099-01-01T12:00:00Z', disposition:'open',reason:'',
  contact:{ channel:'call',outcome:'requested_callback',note:'<img src=x onerror=alert(1)> Fixture callback notes' } };

test('commercial API: authorized persistence, explicit installation linkage, Stripe verification and legacy event replay', async t => {
  const f = await createOperationsFixture();
  t.after(() => f.db.close());
  const read = async () => (await f.request('GET')).json();
  const post = async body => { const response = await f.request('POST',body); return { response, data:await response.json() }; };
  await t.test('unauthenticated and VA users cannot read or mutate; assigning responsibility grants no access', async () => {
    for (const [token,status] of [['missing',401],['fixture-va',403]]) {
      assert.equal((await f.request('GET',null,token)).status,status);
      assert.equal((await f.request('POST',action('follow_up',0,follow),token)).status,status);
    }
    assert.equal((await f.db.query('select count(*)::int n from commercial_lead_activity')).rows[0].n,0);
    const data = await read();
    assert.equal(data.installation,null);
    assert.equal(data.state.revision,0);
    assert.equal(data.staff.length,2);
    assert.equal(Object.hasOwn(data.staff[0],'Pin_Hash'),false);
    await f.db.exec('alter table commercial_lead_operations rename to fixture_missing_operations');
    const missing = await f.request('GET');
    assert.equal(missing.status,503);
    assert.equal((await missing.json()).code,'SCHEMA_UNAVAILABLE');
    await f.db.exec('alter table fixture_missing_operations rename to commercial_lead_operations');
    for(const [code,status,expected] of [['42703',503,'SCHEMA_UNAVAILABLE'],['PGRST204',503,'SCHEMA_UNAVAILABLE'],['42501',403,'PERMISSION_UNAVAILABLE']]) {
      f.faults.table='commercial_lead_operations';f.faults.code=code;
      const response=await f.request('GET');
      assert.equal(response.status,status);
      assert.equal((await response.json()).code,expected);
    }
    f.faults.table=null;f.faults.code=null;
  });
  await t.test('actor/staff identities come from authentication/directory; reload and duplicate retry persist exactly once', async () => {
    const body = { ...action('follow_up',0,follow), actor:{id:'forged',name:'Forged'} };
    let { response, data } = await post(body);
    assert.equal(response.status,200,JSON.stringify(data));
    assert.equal(data.state.responsible_name,'Fixture Staff');
    assert.equal(data.history[0].actor_name,'Fixture Admin');
    assert.equal(data.history[0].payload.contact.note,follow.contact.note);
    ({ response,data } = await post(body));
    assert.equal(response.status,200);
    assert.equal(data.history.length,1);
    assert.equal((await read()).state.revision,1);
    assert.equal((await post(action('follow_up',0,follow))).response.status,409);
    assert.equal((await post({ ...body,payload:{...follow,reason:'Changed retry'} })).response.status,409);
    assert.equal((await post(action('follow_up',1,{...follow,responsibleId:id(11)}))).response.status,400);
  });
  await t.test('location persistence participates in public intake revision and microsecond CAS', async () => {
    const before = await read();
    assert.match(before.lead.updated_at,/123456/);
    const payload = { address:'100 Updated Fixture Lane',city:'Fixture City',state:'NC',postalCode:'00000',expectedUpdatedAt:before.lead.updated_at };
    const { response,data } = await post(action('location',1,payload));
    assert.equal(response.status,200,JSON.stringify(data));
    assert.equal(data.lead.project_address,payload.address);
    assert.equal((await f.db.query('select revision from commercial_leads where lead_id=$1',[id(1)])).rows[0].revision,1);
    assert.equal((await post(action('location',2,{...payload,address:'Stale overwrite'}))).response.status,409);
  });
  await t.test('order lookup is read-only; consultations cannot be linked or counted as paid installations', async () => {
    assert.equal((await f.request('GET',null,'fixture-admin',{orderRef:'APPT-COM-FIXTURE'})).status,400);
    for(const total of [null,0,'NaN','Infinity','-Infinity']) {
      await f.db.query('update h2s_orders set total=$1 where id=$2',[total,id(100)]);
      assert.equal((await f.request('GET',null,'fixture-admin',{orderRef:'ORD-FIXTURE'})).status,400);
    }
    await f.db.query('update h2s_orders set total=1200 where id=$1',[id(100)]);
    const candidate = await (await f.request('GET',null,'fixture-admin',{orderRef:'ORD-FIXTURE'})).json();
    assert.equal(candidate.jobs.length,1);
    assert.equal((await read()).installation,null);
    assert.equal((await post(action('link',2,{orderId:id(200),jobId:id(202)}))).response.status,400);
    const {response,data} = await post(action('link',2,{orderId:id(100),jobId:id(101)}));
    assert.equal(response.status,200,JSON.stringify(data));
    assert.equal(data.installation.payment.status,'paid');
    assert.equal(data.routing.consultationOrderId,'APPT-COM-FIXTURE');
    assert.equal(data.installation.job.job_id,id(101));
  });
  await t.test('incomplete linked records fail closed without advancing history or installation state', async () => {
    const before=await read(),start=new Date(Date.now()+86400000).toISOString(),end=new Date(Date.now()+90000000).toISOString();
    const payload={start,end,timezone:'UTC',expectedJobUpdatedAt:before.installation.job.updated_at,expectedOrderUpdatedAt:before.installation.order.updated_at};
    for(const alteration of [
      `update h2s_dispatch_jobs set order_id=null where job_id='${id(101)}'`,
      `update h2s_orders set total=null where id='${id(100)}'`,
      `update h2s_orders set total='NaN' where id='${id(100)}'`,
    ]) {
      await f.db.exec(alteration);
      assert.equal((await f.request('GET')).status,409);
      assert.equal((await post(action('schedule',3,payload))).response.status,400);
      assert.equal((await f.db.query('select revision from commercial_lead_operations where lead_id=$1',[id(1)])).rows[0].revision,3);
      assert.equal((await f.db.query('select count(*)::int n from commercial_lead_activity')).rows[0].n,3);
      await f.db.exec(`update h2s_dispatch_jobs set order_id='ORD-FIXTURE' where job_id='${id(101)}'; update h2s_orders set total=1200 where id='${id(100)}'`);
    }
  });
  await t.test('Stripe, not an order status or opened page, determines paid/refunded/disputed/unavailable states', async () => {
    f.faults.unpaid = true; assert.equal((await read()).installation.payment.status,'unpaid');
    f.faults.unpaid = false; f.faults.refund = 100; assert.equal((await read()).installation.payment.status,'partially_refunded');
    f.faults.refund = 120000; assert.equal((await read()).installation.payment.status,'refunded');
    f.faults.refund = 0; f.faults.dispute = true; assert.equal((await read()).installation.payment.status,'disputed');
    f.faults.dispute = false; f.faults.amount = 1; assert.equal((await read()).installation.payment.status,'unverified');
    f.faults.amount = 0; f.faults.stripe = true; assert.equal((await read()).installation.payment.status,'unavailable');
    f.faults.stripe = false;
    assert.equal((await f.db.query('select status from h2s_orders where id=$1',[id(100)])).rows[0].status,'paid');
  });
  await t.test('scheduling updates existing sparse dispatch/order fields, not the consultation or a second job', async () => {
    const before = await read();
    const start = new Date(Date.now()+86400000).toISOString(), end = new Date(Date.now()+90000000).toISOString();
    const {response,data} = await post(action('schedule',3,{start,end,timezone:'America/New_York',
      expectedJobUpdatedAt:before.installation.job.updated_at,expectedOrderUpdatedAt:before.installation.order.updated_at}));
    assert.equal(response.status,200,JSON.stringify(data));
    assert.equal(Date.parse(data.installation.job.due_at),Date.parse(start));
    assert.equal(data.installation.job.status,'queued');
    assert.equal(data.installation.order.metadata_json.scheduled_via,'commercial_queue');
    assert.equal(data.routing.consultationOrderId,'APPT-COM-FIXTURE');
    assert.equal((await f.db.query('select count(*)::int n from h2s_dispatch_jobs')).rows[0].n,2);
  });
  await t.test('actual existing webhook replays retain installation schedule and create no duplicate job/order', async () => {
    const before = await read();
    let event = { type:'checkout.session.completed',data:{object:{id:'cs_fixture',payment_intent:'pi_fixture',payment_status:'paid',
      amount_total:120000,customer_details:{name:'Fixture Customer',email:'fixture@example.invalid',address:{line1:'100 Fixture Way'}},metadata:{cart_items:'[]'}}} };
    const notifications = new Set();
    const webhook = evaluate('app\\api\\stripe-webhook\\route.ts',{
      'next/server':{NextResponse:{json:(value,options)=>Response.json(value,options)}},
      stripe:class { constructor(){return {webhooks:{constructEvent:()=>event}};} },
      '@supabase/supabase-js':{createClient:()=>f.client},
      crypto:require('node:crypto'),
      '../../../lib/supabase':{getSupabase:()=>f.client,getSupabaseDispatch:()=>f.client},
    },{fetch:async (url,options)=>{
      assert.match(url,/\/api\/notify-management$/);
      notifications.add(JSON.parse(options.body).idempotency_key);
      return Response.json({ok:true});
    }});
    const invoke = () => webhook.POST(new Request('http://fixture.invalid/api/stripe-webhook',{method:'POST',headers:{'stripe-signature':'fixture-only'},body:'fixture-only'}));
    assert.equal((await invoke()).status,200);
    assert.equal((await invoke()).status,200);
    event = {type:'payment_intent.succeeded',data:{object:{id:'pi_fixture',amount:120000}}};
    assert.equal((await invoke()).status,200);
    assert.equal((await invoke()).status,200);
    const after = await read();
    assert.equal(after.installation.order.metadata_json.scheduled_date,before.installation.order.metadata_json.scheduled_date);
    assert.equal(after.installation.order.metadata_json.scheduled_end,before.installation.order.metadata_json.scheduled_end);
    assert.equal(after.installation.job.job_id,before.installation.job.job_id);
    assert.equal(notifications.size,1);
    assert.equal((await f.db.query('select count(*)::int n from h2s_orders')).rows[0].n,2);
  });
  await t.test('ADMIN assignment, start and completion record facts only; existing paid payouts never change', async () => {
    let before = await read();
    const completion = snapshot => ({ note:'Fixture installation tested and complete',
      expectedJobUpdatedAt:snapshot.installation.job.updated_at,expectedOrderUpdatedAt:snapshot.installation.order.updated_at });
    assert.equal((await post(action('complete',4,completion(before)))).response.status,400);
    const versions = data => ({expectedJobUpdatedAt:data.installation.job.updated_at,expectedOrderUpdatedAt:data.installation.order.updated_at});
    assert.equal((await post(action('assign',4,{...versions(before),proId:id(501),note:'Inactive'}))).response.status,400);
    let assigned = await post(action('assign',4,{...versions(before),proId:id(500),note:'Installer confirmed by staff'}));
    assert.equal(assigned.response.status,200,JSON.stringify(assigned.data));
    assert.equal(assigned.data.installation.job.status,'assigned');
    const started = await post(action('start',5,{...versions(assigned.data),note:'Equipment and work address checked; installation started'}));
    assert.equal(started.response.status,200,JSON.stringify(started.data));
    await f.db.query("insert into h2s_payouts_ledger(job_id,pro_id,payout_type,amount,status) values($1,$2,'job',420,'paid')",[id(101),id(500)]);
    const paidBefore = (await f.db.query('select * from h2s_payouts_ledger')).rows;
    f.faults.table='h2s_jobs';
    before = await read();
    const body = action('complete',6,completion(before));
    let {response,data} = await post(body);
    assert.equal(response.status,200,JSON.stringify(data));
    assert.equal(data.installation.job.status,'completed');
    assert.equal(data.state.disposition,'open');
    assert.equal(data.state.completed_by.name,'Fixture Admin');
    assert.equal(Object.hasOwn(data.state,'completion_processing'),false);
    const mailCount = f.calls.mail.length;
    assert.equal(f.calls.resolver,0,'Commercial context must not globally redirect legacy resolution');
    const ledger = (await f.db.query('select * from h2s_payouts_ledger')).rows;
    assert.equal(ledger.length,1);
    assert.equal(ledger[0].pro_id,id(500));
    assert.equal(ledger[0].status,'paid');
    assert.equal(Number(ledger[0].amount),420);
    await f.db.query("update h2s_dispatch_job_assignments set state='done' where job_id=$1",[id(101)]);
    ({response,data} = await post(body));
    assert.equal(response.status,200,JSON.stringify(data));
    assert.equal(f.calls.mail.length,mailCount);
    assert.equal((await f.db.query('select count(*)::int n from h2s_payouts_ledger')).rows[0].n,1);
    assert.equal(data.history.length,7);
    assert.deepEqual((await f.db.query('select * from h2s_payouts_ledger')).rows,paidBefore);
    assert.equal(f.calls.mail.length,0);
    assert.equal(f.calls.resolver,0);
    f.faults.table=null;
  });
  await t.test('closure rejects null/blank reasons at the API boundary', async () => {
    for(const reason of [null,'','  ','\t\n\r']) assert.equal((await post(action('follow_up',7,{...follow,disposition:'closed',reason}))).response.status,400);
  });
});

test('Email-first contact logging defaults to email and preserves preference across saves, overrides and reload', async t => {
  const f = await createOperationsFixture();
  const dom = new JSDOM('<section data-commercial-operations></section>',{url:'http://fixture.invalid/dash.html',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(async()=>{dom.window.close();await f.db.close();});
  const w = dom.window, host = w.document.querySelector('section'), posts = [];
  w.fetch = async (url, options) => {
    const response = await f.route[options.method](new Request(url, options));
    if (options.method === 'POST') posts.push(await response.clone().json());
    return response;
  };
  w.eval(fs.readFileSync(path.join(__dirname,'..','..','frontend','commercial-operations.js'),'utf8'));
  await w.H2SCommercialOperations.mount(host,id(1),{apiBase:'http://fixture.invalid',getToken:()=> 'fixture-admin'});
  assert.equal(host.querySelector('[name=channel]').value,'email');
  for (const [index, channel] of ['email','call'].entries()) {
    const form = host.querySelector('[data-action=follow_up]');
    assert.equal(form.querySelector('[name=channel]').value,'email');
    form.querySelector('[name=recordContact]').checked=true;
    form.querySelector('[name=channel]').value=channel;
    form.querySelector('[name=outcome]').value='no_response';
    form.querySelector('[name=note]').value=`Synthetic ${channel} attempt; no provider send.`;
    form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    for(let attempt=0;attempt<1000 && !host.querySelector('[data-operations-status]').textContent.startsWith('Saved.');attempt++) await tick();
    assert.match(host.querySelector('[data-operations-status]').textContent,/^Saved\./);
    assert.equal(posts.length,index+1);
    assert.equal(posts[index].lead.contact_preference,'email');
    assert.equal(posts[index].lead.email,'fixture@example.invalid');
    assert.equal(posts[index].history[0].payload.contact.channel,channel);
    assert.equal(posts[index].followUp.enabled,false);
    assert.equal(host.querySelector('[name=channel]').value,'email');
  }
  const restored = await (await f.request('GET')).json();
  assert.equal(restored.lead.contact_preference,'email');
  assert.equal(restored.history.length,2);
  assert.equal((await f.db.query('select contact_preference from commercial_leads where lead_id=$1',[id(1)])).rows[0].contact_preference,'email');
  assert.deepEqual(f.calls.mail,[]);
  assert.deepEqual(f.calls.stripe,[]);
  assert.equal(f.calls.resolver,0);
});

test('full detail module preserves drafts, focus, failures and stale-read protection', async t => {
  const f = await createOperationsFixture();
  const dom = new JSDOM('<section data-commercial-operations></section>',{url:'http://fixture.invalid/dash.html',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(async()=>{dom.window.close();await f.db.close();});
  const w = dom.window;
  let clock = Date.now();
  w.Date.now = () => clock;
  let failRead = false, heldRead, release;
  w.confirm = () => true;
  w.fetch = async (url,options) => {
    if (options.method === 'GET' && heldRead) {
      const original = await f.route.GET(new Request(url,options));
      await new Promise(resolve=>{release=resolve;});
      return original;
    }
    if (options.method === 'GET' && failRead) return Response.json({ok:false,error:'Fixture refresh failed'},{status:503});
    return f.route[options.method](new Request(url,options));
  };
  w.eval(fs.readFileSync(path.join(__dirname,'..','..','frontend','commercial-operations.js'),'utf8'));
  const host = w.document.querySelector('section'), options = {apiBase:'http://fixture.invalid',getToken:()=> 'fixture-admin'};
  await w.H2SCommercialOperations.mount(host,id(1),options);
  assert.match(host.textContent,/Quote\/payment setup required/);
  assert.match(host.textContent,/Payment collection is not connected/);
  const note = host.querySelector('[name=note]');
  note.value = 'Draft that must survive';
  note.focus();
  note.dispatchEvent(new w.Event('input',{bubbles:true}));
  await w.H2SCommercialOperations.refresh(id(1));
  assert.equal(host.querySelector('[name=note]'),note);
  assert.equal(note.value,'Draft that must survive');
  assert.equal(w.document.activeElement,note);
  failRead = true;
  await w.H2SCommercialOperations.refresh(id(1));
  assert.equal(host.querySelector('[name=note]'),note);
  assert.match(host.querySelector('[data-operations-status]').textContent,/temporarily unavailable/);
  assert.equal(Array.from(host.querySelectorAll('button')).some(node=>node.textContent==='Retry'),false);
  failRead = false;
  clock += 3000;
  await w.H2SCommercialOperations.refresh(id(1));
  host.querySelector('[data-reload]').click();
  await tick(); await tick();
  await w.H2SCommercialOperations.refresh(id(1));
  heldRead = true;
  const stale = w.H2SCommercialOperations.refresh(id(1));
  while (!release) await tick();
  const form = host.querySelector('[data-action=follow_up]');
  form.querySelector('[name=responsibleId]').value=id(10);
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
  while (!(await f.db.query('select count(*)::int n from commercial_lead_activity')).rows[0].n) await tick();
  release();
  await stale;
  heldRead = false;
  for(let attempts=0;attempts<100 && !host.textContent.includes('Saved.');attempts++) await tick();
  assert.match(host.textContent,/Fixture Staff/);
  assert.match(host.textContent,/Saved\./);
  const persisted = await (await f.request('GET')).json();
  assert.equal(persisted.state.revision,1);
  assert.equal(persisted.history.length,1);
  assert.equal(host.querySelector('img'),null);
});

test('lost responses replay once; completion survives unavailable response reads without downstream effects', async t => {
  const f = await createOperationsFixture();
  t.after(() => f.db.close());
  const body = action('follow_up',0,{...follow,contact:undefined});
  f.faults.afterSave = true;
  assert.equal((await f.request('POST',body)).status,503);
  f.faults.afterSave = false;
  f.faults.table = null;
  let response = await f.request('POST',body), data = await response.json();
  assert.equal(response.status,200,JSON.stringify(data));
  assert.equal(data.state.revision,1);
  assert.equal(data.history.length,1);
  response = await f.request('POST',action('link',1,{orderId:id(100),jobId:id(101)}));
  assert.equal(response.status,200);
  await f.db.query("update h2s_dispatch_jobs set status='in_progress',updated_at=now() where job_id=$1",[id(101)]);
  const before = await (await f.request('GET')).json();
  const complete = action('complete',2,{note:'Fixture completion with payout processing failure',
    expectedJobUpdatedAt:before.installation.job.updated_at,expectedOrderUpdatedAt:before.installation.order.updated_at});
  f.faults.table = 'h2s_job_artifacts';
  assert.equal((await f.request('POST',complete)).status,503);
  assert.equal((await f.db.query('select status from h2s_dispatch_jobs where job_id=$1',[id(101)])).rows[0].status,'completed');
  f.faults.table = null;
  data = await (await f.request('POST',complete)).json();
  assert.equal(data.installation.job.status,'completed');
  assert.equal(data.history.length,3);
  assert.equal(f.calls.mail.length,0);
  assert.equal((await f.db.query('select count(*)::int n from h2s_payouts_ledger')).rows[0].n,0);
  for(const status of ['unpaid','refunded','disputed','unavailable']) {
    Object.assign(f.faults,{unpaid:status==='unpaid',refund:status==='refunded'?120000:0,dispute:status==='disputed',stripe:status==='unavailable'});
    const latest=await (await f.request('GET')).json();
    assert.equal(latest.installation.payment.status,status);
    assert.equal(latest.installation.job.status,'completed');
    assert.equal(latest.state.completed_by.name,'Fixture Admin');
  }
});

test('communication projection uses recorded results without leaking provider identifiers or errors', () => {
  const {commercialCommunicationSummary: summarize}=evaluate('lib\\commercial_communications.ts',{
    '@/lib/sms_delivery':evaluate('lib\\sms_delivery.ts',{}),
  });
  const effects=[
    {kind:'dispatch:window:initial:+15550000005',state:'accepted',details:{sid:'SMprivate',status:'queued',error:'internal secret'},updated_at:'2026-01-01T10:00:00Z'},
    {kind:'reminder:window:initial:+15550000005',state:'accepted',details:{sid:'SMreceipt'},updated_at:'2026-01-01T11:00:00Z'},
    {kind:'escalation:+15550000006',state:'failed',details:{error:'raw provider payload'},updated_at:'2026-01-01T12:00:00Z'},
    {kind:'customer_confirmation',state:'uncertain',details:{to:'+15550000007'},updated_at:null},
    {kind:'customer_acknowledgement:initial',state:'processing',details:{to:'+15550000007'},updated_at:'2026-01-01T13:00:00Z'},
  ];
  const events=summarize(effects,[{twilio_sid:'SMreceipt',status:'delivered',created_at:'2026-01-01T10:59:00Z'}]);
  assert.deepEqual(new Set(events.map(row=>row.result)),new Set(['provider_accepted','delivered','failed','uncertain','pending']));
  assert.match(events.find(row=>row.result==='delivered').receipt,/timestamp unavailable/);
  assert.equal(events.find(row=>row.result==='uncertain').at,null);
  assert.equal(events.find(row=>row.result==='provider_accepted').role,'Technician notification');
  assert.doesNotMatch(JSON.stringify(events),/SMprivate|SMreceipt|internal secret|raw provider payload/);
  const contradictory=summarize([{...effects[1],state:'failed'}],[{twilio_sid:'SMreceipt',status:'delivered'}])[0];
  assert.equal(contradictory.result,'delivered');
  assert.match(contradictory.processingIssue,/still needs review/);
});

test('API communication evidence uses persisted receipts and explicitly tolerates unavailable receipt storage', async t => {
  const f=await createOperationsFixture();
  t.after(()=>f.db.close());
  await f.db.query(`insert into commercial_effects(request_id,kind,state,details) values
    ($1,'dispatch:window:initial:+15550000005','accepted','{"sid":"SMfixture","status":"queued"}'),
    ($1,'escalation:+15550000006','failed','{"error":"Do not expose internal error"}')`,[id(201)]);
  await f.db.query("insert into sms_messages(twilio_sid,status) values('SMfixture','delivered')");
  let data=await (await f.request('GET')).json();
  assert.equal(data.communications.available,true);
  assert.equal(data.communications.events[0].result,'failed');
  assert.equal(data.communications.events[1].result,'delivered');
  assert.deepEqual(data.communications.technicianRouting,{available:true,recipients:['+15550000005']});
  assert.deepEqual(data.communications.escalationRecipients,['+15550000006']);
  assert.doesNotMatch(JSON.stringify(data.communications),/SMfixture|internal error/);
  assert.equal(f.calls.stripe.length,0,'An unlinked lead has no payment provider reads');
  f.faults.table='sms_messages';
  data=await (await f.request('GET')).json();
  assert.equal(data.communications.available,true);
  assert.equal(data.communications.receiptLookupAvailable,false);
  assert.equal(data.communications.events[1].result,'provider_accepted');
  f.faults.table='commercial_effects';
  data=await (await f.request('GET')).json();
  assert.equal(data.communications.available,false);
  assert.deepEqual(data.communications.events,[]);
  f.faults.table=null;f.faults.routing=true;
  data=await (await f.request('GET')).json();
  assert.equal(data.communications.technicianRouting.available,false);
  assert.deepEqual(data.communications.technicianRouting.recipients,[]);
});

test('read recovery is bounded/deduplicated, preserves drafts and never retries unavailable schema or auth', async t => {
  const f=await createOperationsFixture();
  const dom=new JSDOM('<section></section>',{url:'http://fixture.invalid',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(async()=>{dom.window.close();await f.db.close();});
  const w=dom.window,host=w.document.querySelector('section'),timers=[];
  let clock=Date.now(),reads=0,posts=0,mode='ok';
  w.Date.now=()=>clock;
  const nativeTimeout=w.setTimeout.bind(w);
  w.setTimeout=(callback,delay,...args)=>[2000,5000,15000].includes(delay)?(timers.push({callback,delay}),900+timers.length):nativeTimeout(callback,delay,...args);
  host.getClientRects=()=>[{}];
  w.fetch=async(url,options)=>{
    if(options.method==='POST')posts++;else reads++;
    if(mode==='schema')return Response.json({ok:false,code:'SCHEMA_UNAVAILABLE'},{status:503});
    if(mode==='auth')return Response.json({ok:false},{status:403});
    if(mode==='transient')return Response.json({ok:false},{status:503});
    return f.route[options.method](new Request(url,options));
  };
  w.eval(fs.readFileSync(path.join(__dirname,'..','..','frontend','commercial-operations.js'),'utf8'));
  const options={apiBase:'http://fixture.invalid',getToken:()=> 'fixture-admin'};
  await w.H2SCommercialOperations.mount(host,id(1),options);
  const note=host.querySelector('[name=note]');note.value='Retain this draft';note.focus();
  note.dispatchEvent(new w.Event('input',{bubbles:true}));
  mode='transient';
  const baseline=reads;
  await Promise.all(Array.from({length:10},()=>w.H2SCommercialOperations.refresh(id(1))));
  while(timers.length){const timer=timers.shift();clock+=timer.delay+1;timer.callback();await tick();await tick();}
  assert.equal(reads-baseline,4,'One failed read and exactly three bounded retries');
  for(let i=0;i<10;i++)w.dispatchEvent(new w.Event('online'));
  await tick();
  assert.equal(reads-baseline,4);
  assert.equal(host.querySelector('[name=note]'),note);
  assert.equal(w.document.activeElement,note);
  assert.equal(posts,0);
  assert.equal(note.value,'Retain this draft');
  mode='ok';clock+=61000;
  await w.H2SCommercialOperations.mount(host,id(1),options);
  assert.equal(reads-baseline,5,'Returning to the active view rearms only after cooldown');
  assert.equal(host.querySelector('[name=note]'),note);
  assert.equal(note.value,'Retain this draft');
  host.remove();
  for(const failure of ['schema','auth']) {
    mode=failure;const target=w.document.createElement('section');w.document.body.append(target);
    await w.H2SCommercialOperations.mount(target,id(failure==='schema'?2:3),options);
    const before=reads;
    clock+=61000;
    for(let i=0;i<5;i++){await w.H2SCommercialOperations.refresh(id(failure==='schema'?2:3));w.dispatchEvent(new w.Event('online'));}
    await tick();
    assert.equal(timers.length,0);
    assert.equal(reads,before,'Permanent failures never loop');
  }
});
