(function (global) {
    'use strict';
    const apiRoot = base => String(base).replace(/\/+$/,'').replace(/\/api$/i,'') + '/api';
    let current, generation = 0;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money = value => Number.isSafeInteger(value) ? new Intl.NumberFormat(undefined, {style:'currency',currency:'USD'}).format(value / 100) : 'Amount review required';
    function reset() { generation++; current?.controller.abort(); if (current) for (const url of current.downloads) global.URL.revokeObjectURL(url); current?.root.replaceChildren(); current = null; }
    function mount(root, options) {
        reset();
        const started = options.getSession()?.token, startedRole=options.getSession()?.role, id = generation;
        const state = {root, controller:new AbortController(), data:null, busy:false, attempt:null, downloads:new Set(), representativeId:''};
        current = state;
        const valid = () => {
            const matches=current===state&&generation===id&&!!started&&options.getSession()?.token===started&&options.getSession()?.role===startedRole&&['ADMIN','SALES'].includes(startedRole);
            if(!matches&&current===state&&generation===id)reset();
            return matches;
        };
        const admin = () => options.getSession()?.role === 'ADMIN';
        function status(text, error = false) {
            if (!valid()) return;
            const el = root.querySelector('[data-earnings-status]');
            if (el) { el.textContent = text; el.setAttribute('role', error ? 'alert' : 'status'); }
        }
        async function api(body) {
            if (!valid()) throw Error('Session changed; earnings response discarded.');
            const query = new URLSearchParams();
            if (options.quoteId) query.set('quoteId', options.quoteId);
            if (admin() && state.representativeId) query.set('representativeId',state.representativeId);
            const response = await global.fetch(`${apiRoot(options.apiBase)}/field-sales-earnings${!body && query.size ? '?' + query : ''}`, {
                method:body ? 'POST' : 'GET', cache:'no-store', referrerPolicy:'no-referrer', signal:state.controller.signal,
                headers:{Authorization:'Bearer ' + started, ...(body ? {'Content-Type':'application/json'} : {})},
                ...(body ? {body:JSON.stringify(body)} : {})
            });
            if (!valid()) throw Error('Session changed; earnings response discarded.');
            if ([401,403].includes(response.status)) { options.onSessionEnded?.(); reset(); throw Error('Earnings access ended.'); }
            const result = await response.json();
            if (!valid()) throw Error('Session changed; earnings response discarded.');
            if (!response.ok || !result.ok) throw Error(result.error || 'Earnings unavailable; no settlement is implied.');
            return result;
        }
        function render() {
            const d = state.data;
            for (const url of state.downloads) global.URL.revokeObjectURL(url); state.downloads.clear();
            root.innerHTML = `<h3>${options.view === 'performance' ? 'Performance' : 'Commissions & Friday review'}</h3>
                <p data-earnings-status role="status" aria-live="polite"></p>`;
            if (!d.enabled) { status('Earnings are disabled. No earnings review or settlement can be recorded.'); return; }
            const s = d.summary;
            if (!s || !Array.isArray(d.orders) || !Array.isArray(d.entries) || !Array.isArray(d.runs) || !Array.isArray(d.adjustments)) {
                status('Earnings response is incomplete. No totals or settlement are assumed.', true); return;
            }
            root.insertAdjacentHTML('beforeend', `<button type="button" data-earnings-refresh>Refresh verified records</button>
                <p>Completion and verified final payment qualify an order. Missing actual costs, fees or approved tenure policy remain in amount review. Technician wages are separate.</p>
                <dl class="field-workflow__facts"><dt>Pending qualification</dt><dd>${esc(s.pendingQualification)}</dd>
                <dt>Calculation review</dt><dd>${esc(s.calculationReview)}</dd><dt>Earned entries</dt><dd>${money(s.earnedCents)}</dd>
                <dt>Reviewed accounting adjustments — not representative debt</dt><dd>${money(s.adjustmentCents)}</dd><dt>Allocated to runs (not paid)</dt><dd>${money(s.allocatedCents)}</dd>
                <dt>Independently reconciled paid</dt><dd>${money(s.reconciledPaidCents)}</dd></dl>
                <p>These totals cover the loaded authorized records, not a forecast or a bank transfer.</p><div data-earnings-records></div>`);
            if(options.view==='performance'){
                const orders=d.orders;
                root.querySelector('[data-earnings-records]').insertAdjacentHTML('beforebegin',`<h4>Loaded order performance</h4><dl class="field-workflow__facts">
                    <dt>Authorized orders</dt><dd>${orders.length}</dd><dt>Installations completed</dt><dd>${orders.filter(o=>o.completedAt).length}</dd>
                    <dt>Completed, payment outstanding</dt><dd>${orders.filter(o=>o.completedAt&&o.netPaidCents<o.totalCents).length}</dd>
                    <dt>Verified fully collected</dt><dd>${orders.filter(o=>o.netPaidCents===o.totalCents&&!o.disputed&&o.refundedCents===0).length}</dd></dl>
                    <p>Loaded records only. Historical Dispatch and proposed bonuses are excluded.</p>`);
            }
            if(admin()){
                const ids=[...new Set([...d.orders,...d.entries].map(row=>row.representativeId).filter(Boolean))];
                if(state.representativeId&&!ids.includes(state.representativeId))ids.push(state.representativeId);
                root.querySelector('[data-earnings-records]').insertAdjacentHTML('beforebegin',`<label>Representative earnings scope<select data-earnings-representative><option value="">All authorized representatives</option>
                    ${ids.map(rep=>`<option value="${esc(rep)}"${rep===state.representativeId?' selected':''}>${esc(rep)}</option>`).join('')}</select></label>`);
            }
            renderRecords(root.querySelector('[data-earnings-records]'));
        }
        function renderRecords(target) {
            const d = state.data;
            target.innerHTML = `<h4>Order qualification</h4>${d.orders.map(row => `<article><p class="field-sales__id">Order ${esc(row.orderId)} / quote ${esc(row.quoteId)}</p>
                <p>${esc(row.state)} / ${esc(row.reasons.join('; '))}</p>
                <p>Approved revenue ${money(row.totalCents)} / verified net paid ${money(row.netPaidCents)} / completed ${esc(row.completedAt || 'Not completed')} / qualified ${esc(row.qualifiesAt || 'Not qualified')}</p>
                ${admin() ? `<button type="button" data-earnings-review="${esc(row.quoteId)}"${row.state === 'earned' || row.state === 'held' ? ' disabled' : ''}>Review actual earning inputs</button>` : ''}</article>`).join('') || '<p>No authorized orders.</p>'}
                <h4>Immutable earning entries</h4>${d.entries.map(row => `<article><p class="field-sales__id">${esc(row.entryId)} / quote ${esc(row.quoteId)}</p>
                <p>${money(row.amountCents)} earned / credited representative ${esc(row.representativeId)}</p>
                <p>Qualified ${esc(row.qualifiesAt)}; actual basis ${money(row.basisCents)}; approved rate ${esc(row.rateBasisPoints / 100)}%; tenure day ${esc(row.tenureDay)}.</p>
                ${admin()?`<details><summary>Immutable rate, cost and qualification evidence</summary><p>Rate event ${esc(row.rateEventAt)} / policy ${esc(row.policyId)}</p><p class="field-sales__id">${esc(row.inputHash)}</p><pre>${esc(JSON.stringify(row.snapshot,null,2))}</pre></details>`:'<p>Financial history does not grant access to customer details or private quote evidence.</p>'}
                ${admin() ? `<details><summary>Append reviewed adjustment</summary><form data-earnings-form="review_adjustment" class="field-sales__form">
                    <input type="hidden" name="entryId" value="${esc(row.entryId)}">
                    <label>Adjustment (signed integer cents)<input name="amountCents" type="number" step="1" required></label>
                    <label>Reason<textarea name="reason" required maxlength="2000"></textarea></label>
                    <label class="field-sales__wide">Source evidence<textarea name="evidence" required maxlength="4000"></textarea></label>
                    <button type="submit">Append reviewed adjustment</button></form></details>` : ''}</article>`).join('') || '<p>No immutable entries.</p>'}
                <h4>Reviewed accounting adjustments — not authorized debt or automatic clawback</h4>${d.adjustments.map(row => `<article>${money(row.amountCents)}${admin()?` / ${esc(row.reason)} / ${esc(row.evidence)}`:''}<p>Reviewed ${esc(row.reviewedAt)}${admin()?` by ${esc(row.reviewedBy)}`:''}</p>
                    <p>${row.settlementState==='recovery_review_required'?'Recovery review required. New runs are blocked; this is not representative debt or authorization to recover money.':esc(row.settlementState||'Accounting correction review')}. ${esc(row.effect||'earning_correction_not_debt')}</p></article>`).join('') || '<p>No adjustments.</p>'}
                <h4>Friday runs</h4><p>Approval and export are review steps only. Only matching independent settlement evidence can establish paid status.</p>
                ${d.runs.map(row => run(row)).join('') || '<p>No reviewed runs.</p>'}
                ${admin() ? `<details><summary>Create Friday review run</summary><form data-earnings-form="create_run" class="field-sales__form">
                    <label>Approved settlement policy ID<input name="settlementPolicyId" required></label>
                    <label>Run date (approved policy timezone)<input name="runDate" type="date" required></label>
                    <button type="submit">Create review run — not a transfer</button></form></details>` : ''}`;
        }
        function run(row) {
            return `<article><p class="field-sales__id">${esc(row.runId)}</p><p>${esc(row.runDate)} / ${esc(row.state)} / ${money(row.amountCents)}</p>
                <p>Existing method ${esc(row.method)} / ${esc(row.classification)} / policy ${esc(row.policyId)}</p>
                <p>${row.beneficiaries.map(b=>`${esc(b.representativeId)}: ${money(b.amountCents)}`).join('; ')}</p>
                ${row.state==='abandoned'?`<p>Abandoned unexported run. Effective allocations released; immutable review history remains. This is neither payment nor representative debt.</p>
                    ${admin()&&row.abandonment?`<p>${esc(row.abandonment.reason)} / ${esc(row.abandonment.abandonedBy)} / ${esc(row.abandonment.abandonedAt)}</p>`:''}`:''}
                ${admin() && ['draft','approved','exported'].includes(row.state) ? `<details><summary>Run review and independent settlement</summary>
                    ${['draft','approved'].includes(row.state) ? `<form data-earnings-form="run_review" class="field-sales__form"><input type="hidden" name="runId" value="${esc(row.runId)}">
                    <label>Review step<select name="action">${row.state === 'draft' ? '<option value="approve_run">Approve review — not paid</option>' : '<option value="export_run">Export review — not paid</option>'}</select></label>
                    <label>Review/export evidence<textarea name="evidence" required maxlength="4000"></textarea></label><button type="submit">Record review step</button></form>
                    ` : ''}
                    ${['draft','approved'].includes(row.state)&&row.canAbandon===true?`<details><summary>Abandon unexported run</summary><form data-earnings-form="abandon_run" class="field-sales__form">
                    <input type="hidden" name="runId" value="${esc(row.runId)}">
                    <label>Audited abandonment reason<textarea name="reason" required minlength="3" maxlength="2000"></textarea></label>
                    <label>Review evidence<textarea name="evidence" required maxlength="4000"></textarea></label>
                    <label class="field-sales__wide field-sales__check"><input type="checkbox" name="abandonConfirmed" required>I intentionally abandon this unexported run. Effective allocations are released, not deleted; no transfer, debt or clawback is authorized.</label>
                    <button type="submit">Record audited abandonment</button></form></details>`:''}
                    ${row.state === 'exported' ? `<form data-earnings-form="record_settlement" class="field-sales__form"><input type="hidden" name="runId" value="${esc(row.runId)}">
                    <label>Existing payment method<input name="method" required maxlength="120"></label><label>External settlement reference<input name="reference" required maxlength="500"></label>
                    <label>Settled at (device timezone)<input name="settledAt" type="datetime-local" required></label>
                    <label>Settled amount (integer cents)<input name="amountCents" type="number" step="1" min="0" required></label>
                    <label class="field-sales__wide">Beneficiaries JSON: independently reconcile these verified IDs and amounts<textarea name="beneficiaries" required>${esc(JSON.stringify(row.beneficiaries,null,2))}</textarea></label>
                    <label class="field-sales__wide">Independent reconciliation evidence<textarea name="evidence" required maxlength="4000"></textarea></label>
                    <label class="field-sales__wide field-sales__check"><input name="independentReconciliation" type="checkbox" required>I independently reconciled the amount, beneficiaries and external reference.</label>
                    <button type="submit">Record reconciled settlement evidence</button></form>` : '<p>Settlement recording remains blocked until an approved run is exported and independently reconciled.</p>'}</details>` : ''}</article>`;
        }
        async function load() {
            if (!valid()) return;
            root.innerHTML = '<h3>Commissions</h3><p data-earnings-status role="status">Loading authorized earning records…</p>';
            try { const d = await api(); if (valid()) { state.data = d; render(); } }
            catch (error) { if (valid()) { console.error('Field earnings read failed:', error.message); status(error.message, true); } }
        }
        async function write(body) {
            if (!valid() || !admin() || state.busy) return;
            if (state.attempt && JSON.stringify({...state.attempt,operationId:undefined}) !== JSON.stringify(body)) {
                status('Retry the interrupted action unchanged or refresh verified records before a different action.', true); return;
            }
            state.busy = true;
            state.attempt ||= {...body,operationId:global.crypto.randomUUID()};
            status('Recording server-reviewed evidence. No external payment is initiated.');
            try {
                const action = state.attempt.action, result = await api(state.attempt); if (!valid()) return; state.attempt = null;
                await load();
                if(valid()&&action==='abandon_run'&&result.state==='abandoned'&&result.effectiveAllocationsReleased===true)status('Unexported run abandoned with audit history retained. Effective allocations released; no money sent, debt or clawback authorized. Any replacement requires a separate reviewed run.');
                if (valid() && action === 'export_run') {
                    const url = global.URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));
                    state.downloads.add(url); const a = document.createElement('a'); a.href=url;a.download='Home2Smart-Friday-review-export.json';a.textContent='Download reviewed run export — not proof of payment';root.append(a);
                    status('Run exported for review. No money was sent; independent settlement evidence is still required.');
                }
            }
            catch (error) { if (valid()) { console.error('Field earnings action failed:', error.message); status(error.message + ' Retry retains the exact operation.', true); } }
            finally { state.busy = false; }
        }
        root.onclick = event => {
            const b = event.target.closest('button'); if (!b || !valid() || state.busy) return;
            if (b.hasAttribute('data-earnings-refresh')) { state.attempt = null; load(); }
            if (b.dataset.earningsReview) write({action:'review_order',quoteId:b.dataset.earningsReview});
        };
        root.onchange = event => {
            if(event.target.matches('[data-earnings-representative]')&&valid()&&admin()&&!state.busy){
                if(state.attempt){status('An interrupted operation must be retried or refreshed before changing scope.',true);return;}
                state.representativeId=event.target.value;load();
            }
        };
        root.onsubmit = event => {
            const f = event.target.closest('[data-earnings-form]'); if (!f || !valid() || !admin()) return;
            event.preventDefault(); event.stopPropagation();
            try {
                const values = Object.fromEntries(new FormData(f)), action = f.dataset.earningsForm;
                let body = {...values,action:action === 'run_review' ? values.action : action};
                if(action==='abandon_run'){
                    const row=state.data.runs.find(r=>r.runId===values.runId),reason=String(values.reason||'').trim(),evidence=String(values.evidence||'').trim();
                    if(!row||!['draft','approved'].includes(row.state)||row.canAbandon!==true)throw Error('Only an authorized unexported draft or approved run can be abandoned. Refresh verified records.');
                    if(!f.elements.abandonConfirmed.checked||reason.length<3||reason.length>2000||!evidence)throw Error('Intentional confirmation, a 3–2000 character reason and review evidence are required.');
                    body={action,runId:values.runId,reason,evidence};
                }
                if (['review_adjustment','record_settlement'].includes(action)) {
                    const cents = Number(values.amountCents); if (!Number.isSafeInteger(cents)) throw Error('Use integer cents.');
                    body.amountCents = cents;
                }
                if (action === 'record_settlement') {
                    if(typeof values.settledAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(values.settledAt)||!Number.isFinite(new Date(values.settledAt).getTime()))throw Error('A valid explicit settlement date and time are required; no current-time default is applied.');
                    if(!f.elements.independentReconciliation.checked||!String(values.reference||'').trim()||!String(values.method||'').trim()||!String(values.evidence||'').trim())throw Error('Independent reconciliation, method, reference and settlement evidence are required.');
                    const beneficiaries = JSON.parse(values.beneficiaries);
                    if (!Array.isArray(beneficiaries) || !beneficiaries.length || beneficiaries.some(b => typeof b.representativeId !== 'string' || !Number.isSafeInteger(b.amountCents) || b.amountCents < 0)) throw Error('Provide verified beneficiary IDs and integer amounts.');
                    body = {action,runId:values.runId,proof:{reference:values.reference,method:values.method,settledAt:new Date(values.settledAt).toISOString(),
                        amountCents:body.amountCents,beneficiaries,evidence:values.evidence,independentReconciliation:f.elements.independentReconciliation.checked}};
                }
                write(body);
            } catch (error) { status(error.message, true); }
        };
        load();
    }
    global.H2SFieldEarnings = {mount,reset};
})(window);
