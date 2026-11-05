// Synthetic presentation fixtures only. No production HTTP, credentials or activation.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const source=name=>fs.readFileSync(path.join(__dirname,'..','frontend',name),'utf8');
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function workflow(){
    return {ok:true,enabled:true,policies:[
        {policy_id:id(10),kind:'legal',status:'approved',definition:{version:'2026.1',terms:'Approved synthetic terms'},approval_evidence:{reference:'Fixture approval'}},
        {policy_id:id(11),kind:'legal',status:'draft',definition:{version:'2026.2'},definitionHash:'synthetic-hash'},
        {policy_id:id(12),kind:'commission',status:'approved',definition:{version:'2026.3'}},
        {policy_id:id(13),kind:'settlement',status:'approved',definition:{version:'2026.4'}}
    ],workflows:[{
        orderId:id(1),quoteId:id(2),leadId:id(3),representativeId:id(4),revision:7,state:'scheduled',
        customerName:'Avery Customer <img src=x>',depositCents:2501,netPaidCents:2501,balanceCents:7500,
        cancellationDeadline:'2026-01-03T17:00:00Z',completedAt:null,jobId:id(5),technicianId:id(6),
        processingFeeCents:65,processingFeeEvidence:{reference:'Synthetic fee source'},hours:null,
        documents:[{artifactId:id(7),contentHash:'synthetic-document-hash',label:'Approved quote',kind:'quote',content:{private:'Synthetic customer copy'}}],
        requiredArtifacts:[],deliveryEvidence:[{reference:'Synthetic delivery evidence'}],holds:['Synthetic policy review'],
        reservation:{revision:1},preparation:{record:{revision:2}},technicianExpenses:[],expenses:[],
        proof:{photoCount:1,signatureCount:0,complete:false,requirements:[],candidates:[{artifactId:id(8)}]},
        gates:{canDeposit:false,canBalance:false,canSchedule:false,canAssign:false,canComplete:false}
    }]};
}
function earnings(){
    return {ok:true,enabled:true,summary:{pendingQualification:1,calculationReview:1,earnedCents:39600,adjustmentCents:-100,allocatedCents:39500,reconciledPaidCents:0},
        orders:[{orderId:id(1),quoteId:id(2),leadId:id(3),representativeId:id(4),state:'calculation_review',reasons:['Synthetic internal policy review'],totalCents:100000,netPaidCents:100000,completedAt:'2026-01-01',qualifiesAt:'2026-01-02',refundedCents:0,disputed:false}],
        entries:[{entryId:id(20),quoteId:id(2),representativeId:id(4),amountCents:39600,basisCents:72000,rateBasisPoints:5500,tenureDay:30,qualifiesAt:'2026-01-02',policyId:id(12),snapshot:{private:'Synthetic commission evidence'},inputHash:'synthetic-hash'}],
        adjustments:[{adjustmentId:id(21),entryId:id(20),amountCents:-100,settlementState:'recovery_review_required',effect:'earning_correction_not_debt',reviewedAt:'2026-01-03',reason:'Synthetic reason',evidence:'Synthetic adjustment evidence',reviewedBy:id(22)}],
        runs:[{runId:id(23),state:'exported',runDate:'2026-01-09',amountCents:39500,policyId:id(13),method:'Synthetic method',classification:'internal_classification',beneficiaries:[{representativeId:id(4),amountCents:39500}],evidence:{reference:'Synthetic run evidence'}}]};
}
function browser(t,module,role,data,options={}){
    const dom=new JSDOM('<div id="h2s-app"><section class="field-sales"><div id="root"></div></section></div>',{runScripts:'outside-only',url:'https://fixture.invalid'});
    t.after(()=>dom.window.close());
    const w=dom.window,root=w.document.querySelector('#root'),calls=[];
    let response=data;
    w.crypto.randomUUID=()=>id(99);w.console.error=()=>{};
    w.fetch=async(url,init)=>{
        assert.ok(url.startsWith('https://fixture.invalid/api/field-sales-'),'Only synthetic endpoints permitted');
        const body=init.body&&JSON.parse(init.body);calls.push({url,body});
        return Response.json(typeof response==='function'?response(url,body):response);
    };
    w.eval(source(module));
    const api=w[module==='field-workflow.js'?'H2SFieldWorkflow':'H2SFieldEarnings'];
    api.mount(root,{apiBase:'https://fixture.invalid',getSession:()=>({token:'synthetic-token',role}),...options});
    return {w,root,calls,respond:value=>response=value,submit:form=>form.dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true}))};
}
function nonAuditText(root){
    const clone=root.cloneNode(true);
    clone.querySelectorAll('.field-workflow__audit').forEach(el=>el.remove());
    return clone.textContent;
}
test('SALES orders show readable progress, customer context and exact currency without IDs, evidence or policy jargon',async t=>{
    const f=browser(t,'field-workflow.js','SALES',workflow());await settle();
    assert.match(f.root.textContent,/Avery Customer <img src=x>/);assert.equal(f.root.querySelector('img'),null);
    assert.match(f.root.textContent,/Installation scheduled/);assert.match(f.root.textContent,/Confirm the customer is ready/);
    assert.equal(f.root.querySelector('[aria-label="Order progress"]'),null);
    const copies=[...f.root.querySelectorAll('dt')].find(el=>el.textContent==='Customer copies');
    assert.equal(copies.nextElementSibling.textContent,'Published');
    assert.match(f.root.textContent,/\$25\.01/);assert.match(f.root.textContent,/\$75\.00 — not ready for collection/);
    assert.doesNotMatch(f.root.textContent,/00000000-|synthetic-document-hash|Synthetic customer copy|Synthetic policy review|server gates|immutable|JSON/);
    assert.equal(f.root.querySelector('pre,textarea,form,.field-workflow__audit'),null);
    assert.equal(f.calls.length,1);
});
test('current balance distinguishes zero from positive blocked collection without implying payment, settlement or credit clearance',async t=>{
    for(const [balanceCents,canBalance,expected] of [
        [0,false,'No balance due'],
        [0,true,'No balance due'],
        [7500,false,'$75.00 — not ready for collection'],
        [7500,true,'$75.00 — available after installation'],
        [null,false,'Evidence pending'],
        [undefined,true,'Evidence pending'],
        [-100,false,'-$1.00 — credit balance under management review'],
        [-100,true,'-$1.00 — credit balance under management review']
    ]){
        const d=workflow();d.workflows[0].balanceCents=balanceCents;d.workflows[0].gates.canBalance=canBalance;
        const f=browser(t,'field-workflow.js','ADMIN',d);await settle();
        const label=[...f.root.querySelectorAll('dt')].find(el=>el.textContent==='Outstanding balance');
        assert.equal(label.nextElementSibling.textContent,expected);
        assert.doesNotMatch(label.nextElementSibling.textContent,/settled|payment verified|refund approved/i);
        assert.equal(f.root.querySelector('[data-workflow-form="reschedule"] button').disabled,true);
        assert.equal(f.root.querySelector('[data-workflow-form="assign"] button').disabled,true);
        assert.equal(f.calls.length,1);assert.equal(f.calls.filter(call=>call.body).length,0);
    }
});
test('ADMIN evidence remains intact but expandable; private native proof candidates are not newly disclosed',async t=>{
    const d=workflow(),f=browser(t,'field-workflow.js','ADMIN',d);await settle();
    assert.doesNotMatch(nonAuditText(f.root),/00000000-|synthetic-document-hash|Synthetic customer copy/);
    for(const pre of f.root.querySelectorAll('pre'))assert.ok(pre.closest('.field-workflow__audit'));
    for(const details of f.root.querySelectorAll('.field-workflow__audit'))assert.equal(details.open,false);
    const auditTab=[...f.root.querySelectorAll('[role="tab"]')].find(tab=>tab.textContent==='Audit');
    assert.match(panelFor(f,auditTab).textContent,/Synthetic customer copy/);
    assert.equal(panelFor(f,auditTab).hidden,true);
    for(const pre of f.root.querySelector('[aria-label="Order records"]').querySelectorAll('pre')){
        assert.equal(pre.closest('[role="tabpanel"]'),panelFor(f,auditTab));
    }
    assert.match(f.root.textContent,/Synthetic delivery evidence/);assert.match(f.root.textContent,/Synthetic fee source/);
    assert.doesNotMatch(f.root.textContent,new RegExp(id(8)));
    assert.equal(f.root.querySelector('[data-workflow-form="reschedule"] button').disabled,true);
    assert.equal(f.root.querySelector('[data-workflow-form="assign"] button').disabled,true);
});
test('policy selectors use kind and supplied version while preserving exact approved IDs and enrollment payload',async t=>{
    const f=browser(t,'field-workflow.js','ADMIN',workflow());await settle();
    const form=f.root.querySelector('[data-workflow-form="enroll"]'),select=form.elements.legalPolicyId;
    assert.equal(select.options.length,2);assert.equal(select.options[1].value,id(10));
    assert.match(select.options[1].textContent,/Customer agreement · Version 2026.1/);
    assert.doesNotMatch(select.textContent,/00000000-|2026.2/);
    assert.equal(select.getAttribute('data-custom-select'),null);
    form.elements.quoteId.value=id(2);form.elements.leadId.value=id(3);form.elements.representativeId.value=id(4);
    select.value=id(10);form.elements.commissionPolicyId.value=id(12);form.elements.settlementPolicyId.value=id(13);
    form.elements.creditEvidence.value='Synthetic immutable credit approval';
    f.respond((url,body)=>body?{ok:true}:workflow());f.submit(form);await settle();
    assert.deepEqual(f.calls.find(c=>c.body).body,{action:'enroll',quoteId:id(2),leadId:id(3),revision:0,representativeId:id(4),legalPolicyId:id(10),commissionPolicyId:id(12),settlementPolicyId:id(13),creditEvidence:{reference:'Synthetic immutable credit approval'},operationId:id(99)});
});
test('unapproved actual costs retain visible approval requirement and all explicit attestations',async t=>{
    const d=workflow();Object.assign(d.workflows[0],{state:'completed',completedAt:'2026-01-01',costsComplete:false,technicianExpenses:[
        {category:'equipment',quantity:1,unitCents:1200,amountCents:1200,evidence:{reference:'Synthetic receipt'}},
        {category:'materials',quantity:0,unitCents:0,amountCents:0,evidence:{reference:'Synthetic zero-cost review'},zeroCostAttestation:'No materials used'}
    ]});
    const f=browser(t,'field-workflow.js','ADMIN',d);await settle();
    assert.match(nonAuditText(f.root),/Approval required: review actual equipment and materials costs/);
    const form=f.root.querySelector('[data-workflow-form="cost_review"]');
    assert.equal(form.elements.actualCostsReviewed.required,true);
    assert.equal(form.querySelectorAll('[data-workflow-cost-row] [name="actual"][required]').length,2);
    assert.equal(form.querySelectorAll('[name="zeroCostAttestation"]').length,2);
    assert.equal(form.querySelector('[name="unitCents"]').value,'1200');
    assert.match(form.textContent,/integer cents/);assert.equal(form.querySelector('button').disabled,false);
});
test('SALES earnings separate earned, allocated and independently paid amounts without technical record identity',async t=>{
    const f=browser(t,'field-earnings.js','SALES',earnings());await settle();
    assert.match(f.root.textContent,/Your earnings/);assert.match(f.root.textContent,/Order 1/);
    assert.match(f.root.textContent,/\$396\.00/);assert.match(f.root.textContent,/\$395\.00/);
    assert.match(f.root.textContent,/Commission independently paid\$0\.00/);
    assert.match(f.root.textContent,/Review exported — not paid/);assert.match(f.root.textContent,/Amount under review/);
    assert.match(f.root.textContent,/55% · tenure day 30/);assert.match(f.root.textContent,/not representative debt or authorization to recover money/);
    assert.doesNotMatch(f.root.textContent,/00000000-|calculation_review|recovery_review_required|earning_correction_not_debt|internal_classification|Synthetic commission evidence|integer cents|JSON/);
    assert.equal(f.root.querySelector('form,pre,textarea,.field-workflow__audit'),null);
});
test('ADMIN earnings retain source snapshots and required beneficiary contract inside closed audit details',async t=>{
    const d=earnings(),f=browser(t,'field-earnings.js','ADMIN',d);await settle();
    assert.doesNotMatch(nonAuditText(f.root),/00000000-|internal_classification|Synthetic commission evidence/);
    assert.match(f.root.textContent,/Synthetic commission evidence/);assert.match(f.root.textContent,/Synthetic run evidence/);
    for(const pre of f.root.querySelectorAll('pre'))assert.ok(pre.closest('.field-workflow__audit'));
    for(const details of f.root.querySelectorAll('.field-workflow__audit'))assert.equal(details.open,false);
    const form=f.root.querySelector('[data-earnings-form="record_settlement"]');
    assert.equal(form.elements.beneficiaries.required,true);assert.ok(form.elements.beneficiaries.closest('.field-workflow__audit'));
    assert.deepEqual(JSON.parse(form.elements.beneficiaries.value),d.runs[0].beneficiaries);
    assert.equal(form.elements.independentReconciliation.required,true);assert.equal(form.elements.independentReconciliation.checked,false);
    assert.match(form.textContent,/integer cents/);assert.match(f.root.textContent,/Only matching independent settlement evidence can establish paid status/);
});
test('representative scope labels remain stable after filtering while exact ID query is retained',async t=>{
    const d=earnings();d.orders.push({...d.orders[0],quoteId:id(30),representativeId:id(31)});
    const f=browser(t,'field-earnings.js','ADMIN',d);await settle();
    let select=f.root.querySelector('[data-earnings-representative]');
    assert.equal(select.options[2].textContent,'Representative 2 — profile name unavailable');assert.equal(select.options[2].value,id(31));
    f.respond(()=>({...d,orders:d.orders.filter(o=>o.representativeId===id(31)),entries:[]}));
    select.value=id(31);select.dispatchEvent(new f.w.Event('change',{bubbles:true}));await settle();
    select=f.root.querySelector('[data-earnings-representative]');
    assert.equal(select.selectedOptions[0].textContent,'Representative 2 — profile name unavailable');
    assert.equal(new URL(f.calls.at(-1).url).searchParams.get('representativeId'),id(31));
});
test('authorized caller-supplied identity maps provide readable records without extra requests or raw identity values',async t=>{
    const options={customerNames:{[id(3)]:'Morgan Customer <img src=x>'},representativeNames:{[id(4)]:'Jordan Representative'}};
    const d=workflow();delete d.workflows[0].customerName;
    const f=browser(t,'field-workflow.js','ADMIN',d,options);await settle();
    assert.match(nonAuditText(f.root),/Morgan Customer <img src=x>/);assert.match(nonAuditText(f.root),/Jordan Representative/);
    assert.equal(f.root.querySelector('img'),null);assert.equal(f.calls.length,1);
    const g=browser(t,'field-earnings.js','ADMIN',earnings(),options);await settle();
    assert.match(nonAuditText(g.root),/Morgan Customer <img src=x>/);
    assert.equal(g.root.querySelector('[data-earnings-representative]').selectedOptions[0].textContent,'All authorized representatives');
    assert.equal(g.root.querySelector('[data-earnings-representative]').options[1].textContent,'Jordan Representative');
    assert.equal(g.root.querySelector('[data-earnings-representative]').options[1].value,id(4));
    assert.equal(g.root.querySelector('img'),null);assert.equal(g.calls.length,1);
});
test('unknown statuses and missing amounts remain explicit review states, never invented approval or zero',async t=>{
    const d=workflow();Object.assign(d.workflows[0],{state:'unknown_internal_state',depositCents:null,netPaidCents:null,balanceCents:null,customerName:null});
    const f=browser(t,'field-workflow.js','SALES',d);await settle();
    assert.match(f.root.textContent,/Order 1/);assert.match(f.root.textContent,/Order under review/);assert.match(f.root.textContent,/Evidence pending/);
    assert.doesNotMatch(f.root.textContent,/unknown_internal_state|\$0\.00/);
    const e=earnings();e.orders=[];e.entries=[];e.adjustments=[];e.runs=[];
    const g=browser(t,'field-earnings.js','SALES',e);await settle();
    assert.ok(g.root.querySelectorAll('.field-sales__empty').length>=3);
    assert.equal(g.root.querySelector('form'),null);
});
test('workflow-specific CSS remains token-based and scoped without decorative elevation',()=>{
    const css=source('field-workflow.css');
    assert.doesNotMatch(css,/radial-gradient|linear-gradient|box-shadow/);
    const dom=new JSDOM(`<style>${css}</style>`);try{
        const walk=rules=>{for(const rule of rules){if(rule.cssRules)walk(rule.cssRules);else if(rule.selectorText?.includes('field-workflow__'))for(const selector of rule.selectorText.split(/,(?![^(]*\))/))assert.ok(selector.trim().startsWith('#h2s-app .field-sales '),selector);}};
        walk(dom.window.document.styleSheets[0].cssRules);
    }finally{dom.window.close();}
    assert.match(css,/var\(--cobalt\)/);assert.match(css,/var\(--azure\)/);
});

