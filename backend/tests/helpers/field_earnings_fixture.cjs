const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createCommerceFixture,id}=require('./field_commerce_fixture.cjs');
const {evaluate}=require('./commercial_operations_fixture.cjs');
const commissionPolicy={timezone:'America/New_York',rateEffectiveEvent:'qualified',creditPolicy:'approved_attribution',
  accountingPolicy:'customer_revenue_less_actual_equipment_materials_provider_fees',rounding:'half_away_from_zero',
  rates:[{throughDay:30,basisPoints:5500},{throughDay:60,basisPoints:5000},{throughDay:null,basisPoints:4500}]};
const settlementPolicy={timezone:'America/New_York',cutoff:'17:00',holidayConvention:'skip',holidays:[],
  method:'synthetic-existing-payment-method',classification:'synthetic-approved-classification'};
function attachEarningsRoutes(f){
  if(f.earningsRoute)return f;
  const casts={field_sales_earnings_read:['uuid','uuid','uuid'],field_sales_earnings_command:['uuid','uuid','text','jsonb']};
  const rpc=f.client.rpc.bind(f.client),request=f.request.bind(f);
  f.client.rpc=async(name,args)=>{
    if(!casts[name])return rpc(name,args);
    try{
      const values=Object.values(args).map(v=>v&&typeof v==='object'?JSON.stringify(v):v);
      const out=await f.db.query(`select ${name}(${values.map((_,i)=>'$'+(i+1)+'::'+casts[name][i]).join(',')}) result`,values);
      return{data:out.rows[0].result,error:null};
    }catch(error){return{data:null,error:{code:error.code,message:error.message}};}
  };
  const imports={'node:crypto':crypto,'@/lib/supabase':{getSupabase:()=>f.client},'@/lib/fieldSales':f.sales,'@/lib/adminAuth':{corsHeaders:()=>({})}};
  const globals={process:{env:f.env},Buffer,Headers};
  f.earnings=evaluate('lib\\fieldEarnings.ts',imports,globals);imports['@/lib/fieldEarnings']=f.earnings;
  f.earningsRoute=evaluate('app\\api\\field-sales-earnings\\route.ts',imports,globals);
  f.routes={...f.routes,'field-sales-earnings':f.earningsRoute};
  f.request=(name,method='GET',body,actor='a',query='')=>{
    if(name!=='field-sales-earnings')return request(name,method,body,actor,query);
    return f.earningsRoute[method](new Request('https://fixture.invalid/api/'+name+query,{
      method,headers:{authorization:'Bearer '+actor,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
  };
  f.earningsRequest=(method='GET',body,actor='admin',query='')=>f.request('field-sales-earnings',method,body,actor,query);
  f.earningsCommand=async(body,actor='admin')=>{
    const response=await f.earningsRequest('POST',{operationId:crypto.randomUUID(),...body},actor),result=await response.json();
    return{response,result};
  };
  return f;
}
async function createEarningsFixture(){
  const f=await createCommerceFixture();
  try {
  await f.enable();await f.publish();await f.legal();
  const root=path.join(__dirname,'..','..','migrations'),launch=path.join(root,'045_field_sales_launch_contracts.sql');
  if(!fs.existsSync(launch))throw Error('045 launch contracts must exist before integrated earnings certification');
  await f.db.exec(`alter table h2s_pros add column email text unique;
    alter table h2s_dispatch_job_assignments add column offer_sent_at timestamptz,add column accepted_at timestamptz,add column declined_at timestamptz;
    create table if not exists h2s_dispatch_job_artifacts(
      artifact_id uuid primary key default gen_random_uuid(),job_id text not null,pro_id uuid not null,
      type text not null,url text not null,caption text,
      created_at timestamptz not null default now(),updated_at timestamptz not null default now());`);
  await f.db.exec(fs.readFileSync(path.join(root,'041_management_assignment.sql'),'utf8'));
  await f.db.exec(fs.readFileSync(path.join(root,'042_management_offer_reliability.sql'),'utf8'));
  await f.db.exec(fs.readFileSync(path.join(root,'046_field_sales_workflow.sql'),'utf8'));
  await f.db.exec(fs.readFileSync(path.join(root,'047_field_sales_earnings.sql'),'utf8'));
  const legal=id(920),commission=id(921),settlement=id(922);
  for(const [policyId,kind,definition] of [[legal,'legal',{}],[commission,'commission',commissionPolicy],[settlement,'settlement',settlementPolicy]])
    await f.db.query(`insert into field_sales_workflow_policies(policy_id,kind,status,definition,approved_by,approved_at,approval_evidence)
      values($1,$2,'approved',$3,$4,now(),$5)`,[policyId,kind,JSON.stringify(definition),id(9),JSON.stringify({fixture:'isolated synthetic approval only'})]);
  await f.db.query(`select field_sales_identity_command($1,$2,jsonb_build_object('userId',$3::text,
    'commissionStartDate',((now() at time zone 'America/New_York')::date-10)::text,
    'commissionStartEvidence','synthetic verified start','termsRevision',0))`,[id(9),crypto.randomUUID(),id(20)]);
  attachEarningsRoutes(f);
  const engine=f.earnings,request=f.earningsRequest,command=f.earningsCommand;
  async function order({completed=true,paid=true,fees=true,costsReviewed=true,expenses}={}){
    const leadId=await f.lead(),accepted=await f.accepted(leadId),quoteId=accepted.quoteId;
    const checkout=await(await f.post({action:'checkout',leadId,quoteId,kind:'full'})).json();
    if(!checkout.ok)throw Error(checkout.error);
    const sid=[...f.sessions.keys()].at(-1),receipt=f.paid(sid);
    if(paid){const res=await f.webhook('checkout.session.completed',receipt.session);if(res.status!==200)throw Error(await res.text());}
    // Isolated lifecycle setup: completion/receipt authority is certified separately by workflow tests.
    if(!paid){
      const quote=(await f.db.query('select * from field_sales_quotes where quote_id=$1',[quoteId])).rows[0];
      await f.db.query("insert into h2s_orders(id,order_id,total,currency,status) values($1,$2,100,'usd','pending')",[quote.order_uuid,'synthetic-unpaid-'+quoteId]);
      await f.db.query('insert into field_sales_orders(quote_id,lead_id,order_id) values($1,$2,$3)',[quoteId,leadId,quote.order_uuid]);
    }
    await f.db.query('update field_sales_checkouts set processing_fee_cents=$2,processing_fee_evidence=$3 where checkout_id=$1',[
      checkout.checkoutId,fees?300:null,fees?JSON.stringify({source:'synthetic provider verified fee'}):null]);
    const actualExpenses=expenses||[{category:'equipment',quantity:1,unitCents:2000,amountCents:2000,evidence:{reference:'actual invoice'},actual:true},
      {category:'materials',quantity:1,unitCents:500,amountCents:500,evidence:{reference:'actual invoice'},actual:true},
      {category:'wages',amountCents:200000,evidence:{reference:'hours'},actual:true}];
    const reviewed=completed&&costsReviewed;
    await f.db.query(`insert into field_sales_workflows(quote_id,lead_id,representative_id,credit_evidence,legal_policy_id,commission_policy_id,settlement_policy_id,
      deposit_cents,balance_cents,created_by,completed_at,completion_operation_id,completion_evidence,hours,expenses,verified_paid_at,fully_paid_event_id,
      commission_start_date,commission_start_evidence,technician_expenses,costs_complete,cost_review_evidence,cost_approved_by,cost_approved_at)
      values($1,$2,$3,'{"fixture":"immutable approved credit"}',$4,$5,$6,2500,7500,$7,$8,$9,'{"fixture":"completion proof"}',3,$10,$11,$12,
        (select commission_start_date from field_sales_representatives where user_id=$3),(select commission_start_evidence from field_sales_representatives where user_id=$3),
        $13,$14,$15,$16,$17)`,
      [quoteId,leadId,id(20),legal,commission,settlement,id(9),completed?new Date(Date.now()-60000).toISOString():null,
        completed?crypto.randomUUID():null,JSON.stringify(reviewed?actualExpenses:[]),
        paid?new Date(Date.now()-30000).toISOString():null,paid?'synthetic-payment-'+quoteId:null,
        JSON.stringify(actualExpenses),reviewed,reviewed?JSON.stringify({reference:'synthetic ADMIN actual cost review',actualCostsReviewed:true}):null,
        reviewed?id(9):null,reviewed?new Date().toISOString():null]);
    return{leadId,quoteId,checkoutId:checkout.checkoutId,receipt};
  }
  return{...f,request,command,engine,order,commissionPolicy,settlementPolicy,commission,settlement};
  } catch(error) { await f.db.close(); throw error; }
}
module.exports={createEarningsFixture,attachEarningsRoutes,id,commissionPolicy,settlementPolicy};
