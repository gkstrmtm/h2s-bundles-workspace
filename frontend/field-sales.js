(function (global) {
    'use strict';
    const root = document.createElement('section'), nav = document.createElement('button');
    root.id = 'field-sales-pane'; root.className = 'pane field-sales'; root.setAttribute('aria-label', 'Field Sales');
    nav.type = 'button'; nav.className = 'app-sidebar-nav-item'; nav.dataset.tab = 'fieldsales'; nav.textContent = 'Field Sales'; nav.hidden = true;
    document.querySelector('#h2s-app .app-content').append(root);
    document.querySelector('.app-sidebar-group[data-group-id="admin"] .app-sidebar-group-items').append(nav);
    const style = document.createElement('link'); style.rel = 'stylesheet';
    style.href = global.__h2sResolveDashSiblingAsset?.('field-sales.css') || './field-sales.css'; document.head.append(style);
    let options, data, detail, mode = 'dashboard', token = '', version = 0, controller, attempt, busy = false, preparing = false;
    const urls = new Set(), hiddenNav = new Map();
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const session = () => options?.getSession();
    const allowed = () => ['ADMIN', 'SALES'].includes(session()?.role) && !!session()?.token;
    const admin = () => session()?.role === 'ADMIN';
    const date = value => value ? new Date(value).toLocaleString() : 'Not set';
    const inputDate = value => {
        if (!value) return '';
        const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    const instant = value => value ? new Date(value).toISOString() : null;
    function release() { for (const url of urls) global.URL.revokeObjectURL(url); urls.clear(); }
    function reset() {
        ++version; controller?.abort(); release(); data = detail = attempt = null; busy = preparing = false; token = ''; root.replaceChildren(); nav.hidden = true;
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
        const started = session().token, generation = version;
        const response = await global.fetch(`${options.apiBase}/api/${path}`, { method: body ? 'POST' : 'GET', cache: 'no-store',
            signal: controller?.signal, referrerPolicy: 'no-referrer',
            headers: { Authorization: `Bearer ${started}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}) });
        if (generation !== version || session()?.token !== started) throw new Error('Session changed; private response discarded.');
        if (response.status === 401 || response.status === 403) {
            reset(); status('Access ended. Sign in again or contact management.', true); throw new Error('Access ended. Sign in again or contact management.');
        }
        return response;
    }
    async function json(path, body) {
        const started = session()?.token, generation = version;
        const response = await request(path, body), result = await response.json();
        if (generation !== version || session()?.token !== started || !allowed()) throw new Error('Session changed; private response discarded.');
        if (!response.ok || !result.ok) throw new Error(result.error || 'Field Sales request failed.');
        return result;
    }
    function representatives(selected) {
        return (data.representatives || []).filter(rep => rep.active).map(rep =>
            `<option value="${esc(rep.user_id)}"${selected === rep.user_id ? ' selected' : ''}>${esc(rep.display_name)}</option>`).join('');
    }
    function interests(selected = [], market = 'residential') {
        return data.services.map(service => {
            const available = service.definition.markets.includes(market);
            return `<label class="field-sales__check"${available ? '' : ' hidden'}><input type="checkbox" name="services" value="${esc(service.service_id)}"${selected.includes(service.service_id) ? ' checked' : ''}${available ? '' : ' disabled'}>${esc(service.definition.label)}</label>`;
        }).join('');
    }
    function render() {
        release();
        root.innerHTML = `<header><h2>Field Sales</h2><button type="button" data-sales-refresh>Refresh</button>${!admin() ? '<button type="button" data-sales-logout>Sign out</button>' : ''}</header>
            <p>Assessment and follow-up only. Service interest is not an approved price, offer, agreement or appointment.</p>
            <nav aria-label="Field Sales views">${[['dashboard', 'My Dashboard'], ['new', 'New Prospect'], ['opportunities', 'My Opportunities'], ...(admin() ? [['representatives', 'Representatives']] : [])]
                .map(([id, label]) => `<button type="button" data-sales-mode="${id}" aria-pressed="${mode === id}">${label}</button>`).join('')}</nav>
            <p data-sales-status role="status" aria-live="polite"></p><div data-sales-content></div>`;
        if (!data) return;
        if (!data.enabled) { status('Field Sales is disabled. No accounts or customer records can be changed.'); return; }
        const content = root.querySelector('[data-sales-content]');
        if (mode === 'new') {
            content.innerHTML = `<h3>New prospect</h3><form data-sales-form="create" class="field-sales__form">
                <label>Customer name<input name="fullName" required maxlength="120" autocomplete="name"></label>
                <label>Phone<input name="phone" type="tel" required maxlength="40" autocomplete="tel"></label>
                <label class="field-sales__wide">Property address<input name="address" required maxlength="500" autocomplete="street-address"></label>
                <label>City<input name="city" required maxlength="120" autocomplete="address-level2"></label>
                <label>Property type<select name="market" data-custom-select="off"><option value="residential">Residential</option><option value="commercial">Commercial</option></select></label>
                ${admin() ? `<label>Assigned representative<select name="ownerId" required data-custom-select="off"><option value="">Choose representative</option>${representatives()}</select></label>` : ''}
                <fieldset class="field-sales__wide"><legend>Interested services</legend>${interests()}</fieldset>
                <label class="field-sales__wide">Notes<textarea name="notes" maxlength="2000"></textarea></label>
                <label>Follow-up (device timezone)<input type="datetime-local" name="followUpAt"></label><button type="submit">Save new prospect</button></form>
                ${admin() ? `<h3>Use an existing Customer Queue inquiry</h3><p>Verify the exact lead ID and source evidence. Names or phone similarity do not prove identity.</p>
                <form data-sales-form="attach" class="field-sales__form"><label>Existing lead UUID<input name="leadId" required></label>
                <label>Representative<select name="ownerId" required data-custom-select="off"><option value="">Choose</option>${representatives()}</select></label>
                <label class="field-sales__wide">Identity verification evidence<textarea name="evidence" required maxlength="2000"></textarea></label>
                <button type="submit">Link existing inquiry</button></form>` : ''}`;
        } else if (mode === 'representatives' && admin()) {
            content.innerHTML = `<h3>Representative accounts</h3><p>New accounts are disabled. Creation does not enroll a representative for login.</p>
                ${(data.representatives || []).map(rep => `<article><strong>${esc(rep.display_name)}</strong> / ${esc(rep.username)} / ${rep.active ? 'active' : 'disabled'}
                <button type="button" data-rep-state="${esc(rep.user_id)}" data-active="${!rep.active}">${rep.active ? 'Disable and revoke sessions' : 'Explicitly enable account'}</button></article>`).join('')}
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
            content.innerHTML = `<h3>${esc(detail.lead.full_name)}</h3><p>${esc(detail.lead.phone)} / ${esc(detail.lead.project_address)} / ${esc(detail.lead.project_city)}</p>
                <p class="field-sales__id">Shared lead ${esc(op.lead_id)} / ${esc(op.status)} / revision ${esc(op.revision)}</p>
                <p>Assessment progress: ${required.filter(answer => answer !== undefined && answer !== '').length}/${required.length} required answers;
                    ${expectedPhotos.filter(Boolean).length}/${expectedPhotos.length} requested photo labels have ready evidence.</p>
                <form data-sales-form="save" class="field-sales__form"><fieldset class="field-sales__wide"><legend>Service interests</legend>${interests(op.services, detail.lead.attribution.market)}</fieldset>
                <div data-sales-questions class="field-sales__wide"></div>
                <label class="field-sales__wide">Assessment / follow-up notes<textarea name="notes" maxlength="2000">${esc(op.notes)}</textarea></label>
                <label>Follow-up (device timezone)<input type="datetime-local" name="followUpAt" value="${esc(inputDate(detail.followUpAt))}"></label>
                <label class="field-sales__check"><input type="checkbox" name="photoConsent"${consent ? ' checked' : ''}>Customer permits assessment photographs</label>
                <label class="field-sales__wide">Photo permission evidence / customer statement<textarea name="consentNote" maxlength="1000">${esc(op.consent_note)}</textarea></label>
                <button type="submit" name="submit" value="false">Save assessment draft</button><button type="submit" name="submit" value="true">Submit for management review</button></form>
                <h3>Property photographs</h3><p>Save permission first. Photos stay private. Missing photos require management review, not invented evidence.</p>
                <form data-sales-form="photo" class="field-sales__form"><label>Service<select name="serviceId" data-custom-select="off">${data.services.filter(s => op.services.includes(s.service_id)).map(s => `<option value="${esc(s.service_id)}">${esc(s.definition.label)}</option>`).join('')}</select></label>
                <label>Photo label<select name="label" data-custom-select="off"></select></label>
                <label>Photograph<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required></label><button type="submit"${consent ? '' : ' disabled'}>Upload labeled photo</button></form>
                <div data-sales-photos>${detail.photos.map(p => `<article>${esc(p.service_id)} / ${esc(p.label)} / ${esc(p.state)}
                    ${consent && p.state === 'ready' ? `<button type="button" data-sales-photo="${esc(p.file_id)}">View private photo</button>` : ''}</article>`).join('')}</div>
                ${admin() ? `<h3>Management review and ownership</h3><form data-sales-form="review" class="field-sales__form"><label>Review status<select name="status" data-custom-select="off"><option value="reviewed">Reviewed (not quote approved)</option><option value="needs_information">Needs information</option><option value="closed">Closed</option></select></label>
                <label>Review reason<textarea name="note" required maxlength="2000"></textarea></label><button type="submit">Record management review</button></form>
                <form data-sales-form="assign" class="field-sales__form"><label>Reassign representative<select name="ownerId" required data-custom-select="off">${representatives(op.owner_user_id)}</select></label>
                <label>Reassignment reason<textarea name="note" required maxlength="2000"></textarea></label><button type="submit">Confirm reassignment</button></form>` : ''}
                <h3>Prospect history</h3>${detail.history.map(event => `<article>${esc(date(event.created_at))} / ${esc(event.actor_name)} / ${esc(event.action)}
                    <pre>${esc(JSON.stringify(event.payload, null, 2))}</pre></article>`).join('') || '<p>No recorded activity.</p>'}`;
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
            content.innerHTML = `<h3>${admin() ? 'Management visibility across representatives' : 'My assigned prospects'}</h3>
                <p>${rows.length} loaded of ${data.total} assigned opportunities; ${due.length} loaded follow-ups due. ${data.total > rows.length ? 'Showing the latest 100; use Customer Queue for complete management review.' : ''}</p>
                ${mode === 'dashboard' ? `<h4>Follow-ups due</h4>${due.map(row => `<p><button type="button" data-sales-lead="${esc(row.lead_id)}">${esc(row.full_name)}</button> ${esc(date(row.follow_up_at))}</p>`).join('') || '<p>No due follow-ups in loaded records.</p>'}` : ''}
                ${admin() ? `<label>Representative filter<select data-sales-owner data-custom-select="off"><option value="">All representatives</option>${(data.representatives || []).map(rep => `<option value="${esc(rep.user_id)}">${esc(rep.display_name)}</option>`).join('')}</select></label>` : ''}
                <div data-sales-list>${rows.map(row => `<article data-owner="${esc(row.owner_user_id)}"><button type="button" data-sales-lead="${esc(row.lead_id)}">${esc(row.full_name)}</button>
                <p>${esc(row.phone)} / ${esc(row.address)} / ${esc(row.market)}</p><p>${esc(row.status)} / ${esc(row.services.map(id => data.services.find(s => s.service_id === id)?.definition.label || id).join(', '))}</p>
                <p>Follow-up: ${esc(date(row.follow_up_at))}</p></article>`).join('') || '<p>No assigned prospects. Management can assign an existing inquiry or you can create a prospect.</p>'}</div>`;
        }
        global.h2sInitDateInputs?.();
    }
    function questions() {
        const target = root.querySelector('[data-sales-questions]'); if (!target) return;
        const selected = [...root.querySelectorAll('[name="services"]:checked')].map(el => el.value), previous = {};
        for (const el of target.querySelectorAll('[data-question]')) previous[el.dataset.service + ':' + el.dataset.question] = el.value;
        target.innerHTML = data.services.filter(s => selected.includes(s.service_id)).map(s => `<fieldset><legend>${esc(s.definition.label)} / definition v${s.version}</legend>
            ${s.definition.questions.map(q => {
                const value = previous[s.service_id + ':' + q.id] ?? detail.opportunity.assessments[s.service_id]?.answers?.[q.id] ?? '';
                const attrs = `data-service="${esc(s.service_id)}" data-question="${esc(q.id)}"`;
                return `<label>${esc(q.label)}${q.required ? ' (required for submission)' : ''}${q.type === 'select'
                    ? `<select ${attrs} data-custom-select="off"><option value="">Choose</option>${q.options.map(option => `<option${option === value ? ' selected' : ''}>${esc(option)}</option>`).join('')}</select>`
                    : `<input ${attrs} type="${q.type === 'number' ? 'number' : 'text'}"${q.type === 'number' ? ` min="${q.min ?? 0}" max="${q.max ?? 100000}"` : ' maxlength="2000"'} value="${esc(value)}">`}</label>`;
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
        status('Saving. An interrupted action must be retried with the identical operation key.');
        try { const result = await json(attempt.path, attempt.body); attempt = null; return result; }
        catch (error) { console.error('Field Sales save failed.'); if (generation === version) status(`${error.message} Your form is retained. Retry submits the identical pending action; refresh to re-read before a new action.`, true); return null; }
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
        if (event.target.matches('[data-sales-owner]')) for (const row of root.querySelectorAll('[data-sales-list] article')) row.hidden = !!event.target.value && row.dataset.owner !== event.target.value;
    });
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
    function activate() {
        if (!allowed()) { reset(); return; }
        document.querySelectorAll('#h2s-app .pane').forEach(pane => pane.classList.remove('active')); root.classList.add('active');
        if (session().role === 'SALES') document.getElementById('h2s-app').dataset.fieldSales = 'true';
        if (session().role === 'SALES') for (const element of document.querySelectorAll('.app-sidebar-nav-item')) {
            if (element === nav) continue; if (!hiddenNav.has(element)) hiddenNav.set(element, element.hidden); element.hidden = true;
        }
        const title = document.getElementById('currentAreaTitle'); if (title) title.textContent = 'Field Sales';
        nav.hidden = false; load();
    }
    nav.addEventListener('click', () => { if (session()?.role === 'SALES') activate(); else global.switchToTab('fieldsales'); });
    global.H2SFieldSales = { configure(value) { options = value; nav.hidden = !allowed(); }, open: () => load(), activate, reset };
})(window);
