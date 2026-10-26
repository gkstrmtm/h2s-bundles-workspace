const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createResidentialFixture}=require('./helpers/residential_fixture.cjs');
const sqlReview=require('../lib/residential_workspace_review.cjs');
const uuid=()=>crypto.randomUUID(),at=offset=>new Date(Date.now()+offset).toISOString(),minute=60000;
async function fixture(env={},input={}){
  const f=await createResidentialFixture({RESIDENTIAL_WORKSPACE_ENABLED:'true',CRON_SECRET:'fixture-cron',...env},{workspace:true});
  const response=await f.post('residential-intake',{publicToken:uuid(),submissionKey:uuid(),fullName:'Jordan Fixture',
    phone:'+15550000005',city:'Fixture City',serviceNeeds:['TV Mounting'],smsOptIn:true,...input});
  assert.equal(response.status,201,await response.clone().text());
  const request=(await f.db.query('select * from commercial_consultation_requests')).rows[0];
  f.inquiry=request;f.leadId=request.lead_id;
  const accepted=await f.post('residential-review',{token:request.response_token,action:'approve'});
  assert.equal(accepted.status,200,await accepted.clone().text());
  f.baseline=f.sms.length;
  return f;
}
function workspace(f,body=null,auth='fixture-admin'){
  return f.route('residential-workspace')[body?'POST':'GET'](new Request('http://fixture.invalid/api/residential-workspace?token='+f.inquiry.response_token,{
    method:body?'POST':'GET',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify({token:f.inquiry.response_token,...body})}:{})}));
}
const callback=(f,revision,action='schedule_callback',extra={})=>workspace(f,{revision,operationId:uuid(),action,note:'Agreed phone follow-up',
  ...(action==='schedule_callback'?{dueAt:at(120*minute)}:{}),...extra});
const payload=(extra={})=>({start:at(24*60*minute),end:at(25*60*minute),timezone:'America/New_York',customerAgreed:true,
  expiresAt:at(2*60*minute),reason:'Customer agreed to this installation window',...extra});
