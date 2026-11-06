const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const ts=require('typescript');
const source=fs.readFileSync(path.join(__dirname,'..','frontend','forecast-assistant.js'),'utf8');
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const scenario=()=>({version:1,markets:[]});
const capabilities={ai:{available:false,reason:'AI requires separate authorization'},research:{available:false,reason:'No live research connection'}};
const initial=()=>({ok:true,scenario:scenario(),capabilities});
const calculated=()=>({...initial(),warnings:['Hypothetical inputs only'],comparisons:[{
    market:'Dallas <img src=x onerror=alert(1)>',confidence:'Limited',missing:['Equipment cost unavailable'],
    recommendations:['Review installation capacity'],evidence:[],
    cases:['downside','base','best'].map(name=>({name,metrics:{bookedRevenueCents:10000,cashCollectedCents:2500,operatingProfitCents:null}}))
}]});
function fixture(t){
    const dom=new JSDOM('<main id="root"></main>',{runScripts:'outside-only',url:'https://fixture.invalid'});
    t.after(()=>dom.window.close());const w=dom.window,calls=[];
    w.console.error=()=>{};
    w.confirm=()=>true;
    w.fetch=async(url,init)=>{calls.push({url,init});return Response.json(initial());};
    w.eval(source);
    let token='synthetic-admin',admin=true;
    const root=w.document.getElementById('root'),options={endpoint:'https://fixture.invalid/api/forecast',getToken:()=>token,isAdmin:()=>admin};
    const mount=()=>w.H2SForecast.mount(root,options);
    return {w,root,calls,mount,options,setToken:value=>{token=value;},setAdmin:value=>{admin=value;},
        click:text=>[...root.querySelectorAll('button')].find(button=>button.textContent===text).click()};
}
function canonicalInitial() {
    const businessPolicy=require('../backend/lib/generated/forecastBusinessPolicy.json'),s=JSON.parse(JSON.stringify(businessPolicy.operatingDefaults));
    const services=businessPolicy.defaultServices.map(row=>{
        const offer=businessPolicy.offers.find(offer=>offer.id===row.policyOfferId);
        return {...row,label:offer.label,ownership:offer.ownership,equipmentSku:offer.equipmentSku,materialsCents:null,
            price:{kind:'canonical',amountCents:offer.amountCents,policyOfferId:offer.id}};
    });
    return {...initial(),businessPolicy,scenario:{version:1,policyMode:'canonical_v2',markets:[{...s,id:'market-1',label:'Greenville',
        geography:{place:'Greenville',state:'South Carolina'},context:{property:'residential',propertyTypes:['homeowner'],zones:['city'],season:'all_year'},
        sensitivities:{downside:{demandBps:8000,cplBps:12000,completionBps:9000},best:{demandBps:12000,cplBps:8000,completionBps:10000}},services}]}};
}
test('canonical business source and exact scopes are automatic, protected and editable only via explicit custom mode',async t=>{
    const f=fixture(t),data=canonicalInitial();
    f.w.fetch=async(url,init)=>{f.calls.push({url,init});return Response.json(data);};
    await f.mount();f.click('Assumptions & Sources');
    assert.match(f.root.textContent,/home2smart\.v2\.json/);
    assert.match(f.root.textContent,/25% deposit/);assert.match(f.root.textContent,/company-held money/i);
    assert.equal(f.root.querySelectorAll('[aria-label="Canonical V2 service scope"]').length,2);
    assert.equal(f.root.querySelector('[aria-label="Price source"]'),null);
    assert.equal(f.root.querySelector('[aria-label="Estimated processing variable fee (%)"]').readOnly,true);
    f.click('Use an explicit custom hypothesis instead');
    assert.match(f.root.textContent,/Explicit custom hypothesis/);
    assert.equal(f.root.querySelectorAll('[aria-label="Canonical V2 service scope"]').length,0);
    assert.equal(f.root.querySelector('[aria-label="Estimated processing variable fee (%)"]').readOnly,false);
    f.click('Calculate reviewed assumptions');await settle();
    const sent=JSON.parse(f.calls.at(-1).init.body).scenario;
    assert.equal(sent.policyMode,'hypothetical');assert.ok(sent.markets[0].services.every(row=>row.price.kind==='hypothetical'));
});
test('canonical offer selection preserves exact IDs without exposing editable price/material controls',async t=>{
    const f=fixture(t),data=canonicalInitial();
    f.w.fetch=async(url,init)=>{f.calls.push({url,init});return Response.json(data);};
    await f.mount();f.click('Assumptions & Sources');
    const select=f.root.querySelector('[aria-label="Canonical V2 service scope"]');
    const offer=data.businessPolicy.offers.find(row=>row.id==='tvMounting.residentialWithStandardFixedMount.66-75');
    assert.ok(offer);
    select.value=offer.id;select.dispatchEvent(new f.w.Event('change',{bubbles:true}));
    f.click('Calculate reviewed assumptions');await settle();
    const sent=JSON.parse(f.calls.at(-1).init.body).scenario;
    assert.equal(sent.policyMode,'canonical_v2');assert.equal(sent.markets[0].services[0].price.policyOfferId,offer.id);
    assert.equal(sent.markets[0].services[0].price.amountCents,offer.amountCents);
});
test('changing canonical property market immediately refreshes scope choices without guessing replacement prices',async t=>{
    const f=fixture(t),data=canonicalInitial();
    f.w.fetch=async()=>Response.json(data);
    await f.mount();f.click('Assumptions & Sources');
    assert.equal(f.root.querySelector('[aria-label="Representative tenure (days)"]').readOnly,true);
    const market=f.root.querySelector('[aria-label="Property / catalog market"]');
    market.value='commercial';market.dispatchEvent(new f.w.Event('change',{bubbles:true}));
    const scope=f.root.querySelector('[aria-label="Canonical V2 service scope"]');
    assert.equal(scope.value,'');
    assert.ok([...scope.options].filter(option=>option.value).every(option=>option.value.includes('.commercial')));
    assert.match(f.root.textContent,/Prices are never silently substituted/);
});
test('Describe Your Scenario opens without an AI call and states unavailable connections honestly',async t=>{
    const f=fixture(t);await f.mount();
    assert.equal(f.calls.length,1);assert.equal(f.calls[0].init.method,'GET');
    assert.equal(f.calls[0].init.headers.Authorization,'Bearer synthetic-admin');
    assert.match(f.root.textContent,/Describe Your Scenario/);
    assert.match(f.root.textContent,/separate authorization/);
    assert.match(f.root.textContent,/No live research connection/);
    assert.equal(f.w.localStorage.length,0);
    assert.ok(f.root.querySelector('#forecastMainGrid'));
});
test('calculated unknowns, comparison results, source limitations and model strings render safely',async t=>{
    const f=fixture(t);await f.mount();
    const scroll=[];
    f.w.HTMLElement.prototype.scrollIntoView=function(options){scroll.push(options);};f.w.scrollBy=()=>{};
    const result=calculated();
    result.comparisons[0].evidence=[
        {name:'fixture_households',value:123,unit:'households',dataset:'Synthetic Census fixture',datasetYear:2024,fetchedAt:'2026-11-05T00:00:00.000Z',sourceUrl:'https://api.census.gov/data/2024/acs/acs5'},
        {name:'unsupported_source',value:1,sourceUrl:'javascript:alert(1)'}
    ];
    f.w.fetch=async(url,init)=>{f.calls.push({url,init});return Response.json(result);};
    f.click('Calculate reviewed assumptions');await settle();
    assert.equal(f.calls.filter(call=>call.init.method==='POST').length,1);
    assert.match(f.root.textContent,/\$100\.00/);assert.match(f.root.textContent,/\$25\.00/);
    assert.match(f.root.textContent,/Not available/);assert.match(f.root.textContent,/Equipment cost unavailable/);
    assert.equal(f.root.querySelectorAll('img').length,0);
    assert.equal(scroll[0].behavior,'instant');assert.equal(f.w.document.activeElement.id,'forecastMainGrid');
    f.click('Market Intelligence');assert.match(f.root.textContent,/Synthetic Census fixture.*2024/);
    assert.match(f.root.textContent,/Retrieved 2026-11-05/);
    assert.equal(f.root.querySelectorAll('a[href^="https:"]').length,1);
    assert.equal(f.root.querySelectorAll('a[href^="javascript:"]').length,0);
    assert.match(f.root.textContent,/do not treat this as verified market intelligence/);
});
test('conversational refinement includes the previous scenario and conversation without duplicate requests',async t=>{
    const f=fixture(t);await f.mount();let resolve;
    f.w.fetch=(url,init)=>{f.calls.push({url,init});return new Promise(done=>{resolve=done;});};
    f.root.querySelector('textarea').value='Compare Dallas and Los Angeles';
    f.click('Analyze with AI');f.click('Analyze with AI');
    assert.equal(f.calls.filter(call=>call.init.method==='POST').length,1);
    resolve(Response.json(calculated()));await settle();
    f.w.fetch=async(url,init)=>{f.calls.push({url,init});return Response.json(calculated());};
    f.root.querySelector('textarea').value='Change only Dallas advertising to $5000';
    f.click('Analyze with AI');await settle();
    const body=JSON.parse(f.calls.at(-1).init.body);
    assert.equal(body.action,'interpret');assert.equal(body.conversation.length,2);
    assert.deepEqual(body.scenario,scenario());
    f.click('Scenario Workspace');assert.match(f.root.textContent,/Change only Dallas/);
    for(let i=0;i<8;i++){
        f.root.querySelector('textarea').value=i===0?'x'.repeat(3000):'Refine only the advertising assumption '+i;
        f.click('Analyze with AI');await settle();
        const turn=JSON.parse(f.calls.at(-1).init.body);
        assert.ok(turn.conversation.length<=12);
        assert.ok(turn.conversation.every(item=>item.content.length<=2000));
    }
    assert.equal(JSON.parse(f.calls.at(-1).init.body).conversation.length,12);
});
test('edits made during an interpretation are not replaced by a late scenario response',async t=>{
    const f=fixture(t);await f.mount();let resolve;
    f.w.fetch=()=>new Promise(done=>{resolve=done;});
    const input=f.root.querySelector('textarea');input.value='Initial scenario';
    f.click('Analyze with AI');
    input.value='New management request';input.dispatchEvent(new f.w.Event('input',{bubbles:true}));
    resolve(Response.json(calculated()));await settle();
    assert.equal(input.value,'New management request');
    assert.match(f.root.textContent,/Inputs changed while this request/);
    assert.doesNotMatch(f.root.textContent,/Dallas <img/);
});
test('admin denial, changed sessions, failed reads and missing response shapes never become success',async t=>{
    const f=fixture(t);f.setAdmin(false);await f.mount();assert.equal(f.calls.length,0);
    assert.match(f.root.textContent,/Administrator sign-in/);
    f.setAdmin(true);f.w.fetch=async()=>Response.json({ok:false,error:'Synthetic unavailable'},{status:503});
    await f.mount();assert.match(f.root.textContent,/Synthetic unavailable/);
    f.w.fetch=async()=>Response.json({ok:true,capabilities});f.click('Retry Forecast connection');await settle();
    assert.match(f.root.textContent,/incomplete scenario/);
    f.w.fetch=async()=>Response.json(initial());f.click('Retry Forecast connection');await settle();
    let resolve;f.w.fetch=()=>new Promise(done=>{resolve=done;});
    f.root.querySelector('textarea').value='Sensitive management scenario';f.click('Analyze with AI');
    f.setToken('another-session');resolve(Response.json(calculated()));await settle();
    assert.equal(f.root.querySelector('textarea').value,'');
    assert.doesNotMatch(f.root.textContent,/Dallas <img/);
    assert.match(f.root.textContent,/sign-in changed/);
});
test('contextual tabs support keyboard navigation and retained scenarios survive same-session remounts',async t=>{
    const f=fixture(t);await f.mount();const tabs=f.root.querySelector('[role=tablist]');
    tabs.querySelector('[aria-selected=true]').focus();
    tabs.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'End',bubbles:true}));
    assert.equal(f.root.querySelector('[aria-selected=true]').textContent,'Assumptions & Sources');
    await f.mount();assert.equal(f.calls.length,1);
    assert.equal(f.root.querySelector('[aria-selected=true]').textContent,'Assumptions & Sources');
    f.w.dispatchEvent(new f.w.Event('pagehide'));
    assert.equal(f.root.querySelector('#forecastMainGrid').textContent,'');
});
test('native Forecast initialization uses the contextual module and does not infer defaults from unrelated staff hours or old offers',async t=>{
    const f=fixture(t),dashboard=fs.readFileSync(path.join(__dirname,'..','frontend','dash.js'),'utf8');
    const ast=ts.createSourceFile('dash.js',dashboard,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const statement=ast.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(ast)==='adminForecastCalculator'));
    f.root.id='adminForecastCalculator';f.w.API_URL='https://fixture.invalid/api/v1';
    f.w.getDashboardSessionToken=()=> 'synthetic';f.w.isAdminRole=()=>true;
    let captured;
    f.w.H2SForecast.mount=async(root,options)=>{captured={root,options};};
    f.w.eval(statement.getText(ast)+';window.nativeForecast=adminForecastCalculator;');
    await f.w.nativeForecast.init();
    assert.equal(captured.root,f.root);assert.equal(captured.options.endpoint,'https://fixture.invalid/api/forecast');
    assert.equal(f.calls.length,0);
    assert.match(fs.readFileSync(path.join(__dirname,'..','frontend','dash.html'),'utf8'),/loadScript\('forecast-assistant\.js'\)/);
});

