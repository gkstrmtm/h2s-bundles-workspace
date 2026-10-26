const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createResidentialFixture}=require('./helpers/residential_fixture.cjs');
const {createFixture}=require('./helpers/commercial_contact_fixture.cjs');
const {createCalendarFixture}=require('./helpers/commercial_calendar_fixture.cjs');
const {id}=require('./helpers/commercial_operations_fixture.cjs');
const input=(extra={})=>({publicToken:crypto.randomUUID(),submissionKey:crypto.randomUUID(),fullName:'Homeowner Fixture',
  phone:'+15550000005',city:'Fixture City',serviceNeeds:['TV Mounting'],smsOptIn:true,notes:'',
  availabilityPreferences:[{date:'2099-01-01',period:'afternoon'}],...extra});
const rows=async(f,table)=>(await f.db.query(`select * from ${table}`)).rows;
const review=(f,token,action='approve')=>f.post('residential-review',{token,action});
test('homeowner inquiry uses real 031/037 PostgreSQL functions, isolated routing, and link-only non-booking acceptance',async t=>{
  const f=await createResidentialFixture();
  try {
    const body=input();
    await t.test('submission is atomic, records broad preferences, and sends only separate residential routing',async()=>{
      const responses=await Promise.all([f.post('residential-intake',body),f.post('residential-intake',body)]);
      for(const response of responses)assert.ok([200,201].includes(response.status),await response.clone().text());
      assert.equal((await rows(f,'commercial_leads')).length,1);
      assert.equal((await rows(f,'commercial_consultation_requests')).length,1);
      const [lead]=await rows(f,'commercial_leads'),[request]=await rows(f,'commercial_consultation_requests');
      assert.equal(f.sms.length,2);
      for(const [token,status] of [['fixture-admin',200],['fixture-va',403],['missing',401]]) {
        const link=await f.route('residential-review').GET(new Request(`http://fixture.invalid/api/residential-review?leadId=${lead.lead_id}`,
          {headers:{Authorization:`Bearer ${token}`}}));
        assert.equal(link.status,status);
        if(status===200)assert.match((await link.json()).reviewLink,new RegExp(encodeURIComponent(request.response_token)));
      }
      assert.equal(f.sms.filter(s=>s.to==='+15550000007').length,1);
      assert.equal(f.sms.filter(s=>s.to==='+15550000001').length,0);
      assert.ok(f.sms.some(s=>/Homeowner: Homeowner Fixture/.test(s.body) && /TV Mounting/.test(s.body)
        && /Preferences \(not booked\)/.test(s.body) && /residential-review\?token=/.test(s.body)));
      assert.ok(f.sms.every(s=>!/reply yes|reply no/i.test(s.body)));
      const responseBody=await responses[0].json();
      assert.equal(responseBody.bookingConfirmed,false);
      assert.equal(JSON.stringify(responseBody).includes('+15550000007'),false);
      assert.equal(lead.attribution.market,'residential');
      assert.deepEqual(lead.assessment_answers.availabilityPreferences,body.availabilityPreferences);
      for(const field of ['selected_slot_start','selected_slot_end','related_order_id','next_reminder_at'])assert.equal(request[field],null);
      assert.equal((await rows(f,'h2s_orders')).length,0);
      assert.equal((await rows(f,'h2s_dispatch_jobs')).length,0);
    });
    const [request]=await rows(f,'commercial_consultation_requests'),[lead]=await rows(f,'commercial_leads');
    await t.test('GET is read-only and Commercial endpoints cannot load, submit, retry or approve a homeowner inquiry',async()=>{
      const get=await f.route('residential-review').GET(new Request('http://fixture.invalid/api/residential-review?token='+request.response_token));
      assert.equal(get.status,200);
      assert.equal((await get.json()).inquiry.status,'pending');
      assert.equal(f.sms.length,2);
      assert.equal((await f.post('commercial-consultation',{publicToken:lead.public_token})).status,409);
      assert.equal((await f.route('commercial-intake').GET(new Request('http://fixture.invalid/api/commercial-intake?token='+lead.public_token))).status,404);
      assert.equal((await f.post('commercial-consultation-response',{token:request.response_token,action:'approve'})).status,404);
      assert.equal((await f.runtime.retryCommercialProcessing(new Request('http://fixture.invalid'),request.request_id)).ok,false);
    });
    await t.test('acceptance is idempotent, audited and creates no appointments, jobs or automatic reminders',async()=>{
      for(const response of await Promise.all([review(f,request.response_token),review(f,request.response_token)])){
        assert.equal(response.status,200,await response.clone().text());
        assert.equal((await response.json()).bookingConfirmed,false);
      }
      assert.equal(f.sms.length,3);
      assert.match(f.sms[2].body,/accepted your request for follow-up/);
      assert.match(f.sms[2].body,/not a confirmed installation booking/);
      assert.equal((await rows(f,'commercial_lead_activity')).length,1);
      assert.equal((await rows(f,'commercial_lead_activity'))[0].action,'residential_inquiry_approve');
      assert.equal((await rows(f,'commercial_consultation_requests'))[0].status,'approved');
      assert.equal((await rows(f,'h2s_orders')).length,0);
      assert.equal((await rows(f,'h2s_dispatch_jobs')).length,0);
      assert.equal((await review(f,request.response_token,'decline')).status,409);
      assert.equal((await f.post('residential-intake',body)).status,200);
      assert.equal(f.sms.length,3);
      assert.equal((await f.post('residential-intake',{...body,city:'Changed City'})).status,409);
      assert.equal((await rows(f,'commercial_leads'))[0].project_city,'Fixture City');
    });
    await t.test('SQL guards prevent market conversion and appointment enrollment',async()=>{
      assert.equal((await require('../lib/residential_inquiry_review.cjs').inspect(f.db,true)).inquiryDoesNotBook,true);
      await assert.rejects(f.db.query("update commercial_leads set attribution='{}' where lead_id=$1",[lead.lead_id]),/market cannot be changed/);
      await assert.rejects(f.db.query("update commercial_consultation_requests set related_order_id=gen_random_uuid() where request_id=$1",[request.request_id]),/cannot create an appointment/);
      await assert.rejects(f.db.query("update commercial_consultation_requests set next_reminder_at=now() where request_id=$1",[request.request_id]),/cannot create an appointment/);
      await assert.rejects(f.db.query("update commercial_consultation_requests set metadata='{}' where request_id=$1",[request.request_id]),/cannot create an appointment/);
      for(const role of ['anon','authenticated']){
        await f.db.exec(`set role ${role}`);
        await assert.rejects(f.db.query('select h2s_review_residential_inquiry($1,$2,$3,$4)',[request.response_token,'approve','','+15550000007']),/permission denied/);
        await f.db.exec('reset role');
      }
    });
  }finally{await f.close();}
});
test('validation, feature gate, consent, disabled routing and provider failures fail safely',async t=>{
  for(const [name,env] of [
    ['disabled intake',{RESIDENTIAL_INTAKE_ENABLED:'false'}],
    ['missing dedicated recipient',{RESIDENTIAL_REVIEWER_PHONE:''}],
    ['Call first sends no customer text',{}],
    ['SMS disabled records no outbound sends',{RESIDENTIAL_SMS_ENABLED:'false',RESIDENTIAL_REVIEWER_PHONE:''}],
    ['known provider rejection retries safely',{}],
    ['uncertain send is never automatically resent',{}],
    ['invalid inputs',{}],
  ])await t.test(name,async()=>{
    const f=await createResidentialFixture(env);
    try{
      const body=input(name==='Call first sends no customer text'?{smsOptIn:false}:{});
      if(name==='invalid inputs'){
        for(const patch of [{phone:'invalid'},{serviceNeeds:[]},{serviceNeeds:['Wiring']},{smsOptIn:'true'},
          {availabilityPreferences:[{date:'2099-02-30',period:'morning'}]},{availabilityPreferences:[{date:'2000-01-01',period:'morning'}]},
          {availabilityPreferences:[{date:'2099-01-01',period:'night'}]},{phone:'+15550000007'}]){
          assert.equal((await f.post('residential-intake',{...body,...patch})).status,400);
        }
        assert.equal((await rows(f,'commercial_leads')).length,0);return;
      }
      if(name==='known provider rejection retries safely')f.faults.smsByRecipient={'+15550000007':'rejected'};
      if(name==='uncertain send is never automatically resent')f.faults.smsByRecipient={'+15550000007':'uncertain'};
      const response=await f.post('residential-intake',body);
      if(name==='disabled intake'||name==='missing dedicated recipient'){
        assert.equal(response.status,503);assert.equal((await rows(f,'commercial_leads')).length,0);assert.equal(f.sms.length,0);return;
      }
      assert.equal(response.status,201,await response.clone().text());
      const [req]=await rows(f,'commercial_consultation_requests');
      if(name==='Call first sends no customer text'){assert.equal(f.sms.length,1);assert.equal((await review(f,req.response_token)).status,200);assert.equal(f.sms.length,1);}
      if(name==='SMS disabled records no outbound sends'){assert.equal(f.sms.length,0);assert.equal(req.assigned_technician_phone,null);}
      if(name.includes('provider rejection')||name.includes('uncertain send')){
        const before=f.providerAttempts.length;delete f.faults.smsByRecipient;
        assert.equal((await f.post('residential-intake',body)).status,200);
        assert.equal(f.providerAttempts.length,before+(name.includes('provider rejection')?1:0));
        assert.equal(f.sms.filter(value=>value.to===body.phone).length,1);
      }
    }finally{await f.close();}
  });
});
test('Queue filters markets server-side without treating homeowner acceptance as appointment failure',async()=>{
  const f=createFixture(),now=new Date().toISOString();
  const base={full_name:'Queue fixture',phone:'+15550000005',service_needs:['TV Mounting'],created_at:now,last_submitted_at:now};
  f.tables.commercial_leads.push({...base,lead_id:id(1),attribution:{market:'residential'},
    assessment_answers:{availabilityPreferences:[{date:'2099-01-01',period:'flexible'}]}},{...base,lead_id:id(2),attribution:{}});
  f.tables.commercial_consultation_requests.push({request_id:id(3),lead_id:id(1),status:'approved',metadata:{request_kind:'residential_inquiry'},created_at:now});
  const residential=await f.queue(new URLSearchParams({filter:'all',market:'residential',limit:'1'}));
  assert.equal(residential.queue.length,1);assert.equal(residential.pagination.totalMatches,1);
  assert.equal(residential.queue[0].market,'residential');
  assert.equal(residential.queue[0].followUp.recoveryAllowed,false);
  assert.match(residential.queue[0].followUp.statusLabel,/Follow-up accepted/);
  assert.doesNotMatch(residential.queue[0].followUp.nextAction,/appointment is not created/);
  assert.equal(residential.queue[0].availabilityPreferences.length,1);
  const commercial=await f.queue(new URLSearchParams({filter:'all',market:'commercial'}));
  assert.equal(commercial.queue.length,1);assert.equal(commercial.queue[0].leadId,id(2));
  await assert.rejects(f.queue(new URLSearchParams({market:'other'})),/Unknown customer market/);
});
test('both markets share calendar capacity; adjacent windows work and explicit agreement remains required',async()=>{
  const f=await createCalendarFixture();
  try{
    await f.db.query("update commercial_leads set attribution='{\"market\":\"residential\"}' where lead_id=$1",[id(2)]);
    const payload={start:'2099-01-01T15:00:00Z',end:'2099-01-01T16:00:00Z',timezone:'UTC',reason:'Agreed by customer',customerAgreed:true};
    const booking=(lead,operation,payload)=>f.calendarRequest('POST',{leadId:id(lead),revision:0,operationId:id(operation),action:'confirm',payload});
    assert.equal((await booking(1,3701,payload)).status,200);
    assert.equal((await booking(2,3702,payload)).status,409);
    assert.equal((await booking(2,3703,{...payload,customerAgreed:false,start:'2099-01-01T16:00:00Z',end:'2099-01-01T17:00:00Z'})).status,400);
    assert.equal((await booking(2,3704,{...payload,start:'2099-01-01T16:00:00Z',end:'2099-01-01T17:00:00Z'})).status,200);
    const calendar=(await(await f.calendarRequest('GET')).json()).calendar;
    assert.deepEqual(calendar.entries.map(value=>value.market),['commercial','residential']);
    assert.equal(f.calls.mail.length,0);assert.equal(f.calls.stripe.length,0);
  }finally{await f.db.close();}
});
test('037 inspection detects missing guards and the enabled API refuses a missing schema marker',async()=>{
  const f=await createResidentialFixture();
  try{
    await f.db.exec('reset role;drop function public.h2s_residential_intake_ready()');
    assert.equal((await f.post('residential-intake',input())).status,503);
    assert.equal((await rows(f,'commercial_leads')).length,0);
    await assert.rejects(require('../lib/residential_inquiry_review.cjs').inspect(f.db,true),/objects are incomplete/);
    assert.equal(f.sms.length,0);
  }finally{await f.close();}
});
