const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createWorkflowFixture,id}=require('./helpers/field_workflow_fixture.cjs');
const {evaluate}=require('./helpers/commercial_operations_fixture.cjs');
const checked=async response=>{const d=await response.json();assert.equal(response.status,200,d.error);assert.equal(d.ok,true,d.error);return d;};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlWQAAAAASUVORK5CYII=';

test('real synthetic sessions, owner-operated TV sale, Friday review and separate returning-customer camera sale', {timeout:180000},async t=>{
  const f=await createWorkflowFixture();t.after(()=>f.db.close());
  f.definition.services[0].completionRequirements=[{id:'installed_tv',label:'Installed TV photograph',type:'photo',minimumCount:1}];
  f.definition.services[1].completionRequirements=[{id:'camera_check',label:'Camera security checked',type:'checklist',minimumCount:1}];
  await f.enable();
  const managerCredential=f.sales.newCredentials('synthetic-manager-credential-only');
  await f.db.query('update "Dashboard_Users" set "Pin_Salt"=$1,"Pin_Hash"=$2,"Email"=$3 where "User_ID"=$4',
    [managerCredential.pinSalt,managerCredential.pinHash,'tech-'+id(500)+'@example.invalid',id(9)]);
  const login=await f.auth.dashboardLogin(new Request('https://fixture.invalid'),{username:'ADMIN_FIXTURE',pin:'synthetic-manager-credential-only'});
  assert.ok(login.token,login.error);
  const auth=evaluate('lib\\dashboardAuth.ts',{'node:crypto':crypto,'@/lib/supabase':{getSupabase:()=>f.client,getSupabaseMgmt:()=>f.client}},{Buffer});
  const tokens={admin:login.token};
  f.sales.salesActor=async request=>{
    const raw=request.headers.get('authorization')?.replace('Bearer ','');
    const headers=new Headers(request.headers);headers.set('authorization','Bearer '+(tokens[raw]||raw));
    const actor=await auth.getDashboardAuthUserFromSession(new Request(request.url,{headers}),{allowSales:true,touchSession:false});
    if(!actor)throw new f.sales.BusinessError('Sign-in required.',401);
    if(!['ADMIN','SALES'].includes(actor.role))throw new f.sales.BusinessError('Field Sales access required.',403);
    return actor;
  };
  const repId=crypto.randomUUID(),credential='synthetic-new-representative-password';
  await checked(await f.request('field-sales','POST',{action:'account_create',operationId:repId,
    username:'OWNERPILOT',displayName:'Synthetic new representative',pin:credential},'admin'));
  const disabled=await f.auth.dashboardLogin(new Request('https://fixture.invalid'),{username:'OWNERPILOT',pin:credential});
  assert.ok(!disabled.token);
  await checked(await f.request('field-sales','POST',{action:'account_state',operationId:crypto.randomUUID(),userId:repId,active:true},'admin'));
  const representative=await f.auth.dashboardLogin(new Request('https://fixture.invalid'),{username:'OWNERPILOT',pin:credential});
  assert.match(representative.token,/^h2s-sales:/);
  const other=await f.auth.dashboardLogin(new Request('https://fixture.invalid'),{username:'SALESB',pin:'temporary-fixture-password-b'});
  tokens.a=representative.token;tokens.b=other.token;f.actors.a=repId;
  assert.equal((await f.auth.guardGET(new Request('https://fixture.invalid/api/v1?action=dashboardUsers',
    {headers:{authorization:'Bearer '+tokens.a}}))).status,403);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  for(const userId of [repId,id(21)])await checked(await f.request('field-sales','POST',{
    action:'representative_terms',operationId:crypto.randomUUID(),userId,commissionStartDate:today,
    commissionStartEvidence:'Synthetic approved launch tenure',termsRevision:0},'admin'));
  const source=await checked(await f.request('field-sales','POST',{action:'create',operationId:crypto.randomUUID(),
    fullName:'Synthetic returning household',phone:'+15550005551',address:'100 Fixture Lane',city:'Fixture City',
    market:'residential',services:['tv_mounting'],notes:'Isolated owner-operated pilot'},tokens.a));
  const owner=async(body,actor='admin')=>checked(await f.request('field-sales-company-installation','POST',{operationId:crypto.randomUUID(),...body},actor));
  assert.equal((await f.request('field-sales-company-installation','GET',null,'a')).status,403);
  assert.equal((await f.request('field-sales-company-installation','GET',null,'b')).status,403);
  assert.equal((await checked(await f.request('field-sales-company-installation','GET',null,'admin'))).authorized,false);
  assert.equal((await f.request('field-sales-company-installation','POST',{action:'authorize_self',operationId:crypto.randomUUID(),
    proId:id(502),evidence:{reference:'Cannot impersonate another person'}},'admin')).status,403);
  await owner({action:'authorize_self',proId:id(500),evidence:{reference:'Verified existing owner/company installer identity'}});
  const expenses=[
    {category:'equipment',quantity:1,unitCents:1500,amountCents:1500,actual:true,evidence:{reference:'Synthetic equipment receipt'}},
    {category:'materials',quantity:2,unitCents:100,amountCents:200,actual:true,evidence:{reference:'Synthetic materials receipt'}}];
  const workflow=async record=>(await checked(await f.read(record.leadId))).workflows.find(w=>w.quoteId===record.quoteId);
  const manage=async(record,action,extra)=>checked(await f.admin({action,leadId:record.leadId,quoteId:record.quoteId,
    revision:(await workflow(record)).revision,...extra}));
  async function capture(record,kind){
    await checked(await f.request('field-sales-agreement','POST',{action:'checkout',operationId:crypto.randomUUID(),kind},record.token));
    const paid=f.paid([...f.sessions.keys()].at(-1)),amount=paid.session.amount_total;
    paid.charge.balance_transaction={id:'txn_'+paid.session.id,source:paid.charge.id,amount,fee:31,net:amount-31,currency:'usd',fee_details:[]};
    assert.equal((await f.webhook('checkout.session.completed',paid.session)).status,200);
  }
  async function sale(leadId,actor,service,index){
    const line=service==='tv_mounting'?f.lines()[0]:{serviceId:'equipment_cameras',offerId:'package',quantity:2,answers:{size:50,wall:'drywall'},options:[]};
    let q=await checked(await f.post({action:'quote',leadId,catalogId:f.catalogId,lines:[line]},actor));
    q=await checked(await f.post({action:'submit',leadId,quoteId:q.id},actor));
    if(service!=='tv_mounting')q=await checked(await f.post({action:'approve',leadId,quoteId:q.id,
      reason:'Synthetic camera installation scope review',scopeConfirmation:'Synthetic two camera scope reviewed'},'admin'));
    let record={leadId,quoteId:q.id};
    await checked(await f.admin({action:'enroll',...record,revision:0,legalPolicyId:f.policyIds.legal,
      commissionPolicyId:f.policyIds.commission,settlementPolicyId:f.policyIds.settlement,representativeId:actor==='a'?repId:id(21),
      creditEvidence:{reference:'Synthetic opportunity-specific approved commission credit'}}));
    record=await f.accept(await f.documents(record,actor));
    const early=await f.request('field-sales-agreement','POST',{action:'checkout',operationId:crypto.randomUUID(),kind:'balance'},record.token);
    assert.notEqual(early.status,200);
    await capture(record,'deposit');
    let w=await workflow(record);
    const start=new Date(Date.now()+86400000+index*10800000);
    await manage(record,'schedule',{reservationRevision:0,start:start.toISOString(),end:new Date(+start+7200000).toISOString(),
      timezone:'UTC',customerAgreed:true,reason:'Synthetic agreed appointment'});
    await manage(record,'preparation',{preparationRevision:0,scopeReviewed:true,materials:'ready',access:'ready',blockers:'',note:'Synthetic actual readiness review'});
    w=await workflow(record);
    const claim={action:'claim',job_id:w.jobId,workflowRevision:w.revision,operationId:crypto.randomUUID(),evidence:{reference:'Owner personally performs this installation'}};
    assert.equal((await f.request('field-sales-company-installation','POST',{...claim,evidence:{reference:''}},'admin')).status,400);
    await owner(claim);await owner(claim);
    w=await workflow(record);
    assert.equal((await f.request('field-sales-company-installation','POST',{job_id:w.jobId,workflowRevision:w.revision,
      operationId:crypto.randomUUID(),expenses,hours:2,evidence:{reference:'No proof yet'},performedAt:new Date().toISOString()},'admin')).status,400);
    for(const type of ['photo','signature'])await owner({action:'upload',job_id:w.jobId,type,data:png,filename:type+'.png',mimetype:'image/png'});
    let context=await checked(await f.request('field-sales-company-installation','GET',null,'admin','?job_id='+w.jobId));
    const photo=context.workflow.proof.candidates.find(a=>a.type==='photo');
    await owner({action:'proof_record',job_id:w.jobId,workflowRevision:context.workflow.revision,
      bindings:service==='tv_mounting'?[{serviceId:'tv_mounting',requirementId:'installed_tv',artifactIds:[photo.artifactId]}]:[],
      checklists:service==='tv_mounting'?[]:[{serviceId:'equipment_cameras',requirementId:'camera_check',affirmed:true,evidence:{reference:'Synthetic personally verified security setup'}}]});
    context=await checked(await f.request('field-sales-company-installation','GET',null,'admin','?job_id='+w.jobId));
    assert.equal(context.workflow.canComplete,true);
    const completion={job_id:w.jobId,workflowRevision:context.workflow.revision,expenses,hours:2,
      evidence:{reference:'Synthetic owner installation evidence'},performedAt:new Date().toISOString(),operationId:crypto.randomUUID()};
    for(const performedAt of [null,'2099-01-01T00:00:00Z','2000-01-01T00:00:00Z'])assert.equal((await f.request('field-sales-company-installation','POST',{...completion,performedAt,operationId:crypto.randomUUID()},'admin')).status,400);
    await owner(completion);await owner(completion);
    w=await workflow(record);assert.ok(w.completedAt);assert.equal(w.netPaidCents,w.depositCents);assert.equal(w.gates.canBalance,true);
    await manage(record,'cost_review',{expenses,evidence:{reference:'Synthetic approved actual receipts',actualCostsReviewed:true}});
    const unpaid=await checked(await f.request('field-sales-earnings','GET',null,actor));assert.equal(unpaid.entries.filter(e=>e.quoteId===record.quoteId).length,0);
    await capture(record,'balance');
    const earned=await checked(await f.request('field-sales-earnings','GET',null,actor));
    const entry=earned.entries.find(e=>e.quoteId===record.quoteId);assert.ok(entry);assert.equal(entry.representativeId,actor==='a'?repId:id(21));
    assert.equal(entry.basisCents,w.totalCents-1700-62);assert.equal(entry.rateBasisPoints,5500);
    return record;
  }
  const first=await sale(source.leadId,'a','tv_mounting',0);
  const runDate=new Date(today+'T12:00:00Z');runDate.setUTCDate(runDate.getUTCDate()+(((5-runDate.getUTCDay()+7)%7)||7));
  const run=(await f.db.query('select field_sales_earnings_command($1,$2,$3,$4) result',[id(9),crypto.randomUUID(),'create_run',
    JSON.stringify({settlementPolicyId:f.policyIds.settlement,runDate:runDate.toISOString().slice(0,10)})])).rows[0].result;
  assert.equal(run.state,'draft');assert.equal(run.beneficiaries.length,1);
  await f.db.query('select field_sales_earnings_command($1,$2,$3,$4)',[id(9),crypto.randomUUID(),'approve_run',
    JSON.stringify({runId:run.runId,evidence:{reference:'Synthetic Friday management review'}})]);
  const original=(await f.db.query('select to_jsonb(q) quote,to_jsonb(a) agreement from field_sales_quotes q join field_sales_agreements a using(quote_id) where q.quote_id=$1',[first.quoteId])).rows[0];
  const returning=await checked(await f.request('field-sales','POST',{action:'repeat',operationId:crypto.randomUUID(),leadId:source.leadId,
    ownerId:id(21),services:['cameras_included'],evidence:'Verified exact returning household; new representative',notes:'Separate camera purchase'},'admin'));
  const second=await sale(returning.leadId,'b','equipment_cameras',1);
  assert.notEqual(first.quoteId,second.quoteId);
  assert.deepEqual((await f.db.query('select to_jsonb(q) quote,to_jsonb(a) agreement from field_sales_quotes q join field_sales_agreements a using(quote_id) where q.quote_id=$1',[first.quoteId])).rows[0],original);
  const history=await checked(await f.request('field-sales','GET',null,'admin','?customerId='+source.leadId));assert.equal(history.total,2);
  for(const [actor,own,otherRecord] of [['a',first,second],['b',second,first]]){
    assert.equal((await f.request('field-sales','GET',null,actor,'?leadId='+otherRecord.leadId)).status,404);
    assert.equal((await checked(await f.request('field-sales','GET',null,actor,'?customerId='+source.leadId))).total,1);
    assert.equal((await f.request('field-sales-transactions','GET',null,actor,'?leadId='+otherRecord.leadId)).status,404);
    assert.equal((await f.read(otherRecord.leadId,actor)).status,404);
    const ownEarnings=await checked(await f.request('field-sales-earnings','GET',null,actor));assert.equal(ownEarnings.entries.length,1);
  }
  assert.equal(f.portalEffects.payouts,0);
  assert.equal((await f.db.query('select count(distinct customer_id)::int n from field_sales_opportunities')).rows[0].n,1);
});
