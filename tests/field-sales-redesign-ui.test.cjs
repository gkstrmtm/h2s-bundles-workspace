// Synthetic-only presentation and integration tests. No network or transaction activation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { JSDOM } = require('jsdom');
const source = name => fs.readFileSync(path.join(__dirname, '..', 'frontend', name), 'utf8');
const settle = async () => { for (let i=0;i<8;i++) await new Promise(resolve=>setImmediate(resolve)); };
const leadId = '00000000-0000-4000-8000-000000000001';
const service = (id, name, markets=['residential','commercial']) => ({
    service_id:id, version:1, definition:{label:name, markets, photos:['Installation area'], questions:[
        {id:'equipment',label:'Equipment supplied by',type:'select',required:true,options:['Customer','Home2Smart']},
        {id:'units',label:'Number of units',type:'number',required:true,min:1,max:10}
    ]}
});
function salesData() {
    return {ok:true,enabled:true,total:3,representatives:[],
        services:[service('other','Network installation',['commercial']),service('camera','Security Camera Installation'),service('tv','TV Mounting')],
        opportunities:[
            {lead_id:leadId,full_name:'Synthetic customer with a long household name',phone:'555-0100',address:'10 Example Road',market:'residential',services:['tv'],owner_user_id:'private-owner-id',status:'ready_for_review',follow_up_at:'2020-01-01T10:00:00Z'},
            {lead_id:'second-lead',full_name:'Another customer',phone:'555-0101',address:'20 Example Road',market:'commercial',services:['other'],owner_user_id:'another-owner',status:'assessing'},
            {lead_id:'closed-lead',full_name:'Closed customer',phone:'555-0102',address:'30 Example Road',market:'residential',services:[],owner_user_id:'private-owner-id',status:'closed'}
        ]};
}
function detailData() {
    return {ok:true,enabled:true,lead:{full_name:'Synthetic customer',phone:'555-0100',project_address:'10 Example Road',project_city:'Example City',attribution:{market:'residential'}},
        opportunity:{lead_id:leadId,revision:7,status:'assessing',services:['tv'],assessments:{tv:{answers:{equipment:'Customer',units:2}}},photo_consent:false,notes:'Saved note',consent_note:'',originating_user_id:'private-origin',owner_user_id:'private-owner-id',created_by:'private-creator'},
        photos:[{service_id:'tv',label:'Installation area',state:'ready',file_id:'private-file-id'}],
        history:[{created_at:'2026-01-01',actor_name:'Management',action:'private_action',payload:{private_audit:'must not appear for SALES'}}]};
}
function fixture(t, {role='SALES', commerce=false}={}) {
    const dom = new JSDOM('<body data-sales-app="true"><main id="h2s-app"><div class="app-content"></div></main></body>',{runScripts:'outside-only',url:'https://fixture.invalid/sales.html'});
    t.after(()=>dom.window.close());
    const w=dom.window,calls=[],mounts=[],data=salesData(),detail=detailData();
    let actor={token:'synthetic-session-only',role},respond=async(url,init)=>Response.json(init.method==='POST'?{ok:true,leadId}:url.includes('?leadId=')?detail:data);
    w.crypto.randomUUID=crypto.randomUUID; w.console.error=()=>{};
    w.fetch=async(url,init={})=>{calls.push({url,init,body:init.body&&JSON.parse(init.body)});return respond(url,init);};
    w.H2SFieldWorkflow={reset(){},mount(root,options){mounts.push({kind:'orders',options});root.textContent='Synthetic orders';}};
    w.H2SFieldEarnings={reset(){},mount(root,options){mounts.push({kind:'earnings',options});root.textContent='Synthetic earnings';}};
    if(commerce) w.eval(source('field-commerce.js'));
    else w.H2SFieldCommerce={reset(){},mount(root,options){mounts.push({kind:'quotes',options});root.textContent='Synthetic real builder mount';}};
    w.eval(source('field-sales.js'));
    w.H2SFieldSales.configure({apiBase:'https://fixture.invalid/api/',getSession:()=>actor,onLogout(){actor={token:'',role:null};w.H2SFieldSales.reset();}});
    return {w,calls,mounts,data,detail,
        root:()=>w.document.querySelector('#field-sales-pane'),
        actor(value){actor=value;}, respond(fn){respond=fn;},
        async navigate(view,id){await w.H2SFieldSales.navigate(view,id);await settle();},
        change(input,value){if(input.type==='checkbox')input.checked=value;else input.value=value;input.dispatchEvent(new w.Event('change',{bubbles:true}));},
        submit(form,button){form.dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true,submitter:button}));}
    };
}
test('standalone sales mounts without dashboard sidebar and exposes five genuine canonical destinations',async t=>{
    const f=fixture(t);
    const activation=f.w.H2SFieldSales.activate();
    assert.equal(typeof activation.then,'function');
    await activation;await settle();
    assert.equal(f.w.document.querySelector('#h2s-app').dataset.fieldSales,'true');
    assert.deepEqual([...f.root().querySelectorAll('.field-sales__nav button')].map(b=>b.textContent),['Home','Leads','Quotes','Orders','Earnings']);
    assert.equal(f.root().querySelector('.field-sales__management-nav'),null);
    assert.deepEqual([...f.root().querySelectorAll('.field-sales__metric strong')].map(el=>el.textContent),['2','1','0','1']);
    assert.doesNotMatch(f.root().textContent,/private-owner-id|ready_for_review|→|UUID/);
    await f.navigate('leads');
    assert.ok(f.root().querySelector('[data-sales-list]'));
    assert.equal(f.root().querySelector('[aria-current="page"]').textContent,'Leads');
    await f.navigate('quotes',leadId);
    assert.equal(f.mounts.at(-1).kind,'quotes');
    assert.equal(f.mounts.at(-1).options.leadId,leadId);
    assert.equal(f.root().querySelector('[data-sales-quote-builder]').dataset.market,'residential');
    await f.navigate('orders');assert.equal(f.mounts.at(-1).kind,'orders');assert.equal(f.mounts.at(-1).options.customerNames[leadId],f.data.opportunities[0].full_name);
    await f.navigate('earnings');assert.equal(f.mounts.at(-1).kind,'earnings');assert.equal(f.mounts.at(-1).options.customerNames[leadId],f.data.opportunities[0].full_name);
    const before=f.calls.length;await f.navigate('unapproved-route');assert.equal(f.calls.length,before);
});
test('initial navigate activates the standalone shell and loads only the requested destination without aborting a Home read',async t=>{
    const f=fixture(t);
    await f.navigate('orders');
    assert.equal(f.root().classList.contains('active'),true);
    assert.equal(f.w.document.querySelector('#h2s-app').dataset.fieldSales,'true');
    assert.equal(f.root().querySelector('[aria-current="page"]').textContent,'Orders');
    assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].init.signal.aborted,false);
    assert.equal(f.mounts.length,1);
    assert.equal(f.mounts[0].kind,'orders');
});
test('Home labels same-day lead contacts as follow-ups, never installation bookings',async t=>{
    const f=fixture(t), NativeDate=f.w.Date;
    f.w.Date=class extends NativeDate {
        constructor(...args){super(...(args.length?args:['2026-11-05T12:00:00']));}
        static now(){return new NativeDate('2026-11-05T12:00:00').getTime();}
    };
    const base=f.data.opportunities[0];
    f.data.opportunities=[
        ...[1,2,3].map(n=>({...base,lead_id:`contact-${n}`,follow_up_at:'2026-11-05T09:00:00'})),
        {...base,lead_id:'closed-contact',status:'closed',follow_up_at:'2026-11-05T09:00:00'},
        {...base,lead_id:'tomorrow-contact',follow_up_at:'2026-11-06T09:00:00'}
    ];
    f.data.total=f.data.opportunities.length;
    await f.navigate('home');
    const metric=[...f.root().querySelectorAll('.field-sales__metric')].find(el=>el.querySelector('span').textContent==='Follow-ups today');
    assert.ok(metric);
    assert.equal(metric.querySelector('strong').textContent,'3');
    assert.doesNotMatch(f.root().querySelector('.field-sales__summary').textContent,/Scheduled today|installation|booking/i);
    assert.equal(f.mounts.length,0); // Home has loaded lead contacts, not an installation schedule.
    assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].url,'https://fixture.invalid/api/field-sales');
});
test('intake preserves configured services, native validation, market gating and exact create identity contract',async t=>{
    const f=fixture(t);await f.navigate('new');
    const form=f.root().querySelector('[data-sales-form="create"]');
    assert.deepEqual([...form.querySelectorAll('[name="services"]')].map(el=>el.value),['tv','camera','other']);
    assert.equal(form.elements.fullName.required,true);
    assert.equal(form.elements.phone.type,'tel');
    assert.equal(form.elements.address.autocomplete,'street-address');
    assert.equal(form.querySelector('[name="ownerId"]'),null);
    assert.equal(form.querySelector('[name="leadId"]'),null);
    assert.equal(form.checkValidity(),false);
    const other=form.querySelector('[name="services"][value="other"]');
    assert.equal(other.disabled,true);
    f.change(form.elements.market,'commercial');assert.equal(other.disabled,false);
    f.change(other,true);
    f.change(form.elements.market,'residential');assert.equal(other.checked,false);assert.equal(other.disabled,true);
    Object.assign(form.elements.fullName,{value:'New synthetic customer'});form.elements.phone.value='555-0199';form.elements.address.value='99 Example Road';form.elements.city.value='Example City';
    f.change(form.querySelector('[name="services"][value="tv"]'),true);
    form.elements.notes.value='Synthetic identity note';form.elements.followUpAt.value='2026-11-06T09:30';
    assert.equal(form.checkValidity(),true);
    f.submit(form,form.querySelector('[type="submit"]'));await settle();
    const body=f.calls.find(call=>call.body).body;
    assert.equal(body.action,'create');assert.equal(body.fullName,'New synthetic customer');
    assert.deepEqual(body.services,['tv']);assert.ok(body.operationId);
    assert.match(body.followUpAt,/Z$/);assert.equal(body.ownerId,undefined);assert.equal(body.leadId,undefined);assert.equal(body.customerId,undefined);
    assert.ok(f.root().querySelector('[data-sales-form="save"]'));
    assert.equal(f.root().querySelector('[data-custom-select="off"]'),null);
});
test('assessment progressively shows configured questions, retains draft answers, and preserves save/photo/review contracts without exposing audit evidence',async t=>{
    const f=fixture(t);await f.navigate('assessment',leadId);
    assert.equal(f.root().querySelector('[data-question][data-service="camera"]'),null);
    assert.equal(f.root().querySelector('[data-question="equipment"]').value,'Customer');
    f.change(f.root().querySelector('[data-question="equipment"]'),'Home2Smart');
    const tv=f.root().querySelector('[name="services"][value="tv"]');
    f.change(tv,false);assert.equal(f.root().querySelector('[data-question]'),null);
    f.change(tv,true);assert.equal(f.root().querySelector('[data-question="equipment"]').value,'Home2Smart');
    f.change(f.root().querySelector('[name="services"][value="camera"]'),true);
    assert.ok(f.root().querySelector('[data-question][data-service="camera"]'));
    assert.equal(f.root().querySelector('[data-sales-form="photo"] button').disabled,true);
    assert.doesNotMatch(f.root().textContent,/private-owner|private-origin|private-creator|private_action|private_audit|00000000|assessing/);
    const form=f.root().querySelector('[data-sales-form="save"]');
    form.elements.notes.value='Retained assessment';form.elements.photoConsent.checked=true;form.elements.consentNote.value='Customer permits photographs';
    f.submit(form,form.querySelector('[value="true"]'));await settle();
    const body=f.calls.find(call=>call.body).body;
    assert.equal(body.action,'save');assert.equal(body.leadId,leadId);assert.equal(body.revision,7);
    assert.equal(body.submit,true);assert.equal(body.photoConsent,true);assert.equal(body.answers.tv.equipment,'Home2Smart');
    assert.equal(body.answers.tv.units,2);assert.deepEqual(body.services,['tv','camera']);
    assert.equal(body.ownerId,undefined);assert.equal(body.originating_user_id,undefined);
    assert.ok(f.root().querySelector('[data-sales-build-quote]'));
});
test('quotes choose only actual assigned leads and mount existing commerce; filters combine query and management owner',async t=>{
    const f=fixture(t);await f.navigate('quotes','unassigned-lead');
    assert.equal(f.mounts.length,0);
    const select=f.root().querySelector('[data-sales-quote-lead]');
    assert.equal(select.options.length,4);f.change(select,leadId);
    assert.equal(f.mounts.at(-1).options.leadId,leadId);
    assert.equal(f.mounts.at(-1).options.apiBase,'https://fixture.invalid/api/');
    await f.navigate('leads');
    const search=f.root().querySelector('[data-sales-search]');search.value='555-0101';search.dispatchEvent(new f.w.Event('input',{bubbles:true}));
    assert.equal([...f.root().querySelectorAll('[data-sales-list] article')].filter(row=>!row.hidden).length,1);
    search.value='No matching customer';search.dispatchEvent(new f.w.Event('input',{bubbles:true}));
    assert.equal(f.root().querySelector('[data-sales-no-results]').hidden,false);
});
test('ADMIN keeps identity and raw audit evidence inside disclosure and representative tools stay role scoped',async t=>{
    const f=fixture(t,{role:'ADMIN'});await f.navigate('assessment',leadId);
    assert.ok(f.root().querySelector('.field-sales__management-nav'));
    for(const text of ['private-owner-id','private_audit']) {
        const element=[...f.root().querySelectorAll('details')].find(el=>el.textContent.includes(text));
        assert.ok(element,text);assert.equal(element.open,false);
    }
    assert.ok(f.root().querySelector('[data-sales-form="assign"]'));
    await f.navigate('new');assert.ok(f.root().querySelector('[data-sales-form="attach"]').closest('details'));
});
test('late representative data is discarded across session change, and reset returns canonical Home',async t=>{
    const f=fixture(t);let done;
    f.respond(()=>new Promise(resolve=>{done=resolve;}));
    const pending=f.w.H2SFieldSales.navigate('leads');await settle();
    f.actor({token:'different-synthetic-session',role:'SALES'});
    done(Response.json({...f.data,opportunities:[{...f.data.opportunities[0],full_name:'PRIVATE late customer'}]}));await pending;await settle();
    assert.doesNotMatch(f.root().textContent,/PRIVATE late customer/);
    f.respond(async()=>Response.json(f.data));
    await f.w.H2SFieldSales.open();await settle();
    assert.equal(f.root().querySelector('[aria-current="page"]').textContent,'Home');
});
test('actual quote builder posts the existing qualified immutable-quote contract and hides raw IDs from SALES',async t=>{
    const f=fixture(t,{commerce:true});
    const quoteId='00000000-0000-4000-8000-000000000099';
    const transaction={ok:true,enabled:true,policyReady:false,depositConfigured:false,agreements:[],orders:[],payments:[],
        catalogs:[{catalog_id:'catalog-fixture',status:'published',version:'Approved version',definition:{services:[{id:'tv',label:'TV Mounting',markets:['residential'],offers:[{id:'customer-tv',label:'Customer-owned TV',enabled:true,minimum:1,maximum:5,scope:['Wall mounting'],equipment:[],questions:[{id:'wall',label:'Wall construction',type:'select',required:true,options:['Drywall','Brick']}],options:[]}]}]}}],
        quotes:[{quote_id:quoteId,quote_hash:'private-immutable-hash',lead_id:leadId,revision:1,state:'pending_approval',snapshot:{customer:{name:'Synthetic customer',market:'residential'},lines:[],totalCents:10000,catalogVersion:'Approved version',pricingStatus:'published',approvalReasons:['Wall review required']}}]};
    f.respond(async(url,init)=>{
        if(url.includes('field-sales-transactions'))return Response.json(init.method==='POST'?{ok:true,id:quoteId}:transaction);
        return Response.json(f.data);
    });
    await f.navigate('quotes',leadId);await settle();
    assert.ok(f.root().querySelector('[data-commerce-create]'));
    assert.match(f.root().textContent,/Awaiting approval/);
    assert.doesNotMatch(f.root().textContent,/00000000|private-immutable-hash|pending_approval/);
    const form=f.root().querySelector('[data-commerce-create]');
    assert.equal(form.querySelector('[data-commerce-offer]').value,'tv:customer-tv');
    form.querySelector('[data-q="wall"]').value='Brick';form.querySelector('[name="quantity"]').value='2';form.querySelector('[name="exceptionNote"]').value='Review brick installation';
    f.submit(form,form.querySelector('[type="submit"]'));await settle();
    const call=f.calls.find(call=>call.body);
    assert.match(call.url,/\/api\/field-sales-transactions$/);
    assert.equal(call.body.action,'quote');assert.equal(call.body.leadId,leadId);assert.equal(call.body.catalogId,'catalog-fixture');
    assert.deepEqual(call.body.lines,[{serviceId:'tv',offerId:'customer-tv',quantity:2,options:[],answers:{wall:'Brick'},exceptionNote:'Review brick installation'}]);
    assert.equal(call.body.amountCents,undefined);assert.equal(call.body.totalCents,undefined);
    assert.ok(call.body.operationId);
});
test('sales styling uses scoped H2S brand tokens, compact shared classes and the existing dropdown rather than a replacement',()=>{
    const css=source('field-sales.css');
    assert.match(css,/--sales-accent: var\(--h2s-primary, #1493ff\)/);
    assert.match(css,/--sales-heading: var\(--h2s-cobalt, #0a2a5a\)/);
    for(const name of ['summary','metric','badge','section','toolbar','empty'])assert.match(css,new RegExp('field-sales__'+name));
    assert.match(css,/dashboard-custom-select-trigger/);
    assert.match(css,/grid-template-columns: repeat\(5,minmax\(0,1fr\)\)/);
    assert.doesNotMatch(css,/radial-gradient|linear-gradient|--primary\s*:/);
    assert.doesNotMatch(source('field-sales.js')+source('field-commerce.js'),/data-custom-select="off"/);
});
test('mobile sales pane overrides inherited zero padding and transform containment so bottom navigation cannot cover final actions',()=>{
    // Load the real inherited pane rules; unrelated dashboard CSS uses syntax JSDOM cannot parse.
    const inheritedPaneRules=source('dash.css').match(/(?:#h2s-app )?\.pane(?:\.active)?\s*\{[^}]*\}/g).join('\n');
    const css=source('field-sales.css'),dom=new JSDOM(`<style>${inheritedPaneRules}\n${css}</style><div id="h2s-app"><section class="pane field-sales active"></section></div>`);
    try {
        const pane=dom.window.document.querySelector('.field-sales'),style=dom.window.getComputedStyle(pane);
        assert.equal(style.willChange,'auto');
        assert.equal(style.transform,'none');
        assert.equal(style.animation,'none');
        const rules=Array.from(dom.window.document.styleSheets[0].cssRules);
        const mobile=rules.find(rule=>rule.conditionText==='(max-width:767px)');
        assert.ok(mobile);
        const clearance=Array.from(mobile.cssRules).find(rule=>rule.selectorText==='#h2s-app .field-sales.pane.active');
        assert.ok(clearance);
        assert.equal(clearance.style.getPropertyPriority('padding-bottom'),'important');
        assert.equal(clearance.style.getPropertyValue('padding-bottom'),'calc(80px + env(safe-area-inset-bottom, 0px))');
        assert.match(css,/scroll-margin-bottom: calc\(88px \+ env\(safe-area-inset-bottom, 0px\)\)/);
    } finally {dom.window.close();}
});
