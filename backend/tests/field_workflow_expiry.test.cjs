const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createWorkflowFixture,id}=require('./helpers/field_workflow_fixture.cjs');
test('aged accepted immutable contract completes after expiry and receives only finite authenticated balance handoffs',async t=>{
  const f=await createWorkflowFixture();t.after(()=>f.db.close());f.definition.services[0].offers[0].unitCents=10001;await f.enable();
  const leadId=await f.lead(),templateId=await f.submit(leadId,await f.quote(leadId));
  const quoteId=crypto.randomUUID(),agreementId=crypto.randomUUID(),orderId=crypto.randomUUID();
  // Seed elapsed sale time by INSERTING aged evidence, never mutating an approved quote/agreement.
  await f.db.query(`insert into field_sales_quotes(quote_id,lead_id,revision,catalog_id,catalog_hash,opportunity_revision,snapshot,quote_hash,
    state,created_by,attributed_user_id,created_at,expires_at,order_uuid)
    select $1,lead_id,revision+1,catalog_id,catalog_hash,opportunity_revision,snapshot,quote_hash,state,created_by,attributed_user_id,
      now()-interval '10 days',now()-interval '9 days',$2 from field_sales_quotes where quote_id=$3`,[quoteId,orderId,templateId]);
  await f.db.query(`insert into field_sales_workflows(quote_id,lead_id,representative_id,credit_evidence,legal_policy_id,commission_policy_id,
    settlement_policy_id,commission_start_date,commission_start_evidence,deposit_cents,balance_cents,cancellation_deadline,created_by,created_at)
    values($1,$2,$3,'{"reference":"Synthetic approved aged credit"}',$4,$5,$6,'2026-10-01','Synthetic start',2501,7500,
      now()-interval '6 days',$7,now()-interval '10 days')`,[quoteId,leadId,id(20),f.policyIds.legal,f.policyIds.commission,f.policyIds.settlement,id(9)]);
  const quote=(await f.db.query('select * from field_sales_quotes where quote_id=$1',[quoteId])).rows[0];
  const originalToken=f.commerce.customerToken(agreementId,quote.quote_hash),originalHash=f.commerce.tokenHash(originalToken);
  const legal=(await f.db.query('select to_jsonb(p) p from field_sales_agreement_policies p where policy_id=$1',[id(811)])).rows[0].p;
  const policy={...legal,paymentPlan:{fullCents:10001,depositCents:2501,remainingAfterDepositCents:7500}};
  const acceptance={operationId:crypto.randomUUID(),name:'Synthetic aged customer',email:'synthetic@example.invalid',
    accepted:true,electronicDelivery:true,quoteHash:quote.quote_hash,policyVersion:'synthetic-legal-v1',acceptanceMethod:'approved_customer_handoff'};
  const {acceptanceMethod,...customerAcceptance}=acceptance;
  await f.db.query(`insert into field_sales_agreements(agreement_id,quote_id,lead_id,quote_hash,policy_id,policy_snapshot,token_hash,expires_at,
    prepared_by,created_at,accepted_at,acceptance) values($1,$2,$3,$4,$5,$6,$7,now()-interval '9 days',$8,
      now()-interval '10 days',now()-interval '10 days',$9)`,[agreementId,quoteId,leadId,quote.quote_hash,id(811),JSON.stringify(policy),originalHash,id(9),JSON.stringify(acceptance)]);
  let w=(await(await f.read(leadId)).json()).workflows[0];
  for(const document of w.requiredArtifacts){
    await f.db.query(`insert into field_sales_workflow_artifacts(quote_id,kind,label,content,content_hash,approved_by,approved_at,approval_evidence)
      values($1,$2,$3,$4,encode(sha256(convert_to($4::jsonb::text,'UTF8')),'hex'),$5,now()-interval '10 days','{"reference":"Synthetic aged approved copy"}')`,
      [quoteId,document.kind,document.label,JSON.stringify(document.content),id(9)]);
  }
  await f.db.query(`insert into field_sales_workflow_delivery(quote_id,actor_reference,method,artifact_hashes,evidence,created_at)
    select $1,'customer-handoff','customer_retrieval',jsonb_agg(content_hash order by kind,label),
      '{"reference":"Synthetic aged customer retrieval"}',now()-interval '10 days' from field_sales_workflow_artifacts where quote_id=$1`,[quoteId]);
  const checkoutId=crypto.randomUUID();
  await f.db.query(`insert into field_sales_checkouts(checkout_id,quote_id,agreement_id,lead_id,kind,amount_cents,policy_snapshot,created_by,created_at,expires_at)
    values($1,$2,$3,$4,'deposit',2501,'{"basisPoints":2500}',$5,now()-interval '10 days',now()-interval '9 days')`,
    [checkoutId,quoteId,agreementId,leadId,id(20)]);
  const {payment}=await f.commerce.paymentRecord(checkoutId),metadata=f.commerce.stripeMetadata(payment,quote),provider=f.commerce.fieldStripe();
  const session=await provider.checkout.sessions.create({line_items:[{price_data:{unit_amount:2501}}],client_reference_id:checkoutId,metadata},
    {idempotencyKey:'aged-deposit'});
  const paid=f.paid(session.id);await f.commerce.recordSession(provider,checkoutId,'synthetic-aged-deposit-verification',paid.session);
  assert.equal((await f.request('field-sales-agreement','GET',null,originalToken)).status,404);
  assert.equal((await f.request('field-sales-agreement','POST',{action:'checkout',operationId:crypto.randomUUID(),kind:'balance'},originalToken)).status,403);
  w=(await(await f.read(leadId)).json()).workflows[0];
  let response=await(await f.admin({action:'schedule',leadId,quoteId,revision:w.revision,reservationRevision:0,
    start:'2099-03-03T15:00:00Z',end:'2099-03-03T17:00:00Z',timezone:'America/New_York',customerAgreed:true,reason:'Synthetic aged agreed window'})).json();
  assert.equal(response.ok,true,response.error);
  w=(await(await f.read(leadId)).json()).workflows[0];
  response=await(await f.admin({action:'preparation',leadId,quoteId,revision:w.revision,preparationRevision:0,
    scopeReviewed:true,materials:'ready',access:'ready',blockers:'',note:'Synthetic aged preparation'})).json();assert.equal(response.ok,true,response.error);
  w=(await(await f.read(leadId)).json()).workflows[0];
  response=await(await f.admin({action:'assign',leadId,quoteId,revision:w.revision,proId:id(500),
    context:w.assignmentPreview.job.context,note:'Synthetic aged canonical offer'})).json();assert.equal(response.ok,true,response.error);
  await f.db.query('select h2s_management_respond_to_offer($1,$2,$3)',[w.jobId,id(500),'accept']);
  await f.uploadProof(w.jobId);
  const pro=(await(await f.proRead(w.jobId)).json()).workflow;
  response=await(await f.complete({job_id:w.jobId,operationId:crypto.randomUUID(),workflowRevision:pro.revision,hours:1,
    expenses:[{category:'equipment',quantity:0,unitCents:0,amountCents:0,actual:true,zeroCostAttestation:'Customer-owned equipment',
      evidence:{reference:'Actual customer-owned equipment attestation'}},{category:'materials',quantity:0,unitCents:0,amountCents:0,actual:true,
      zeroCostAttestation:'No materials used',evidence:{reference:'Actual no materials used'}}],evidence:{reference:'Actual synthetic completion'}})).json();
  assert.equal(response.ok,true,response.error);
  assert.equal((await f.db.query('select field_sales_workflow_order_facts($1) f',[quoteId])).rows[0].f.netPaidCents,2501);
  assert.equal((await f.post({action:'agreement_link',leadId,quoteId},'b')).status,404);
  const operationId=crypto.randomUUID(),link=await(await f.post({action:'agreement_link',operationId,leadId,quoteId})).json();
  assert.equal(link.ok,true,link.error);assert.equal(link.scope,'accepted_documents_balance');
  assert.ok(Date.parse(link.expiresAt)>Date.now());assert.ok(Date.parse(link.expiresAt)<=Date.now()+61*60000);
  const renewedToken=new URLSearchParams(new URL(link.agreementUrl).hash.slice(1)).get('token');
  assert.notEqual(renewedToken,originalToken);
  const retry=await(await f.post({action:'agreement_link',operationId,leadId,quoteId})).json();assert.equal(retry.agreementUrl,link.agreementUrl);
  const customer=await(await f.request('field-sales-agreement','GET',null,renewedToken)).json();
  assert.equal(customer.ok,true,customer.error);assert.equal(customer.workflow.gates.canBalance,true);
  const balance=await(await f.request('field-sales-agreement','POST',{action:'checkout',operationId:crypto.randomUUID(),kind:'balance'},renewedToken)).json();
  assert.equal(balance.ok,true,balance.error);assert.equal([...f.sessions.values()].at(-1).amount_total,7500);
  const final=f.paid([...f.sessions.keys()].at(-1));assert.equal((await f.webhook('checkout.session.completed',final.session)).status,200);
  const preserved=(await f.db.query('select * from field_sales_quotes where quote_id=$1',[quoteId])).rows[0];
  assert.equal(String(preserved.expires_at),String(quote.expires_at));assert.equal(preserved.quote_hash,quote.quote_hash);
  const expiredToken=f.commerce.customerToken(crypto.randomUUID(),quote.quote_hash);
  await f.db.query(`insert into field_sales_workflow_handoffs(handoff_id,quote_id,token_hash,scope,duration_minutes,expires_at,issued_by)
    values($1,$2,$3,'accepted_documents_balance',60,now()-interval '1 minute',$4)`,
    [crypto.randomUUID(),quoteId,f.commerce.tokenHash(expiredToken),id(20)]);
  assert.equal((await f.request('field-sales-agreement','GET',null,expiredToken)).status,404);
  assert.equal((await f.request('field-sales-agreement','POST',customerAcceptance,expiredToken)).status,400);
  delete f.env.H2S_FIELD_AGREEMENT_HANDOFF_MINUTES;
  assert.equal((await f.post({action:'agreement_link',leadId,quoteId})).status,503);
  const unacceptedLead=await f.lead(),unacceptedTemplate=await f.submit(unacceptedLead,await f.quote(unacceptedLead));
  const unacceptedQuote=crypto.randomUUID(),unacceptedAgreement=crypto.randomUUID();
  await f.db.query(`insert into field_sales_quotes(quote_id,lead_id,revision,catalog_id,catalog_hash,opportunity_revision,snapshot,quote_hash,
    state,created_by,attributed_user_id,expires_at)
    select $1,lead_id,revision+1,catalog_id,catalog_hash,opportunity_revision,snapshot,quote_hash,state,created_by,attributed_user_id,
      now()-interval '1 day' from field_sales_quotes where quote_id=$2`,[unacceptedQuote,unacceptedTemplate]);
  const uq=(await f.db.query('select quote_hash from field_sales_quotes where quote_id=$1',[unacceptedQuote])).rows[0].quote_hash;
  const unacceptedToken=f.commerce.customerToken(unacceptedAgreement,uq);
  await f.db.query(`insert into field_sales_agreements(agreement_id,quote_id,lead_id,quote_hash,policy_id,policy_snapshot,token_hash,expires_at,prepared_by)
    values($1,$2,$3,$4,$5,$6,$7,now()-interval '1 day',$8)`,[unacceptedAgreement,unacceptedQuote,unacceptedLead,uq,id(811),
      JSON.stringify(policy),f.commerce.tokenHash(unacceptedToken),id(9)]);
  assert.equal((await f.request('field-sales-agreement','GET',null,unacceptedToken)).status,404);
  assert.equal((await f.request('field-sales-agreement','POST',{...customerAcceptance,quoteHash:uq},unacceptedToken)).status,400);
  assert.equal((await f.request('field-sales-agreement','POST',{action:'checkout',operationId:crypto.randomUUID(),kind:'deposit'},unacceptedToken)).status,403);
  assert.equal((await f.post({action:'agreement_link',leadId:unacceptedLead,quoteId:unacceptedQuote})).status,409);
});