test('named scenarios preserve inputs, conversation and dated source provenance without another calculation',async t=>{
    const f=fixture(t);await f.mount();
    const result=calculated();
    result.comparisons[0].audit=[{path:'price',provenance:'hypothetical',detail:'Catalog version retained for planning'}];
    result.comparisons[0].evidence=[{name:'households',value:42,dataset:'Synthetic source',datasetYear:2024,fetchedAt:'2026-11-05T00:00:00Z',sourceUrl:'https://api.census.gov/data/2024/acs/acs5'}];
    f.w.fetch=async(url,init)=>{f.calls.push({url,init});return Response.json(result);};
    f.root.querySelector('textarea').value='Dallas planning';
    f.click('Analyze with AI');await settle();
    const name=f.root.querySelector('[aria-label="Scenario name"]');
    name.value='Dallas launch';name.dispatchEvent(new f.w.Event('input'));
    f.click('Save scenario');
    const savedId=f.root.querySelector('[aria-label="Revisit saved scenario"]').value;
    assert.ok(savedId);
    f.click('New scenario');assert.equal(f.root.querySelector('textarea').value,'');
    const select=f.root.querySelector('[aria-label="Revisit saved scenario"]');
    select.value=savedId;select.dispatchEvent(new f.w.Event('change'));
    assert.equal(f.root.querySelector('textarea').value,'Dallas planning');
    assert.match(f.root.textContent,/original calculation provenance/);
    f.click('Forecast Results');assert.match(f.root.textContent,/Saved calculation snapshot/);
    f.click('Market Intelligence');assert.match(f.root.textContent,/2026-11-05/);
    f.click('Assumptions & Sources');assert.match(f.root.textContent,/Catalog version retained/);
    f.click('Scenario Comparison');assert.match(f.root.textContent,/Dallas launch: Dallas/);
    assert.equal(f.calls.length,2);
    await f.mount();
    assert.equal(f.root.querySelector('[aria-label="Scenario name"]').value,'Dallas launch');
    assert.equal(f.w.localStorage.length,0);
    assert.match(f.root.textContent,/Not shared or stored on the server/);
});

