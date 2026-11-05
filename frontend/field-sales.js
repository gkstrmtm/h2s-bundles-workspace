(function (global) {
    'use strict';
    const apiRoot = base => String(base).replace(/\/+$/,'').replace(/\/api$/i,'') + '/api';
    const root = document.createElement('section'), nav = document.createElement('button');
    root.id = 'field-sales-pane'; root.className = 'pane field-sales'; root.setAttribute('aria-label', 'Field Sales');
    nav.type = 'button'; nav.className = 'app-sidebar-nav-item'; nav.dataset.tab = 'fieldsales'; nav.textContent = 'Field Sales'; nav.hidden = true;
    document.querySelector('#h2s-app .app-content').append(root);
    const adminNav = document.querySelector('.app-sidebar-group[data-group-id="admin"] .app-sidebar-group-items');
    adminNav?.append(nav);
    const style = document.createElement('link'); style.rel = 'stylesheet';
    style.href = global.__h2sResolveDashSiblingAsset?.('field-sales.css') || './field-sales.css'; document.head.append(style);
    const workflowStyle = document.createElement('link'); workflowStyle.rel = 'stylesheet';
    workflowStyle.href = global.__h2sResolveDashSiblingAsset?.('field-workflow.css') || './field-workflow.css'; document.head.append(workflowStyle);
    let options, data, detail, mode = 'dashboard', token = '', version = 0, controller, attempt, busy = false, preparing = false, quoteLead = null, assessmentDraft = {};
    const urls = new Set(), hiddenNav = new Map();
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const session = () => options?.getSession();
    const allowed = () => ['ADMIN', 'SALES'].includes(session()?.role) && !!session()?.token;
    const admin = () => session()?.role === 'ADMIN';
    const label = value => ({new:'New prospect',assessing:'Assessment in progress',ready_for_review:'Awaiting review',reviewed:'Assessment reviewed',needs_information:'More information needed',closed:'Closed'}[value] || 'Review needed');
    const serviceName = id => data.services.find(service => service.service_id === id)?.definition.label || 'Service unavailable';
    const identityNames = () => ({
        customerNames: Object.fromEntries((data?.opportunities || []).map(row=>[row.lead_id,row.full_name])),
        representativeNames: Object.fromEntries((data?.representatives || []).map(rep=>[rep.user_id,rep.display_name]))
    });
    const primaryMode = () => ['new','detail','opportunities'].includes(mode) ? 'opportunities' : ['commerce','quotes'].includes(mode) ? 'quotes' : mode === 'performance' ? 'commissions' : mode;
    const date = value => value ? new Date(value).toLocaleString() : 'Not set';
    const inputDate = value => {
        if (!value) return '';
        const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    const instant = value => value ? new Date(value).toISOString() : null;
    function release() { for (const url of urls) global.URL.revokeObjectURL(url); urls.clear(); }
    function reset() {
        global.H2SFieldCommerce?.reset();
        global.H2SFieldWorkflow?.reset();
        global.H2SFieldEarnings?.reset();
        ++version; controller?.abort(); release(); data = detail = attempt = quoteLead = null; busy = preparing = false; mode = 'dashboard'; token = ''; root.replaceChildren(); nav.hidden = true;
        delete document.getElementById('h2s-app').dataset.fieldSales;
        for (const [element, hidden] of hiddenNav) element.hidden = hidden; hiddenNav.clear();
    }
    function status(message, error = false) {
        let target = root.querySelector('[data-sales-status]');
        if (!target) { target = document.createElement('p'); target.dataset.salesStatus = ''; root.append(target); }
        target.textContent = message; target.setAttribute('role', error ? 'alert' : 'status');
    }
    async function request(path, body) {
        if (!allowed()) { reset(); throw new Error('Sign in to Field Sales.'); }
        const started = session().token, startedRole=session().role, generation = version;
        const response = await global.fetch(`${apiRoot(options.apiBase)}/${path}`, { method: body ? 'POST' : 'GET', cache: 'no-store',
            signal: controller?.signal, referrerPolicy: 'no-referrer',
            headers: { Authorization: `Bearer ${started}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}) });
        if (generation !== version || session()?.token !== started || session()?.role !== startedRole) { if(generation===version)reset(); throw new Error('Session changed; private response discarded.'); }
        if (response.status === 401 || response.status === 403) {
            reset(); status('Access ended. Sign in again or contact management.', true); throw new Error('Access ended. Sign in again or contact management.');
        }
        return response;
    }
    async function json(path, body) {
        const started = session()?.token, startedRole=session()?.role, generation = version;
        const response = await request(path, body), result = await response.json();
        if (generation !== version || session()?.token !== started || session()?.role!==startedRole || !allowed()) { if(generation===version)reset(); throw new Error('Session changed; private response discarded.'); }
        if (!response.ok || !result.ok) throw new Error(result.error || 'Field Sales request failed.');
        return result;
    }
    function representatives(selected) {
        return (data.representatives || []).filter(rep => rep.active).map(rep =>
            `<option value="${esc(rep.user_id)}"${selected === rep.user_id ? ' selected' : ''}>${esc(rep.display_name)}</option>`).join('');
    }
    function interests(selected = [], market = 'residential') {
        const rank = service => /tv|television/i.test(service.definition.label) ? 0 : /camera|security/i.test(service.definition.label) ? 1 : 2;
        return [...data.services].sort((a,b) => rank(a)-rank(b)).map(service => {
            const available = service.definition.markets.includes(market);
            return `<label class="field-sales__service"${available ? '' : ' hidden'}><input type="checkbox" name="services" value="${esc(service.service_id)}"${selected.includes(service.service_id) ? ' checked' : ''}${available ? '' : ' disabled'}><span><strong>${esc(service.definition.label)}</strong><small>${rank(service) < 2 ? 'Popular service · ' : ''}Select to assess equipment and installation</small></span></label>`;
        }).join('');
    }
    function render() {
        global.H2SFieldCommerce?.reset();
        global.H2SFieldWorkflow?.reset();
        global.H2SFieldEarnings?.reset();
        release(); assessmentDraft = {};
        root.innerHTML = `<header class="field-sales__header"><div><span class="field-sales__eyebrow">Home2Smart</span><h2>${admin() ? 'Field Sales management' : 'Field Sales'}</h2></div><div class="field-sales__toolbar"><button type="button" data-sales-refresh>Refresh</button>${!admin() ? '<button type="button" data-sales-logout>Sign out</button>' : ''}</div></header>
            <nav class="field-sales__nav" aria-label="Field Sales views">${[['dashboard', 'Home'], ['opportunities', 'Leads'], ['quotes', 'Quotes'], ['orders','Orders'], ['commissions','Earnings']]
                .map(([id, title]) => `<button type="button" data-sales-mode="${id}" aria-pressed="${primaryMode() === id}"${primaryMode() === id ? ' aria-current="page"' : ''}>${title}</button>`).join('')}</nav>
            ${admin() ? `<nav class="field-sales__management-nav" aria-label="Management views">${[['representatives','Representatives'],['transactions','Quotes & Payments'],['performance','Performance']].map(([id,title])=>`<button type="button" data-sales-mode="${id}" aria-pressed="${mode===id}">${title}</button>`).join('')}</nav>` : ''}
            <p data-sales-status role="status" aria-live="polite"></p><div data-sales-content></div>`;
        if (!data) return;
        if (!data.enabled) { status('Field Sales is disabled. No accounts or customer records can be changed.'); return; }
        const content = root.querySelector('[data-sales-content]');
        if(!admin()&&data.commissionProfile&&['dashboard','commissions','performance'].includes(mode)){
            const profile=data.commissionProfile;
            content.insertAdjacentHTML('afterend',`<details class="field-sales__note"><summary>My commission terms</summary><p>My approved commission start: ${esc(profile.commission_start_date||'Awaiting management review')} / terms revision ${esc(profile.commission_terms_revision??0)}. Contact management to review your terms.</p></details>`);
        }
        if (mode === 'orders') {
            content.innerHTML = '<div data-sales-workflow></div>';
            const target = content.querySelector('[data-sales-workflow]');
            if (global.H2SFieldWorkflow) global.H2SFieldWorkflow.mount(target, {apiBase:options.apiBase,getSession:session,onSessionEnded:reset,...identityNames()});
            else target.textContent = 'Order workflow module unavailable. No readiness, payment or installation is assumed.';
        } else if (['performance','commissions'].includes(mode)) {
            content.innerHTML = '<div data-sales-earnings></div>';
            const target = content.querySelector('[data-sales-earnings]');
            if (global.H2SFieldEarnings) global.H2SFieldEarnings.mount(target, {apiBase:options.apiBase,getSession:session,view:mode,onSessionEnded:reset,...identityNames()});
            else target.textContent = 'Earnings module unavailable. No commission or settlement is assumed.';
        } else if (mode === 'transactions' && admin()) {
            content.innerHTML = '<div data-sales-commerce></div>';
            commerce(content.querySelector('[data-sales-commerce]'), null);
        } else if (mode === 'quotes' || mode === 'commerce') {
            const leads = data.opportunities || [];
            content.innerHTML = `<div class="field-sales__section"><h3>Customer quotes</h3><p>Choose an assigned lead to build or review their quote.</p>
                <label>Customer<select data-sales-quote-lead><option value="">Choose an existing lead</option>${leads.map(row=>`<option value="${esc(row.lead_id)}"${quoteLead===row.lead_id?' selected':''}>${esc(row.full_name)}${row.address?' · '+esc(row.address):''}</option>`).join('')}</select></label>
                ${!leads.length ? '<div class="field-sales__empty"><p>No assigned leads yet.</p><button type="button" data-sales-mode="new">Add a prospect</button></div>' : ''}
                <div data-sales-quote-builder></div></div>`;
            if (quoteLead && leads.some(row=>row.lead_id===quoteLead)) {
                const selectedLead = leads.find(row=>row.lead_id===quoteLead), target = content.querySelector('[data-sales-quote-builder]');
                target.dataset.market = selectedLead.market;
                commerce(target, quoteLead);
            } else quoteLead = null;
        } else if (mode === 'new') {
            content.innerHTML = `<div class="field-sales__toolbar"><button type="button" data-sales-mode="opportunities">Back to leads</button></div><h3>New prospect</h3><p>Start with the customer and property. Assess selected services after saving.</p><form data-sales-form="create" class="field-sales__form">
                <fieldset class="field-sales__wide field-sales__form"><legend>1 · Customer & property</legend>
                <label>Customer name<input name="fullName" required maxlength="120" autocomplete="name"></label>
                <label>Phone<input name="phone" type="tel" required maxlength="40" autocomplete="tel"></label>
                <label class="field-sales__wide">Property address<input name="address" required maxlength="500" autocomplete="street-address"></label>
                <label>City<input name="city" required maxlength="120" autocomplete="address-level2"></label>
                <label>Property type<select name="market"><option value="residential">Residential</option><option value="commercial">Commercial</option></select></label>
                ${admin() ? `<label>Assigned representative<select name="ownerId" required><option value="">Choose representative</option>${representatives()}</select></label>` : ''}</fieldset>
                <fieldset class="field-sales__wide"><legend>2 · Service interests</legend><p>Select all that apply. Only selected services need an assessment.</p><div class="field-sales__services">${interests()}</div></fieldset>
                <fieldset class="field-sales__wide field-sales__form"><legend>3 · Next contact</legend>
                <label class="field-sales__wide">Notes<textarea name="notes" maxlength="2000"></textarea></label>
                <label>Follow-up (device timezone)<input type="datetime-local" name="followUpAt"></label></fieldset><div class="field-sales__wide field-sales__toolbar"><button type="submit" class="field-sales__primary">Save & continue to assessment</button></div></form>
                ${admin() ? `<details><summary>Link a verified existing Customer Queue inquiry</summary><p>Verify the exact lead ID and source evidence. Names or phone similarity do not prove identity.</p>
                <form data-sales-form="attach" class="field-sales__form"><label>Existing lead UUID<input name="leadId" required></label>
                <label>Representative<select name="ownerId" required><option value="">Choose</option>${representatives()}</select></label>
                <label class="field-sales__wide">Identity verification evidence<textarea name="evidence" required maxlength="2000"></textarea></label>
                <button type="submit">Link existing inquiry</button></form></details>` : ''}`;
        } else if (mode === 'representatives' && admin()) {
            content.innerHTML = `<h3>Representative accounts</h3><p>New accounts are disabled. Creation does not enroll a representative for login.</p>
                ${(data.representatives || []).map(rep => `<article><strong>${esc(rep.display_name)}</strong> / ${esc(rep.username)} / ${rep.active ? 'active' : 'disabled'}
                <button type="button" data-rep-state="${esc(rep.user_id)}" data-active="${!rep.active}">${rep.active ? 'Disable and revoke sessions' : 'Explicitly enable account'}</button>
                <p>Approved commission start: ${esc(rep.commission_start_date || 'Not configured — tenure review required')} / ${esc(rep.commission_start_evidence || 'Evidence pending')}</p>
                <details><summary>Representative commission terms</summary><form data-sales-form="representative_terms" class="field-sales__form">
                    <input type="hidden" name="userId" value="${esc(rep.user_id)}"><input type="hidden" name="termsRevision" value="${esc(rep.commission_terms_revision ?? 0)}">
                    <label>Approved commission start date (blank explicitly unsets tenure)<input name="commissionStartDate" type="date" value="${esc(rep.commission_start_date || '')}"></label>
                    <label class="field-sales__wide">Start-event approval evidence<textarea name="commissionStartEvidence" required maxlength="2000">${esc(rep.commission_start_evidence || '')}</textarea></label>
                    <button type="submit">Record approved representative terms</button></form></details></article>`).join('')}
                <form data-sales-form="account_create" class="field-sales__form"><label>Display name<input name="displayName" required maxlength="120"></label>
                <label>Username (letters/digits)<input name="username" required pattern="[A-Za-z][A-Za-z0-9]{2,31}"></label>
                <label class="field-sales__wide">Temporary credential: save securely before creating; never share a session token<input name="pin" readonly value="${esc(global.crypto.randomUUID().replaceAll('-', ''))}"></label>
                <button type="submit">Create disabled representative</button></form>`;
        } else if (mode === 'detail' && detail) {
            const op = detail.opportunity, consent = op.photo_consent;
            const selected = data.services.filter(service => op.services.includes(service.service_id));
            const required = selected.flatMap(service => service.definition.questions.filter(question => question.required)
                .map(question => op.assessments[service.service_id]?.answers?.[question.id]));
            const expectedPhotos = selected.flatMap(service => service.definition.photos.map(label =>
                detail.photos.some(photo => photo.service_id === service.service_id && photo.label === label && photo.state === 'ready')));
            content.innerHTML = `<div class="field-sales__toolbar"><button type="button" data-sales-mode="opportunities">Back to leads</button><button type="button" data-sales-build-quote="${esc(op.lead_id)}">Open customer quotes</button></div>
                <h3>${esc(detail.lead.full_name)}</h3><p>${esc(detail.lead.phone)} · ${esc(detail.lead.project_address)} · ${esc(detail.lead.project_city)}</p>
                <span class="field-sales__badge">${esc(label(op.status))}</span>
                ${admin() ? `<details><summary>Identity & ownership audit</summary><p class="field-sales__id">Shared lead ${esc(op.lead_id)} / ${esc(op.status)} / revision ${esc(op.revision)}</p>
                <p>Original representative: ${esc(op.originating_user_id || 'Historical origin unverified')} / creator ${esc(op.created_by || 'Unverified')} / current owner ${esc(op.owner_user_id)}. Reassignment does not rewrite original identity or approved commission credit.</p></details>` : ''}
                <p class="field-sales__note">Assessment progress: ${required.filter(answer => answer !== undefined && answer !== '').length}/${required.length} required answers;
                    ${expectedPhotos.filter(Boolean).length}/${expectedPhotos.length} requested photo labels have ready evidence.</p>
                <form data-sales-form="save" class="field-sales__form"><fieldset class="field-sales__wide"><legend>1 · Selected services</legend><div class="field-sales__services">${interests(op.services, detail.lead.attribution.market)}</div></fieldset>
                <div data-sales-questions class="field-sales__wide"></div>
                <fieldset class="field-sales__wide field-sales__form"><legend>3 · Notes & photo permission</legend>
                <label class="field-sales__wide">Assessment / follow-up notes<textarea name="notes" maxlength="2000">${esc(op.notes)}</textarea></label>
                <label>Follow-up (device timezone)<input type="datetime-local" name="followUpAt" value="${esc(inputDate(detail.followUpAt))}"></label>
                <label class="field-sales__check"><input type="checkbox" name="photoConsent"${consent ? ' checked' : ''}>Customer permits assessment photographs</label>
                <label class="field-sales__wide">Photo permission evidence / customer statement<textarea name="consentNote" maxlength="1000">${esc(op.consent_note)}</textarea></label></fieldset>
                <div class="field-sales__wide field-sales__toolbar"><button type="submit" name="submit" value="false">Save assessment draft</button><button type="submit" name="submit" value="true" class="field-sales__primary">Submit for management review</button></div></form>
                <h3>Property photographs</h3><p>Save permission first. Photos stay private. Missing photos require management review, not invented evidence.</p>
                <form data-sales-form="photo" class="field-sales__form"><label>Service<select name="serviceId">${data.services.filter(s => op.services.includes(s.service_id)).map(s => `<option value="${esc(s.service_id)}">${esc(s.definition.label)}</option>`).join('')}</select></label>
                <label>Photo label<select name="label"></select></label>
                <label>Photograph<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required></label><button type="submit"${consent ? '' : ' disabled'}>Upload labeled photo</button></form>
                <div data-sales-photos>${detail.photos.map(p => `<article>${esc(serviceName(p.service_id))} · ${esc(p.label)} · ${p.state === 'ready' ? 'Ready' : 'Processing or review needed'}
                    ${consent && p.state === 'ready' ? `<button type="button" data-sales-photo="${esc(p.file_id)}">View private photo</button>` : ''}</article>`).join('')}</div>
                ${admin() ? `<h3>Management review and ownership</h3><form data-sales-form="review" class="field-sales__form"><label>Review status<select name="status"><option value="reviewed">Reviewed (not quote approved)</option><option value="needs_information">Needs information</option><option value="closed">Closed</option></select></label>
                <label>Review reason<textarea name="note" required maxlength="2000"></textarea></label><button type="submit">Record management review</button></form>
                <form data-sales-form="assign" class="field-sales__form"><label>Reassign representative<select name="ownerId" required>${representatives(op.owner_user_id)}</select></label>
                <label>Reassignment reason<textarea name="note" required maxlength="2000"></textarea></label><button type="submit">Confirm reassignment</button></form>` : ''}
                ${admin() ? `<details><summary>Prospect audit history</summary>${detail.history.map(event => `<article>${esc(date(event.created_at))} / ${esc(event.actor_name)} / ${esc(event.action)}
                    <pre>${esc(JSON.stringify(event.payload, null, 2))}</pre></article>`).join('') || '<p>No recorded activity.</p>'}</details>` : ''}`;
            questions(); photoLabels();
            if (!admin() && op.status === 'closed') {
                content.querySelectorAll('form :is(input,select,textarea,button)').forEach(control => { control.disabled = true; });
                status('Closed opportunity. Contact management before changing this assessment.');
            }
            if (op.services.some(id => !data.services.some(service => service.service_id === id))) {
                status('A selected service is unavailable. Management must review its configuration before this assessment can be saved.', true);
                content.querySelectorAll('form[data-sales-form="save"] button, form[data-sales-form="photo"] button').forEach(button => { button.disabled = true; });
            }
        } else {
            const rows = data.opportunities || [], due = rows.filter(row => row.follow_up_at && Date.parse(row.follow_up_at) <= Date.now() && row.status !== 'closed');
            const active = rows.filter(row=>row.status !== 'closed'), followUpsToday = rows.filter(row=>row.follow_up_at && new Date(row.follow_up_at).toDateString()===new Date().toDateString() && row.status!=='closed');
            content.innerHTML = `<div class="field-sales__toolbar field-sales__section-heading"><h3>${mode==='dashboard' ? (admin() ? 'Sales overview' : 'Your day in sales') : 'Customer leads'}</h3><button type="button" data-sales-mode="new" class="field-sales__primary">New prospect</button></div>
                ${mode==='dashboard' ? `<div class="field-sales__summary" aria-label="Loaded lead activity">
                    ${[[active.length,'Active opportunities'],[due.length,'Follow-ups due'],[followUpsToday.length,'Follow-ups today'],[rows.filter(row=>row.status==='ready_for_review').length,'Awaiting review']].map(([value,title])=>`<div class="field-sales__metric"><strong>${value}</strong><span>${title}</span></div>`).join('')}</div>` : ''}
                <p class="field-sales__note">${rows.length} of ${esc(data.total ?? rows.length)} assigned leads loaded. ${data.total > rows.length ? 'Activity counts cover only the latest loaded leads, not your complete history.' : 'Activity counts reflect your current loaded leads.'}</p>
                ${mode === 'dashboard' ? `<section class="field-sales__section"><h4>Follow-ups to make</h4>${due.map(row => `<div class="field-sales__followup"><button type="button" data-sales-lead="${esc(row.lead_id)}">${esc(row.full_name)}</button><span>${esc(date(row.follow_up_at))}</span></div>`).join('') || '<p class="field-sales__empty">You have no overdue follow-ups in loaded leads.</p>'}</section>` : ''}
                <div class="field-sales__toolbar"><label class="field-sales__search">Find a lead<input type="search" data-sales-search placeholder="Customer, phone or address" autocomplete="off"></label>
                ${admin() ? `<label>Representative<select data-sales-owner><option value="">All representatives</option>${(data.representatives || []).map(rep => `<option value="${esc(rep.user_id)}">${esc(rep.display_name)}</option>`).join('')}</select></label>` : ''}</div>
                <div data-sales-list>${rows.map(row => `<article data-owner="${esc(row.owner_user_id)}" data-search="${esc([row.full_name,row.phone,row.address].join(' ').toLowerCase())}"><div class="field-sales__record-heading"><button type="button" data-sales-lead="${esc(row.lead_id)}">${esc(row.full_name)}</button><span class="field-sales__badge">${esc(label(row.status))}</span></div>
                <p>${esc(row.phone)} · ${esc(row.address)} · ${row.market==='commercial'?'Commercial':'Residential'}</p><p>${esc(row.services.map(serviceName).join(' · ') || 'Service interests not selected')}</p>
                <p class="field-sales__note">Next contact: ${esc(date(row.follow_up_at))}</p></article>`).join('') || '<div class="field-sales__empty"><h4>Your next customer starts here</h4><p>Add a prospect, or ask management to assign an existing inquiry.</p></div>'}</div><p data-sales-no-results hidden>No leads match these filters.</p>`;
        }
        global.h2sInitDateInputs?.();
    }
    function commerce(target, leadId) {
        if (!global.H2SFieldCommerce) { target.textContent = 'Quote/payment module unavailable. Assessment remains available.'; return; }
        global.H2SFieldCommerce.mount(target, { apiBase: options.apiBase, getSession: session, leadId, ...identityNames(),
            openLead: id => load(id), onSessionEnded: () => reset() });
    }
    function questions() {
        const target = root.querySelector('[data-sales-questions]'); if (!target) return;
        const selected = [...root.querySelectorAll('[name="services"]:checked')].map(el => el.value), previous = assessmentDraft;
        for (const el of target.querySelectorAll('[data-question]')) previous[el.dataset.service + ':' + el.dataset.question] = el.value;
        target.innerHTML = `<h4>2 · Service assessment</h4>${selected.length ? '' : '<p class="field-sales__empty">Choose a service above to see its assessment.</p>'}` + data.services.filter(s => selected.includes(s.service_id)).map(s => `<fieldset><legend>${esc(s.definition.label)}</legend>
            ${s.definition.questions.map(q => {
                const value = previous[s.service_id + ':' + q.id] ?? detail.opportunity.assessments[s.service_id]?.answers?.[q.id] ?? '';
                const attrs = `data-service="${esc(s.service_id)}" data-question="${esc(q.id)}"`;
                return `<label>${esc(q.label)}${q.required ? ' (required for submission)' : ''}${q.type === 'select'
                    ? `<select ${attrs}><option value="">Choose</option>${q.options.map(option => `<option${option === value ? ' selected' : ''}>${esc(option)}</option>`).join('')}</select>`
                    : `<input ${attrs} type="${q.type === 'number' ? 'number' : 'text'}"${q.type === 'number' ? ` min="${esc(q.min ?? 0)}" max="${esc(q.max ?? 100000)}"` : ' maxlength="2000"'} value="${esc(value)}">`}</label>`;
            }).join('')}<p>Requested photo evidence: ${esc(s.definition.photos.join('; '))}. Missing evidence stays visible for management review.</p></fieldset>`).join('');
    }
    function photoLabels() {
        const form = root.querySelector('[data-sales-form="photo"]'); if (!form) return;
        const service = data.services.find(s => s.service_id === form.elements.serviceId.value);
        form.elements.label.innerHTML = (service?.definition.photos || []).map(label => `<option>${esc(label)}</option>`).join('');
    }
    async function load(leadId) {
        if (!allowed()) { reset(); return; }
        if (token && token !== session().token) reset();
        token = session().token; const id = ++version; controller?.abort(); controller = new AbortController();
        data = detail = null; render(); status('Loading assigned Field Sales records...');
        try {
            const result = await json('field-sales'); if (id !== version) return; data = result;
            if (leadId && result.enabled) { const record = await json(`field-sales?leadId=${encodeURIComponent(leadId)}`); if (id !== version) return; detail = record; mode = 'detail'; }
            render();
        } catch (error) { console.error('Field Sales read failed.'); if (id === version) { data = detail = null; render(); status(error.message, true); } }
    }
    async function write(path, body) {
        if (busy) return null;
        const generation = version;
        busy = true;
        if (!attempt) attempt = { path, body: { ...body, operationId: global.crypto.randomUUID() } };
        status('Saving securely. If interrupted, retry this same action.');
        try { const result = await json(attempt.path, attempt.body); attempt = null; return result; }
        catch (error) { console.error('Field Sales save failed.'); if (generation === version) status(`${error.message} Your form is retained. Retry this action, or refresh before starting a different action.`, true); return null; }
        finally { if (generation === version) busy = false; }
    }
    async function preparePhoto(file) {
        if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) throw new Error('Choose a JPEG, PNG or WebP under 20 MB.');
        const image = await global.createImageBitmap(file), canvas = document.createElement('canvas');
        const scale = Math.min(1, 1600 / Math.max(image.width, image.height)); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
        try { canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); return canvas.toDataURL('image/jpeg', .82); }
        finally { image.close(); }
    }
    root.addEventListener('change', event => {
        if (event.target.name === 'services') questions();
        if (event.target.name === 'market') {
            for (const input of root.querySelectorAll('[name="services"]')) {
                const available = data.services.find(service => service.service_id === input.value).definition.markets.includes(event.target.value);
                input.disabled = !available; input.closest('label').hidden = !available; if (!available) input.checked = false;
            }
        }
        if (event.target.name === 'serviceId') photoLabels();
        if (event.target.matches('[data-sales-owner]')) filterLeads();
        if (event.target.matches('[data-sales-quote-lead]')) {
            quoteLead = event.target.value || null;
            const target = root.querySelector('[data-sales-quote-builder]'), lead = data.opportunities.find(row=>row.lead_id===quoteLead);
            global.H2SFieldCommerce?.reset(); target.replaceChildren();
            if (lead) { target.dataset.market = lead.market; commerce(target, quoteLead); }
        }
    });
    function filterLeads() {
        const search = root.querySelector('[data-sales-search]')?.value.trim().toLowerCase() || '', owner = root.querySelector('[data-sales-owner]')?.value || '';
        const rows = [...root.querySelectorAll('[data-sales-list] article')];
        for (const row of rows) row.hidden = (!!owner && row.dataset.owner !== owner) || !row.dataset.search.includes(search);
        const empty = root.querySelector('[data-sales-no-results]'); if (empty) empty.hidden = !rows.length || rows.some(row=>!row.hidden);
    }
    root.addEventListener('input', event=>{ if(event.target.matches('[data-sales-search]')) filterLeads(); });
    root.addEventListener('submit', async event => {
        const form = event.target.closest('[data-sales-form]'); if (!form) return; event.preventDefault();
        if (busy || preparing) return;
        const generation = version, started = session()?.token;
        try {
            const action = form.dataset.salesForm, values = Object.fromEntries(new FormData(form)), body = { ...values, action };
            if (['create', 'save'].includes(action)) { body.services = [...form.querySelectorAll('[name="services"]:checked')].map(el => el.value); body.followUpAt = instant(values.followUpAt); }
            let path = 'field-sales';
            if (action === 'save') {
                Object.assign(body, { leadId: detail.opportunity.lead_id, revision: detail.opportunity.revision,
                    photoConsent: form.elements.photoConsent.checked, submit: event.submitter?.value === 'true', answers: {} });
                for (const el of form.querySelectorAll('[data-question]')) { (body.answers[el.dataset.service] ||= {})[el.dataset.question] = el.type === 'number' && el.value !== '' ? Number(el.value) : el.value; }
            }
            if (['assign', 'review'].includes(action)) Object.assign(body, { leadId: detail.opportunity.lead_id, revision: detail.opportunity.revision });
            if (action === 'representative_terms') {body.termsRevision = Number(values.termsRevision);body.commissionStartDate=values.commissionStartDate||null;}
            if (action === 'photo') {
                preparing = true; path = 'field-sales-photos'; body.leadId = detail.opportunity.lead_id; body.filename = 'assessment.jpg';
                body.data = attempt?.path === path ? attempt.body.data : await preparePhoto(form.elements.photo.files[0]); delete body.photo;
                if (generation !== version || session()?.token !== started || !allowed()) return;
            }
            preparing = false;
            const result = await write(path, body);
            if (result) { const lead = result.leadId || (detail?.opportunity.lead_id); if (action === 'account_create') { status('Disabled account created. Save the temporary credential securely before Refresh; it is not recoverable. Refresh to enable explicitly.'); form.querySelector('button').disabled = true; await refreshRepresentatives(); } else await load(lead); }
        } catch (error) { if (generation === version) status(error.message, true); }
        finally { if (generation === version) preparing = false; }
    });
    async function refreshRepresentatives() { const fresh = await json('field-sales'); data = fresh; }
    root.addEventListener('click', async event => {
        const button = event.target.closest('button'); if (!button) return;
        if (button.hasAttribute('data-sales-logout')) { options.onLogout(); return; }
        if (busy || preparing) return;
        try {
            if (button.hasAttribute('data-sales-refresh')) { attempt = null; await load(detail?.opportunity.lead_id); }
            if (button.dataset.salesMode) { mode = button.dataset.salesMode; detail = null; attempt = null; await load(); }
            if (button.dataset.salesBuildQuote) { quoteLead = button.dataset.salesBuildQuote; mode = 'quotes'; detail = null; attempt = null; await load(); }
            if (button.dataset.salesLead) { attempt = null; await load(button.dataset.salesLead); }
            if (button.dataset.repState) { const result = await write('field-sales', { action: 'account_state', userId: button.dataset.repState, active: button.dataset.active === 'true' }); if (result) await load(); }
            if (button.dataset.salesPhoto) {
                const generation = version, started = session()?.token;
                const response = await request(`field-sales-photos?leadId=${encodeURIComponent(detail.opportunity.lead_id)}&photoId=${encodeURIComponent(button.dataset.salesPhoto)}`);
                if (!response.ok) throw new Error('Private photo access failed.');
                const blob = await response.blob(); if (!allowed() || generation !== version || session()?.token !== started) return;
                const url = global.URL.createObjectURL(blob); urls.add(url);
                const img = document.createElement('img'); img.src = url; img.alt = 'Permissioned assessment photograph'; button.parentElement.append(img); button.disabled = true;
            }
        } catch (error) { status(error.message, true); }
    });
    function activateShell() {
        document.querySelectorAll('#h2s-app .pane').forEach(pane => pane.classList.remove('active')); root.classList.add('active');
        if (session().role === 'SALES') document.getElementById('h2s-app').dataset.fieldSales = 'true';
        if (session().role === 'SALES') for (const element of document.querySelectorAll('.app-sidebar-nav-item')) {
            if (element === nav) continue; if (!hiddenNav.has(element)) hiddenNav.set(element, element.hidden); element.hidden = true;
        }
        const title = document.getElementById('currentAreaTitle'); if (title) title.textContent = 'Field Sales';
        nav.hidden = !adminNav || document.body.dataset.salesApp === 'true';
    }
    function activate() {
        if (!allowed()) { reset(); return Promise.resolve(); }
        activateShell();
        return load();
    }
    function navigate(view, leadId) {
        const views = {home:'dashboard',leads:'opportunities',new:'new',quotes:'quotes',orders:'orders',earnings:'commissions',assessment:'detail'};
        if (!Object.hasOwn(views, view) || !allowed()) return Promise.resolve();
        activateShell();
        mode = views[view]; detail = null; attempt = null; quoteLead = view === 'quotes' ? leadId || null : null;
        if (view === 'assessment' && !leadId) mode = 'opportunities';
        return load(view === 'assessment' ? leadId : undefined);
    }
    nav.addEventListener('click', () => { if (session()?.role === 'SALES') activate(); else global.switchToTab('fieldsales'); });
    global.H2SFieldSales = { configure(value) { options = value; nav.hidden = !allowed() || !adminNav || document.body.dataset.salesApp === 'true'; }, open: () => load(), activate, navigate, reset };
})(window);
