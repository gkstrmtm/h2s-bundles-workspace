const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createCommerceFixture,id}=require('./field_commerce_fixture.cjs');
const {evaluate}=require('./commercial_operations_fixture.cjs');
const {attachEarningsRoutes}=require('./field_earnings_fixture.cjs');
async function createWorkflowFixture(){
  const f=await createCommerceFixture();
  const migration=name=>fs.readFileSync(path.join(__dirname,'..','..','migrations',name),'utf8');
  await f.db.exec(`alter table h2s_pros add column email text unique;
    create table h2s_dispatch_job_artifacts(artifact_id uuid primary key default gen_random_uuid(),job_id text not null,
      pro_id uuid,type text not null,url text not null,caption text,created_at timestamptz not null default now(),updated_at timestamptz default now());
    alter table h2s_dispatch_job_assignments add column offer_sent_at timestamptz,add column accepted_at timestamptz,add column declined_at timestamptz;
    update h2s_pros set email='tech-'||pro_id||'@example.invalid';`);
  await f.db.exec(migration('041_management_assignment.sql'));
  await f.db.exec(migration('042_management_offer_reliability.sql'));
  await f.db.exec(migration('046_field_sales_workflow.sql'));
  await f.db.exec(migration('047_field_sales_earnings.sql'));
  await f.db.exec(migration('051_field_sales_company_installation.sql'));
  f.env.H2S_FIELD_WORKFLOW_ENABLED='true';
  f.env.H2S_FIELD_AGREEMENT_HANDOFF_MINUTES='60';
  const original=f.client.rpc.bind(f.client),casts={
    field_sales_workflow_read:['uuid','uuid','uuid'],field_sales_workflow_command:['uuid','uuid','uuid','uuid','integer','text','jsonb'],
    field_sales_workflow_installation:['uuid','uuid'],field_sales_workflow_complete:['uuid','uuid','uuid','integer','jsonb'],
    field_sales_workflow_record_proof:['uuid','uuid','uuid','integer','jsonb'],
    field_sales_workflow_bind_mode:['uuid','uuid','text'],field_sales_workflow_customer_context:['text'],
    field_sales_workflow_reserve_refund:['uuid','uuid','uuid','bigint','jsonb'],field_sales_workflow_refund_result:['uuid','uuid','jsonb'],
    field_sales_workflow_renew_handoff:['uuid','uuid','uuid','text','integer'],
    field_sales_identity_command:['uuid','uuid','jsonb'],
    field_sales_company_context:['uuid','uuid'],
    field_sales_company_command:['uuid','uuid','uuid','integer','text','jsonb'],
  };
  f.client.rpc=async(name,args)=>{
    if(!casts[name])return original(name,args);
    try{
      const values=Object.values(args).map(v=>v&&typeof v==='object'?JSON.stringify(v):v);
      const result=await f.db.query(`select ${name}(${values.map((_,i)=>'$'+(i+1)+'::'+casts[name][i]).join(',')}) result`,values);
      return {data:result.rows[0].result,error:null};
    }catch(error){return {data:null,error:{code:error.code,message:error.message}};}
  };
  const provider=f.commerce.fieldStripe(),refunds=new Map(),refundKeys=new Map();
  provider.checkout.sessions.expire=async sid=>{
    const session=f.sessions.get(sid);if(!session||session.status!=='open')throw Error('Provider session cannot expire');
    session.status='expired';session.url=null;return session;
  };
  provider.refunds={
    retrieve:async key=>{if(!refunds.has(key))throw Error('Unknown fixture refund');return refunds.get(key);},
    create:async(params,options)=>{
      if(refundKeys.has(options.idempotencyKey))return refunds.get(refundKeys.get(options.idempotencyKey));
      const intent=f.intents.get(params.payment_intent),charge=f.charges.get(intent.latest_charge);
      const refund={id:'re_synthetic_'+refunds.size,amount:params.amount,currency:'usd',payment_intent:intent.id,status:'succeeded'};
      charge.amount_refunded+=params.amount;
      refunds.set(refund.id,refund);refundKeys.set(options.idempotencyKey,refund.id);return refund;
    }
  };
  class AuthError extends Error {constructor(message,code,status){super(message);this.code=code;this.status=status;}}
  const portalEffects={payouts:0,dispatchResolution:0};
  const imports={'node:crypto':crypto,'@/lib/supabase':{getSupabase:()=>f.client,getSupabaseDispatch:()=>f.client},'@/lib/fieldSales':f.sales,
    '@/lib/fieldQuote':f.engine,
    '@/lib/adminAuth':{corsHeaders:()=>({})},'@/lib/auth':{AuthError,verifyPortalToken:async token=>
      ['pro','other'].includes(token)?{ok:true,payload:{sub:id(token==='pro'?500:502),role:'pro'}}:{ok:false,error:'Pro sign-in required'},
    requireAuth:async request=>{
      const token=request.headers.get('authorization')?.replace('Bearer ','');
      if(!['pro','other'].includes(token))throw new AuthError('Pro sign-in required','invalid_token',401);
      return {sub:id(token==='pro'?500:502),role:'pro',email:'synthetic-tech@example.invalid'};
    }},'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},
    '@/lib/config':{getConfig:()=>({buildId:'synthetic-workflow-fixture'})},
    '@/lib/dispatchSchema':{resolveDispatchSchema:async()=>{portalEffects.dispatchResolution++;return{
      jobsTable:'h2s_dispatch_jobs',jobsIdCol:'job_id',jobsStatusCol:'status',assignmentsTable:'h2s_dispatch_job_assignments',
      assignmentsJobCol:'job_id',assignmentsProCol:'pro_id',assignmentsStateCol:'state'};}},
    '@/lib/dataOrchestration':{ensureCompletionSideEffects:async()=>{portalEffects.payouts++;return{payoutId:'legacy-fixture-payout'};}}};
  const proofStorage=new Map(),from=f.client.from.bind(f.client),privateStorage=f.client.storage;
  f.client.storage={...privateStorage,from:bucket=>bucket==='commercial-private-files'?privateStorage.from(bucket):({
    upload:async(objectPath,bytes)=>{proofStorage.set(bucket+'/'+objectPath,Buffer.from(bytes));return{data:{path:objectPath},error:null};},
    getPublicUrl:objectPath=>({data:{publicUrl:'https://fixture.invalid/artifacts/'+bucket+'/'+objectPath}})
  })};
  f.client.from=table=>{
    const builder=from(table);if(table!=='h2s_dispatch_job_artifacts')return builder;
    builder.insert=value=>{
      const keys=Object.keys(value),result=f.db.query(`insert into h2s_dispatch_job_artifacts(${keys.map(k=>'"'+k+'"').join(',')})
        values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning *`,Object.values(value))
        .then(out=>({data:out.rows,error:null}),error=>({data:null,error:{message:error.message,code:error.code}}));
      return{then:(resolve,reject)=>result.then(resolve,reject),select:()=>({maybeSingle:async()=>{
        const out=await result;return{...out,data:out.data?.[0]??null};
      }})};
    };return builder;
  };
  const globals={process:{env:f.env},Buffer,Headers,crypto};
  imports['@/lib/portalArtifacts']=evaluate('lib\\portalArtifacts.ts',imports,globals);
  const workflow=evaluate('lib\\fieldWorkflow.ts',imports,globals);imports['@/lib/fieldWorkflow']=workflow;
  const workflowRoute=evaluate('app\\api\\field-sales-workflow\\route.ts',imports,globals);
  const installationRoute=evaluate('app\\api\\field-sales-installation\\route.ts',imports,globals);
  const portalRoute=evaluate('app\\api\\portal_mark_done\\route.ts',imports,globals);
  const salesRoute=evaluate('app\\api\\field-sales\\route.ts',imports,globals);
  const routes={...f.routes,'field-sales':salesRoute,'field-sales-workflow':workflowRoute,
    'field-sales-installation':installationRoute,portal_mark_done:portalRoute,
    portal_upload_artifact:evaluate('app\\api\\portal_upload_artifact\\route.ts',imports,globals),
    portal_upload_signature:evaluate('app\\api\\portal_upload_signature\\route.ts',imports,globals),
    portal_get_artifacts:evaluate('app\\api\\portal_get_artifacts\\route.ts',imports,globals),
    'field-sales-photos':evaluate('app\\api\\field-sales-photos\\route.ts',imports,globals)};
  routes['field-sales-company-installation']=evaluate('app\\api\\field-sales-company-installation\\route.ts',imports,globals);
  const request=(name,method='GET',body,actor='a',query='')=>{
    if(!routes[name]?.[method])throw Error('Unsupported isolated workflow fixture route: '+name);
    return routes[name][method](new Request('https://fixture.invalid/api/'+name+query,{
      method,headers:{authorization:'Bearer '+actor,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
  };
  const call=(route,method,body,actor='admin',query='')=>route[method](new Request('https://fixture.invalid/api/workflow'+query,{
    method,headers:{authorization:'Bearer '+actor,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
  const admin=(body,actor='admin')=>call(workflowRoute,'POST',{operationId:crypto.randomUUID(),...body},actor);
  const read=(lead,actor='admin')=>call(workflowRoute,'GET',null,actor,lead?'?lead_id='+lead:'');
  const proRead=(job,actor='pro')=>call(installationRoute,'GET',null,actor,'?job_id='+job);
  const complete=(body,actor='pro')=>call(installationRoute,'POST',body,actor);
  const portalComplete=(body,actor='pro')=>call(portalRoute,'POST',body,actor);
  async function uploadProof(jobId,types=['photo','signature'],actor='pro'){
    const artifacts=[];
    for(const type of types){
      const result=await(await request(type==='signature'?'portal_upload_signature':'portal_upload_artifact','POST',
        {token:actor,job_id:jobId,type,data:Buffer.from('Synthetic '+type+' uploaded bytes').toString('base64'),
          filename:type+'.png',mimetype:'image/png'},actor)).json();
      if(!result.ok)throw Error(result.error);
      artifacts.push(result.artifact);
    }
    return artifacts;
  }
  const policyIds={legal:id(900),commission:id(901),settlement:id(902)};
  const legalDefinition={agreementPolicyId:id(811),depositBasisPoints:2500,
    requiredNotices:[{label:'Synthetic cancellation notice',content:{text:'Synthetic approved notice only'}}],
    cancellationCalendar:{timezone:'America/New_York',businessDays:0,deadlineLocalTime:'00:00',startEvent:'acceptance',excludedWeekdays:[6,7],holidays:['2099-01-01']}};
  async function enable(){
    await f.enable();await f.publish();await f.legal();
    await f.db.exec('update field_sales_workflow_settings set enabled=true');
    await f.db.query(`update field_sales_transaction_settings set deposit_policy=$1`,[JSON.stringify({mode:'basis_points',basisPoints:2500,
      approvedBy:id(9),approvedAt:'2026-11-04T00:00:00Z',approvalEvidence:'Synthetic deposit approval',agreementPolicyId:id(811)})]);
    await f.db.query(`update field_sales_representatives set commission_start_date='2026-10-01',commission_start_evidence='Synthetic start',
      commission_terms_set_by=$1,commission_terms_set_at=now() where user_id=$2`,[id(9),id(20)]);
    for(const [kind,policyId] of Object.entries(policyIds)){
      const definition=kind==='legal'?legalDefinition:kind==='commission'?
        {timezone:'America/New_York',rateEffectiveEvent:'accepted',creditPolicy:'approved_attribution',
          accountingPolicy:'customer_revenue_less_actual_equipment_materials_provider_fees',rounding:'half_away_from_zero',
          rates:[{throughDay:30,basisPoints:5500},{throughDay:60,basisPoints:5000},{throughDay:null,basisPoints:4500}]}:
        {timezone:'America/New_York',cutoff:'12:00',holidayConvention:'skip',holidays:[],method:'reviewed_bank_transfer',classification:'synthetic'};
      const created=await(await admin({action:'policy_create',policyId,kind,definition})).json();if(!created.ok)throw Error(created.error);
      const approved=await(await admin({action:'policy_approve',policyId,expectedDefinitionHash:created.definitionHash,
        evidence:{reference:'Synthetic approval only'}})).json();if(!approved.ok)throw Error(approved.error);
    }
  }
  async function enrolled(){
    const leadId=await f.lead(),quoteId=await f.submit(leadId,await f.quote(leadId));
    const result=await(await admin({action:'enroll',leadId,quoteId,revision:0,legalPolicyId:policyIds.legal,
      commissionPolicyId:policyIds.commission,settlementPolicyId:policyIds.settlement,representativeId:id(20),
      creditEvidence:{reference:'Synthetic immutable approved credit'}})).json();
    if(!result.ok)throw Error(result.error);
    return {leadId,quoteId};
  }
  async function documents(record,actor='a'){
    const dto=await(await read(record.leadId)).json();if(!dto.ok)throw Error(dto.error);
    const w=dto.workflows[0];
    const published=await(await admin({action:'documents_publish',...record,revision:w.revision,artifacts:w.requiredArtifacts,
      evidence:{reference:'Synthetic approved copies'}})).json();if(!published.ok)throw Error(published.error);
    const prepared=await(await f.post({action:'agreement',...record},actor)).json();if(!prepared.ok)throw Error(prepared.error);
    const token=new URLSearchParams(new URL(prepared.agreementUrl).hash.slice(1)).get('token');
    return {...record,token};
  }
  async function accept(record){
    const facts=await(await f.request('field-sales-agreement','GET',null,record.token)).json();if(!facts.ok)throw Error(facts.error);
    const body={operationId:crypto.randomUUID(),name:'Synthetic customer',email:'synthetic@example.invalid',accepted:true,electronicDelivery:true,
      quoteHash:facts.quote.quote_hash,policyVersion:facts.agreement.policy_snapshot.version};
    const result=await(await f.request('field-sales-agreement','POST',body,record.token)).json();if(!result.ok)throw Error(result.error);
    return {...record,acceptance:body};
  }
  async function collect(record,kind='deposit',actor='a'){
    const checkoutResponse=record.token
      ? await f.request('field-sales-agreement','POST',{action:'checkout',operationId:crypto.randomUUID(),kind},record.token)
      : await f.post({action:'checkout',leadId:record.leadId,quoteId:record.quoteId,kind},actor);
    const payment=await checkoutResponse.json();
    // Only exact API fields are accepted.
    if(!payment.ok)throw Error(payment.error);
    const sid=[...f.sessions.keys()].at(-1),paid=f.paid(sid);
    const response=await f.webhook('checkout.session.completed',paid.session);if(response.status!==200)throw Error(await response.text());
    return {payment,paid};
  }
  const fixture={...f,routes,request,workflow,workflowRoute,installationRoute,admin,read,proRead,complete,portalComplete,portalEffects,policyIds,legalDefinition,enable,enrolled,documents,accept,collect,refunds,uploadProof,proofStorage};
  await attachEarningsRoutes(fixture);
  return fixture;
}
module.exports={createWorkflowFixture,id};
