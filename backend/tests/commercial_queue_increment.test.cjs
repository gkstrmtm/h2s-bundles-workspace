const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), twilio = require('twilio');
const { JSDOM } = require('jsdom');
const { createOperationsFixture, evaluate, id } = require('./helpers/commercial_operations_fixture.cjs');
const { createFixture } = require('./helpers/commercial_contact_fixture.cjs');
const next = require('next/server');
const policyModule = evaluate('lib\\internal_follow_up.ts', { 'node:crypto': crypto });
const configuration = { ...policyModule.proposedFollowUpPolicy, enabled: true };
const tick = () => new Promise(resolve => setImmediate(resolve));
let sequence = 8000;
const action = (payload, revision = 0) => ({ leadId:id(1),operationId:id(++sequence),revision,action:'follow_up',
  payload:{ responsibleId:'',disposition:'open',reason:'',nextFollowUpAt:'',...payload } });

test('internal policy: inactive defaults, business days, timezone/DST, overrides, terminal states and stable event-based dates', () => {
  const p = policyModule;
  assert.equal(p.readFollowUpPolicy().enabled,false);
  for (const raw of ['{}','false','{','{"enabled":true,"timeZone":"invalid"}']) assert.throws(()=>p.readFollowUpPolicy(raw));
  assert.throws(()=>p.readFollowUpPolicy(JSON.stringify({...configuration,timeZone:'not/a-zone'})));
  const context={ disposition:'open',completed:false,mode:'automatic',event:{id:'persisted-event',at:'2026-03-06T20:00:00Z',outcome:'no_response'} };
  const decision = p.followUpDecision(context,configuration);
  assert.equal(decision.dueAt,'2026-03-09T13:00:00.000Z','Friday + 1 business day crosses US DST, Monday 09:00 EDT');
  assert.equal(p.followUpDecision({...context,event:{...context.event,outcome:'left_message'}},configuration).dueAt,'2026-03-10T13:00:00.000Z');
  assert.deepEqual(p.followUpDecision(context,configuration),decision,'Overdue source is never rolled forward based on run time');
  assert.equal(p.followUpDecision({...context,mode:'manual',nextAt:'2099-01-01T12:00:00Z'},configuration).dueAt,'2099-01-01T12:00:00Z');
  assert.equal(p.followUpDecision({...context,mode:'customer_callback',nextAt:'2099-02-01T12:00:00Z'},configuration).dueAt,'2099-02-01T12:00:00Z');
  for (const disposition of ['closed','lost']) assert.equal(p.followUpDecision({...context,disposition},configuration).dueAt,null);
  assert.equal(p.followUpDecision({...context,completed:true},configuration).dueAt,null);
  for (const outcome of ['reached','other','requested_callback']) assert.equal(p.followUpDecision({...context,event:{...context.event,outcome}},configuration).dueAt,null);
  assert.equal(p.followUpDecision({...context,event:null},configuration).dueAt,null);
  assert.throws(()=>p.followUpDecision({...context,event:{...context.event,at:'invalid'}},configuration),/persisted timestamp/);
  const lordHowe={...configuration,timeZone:'Australia/Lord_Howe'};
  assert.equal(p.followUpDecision({...context,event:{id:'half-hour-dst',at:'2026-10-02T02:00:00Z',outcome:'new_request'}},lordHowe).dueAt,'2026-10-04T22:00:00.000Z');
  assert.equal(p.followUpOperationId(decision.sourceKey),p.followUpOperationId(decision.sourceKey));
});

