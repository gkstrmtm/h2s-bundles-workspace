'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {evaluate}=require('./helpers/commercial_operations_fixture.cjs');
const {createWorkflowFixture,id}=require('./helpers/field_workflow_fixture.cjs');
const {retargetSql}=require('../tools/staging-sql-namespace.cjs');
const migration=name=>fs.readFileSync(path.join(__dirname,'..','migrations',name),'utf8').replaceAll('\r','');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const quoted=value=>'"'+value.replaceAll('"','""')+'"';
const runId='e58bc631-2cc4-45f4-b523-c33af024e3d2',schema='h2s_test_'+runId.replaceAll('-',''),role=schema+'_owner',storageSchema=schema+'_storage';
const target={schema,storageSchema};
const identity={marker:'home2smart-native-test-run-v1',runId,schema,storageSchema,role,sourceCommit:'a'.repeat(40),nativeBaselineFingerprint:'b'.repeat(64)};
const intent='I intend to electronically sign this exact Home2Smart service agreement.';
const rpc=async(f,name,casts,args)=>(await f.db.query(`select ${name}(${casts.map((c,i)=>'$'+(i+1)+'::'+c).join(',')}) result`,
  args.map(v=>v&&typeof v==='object'?JSON.stringify(v):v))).rows[0].result;
const read=(f,record,input=null)=>rpc(f,'field_sales_customer_agreement',['text','jsonb'],[record.hash,input]);
const context=(f,record)=>rpc(f,'field_sales_customer_signature_context',['text'],[record.hash]);
const legacyRead=(f,record,input)=>rpc(f,'field_sales_customer_agreement_legacy',['text','jsonb'],[record.hash,input]);
const reserve=(f,record,kind='deposit')=>rpc(f,'field_sales_reserve_checkout',['uuid','uuid','uuid','uuid','text'],
  [id(20),crypto.randomUUID(),record.leadId,record.quoteId,kind]);