function panelFor(f,tab){return f.root.querySelector('#'+tab.getAttribute('aria-controls'));}
function assertTabState(f,tabs,selected){
    for(const tab of tabs){
        const active=tab===selected,panel=panelFor(f,tab);
        assert.ok(panel);assert.equal(panel.getAttribute('role'),'tabpanel');
        assert.equal(panel.getAttribute('aria-labelledby'),tab.id);
        assert.equal(panel.tabIndex,0);
        assert.equal(tab.getAttribute('aria-selected'),String(active));
        assert.equal(tab.tabIndex,active?0:-1);assert.equal(panel.hidden,!active);
        assert.equal(tab.type,'button');
    }
}
test('order action and enrollment tabs provide labelled panels, roving focus and wrapping keyboard navigation without requests',async t=>{
    const f=browser(t,'field-workflow.js','ADMIN',workflow());await settle();
    const groups=[...f.root.querySelectorAll('[role="tablist"]')];
    assert.equal(groups.length,2);
    assert.match(groups[0].getAttribute('aria-label'),/Avery Customer/);
    assert.deepEqual([...groups[0].children].map(el=>el.textContent),[
        'Overview','Quote','Customer Docs','Scheduling','Costs & Margin','Commission Review','Audit'
    ]);
    assert.match(groups[1].getAttribute('aria-label'),/enrollment and policy/);
    assert.deepEqual([...groups[1].children].map(el=>el.textContent),['Enroll sale','Policy management']);
    const headings=[
        'Order overview','Approved quote','Customer documents & acceptance',
        'Scheduling & installation readiness','Actual costs & margin review','Commission qualification review','Technical evidence & audit',
        'New order enrollment — exact quote and approved policies','Versioned legal, commission and settlement policies'
    ];
    for(const heading of headings)assert.ok([...f.root.querySelectorAll('[role="tabpanel"] > h4')].some(el=>el.textContent===heading),'Descriptive panel heading retained: '+heading);
    const key=(tab,value)=>tab.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
    for(const group of groups){
        const tabs=[...group.children];assertTabState(f,tabs,tabs[0]);
        tabs[0].focus();key(tabs[0],'ArrowLeft');
        assertTabState(f,tabs,tabs.at(-1));assert.equal(f.w.document.activeElement,tabs.at(-1));
        key(tabs.at(-1),'ArrowRight');assertTabState(f,tabs,tabs[0]);
        key(tabs[0],'End');assertTabState(f,tabs,tabs.at(-1));
        key(tabs.at(-1),'Home');assertTabState(f,tabs,tabs[0]);
        tabs[1].click();assertTabState(f,tabs,tabs[1]);
        assert.equal(f.w.document.activeElement,tabs[1]);
        assert.equal(panelFor(f,tabs[1]).querySelector('details:not(.field-workflow__audit)'),null);
    }
    const ids=[...f.root.querySelectorAll('[id]')].map(el=>el.id);assert.equal(new Set(ids).size,ids.length);
    assert.equal(f.root.querySelector('details:not(.field-workflow__audit),details details'),null);
    for(const el of f.root.querySelectorAll('.field-workflow__next,.field-workflow__facts,.field-sales__summary')){
        // The primary order summary and next action are never within a switched panel.
        if(el.closest('[role="tabpanel"]'))continue;
        assert.equal(el.closest('[hidden]'),null);
    }
    assert.equal(f.root.querySelector('.field-workflow__next').closest('[role="tabpanel"]'),null);
    assert.equal(f.root.querySelector('.field-workflow__facts').closest('[role="tabpanel"]'),null);
    assert.equal(f.calls.length,1);
});

