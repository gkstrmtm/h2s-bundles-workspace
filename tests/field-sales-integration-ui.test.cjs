// Deterministic synthetic API fixtures. These tests do not activate or call production.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {JSDOM}=require('jsdom');
const source=name=>fs.readFileSync(path.join(__dirname,'..','frontend',name),'utf8');
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));};
const uuid='00000000-0000-4000-8000-000000000001';
function workflowData(){
    return {ok:true,enabled:true,policies:[{policy_id:uuid,kind:'legal',status:'draft',definition:{fixture:true}}],
        workflows:[{quoteId:'quote-fixture',leadId:'lead-fixture',orderId:'order-fixture',revision:2,state:'enrolled',representativeId:'rep-fixture',
            depositCents:2501,balanceCents:7500,netPaidCents:2501,processingFeeCents:null,processingFeeEvidence:null,jobId:uuid,technicianId:null,
            completedAt:null,hours:null,holds:['Installation completion required before balance collection'],expenses:[],documents:[],deliveryEvidence:[],
            requiredArtifacts:[{kind:'quote',label:'Approved quote',content:{fixture:'<img src=x>'}},{kind:'agreement',label:'Agreement',content:{terms:'Synthetic only'}},{kind:'notice',label:'Notice',content:'Synthetic notice'}],
            gates:{canDeposit:false,canBalance:false,canSchedule:false,canAssign:false,canComplete:false},preparation:{revision:3},reservation:null}],nextActions:['preparation']};
}
function earningsData(){
    return {ok:true,enabled:true,externalPaymentInitiated:false,summary:{pendingQualification:1,calculationReview:1,earnedCents:39600,adjustmentCents:-100,allocatedCents:39500,reconciledPaidCents:0},
        orders:[{quoteId:'quote-fixture',orderId:'order-fixture',leadId:'lead-fixture',representativeId:'rep-fixture',totalCents:100000,netPaidCents:100000,completedAt:'2026-01-01',qualifiesAt:'2026-01-02',state:'calculation_review',reasons:['Missing actual fee evidence'],disputed:false,refundedCents:0}],
        entries:[{entryId:'entry-fixture',quoteId:'quote-fixture',orderId:'order-fixture',leadId:'lead-fixture',representativeId:'rep-fixture',qualifiesAt:'2026-01-02',amountCents:39600,basisCents:72000,rateBasisPoints:5500,tenureDay:30,rateEventAt:'2026-01-02',policyId:uuid,inputHash:'fixturehash',snapshot:{fixture:'<img src=x>'},createdAt:'2026-01-02'}],
        adjustments:[{adjustmentId:'adjustment-fixture',entryId:'entry-fixture',representativeId:'rep-fixture',amountCents:-100,reason:'Synthetic adjustment',evidence:'<img src=x>',reviewedBy:'admin-fixture',reviewedAt:'2026-01-02'}],
        runs:[{runId:'run-fixture',runDate:'2026-01-09',policyId:uuid,state:'exported',amountCents:39500,beneficiaries:[{representativeId:'rep-fixture',amountCents:39500}],method:'Synthetic payroll',classification:'Synthetic classification',createdAt:'2026-01-02'}]};
}
function configuredInstallation(){
    const ids=[1,2,3,4].map(n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'));
    return {ok:true,enabled:true,enrolled:true,workflow:{jobId:uuid,quoteId:'quote-fixture',revision:3,canComplete:false,
        proof:{photoCount:3,signatureCount:1,complete:false,missing:['Configured service requirements incomplete'],
            candidates:ids.map((artifactId,i)=>({artifactId,type:i===3?'signature':'photo',createdAt:'2026-01-01T12:00:00Z'})),
            requirements:[{serviceId:'service-a',id:'angles',label:'Two installation angles <img src=x>',type:'photo',minimumCount:2},
                {serviceId:'service-b',id:'finish',label:'Separate service finish',type:'photo',minimumCount:1},
                {serviceId:'service-a',id:'onsite',label:'Onsite customer signature',type:'signature',minimumCount:1},
                {serviceId:'service-b',id:'tested',label:'Personally tested equipment',type:'checklist',minimumCount:1}]
                .map(r=>({...r,artifactIds:[],affirmed:false,complete:false,missingCount:r.minimumCount}))}}};
}
test('configured native evidence and checklist proof support partial saves, fresh gates and cost/proof draft-preserving refresh',async t=>{
    const f=fixture(t,'field-installation.js','H2SFieldInstallation','PRO'),d=configuredInstallation();
    f.respond(async(url,init)=>{
        assert.equal(url,'https://fixture.invalid/api/field-sales-installation'+(init.method==='POST'?'':'?job_id='+uuid));
        if(init.method!=='POST')return Response.json(d);
        const body=JSON.parse(init.body);assert.equal(body.action,'proof_record');
        for(const r of d.workflow.proof.requirements){const binding=body.bindings.find(b=>b.serviceId===r.serviceId&&b.requirementId===r.id),check=body.checklists.find(b=>b.serviceId===r.serviceId&&b.requirementId===r.id);r.artifactIds=binding?.artifactIds||[];r.affirmed=check?.affirmed===true;r.evidence=check?.evidence;r.missingCount=r.type==='checklist'?(r.affirmed?0:1):Math.max(r.minimumCount-r.artifactIds.length,0);r.complete=r.missingCount===0;}
        d.workflow.proof.complete=d.workflow.proof.requirements.every(r=>r.complete);d.workflow.canComplete=d.workflow.proof.complete;d.workflow.revision++;
        return Response.json({ok:true,enrolled:true,proofRecorded:true,revision:d.workflow.revision});
    });
    const handle=f.mount({jobId:uuid,quoteId:'quote-fixture'});await handle.ready;const cost=f.root.querySelector('[data-installation-form]');cost.elements.hours.value='2';cost.querySelector('[name="quantity"]').value='0.07';
    let row=f.root.querySelector('[data-proof-requirement="0"]');row.querySelector('[data-proof-artifact]').checked=true;row.querySelector('[data-proof-artifact]').dispatchEvent(new f.w.Event('change',{bubbles:true}));
    await handle.refresh();assert.equal(f.root.querySelector('[data-proof-requirement="0"] [data-proof-artifact]').checked,true);assert.equal(f.root.querySelector('[data-installation-form]'),cost);assert.equal(cost.elements.hours.value,'2');
    f.submit('[data-installation-proof-form]');await settle();let body=f.calls.find(c=>c.body).body;assert.equal(body.workflowRevision,3);assert.equal(body.action,'proof_record');assert.deepEqual(body.checklists,[]);assert.equal(body.bindings[0].artifactIds.length,1);assert.equal(body.token,undefined);
    assert.equal(cost.querySelector('button[type="submit"]').disabled,true);assert.equal(d.workflow.proof.complete,false);
    const ids=d.workflow.proof.candidates.map(c=>c.artifactId);
    for(const [index,chosen] of [[0,[ids[0],ids[1]]],[1,[ids[2]]],[2,[ids[3]]]])for(const input of f.root.querySelectorAll(`[data-proof-requirement="${index}"] [data-proof-artifact]`)){input.checked=chosen.includes(input.value);input.dispatchEvent(new f.w.Event('change',{bubbles:true}));}
    row=f.root.querySelector('[data-proof-requirement="3"]');row.querySelector('[name="affirmed"]').checked=true;row.querySelector('[name="checklistEvidence"]').value='  Synthetic onsite equipment test  ';
    row.querySelector('[name="affirmed"]').dispatchEvent(new f.w.Event('change',{bubbles:true}));f.submit('[data-installation-proof-form]');await settle();body=f.calls.filter(c=>c.body).at(-1).body;
    assert.equal(body.workflowRevision,4);assert.equal(body.bindings.length,3);assert.deepEqual(body.checklists,[{serviceId:'service-b',requirementId:'tested',affirmed:true,evidence:{reference:'Synthetic onsite equipment test'}}]);
    assert.equal(cost.querySelector('button[type="submit"]').disabled,false);assert.equal(cost.querySelector('[name="quantity"]').value,'0.07');assert.equal(f.root.querySelector('img'),null);assert.equal(f.root.querySelector('a[href]'),null);
    const count=f.calls.filter(c=>c.body).length,input=f.root.querySelector('[data-proof-artifact]');input.checked=false;input.dispatchEvent(new f.w.Event('change',{bubbles:true}));
    f.submit('[data-installation-form]');await settle();assert.equal(f.calls.filter(c=>c.body).length,count);assert.match(f.root.textContent,/Save or retry configured proof/);
    await handle.refresh();assert.equal(f.root.querySelector('[data-proof-artifact]').checked,false);assert.equal(cost.querySelector('button[type="submit"]').disabled,true);
});
test('configured proof rejects shared/noncandidate evidence and unevidenced checklists; interrupted retries stay identical and disposed writes stay hidden',async t=>{
    const f=fixture(t,'field-installation.js','H2SFieldInstallation','PRO'),d=configuredInstallation();f.respond(async()=>Response.json(d));const handle=f.mount({jobId:uuid,quoteId:'quote-fixture'});await handle.ready;
    const first=f.root.querySelector('[data-proof-requirement="0"] [data-proof-artifact]'),other=f.root.querySelector('[data-proof-requirement="1"] [data-proof-artifact]');first.checked=other.checked=true;
    f.submit('[data-installation-proof-form]');await settle();assert.match(f.root.textContent,/cannot be shared/);assert.equal(f.calls.filter(c=>c.body).length,0);
    other.checked=false;const real=first.value;first.value='not-a-native-id';f.submit('[data-installation-proof-form]');await settle();assert.match(f.root.textContent,/matching native evidence/);assert.equal(f.calls.filter(c=>c.body).length,0);first.value=real;
    const check=f.root.querySelector('[data-proof-requirement="3"]');check.querySelector('[name="affirmed"]').checked=true;check.querySelector('[name="checklistEvidence"]').value=' x ';f.submit('[data-installation-proof-form]');await settle();assert.match(f.root.textContent,/at least 3 characters/);assert.equal(f.calls.filter(c=>c.body).length,0);
    check.querySelector('[name="checklistEvidence"]').value='Synthetic verification';f.respond(async()=>{throw Error('Synthetic interrupted proof');});f.submit('[data-installation-proof-form]');await settle();const initial=f.calls.at(-1).body;
    check.querySelector('[name="checklistEvidence"]').value='Changed uncertain evidence';f.submit('[data-installation-proof-form]');await settle();assert.deepEqual(f.calls.at(-1).body,initial);
    let done;f.respond(async()=>({ok:true,status:200,json:()=>new Promise(r=>done=r)}));f.submit('[data-installation-proof-form]');await settle();handle.destroy();done({ok:true,enrolled:true,proofRecorded:true,revision:4});await settle();assert.equal(f.root.children.length,0);
});
test('manager sees pinned completion counts/status without native artifact candidates or raw checklist evidence',async t=>{
    const f=fixture(t,'field-workflow.js','H2SFieldWorkflow'),d=workflowData();d.workflows[0].proof=configuredInstallation().workflow.proof;
    d.workflows[0].proof.requirements[3].evidence={reference:'PRIVATE checklist evidence'};f.respond(async()=>Response.json(d));f.mount();await settle();
    assert.match(f.root.textContent,/Pinned installation requirements/);assert.match(f.root.textContent,/Two installation angles/);assert.match(f.root.textContent,/required 2 \/ Missing 2/);assert.doesNotMatch(f.root.textContent,/PRIVATE checklist evidence/);assert.equal(f.root.querySelector('[data-proof-artifact]'),null);assert.equal(f.root.querySelector('img'),null);
    f.w.H2SFieldWorkflow.reset();f.actor({token:'sales',role:'SALES'});f.mount();await settle();assert.doesNotMatch(f.root.textContent,/Pinned installation requirements/);
});
function fixture(t,script,globalName,role='ADMIN'){
    const dom=new JSDOM('<div id="h2s-app"><section class="field-sales" id="root"></section></div>',{runScripts:'outside-only',url:'https://fixture.invalid'});
    t.after(()=>dom.window.close());const w=dom.window,root=w.document.querySelector('#root'),calls=[],revoked=[];
    let actor={token:'synthetic-only',role},respond;
    w.crypto.randomUUID=crypto.randomUUID;w.console.error=()=>{};w.URL.createObjectURL=()=> 'blob:synthetic-fixture';w.URL.revokeObjectURL=url=>revoked.push(url);
    w.fetch=async(url,init={})=>{calls.push({url,init,body:init.body&&JSON.parse(init.body)});return respond(url,init);};
    w.eval(source(script));
    return {w,root,calls,revoked,respond(fn){respond=fn;},actor(value){actor=value;},
        mount(extra={}){return w[globalName].mount(root,{apiBase:'https://fixture.invalid',getSession:()=>actor,...extra});},
        click(selector){const el=root.querySelector(selector);assert.ok(el,selector);el.click();},
        submit(selector){const f=root.querySelector(selector);assert.ok(f,selector);f.dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true}));}};
}
test('standalone installation/workflow/earnings/commerce request exact GET and POST URLs for origin or /api bases',async t=>{
    const origin='http://127.0.0.1:64170';
    for(const apiBase of [origin,origin+'/',origin+'/api',origin+'/api/',origin+'/api///']){
        for(const [script,name,endpoint] of [['field-installation.js','H2SFieldInstallation','field-sales-installation'],['field-workflow.js','H2SFieldWorkflow','field-sales-workflow'],['field-earnings.js','H2SFieldEarnings','field-sales-earnings'],['field-commerce.js','H2SFieldCommerce','field-sales-transactions']]){
            const f=fixture(t,script,name),isPro=name==='H2SFieldInstallation',isCommerce=name==='H2SFieldCommerce';
            let query=isPro?'?job_id='+uuid:isCommerce?'':name==='H2SFieldWorkflow'?'?quote_id=quote-fixture':'?quoteId=quote-fixture';
            f.respond(async(url,init)=>{
                const post=init.method==='POST',catalog=url===origin+'/api/field-sales-catalog';
                assert.equal(url,catalog?origin+'/api/field-sales-catalog':origin+'/api/'+endpoint+(post?'':query),`${script} ${apiBase} ${init.method||'GET'}`);
                if(post)return Response.json({ok:true,completed:isPro,externalPaymentInitiated:false});
                if(isPro)return Response.json({ok:true,enabled:true,enrolled:true,workflow:{jobId:uuid,quoteId:'quote-fixture',revision:3,canComplete:true,proof:{photoCount:1,signatureCount:1,complete:true,missing:[]}}});
                if(isCommerce)return Response.json(catalog?{ok:true,enabled:true,catalogs:[]}:{ok:true,enabled:false});
                return Response.json(name==='H2SFieldWorkflow'?workflowData():earningsData());
            });
            const handle=f.mount({apiBase,jobId:uuid,quoteId:'quote-fixture',leadId:isCommerce?null:'lead-fixture'});if(isPro)await handle.ready;else await settle();
            assert.equal(f.calls[0].url,origin+'/api/'+endpoint+query);
            if(isPro){
                for(const row of f.root.querySelectorAll('[data-installation-expense]')){for(const name of ['quantity','unitCents','amountCents'])row.querySelector(`[name="${name}"]`).value='1';row.querySelector('[name="actual"]').checked=true;row.querySelector('[name="expenseEvidence"]').value='Synthetic receipt';}
                f.root.querySelector('[name="hours"]').value='1';f.root.querySelector('[name="evidence"]').value='Synthetic installation proof';f.submit('[data-installation-form]');
            }else if(isCommerce){
                const form=f.root.querySelector('[data-commerce-catalog-action="create_draft"]');form.elements.version.value='Synthetic version';form.elements.definition.value='{"fixture":true}';form.elements.sourceEvidence.value='Synthetic approved source';f.submit('[data-commerce-catalog-action="create_draft"]');
            }else if(name==='H2SFieldWorkflow'){f.root.querySelector('[data-workflow-form="documents_publish"]').elements.evidence.value='Synthetic approval';f.submit('[data-workflow-form="documents_publish"]');}
            else f.click('[data-earnings-review]');
            await settle();const post=f.calls.find(c=>c.body);assert.ok(post,`${script} posted`);assert.equal(post.url,origin+'/api/'+(isCommerce?'field-sales-catalog':endpoint));
            if(isCommerce){query='?leadId=lead-fixture';f.mount({apiBase,leadId:'lead-fixture'});await settle();assert.equal(f.calls.at(-1).url,origin+'/api/'+endpoint+query);}
            assert.ok(f.calls.every(c=>!c.url.includes('/api/api/')));
        }
    }
});
test('workflow uses authoritative gates, exact readonly documents, camelCase commands and evidence objects',async t=>{
    const f=fixture(t,'field-workflow.js','H2SFieldWorkflow'),d=workflowData();
    f.respond(async(url,init)=>Response.json(init.method==='POST'?{ok:true}:d));f.mount({quoteId:'quote-fixture'});await settle();
    assert.match(f.calls[0].url,/\?quote_id=quote-fixture$/);assert.equal(f.root.querySelector('img'),null);
    assert.equal(f.root.querySelector('[data-workflow-form="schedule"] button').disabled,true);
    assert.equal(f.root.querySelector('[data-workflow-form="assign"] button').disabled,true);
    const docs=f.root.querySelector('[data-workflow-form="documents_publish"]');assert.equal(docs.elements.artifacts.readOnly,true);docs.elements.evidence.value='Synthetic documented approval';
    f.submit('[data-workflow-form="documents_publish"]');await settle();
    const body=f.calls.find(c=>c.body).body;assert.equal(body.action,'documents_publish');assert.equal(body.quoteId,'quote-fixture');assert.equal(body.revision,2);
    assert.deepEqual(body.artifacts,d.workflows[0].requiredArtifacts);assert.deepEqual(body.evidence,{reference:'Synthetic documented approval'});assert.ok(body.operationId);
    assert.equal(body.operation_id,undefined);
});
test('workflow SALES role hides policy/write controls, VA never fetches, default-off does not fabricate empty readiness',async t=>{
    const f=fixture(t,'field-workflow.js','H2SFieldWorkflow','SALES');f.respond(async()=>Response.json(workflowData()));f.mount();await settle();
    assert.equal(f.root.querySelector('form'),null);assert.match(f.root.textContent,/Current net balance/);
    f.w.H2SFieldWorkflow.reset();f.actor({token:'va',role:'VA'});const count=f.calls.length;f.mount();await settle();assert.equal(f.calls.length,count);
    f.actor({token:'admin',role:'ADMIN'});f.respond(async()=>Response.json({ok:true,enabled:false}));f.mount();await settle();
    assert.match(f.root.textContent,/disabled/);assert.equal(f.root.querySelector('form'),null);
});
test('workflow retains exact retry and discards late private results after reset',async t=>{
    const f=fixture(t,'field-workflow.js','H2SFieldWorkflow');f.respond(async()=>Response.json(workflowData()));f.mount();await settle();
    const form=f.root.querySelector('[data-workflow-form="preparation"]');form.elements.note.value='Synthetic preparation';
    f.respond(async()=>{throw Error('Synthetic interrupted response');});f.submit('[data-workflow-form="preparation"]');await settle();
    const first=f.calls.at(-1).body;form.elements.note.value='Must not replace uncertain input';f.click('[data-workflow-retry]');await settle();assert.deepEqual(f.calls.at(-1).body,first);
    let done;f.respond(async()=>({ok:true,status:200,json:()=>new Promise(r=>done=r)}));f.mount();await settle();f.w.H2SFieldWorkflow.reset();done(workflowData());await settle();assert.equal(f.root.children.length,0);
});
test('workflow reuses036 preparation record revisions and041 server assignment context, never handwritten context',async t=>{
    const f=fixture(t,'field-workflow.js','H2SFieldWorkflow'),d=workflowData(),w=d.workflows[0];
    w.preparation={record:{revision:7},context:{fixture:true},ready:true,blockers:[]};w.gates.canAssign=true;
    w.assignmentPreview={enabled:true,job:{jobId:uuid,context:'synthetic-server-context'},technicians:[{proId:uuid,name:'Synthetic technician'}]};
    f.respond(async(url,init)=>Response.json(init.method==='POST'?{ok:true}:d));f.mount();await settle();
    const prep=f.root.querySelector('[data-workflow-form="preparation"]');assert.equal(prep.elements.preparationRevision.value,'7');prep.elements.note.value='Synthetic ready evidence';prep.elements.blockers.value='';
    f.submit('[data-workflow-form="preparation"]');await settle();let body=f.calls.find(c=>c.body).body;assert.equal(body.preparationRevision,7);assert.equal(body.blockers,'');
    const assign=f.root.querySelector('[data-workflow-form="assign"]');assert.equal(assign.elements.context.type,'hidden');assign.elements.proId.value=uuid;assign.elements.note.value='Synthetic managed offer';
    f.submit('[data-workflow-form="assign"]');await settle();body=f.calls.filter(c=>c.body).at(-1).body;assert.equal(body.context,'synthetic-server-context');assert.equal(body.proId,uuid);
});
test('policy update/approval binds viewed definition hash, blocks missing hash and requires reload after stale409',async t=>{
    const f=fixture(t,'field-workflow.js','H2SFieldWorkflow'),d=workflowData();let stale=false;
    f.respond(async(url,init)=>init.method==='POST'?Response.json(stale?{ok:false,error:'Policy changed; reload the current definition hash.'}:{ok:true},{status:stale?409:200}):Response.json(d));
    f.mount();await settle();assert.equal(f.root.querySelector('[data-workflow-form="policy_approve"] button').disabled,true);
    f.root.querySelector('[data-workflow-form="policy_approve"] [name="evidence"]').value='Synthetic management evidence';
    f.submit('[data-workflow-form="policy_approve"]');await settle();assert.equal(f.calls.filter(c=>c.body).length,0);assert.match(f.root.textContent,/definition hash unavailable/);
    d.policies[0].definitionHash='synthetic-viewed-definition-hash';f.mount();await settle();
    f.submit('[data-workflow-form="policy_update"]');await settle();assert.equal(f.calls.find(c=>c.body).body.expectedDefinitionHash,'synthetic-viewed-definition-hash');
    stale=true;f.root.querySelector('[data-workflow-form="policy_approve"] [name="evidence"]').value='Synthetic approval';
    f.submit('[data-workflow-form="policy_approve"]');await settle();assert.match(f.root.textContent,/Policy changed; reload/);const old=f.calls.filter(c=>c.body).at(-1).body;
    assert.equal(old.expectedDefinitionHash,'synthetic-viewed-definition-hash');
    d.policies[0].definitionHash='synthetic-new-definition-hash';stale=false;f.click('[data-workflow-refresh]');await settle();f.root.querySelector('[data-workflow-form="policy_approve"] [name="evidence"]').value='Synthetic refreshed approval';
    f.submit('[data-workflow-form="policy_approve"]');await settle();const fresh=f.calls.filter(c=>c.body).at(-1).body;assert.equal(fresh.expectedDefinitionHash,'synthetic-new-definition-hash');assert.notEqual(fresh.operationId,old.operationId);
});
test('commission DTO renders actual immutable amounts and separates exported from independently reconciled paid',async t=>{
    const f=fixture(t,'field-earnings.js','H2SFieldEarnings','SALES');f.respond(async()=>Response.json(earningsData()));f.mount();await settle();
    assert.match(f.root.textContent,/\$396\.00/);assert.match(f.root.textContent,/55%/);assert.match(f.root.textContent,/tenure day 30/);
    assert.match(f.root.textContent,/exported/);assert.match(f.root.textContent,/Independently reconciled paid\s*\$0\.00/);assert.equal(f.root.querySelector('form'),null);assert.equal(f.root.querySelector('img'),null);
});
test('allocated negative correction displays recovery review, not representative debt or authorized clawback',async t=>{
    const f=fixture(t,'field-earnings.js','H2SFieldEarnings','SALES'),d=earningsData();d.adjustments[0].effect='earning_correction_not_debt';d.adjustments[0].settlementState='recovery_review_required';
    f.respond(async()=>Response.json(d));f.mount();await settle();assert.match(f.root.textContent,/New runs are blocked/);assert.match(f.root.textContent,/not representative debt or authorization to recover money/);assert.equal(f.root.querySelector('form'),null);
});
test('admin Friday run only permits state-correct review/export/settlement and validates settlement proof',async t=>{
    const f=fixture(t,'field-earnings.js','H2SFieldEarnings');let d=earningsData();
    f.respond(async(url,init)=>Response.json(init.method==='POST'?{ok:true}:d));f.mount();await settle();
    assert.equal(f.root.querySelector('[data-earnings-form="run_review"]'),null);
    const form=f.root.querySelector('[data-earnings-form="record_settlement"]');form.elements.method.value='Synthetic payroll';form.elements.reference.value='SYNTHETIC-NO-TRANSFER';
    form.elements.settledAt.value='2026-01-09T12:00';form.elements.amountCents.value='39500';form.elements.evidence.value='Synthetic independently reconciled fixture';form.elements.independentReconciliation.checked=true;
    f.submit('[data-earnings-form="record_settlement"]');await settle();const body=f.calls.find(c=>c.body).body;
    assert.equal(body.action,'record_settlement');assert.equal(body.proof.independentReconciliation,true);assert.equal(body.proof.amountCents,39500);assert.equal(body.externalPaymentInitiated,undefined);
    d=earningsData();d.runs[0].state='draft';f.mount();await settle();assert.equal(f.root.querySelector('[name="action"]').value,'approve_run');assert.equal(f.root.querySelector('[data-earnings-form="record_settlement"]'),null);
    d.runs[0].state='approved';f.mount();await settle();assert.equal(f.root.querySelector('[name="action"]').value,'export_run');
    f.root.querySelector('[data-earnings-form="run_review"] [name="evidence"]').value='Synthetic export approval';
    f.respond(async(url,init)=>Response.json(init.method==='POST'?{ok:true,runId:'run-fixture',state:'exported',amountCents:39500,beneficiaries:d.runs[0].beneficiaries}:d));
    f.submit('[data-earnings-form="run_review"]');await settle();assert.match(f.root.querySelector('a[download]').textContent,/not proof of payment/);
    f.w.H2SFieldEarnings.reset();assert.equal(f.revoked.length,1);
});
test('settlement UI never defaults missing/invalid settledAt or skips independent reconciliation',async t=>{
    const f=fixture(t,'field-earnings.js','H2SFieldEarnings');f.respond(async()=>Response.json(earningsData()));f.mount();await settle();
    const form=f.root.querySelector('[data-earnings-form="record_settlement"]');form.elements.method.value='Synthetic payroll';form.elements.reference.value='Synthetic reference';form.elements.evidence.value='Synthetic reconciled proof';form.elements.amountCents.value='39500';form.elements.independentReconciliation.checked=true;
    for(const value of ['', 'not-a-date']){form.elements.settledAt.value=value;f.submit('[data-earnings-form="record_settlement"]');await settle();assert.match(f.root.textContent,/valid explicit settlement date and time/);assert.equal(f.calls.filter(c=>c.body).length,0);}
    form.elements.settledAt.value='2026-01-09T12:00';form.elements.independentReconciliation.checked=false;f.submit('[data-earnings-form="record_settlement"]');await settle();assert.match(f.root.textContent,/Independent reconciliation/);assert.equal(f.calls.filter(c=>c.body).length,0);
});
test('ADMIN abandonment requires current capability, explicit confirmation and audited payload; retains history without debt',async t=>{
    const f=fixture(t,'field-earnings.js','H2SFieldEarnings'),d=earningsData();d.runs[0].state='approved';d.runs[0].canAbandon=true;
    f.respond(async(url,init)=>{if(init.method==='POST'){d.runs[0].state='abandoned';d.runs[0].canAbandon=false;d.runs[0].abandonment={reason:'<img src=x>',abandonedBy:'Synthetic admin',abandonedAt:'2026-01-09'};return Response.json({ok:true,runId:'run-fixture',state:'abandoned',effectiveAllocationsReleased:true,externalPaymentInitiated:false});}return Response.json(d);});f.mount();await settle();
    const form=f.root.querySelector('[data-earnings-form="abandon_run"]');form.elements.reason.value='  Synthetic failed review  ';form.elements.evidence.value='  Synthetic accounting evidence  ';
    f.submit('[data-earnings-form="abandon_run"]');await settle();assert.equal(f.calls.filter(c=>c.body).length,0);assert.match(f.root.textContent,/Intentional confirmation/);
    form.elements.abandonConfirmed.checked=true;form.elements.reason.value=' x ';f.submit('[data-earnings-form="abandon_run"]');await settle();assert.equal(f.calls.filter(c=>c.body).length,0);
    form.elements.reason.value='  Synthetic failed review  ';form.elements.evidence.value='  ';f.submit('[data-earnings-form="abandon_run"]');await settle();assert.equal(f.calls.filter(c=>c.body).length,0);
    form.elements.evidence.value='  Synthetic accounting evidence  ';f.submit('[data-earnings-form="abandon_run"]');await settle();const body=f.calls.find(c=>c.body).body;
    assert.deepEqual({...body,operationId:undefined},{action:'abandon_run',runId:'run-fixture',reason:'Synthetic failed review',evidence:'Synthetic accounting evidence',operationId:undefined});assert.match(body.operationId,/^[0-9a-f-]{36}$/);
    assert.equal(f.root.querySelector('[data-earnings-form="abandon_run"]'),null);assert.equal(f.root.querySelector('[data-earnings-form="run_review"]'),null);assert.equal(f.root.querySelector('[data-earnings-form="record_settlement"]'),null);assert.equal(f.root.querySelector('img'),null);
    assert.match(f.root.textContent,/immutable review history remains/);assert.match(f.root.textContent,/no money sent, debt or clawback authorized/);
});
test('abandonment is absent for SALES, exported/paid/abandoned, unknown states and missing/false capability; errors remain explicit',async t=>{
    for(const [role,state,canAbandon] of [['SALES','draft',true],['ADMIN','exported',true],['ADMIN','reconciled_paid',true],['ADMIN','abandoned',true],['ADMIN','unknown',true],['ADMIN','draft',false],['ADMIN','approved',undefined]]){
        const f=fixture(t,'field-earnings.js','H2SFieldEarnings',role),d=earningsData();Object.assign(d.runs[0],{state,canAbandon});f.respond(async()=>Response.json(d));f.mount();await settle();assert.equal(f.root.querySelector('[data-earnings-form="abandon_run"]'),null,`${role}/${state}/${canAbandon}`);
    }
    const f=fixture(t,'field-earnings.js','H2SFieldEarnings'),d=earningsData();Object.assign(d.runs[0],{state:'draft',canAbandon:true});f.respond(async(url,init)=>init.method==='POST'?Response.json({ok:false,error:'Run exported concurrently; abandonment rejected'},{status:409}):Response.json(d));f.mount();await settle();
    const form=f.root.querySelector('[data-earnings-form="abandon_run"]');form.elements.reason.value='Synthetic rejection review';form.elements.evidence.value='Synthetic evidence';form.elements.abandonConfirmed.checked=true;f.submit('[data-earnings-form="abandon_run"]');await settle();assert.match(f.root.textContent,/Run exported concurrently/);assert.doesNotMatch(f.root.textContent,/Unexported run abandoned with audit history retained/);
    const count=f.calls.length;f.actor({token:'synthetic-only',role:'SALES'});f.submit('[data-earnings-form="abandon_run"]');await settle();assert.equal(f.calls.length,count);assert.equal(f.root.children.length,0);
});
test('technician enhancement never probes legacy by default, verifies job mapping and completes with actual costs/hours despite unpaid balance',async t=>{
    const f=fixture(t,'field-installation.js','H2SFieldInstallation','PRO');f.respond(async()=>{throw Error('Legacy must not probe');});
    f.mount({jobId:uuid});await settle();assert.equal(f.calls.length,0);assert.equal(f.root.children.length,0);
    let completed;
    f.respond(async(url,init)=>Response.json(init.method==='POST'?{ok:true,enrolled:true,completed:true,jobId:uuid,quoteId:'quote-fixture',balanceCollectionEligible:true,externalPaymentInitiated:false}:
        {ok:true,enabled:true,enrolled:true,workflow:{quoteId:'quote-fixture',jobId:uuid,revision:4,state:'scheduled',completedAt:null,expenses:[],hours:null,canComplete:true,proof:{photoCount:1,signatureCount:1,complete:true,missing:[]},gates:{canComplete:true,canBalance:false}}}));
    const mounted=f.mount({jobId:uuid,quoteId:'quote-fixture',onCompleted:r=>completed=r});await mounted.ready;
    const rows=f.root.querySelectorAll('[data-installation-expense]');assert.equal(rows.length,2);
    for(const [i,row] of [...rows].entries()){row.querySelector('[name="quantity"]').value='1';row.querySelector('[name="unitCents"]').value=String(i?0:20000);row.querySelector('[name="amountCents"]').value=String(i?0:20000);row.querySelector('[name="actual"]').checked=true;row.querySelector('[name="zeroCostAttestation"]').value=i?'Verified synthetic customer-owned materials':'';row.querySelector('[name="expenseEvidence"]').value=i?'Synthetic customer-owned/zero-cost evidence':'Synthetic receipt';}
    f.root.querySelector('[name="hours"]').value='2.5';f.root.querySelector('[name="evidence"]').value='Synthetic completed installation';
    f.submit('[data-installation-form]');await settle();const body=f.calls.at(-1).body;
    assert.match(f.calls.at(-1).url,/field-sales-installation$/);assert.equal(body.workflowRevision,4);assert.equal(body.hours,2.5);assert.equal(body.expenses[1].category,'materials');assert.equal(body.expenses[1].amountCents,0);assert.equal(body.expenses[0].evidence.reference,'Synthetic receipt');
    assert.equal(body.expenses[0].unitCents,20000);assert.equal(body.expenses[0].actual,true);assert.equal(body.expenses[1].zeroCostAttestation,'Verified synthetic customer-owned materials');
    assert.ok(body.operationId);assert.equal(body.operation_id,undefined);assert.equal(body.workflow_revision,undefined);assert.equal(completed.completed,true);assert.match(f.root.textContent,/Customer balance and commission are verified separately/);mounted.destroy();assert.equal(f.root.children.length,0);
});
test('technician costs reject missing category, missing actual attestation, inconsistent totals and unattested zero',async t=>{
    const f=fixture(t,'field-installation.js','H2SFieldInstallation','PRO');f.respond(async()=>Response.json({ok:true,enabled:true,enrolled:true,workflow:{jobId:uuid,quoteId:'quote-fixture',revision:3,canComplete:true,proof:{photoCount:1,signatureCount:1,complete:true,missing:[]}}}));
    await f.mount({jobId:uuid,quoteId:'quote-fixture'}).ready;
    const rows=[...f.root.querySelectorAll('[data-installation-expense]')];
    for(const row of rows){row.querySelector('[name="quantity"]').value='1';row.querySelector('[name="unitCents"]').value='100';row.querySelector('[name="amountCents"]').value='100';row.querySelector('[name="expenseEvidence"]').value='Synthetic receipt';}
    f.root.querySelector('[name="hours"]').value='1';f.root.querySelector('[name="evidence"]').value='Synthetic complete';
    f.submit('[data-installation-form]');await settle();assert.match(f.root.textContent,/actual-cost attestation is required/);assert.equal(f.calls.filter(c=>c.body).length,0);
    for(const row of rows)row.querySelector('[name="actual"]').checked=true;
    rows[0].querySelector('[name="amountCents"]').value='99';f.submit('[data-installation-form]');await settle();assert.match(f.root.textContent,/exactly equal/);assert.equal(f.calls.filter(c=>c.body).length,0);
    rows[0].querySelector('[name="amountCents"]').value='100';rows[1].querySelector('[name="unitCents"]').value='0';rows[1].querySelector('[name="amountCents"]').value='0';
    f.submit('[data-installation-form]');await settle();assert.match(f.root.textContent,/zero-cost attestation is required/);assert.equal(f.calls.filter(c=>c.body).length,0);
    rows[1].querySelector('[name="zeroCostAttestation"]').value='Verified synthetic zero';rows[1].querySelector('[name="category"]').value='equipment';
    f.submit('[data-installation-form]');await settle();assert.match(f.root.textContent,/both equipment and materials/);assert.equal(f.calls.filter(c=>c.body).length,0);
    rows[1].querySelector('[name="category"]').value='materials';
    for(const hours of ['', '0', '0.009', '10000.01']){f.root.querySelector('[name="hours"]').value=hours;f.submit('[data-installation-form]');await settle();assert.match(f.root.textContent,/0.01 to 10000/);assert.equal(f.calls.filter(c=>c.body).length,0);}
});
test('ADMIN explicitly reviews separate technician costs; zero and corrections require evidenced immutable approval',async t=>{
    const f=fixture(t,'field-workflow.js','H2SFieldWorkflow'),d=workflowData(),w=d.workflows[0];
    w.completedAt='2026-01-01';w.state='completed';w.costsComplete=false;w.expenses=[];w.technicianExpenses=[
        {category:'equipment',quantity:2,unitCents:10000,amountCents:20000,evidence:{reference:'Synthetic equipment receipt'},actual:true},
        {category:'materials',quantity:1,unitCents:0,amountCents:0,evidence:{reference:'Synthetic materials receipt'},actual:true,zeroCostAttestation:'Verified synthetic customer-owned materials'}];
    f.respond(async(url,init)=>Response.json(init.method==='POST'?{ok:true}:d));f.mount();await settle();
    assert.match(f.root.textContent,/Technician costs are not approved costs/);assert.equal(f.calls.filter(c=>c.body).length,0);
    let form=f.root.querySelector('[data-workflow-form="cost_review"]');assert.ok(form);form.elements.evidence.value='Synthetic reviewed corrections';
    f.submit('[data-workflow-form="cost_review"]');await settle();assert.match(f.root.textContent,/management actual-cost review attestation is required/);assert.equal(f.calls.filter(c=>c.body).length,0);
    form.elements.actualCostsReviewed.checked=true;
    f.submit('[data-workflow-form="cost_review"]');await settle();assert.match(f.root.textContent,/Each reviewed cost needs explicit/);assert.equal(f.calls.filter(c=>c.body).length,0);
    for(const row of form.querySelectorAll('[data-workflow-cost-row]'))row.querySelector('[name="actual"]').checked=true;
    const rows=form.querySelectorAll('[data-workflow-cost-row]');rows[1].querySelector('[name="zeroCostAttestation"]').value='';
    f.submit('[data-workflow-form="cost_review"]');await settle();assert.match(f.root.textContent,/reviewed zero-cost attestation is required/);assert.equal(f.calls.filter(c=>c.body).length,0);
    rows[1].querySelector('[name="zeroCostAttestation"]').value='Reviewed verified zero';rows[0].querySelector('[name="unitCents"]').value='9000';rows[0].querySelector('[name="amountCents"]').value='18000';rows[0].querySelector('[name="rowEvidence"]').value='Synthetic correction receipt';
    f.submit('[data-workflow-form="cost_review"]');await settle();const body=f.calls.find(c=>c.body).body;
    assert.equal(body.action,'cost_review');assert.equal(body.expenses[0].amountCents,18000);assert.equal(body.expenses[0].unitCents,9000);assert.equal(body.expenses[0].actual,true);assert.equal(body.expenses[1].zeroCostAttestation,'Reviewed verified zero');
    assert.deepEqual(body.evidence,{reference:'Synthetic reviewed corrections',actualCostsReviewed:true});assert.deepEqual(Object.keys(body).sort(),['action','evidence','expenses','leadId','operationId','quoteId','revision']);
    assert.equal(w.technicianExpenses[0].amountCents,20000);w.costsComplete=true;w.expenses=body.expenses;f.mount();await settle();assert.equal(f.root.querySelector('[data-workflow-form="cost_review"]'),null);
});
test('SALES immutable financial history never renders private customer snapshots/evidence or grants customer detail links',async t=>{
    const f=fixture(t,'field-earnings.js','H2SFieldEarnings','SALES'),d=earningsData();
    d.entries[0].snapshot={customer:{address:'PRIVATE-REASSIGNED-ADDRESS',phone:'PRIVATE-REASSIGNED-PHONE',photos:['https://private.invalid/photo']},quote:{private:'PRIVATE-QUOTE-SNAPSHOT'}};
    d.adjustments[0].evidence='PRIVATE-ADJUSTMENT-EVIDENCE';f.respond(async()=>Response.json(d));f.mount();await settle();
    assert.match(f.root.textContent,/\$396\.00/);assert.doesNotMatch(f.root.textContent,/PRIVATE-/);assert.equal(f.root.querySelector('a'),null);
});
test('late earnings/workflow responses are cleared after logout or same-token role change, never resurfacing previous data',async t=>{
    for(const [script,name,data] of [['field-earnings.js','H2SFieldEarnings',earningsData()],['field-workflow.js','H2SFieldWorkflow',workflowData()]]){
        const f=fixture(t,script,name,'ADMIN');let done;f.respond(async()=>({ok:true,status:200,json:()=>new Promise(r=>done=r)}));f.mount();await settle();
        f.actor({token:'synthetic-only',role:'SALES'});done(data);await settle();assert.equal(f.root.children.length,0);
        f.actor({token:'synthetic-only',role:'ADMIN'});f.mount();await settle();f.w[name].reset();f.actor({token:'',role:null});done(data);await settle();assert.equal(f.root.children.length,0);
    }
});
test('technician installation fails closed on mismatched job, unavailable API or ended session',async t=>{
    const f=fixture(t,'field-installation.js','H2SFieldInstallation','PRO');f.respond(async()=>Response.json({ok:true,enabled:true,enrolled:true,workflow:{jobId:'wrong-job',quoteId:'quote-fixture',revision:2,canComplete:true}}));
    await f.mount({jobId:uuid,quoteId:'quote-fixture'}).ready;assert.match(f.root.textContent,/mismatch/);assert.equal(f.root.querySelector('form'),null);
    f.respond(async()=>Response.json({ok:true,enabled:false}));await f.mount({jobId:uuid,quoteId:'quote-fixture'}).ready;assert.equal(f.root.children.length,0);
    let done;f.respond(async()=>({ok:true,json:()=>new Promise(r=>done=r)}));const mounted=f.mount({jobId:uuid,quoteId:'quote-fixture'});await settle();mounted.destroy();done({ok:true,enabled:true,enrolled:true});await mounted.ready;assert.equal(f.root.children.length,0);
});
test('existing customer page uses secure-token checkout commands, downloads exact copies, provider refresh only and refuses dangerous URLs',async t=>{
    const dom=new JSDOM(source('field-agreement.html'),{runScripts:'outside-only',url:'https://fixture.invalid/field-agreement.html#token='+'a'.repeat(64)});t.after(()=>dom.window.close());
    const w=dom.window,calls=[],d={ok:true,quote:{quote_id:'quote-fixture',quote_hash:'hash',revision:2,expires_at:'2099-01-01',snapshot:{customer:{name:'Synthetic customer',address:'Fixture address',city:'Fixture',phone:'555'},catalogVersion:'Synthetic pricing',totalCents:10001,lines:[]}},
        agreement:{accepted_at:'2026-01-01',acceptance:{name:'Synthetic customer'},policy_snapshot:{version:'synthetic-legal',terms:'Synthetic terms',payment_terms:'Synthetic payment',cancellation_information:'Synthetic notice',electronic_delivery:'Synthetic delivery',paymentPlan:{depositCents:2501,remainingAfterDepositCents:7500}}},
        workflow:{documents:[{kind:'notice',label:'Approved synthetic notice',content:{fixture:'<img src=x>'},contentHash:'hash'}],gates:{canDeposit:true,canBalance:false},netPaidCents:0,balanceCents:7500,completedAt:null,payments:[{checkout_id:'checkout-fixture',state:'checkout_created',captured_cents:0,refunded_cents:0,disputed:false}]}};
    w.crypto.randomUUID=crypto.randomUUID;w.console.error=()=>{};w.URL.createObjectURL=()=> 'blob:synthetic-copy';w.URL.revokeObjectURL=()=>{};
    w.document.querySelector('meta[name="h2s-api-base"]').content='http://127.0.0.1:64170/api/';
    w.fetch=async(url,init)=>{assert.equal(url,'http://127.0.0.1:64170/api/field-sales-agreement');const body=init.body&&JSON.parse(init.body);calls.push({url,init,body});return Response.json(body?.action==='checkout'?{ok:true,checkoutUrl:'javascript:alert(1)'}:d);};
    w.eval(source('field-agreement.js'));await settle();assert.equal(w.location.hash,'');assert.equal(w.document.querySelector('img'),null);assert.match(w.document.body.textContent,/Exact new-sales 25% deposit: \$25\.01/);
    w.document.querySelector('[data-agreement-checkout]').click();await settle();assert.deepEqual(Object.keys(calls.find(c=>c.body).body).sort(),['action','kind','operationId']);assert.match(w.document.querySelector('[role="alert"]').textContent,/Untrusted checkout URL/);assert.equal(w.document.querySelector('a[href^="javascript"]'),null);
    w.document.querySelector('[data-agreement-verify]').click();await settle();assert.equal(calls.filter(c=>c.body).at(-1).body.action,'refresh_payment');assert.equal(calls.filter(c=>c.body).at(-1).body.checkoutId,'checkout-fixture');
    d.workflow.netPaidCents=2501;d.workflow.gates.canDeposit=false;w.document.querySelector('[data-agreement-refresh]').click();await settle();assert.equal(w.document.querySelector('[data-agreement-checkout]').disabled,true);assert.equal(w.document.querySelector('[data-agreement-checkout]').dataset.agreementCheckout,'balance');
    assert.equal(w.localStorage.length,0);assert.ok(calls.every(c=>!c.url.includes('token')));
});
test('ADMIN catalog uses existing configuration API, drafts remain unapproved and publish requires exact digest/evidence',async t=>{
    const f=fixture(t,'field-commerce.js','H2SFieldCommerce'),catalog={catalog_id:uuid,version:'Synthetic version',status:'draft',definition:{services:[]},source_evidence:{reference:'Synthetic reviewed source'},digest:'a'.repeat(64),approved_by:null,published_at:null};
    f.respond(async(url,init)=>Response.json(init.method==='POST'?{ok:true}:url.includes('field-sales-catalog')?{ok:true,enabled:true,catalogs:[catalog]}:{ok:true,enabled:false}));
    f.mount({leadId:null});await settle();assert.ok(f.root.querySelector('[data-commerce-catalog-admin]'));
    const create=f.root.querySelector('[data-commerce-catalog-action="create_draft"]');create.elements.version.value='Synthetic next version';create.elements.definition.value=JSON.stringify({fixture:true});create.elements.sourceEvidence.value='Synthetic reconciliation evidence';
    f.submit('[data-commerce-catalog-action="create_draft"]');await settle();const body=f.calls.find(c=>c.body).body;
    assert.match(f.calls.find(c=>c.body).url,/field-sales-catalog$/);assert.equal(body.action,'create_draft');assert.deepEqual(body.definition,{fixture:true});assert.deepEqual(body.sourceEvidence,{reference:'Synthetic reconciliation evidence'});assert.equal(body.leadId,undefined);
    f.root.querySelector('[data-commerce-catalog-action="publish"] [name="approvalEvidence"]').value='Synthetic management publication approval';
    f.submit('[data-commerce-catalog-action="publish"]');await settle();assert.equal(f.calls.filter(c=>c.body).length,1);assert.match(f.root.textContent,/Explicit publication confirmation/);
    f.root.querySelector('[data-commerce-catalog-action="publish"] [name="publishConfirmed"]').checked=true;
    f.submit('[data-commerce-catalog-action="publish"]');await settle();const published=f.calls.filter(c=>c.body).at(-1).body;assert.equal(published.expectedDigest,'a'.repeat(64));assert.equal(published.approvalEvidence,'Synthetic management publication approval');assert.equal(published.action,'publish');
    f.w.H2SFieldCommerce.reset();f.actor({token:'synthetic-rep',role:'SALES'});const count=f.calls.filter(c=>c.url.includes('field-sales-catalog')).length;f.mount({leadId:null});await settle();assert.equal(f.calls.filter(c=>c.url.includes('field-sales-catalog')).length,count);assert.equal(f.root.querySelector('[data-commerce-catalog-admin]'),null);
});
test('existing commerce refund is management-only, explicit evidence and actual provider command, never automatic cancellation refund',async t=>{
    const f=fixture(t,'field-commerce.js','H2SFieldCommerce'),d={ok:true,enabled:true,catalogs:[],policyReady:false,depositConfigured:false,agreements:[],orders:[],
        quotes:[{quote_id:'quote-fixture',lead_id:'lead-fixture',revision:2,state:'approved',quote_hash:'hash',expires_at:'2099-01-01',snapshot:{customer:{name:'Synthetic customer',market:'residential'},lines:[],totalCents:10001,catalogVersion:'Synthetic',approvalReasons:[]}}],
        payments:[{quote_id:'quote-fixture',checkout_id:'checkout-fixture',session_id:'synthetic-session',state:'paid',kind:'deposit',amount_cents:2501,captured_cents:2501,refunded_cents:0}],
        workflows:[{quoteId:'quote-fixture',state:'refund_review',gates:{canDeposit:false,canBalance:false}}]};
    f.respond(async(url,init)=>Response.json(init.method==='POST'?{ok:true,providerVerificationRequired:true}:d));f.mount({leadId:'lead-fixture'});await settle();
    assert.equal(f.calls.filter(c=>c.body).length,0);const form=f.root.querySelector('[data-commerce-refund]');form.elements.amountCents.value='2501';form.elements.evidence.value='Synthetic reviewed refund';f.submit('[data-commerce-refund]');await settle();
    assert.equal(f.calls.filter(c=>c.body).length,0);form.elements.authorized.checked=true;f.submit('[data-commerce-refund]');await settle();const body=f.calls.find(c=>c.body).body;
    assert.equal(body.action,'refund');assert.equal(body.amountCents,2501);assert.deepEqual(body.evidence,{reference:'Synthetic reviewed refund'});assert.equal(body.authorized,undefined);assert.ok(body.operationId);
    f.actor({token:'synthetic-rep',role:'SALES'});f.mount({leadId:'lead-fixture'});await settle();assert.equal(f.root.querySelector('[data-commerce-refund]'),null);
});
test('accepted enrolled agreement renews finite scoped link without changing acceptance or claiming payment',async t=>{
    const f=fixture(t,'field-commerce.js','H2SFieldCommerce','SALES'),d={ok:true,enabled:true,catalogs:[],policyReady:true,depositConfigured:true,payments:[],orders:[],
        quotes:[{quote_id:'quote-fixture',lead_id:'lead-fixture',revision:2,state:'approved',quote_hash:'hash',expires_at:'2026-01-01',snapshot:{customer:{name:'Synthetic customer',market:'residential'},lines:[],totalCents:10001,catalogVersion:'Synthetic',approvalReasons:[]}}],
        agreements:[{quote_id:'quote-fixture',accepted_at:'2026-01-01'}],workflows:[{quoteId:'quote-fixture',state:'completed',gates:{canBalance:true}}]};
    f.respond(async(url,init)=>Response.json(init.method==='POST'?{ok:true,agreementUrl:'https://fixture.invalid/field-agreement.html#token='+'a'.repeat(64),handoffId:uuid,expiresAt:'2026-11-05T00:00:00Z',scope:'accepted_documents_balance'}:d));
    f.mount({leadId:'lead-fixture'});await settle();assert.match(f.root.querySelector('[data-commerce-agreement]').textContent,/Renew finite/);
    f.click('[data-commerce-agreement]');await settle();assert.equal(f.calls.find(c=>c.body).body.action,'agreement_link');assert.match(f.root.querySelector('[data-commerce-handoff]').textContent,/Secure handoff expires/);assert.match(f.root.textContent,/Customer copies and eligible remaining balance/);assert.doesNotMatch(f.root.textContent,/accepted_documents_balance/);
    assert.match(f.root.textContent,/does not extend initial acceptance or imply payment/);assert.equal(d.agreements[0].accepted_at,'2026-01-01');
});
test('expired customer link exposes no customer data and asks for finite renewal, not late acceptance',async t=>{
    const dom=new JSDOM(source('field-agreement.html'),{runScripts:'outside-only',url:'https://fixture.invalid/field-agreement.html#token='+'a'.repeat(64)});t.after(()=>dom.window.close());const w=dom.window;w.console.error=()=>{};
    w.fetch=async()=>Response.json({ok:false,error:'Secure link expired.'},{status:401});w.eval(source('field-agreement.js'));await settle();
    assert.match(w.document.body.textContent,/fresh finite customer-copy\/payment link/);assert.match(w.document.body.textContent,/cannot record late initial acceptance/);assert.equal(w.document.querySelector('form'),null);assert.equal(w.location.hash,'');
});
test('existing FieldSales mounts Orders/Performance/Commissions and submits approved representative terms without changing identity',async t=>{
    const dom=new JSDOM('<div id="h2s-app"><div class="app-sidebar-group" data-group-id="admin"><div class="app-sidebar-group-items"></div></div><div class="app-content"></div></div>',{runScripts:'outside-only',url:'https://fixture.invalid'});
    t.after(()=>dom.window.close());const w=dom.window,calls=[],mounts=[];w.crypto.randomUUID=crypto.randomUUID;w.console.error=()=>{};
    w.H2SFieldWorkflow={reset(){},mount(root,options){mounts.push({kind:'orders',options});root.textContent='Synthetic order module';}};
    w.H2SFieldEarnings={reset(){},mount(root,options){mounts.push({kind:options.view,options});root.textContent='Synthetic earnings module';}};
    w.fetch=async(url,init)=>{assert.equal(url,'http://127.0.0.1:64170/api/field-sales');calls.push({url,body:init.body&&JSON.parse(init.body)});return Response.json({ok:true,enabled:true,services:[],opportunities:[],total:0,representatives:[{user_id:uuid,display_name:'Synthetic rep',username:'SYNTHETIC',active:false,commission_start_date:null,commission_terms_revision:3}]});};
    w.eval(source('field-sales.js'));w.H2SFieldSales.configure({apiBase:'http://127.0.0.1:64170/api/',getSession:()=>({token:'synthetic-admin',role:'ADMIN'})});w.H2SFieldSales.open();await settle();
    for(const view of ['orders','performance','commissions']){w.document.querySelector(`[data-sales-mode="${view}"]`).click();await settle();assert.equal(mounts.at(-1).kind,view);}
    w.document.querySelector('[data-sales-mode="representatives"]').click();await settle();const form=w.document.querySelector('[data-sales-form="representative_terms"]');
    form.elements.commissionStartDate.value='2026-01-01';form.elements.commissionStartEvidence.value='Synthetic approved start event';
    form.dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true}));await settle();const body=calls.find(c=>c.body).body;
    assert.equal(body.action,'representative_terms');assert.equal(body.userId,uuid);assert.equal(body.termsRevision,3);assert.equal(body.commissionStartDate,'2026-01-01');assert.equal(body.commissionStartEvidence,'Synthetic approved start event');assert.ok(body.operationId);assert.equal(body.originating_user_id,undefined);
    const unset=w.document.querySelector('[data-sales-form="representative_terms"]');unset.elements.commissionStartDate.value='';unset.elements.commissionStartEvidence.value='Synthetic explicit tenure unset review';
    unset.dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true}));await settle();assert.equal(calls.filter(c=>c.body).at(-1).body.commissionStartDate,null);
});
test('catalog is independently gated and shows explicit errors; a late catalog read cannot survive logout',async t=>{
    const f=fixture(t,'field-commerce.js','H2SFieldCommerce');
    f.respond(async(url)=>Response.json(url.includes('field-sales-catalog')?{ok:true,enabled:false,catalogs:[]}:{ok:true,enabled:false}));f.mount({leadId:null});await settle();
    assert.match(f.root.textContent,/Catalog administration disabled/);assert.equal(f.root.querySelector('[data-commerce-catalog-action]'),null);
    f.respond(async(url)=>url.includes('field-sales-catalog')?Response.json({ok:false,error:'Synthetic unavailable catalog schema'},{status:503}):Response.json({ok:true,enabled:false}));f.mount({leadId:null});await settle();
    assert.match(f.root.textContent,/Synthetic unavailable catalog schema/);assert.equal(f.root.querySelector('[data-commerce-catalog-action]'),null);
    let done;f.respond(async(url)=>url.includes('field-sales-catalog')?({ok:true,status:200,json:()=>new Promise(r=>done=r)}):Response.json({ok:true,enabled:false}));
    f.mount({leadId:null});await settle();assert.match(f.root.textContent,/Loading transaction visibility/);f.w.H2SFieldCommerce.reset();f.actor({token:'',role:null});done({ok:true,enabled:true,catalogs:[]});await settle();assert.equal(f.root.children.length,0);
});
test('own SALES commission profile is visible without ADMIN commission terms controls; late representative read is cleared',async t=>{
    const dom=new JSDOM('<div id="h2s-app"><div class="app-sidebar-group" data-group-id="admin"><div class="app-sidebar-group-items"></div></div><div class="app-content"></div></div>',{runScripts:'outside-only',url:'https://fixture.invalid'});t.after(()=>dom.window.close());
    const w=dom.window;let actor={token:'synthetic-sales',role:'SALES'},done;w.crypto.randomUUID=crypto.randomUUID;w.console.error=()=>{};
    w.fetch=async()=>Response.json({ok:true,enabled:true,services:[],opportunities:[],total:0,commissionProfile:{commission_start_date:'2026-01-01',commission_start_evidence:'Synthetic own approved start',commission_terms_revision:4}});
    w.eval(source('field-sales.js'));w.H2SFieldSales.configure({apiBase:'https://fixture.invalid',getSession:()=>actor});w.H2SFieldSales.open();await settle();
    assert.match(w.document.body.textContent,/My approved commission start: 2026-01-01 \/ terms revision 4/);assert.equal(w.document.querySelector('[data-sales-form="representative_terms"]'),null);
    actor={token:'synthetic-admin',role:'ADMIN'};w.fetch=async()=>({ok:true,status:200,json:()=>new Promise(r=>done=r)});w.H2SFieldSales.open();await settle();
    w.H2SFieldSales.reset();actor={token:'',role:null};done({ok:true,enabled:true,representatives:[{display_name:'PRIVATE-LATE-REP'}]});await settle();assert.doesNotMatch(w.document.body.textContent,/PRIVATE-LATE-REP/);
});
test('pro mount ready exposes verified enrollment, disabled unknown and lifecycle cleanup without legacy mutation',async t=>{
    const f=fixture(t,'field-installation.js','H2SFieldInstallation','PRO');let capability;
    f.respond(async()=>Response.json({ok:true,enabled:true,enrolled:true,workflow:{jobId:uuid,quoteId:'quote-fixture',revision:3,canComplete:true,proof:{photoCount:1,signatureCount:1,complete:true,missing:[]}}}));
    const mounted=f.mount({jobId:uuid,quoteId:'quote-fixture',onCapability:r=>capability=r});const result=await mounted.ready;assert.equal(result.enrolled,true);assert.equal(result.workflow.revision,3);assert.equal(capability,result);assert.ok(f.root.classList.contains('field-installation'));mounted.destroy();assert.equal(f.root.children.length,0);
    f.respond(async()=>Response.json({ok:true,enabled:false}));const disabled=await f.mount({jobId:uuid,quoteId:'quote-fixture',onCapability:r=>capability=r}).ready;assert.equal(disabled.enrolled,null);assert.equal(disabled.enabled,false);assert.equal(capability,disabled);
});
test('saved photo/signature proof gates completion and host refresh preserves actual-cost drafts and existing upload hooks',async t=>{
    const f=fixture(t,'field-installation.js','H2SFieldInstallation','PRO'),capabilities=[];
    let d={ok:true,enabled:true,enrolled:true,workflow:{jobId:uuid,quoteId:'quote-fixture',revision:3,canComplete:false,proof:{photoCount:0,signatureCount:0,complete:false,missing:['Upload installation photos','Collect customer signature']}}};
    f.respond(async()=>Response.json(d));const mounted=f.mount({jobId:uuid,quoteId:'quote-fixture',onCapability:c=>capabilities.push(c)});await mounted.ready;
    assert.match(f.root.textContent,/Upload installation photos; Collect customer signature/);const form=f.root.querySelector('[data-installation-form]'),row=form.querySelector('[data-installation-expense]');
    row.querySelector('[name="quantity"]').value='0.07';row.querySelector('[name="unitCents"]').value='100';row.querySelector('[name="amountCents"]').value='7';form.elements.hours.value='2';
    assert.equal(form.querySelector('button[type="submit"]').disabled,true);
    d.workflow={...d.workflow,canComplete:true,proof:{photoCount:2,signatureCount:1,complete:true,missing:[]}};const result=await mounted.refresh();
    assert.equal(result.workflow.proof.complete,true);assert.equal(f.root.querySelector('[data-installation-form]'),form);assert.equal(row.querySelector('[name="quantity"]').value,'0.07');assert.equal(form.elements.hours.value,'2');
    assert.equal(form.querySelector('button[type="submit"]').disabled,false);assert.match(f.root.textContent,/Saved installation photos: 2 \/ customer signatures: 1/);assert.equal(capabilities.length,2);
    assert.equal(f.calls.filter(c=>c.body).length,0); // No photo/signature handlers or uploads are replaced/called.
    f.respond(async()=>Response.json({ok:false,error:'Synthetic proof authorization unavailable'},{status:503}));
    const failed=await mounted.refresh();assert.equal(failed.unavailable,true);assert.equal(form.querySelector('button[type="submit"]').disabled,true);assert.equal(f.root.querySelector('[data-installation-form]'),form);mounted.destroy();
});
test('out-of-order proof refresh and destroyed refresh never overwrite current capability or resurrect job data',async t=>{
    const f=fixture(t,'field-installation.js','H2SFieldInstallation','PRO');const dto=complete=>({ok:true,enabled:true,enrolled:true,workflow:{jobId:uuid,quoteId:'quote-fixture',revision:3,canComplete:complete,proof:{photoCount:complete?1:0,signatureCount:complete?1:0,complete,missing:complete?[]:['Collect customer signature']}}});
    f.respond(async()=>Response.json(dto(false)));const mounted=f.mount({jobId:uuid,quoteId:'quote-fixture'});await mounted.ready;
    let done;f.respond(async()=>({ok:true,status:200,json:()=>new Promise(r=>done=r)}));const old=mounted.refresh();await settle();
    f.respond(async()=>Response.json(dto(true)));await mounted.refresh();done(dto(false));assert.equal((await old).superseded,true);assert.equal(f.root.querySelector('[data-installation-form] button[type="submit"]').disabled,false);
    f.respond(async()=>({ok:true,status:200,json:()=>new Promise(r=>done=r)}));const late=mounted.refresh();await settle();mounted.destroy();done(dto(true));assert.equal((await late).disposed,true);assert.equal(f.root.children.length,0);
});
