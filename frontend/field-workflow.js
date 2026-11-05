(function (global) {
    'use strict';
    const apiRoot = base => String(base).replace(/\/+$/,'').replace(/\/api$/i,'') + '/api';
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money = value => Number.isSafeInteger(value) ? new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(value / 100) : 'Evidence pending';
    const date = value => value ? esc(new Date(value).toLocaleString()) : 'Not established';
    const contentText = value => typeof value === 'string' ? value : JSON.stringify(value,null,2);
    function exactCost(quantity,unitCents,amountCents){
        const [whole,fraction='']=quantity.split('.');
        const millionths=BigInt(whole)*1000000n+BigInt(fraction.padEnd(6,'0'));
        return millionths*BigInt(unitCents)===BigInt(amountCents)*1000000n;
    }
    let current, generation = 0;
    function reset() { generation++; current?.controller.abort(); current?.root.replaceChildren(); current = null; }
    function mount(root, options) {
        reset();
        const started = options.getSession()?.token, startedRole=options.getSession()?.role, id = generation;
        const state = {root,controller:new AbortController(),data:null,busy:false,attempt:null};
        current = state;
        const valid = () => {
            const matches=current===state&&id===generation&&!!started&&options.getSession()?.token===started&&options.getSession()?.role===startedRole&&['ADMIN','SALES'].includes(startedRole);
            if(!matches&&current===state&&id===generation)reset();
            return matches;
        };
        const admin = () => options.getSession()?.role === 'ADMIN';
        function status(text, error = false) {
            if (!valid()) return;
            const el = root.querySelector('[data-workflow-status]');
            if (el) { el.textContent = text; el.setAttribute('role',error ? 'alert' : 'status'); }
        }
        async function api(body) {
            if (!valid()) throw Error('Session changed; workflow response discarded.');
            const query = new URLSearchParams();
            if (options.quoteId) query.set('quote_id',options.quoteId);
            else if (options.leadId) query.set('lead_id',options.leadId);
            const response = await global.fetch(`${apiRoot(options.apiBase)}/field-sales-workflow${!body && query.size ? '?' + query : ''}`, {
                method:body ? 'POST' : 'GET',cache:'no-store',referrerPolicy:'no-referrer',signal:state.controller.signal,
                headers:{Authorization:'Bearer '+started,...(body ? {'Content-Type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {})
            });
            if (!valid()) throw Error('Session changed; workflow response discarded.');
            if ([401,403].includes(response.status)) { options.onSessionEnded?.(); reset(); throw Error('Workflow access ended.'); }
            const result = await response.json();
            if (!valid()) throw Error('Session changed; workflow response discarded.');
            if (!response.ok || !result.ok) throw Error(result.error || 'Order workflow unavailable. No clearance or completion is implied.');
            return result;
        }
        function policies(kind) {
            return state.data.policies.filter(p => p.kind === kind && p.status === 'approved').map(p => `<option value="${esc(p.policy_id)}">${esc(p.policy_id)}</option>`).join('');
        }
        function form(action, w, contents, label, disabled = false) {
            return `<form data-workflow-form="${action}" class="field-sales__form">${w ? `<input type="hidden" name="quoteId" value="${esc(w.quoteId)}"><input type="hidden" name="leadId" value="${esc(w.leadId)}"><input type="hidden" name="revision" value="${esc(w.revision)}">` : ''}
                ${contents}<button type="submit"${disabled ? ' disabled' : ''}>${label}</button></form>`;
        }
        const evidence = '<label class="field-sales__wide">Approval/source evidence<textarea name="evidence" required maxlength="6000"></textarea></label>';
        const reason = '<label class="field-sales__wide">Reason<textarea name="reason" required maxlength="2000"></textarea></label>';
        function nextAction(w) {
            if(['cancelled','refund_review'].includes(w.state))return 'Management: reconcile cancellation/refund holds; collection and scheduling remain blocked.';
            if(w.gates?.canBalance)return 'Customer: verify and pay the outstanding post-installation net balance.';
            if(w.completedAt)return w.balanceCents>0?'Management: resolve payment clearance before post-install balance collection.':'Management: review actual costs, earned commission and the eligible Friday settlement run.';
            if(w.state==='scheduled'){
                if(!w.technicianId)return w.gates?.canAssign?'Management: select an authorized technician for the existing managed assignment.':'Management: resolve scheduled job preparation before assigning a technician.';
                return w.gates?.canComplete?'Assigned technician: record actual materials, hours and completion in the existing pro job detail.':'Management: resolve assigned-job readiness before technician completion.';
            }
            if(w.gates?.canSchedule)return 'Management: confirm an eligible installation in the existing company calendar.';
            if(w.gates?.canDeposit)return 'Customer: pay the exact 25% deposit through the secure agreement handoff.';
            if(!w.documents?.length)return 'Management: publish exact approved customer copies; customer retrieval and acceptance are required.';
            return 'Management: resolve the current legal, delivery and verified-deposit gates before scheduling.';
        }
        function order(w) {
            const holds = Array.isArray(w.holds) ? w.holds : ['Readiness evidence unavailable'];
            return `<article><h4>${esc(w.orderId || 'Exact quote awaiting enrollment')}</h4>
                <p class="field-sales__id">Lead ${esc(w.leadId)} / quote ${esc(w.quoteId)} / revision ${esc(w.revision)}</p>
                <p>${esc(w.state)} / credited representative ${esc(w.representativeId)}</p>
                <p class="field-workflow__next">Next action: ${esc(nextAction(w))}</p><p>Review reasons: ${esc(holds.join('; ') || 'No additional server review reasons reported.')}</p>
                <dl class="field-workflow__facts"><dt>Exact 25% deposit</dt><dd>${money(w.depositCents)}</dd><dt>Verified net paid</dt><dd>${money(w.netPaidCents)}</dd>
                <dt>Current net balance</dt><dd>${money(w.balanceCents)}${w.gates?.canBalance ? ' — post-install collection available' : ' — collection blocked by current server gates'}</dd>
                <dt>Cancellation deadline</dt><dd>${date(w.cancellationDeadline)} — approved policy and delivery evidence control clearance</dd>
                <dt>Installation</dt><dd>${esc(w.jobId || 'Not linked')} / technician ${esc(w.technicianId || 'Not assigned')}</dd>
                <dt>Completion</dt><dd>${date(w.completedAt)}</dd><dt>Actual processing fee</dt><dd>${money(w.processingFeeCents)} / ${esc(w.processingFeeEvidence ? contentText(w.processingFeeEvidence) : 'Evidence pending')}</dd>
                <dt>Actual technician hours</dt><dd>${esc(w.hours ?? 'Not recorded')} — wages are separate from commission</dd></dl>
                <details><summary>Approved immutable customer copies & delivery</summary>
                ${(w.documents || []).map(doc => `<section><h4>${esc(doc.label)} / ${esc(doc.kind)}</h4><p class="field-sales__id">${esc(doc.artifactId)} / ${esc(doc.contentHash)}</p><pre>${esc(contentText(doc.content))}</pre></section>`).join('') || '<p>No approved immutable copies published.</p>'}
                <pre>${esc(JSON.stringify(w.deliveryEvidence || [],null,2))}</pre></details>
                <details><summary>Installation, preparation & actual expenses</summary><p>${w.costsComplete===true?'Actual costs approved by management.':'Technician costs are not approved costs. Commission amount remains in review until management explicitly approves evidenced actual costs.'}</p>
                    ${installationProof(w)}
                    <p>Cost approval: ${esc(w.costApprovedBy||'Not approved')} / ${date(w.costApprovedAt)}</p>
                    <pre>${esc(JSON.stringify({reservation:w.reservation,preparation:w.preparation,assignmentPreview:w.assignmentPreview,technicianExpenses:w.technicianExpenses,approvedExpenses:w.expenses,costReviewEvidence:w.costReviewEvidence},null,2))}</pre></details>
                ${(w.refunds||[]).length?`<details><summary>Refund reconciliation records</summary><p>Reserved/provider-pending is not refunded. Retry the identical operation or verify the provider record; failed states require management review.</p>
                    ${w.refunds.map(r=>`<p class="field-sales__id">${esc(r.operation_id)} / checkout ${esc(r.checkout_id)}</p><p>${esc(r.state)} / ${money(r.amount_cents)} / provider reference ${esc(r.provider_refund_id||'Not confirmed')}</p>`).join('')}</details>`:''}
                ${admin() ? management(w, holds) : '<p>Management controls legal clearance, readiness and scheduling. Payment confirmations come from server reconciliation, not a checkout return.</p>'}</article>`;
        }
        function installationProof(w){
            if(!admin())return '';
            const p=w.proof;if(!p)return '<p>Assigned-job installation proof status unavailable. No completion clearance is implied.</p>';
            return `<h4>Pinned installation requirements</h4><p>Baseline saved photos: ${esc(p.photoCount)} / customer signatures: ${esc(p.signatureCount)}. ${p.complete===true?'Server proof requirements satisfied.':'Proof remains incomplete: '+esc((p.missing||[]).join('; '))}</p>
                ${Array.isArray(p.requirements)&&p.requirements.length?`<ul>${p.requirements.map(r=>`<li>${esc(r.label)} / service ${esc(r.serviceId)} / ${esc(r.type)} / required ${esc(r.minimumCount)} / ${r.complete===true?'Saved requirement satisfied':'Missing '+esc(r.missingCount)}</li>`).join('')}</ul>`:'<p>No additional service requirements reported. Baseline photo/signature requirements remain mandatory.</p>'}
                <p>Requirements are pinned to the approved quote. The assigned technician records native evidence and explicit checklist completion; management does not bypass proof here.</p>`;
        }
        function management(w, holds) {
            const docForms = form('documents_publish',w,`<label class="field-sales__wide">Exact required customer copies from the server (not editable)<textarea name="artifacts" readonly required>${esc(JSON.stringify(w.requiredArtifacts || [],null,2))}</textarea></label>${evidence}`,'Publish approved immutable copies',
                !w.requiredArtifacts?.length || !!w.documents?.length || ['cancelled','completed'].includes(w.state)) +
                form('delivery_record',w,`<label>Approved delivery method<input name="method" required maxlength="120"></label><label>Delivered at (device timezone)<input name="deliveredAt" type="datetime-local" required></label>
                <label>Exact recipient<input name="recipient" required maxlength="500"></label><label>Delivery reference<input name="reference" required maxlength="2000"></label>`,'Record document delivery evidence');
            const readiness = form('preparation',w,`<input type="hidden" name="preparationRevision" value="${esc(w.preparation?.record?.revision ?? 0)}">
                <label class="field-sales__check"><input name="scopeReviewed" type="checkbox">Scope reviewed</label>
                ${['materials','access'].map(name => `<label>${name === 'materials' ? 'Materials readiness' : 'Customer access'}<select name="${name}"><option value="unreviewed">Unreviewed</option><option value="ready">Ready</option><option value="blocked">Blocked</option>${name === 'materials' ? '<option value="not_required">Not required — approved scope</option>' : ''}</select></label>`).join('')}
                <label class="field-sales__wide">Readiness blockers (leave blank only when none)<textarea name="blockers"></textarea></label><label class="field-sales__wide">Preparation evidence / note<textarea name="note" required maxlength="4000"></textarea></label>`,'Record readiness evidence',!w.jobId || ['cancelled','completed','refund_review'].includes(w.state));
            const schedule = form(w.reservation ? 'reschedule' : 'schedule',w,`<input type="hidden" name="reservationRevision" value="${esc(w.reservation?.revision ?? 0)}">
                <label>Start (device timezone)<input name="start" type="datetime-local" required></label><label>End (device timezone)<input name="end" type="datetime-local" required></label>
                <label>Approved IANA timezone<input name="timezone" required></label><label class="field-sales__check"><input name="customerAgreed" type="checkbox" required>Customer agreed to these times</label>${reason}`,
                'Confirm in existing company calendar',w.gates?.canSchedule !== true);
            const preview = w.assignmentPreview, technicians = preview?.technicians || [];
            const assignment = form('assign',w,`<label>Available canonical technician<select name="proId" required><option value="">Choose an authorized technician</option>${technicians.map(t=>`<option value="${esc(t.proId)}">${esc(t.name)} / ${esc(t.proId)}</option>`).join('')}</select></label>
                <input name="context" type="hidden" value="${esc(preview?.job?.context || '')}"><label class="field-sales__wide">Assignment note<textarea name="note" required maxlength="4000"></textarea></label>`,'Submit managed assignment',w.gates?.canAssign !== true || !preview?.job?.context || !technicians.length);
            return `${costReview(w)}<details><summary>Management documents and readiness</summary>${docForms}${readiness}</details>
                <details><summary>Existing calendar and managed assignment</summary>${holds.length ? '<p>Scheduling/assignment blocked by the readiness reasons above. Server revalidates every transition.</p>' : ''}
                ${schedule}${assignment}</details><details><summary>Cancellation or refund review — not automatic refund</summary>
                ${form('cancel',w,reason+evidence,'Record cancellation and holds')}${form('refund_review',w,reason+evidence,'Record refund review — no automatic transfer')}</details>`;
        }
        function costReview(w){
            if(!w.completedAt||w.costsComplete===true)return '';
            const rows=w.technicianExpenses||[];
            return `<details><summary>Review technician actual costs before commission calculation</summary><p>Technician rows stay immutable. Document any correction here. Approval saves a separate immutable actual-cost snapshot; wages are excluded.</p>
                ${form('cost_review',w,`${rows.map((row,index)=>`<fieldset class="field-sales__wide" data-workflow-cost-row><legend>Reviewed actual cost ${index+1}</legend>
                    <label>Category<select name="category"><option value="equipment"${row.category==='equipment'?' selected':''}>Equipment</option><option value="materials"${row.category==='materials'?' selected':''}>Installation materials</option></select></label>
                    <label>Quantity (up to 6 decimals)<input name="quantity" type="number" min="0" max="100000" step="0.000001" value="${esc(row.quantity)}" required></label>
                    <label>Actual unit cost (integer cents)<input name="unitCents" type="number" min="0" step="1" value="${esc(row.unitCents)}" required></label>
                    <label>Actual line total (quantity × unit cents)<input name="amountCents" type="number" min="0" step="1" value="${esc(row.amountCents)}" required></label>
                    <label>Receipt/source/correction evidence<textarea name="rowEvidence" required maxlength="4000">${esc(row.evidence?.reference||'')}</textarea></label>
                    <label>Zero-cost attestation (required when total is zero)<textarea name="zeroCostAttestation" maxlength="2000">${esc(row.zeroCostAttestation||'')}</textarea></label>
                    <label class="field-sales__check"><input name="actual" type="checkbox" required>I attest these are evidenced actual costs, not estimates.</label></fieldset>`).join('')}
                    ${evidence}<label class="field-sales__wide field-sales__check"><input name="actualCostsReviewed" type="checkbox" required>I reviewed both equipment and materials, including any zero costs and documented corrections.</label>`,'Approve immutable actual-cost snapshot',!rows.length)}
                ${!rows.length?'<p>Technician actual-cost rows unavailable. Approval is blocked; do not substitute zero costs.</p>':''}</details>`;
        }
        function render() {
            const d = state.data;
            root.innerHTML = '<h3>Orders & next actions</h3><p data-workflow-status role="status" aria-live="polite"></p>';
            if (!d.enabled) { status('Sales workflow disabled. Legal, scheduling and completion actions are unavailable.'); return; }
            if (!Array.isArray(d.workflows) || !Array.isArray(d.policies)) { status('Incomplete workflow response. No readiness or scheduling is assumed.',true); return; }
            root.insertAdjacentHTML('beforeend', `<button type="button" data-workflow-refresh>Refresh order trace</button>
                <p>New sales use a fixed 25% deposit, then post-installation net balance. Deposit alone is not legal clearance or an installation appointment.</p>
                ${d.workflows.map(order).join('') || '<p>No enrolled new-sales orders. Legacy Dispatch is not included.</p>'}`);
            if (admin()) root.insertAdjacentHTML('beforeend', `<details><summary>New order enrollment — exact quote and approved policies</summary>
                ${form('enroll',null,`<label>Exact approved quote ID<input name="quoteId" value="${esc(options.quoteId || '')}" required></label>
                    <input type="hidden" name="revision" value="0">
                    <label>Shared lead ID<input name="leadId" value="${esc(options.leadId || '')}" required></label>
                    ${[['legalPolicyId','legal','Legal policy'],['commissionPolicyId','commission','Commission policy'],['settlementPolicyId','settlement','Settlement policy']].map(([name,kind,label]) => `<label>${label}<select name="${name}" required><option value="">Choose approved version</option>${policies(kind)}</select></label>`).join('')}
                    <label>Immutable commission credit representative ID<input name="representativeId" required></label>
                    <label class="field-sales__wide">Commission credit approval evidence<textarea name="creditEvidence" required maxlength="4000"></textarea></label>`,'Enroll exact new-sales order')}</details>
                <details><summary>Versioned legal, commission and settlement policies</summary><p>No jurisdiction, legal days, refund rule, rate-effective event or settlement method is preselected. Drafts are not approved.</p>
                    ${d.policies.map(p => `<article><p class="field-sales__id">${esc(p.policy_id)} / ${esc(p.kind)} / ${esc(p.status)}</p><pre>${esc(JSON.stringify(p.definition,null,2))}</pre>
                    <p>Approval evidence: ${esc(p.approval_evidence ? contentText(p.approval_evidence) : 'Unapproved')}</p>
                    ${p.status === 'draft' ? form('policy_update',null,`<input type="hidden" name="policyId" value="${esc(p.policy_id)}"><input type="hidden" name="expectedDefinitionHash" value="${esc(p.definitionHash||'')}"><label class="field-sales__wide">Policy definition JSON<textarea name="definition" required>${esc(JSON.stringify(p.definition,null,2))}</textarea></label>`,'Save draft policy',!p.definitionHash) +
                        form('policy_approve',null,`<input type="hidden" name="policyId" value="${esc(p.policy_id)}"><input type="hidden" name="expectedDefinitionHash" value="${esc(p.definitionHash||'')}">${evidence}`,'Explicitly approve policy version',!p.definitionHash) +
                        form('policy_delete_draft',null,`<input type="hidden" name="policyId" value="${esc(p.policy_id)}">`,'Delete unapproved draft') : p.status === 'approved' ? form('policy_retire',null,`<input type="hidden" name="policyId" value="${esc(p.policy_id)}">`,'Retire policy for future enrollment') : ''}</article>`).join('')}
                    ${form('policy_create',null,`<label>New policy UUID<input name="policyId" required></label><label>Policy kind<select name="kind"><option value="legal">Legal</option><option value="commission">Commission</option><option value="settlement">Settlement</option></select></label>
                        <label class="field-sales__wide">Policy definition JSON<textarea name="definition" required></textarea></label>`,'Create unapproved policy draft')}</details>`);
        }
        async function load() {
            if (!valid()) return;
            root.innerHTML = '<h3>Orders</h3><p data-workflow-status role="status">Loading authorized order trace…</p>';
            try { const d = await api(); if (valid()) { state.data = d; render(); } }
            catch (error) { if (valid()) { console.error('Field workflow read failed:',error.message); status(error.message,true); } }
        }
        async function write(body) {
            if (!valid() || !admin() || state.busy) return;
            if (state.attempt) { status('An interrupted operation is pending. Retry it unchanged using Retry, or refresh the order trace.',true); return; }
            state.attempt = {...body,operationId:global.crypto.randomUUID()};
            await retry();
        }
        async function retry() {
            if (!valid() || !admin() || state.busy || !state.attempt) return;
            state.busy = true; status('Recording evidence on the server. No payment or scheduling success is assumed.');
            try { await api(state.attempt); if (!valid()) return; state.attempt = null; await load(); }
            catch (error) {
                if (valid()) {
                    console.error('Field workflow action failed:',error.message); status(error.message + ' The exact interrupted operation is retained.',true);
                    if (!root.querySelector('[data-workflow-retry]')) root.querySelector('[data-workflow-status]').insertAdjacentHTML('afterend','<button type="button" data-workflow-retry>Retry identical interrupted operation</button>');
                }
            } finally { state.busy = false; }
        }
        root.onclick = event => {
            const b = event.target.closest('button'); if (!b || !valid() || state.busy) return;
            if (b.hasAttribute('data-workflow-refresh')) { state.attempt = null; load(); }
            if (b.hasAttribute('data-workflow-retry')) retry();
        };
        root.onsubmit = event => {
            const f = event.target.closest('[data-workflow-form]'); if (!f || !valid() || !admin()) return;
            event.preventDefault(); event.stopPropagation();
            try {
                const body = {...Object.fromEntries(new FormData(f)),action:f.dataset.workflowForm};
                if(['policy_update','policy_approve'].includes(body.action)&&!String(body.expectedDefinitionHash||'').trim())throw Error('Policy definition hash unavailable. Refresh the policy records before editing or approving.');
                for (const name of ['revision','reservationRevision','preparationRevision']) if (body[name] !== undefined) {
                    if (body[name] === '') delete body[name]; else body[name] = Number(body[name]);
                }
                if (body.definition !== undefined) { body.definition = JSON.parse(body.definition); if (!body.definition || Array.isArray(body.definition) || typeof body.definition !== 'object') throw Error('Policy definition must be a JSON object.'); }
                if (body.artifacts !== undefined) { body.artifacts = JSON.parse(body.artifacts); if (!Array.isArray(body.artifacts) || !body.artifacts.length) throw Error('Provide the approved immutable document copies.'); }
                if (typeof body.evidence === 'string') { if (!body.evidence.trim()) throw Error('Source approval evidence is required.'); body.evidence = {reference:body.evidence}; }
                if (typeof body.creditEvidence === 'string') { if (!body.creditEvidence.trim()) throw Error('Commission credit approval evidence is required.'); body.creditEvidence = {reference:body.creditEvidence}; }
                if(body.action==='cost_review'){
                    if(!f.elements.actualCostsReviewed.checked)throw Error('Explicit management actual-cost review attestation is required.');
                    body.expenses=[...f.querySelectorAll('[data-workflow-cost-row]')].map(row=>{
                        const rawQuantity=row.querySelector('[name="quantity"]').value,rawUnit=row.querySelector('[name="unitCents"]').value,rawAmount=row.querySelector('[name="amountCents"]').value;
                        const quantity=Number(rawQuantity),unitCents=Number(rawUnit),amountCents=Number(rawAmount);
                        if(!/^\d+(?:\.\d{1,6})?$/.test(rawQuantity)||quantity>100000||!rawUnit||!rawAmount||!Number.isSafeInteger(unitCents)||unitCents<0||unitCents>100000000||!Number.isSafeInteger(amountCents)||amountCents<0||amountCents>100000000)throw Error('Use supported quantities and nonnegative integer actual cost cents.');
                        if(!exactCost(rawQuantity,unitCents,amountCents))throw Error('Reviewed line total must exactly equal quantity × unit cents. No rounding is allowed.');
                        if(!row.querySelector('[name="actual"]').checked)throw Error('Each reviewed cost needs explicit actual-cost attestation.');
                        const reference=row.querySelector('[name="rowEvidence"]').value.trim();if(!reference)throw Error('Reviewed source/correction evidence is required.');
                        const zeroCostAttestation=row.querySelector('[name="zeroCostAttestation"]').value.trim();if(amountCents===0&&zeroCostAttestation.length<3)throw Error('Explicit reviewed zero-cost attestation is required.');
                        return {category:row.querySelector('[name="category"]').value,quantity,unitCents,amountCents,evidence:{reference},actual:true,...(amountCents===0?{zeroCostAttestation}:{})};
                    });
                    if(!body.expenses.some(e=>e.category==='equipment')||!body.expenses.some(e=>e.category==='materials'))throw Error('Review both equipment and materials, including evidenced zero costs.');
                    body.evidence={...body.evidence,actualCostsReviewed:true};
                    for(const name of ['category','quantity','unitCents','amountCents','rowEvidence','zeroCostAttestation','actual','actualCostsReviewed'])delete body[name];
                }
                for (const name of ['start','end']) if (body[name]) body[name] = new Date(body[name]).toISOString();
                if (body.action === 'delivery_record') {
                    body.evidence = {method:body.method,deliveredAt:new Date(body.deliveredAt).toISOString(),recipient:body.recipient,reference:body.reference};
                    for (const name of ['method','deliveredAt','recipient','reference']) delete body[name];
                }
                if (body.action === 'preparation') { body.scopeReviewed = f.elements.scopeReviewed.checked; body.blockers = body.blockers.trim(); }
                if (['schedule','reschedule'].includes(body.action)) body.customerAgreed = f.elements.customerAgreed.checked;
                write(body);
            } catch (error) { status(error.message,true); }
        };
        load();
    }
    global.H2SFieldWorkflow = {mount,reset};
})(window);