test('all order forms, native selects/dates, evidence and cost attestations retain their exact nodes and unsaved state across tabs',async t=>{
    const d=workflow();Object.assign(d.workflows[0],{completedAt:'2026-01-01',costsComplete:false,technicianExpenses:[
        {category:'equipment',quantity:1,unitCents:1200,amountCents:1200,evidence:{reference:'Fixture receipt'}},
        {category:'materials',quantity:0,unitCents:0,amountCents:0,evidence:{reference:'Fixture zero review'}}
    ]});
    const f=browser(t,'field-workflow.js','ADMIN',d);await settle();
    const forms=[...f.root.querySelectorAll('form')];
    assert.ok(forms.some(form=>form.dataset.workflowForm==='cost_review'));
    const costTab=[...f.root.querySelectorAll('[role="tab"]')].find(tab=>tab.textContent==='Costs & Margin');
    assert.ok(costTab);
    assert.equal(panelFor(f,costTab).querySelector('h4').textContent,'Actual costs & margin review');
    assert.match(panelFor(f,costTab).textContent,/Review technician actual costs before commission calculation/);
    const values=[...f.root.querySelectorAll('input,select,textarea')].map((el,index)=>{
        if(el.tagName==='SELECT'&&el.options.length>1)el.selectedIndex=el.options.length-1;
        else if(el.type==='checkbox')el.checked=true;
        else if(el.type==='datetime-local')el.value='2026-11-06T09:30';
        else if(el.type==='number')el.value='123';
        else if(el.type!=='hidden'&&!el.readOnly)el.value='Unsaved fixture '+index;
        return {el,value:el.value,checked:el.checked};
    });
    const audits=[...f.root.querySelectorAll('.field-workflow__audit')];audits[0].open=true;
    for(let i=0;i<2;i++)for(const tab of f.root.querySelectorAll('[role="tab"]'))tab.click();
    for(const {el,value,checked} of values){
        assert.ok(f.root.contains(el));assert.equal(el.value,value);assert.equal(el.checked,checked);
    }
    for(const form of forms)assert.ok(f.root.contains(form));
    assert.equal(audits[0].open,true);
    assert.equal(f.root.querySelectorAll('select').length,values.filter(({el})=>el.tagName==='SELECT').length);
    const select=f.root.querySelector('[name="materials"]'),active=f.root.querySelector('[role="tab"][aria-selected="true"]');
    select.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    assert.equal(active.getAttribute('aria-selected'),'true','Native select arrows must not navigate tabs');
    assert.equal(f.calls.length,1);assert.equal(f.calls.filter(c=>c.body).length,0);
});

