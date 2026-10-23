const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const {createBusinessFixture,id} = require('./helpers/commercial_business_fixture.cjs');
const leadId=id(1), op=()=>crypto.randomUUID();
async function post(f,body) {return f.businessRequest('commercial-business','POST',{leadId,operationId:op(),...body});}
async function snapshot(f) {const r=await f.businessRequest('commercial-business');assert.equal(r.status,200);return r.json();}

test('phone-only business records work without email setup and refuse a paused send',async t=>{
  const f=await createBusinessFixture();
  t.after(()=>f.db.close());
  f.env.COMMERCIAL_EMAIL_ENABLED='false';
  delete f.env.COMMERCIAL_EMAIL_REPLY_TO;
  delete f.env.SENDGRID_API_KEY;
  const data=await snapshot(f);
  assert.equal(data.emailConfiguration.enabled,false);
  assert.equal(data.emailConfiguration.configured,false);
  assert.equal((await post(f,{action:'email',subject:'Home2Smart fixture',body:'Must not send.'})).status,503);
  assert.equal(f.attempts.length,0);
  assert.equal((await f.db.query('select count(*) n from commercial_emails')).rows[0].n,0);
});

test('deferred Commercial email uses real transport contract, atomic claims and signed correlated evidence when explicitly enabled in fixtures',async t=>{
  const f=await createBusinessFixture();
  t.after(()=>f.db.close());
  await t.test('admin access and bounded/invalid input',async()=>{
    assert.equal((await f.businessRequest('commercial-business','GET',null,'missing')).status,401);
    assert.equal((await f.businessRequest('commercial-business','GET',null,'fixture-staff')).status,403);
    assert.equal((await post(f,{action:'email',subject:'Missing body'})).status,400);
    const large=await f.businessRequest('commercial-business','POST','x'.repeat(33000));
    assert.equal(large.status,413);assert.equal(f.attempts.length,0);
  });
  await t.test('disabled/missing reply mailbox cannot pretend to send',async()=>{
    delete f.env.COMMERCIAL_EMAIL_REPLY_TO;
    const r=await post(f,{action:'email',subject:'Home2Smart fixture',body:'Staff follow-up fixture.'});
    assert.equal(r.status,503);assert.equal(f.attempts.length,0);
    f.env.COMMERCIAL_EMAIL_REPLY_TO='staff@example.invalid';
  });
  await t.test('one automatic Email-first receipt per persisted manual request, no call/text receipt',async()=>{
    await f.db.query(`update commercial_consultation_requests set metadata=$1 where request_id=$2`,
      [JSON.stringify({request_kind:'manual_follow_up',contact_preference:'email'}),id(201)]);
    const input={request_id:id(201),reference_code:'COM-FIXTURE'};
    const lead={lead_id:leadId,contact_preference:'email',email:'fixture@example.invalid'};
    const [a,b]=await Promise.all([f.email.sendInitialCommercialEmail(input,lead),f.email.sendInitialCommercialEmail(input,lead)]);
    assert.ok([a,b].some(x=>x.state==='accepted'));
    assert.equal(f.attempts.length,1);
    await f.email.sendInitialCommercialEmail(input,lead);
    assert.equal(f.attempts.length,1);
    assert.equal((await f.email.sendInitialCommercialEmail(input,{...lead,contact_preference:'call'})).state,'not_applicable');
    assert.equal((await f.email.sendInitialCommercialEmail(input,{...lead,contact_preference:'sms'})).state,'not_applicable');
    const sent=f.attempts[0];
    assert.equal(sent.from.name,'Home2Smart');assert.equal(sent.reply_to.email,'staff@example.invalid');
    assert.match(sent.content[0].value,/follow up by email/);assert.match(sent.content[0].value,/not a confirmed appointment/);
    assert.equal(sent.tracking_settings.open_tracking.enable,false);
    assert.equal((await f.db.query('select count(*) n from commercial_emails')).rows[0].n,1);
  });
  let emailId;
  await t.test('staff sends an actual email to saved recipient; same key and concurrent repeats cannot duplicate',async()=>{
    const operationId=op(),body={action:'email',operationId,subject:'Home2Smart - fixture quote',body:'A genuine staff-composed email.'};
    const [first,second]=await Promise.all([post(f,body),post(f,body)]);
    assert.ok([first.status,second.status].includes(202));
    assert.equal(f.attempts.length,2);
    const replay=await post(f,body);assert.equal(replay.status,202);
    assert.equal(f.attempts.length,2);
    emailId=(await replay.json()).email.id;
    assert.equal((await post(f,{...body,body:'Changed content with a reused key.'})).status,400);
    const data=await snapshot(f);assert.equal(data.lead.contactPreference,'email');
    assert.equal(data.emails.find(e=>e.id===emailId).state,'accepted');
    const activity=(await f.db.query(`select payload from commercial_lead_activity where operation_id=$1`,[emailId])).rows;
    assert.equal(activity.length,1);assert.equal(activity[0].payload.contact.outcome,'email_submitted');
    assert.equal((await f.db.query('select next_follow_up_at from commercial_lead_operations where lead_id=$1',[leadId])).rows[0].next_follow_up_at,null);
  });
  let sequence=0;
  function signed(events,options={}) {
    const payload=JSON.stringify(events),timestamp=String(Math.floor(Date.now()/1000));
    const pair=options.pair||keys;
    const signature=crypto.sign('sha256',Buffer.from(timestamp+payload),pair.privateKey).toString('base64');
    return f.businessRequest('commercial-email-events','POST',payload,'missing',{
      'x-twilio-email-event-webhook-timestamp':timestamp,'x-twilio-email-event-webhook-signature':signature,
    });
  }
  const keys=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  f.env.SENDGRID_EVENT_WEBHOOK_VERIFICATION_KEY=keys.publicKey.export({type:'spki',format:'der'}).toString('base64');
  const event=(kind,extra={})=>({commercial_email_id:emailId,event:kind,email:'fixture@example.invalid',
    sg_message_id:'fixture-provider-2.fixture-suffix',sg_event_id:`fixture-event-${++sequence}`,
    timestamp:Math.floor(Date.now()/1000),...extra});
  await t.test('unsigned and forged events are rejected without persistence',async()=>{
    const before=(await f.db.query('select count(*) n from commercial_email_events')).rows[0].n;
    assert.equal((await f.businessRequest('commercial-email-events','POST',[event('delivered')],'missing')).status,403);
    const forged=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
    assert.equal((await signed([event('delivered')],{pair:forged})).status,403);
    assert.equal((await f.db.query('select count(*) n from commercial_email_events')).rows[0].n,before);
  });
  await t.test('signed events require matching recipient/provider and store no false delivery',async()=>{
    assert.equal((await signed([event('delivered',{email:'wrong@example.invalid'})])).status,400);
    assert.equal((await signed([event('delivered',{sg_message_id:'wrong-provider'})])).status,400);
    assert.equal((await snapshot(f)).emails.find(e=>e.id===emailId).state,'accepted');
  });
  await t.test('delivery, replay, old deferred/failure events and open events cannot regress delivery or imply read',async()=>{
    const delivered=event('delivered');
    assert.equal((await signed([delivered])).status,200);
    assert.equal((await signed([delivered])).status,200);
    assert.equal((await signed([event('deferred'),event('open'),event('bounce',{timestamp:delivered.timestamp-10})])).status,200);
    const row=(await snapshot(f)).emails.find(e=>e.id===emailId);
    assert.equal(row.state,'delivered');assert.equal(Date.parse(row.deliveredAt),delivered.timestamp*1000);
    assert.equal((await f.db.query('select count(*) n from commercial_email_events where event_id=$1',[delivered.sg_event_id])).rows[0].n,1);
    await f.db.exec('delete from commercial_email_suppressions'); // fixture reset only
  });
  await t.test('contradictory terminal evidence requires review and opt-out blocks new sends',async()=>{
    assert.equal((await signed([event('bounce',{reason:'Fixture mailbox rejected the message.'}),event('unsubscribe')])).status,200);
    const row=(await snapshot(f)).emails.find(e=>e.id===emailId);
    assert.equal(row.state,'needs_review');
    assert.equal((await post(f,{action:'email',subject:'Home2Smart',body:'Blocked by opt-out.'})).status,400);
    assert.equal(f.attempts.length,2);
    await f.db.exec('delete from commercial_email_suppressions'); // fixture reset only
  });
  await t.test('definite rejection permits explicit retry, not repeated-save retry',async()=>{
    f.businessFaults.providerStatus=429;
    const body={action:'email',operationId:op(),subject:'Home2Smart - retry fixture',body:'Fixture only.'};
    const rejected=await post(f,body);assert.equal(rejected.status,409);
    const message=(await rejected.json()).email;assert.equal(message.retrySafe,true);
    await post(f,body);assert.equal(f.attempts.length,3);
    f.businessFaults.providerStatus=202;
    assert.equal((await post(f,{action:'email',retryEmailId:message.id})).status,202);
    assert.equal(f.attempts.length,4);
  });
  await t.test('network ambiguity and post-send database failure never cause blind retries',async()=>{
    f.businessFaults.network=true;
    const body={action:'email',operationId:op(),subject:'Home2Smart - uncertain fixture',body:'Fixture only.'};
    const uncertain=await post(f,body);assert.equal(uncertain.status,409);
    assert.equal((await uncertain.json()).email.state,'needs_review');
    delete f.businessFaults.network;
    await post(f,body);assert.equal(f.attempts.length,5);
    const failedSave={...body,operationId:op()};
    f.businessFaults.rpc='commercial_email_finish';
    assert.equal((await post(f,failedSave)).status,503);
    delete f.businessFaults.rpc;
    assert.equal((await post(f,failedSave)).status,409);
    assert.equal(f.attempts.length,6);
    const processed=event('processed',{commercial_email_id:failedSave.operationId,sg_message_id:'fixture-provider-6.fixture'});
    assert.equal((await signed([processed])).status,200);
    assert.equal((await post(f,failedSave)).status,202);
    assert.equal(f.attempts.length,6);
  });
});

