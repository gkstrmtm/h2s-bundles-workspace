'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createWorkflowFixture,id}=require('./helpers/field_workflow_fixture.cjs');
const {evaluate}=require('./helpers/commercial_operations_fixture.cjs');
const {retargetSql}=require('../tools/staging-sql-namespace.cjs');
const migration=name=>fs.readFileSync(path.join(__dirname,'..','migrations',name),'utf8').replaceAll('\r','');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const quoted=value=>'"'+value.replaceAll('"','""')+'"';
const runId='e58bc631-2cc4-45f4-b523-c33af024e3d2',schema='h2s_test_'+runId.replaceAll('-',''),role=schema+'_owner',storageSchema=schema+'_storage';
const target={schema,storageSchema},identity={marker:'home2smart-native-test-run-v1',runId,schema,storageSchema,role,
  sourceCommit:'a'.repeat(40),nativeBaselineFingerprint:'b'.repeat(64)};
const launch={enabled:true,jurisdiction:'NC',municipality:'Charlotte',status:'staging_only',productionApproved:false};
const agreementModule=f=>evaluate('lib\\fieldAgreement.ts',{'node:crypto':crypto,'@/lib/commercial_business':f.business,
  '@/lib/customerAgreement.v1.json':require('../lib/customerAgreement.v1.json'),
  '@/lib/customerAgreement.nc.v1.json':require('../lib/customerAgreement.nc.v1.json')});
const rpc=async(f,name,casts,args)=>(await f.db.query(`select ${name}(${casts.map((c,i)=>'$'+(i+1)+'::'+c).join(',')}) result`,
  args.map(v=>v&&typeof v==='object'?JSON.stringify(v):v))).rows[0].result;
const command=(f,action,payload,operation=crypto.randomUUID())=>rpc(f,'field_sales_command',['uuid','uuid','text','jsonb'],
  [id(20),operation,action,payload]);
const workflow=(f,r,action,payload={},revision=0)=>rpc(f,'field_sales_workflow_command',
  ['uuid','uuid','uuid','uuid','integer','text','jsonb'],[id(9),crypto.randomUUID(),r.leadId,r.quoteId,revision,action,payload]);
const transaction=(f,r,action,payload={})=>rpc(f,'field_sales_transaction_command',['uuid','uuid','uuid','text','jsonb'],
  [id(20),crypto.randomUUID(),r.leadId,action,{quoteId:r.quoteId,...payload}]);
const read=(f,r,input=null)=>rpc(f,'field_sales_customer_agreement',['text','jsonb'],[r.hash,input]);
const reserve=(f,r,kind='deposit')=>rpc(f,'field_sales_reserve_checkout',['uuid','uuid','uuid','uuid','text'],
  [id(20),crypto.randomUUID(),r.leadId,r.quoteId,kind]);