test('earnings tabs keep financial summary visible and preserve settlement, adjustment and run-creation edits without re-rendering',async t=>{
    const f=browser(t,'field-earnings.js','ADMIN',earnings());await settle();
    const tabs=[...f.root.querySelector('[role="tablist"]').children];
    assert.deepEqual(tabs.map(tab=>tab.textContent),['Qualification','Commissions','Adjustments','Friday review','Audit']);
    assert.deepEqual(tabs.map(tab=>panelFor(f,tab).querySelector('h4').textContent),[
        'Commission qualification','Earned commissions','Accounting adjustments','Friday payment review','Technical evidence & audit'
    ]);
    assertTabState(f,tabs,tabs[0]);
    assert.equal(f.root.querySelector('details:not(.field-workflow__audit),details details'),null);
    assert.match(f.root.textContent,/Qualification review details/);
    const summary=f.root.querySelector('[aria-label="Verified earnings summary"]'),summaryHTML=summary.outerHTML;
    assert.equal(summary.closest('[role="tabpanel"]'),null);
    const settlement=f.root.querySelector('[data-earnings-form="record_settlement"]');
    assert.equal(settlement.querySelector('button').textContent,'Record settlement evidence');
    assert.match(settlement.textContent,/I independently reconciled the amount, beneficiaries and external reference/);
    assert.match(panelFor(f,tabs[3]).textContent,/Only matching independent settlement evidence can establish paid status/);
    settlement.elements.method.value='Existing approved method';settlement.elements.reference.value='Unsaved independent reference';
    settlement.elements.settledAt.value='2026-11-06T10:30';settlement.elements.amountCents.value='39500';
    settlement.elements.independentReconciliation.checked=true;settlement.elements.evidence.value='Unsaved independent evidence';
    const adjustment=f.root.querySelector('[data-earnings-form="review_adjustment"]');
    adjustment.elements.amountCents.value='-101';adjustment.elements.reason.value='Unsaved correction';
    const creation=f.root.querySelector('[data-earnings-form="create_run"]');
    creation.elements.runDate.value='2026-11-13';
    const before=[settlement,adjustment,creation].map(form=>[form,[...new f.w.FormData(form)]]);
    for(const tab of tabs){
        tab.focus();tab.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
        const next=tabs[(tabs.indexOf(tab)+1)%tabs.length];assertTabState(f,tabs,next);
        assert.equal(f.w.document.activeElement,next);assert.equal(summary.closest('[hidden]'),null);
    }
    for(const [form,entries] of before){assert.ok(f.root.contains(form));assert.deepEqual([...new f.w.FormData(form)],entries);}
    assert.equal(summary.outerHTML,summaryHTML);
    assert.equal(f.root.querySelector('[data-earnings-form="record_settlement"]'),settlement);
    assert.equal(f.calls.length,1);
});

