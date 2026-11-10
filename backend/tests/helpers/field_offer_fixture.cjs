const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {createCommerceFixture,baseOffer,id}=require('./field_commerce_fixture.cjs');
const {evaluate}=require('./commercial_operations_fixture.cjs');
const pricingRoot=path.resolve(__dirname,'..','..','..','config','pricing');
function offerImports(sales,engine) {
  return {'node:crypto':crypto,'@/lib/fieldSales':sales,'@/lib/fieldQuote':engine,
    ...Object.fromEntries(['equipment.v1.json','residential-cameras.v1.json','field-offer-knowledge.v1.json','home2smart.v2.json','offers/residential/v5-launch-proposed.json','camera-recommendations.cjs']
      .map(name=>['../../config/pricing/'+name,require(path.join(pricingRoot,...name.split('/')))]))};
}
function answers() {
  return {schemaVersion:1,step:0,services:['tv'],tvQuantity:1,cameraQuantity:null,catalogId:null,
    tvs:[{location:'Living room',size:60,weight:45,vesaWidth:400,vesaHeight:200,ownership:'supplied',mountStyle:'fixed',surface:'drywall',concealment:'external',compatibilityVerified:true}],
    cameras:[],preferences:{priority:'balanced',storage:'no_preference',homebaseType:'homebase_s380'},
    existingHub:{type:'none',compatibilityVerified:null,availableCameraSlots:null},hubRouterConnectionConfirmed:null,quoteAnswers:{}};
}
function camera(index=0,overrides={}) {
  return {id:'camera_'+(index+1),coverage:['front_door'],outdoor:true,coveragePositionVerified:true,sunlightSuitable:true,directSunHours:3,batteryMaintenanceAccepted:true,
    c31PowerCompatible:false,floodlightPowerCompatible:false,wifiConfirmed:true,homebaseLinkConfirmed:null,mountingCompatible:true,standardInstallation:true,
    requiredFeatures:[],preferredEquipmentId:'eufy_solocam_s220',ownership:'supplied',recording:'events',storageVerified:true,equipmentCompatibilityVerified:true,...overrides};
}
function catalogDefinition() {
  const tvOffers=[];
  for(const [min,max,price] of [[19,43,16000],[44,55,17000],[56,65,19900],[66,75,23000],[76,85,28500]]) {
    for(const ownership of ['supplied','customer']) tvOffers.push({...baseOffer(),id:`tv_${ownership==='supplied'?'fixed':'install'}_${min===19?1:min}_${max}`,
      label:`Synthetic ${ownership} TV ${min}-${max}`,unitCents:price,minimum:1,maximum:100,
      equipment:ownership==='supplied'?['ONN fixed mount, 32-86 inches']:['Verified customer-owned compatible mount'],
      questions:[{id:'size',label:'TV diagonal inches',type:'number',required:true,min,max}],qualifications:[],
      guidance:{kind:'tv',ownership,mountStyle:'fixed',...(ownership==='supplied'?{equipmentId:'onn_fixed_32_86'}:{})},
      options:ownership==='supplied'?[
        {id:'tilt',label:'Configured synthetic tilt upgrade',amountCents:2000,perUnit:true,equipment:['ONN tilt mount, 50-86 inches'],replacesEquipment:['ONN fixed mount, 32-86 inches'],
          guidance:{mountStyle:'tilt',equipmentId:'onn_tilt_50_86'}},
        {id:'motion',label:'Configured synthetic full-motion upgrade',amountCents:6500,perUnit:true,equipment:['ONN full-motion mount, 50-86 inches'],replacesEquipment:['ONN fixed mount, 32-86 inches'],
          guidance:{mountStyle:'full_motion',equipmentId:'onn_full_motion_50_86'}}]:[]});
  }
  const cameraOffer=(id,model,ownership,basis,price,min,max)=>({...baseOffer(),id,label:'Synthetic '+model+' '+ownership,unitCents:price,basis,minimum:min,maximum:max,
    equipment:[model],questions:[],options:[],qualifications:[],starting:false,guidance:{kind:'camera',ownership,...(ownership==='supplied'?{equipmentId:model}:{})}});
  return {currency:'usd',validForMinutes:180,services:[
    {id:'tv_mounting',label:'Synthetic TV installation',markets:['residential'],offers:tvOffers,
      tvMarginalDiscounts:{basis:'highest_base_price_first_marginal',percentsByPosition:[0,10,15],eligibleOfferIds:tvOffers.map(offer=>offer.id)}},
    {id:'equipment_cameras',label:'Synthetic cameras',markets:['residential'],offers:[
      cameraOffer('s220_pair','eufy_solocam_s220','supplied','package',59900,2,2),
      cameraOffer('c31','eufy_wired_cam_c31','supplied','per_unit',31900,1,4),
      cameraOffer('owned','customer cameras','customer','per_unit',12900,1,4)]}
  ]};
}
async function createOfferFixture() {
  const f=await createCommerceFixture();
  await f.db.exec(fs.readFileSync(path.join(__dirname,'..','..','migrations','058_field_sales_offer_assistant.sql'),'utf8'));
  await f.db.exec(fs.readFileSync(path.join(__dirname,'..','..','migrations','059_field_sales_offer_business_conflicts.sql'),'utf8'));
  const original=f.client.rpc,casts={field_sales_offer_read:['uuid','uuid'],field_sales_offer_save:['uuid','uuid','uuid','integer','jsonb'],
    field_sales_offer_quote:['uuid','uuid','uuid','integer','text','jsonb'],field_sales_offer_reference:['uuid','uuid','uuid','boolean','jsonb']};
  f.client.rpc=async(name,args)=>{
    if(!casts[name])return original(name,args);
    try {
      const values=Object.values(args).map(value=>value&&typeof value==='object'?JSON.stringify(value):value);
      const result=await f.db.query(`select ${name}(${values.map((_,index)=>'$'+(index+1)+'::'+casts[name][index]).join(',')}) result`,values);
      return {data:result.rows[0].result,error:null};
    } catch(error) {return {data:null,error:{code:error.code,message:error.message}};}
  };
  const ai={requests:[],entryIds:['recording_and_storage'],error:null,finishReason:'stop',extra:null};
  class Provider {
    static APIError=class extends Error {};
    constructor(){this.chat={completions:{create:input=>({withResponse:async()=>{
      ai.requests.push(input);if(ai.error)throw ai.error;
      return {response:new Response('{}',{status:200}),data:{model:'synthetic-provider',usage:{total_tokens:42},
        choices:[{finish_reason:ai.finishReason,message:{content:JSON.stringify(ai.extra || {entryIds:ai.entryIds})}}]}};
    }})}};}
  }
  const imports={...offerImports(f.sales,f.engine),'@/lib/supabase':{getSupabase:()=>f.client},'@/lib/fieldCommerce':f.commerce,
    '@/lib/adminAuth':{corsHeaders:()=>({})},openai:Provider};
  const globals={process:{env:f.env},Buffer,Headers};
  const offer=evaluate('lib\\fieldOffer.ts',imports,globals);imports['@/lib/fieldOffer']=offer;
  const route=evaluate('app\\api\\field-sales-offers\\route.ts',imports,globals);
  const request=(method='GET',body,actor='a',leadId)=>route[method](new Request('https://fixture.invalid/api/field-sales-offers'+(method==='GET'?'?leadId='+leadId:''),
    {method,headers:{authorization:'Bearer '+actor,'content-type':'application/json'},...(body?{body:JSON.stringify({operationId:crypto.randomUUID(),...body})}:{})}));
  const baseEnable=f.enable;
  f.enable=async()=>{
    await baseEnable();f.definition.services=catalogDefinition().services;
    await f.db.query('update field_sales_catalogs set definition=$1 where catalog_id=$2',[JSON.stringify(f.definition),f.catalogId]);
  };
  const save=async(leadId,data=answers(),revision=0,extra={})=>{
    data.catalogId=f.catalogId;
    const catalog=(await(await request('GET',null,'a',leadId)).json()).catalogs.find(c=>c.catalog_id===f.catalogId);
    return request('POST',{action:'save',leadId,revision,answers:data,stage:'recommendation',knowledgeHash:offer.offerKnowledgeHash,catalogHash:catalog.digest,...extra});
  };
  return {...f,offer,offerRequest:request,save,ai};
}
module.exports={createOfferFixture,offerImports,answers,camera,catalogDefinition,id};