test('persisted internal tasks: scheduler/save/reload idempotence, callback priority, manual clear and terminal suppression', async t => {
  const f=await createOperationsFixture({INTERNAL_FOLLOW_UP_POLICY_JSON:JSON.stringify(configuration)});
  t.after(()=>f.db.close());
  await f.db.exec("update commercial_consultation_requests set created_at='2026-03-06T20:00:00Z'");
  assert.equal(await f.followUp.applyAutomaticFollowUp(id(1)),'updated');
  assert.equal(await f.followUp.applyAutomaticFollowUp(id(1)),'unchanged');
  let snapshot=await(await f.request('GET')).json();
  assert.equal(Date.parse(snapshot.state.next_follow_up_at),Date.parse('2026-03-09T13:00:00Z'));
  assert.equal(snapshot.history.length,1);
  assert.equal(snapshot.history[0].actor_name,'Internal follow-up policy');
  assert.match(snapshot.followUp.reason,/business day/);
  const saved=action({followUpMode:'automatic',contact:{channel:'call',outcome:'left_message',note:'Fixture only'}},1);
  assert.equal((await f.request('POST',saved)).status,200);
  assert.equal((await f.request('POST',saved)).status,200);
  snapshot=await(await f.request('GET')).json();
  assert.equal(snapshot.history.length,2);
  assert.equal(await f.followUp.applyAutomaticFollowUp(id(1)),'unchanged');
  const callback=action({followUpMode:'automatic',nextFollowUpAt:'2099-01-01T12:00:12.123456Z',
    contact:{channel:'call',outcome:'requested_callback',note:'Customer exact time'}},2);
  assert.equal((await f.request('POST',callback)).status,200);
  assert.equal(await f.followUp.applyAutomaticFollowUp(id(1)),'manual_override');
  snapshot=await(await f.request('GET')).json();
  assert.equal(snapshot.followUp.mode,'customer_callback');
  assert.equal(Date.parse(snapshot.state.next_follow_up_at),Date.parse('2099-01-01T12:00:12.123456Z'));
  assert.match(snapshot.state.next_follow_up_at,/12\.123456/);
  assert.equal((await f.request('POST',action({followUpMode:'customer_callback'},3))).status,400);
  assert.equal((await f.request('POST',action({followUpMode:'manual'},3))).status,200);
  assert.equal(await f.followUp.applyAutomaticFollowUp(id(1)),'manual_override','Explicitly cleared manual date stays cleared');
  assert.equal((await f.request('POST',action({followUpMode:'automatic',
    contact:{channel:'call',outcome:'no_response',note:'Callback attempt made; no answer'}},4))).status,200);
  await f.db.exec(`update commercial_lead_operations set order_id='${id(100)}',installation_job_id='${id(101)}';update h2s_dispatch_jobs set status='completed' where job_id='${id(101)}'`);
  assert.equal(await f.followUp.applyAutomaticFollowUp(id(1)),'updated','Completed installation clears only the automatic internal task');
  assert.equal(await f.followUp.applyAutomaticFollowUp(id(1)),'unchanged');
  snapshot=await(await f.request('GET')).json();
  assert.equal(snapshot.state.next_follow_up_at,null);
  assert.equal(snapshot.state.disposition,'open','Installation and disposition remain independent');
  assert.equal(snapshot.followUp.completed,true);
  assert.equal((await f.request('POST',action({followUpMode:'automatic',disposition:'closed',reason:'Lost'},6))).status,200);
  assert.equal(await f.followUp.applyAutomaticFollowUp(id(1)),'unchanged');
  assert.equal(f.calls.mail.length,0);
  assert.equal(f.calls.resolver,0);
});