test('native validation reveals the original hidden panel and does not steal focus or submit an operation',async t=>{
    for(const [module,data,field] of [
        ['field-workflow.js',workflow(),'[data-workflow-form="delivery_record"] [name="recipient"]'],
        ['field-earnings.js',earnings(),'[data-earnings-form="record_settlement"] [name="method"]']
    ]){
        const f=browser(t,module,'ADMIN',data);await settle();
        const input=f.root.querySelector(field),panel=input.closest('[role="tabpanel"]');
        assert.equal(panel.hidden,true);
        input.dispatchEvent(new f.w.Event('invalid',{cancelable:true}));
        assert.equal(panel.hidden,false);
        const tab=f.root.querySelector('#'+panel.getAttribute('aria-labelledby'));
        assert.equal(tab.getAttribute('aria-selected'),'true');
        input.focus();assert.equal(f.w.document.activeElement,input);
        assert.equal(f.calls.length,1);
    }
});

test('required admin evidence opens only on validation, retaining its original control and entered evidence',async t=>{
    for(const [module,data,field] of [
        ['field-workflow.js',workflow(),'[data-workflow-form="enroll"] [name="quoteId"]'],
        ['field-earnings.js',earnings(),'[data-earnings-form="record_settlement"] [name="beneficiaries"]']
    ]){
        const f=browser(t,module,'ADMIN',data);await settle();
        const input=f.root.querySelector(field),audit=input.closest('.field-workflow__audit'),value=input.value;
        assert.equal(audit.open,false);
        input.dispatchEvent(new f.w.Event('invalid',{cancelable:true}));
        assert.equal(audit.open,true);assert.equal(input.value,value);
        assert.equal(input.closest('[role="tabpanel"]').hidden,false);
        assert.equal(f.calls.length,1);
    }
});

