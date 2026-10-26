const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createResidentialFixture}=require('./helpers/residential_fixture.cjs');
const review=require('../lib/notification_routing_review.cjs');
const uuid=()=>crypto.randomUUID();
async function fixture(t,env={}){
  const f=await createResidentialFixture({RESIDENTIAL_WORKSPACE_ENABLED:'true',...env},{workspace:true,routing:true});
  t.after(()=>f.close());
  return f;
}
function request(f,body=null,token='fixture-admin'){
  return f.route('notification-routing')[body?'POST':'GET'](new Request('http://fixture.invalid/api/notification-routing',{
    method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{})}));
}
const save=(f,phone='(555) 000-0008',revision=0,extra={})=>request(f,{phone,revision,acknowledgeRecipientChange:true,...extra});
const read=async f=>(await(await request(f)).json()).routing;
const input=()=>({publicToken:uuid(),submissionKey:uuid(),fullName:'Routing Fixture',phone:'+15550000005',
  city:'Fixture City',serviceNeeds:['TV Mounting'],smsOptIn:true});
async function inquiry(f){
  const response=await f.post('residential-intake',input());
  assert.equal(response.status,201,await response.clone().text());
  return (await f.db.query('select * from commercial_consultation_requests order by created_at desc limit 1')).rows[0];
}
function callback(f,token,dueAt){
  return f.route('residential-workspace').POST(new Request('http://fixture.invalid/api/residential-workspace',{
    method:'POST',headers:{Authorization:'Bearer fixture-admin','Content-Type':'application/json'},
    body:JSON.stringify({token,revision:0,operationId:uuid(),action:'schedule_callback',dueAt,note:'Agreed callback'})}));
}
test('initial routing preserves the environment recipient and displays distinct unchanged commercial routes',async t=>{
  const f=await fixture(t),routing=await read(f);
  assert.equal(routing.owner.phone,'+15550000007');assert.equal(routing.owner.source,'environment');assert.equal(routing.owner.revision,0);
  assert.deepEqual(routing.commercialTechnicians,['+15550000001']);
  assert.deepEqual(routing.managementEscalation,['+15550000002']);
  assert.equal((await f.db.query('select count(*)::int n from notification_routing')).rows[0].n,0,'Reading does not seed or change routing');
  assert.equal((await review.inspect(f.db,true)).atomicAudit,true);
  assert.equal(f.providerAttempts.length,0);
});
test('ADMIN save normalizes, persists across reads and records server-derived identity and old/new values without sending',async t=>{
  const f=await fixture(t);
  const response=await save(f,undefined,0,{actor:{id:'spoofed',name:'Spoofed',role:'ADMIN'}});
  assert.equal(response.status,200,await response.clone().text());
  const result=await response.json();assert.equal(result.verified,false);
  assert.equal(result.owner.phone,'+15550000008');
  assert.equal((await read(f)).owner.phone,'+15550000008');assert.equal((await read(f)).owner.revision,1);
  const audit=(await f.db.query('select * from notification_routing_activity')).rows;
  assert.equal(audit.length,1);assert.equal(audit[0].previous_phone,'+15550000007');assert.equal(audit[0].phone,'+15550000008');
  assert.equal(audit[0].previous_source,'environment');assert.equal(audit[0].actor.id,'fixture-admin');assert.equal(audit[0].actor.name,'Fixture Admin');
  assert.ok(Number.isFinite(Date.parse(audit[0].changed_at)));
  assert.equal(f.providerAttempts.length,0);assert.equal(f.sms.length,0);
});
test('read/write require ADMIN and explicit recipient-bound handling acknowledgment; tables are not browser-writable',async t=>{
  const f=await fixture(t);
  for(const [auth,status] of [['missing',401],['fixture-va',403]]){
    assert.equal((await request(f,null,auth)).status,status);
    assert.equal((await request(f,{phone:'+15550000008',revision:0,acknowledgeRecipientChange:true},auth)).status,status);
  }
  assert.equal((await save(f,undefined,0,{acknowledgeRecipientChange:false})).status,400);
  for(const role of ['anon','authenticated']){
    await f.db.exec('reset role;set role '+role);
    await assert.rejects(f.db.query('select * from notification_routing'),/permission denied/);
    await assert.rejects(f.db.query("select h2s_save_notification_routing('+15550000008',0,'{}',null)"),/permission denied/);
  }
  await f.db.exec('reset role;set role service_role');
  await assert.rejects(f.db.query("update notification_routing set phone='+15550000008'"),/permission denied/);
  await assert.rejects(f.db.query('delete from notification_routing_activity'),/permission denied/);
  await assert.rejects(f.db.query("select h2s_save_notification_routing('+15550000008',0,'{\"role\":\"VA\",\"id\":\"fixture-va\",\"name\":\"Fixture\"}',null)"),/administrator/);
  assert.equal((await f.db.query('select count(*)::int n from notification_routing_activity')).rows[0].n,0);
});
test('invalid/ambiguous phone numbers and revisions cannot change routing',async t=>{
  const f=await fixture(t);
  for(const phone of ['',null,12,'123','555-CALL-NOW','++15550000008','+05550000008','5550000008 ext 4','442079460123','1'.repeat(41)]){
    const response=await save(f,phone);assert.equal(response.status,400,String(phone));
  }
  for(const revision of [-1,1.5,'0',null])assert.equal((await save(f,undefined,revision)).status,400);
  assert.equal((await read(f)).owner.phone,'+15550000007');
  assert.equal((await save(f,'+44 20 7946 0123')).status,200);
  assert.equal((await read(f)).owner.phone,'+442079460123');
  assert.equal(f.providerAttempts.length,0);
});
test('concurrent first saves and stale edits cannot overwrite routing; reloading permits an explicit new revision',async t=>{
  const f=await fixture(t);
  const responses=await Promise.all([save(f,'5550000008'),save(f,'5550000009')]);
  assert.deepEqual(responses.map(row=>row.status).sort(),[200,409]);
  const latest=(await read(f)).owner;
  assert.equal(latest.revision,1);
  assert.equal((await save(f,'5550000010',0)).status,409);
  assert.equal((await save(f,'5550000010',latest.revision)).status,200);
  const audit=(await f.db.query('select * from notification_routing_activity order by revision')).rows;
  assert.equal(audit.length,2);assert.equal(audit[1].previous_phone,latest.phone);assert.equal(audit[1].previous_source,'saved');
  assert.equal((await read(f)).owner.phone,'+15550000010');
});
test('missing default fails sending until configured, and a saved setting takes precedence over an invalid environment default',async t=>{
  const f=await fixture(t,{RESIDENTIAL_REVIEWER_PHONE:''});
  assert.equal((await read(f)).owner.phone,null);
  assert.equal((await f.post('residential-intake',input())).status,503);
  assert.equal((await save(f)).status,200);
  await inquiry(f);assert.equal(f.sms[0].to,'+15550000008');
  const other=await fixture(t,{RESIDENTIAL_REVIEWER_PHONE:'invalid default'});
  assert.equal((await request(other)).status,503);
  await other.db.query("select h2s_save_notification_routing('+15550000009',0,$1,null)",[JSON.stringify({id:'fixture-admin',name:'Fixture Admin',role:'ADMIN'})]);
  assert.equal((await read(other)).owner.phone,'+15550000009');
  await inquiry(other);assert.equal(other.sms[0].to,'+15550000009');
});
test('routing storage failure never silently falls back to the former environment recipient',async t=>{
  const f=await fixture(t);
  assert.equal((await save(f)).status,200);
  await f.db.exec('reset role;alter table notification_routing rename to unavailable_routing_fixture;set role service_role');
  assert.equal((await request(f)).status,503);
  assert.equal((await f.post('residential-intake',input())).status,503);
  assert.equal(f.providerAttempts.length,0);
  assert.equal((await f.db.query('select count(*)::int n from commercial_leads')).rows[0].n,0);
});
test('saved owner receives new inquiries and scheduled callbacks without changing sender, customer or commercial recipients',async t=>{
  const f=await fixture(t);assert.equal((await save(f)).status,200);
  const row=await inquiry(f);
  assert.equal(row.assigned_technician_phone,'+15550000008');
  assert.equal(f.sms[0].to,'+15550000008');assert.equal(f.sms[0].from,'+15550000004');
  assert.equal(f.sms[1].to,'+15550000005');
  assert.equal((await f.post('residential-review',{token:row.response_token,action:'approve'})).status,200);
  const dueAt=new Date(Date.now()+2*3600000).toISOString();
  assert.equal((await callback(f,row.response_token,dueAt)).status,200);
  const result=await f.workspace.processResidentialNotices({now:new Date(Date.parse(dueAt)-15*60000)});
  assert.ok(result.processed.some(notice=>notice.action==='provider_accepted'));
  assert.equal(f.sms.at(-1).to,'+15550000008');assert.ok(f.sms.at(-1).body.includes(row.response_token));
  const routing=await read(f);assert.deepEqual(routing.commercialTechnicians,['+15550000001']);assert.deepEqual(routing.managementEscalation,['+15550000002']);
  assert.equal((await f.db.query('select count(*)::int n from h2s_orders')).rows[0].n,0);
  assert.equal((await f.db.query('select count(*)::int n from h2s_dispatch_jobs')).rows[0].n,0);
});
test('old links keep their customer, but owner-bound acceptance/reminders are held for explicit review rather than redirected',async t=>{
  const f=await fixture(t),row=await inquiry(f),dueAt=new Date(Date.now()+2*3600000).toISOString();
  assert.equal((await f.post('residential-review',{token:row.response_token,action:'approve'})).status,200);
  assert.equal((await callback(f,row.response_token,dueAt)).status,200);
  const pending=await inquiry(f);
  const before=f.sms.length;assert.equal((await save(f)).status,200);
  const opened=await f.route('residential-review').GET(new Request('http://fixture.invalid/api/residential-review?token='+pending.response_token));
  assert.equal(opened.status,200);assert.equal((await opened.json()).inquiry.name,'Routing Fixture');
  assert.equal((await f.post('residential-review',{token:pending.response_token,action:'approve'})).status,503);
  const result=await f.workspace.processResidentialNotices({now:new Date(Date.parse(dueAt)-15*60000)});
  assert.ok(result.processed.some(notice=>notice.action==='routing_review_required'));
  assert.equal(f.sms.length,before);
  const stored=(await f.db.query('select * from commercial_consultation_requests where request_id=$1',[row.request_id])).rows[0];
  assert.equal(stored.assigned_technician_phone,'+15550000007');assert.equal(stored.status,'approved');
  assert.equal((await f.db.query('select status from commercial_consultation_requests where request_id=$1',[pending.request_id])).rows[0].status,'pending');
  assert.equal((await f.db.query('select count(*)::int n from commercial_reservations')).rows[0].n,0);
});
test('migration inspection rejects column-level browser access and weaker constraints without accepting name-only matches',async t=>{
  const f=await fixture(t);
  await f.db.exec('reset role;grant select(phone) on notification_routing to anon;set role service_role');
  await assert.rejects(review.inspect(f.db,true),/grants changed/);
  await f.db.exec("reset role;revoke select(phone) on notification_routing from anon;alter table notification_routing drop constraint notification_routing_phone_check;alter table notification_routing add constraint notification_routing_phone_check check(phone<>'');set role service_role");
  await assert.rejects(review.inspect(f.db,true),/constraints changed/);
});
test('saved routing reaches installation owner reminders while customer confirmations/reminders retain their own recipient',async t=>{
  const f=await fixture(t);assert.equal((await save(f)).status,200);
  const row=await inquiry(f);
  assert.equal((await f.post('residential-review',{token:row.response_token,action:'approve'})).status,200);
  const start=new Date(Date.now()+24*3600000).toISOString(),end=new Date(Date.parse(start)+3600000).toISOString();
  const response=await f.route('commercial-calendar').POST(new Request('http://fixture.invalid/api/commercial-calendar',{
    method:'POST',headers:{Authorization:'Bearer fixture-admin','Content-Type':'application/json'},
    body:JSON.stringify({leadId:row.lead_id,revision:0,operationId:uuid(),action:'confirm',
      payload:{start,end,timezone:'America/New_York',customerAgreed:true,reason:'Fixture customer agreed to this window'}})}));
  assert.equal(response.status,200,await response.clone().text());
  assert.equal(f.sms.at(-1).to,'+15550000005');assert.match(f.sms.at(-1).body,/agreed.*installation window/);
  const before=f.sms.length;
  await f.workspace.processResidentialNotices({now:new Date(Date.parse(start)-60*60000)});
  const sent=f.sms.slice(before);
  assert.equal(sent.length,2);
  assert.ok(sent.some(message=>message.to==='+15550000008'&&message.body.includes(row.response_token)));
  assert.ok(sent.some(message=>message.to==='+15550000005'&&!message.body.includes(row.response_token)));
  assert.ok(sent.every(message=>message.from==='+15550000004'));
});
