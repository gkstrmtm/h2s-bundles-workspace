(function (global) {
    'use strict';
    const apiRoot = base => String(base).replace(/\/+$/,'').replace(/\/api$/i,'') + '/api';
    let current, generation = 0;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money = value => Number.isSafeInteger(value) ? new Intl.NumberFormat(undefined, {style:'currency',currency:'USD'}).format(value / 100) : 'Amount review required';
    const date = value => value ? esc(new Date(value).toLocaleString()) : 'Not yet recorded';
    const labels = {pending:'Awaiting qualification',pending_qualification:'Awaiting qualification',calculation_review:'Amount under review',earned:'Commission earned',held:'On hold',draft:'Draft review',approved:'Approved for export — not paid',exported:'Review exported — not paid',reconciled_paid:'Paid — independently reconciled',abandoned:'Review abandoned',recovery_review_required:'Recovery review required'};
    const human = value => labels[value] || 'Review required';
    const metric = (label,value) => `<div class="field-sales__metric"><span>${label}</span><strong>${value}</strong></div>`;
    function reset() { generation++; current?.controller.abort(); if (current) for (const url of current.downloads) global.URL.revokeObjectURL(url); current?.root.replaceChildren(); current = null; }
    function mount(root, options) {
        reset();
        const started = options.getSession()?.token, startedRole=options.getSession()?.role, id = generation;
        const state = {root, controller:new AbortController(), data:null, busy:false, attempt:null, downloads:new Set(), representativeId:'',representativeLabels:new Map()};
        current = state;
        const valid = () => {
            const matches=current===state&&generation===id&&!!started&&options.getSession()?.token===started&&options.getSession()?.role===startedRole&&['ADMIN','SALES'].includes(startedRole);
            if(!matches&&current===state&&generation===id)reset();
            return matches;
        };
        const admin = () => options.getSession()?.role === 'ADMIN';
        const title = (row,index,prefix='Order') => row.customerName || row.customer?.name || options.customerNames?.[row.leadId] || `${prefix} ${index+1}`;
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
            root.innerHTML = `<div class="field-sales__toolbar"><h3>${options.view === 'performance' ? 'Sales performance' : admin() ? 'Commissions & Friday review' : 'Your earnings'}</h3><button type="button" data-earnings-refresh>Refresh earnings</button></div>
                <p data-earnings-status role="status" aria-live="polite"></p>`;
            if (!d.enabled) { status('Earnings are disabled. No earnings review or settlement can be recorded.'); return; }
            const s = d.summary;
            if (!s || !Array.isArray(d.orders) || !Array.isArray(d.entries) || !Array.isArray(d.runs) || !Array.isArray(d.adjustments)) {
                status('Earnings response is incomplete. No totals or settlement are assumed.', true); return;
            }
            root.insertAdjacentHTML('beforeend', `<div class="field-sales__summary" aria-label="Verified earnings summary">
                ${metric('Earned commission',money(s.earnedCents))}${metric('Allocated to Friday review — not paid',money(s.allocatedCents))}${metric('Independently reconciled paid',money(s.reconciledPaidCents))}
                </div><div class="field-sales__toolbar field-workflow__counts"><span>Awaiting qualification <strong>${esc(s.pendingQualification)}</strong></span><span>Amount under review <strong>${esc(s.calculationReview)}</strong></span><span>Accounting adjustments <strong>${money(s.adjustmentCents)}</strong> — not representative debt</span></div>
                <p class="field-workflow__note">Commission follows completed installation and verified final payment. Actual costs, fees and the approved rate must be reviewed. Technician wages are separate.</p>
                <p class="field-workflow__note">Loaded authorized records only, not a forecast or a bank transfer. Friday approval and export do not send money.</p><div data-earnings-records></div>`);
            if(options.view==='performance'){
                const orders=d.orders;
                root.querySelector('[data-earnings-records]').insertAdjacentHTML('beforebegin',`<section class="field-sales__section"><h4>Loaded order performance</h4><dl class="field-workflow__facts">
                    <dt>Authorized orders</dt><dd>${orders.length}</dd><dt>Installations completed</dt><dd>${orders.filter(o=>o.completedAt).length}</dd>
                    <dt>Completed, payment outstanding</dt><dd>${orders.filter(o=>o.completedAt&&o.netPaidCents<o.totalCents).length}</dd>
                    <dt>Verified fully collected</dt><dd>${orders.filter(o=>o.netPaidCents===o.totalCents&&!o.disputed&&o.refundedCents===0).length}</dd></dl>
                    <p>Loaded records only. Historical Dispatch and proposed bonuses are excluded.</p></section>`);
            }
            if(admin()){
                const ids=[...new Set([...d.orders,...d.entries].map(row=>row.representativeId).filter(Boolean))];
                if(state.representativeId&&!ids.includes(state.representativeId))ids.push(state.representativeId);
                for(const rep of ids){
                    const name=options.representativeNames?.[rep] || [...d.orders,...d.entries].find(row=>row.representativeId===rep&&row.representativeName)?.representativeName;
                    if(name||!state.representativeLabels.has(rep))state.representativeLabels.set(rep,name||'Representative '+(state.representativeLabels.size+1));
                }
                root.querySelector('[data-earnings-records]').insertAdjacentHTML('beforebegin',`<label>Representative earnings scope<select data-earnings-representative><option value="">All authorized representatives</option>
                    ${ids.map(rep=>`<option value="${esc(rep)}"${rep===state.representativeId?' selected':''}>${esc(state.representativeLabels.get(rep))}</option>`).join('')}</select></label>`);
            }
            renderRecords(root.querySelector('[data-earnings-records]'));
        }
        function renderRecords(target) {
            const d = state.data;
            const entryTitle = (row,index) => {
                const orderIndex=d.orders.findIndex(o=>o.quoteId===row.quoteId);
                return orderIndex<0 ? title(row,index,'Commission') : title(d.orders[orderIndex],orderIndex);
            };
            target.innerHTML = `<section class="field-sales__section"><h4>Commission qualification</h4>${d.orders.map((row,index) => `<article class="field-workflow__record"><header class="field-workflow__header"><h4>${esc(title(row,index))}</h4><span class="field-sales__badge">${esc(human(row.state))}</span></header>
                <dl class="field-workflow__facts"><dt>Approved revenue</dt><dd>${money(row.totalCents)}</dd><dt>Verified net paid</dt><dd>${money(row.netPaidCents)}</dd><dt>Installation completed</dt><dd>${date(row.completedAt)}</dd><dt>Qualified for commission</dt><dd>${date(row.qualifiesAt)}</dd></dl>
                <p class="field-workflow__next"><strong>Next step</strong> ${row.state==='earned'?'See the earned commission record below.':row.state==='held'?'Contact management about this order’s hold.':row.state==='calculation_review'?'Management must review actual costs, fees and the approved commission rate.':'Installation and final payment must be verified before commission qualifies.'}</p>
                ${admin() ? `<details class="field-workflow__review"><summary>Qualification review details</summary><p>${esc((row.reasons || []).join('; ') || 'No additional review reasons reported.')}</p><details class="field-workflow__audit"><summary>Admin audit details — order qualification</summary><pre>${esc(JSON.stringify(row,null,2))}</pre></details></details><button type="button" data-earnings-review="${esc(row.quoteId)}"${row.state === 'earned' || row.state === 'held' ? ' disabled' : ''}>Review actual earning inputs</button>` : ''}</article>`).join('') || '<div class="field-sales__empty"><p>No orders awaiting qualification. Completed sales will appear here for review.</p></div>'}</section>
                <section class="field-sales__section"><h4>Earned commissions</h4>${d.entries.map((row,index) => `<article class="field-workflow__record"><header class="field-workflow__header"><h4>${esc(entryTitle(row,index))}</h4><strong>${money(row.amountCents)} earned</strong></header>
                <dl class="field-workflow__facts"><dt>Qualified</dt><dd>${date(row.qualifiesAt)}</dd><dt>Actual commission basis</dt><dd>${money(row.basisCents)}</dd><dt>Approved rate</dt><dd>${esc(row.rateBasisPoints / 100)}% · tenure day ${esc(row.tenureDay)}</dd></dl>
                ${admin()?`<details class="field-workflow__audit"><summary>Admin audit details — immutable rate, cost & qualification evidence</summary><pre>${esc(JSON.stringify(row,null,2))}</pre></details>`:''}
                ${admin() ? `<details><summary>Append reviewed adjustment</summary><form data-earnings-form="review_adjustment" class="field-sales__form">
                    <input type="hidden" name="entryId" value="${esc(row.entryId)}">
                    <label>Adjustment (signed integer cents)<input name="amountCents" type="number" step="1" required></label>
                    <label>Reason<textarea name="reason" required maxlength="2000"></textarea></label>
                    <label class="field-sales__wide">Source evidence<textarea name="evidence" required maxlength="4000"></textarea></label>
                    <button type="submit">Append reviewed adjustment</button></form></details>` : ''}</article>`).join('') || '<div class="field-sales__empty"><p>No earned commission yet. Qualification and amount reviews must finish first.</p></div>'}</section>
                <section class="field-sales__section"><h4>Accounting adjustments</h4><p>Reviewed corrections are not authorized debt or automatic clawback.</p>${d.adjustments.map(row => `<article class="field-workflow__record"><strong>${money(row.amountCents)}</strong><p>Reviewed ${date(row.reviewedAt)}</p>
                    <p>${row.settlementState==='recovery_review_required'?'Recovery review required. New runs are blocked; this is not representative debt or authorization to recover money.':'Accounting correction under review. This does not authorize recovery from the representative.'}</p>
                    ${admin()?`<details class="field-workflow__audit"><summary>Admin audit details — adjustment reason & evidence</summary><pre>${esc(JSON.stringify(row,null,2))}</pre></details>`:''}</article>`).join('') || '<p class="field-sales__empty">No accounting adjustments.</p>'}</section>
                <section class="field-sales__section"><h4>Friday payment review</h4><p class="field-workflow__note">Approval and export are review steps only. Only matching independent settlement evidence can establish paid status.</p>
                ${d.runs.map(row => run(row)).join('') || '<p>No reviewed runs.</p>'}
                ${admin() ? `<details><summary>Create Friday review run</summary><form data-earnings-form="create_run" class="field-sales__form">
                    <details class="field-sales__wide field-workflow__audit"><summary>Admin evidence details — approved settlement policy (required)</summary><label>Approved settlement policy ID<input name="settlementPolicyId" required></label><p>Use the exact approved Friday settlement policy from order management.</p></details>
                    <label>Run date (approved policy timezone)<input name="runDate" type="date" required></label>
                    <button type="submit">Create review run — not a transfer</button></form></details>` : ''}</section>`;
        }
        function run(row) {
            return `<article class="field-workflow__record"><header class="field-workflow__header"><h4>Friday review · ${esc(row.runDate)}</h4><span class="field-sales__badge">${esc(human(row.state))}</span></header><p><strong>${money(row.amountCents)}</strong> ${row.state==='reconciled_paid'?'independently reconciled':row.state==='abandoned'?'released allocation — not paid':'reviewed allocation — not confirmed paid'}</p>
                <p>${row.beneficiaries.map((b,index)=>`${esc(admin() ? b.representativeName || options.representativeNames?.[b.representativeId] || state.representativeLabels.get(b.representativeId) || 'Beneficiary '+(index+1) : 'Commission allocation')}: ${money(b.amountCents)}`).join('; ')}</p>
                ${admin()?`<details class="field-workflow__audit"><summary>Admin audit details — run, beneficiaries & settlement evidence</summary><pre>${esc(JSON.stringify(row,null,2))}</pre></details>`:''}
                ${row.state==='abandoned'?`<p>Abandoned unexported run. Effective allocations released; immutable review history remains. This is neither payment nor representative debt.</p>
                    `:''}
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
                    <details class="field-sales__wide field-workflow__audit"><summary>Admin evidence details — beneficiaries reconciliation (required)</summary><label>Verified beneficiaries & integer amounts (JSON)<textarea name="beneficiaries" required>${esc(JSON.stringify(row.beneficiaries,null,2))}</textarea></label></details>
                    <label class="field-sales__wide">Independent reconciliation evidence<textarea name="evidence" required maxlength="4000"></textarea></label>
                    <label class="field-sales__wide field-sales__check"><input name="independentReconciliation" type="checkbox" required>I independently reconciled the amount, beneficiaries and external reference.</label>
                    <button type="submit">Record reconciled settlement evidence</button></form>` : '<p>Settlement recording remains blocked until an approved run is exported and independently reconciled.</p>'}</details>` : ''}</article>`;
        }
        async function load() {
            if (!valid()) return;
            root.innerHTML = '<h3>Earnings</h3><p data-earnings-status role="status">Loading earnings…</p>';
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