test('SALES has contextual earnings views but no admin workflow actions or evidence panels',async t=>{
    const f=browser(t,'field-workflow.js','SALES',workflow());await settle();
    assert.equal(f.root.querySelector('[role="tablist"],form,.field-workflow__audit'),null);
    const g=browser(t,'field-earnings.js','SALES',earnings());await settle();
    for(const tab of g.root.querySelectorAll('[role="tab"]')){
        tab.click();assert.equal(panelFor(g,tab).hidden,false);
        assert.equal(g.root.querySelector('form,pre,textarea,.field-workflow__audit'),null);
    }
    assert.equal(g.calls.length,1);
});

test('approved reference hierarchy uses real quote scope, six purposeful summaries and separate agreement/readiness states',async t=>{
    const d=workflow(),w=d.workflows[0];
    Object.assign(w,{totalCents:10001,acceptedAt:null,costsComplete:false,
        reservation:{revision:1,starts_at:'2026-11-06T15:00:00Z',ends_at:'2026-11-06T17:00:00Z',timezone:'America/New_York'},
        preparation:{record:{revision:2,scope_reviewed:true,materials:'blocked',access:'ready'}},
        documents:[
            {kind:'quote',label:'Approved quote',approvedAt:'2026-11-01T10:00:00Z',contentHash:'private-quote-hash',
                content:{lines:[{service:'Camera installation',description:'Exterior camera setup',quantity:1,totalCents:10001,
                    scope:['Approved scope <img src=x>'],equipment:['Customer supplied camera'],exclusions:['No electrical work']}] }},
            {kind:'agreement',label:'Customer agreement',approvedAt:'2026-11-01T10:00:00Z',content:{version:'fixture-v1',terms:'Private legal text'}}
        ]});
    const f=browser(t,'field-workflow.js','ADMIN',d,{representativeNames:{[id(4)]:'Jordan Representative'}});await settle();
    const detail=f.root.querySelector('.field-workflow__order-detail');
    assert.match(detail.querySelector('.field-workflow__header').textContent,/Avery Customer.*Camera installation.*Installation scheduled/s);
    assert.match(detail.querySelector('.field-workflow__identity').textContent,/Verified net payment covers deposit/);
    assert.match(detail.querySelector('.field-workflow__identity').textContent,/Jordan Representative/);
    const tabs=[...detail.querySelector('[role="tablist"]').children],overview=panelFor(f,tabs[0]);
    const summaries=[...overview.querySelectorAll('.field-workflow__summary-panel')];
    assert.deepEqual(summaries.map(panel=>panel.querySelector('h5').textContent),[
        'Approved quote summary','Customer agreement','Scheduling status','Installation readiness','Actual costs approval','Commission qualification'
    ]);
    assert.match(summaries[0].textContent,/\$100\.01/);
    assert.match(summaries[1].textContent,/Acceptance pending/);
    assert.doesNotMatch(summaries[1].textContent,/Signed|AcceptedAccepted/);
    assert.match(summaries[3].textContent,/Scope reviewReviewed.*MaterialsBlocked.*Customer accessReady/s);
    assert.match(summaries[4].textContent,/Approval pending/);
    assert.match(summaries[5].textContent,/Separate earnings review/);
    assert.doesNotMatch(overview.textContent,/private-quote-hash|Private legal text|00000000-|JSON|integer cents/);
    tabs[1].click();const quote=panelFor(f,tabs[1]);
    assert.match(quote.textContent,/Exterior camera setup/);assert.match(quote.textContent,/Approved scope <img src=x>/);
    assert.match(quote.textContent,/Customer supplied camera/);assert.match(quote.textContent,/No electrical work/);
    assert.equal(f.root.querySelector('img'),null);
    assert.equal(quote.querySelector('pre,textarea'),null);
    assert.equal(detail.querySelector('.field-workflow__next').closest('[hidden]'),null);
    assert.equal(f.calls.length,1);assert.equal(f.calls.filter(call=>call.body).length,0);
});