test('unsaved scenario switching is confirmed, snapshot counts and comparison selection are bounded',async t=>{
    const f=fixture(t);await f.mount();
    f.w.fetch=async()=>Response.json(calculated());f.click('Calculate reviewed assumptions');await settle();
    f.click('Save scenario');
    for(let i=0;i<19;i++)f.click('Save as copy');
    const select=()=>f.root.querySelector('[aria-label="Revisit saved scenario"]');
    assert.equal(select().options.length,21);
    f.click('Save as copy');assert.match(f.root.textContent,/at most 20 scenarios/);
    f.click('Scenario Comparison');
    assert.equal(f.root.querySelectorAll('input[type=checkbox]:checked').length,4);
    const fifth=f.root.querySelectorAll('input[type=checkbox]')[4];fifth.click();
    assert.equal(fifth.checked,false);assert.match(f.root.textContent,/at most four saved scenarios/);
    const input=f.root.querySelector('textarea');input.value='Unsaved refinement';input.dispatchEvent(new f.w.Event('input'));
    f.w.confirm=()=>false;
    select().value=select().options[1].value;select().dispatchEvent(new f.w.Event('change'));
    assert.equal(f.root.querySelector('textarea').value,'Unsaved refinement');
    f.click('New scenario');assert.equal(f.root.querySelector('textarea').value,'Unsaved refinement');
    f.w.confirm=()=>true;f.click('Remove saved scenario');
    assert.equal(select().options.length,20);
});

