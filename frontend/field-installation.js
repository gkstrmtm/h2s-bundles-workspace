(function (global) {
    'use strict';
    const apiRoot = base => String(base).replace(/\/+$/,'').replace(/\/api$/i,'') + '/api';
    const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function exactCost(quantity,unitCents,amountCents){
        const [whole,fraction='']=quantity.split('.');
        const millionths=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
        return millionths*BigInt(unitCents)===BigInt(amountCents)*1000000n;
    }
    // Parent binds only a server-verified enrolled job in the existing pro-auth job detail.
    // Never mounts on a legacy job, and never intercepts the legacy completion handler.
    function mount(root, options) {
        const endpoint=options.company===true?'field-sales-company-installation':'field-sales-installation';
        const session = options.getSession(), started = session?.token;
        if (!started || !options.jobId || !(options.enrolled === true || options.quoteId || options.probeEnabled === true)) {
            root.replaceChildren(); const skipped={enabled:false,enrolled:null,skipped:true};return {ready:Promise.resolve(skipped),refresh:async()=>skipped,destroy() {root.replaceChildren();}};
        }
        let ended = false, busy = false, reading = false, readVersion = 0, attempt = null, rows = 1, workflow, proofDirty=false, completionConfirmed=false;
        const proofDrafts=new Map();
        const controller = new AbortController();
        const valid = () => {
            if(!ended&&options.getSession()?.token!==started){ended=true;readVersion++;attempt=workflow=null;controller.abort();root.replaceChildren();}
            return !ended;
        };
        root.classList.add('field-sales','field-installation');
        root.innerHTML = '<p data-installation-status role="status">Verifying exact enrolled job and assigned technician…</p>';
        function render() {
        root.innerHTML = `<h3>${options.company===true?'Installation evidence & actual costs':'New sales installation evidence'}</h3><p data-installation-status role="status" aria-live="polite">Record actual equipment/materials and hours, not estimates. Management reviews costs separately before commission calculation. Final customer balance is collected after completion, not required to complete installation.</p>
            <div data-installation-proof></div>${options.company===true?'':'<button type="button" data-installation-refresh>Refresh saved installation proof</button>'}
            <form data-installation-form class="field-sales__form">
                <div class="field-sales__wide" data-installation-expenses></div>
                <button type="button" data-installation-add>Add actual expense line</button>
                <label>Actual technician hours<input name="hours" type="number" step="0.01" min="0.01" max="10000" required></label>
                ${options.company===true?'<label>Actual installation date (device timezone)<input name="performedAt" type="datetime-local" required></label>':''}
                <label class="field-sales__wide">Completion / service evidence<textarea name="evidence" required maxlength="6000"></textarea></label>
                <button type="submit" disabled>Record installation completion</button></form>`;
            rows = 1; add('equipment'); rows = 2; add('materials');
            updateProof();
        }
        function updateProof(){
            const target=root.querySelector('[data-installation-proof]');if(!target||!valid())return;
            const proof=workflow?.proof;
            if(proofDirty)for(const row of target.querySelectorAll('[data-proof-requirement]')){
                proofDrafts.set(row.dataset.proofKey,{artifactIds:[...row.querySelectorAll('[data-proof-artifact]:checked')].map(e=>e.value),affirmed:row.querySelector('[name="affirmed"]')?.checked===true,reference:row.querySelector('[name="checklistEvidence"]')?.value||''});
            }
            target.innerHTML=proof?`<p>Saved installation photos: ${esc(proof.photoCount)} / customer signatures: ${esc(proof.signatureCount)}</p>
                <p>${proof.complete===true?'Installation proof verified for this assigned job.':'Complete the required photographs, signature and onsite checks below.'}</p>
                ${Array.isArray(proof.requirements)&&proof.requirements.length?proofForm(proof):''}`:'<p>Installation proof verification unavailable. Completion remains blocked.</p>';
            const submit=root.querySelector('[data-installation-form] button[type="submit"]');
            if(submit)submit.disabled=reading||proofDirty||attempt?.action==='proof_record'||workflow?.canComplete!==true||proof?.complete!==true;
            target.querySelectorAll('input,textarea,button').forEach(el=>el.disabled=reading||completionConfirmed||!!workflow?.completedAt);
            if(workflow?.completedAt||completionConfirmed){
                root.querySelectorAll('[data-installation-form] input,[data-installation-form] select,[data-installation-form] textarea,[data-installation-form] button').forEach(el=>el.disabled=true);
                status('Installation already completed. Customer net balance and management cost review are verified separately.');
            }else if(proofDirty||attempt?.action==='proof_record')status(options.company===true?'Save the selected evidence and onsite checks before completing this installation. Interrupted saves retain the same operation.':'Evidence selections are not yet server-confirmed. Save selected proof (an interrupted retry keeps the identical operation), then refresh server readiness.');
            else if(proof?.complete!==true)status(options.company===true?'Upload photographs and the customer signature above, then save the required evidence selections and onsite checks below.':'Use the job upload and signature controls, refresh, then save the evidence selections and onsite checks below. Written notes cannot replace saved photographs or signatures.');
            else if(workflow?.canComplete!==true)status('Photo/signature proof is saved, but assigned-job/readiness gates still block completion. Final balance is not a completion gate.');
            else status('Saved photo/signature proof verified. Record actual costs and hours before submitting completion.');
        }
        function proofForm(proof){
            return `<form data-installation-proof-form><h4>${options.company===true?'Required installation evidence':'Pinned service completion requirements'}</h4>
                <p>${options.company===true?'Select the saved evidence for each required view and confirm the onsite checks. Every required item must be complete before recording the installation.':'Use evidence captured through this job\'s existing upload/signature controls. Each configured requirement needs distinct evidence; baseline photo/signature checks may reuse it. Saving replaces all configured selections and checklist affirmations. Partial saves do not clear unmet requirements.'}</p>
                ${proof.requirements.map((r,index)=>{
                    const key=JSON.stringify([r.serviceId,r.id]),draft=proofDrafts.get(key),selected=draft?.artifactIds||r.artifactIds||[];
                    const candidates=(proof.candidates||[]).filter(c=>c.type===r.type);
                    return `<fieldset data-proof-requirement="${index}" data-proof-key="${esc(key)}"><legend>${esc(r.label)}</legend>
                        <p>${esc(options.serviceNames?.[r.serviceId]||'Installation service')} · ${esc({photo:'Photographs',signature:'Customer signatures',checklist:'Onsite checklist'}[r.type]||'Evidence')} · ${esc(r.minimumCount)} required</p>
                        <p><strong>${r.complete===true?'Saved and verified':r.type==='checklist'?'Missing onsite confirmation and written evidence':'Missing '+esc(r.missingCount)+' saved evidence item(s)'}</strong></p>
                        ${r.type==='checklist'?`<label class="field-installation__check field-sales__check"><input type="checkbox" name="affirmed"${(draft?draft.affirmed:r.affirmed===true)?' checked':''}>I personally completed this onsite check</label>
                            <label>Checklist completion evidence<textarea name="checklistEvidence" minlength="3" maxlength="4000">${esc(draft?draft.reference:r.evidence?.reference||'')}</textarea></label>`:
                            ['photo','signature'].includes(r.type)?`${candidates.map((c,i)=>`<label class="field-installation__check field-sales__check"><input type="checkbox" data-proof-artifact value="${esc(c.artifactId)}"${selected.includes(c.artifactId)?' checked':''}>${c.type==='photo'?'Photograph':'Customer signature'} ${i+1} · ${esc(new Date(c.createdAt).toLocaleString())}</label>`).join('')||(options.company===true?'<p>Upload the required image above. Saved evidence appears here automatically.</p>':'<p>No matching saved evidence. Use the job upload/signature control, then refresh.</p>')}`:'<p>Unsupported requirement type. Completion remains subject to server clearance.</p>'}
                        </fieldset>`;
                }).join('')}<button type="submit">Save selected installation proof</button></form>`;
        }
        function status(text,error=false) {
            if (!valid()) return;
            const el = root.querySelector('[data-installation-status]');
            if (el) {el.textContent = text; el.setAttribute('role',error ? 'alert' : 'status');}
        }
        function add(category='equipment') {
            root.querySelector('[data-installation-expenses]').insertAdjacentHTML('beforeend',`<fieldset data-installation-expense><legend>Actual expense ${rows}</legend>
                <label>Category<select name="category"><option value="equipment"${category==='equipment'?' selected':''}>Equipment</option><option value="materials"${category==='materials'?' selected':''}>Installation materials</option></select></label>
                <label>Quantity (up to 6 decimal places)<input name="quantity" type="number" min="0" max="100000" step="0.000001" required></label>
                <label>Actual unit cost (integer cents)<input name="unitCents" type="number" min="0" step="1" required></label>
                <label>Total actual line cost (integer cents, not unit price)<input name="amountCents" type="number" min="0" step="1" required></label>
                <label>Receipt / customer-owned / zero-cost evidence<textarea name="expenseEvidence" required maxlength="4000"></textarea></label>
                <label>Zero-cost attestation (required when total is zero)<textarea name="zeroCostAttestation" maxlength="2000"></textarea></label>
                <label class="field-sales__wide field-installation__check field-sales__check"><input name="actual" type="checkbox" required>I attest this quantity, unit cost and line total are actual, evidenced costs—not estimates.</label>
                <button type="button" data-installation-remove>Remove expense line</button></fieldset>`);
        }
        const click = event => {
            const b = event.target.closest('button'); if (!b || busy || !valid()) return;
            if(b.hasAttribute('data-installation-refresh')){load();return;}
            if (b.hasAttribute('data-installation-add')) { if (rows >= 50) {status('Maximum 50 actual expense lines.',true);return;}rows++;add(); }
            if (b.hasAttribute('data-installation-remove')) {
                if (rows <= 1) {status('Record actual or evidenced zero-cost/customer-owned equipment/materials; do not omit unknown costs.',true);return;}
                b.closest('[data-installation-expense]').remove(); rows--;
            }
        };
        const change=event=>{
            if(!event.target.closest('[data-installation-proof-form]')||!valid()||completionConfirmed)return;
            proofDirty=true;const button=root.querySelector('[data-installation-form] button[type="submit"]');if(button)button.disabled=true;
            status('Unsaved evidence selections. Save selected proof before completion; checkbox state alone is not clearance.');
        };
        async function saveProof(f){
            if(busy||reading||!valid())return;
            try{
                if(completionConfirmed||workflow?.completedAt)throw Error('Completed proof is immutable.');
                if(attempt&&attempt.action!=='proof_record')throw Error('Retry the interrupted completion unchanged before a different operation.');
                if(!attempt){
                    if(!Array.isArray(workflow?.proof?.requirements)||!workflow.proof.requirements.length||!Array.isArray(workflow.proof.candidates))throw Error('Configured proof authority or native candidates unavailable. Refresh verified job detail.');
                    const bindings=[],checklists=[],used=new Set();
                    for(const row of f.querySelectorAll('[data-proof-requirement]')){
                        const r=workflow.proof.requirements[Number(row.dataset.proofRequirement)];
                        if(!r||row.dataset.proofKey!==JSON.stringify([r.serviceId,r.id]))throw Error('Requirement binding changed. Refresh verified job detail.');
                        if(r.type==='checklist'){
                            if(row.querySelector('[name="affirmed"]').checked){const reference=row.querySelector('[name="checklistEvidence"]').value.trim();if(reference.length<3)throw Error('Every affirmed checklist needs explicit completion evidence (at least 3 characters).');
                                checklists.push({serviceId:r.serviceId,requirementId:r.id,affirmed:true,evidence:{reference}});}
                        }else if(['photo','signature'].includes(r.type)){
                            const artifactIds=[...row.querySelectorAll('[data-proof-artifact]:checked')].map(el=>el.value);
                            for(const id of artifactIds){
                                if(!workflow.proof.candidates.some(c=>c.artifactId===id&&c.type===r.type))throw Error('Select only matching native evidence for this exact job.');
                                if(used.has(id))throw Error('A native artifact cannot be shared across configured requirements. Capture distinct evidence for each requirement.');used.add(id);
                            }
                            if(artifactIds.length)bindings.push({serviceId:r.serviceId,requirementId:r.id,artifactIds});
                        }else throw Error('Unsupported configured requirement type. Ask management to review the pinned order.');
                    }
                    attempt={job_id:options.jobId,operationId:global.crypto.randomUUID(),workflowRevision:workflow.revision,action:'proof_record',bindings,checklists};
                }
                busy=true;proofDirty=true;status('Saving scoped proof selections. Completion still requires fresh server clearance.');
                const response=await global.fetch(`${apiRoot(options.apiBase)}/${endpoint}`,{method:'POST',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,headers:{Authorization:'Bearer '+started,'Content-Type':'application/json'},body:JSON.stringify(attempt)});
                if(!valid())return;const result=await response.json();if(!valid())return;
                if(!response.ok||result.ok!==true||result.enrolled!==true||result.proofRecorded!==true||!Number.isSafeInteger(result.revision))throw Error(result.error||'Configured installation proof not confirmed.');
                attempt=null;proofDirty=false;proofDrafts.clear();busy=false;await load();
            }catch(error){if(valid()){console.error('Field installation proof save failed:',error.message);status(error.message+' Retry keeps the same proof operation; no completion clearance is implied.',true);}}
            finally{busy=false;const button=root.querySelector('[data-installation-form] button[type="submit"]');if(button&&(proofDirty||attempt?.action==='proof_record'))button.disabled=true;}
        }
        const submit = async event => {
            const proof=event.target.closest('[data-installation-proof-form]');if(proof){event.preventDefault();event.stopPropagation();await saveProof(proof);return;}
            const f = event.target.closest('[data-installation-form]'); if (!f) return;
            event.preventDefault(); event.stopPropagation(); if (busy || reading || !valid()) return;
            try {
                if(proofDirty||attempt?.action==='proof_record')throw Error('Save or retry configured proof selections and refresh server readiness before completion.');
                if(workflow?.canComplete!==true||workflow.proof?.complete!==true)throw Error('Saved installation photos, customer signature and current server completion gates are required.');
                if (!attempt) {
                    const expenses = [...f.querySelectorAll('[data-installation-expense]')].map(row => {
                        const rawQuantity=row.querySelector('[name="quantity"]').value,rawUnit=row.querySelector('[name="unitCents"]').value,rawAmount=row.querySelector('[name="amountCents"]').value;
                        const quantity=Number(rawQuantity),unitCents=Number(rawUnit),amountCents=Number(rawAmount);
                        if(!/^\d+(?:\.\d{1,6})?$/.test(rawQuantity)||quantity>100000||!rawUnit||!rawAmount||!Number.isSafeInteger(unitCents)||unitCents<0||unitCents>100000000||!Number.isSafeInteger(amountCents)||amountCents<0||amountCents>100000000)throw Error('Use quantities from 0 to 100000 (maximum 6 decimals) and supported nonnegative integer cost cents.');
                        if(!exactCost(rawQuantity,unitCents,amountCents))throw Error('Actual line total must exactly equal quantity × unit cents. No rounding or estimates are allowed.');
                        if(!row.querySelector('[name="actual"]').checked)throw Error('Explicit actual-cost attestation is required for every category.');
                        const reference=row.querySelector('[name="expenseEvidence"]').value.trim();if(!reference)throw Error('Actual cost evidence is required.');
                        const zeroCostAttestation=row.querySelector('[name="zeroCostAttestation"]').value.trim();
                        if(amountCents===0&&zeroCostAttestation.length<3)throw Error('Explicit zero-cost attestation is required for a zero total.');
                        return {category:row.querySelector('[name="category"]').value,quantity,unitCents,amountCents,evidence:{reference},actual:true,...(amountCents===0?{zeroCostAttestation}:{})};
                    });
                    if (!expenses.some(e=>e.category==='equipment')||!expenses.some(e=>e.category==='materials')) throw Error('Record both equipment and materials, including evidenced zero-cost categories.');
                    const hours = Number(f.elements.hours.value); if (!f.elements.hours.value||!Number.isFinite(hours) || hours < 0.01 || hours > 10000) throw Error('Record actual hours from 0.01 to 10000, matching the installation authority.');
                    if(workflow?.canComplete!==true)throw Error('Completion unavailable under current server gates.');
                    const reference=f.elements.evidence.value.trim();if(!reference)throw Error('Completion evidence is required.');
                    let performedAt;
                    if(options.company===true){
                        if(!f.elements.performedAt.value)throw Error('Record the actual installation date.');
                        performedAt=new Date(f.elements.performedAt.value).toISOString();
                    }
                    attempt = {job_id:options.jobId,operationId:global.crypto.randomUUID(),workflowRevision:workflow.revision,expenses,hours,evidence:{reference},...(performedAt?{performedAt}:{})};
                }
                busy = true; status('Recording evidence with the scoped completion authority. An interrupted retry keeps identical inputs.');
                const response = await global.fetch(`${apiRoot(options.apiBase)}/${endpoint}`, {
                    method:'POST',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,
                    headers:{Authorization:'Bearer '+started,'Content-Type':'application/json'},body:JSON.stringify({...attempt,token:started})
                });
                if (!valid()) return;
                const result = await response.json(); if (!valid()) return;
                if (!response.ok || result.ok !== true || result.completed !== true || result.enrolled !== true) throw Error(result.error || 'Installation completion not confirmed.');
                attempt = null; completionConfirmed=true; status('Installation completion confirmed by the server. Customer balance and commission are verified separately. Technician costs await explicit management review.');
                f.querySelectorAll('input,textarea,select,button').forEach(el=>el.disabled=true);
                root.querySelectorAll('[data-installation-proof-form] input,[data-installation-proof-form] textarea,[data-installation-proof-form] button').forEach(el=>el.disabled=true);
                options.onCompleted?.(result);
            } catch (error) { if (valid()) { console.error('Field installation completion failed:',error.message); status(error.message+' Retry retains the same operation and actual evidence; reopen verified job detail before a different operation.',true); } }
            finally {busy=false;}
        };
        root.addEventListener('click',click);root.addEventListener('submit',submit);root.addEventListener('change',change);root.addEventListener('input',change);
        async function load() {
            if(!valid())return {disposed:true};
            if(busy)return {busy:true};
            const version=++readVersion;reading=true;
            const submit=root.querySelector('[data-installation-form] button[type="submit"]');if(submit)submit.disabled=true;
            root.querySelectorAll('[data-installation-proof-form] input,[data-installation-proof-form] textarea,[data-installation-proof-form] button').forEach(el=>el.disabled=true);
            status('Verifying saved photo/signature proof and the exact assigned-job completion gates…');
            try {
                const response=await global.fetch(`${apiRoot(options.apiBase)}/${endpoint}?job_id=${encodeURIComponent(options.jobId)}`,{cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,headers:{Authorization:'Bearer '+started}});
                if(!valid())return {disposed:true};
                const result=await response.json();if(!valid())return {disposed:true};
                if(version!==readVersion)return {superseded:true};
                if(!response.ok||!result.ok)throw Error(result.error||'Exact installation authorization unavailable.');
                if(result.enabled!==true||result.enrolled!==true){
                    workflow=null;root.replaceChildren();const capability={enabled:result.enabled===true,enrolled:result.enabled===true?false:null};
                    options.onCapability?.(capability);return capability;
                }
                workflow=result.workflow;
                if(!workflow||workflow.jobId!==options.jobId||!Number.isSafeInteger(workflow.revision)||options.quoteId&&workflow.quoteId!==options.quoteId)throw Error('Installation relationship mismatch. No completion can be submitted.');
                if(options.company===true)root.querySelector('[data-installation-refresh]')?.remove();
                reading=false;if(root.querySelector('[data-installation-form]'))updateProof();else render();
                const capability={enabled:true,enrolled:true,workflow};options.onCapability?.(capability);return capability;
            }catch(error){
                if(valid()&&version===readVersion){workflow=null;console.error('Field installation read failed:',error.message);updateProof();status(error.message,true);if(options.company===true&&!root.querySelector('[data-installation-refresh]'))root.insertAdjacentHTML('beforeend','<button type="button" data-installation-refresh>Retry saved installation evidence</button>');options.onUnavailable?.(error);return {unavailable:true};}
                return valid()?{superseded:true}:{disposed:true};
            }finally{if(version===readVersion)reading=false;}
        }
        const ready=load();
        return {ready,refresh:load,destroy() {ended=true;readVersion++;attempt=workflow=null;proofDrafts.clear();controller.abort();root.removeEventListener('click',click);root.removeEventListener('submit',submit);root.removeEventListener('change',change);root.removeEventListener('input',change);root.replaceChildren();}};
    }
    global.H2SFieldInstallation = {mount};
})(window);