test('Manual quote/payment records remain independent of scheduling and Stripe; private proof is resumable',async t=>{
  const f=await createBusinessFixture();t.after(()=>f.db.close());
  const quote={action:'quote',status:'accepted',terms:'deposit',amountCents:150000,depositCents:50000,
    approvalNote:'Customer approval by phone recorded by fixture staff.',reference:'QUOTE-FIXTURE',note:'Camera installation scope.'};
  await t.test('invalid quote/approval input is rejected; approved quote restores exactly',async()=>{
    assert.equal((await post(f,{...quote,revision:0,depositCents:200000})).status,400);
    assert.equal((await post(f,{...quote,revision:0,approvalNote:''})).status,400);
    const body={...quote,revision:0,operationId:op()};
    assert.equal((await post(f,body)).status,200);
    assert.equal((await post(f,body)).status,200);
    const data=await snapshot(f);assert.equal(data.revision,1);assert.equal(data.quote.amountCents,150000);
    assert.equal(data.quote.depositCents,50000);assert.equal(data.history.length,1);
    assert.equal((await post(f,{...quote,revision:0})).status,409);
  });
  let paymentId;
  await t.test('manual received amount is audited without charging, Stripe verification or schedule changes',async()=>{
    const before=await f.db.query('select status,due_at from h2s_dispatch_jobs where job_id=$1',[id(101)]);
    paymentId=op();
    const body={action:'payment',revision:1,operationId:paymentId,amountCents:50000,method:'bank_transfer',
      state:'confirmed',reference:'BANK-FIXTURE-REDACTED',note:'Staff checked settled receipt in the business bank account.',receivedAt:new Date().toISOString()};
    assert.equal((await post(f,{...body,reference:''})).status,400);
    assert.equal((await post(f,body)).status,200);assert.equal((await post(f,body)).status,200);
    const data=await snapshot(f);assert.equal(data.payments.length,1);assert.equal(data.payments[0].state,'confirmed');
    assert.deepEqual((await f.db.query('select status,due_at from h2s_dispatch_jobs where job_id=$1',[id(101)])).rows,before.rows);
    assert.equal(f.calls.stripe.length,0);assert.equal(f.attempts.length,0);
    assert.equal((await post(f,{...quote,revision:data.revision,amountCents:160000})).status,400);
  });
  await t.test('correction preserves original payment and does not refund',async()=>{
    const data=await snapshot(f);
    assert.equal((await post(f,{action:'payment_void',revision:data.revision,paymentId,reason:'Incorrect fixture reference; corrected record required.'})).status,200);
    const next=await snapshot(f);assert.equal(next.payments[0].state,'voided');
    assert.equal(next.payments[0].amountCents,50000);assert.equal(next.history[0].action,'payment_void');
    assert.equal(f.calls.stripe.length,0);
  });
  const upload={leadId,operationId:op(),purpose:'contact_note',filename:'fixture.pdf',note:'Fixture staff note.',
    data:'data:application/pdf;base64,'+Buffer.from('%PDF-1.7\nFixture only.\n%%EOF').toString('base64')};
  await t.test('private upload requires admin, valid signature/size and private storage',async()=>{
    assert.equal((await f.businessRequest('commercial-business-files','POST',upload,'fixture-staff')).status,403);
    assert.equal((await f.businessRequest('commercial-business-files','POST',{...upload,data:'data:application/pdf;base64,aGVsbG8='})).status,400);
    f.businessFaults.publicBucket=true;
    assert.equal((await f.businessRequest('commercial-business-files','POST',upload)).status,503);
    delete f.businessFaults.publicBucket;
    assert.equal(f.objects.size,0);
  });
  await t.test('interrupted uploads reserve once and safely resume without duplicate storage/audit',async()=>{
    f.businessFaults.upload=true;
    assert.equal((await f.businessRequest('commercial-business-files','POST',upload)).status,503);
    let data=await snapshot(f);assert.equal(data.files[0].state,'pending');assert.equal(data.files[0].url,null);
    delete f.businessFaults.upload;
    assert.equal((await f.businessRequest('commercial-business-files','POST',upload)).status,201);
    assert.equal((await f.businessRequest('commercial-business-files','POST',upload)).status,201);
    data=await snapshot(f);
    assert.equal(f.objects.size,1);assert.equal(data.files[0].state,'ready');assert.match(data.files[0].url,/private/);
    assert.equal(data.history.filter(e=>e.action==='attachment').length,1);
    assert.equal((await f.businessRequest('commercial-business-files','POST',{...upload,note:'Different note, same identifier.'})).status,400);
  });
  await t.test('installation proof requires a linked job; upload does not complete it',async()=>{
    const proof={...upload,operationId:op(),purpose:'installation_proof'};
    assert.equal((await f.businessRequest('commercial-business-files','POST',proof)).status,400);
    await f.db.query(`insert into commercial_lead_operations(lead_id,installation_job_id,order_id) values($1,$2,$3)`,
      [leadId,id(101),id(100)]);
    assert.equal((await f.businessRequest('commercial-business-files','POST',proof)).status,201);
    const data=await snapshot(f),file=data.files.find(x=>x.id===proof.operationId);
    assert.equal(file.jobId,id(101));
    assert.equal((await f.db.query('select status from h2s_dispatch_jobs where job_id=$1',[id(101)])).rows[0].status,'queued');
    assert.equal(f.calls.stripe.length,0);assert.equal(f.attempts.length,0);
  });
  await t.test('new tables and functions deny anonymous/authenticated access',async()=>{
    const grants=await f.db.query(`select grantee from information_schema.role_table_grants where table_schema='public'
      and table_name like 'commercial_business_%' and grantee in ('PUBLIC','anon','authenticated')`);
    assert.equal(grants.rows.length,0);
    const access=await f.db.query(`select p.proname,has_function_privilege('anon',p.oid,'execute') a,
      has_function_privilege('authenticated',p.oid,'execute') b from pg_proc p where p.proname in
      ('commercial_business_record','commercial_email_claim','commercial_email_finish','commercial_email_event','commercial_file_record')`);
    assert.equal(access.rows.length,5);assert.ok(access.rows.every(x=>!x.a&&!x.b));
    const review=require('../lib/commercial_business_review.cjs');
    assert.equal((await review.inspect(f.db,true)).privateStorageVerified,true);
    await f.db.exec('create policy fixture_unsafe_storage on storage.objects for select to anon using(true)');
    await assert.rejects(review.inspect(f.db,true),/default-deny/);
    await f.db.exec('drop policy fixture_unsafe_storage on storage.objects');
  });
  await t.test('staff can email a verified private quote document; audit records attachment and no public URL is mailed',async()=>{
    const result=await post(f,{action:'email',subject:'Home2Smart - fixture quote document',body:'Please review the attached fixture quote.',
      attachmentIds:[upload.operationId]});
    assert.equal(result.status,202);
    assert.equal(f.attempts.length,1);
    assert.equal(f.attempts[0].attachments[0].filename,'fixture.pdf');
    assert.equal(f.attempts[0].attachments[0].content,upload.data.split(',')[1]);
    assert.doesNotMatch(JSON.stringify(f.attempts[0]),/https:\/\/fixture.invalid\/private/);
    const data=await snapshot(f);assert.equal(data.emails[0].attachments[0].id,upload.operationId);
    const crossed=await f.businessRequest('commercial-business','POST',{leadId:id(2),operationId:op(),action:'email',
      subject:'Home2Smart - invalid cross-lead attachment',body:'Must not send another lead file.',attachmentIds:[upload.operationId]});
    assert.equal(crossed.status,400);assert.equal(f.attempts.length,1);
    const messageId=data.emails[0].id;
    const attached=await f.businessRequest('commercial-business-files','POST',{...upload,operationId:op(),contactId:messageId,note:''});
    assert.equal(attached.status,201);
    assert.equal((await snapshot(f)).files.find(file=>file.contactId===messageId).purpose,'contact_note');
    const invalid=await f.businessRequest('commercial-business-files','POST',{...upload,operationId:op(),contactId:op()});
    assert.equal(invalid.status,400);
  });
});
