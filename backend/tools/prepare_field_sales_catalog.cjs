const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const catalogUrl='https://h2s-backend.vercel.app/api/bundles-data';
const slug=value=>String(value).replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase().replace(/[^a-z0-9_-]/g,'_').slice(0,79);
const cents=value=>{if(value===undefined||value===null)return null;const n=Math.round(Number(value)*100);if(!Number.isSafeInteger(n)||n<0||Math.abs(n-Number(value)*100)>0.00001)throw Error('Invalid source price');return n;};
const offer=(id,label,unitCents)=>({id,label,enabled:true,unitCents,basis:'package',minimum:1,maximum:1,starting:true,
  equipment:[],scope:['Exact installation scope requires management reconciliation and approval.'],exclusions:['Not a published or payable offer.'],
  questions:[{id:'survey',label:'Installation requirements and scope evidence',type:'text',required:true}],options:[],qualifications:[]});
function prepare(v2,storefront,checkedAt){
  if(v2.activationAllowed!==false||!v2.status?.includes('pending_approval')||storefront.ok!==true||!Array.isArray(storefront.services)||!Array.isArray(storefront.bundles))throw Error('Expected proposed v2 pricing and a successful storefront GET snapshot.');
  const proposed=[];
  for(const [category,groups] of Object.entries(v2.prices)){
    for(const [group,tiers] of Object.entries(groups)){
      if(!Array.isArray(tiers)||!tiers.length)throw Error('Unexpected price tier structure.');
      const market=group.startsWith('residential')?'residential':group.startsWith('commercial')?'commercial':null;
      if(!market)throw Error('Source market must be explicit.');
      const serviceId=slug(category+'_'+group);
      proposed.push({id:serviceId,label:category+' / '+group,markets:[market],offers:tiers.map((tier,index)=>{
        const o=offer('tier_'+index,group+' / '+(tier.quantity?`${tier.quantity} units`:`${tier.minInches||1}-${tier.maxInches||'larger'} inches`),cents(tier.price??tier.priceFrom));
        o.minimum=o.maximum=tier.quantity||1;
        if(tier.equipmentId)o.equipment=[tier.equipmentId];
        if(category==='tvMounting'){
          o.questions.push({id:'size',label:'TV size in inches',type:'number',required:true,min:tier.minInches||1,max:tier.maxInches||100000});
          if(group.includes('UpTo65Inches'))o.questions.at(-1).max=65;
          if(group.includes('WithStandardFixedMount')){
            o.equipment=[v2.costPolicy.tvMountEquipmentId];
            o.options=v2.addOns.filter(a=>a.price!==undefined&&a.replacesEquipmentId===v2.costPolicy.tvMountEquipmentId)
              .map(a=>({id:a.id,label:a.id,amountCents:cents(a.price),perUnit:true,equipment:[a.equipmentId],replacesEquipment:[a.replacesEquipmentId]}));
          }
        }
        return o;
      })});
    }
  }
  const services=storefront.services.map(s=>({id:slug(s.service_id||s.id),label:s.name||s.label||s.service_id||s.id,markets:[],
    offers:[offer('scope_review','Scope and approved pricing required',null)]}));
  const bundles=storefront.bundles.map(b=>offer(slug(b.bundle_id||b.id),b.name||b.label||b.bundle_id||b.id,cents(b.price)));
  if(bundles.length)services.push({id:'observed_storefront_bundles',label:'Observed storefront bundles (not proposed equipment packages)',markets:[],offers:bundles});
  const evidence={checkedAt,catalogUrl,approvalEvidence:null,unresolved:[
    'Reconcile current storefront, modal, calculator and proposed v2 prices independently.',
    'Confirm equipment, compatible replacement SKUs, scope, exclusions, tax jurisdiction and final customer total.',
    'No approved commercial storefront market mapping; observed markets remain empty until verified.',
    'Resolve multi-TV discounts and unpriced add-ons; do not infer missing prices.',
    'Keep proposed two-solar-camera $599 offer distinct from the $599 storefront doorbell bundle.',
    'Set quote validity and obtain explicit catalog publication approval; this tool cannot publish.'
  ]};
  const draft=(suffix,definition,source)=>({catalog_id:crypto.randomUUID(),version:'field-review-'+checkedAt.replace(/[^0-9]/g,'')+'-'+suffix,status:'draft',
    definition:{currency:'usd',validForMinutes:null,services:definition},source_evidence:{...evidence,...source}});
  return {mode:'review_only_no_database_writes',catalogs:[
    draft('v2',proposed,{source:'config/pricing/home2smart.v2.json',status:v2.status,sha256:crypto.createHash('sha256').update(JSON.stringify(v2)).digest('hex')}),
    draft('storefront',services,{source:catalogUrl,status:'observed_not_approved'})
  ]};
}
async function main(){
  const input=process.argv[2];if(input&&process.argv.length!==3)throw Error('Usage: node prepare_field_sales_catalog.cjs [storefront-snapshot.json]');
  const v2=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','config','pricing','home2smart.v2.json'),'utf8'));
  let storefront;
  if(input)storefront=JSON.parse(fs.readFileSync(path.resolve(input),'utf8'));
  else{const response=await fetch(catalogUrl,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Storefront catalog GET failed: '+response.status);storefront=await response.json();}
  console.log(JSON.stringify(prepare(v2,storefront,new Date().toISOString()),null,2));
}
if(require.main===module)main().catch(error=>{console.error('Draft catalog preparation failed:',error.message);process.exitCode=1;});
module.exports={prepare};
