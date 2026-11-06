'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createWorkflowFixture,id}=require('./helpers/field_workflow_fixture.cjs');
const {retargetSql}=require('../tools/staging-sql-namespace.cjs');
const migration=name=>fs.readFileSync(path.join(__dirname,'..','migrations',name),'utf8').replaceAll('\r','');
const upgrade=migration('054_field_sales_residential_booking.sql');
const balanceMessage='Enrolled sales require 25% first and balance only after installation completion';
const runId='e58bc631-2cc4-45f4-b523-c33af024e3d2',schema='h2s_test_'+runId.replaceAll('-',''),role=schema+'_owner',storageSchema=schema+'_storage';
const target={schema,storageSchema},quote=name=>'"'+name.replaceAll('"','""')+'"';
const identity={marker:'home2smart-native-test-run-v1',runId,schema,storageSchema,role,sourceCommit:'a'.repeat(40),nativeBaselineFingerprint:'b'.repeat(64)};
const checked=async response=>{const data=await response.json();assert.equal(response.status,200,data.error);return data;};
const window=(days=1)=>({start:new Date(Date.now()+days*86400000).toISOString(),end:new Date(Date.now()+days*86400000+7200000).toISOString(),
  timezone:'America/New_York',customerAgreed:true,reason:'Synthetic customer-agreed installation window'});
async function fixture(t){
  const f=await createWorkflowFixture();t.after(()=>f.db.close());
  await f.db.exec(`alter table commercial_consultation_requests add column selected_slot_end timestamptz,
    add column preferred_slots jsonb default '[]'::jsonb;`);
  await f.db.exec(migration('038_residential_workspace.sql'));await f.enable();
  await f.db.exec(`create role ${quote(role)} nologin noinherit;alter schema public rename to ${quote(schema)};
    create schema public;alter schema ${quote(schema)} owner to ${quote(role)};
    create schema ${quote(storageSchema)} authorization ${quote(role)};set search_path=${quote(schema)},pg_catalog;`);
  const functions=(await f.db.query(`select p.oid::regprocedure::text as signature,pg_get_functiondef(p.oid) as source
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.prokind='f'`,[schema])).rows;
  for(const fn of functions){
    const source=fn.source.replaceAll('\r','').replace(/SET search_path TO ([^\n]+)/g,(_,names)=>{
      assert.match(names,/^'(?:public|pg_catalog|pg_temp)'(?:, '(?:public|pg_catalog|pg_temp)')*$/);
      return 'SET search_path='+names.replaceAll("'",'');
    });
    await f.db.exec(retargetSql(source,target));await f.db.exec(`alter function ${fn.signature} owner to ${quote(role)}`);
  }
  const tables=(await f.db.query(`select c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname=$1 and c.relkind in ('r','v')`,[schema])).rows;
  for(const table of tables)await f.db.exec(`alter ${table.relkind==='v'?'view':'table'} ${quote(schema)}.${quote(table.relname)} owner to ${quote(role)}`);
  await f.db.exec(`set role ${quote(role)};create table h2s_test_run(run_id uuid primary key,source_commit text,baseline_sha256 text);
    insert into h2s_test_run values('${runId}','${identity.sourceCommit}','${identity.nativeBaselineFingerprint}');
    comment on schema ${quote(schema)} is '${JSON.stringify(identity)}';
    comment on schema ${quote(storageSchema)} is '${JSON.stringify(identity)}';`);
  assert.equal((await f.db.query('select field_sales_native_staging_scope() as ok')).rows[0].ok,true);
  return f;
}
async function paid(f){
  const record=await f.accept(await f.documents(await f.enrolled()));
  await f.collect(record,'deposit');return record;
}
const workflow=async(f,record)=>(await checked(await f.read(record.leadId))).workflows.find(w=>w.quoteId===record.quoteId);
const schedule=async(f,record,extra={})=>f.admin({action:'schedule',leadId:record.leadId,quoteId:record.quoteId,
  revision:(await workflow(f,record)).revision,reservationRevision:0,...window(),...extra});
const book=(f,leadId,revision=0,action='confirm',payload=window())=>f.db.query('select commercial_record_reservation($1,$2,$3,$4,$5,$6)',
  [leadId,revision,crypto.randomUUID(),{id:id(9),name:'Synthetic fixture admin'},action,payload]);