function book(f,revision,action='confirm',extra={},operationId=uuid()){
  return f.route('commercial-calendar').POST(new Request('http://fixture.invalid/api/commercial-calendar',{
    method:'POST',headers:{Authorization:'Bearer fixture-admin','Content-Type':'application/json'},
    body:JSON.stringify({leadId:f.leadId,revision,operationId,action,payload:payload(extra)})}));
}
const rows=async(f,table)=>(await f.db.query('select * from '+table)).rows;
async function elevated(f,query,args=[]){await f.db.exec('reset role');try{return await f.db.query(query,args);}finally{await f.db.exec('set role service_role');}}
test('038 schema, ADMIN workspace boundaries and callback persistence use real PostgreSQL and existing activity',async()=>{
  const f=await fixture();
  try{
    assert.equal((await sqlReview.inspect(f.db,true)).serviceOnlyClaims,true);
    for(const [auth,status] of [['missing',401],['fixture-va',403]])assert.equal((await workspace(f,null,auth)).status,status);
    for(const role of ['anon','authenticated']){
      await f.db.exec('reset role;set role '+role);
      await assert.rejects(f.db.query('select * from residential_notices'),/permission denied/);
      await assert.rejects(f.db.query("select h2s_residential_workspace_ready()"),/permission denied/);
    }
    await f.db.exec('reset role;set role service_role');
    await assert.rejects(f.db.query("update residential_notices set state='accepted'"),/permission denied/);
    const key=uuid(),dueAt=at(120*minute);
    const first=await callback(f,0,'schedule_callback',{operationId:key,dueAt});
    assert.equal(first.status,200,await first.clone().text());
    const saved=(await first.json()).workspace;
    assert.equal(saved.callback.status,'scheduled');assert.equal(saved.callback.revision,1);
    assert.equal(Date.parse(saved.callback.dueAt),Date.parse(dueAt));
    assert.equal(f.sms.length,f.baseline,'Scheduling a callback is not a reminder send');
    assert.equal((await callback(f,0,'schedule_callback',{operationId:key,dueAt})).status,200);
    assert.equal((await callback(f,0,'schedule_callback',{dueAt})).status,409);
    assert.equal((await callback(f,0,'schedule_callback',{operationId:key,dueAt:at(121*minute)})).status,400);
    const reopened=(await (await workspace(f)).json()).workspace;
    assert.equal(reopened.callback.revision,1);
    assert.equal((await rows(f,'commercial_lead_activity')).filter(row=>row.action==='residential_callback').length,1);
    assert.equal((await callback(f,1,'complete_callback')).status,200);
    assert.equal((await (await workspace(f)).json()).workspace.callback.status,'completed');
    assert.equal((await rows(f,'residential_notices'))[0].state,'superseded');
    assert.equal((await rows(f,'h2s_orders')).length,0);assert.equal((await rows(f,'h2s_dispatch_jobs')).length,0);
  }finally{await f.close();}
});
test('owner callback reminder is due 15 minutes before, contains context and the same link, and is sent only once',async()=>{
  const f=await fixture();
  try{
    const dueAt=at(120*minute);
    assert.equal((await callback(f,0,'schedule_callback',{dueAt})).status,200);
    assert.equal((await f.workspace.processResidentialNotices({now:new Date(Date.parse(dueAt)-16*minute)})).processed.length,0);
    const notices=await Promise.all([f.workspace.processResidentialNotices({now:new Date(Date.parse(dueAt)-15*minute)}),
      f.workspace.processResidentialNotices({now:new Date(Date.parse(dueAt)-15*minute)})]);
    assert.ok(notices.some(result=>result.processed.some(n=>n.action==='provider_accepted')));
    assert.equal(f.sms.length,f.baseline+1);
    const message=f.sms.at(-1);assert.equal(message.to,'+15550000007');
    for(const text of ['Jordan Fixture','TV Mounting','Fixture City',f.inquiry.response_token])assert.ok(message.body.includes(text));
    assert.match(message.body,/Callback/);
    await f.workspace.processResidentialNotices({now:new Date(Date.parse(dueAt)-14*minute)});
    assert.equal(f.sms.length,f.baseline+1);
    assert.equal((await rows(f,'residential_notices'))[0].state,'accepted');
  }finally{await f.close();}
});
test('confirmation, 60-minute owner/customer reminders and booking replay reuse the same calendar without duplicates',async()=>{
  const f=await fixture();
  try{
    const window=payload(),key=uuid();
    const response=await book(f,0,'confirm',window,key);
    assert.equal(response.status,200,await response.clone().text());
    assert.equal((await response.json()).notifications.needsReview,false);
    assert.equal(f.sms.length,f.baseline+1);assert.equal(f.sms.at(-1).to,'+15550000005');
    assert.match(f.sms.at(-1).body,/agreed.*installation window/);
    assert.ok(!f.sms.at(-1).body.includes(f.inquiry.response_token),'Owner credential must never be sent to customer');
    assert.equal((await book(f,0,'confirm',window,key)).status,200);
    assert.equal(f.sms.length,f.baseline+1);
    await f.workspace.processResidentialNotices({now:new Date(Date.parse(window.start)-61*minute)});
    assert.equal(f.sms.length,f.baseline+1);
    await f.workspace.processResidentialNotices({now:new Date(Date.parse(window.start)-60*minute)});
    assert.equal(f.sms.length,f.baseline+3);
    assert.equal(f.sms.slice(f.baseline+1).filter(row=>row.to==='+15550000007').length,1);
    await f.workspace.processResidentialNotices({now:new Date(Date.parse(window.start)-59*minute)});
    assert.equal(f.sms.length,f.baseline+3);
    const effects=await rows(f,'residential_notices');assert.equal(effects.filter(n=>n.state==='accepted').length,3);
    assert.ok(effects.every(n=>n.details.segments>=1));
    assert.equal((await rows(f,'h2s_orders')).length,0);
  }finally{await f.close();}
});
test('rescheduling supersedes old notices; cancelling a confirmed install sends only its cancellation and stops reminders',async()=>{
  const f=await fixture();
  try{
    const first=payload();
    assert.equal((await book(f,0,'confirm',first)).status,200);
    const next=payload({start:at(48*60*minute),end:at(49*60*minute)});
    assert.equal((await book(f,1,'reschedule',next)).status,200);
    assert.equal(f.sms.length,f.baseline+2);
    await f.workspace.processResidentialNotices({now:new Date(Date.parse(first.start)-60*minute)});
    assert.equal(f.sms.length,f.baseline+2,'Old installation reminder must not be sent');
    assert.equal((await book(f,2,'cancel')).status,200);
    assert.equal(f.sms.length,f.baseline+3);assert.match(f.sms.at(-1).body,/cancelled.*No replacement time/);
    await f.workspace.processResidentialNotices({now:new Date(Date.parse(next.start)-60*minute)});
    assert.equal(f.sms.length,f.baseline+3);
    assert.equal((await rows(f,'commercial_reservations'))[0].state,'cancelled');
  }finally{await f.close();}
});
test('holds do not send booking messages; unchanged confirmed windows do not enroll a second reminder sequence',async()=>{
  const f=await fixture();
  try{
    const window=payload();
    assert.equal((await book(f,0,'hold',window)).status,200);assert.equal(f.sms.length,f.baseline);
    assert.equal((await book(f,1,'confirm',window)).status,200);assert.equal(f.sms.length,f.baseline+1);
    assert.equal((await book(f,2,'confirm',{...window,reason:'Updated internal agreement note'})).status,200);
    assert.equal(f.sms.length,f.baseline+1);
    const notices=await rows(f,'residential_notices');assert.equal(notices.length,3);assert.ok(notices.every(n=>n.version===3));
    await f.workspace.processResidentialNotices({now:new Date(Date.parse(window.start)-60*minute)});
    assert.equal(f.sms.length,f.baseline+3);
  }finally{await f.close();}
});
test('current consent and reviewer routing are checked at send time, not copied from submission',async()=>{
  const f=await fixture({}, {smsOptIn:false});
  try{
    const window=payload();assert.equal((await book(f,0,'confirm',window)).status,200);
    assert.equal(f.sms.length,f.baseline);
    await f.workspace.processResidentialNotices({now:new Date(Date.parse(window.start)-60*minute)});
    assert.equal(f.sms.length,f.baseline+1);assert.equal(f.sms.at(-1).to,'+15550000007');
    assert.equal((await rows(f,'residential_notices')).filter(n=>n.state==='skipped').length,2);
    const dueAt=at(120*minute);await callback(f,0,'schedule_callback',{dueAt});
    await f.db.query("update commercial_consultation_requests set assigned_technician_phone='+15550000008' where request_id=$1",[f.inquiry.request_id]);
    const result=await f.workspace.processResidentialNotices({now:new Date(Date.parse(dueAt)-15*minute)});
    assert.equal(result.needsReview,true);assert.equal(f.sms.length,f.baseline+1);
  }finally{await f.close();}
});
test('failed or uncertain sends require review without automatic retries; a lost finish is reconciled without resend',async()=>{
  const f=await fixture();
  try{
    const dueAt=at(120*minute);await callback(f,0,'schedule_callback',{dueAt});
    f.faults.sms='uncertain';
    const now=new Date(Date.parse(dueAt)-15*minute),before=f.providerAttempts.length;
    assert.equal((await f.workspace.processResidentialNotices({now})).needsReview,true);
    assert.equal(f.providerAttempts.length,before+1);
    await f.workspace.processResidentialNotices({now});assert.equal(f.providerAttempts.length,before+1);
    assert.equal((await rows(f,'residential_notices'))[0].state,'review_required');
    delete f.faults.sms;
    const next=at(180*minute);await callback(f,1,'schedule_callback',{dueAt:next});
    const notice=(await rows(f,'residential_notices')).find(n=>n.state==='pending');
    const claimed=await f.database.rpc('h2s_claim_residential_notice',{p_notice_id:notice.notice_id,p_now:new Date(Date.parse(next)-15*minute).toISOString(),p_owner_phone:'+15550000007'});
    assert.equal(claimed.error,null);assert.equal(claimed.data.action,'send');
    await elevated(f,"update commercial_effects set updated_at=clock_timestamp()-interval '6 minutes' where kind=$1",['residential_notice:'+notice.notice_id]);
    assert.equal((await f.workspace.processResidentialNotices({now:new Date(Date.parse(next)-14*minute)})).needsReview,true);
    assert.equal(f.providerAttempts.length,before+1);
    assert.equal((await rows(f,'residential_notices')).find(n=>n.notice_id===notice.notice_id).state,'review_required');
  }finally{await f.close();}
});
test('maintenance authentication, disabled flags, expiry, and SQL capacity checks fail closed',async()=>{
  const f=await fixture();
  try{
    const maintenance=auth=>f.route('residential-maintenance').GET(new Request('http://fixture.invalid/api/residential-maintenance',{headers:{Authorization:'Bearer '+auth}}));
    assert.equal((await maintenance('wrong')).status,401);assert.equal((await maintenance('fixture-cron')).status,200);
    const dueAt=at(120*minute);await callback(f,0,'schedule_callback',{dueAt});
    await f.workspace.processResidentialNotices({now:new Date(Date.parse(dueAt)+minute)});
    assert.equal((await rows(f,'residential_notices'))[0].state,'expired');assert.equal(f.sms.length,f.baseline);
    assert.equal((await callback(f,1,'schedule_callback',{dueAt:at(-minute)})).status,400);
    await f.db.query("update commercial_consultation_requests set status='declined' where request_id=$1",[f.inquiry.request_id]);
    assert.equal((await book(f,0)).status,400);
    assert.equal((await rows(f,'commercial_reservations')).length,0);
  }finally{await f.close();}
  const disabled=await fixture({RESIDENTIAL_WORKSPACE_ENABLED:'false'});
  try{assert.equal((await workspace(disabled)).status,503);assert.equal((await disabled.workspace.processResidentialNotices()).enabled,false);}finally{await disabled.close();}
});
test('SMS segment estimation counts GSM extension escapes and Unicode without changing customer names',()=>{
  const {createFixture}=require('./helpers/commercial_contact_fixture.cjs');
  const f=createFixture();
  assert.equal(f.workspace.smsSegments('a'.repeat(160)).segments,1);
  assert.equal(f.workspace.smsSegments('a'.repeat(161)).segments,2);
  assert.equal(f.workspace.smsSegments('^'.repeat(81)).segments,2);
  assert.equal(f.workspace.smsSegments('😀'.repeat(36)).segments,2);
  assert.equal(f.workspace.smsSegments('山'.repeat(70)).encoding,'UCS-2');
});

