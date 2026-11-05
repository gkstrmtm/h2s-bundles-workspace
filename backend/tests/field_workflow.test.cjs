const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createWorkflowFixture,id}=require('./helpers/field_workflow_fixture.cjs');
const json=async r=>r.json();
test('workflow SQL and authenticated route fail closed, versions and attribution are immutable',async t=>{
  const f=await createWorkflowFixture();t.after(()=>f.db.close());
  assert.equal((await f.read(null,'missing')).status,401);
  assert.equal((await f.read(null,'va')).status,403);
  assert.equal((await f.read()).status,503);
  await f.enable();
  assert.equal((await f.admin({action:'policy_create',policyId:id(999),kind:'legal',definition:{}},'a')).status,403);
  const record=await f.enrolled(),dto=await json(await f.read(record.leadId));assert.equal(dto.workflows.length,1);
  const draftId=id(990),definition=dto.policies.find(p=>p.kind==='settlement').definition;
  const draft=await json(await f.admin({action:'policy_create',policyId:draftId,kind:'settlement',definition}));
  const edit=await json(await f.admin({action:'policy_update',policyId:draftId,expectedDefinitionHash:draft.definitionHash,
    definition:{...definition,cutoff:'14:00'}}));assert.equal(edit.ok,true);assert.notEqual(edit.definitionHash,draft.definitionHash);
  assert.equal((await f.admin({action:'policy_approve',policyId:draftId,expectedDefinitionHash:draft.definitionHash,evidence:{reference:'Stale draft'}})).status,409);
  assert.equal((await f.admin({action:'policy_approve',policyId:draftId,evidence:{reference:'No reviewed version'}})).status,409);
  assert.equal((await f.admin({action:'policy_approve',policyId:draftId,expectedDefinitionHash:edit.definitionHash,
    evidence:{reference:'Reviewed latest synthetic version'}})).status,200);
  assert.equal((await f.read(record.leadId,'b')).status,404);
  assert.equal((await f.admin({action:'policy_update',policyId:f.policyIds.legal,definition:{}})).status,409);
  await assert.rejects(f.db.query('update field_sales_workflows set representative_id=$1 where quote_id=$2',[id(21),record.quoteId]),/Immutable/);
  await assert.rejects(f.db.query('delete from field_sales_workflow_policies where policy_id=$1',[f.policyIds.legal]),/Immutable/);
  const holding=await json(await f.post({action:'agreement',...record}));assert.equal(holding.ok,false);
  assert.equal(dto.workflows[0].gates.canSchedule,false);
  const copy=await f.documents(record),w=(await json(await f.read(record.leadId))).workflows[0];
  await assert.rejects(f.db.query('update field_sales_workflow_artifacts set label=$1 where quote_id=$2',['tampered',record.quoteId]),/Immutable/);
  const body={operationId:crypto.randomUUID(),name:'Customer',email:'synthetic@example.invalid',accepted:true,electronicDelivery:true,
    quoteHash:(await f.db.query('select quote_hash from field_sales_quotes where quote_id=$1',[record.quoteId])).rows[0].quote_hash,policyVersion:'synthetic-legal-v1'};
  assert.equal((await f.request('field-sales-agreement','POST',body,copy.token)).status,503);
  const accepted=await f.accept(copy);assert.ok(accepted.token);
  assert.equal(w.documents.length,3);
  const customer=await json(await f.request('field-sales-agreement','GET',null,copy.token));assert.ok(customer.workflow.cancellationDeadline);
  assert.equal(customer.workflow.gates.canDeposit,true);
  const rpc=f.client.rpc;
  f.client.rpc=async(name,args)=>name==='field_sales_workflow_read'?{data:null,error:{code:'42P01',message:'Missing synthetic workflow schema'}}:rpc(name,args);
  assert.equal((await f.read(record.leadId)).status,503);
  f.client.rpc=rpc;
});
test('exact calendar/assignment/completion chain accepts unpaid balance and preserves current-net receipt locks',async t=>{
  const f=await createWorkflowFixture();t.after(()=>f.db.close());
  f.definition.services[0].offers[0].unitCents=10001;
  await f.enable();
  const record=await f.enrolled();
  let w=(await json(await f.read(record.leadId))).workflows[0];
  assert.equal(w.depositCents,2501);assert.equal(w.agreedBalanceCents,7500);assert.equal(w.balanceCents,10001);
  const accepted=await f.accept(await f.documents(record));
  const full=await f.post({action:'checkout',...record,kind:'full'});assert.equal(full.status,503);
  const deposits=await Promise.all([f.post({action:'checkout',...record,kind:'deposit'}),f.post({action:'checkout',...record,kind:'deposit'})]);
  const payment=await deposits[0].json(),second=await deposits[1].json();assert.equal(payment.ok,true);
  assert.equal(second.checkoutId,payment.checkoutId);assert.equal(f.sessions.size,1);
  const sid=[...f.sessions.keys()][0],paid=f.paid(sid);assert.equal(paid.session.amount_total,2501);
  assert.equal((await f.webhook('checkout.session.completed',paid.session)).status,200);
  assert.equal((await f.post({action:'checkout',...record,kind:'balance'})).status,503);
  w=(await json(await f.read(record.leadId))).workflows[0];assert.equal(w.processingFeeCents,null);
  const schedule={action:'schedule',...record,revision:w.revision,reservationRevision:0,start:'2099-03-03T15:00:00Z',
    end:'2099-03-03T17:00:00Z',timezone:'America/New_York',customerAgreed:true,reason:'Synthetic agreed window'};
  const scheduled=await json(await f.admin(schedule));assert.equal(scheduled.ok,true,scheduled.error);
  assert.equal((await f.admin(schedule)).status,409);
  w=(await json(await f.read(record.leadId))).workflows[0];assert.ok(w.jobId);assert.equal(w.reservation.state,'confirmed');
  const hint=(await f.db.query('select metadata_json from h2s_dispatch_jobs where job_id=$1',[w.jobId])).rows[0].metadata_json.field_sales_workflow;
  assert.equal(hint.enrolled,true);assert.equal(hint.quoteId,record.quoteId);
  const preparation=await json(await f.admin({action:'preparation',...record,revision:w.revision,preparationRevision:0,
    scopeReviewed:true,materials:'ready',access:'ready',blockers:'',note:'Synthetic scope and equipment ready'}));
  assert.equal(preparation.ok,true,preparation.error);
  w=(await json(await f.read(record.leadId))).workflows[0];
  const assigned=await json(await f.admin({action:'assign',...record,revision:w.revision,proId:id(500),
    context:w.assignmentPreview.job.context,note:'Synthetic canonical technician offer'}));assert.equal(assigned.ok,true,assigned.error);
  await f.db.query('select h2s_management_respond_to_offer($1,$2,$3)',[w.jobId,id(500),'accept']);
  assert.equal((await f.proRead(w.jobId,'other')).status,403);
  let pro=await json(await f.proRead(w.jobId));assert.equal(pro.workflow.canComplete,false);
  const completion={job_id:w.jobId,operationId:crypto.randomUUID(),workflowRevision:pro.workflow.revision,
    expenses:[{category:'equipment',quantity:1,unitCents:1500,amountCents:1500,actual:true,evidence:{reference:'Synthetic equipment receipt'}},
      {category:'materials',quantity:0,unitCents:0,amountCents:0,actual:true,zeroCostAttestation:'No consumables used',
        evidence:{reference:'No consumables used'}}],hours:2,evidence:{reference:'Synthetic completion photos'}};
  assert.deepEqual(pro.workflow.proof.missing,['Upload installation photos','Collect customer signature']);
  const exactOrder=(await f.db.query('select order_id from h2s_dispatch_jobs where job_id=$1',[w.jobId])).rows[0].order_id;
  await f.db.query('update h2s_dispatch_jobs set order_id=$1 where job_id=$2',[id(100),w.jobId]);
  assert.equal((await f.proRead(w.jobId)).status,409);
  assert.equal((await f.complete(completion)).status,409);
  await f.db.query('update h2s_dispatch_jobs set order_id=$1 where job_id=$2',[exactOrder,w.jobId]);
  await f.db.exec('alter table h2s_dispatch_job_artifacts rename to unavailable_artifact_authority');
  assert.equal((await f.proRead(w.jobId)).status,503);
  assert.equal((await f.complete(completion)).status,503);
  await f.db.exec('alter table unavailable_artifact_authority rename to h2s_dispatch_job_artifacts');
  await f.db.exec('alter table h2s_dispatch_job_artifacts disable trigger field_sales_workflow_proof_freeze');
  assert.equal((await f.proRead(w.jobId)).status,503);
  assert.equal((await f.complete(completion)).status,503);
  await f.db.exec('alter table h2s_dispatch_job_artifacts enable trigger field_sales_workflow_proof_freeze');
  assert.equal((await f.complete(completion)).status,400);
  assert.equal((await f.portalComplete(completion)).status,400);
  await assert.rejects(f.uploadProof(w.jobId,['photo'],'other'),/Forbidden/);
  await f.db.query(`insert into h2s_dispatch_job_artifacts(job_id,pro_id,type,url,created_at)
    values($1,$2,'photo','https://fixture.invalid/wrong-tech',now()),($1,$2,'signature','https://fixture.invalid/wrong-tech',now()),
    ($3,$4,'photo','https://fixture.invalid/wrong-job',now()),($3,$4,'signature','https://fixture.invalid/wrong-job',now()),
    ($1,$4,'photo','https://fixture.invalid/preaccept',now()-interval '1 day')`,[w.jobId,id(502),id(101),id(500)]);
  assert.equal((await f.complete(completion)).status,400);
  const proof=await f.uploadProof(w.jobId,['signature']);
  pro=await json(await f.proRead(w.jobId));assert.equal(pro.workflow.proof.signatureCount,1);
  assert.equal(pro.workflow.proof.photoCount,0);assert.equal(pro.workflow.canComplete,false);
  assert.equal((await f.complete(completion)).status,400);
  await f.db.query('delete from h2s_dispatch_job_artifacts where artifact_id=$1',[proof[0].artifact_id]);
  const photos=await f.uploadProof(w.jobId,['photo']);
  pro=await json(await f.proRead(w.jobId));assert.equal(pro.workflow.proof.photoCount,1);
  assert.equal(pro.workflow.proof.signatureCount,0);assert.equal(pro.workflow.canComplete,false);
  assert.equal((await f.complete(completion)).status,400);
  const signatures=await f.uploadProof(w.jobId,['signature']);
  pro=await json(await f.proRead(w.jobId));assert.equal(pro.workflow.canComplete,true);
  assert.equal(pro.workflow.proof.complete,true);
  const stored=await json(await f.request('portal_get_artifacts','POST',{token:'pro',job_id:w.jobId},'pro'));
  assert.equal(stored.ok,true);assert.ok(stored.artifacts.some(a=>a.artifact_id===signatures[0].artifact_id));
  assert.equal((await f.complete({...completion,expenses:[]})).status,400);
  assert.equal((await f.complete({...completion,expenses:[completion.expenses[0]]})).status,400);
  assert.equal((await f.complete({...completion,expenses:completion.expenses.map(e=>({...e,actual:false}))})).status,400);
  assert.equal((await f.complete({...completion,expenses:completion.expenses.map(e=>({...e,zeroCostAttestation:undefined}))})).status,400);
  assert.equal((await f.complete({...completion,expenses:[{...completion.expenses[0],quantity:2},completion.expenses[1]]})).status,400);
  await assert.rejects(f.db.query("update h2s_dispatch_jobs set status='done' where job_id=$1",[w.jobId]),/legacy fallback prohibited/);
  f.env.H2S_FIELD_WORKFLOW_ENABLED='false';
  const disabled=await f.portalComplete(completion),disabledBody=await disabled.json();
  assert.equal(disabledBody.ok,false);assert.equal(f.portalEffects.payouts,0);
  f.env.H2S_FIELD_WORKFLOW_ENABLED='true';
  const dispatchBeforeCompletion=f.portalEffects.dispatchResolution;
  const completions=await Promise.all([f.portalComplete(completion),f.complete(completion)]);
  const done=await json(completions[0]);assert.equal(done.ok,true,done.error);assert.equal(done.completed,true);
  const retry=await json(completions[1]);assert.equal(retry.replayed,true);
  assert.equal((await f.db.query("select count(*)::int n from field_sales_workflow_commands where quote_id=$1 and action='complete'",
    [record.quoteId])).rows[0].n,1);
  assert.equal(f.portalEffects.payouts,0);assert.equal(f.portalEffects.dispatchResolution,dispatchBeforeCompletion);
  const changed=await f.complete({...completion,hours:3});assert.equal(changed.status,409);
  const frozenProof=(await f.db.query('select completion_proof from field_sales_workflows where quote_id=$1',[record.quoteId])).rows[0].completion_proof;
  assert.equal(frozenProof.complete,true);assert.equal(frozenProof.leadId,record.leadId);
  assert.equal(frozenProof.artifacts.length,2);assert.equal(frozenProof.photoCount,1);assert.equal(frozenProof.signatureCount,1);
  await assert.rejects(f.db.query('delete from h2s_dispatch_job_artifacts where artifact_id=$1',[photos[0].artifact_id]),/immutable/);
  await assert.rejects(f.db.query("update h2s_dispatch_job_artifacts set url='https://fixture.invalid/changed' where artifact_id=$1",
    [signatures[0].artifact_id]),/immutable/);
  await assert.rejects(f.db.query("update field_sales_workflows set completion_proof='{}' where quote_id=$1",[record.quoteId]),/Immutable/);
  await f.db.query("delete from h2s_dispatch_job_artifacts where job_id=$1",[id(101)]);
  const facts=(await f.db.query('select field_sales_workflow_order_facts($1) facts',[record.quoteId])).rows[0].facts;
  assert.ok(facts.completedAt);assert.equal(facts.netPaidCents,2501);assert.equal(facts.costsComplete,false);assert.deepEqual(facts.expenses,[]);
  assert.equal((await f.db.query('select state from commercial_reservations where lead_id=$1',[record.leadId])).rows[0].state,'completed');
  assert.equal((await f.db.query('select count(*)::int n from field_sales_earning_qualifications where quote_id=$1',[record.quoteId])).rows[0].n,0);
  const balance=await json(await f.request('field-sales-agreement','POST',{action:'checkout',operationId:crypto.randomUUID(),kind:'balance'},accepted.token));
  assert.equal(balance.ok,true,balance.error);
  const balanceSession=[...f.sessions.values()].at(-1);assert.equal(balanceSession.amount_total,7500);
  const final=f.paid(balanceSession.id);assert.equal((await f.webhook('checkout.session.completed',final.session)).status,200);
  assert.equal((await f.db.query('select field_sales_workflow_order_facts($1) f',[record.quoteId])).rows[0].f.netPaidCents,10001);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_earning_qualifications where quote_id=$1',[record.quoteId])).rows[0].n,1);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_earning_entries where quote_id=$1',[record.quoteId])).rows[0].n,0);
  const qualification=(await f.db.query('select qualifies_at from field_sales_earning_qualifications where quote_id=$1',[record.quoteId])).rows[0].qualifies_at;
  paid.charge.balance_transaction={id:'txn_deposit',source:paid.charge.id,amount:2501,fee:31,net:2470,currency:'usd',fee_details:[]};
  final.charge.balance_transaction={id:'txn_balance',source:final.charge.id,amount:7500,fee:103,net:7397,currency:'usd',fee_details:[]};
  await f.post({action:'refresh_payment',leadId:record.leadId,checkoutId:payment.checkoutId});
  await f.post({action:'refresh_payment',leadId:record.leadId,checkoutId:balance.checkoutId});
  assert.equal((await f.db.query('select count(*)::int n from field_sales_earning_entries where quote_id=$1',[record.quoteId])).rows[0].n,0);
  w=(await json(await f.read(record.leadId))).workflows[0];assert.equal(w.technicianExpenses.length,2);
  const review={action:'cost_review',...record,revision:w.revision,expenses:completion.expenses,
    evidence:{reference:'Synthetic manager reviewed actual equipment and explicit no-material attestation',actualCostsReviewed:true}};
  assert.equal((await f.admin({...review,evidence:{reference:'No actual approval'}})).status,400);
  assert.equal((await f.admin({...review,expenses:[]})).status,400);
  assert.equal((await f.admin({...review,expenses:completion.expenses.map(e=>({...e,zeroCostAttestation:undefined}))})).status,400);
  const reviewOperation=crypto.randomUUID(),reviews=await Promise.all([f.admin({...review,operationId:reviewOperation}),f.admin({...review,operationId:reviewOperation})]);
  const reviewed=await reviews[0].json(),replayed=await reviews[1].json();assert.equal(reviewed.ok,true,reviewed.error);assert.equal(replayed.replayed,true);
  const approvedFacts=(await f.db.query('select field_sales_workflow_order_facts($1) f',[record.quoteId])).rows[0].f;
  assert.equal(approvedFacts.costsComplete,true);assert.equal(approvedFacts.costApprovedBy,id(9));assert.equal(approvedFacts.expenses[1].amountCents,0);
  await assert.rejects(f.db.query('update field_sales_workflows set expenses=$1 where quote_id=$2',['[]',record.quoteId]),/Immutable/);
  const entry=(await f.db.query('select * from field_sales_earning_entries where quote_id=$1',[record.quoteId])).rows[0];
  assert.ok(entry);assert.equal(Number(entry.basis_cents),8367);assert.equal(Number(entry.rate_basis_points),5000);
  assert.equal(Number(entry.amount_cents),4184);assert.equal(String(entry.qualifies_at),String(qualification));
  const earningsResponse=await f.request('field-sales-earnings','GET',null,'a');
  assert.equal(earningsResponse.status,200);
  const earnings=await json(earningsResponse);assert.equal(earnings.ok,true);assert.equal(earnings.enabled,true);
  assert.equal(JSON.stringify(earnings).includes('"facts"'),false);
  assert.equal(JSON.stringify(earnings).includes('Synthetic equipment receipt'),false);
  const finalCustomer=await json(await f.request('field-sales-agreement','GET',null,accepted.token));assert.equal(finalCustomer.workflow.balanceCents,0);
  assert.equal((await f.db.query('select enabled from h2s_management_assignment_config')).rows[0].enabled,false);
});
test('legacy unenrolled portal completion still uses established ownership and payout path',async t=>{
  const f=await createWorkflowFixture();t.after(()=>f.db.close());
  assert.equal((await f.portalComplete({job_id:id(101)},'missing')).status,401);
  assert.equal((await f.portalComplete({job_id:id(101)},'other')).status,403);
  const response=await f.portalComplete({job_id:id(101)});
  const body=await response.json();assert.equal(body.ok,true,body.error);
  assert.equal(f.portalEffects.payouts,1);assert.ok(f.portalEffects.dispatchResolution>0);
  assert.equal((await f.db.query('select status from h2s_dispatch_jobs where job_id=$1',[id(101)])).rows[0].status,'done');
});
test('document preparation supports another owning rep and customer collection uses the secure token rather than alias a',async t=>{
  const f=await createWorkflowFixture();t.after(()=>f.db.close());await f.enable();
  const terms=await json(await f.request('field-sales','POST',{action:'representative_terms',operationId:crypto.randomUUID(),userId:id(21),
    commissionStartDate:'2026-10-01',commissionStartEvidence:'Synthetic reviewed B commission start',termsRevision:0},'admin'));
  assert.equal(terms.ok,true,terms.error);
  const lead=await json(await f.request('field-sales','POST',{action:'create',operationId:crypto.randomUUID(),fullName:'Synthetic rep B customer',
    phone:'+15559999999',address:'200 Fixture Lane',city:'Fixture City',market:'residential',services:['tv_mounting'],notes:'',followUpAt:null},'b'));
  assert.equal(lead.ok,true,lead.error);
  const leadId=lead.leadId,draft=await json(await f.post({action:'quote',leadId,catalogId:f.catalogId,lines:f.lines()},'b'));
  assert.equal(draft.ok,true,draft.error);
  const quote=await json(await f.post({action:'submit',leadId,quoteId:draft.id},'b'));assert.equal(quote.ok,true,quote.error);
  const quoteId=quote.id,enrolled=await json(await f.admin({action:'enroll',leadId,quoteId,revision:0,representativeId:id(21),
    legalPolicyId:f.policyIds.legal,commissionPolicyId:f.policyIds.commission,settlementPolicyId:f.policyIds.settlement,
    creditEvidence:{reference:'Synthetic approved B attribution'}}));
  assert.equal(enrolled.ok,true,enrolled.error);
  const accepted=await f.accept(await f.documents({leadId,quoteId},'b'));
  const collected=await f.collect(accepted);assert.equal(collected.payment.ok,true);
  const facts=(await f.db.query('select field_sales_workflow_order_facts($1) f',[quoteId])).rows[0].f;
  assert.equal(facts.representativeId,id(21));assert.equal(facts.netPaidCents,2500);
  assert.equal((await f.post({action:'refresh_payment',leadId,checkoutId:collected.payment.checkoutId},'a')).status,404);
});
test('active checkout cancellation fails visibly; actual expiration and reserved provider refund retry safely',async t=>{
  const f=await createWorkflowFixture();t.after(()=>f.db.close());await f.enable();
  const record=await f.enrolled(),accepted=await f.accept(await f.documents(record));
  const first=await json(await f.post({action:'checkout',...record,kind:'deposit'}));
  await f.db.exec('update field_sales_workflow_settings set live_enabled=true');
  await assert.rejects(f.db.query('select field_sales_workflow_bind_mode($1,$2,$3)',[id(20),first.checkoutId,'live']),/mode immutable/);
  await f.db.exec('update field_sales_workflow_settings set live_enabled=false');
  let w=(await json(await f.read(record.leadId))).workflows[0];
  const cancellation={action:'cancel',...record,revision:w.revision,reason:'Synthetic customer cancellation',evidence:{reference:'Customer cancellation request'}};
  assert.equal((await f.admin(cancellation)).status,409);
  assert.equal((await f.post({action:'expire_checkout',leadId:record.leadId,checkoutId:first.checkoutId},'a')).status,403);
  const expired=await json(await f.post({action:'expire_checkout',leadId:record.leadId,checkoutId:first.checkoutId},'admin'));
  assert.equal(expired.ok,true,expired.error);assert.equal(expired.payment.state,'expired');
  const second=await json(await f.post({action:'checkout',...record,kind:'deposit'}));
  const paid=f.paid([...f.sessions.keys()].at(-1));assert.equal((await f.webhook('checkout.session.completed',paid.session)).status,200);
  w=(await json(await f.read(record.leadId))).workflows[0];
  const op=crypto.randomUUID(),cancelled=await json(await f.admin({...cancellation,operationId:op,revision:w.revision}));
  assert.equal(cancelled.ok,true,cancelled.error);
  assert.equal((await json(await f.admin({...cancellation,operationId:op,revision:w.revision}))).replayed,true);
  assert.equal((await f.post({action:'checkout',...record,kind:'deposit'})).status,503);
  const refundOp=crypto.randomUUID(),refundBody={operationId:refundOp,action:'refund',leadId:record.leadId,checkoutId:second.checkoutId,
    amountCents:2500,evidence:{reference:'Approved synthetic refund, customer cancellation'}};
  const refunded=await json(await f.post(refundBody,'admin'));assert.equal(refunded.ok,true,refunded.error);
  assert.equal(refunded.refund.state,'verified');assert.equal(refunded.payment.refunded_cents,2500);
  const retry=await json(await f.post(refundBody,'admin'));assert.equal(retry.ok,true);assert.equal(f.refunds.size,1);
  assert.equal((await f.post({...refundBody,amountCents:2499},'admin')).status,409);
  const dto=await json(await f.read(record.leadId));assert.equal(dto.workflows[0].refunds.length,1);
  const documents=await json(await f.request('field-sales-agreement','GET',null,accepted.token));
  assert.equal(documents.ok,true);assert.equal(documents.workflow.documents.length,3);assert.equal(documents.workflow.gates.canDeposit,false);
  const facts=(await f.db.query('select field_sales_workflow_order_facts($1) f',[record.quoteId])).rows[0].f;
  assert.equal(facts.netPaidCents,0);assert.equal(facts.refundedCents,2500);
  const replacement=await f.quote(record.leadId);assert.ok(replacement);
});
test('configured cancellation calendar honors excluded days/holidays and unapplied live gate',async t=>{
  const f=await createWorkflowFixture();t.after(()=>f.db.close());await f.enable();
  const policyId=id(903),definition={...f.legalDefinition,cancellationCalendar:{...f.legalDefinition.cancellationCalendar,
    businessDays:3,deadlineLocalTime:'23:59',holidays:['2026-11-05']}};
  const createdPolicy=await json(await f.admin({action:'policy_create',policyId,kind:'legal',definition}));assert.equal(createdPolicy.ok,true);
  assert.equal((await f.admin({action:'policy_approve',policyId,expectedDefinitionHash:createdPolicy.definitionHash,
    evidence:{reference:'Synthetic calendar approval'}})).status,200);
  f.policyIds.legal=policyId;const record=await f.enrolled();
  const deadline=(await f.db.query("select field_sales_workflow_deadline($1,'2026-11-04T16:00:00Z'::timestamptz) d",[record.quoteId])).rows[0].d;
  assert.equal(new Date(deadline).toISOString(),'2026-11-11T04:59:00.000Z');
  f.env.H2S_FIELD_STRIPE_MODE='live';f.env.H2S_FIELD_STRIPE_LIVE_ENABLED='false';
  assert.throws(()=>f.commerce.enrolledStripeMode(),/disabled/);
  f.env.H2S_FIELD_STRIPE_TEST_SECRET_KEY='sk_live_not_valid_for_test';
  assert.throws(()=>f.commerce.fieldStripe(),/test-mode/);
});