async function native(f){
  await f.db.exec(`create role ${quoted(role)} nologin noinherit;alter schema public rename to ${quoted(schema)};
    create schema public;alter schema ${quoted(schema)} owner to ${quoted(role)};
    create schema ${quoted(storageSchema)} authorization ${quoted(role)};set search_path=${quoted(schema)},pg_catalog;`);
  const functions=(await f.db.query(`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) source
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.prokind='f'`,[schema])).rows;
  for(const fn of functions){
    const source=fn.source.replaceAll('\r','').replace(/SET search_path TO ([^\n]+)/g,(_,names)=>{
      assert.match(names,/^'(?:public|pg_catalog|pg_temp)'(?:, '(?:public|pg_catalog|pg_temp)')*$/);
      return 'SET search_path='+names.replaceAll("'",'');
    });
    await f.db.exec(retargetSql(source,target));
    await f.db.exec(`alter function ${fn.signature} owner to ${quoted(role)}`);
  }
  const tables=(await f.db.query(`select c.relname,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname=$1 and c.relkind in ('r','v')`,[schema])).rows;
  for(const table of tables)await f.db.exec(`alter ${table.relkind==='v'?'view':'table'} ${quoted(schema)}.${quoted(table.relname)} owner to ${quoted(role)}`);
  await f.db.exec(`set role ${quoted(role)};create table h2s_test_run(run_id uuid primary key,source_commit text,baseline_sha256 text);
    insert into h2s_test_run values('${runId}','${identity.sourceCommit}','${identity.nativeBaselineFingerprint}');
    comment on schema ${quoted(schema)} is '${JSON.stringify(identity)}';
    comment on schema ${quoted(storageSchema)} is '${JSON.stringify(identity)}';`);
  assert.equal((await f.db.query('select field_sales_native_staging_scope() ok')).rows[0].ok,true);
}
function signature(facts){
  const documents=facts.workflow.documents.filter(d=>d.kind!=='quote').map(d=>{
    const c=d.content.customer_document||d.content;
    const html=`<html><body><h1>${d.label}</h1>${c.text} ${facts.workflow.reviewDate} ${facts.workflow.cancellationPreviewDeadline}</body></html>`;
    return {kind:d.kind==='agreement'?'agreement':c.version==='electronic-records-v1'?'electronic_consent':'notice',
      version:c.version,label:d.label,html,contentHash:sha(html)};
  });
  const bundle=sha(documents.map(d=>d.contentHash).join('|')+'|'+facts.quote.quote_hash+'|'+facts.workflow.reviewDate);
  return {operationId:crypto.randomUUID(),name:'Synthetic Customer',email:'synthetic@example.invalid',quoteHash:facts.quote.quote_hash,
    policyVersion:facts.agreement.policy_snapshot.version,accepted:true,electronicDelivery:true,acceptanceMethod:'typed_name',
    agreementAccepted:true,cancellationNoticeReceived:true,electronicRecordsConsent:true,signatureIntent:true,
    signatureIntentText:'I intend to electronically sign this exact Home2Smart service agreement.',
    reviewedBundleHash:bundle,reviewDate:facts.workflow.reviewDate,accessCode:bundle.slice(0,8).toUpperCase(),
    acknowledgments:['agreement','cancellation_notice','electronic_records','signature_intent'].map(kind=>({kind,affirmed:true})),
    requestMetadata:{authenticatedCustomerLink:true,userAgent:'isolated NC SQL fixture'},acceptedDocuments:documents,
    artifactHashes:facts.workflow.originalArtifactHashes};
}
async function protocolRecord(f,{nc=false,leadId=null,documentOverrides={},mutateDocument=()=>{},calendarOverrides={},publish=true}={}){
  if(!leadId)leadId=await f.lead();
  const quoteId=await f.submit(leadId,await f.quote(leadId)),r={leadId,quoteId};
  const protocol=nc?'h2s-customer-service-nc-v1':'h2s-customer-service-v1';
  const snapshot=(await f.db.query('select snapshot from field_sales_quotes where quote_id=$1',[quoteId])).rows[0].snapshot;
  let document={protocol,version:nc?'customer-service-nc-v1':'customer-service-v1',
    text:'Synthetic covered service agreement; not a legal approval or actual solicitation.',
    seller:{name:'Synthetic Home2Smart',mailingAddress:'100 Synthetic Street',phone:'555-0100'},
    sale:{jurisdiction:nc?'NC':'SC',location:'residence',personalSolicitation:true,oralPresentationLanguage:'en',
      oralNoticeEvidence:'Synthetic seller personally explained cancellation rights',cancellationEligibility:'covered',
      ...(nc?{territory:{state:'NC',municipality:'Charlotte',verifiedAddress:snapshot.customer.address,
        addressEvidence:'Synthetic address checked for this isolated fixture',
        permitReviewEvidence:'Synthetic authorization only; no real permit claimed',solicitationAuthorized:true,syntheticOnly:true}}:{})},
    ...documentOverrides};
  let prepared;
  if(nc){
    prepared=agreementModule(f).prepareAgreementArtifacts(snapshot,document.seller,{language:'en',
      oralNoticeEvidence:document.sale.oralNoticeEvidence,territory:document.sale.territory});
    document={...prepared.find(d=>d.kind==='agreement').content,...documentOverrides};
  }
  mutateDocument(document);
  let notices=[1,2].map(copy=>({label:'Cancellation notice copy '+copy,
    content:{protocol,version:nc?'nc-ftc-cancellation-v1':'sc-ftc-cancellation-v1',copy,text:'Synthetic cancellation notice copy '+copy}}));
  notices.push({label:'Electronic records consent',content:{protocol,version:'electronic-records-v1',text:'Synthetic electronic records consent'}});
  if(nc)notices=prepared.filter(d=>d.kind==='notice').map(({label,content})=>({label,content}));
  const agreementPolicyId=crypto.randomUUID(),policyId=crypto.randomUUID();
  await f.db.query(`insert into field_sales_agreement_policies(policy_id,version,status,terms,cancellation_information,
    electronic_delivery,payment_terms,approval_evidence,approved_by,approved_at,customer_document)
    select $1,$2,'approved',terms,cancellation_information,electronic_delivery,payment_terms,approval_evidence,
      approved_by,approved_at,$3 from field_sales_agreement_policies where policy_id=$4`,
    [agreementPolicyId,'synthetic-'+agreementPolicyId,document,id(811)]);
  const holidays=(await f.db.query(`select distinct h::text as holiday_date from generate_series(extract(year from now())::int-1,
    extract(year from now())::int+2) y cross join lateral field_sales_signature_holidays(y) h order by holiday_date`)).rows.map(r=>r.holiday_date);
  const definition={...f.legalDefinition,agreementPolicyId,requiredNotices:notices,
    cancellationCalendar:{timezone:'America/New_York',businessDays:3,deadlineLocalTime:'23:59',startEvent:'acceptance',
      excludedWeekdays:nc?[6,7]:[7],holidays,...calendarOverrides}};
  await f.db.query(`insert into field_sales_workflow_policies(policy_id,kind,status,definition,approved_by,approved_at,approval_evidence)
    values($1,'legal','approved',$2,$3,now(),'{"reference":"isolated synthetic NC fixture"}')`,[policyId,definition,id(9)]);
  await workflow(f,r,'enroll',{legal_policy_id:policyId,commission_policy_id:f.policyIds.commission,
    settlement_policy_id:f.policyIds.settlement,representative_id:id(20),credit_evidence:{reference:'Synthetic isolated enrollment'}});
  await f.db.query(`update field_sales_transaction_settings set agreement_policy_id=$1::uuid,
    deposit_policy=jsonb_set(deposit_policy,'{agreementPolicyId}',to_jsonb(($1::uuid)::text))`,[agreementPolicyId]);
  const facts=await rpc(f,'field_sales_workflow_read',['uuid','uuid','uuid'],[id(9),leadId,quoteId]);
  const artifacts=facts.workflows[0].requiredArtifacts;
  if(!publish)return {...r,artifacts,document};
  await workflow(f,r,'documents_publish',{artifacts,evidence:{reference:'Reviewed synthetic NC templates'}},1);
  const token=crypto.randomBytes(32).toString('hex'),hash=sha(token);
  await transaction(f,r,'agreement',{tokenHash:hash});
  return {...r,hash,token,artifacts,document};
}
async function prospect(f,patch={}){
  const leadId=await f.lead();
  const base=(await f.db.query('select payload from field_sales_commands where lead_id=$1 and action=$2',[leadId,'create'])).rows[0].payload;
  return {...base,phone:'+1555'+String(Math.floor(1000000+Math.random()*8000000)),state:'NC',city:'Charlotte',
    salesChannel:'door_to_door',...patch};
}
async function rollback(f,fn){await f.db.exec('begin');try{return await fn();}finally{await f.db.exec('rollback');}}

