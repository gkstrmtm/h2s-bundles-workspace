'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function cents(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw Error('Explicit source price is required');
  const result=Math.round(value*100);
  if(!Number.isSafeInteger(result)||Math.abs(result-value*100)>0.000001)throw Error('Source price must resolve to whole cents');
  return result;
}
function buildStagingSalesConfig(root=path.resolve(__dirname,'..','..')){
  const sources=['config\\pricing\\source\\pricing.v1.json','config\\pricing\\equipment.v1.json'].map(relative=>{
    const bytes=fs.readFileSync(path.join(root,relative)),data=JSON.parse(bytes);
    return{data,evidence:{path:relative,status:data.status,sha256:sha256(bytes)}};
  });
  const pricing=sources[0].data,equipment=sources[1].data;
  const base=(id,label,amount,basis,minimum,maximum,starting,included,questions=[])=>({
    id,label:'STAGING ONLY - '+label,enabled:true,unitCents:amount,basis,minimum,maximum,starting,
    equipment:included,scope:['Source residential installation scope; synthetic certification only'],
    exclusions:['Unsurveyed structural, electrical or nonstandard work; no production scope approval'],
    questions,options:[],qualifications:[],
  });
  const tv=[];
  for(const[key,tiers]of Object.entries(pricing.prices.tvMounting)){
    if(!key.startsWith('residential')||!Array.isArray(tiers))continue;
    for(const tier of tiers){
      const fixed=key==='residentialWithStandardFixedMount',min=tier.minInches||1,max=tier.maxInches;
      tv.push(base('tv_'+(fixed?'fixed':'install')+'_'+min+'_'+(max||'plus'),
        (fixed?'Fixed mount':'Installation only')+' '+min+'-'+(max||'plus')+' inches',
        tier.price===undefined?null:cents(tier.price),'per_unit',1,100,Boolean(tier.quoteRequired),
        fixed?['Source standard fixed mount; compatibility must be assessed']:['Customer-supplied compatible mount'],
        [{id:'size',label:'Assessed TV diagonal inches',type:'number',required:true,min,...(max?{max}:{})}]));
    }
  }
  const cameras=[];
  for(const[kind,rows]of [['install',pricing.prices.cameras.residentialWirelessInstallationOnly],
    ['included',pricing.prices.cameras.residentialEquipmentIncluded]]){
    for(const row of rows)cameras.push(base('camera_'+kind+'_'+row.quantity,
      row.quantity+' wireless cameras '+kind,cents(row.price??row.priceFrom),'package',row.quantity,row.quantity,
      row.priceFrom!==undefined,kind==='included'?['Source equipment-included package; exact SKU needs scope review']:['Customer-supplied cameras']));
  }
  const proof=prefix=>[
    {id:prefix+'_photo',label:'SYNTHETIC completed installation screenshot',type:'photo',minimumCount:1},
    {id:prefix+'_signature',label:'SYNTHETIC customer completion signature',type:'signature',minimumCount:1},
    {id:prefix+'_check',label:'SYNTHETIC scope and handoff verified',type:'checklist',minimumCount:1},
  ];
  const definition={currency:'usd',validForMinutes:180,services:[
    {id:'tv_mounting',label:'STAGING ONLY - TV mounting',markets:['residential'],offers:tv,completionRequirements:proof('tv')},
    {id:'equipment_cameras',label:'STAGING ONLY - Cameras',markets:['residential'],offers:cameras,completionRequirements:proof('camera')},
  ]};
  const mount=equipment.items.find(item=>item.id==='onn_fixed_32_86');
  const consumables=equipment.costAllowances.find(item=>item.id==='extra_tv_consumables');
  if(!mount||!consumables)throw Error('Existing equipment cost assumptions are required');
  return{version:'STAGING-ONLY-source-'+sources[0].evidence.sha256.slice(0,12),definition,
    sourceEvidence:{stagingOnly:true,productionApproved:false,sources:sources.map(source=>source.evidence),
      technicalQuoteQuantityLimit:100,quoteExpirySource:'Existing field_commerce_fixture 180-minute technical test capability; not production approval'},
    costAssumptions:{estimated:true,actualReceipt:false,fixedMountCents:cents(mount.costAssumption.amount),
      consumablesPerTvCents:cents(consumables.amountPerTv),sourceStatus:equipment.status},
    lines:{tv:{serviceId:'tv_mounting',offerId:'tv_fixed_56_65',quantity:1,answers:{size:60},options:[]},
      camera:{serviceId:'equipment_cameras',offerId:'camera_included_2',quantity:2,answers:{},options:[]}},
  };
}
module.exports={buildStagingSalesConfig};