test('follow-up guard rejects concurrent revisions and terminal task generation; review inspector checks actual SQL and grants', async t => {
  const f=await createOperationsFixture({INTERNAL_FOLLOW_UP_POLICY_JSON:JSON.stringify(configuration)});
  t.after(()=>f.db.close());
  const payload={responsibleId:'',responsibleName:'',disposition:'open',reason:'',nextFollowUpAt:'2099-01-01T12:00:00Z',followUp:{mode:'automatic'}};
  const write=(revision,body=payload)=>f.client.rpc('commercial_record_follow_up',{p_lead_id:id(1),p_revision:revision,
    p_operation_id:id(++sequence),p_actor:{id:'fixture-system',name:'Fixture system'},p_payload:body});
  assert.equal((await write(0)).error,null);
  assert.equal((await write(0)).error.code,'40001');
  await f.db.exec(`update commercial_lead_operations set completed_at=now()`);
  assert.equal((await write(1)).error.code,'40001');
  await f.db.exec(`update commercial_lead_operations set completed_at=null,order_id='${id(100)}',installation_job_id='${id(101)}'`);
  for(const status of ['completed','done','cancelled']) {
    await f.db.query('update h2s_dispatch_jobs set status=$1 where job_id=$2',[status,id(101)]);
    assert.equal((await write(1)).error.code,'40001');
  }
  await f.db.query("update h2s_dispatch_jobs set status='queued' where job_id=$1",[id(101)]);
  f.faults.beforeFollowUp=async()=>{
    assert.equal((await f.request('POST',action({followUpMode:'manual',nextFollowUpAt:'2099-02-02T12:00:00Z'},1))).status,200);
  };
  assert.equal(await f.followUp.applyAutomaticFollowUp(id(1)),'changed_during_review');
  const manual=(await f.db.query('select next_follow_up_at from commercial_lead_operations')).rows[0];
  assert.equal(manual.next_follow_up_at.toISOString(),'2099-02-02T12:00:00.000Z','Concurrent staff override wins over automatic maintenance');
  const inspection=require('../lib/commercial_queue_review.cjs');
  assert.equal((await inspection.inspect(f.db,true)).serviceOnlyVerified,true);
  await assert.rejects(()=>inspection.inspect(f.db,false),/without a verified ledger/);
  await f.db.exec('grant insert on sms_delivery_receipts to service_role');
  await assert.rejects(()=>inspection.inspect(f.db,true),/access differs/);
});

test('separate protected maintenance is inactive unless explicitly configured, paginates, is repeat-safe and never invokes sends', async t => {
  const f=await createOperationsFixture({CRON_SECRET:'fixture-internal-cron'});
  t.after(()=>f.db.close());
  const route=evaluate('app\\api\\commercial-follow-up-maintenance\\route.ts',{
    'next/server':next,'node:crypto':crypto,'@/lib/supabase':{getSupabase:()=>f.client},
    '@/lib/internal_follow_up':f.policy,'@/lib/commercial_follow_up':f.followUp,
  },{Buffer,process:{env:f.env}});
  const run=(token='fixture-internal-cron',query='')=>route.POST(new Request('https://fixture.invalid/api/commercial-follow-up-maintenance'+query,
    {method:'POST',headers:{Authorization:`Bearer ${token}`}}));
  assert.equal((await run('invalid')).status,401);
  assert.equal((await(await run()).json()).enabled,false);
  assert.equal((await f.db.query('select count(*)::int n from commercial_lead_activity')).rows[0].n,0);
  f.env.INTERNAL_FOLLOW_UP_POLICY_JSON=JSON.stringify(configuration);
  assert.equal((await run('fixture-internal-cron','?after=invalid')).status,400);
  assert.equal((await(await run()).json()).counts.updated,1);
  assert.equal((await(await run()).json()).counts.unchanged,2);
  assert.equal((await(await run('fixture-internal-cron','?after='+id(1))).json()).processed,1);
  assert.equal(f.calls.mail.length,0);
  assert.equal(f.calls.stripe.length,0);
});