test('native 038 reproduction: paid Field Sales schedule/reschedule succeeds after 054 without an invented inquiry or approval',{timeout:180000},async t=>{
  const f=await fixture(t),record=await paid(f);
  const fn=(await f.db.query("select pg_get_functiondef('field_sales_reserve_checkout(uuid,uuid,uuid,uuid,text)'::regprocedure) as source")).rows[0].source;
  const domainGate="raise exception 'Enrolled sales require 25%% first and balance only after installation completion' using errcode='22023';";
  assert.equal(fn.split(domainGate).length-1,1,'fresh 046 source uses a domain input error');
  await f.db.exec(fn.replace(domainGate,domainGate.replace("'22023'","'55000'")));
  const earlyBalance=()=>f.request('field-sales-agreement','POST',{action:'checkout',operationId:crypto.randomUUID(),kind:'balance'},record.token);
  const early=await earlyBalance();assert.equal(early.status,503,'reproduces old native SQLSTATE misclassification');
  const sessions=f.sessions.size;
  const deposit=(await f.db.query('select checkout_id,state,captured_cents from field_sales_checkouts where quote_id=$1',[record.quoteId])).rows[0];
  const blocked=await schedule(f,record);
  assert.equal(blocked.status,400);assert.match((await blocked.json()).error,/Accept homeowner follow-up/);
  assert.equal((await f.db.query('select count(*)::int as n from commercial_reservations where lead_id=$1',[record.leadId])).rows[0].n,0);
  assert.equal((await workflow(f,record)).jobId,null,'failed scheduling rolls back its job links');
  await f.db.exec(retargetSql(upgrade,target));await f.db.exec(retargetSql(upgrade,target));
  const balance=await earlyBalance();assert.equal(balance.status,400);assert.equal((await balance.json()).error,balanceMessage);
  await assert.rejects(f.db.query("select field_sales_reserve_checkout($1,$2,$3,$4,'balance')",
    [id(20),crypto.randomUUID(),record.leadId,record.quoteId]),error=>error.code==='22023'&&error.message===balanceMessage);
  assert.equal(f.sessions.size,sessions,'no additional checkout/provider session');
  assert.equal((await f.db.query("select count(*)::int as n from field_sales_checkouts where quote_id=$1 and kind='balance'",[record.quoteId])).rows[0].n,0);
  assert.deepEqual((await f.db.query('select checkout_id,state,captured_cents from field_sales_checkouts where checkout_id=$1',[deposit.checkout_id])).rows[0],deposit);
  await checked(await schedule(f,record));
  let w=await workflow(f,record);
  assert.equal(w.state,'scheduled');assert.equal(w.reservation.state,'confirmed');assert.ok(w.jobId);
  const job=w.jobId;
  await checked(await f.admin({action:'reschedule',leadId:record.leadId,quoteId:record.quoteId,
    revision:w.revision,reservationRevision:w.reservation.revision,...window(2)}));
  w=await workflow(f,record);assert.equal(w.jobId,job);assert.equal(w.reservation.revision,2);
  assert.equal((await f.db.query('select count(*)::int as n from commercial_consultation_requests where lead_id=$1',[record.leadId])).rows[0].n,0);
  assert.equal((await f.db.query('select count(*)::int as n from residential_notices where lead_id=$1',[record.leadId])).rows[0].n,0);
  const returning=await checked(await f.request('field-sales','POST',{action:'repeat',operationId:crypto.randomUUID(),
    leadId:record.leadId,ownerId:id(20),services:['tv_mounting'],evidence:'Verified exact returning household; separate installation'},'admin'));
  const quoteId=await f.submit(returning.leadId,await f.quote(returning.leadId));
  await checked(await f.admin({action:'enroll',leadId:returning.leadId,quoteId,revision:0,legalPolicyId:f.policyIds.legal,
    commissionPolicyId:f.policyIds.commission,settlementPolicyId:f.policyIds.settlement,representativeId:id(20),
    creditEvidence:{reference:'Synthetic separate canonical opportunity'}}));
  const second=await f.accept(await f.documents({leadId:returning.leadId,quoteId}));
  await f.collect(second,'deposit');await checked(await schedule(f,second,window(3)));
  assert.notEqual((await workflow(f,second)).jobId,job);
  assert.equal((await f.db.query('select customer_id from field_sales_opportunities where lead_id=$1',[returning.leadId])).rows[0].customer_id,record.leadId);
  assert.equal((await f.db.query('select count(*)::int as n from residential_notices where lead_id=any($1::uuid[])',[[record.leadId,returning.leadId]])).rows[0].n,0);
});

test('054 preserves genuine homeowner approval/closed-lead gates, unknown-source denial, and original notice generation',{timeout:180000},async t=>{
  const f=await fixture(t);await f.db.exec(retargetSql(upgrade,target));
  const leadId=crypto.randomUUID(),requestId=crypto.randomUUID();
  await f.db.query(`insert into commercial_leads(lead_id,full_name,phone,project_address,project_city,attribution,service_needs)
    values($1,'Synthetic homeowner','+15550003331','100 Fixture Lane','Fixture City','{"market":"residential"}','["TV Mounting"]')`,[leadId]);
  await f.db.query('insert into commercial_lead_operations(lead_id) values($1)',[leadId]);
  await assert.rejects(book(f,leadId),/Accept homeowner follow-up/);
  await f.db.query(`insert into commercial_consultation_requests(request_id,lead_id,status,metadata,preferred_slots)
    values($1,$2,'pending','{"request_kind":"residential_inquiry"}','[]')`,[requestId,leadId]);
  await assert.rejects(book(f,leadId),/Accept homeowner follow-up/);
  await f.db.query("update commercial_consultation_requests set status='approved' where request_id=$1",[requestId]);
  await f.db.query("update commercial_lead_operations set disposition='closed',disposition_reason='Synthetic closed inquiry' where lead_id=$1",[leadId]);
  await assert.rejects(book(f,leadId),/Accept homeowner follow-up/);
  await f.db.query("update commercial_lead_operations set disposition='open' where lead_id=$1",[leadId]);
  await book(f,leadId);
  assert.equal((await f.db.query('select count(*)::int as n from residential_notices where lead_id=$1',[leadId])).rows[0].n,3);
  await book(f,leadId,1,'cancel',{reason:'Synthetic customer cancellation'});
  assert.equal((await f.db.query("select count(*)::int as n from residential_notices where lead_id=$1 and kind='customer_cancellation'",[leadId])).rows[0].n,1);
  const fieldLead=await f.lead();
  await assert.rejects(book(f,fieldLead),/Accept homeowner follow-up/,'intake tag and opportunity alone are insufficient');
  const tagged=crypto.randomUUID();
  await f.db.query(`insert into commercial_leads(lead_id,attribution,service_needs)
    values($1,'{"market":"residential","intake":"field_sales"}','["TV Mounting"]')`,[tagged]);
  await assert.rejects(book(f,tagged),/Accept homeowner follow-up/,'a caller-supplied source tag is not provenance');
});