test('callback changes from existing operations supersede old versions, preserve unrelated edits, and stop on closure',async()=>{
  const f=await fixture();
  try{
    const first=at(120*minute),next=at(240*minute);
    assert.equal((await callback(f,0,'schedule_callback',{dueAt:first})).status,200);
    await elevated(f,'update commercial_lead_operations set next_follow_up_at=$1 where lead_id=$2',[next,f.leadId]);
    let current=(await (await workspace(f)).json()).workspace.callback;
    assert.equal(current.revision,2);assert.equal(Date.parse(current.dueAt),Date.parse(next));
    await elevated(f,"update commercial_lead_operations set disposition_reason='Unrelated note edit' where lead_id=$1",[f.leadId]);
    assert.equal((await (await workspace(f)).json()).workspace.callback.revision,2);
    assert.equal((await callback(f,1,'cancel_callback')).status,409);
    await f.workspace.processResidentialNotices({now:new Date(Date.parse(first)-15*minute)});
    assert.equal(f.sms.length,f.baseline);
    await elevated(f,"update commercial_lead_operations set disposition='closed' where lead_id=$1",[f.leadId]);
    current=(await (await workspace(f)).json()).workspace.callback;
    assert.equal(current.status,'cancelled');assert.equal(current.dueAt,null);assert.equal(current.revision,3);
    await f.workspace.processResidentialNotices({now:new Date(Date.parse(next)-15*minute)});
    assert.equal(f.sms.length,f.baseline);
    assert.ok((await rows(f,'residential_notices')).every(n=>n.state==='superseded'));
  }finally{await f.close();}
});