test('all financial raw snapshots live in a secondary Audit tab while required technical controls retain native forms',async t=>{
    const f=browser(t,'field-earnings.js','ADMIN',earnings());await settle();
    const tabs=[...f.root.querySelector('[role="tablist"]').children],audit=panelFor(f,tabs.at(-1));
    assert.equal(tabs.at(-1).textContent,'Audit');assert.equal(audit.hidden,true);
    assert.equal(audit.querySelectorAll('pre').length,4);
    for(const pre of f.root.querySelectorAll('pre'))assert.equal(pre.closest('[role="tabpanel"]'),audit);
    for(const tab of tabs.slice(0,-1)){
        tab.click();const panel=panelFor(f,tab);
        assert.equal(panel.querySelector('pre'),null);
        assert.doesNotMatch(nonAuditText(panel),/00000000-|synthetic-hash|JSON|integer cents/);
    }
    const run=f.root.querySelector('.field-workflow__friday-run');
    assert.match(run.querySelector('.field-workflow__run-summary').textContent,/\$395\.00.*not confirmed paid/s);
    assert.match(run.querySelector('.field-workflow__next').textContent,/Independently reconcile/);
    const form=f.root.querySelector('[data-earnings-form="record_settlement"]');
    assert.ok(form.elements.amountCents.closest('.field-workflow__audit'));
    assert.equal(form.elements.amountCents.required,true);
    form.elements.amountCents.dispatchEvent(new f.w.Event('invalid',{cancelable:true}));
    assert.equal(form.elements.amountCents.closest('.field-workflow__audit').open,true);
    assert.equal(form.closest('[role="tabpanel"]').hidden,false);
    assert.equal(f.calls.length,1);
});

test('reviewed cost summaries are currency; exact correction inputs and immutable attestations remain intact',async t=>{
    const d=workflow();Object.assign(d.workflows[0],{completedAt:'2026-01-01',costsComplete:false,technicianExpenses:[
        {category:'equipment',quantity:1,unitCents:1234,amountCents:1234,evidence:{reference:'Fixture receipt'}},
        {category:'materials',quantity:0,unitCents:0,amountCents:0,evidence:{reference:'Fixture zero review'}}
    ]});
    const f=browser(t,'field-workflow.js','ADMIN',d);await settle();
    const form=f.root.querySelector('[data-workflow-form="cost_review"]');
    assert.match(nonAuditText(form),/\$12\.34/);
    assert.doesNotMatch(nonAuditText(form),/integer cents|1234|JSON/);
    for(const row of form.querySelectorAll('[data-workflow-cost-row]')){
        assert.ok(row.querySelector('[name="unitCents"]').closest('.field-workflow__audit'));
        assert.ok(row.querySelector('[name="amountCents"]').closest('.field-workflow__audit'));
        assert.equal(row.querySelector('[name="actual"]').required,true);
    }
    const unit=form.querySelector('[name="unitCents"]');unit.value='1200';
    unit.dispatchEvent(new f.w.Event('invalid',{cancelable:true}));
    assert.equal(unit.closest('.field-workflow__audit').open,true);
    assert.equal(unit.closest('[role="tabpanel"]').hidden,false);
    assert.equal(unit.value,'1200');
    assert.equal(f.calls.length,1);
});

