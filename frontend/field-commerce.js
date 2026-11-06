(function (global) {
    'use strict';
    const apiRoot = base => String(base).replace(/\/+$/,'').replace(/\/api$/i,'') + '/api';
    let active, generation = 0;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const money = value => value === null || value === undefined ? 'Pricing required' : new Intl.NumberFormat(undefined,{style:'currency',currency:'USD'}).format(Number(value)/100);
    const stateLabel = value => ({draft:'Draft',published:'Published',staging_only:'STAGING ONLY - not production approved',retired:'Retired',pending_approval:'Awaiting approval',approved:'Approved',rejected:'Not approved',expired:'Expired',superseded:'Replaced by a newer revision',open:'Open',paid:'Paid',complete:'Complete',completed:'Complete',payment_exception:'Payment review needed',pending:'Pending',processing:'Processing',failed:'Failed',cancelled:'Cancelled',refunded:'Refunded',partially_refunded:'Partially refunded',deposit:'Deposit',balance:'Remaining balance',full:'Full payment',payment_pending:'Awaiting payment',scheduled:'Scheduled',unpaid:'Unpaid',no_payment_required:'No payment required'}[value] || 'Review needed');
    const stateTone = value => ['approved','paid','complete','completed'].includes(value) ? 'success' : ['rejected','failed','payment_exception'].includes(value) ? 'attention' : ['pending_approval','processing','scheduled'].includes(value) ? 'info' : 'neutral';
    const facts = rows => `<dl class="field-sales__facts">${rows.map(([title,value])=>`<div><dt>${esc(title)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`;
    const customerSummary = customer => `<div class="field-sales__quote-customer"><strong>${esc(customer.name || 'Customer')}</strong><p class="field-sales__note">${esc([customer.address,customer.city].filter(Boolean).join(' · ') || 'Property address not provided')}</p>${customer.phone ? `<p class="field-sales__note">${esc(customer.phone)}</p>` : ''}</div>`;
    function reset() { generation++; active?.sync?.destroy(); active?.controller.abort(); global.H2SFieldWorkflow?.reset(); if (active) active.root.replaceChildren(); active = null; }
    // Retain only the unsaved builder DOM, never immutable quote/review state.
    function captureDraft() {
        if (!active?.valid() || !active.options.leadId) return null;
        const form = active.root.querySelector('[data-commerce-create]');
        if (!form) return null;
        const catalog = active.data.catalogs.find(item => item.catalog_id === form.elements.catalogId.value);
        return {leadId: active.options.leadId, form, rows: active.rows,
            catalog: active.draftBlocked ? active.options.draft.catalog : JSON.stringify(catalog)};
    }
    function canLeave() {
        if (!active) return true;
        if (active.busy || active.attempt) {
            active.status('Finish or retry the pending transaction action before leaving, or explicitly discard the interrupted action.', true);
            return false;
        }
        return true;
    }
    function mount(root, options) {
        reset(); const id = generation, started = options.getSession()?.token, startedRole=options.getSession()?.role;
        const state = { root, options, controller: new AbortController(), data: null, current: null, busy: false, attempt: null, attemptEndpoint:null, catalog:null, catalogError:null, rows: 1, dirty:false, edits:0, read:0 };
        active = state;
        const valid = () => {
            const matches=id===generation&&active===state&&!!started&&options.getSession()?.token===started&&options.getSession()?.role===startedRole&&['ADMIN','SALES'].includes(startedRole);
            if(!matches&&active===state&&id===generation)reset();
            return matches;
        };
        const admin = () => options.getSession()?.role === 'ADMIN';
        function status(message, error = false) {
            const target = root.querySelector('[data-commerce-status]'); if (!target || !valid()) return;
            target.textContent = message; target.setAttribute('role', error ? 'alert' : 'status');
            if (error && !state.attempt) {
                const button=document.createElement('button'); button.type='button';button.textContent='Retry';button.dataset.commerceRefresh='';
                target.append(' ',button);
            } else if (error && state.attempt) {
                const button=document.createElement('button');button.type='button';button.textContent='Discard interrupted action';button.dataset.commerceDiscardAttempt='';
                target.append(' ',button);
            }
        }
        state.valid = valid; state.status = status;
        async function api(body,endpoint='field-sales-transactions') {
            if (!valid()) throw Error('Session changed; private transaction response discarded.');
            const response = await global.fetch(`${apiRoot(options.apiBase)}/${endpoint}${body || !options.leadId || endpoint!=='field-sales-transactions' ? '' : '?leadId='+encodeURIComponent(options.leadId)}`,
                { method: body ? 'POST' : 'GET', cache: 'no-store', signal: !body && global.H2SDataSync ? global.H2SDataSync.signal(state.controller.signal) : state.controller.signal,
                    headers: { Authorization: `Bearer ${started}`, ...(body ? {'Content-Type':'application/json'} : {}) },
                    ...(body ? {body:JSON.stringify(body)} : {}) });
            if (!valid()) throw Error('Session changed; private transaction response discarded.');
            if (response.status === 401 || response.status === 403) { options.onSessionEnded(); throw Error('Transaction access ended. Sign in again or contact management.'); }
            const result = await response.json();
            if (!valid()) throw Error('Session changed; private transaction response discarded.');
            if (!response.ok || !result.ok) throw Error(result.error || 'Transaction request failed; no success is implied.');
            return result;
        }
        const dirty = () => state.dirty || state.busy || !!state.attempt || global.H2SDataSync?.interacting(root);
        async function load(background = false) {
            if (!valid()) return;
            const read=++state.read, edits=state.edits;
            if (!state.data) root.innerHTML = '<h3>Quotes & customer acceptance</h3><p class="field-sales__loading" data-commerce-status role="status">Loading quotes, agreements and payment status…</p>';
            try {
                const data = await api(); if (!valid() || read!==state.read || background && (edits!==state.edits || dirty())) return false;
                if(typeof data.enabled!=='boolean'||data.enabled&&!['catalogs','quotes','payments','orders','agreements'].every(key=>Array.isArray(data[key])))throw Error('Incomplete quote and payment response. Previously loaded records are retained.');
                if(admin()&&!options.leadId){
                    state.catalog=null;state.catalogError=null;
                    try{const catalog=await api(null,'field-sales-catalog');if(typeof catalog.enabled!=='boolean'||catalog.enabled&&!Array.isArray(catalog.catalogs))throw Error('Catalog response incomplete. No publication is assumed.');state.catalog=catalog;}
                    catch(error){if(!valid())return;console.error('Field catalog read failed:',error.message);state.catalogError=error.message;}
                }
                if (!valid() || read!==state.read || background && (edits!==state.edits || dirty())) return false;
                const selected=state.current?.quote_id,links=background?[...root.querySelectorAll('[data-commerce-handoff],[data-commerce-checkout-link]')].map(el=>({selector:el.hasAttribute('data-commerce-handoff')?'[data-commerce-handoff]':'[data-commerce-checkout-link]',nodes:[...el.childNodes]})):[];
                state.data = data;
                if (state.current) state.current=data.quotes.find(q=>q.quote_id===state.current.quote_id)||null;
                if (global.H2SDataSync) global.H2SDataSync.preserveView(root,render); else render();
                if(selected&&state.current?.quote_id===selected&&state.current.state==='approved')for(const link of links)root.querySelector(link.selector)?.append(...link.nodes);
                if(state.catalogError)throw Error('Quote/payment records loaded, but catalog configuration is unavailable: '+state.catalogError);
                return true;
            }
            catch (error) { console.error('Field transaction read failed.'); if(background)throw error; status(error.message, true); return false; }
        }
        function render() {
            const d = state.data;
            const priority = q => ({pending_approval:0,draft:1,approved:2}[q.state] ?? 3);
            const quotes = [...(d.quotes || [])].sort((a,b)=>priority(a)-priority(b)
                || (Date.parse(a.created_at)||0)-(Date.parse(b.created_at)||0) || a.revision-b.revision);
            root.innerHTML = '<h3>Quotes & customer acceptance</h3><p data-commerce-status role="status" aria-live="polite"></p>';
            if(admin()&&!options.leadId)catalogAdmin();
            if (!d.enabled) { status('Transactions are disabled. No quote, agreement or payment can be activated.'); return; }
            root.insertAdjacentHTML('beforeend', '<details class="field-sales__guidance"><summary>Acceptance & payment safeguards</summary><p>Acceptance is not payment confirmation. No automatic technician assignment. Use secure checkout; never enter card details here.</p></details>');
            if (!options.leadId) {
                root.insertAdjacentHTML('beforeend', `<h4>Management quote and payment review</h4><p>${d.quotes.length} quote revisions loaded. Historical revisions are not separate sales.</p>
                    <div class="field-sales__quote-list">${quotes.map(q => `<article class="field-sales__quote-card"><div class="field-sales__record-heading"><button type="button" class="field-sales__customer-link" data-commerce-lead="${esc(q.lead_id)}">${esc(q.snapshot.customer.name)} · Revision ${esc(q.revision)}</button>
                    <span class="field-sales__badge" data-tone="${stateTone(q.state)}">${esc(stateLabel(q.state))}</span></div>
                    ${facts([[q.state==='approved'?'Approved quote total':'Proposed quote total',money(q.snapshot.totalCents)],['Next action',quoteNext(q)],['Property',q.snapshot.customer.market==='commercial'?'Commercial':'Residential']])}
                    ${admin()?`<details><summary>Quote attribution audit</summary><p class="field-sales__id">${esc(q.attributed_user_id)} / ${esc(q.quote_id)}</p></details>`:''}
                    ${facts([['Agreement',d.agreements.some(a=>a.quote_id===q.quote_id&&a.accepted_at) ? 'Agreement accepted' : 'No accepted agreement']])}
                    ${payments(q)}</article>`).join('') || '<p class="field-sales__empty">No quote revisions to review.</p>'}</div>`);
                return;
            }
            function catalogAdmin(){
                const d=state.catalog;
                if(state.catalogError){root.insertAdjacentHTML('beforeend',`<p role="alert">Catalog configuration unavailable: ${esc(state.catalogError)}. No prices or publication are assumed.</p>`);return;}
                if(!d?.enabled){root.insertAdjacentHTML('beforeend','<p>Catalog administration disabled. No pricing version can be drafted or published here.</p>');return;}
                if(!Array.isArray(d.catalogs)){root.insertAdjacentHTML('beforeend','<p role="alert">Catalog response incomplete. No publication is assumed.</p>');return;}
                root.insertAdjacentHTML('beforeend',`<details data-commerce-catalog-admin><summary>Approved service catalog configuration</summary>
                    <p>Reuse the existing quote engine. Drafts are not payable. Publication requires reviewed source, service markets and explicit management approval; no proposed price is prefilled.</p>
                    ${d.catalogs.map(c=>`<article><h4>${esc(c.version)} / ${esc(c.status)}</h4><p class="field-sales__id">${esc(c.catalog_id)} / ${esc(c.digest)}</p>
                        <pre>${esc(JSON.stringify(c.definition,null,2))}</pre><p>Source evidence: ${esc(JSON.stringify(c.source_evidence))}</p>
                        <p>${c.status==='staging_only'?'STAGING ONLY technical activation; no production approval':'Approved by'} ${esc(c.approved_by||'Not approved')} / ${c.status==='staging_only'?'test activation':'published'} ${esc(c.published_at||'Not published')}</p>
                        ${['draft','published'].includes(c.status)?`<form data-commerce-catalog-action="${c.status==='draft'?'publish':'retire'}" class="field-sales__form">
                            <input name="catalogId" type="hidden" value="${esc(c.catalog_id)}"><input name="expectedDigest" type="hidden" value="${esc(c.digest)}">
                            ${c.status==='draft'?'<label class="field-sales__wide">Management publication approval evidence<textarea name="approvalEvidence" required maxlength="2000"></textarea></label><label class="field-sales__wide field-sales__check"><input name="publishConfirmed" type="checkbox" required>I explicitly authorize this reviewed digest/version to become payable pricing. Proposed prices are not approved by default.</label>':''}
                            <button type="submit">${c.status==='draft'?'Explicitly publish reviewed pricing version':'Retire version for future quotes'}</button></form>`:''}</article>`).join('')||'<p>No catalog versions.</p>'}
                    <form data-commerce-catalog-action="create_draft" class="field-sales__form">
                        <label>New catalog UUID<input name="catalogId" value="${esc(global.crypto.randomUUID())}" required></label>
                        <label>Version label<input name="version" required maxlength="120"></label>
                        <label class="field-sales__wide">Optional catalog JSON file (local import only)<input name="catalogFile" type="file" accept=".json,application/json" data-commerce-catalog-file></label>
                        <label class="field-sales__wide">Catalog definition JSON<textarea name="definition" required></textarea></label>
                        <label class="field-sales__wide">Source/reconciliation evidence<textarea name="sourceEvidence" required maxlength="4000"></textarea></label>
                        <button type="submit">Validate and save unapproved draft</button></form></details>`);
            }
            const catalogs = d.catalogs.filter(c=>c.status!=='retired').sort((a,b)=>Number(b.status==='published')-Number(a.status==='published'));
            if (!catalogs.length) root.insertAdjacentHTML('beforeend', '<p class="field-sales__empty">No quoting catalog is configured. Contact management to review and publish pricing before building a quote.</p>');
            else {
                root.insertAdjacentHTML('beforeend', `<h4>Create Quote</h4><form data-commerce-create class="field-sales__form">
                    <label class="field-sales__wide">Pricing version<select name="catalogId" data-commerce-catalog>${catalogs.map(c=>`<option value="${esc(c.catalog_id)}">${esc(c.version)} · ${esc(stateLabel(c.status))}${c.status==='draft'?' - not payable':''}</option>`).join('')}</select></label>
                    <div class="field-sales__wide" data-commerce-lines></div><button type="button" data-commerce-add>Add service line</button>
                    <button type="submit" class="field-sales__primary">Calculate & save quote draft</button></form>`);
                rows();
            }
            if (options.draft?.leadId === options.leadId && options.draft.form) {
                const fresh = root.querySelector('[data-commerce-create]'), draft = options.draft;
                if (fresh) fresh.replaceWith(draft.form); else root.append(draft.form);
                state.rows = draft.rows;
                const current = d.catalogs.find(item => item.catalog_id === draft.form.elements.catalogId.value);
                state.draftBlocked = JSON.stringify(current) !== draft.catalog;
                draft.form.querySelectorAll('input,select,textarea,button').forEach(control => { control.disabled = state.draftBlocked; });
                if (state.draftBlocked) {
                    status('Pricing configuration changed. Your unsaved scope is retained. Discard the quote draft explicitly to use current choices.', true);
                }
            }
            if(root.querySelector('[data-commerce-create]'))root.insertAdjacentHTML('beforeend','<button type="button" data-commerce-discard-draft>Discard quote draft</button>');
            root.insertAdjacentHTML('beforeend', `<h4>Saved quotes</h4><p class="field-sales__note">Approval and draft actions first · oldest first within each state</p><div class="field-sales__quote-revisions">${quotes.map(q=>`<button type="button" data-commerce-quote="${esc(q.quote_id)}"><span>Revision ${esc(q.revision)} · ${esc(stateLabel(q.state))}</span><strong>${money(q.snapshot.totalCents)}</strong></button>`).join('') || '<p class="field-sales__empty">No saved quotes for this customer. Complete the service scope above to create a draft.</p>'}</div><div data-commerce-review></div>`);
            state.current = d.quotes.find(q=>q.quote_id===state.current?.quote_id) || d.quotes[0];
            review();
        }
        function catalog() { return state.data.catalogs.find(c=>c.catalog_id===root.querySelector('[data-commerce-catalog]').value); }
        function rows() {
            const target = root.querySelector('[data-commerce-lines]'); if (!target) return;
            const c = catalog(), market = state.data.quotes[0]?.snapshot.customer.market || root.closest('[data-market]')?.dataset.market;
            const offers = c.definition.services.filter(s=>!market||s.markets.includes(market)).flatMap(s=>s.offers.filter(o=>o.enabled).map(o=>({s,o})));
            const start = target.children.length;
            target.insertAdjacentHTML('beforeend', Array.from({length:state.rows-start},(_,n)=>{ const i=start+n; return `<fieldset data-commerce-line><legend>Service line ${i+1}</legend>
                <label>Service / equipment / installation<select data-commerce-offer>${offers.map(({s,o})=>`<option value="${esc(s.id+':'+o.id)}">${esc(s.label)} / ${esc(o.label)}</option>`).join('')}</select></label>
                <div data-commerce-inputs></div><button type="button" data-commerce-remove>Remove service line</button></fieldset>`; }).join(''));
            for (const row of [...target.children].slice(start)) inputs(row);
        }
        function inputs(row) {
            const [sid,oid] = row.querySelector('[data-commerce-offer]').value.split(':'), s = catalog().definition.services.find(s=>s.id===sid), o=s?.offers.find(o=>o.id===oid);
            const target=row.querySelector('[data-commerce-inputs]');
            if (!o) { target.textContent='No eligible offers in this version.'; return; }
            target.innerHTML=`<div class="field-sales__scope-note"><p><strong>Included scope</strong><br>${esc(o.scope.join('; ') || 'Scope requires review')}</p><p class="field-sales__note">Equipment: ${esc(o.equipment.join('; ')||'No included equipment specified')}</p></div>
                <label>Quantity<input name="quantity" type="number" step="1" min="${esc(o.minimum)}" max="${esc(o.maximum)}" value="${esc(o.minimum)}" required></label>
                ${o.questions.map(q=>`<label>${esc(q.label)}${q.required?' (qualification required)':''}${q.type==='select'
                    ?`<select data-q="${esc(q.id)}"><option value="">Not yet qualified</option>${q.options.map(v=>`<option>${esc(v)}</option>`).join('')}</select>`
                    :`<input data-q="${esc(q.id)}" type="${q.type==='number'?'number':'text'}"${q.type==='number'?` step="any" min="${esc(q.min??0)}" max="${esc(q.max??100000)}"`:' maxlength="2000"'}>`}</label>`).join('')}
                ${o.options.map(opt=>`<label class="field-sales__check"><input type="checkbox" data-option value="${esc(opt.id)}">${esc(opt.label)} / ${money(opt.amountCents)} ${opt.perUnit?'per unit':'per line'}</label>`).join('')}
                <label>Unusual conditions requiring review<textarea name="exceptionNote" maxlength="2000"></textarea></label>`;
        }
        function quoteNext(q) {
            if(q.state==='pending_approval')return admin()?'Review quote approval':'Await management approval';
            if(q.state==='draft')return 'Complete scope and submit for approval';
            if(q.state!=='approved')return 'Review current quote revision';
            if(!state.data.agreements.some(a=>a.quote_id===q.quote_id&&a.accepted_at))return 'Customer signature required';
            const paid=state.data.payments.filter(p=>p.quote_id===q.quote_id).reduce((sum,p)=>sum+Number(p.captured_cents)-Number(p.refunded_cents),0);
            return paid<q.snapshot.totalCents?'Follow up on eligible customer payment':'Track installation in Orders';
        }
        function payments(q) {
            const rows=state.data.payments.filter(p=>p.quote_id===q.quote_id), net=rows.reduce((s,p)=>s+Number(p.captured_cents)-Number(p.refunded_cents),0),
                workflow=state.data.workflows?.find(w=>w.quoteId===q.quote_id);
            const accepted=state.data.agreements.find(a=>a.quote_id===q.quote_id&&a.accepted_at);
            const depositRequired=workflow?.depositCents ?? accepted?.policy_snapshot?.paymentPlan?.depositCents;
            const depositCollected=rows.filter(p=>p.kind==='deposit').reduce((sum,p)=>sum+Number(p.captured_cents)-Number(p.refunded_cents),0);
            const refunded=rows.reduce((sum,p)=>sum+Number(p.refunded_cents),0);
            return `${facts([['Deposit required',depositRequired===undefined?'Approved deposit not established':money(depositRequired)],
                ['Deposit collected · verified deposit sessions',money(depositCollected)],['Total verified payments (net of refunds)',money(net)],['Verified refunds',money(refunded)],
                ['Outstanding balance',q.snapshot.totalCents===null?'Unpriced':money(Math.max(0,q.snapshot.totalCents-net))]])}
                ${rows.map(p=>`<div class="field-sales__payment-record"><div class="field-sales__record-heading"><strong>${esc(stateLabel(p.kind))}</strong><span class="field-sales__badge" data-tone="${stateTone(p.state)}">${esc(stateLabel(p.state))}</span></div>${facts([['Checkout amount · not proof of collection',money(p.amount_cents)],['Verified captured',money(p.captured_cents)],['Verified refunds',money(p.refunded_cents)]])}
                ${admin()?`<details><summary>Provider reconciliation details</summary><p>${esc(p.kind)} / ${esc(p.state)} / ${esc(p.provider_state || 'Provider state unavailable')}</p></details>`:''}
                ${options.leadId&&p.session_id?`<button type="button" data-commerce-verify="${esc(p.checkout_id)}">Verify with Stripe</button>`:''}
                ${admin()&&options.leadId&&workflow&&p.session_id&&p.state==='open'?`<button type="button" data-commerce-expire="${esc(p.checkout_id)}">Expire this open checkout</button>`:''}</div>
                ${admin()&&options.leadId&&workflow&&['cancelled','refund_review'].includes(workflow.state)&&Number(p.captured_cents)>Number(p.refunded_cents)?
                    `<details><summary>Explicitly reviewed provider refund</summary><p>Cancellation is not an automatic refund. A submitted request can move money through the existing payment provider; pending and failed states require reconciliation.</p>
                    <form data-commerce-refund class="field-sales__form"><input name="checkoutId" type="hidden" value="${esc(p.checkout_id)}">
                        <label>Approved refund (integer cents)<input name="amountCents" type="number" min="1" max="${esc(Number(p.captured_cents)-Number(p.refunded_cents))}" step="1" required></label>
                        <label class="field-sales__wide">Refund approval/source evidence<textarea name="evidence" required maxlength="4000"></textarea></label>
                        <label class="field-sales__wide field-sales__check"><input name="authorized" type="checkbox" required>I authorize this exact reviewed refund amount; this is not merely a review/export.</label>
                        <button type="submit">Request this reviewed provider refund</button></form></details>`:''}`).join('')}`;
        }
        function review() {
            const target=root.querySelector('[data-commerce-review]'),q=state.current;if(!target||!q)return;
            const a=state.data.agreements.find(a=>a.quote_id===q.quote_id),p=state.data.payments.filter(p=>p.quote_id===q.quote_id),
                net=p.reduce((sum,row)=>sum+Number(row.captured_cents)-Number(row.refunded_cents),0),exception=p.some(p=>Number(p.refunded_cents)>0||p.disputed||p.state==='payment_exception'),
                depositReady=Number(a?.policy_snapshot?.paymentPlan?.depositCents)>0,
                workflow=state.data.workflows?.find(w=>w.quoteId===q.quote_id);
            root.querySelectorAll('[data-commerce-quote]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.commerceQuote===q.quote_id)));
            target.innerHTML=`<article class="field-sales__quote-review"><div class="field-sales__record-heading"><h4>Quote revision ${esc(q.revision)}</h4><span class="field-sales__badge" data-tone="${stateTone(q.state)}">${esc(stateLabel(q.state))}</span></div>
                ${admin()?`<details><summary>Immutable quote audit</summary><p class="field-sales__id">${esc(q.quote_id)} / ${esc(q.quote_hash)}</p><p>${esc(q.snapshot.catalogVersion)} / ${esc(q.snapshot.pricingStatus)}</p></details>`:''}
                ${customerSummary(q.snapshot.customer)}
                ${q.snapshot.lines.map(line=>`<section class="field-sales__quote-scope"><h4>${esc(line.service)}</h4><p>${esc(line.description)}</p>
                    ${facts([['Quantity',line.quantity],['Base',money(line.baseCents)],['Equipment / materials',line.equipment.join('; ') || 'None specified'],['Scope',line.scope.join('; ') || 'Requires review'],
                        ...Object.entries(line.answers||{}).map(([id,value])=>[line.answerLabels?.[id]||'Qualification',value]),
                        ...line.addOns.map(a=>[a.label,money(a.amountCents)]),['Line total',money(line.totalCents)],['Exclusions / conditions',line.exclusions.join('; ') || 'None specified']])}</section>`).join('')}
                ${q.snapshot.managementAdjustmentCents!==undefined?`<p>Audited management adjustment: ${money(q.snapshot.managementAdjustmentCents)} / ${esc(q.snapshot.managementReview.reason)}</p>`:''}
                ${q.snapshot.managementReview?`<p>Management decision: ${esc(stateLabel(q.snapshot.managementReview.decision==='approve'?'approved':q.snapshot.managementReview.decision==='reject'?'rejected':q.snapshot.managementReview.decision))} · final scope confirmation: ${esc(q.snapshot.managementReview.scopeConfirmation)}</p>`:''}
                <div class="field-sales__quote-total"><span>${q.state==='approved'?'Approved quote total':'Proposed quote total'}</span><strong>${money(q.snapshot.totalCents)}</strong></div><p class="field-workflow__next"><strong>Next action</strong> ${esc(quoteNext(q))}</p><p class="field-sales__note">Valid until: ${q.expires_at?esc(new Date(q.expires_at).toLocaleString()):'Not payable / validity pending approval'}</p>
                <p class="field-sales__note">Pricing version: ${esc(q.snapshot.catalogVersion)}. Saved quotes are read-only; any approved changes create a new revision.</p>
                <p>Approval requirements: ${esc(q.snapshot.approvalReasons.join('; ')||'No exceptional qualification flags')}</p>
                ${q.state==='draft'?'<button type="button" data-commerce-submit>Submit quote / request management approval</button>':''}
                ${admin()&&q.state==='pending_approval'?`<form data-commerce-approve class="field-sales__form"><label>Approved final total (optional adjustment, USD)<input name="amount" inputmode="decimal"></label>
                    <label>Reason<textarea name="reason" required maxlength="2000"></textarea></label><label class="field-sales__wide">Final scope confirmation<textarea name="scopeConfirmation" maxlength="6000"></textarea></label>
                    <button type="submit" value="approve">Approve as new immutable revision</button><button type="submit" value="reject">Reject revision</button></form>`:''}
                <h4>Customer agreement</h4><p>${a?.accepted_at?'Customer acceptance recorded '+esc(new Date(a.accepted_at).toLocaleString()):'No accepted customer agreement.'}</p>
                ${a?.policy_snapshot?`<details><summary>Saved agreement version ${esc(a.policy_snapshot.version)}</summary><pre>${esc(a.policy_snapshot.terms)}</pre><h4>Payment terms</h4><pre>${esc(a.policy_snapshot.payment_terms)}</pre><h4>Cancellation information</h4><pre>${esc(a.policy_snapshot.cancellation_information)}</pre><h4>Electronic delivery</h4><pre>${esc(a.policy_snapshot.electronic_delivery)}</pre></details>`:''}
                ${q.state==='approved'?`<button type="button" data-commerce-agreement ${a||state.data.policyReady?'':'disabled'}>${workflow&&a?.accepted_at?'Renew finite secure customer-copy / balance link':a?'Present existing agreement':'Prepare exact-quote agreement'}</button>`:''}
                ${!state.data.policyReady?'<p>Agreement language, cancellation and electronic delivery approval is missing.</p>':''}<div data-commerce-handoff></div>
                <h4>Secure payment & order</h4>${payments(q)}
                ${workflow ? `<button type="button" data-commerce-checkout="${net>0?'balance':'deposit'}"${(net>0 ? workflow.gates?.canBalance : workflow.gates?.canDeposit) === true ? '' : ' disabled'}>Start secure ${net>0?'post-install net balance':'25% deposit'} checkout</button>
                    <p>${net>0&&!workflow.gates?.canBalance?'Net balance collection blocked until completion and current payment clearance.':!net&&!workflow.gates?.canDeposit?'Deposit collection blocked until exact acceptance, approved documents and current payment gates.':'Checkout is a secure handoff, never payment confirmation.'}</p>` :
                a?.accepted_at&&!exception&&net<q.snapshot.totalCents?`<button type="button" data-commerce-checkout="${net>0?'balance':'full'}">Start secure ${net>0?'remaining balance':'full-payment'} checkout</button>
                    ${net===0?`<button type="button" data-commerce-checkout="deposit"${depositReady?'':' disabled'}>Start approved deposit checkout</button>`:''}`:''}
                ${!state.data.depositConfigured&&!depositReady?'<p>Deposit policy unset. No nonrefundable terms are implied.</p>':''}
                ${depositReady?`<p>Exact agreement deposit: ${money(a.policy_snapshot.paymentPlan.depositCents)}; remaining balance: ${money(a.policy_snapshot.paymentPlan.remainingAfterDepositCents)}. Later policy changes do not alter these accepted amounts.</p>`:''}<div data-commerce-checkout-link></div>
                ${a&&!depositReady&&state.data.depositConfigured?'<p>This exact agreement does not authorize a deposit. Later policy changes do not alter accepted terms.</p>':''}
                ${state.data.orders.filter(o=>o.quote_id===q.quote_id).map((o,index)=>`<p>Customer order ${index+1} · ${esc(stateLabel(o.status))} · scheduling requires management review.</p>${admin()?`<details><summary>Order audit reference</summary><p class="field-sales__id">${esc(o.order_reference)} / ${esc(o.status)}</p></details>`:''}`).join('')}
                </article><div data-commerce-workflow></div>`;
            const workflowRoot=target.querySelector('[data-commerce-workflow]');
            if(global.H2SFieldWorkflow) global.H2SFieldWorkflow.mount(workflowRoot,{apiBase:options.apiBase,getSession:options.getSession,quoteId:q.quote_id,leadId:options.leadId,onSessionEnded:options.onSessionEnded,
                customerNames:{...options.customerNames,...(options.leadId?{[options.leadId]:q.snapshot.customer.name}:{})},representativeNames:options.representativeNames});
            else workflowRoot.textContent='Integrated order trace unavailable. No legal clearance or fulfillment is implied.';
        }
        function safeLink(value,checkout=false){
            const url=new URL(value,global.location.href);
            if(url.protocol!=='https:'||(checkout?url.hostname!=='checkout.stripe.com':![global.location.origin,new URL(options.apiBase).origin].includes(url.origin)))throw Error('Server returned an untrusted handoff URL. No link opened.');
            return url.href;
        }
        async function write(body,endpoint='field-sales-transactions') {
            if(state.busy||!valid())return;state.busy=true;
            if(state.attempt&&(endpoint!==state.attemptEndpoint||body.action!==state.attempt.action||body.quoteId!==state.attempt.quoteId||body.checkoutId!==state.attempt.checkoutId||body.catalogId!==state.attempt.catalogId)){
                state.busy=false;status('An interrupted action must be retried or refreshed before choosing a different operation.',true);return;
            }
            if(!state.attempt){state.attempt={...body,...(endpoint==='field-sales-transactions'?{leadId:options.leadId}:{}),operationId:global.crypto.randomUUID()};state.attemptEndpoint=endpoint;}
            status('Saving/verifying on the server. An interrupted action retains its exact retry key.');
            try {
                const action=state.attempt.action,result=await api(state.attempt,state.attemptEndpoint);if(!valid())return;state.attempt=null;state.attemptEndpoint=null;
                state.dirty=false;
                if(action==='quote'){options.draft=null;options.onDraftDiscard?.();}
                if(result.id&&['quote','submit','approve','reject'].includes(action))state.current={quote_id:result.id};
                if(result.agreementUrl){const href=safeLink(result.agreementUrl),target=root.querySelector('[data-commerce-handoff]');target.replaceChildren();const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open/share finite secure customer link';target.append(a);
                    if(result.expiresAt){const expiry=document.createElement('p');expiry.textContent='Secure handoff expires '+new Date(result.expiresAt).toLocaleString()+'. '+(result.scope==='accepted_documents_balance'?'Customer copies and eligible remaining balance.':'Exact approved customer agreement.');target.append(expiry);}
                    root.querySelector('[data-commerce-agreement]').disabled=true;status(result.handoffId?'Finite customer-copy/payment handoff issued. It does not extend acceptance or imply payment.':'Agreement prepared. Customer acceptance and verified payments update automatically.');}
                else if(result.checkoutUrl){const href=safeLink(result.checkoutUrl,true);if(result.payment){state.data.payments=[...state.data.payments.filter(p=>p.checkout_id!==result.payment.checkout_id),result.payment];review();}const target=root.querySelector('[data-commerce-checkout-link]');target.replaceChildren();const a=document.createElement('a');a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open secure Stripe Checkout — not paid';target.append(a);status('Checkout created, not paid. After the customer returns, use Verify with Stripe to check payment and order status.');}
                else await load();
            }catch(error){console.error('Field transaction action failed.');status(error.message+' Retry the same action with its retained key.',true);}
            finally{state.busy=false;}
        }
        root.addEventListener('change',event=>{
            if(event.target.closest('form')){state.dirty=true;state.edits++;}
            if(!valid()||state.busy)return;
            if(state.draftBlocked && event.target.closest('[data-commerce-create]'))return;
            if(event.target.matches('[data-commerce-catalog]')){state.rows=1;root.querySelector('[data-commerce-lines]').replaceChildren();rows();}
            if(event.target.matches('[data-commerce-offer]'))inputs(event.target.closest('[data-commerce-line]'));
        });
        root.addEventListener('change',async event=>{
            if(!event.target.matches('[data-commerce-catalog-file]')||!valid()||!admin()||state.busy)return;
            try{const file=event.target.files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('Choose catalog JSON under 2 MB.');
                const text=await file.text();if(!valid())return;const definition=JSON.parse(text);if(!definition||typeof definition!=='object'||Array.isArray(definition))throw Error('Catalog file must contain a definition object.');
                event.target.form.elements.definition.value=JSON.stringify(definition,null,2);status('JSON imported locally only. Review source and version before explicitly saving a draft.');
            }catch(error){if(valid())status(error.message,true);}
        });
        root.addEventListener('click',event=>{
            if(!valid()||state.busy)return;const b=event.target.closest('button');if(!b)return;
            if(b.hasAttribute('data-commerce-refresh')){
                if (dirty()) { status('Your draft is retained. Finish editing before retrying synchronization.',true); return; }
                if(state.sync)state.sync.request('retry',{force:true});else load();
            }
            if(b.hasAttribute('data-commerce-discard-attempt')&&global.confirm('Discard only the interrupted retry? Your form stays available; review server records before another action.')){state.attempt=null;state.attemptEndpoint=null;status('Interrupted retry discarded. Your form is retained.');}
            if(b.hasAttribute('data-commerce-discard-draft')){
                if(state.attempt){status('Retry or explicitly discard the interrupted action before discarding the quote draft.',true);return;}
                if(!global.confirm('Discard this unsaved quote scope and load current choices? Saved quotes are not changed.'))return;
                options.onDraftDiscard?.();options.draft=null;state.draftBlocked=false;state.dirty=false;state.edits++;state.rows=1;load();
            }
            if(b.hasAttribute('data-commerce-add')){if(state.rows>=30){status('Maximum 30 service lines.',true);return;}state.rows++;rows();}
            if(b.hasAttribute('data-commerce-remove')){if(state.rows===1){status('At least one service line is required.',true);return;}b.closest('[data-commerce-line]').remove();state.rows--;[...root.querySelectorAll('[data-commerce-line] legend')].forEach((el,i)=>el.textContent='Service line '+(i+1));}
            if(b.dataset.commerceQuote){state.current=state.data.quotes.find(q=>q.quote_id===b.dataset.commerceQuote);review();}
            if(b.dataset.commerceLead)options.openLead(b.dataset.commerceLead);
            if(b.hasAttribute('data-commerce-submit'))write({action:'submit',quoteId:state.current.quote_id});
            if(b.hasAttribute('data-commerce-agreement'))write({action:state.data.agreements.some(a=>a.quote_id===state.current.quote_id)?'agreement_link':'agreement',quoteId:state.current.quote_id});
            if(b.dataset.commerceCheckout)write({action:'checkout',quoteId:state.current.quote_id,kind:b.dataset.commerceCheckout});
            if(b.dataset.commerceVerify)write({action:'refresh_payment',checkoutId:b.dataset.commerceVerify});
            if(b.dataset.commerceExpire)write({action:'expire_checkout',checkoutId:b.dataset.commerceExpire});
        });
        root.addEventListener('submit',event=>{
            const form=event.target.closest('[data-commerce-create],[data-commerce-approve],[data-commerce-catalog-action],[data-commerce-refund]');if(!form||!valid())return;event.preventDefault();event.stopPropagation();
            if(state.busy)return;
            try {
                if(form.hasAttribute('data-commerce-refund')){
                    if(!admin()||!form.elements.authorized.checked)throw Error('Explicit management refund authorization required.');
                    const amountCents=Number(form.elements.amountCents.value),reference=form.elements.evidence.value.trim();
                    if(!Number.isSafeInteger(amountCents)||amountCents<1||!reference)throw Error('Enter exact approved positive cents and refund evidence.');
                    write({action:'refund',checkoutId:form.elements.checkoutId.value,amountCents,evidence:{reference}});
                }else if(form.hasAttribute('data-commerce-catalog-action')){
                    if(!admin())throw Error('Administrator required for catalog configuration.');
                    const values=Object.fromEntries(new FormData(form)),body={...values,action:form.dataset.commerceCatalogAction};delete body.catalogFile;
                    if(body.action==='publish'&&(!form.elements.publishConfirmed.checked||String(body.approvalEvidence||'').trim().length<3))throw Error('Explicit publication confirmation and management approval evidence are required.');
                    delete body.publishConfirmed;
                    if(body.action==='create_draft'){body.definition=JSON.parse(body.definition);if(!body.definition||typeof body.definition!=='object'||Array.isArray(body.definition))throw Error('Provide a catalog definition object.');if(!body.sourceEvidence.trim())throw Error('Source evidence is required.');body.sourceEvidence={reference:body.sourceEvidence};}
                    write(body,'field-sales-catalog');
                }else if(form.matches('[data-commerce-create]')){
                    if(state.draftBlocked)throw Error('Pricing configuration changed. Explicitly discard the retained quote draft before creating a new one.');
                    const lines=[...form.querySelectorAll('[data-commerce-line]')].map(row=>{
                        const [serviceId,offerId]=row.querySelector('[data-commerce-offer]').value.split(':');
                        return {serviceId,offerId,quantity:Number(row.querySelector('[name="quantity"]').value),options:[...row.querySelectorAll('[data-option]:checked')].map(el=>el.value),
                            answers:Object.fromEntries([...row.querySelectorAll('[data-q]')].map(el=>[el.dataset.q,el.type==='number'&&el.value!==''?Number(el.value):el.value])),
                            exceptionNote:row.querySelector('[name="exceptionNote"]').value};
                    });write({action:'quote',catalogId:form.elements.catalogId.value,lines});
                }else{
                    const action=event.submitter?.value||'approve',body={action,quoteId:state.current.quote_id,reason:form.elements.reason.value};
                    if(action==='approve'){body.scopeConfirmation=form.elements.scopeConfirmation.value;const value=form.elements.amount.value.trim();
                        if(value){if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw Error('Use USD with at most two decimal places.');const [whole,fraction='']=value.split('.');body.amountCents=Number(whole)*100+Number(fraction.padEnd(2,'0'));}}
                    write(body);
                }
            }catch(error){status(error.message,true);}
        });
        root.addEventListener('input',event=>{if(event.target.closest('form')){state.dirty=true;state.edits++;}},{signal:state.controller.signal});
        state.sync=global.H2SDataSync?.register({id:'field-commerce',isActive:()=>valid()&&root.isConnected&&root.closest('.pane')?.classList.contains('active'),
            isDirty:dirty,refresh:()=>load(true),onState:s=>{if(!state.attempt)global.H2SDataSync.feedback(root,'[data-commerce-status]',s,()=>state.sync.request('retry',{force:true}));}});
        if(state.sync)state.sync.request('mount',{force:true});else load();
    }
    global.H2SFieldCommerce={mount,reset,captureDraft,canLeave};
})(window);