test('signed Twilio callbacks: strict authenticity, identity, correlation before persistence, dedupe, out-of-order and conflicting terminals', async t => {
  const f=await createOperationsFixture(), url='https://backend.example.invalid/api/twilio/message-status';
  t.after(()=>f.db.close());
  const env={TWILIO_STATUS_CALLBACK_URL:url,TWILIO_AUTH_TOKEN:'fixture-token-only',TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),TWILIO_DISABLE_SIGNATURE_VALIDATION:'1'};
  const delivery=evaluate('lib\\sms_delivery.ts',{}, {process:{env}});
  const callback=evaluate('app\\api\\twilio\\message-status\\route.ts',{
    'next/server':next,'node:crypto':crypto,twilio,'@/lib/supabase':{getSupabase:()=>f.client},'@/lib/sms_delivery':delivery,
  },{URLSearchParams,Buffer,process:{env}});
  const original={AccountSid:env.TWILIO_ACCOUNT_SID,MessageSid:'SM'+'2'.repeat(32),MessageStatus:'sent',To:'+15550000005',From:'+15550000004'};
  async function send(fields={},options={}) {
    const params={...original,...fields},body=new URLSearchParams(params);
    if(options.duplicate)body.append('MessageSid',params.MessageSid);
    return callback.POST(new Request('https://untrusted-proxy.invalid/api/twilio/message-status',{method:'POST',
      headers:{'content-type':options.type||'application/x-www-form-urlencoded',
        'x-twilio-signature':options.invalid?'invalid':twilio.getExpectedTwilioSignature(env.TWILIO_AUTH_TOKEN,options.url||url,params)},body:body.toString()}));
  }
  assert.equal((await send({}, {invalid:true})).status,403,'Debug bypass cannot disable validation');
  assert.equal((await send({}, {url:'https://attacker.invalid/api/twilio/message-status'})).status,403);
  assert.equal((await send({}, {duplicate:true})).status,400);
  assert.equal((await send({}, {type:'application/json'})).status,415);
  for(const fields of [{AccountSid:'AC'+'3'.repeat(32)},{MessageSid:'bad'},{MessageStatus:'unknown'},{To:'bad'},{SmsSid:'SM'+'4'.repeat(32)}]) {
    assert.equal((await send(fields)).status,400);
  }
  assert.equal((await send()).status,200,'Callback can precede sms_messages/effect inserts');
  assert.equal((await send({MessageStatus:'delivered'})).status,200);
  const before=(await f.db.query('select * from sms_delivery_receipts')).rows[0];
  assert.equal((await send({MessageStatus:'queued'})).status,200);
  assert.equal((await send({MessageStatus:'delivered'})).status,200);
  let receipt=(await f.db.query('select * from sms_delivery_receipts')).rows[0];
  assert.equal(receipt.status,'delivered');
  assert.equal(receipt.received_at.getTime(),before.received_at.getTime(),'Late queued/retries do not move delivery evidence time');
  assert.equal((await f.db.query('select count(*)::int n from sms_delivery_events')).rows[0].n,3);
  assert.equal((await send({To:'+15550000006'})).status,503,'Recipient collision is not silently acknowledged');
  await f.db.query(`insert into commercial_effects(request_id,kind,state,details) values($1,'customer_confirmation','accepted',$2)`,
    [id(201),JSON.stringify({sid:original.MessageSid,to:original.To,status:'queued'})]);
  let summary=(await(await f.request('GET')).json()).communications.events.find(event=>event.purpose==='Customer confirmation');
  assert.equal(summary.statusLabel,'Delivered');
  assert.equal(summary.timeLabel,'Delivery update received');
  assert.match(summary.receipt,/Not proof of reading/);
  assert.equal((await send({MessageStatus:'undelivered',ErrorCode:'30005',ErrorMessage:'Fixture unreachable handset'})).status,200);
  receipt=(await f.db.query('select * from sms_delivery_receipts')).rows[0];
  assert.equal(receipt.status,'delivered');
  assert.equal(receipt.conflicting_terminal,true);
  summary=(await(await f.request('GET')).json()).communications.events.find(event=>event.purpose==='Customer confirmation');
  assert.equal(summary.statusLabel,'Status unavailable / needs review');
  assert.equal(summary.errorCode,'30005');
  assert.equal(summary.errorMessage,'Fixture unreachable handset');
  assert.doesNotMatch(JSON.stringify(summary),new RegExp(env.TWILIO_AUTH_TOKEN+'|'+original.MessageSid));
  const failed={MessageSid:'SM'+'5'.repeat(32),MessageStatus:'failed',ErrorCode:'30003',ErrorMessage:'Fixture failure'};
  assert.equal((await send(failed)).status,200);
  assert.equal((await send({...failed,MessageStatus:'sent',ErrorCode:'',ErrorMessage:''})).status,200);
  assert.equal((await f.db.query('select status from sms_delivery_receipts where message_sid=$1',[failed.MessageSid])).rows[0].status,'failed');
  assert.equal((await send({...failed,MessageStatus:'delivered',ErrorCode:'',ErrorMessage:''})).status,200);
  const reverse=(await f.db.query('select * from sms_delivery_receipts where message_sid=$1',[failed.MessageSid])).rows[0];
  assert.equal(reverse.conflicting_terminal,true);
  assert.equal(reverse.last_error_code,'30003','Failure evidence survives a contradictory terminal callback');
  env.TWILIO_STATUS_CALLBACK_URL='';
  assert.equal((await send()).status,503);
});