async function prepare(f,record){
  const token=crypto.randomBytes(32).toString('hex'),hash=sha(token);
  await rpc(f,'field_sales_transaction_command',['uuid','uuid','uuid','text','jsonb'],
    [id(20),crypto.randomUUID(),record.leadId,'agreement',{quoteId:record.quoteId,tokenHash:hash}]);
  return {...record,hash,token};
}
async function legacyRecord(f){
  const record=await f.documents(await f.enrolled());
  return {...record,hash:(await f.db.query('select token_hash from field_sales_agreements where quote_id=$1',[record.quoteId])).rows[0].token_hash};
}
async function legacyInput(f,record){
  const facts=await read(f,record);
  return {operationId:crypto.randomUUID(),name:'Synthetic Legacy',email:'legacy@example.invalid',accepted:true,electronicDelivery:true,
    quoteHash:facts.quote.quote_hash,policyVersion:facts.agreement.policy_snapshot.version};
}
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
async function protocolRecord(f,{publish=true,calendarOverrides={},saleOverrides={}}={}){
  const policyId=crypto.randomUUID(),agreementPolicyId=crypto.randomUUID();
  const leadId=await f.lead(),quoteId=await f.submit(leadId,await f.quote(leadId)),record={leadId,quoteId};
  const snapshot=(await f.db.query('select snapshot from field_sales_quotes where quote_id=$1',[quoteId])).rows[0].snapshot;
  const documents=evaluate('lib\\fieldAgreement.ts',{'node:crypto':crypto,'@/lib/commercial_business':f.business,
    '@/lib/customerAgreement.v1.json':require('../lib/customerAgreement.v1.json')});
  const prepared=documents.prepareAgreementArtifacts(snapshot,{name:'Synthetic Home2Smart',
    mailingAddress:'100 Test Street, SC 29000',phone:'555-0100'},
    {language:'en',oralNoticeEvidence:'Synthetic seller personally explained covered cancellation rights'});
  Object.assign(prepared.find(d=>d.kind==='agreement').content.sale,saleOverrides);
  await f.db.query(`insert into field_sales_agreement_policies(policy_id,version,status,terms,cancellation_information,
    electronic_delivery,payment_terms,approval_evidence,approved_by,approved_at,customer_document)
    select $1,$2,'approved',terms,cancellation_information,electronic_delivery,payment_terms,approval_evidence,
      approved_by,approved_at,$3 from field_sales_agreement_policies where policy_id=$4`,
    [agreementPolicyId,'synthetic-signature-'+agreementPolicyId,prepared.find(d=>d.kind==='agreement').content,id(811)]);
  const holidays=(await f.db.query(`select distinct h::text as holiday_date from generate_series(extract(year from now())::int-1,
    extract(year from now())::int+2) y cross join lateral field_sales_signature_holidays(y) h order by holiday_date`)).rows.map(r=>r.holiday_date);
  const definition={...f.legalDefinition,agreementPolicyId,requiredNotices:prepared.filter(d=>d.kind==='notice').map(({label,content})=>({label,content})),
    cancellationCalendar:{timezone:'America/New_York',businessDays:3,deadlineLocalTime:'23:59',startEvent:'acceptance',
      excludedWeekdays:[7],holidays,...calendarOverrides}};
  // Test-only approved configuration; never changes a live database or prior signed evidence.
  await f.db.query(`insert into field_sales_workflow_policies(policy_id,kind,status,definition,approved_by,approved_at,approval_evidence)
    values($1,'legal','approved',$2,$3,now(),'{"reference":"isolated signature SQL fixture"}')`,[policyId,definition,id(9)]);
  await rpc(f,'field_sales_workflow_command',['uuid','uuid','uuid','uuid','integer','text','jsonb'],
    [id(9),crypto.randomUUID(),leadId,quoteId,0,'enroll',{legal_policy_id:policyId,
      commission_policy_id:f.policyIds.commission,settlement_policy_id:f.policyIds.settlement,
      representative_id:id(20),credit_evidence:{reference:'Synthetic protocol SQL enrollment'}}]);
  await f.db.query(`update field_sales_transaction_settings set agreement_policy_id=$1::uuid,
    deposit_policy=jsonb_set(deposit_policy,'{agreementPolicyId}',to_jsonb(($1::uuid)::text))`,[agreementPolicyId]);
  const workflow=await rpc(f,'field_sales_workflow_read',['uuid','uuid','uuid'],[id(9),leadId,quoteId]);
  const artifacts=workflow.workflows[0].requiredArtifacts;
  if(publish){
    await rpc(f,'field_sales_workflow_command',['uuid','uuid','uuid','uuid','integer','text','jsonb'],
      [id(9),crypto.randomUUID(),record.leadId,record.quoteId,1,'documents_publish',
        {artifacts,evidence:{reference:'Reviewed isolated signature templates'}}]);
    return {...await prepare(f,record),policyId,artifacts};
  }
  return {...record,policyId,artifacts};
}
function payload(facts){
  const originals=facts.workflow.documents.filter(d=>d.kind!=='quote');
  const documents=originals.map(d=>{
    const content=d.content.customer_document||d.content;
    return {kind:d.kind==='agreement'?'agreement':content.version==='electronic-records-v1'?'electronic_consent':'notice',
      version:content.version,label:d.label,html:`<html><body><h1>${d.label}</h1><p>${content.text}</p><p>${facts.workflow.reviewDate}</p><p>${facts.workflow.cancellationPreviewDeadline}</p></body></html>`};
  });
  for(const d of documents)d.contentHash=sha(d.html);
  const bundle=sha(documents.map(d=>d.contentHash).join('|')+'|'+facts.quote.quote_hash+'|'+facts.workflow.reviewDate);
  return {operationId:crypto.randomUUID(),name:'李 小龍',email:'synthetic@example.invalid',quoteHash:facts.quote.quote_hash,
    policyVersion:facts.agreement.policy_snapshot.version,accepted:true,electronicDelivery:true,acceptanceMethod:'typed_name',
    agreementAccepted:true,cancellationNoticeReceived:true,electronicRecordsConsent:true,signatureIntent:true,signatureIntentText:intent,
    reviewedBundleHash:bundle,reviewDate:facts.workflow.reviewDate,accessCode:bundle.slice(0,8).toUpperCase(),
    acknowledgments:['agreement','cancellation_notice','electronic_records','signature_intent'].map(kind=>({kind,affirmed:true})),
    requestMetadata:{userAgent:'synthetic SQL fixture',origin:'https://fixture.invalid',authenticatedCustomerLink:true},acceptedDocuments:documents,
    artifactHashes:facts.workflow.originalArtifactHashes};
}
async function rollback(f,fn){
  await f.db.exec('begin');
  try{return await fn();}finally{await f.db.exec('rollback');}
}