test('revoked consent stops pending customer reminders while owner reminders still run; completion supersedes the window',async()=>{
  const f=await fixture();
  try{
    const window=payload();assert.equal((await book(f,0,'confirm',window)).status,200);
    await f.db.query("update commercial_leads set attribution=jsonb_set(attribution,'{communicationConsent,smsOptIn}','false'::jsonb) where lead_id=$1",[f.leadId]);
    await f.workspace.processResidentialNotices({now:new Date(Date.parse(window.start)-60*minute)});
    assert.equal(f.sms.length,f.baseline+2);assert.equal(f.sms.at(-1).to,'+15550000007');
    const notices=await rows(f,'residential_notices');
    assert.equal(notices.find(n=>n.kind==='customer_installation').state,'skipped');
    const next=payload({start:at(48*60*minute),end:at(49*60*minute)});
    assert.equal((await book(f,1,'reschedule',next)).status,200);
    await elevated(f,"update commercial_reservations set state='completed',revision=revision+1 where lead_id=$1",[f.leadId]);
    await f.workspace.processResidentialNotices({now:new Date(Date.parse(next.start)-60*minute)});
    assert.equal(f.sms.length,f.baseline+2);
    assert.ok((await rows(f,'residential_notices')).filter(n=>n.version===2&&n.kind!=='customer_confirmation').every(n=>n.state==='superseded'));
  }finally{await f.close();}
});