test('057 native NC launch uses real SQL, frozen jurisdiction evidence and unchanged signed SC history',{timeout:180000},async t=>{
  const f=await createWorkflowFixture();t.after(()=>f.db.close());await f.enable();
  await assert.rejects(f.db.exec(migration('057_field_sales_nc_launch.sql')),e=>e.code==='42501');
  await f.db.exec('rollback');
  await native(f);
  await f.db.exec(retargetSql(migration('056_field_sales_customer_signature.sql'),target));
  const sc=await protocolRecord(f),scInput=signature(await read(f,sc));
  await read(f,sc,scInput);
  const scCheckout=crypto.randomUUID();
  const scPayment=await rpc(f,'field_sales_reserve_checkout',['uuid','uuid','uuid','uuid','text'],
    [id(20),scCheckout,sc.leadId,sc.quoteId,'deposit']);
  const unsigned=await protocolRecord(f);
  const scBefore=(await f.db.query(`select to_jsonb(a) agreement,
    (select jsonb_agg(to_jsonb(x) order by artifact_id) from field_sales_workflow_artifacts x where x.quote_id=a.quote_id) artifacts,
    (select cancellation_deadline from field_sales_workflows where quote_id=a.quote_id) deadline
    from field_sales_agreements a where a.quote_id=$1`,[sc.quoteId])).rows[0];
  const createPayload=await prospect(f);
  await f.db.exec(retargetSql(migration('057_field_sales_nc_launch.sql'),target));
  const previousRpc=f.client.rpc.bind(f.client);
  f.client.rpc=async(name,args)=>{
    if(name!=='field_sales_customer_signature_context')return previousRpc(name,args);
    assert.deepEqual(Object.keys(args),['p_token_hash']);
    try{return {data:await rpc(f,name,['text'],[args.p_token_hash]),error:null};}
    catch(error){return {data:null,error:{code:error.code,message:error.message}};}
  };
  await t.test('nullable launch is off; invalid/non-native/production configuration cannot enable it',async()=>{
    assert.equal((await rpc(f,'field_sales_read',['uuid','uuid'],[id(20),null])).doorToDoorLaunch,null);
    assert.deepEqual(await rpc(f,'field_sales_access',['uuid'],[id(20)]),{role:'SALES',doorToDoorLaunch:null});
    const listingOff=await f.request('field-sales','GET',null,'a'),listingOffFacts=await listingOff.json();
    assert.equal(listingOff.status,200,listingOffFacts.error);
    assert.equal(listingOffFacts.doorToDoorLaunch,null);
    for(const config of [{...launch,productionApproved:true},{...launch,status:'approved'},{...launch,jurisdiction:'SC'},{...launch,municipality:'Fort Mill'}])
      await assert.rejects(f.db.query('update field_sales_settings set door_to_door_launch=$1',[config]),e=>e.code==='42501');
    await rollback(f,async()=>{
      await f.db.exec(`comment on schema ${quoted(schema)} is 'null'`);
      await assert.rejects(f.db.query('update field_sales_settings set door_to_door_launch=$1',[launch]),e=>e.code==='42501');
    });
    await f.db.query('update field_sales_settings set door_to_door_launch=$1',[launch]);
    assert.deepEqual((await rpc(f,'field_sales_read',['uuid','uuid'],[id(20),null])).doorToDoorLaunch,launch);
  });
  await t.test('access RPC and actual API listing expose enabled launch without changing role authorization',async()=>{
    assert.deepEqual(await rpc(f,'field_sales_access',['uuid'],[id(20)]),{role:'SALES',doorToDoorLaunch:launch});
    assert.deepEqual(await rpc(f,'field_sales_access',['uuid'],[id(9)]),{role:'ADMIN',doorToDoorLaunch:launch});
    await assert.rejects(rpc(f,'field_sales_access',['uuid'],[id(10)]),e=>e.code==='42501');
    await assert.rejects(rpc(f,'field_sales_access',['uuid'],[crypto.randomUUID()]),e=>e.code==='42501');
    const listing=await f.request('field-sales','GET',null,'a'),facts=await listing.json();
    assert.equal(listing.status,200,facts.error);
    assert.deepEqual(facts.doorToDoorLaunch,launch);
    assert.equal(facts.actor.role,'SALES');assert.ok(Array.isArray(facts.opportunities));
  });
  await t.test('raw create rejects missing classification, SC and Fort Mill; Charlotte NC and non-DTD SC succeed',async()=>{
    for(const patch of [{state:null},{salesChannel:null},{city:null},{state:'SC'},{city:'Fort Mill'},{salesChannel:'unknown'}])
      await assert.rejects(command(f,'create',{...createPayload,...patch}),e=>e.code==='22023');
    const operation=crypto.randomUUID(),ncPayload={...createPayload,state:'nc',city:'cHaRlOtTe'};
    const nc=await command(f,'create',ncPayload,operation);
    assert.equal((await command(f,'create',ncPayload,operation)).leadId,nc.leadId);
    f.ncLeadId=nc.leadId;
    const stored=(await f.db.query('select project_state,attribution from commercial_leads where lead_id=$1',[nc.leadId])).rows[0];
    assert.equal(stored.project_state,'NC');assert.equal(stored.attribution.state,'NC');assert.equal(stored.attribution.salesChannel,'door_to_door');
    const detail=await rpc(f,'field_sales_read',['uuid','uuid'],[id(20),nc.leadId]);
    assert.equal(detail.lead.project_state,'NC');assert.equal(detail.lead.attribution.salesChannel,'door_to_door');
    const response=await f.request('field-sales','GET',null,'a','?leadId='+nc.leadId),apiDetail=await response.json();
    assert.equal(response.status,200,apiDetail.error);
    assert.deepEqual(apiDetail.doorToDoorLaunch,launch);
    assert.equal(apiDetail.lead.project_state,'NC');assert.equal(apiDetail.lead.state,'NC');
    assert.equal(apiDetail.lead.attribution.salesChannel,'door_to_door');
    const other=await command(f,'create',{...createPayload,phone:'+15555559871',state:'SC',city:'Fort Mill',salesChannel:'other'});
    assert.ok(other.leadId);
    await assert.rejects(f.db.query(`update commercial_leads set project_state='NC',
      attribution=attribution||'{"state":"NC","salesChannel":"door_to_door"}' where lead_id=$1`,[other.leadId]),e=>e.code==='42501');
    await assert.rejects(command(f,'repeat',{...createPayload,leadId:other.leadId,evidence:'Synthetic relationship',
      state:'NC',salesChannel:'door_to_door'}),e=>e.code==='42501');
    await assert.rejects(command(f,'attach',{...createPayload,leadId:unsigned.leadId,evidence:'Must not relabel old SC'}),
      e=>e.code==='55000');
    const repeat=await command(f,'repeat',{...createPayload,leadId:nc.leadId,state:'NC',evidence:'Synthetic relationship'});
    const repeated=(await f.db.query('select project_state,attribution from commercial_leads where lead_id=$1',[repeat.leadId])).rows[0];
    assert.equal(repeated.project_state,'NC');assert.equal(repeated.attribution.salesChannel,'door_to_door');
  });
  await t.test('new SC paths fail even with raw RPCs while signed SC copies/hash/deadline/retries remain untouched',async()=>{
    await assert.rejects(read(f,unsigned),e=>e.code==='55000');
    await assert.rejects(rpc(f,'field_sales_customer_signature_context',['text'],[unsigned.hash]),e=>e.code==='55000');
    await assert.rejects(read(f,unsigned,scInput),e=>e.code==='55000');
    await assert.rejects(reserve(f,unsigned),e=>['55000','40001'].includes(e.code));
    for(const action of ['quote','submit','agreement'])
      await assert.rejects(transaction(f,unsigned,action),e=>e.code==='55000');
    for(const action of ['enroll','preparation'])
      await assert.rejects(workflow(f,unsigned,action),e=>e.code==='55000');
  });
  await t.test('new NC publication and signature pin source territory and server-owned customer state/channel',async()=>{
    const nc=await protocolRecord(f,{nc:true,leadId:f.ncLeadId});
    const q=(await f.db.query('select snapshot from field_sales_quotes where quote_id=$1',[nc.quoteId])).rows[0].snapshot;
    assert.equal(q.customer.state,'NC');assert.equal(q.customer.salesChannel,'door_to_door');
    await assert.rejects(read(f,nc,signature(await rpc(f,'field_sales_customer_signature_context',['text'],[nc.hash]))),e=>e.code==='55000');
    const facts=await read(f,nc),input=signature(facts);
    const wrongNotice=structuredClone(input);
    wrongNotice.acceptedDocuments.find(d=>d.kind==='notice').version='sc-ftc-cancellation-v1';
    await assert.rejects(read(f,nc,wrongNotice),e=>e.code==='22023');
    const accepted=await read(f,nc,input);
    assert.equal(accepted.agreement.acceptance.protocol,'h2s-customer-service-nc-v1');
    assert.equal(accepted.workflow.acceptedDocuments.length,4);
    for(const d of accepted.workflow.acceptedDocuments){
      assert.equal(d.content.protocol,'h2s-customer-service-nc-v1');
      assert.match(d.content.html,/data-h2s-signature-evidence="h2s-customer-service-nc-v1"/);
    }
    assert.deepEqual((await read(f,nc,input)).agreement.acceptance,accepted.agreement.acceptance);
    const payment=await reserve(f,nc);
    assert.equal(Number(payment.amount_cents),Math.ceil(q.totalCents/4));
    const freshSC=await read(f,sc,scInput);
    assert.equal(freshSC.agreement.acceptance.protocol,'h2s-customer-service-v1');
    const after=(await f.db.query(`select to_jsonb(a) agreement,
      (select jsonb_agg(to_jsonb(x) order by artifact_id) from field_sales_workflow_artifacts x where x.quote_id=a.quote_id) artifacts,
      (select cancellation_deadline from field_sales_workflows where quote_id=a.quote_id) deadline
      from field_sales_agreements a where a.quote_id=$1`,[sc.quoteId])).rows[0];
    assert.deepEqual(after,scBefore);
    await assert.rejects(reserve(f,sc),e=>e.code==='55000'&&e.message.includes('existing checkout retries'));
    const retried=await rpc(f,'field_sales_reserve_checkout',['uuid','uuid','uuid','uuid','text'],
      [id(20),scCheckout,sc.leadId,sc.quoteId,'deposit']);
    assert.equal(retried.checkout_id,scPayment.checkout_id);
    assert.equal(Number(retried.amount_cents),Math.ceil(scBefore.agreement.policy_snapshot.paymentPlan.fullCents/4));
    await assert.rejects(reserve(f,sc,'balance'),e=>['22023','55000'].includes(e.code)&&!e.message.includes('SC protocol'));
    f.ncRecord=nc;
  });
  await t.test('NC source refuses missing review, real-permit claims, mismatched addresses and relabeled SC/no-state quotes',async()=>{
    const nc=f.ncRecord;
    for(const mutate of [
      d=>delete d.sale.territory,
      d=>d.sale.territory.syntheticOnly=false,
      d=>d.sale.territory.solicitationAuthorized=false,
      d=>d.sale.territory.addressEvidence='',
      d=>d.sale.territory.permitReviewEvidence='',
      d=>d.sale.territory.verifiedAddress+=' changed',
      d=>d.sale.territory.state='SC',
      d=>d.sale.territory.municipality='Fort Mill',
      d=>d.sale.jurisdiction='SC',
      d=>d.sale.oralPresentationLanguage='es'
    ]){
      const document=structuredClone(nc.document);mutate(document);
      assert.equal(await rpc(f,'field_sales_nc_source',['uuid','jsonb'],[nc.quoteId,document]),false);
    }
    assert.equal(await rpc(f,'field_sales_nc_source',['uuid','jsonb'],[unsigned.quoteId,nc.document]),false);
    const policy=(await f.db.query('select policy_id from field_sales_agreements where quote_id=$1',[nc.quoteId])).rows[0].policy_id;
    await assert.rejects(f.db.query(`update field_sales_agreement_policies set customer_document=jsonb_set(customer_document,
      '{sale,territory,state}','"SC"') where policy_id=$1`,[policy]),e=>e.code==='42501');
    const lead=await command(f,'create',{...createPayload,phone:'+15555559872'});
    const bad=await protocolRecord(f,{nc:true,leadId:lead.leadId,publish:false,
      mutateDocument:d=>d.sale.territory.verifiedAddress+=' not the frozen quote address'});
    await assert.rejects(workflow(f,bad,'documents_publish',{artifacts:bad.artifacts,
      evidence:{reference:'Invalid synthetic territory review must not publish'}},1),e=>e.code==='55000');
    assert.equal((await f.db.query('select count(*)::int n from field_sales_workflow_artifacts where quote_id=$1',[bad.quoteId])).rows[0].n,0);
    await assert.rejects(transaction(f,bad,'agreement',{tokenHash:'f'.repeat(64)}),e=>e.code==='55000');
  });
  await t.test('NC voluntarily extends printed deadlines to three Mon-Fri days; SC retains Saturday and old deadlines',async()=>{
    const nc=f.ncRecord;
    for(const [stamp,expected] of [
      ['2026-11-06T15:00:00Z','2026-11-13T05:00:00+00:00'],
      ['2026-07-02T15:00:00Z','2026-07-09T04:00:00+00:00'],
      ['2026-03-06T15:00:00Z','2026-03-12T04:00:00+00:00']
    ]){
      const actual=await rpc(f,'field_sales_workflow_deadline',['uuid','timestamptz'],[nc.quoteId,stamp]);
      assert.equal(new Date(actual).toISOString(),new Date(expected).toISOString());
    }
    const start='2026-03-06T15:00:00Z';
    const old=await rpc(f,'field_sales_workflow_deadline',['uuid','timestamptz'],[sc.quoteId,start]);
    assert.equal(new Date(old).toISOString(),'2026-03-11T04:00:00.000Z');
    const lead=await command(f,'create',{...createPayload,phone:'+15555559875'});
    const bad=await protocolRecord(f,{nc:true,leadId:lead.leadId,publish:false,calendarOverrides:{excludedWeekdays:[7]}});
    await assert.rejects(workflow(f,bad,'documents_publish',{artifacts:bad.artifacts,
      evidence:{reference:'NC printed extension must not silently use the SC convention'}},1),e=>e.code==='55000');
    assert.deepEqual((await f.db.query('select cancellation_deadline from field_sales_workflows where quote_id=$1',[sc.quoteId])).rows[0].cancellation_deadline,
      scBefore.deadline);
  });
  await t.test('API creation reaches SQL territory checks with explicit state and channel',async()=>{
    const rejected=await f.request('field-sales','POST',{...createPayload,action:'create',operationId:crypto.randomUUID(),
      phone:'+15555559873',state:'SC'},'a');
    assert.ok(rejected.status>=400);
    const allowed=await f.request('field-sales','POST',{...createPayload,action:'create',operationId:crypto.randomUUID(),
      phone:'+15555559874'},'a');
    const body=await allowed.json();
    assert.equal(body.ok,true,JSON.stringify(body));
    const lead=(await f.db.query('select project_state,attribution from commercial_leads where lead_id=$1',[body.leadId])).rows[0];
    assert.equal(lead.project_state,'NC');assert.equal(lead.attribution.salesChannel,'door_to_door');
  });
  await t.test('real NC customer API uses the reviewed source, prior retrieval, retained documents and exact retries',async()=>{
    const lead=await command(f,'create',{...createPayload,phone:'+15555559876'});
    const record=await protocolRecord(f,{nc:true,leadId:lead.leadId});
    const facts=await rpc(f,'field_sales_customer_signature_context',['text'],[record.hash]);
    const decorated=agreementModule(f).withCustomerDocuments(facts);
    const body={operationId:crypto.randomUUID(),name:'Synthetic NC Signer',email:'nc-signature@example.invalid',
      quoteHash:decorated.quote.quote_hash,policyVersion:decorated.agreement.policy_snapshot.version,
      accepted:true,electronicDelivery:true,agreementAccepted:true,cancellationNoticeReceived:true,
      electronicRecordsConsent:true,signatureIntent:true,
      signatureIntentText:'I intend to electronically sign this exact Home2Smart service agreement.',
      reviewedBundleHash:decorated.workflow.reviewedBundleHash,reviewDate:decorated.workflow.reviewDate,
      accessCode:decorated.workflow.reviewedBundleHash.slice(0,8).toUpperCase()};
    const first=await f.request('field-sales-agreement','POST',body,record.token);
    assert.equal(first.status,409);
    assert.equal((await f.db.query('select count(*)::int n from field_sales_workflow_delivery where quote_id=$1',[record.quoteId])).rows[0].n,0);
    const served=await f.request('field-sales-agreement','GET',null,record.token),servedFacts=await served.json();
    assert.equal(served.status,200,servedFacts.error);assert.equal(servedFacts.workflow.reviewDocuments.length,4);
    const response=await f.request('field-sales-agreement','POST',body,record.token),signed=await response.json();
    assert.equal(response.status,200,signed.error);
    assert.equal(signed.agreement.acceptance.protocol,'h2s-customer-service-nc-v1');
    assert.deepEqual(signed.agreement.acceptance.acceptedDocuments.map(d=>d.contentHash),
      servedFacts.workflow.reviewDocuments.map(d=>d.contentHash));
    const deadline=(await f.db.query('select cancellation_deadline from field_sales_workflows where quote_id=$1',[record.quoteId])).rows[0].cancellation_deadline;
    assert.equal(new Date(deadline).getTime(),new Date(servedFacts.workflow.cancellationPreviewDeadline).getTime());
    const retry=await f.request('field-sales-agreement','POST',body,record.token),retried=await retry.json();
    assert.equal(retry.status,200,retried.error);
    assert.deepEqual(retried.agreement.acceptance,signed.agreement.acceptance);
    assert.deepEqual(retried.workflow.acceptedDocuments,signed.workflow.acceptedDocuments);
  });
  await t.test('RPC argument names are PostgREST compatible and legacy internals are not exposed',async()=>{
    const args={
      field_sales_access:['p_actor'],
      field_sales_command:['p_actor','p_operation','p_action','p_payload'],
      field_sales_read:['p_actor','p_lead_id'],
      field_sales_transaction_command:['p_actor','p_operation','p_lead','p_action','p_payload'],
      field_sales_workflow_command:['p_actor','p_operation','p_lead','p_quote','p_revision','p_action','p_payload'],
      field_sales_customer_agreement:['p_token_hash','p_accept'],
      field_sales_customer_signature_context:['p_token_hash'],
      field_sales_reserve_checkout:['p_actor','p_operation','p_lead','p_quote','p_kind']
    };
    for(const [name,names] of Object.entries(args)){
      const actual=(await f.db.query(`select proargnames from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname=$1 and p.proname=$2`,[schema,name])).rows[0].proargnames;
      assert.deepEqual(actual,names);
      for(const r of ['service_role','anon','authenticated'])
        assert.equal((await f.db.query('select has_function_privilege($1,$2,\'EXECUTE\') ok',[r,name+'('+names.map(n=>
          n==='p_payload'||n==='p_accept'?'jsonb':n==='p_revision'?'integer':n==='p_action'||n==='p_token_hash'||n==='p_kind'?'text':'uuid').join(',')+')'])).rows[0].ok,r==='service_role');
    }
    const internals=(await f.db.query(`select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname=$1 and (p.proname like 'field_sales_nc_%' or p.proname like '%pre_nc'
        or p.proname like 'field_sales_signature_%' or p.proname='field_sales_customer_agreement_legacy')`,[schema])).rows;
    for(const fn of internals)assert.equal((await f.db.query("select has_function_privilege('service_role',$1,'EXECUTE') ok",[fn.signature])).rows[0].ok,false,fn.signature);
  });
});