test('native signature SQL: protocol admission, immutable exact evidence, idempotency, retained copies and unchanged money gates',
  {timeout:180000},async t=>{
    const f=await createWorkflowFixture();t.after(()=>f.db.close());await f.enable();
    const grandfather=await legacyRecord(f),oldInput=await legacyInput(f,grandfather);
    await read(f,grandfather,oldInput);
    const legacyBefore=(await f.db.query('select accepted_at,acceptance from field_sales_agreements where quote_id=$1',[grandfather.quoteId])).rows[0];
    const unsignedLegacy=await legacyRecord(f),unsignedInput=await legacyInput(f,unsignedLegacy);
    await assert.rejects(f.db.exec(migration('056_field_sales_customer_signature.sql')),e=>e.code==='42501');
    await f.db.exec('rollback');
    await native(f);
    await f.db.exec(retargetSql(migration('056_field_sales_customer_signature.sql'),target));
    const originalRpc=f.client.rpc.bind(f.client);
    f.client.rpc=async(name,args)=>{
      if(name!=='field_sales_customer_signature_context')return originalRpc(name,args);
      try{return {data:await rpc(f,name,['text'],Object.values(args)),error:null};}
      catch(error){return {data:null,error:{message:error.message,code:error.code}};}
    };
    await t.test('only intended service RPCs are callable; historical acceptance wrappers are not exposed',async()=>{
      for(const name of ['field_sales_customer_signature_context(text)','field_sales_customer_agreement(text,jsonb)'])
        for(const roleName of ['service_role','anon','authenticated']){
          const allowed=(await f.db.query('select has_function_privilege($1,$2,\'EXECUTE\') ok',[roleName,name])).rows[0].ok;
          assert.equal(allowed,roleName==='service_role',roleName+' '+name);
        }
      for(const name of ['field_sales_customer_agreement_legacy(text,jsonb)','field_sales_customer_agreement_pre_signature(text,jsonb)',
        'field_sales_signature_normalize(uuid,jsonb)'])
        assert.equal((await f.db.query("select has_function_privilege('service_role',$1,'EXECUTE') ok",[name])).rows[0].ok,false,name);
    });
    await t.test('existing accepted legacy is untouched/readable; every new legacy acceptance/deposit is blocked',async()=>{
      assert.deepEqual((await f.db.query('select accepted_at,acceptance from field_sales_agreements where quote_id=$1',[grandfather.quoteId])).rows[0],legacyBefore);
      assert.equal((await read(f,grandfather)).agreement.acceptance.name,oldInput.name);
      await assert.rejects(read(f,unsignedLegacy,unsignedInput),e=>e.code==='55000');
      await assert.rejects(legacyRead(f,unsignedLegacy,unsignedInput),e=>e.code==='55000');
      await assert.rejects(reserve(f,unsignedLegacy),e=>['55000','40001'].includes(e.code));
      await assert.rejects(f.db.query('update field_sales_agreements set accepted_at=now(),acceptance=$1 where quote_id=$2',
        [unsignedInput,unsignedLegacy.quoteId]),e=>e.code==='42501');
      await assert.rejects(f.db.query(`insert into field_sales_agreements
        select agreement_id,quote_id,lead_id,quote_hash,policy_id,policy_snapshot,token_hash,expires_at,
          prepared_by,created_at,now(),$1 from field_sales_agreements where quote_id=$2`,[unsignedInput,unsignedLegacy.quoteId]),e=>e.code==='42501');
      assert.equal((await f.db.query('select accepted_at from field_sales_agreements where quote_id=$1',[unsignedLegacy.quoteId])).rows[0].accepted_at,null);
    });
    const record=await protocolRecord(f);
    await t.test('publisher still requires the exact pinned approved service template',async()=>{
      const unpublished=await protocolRecord(f,{publish:false}),bad=structuredClone(unpublished.artifacts);
      bad.find(d=>d.kind==='agreement').content.customer_document.seller.name='Unapproved substituted seller';
      await assert.rejects(rpc(f,'field_sales_workflow_command',['uuid','uuid','uuid','uuid','integer','text','jsonb'],
        [id(9),crypto.randomUUID(),unpublished.leadId,unpublished.quoteId,1,'documents_publish',
          {artifacts:bad,evidence:{reference:'Must not publish substituted template'}}]),e=>e.code==='22023');
      assert.equal((await f.db.query('select count(*)::int n from field_sales_workflow_artifacts where quote_id=$1',[unpublished.quoteId])).rows[0].n,0);
    });
    await t.test('new protocol refuses zero-day, wrong timezone and incomplete current/following-year FTC holiday calendars',async()=>{
      const year=new Date().getUTCFullYear();
      const currentOnly=(await f.db.query('select field_sales_signature_holidays($1)::text as holiday_date',[year])).rows.map(r=>r.holiday_date);
      for(const calendarOverrides of [{businessDays:0},{timezone:'UTC'},{holidays:[]},{holidays:currentOnly}]){
        const bad=await protocolRecord(f,{publish:false,calendarOverrides});
        await assert.rejects(rpc(f,'field_sales_workflow_command',['uuid','uuid','uuid','uuid','integer','text','jsonb'],
          [id(9),crypto.randomUUID(),bad.leadId,bad.quoteId,1,'documents_publish',
            {artifacts:bad.artifacts,evidence:{reference:'Invalid legal calendar must stay blocked'}}]),e=>e.code==='55000');
        assert.equal((await f.db.query('select count(*)::int n from field_sales_workflow_artifacts where quote_id=$1',[bad.quoteId])).rows[0].n,0);
      }
    });
    await t.test('new signature publication requires reviewed English presentation, affirmative covered eligibility and oral notice evidence',async()=>{
      for(const saleOverrides of [{oralPresentationLanguage:'fr'},{cancellationEligibility:'waived'},{oralNoticeEvidence:''},
        {oralNoticeEvidence:null}]){
        const bad=await protocolRecord(f,{publish:false,saleOverrides});
        await assert.rejects(rpc(f,'field_sales_workflow_command',['uuid','uuid','uuid','uuid','integer','text','jsonb'],
          [id(9),crypto.randomUUID(),bad.leadId,bad.quoteId,1,'documents_publish',
            {artifacts:bad.artifacts,evidence:{reference:'Unreviewed presentation must remain blocked'}}]),e=>e.code==='55000');
        assert.equal((await f.db.query('select count(*)::int n from field_sales_workflow_artifacts where quote_id=$1',[bad.quoteId])).rows[0].n,0);
      }
    });
    await t.test('prior retrieval is actual SQL evidence, not supplied browser flags',async()=>{
      const trusted=await context(f,record);
      await assert.rejects(read(f,record,payload(trusted)),e=>e.code==='55000');
      assert.equal(trusted.workflow.documents.length,5);
      assert.equal((await f.db.query('select count(*)::int n from field_sales_workflow_delivery where quote_id=$1',[record.quoteId])).rows[0].n,0);
    });
    const facts=await read(f,record),input=payload(facts);
    assert.equal(facts.workflow.originalArtifactHashes.length,5);
    assert.match(facts.workflow.reviewDate,/^\d{4}-\d{2}-\d{2}$/);
    assert.ok(facts.workflow.cancellationPreviewDeadline);
    await t.test('SQL rejects missing/altered signature, exact acknowledgment set, document versions/hashes, review binding and extra JSON',async()=>{
      const mutations=[
        p=>p.name='Single',p=>p.name='\tSingle\t',p=>p.signatureIntent=false,p=>p.signatureIntentText='I agree',
        p=>p.electronicRecordsConsent=false,p=>delete p.agreementAccepted,p=>p.accepted='true',
        p=>p.acknowledgments.pop(),p=>p.acknowledgments[1]=p.acknowledgments[0],
        p=>p.acknowledgments[0].browserTimestamp='2026-01-01',
        p=>p.acceptedDocuments.pop(),p=>p.acceptedDocuments[0].version='wrong-version',
        p=>p.acceptedDocuments[0].html+='<p>Altered</p>',p=>p.acceptedDocuments[0].contentHash='0'.repeat(64),
        p=>p.acceptedDocuments[2].label=p.acceptedDocuments[1].label,
        p=>p.reviewDate='2000-01-01',p=>p.reviewedBundleHash='0'.repeat(64),p=>p.accessCode='00000000',
        p=>p.artifactHashes.reverse(),p=>p.quoteHash='f'.repeat(64),p=>p.policyVersion='unapproved',
        p=>p.signedAt='2000-01-01T00:00:00Z',p=>p.requestMetadata.ip='spoof',p=>p.requestMetadata.userAgent='x'.repeat(301),
        p=>p.requestMetadata.authenticatedCustomerLink=false
      ];
      for(const mutate of mutations)await rollback(f,async()=>{
        const bad=structuredClone(input);mutate(bad);
        await assert.rejects(read(f,record,bad),e=>['22023','55000'].includes(e.code),mutate.toString());
      });
      assert.equal((await f.db.query('select count(*)::int n from field_sales_workflow_artifacts where quote_id=$1',[record.quoteId])).rows[0].n,5);
      await rollback(f,async()=>{
        await f.db.query("update field_sales_workflows set state='cancelled' where quote_id=$1",[record.quoteId]);
        await assert.rejects(read(f,record,input),e=>e.code==='55000');
      });
    });
    let accepted;
    await t.test('server timestamps every acknowledgment and retains hashed final signed HTML in existing immutable artifacts',async()=>{
      accepted=await read(f,record,input);
      const evidence=accepted.agreement.acceptance;
      assert.equal(evidence.protocol,'h2s-customer-service-v1');assert.equal(evidence.signature.name,input.name);
      assert.equal(new Date(evidence.signedAt).getTime(),new Date(accepted.agreement.accepted_at).getTime());
      assert.equal(evidence.acknowledgmentEvents.length,4);
      assert.ok(evidence.acknowledgmentEvents.every(e=>e.affirmed&&e.acknowledgedAt===evidence.signedAt&&e.quoteHash===input.quoteHash));
      assert.equal(accepted.workflow.acceptedDocuments.length,4);assert.equal(accepted.workflow.documents.length,9);
      for(const doc of accepted.workflow.acceptedDocuments){
        assert.equal(sha(doc.content.html),doc.contentHash);assert.equal(sha(doc.content.reviewedHtml),doc.content.reviewedContentHash);
        assert.ok(doc.content.html.includes(input.name));assert.ok(doc.content.html.includes(intent));assert.ok(doc.label.includes(input.operationId));
      }
      const deliveries=(await f.db.query(`select method,artifact_hashes,evidence from field_sales_workflow_delivery
        where quote_id=$1 and evidence->>'atSigning'='true' order by method`,[record.quoteId])).rows;
      assert.equal(deliveries.length,2);assert.ok(deliveries.every(d=>d.artifact_hashes.length===9&&d.evidence.accessCode===input.accessCode));
      const expected=(await f.db.query('select field_sales_workflow_deadline($1,$2::timestamptz) deadline',[record.quoteId,evidence.signedAt])).rows[0].deadline;
      assert.equal(new Date(accepted.workflow.cancellationDeadline).getTime(),new Date(expected).getTime());
    });
    await t.test('exact operation retries ignore only server request metadata and create no replacement records',async()=>{
      const retry=structuredClone(input);retry.requestMetadata={userAgent:'new server request',origin:'https://fixture.invalid',authenticatedCustomerLink:true};
      const again=await read(f,record,retry);assert.deepEqual(again.agreement,accepted.agreement);
      assert.deepEqual(again.workflow.acceptedDocuments,accepted.workflow.acceptedDocuments);
      assert.equal((await legacyRead(f,record,retry)).agreement.acceptance.signedAt,accepted.agreement.acceptance.signedAt);
      for(const field of ['operationId','name','email','reviewDate','reviewedBundleHash','accessCode','quoteHash'])
        await assert.rejects(read(f,record,{...retry,[field]:field==='operationId'?crypto.randomUUID():'altered'}),e=>e.code==='40001');
      await assert.rejects(read(f,record,{...retry,extra:true}),e=>e.code==='40001');
      await rollback(f,async()=>{
        await f.db.query('update field_sales_opportunities set revision=revision+1 where lead_id=$1',[record.leadId]);
        await assert.rejects(read(f,record,retry),e=>e.code==='40001');
      });
      assert.equal((await f.db.query('select count(*)::int n from field_sales_workflow_artifacts where quote_id=$1',[record.quoteId])).rows[0].n,9);
    });
    await t.test('immutable accepted evidence and copies reject updates/deletes, later artifacts cannot replace signed copies',async()=>{
      for(const command of [
        `update field_sales_agreements set acceptance='{}' where quote_id='${record.quoteId}'`,
        `delete from field_sales_agreements where quote_id='${record.quoteId}'`,
        `update field_sales_workflow_artifacts set content='{}' where quote_id='${record.quoteId}'`,
        `delete from field_sales_workflow_artifacts where quote_id='${record.quoteId}'`,
        `delete from field_sales_workflow_delivery where quote_id='${record.quoteId}'`
      ])await rollback(f,()=>assert.rejects(f.db.exec(command),e=>e.code==='42501'));
      await rollback(f,async()=>{
        await f.db.query(`insert into field_sales_workflow_artifacts(quote_id,kind,label,content,content_hash,approved_by,approval_evidence)
          values($1,'agreement','Later unsigned amendment','{}',$2,$3,'{"reference":"isolated later artifact"}')`,[record.quoteId,sha('later'),id(9)]);
        const later=await read(f,record);assert.deepEqual(later.workflow.acceptedDocuments,accepted.workflow.acceptedDocuments);
        assert.equal(later.workflow.documents.length,9);
        assert.equal((await f.db.query(`select artifact_hashes from field_sales_workflow_delivery where quote_id=$1
          order by created_at desc limit 1`,[record.quoteId])).rows[0].artifact_hashes.length,9);
        assert.equal((await f.db.query('select field_sales_workflow_document_gate($1,true) ok',[record.quoteId])).rows[0].ok,true);
      });
    });
    await t.test('finite renewed links return exact accepted documents; no expired or cancelled acceptance',async()=>{
      const hash=sha(crypto.randomUUID());
      await rpc(f,'field_sales_workflow_renew_handoff',['uuid','uuid','uuid','text','integer'],[id(9),crypto.randomUUID(),record.quoteId,hash,60]);
      assert.deepEqual((await read(f,{...record,hash})).workflow.acceptedDocuments,accepted.workflow.acceptedDocuments);
      const retrievals=(await f.db.query('select count(*)::int n from field_sales_workflow_delivery where quote_id=$1',[record.quoteId])).rows[0].n;
      assert.deepEqual((await context(f,{...record,hash})).workflow.acceptedDocuments,accepted.workflow.acceptedDocuments);
      assert.equal((await f.db.query('select count(*)::int n from field_sales_workflow_delivery where quote_id=$1',[record.quoteId])).rows[0].n,retrievals);
      await assert.rejects(context(f,{...record,hash:'a'.repeat(64)}),e=>e.code==='P0002');
      await assert.rejects(read(f,{...record,hash:'a'.repeat(64)}),e=>e.code==='P0002');
      await rollback(f,async()=>{
        await f.db.query("update field_sales_workflows set state='cancelled' where quote_id=$1",[record.quoteId]);
        await assert.rejects(read(f,record,input),e=>e.code==='55000');
      });
    });
    await t.test('deposit remains exactly 25 percent and premature balance/full and signature-free deposits remain blocked',async()=>{
      await assert.rejects(reserve(f,record,'balance'),e=>['22023','55000'].includes(e.code));
      await assert.rejects(reserve(f,record,'full'),e=>['22023','55000'].includes(e.code));
      const pay=await reserve(f,record);assert.equal(pay.kind,'deposit');
      const row=(await f.db.query('select amount_cents from field_sales_checkouts where checkout_id=$1',[pay.checkout_id])).rows[0];
      assert.equal(Number(row.amount_cents),facts.workflow.depositCents);
    });
    await t.test('FTC calendar covers actual/observed federal holidays and Sunday, allows Saturday, preserves signature-time New York deadline',async()=>{
      const days=(await f.db.query('select field_sales_signature_holidays(2027)::text as holiday_date')).rows.map(r=>r.holiday_date);
      for(const date of ['2027-06-19','2027-06-18','2027-07-04','2027-07-05','2027-11-25'])assert.ok(days.includes(date),date);
      const sql='select field_sales_workflow_deadline($1,$2::timestamptz) deadline';
      const thanksgiving=(await f.db.query(sql,[record.quoteId,'2026-11-25T20:00:00Z'])).rows[0].deadline;
      assert.equal(new Date(thanksgiving).toISOString(),'2026-12-01T05:00:00.000Z');
      const juneteenth=(await f.db.query(sql,[record.quoteId,'2027-06-17T20:00:00Z'])).rows[0].deadline;
      assert.equal(new Date(juneteenth).toISOString(),'2027-06-24T04:00:00.000Z');
      const veterans=(await f.db.query(sql,[record.quoteId,'2026-11-08T20:00:00Z'])).rows[0].deadline;
      assert.equal(new Date(veterans).toISOString(),'2026-11-13T05:00:00.000Z');
    });
    await t.test('real customer API constructs trusted reviewed documents, requires genuine GET retrieval, and persists the same native SQL evidence',async()=>{
      const apiRecord=await protocolRecord(f);
      const facts=await context(f,apiRecord);
      const documents=evaluate('lib\\fieldAgreement.ts',{'node:crypto':crypto,'@/lib/commercial_business':f.business,
        '@/lib/customerAgreement.v1.json':require('../lib/customerAgreement.v1.json')});
      const decorated=documents.withCustomerDocuments(facts);
      const body={operationId:crypto.randomUUID(),name:'Synthetic Signer',email:'signature@example.invalid',
        quoteHash:decorated.quote.quote_hash,policyVersion:decorated.agreement.policy_snapshot.version,
        accepted:true,electronicDelivery:true,agreementAccepted:true,cancellationNoticeReceived:true,
        electronicRecordsConsent:true,signatureIntent:true,signatureIntentText:intent,
        reviewedBundleHash:decorated.workflow.reviewedBundleHash,reviewDate:decorated.workflow.reviewDate,
        accessCode:decorated.workflow.reviewedBundleHash.slice(0,8).toUpperCase()};
      const noRetrieval=await f.request('field-sales-agreement','POST',body,apiRecord.token);
      assert.equal(noRetrieval.status,409);
      assert.equal((await f.db.query('select count(*)::int n from field_sales_workflow_delivery where quote_id=$1',[apiRecord.quoteId])).rows[0].n,0);
      const served=await f.request('field-sales-agreement','GET',null,apiRecord.token),servedFacts=await served.json();
      assert.equal(served.status,200,servedFacts.error);assert.equal(servedFacts.workflow.reviewDocuments.length,4);
      const response=await f.request('field-sales-agreement','POST',body,apiRecord.token),signed=await response.json();
      assert.equal(response.status,200,signed.error);
      assert.equal(signed.workflow.acceptedDocuments.length,4);
      assert.deepEqual(signed.agreement.acceptance.acceptedDocuments.map(d=>d.contentHash),
        servedFacts.workflow.reviewDocuments.map(d=>d.contentHash));
      const retry=await f.request('field-sales-agreement','POST',body,apiRecord.token),replayed=await retry.json();
      assert.equal(retry.status,200,replayed.error);
      assert.deepEqual(replayed.workflow.acceptedDocuments,signed.workflow.acceptedDocuments);
      assert.deepEqual(replayed.agreement.acceptance,signed.agreement.acceptance);
    });
  });
