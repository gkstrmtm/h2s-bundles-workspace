const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.join(__dirname,'..');
class BusinessError extends Error { constructor(message,status=400) { super(message); this.status=status; } }
function load(file, imports={}, globals={}) {
  const module={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,URL,Request,Response,AbortController,TextDecoder,Date,JSON,
    setTimeout,clearTimeout,console,process:{env:{}},fetch:()=>{throw Error('Live network prohibited');},
    require(name){assert.ok(Object.hasOwn(imports,name),`Unexpected dependency ${name}`);return imports[name];},...globals},{filename:file});
  return module.exports;
}
const engine=load('lib\\forecast.ts',{'@/lib/commercial_business':{BusinessError}});
const research=load('lib\\forecastResearch.ts',{'@/lib/forecast':engine});
const service=load('lib\\forecastService.ts',{'@/lib/commercial_business':{BusinessError},'@/lib/forecast':engine,'@/lib/forecastResearch':research});
const capabilities={ai:{available:false,reason:'off'},research:{available:false,reason:'off'},catalog:{available:false,reason:'off'}};
const dependencies=(extra={})=>({capabilities:structuredClone(capabilities),catalog:[],...extra});
function scenario() {
  const s=engine.defaultForecastScenario(),m=s.markets[0];
  Object.assign(m,{id:'dallas',label:'Dallas',geography:{place:'Dallas',state:'Texas'},reps:0,repTenureDays:1,
    technicians:10,workDays:20,hoursPerDay:8,productiveBps:10000,travelMinutesPerJob:0,adBudgetCents:10000,cplCents:1000,
    repLeadsPerDay:0,organicLeads:0,bookingBps:10000,cancellationBps:0,completionBps:10000,
    processingBps:300,processingFixedCents:30,techHourlyCents:2000,techPerJobCents:0,overheadCents:1000,
    services:[{id:'tv',label:'TV',shareBps:10000,jobMinutes:60,ownership:'customer_owned',price:{kind:'hypothetical',amountCents:10001},materialsCents:1000}]});
  return s;
}
const run=(s,extra={})=>service.executeForecast({action:'calculate',scenario:s},dependencies(extra));
const base=result=>result.comparisons[0].cases.find(c=>c.name==='base').metrics;
test('default manual scenario executes honestly without AI, research, catalog or prices',async()=>{
  const result=await service.executeForecast({action:'calculate'},dependencies());
  assert.equal(result.ok,true);assert.equal(base(result).operatingProfitCents,null);
  assert.equal(base(result).bookedRevenueCents,null);
  assert.ok(result.comparisons[0].missing.some(s=>s.includes('Advertising')));
  await assert.rejects(service.executeForecast({action:'interpret',text:'Dallas vs Los Angeles'},dependencies()),e=>e.status===503);
});
test('exact integer cents: per-job deposit ceiling, balance, processing, commission and company identities',async()=>{
  const m=base(await run(scenario()));
  assert.equal(m.completedJobs,10); assert.equal(m.bookedRevenueCents,100010);
  assert.equal(m.bookedDepositCents,25010);assert.equal(m.completedBalanceCents,75000);
  assert.equal(m.cashCollectedCents,100010);assert.equal(m.processingCents,3600);
  assert.equal(m.materialsCents,10000);assert.equal(m.commissionBasisCents,86410);
  assert.equal(m.representativeCommissionCents,47526);assert.equal(m.technicianCompensationCents,20000);
  assert.equal(m.grossContributionCents,18884);assert.equal(m.operatingProfitCents,7884);
  assert.equal(m.completedRevenueCents-m.completedDepositCents,m.completedBalanceCents);
  assert.equal(m.depositsCollectedCents+m.balanceCollectionsCents,m.cashCollectedCents);
  assert.equal(m.grossContributionCents-m.adSpendCents-m.overheadCents,m.operatingProfitCents);
  assert.equal(m.cacCents,1000);assert.equal(m.breakEvenCacCents,1788);
});
test('representative 55/50/45 tenure projection excludes technician wages from commission basis',async()=>{
  const s=scenario();
  for(const [days,rate] of [[1,5500],[30,5500],[31,5000],[60,5000],[61,4500]]) {
    s.markets[0].repTenureDays=days;const b=base(await run(s));assert.equal(b.repRateBps,rate);assert.equal(b.commissionBasisCents,86410);
  }
  s.markets[0].repTenureDays=null;const b=base(await run(s));
  assert.equal(b.representativeCommissionCents,null);assert.equal(b.operatingProfitCents,null);assert.equal(b.breakEvenCacCents,null);
});
test('money ratios round half cents exactly rather than via binary floating point',async()=>{
  const s=scenario(),m=s.markets[0];m.adBudgetCents=1000;m.depositCollectedBps=7000;
  m.services[0].price.amountCents=177;
  const b=base(await run(s));assert.equal(b.bookedDepositCents,45);assert.equal(b.depositsCollectedCents,32);
  assert.equal(b.completedBalanceCents,132);
});
test('paid, rep prospecting and organic channels are distinct; reps are not technician capacity',async()=>{
  const s=scenario(),m=s.markets[0];
  Object.assign(m,{reps:5,repLeadsPerDay:2,organicLeads:30,technicians:1,workDays:20,hoursPerDay:1,travelMinutesPerJob:30});
  const b=base(await run(s));
  assert.equal(b.paidLeads,10);assert.equal(b.repLeads,200);assert.equal(b.totalLeads,240);
  assert.equal(b.bookings,240);assert.equal(b.capacityJobs,13);assert.equal(b.completedJobs,13);
  m.reps=10;assert.equal(base(await run(s)).capacityJobs,13);
});
test('cancellation, weighted capacity, travel and collection timing remain independent',async()=>{
  const s=scenario(),m=s.markets[0];
  Object.assign(m,{bookingBps:10000,cancellationBps:2000,completionBps:5000,depositCollectedBps:5000,balanceCollectedBps:0});
  m.sensitivities.best.completionBps=10000;m.sensitivities.downside.completionBps=4000;
  const b=base(await run(s));
  assert.equal(b.bookings,10);assert.equal(b.cancellations,2);assert.equal(b.completedJobs,4);
  assert.equal(b.bookedRevenueCents,80008);assert.equal(b.completedRevenueCents,40004);
  assert.equal(b.depositsCollectedCents,10004);assert.equal(b.balanceCollectionsCents,0);assert.equal(b.cashCollectedCents,10004);
  assert.ok(b.completedRevenueCents>b.cashCollectedCents);
});
test('service mix allocates whole jobs exactly and actual service minutes fit capacity',async()=>{
  const s=scenario(),m=s.markets[0];m.technicians=1;m.workDays=1;m.hoursPerDay=1;
  m.services=[{...m.services[0],shareBps:5000,jobMinutes:120},
    {...m.services[0],id:'camera',shareBps:5000,jobMinutes:1,price:{kind:'hypothetical',amountCents:20000}}];
  const b=base(await run(s));assert.equal(b.capacityJobs,0);assert.equal(b.completedJobs,0);
  m.hoursPerDay=2;const c=base(await run(s));assert.equal(c.capacityJobs,1);assert.equal(c.completedJobs,1);
});
test('missing BOM, customer-owned consumables, labor, processing, tenure or overhead never become zero profit',async()=>{
  for(const field of ['techHourlyCents','techPerJobCents','processingBps','processingFixedCents','repTenureDays','overheadCents']) {
    const s=scenario();s.markets[0][field]=null;const b=base(await run(s));assert.equal(b.operatingProfitCents,null,field);assert.equal(b.breakEvenCacCents,null,field);
  }
  for(const ownership of ['supplied','customer_owned']) {
    const s=scenario();s.markets[0].services[0].ownership=ownership;s.markets[0].services[0].materialsCents=null;
    assert.equal(base(await run(s)).materialsCents,null);assert.equal(base(await run(s)).operatingProfitCents,null);
  }
});
test('zero denominators return null and unknown acquisition cost propagates to demand',async()=>{
  const s=scenario();s.markets[0].adBudgetCents=0;
  assert.equal(base(await run(s)).cacCents,null);assert.equal(base(await run(s)).breakEvenCacCents,null);
  s.markets[0].adBudgetCents=10000;s.markets[0].cplCents=null;
  assert.equal(base(await run(s)).bookings,null);assert.equal(base(await run(s)).completedRevenueCents,null);
});
test('safe integer/range/schema validation rejects overflow, NaN, missing fields and arbitrary provenance',async()=>{
  for(const mutation of [
    m=>m.adBudgetCents=1.5,m=>m.adBudgetCents=Number.MAX_SAFE_INTEGER,m=>m.adBudgetCents=NaN,
    m=>m.bookingBps=10001,m=>m.reps=-1,m=>delete m.organicLeads,m=>m.services[0].price.provenance='approved',
    m=>m.services[0].shareBps=9999,m=>m.cplCents=0,m=>m.services[0].materialsCents=undefined,
  ]) {const s=scenario();mutation(s.markets[0]);await assert.rejects(run(s),e=>e.status===400);}
});
test('published catalog exact IDs rehydrate prices, no approved client amounts or proposed JSON imports',async()=>{
  const s=scenario(),row=s.markets[0].services[0];
  row.price={kind:'approved',amountCents:1,catalogId:'catalog-a',serviceId:'tv',offerId:'one'};
  const approved={catalogId:'catalog-a',version:'published-v1',digest:'a'.repeat(64),serviceId:'tv',offerId:'one',
    label:'TV one',amountCents:25001,markets:['residential'],equipment:[],starting:false,qualified:false};
  let r=await run(s,{catalog:[approved]});assert.equal(r.scenario.markets[0].services[0].price.amountCents,25001);
  r=await run(s);assert.equal(r.scenario.markets[0].services[0].price.amountCents,null);
  for(const patch of [{starting:true},{qualified:true},{markets:['commercial']},{offerId:'other'}])
    assert.equal((await run(s,{catalog:[{...approved,...patch}]})).scenario.markets[0].services[0].price.amountCents,null);
  row.ownership='supplied';row.equipmentSku='eufy S220 exact SKU';
  assert.equal((await run(s,{catalog:[{...approved,equipment:['generic camera']}]})).scenario.markets[0].services[0].price.amountCents,null);
  assert.equal((await run(s,{catalog:[{...approved,equipment:['eufy S220 exact SKU']}]})).scenario.markets[0].services[0].price.amountCents,25001);
});
test('existing baseline versus market proposal prices are independent, never geographically multiplied',async()=>{
  const s=scenario(),m=s.markets[0];m.baselineServices=structuredClone(m.services);m.baselineServices[0].price.amountCents=20000;
  const other=structuredClone(m);other.id='la';other.label='Los Angeles';other.geography={place:'Los Angeles',state:'California'};s.markets.push(other);
  const r=await run(s);assert.equal(r.comparisons.length,4);
  assert.equal(r.comparisons[0].cases[1].metrics.completedRevenueCents,200000);
  assert.equal(r.comparisons[1].cases[1].metrics.completedRevenueCents,100010);
  assert.equal(r.comparisons[3].cases[1].metrics.completedRevenueCents,100010);
});
test('sensitivity bounds prevent inverted demand/CPL/completion cases and explicit cases are monotonic',async()=>{
  const s=scenario(),r=await run(s),cases=r.comparisons[0].cases;
  assert.ok(cases[0].metrics.completedJobs<=cases[1].metrics.completedJobs);
  assert.ok(cases[1].metrics.completedJobs<=cases[2].metrics.completedJobs);
  assert.ok(cases[0].metrics.completedRevenueCents<=cases[1].metrics.completedRevenueCents);
  for(const mutate of [m=>m.sensitivities.best.demandBps=9999,m=>m.sensitivities.downside.cplBps=9999,
    m=>m.sensitivities.downside.completionBps=10001]) {const s=scenario();mutate(s.markets[0]);await assert.rejects(run(s));}
});
test('injected genuine conversational provider interprets Dallas vs Los Angeles 5 reps/$10k TV/eufy and patches only LA budget',async()=>{
  const initial=engine.defaultForecastScenario(),dallas=structuredClone(initial.markets[0]);
  Object.assign(dallas,{id:'dallas',label:'Dallas',geography:{place:'Dallas',state:'Texas'}});
  const la=structuredClone(dallas);Object.assign(la,{id:'la',label:'Los Angeles',geography:{place:'Los Angeles',state:'California'}});
  let calls=0;
  const deps=dependencies({capabilities:{...capabilities,ai:{available:true,reason:'injected'}},ai:{
    interpret:async input=>{calls++;assert.ok(!JSON.stringify(input).includes('catalogId'));
      return calls===1?{updates:[{marketId:'market-1',changes:{label:dallas.label,geography:dallas.geography}}],newMarkets:[la]}:
        {updates:[{marketId:'la',changes:{adBudgetCents:2000000}}]};},
    advise:async()=>({items:[{marketId:'la',reason:'costs',metric:'operatingProfitCents',observed:null}]})
  }});
  const first=await service.executeForecast({action:'interpret',text:'Compare Dallas and Los Angeles with 5 reps, $10k advertising, TV and supplied eufy installations.'},deps);
  assert.equal(first.scenario.markets.length,2);assert.equal(first.scenario.markets[0].reps,5);
  assert.equal(first.scenario.markets[1].adBudgetCents,1000000);assert.equal(first.scenario.markets[1].services[1].price.amountCents,null);
  const second=await service.executeForecast({action:'interpret',text:'Only double Los Angeles advertising; leave Dallas unchanged.',scenario:first.scenario},deps);
  assert.deepEqual(second.scenario.markets[0],first.scenario.markets[0]);
  assert.equal(second.scenario.markets[1].adBudgetCents,2000000);
  assert.ok(second.comparisons[1].advisory.some(a=>a.author==='ai'));
});
test('AI cannot invent approved sources, catalog IDs, facts, unknown fields, financial calculations or invalid schemas',async()=>{
  const outputs=[
    {updates:[{marketId:'dallas',changes:{sourceUrl:'https://invented.invalid'}}]},
    {updates:[{marketId:'dallas',changes:{reps:NaN}}]},
    {updates:[{marketId:'dallas',changes:{services:[{...scenario().markets[0].services[0],price:{kind:'approved',amountCents:1,catalogId:'fake'}}]}}]},
    {updates:[{marketId:'dallas',changes:{adBudgetCents:-1}}]},
    {updates:[],verifiedResearch:true},
    JSON.parse('{"updates":[{"marketId":"dallas","changes":{"__proto__":{"polluted":true}}}]}'),
  ];
  for(const output of outputs) {
    const deps=dependencies({capabilities:{...capabilities,ai:{available:true,reason:'test'}},ai:{interpret:async()=>output}});
    await assert.rejects(service.executeForecast({action:'interpret',text:'Review Dallas',scenario:scenario()},deps),e=>e.status===502);
  }
  assert.equal({}.polluted,undefined);
});
test('AI receives only rehydrated bounded approved numeric summary, never source IDs or internal records',async()=>{
  const s=scenario();s.markets[0].services[0].price={kind:'approved',amountCents:99999999,catalogId:'private-id',serviceId:'tv',offerId:'one'};
  let captured;
  const result=await service.executeForecast({action:'interpret',text:'Review only',scenario:s},dependencies({
    capabilities:{...capabilities,ai:{available:true,reason:'test'}},ai:{interpret:async input=>{captured=input;return {updates:[]};}}
  }));
  assert.ok(!JSON.stringify(captured).includes('private-id'));assert.ok(!JSON.stringify(captured).includes('99999999'));
  assert.equal(result.scenario.markets[0].services[0].price.amountCents,null);
});
test('AI may introduce an independently hypothetical baseline without modifying proposal prices',()=>{
  const s=scenario(),baseline=structuredClone(s.markets[0].services);baseline[0].price.amountCents=12000;
  const patched=service.applyForecastAiPatch(s,{updates:[{marketId:'dallas',changes:{baselineServices:baseline}}]});
  assert.equal(patched.markets[0].baselineServices[0].price.amountCents,12000);
  assert.equal(patched.markets[0].services[0].price.amountCents,10001);
});
test('invalid AI advisory cannot invent prose, finance or authoritative research',async()=>{
  const result=await service.executeForecast({action:'interpret',text:'Review',scenario:scenario()},dependencies({
    capabilities:{...capabilities,ai:{available:true,reason:'test'}},ai:{interpret:async()=>({updates:[]}),
      advise:async()=>({items:[{marketId:'dallas',reason:'costs',metric:'operatingProfitCents',observed:999999,text:'Verified profit'}]})}}));
  assert.ok(result.warnings.some(w=>w.includes('grounding')));assert.ok(result.comparisons[0].advisory.every(a=>a.author==='rules'));
});
function censusFetch({ambiguous=false,fail=false,large=false}={}) {
  const urls=[];
  return {urls,fetch:async(url,options)=>{
    urls.push(url);assert.equal(options.redirect,'manual');assert.equal(new URL(url).hostname,'api.census.gov');
    if(fail) throw Error('Offline');
    const u=new URL(url),get=u.searchParams.get('get'),geo=u.searchParams.get('for');
    let rows=geo==='state:*'?[['NAME','state'],['Texas','48'],['California','06']]:
      geo==='place:*'?[['NAME','state','place'],['Dallas city, Texas','48','19000'],
        ...(ambiguous?[['Dallas town, Texas','48','19001']]:[])]:
      [['NAME','B01003_001E','B11001_001E','B25003_001E','B25003_002E','B25001_001E','B25024_002E','state','place'],
        ['Dallas city, Texas','1300000','500000','500000','250000','550000','300000','48','19000']];
    if(get==='NAME'&&geo==='place:*') assert.equal(u.searchParams.get('in'),'state:48');
    return new Response(large?'x'.repeat(300):JSON.stringify(rows),{headers:{'content-type':'application/json'}});
  }};
}
test('official Census state/place resolution, source/year/timestamps, TTL caching and in-flight coalescing',async()=>{
  const stub=censusFetch();let now=Date.parse('2026-11-05T00:00:00Z');
  const provider=research.createCensusForecastProvider({enabled:true,fetch:stub.fetch,now:()=>now,ttlMs:1000});
  const [a,b]=await Promise.all([provider.research('Dallas','Texas'),provider.research('Dallas','Texas')]);
  assert.equal(stub.urls.length,3);assert.equal(a.facts.length,6);assert.equal(b.facts[0].value,1300000);
  assert.equal(a.facts[0].datasetYear,2024);assert.match(a.facts[0].sourceUrl,/api.census.gov/);assert.equal(a.facts[0].stale,false);
  assert.equal(a.facts[0].fetchedAt,new Date(now).toISOString());
  await provider.research('Dallas','Texas');assert.equal(stub.urls.length,3);
  now+=2000;await provider.research('Dallas','Texas');assert.equal(stub.urls.length,6);
});
test('synthetic Census key is sent only in requests, never source URLs, returned errors or cached fact metadata',async()=>{
  const key='synthetic-census-key-not-real',stub=censusFetch();
  const provider=research.createCensusForecastProvider({enabled:true,apiKey:key,fetch:async(url,options)=>{
    assert.equal(new URL(url).searchParams.get('key'),key);
    return stub.fetch(url,options);
  }});
  const first=await provider.research('Dallas','Texas'),second=await provider.research('Dallas','Texas');
  assert.equal(first.facts.length,6);assert.equal(stub.urls.length,3);
  assert.equal(JSON.stringify(first).includes(key),false);assert.equal(JSON.stringify(second).includes(key),false);
  for(const fact of second.facts) assert.equal(new URL(fact.sourceUrl).searchParams.has('key'),false);
  const failing=research.createCensusForecastProvider({enabled:true,apiKey:key,fetch:async(url)=>{
    assert.equal(new URL(url).searchParams.get('key'),key);throw Error('Network failed for '+url);
  }});
  const error=await failing.research('Dallas','Texas');
  assert.equal(error.facts.length,0);assert.equal(JSON.stringify(error).includes(key),false);
});
test('research default off, ambiguity, unavailable/oversized responses and stale dataset never invent multipliers',async()=>{
  const stub=censusFetch();
  const off=research.createCensusForecastProvider({enabled:false,fetch:stub.fetch});
  assert.equal((await off.research('Dallas','Texas')).facts.length,0);assert.equal(stub.urls.length,0);
  for(const options of [{ambiguous:true},{fail:true},{large:true}]) {
    const f=censusFetch(options),p=research.createCensusForecastProvider({enabled:true,fetch:f.fetch,maxBytes:200});
    const result=await p.research('Dallas','Texas');assert.equal(result.facts.length,0);assert.ok(result.missing.length);
  }
  const p=research.createCensusForecastProvider({enabled:true,fetch:stub.fetch,year:2020});
  assert.equal((await p.research('Dallas','Texas')).facts[0].stale,true);
});
test('research facts never implicitly set conversion, price, CPL or city multipliers',async()=>{
  const s=scenario(),manual=await run(s);
  const connected=await run(s,{capabilities:{...capabilities,research:{available:true,reason:'test'}},
    research:{research:async()=>({facts:[{name:'population',value:90000000,unit:'count',provenance:'market_fact',
      sourceUrl:'https://api.census.gov/data/2024/acs/acs5',dataset:'ACS',datasetYear:2024,fetchedAt:new Date().toISOString(),stale:false}],missing:[]})}});
  assert.deepEqual(base(manual),base(connected));
});
test('bounded research timeout and unavailable provider fail honestly with no live network',async()=>{
  let aborted=false;
  const provider=research.createCensusForecastProvider({enabled:true,timeoutMs:1,fetch:(_url,options)=>new Promise((resolve,reject)=>{
    options.signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'));},{once:true});
  })});
  const result=await provider.research('Dallas','Texas');assert.equal(aborted,true);assert.equal(result.facts.length,0);
  const response=await run(scenario(),{capabilities:{...capabilities,research:{available:true,reason:'test'}},
    research:{research:async()=>{throw Error('offline');}}});
  assert.ok(response.comparisons[0].missing.some(s=>s.includes('unavailable')));
});
test('official missing-key redirect is identified honestly and never followed or treated as market evidence',async()=>{
  let requests=0;
  const provider=research.createCensusForecastProvider({enabled:true,fetch:async(url,options)=>{
    requests++;assert.equal(options.redirect,'manual');assert.equal(new URL(url).hostname,'api.census.gov');
    return new Response(null,{status:302,headers:{location:'https://api.census.gov/data/missing_key.html'}});
  }});
  const result=await provider.research('Dallas','Texas');
  assert.equal(requests,1);assert.equal(result.facts.length,0);
  assert.match(result.missing[0],/requires a free API key/);
  assert.match(result.missing[0],/Metadata access does not verify/);
});
function routeFixture(env={}) {
  let writes=0,reads=0,aiCalls=0,researchConstructions=0;
  const route=load('app\\api\\forecast\\route.ts',{
    '@/lib/adminAuth':{corsHeaders:()=>({'Access-Control-Allow-Origin':'https://fixture.invalid'})},
    '@/lib/fieldSales':{BusinessError,salesChecked:r=>{if(r.error)throw new BusinessError('Catalog unavailable',503);return r.data;},
      salesActor:async request=>{const role=request.headers.get('authorization');if(!role)throw new BusinessError('Sign in',401);return {role,userId:'admin-id'};},
      salesAccess:async()=>{},
      readJson:async(request,limit)=>{const text=await request.text();if(Buffer.byteLength(text)>limit)throw new BusinessError('Too large',413);
        try{return JSON.parse(text);}catch{throw new BusinessError('Bad JSON');}}},
    '@/lib/supabase':{getSupabase:()=>({rpc:async name=>{if(name!=='field_sales_catalog_admin_read'){writes++;throw Error('write');}reads++;return {data:{catalogs:[],total:0},error:null};}})},
    '@/lib/fieldQuote':{validateQuoteCatalog:c=>c},'@/lib/forecast':engine,'@/lib/forecastService':service,
    '@/lib/forecastResearch':{...research,createCensusForecastProvider:options=>{
      researchConstructions++;return research.createCensusForecastProvider(options);
    }},'@/lib/forecastProviders':{createOpenAiForecastProvider:()=>{aiCalls++;return undefined;}},
  },{process:{env:{H2S_FORECAST_RESEARCH_ENABLED:'false',...env}}});
  const request=(method='GET',role='ADMIN',body)=>route[method](new Request('https://fixture.invalid/api/forecast',{
    method,headers:role?{authorization:role}:{},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  return {request,stats:()=>({writes,reads,aiCalls}),researchConstructions:()=>researchConstructions};
}
test('endpoint authenticates ADMIN, default GET supplies executable manual scenario and private CORS',async()=>{
  const f=routeFixture();
  assert.equal((await f.request('GET',null)).status,401);
  assert.equal((await f.request('GET','SALES')).status,403);
  assert.equal((await f.request('GET','VA')).status,403);
  const response=await f.request(),body=await response.json();
  assert.equal(response.status,200);assert.equal(body.capabilities.ai.available,false);
  assert.equal(body.scenario.markets[0].services[0].price.amountCents,null);
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://fixture.invalid');
  const calculate=await f.request('POST','ADMIN',{action:'calculate',scenario:body.scenario});assert.equal(calculate.status,200);
  assert.deepEqual(f.stats(),{writes:0,reads:0,aiCalls:0});
});
test('endpoint rejects oversized, invalid operations, unavailable interpret; catalog uses authorized read-only contract',async()=>{
  const f=routeFixture();
  assert.equal((await f.request('POST','ADMIN',{action:'calculate',text:'x'.repeat(70000)})).status,413);
  assert.equal((await f.request('POST','ADMIN',{action:'publish'})).status,400);
  assert.equal((await f.request('POST','ADMIN',{action:'interpret',text:'Compare cities'})).status,503);
  const enabled=routeFixture({H2S_FIELD_CATALOG_ADMIN_ENABLED:'true',H2S_FIELD_SALES_ENABLED:'true'});
  assert.equal((await enabled.request()).status,200);assert.deepEqual(enabled.stats(),{writes:0,reads:1,aiCalls:0});
});
test('enabled Census without server key is unavailable and Calculate never creates a failing research connector',async()=>{
  const f=routeFixture({H2S_FORECAST_RESEARCH_ENABLED:undefined});
  const response=await f.request(),body=await response.json();
  assert.equal(body.capabilities.research.available,false);assert.match(body.capabilities.research.reason,/Census key required/);
  assert.equal(body.capabilities.ai.available,false);
  for(let n=0;n<2;n++) assert.equal((await f.request('POST','ADMIN',{action:'calculate',scenario:scenario()})).status,200);
  assert.equal(f.researchConstructions(),0);
});
test('configured synthetic Census key enables connector without disclosure; explicit disable still wins',async()=>{
  const key='synthetic-server-census-key-not-real';
  const f=routeFixture({H2S_FORECAST_RESEARCH_ENABLED:undefined,CENSUS_API_KEY:key});
  const body=await (await f.request()).json();assert.equal(body.capabilities.research.available,true);
  assert.equal(JSON.stringify(body).includes(key),false);assert.equal(f.researchConstructions(),0);
  const calculated=await (await f.request('POST','ADMIN',{action:'calculate',scenario:scenario()})).json();
  assert.equal(calculated.ok,true);assert.equal(f.researchConstructions(),1);
  assert.equal(JSON.stringify(calculated).includes(key),false);
  assert.ok(calculated.comparisons[0].missing.some(s=>s.includes('unavailable')));
  const off=routeFixture({H2S_FORECAST_RESEARCH_ENABLED:'false',CENSUS_API_KEY:key});
  assert.equal((await (await off.request()).json()).capabilities.research.available,false);
  assert.equal(off.researchConstructions(),0);
});
test('OpenAI SDK provider is constructed only behind explicit forecast gate and existing key',()=>{
  let constructions=0,calls=0;
  class OpenAI {constructor(options){constructions++;assert.equal(options.maxRetries,0);this.chat={completions:{create:async()=>{calls++;throw Error('Paid call prohibited');}}};}}
  for(const env of [{},{OPENAI_API_KEY:'synthetic'},{H2S_FORECAST_AI_ENABLED:'true'}]) {
    const p=load('lib\\forecastProviders.ts',{'openai':OpenAI,'@/lib/commercial_business':{BusinessError},'@/lib/forecast':engine},{process:{env}});
    assert.equal(p.createOpenAiForecastProvider(),undefined);
  }
  assert.equal(constructions,0);assert.equal(calls,0);
  const p=load('lib\\forecastProviders.ts',{'openai':OpenAI,'@/lib/commercial_business':{BusinessError},'@/lib/forecast':engine},
    {process:{env:{H2S_FORECAST_AI_ENABLED:'true',OPENAI_API_KEY:'synthetic'}}});
  assert.ok(p.createOpenAiForecastProvider());assert.equal(constructions,1);assert.equal(calls,0);
});
