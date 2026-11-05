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
function quoteData() {
    return {ok:true,enabled:true,policyReady:false,depositConfigured:false,agreements:[],orders:[],payments:[],quotes:[],
        catalogs:[{catalog_id:'catalog-fixture',status:'published',version:'Approved version',definition:{services:[
            {id:'tv',label:'TV Mounting',markets:['residential'],offers:[{id:'customer-tv',label:'Customer-owned TV',enabled:true,minimum:1,maximum:5,
                scope:['Wall mounting'],equipment:[],questions:[{id:'wall',label:'Wall construction',type:'select',required:true,options:['Drywall','Brick']}],options:[]}]}
        ]}}]};
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
    await f.navigate('new');
    const attach=f.root().querySelector('[data-sales-form="attach"]');
    assert.equal(attach.closest('details'),null);
    assert.ok(attach.closest('[aria-label="Link existing inquiry"]'));
});
test('management has one compact navigation with one current destination and no repeated global brand',async t=>{
    const f=fixture(t,{role:'ADMIN'});await f.navigate('home');
    const expected=['dashboard','opportunities','transactions','orders','commissions','performance','representatives'];
    const assertNavigation=current=>{
        assert.equal(f.root().querySelectorAll('nav').length,1);
        assert.equal(f.root().querySelector('.field-sales__nav'),null,'representative footer is not a management navigation row');
        const nav=f.root().querySelector('.field-sales__management-nav');
        assert.deepEqual([...nav.querySelectorAll('button')].map(button=>button.dataset.salesMode),expected);
        assert.equal(nav.querySelectorAll('[aria-current="page"]').length,1);
        assert.equal(nav.querySelectorAll('[aria-pressed="true"]').length,1);
        assert.equal(nav.querySelector('[aria-current="page"]').dataset.salesMode,current);
        assert.equal(f.root().querySelector('.field-sales__header .field-sales__eyebrow'),null);
        assert.equal(f.root().querySelector('.field-sales__header h2').textContent,'Field Sales');
    };
    assertNavigation('dashboard');
    for(const mode of expected.slice(1)) {
        f.root().querySelector(`.field-sales__management-nav [data-sales-mode="${mode}"]`).click();await settle();
        assertNavigation(mode);
        if(mode==='commissions'||mode==='performance')assert.equal(f.mounts.at(-1).options.view,mode,'performance remains distinct from commissions');
    }
    await f.navigate('new');assertNavigation('opportunities');
    await f.navigate('assessment',leadId);assertNavigation('opportunities');
    await f.navigate('quotes',leadId);assertNavigation('transactions');
    assert.ok(f.root().querySelector('[data-sales-quote-lead]'),'customer quote builder remains an existing destination');
    f.root().querySelector('[data-sales-content] [data-sales-mode="transactions"]').click();await settle();
    assertNavigation('transactions');assert.equal(f.mounts.at(-1).options.leadId,null,'portfolio quote/payment review remains reachable');
    f.root().querySelector('[data-sales-content] [data-sales-mode="quotes"]').click();await settle();
    assertNavigation('transactions');assert.ok(f.root().querySelector('[data-sales-quote-lead]'));
    assert.equal(f.calls.some(call=>call.body),false,'navigation never writes business state');
});
test('management navigation stays a compact single scrolling row without changing representative footer rules',()=>{
    const dom=new JSDOM(`<style>${source('field-sales.css')}</style>`);
    try {
        const rules=[...dom.window.document.styleSheets[0].cssRules];
        const nav=rules.find(rule=>rule.selectorText==='#h2s-app .field-sales nav.field-sales__management-nav');
        assert.equal(nav.style.getPropertyValue('flex-wrap'),'nowrap');
        assert.equal(nav.style.getPropertyValue('overflow-x'),'auto');
        assert.equal(nav.style.getPropertyValue('position'),'');
        assert.equal(nav.style.getPropertyValue('margin'),'0 0 12px');
        const heading=rules.find(rule=>rule.selectorText==='#h2s-app .field-sales__header--management .field-sales__identity h2');
        assert.equal(heading.style.getPropertyValue('margin'),'0');
        const mobile=[...rules.find(rule=>rule.conditionText==='(max-width:767px)').cssRules];
        const footer=mobile.find(rule=>rule.selectorText==='body[data-sales-app="true"] #h2s-app .field-sales nav.field-sales__nav');
        assert.equal(footer.style.getPropertyValue('position'),'fixed');
        assert.equal(footer.style.getPropertyValue('grid-template-columns'),'repeat(5,minmax(0,1fr))');
    } finally {dom.window.close();}
});
test('compact navigation pairs decorative 16px line SVGs with visible labels and current-page state',async t=>{
    const f=fixture(t);await f.navigate('home');
    const buttons=[...f.root().querySelectorAll('.field-sales__nav button')];
    for (const button of buttons) {
        const svg=button.querySelector('svg');
        assert.ok(svg);assert.equal(svg.getAttribute('width'),'16');assert.equal(svg.getAttribute('height'),'16');
        assert.equal(svg.getAttribute('aria-hidden'),'true');assert.equal(svg.getAttribute('focusable'),'false');
        assert.equal(svg.getAttribute('fill'),'none');assert.ok(button.querySelector('span').textContent);
    }
    assert.equal(buttons.filter(button=>button.hasAttribute('aria-current')).length,1);
    const css=source('field-sales.css');
    assert.match(css,/height: 52px/);assert.match(css,/button,input,select,textarea,summary,a\):focus-visible/);
    // Fixed nav = 52px item + 8px top/bottom + 1px border; safe area is shared with the 80px clearance.
    assert.ok(52+8+8+1<80);
});
test('whole-card native service labels have specific concise descriptions and configured future fallback',async t=>{
    const f=fixture(t);
    f.data.services.push(service('future','Future configured service'));
    f.data.services.at(-1).definition.description='Site access and installation constraints';
    await f.navigate('new');
    const cards=[...f.root().querySelectorAll('.field-sales__service')];
    for(const card of cards) {
        assert.equal(card.tagName,'LABEL');
        const input=card.querySelector('input');
        assert.equal(input.type,'checkbox');
        assert.equal(input.getAttribute('aria-label'),card.querySelector('strong').textContent);
    }
    assert.match(cards.find(card=>card.textContent.includes('TV Mounting')).querySelector('small').textContent,/Screen size/);
    assert.match(cards.find(card=>card.textContent.includes('Camera')).querySelector('small').textContent,/coverage/);
    assert.match(cards.at(-1).textContent,/Site access and installation constraints/);
    assert.doesNotMatch(f.root().textContent,/Popular service|Select to assess/);
    const card=cards[0];card.click();await settle();assert.equal(card.querySelector('input').checked,true);
});
test('answers, notes, permission and the original photo input survive service toggles and every representative destination roundtrip',async t=>{
    const f=fixture(t);await f.navigate('assessment',leadId);
    const form=f.root().querySelector('[data-sales-form="save"]');
    form.elements.notes.value='Unsaved private assessment';
    form.elements.consentNote.value='Unsaved permission';
    form.elements.photoConsent.checked=true;
    form.elements.followUpAt.value='2026-11-06T10:30';
    f.root().querySelector('[data-question="units"]').value='5';
    const photo=f.root().querySelector('[name="photo"]');
    const file=new f.w.File(['synthetic pixels'],'fixture.jpg',{type:'image/jpeg'});
    Object.defineProperty(photo,'files',{value:[file]});
    f.change(form.querySelector('[name="services"][value="tv"]'),false);
    assert.equal(form.elements.notes.value,'Unsaved private assessment');
    f.change(form.querySelector('[name="services"][value="tv"]'),true);
    assert.equal(f.root().querySelector('[data-question="units"]').value,'5');
    for(const destination of ['home','leads','quotes','orders','earnings']) {
        await f.navigate(destination);await f.navigate('assessment',leadId);
        assert.equal(f.root().querySelector('[data-sales-form="save"]'),form);
        assert.equal(form.elements.notes.value,'Unsaved private assessment');
        assert.equal(form.elements.consentNote.value,'Unsaved permission');
        assert.equal(form.elements.photoConsent.checked,true);
        assert.equal(form.elements.followUpAt.value,'2026-11-06T10:30');
        assert.equal(f.root().querySelector('[data-question="units"]').value,'5');
        assert.equal(f.root().querySelector('[name="photo"]'),photo);
        assert.equal(photo.files[0],file);
    }
    assert.equal(f.w.localStorage.length,0);
    const unload=new f.w.Event('beforeunload',{cancelable:true});
    f.w.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true);
    f.w.H2SFieldSales.reset();
    await f.navigate('assessment',leadId);
    assert.notEqual(f.root().querySelector('[name="photo"]'),photo);
    assert.equal(f.root().querySelector('[data-sales-form="save"]').elements.notes.value,'Saved note');
});
test('new prospect input survives navigation without introducing duplicate customer inputs',async t=>{
    const f=fixture(t);await f.navigate('new');
    const form=f.root().querySelector('[data-sales-form="create"]');
    form.elements.fullName.value='Unsaved customer';form.elements.notes.value='Contact tomorrow';
    f.change(form.querySelector('[name="services"][value="tv"]'),true);
    await f.navigate('home');await f.navigate('new');
    assert.equal(f.root().querySelector('[data-sales-form="create"]'),form);
    assert.equal(form.elements.fullName.value,'Unsaved customer');
    assert.equal(form.elements.notes.value,'Contact tomorrow');
    assert.equal(form.querySelector('[name="services"][value="tv"]').checked,true);
    assert.equal(f.root().querySelectorAll('[name="fullName"]').length,1);
});
test('mounted destinations require an explicit dirty boundary before destroying their form or selected files',async t=>{
    const f=fixture(t);await f.navigate('quotes',leadId);
    const target=f.root().querySelector('[data-sales-quote-builder]');
    target.innerHTML='<form><textarea>Saved</textarea><input type="file"></form>';
    const textarea=target.querySelector('textarea');
    textarea.value='Unsaved quote details';textarea.dispatchEvent(new f.w.Event('input',{bubbles:true}));
    let confirmations=0;f.w.confirm=()=>{confirmations++;return false;};
    await f.navigate('home');
    assert.equal(confirmations,1);assert.equal(f.root().querySelector('textarea'),textarea);
    f.w.confirm=()=>true;
    await f.navigate('home');assert.equal(f.root().querySelector('[aria-current="page"]').textContent,'Home');
});
test('saving permission retains an unuploaded file; uploading it retains unsaved assessment answers and notes with fresh server revision',async t=>{
    const f=fixture(t);await f.navigate('assessment',leadId);
    const photo=f.root().querySelector('[name="photo"]');
    const file=new f.w.File(['synthetic pixels'],'fixture.jpg',{type:'image/jpeg'});
    Object.defineProperty(photo,'files',{value:[file]});
    f.respond(async(url,init)=>{
        if(init.method==='POST') {
            const body=JSON.parse(init.body);
            if(body.action==='save') {f.detail.opportunity.photo_consent=true;f.detail.opportunity.revision=8;}
            if(body.action==='photo') {
                f.detail.opportunity.revision=9;
                f.detail.photos.push({service_id:'tv',label:'Newly uploaded photo',state:'ready',file_id:'new-private-photo'});
            }
            return Response.json({ok:true,leadId});
        }
        return Response.json(url.includes('?leadId=')?f.detail:f.data);
    });
    let form=f.root().querySelector('[data-sales-form="save"]');form.elements.photoConsent.checked=true;
    f.submit(form,form.querySelector('[value="false"]'));await settle();
    assert.equal(f.root().querySelector('[name="photo"]'),photo);assert.equal(photo.files[0],file);
    assert.equal(f.root().querySelector('[data-sales-form="photo"] button').disabled,false);
    form=f.root().querySelector('[data-sales-form="save"]');
    form.elements.notes.value='Keep this while uploading';
    form.querySelector('[data-question="units"]').value='6';
    f.w.createImageBitmap=async()=>({width:10,height:10,close(){}});
    f.w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});
    f.w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/jpeg;base64,c3ludGhldGlj';
    const upload=f.root().querySelector('[data-sales-form="photo"]');
    f.submit(upload,upload.querySelector('button'));await settle();
    assert.equal(f.root().querySelector('[data-sales-form="save"]'),form);
    assert.equal(form.elements.notes.value,'Keep this while uploading');
    assert.equal(form.querySelector('[data-question="units"]').value,'6');
    assert.match(f.root().querySelector('[data-sales-photos]').textContent,/Newly uploaded photo/);
    assert.equal(f.root().querySelector('[name="photo"]').files.length,0,'only the successfully uploaded file is cleared');
    f.submit(form,form.querySelector('[value="false"]'));await settle();
    const body=f.calls.filter(call=>call.body?.action==='save').at(-1).body;
    assert.equal(body.revision,9);assert.equal(body.notes,'Keep this while uploading');assert.equal(body.answers.tv.units,6);
});
test('changing saved services never silently relabels a selected photo and Refresh/Sign out require explicit discard',async t=>{
    const f=fixture(t);await f.navigate('assessment',leadId);
    const photo=f.root().querySelector('[name="photo"]');
    const file=new f.w.File(['synthetic pixels'],'fixture.jpg',{type:'image/jpeg'});
    Object.defineProperty(photo,'files',{value:[file]});
    const form=f.root().querySelector('[data-sales-form="save"]');
    f.change(form.querySelector('[name="services"][value="tv"]'),false);
    f.change(form.querySelector('[name="services"][value="camera"]'),true);
    f.respond(async(url,init)=>{
        if(init.method==='POST') {f.detail.opportunity.services=['camera'];f.detail.opportunity.photo_consent=true;return Response.json({ok:true,leadId});}
        return Response.json(url.includes('?leadId=')?f.detail:f.data);
    });
    f.submit(form,form.querySelector('[value="false"]'));await settle();
    const upload=f.root().querySelector('[data-sales-form="photo"]');
    assert.equal(upload.elements.photo,photo);assert.equal(photo.files[0],file);
    assert.equal(upload.elements.serviceId.value,'');assert.equal(upload.checkValidity(),false);
    assert.match(f.root().querySelector('[data-sales-status]').textContent,/photo is retained/);
    f.change(upload.elements.serviceId,'camera');
    assert.equal(upload.elements.label.value,'Installation area');
    assert.equal(upload.elements.serviceId.checkValidity(),true);assert.equal(upload.elements.label.checkValidity(),true);
    const before=f.calls.length;let confirmations=0;
    f.w.confirm=()=>{confirmations++;return false;};
    f.root().querySelector('[data-sales-refresh]').click();await settle();
    f.root().querySelector('[data-sales-logout]').click();await settle();
    assert.equal(confirmations,2);assert.equal(f.calls.length,before);
    assert.equal(f.root().querySelector('[name="photo"]'),photo);
    assert.equal(photo.files[0],file);
});
test('real quote builder quantity, qualification and exception notes survive Quotes → Orders → Quotes without touching immutable quote contracts',async t=>{
    const f=fixture(t,{commerce:true}),transactions=quoteData();
    f.respond(async(url,init)=>Response.json(url.includes('field-sales-transactions')?(init.method==='POST'?{ok:true,id:'new-quote'}:transactions):f.data));
    await f.navigate('quotes',leadId);
    const form=f.root().querySelector('[data-commerce-create]');
    const quantity=form.querySelector('[name="quantity"]'),note=form.querySelector('[name="exceptionNote"]');
    quantity.value='4';quantity.dispatchEvent(new f.w.Event('input',{bubbles:true}));
    note.value='Unsaved unusual wall condition';note.dispatchEvent(new f.w.Event('input',{bubbles:true}));
    f.change(form.querySelector('[data-q="wall"]'),'Brick');
    form.querySelector('[data-commerce-add]').click();
    form.querySelectorAll('[name="quantity"]')[1].value='2';
    f.w.confirm=()=>assert.fail('the retained builder must not ask to discard its draft');
    await f.navigate('orders');
    const unload=new f.w.Event('beforeunload',{cancelable:true});
    f.w.dispatchEvent(unload);assert.equal(unload.defaultPrevented,true,'detached quote scope remains an unsaved draft');
    await f.navigate('quotes'); // Retain the selected customer, too.
    const restored=f.root().querySelector('[data-commerce-create]');
    assert.equal(restored,form);
    assert.equal(f.root().querySelector('[data-sales-quote-lead]').value,leadId);
    assert.equal(restored.querySelector('[name="quantity"]').value,'4');
    assert.equal(restored.querySelector('[name="exceptionNote"]').value,'Unsaved unusual wall condition');
    assert.equal(restored.querySelector('[data-q="wall"]').value,'Brick');
    assert.equal(restored.querySelectorAll('[name="quantity"]')[1].value,'2');
    assert.equal(f.calls.filter(call=>call.url.includes('field-sales-transactions')&&!call.body).length,2,'saved quote records are re-read');
    f.submit(restored,restored.querySelector('[type="submit"]'));await settle();
    const body=f.calls.find(call=>call.body?.action==='quote').body;
    assert.equal(body.leadId,leadId);assert.equal(body.catalogId,'catalog-fixture');assert.ok(body.operationId);
    assert.equal(body.lines[0].quantity,4);assert.equal(body.lines[0].exceptionNote,'Unsaved unusual wall condition');
    assert.equal(body.lines[0].answers.wall,'Brick');assert.equal(body.lines[1].quantity,2);
    assert.equal(body.amountCents,undefined);assert.equal(body.totalCents,undefined);
    assert.deepEqual(Object.keys(body.lines[0]).sort(),['answers','exceptionNote','offerId','options','quantity','serviceId']);
    assert.equal(f.w.localStorage.length,0);
    f.w.H2SFieldSales.reset();await f.navigate('quotes',leadId);
    assert.equal(f.root().querySelector('[name="quantity"]').value,'1');
    assert.equal(f.root().querySelector('[name="exceptionNote"]').value,'');
});
test('changed pricing retains but blocks the unsaved quote scope until explicit discard, and interrupted quote actions cannot be abandoned silently',async t=>{
    const f=fixture(t,{commerce:true}),transactions=quoteData();let interrupted=false;
    f.respond(async(url,init)=>{
        if(url.includes('field-sales-transactions')) {
            if(init.method==='POST'&&interrupted)throw Error('Synthetic interrupted quote');
            return Response.json(transactions);
        }
        return Response.json(f.data);
    });
    await f.navigate('quotes',leadId);
    const form=f.root().querySelector('[data-commerce-create]');form.querySelector('[name="quantity"]').value='3';
    form.querySelector('[name="exceptionNote"]').value='Keep old scope for review';
    await f.navigate('orders');
    transactions.catalogs[0].version='Changed approved version';
    await f.navigate('quotes');
    assert.equal(f.root().querySelector('[data-commerce-create]'),form);
    assert.equal(form.querySelector('[name="quantity"]').value,'3');
    assert.equal(form.querySelector('[type="submit"]').disabled,true);
    assert.match(f.root().querySelector('[data-commerce-status]').textContent,/Pricing configuration changed/);
    const count=f.calls.length;f.submit(form,form.querySelector('[type="submit"]'));await settle();assert.equal(f.calls.length,count);
    f.w.confirm=()=>false;f.root().querySelector('[data-commerce-refresh]').click();await settle();
    assert.equal(f.root().querySelector('[data-commerce-create]'),form);
    f.w.confirm=()=>true;f.root().querySelector('[data-commerce-refresh]').click();await settle();
    const fresh=f.root().querySelector('[data-commerce-create]');
    assert.notEqual(fresh,form);assert.equal(fresh.querySelector('[name="quantity"]').value,'1');
    interrupted=true;f.submit(fresh,fresh.querySelector('[type="submit"]'));await settle();
    await f.navigate('orders');
    assert.ok(f.root().querySelector('[data-commerce-create]'));
    assert.match(f.root().querySelector('[data-commerce-status]').textContent,/retry.*pending transaction/i);
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
    assert.match(css,/--sales-accent: var\(--azure, var\(--h2s-primary, #2563eb\)\)/);
    assert.match(css,/--sales-heading: var\(--cobalt, var\(--h2s-cobalt, #1a365d\)\)/);
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
        const clearance=Array.from(mobile.cssRules).find(rule=>rule.selectorText==='body[data-sales-app="true"] #h2s-app .field-sales.pane.active');
        assert.ok(clearance);
        assert.equal(clearance.style.getPropertyPriority('padding-bottom'),'important');
        assert.equal(clearance.style.getPropertyValue('padding-bottom'),'calc(80px + env(safe-area-inset-bottom, 0px))');
        assert.match(css,/scroll-margin-bottom: calc\(88px \+ env\(safe-area-inset-bottom, 0px\)\)/);
        const mobileNav=Array.from(mobile.cssRules).find(rule=>rule.selectorText==='body[data-sales-app="true"] #h2s-app .field-sales nav.field-sales__nav');
        assert.ok(mobileNav,'mobile grid selector must beat the shared .field-sales nav flex selector');
        assert.equal(mobileNav.style.getPropertyValue('display'),'grid');
        assert.equal(mobileNav.style.getPropertyValue('grid-template-columns'),'repeat(5,minmax(0,1fr))');
        assert.equal(mobileNav.style.getPropertyValue('padding'),'8px 4px calc(8px + env(safe-area-inset-bottom, 0px))');
        const mobileButton=Array.from(mobile.cssRules).find(rule=>rule.selectorText==='body[data-sales-app="true"] #h2s-app .field-sales__nav button');
        const itemHeight=parseFloat(mobileButton.style.getPropertyValue('height'));
        assert.ok(itemHeight>=44);
        assert.equal(mobileButton.style.getPropertyValue('white-space'),'nowrap');
        const navHeight=itemHeight+8+8+parseFloat(mobileNav.style.getPropertyValue('border-top'));
        // Both totals add the same safe-area value: it cancels without weakening the clearance.
        assert.ok(navHeight<80,`${navHeight}px navigation remains below 80px content clearance`);
    } finally {dom.window.close();}
});
test('320/390 management navigation stays in flow while only the independent sales app gets the fixed safe-area footer',()=>{
    const sheet=new JSDOM(`<style>${source('field-sales.css')}</style>`);
    try {
        const rules=[...sheet.window.document.styleSheets[0].cssRules];
        for(const width of [320,390]) {
            // JSDOM does not evaluate media queries; explicitly activate the matching mobile rules.
            const active=rules.flatMap(rule=>rule.conditionText==='(max-width:767px)'&&width<=767?[...rule.cssRules]:rule.selectorText?[rule]:[]);
            const css=active.map(rule=>rule.cssText).join('\n');
            for(const standalone of [false,true]) {
                const dom=new JSDOM(`<body${standalone?' data-sales-app="true"':''}><style>${css}</style><main id="h2s-app"><section class="pane field-sales active"><nav class="field-sales__nav"><button>Earnings</button></nav></section></main></body>`);
                try {
                    const nav=dom.window.document.querySelector('nav'),style=dom.window.getComputedStyle(nav);
                    assert.equal(style.position,standalone?'fixed':'',`${width}px ${standalone?'standalone':'management'} positioning`);
                    assert.equal(style.display,standalone?'grid':'flex');
                    const footerRules=active.filter(rule=>rule.style.getPropertyValue('padding-bottom').includes('safe-area')||rule.style.getPropertyValue('scroll-margin-bottom'));
                    assert.ok(footerRules.length>=2);
                    const pane=dom.window.document.querySelector('.field-sales'),button=nav.querySelector('button');
                    assert.equal(footerRules.some(rule=>pane.matches(rule.selectorText)),standalone);
                    assert.equal(footerRules.some(rule=>button.matches(rule.selectorText)),standalone);
                } finally {dom.window.close();}
            }
        }
    } finally {sheet.window.close();}
});
test('real lead cards separate customer, service, status and labeled next actions without inventing order facts',async t=>{
    const f=fixture(t);await f.navigate('leads');
    const cards=[...f.root().querySelectorAll('[data-sales-list] .field-sales__lead-card')];
    assert.equal(cards.length,3);
    const first=cards[0];
    assert.equal(first.querySelector('.field-sales__customer-link').textContent,f.data.opportunities[0].full_name);
    assert.equal(first.querySelector('.field-sales__service-label').textContent,'TV Mounting');
    assert.equal(first.querySelector('.field-sales__badge').textContent,'Awaiting review');
    assert.equal(first.querySelector('.field-sales__badge').dataset.tone,'info');
    assert.deepEqual([...first.querySelectorAll('dt')].map(el=>el.textContent),['Phone','Property','Next contact','Next step']);
    assert.equal(first.querySelector('.field-sales__next-step dd').textContent,'Await management review');
    assert.match(cards[2].querySelector('.field-sales__next-step').textContent,/Review saved assessment/);
    assert.doesNotMatch(first.textContent,/private-owner|00000000|deposit|scheduled|verified payment/i);
    first.querySelector('.field-sales__card-actions button').click();await settle();
    assert.ok(f.root().querySelector('[data-sales-form="save"]'),'context action opens the existing assessment');
    assert.ok(f.root().querySelector('.field-sales__customer-summary dl'),'assessment retains labeled customer context');
});
test('four compact activity metrics remain a single mobile row and customer cards grow naturally for long labels',async t=>{
    const f=fixture(t);await f.navigate('home');
    assert.equal(f.root().querySelectorAll('.field-sales__metric').length,4);
    assert.deepEqual([...f.root().querySelectorAll('.field-sales__metric span')].map(el=>el.textContent),
        ['Active leads','Follow-ups due','Follow-ups today','Awaiting review']);
    const dom=new JSDOM(`<style>${source('field-sales.css')}</style>`);
    try {
        const rules=[...dom.window.document.styleSheets[0].cssRules];
        const summary=rules.find(rule=>rule.selectorText==='#h2s-app .field-sales__summary');
        assert.equal(summary.style.getPropertyValue('grid-template-columns'),'repeat(4,minmax(0,1fr))');
        const mobile=[...rules.find(rule=>rule.conditionText==='(max-width:767px)').cssRules];
        assert.ok(!mobile.some(rule=>rule.selectorText?.includes('field-sales__summary')&&rule.style.getPropertyValue('grid-template-columns')));
        for(const rule of [...rules,...mobile].filter(rule=>/field-sales__(lead-card|metric|quote-review|quote-card)/.test(rule.selectorText||''))) {
            assert.equal(rule.style.getPropertyValue('height'),'');
            assert.equal(rule.style.getPropertyValue('min-height'),'');
        }
        assert.doesNotMatch(source('field-sales.css'),/radial-gradient|linear-gradient/);
    } finally {dom.window.close();}
});
test('customer quote placeholder follows the actual existing selector without competing controls',async t=>{
    const f=fixture(t);await f.navigate('quotes');
    const empty=f.root().querySelector('[data-sales-quote-empty]'),select=f.root().querySelector('[data-sales-quote-lead]');
    assert.equal(empty.hidden,false);
    assert.equal(f.root().querySelectorAll('[data-sales-quote-lead]').length,1);
    f.change(select,leadId);
    assert.equal(empty.hidden,true);assert.equal(f.mounts.at(-1).options.leadId,leadId);
    f.change(select,'');
    assert.equal(empty.hidden,false);assert.equal(f.root().querySelector('[data-sales-quote-builder]').textContent,'');
    assert.equal(f.calls.some(call=>call.body),false);
});
test('saved quote review uses structured customer, scoped line and payment facts; sparse customer fields never show undefined',async t=>{
    const f=fixture(t,{commerce:true}),transactions=quoteData();
    transactions.quotes=[{quote_id:'private-quote-reference',lead_id:leadId,revision:1,state:'draft',quote_hash:'private-hash',
        snapshot:{customer:{name:'Customer <not markup>',market:'residential'},catalogVersion:'Approved version',approvalReasons:[],totalCents:10000,
            lines:[{service:'TV Mounting',description:'Customer-owned TV with a long installation description',quantity:1,baseCents:10000,totalCents:10000,
                equipment:[],scope:['Wall mounting'],answers:{internal_question_id:'Brick'},answerLabels:{internal_question_id:'Wall construction'},addOns:[],exclusions:[]}]}}];
    f.respond(async(url)=>Response.json(url.includes('field-sales-transactions')?transactions:f.data));
    await f.navigate('quotes',leadId);
    const review=f.root().querySelector('.field-sales__quote-review');
    assert.equal(review.querySelector('.field-sales__quote-customer strong').textContent,'Customer <not markup>');
    assert.equal(review.querySelector('.field-sales__quote-customer not'),null);
    assert.match(review.querySelector('.field-sales__quote-scope').textContent,/TV Mounting.*Customer-owned TV/s);
    assert.ok([...review.querySelectorAll('dt')].some(el=>el.textContent==='Wall construction'));
    assert.ok([...review.querySelectorAll('dt')].some(el=>el.textContent==='Net verified collected'));
    assert.equal(review.querySelector('.field-sales__quote-total strong').textContent,'$100.00');
    assert.equal(f.root().querySelector('[data-commerce-quote]').getAttribute('aria-pressed'),'true');
    assert.doesNotMatch(review.textContent,/undefined|private-quote-reference|private-hash|internal_question_id/);
    assert.equal(f.calls.some(call=>call.body),false,'presentation must never initiate a transaction');
});
test('pending sales and quote reads use concise live loading states without decorative skeletons',async t=>{
    const f=fixture(t);let finish;
    f.respond(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=f.w.H2SFieldSales.navigate('leads');await settle();
    const status=f.root().querySelector('[data-sales-status]');
    assert.equal(status.getAttribute('role'),'status');assert.equal(status.getAttribute('aria-live'),'polite');
    assert.equal(status.classList.contains('field-sales__loading'),true);
    assert.match(status.textContent,/Loading assigned/);
    finish(Response.json(f.data));await pending;await settle();
    assert.equal(f.root().querySelector('[data-sales-status]').textContent,'');
    assert.ok(f.root().querySelector('[data-sales-list]'));
});