test('commercial sends add only explicit validated status callbacks; invalid configuration prevents a send', async () => {
  const f=createFixture();
  const send=()=>f.runtime.sendSmsAndPersist('+15550000005','Home2Smart fixture message');
  assert.equal((await send()).accepted,true);
  assert.equal(Object.hasOwn(f.providerAttempts[0],'statusCallback'),false);
  const callback=createFixture({TWILIO_STATUS_CALLBACK_URL:'https://backend.example.invalid/api/twilio/message-status'});
  assert.equal((await callback.runtime.sendSmsAndPersist('+15550000005','Fixture only')).accepted,true);
  assert.equal(callback.providerAttempts[0].statusCallback,'https://backend.example.invalid/api/twilio/message-status');
  const invalid=createFixture({TWILIO_STATUS_CALLBACK_URL:'http://invalid.example/api/twilio/message-status'});
  assert.equal((await invalid.runtime.sendSmsAndPersist('+15550000005','Fixture only')).accepted,undefined);
  assert.equal(invalid.providerAttempts.length,0);
});

test('native date fields preserve exact instants and reject edited DST gaps/folds without duplicate picker initialization', async t => {
  const oldZone=process.env.TZ;
  process.env.TZ='America/New_York';
  const f=await createOperationsFixture(), snapshot=await(await f.request('GET')).json();
  t.after(async()=>{if(oldZone===undefined)delete process.env.TZ;else process.env.TZ=oldZone;await f.db.close();});
  snapshot.state.next_follow_up_at='2026-11-01T06:30:42.123456Z';
  snapshot.followUp.mode='manual';
  const dom=new JSDOM('<section></section>',{url:'https://fixture.invalid/dash.html',runScripts:'outside-only',pretendToBeVisual:true});
  t.after(()=>dom.window.close());
  const w=dom.window, sent=[];
  let pickerCalls=0;
  w.h2sInitDateInputs=()=>pickerCalls++;
  w.fetch=async(url,options)=>{
    if(options.method==='POST')sent.push(JSON.parse(options.body));
    return Response.json({...snapshot,ok:true});
  };
  w.eval(fs.readFileSync(path.join(__dirname,'..','..','frontend','commercial-operations.js'),'utf8'));
  const host=w.document.querySelector('section');
  await w.H2SCommercialOperations.mount(host,id(1),{apiBase:'https://fixture.invalid',getToken:()=> 'fixture-admin'});
  const submit=async()=>{
    host.querySelector('[data-action=follow_up]').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    for(let i=0;i<20;i++)await tick();
  };
  let input=host.querySelector('[name=nextFollowUpAt]');
  assert.equal(input.type,'datetime-local');
  assert.equal(input.value,'2026-11-01T01:30');
  assert.equal(input.hasAttribute('data-native-date'),true);
  assert.match(input.closest('label').textContent,/America\/New_York/);
  await submit();
  assert.equal(sent[0].payload.nextFollowUpAt,snapshot.state.next_follow_up_at,'Unchanged ambiguous saved wall time retains offset and microseconds');
  input=host.querySelector('[name=nextFollowUpAt]');
  input.value='2026-03-08T02:30';
  await submit();
  assert.equal(sent.length,1);
  assert.match(host.querySelector('[data-operations-status]').textContent,/does not exist/);
  input.value='2026-11-01T01:45';
  await submit();
  assert.equal(sent.length,1);
  assert.match(host.querySelector('[data-operations-status]').textContent,/occurs twice/);
  input.value='2026-11-02T09:15';
  await submit();
  assert.equal(sent[1].payload.nextFollowUpAt,'2026-11-02T14:15:00.000Z');
  assert.equal(pickerCalls,0);
});
