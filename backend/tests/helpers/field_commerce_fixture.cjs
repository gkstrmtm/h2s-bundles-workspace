const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Stripe=require('stripe');
const {createSalesFixture,id}=require('./field_sales_fixture.cjs');
const {evaluate}=require('./commercial_operations_fixture.cjs');
const baseOffer=()=>({id:'standard',label:'Synthetic standard installation',enabled:true,unitCents:10000,basis:'per_unit',minimum:1,maximum:10,
  starting:false,equipment:['Fixture standard equipment'],scope:['Synthetic standard installation scope'],exclusions:['Unsurveyed structural work'],
  questions:[{id:'size',label:'Fixture size',type:'number',required:true,min:1,max:100},{id:'wall',label:'Fixture wall',type:'select',required:true,options:['drywall','masonry']}],
  options:[{id:'equipment_upgrade',label:'Synthetic equipment upgrade',amountCents:2500,perUnit:true,equipment:['Fixture upgraded equipment']}],
  qualifications:[{question:'wall',allowed:['drywall'],reason:'Masonry requires management review'}]});
async function createCommerceFixture(){
  const f=await createSalesFixture();await f.db.exec(fs.readFileSync(path.join(__dirname,'..','..','migrations','044_field_sales_transactions.sql'),'utf8'));
  const env={...f.env,H2S_FIELD_TRANSACTIONS_ENABLED:'true',H2S_FIELD_CUSTOMER_AGREEMENTS_ENABLED:'true',
    H2S_FIELD_STRIPE_TEST_SECRET_KEY:'sk_test_synthetic_fixture_only',H2S_FIELD_STRIPE_TEST_WEBHOOK_SECRET:'whsec_synthetic_fixture_only',
    H2S_FIELD_AGREEMENT_TOKEN_KEY:'synthetic-fixture-handoff-key-not-a-production-credential',H2S_FIELD_SALES_ORIGIN:'https://fixture.invalid'};
  const realRpc=f.client.rpc.bind(f.client),casts={field_sales_transaction_read:['uuid','uuid'],
    field_sales_transaction_command:['uuid','uuid','uuid','text','jsonb'],field_sales_customer_agreement:['text','jsonb'],
    field_sales_reserve_checkout:['uuid','uuid','uuid','uuid','text'],field_sales_record_receipt:['uuid','text','jsonb']};
  f.client.rpc=async(name,args)=>{
    if(!casts[name])return realRpc(name,args);
    try {const values=Object.values(args).map(v=>v&&typeof v==='object'?JSON.stringify(v):v);
      const out=await f.db.query(`select ${name}(${values.map((_,n)=>'$'+(n+1)+'::'+casts[name][n]).join(',')}) result`,values);
      return {data:out.rows[0].result,error:null};
    }catch(error){return {data:null,error:{code:error.code,message:error.message}};}
  };
  const sessions=new Map(),intents=new Map(),charges=new Map(),keys=new Map(),stripeCalls=[];
  const sdk=new Stripe('sk_test_synthetic_fixture_only');
  const provider={webhooks:sdk.webhooks,checkout:{sessions:{
    create:async(params,opts)=>{
      stripeCalls.push({method:'create',params,key:opts.idempotencyKey});
      if(keys.has(opts.idempotencyKey))return sessions.get(keys.get(opts.idempotencyKey));
      const sid='cs_test_fixture_'+keys.size;
      const session={id:sid,livemode:false,mode:'payment',currency:'usd',amount_total:params.line_items[0].price_data.unit_amount,
        client_reference_id:params.client_reference_id,metadata:params.metadata,status:'open',payment_status:'unpaid',
        payment_intent:null,url:'https://checkout.stripe.com/c/pay/'+sid};
      sessions.set(sid,session);keys.set(opts.idempotencyKey,sid);return session;
    },
    retrieve:async sid=>{stripeCalls.push({method:'retrieve',sid});if(!sessions.has(sid))throw Error('Unknown synthetic session');return sessions.get(sid);},
    list:async({payment_intent})=>({data:[...sessions.values()].filter(s=>s.payment_intent===payment_intent)})
  }},paymentIntents:{retrieve:async pid=>{if(!intents.has(pid))throw Error('Unknown synthetic intent');return intents.get(pid);}},
    charges:{retrieve:async cid=>{if(!charges.has(cid))throw Error('Unknown synthetic charge');return charges.get(cid);}}};
  const imports={'node:crypto':crypto,'@/lib/supabase':{getSupabase:()=>f.client},'@/lib/fieldSales':f.sales,
    '@/lib/commercial_business':f.business,'@/lib/adminAuth':{corsHeaders:()=>({})},stripe:class{constructor(){return provider;}}};
  const globals={process:{env},Buffer,Headers};
  const engine=evaluate('lib\\fieldQuote.ts',imports,globals);imports['@/lib/fieldQuote']=engine;
  const commerce=evaluate('lib\\fieldCommerce.ts',imports,globals);imports['@/lib/fieldCommerce']=commerce;
  imports['@/lib/customerAgreement.v1.json']=require('../../lib/customerAgreement.v1.json');
  imports['@/lib/customerAgreement.nc.v1.json']=require('../../lib/customerAgreement.nc.v1.json');
  imports['@/lib/fieldAgreement']=evaluate('lib\\fieldAgreement.ts',imports,globals);
  const routes=Object.fromEntries(['field-sales-transactions','field-sales-agreement','field-sales-stripe-webhook'].map(name=>
    [name,evaluate('app\\api\\'+name+'\\route.ts',imports,globals)]));
  const request=(name,method='GET',body,actor='a',query='')=>routes[name][method](new Request('https://fixture.invalid/api/'+name+query,
    {method,headers:{authorization:'Bearer '+actor,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}));
  const post=(body,actor='a')=>request('field-sales-transactions','POST',{operationId:crypto.randomUUID(),...body},actor);
  const catalogId=id(810),policyId=id(811);
  const definition={currency:'usd',validForMinutes:180,services:[
    {id:'tv_mounting',label:'Synthetic TV installation',markets:['residential','commercial'],offers:[baseOffer()]},
    {id:'equipment_cameras',label:'Synthetic equipment-inclusive cameras',markets:['residential','commercial'],offers:[{...baseOffer(),id:'package',basis:'package',unitCents:59900,minimum:2,maximum:2,starting:true}]},
    {id:'future_service',label:'Synthetic future service',markets:['residential','commercial'],offers:[{...baseOffer(),unitCents:null}]}]};
  async function enable(){
    await f.enable();await f.db.exec('update field_sales_transaction_settings set enabled=true');
    await f.db.query('insert into field_sales_catalogs(catalog_id,version,definition,source_evidence) values($1,$2,$3,$4)',
      [catalogId,'synthetic-v1',JSON.stringify(definition),JSON.stringify({status:'proposed_test_only',approvalEvidence:'Isolated synthetic approval, never production'})]);
  }
  const publish=()=>f.db.query("update field_sales_catalogs set status='published',approved_by=$1,published_at=now() where catalog_id=$2",[id(9),catalogId]);
  async function legal(){
    await f.db.query(`insert into field_sales_agreement_policies(policy_id,version,status,terms,cancellation_information,electronic_delivery,payment_terms,approval_evidence,approved_by,approved_at)
      values($1,'synthetic-legal-v1','approved','Synthetic test terms only','Synthetic test cancellation notice','Synthetic test electronic delivery notice','Synthetic test payment terms','Isolated fixture approval',$2,now())`,[policyId,id(9)]);
    await f.db.query('update field_sales_transaction_settings set agreement_policy_id=$1',[policyId]);
  }
  async function lead(){
    const response=await f.request('field-sales','POST',{action:'create',operationId:crypto.randomUUID(),fullName:'Synthetic customer',
      phone:'+1555'+String(Math.floor(1000000+Math.random()*8000000)),address:'100 Fixture Lane',city:'Fixture City',market:'residential',services:['tv_mounting'],notes:'',followUpAt:null},'a');
    const result=await response.json();if(!result.ok)throw Error(result.error);return result.leadId;
  }
  const lines=()=>[{serviceId:'tv_mounting',offerId:'standard',quantity:1,answers:{size:50,wall:'drywall'},options:[]}];
  async function quote(leadId,custom=lines()){
    const result=await (await post({action:'quote',leadId,catalogId,lines:custom})).json();if(!result.ok)throw Error(result.error);return result.id;
  }
  async function submit(leadId,quoteId){
    const result=await(await post({action:'submit',leadId,quoteId})).json();if(!result.ok)throw Error(result.error);return result.id;
  }
  async function accepted(leadId){
    const q=await submit(leadId,await quote(leadId));
    const prepared=await(await post({action:'agreement',leadId,quoteId:q})).json();if(!prepared.ok)throw Error(prepared.error);
    const token=new URLSearchParams(new URL(prepared.agreementUrl).hash.slice(1)).get('token');
    const facts=await(await request('field-sales-agreement','GET',null,token)).json();
    const body={operationId:crypto.randomUUID(),name:'Synthetic customer',email:'synthetic@example.invalid',accepted:true,electronicDelivery:true,
      quoteHash:facts.quote.quote_hash,policyVersion:facts.agreement.policy_snapshot.version};
    await historicalAcceptance(token,body);
    return {quoteId:q,token,body,agreementId:prepared.id};
  }
  // These pre-056 fixtures represent already-signed legacy records, not the new customer signature flow.
  const historicalAcceptance=(token,body)=>f.db.query('select field_sales_customer_agreement($1::text,$2::jsonb) result',
    [crypto.createHash('sha256').update(token).digest('hex'),JSON.stringify(body)]);
  function paid(sid){
    const session=sessions.get(sid),pid='pi_'+sid,cid='ch_'+sid;
    session.status='complete';session.payment_status='paid';session.payment_intent=pid;session.url=null;
    intents.set(pid,{id:pid,livemode:false,amount:session.amount_total,amount_received:session.amount_total,currency:'usd',status:'succeeded',metadata:session.metadata,latest_charge:cid});
    charges.set(cid,{id:cid,livemode:false,amount:session.amount_total,currency:'usd',paid:true,captured:true,disputed:false,amount_refunded:0,payment_intent:pid});
    return {session,intent:intents.get(pid),charge:charges.get(cid)};
  }
  const webhook=(type,object,eventId='evt_fixture_'+crypto.randomUUID(),overrides={})=>{
    const payload=JSON.stringify({id:eventId,type,livemode:false,data:{object},...overrides});
    const signature=sdk.webhooks.generateTestHeaderString({payload,secret:env.H2S_FIELD_STRIPE_TEST_WEBHOOK_SECRET});
    return routes['field-sales-stripe-webhook'].POST(new Request('https://fixture.invalid/api/field-sales-stripe-webhook',
      {method:'POST',headers:{'stripe-signature':signature},body:payload}));
  };
  return {...f,env,engine,commerce,routes,request,post,catalogId,definition,enable,publish,legal,lead,lines,quote,submit,accepted,
    sessions,intents,charges,keys,stripeCalls,paid,webhook,historicalAcceptance};
}
module.exports={createCommerceFixture,id,baseOffer};
