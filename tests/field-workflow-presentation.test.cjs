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
    assert.equal(f.root.querySelector('[aria-label="Order progress"]').querySelectorAll('li').length,3);
    assert.match(f.root.textContent,/\$25\.01/);assert.match(f.root.textContent,/\$75\.00 — not ready for collection/);
    assert.doesNotMatch(f.root.textContent,/00000000-|synthetic-document-hash|Synthetic customer copy|Synthetic policy review|server gates|immutable|JSON/);
    assert.equal(f.root.querySelector('pre,textarea,form,.field-workflow__audit'),null);
    assert.equal(f.calls.length,1);
});
test('ADMIN evidence remains intact but expandable; private native proof candidates are not newly disclosed',async t=>{
    const d=workflow(),f=browser(t,'field-workflow.js','ADMIN',d);await settle();
    assert.doesNotMatch(nonAuditText(f.root),/00000000-|synthetic-document-hash|Synthetic customer copy/);
    for(const pre of f.root.querySelectorAll('pre'))assert.ok(pre.closest('.field-workflow__audit'));
    for(const details of f.root.querySelectorAll('.field-workflow__audit'))assert.equal(details.open,false);
    assert.match(f.root.querySelector('.field-workflow__audit').textContent,/Synthetic customer copy/);
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
    assert.match(f.root.textContent,/Independently reconciled paid\$0\.00/);
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
    assert.equal(select.options[2].textContent,'Representative 2');assert.equal(select.options[2].value,id(31));
    f.respond(()=>({...d,orders:d.orders.filter(o=>o.representativeId===id(31)),entries:[]}));
    select.value=id(31);select.dispatchEvent(new f.w.Event('change',{bubbles:true}));await settle();
    select=f.root.querySelector('[data-earnings-representative]');
    assert.equal(select.selectedOptions[0].textContent,'Representative 2');
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