test('native workspace lifecycle retains drafts across navigation and clears private scenarios on session changes',async t=>{
    const f=fixture(t);f.root.id='strategyForecastWorkspace';
    const nav=f.w.document.createElement('div');nav.id='strategyNavigation';nav.hidden=true;f.w.document.body.append(nav);
    f.w.H2SForecast.configure(f.options);assert.equal(nav.hidden,false);
    await f.w.H2SForecast.open();
    f.click('Save scenario');f.root.querySelector('textarea').value='Private draft';
    await f.w.H2SForecast.open();assert.equal(f.calls.length,1);
    assert.equal(f.root.querySelector('textarea').value,'Private draft');
    f.setToken('next-admin');f.w.H2SForecast.configure(f.options);
    assert.equal(f.root.childElementCount,0);
    await f.w.H2SForecast.open();
    assert.equal(f.root.querySelector('textarea').value,'');
    assert.equal(f.root.querySelector('[aria-label="Revisit saved scenario"]').options.length,1);
    f.setAdmin(false);f.w.H2SForecast.configure(f.options);
    assert.equal(nav.hidden,true);assert.equal(f.root.childElementCount,0);
    assert.equal(await f.w.H2SForecast.open(),false);
    assert.equal(f.calls.length,2);
});

test('a forbidden response clears saved names, sources, result values and inputs',async t=>{
    const f=fixture(t);await f.mount();
    const name=f.root.querySelector('[aria-label="Scenario name"]');
    name.value='Confidential plan';name.dispatchEvent(new f.w.Event('input'));f.click('Save scenario');
    f.w.fetch=async()=>Response.json({ok:false,error:'ADMIN permission revoked'},{status:403});
    f.click('Calculate reviewed assumptions');await settle();
    assert.doesNotMatch(f.root.textContent,/Confidential plan/);
    assert.equal(f.root.querySelector('[aria-label="Scenario name"]')?.value,undefined);
    assert.match(f.root.textContent,/ADMIN permission revoked/);
    assert.equal(f.root.querySelector('textarea').value,'');
    f.w.fetch=async()=>Response.json(initial());
    f.click('Retry Forecast connection');await settle();
    assert.equal(f.root.querySelector('[aria-label="Scenario name"]').value,'Untitled scenario');
});
