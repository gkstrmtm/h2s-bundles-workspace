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
    const urls = new Set(), hiddenNav = new Map(), draftViews = new Map(), quoteDrafts = new Map();
    let renderedKey = null, mountedDirty = false, savedForm = null, actorRole = null, sync = null, editVersion = 0;
    let filters = {search:'',owner:''}, pages = [null], pageIndex = 0, duePages = [null], dueIndex = 0, searchTimer;
    let customerHistory = null, historyPages = [null], historyIndex = 0;
    function listPath(cursor = pages[pageIndex], due = false) {
        const query = new URLSearchParams();
        if (filters.search) query.set('search',filters.search);
        if (filters.owner) query.set('ownerId',filters.owner);
        if (cursor) query.set('cursor',cursor);
        if (due) query.set('due','true');
        else if (mode === 'dashboard') {
            query.set('includeFollowUps','true');
            if (duePages[dueIndex]) query.set('dueCursor',duePages[dueIndex]);
        }
        return 'field-sales' + (query.size ? '?' + query : '');
    }
    const searchControls = () => `<div class="field-sales__toolbar"><label class="field-sales__search">Find a lead<input type="search" data-sales-search value="${esc(filters.search)}" placeholder="Customer, phone or address" autocomplete="off"></label>
        ${admin() ? `<label>Representative<select data-sales-owner><option value="">All representatives</option>${(data.representatives || []).map(rep=>`<option value="${esc(rep.user_id)}"${filters.owner===rep.user_id?' selected':''}>${esc(rep.display_name)}</option>`).join('')}</select></label>` : ''}</div>`;
    function pager(kind,next,total) {
        const index = kind==='due' ? dueIndex : kind==='history' ? historyIndex : pageIndex;
        return `<div class="field-sales__toolbar" role="group" aria-label="${kind==='due'?'Follow-up':kind==='history'?'Customer history':'Lead'} pages"><button type="button" data-sales-page="${kind}" data-direction="-1"${index ? '' : ' disabled'}>Previous</button><span>Page ${index+1} · ${esc(total)} matching opportunities</span><button type="button" data-sales-page="${kind}" data-direction="1"${next?'':' disabled'}>Next</button></div>`;
    }
    const viewKey = () => mode === 'detail' && detail ? `detail:${detail.opportunity.lead_id}` : mode;
    // Keep actual form nodes, including browser-owned FileLists, only in this session's memory.
    function retainDraft() {
        const content = root.querySelector('[data-sales-content]');
        if (content && renderedKey && /^(new|repeat|representatives|detail:)/.test(renderedKey)) {
            draftViews.set(renderedKey, { forms: [...content.querySelectorAll('[data-sales-form]')], answers: assessmentDraft });
        }
    }
    function retainQuoteDraft() {
        const draft = global.H2SFieldCommerce?.captureDraft?.();
        if (draft) quoteDrafts.set(draft.leadId, draft);
    }
    function safeToLeave() {
        if (busy || preparing) { status('Wait for the current save or photo preparation to finish.'); return false; }
        if (attempt) { status('Retry the interrupted save before leaving, or discard that interrupted action explicitly.', true); return false; }
        if (global.H2SFieldCommerce?.canLeave?.() === false) return false;
        if (mountedDirty && !global.confirm('Leave this destination and discard its unsaved changes, including any selected files?')) return false;
        mountedDirty = false;
        retainDraft(); retainQuoteDraft();
        return true;
    }
    const navIcon = id => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${({
        dashboard:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-8H9v8H4a1 1 0 0 1-1-1Z"/>',
        opportunities:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2"/>',
        quotes:'<path d="M6 3h9l4 4v14H6ZM14 3v5h5M9 12h7m-7 4h5"/>',
        orders:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M9 5V3h6v2m-7 8 3 3 5-6"/>',
        commissions:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 10h18m-5 5h2"/>'
    })[id]}</svg>`;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const session = () => options?.getSession();
    const allowed = () => ['ADMIN', 'SALES'].includes(session()?.role) && !!session()?.token;
    const admin = () => session()?.role === 'ADMIN';
    const label = value => ({new:'New prospect',assessing:'Assessment in progress',ready_for_review:'Awaiting review',reviewed:'Assessment reviewed',needs_information:'More information needed',closed:'Closed'}[value] || 'Review needed');
    const leadTone = value => ({ready_for_review:'info',reviewed:'success',needs_information:'attention',closed:'neutral'}[value] || 'neutral');
    const nextContact = value => value ? date(value) : 'Not planned';
    const nextStep = value => ({new:'Start service assessment',assessing:'Continue assessment',ready_for_review:'Await management review',reviewed:'Review assessment & quote',needs_information:'Complete requested details',closed:'Review saved assessment'}[value] || 'Review lead details');
    const chronological = rows => [...rows].sort((a,b) => {
        const closed = Number(a.status === 'closed') - Number(b.status === 'closed');
        const aTime = Date.parse(a.follow_up_at), bTime = Date.parse(b.follow_up_at);
        return closed || (Number.isFinite(aTime) ? aTime : Infinity) - (Number.isFinite(bTime) ? bTime : Infinity)
            || String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
    const representative = id => (data?.representatives || []).find(rep => rep.user_id === id)?.display_name || (!admin()&&id===data?.actor?.userId?'You':'Profile name unavailable');
    const attribution = row => `<div><dt>Originating salesperson</dt><dd>${esc(row.originating_user_id ? representative(row.originating_user_id) : 'Historical origin unverified')}</dd></div><div><dt>Assigned salesperson</dt><dd>${esc(representative(row.owner_user_id))}</dd></div>`;
    const serviceName = id => data.services.find(service => service.service_id === id)?.definition.label || 'Service unavailable';
    const identityNames = () => ({
        customerNames: Object.fromEntries((data?.opportunities || []).map(row=>[row.lead_id,row.full_name])),
        representativeNames: Object.fromEntries((data?.representatives || []).map(rep=>[rep.user_id,rep.display_name]))
    });
    const primaryMode = () => ['new','detail','opportunities'].includes(mode) ? 'opportunities' : ['commerce','quotes'].includes(mode) ? 'quotes' : mode === 'performance' ? 'commissions' : mode;
    // Management groups customer quoting and portfolio payment review without
    // confusing the distinct performance and commission review destinations.
    const managementMode = () => ['new','detail','opportunities'].includes(mode) ? 'opportunities'
        : ['commerce','quotes','transactions'].includes(mode) ? 'transactions' : mode;
    const date = value => value ? new Date(value).toLocaleString() : 'Not set';
    const inputDate = value => {
        if (!value) return '';
        const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    const instant = value => value ? new Date(value).toISOString() : null;
    function release() { for (const url of urls) global.URL.revokeObjectURL(url); urls.clear(); }
    function reset() {
        sync?.destroy(); sync = null;
        clearTimeout(searchTimer); filters={search:'',owner:''}; pages=[null];pageIndex=0;duePages=[null];dueIndex=0;
        customerHistory=null;historyPages=[null];historyIndex=0;
        global.H2SFieldCommerce?.reset();
        global.H2SFieldWorkflow?.reset();
        global.H2SFieldEarnings?.reset();
        ++version; controller?.abort(); release(); draftViews.clear(); quoteDrafts.clear(); renderedKey = savedForm = actorRole = null; assessmentDraft = {}; mountedDirty = false; data = detail = attempt = quoteLead = null; busy = preparing = false; mode = 'dashboard'; token = ''; root.replaceChildren(); nav.hidden = true;
        delete document.getElementById('h2s-app').dataset.fieldSales;
        for (const [element, hidden] of hiddenNav) element.hidden = hidden; hiddenNav.clear();
    }
    function status(message, error = false) {
        let target = root.querySelector('[data-sales-status]');
        if (!target) { target = document.createElement('p'); target.dataset.salesStatus = ''; root.append(target); }
        target.textContent = message; target.setAttribute('role', error ? 'alert' : 'status');
        if (error) {
            const retry = document.createElement('button'); retry.type = 'button';
            retry.textContent = attempt ? 'Discard interrupted action' : 'Retry';
            retry.dataset[attempt ? 'salesDiscardAttempt' : 'salesRetryRead'] = '';
            target.append(' ', retry);
        }
    }
    async function request(path, body) {
        if (!allowed()) { reset(); throw new Error('Sign in to Field Sales.'); }
        const started = session().token, startedRole=session().role, generation = version;
        const response = await global.fetch(`${apiRoot(options.apiBase)}/${path}`, { method: body ? 'POST' : 'GET', cache: 'no-store',
            signal: controller && !body && global.H2SDataSync ? global.H2SDataSync.signal(controller.signal) : controller?.signal, referrerPolicy: 'no-referrer',
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
            const name = service.definition.label;
            const description = service.definition.description || (/tv|television/i.test(name) ? 'Screen size, wall type and mounting location'
                : /camera|security/i.test(name) ? 'Camera locations, coverage and wiring'
                : /network|wi-?fi/i.test(name) ? 'Coverage, connection points and equipment'
                : /doorbell/i.test(name) ? 'Doorway, existing wiring and device'
                : service.definition.questions?.slice(0, 2).map(question => question.label).join(' · ') || `${name} requirements`);
            return `<label class="field-sales__service"${available ? '' : ' hidden'}><input type="checkbox" name="services" aria-label="${esc(name)}" value="${esc(service.service_id)}"${selected.includes(service.service_id) ? ' checked' : ''}${available ? '' : ' disabled'}><span><strong>${esc(name)}</strong><small>${esc(description)}</small></span></label>`;
        }).join('');
    }
    function render() {
        retainQuoteDraft();
        global.H2SFieldCommerce?.reset();
        global.H2SFieldWorkflow?.reset();
        global.H2SFieldEarnings?.reset();
        release(); assessmentDraft = {};
        root.innerHTML = `<header class="field-sales__header${admin() ? ' field-sales__header--management' : ''}"><div class="field-sales__identity">${admin() ? '' : '<span class="field-sales__eyebrow">Home2Smart</span>'}<h2>Field Sales</h2></div><div class="field-sales__toolbar">${['new','detail','representatives'].includes(mode)?'<button type="button" data-sales-discard-draft>Discard unsaved changes</button>':''}${!admin() ? '<button type="button" data-sales-logout>Sign out</button>' : ''}</div></header>
            ${admin() ? `<nav class="field-sales__management-nav" aria-label="Management views">${[['dashboard','Overview'],['opportunities','Leads'],['transactions','Quotes & Payments'],['orders','Orders'],['commissions','Commissions'],['performance','Performance'],['representatives','Representatives']]
                .map(([id,title])=>`<button type="button" data-sales-mode="${id}" aria-pressed="${managementMode()===id}"${managementMode()===id ? ' aria-current="page"' : ''}>${title}</button>`).join('')}</nav>`
                : `<nav class="field-sales__nav" aria-label="Field Sales views">${[['dashboard', 'Home'], ['opportunities', 'Leads'], ['quotes', 'Quotes'], ['orders','Orders'], ['commissions','Earnings']]
                .map(([id, title]) => `<button type="button" data-sales-mode="${id}" aria-pressed="${primaryMode() === id}"${primaryMode() === id ? ' aria-current="page"' : ''}>${navIcon(id)}<span>${title}</span></button>`).join('')}</nav>`}
            <p data-sales-status role="status" aria-live="polite"></p><div data-sales-content></div>`;
        root.querySelector('.field-sales__management-nav [aria-current="page"]')?.scrollIntoView?.({block:'nearest',inline:'nearest'});
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
            content.innerHTML = '<div class="field-sales__toolbar"><button type="button" data-sales-mode="quotes">Build or review a customer quote</button></div><div data-sales-commerce></div>';
            commerce(content.querySelector('[data-sales-commerce]'), null);
        } else if (mode === 'quotes' || mode === 'commerce') {
            const leads = data.opportunities || [];
            content.innerHTML = `<section class="field-sales__quote-workspace"><div class="field-sales__section-heading"><h3>Customer quotes</h3>${admin() ? '<button type="button" data-sales-mode="transactions">Review all quotes & payments</button>' : ''}</div><p class="field-sales__note">Choose an assigned lead to build or review their quote.</p>
                ${searchControls()}<label>Customer opportunity<select data-sales-quote-lead><option value="">Choose an existing lead</option>${leads.map(row=>`<option value="${esc(row.lead_id)}"${quoteLead===row.lead_id?' selected':''}>${esc(row.full_name)}${row.address?' · '+esc(row.address):''} · ${esc(row.services.map(serviceName).join(' / '))}</option>`).join('')}</select></label>${pager('list',data.nextCursor,data.total ?? leads.length)}
                ${!leads.length ? '<div class="field-sales__empty"><p>No assigned leads yet.</p><button type="button" data-sales-mode="new">Add a prospect</button></div>' : ''}
                ${leads.length ? `<div class="field-sales__empty" data-sales-quote-empty${leads.some(row=>row.lead_id===quoteLead) ? ' hidden' : ''}><h4>Choose a customer to get started</h4><p>Their service scope and saved quote revisions will appear here.</p></div>` : ''}
                <div data-sales-quote-builder></div></section>`;
            if (quoteLead && leads.some(row=>row.lead_id===quoteLead)) {
                const selectedLead = leads.find(row=>row.lead_id===quoteLead), target = content.querySelector('[data-sales-quote-builder]');
                target.dataset.market = selectedLead.market;
                commerce(target, quoteLead);
            } else quoteLead = null;
        } else if (mode === 'repeat' && detail) {
            content.innerHTML = `<h3>Additional service for ${esc(detail.lead.full_name)}</h3><p class="field-sales__note">New opportunity under the same customer. Previous agreements, payments and commission credit stay unchanged.</p>
                <form data-sales-form="repeat" class="field-sales__form">
                ${admin()?`<label>Assigned representative<select name="ownerId" required>${representatives(detail.opportunity.owner_user_id)}</select></label>`:''}
                <fieldset class="field-sales__wide"><legend>New service interests</legend><div class="field-sales__services">${interests([],detail.lead.attribution.market)}</div></fieldset>
                <label class="field-sales__wide">Customer identity confirmation<textarea name="evidence" required minlength="3" maxlength="2000" placeholder="How you verified this is the same customer"></textarea></label>
                <label class="field-sales__wide">New service notes<textarea name="notes" maxlength="2000"></textarea></label>
                <label>Follow-up (device timezone)<input type="datetime-local" name="followUpAt"></label>
                <button type="submit">Create separate opportunity</button></form>`;
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
                ${admin() ? `<section class="field-sales__section" aria-label="Link existing inquiry"><h4>Link a verified existing Customer Queue inquiry</h4><p>Verify the exact lead ID and source evidence. Names or phone similarity do not prove identity.</p>
                <form data-sales-form="attach" class="field-sales__form"><label>Existing lead UUID<input name="leadId" required></label>
                <label>Representative<select name="ownerId" required><option value="">Choose</option>${representatives()}</select></label>
                <label class="field-sales__wide">Identity verification evidence<textarea name="evidence" required maxlength="2000"></textarea></label>
                <button type="submit">Link existing inquiry</button></form></section>` : ''}`;
        } else if (mode === 'representatives' && admin()) {
            content.innerHTML = `<h3>Representative accounts</h3><p>New accounts are disabled. Creation does not enroll a representative for login.</p>
                ${(data.representatives || []).map(rep => `<article><strong>${esc(rep.display_name)}</strong> / ${esc(rep.username)} / ${rep.active ? 'active' : 'disabled'}
                <button type="button" data-rep-state="${esc(rep.user_id)}" data-active="${!rep.active}">${rep.active ? 'Disable and revoke sessions' : 'Explicitly enable account'}</button>
                <p>Approved commission start: ${esc(rep.commission_start_date || 'Not configured — tenure review required')} / ${esc(rep.commission_start_evidence || 'Evidence pending')}</p>
                <section class="field-sales__section" aria-label="Representative commission terms"><h4>Representative commission terms</h4><form data-sales-form="representative_terms" class="field-sales__form">
                    <input type="hidden" name="userId" value="${esc(rep.user_id)}"><input type="hidden" name="termsRevision" value="${esc(rep.commission_terms_revision ?? 0)}">
                    <label>Approved commission start date (blank explicitly unsets tenure)<input name="commissionStartDate" type="date" value="${esc(rep.commission_start_date || '')}"></label>
                    <label class="field-sales__wide">Start-event approval evidence<textarea name="commissionStartEvidence" required maxlength="2000">${esc(rep.commission_start_evidence || '')}</textarea></label>
                    <button type="submit">Record approved representative terms</button></form></section></article>`).join('')}
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
            content.innerHTML = `<div class="field-sales__toolbar"><button type="button" data-sales-mode="opportunities">Back to leads</button><button type="button" data-sales-build-quote="${esc(op.lead_id)}">Open customer quotes</button><button type="button" data-sales-repeat>Additional service for this customer</button></div>
                <section class="field-sales__customer-summary" aria-label="Customer assessment summary"><div class="field-sales__record-heading"><h3>${esc(detail.lead.full_name)}</h3>
                <span class="field-sales__badge" data-tone="${leadTone(op.status)}">${esc(label(op.status))}</span></div>
                <p>${esc([detail.lead.project_address, detail.lead.project_city].filter(Boolean).join(' · ') || 'Property address not provided')}</p>
                <dl class="field-sales__facts"><div><dt>Phone</dt><dd>${esc(detail.lead.phone || 'Not provided')}</dd></div>${attribution(op)}<div><dt>Technician</dt><dd>See installation assignment in Orders</dd></div><div><dt>Next step</dt><dd>${esc(nextStep(op.status))}</dd></div></dl></section>
                ${customerHistory ? `<section class="field-sales__section" aria-label="Customer opportunities"><h4>Customer service history</h4><p class="field-sales__note">${admin()?'All authorized opportunities for this customer.':'Only opportunities assigned to you are shown.'}</p>
                    ${customerHistory.opportunities.map(row=>`<article class="field-sales__photo-card"><div><strong>${esc(row.services.map(serviceName).join(' · '))}</strong><p>${esc(label(row.status))} · ${esc(date(row.created_at))}</p></div><button type="button" data-sales-lead="${esc(row.lead_id)}"${row.lead_id===op.lead_id?' disabled':''}>${row.lead_id===op.lead_id?'Current opportunity':'View opportunity'}</button></article>`).join('')}
                    ${pager('history',customerHistory.nextCursor,customerHistory.total)}</section>` : ''}
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
                <form data-sales-form="photo" class="field-sales__form"><label>Service<select name="serviceId" required>${data.services.filter(s => op.services.includes(s.service_id)).map(s => `<option value="${esc(s.service_id)}">${esc(s.definition.label)}</option>`).join('')}</select></label>
                <label>Photo label<select name="label" required></select></label>
                <label>Photograph<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required></label><button type="submit"${consent ? '' : ' disabled'}>Upload labeled photo</button></form>
                <div data-sales-photos>${detail.photos.map(p => `<article class="field-sales__photo-card"><div><strong>${esc(p.label)}</strong><p class="field-sales__note">${esc(serviceName(p.service_id))} · ${p.state === 'ready' ? 'Ready' : 'Processing or review needed'}</p></div>
                    ${consent && p.state === 'ready' ? `<button type="button" data-sales-photo="${esc(p.file_id)}">View private photo</button>` : ''}</article>`).join('') || '<p class="field-sales__empty">No assessment photos yet. Save customer permission before uploading.</p>'}</div>
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
            const rows = data.opportunities || [], due = data.followUps || chronological(rows.filter(row => row.follow_up_at && Date.parse(row.follow_up_at) <= Date.now() && row.status !== 'closed'));
            const active = rows.filter(row=>row.status !== 'closed'), followUpsToday = rows.filter(row=>row.follow_up_at && new Date(row.follow_up_at).toDateString()===new Date().toDateString() && row.status!=='closed');
            content.innerHTML = `<div class="field-sales__toolbar field-sales__section-heading"><h3>${mode==='dashboard' ? (admin() ? 'Sales overview' : 'Your day in sales') : 'Customer leads'}</h3><button type="button" data-sales-mode="new" class="field-sales__primary">New prospect</button></div>
                ${mode==='dashboard' ? `<div class="field-sales__summary" aria-label="Loaded lead activity">
                    ${[[data.summary?.active ?? active.length,'Active leads'],[data.summary?.due ?? due.length,'Follow-ups due'],[data.summary?.upcoming ?? followUpsToday.length,data.summary?'Upcoming 24h':'Follow-ups today'],[data.summary?.awaitingReview ?? rows.filter(row=>row.status==='ready_for_review').length,'Awaiting review']].map(([value,title])=>`<div class="field-sales__metric"><span>${title}</span><strong>${value}</strong></div>`).join('')}</div>` : ''}
                <p class="field-sales__note">${rows.length} of ${esc(data.total ?? rows.length)} matching opportunities on this page. ${data.summary?'Activity counts cover all matching authorized opportunities.':'Activity counts reflect your current loaded leads.'}</p>
                ${mode === 'dashboard' ? `<section class="field-sales__section"><h4>Contact next</h4>${due.length ? `<div class="field-sales__table-region" role="region" aria-label="Customer follow-ups" tabindex="0"><table class="field-sales__followup-table">
                    <caption>Overdue follow-ups · earliest due first</caption><thead><tr><th scope="col">Customer</th><th scope="col">Service</th><th scope="col">Contact due</th><th scope="col">Next step</th></tr></thead>
                    <tbody>${due.map(row=>`<tr><th scope="row"><button type="button" class="field-sales__customer-link" data-sales-lead="${esc(row.lead_id)}">${esc(row.full_name)}</button></th><td>${esc(row.services.map(serviceName).join(' · ') || 'Service assessment needed')}</td><td>${esc(date(row.follow_up_at))}</td><td>${esc(nextStep(row.status))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="field-sales__empty">No overdue customer follow-ups match these filters.</p>'}${pager('due',data.followUpCursor,data.followUpTotal ?? due.length)}</section>` : ''}
                ${searchControls()}
                <div data-sales-list>${rows.map(row => `<article class="field-sales__lead-card" data-owner="${esc(row.owner_user_id)}" data-search="${esc([row.full_name,row.phone,row.address].join(' ').toLowerCase())}">
                <div class="field-sales__record-heading"><button type="button" class="field-sales__customer-link" data-sales-lead="${esc(row.lead_id)}">${esc(row.full_name)}</button><span class="field-sales__badge" data-tone="${leadTone(row.status)}">${esc(label(row.status))}</span></div>
                <p class="field-sales__service-label">${esc(row.services.map(serviceName).join(' · ') || 'Service interests not selected')}</p>
                <p class="field-sales__note">${esc(row.address || 'Property address not provided')}</p>
                <dl class="field-sales__facts"><div><dt>Phone</dt><dd>${esc(row.phone || 'Not provided')}</dd></div><div><dt>Property</dt><dd>${row.market==='commercial'?'Commercial':'Residential'}</dd></div>${attribution(row)}<div><dt>Next contact</dt><dd>${esc(nextContact(row.follow_up_at))}</dd></div><div class="field-sales__next-step"><dt>Next step</dt><dd>${esc(nextStep(row.status))}</dd></div></dl>
                <div class="field-sales__card-actions"><button type="button" data-sales-lead="${esc(row.lead_id)}">View assessment<span aria-hidden="true"> ›</span></button></div></article>`).join('') || `<div class="field-sales__empty"><h4>${filters.search||filters.owner?'No matching opportunities':'Your next customer starts here'}</h4><p>${filters.search||filters.owner?'Try another customer, phone or address.':'Add a prospect, or ask management to assign an existing inquiry.'}</p></div>`}</div>${pager('list',data.nextCursor,data.total ?? rows.length)}<p class="field-sales__empty" data-sales-no-results hidden>No leads match these filters. Try another name, phone or address.</p>`;
        }
        const key = viewKey(), retained = draftViews.get(key);
        if (retained) {
            const freshForms = [...content.querySelectorAll('[data-sales-form]')];
            assessmentDraft = retained.answers;
            for (const form of retained.forms) {
                const fresh = freshForms.find(candidate => candidate.dataset.salesForm === form.dataset.salesForm &&
                    candidate.elements.userId?.value === form.elements.userId?.value);
                if (!fresh) continue;
                if (form === savedForm) {
                    if (form.dataset.salesForm === 'save') assessmentDraft = {};
                } else fresh.replaceWith(form);
            }
            if (mode === 'detail') {
                // Refresh server-authoritative availability without clearing a selected FileList.
                const photoForm = content.querySelector('[data-sales-form="photo"]');
                if (photoForm) {
                    const serviceId = photoForm.elements.serviceId.value, photoLabel = photoForm.elements.label.value;
                    const fileSelected = photoForm.elements.photo.files.length > 0;
                    const available = data.services.filter(service => detail.opportunity.services.includes(service.service_id));
                    const serviceAvailable = available.some(service => service.service_id === serviceId);
                    photoForm.elements.serviceId.innerHTML = (fileSelected && !serviceAvailable ? '<option value="" selected disabled>Choose a service for the retained photo</option>' : '') +
                        available.map(service => `<option value="${esc(service.service_id)}"${service.service_id === serviceId ? ' selected' : ''}>${esc(service.definition.label)}</option>`).join('');
                    photoLabels();
                    const labelAvailable = serviceAvailable && [...photoForm.elements.label.options].some(option => option.value === photoLabel);
                    if (labelAvailable) photoForm.elements.label.value = photoLabel;
                    else if (fileSelected) photoForm.elements.label.insertAdjacentHTML('afterbegin','<option value="" selected disabled>Choose a label for the retained photo</option>');
                    photoForm.querySelector('button').disabled = !detail.opportunity.photo_consent || !available.length;
                    if (fileSelected && (!serviceAvailable || !labelAvailable)) status('Your selected photo is retained. Choose its service and label before uploading.');
                }
                if ((!admin() && detail.opportunity.status === 'closed') ||
                    detail.opportunity.services.some(id => !data.services.some(service => service.service_id === id))) {
                    content.querySelectorAll('form :is(input,select,textarea,button)').forEach(control => { control.disabled = true; });
                }
            }
        }
        savedForm = null;
        renderedKey = key;
        if (retained) retainDraft();
        global.h2sInitDateInputs?.();
    }
    function commerce(target, leadId) {
        if (!global.H2SFieldCommerce) { target.textContent = 'Quote/payment module unavailable. Assessment remains available.'; return; }
        global.H2SFieldCommerce.mount(target, { apiBase: options.apiBase, getSession: session, leadId, draft: quoteDrafts.get(leadId), ...identityNames(),
            onDraftDiscard: () => quoteDrafts.delete(leadId),
            openLead: id => navigate('assessment', id), onSessionEnded: () => reset() });
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
    function checkedRecords(result){
        if(typeof result.enabled!=='boolean'||result.enabled&&(!Array.isArray(result.opportunities)||!Array.isArray(result.services)))throw Error('Field Sales response incomplete. No empty result or current synchronization is assumed.');
        return result;
    }
    async function includeSelectedQuote(result) {
        if (quoteLead && ['quotes','commerce'].includes(mode) && !result.opportunities.some(row=>row.lead_id===quoteLead)) {
            const selected=await json('field-sales?leadId='+encodeURIComponent(quoteLead));
            if (selected.opportunity?.lead_id!==quoteLead || selected.lead?.lead_id!==quoteLead) throw Error('Selected customer opportunity was not verified.');
            result.opportunities.push({...selected.opportunity,full_name:selected.lead.full_name,address:selected.lead.project_address,market:selected.lead.attribution.market});
        }
        return result;
    }
    async function load(leadId) {
        if (!allowed()) { reset(); return; }
        if (token && (token !== session().token || actorRole !== session().role)) reset();
        retainDraft();
        renderedKey = null;
        token = session().token; actorRole = session().role; const id = ++version; controller?.abort(); controller = new AbortController();
        data = detail = null; render(); status('Loading assigned Field Sales records...');
        root.querySelector('[data-sales-status]').classList.add('field-sales__loading');
        try {
            const result = checkedRecords(await json(listPath())); if (id !== version) return; data = result;
            if (leadId && result.enabled) { const record = await json(`field-sales?leadId=${encodeURIComponent(leadId)}`); if (id !== version) return; detail = record; mode = 'detail'; }
            if (detail?.lead.customer_id) customerHistory = await json('field-sales?customerId='+encodeURIComponent(detail.lead.customer_id)+(historyPages[historyIndex]?'&cursor='+encodeURIComponent(historyPages[historyIndex]):''));
            if (result.enabled) await includeSelectedQuote(data);
            if (id !== version) return;
            render();
        } catch (error) { console.error('Field Sales read failed.'); if (id === version) { data = detail = null; render(); status(error.message, true); root.querySelector('[data-sales-content]').innerHTML='<button type="button" data-sales-retry-read>Retry loading opportunities</button>'; } }
        ensureSync();
    }
    async function synchronize() {
        const id = version, edits = editVersion, lead = detail?.opportunity.lead_id;
        const fresh = checkedRecords(await json(listPath()));
        const record = lead && fresh.enabled ? await json(`field-sales?leadId=${encodeURIComponent(lead)}`) : null;
        const history = record?.lead.customer_id ? await json('field-sales?customerId='+encodeURIComponent(record.lead.customer_id)+(historyPages[historyIndex]?'&cursor='+encodeURIComponent(historyPages[historyIndex]):'')) : null;
        if (id !== version || edits !== editVersion || hasUnsavedDraft() || global.H2SDataSync?.interacting(root)) return false;
        const search = root.querySelector('[data-sales-search]')?.value, owner = root.querySelector('[data-sales-owner]')?.value;
        data = fresh; detail = record; customerHistory = history;
        draftViews.delete(renderedKey);
        render();
        if (search !== undefined && root.querySelector('[data-sales-search]')) root.querySelector('[data-sales-search]').value = search;
        if (owner !== undefined && root.querySelector('[data-sales-owner]')) root.querySelector('[data-sales-owner]').value = owner;
        return true;
    }
    function ensureSync() {
        if (sync || !global.H2SDataSync) return;
        sync = global.H2SDataSync.register({id:'field-sales',isActive:()=>allowed() && root.classList.contains('active')
            && !['orders','commissions','performance','transactions','quotes','commerce'].includes(mode),
            isDirty:()=>hasUnsavedDraft() || global.H2SDataSync.interacting(root),
            refresh:synchronize,onState:state=>{
                if (!attempt) global.H2SDataSync.feedback(root,'[data-sales-status]',state,()=>sync.request('retry',{force:true}));
            }});
    }
    async function write(path, body) {
        if (busy) return null;
        const generation = version;
        busy = true;
        if (!attempt) attempt = { path, body: { ...body, operationId: global.crypto.randomUUID() } };
        status('Saving securely. If interrupted, retry this same action.');
        try { const result = await json(attempt.path, attempt.body); attempt = null; return result; }
        catch (error) { console.error('Field Sales save failed.'); if (generation === version) status(`${error.message} Your form is retained. Retry this same save or explicitly discard the interrupted action.`, true); return null; }
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
        editVersion++;
        if (event.target.closest('form') && !event.target.closest('[data-sales-form]') &&
            !(global.H2SFieldCommerce?.captureDraft && event.target.closest('[data-commerce-create]'))) mountedDirty = true;
        if (event.target.name === 'services') questions();
        if (event.target.name === 'market') {
            for (const input of root.querySelectorAll('[name="services"]')) {
                const available = data.services.find(service => service.service_id === input.value).definition.markets.includes(event.target.value);
                input.disabled = !available; input.closest('label').hidden = !available; if (!available) input.checked = false;
            }
        }
        if (event.target.name === 'serviceId') photoLabels();
        if (event.target.matches('[data-sales-owner]')) {filters.owner=event.target.value;resetPages();reloadPage();}
        if (event.target.matches('[data-sales-quote-lead]')) {
            if (!safeToLeave()) { event.target.value = quoteLead || ''; event.target.dispatchEvent(new Event('change', {bubbles:false})); return; }
            quoteLead = event.target.value || null;
            const target = root.querySelector('[data-sales-quote-builder]'), lead = data.opportunities.find(row=>row.lead_id===quoteLead);
            global.H2SFieldCommerce?.reset(); target.replaceChildren();
            const empty = root.querySelector('[data-sales-quote-empty]'); if (empty) empty.hidden = !!lead;
            if (lead) { target.dataset.market = lead.market; commerce(target, quoteLead); }
        }
    });
    function resetPages(){pages=[null];pageIndex=0;duePages=[null];dueIndex=0;}
    async function reloadPage(kind='list') {
        if (!allowed() || busy || preparing) return;
        const id=++version;controller?.abort();controller=new AbortController();
        status('Loading matching opportunities...');
        const focused=root.querySelector('[data-sales-search]')===document.activeElement;
        try {
            const fresh=checkedRecords(await json(kind==='due'?listPath(duePages[dueIndex],true):listPath()));
            if(kind!=='due'&&fresh.enabled)await includeSelectedQuote(fresh);
            if(id!==version)return;
            if(kind==='due')data={...data,followUps:fresh.opportunities,followUpCursor:fresh.nextCursor,followUpTotal:fresh.total};
            else data=fresh;
            retainDraft();render();
            if(focused)root.querySelector('[data-sales-search]')?.focus();
        }catch(error){console.error('Field Sales page read failed.');if(id===version){data=detail=null;render();status(error.message,true);root.querySelector('[data-sales-content]').innerHTML='<button type="button" data-sales-retry-read>Retry loading opportunities</button>';}}
    }
    root.addEventListener('input', event=>{
        editVersion++;
        if(event.target.matches('[data-sales-search]')) {
            filters.search=event.target.value.trim();resetPages();clearTimeout(searchTimer);
            searchTimer=setTimeout(()=>reloadPage(),300);
        }
        if (event.target.closest('form') && !event.target.closest('[data-sales-form]') &&
            !(global.H2SFieldCommerce?.captureDraft && event.target.closest('[data-commerce-create]'))) mountedDirty = true;
    });
    function hasUnsavedDraft() {
        const nodes = [root, ...[...draftViews.values()].flatMap(draft => draft.forms), ...[...quoteDrafts.values()].map(draft => draft.form)];
        const changed = nodes.some(node => node.querySelectorAll && [...node.querySelectorAll('form input,form select,form textarea')].some(control =>
            control.type === 'file' ? control.files.length > 0
                : ['checkbox','radio'].includes(control.type) ? control.checked !== control.defaultChecked
                : control.tagName === 'SELECT' ? control.selectedIndex !== Math.max(0, [...control.options].findIndex(option => option.defaultSelected))
                : control.value !== control.defaultValue));
        return changed || mountedDirty || busy || preparing || !!attempt;
    }
    global.addEventListener('beforeunload', event => {
        if (hasUnsavedDraft()) { event.preventDefault(); event.returnValue = ''; }
    });
    root.addEventListener('submit', async event => {
        const form = event.target.closest('[data-sales-form]'); if (!form) return; event.preventDefault();
        if (busy || preparing) return;
        const generation = version, started = session()?.token;
        try {
            const action = form.dataset.salesForm, values = Object.fromEntries(new FormData(form)), body = { ...values, action };
            if (['create', 'save','repeat'].includes(action)) { body.services = [...form.querySelectorAll('[name="services"]:checked')].map(el => el.value); body.followUpAt = instant(values.followUpAt); }
            if(action==='repeat')body.leadId=detail.opportunity.lead_id;
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
            if (result) { const lead = result.leadId || (detail?.opportunity.lead_id); if (action === 'account_create') { form.querySelector('button').disabled = true; await refreshRepresentatives(); retainDraft(); render(); status('Disabled account created. Save the retained temporary credential securely; it is not recoverable. Activation remains a separate explicit management action.'); } else {
                if (['create','repeat'].includes(action)) { draftViews.delete(renderedKey); renderedKey = null; }
                savedForm = form; await load(lead);
            } }
        } catch (error) { if (generation === version) status(error.message, true); }
        finally { if (generation === version) preparing = false; }
    });
    async function refreshRepresentatives() { const fresh = checkedRecords(await json('field-sales')); data = fresh; }
    root.addEventListener('click', async event => {
        const button = event.target.closest('button'); if (!button) return;
        if (button.hasAttribute('data-sales-logout')) {
            if (hasUnsavedDraft() && !global.confirm('Sign out and discard all unsaved changes and selected files?')) return;
            options.onLogout(); return;
        }
        if (busy || preparing) return;
        try {
            if(button.hasAttribute('data-sales-repeat')){if(!safeToLeave())return;mode='repeat';render();return;}
            if(button.dataset.salesPage){
                if(!safeToLeave())return;
                const kind=button.dataset.salesPage,forward=button.dataset.direction==='1';
                if(kind==='history'){
                    if(forward){historyPages[++historyIndex]=customerHistory.nextCursor;}else historyIndex--;
                    await load(detail.opportunity.lead_id);return;
                }
                if(kind==='due'){if(forward)duePages[++dueIndex]=data.followUpCursor;else dueIndex--;}
                else {if(forward)pages[++pageIndex]=data.nextCursor;else pageIndex--;}
                await reloadPage(kind);return;
            }
            if (button.hasAttribute('data-sales-discard-attempt')) {
                if (!global.confirm('Discard the interrupted action? Your form stays available. A prior server result may still exist; review current records before submitting another action.')) return;
                attempt = null; status('Interrupted retry discarded. Your form is retained; review current records before another save.');
            }
            if(button.hasAttribute('data-sales-discard-draft')){
                if(attempt){status('Retry or explicitly discard the interrupted action before discarding form changes.',true);return;}
                if(!global.confirm('Discard the unsaved changes and selected files in this view? Server records are not undone.'))return;
                draftViews.delete(renderedKey);renderedKey=savedForm=null;assessmentDraft={};mountedDirty=false;
                root.querySelector('[data-sales-content]').replaceChildren();await load(detail?.opportunity.lead_id);
            }
            if (button.hasAttribute('data-sales-retry-read')) await load(detail?.opportunity.lead_id);
            if (button.dataset.salesMode) { if (!safeToLeave()) return; mode = button.dataset.salesMode; detail = null; attempt = null; await load(); }
            if (button.dataset.salesBuildQuote) { if (!safeToLeave()) return; quoteLead = button.dataset.salesBuildQuote; mode = 'quotes'; detail = null; attempt = null; await load(); }
            if (button.dataset.salesLead) { if (!safeToLeave()) return; attempt = null;historyPages=[null];historyIndex=0;customerHistory=null; await load(button.dataset.salesLead); }
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
        if (token && (token !== session().token || actorRole !== session().role)) reset();
        if (!safeToLeave()) return Promise.resolve();
        activateShell();
        return load(detail?.opportunity.lead_id);
    }
    function navigate(view, leadId) {
        const views = {home:'dashboard',leads:'opportunities',new:'new',quotes:'quotes',orders:'orders',earnings:'commissions',assessment:'detail'};
        if (!Object.hasOwn(views, view) || !allowed()) return Promise.resolve();
        if (token && (token !== session().token || actorRole !== session().role)) reset();
        if (!safeToLeave()) return Promise.resolve();
        activateShell();
        mode = views[view]; detail = null; attempt = null; if (view === 'quotes' && leadId) quoteLead = leadId;
        if (view === 'assessment' && !leadId) mode = 'opportunities';
        return load(view === 'assessment' ? leadId : undefined);
    }
    nav.addEventListener('click', () => { if (session()?.role === 'SALES') activate(); else global.switchToTab('fieldsales'); });
    global.H2SFieldSales = { configure(value) { options = value; nav.hidden = !allowed() || !adminNav || document.body.dataset.salesApp === 'true'; }, open: () => {
        if (!allowed()) { reset(); return Promise.resolve(); }
        if (token && (token !== session().token || actorRole !== session().role)) reset();
        return safeToLeave() ? load(detail?.opportunity.lead_id) : Promise.resolve();
    }, activate, navigate, reset };
})(window);