test('management puts tabs directly after one concise status band and next action; full financial evidence stays inside Overview',async t=>{
    const f=browser(t,'field-workflow.js','ADMIN',workflow(),{representativeNames:{[id(4)]:'Jordan Representative'}});await settle();
    const record=f.root.querySelector('.field-workflow__order-detail');
    assert.deepEqual([...record.children].map(el=>el.tagName),['HEADER','DL','P','DIV']);
    const band=record.querySelector(':scope > dl');
    assert.deepEqual([...band.querySelectorAll('dt')].map(el=>el.textContent),[
        'Deposit required (25%)','Outstanding balance','Credited representative','Installation team'
    ]);
    assert.match(band.textContent,/\$25\.01.*Verified net payment covers deposit.*\$75\.00 — not ready for collection/s);
    assert.match(band.textContent,/Jordan Representative.*Assigned/s);
    assert.equal(record.querySelector(':scope > .field-workflow__payment-strip'),null);
    const views=record.querySelector('[data-context-panels]');
    assert.equal(record.querySelector('.field-workflow__next').nextElementSibling,views);
    assert.equal(views.firstElementChild.getAttribute('role'),'tablist');
    const overview=views.querySelector('[role="tabpanel"]');
    assert.equal(overview.hidden,false);
    const paid=[...overview.querySelectorAll('dt')].find(el=>el.textContent==='Total verified payments (net)');
    assert.equal(paid.nextElementSibling.textContent,'$25.01');
    assert.equal(overview.querySelectorAll('.field-workflow__summary-panel').length,6);
    assert.equal(f.calls.length,1);
});

test('representative cards use one compact row set with no duplicated progress or missing payment/document/team information',async t=>{
    const d=workflow();d.workflows[0].completedAt='2026-11-05T15:00:00Z';
    const f=browser(t,'field-workflow.js','SALES',d);await settle();
    const card=f.root.querySelector('.field-workflow__mobile-order');
    assert.deepEqual([...card.children].map(el=>el.tagName),['HEADER','DL','P']);
    assert.equal(card.querySelector('ol,[aria-label="Order progress"],details'),null);
    const rows=[...card.querySelectorAll('dt')];
    assert.deepEqual(rows.map(el=>el.textContent),[
        'Deposit required (25%)','Outstanding balance','Installation team','Completion','Customer copies'
    ]);
    assert.match(rows[0].nextElementSibling.textContent,/\$25\.01.*Verified net payment covers deposit.*Total verified payments \(net\): \$25\.01/s);
    assert.equal(rows[1].nextElementSibling.textContent,'$75.00 — not ready for collection');
    assert.equal(rows[2].nextElementSibling.textContent,'Assigned');
    assert.notEqual(rows[3].nextElementSibling.textContent,'Not established');
    assert.equal(rows[4].nextElementSibling.textContent,'Published');
    assert.match(card.querySelector('.field-workflow__next').textContent,/Management is reviewing payment readiness/);
    assert.equal(f.calls.length,1);
});

test('order credit never presents user codes as profile names; real supplied names win and exact identity stays in Audit',async t=>{
    for(const [representativeId,representativeName,mapped,expected] of [
        ['SALESA','SALESA','SALESA','Assigned — profile name unavailable'],
        [id(4),'SALESA','Jordan Brooks','Jordan Brooks'],
        [id(4),'Taylor Brooks',undefined,'Taylor Brooks'],
        [id(4),undefined,undefined,'Assigned — profile name unavailable']
    ]){
        const d=workflow();Object.assign(d.workflows[0],{representativeId,representativeName});
        const f=browser(t,'field-workflow.js','ADMIN',d,{representativeNames:{[representativeId]:mapped}});await settle();
        const label=[...f.root.querySelectorAll('dt')].find(el=>el.textContent==='Credited representative');
        assert.equal(label.nextElementSibling.textContent,expected);
        assert.doesNotMatch(nonAuditText(f.root),/SALESA|00000000-/);
        const audit=[...f.root.querySelectorAll('[role="tab"]')].find(tab=>tab.textContent==='Audit');
        assert.match(panelFor(f,audit).textContent,new RegExp(representativeId));
        assert.equal(f.calls.length,1);
    }
});

test('Friday beneficiaries and earnings scope use readable names or explicit missing-profile labels, never account codes',async t=>{
    for(const [mapped,expected] of [[undefined,'Representative 1 — profile name unavailable'],['Jordan Brooks','Jordan Brooks']]){
        const d=earnings();
        for(const row of [...d.orders,...d.entries,...d.runs[0].beneficiaries]){
            row.representativeId='SALESA';row.representativeName='SALESA';
        }
        const f=browser(t,'field-earnings.js','ADMIN',d,{representativeNames:{SALESA:mapped}});await settle();
        const beneficiary=f.root.querySelector('.field-workflow__run-summary dt');
        assert.equal(beneficiary.textContent,expected);
        const scope=f.root.querySelector('[data-earnings-representative]');
        assert.equal(scope.options[1].textContent,expected);
        assert.equal(scope.options[1].value,'SALESA');
        assert.doesNotMatch(nonAuditText(f.root),/SALESA/);
        const audit=[...f.root.querySelectorAll('[role="tab"]')].find(tab=>tab.textContent==='Audit');
        assert.match(panelFor(f,audit).textContent,/SALESA/);
        assert.equal(f.calls.length,1);
    }
});
