// Synthetic UI-to-authority integration: actual route/library code and additive SQL
// run in createWorkflowFixture's isolated PGlite database. No production HTTP, .env,
// credentials, payment provider or schema activation.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {JSDOM}=require('jsdom');
const {createWorkflowFixture,id}=require('../backend/tests/helpers/field_workflow_fixture.cjs');
const source=name=>fs.readFileSync(path.join(__dirname,'..','frontend',name),'utf8');
async function waitFor(predicate){
    for(let i=0;i<1000;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}
    throw Error('Timed out waiting for the synthetic UI-to-SQL authority.');
}
function browser(t,f,actor){
    const dom=new JSDOM('<div id="h2s-app"><section id="root" class="field-sales"></section></div>',{runScripts:'outside-only',url:'https://fixture.invalid'});
    t.after(()=>dom.window.close());const w=dom.window,calls=[],root=w.document.querySelector('#root');
    w.crypto.randomUUID=crypto.randomUUID;w.console.error=()=>{};
    w.fetch=async(url,init={})=>{
        const method=init.method||'GET',body=init.body&&JSON.parse(init.body),request=new Request(url,{method,headers:init.headers,...(init.body?{body:init.body}:{})});
        const call={url,body,status:null};calls.push(call);
        const route=url.includes('/field-sales-installation')?f.installationRoute:url.includes('/field-sales-workflow')?f.workflowRoute:null;
        if(!route)throw Error('Unexpected fixture endpoint; real HTTP prohibited.');
        const response=await route[method](request);call.status=response.status;return response;
    };
    return {w,root,calls,session:()=>({token:actor,role:actor==='admin'?'ADMIN':'PRO'}),
        submit(form){form.dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true}));}};
}
test('captured pro/ADMIN UI cost payloads and policy hash lifecycle are accepted by real routes and046 SQL',async t=>{
    const f=await createWorkflowFixture();t.after(()=>f.db.close());f.definition.services[0].offers[0].unitCents=10001;
    f.definition.services[0].completionRequirements=[
        {id:'installation-photo',label:'Installed equipment photo',type:'photo',minimumCount:1},
        {id:'onsite-signature',label:'Onsite customer signature',type:'signature',minimumCount:1},
        {id:'functional-check',label:'Personally tested installed equipment',type:'checklist',minimumCount:1}];
    await f.enable();const record=await f.enrolled();await f.accept(await f.documents(record));await f.collect(record);
    const read=async()=>(await(await f.read(record.leadId)).json()).workflows[0];
    let workflow=await read();
    let result=await(await f.admin({action:'schedule',...record,revision:workflow.revision,reservationRevision:0,start:'2099-03-03T15:00:00Z',
        end:'2099-03-03T17:00:00Z',timezone:'America/New_York',customerAgreed:true,reason:'Synthetic agreed window'})).json();assert.equal(result.ok,true,result.error);
    workflow=await read();result=await(await f.admin({action:'preparation',...record,revision:workflow.revision,preparationRevision:0,scopeReviewed:true,materials:'ready',access:'ready',blockers:'',note:'Synthetic actual-cost fixture ready'})).json();assert.equal(result.ok,true,result.error);
    workflow=await read();result=await(await f.admin({action:'assign',...record,revision:workflow.revision,proId:id(500),context:workflow.assignmentPreview.job.context,note:'Synthetic technician'})).json();assert.equal(result.ok,true,result.error);
    await f.db.query('select h2s_management_respond_to_offer($1,$2,$3)',[workflow.jobId,id(500),'accept']);
    const pro=browser(t,f,'pro');pro.w.eval(source('field-installation.js'));
    const installation=pro.w.H2SFieldInstallation.mount(pro.root,{apiBase:'https://fixture.invalid',getSession:pro.session,jobId:workflow.jobId,quoteId:record.quoteId});
    const capability=await installation.ready;assert.equal(capability.enrolled,true);assert.equal(capability.workflow.proof.complete,false);
    assert.equal(capability.workflow.canComplete,false);
    assert.equal(capability.workflow.proof.requirements.length,3);
    assert.ok(capability.workflow.proof.missing.length>0);
    assert.ok(capability.workflow.proof.requirements.every(r=>r.complete===false&&(r.artifactIds||[]).length===0&&r.affirmed!==true));
    assert.equal(pro.root.querySelector('[data-installation-form] button[type="submit"]').disabled,true);
    const rows=pro.root.querySelectorAll('[data-installation-expense]');
    for(const [i,row] of [...rows].entries()){
        row.querySelector('[name="quantity"]').value=i?'0':'0.07';
        row.querySelector('[name="unitCents"]').value=i?'0':'100';
        row.querySelector('[name="amountCents"]').value=i?'0':'7';
        row.querySelector('[name="actual"]').checked=true;
        row.querySelector('[name="expenseEvidence"]').value='Synthetic source receipt';
        row.querySelector('[name="zeroCostAttestation"]').value=i?'No synthetic consumables used':'';
    }
    pro.root.querySelector('[name="hours"]').value='2';pro.root.querySelector('[name="evidence"]').value='Synthetic completed installation';
    const draftForm=pro.root.querySelector('[data-installation-form]');
    const claimedProof=await f.complete({job_id:workflow.jobId,operationId:crypto.randomUUID(),workflowRevision:capability.workflow.revision,
        expenses:[{category:'equipment',quantity:0.07,unitCents:100,amountCents:7,actual:true,evidence:{reference:'Synthetic source receipt'}},
            {category:'materials',quantity:0,unitCents:0,amountCents:0,actual:true,zeroCostAttestation:'No synthetic consumables',evidence:{reference:'Synthetic source receipt'}}],
        hours:2,evidence:{reference:'Claimed photos/signature without saved artifacts'}});
    assert.equal(claimedProof.status,400);
    await f.uploadProof(workflow.jobId,['photo']);
    const photoOnly=await installation.refresh();assert.equal(photoOnly.workflow.proof.photoCount,1);assert.equal(photoOnly.workflow.proof.signatureCount,0);assert.equal(photoOnly.workflow.proof.complete,false);
    assert.equal(pro.root.querySelector('[data-installation-form] button[type="submit"]').disabled,true);
    await f.uploadProof(workflow.jobId,['signature']);
    const uploadedProof=await installation.refresh();assert.equal(uploadedProof.workflow.proof.complete,false);assert.equal(uploadedProof.workflow.canComplete,false);
    assert.equal(uploadedProof.workflow.proof.requirements.length,3);
    assert.ok(uploadedProof.workflow.proof.requirements.every(r=>r.complete===false&&(r.artifactIds||[]).length===0&&r.affirmed!==true));
    pro.root.querySelector('[data-proof-requirement="0"] [data-proof-artifact]').checked=true;
    pro.submit(pro.root.querySelector('[data-installation-proof-form]'));
    await waitFor(()=>pro.calls.some(c=>c.body?.action==='proof_record'&&c.status===200));
    await waitFor(()=>/Saved requirement satisfied/.test(pro.root.textContent));
    const partialProof=await installation.refresh();assert.equal(partialProof.workflow.proof.complete,false);assert.equal(partialProof.workflow.canComplete,false);
    assert.equal(pro.calls.find(c=>c.body?.action==='proof_record').body.bindings.length,1);
    assert.deepEqual(pro.calls.find(c=>c.body?.action==='proof_record').body.checklists,[]);
    for(const row of pro.root.querySelectorAll('[data-proof-requirement]')){
        const artifact=row.querySelector('[data-proof-artifact]');
        if(artifact)artifact.checked=true;
        else{row.querySelector('[name="affirmed"]').checked=true;row.querySelector('[name="checklistEvidence"]').value='Synthetic onsite functional check';}
    }
    pro.submit(pro.root.querySelector('[data-installation-proof-form]'));
    await waitFor(()=>pro.calls.filter(c=>c.body?.action==='proof_record'&&c.status!==null).length===2);
    const saved=pro.calls.filter(c=>c.body?.action==='proof_record').at(-1);assert.equal(saved.status,200);
    assert.equal(saved.body.bindings.length,2);assert.equal(saved.body.checklists.length,1);assert.equal(saved.body.token,undefined);
    assert.equal(saved.body.expenses,undefined);assert.equal(saved.body.hours,undefined); // Saving proof is separate from guarded completion.
    await waitFor(()=>pro.root.querySelector('[data-installation-form] button[type="submit"]').disabled===false);
    const verifiedProof=await installation.refresh();assert.equal(verifiedProof.workflow.proof.complete,true);assert.equal(verifiedProof.workflow.canComplete,true);
    assert.ok(verifiedProof.workflow.proof.requirements.every(r=>r.complete===true));
    assert.equal(verifiedProof.workflow.proof.artifacts,undefined);assert.equal(pro.root.querySelector('[data-installation-form]'),draftForm);
    assert.equal(rows[0].querySelector('[name="quantity"]').value,'0.07');assert.equal(draftForm.elements.hours.value,'2');
    assert.equal(pro.root.querySelector('[data-installation-form] button[type="submit"]').disabled,false);assert.ok(f.proofStorage.size>=2);
    const obsoleteZero=await f.complete({job_id:workflow.jobId,operationId:crypto.randomUUID(),workflowRevision:verifiedProof.workflow.revision,
        expenses:[{category:'equipment',quantity:0.07,unitCents:100,amountCents:7,actual:true,evidence:{reference:'Synthetic source receipt'}},
            {category:'materials',quantity:0,unitCents:0,amountCents:0,actual:true,evidence:{reference:'Synthetic source receipt',zeroCostAttested:true}}],
        hours:2,evidence:{reference:'Synthetic completed installation'}});
    assert.equal(obsoleteZero.status,400);
    pro.submit(pro.root.querySelector('[data-installation-form]'));
    await waitFor(()=>pro.calls.some(c=>c.body&&c.body.action!=='proof_record'&&c.status!==null));assert.equal(pro.calls.find(c=>c.body&&c.body.action!=='proof_record').status,200);
    await waitFor(()=>/completion confirmed/.test(pro.root.textContent));
    const completion=pro.calls.find(c=>c.body&&c.body.action!=='proof_record').body;
    assert.deepEqual(completion.expenses[0],{category:'equipment',quantity:0.07,unitCents:100,amountCents:7,evidence:{reference:'Synthetic source receipt'},actual:true});
    assert.equal(completion.expenses[1].zeroCostAttestation,'No synthetic consumables used');assert.equal(completion.expenses[1].evidence.zeroCostAttested,undefined);
    workflow=await read();assert.ok(workflow.completedAt);assert.equal(workflow.netPaidCents,2501);assert.equal(workflow.balanceCents,7500);assert.equal(workflow.costsComplete,false);assert.deepEqual(workflow.expenses,[]);
    assert.equal(workflow.proof.complete,true);assert.equal(workflow.proof.artifacts,undefined);
    await assert.rejects(f.db.query('delete from h2s_dispatch_job_artifacts where job_id::text=$1',[workflow.jobId]),/Completed installation proof is immutable/);
    assert.deepEqual(workflow.technicianExpenses,completion.expenses);
    assert.equal((await f.admin({action:'cost_review',...record,revision:workflow.revision,expenses:completion.expenses,
        evidence:{reference:'Missing explicit management attestation'}})).status,400);
    const legacyBoolean=completion.expenses.map(e=>e.amountCents?e:{...e,zeroCostAttestation:undefined,evidence:{...e.evidence,zeroCostAttested:true}});
    assert.equal((await f.db.query('select field_sales_workflow_validate_costs($1::jsonb) valid',[JSON.stringify(legacyBoolean)])).rows[0].valid,false);
    const admin=browser(t,f,'admin');admin.w.eval(source('field-workflow.js'));
    admin.w.H2SFieldWorkflow.mount(admin.root,{apiBase:'https://fixture.invalid',getSession:admin.session,leadId:record.leadId,quoteId:record.quoteId});
    await waitFor(()=>admin.root.querySelector('[data-workflow-form="cost_review"]'));
    const costForm=admin.root.querySelector('[data-workflow-form="cost_review"]');
    for(const row of costForm.querySelectorAll('[data-workflow-cost-row]'))row.querySelector('[name="actual"]').checked=true;
    costForm.elements.evidence.value='Synthetic management actual-cost approval';costForm.elements.actualCostsReviewed.checked=true;
    admin.submit(costForm);
    await waitFor(()=>admin.calls.some(c=>c.body?.action==='cost_review'&&c.status!==null));assert.equal(admin.calls.find(c=>c.body?.action==='cost_review').status,200);
    const review=admin.calls.find(c=>c.body?.action==='cost_review').body;
    assert.deepEqual(review.expenses,completion.expenses);assert.deepEqual(review.evidence,{reference:'Synthetic management actual-cost approval',actualCostsReviewed:true});
    workflow=await read();assert.equal(workflow.costsComplete,true);assert.equal(workflow.costApprovedBy,id(9));assert.deepEqual(workflow.expenses,completion.expenses);
    assert.deepEqual(workflow.technicianExpenses,completion.expenses);assert.equal(workflow.costReviewEvidence.actualCostsReviewed,true);
    await waitFor(()=>!admin.root.querySelector('[data-workflow-form="cost_review"]'));
    const create=admin.root.querySelector('[data-workflow-form="policy_create"]'),policyId=id(990);
    const dto=await(await f.read(record.leadId)).json(),definition=dto.policies.find(p=>p.kind==='settlement').definition;
    create.elements.policyId.value=policyId;create.elements.kind.value='settlement';create.elements.definition.value=JSON.stringify(definition);admin.submit(create);
    await waitFor(()=>admin.calls.some(c=>c.body?.action==='policy_create'&&c.status!==null));assert.equal(admin.calls.find(c=>c.body?.action==='policy_create').status,200);
    assert.equal(admin.calls.find(c=>c.body?.action==='policy_create').body.expectedDefinitionHash,undefined);
    const findForm=action=>[...admin.root.querySelectorAll(`[data-workflow-form="${action}"]`)].find(form=>form.elements.policyId.value===policyId);
    await waitFor(()=>findForm('policy_update'));
    const viewedHash=findForm('policy_update').elements.expectedDefinitionHash.value;assert.ok(viewedHash);
    findForm('policy_update').elements.definition.value=JSON.stringify({...definition,cutoff:'13:00'});admin.submit(findForm('policy_update'));
    await waitFor(()=>admin.calls.some(c=>c.body?.action==='policy_update'&&c.status!==null));assert.equal(admin.calls.find(c=>c.body?.action==='policy_update').status,200);
    assert.equal(admin.calls.find(c=>c.body?.action==='policy_update').body.expectedDefinitionHash,viewedHash);
    await waitFor(()=>findForm('policy_approve')?.elements.expectedDefinitionHash.value!==viewedHash&&findForm('policy_approve'));
    const currentHash=findForm('policy_approve').elements.expectedDefinitionHash.value;
    findForm('policy_approve').elements.evidence.value='Synthetic reviewed latest policy';admin.submit(findForm('policy_approve'));
    await waitFor(()=>admin.calls.some(c=>c.body?.action==='policy_approve'&&c.status!==null));assert.equal(admin.calls.find(c=>c.body?.action==='policy_approve').status,200);
    assert.equal(admin.calls.find(c=>c.body?.action==='policy_approve').body.expectedDefinitionHash,currentHash);
    const approved=(await(await f.read(record.leadId)).json()).policies.find(p=>p.policy_id===policyId);assert.equal(approved.status,'approved');assert.equal(approved.definitionHash,currentHash);
    assert.equal(f.portalEffects.payouts,0);
});