test('native provenance exemption cannot skip paid/legal/window/source/canonical/order/closed safeguards',{timeout:180000},async t=>{
  const f=await fixture(t);await f.db.exec(retargetSql(upgrade,target));
  for(const name of ['anon','authenticated']){
    await f.db.exec('reset role;set role '+name);
    await assert.rejects(book(f,id(1)),/permission denied/);
    await f.db.exec('reset role;set role '+quote(role));
  }
  const unpaid=await f.accept(await f.documents(await f.enrolled()));
  assert.notEqual((await schedule(f,unpaid)).status,200,'unpaid workflow is not schedulable');
  await assert.rejects(book(f,unpaid.leadId),/Accept homeowner follow-up/);
  const record=await paid(f);await checked(await schedule(f,record));
  const w=await workflow(f,record);
  await assert.rejects(book(f,record.leadId,w.reservation.revision,'reschedule',{...window(3),customerAgreed:false}),/customer agreement/i);
  for(const mutation of [
    {sql:"update field_sales_checkouts set disputed=true where quote_id=$1",args:[record.quoteId]},
    {sql:"update field_sales_checkouts set refunded_cents=1 where quote_id=$1",args:[record.quoteId]},
    {sql:"update commercial_lead_operations set disposition='closed',disposition_reason='Synthetic closed opportunity' where lead_id=$1",args:[record.leadId]},
    {sql:"update field_sales_opportunities set status='closed' where lead_id=$1",args:[record.leadId]},
    {sql:"delete from field_sales_commands where lead_id=$1 and action in ('create','repeat')",args:[record.leadId]},
    {sql:"update commercial_lead_operations set order_id=$1 where lead_id=$2",args:[id(100),record.leadId]},
    {sql:"update field_sales_workflows set state='refund_review' where quote_id=$1",args:[record.quoteId]},
    {sql:"update field_sales_settings set enabled=false",args:[]},
    {sql:"update field_sales_transaction_settings set enabled=false",args:[]},
    {sql:"update field_sales_workflow_settings set enabled=false",args:[]},
    {sql:`insert into commercial_consultation_requests(request_id,lead_id,status,metadata,preferred_slots)
      values($1,$2,'pending','{"request_kind":"residential_inquiry"}','[]')`,args:[crypto.randomUUID(),record.leadId]},
    {sql:"delete from field_sales_workflow_delivery where quote_id=$1",args:[record.quoteId],rejectMutation:true},
    {sql:`comment on schema ${quote(schema)} is '{}'`,args:[]}
  ]){
    await f.db.exec('begin');
    if(mutation.rejectMutation){await assert.rejects(f.db.query(mutation.sql,mutation.args),/immutable/i);await f.db.exec('rollback');continue;}
    await f.db.query(mutation.sql,mutation.args);
    await assert.rejects(book(f,record.leadId,w.reservation.revision,'reschedule',window(3)),/Accept homeowner follow-up/,mutation.sql);
    await f.db.exec('rollback');
  }
  await assert.rejects(book(f,record.leadId,w.reservation.revision,'hold',{...window(3),expiresAt:window().start}),/Reschedule or cancel/);
  await assert.rejects(f.db.query('update field_sales_opportunities set customer_id=$1 where lead_id=$2',[id(1),record.leadId]),/Customer identity is immutable/);
  assert.equal((await workflow(f,record)).reservation.revision,w.reservation.revision);
});

test('054 is retargetable and refuses public installation; 038 source remains the existing authority',{timeout:180000},async t=>{
  assert.equal(retargetSql(retargetSql(upgrade,target),target),retargetSql(upgrade,target));
  assert.doesNotMatch(upgrade,/disable trigger|insert into public\.commercial_consultation_requests|set_config/i);
  const f=await createWorkflowFixture();t.after(()=>f.db.close());await f.db.exec(migration('038_residential_workspace.sql'));
  await assert.rejects(f.db.exec(upgrade),/054 requires the verified UUID-owned native sandbox/);await f.db.exec('rollback');
});
