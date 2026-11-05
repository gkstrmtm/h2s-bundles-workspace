const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createWorkflowFixture,id}=require('./helpers/field_workflow_fixture.cjs');
const json=response=>response.json();
async function assigned(f,record){
  record=await f.accept(await f.documents(record));await f.collect(record);
  let w=(await json(await f.read(record.leadId))).workflows[0];
  let result=await json(await f.admin({action:'schedule',leadId:record.leadId,quoteId:record.quoteId,revision:w.revision,reservationRevision:0,
    start:'2099-03-03T15:00:00Z',end:'2099-03-03T17:00:00Z',timezone:'America/New_York',customerAgreed:true,reason:'Synthetic agreed installation'}));
  assert.equal(result.ok,true,result.error);
  w=(await json(await f.read(record.leadId))).workflows[0];
  result=await json(await f.admin({action:'preparation',leadId:record.leadId,quoteId:record.quoteId,revision:w.revision,
    preparationRevision:0,scopeReviewed:true,materials:'ready',access:'ready',blockers:'',note:'Synthetic preparation'}));
  assert.equal(result.ok,true,result.error);
  w=(await json(await f.read(record.leadId))).workflows[0];
  result=await json(await f.admin({action:'assign',leadId:record.leadId,quoteId:record.quoteId,revision:w.revision,
    proId:id(500),context:w.assignmentPreview.job.context,note:'Synthetic technician offer'}));
  assert.equal(result.ok,true,result.error);
  await f.db.query('select h2s_management_respond_to_offer($1,$2,$3)',[w.jobId,id(500),'accept']);
  return {...record,jobId:w.jobId};
}
test('pinned per-service proof requirements use real artifacts, affirmative checks, atomic revisions and immutable completion',async t=>{
  const f=await createWorkflowFixture();t.after(()=>f.db.close());
  assert.equal(f.engine.FIELD_COMPLETION_PROOF_MAX_BYTES,4456448);
  const tv=[
    {id:'finished',label:'Finished installation views',type:'photo',minimumCount:2},
    {id:'rear',label:'Rear connection view',type:'photo',minimumCount:1},
    {id:'signoff',label:'Customer sign-off pages',type:'signature',minimumCount:2},
    {id:'tested',label:'Operation tested onsite',type:'checklist',minimumCount:1}
  ],camera=[{id:'finished',label:'Camera installation view',type:'photo',minimumCount:1}];
  f.definition.services[0].completionRequirements=tv;
  f.definition.services[1]={...structuredClone(f.definition.services[0]),id:'cameras_owned',label:'Synthetic camera installation',completionRequirements:camera};
  await f.enable();
  const lead=await json(await f.request('field-sales','POST',{action:'create',operationId:crypto.randomUUID(),
    fullName:'Synthetic combined customer',phone:'+15551112223',address:'300 Fixture Lane',city:'Fixture City',
    market:'residential',services:['tv_mounting','cameras_owned'],notes:'',followUpAt:null},'a'));
  assert.equal(lead.ok,true,lead.error);
  const leadId=lead.leadId,quoteId=await f.submit(leadId,await f.quote(leadId,[...f.lines(),{...f.lines()[0],serviceId:'cameras_owned'}]));
  const quote=(await f.db.query('select * from field_sales_quotes where quote_id=$1',[quoteId])).rows[0];
  assert.deepEqual(quote.snapshot.lines[0].completionRequirements,tv);
  assert.deepEqual(quote.snapshot.lines[1].completionRequirements,camera);
  const enrolled=await json(await f.admin({action:'enroll',leadId,quoteId,revision:0,representativeId:id(20),
    legalPolicyId:f.policyIds.legal,commissionPolicyId:f.policyIds.commission,settlementPolicyId:f.policyIds.settlement,
    creditEvidence:{reference:'Synthetic approved representative'}}));assert.equal(enrolled.ok,true,enrolled.error);
  const record=await assigned(f,{leadId,quoteId}),jobId=record.jobId;
  const photos=await f.uploadProof(jobId,['photo','photo','photo','photo','photo']),signatures=await f.uploadProof(jobId,['signature','signature']);
  let pro=(await json(await f.proRead(jobId))).workflow;
  assert.equal(pro.proof.photoCount,5);assert.equal(pro.proof.signatureCount,2);
  assert.equal(pro.proof.complete,false);assert.equal(pro.canComplete,false);assert.equal(pro.proof.requirements.length,5);
  assert.equal(pro.proof.requirements[0].missingCount,2);
  assert.ok(pro.proof.candidates.every(a=>Object.keys(a).sort().join(',')==='artifactId,createdAt,type'));
  const zero=[{category:'equipment',quantity:0,unitCents:0,amountCents:0,actual:true,zeroCostAttestation:'Customer-owned actual equipment',
    evidence:{reference:'Actual customer-owned equipment'}},{category:'materials',quantity:0,unitCents:0,amountCents:0,actual:true,
    zeroCostAttestation:'No materials consumed',evidence:{reference:'Actual no materials consumed'}}];
  const completion=()=>({job_id:jobId,operationId:crypto.randomUUID(),workflowRevision:pro.revision,expenses:zero,hours:1,
    evidence:{reference:'Synthetic technician completion'}});
  assert.equal((await f.complete(completion())).status,400);
  assert.equal((await f.portalComplete(completion())).status,400);
  const hash=pro.proof.requirementsHash;
  const weaker=structuredClone(f.definition);weaker.services.forEach(service=>{service.completionRequirements=[];});
  await f.db.query("update field_sales_catalogs set status='retired' where catalog_id=$1",[f.catalogId]);
  await f.db.query(`insert into field_sales_catalogs(catalog_id,version,definition,source_evidence,status,approved_by,published_at)
    values($1,'synthetic-weaker-v2',$2,'{"approvalEvidence":"Synthetic approved weaker future version"}','published',$3,now())`,
    [id(950),JSON.stringify(weaker),id(9)]);
  pro=(await json(await f.proRead(jobId))).workflow;
  assert.equal(pro.proof.requirementsHash,hash);assert.equal(pro.proof.requirements[0].minimumCount,2);
  await assert.rejects(f.db.query("update field_sales_quotes set snapshot=jsonb_set(snapshot,'{lines,0,completionRequirements}','[]') where quote_id=$1",[quoteId]),/Immutable/);
  const binding=(serviceId,requirementId,artifactIds)=>({serviceId,requirementId,artifactIds});
  const bindings=[
    binding('tv_mounting','finished',photos.slice(0,2).map(a=>a.artifact_id)),
    binding('tv_mounting','rear',[photos[2].artifact_id]),
    binding('tv_mounting','signoff',signatures.map(a=>a.artifact_id)),
    binding('cameras_owned','finished',[photos[3].artifact_id])
  ],checklists=[{serviceId:'tv_mounting',requirementId:'tested',affirmed:true,evidence:{reference:'Actual onsite operation verified'}}];
  const save=(changes={},actor='pro')=>f.complete({job_id:jobId,operationId:crypto.randomUUID(),workflowRevision:pro.revision,
    action:'proof_record',bindings,checklists,...changes},actor);
  const maximumServicePayload=Array.from({length:100},(_,index)=>binding('tv_mounting','rule_'+index,
    Array.from({length:100},()=>crypto.randomUUID())));
  assert.ok(Buffer.byteLength(JSON.stringify(maximumServicePayload))>32768);
  // The large request reaches SQL authority and rejects unknown requirements, rather than failing body admission.
  assert.equal((await save({bindings:maximumServicePayload,checklists:[]})).status,400);
  assert.equal((await save({checklists:[{...checklists[0],evidence:{reference:'x'.repeat(f.engine.FIELD_COMPLETION_PROOF_MAX_BYTES)}}]})).status,413);
  assert.equal((await save({},'other')).status,403);
  assert.equal((await save({bindings:[binding('tv_mounting','unknown',[])]})).status,400);
  assert.equal((await save({bindings:[binding('tv_mounting','finished',[signatures[0].artifact_id])]})).status,400);
  assert.equal((await save({bindings:[binding('tv_mounting','finished',[photos[0].artifact_id,photos[0].artifact_id])]})).status,400);
  assert.equal((await save({bindings:[bindings[0],binding('cameras_owned','finished',[photos[0].artifact_id])]})).status,400);
  await assert.rejects(f.uploadProof(jobId,['photo'],'other'),/Forbidden/);
  const wrongJob=(await f.uploadProof(id(101),['photo']))[0].artifact_id;
  const wrongPro=crypto.randomUUID(),preAcceptance=crypto.randomUUID();
  await f.db.query(`insert into h2s_dispatch_job_artifacts(artifact_id,job_id,pro_id,type,url,created_at)
    values($1,$2,$3,'photo','https://fixture.invalid/old-other-pro',now()),
      ($4,$2,$5,'photo','https://fixture.invalid/before-acceptance',now()-interval '1 day')`,
    [wrongPro,jobId,id(502),preAcceptance,id(500)]);
  for(const artifactId of [wrongJob,wrongPro,preAcceptance]){
    assert.equal((await save({bindings:[binding('tv_mounting','finished',[artifactId])]})).status,400);
  }
  for(const evidence of [{}, {reference:''}, {note:'No affirmative reference'}]){
    assert.equal((await save({checklists:[{...checklists[0],evidence}]})).status,400);
  }
  assert.equal((await save({checklists:[{...checklists[0],affirmed:false}]})).status,400);
  assert.equal((await save({checklists:[{...checklists[0],unexpected:true}]})).status,400);
  const partial=await json(await save({bindings:[binding('tv_mounting','finished',[photos[0].artifact_id])],checklists:[]}));
  assert.equal(partial.ok,true,partial.error);
  pro=(await json(await f.proRead(jobId))).workflow;
  assert.equal(pro.proof.requirements[0].missingCount,1);assert.equal(pro.canComplete,false);
  assert.equal((await f.complete(completion())).status,400);
  const operationId=crypto.randomUUID(),body={job_id:jobId,operationId,workflowRevision:pro.revision,action:'proof_record',bindings,checklists};
  const responses=await Promise.all([f.complete(body),f.complete(body)]);
  const saved=await json(responses[0]),retry=await json(responses[1]);
  assert.equal(saved.ok,true,saved.error);assert.equal(saved.proofRecorded,true);assert.equal(retry.replayed,true);
  assert.equal((await f.complete({...body,checklists:[]})).status,409);
  await f.db.exec('begin');
  await assert.rejects(f.db.query(`insert into field_sales_workflow_proof_bindings(quote_id,service_id,requirement_id,artifact_id,recorded_by)
    values($1,'cameras_owned','finished',$2,$3)`,[quoteId,photos[0].artifact_id,id(500)]),error=>error.code==='23505');
  await f.db.exec('rollback');
  pro=(await json(await f.proRead(jobId))).workflow;
  assert.equal(pro.proof.complete,true);assert.equal(pro.canComplete,true);
  const sales=(await json(await f.read(leadId,'a'))).workflows[0];
  assert.equal(sales.proof.candidates,undefined);assert.equal(sales.proof.artifacts,undefined);
  assert.ok(sales.proof.requirements.every(r=>r.evidence===undefined));
  await f.db.query('delete from h2s_dispatch_job_artifacts where artifact_id=$1',[photos[2].artifact_id]);
  pro=(await json(await f.proRead(jobId))).workflow;
  assert.equal(pro.proof.requirements.find(r=>r.id==='rear').missingCount,1);assert.equal(pro.canComplete,false);
  assert.equal((await f.complete(completion())).status,400);
  bindings[1]=binding('tv_mounting','rear',[photos[4].artifact_id]);
  assert.equal((await save()).status,200);
  pro=(await json(await f.proRead(jobId))).workflow;
  const completed=await json(await f.complete(completion()));assert.equal(completed.ok,true,completed.error);
  const snapshot=(await f.db.query('select completion_proof from field_sales_workflows where quote_id=$1',[quoteId])).rows[0].completion_proof;
  assert.equal(snapshot.requirementsHash,hash);assert.ok(snapshot.requirements.every(r=>r.complete));
  assert.equal(snapshot.requirements.find(r=>r.type==='checklist').evidence.reference,checklists[0].evidence.reference);
  for(const artifactId of bindings.flatMap(b=>b.artifactIds)){
    await assert.rejects(f.db.query('delete from h2s_dispatch_job_artifacts where artifact_id=$1',[artifactId]),/immutable/);
    await assert.rejects(f.db.query("update h2s_dispatch_job_artifacts set type='other' where artifact_id=$1",[artifactId]),/immutable/);
  }
  await assert.rejects(f.db.query('delete from field_sales_workflow_proof_bindings where quote_id=$1',[quoteId]),/immutable/);
  await assert.rejects(f.db.query('delete from field_sales_workflow_proof_checks where quote_id=$1',[quoteId]),/immutable/);
  assert.equal((await f.complete({...body,operationId:crypto.randomUUID(),workflowRevision:completed.revision})).status,409);
  const facts=(await f.db.query('select field_sales_workflow_order_facts($1) f',[quoteId])).rows[0].f;
  assert.equal(facts.netPaidCents,5000);assert.ok(facts.completedAt);
});
test('workflow fixture preserves private assessment photo storage, permissions, retries and RPC adapters',async t=>{
  const f=await createWorkflowFixture();t.after(()=>f.db.close());await f.enable();
  const leadId=await f.lead(),read=await json(await f.request('field-sales','GET',null,'a','?leadId='+leadId));
  assert.equal(read.ok,true,read.error);
  const saved=await json(await f.request('field-sales','POST',{action:'save',operationId:crypto.randomUUID(),leadId,
    revision:read.opportunity.revision,services:['tv_mounting'],answers:{},submit:false,photoConsent:true,
    consentNote:'Synthetic permission for assessment photos',notes:'',followUpAt:null},'a'));
  assert.equal(saved.ok,true,saved.error);
  const data='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/psAAAAASUVORK5CYII=';
  const body={operationId:crypto.randomUUID(),leadId,serviceId:'tv_mounting',label:'Mounting surface',filename:'assessment.png',data};
  const uploaded=await json(await f.request('field-sales-photos','POST',body,'a'));assert.equal(uploaded.ok,true,uploaded.error);
  assert.equal((await f.request('field-sales-photos','POST',body,'a')).status,200);
  const response=await f.request('field-sales-photos','GET',null,'a','?leadId='+leadId+'&photoId='+uploaded.fileId);
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(data.split(',')[1],'base64'));
  assert.equal(f.objects.size,1);
  assert.equal((await f.request('field-sales-photos','GET',null,'b','?leadId='+leadId+'&photoId='+uploaded.fileId)).status,404);
  f.businessFaults.publicBucket=true;
  assert.equal((await f.request('field-sales-photos','GET',null,'a','?leadId='+leadId+'&photoId='+uploaded.fileId)).status,503);
  f.businessFaults.publicBucket=false;
  assert.equal((await f.request('field-sales-earnings','GET',null,'a')).status,200);
  assert.equal((await f.proRead(id(101))).status,200);
});
