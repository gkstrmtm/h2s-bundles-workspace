(function (global) {
    'use strict';
    const models = new Map(), recoveryDelays = [2000, 5000, 15000];
    let authKey = '';
    const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const date = value => value ? new Date(value).toLocaleString() : 'Not recorded';
    const label = value => String(value || '').replace(/_/g, ' ');
    const signature = value => JSON.stringify(value, (key, item) => key === 'checkedAt' ? undefined : item);
    const localInput = value => {
        if (!value) return '';
        const instant = new Date(value);
        return new Date(instant.getTime() - instant.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    const money = order => /^[A-Za-z]{3}$/.test(order.currency || '') && Number.isFinite(Number(order.total))
        ? new Intl.NumberFormat('en-US', { style: 'currency', currency: order.currency.toUpperCase() }).format(Number(order.total))
        : 'Price/currency needs review';
    function message(model, text) {
        model.root.querySelector('[data-operations-status]').textContent = text;
    }
    async function request(model, query, body) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await global.fetch(`${model.options.apiBase}/api/commercial-operations?${new URLSearchParams({ leadId: model.id, ...query })}`, {
                method: body ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
                headers: { Authorization: `Bearer ${model.options.getToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
            let data;
            try { data = await response.json(); } catch (_) { data = null; }
            if (!response.ok || !data?.ok) {
                const error = new Error(response.status === 401 || response.status === 403 ? 'Administrator session unavailable.'
                    : data?.code === 'SCHEMA_UNAVAILABLE' || response.status === 404 ? 'Operations setup unavailable.'
                        : response.status === 400 || response.status === 409 ? data?.error || 'Review the record before saving.'
                            : 'Operational updates temporarily unavailable.');
                error.transient = response.status >= 500 && data?.code !== 'SCHEMA_UNAVAILABLE';
                throw error;
            }
            return data;
        } catch (error) {
            if (error.transient === undefined) error.transient = error.name === 'TypeError' || error.name === 'AbortError';
            throw error;
        } finally { clearTimeout(timer); }
    }
    function visible(model) {
        return !document.hidden && model.root.isConnected && model.root.getClientRects().length > 0;
    }
    function changed(a, b) {
        return a.state.revision !== b.state.revision || a.lead.updated_at !== b.lead.updated_at
            || a.installation?.job.updated_at !== b.installation?.job.updated_at
            || a.installation?.order.updated_at !== b.installation?.order.updated_at;
    }
    async function refresh(model) {
        if (model.read || model.saving) return model.read;
        if (model.halted || model.paused || Date.now() < (model.nextReadAt || 0)) return;
        const generation = ++model.generation;
        model.read = (async () => {
            try {
                const next = await request(model);
                if (generation !== model.generation) return;
                model.attempts = 0;
                model.nextReadAt = 0;
                if (model.recoveryTimer) clearTimeout(model.recoveryTimer);
                model.recoveryTimer = null;
                model.latest = next;
                const active = document.activeElement;
                if (model.dirty || (model.root.contains(active) && (active.matches('input,textarea,select') || active.closest('.dashboard-custom-select-shell.is-open')))) {
                    if (model.data && changed(model.data, next)) message(model, 'Updated record available. Your edits are retained; review latest before saving.');
                    else message(model, 'Current record checked. Unsaved edits are retained.');
                    return;
                }
                if (model.signature !== signature(next)) {
                    model.data = next;
                    model.signature = signature(next);
                    render(model);
                } else message(model, '');
            } catch (error) {
                if (generation !== model.generation) return;
                if (!error.transient) model.halted = true;
                else {
                    const delay = recoveryDelays[model.attempts++ || 0];
                    if (delay) {
                        model.nextReadAt = Date.now() + delay;
                        model.recoveryTimer = global.setTimeout(() => {
                            model.recoveryTimer = null;
                            if (visible(model)) refresh(model);
                        }, delay);
                    } else model.paused = true;
                }
                message(model, `${error.message} ${model.data ? 'Showing retained data; edits are safe.' : 'No operational data loaded.'}`);
            } finally { model.read = null; }
        })();
        return model.read;
    }
    const input = (name, title, value, type = 'text', extra = '') => `<label>${escape(title)}<input name="${name}" type="${type}" value="${escape(value)}" ${extra}></label>`;
    const row = (title, value) => `<div><dt>${escape(title)}</dt><dd>${value}</dd></div>`;
    function communications(data) {
        const summary = data.communications;
        if (!summary?.available) return '<p class="commercial-operations-note">Communication records unavailable. No delivery or customer acknowledgement is assumed.</p>';
        const events = summary.events || [];
        const latest = events.slice().sort((a, b) => (Date.parse(b.at || '') || 0) - (Date.parse(a.at || '') || 0))[0];
        const primary = [...new Set([...events.filter(event => event.processingIssue || ['failed','uncertain'].includes(event.result)).slice(0, 2), latest].filter(Boolean))];
        const rest = events.filter(event => !primary.includes(event));
        const render = event => `<li class="commercial-operations-communication">
            <div><strong>${escape(event.purpose)}</strong><span>${escape(event.role)}${event.recipient ? ` · ${escape(event.recipient)}` : ''}</span></div>
            <div><span class="commercial-operations-badge" data-result="${escape(event.result)}">${escape(label(event.result))}</span>
                <time>${escape(event.timeLabel)}: ${escape(date(event.at))}</time><span>${escape(event.receipt)}</span>${event.processingIssue ? `<span>${escape(event.processingIssue)}</span>` : ''}</div></li>`;
        return `<p class="commercial-operations-note">Notification recipients are not assigned installers. Transport status does not establish technician approval or customer acknowledgement.</p>
            <details data-section="routing"><summary>Current notification routing</summary>
                <p class="commercial-operations-note">Technician requests: ${escape(summary.technicianRouting?.available ? summary.technicianRouting.recipients.join(', ') || 'No recipients configured' : 'Configuration unavailable; staff review required')}.
                Staff escalation: ${escape(summary.escalationRecipients?.join(', ') || 'No recipients configured')}. These settings do not prove a send or an installation assignment.</p></details>
            ${!summary.receiptLookupAvailable ? '<p class="commercial-operations-note">Receipt lookup unavailable; only application attempt records are shown.</p>' : ''}
            <ul class="commercial-operations-communications">${primary.map(render).join('') || '<li>No recorded communication attempts.</li>'}</ul>
            ${rest.length ? `<details data-section="communications"><summary>More recorded communications (${rest.length})</summary><ul class="commercial-operations-communications">${rest.map(render).join('')}</ul></details>` : ''}
            ${summary.limited ? '<p class="commercial-operations-note">Latest available records shown; older attempts may exist.</p>' : ''}`;
    }
    function render(model) {
        const { state, lead, staff, history, installation, routing } = model.data;
        const active = model.root.contains(document.activeElement) ? document.activeElement : null;
        const activeSection = active?.closest('details')?.dataset.section;
        const activeForm = active?.closest('form')?.dataset.action;
        const scroller = model.root.closest('.commercial-queue-detail'), scroll = scroller?.scrollTop;
        const viewport = { x: global.scrollX, y: global.scrollY };
        const expanded = new Set(Array.from(model.root.querySelectorAll('details[open]'), node => node.dataset.section));
        const job = installation?.job, order = installation?.order;
        const latestContact = history.find(event => event.payload.contact);
        const overdue = state.disposition !== 'closed' && state.next_follow_up_at && Date.parse(state.next_follow_up_at) < Date.now();
        const assignments = installation?.assignments || [];
        const installerIds = [...new Set(assignments.map(item => item.pro_id))];
        const installer = model.data.installers?.find(person => person.id === installerIds[0]);
        const upcoming = [];
        if (state.disposition !== 'closed' && state.next_follow_up_at) upcoming.push(`<li><strong>${overdue ? 'Overdue customer follow-up' : 'Customer follow-up'}</strong><time>${escape(date(state.next_follow_up_at))}</time></li>`);
        if (['queued','assigned'].includes(job?.status) && job.due_at) upcoming.push(`<li><strong>Installation window</strong><time>${escape(date(job.due_at))} · ${escape(order.delivery_time || '')}</time></li>`);
        if (routing.nextReminderAt) upcoming.push(`<li><strong>Consultation reminder on record</strong><time>${escape(date(routing.nextReminderAt))}</time><span>Existing consultation rules determine whether it runs.</span></li>`);
        const historyItem = event => `<li><strong>${escape(event.action === 'follow_up' && event.payload.contact ? 'Contact attempt recorded' : label(event.action))}</strong>
            <time>${escape(date(event.created_at))} · ${escape(event.actor_name)}</time>
            <span>${escape(event.payload.contact?.note || event.payload.note || (event.action === 'follow_up' ? event.payload.reason || 'Follow-up responsibility and disposition saved.'
                : event.action === 'schedule' ? 'Installation window saved.' : event.action === 'assign' ? `Installer: ${event.payload.proName || 'Existing directory record'}.`
                    : event.action === 'location' ? 'Lead location updated; order address unchanged.' : 'Existing order and installation linked.'))}</span></li>`;
        model.root.innerHTML = `
            <h4 class="commercial-queue-detail__section-title">Operations</h4><p data-operations-status role="status" aria-live="polite"></p>
            <dl class="commercial-operations-facts">
                ${row('Lead', escape(label(state.disposition)))}
                ${row('Responsible', escape(state.responsible_name || 'Not assigned'))}
                ${row('Latest contact', escape(latestContact ? label(latestContact.payload.contact.outcome) : 'No attempt recorded'))}
                ${row('Next action', escape(state.disposition === 'closed' ? 'Lead closed; installation and payment remain separate'
                    : !installation ? 'Follow up; prepare approved quote/payment setup' : 'Follow up or update the installation below'))}
                ${row('Installation', escape(job ? `${label(job.status)}${installerIds.length > 1 ? ' · conflicting assignments — reconcile' : installer ? ` · ${installer.name}` : ' · installer name unavailable'}` : 'No installation linked'))}
                ${row('Payment', installation ? `<strong>${escape(label(installation.payment.status))}</strong> · ${escape(installation.payment.detail)}` : 'Quote/payment setup required. Payment collection is not connected for this lead.')}
                ${order ? row('Existing order', `${escape(order.order_id)} · ${escape(money(order))}`) + row('Work location', escape([order.address,order.city,order.state,order.zip].filter(Boolean).join(', ') || 'Missing — reconcile the existing order address before starting')) : ''}
                ${state.completed_at ? row('Completion recorded', `${escape(date(state.completed_at))} · ${escape(state.completed_by?.name)}. No payout or communication was triggered.`) : ''}
            </dl>
            <details data-section="followup"><summary>Update follow-up</summary>
                <form data-action="follow_up" class="commercial-operations-form">
                    <label>Responsible staff<select name="responsibleId" class="form-select"><option value="">Not assigned</option>
                        ${state.responsible_id && !staff.some(person => person.User_ID === state.responsible_id) ? `<option value="${escape(state.responsible_id)}" selected>${escape(state.responsible_name)} (inactive)</option>` : ''}
                        ${staff.map(person => `<option value="${escape(person.User_ID)}"${person.User_ID === state.responsible_id ? ' selected' : ''}>${escape(person.Display_Name || person.Username)}</option>`).join('')}
                    </select></label>
                    ${input('nextFollowUpAt', 'Next customer follow-up (your local time)', localInput(state.next_follow_up_at), 'datetime-local')}
                    <label>Lead disposition<select name="disposition" class="form-select"><option value="open">Open</option><option value="closed"${state.disposition === 'closed' ? ' selected' : ''}>Closed</option></select></label>
                    ${input('reason', 'Reason (required when closed)', state.disposition_reason || '', 'text', 'maxlength="1000"')}
                    <label class="commercial-operations-wide commercial-operations-check"><input type="checkbox" name="recordContact"> Log a contact attempt — does not send a message</label>
                    <label>Contact channel<select name="channel" class="form-select"><option value="call">Call</option><option value="email">Email</option><option value="sms">Text</option><option value="other">Other</option></select></label>
                    <label>Outcome<select name="outcome" class="form-select">${['no_response','reached','left_message','requested_callback','other'].map(value => `<option value="${value}">${escape(label(value))}</option>`).join('')}</select></label>
                    <label class="commercial-operations-wide">Contact notes<textarea name="note" maxlength="4000" rows="2"></textarea></label>
                    <p class="commercial-operations-note commercial-operations-wide">Lead closure does not complete installation or customer confirmation, or stop consultation reminders. Responsibility grants no access.</p>
                    <button class="btn btn-secondary" type="submit">Save follow-up</button>
                </form>
            </details>
            <details data-section="location"><summary>Edit lead location</summary><form data-action="location" class="commercial-operations-form">
                ${input('address', 'Street address', lead.project_address || '', 'text', 'maxlength="300"')}
                ${input('city', 'City', lead.project_city || '', 'text', 'maxlength="100"')}
                ${input('state', 'State', lead.project_state || '', 'text', 'maxlength="100"')}
                ${input('postalCode', 'Postal code', lead.project_postal_code || '', 'text', 'maxlength="100"')}
                <p class="commercial-operations-note commercial-operations-wide">Updates this lead only; an existing order retains its address.</p><button class="btn btn-tonal" type="submit">Save lead location</button>
            </form></details>
            <section aria-label="Installation and payment" class="commercial-operations-section">
                <h5>Installation actions</h5>
                ${!installation ? `<p class="commercial-operations-note"><strong>Quote/payment setup required.</strong> No order, job or checkout is created here.</p>
                    <details data-section="link"><summary>Link an existing priced installation</summary>
                    <form data-lookup class="commercial-operations-form">${input('orderRef', 'Existing order reference', '', 'text', 'required maxlength="150"')}<button class="btn btn-tonal" type="submit">Find existing order</button></form><div data-candidate></div></details>` : `
                    ${['queued','assigned'].includes(job.status) ? `<details data-section="assign"><summary>Assign existing installer</summary><form data-action="assign" class="commercial-operations-form">
                        <label>Existing active installer<select name="proId" class="form-select" required><option value="">Choose installer</option>${model.data.installers.filter(person => person.name !== 'Name unavailable').map(person => `<option value="${escape(person.id)}">${escape(person.name)}</option>`).join('')}</select></label>
                        <label>Assignment notes<textarea name="note" required maxlength="4000" rows="2"></textarea></label><button class="btn btn-tonal" type="submit">Record assignment</button>
                        <p class="commercial-operations-note commercial-operations-wide">Explicit ADMIN assignment; no technician acceptance, notification or portal action is implied. Conflicting assignments require reconciliation.</p>
                    </form></details>` : ''}
                    <details data-section="schedule"><summary>Set installation window</summary><form data-action="schedule" class="commercial-operations-form">
                        ${input('start', 'Start (your local time)', localInput(job.due_at), 'datetime-local', 'required')}
                        ${input('end', 'End (your local time)', localInput(order.metadata_json?.scheduled_end), 'datetime-local', 'required')}
                        <p class="commercial-operations-note commercial-operations-wide">${escape(Intl.DateTimeFormat().resolvedOptions().timeZone)}. No availability check or customer confirmation.</p>
                        <button class="btn btn-tonal" type="submit"${!['queued','assigned'].includes(job.status) ? ' disabled' : ''}>Save installation window</button>
                    </form></details>
                    ${job.status === 'assigned' ? `<details data-section="start"><summary>Record installation started</summary><form data-action="start" class="commercial-operations-form">
                        <label class="commercial-operations-wide">Start notes<textarea name="note" required maxlength="4000" rows="2"></textarea></label>
                        <p class="commercial-operations-note commercial-operations-wide">Requires a recorded installer, schedule, work address and delivered equipment where ordering is required.</p><button class="btn btn-tonal" type="submit">Record installation started</button>
                    </form></details>` : ''}
                    <details data-section="completion"><summary>Record installation completion</summary><form data-action="complete" class="commercial-operations-form">
                        <label class="commercial-operations-wide">Completion notes<textarea name="note" required maxlength="4000" rows="2"></textarea></label>
                        <p class="commercial-operations-note commercial-operations-wide">Requires in-progress work, recorded assignment, notes and resolved critical flags. Records facts only: no payout, review email, receipt or customer communication.</p>
                        <button class="btn btn-tonal" type="submit"${job.status !== 'in_progress' ? ' disabled' : ''}>Record installation completed</button>
                    </form></details>
                    <details data-section="evidence"><summary>Recorded work evidence (${installation.artifacts.length})</summary><ul>${installation.artifacts.map(asset => {
                        let safe = false;
                        try { safe = new URL(asset.url).protocol === 'https:'; } catch (_) { /* Stored invalid URLs are not made interactive. */ }
                        return `<li>${safe ? `<a href="${escape(asset.url)}" target="_blank" rel="noopener noreferrer">${escape(asset.caption || label(asset.artifact_type))}</a>` : 'Evidence link unavailable'}</li>`;
                    }).join('') || '<li>No evidence attachments recorded. Completion notes are required; this surface does not upload proof.</li>'}</ul></details>`}
            </section>
            <section class="commercial-operations-section" aria-label="Recorded commercial communications"><h5>Communications</h5>${communications(model.data)}</section>
            <section class="commercial-operations-section" aria-label="Activity and upcoming actions"><h5>Upcoming actions</h5>
                <ul class="commercial-operations-timeline commercial-operations-upcoming">${upcoming.join('') || '<li>No dated action recorded.</li>'}</ul>
                <h5>Recorded activity</h5><ol class="commercial-operations-timeline">${history.slice(0, 3).map(historyItem).join('') || '<li>No operational activity recorded.</li>'}</ol>
                ${history.length > 3 ? `<details data-section="history"><summary>Earlier activity (${history.length - 3}${model.data.hasOlderActivity ? '+' : ''})</summary><ol class="commercial-operations-timeline">${history.slice(3).map(historyItem).join('')}</ol></details>` : ''}
            </section>
            <button type="button" class="commercial-operations-review" data-reload>Review latest / discard draft</button>`;
        model.root.querySelectorAll('details').forEach(node => { node.open = expanded.has(node.dataset.section); });
        model.root.querySelectorAll('form').forEach(form => {
            form.oninput = form.onchange = () => { model.dirty = true; };
            form.onsubmit = event => { event.preventDefault(); if (form.hasAttribute('data-lookup')) lookup(model, form); else save(model, form); };
        });
        model.root.querySelector('[data-reload]').onclick = () => {
            if (model.saving || (model.dirty && !global.confirm('Discard unsaved changes and review the latest record?'))) return;
            model.dirty = false;
            model.retry = null;
            if (model.latest) {
                model.data = model.latest;
                model.signature = signature(model.data);
                render(model);
            } else refresh(model);
        };
        if (typeof global.h2sInitDateInputs === 'function') global.h2sInitDateInputs();
        if (active) {
            const target = active.tagName === 'SUMMARY' && activeSection ? model.root.querySelector(`details[data-section="${activeSection}"] > summary`)
                : activeForm ? model.root.querySelector(`form[data-action="${activeForm}"] ${active.name ? `[name="${active.name}"]` : 'button[type="submit"]'}`) : null;
            if (target) target.focus({ preventScroll: true });
        }
        if (scroller) scroller.scrollTop = scroll;
        if (global.scrollY !== viewport.y || global.scrollX !== viewport.x) global.scrollTo({ left: viewport.x, top: viewport.y, behavior: 'instant' });
    }
    async function lookup(model, form) {
        if (model.saving || model.lookingUp) return;
        model.lookingUp = true;
        const generation = ++model.lookupGeneration, button = form.querySelector('button');
        button.disabled = true;
        try {
            const found = await request(model, { orderRef: new FormData(form).get('orderRef') });
            if (generation !== model.lookupGeneration) return;
            model.candidate = found.order;
            const host = model.root.querySelector('[data-candidate]');
            if (!host) return;
            host.innerHTML = `<p class="commercial-operations-note">Candidate only — not linked: ${escape(found.order.order_id)} · ${escape(money(found.order))}</p>
                <form data-action="link" class="commercial-operations-form"><label>Existing installation<select name="jobId" class="form-select" required><option value="">Choose installation</option>${found.jobs.map((job, index) => `<option value="${escape(job.job_id)}">Installation ${index + 1} · ${escape(label(job.status))} · ${escape(date(job.due_at))}</option>`).join('')}</select></label>
                <button class="btn btn-tonal" type="submit"${found.jobs.length ? '' : ' disabled'}>Link existing order and job</button></form>`;
            const link = host.querySelector('form');
            link.onchange = () => { model.dirty = true; };
            link.onsubmit = event => { event.preventDefault(); save(model, link); };
            message(model, found.jobs.length ? 'Candidate only. Choose and explicitly link the existing installation.' : 'No matching installation. Job creation is not connected here.');
        } catch (error) { message(model, error.message); }
        finally { model.lookingUp = false; button.disabled = false; }
    }
    async function save(model, form) {
        if (model.saving || !form.reportValidity()) return;
        const fields = Object.fromEntries(new FormData(form)), action = form.dataset.action;
        let payload;
        try {
            if (action === 'follow_up') {
                payload = { responsibleId: fields.responsibleId, nextFollowUpAt: fields.nextFollowUpAt ? new Date(fields.nextFollowUpAt).toISOString() : '', disposition: fields.disposition, reason: fields.reason };
                if (fields.recordContact) payload.contact = { channel: fields.channel, outcome: fields.outcome, note: fields.note };
                if (fields.recordContact && !fields.note.trim()) throw new Error('Contact notes are required.');
                if (fields.disposition === 'closed' && !fields.reason.trim()) throw new Error('A nonblank closure reason is required.');
            } else if (action === 'location') payload = { ...fields, expectedUpdatedAt: model.data.lead.updated_at };
            else if (action === 'link') payload = { orderId: model.candidate.id, jobId: fields.jobId };
            else payload = {
                ...(action === 'schedule' ? { start: new Date(fields.start).toISOString(), end: new Date(fields.end).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : { note: fields.note, ...(action === 'assign' ? { proId: fields.proId } : {}) }),
                expectedJobUpdatedAt: model.data.installation.job.updated_at, expectedOrderUpdatedAt: model.data.installation.order.updated_at,
            };
        } catch (error) { message(model, error.message); return; }
        const key = JSON.stringify([action, payload, model.data.state.revision]);
        if (!model.retry || model.retry.signature !== key) model.retry = { signature: key, operationId: global.crypto.randomUUID() };
        model.saving = model.dirty = true;
        ++model.generation;
        ++model.lookupGeneration;
        const controls = Array.from(model.root.querySelectorAll('button,input,select,textarea')), disabled = controls.map(node => node.disabled);
        controls.forEach(node => { node.disabled = true; });
        message(model, 'Saving…');
        try {
            const next = await request(model, {}, { leadId: model.id, revision: model.data.state.revision, operationId: model.retry.operationId, action, payload });
            model.data = model.latest = next;
            model.signature = signature(next);
            model.dirty = false;
            model.retry = null;
            render(model);
            message(model, 'Saved. Installation, payment and follow-up remain separate facts.');
        } catch (error) {
            controls.forEach((node, index) => { node.disabled = disabled[index]; });
            message(model, `${error.message} Draft retained. Only an explicit unchanged save reuses the operation key.`);
        } finally { model.saving = false; }
    }
    function resume(model, requireVisible = true) {
            if ((requireVisible && !visible(model)) || model.halted) return;
            if (model.paused && Date.now() - (model.lastRecoveryAt || 0) >= 60000) {
                model.paused = false;
                model.attempts = 0;
                model.lastRecoveryAt = Date.now();
            }
            return refresh(model);
    }
    function returnToView() {
        models.forEach(model => resume(model));
    }
    global.H2SCommercialOperations = {
        mount(host, id, options) {
            const token = options.getToken();
            if (authKey !== token) {
                models.forEach(model => { if (model.recoveryTimer) clearTimeout(model.recoveryTimer); ++model.generation; });
                models.clear();
                authKey = token;
            }
            let model = models.get(id);
            if (!model) {
                model = { id, root: host, options, generation: 0, lookupGeneration: 0, dirty: false, attempts: 0, lastRecoveryAt: Date.now() };
                models.set(id, model);
                host.className = 'commercial-queue-detail__section commercial-operations';
                host.innerHTML = '<h4 class="commercial-queue-detail__section-title">Operations</h4><p data-operations-status role="status">Loading operational details…</p>';
            } else {
                model.options = options;
                const active = model.root.contains(document.activeElement) ? document.activeElement : null;
                if (host !== model.root) host.replaceWith(model.root);
                if (active) active.focus({ preventScroll: true });
            }
            return resume(model, false) || Promise.resolve();
        },
        refresh(id) { const model = models.get(id); return model ? refresh(model) : Promise.resolve(); },
    };
    global.addEventListener('online', returnToView);
    document.addEventListener('visibilitychange', returnToView);
    global.setInterval(() => models.forEach(model => { if (visible(model)) refresh(model); }), 45000);
})(window);
