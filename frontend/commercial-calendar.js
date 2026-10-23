(function (global) {
    'use strict';
    const models = new WeakMap();
    const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
    const date = value => new Date(value).toLocaleString();
    const today = () => {
        const value = new Date();
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    };
    function range(day) {
        const start = new Date(`${day}T00:00`), end = new Date(start);
        end.setDate(end.getDate() + 1);
        if (!Number.isFinite(start.getTime())) throw new Error('Choose a valid calendar day.');
        return { start: start.toISOString(), end: end.toISOString() };
    }
    async function request(model, body) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
        try {
            const query = new URLSearchParams({ ...range(model.day), ...(model.leadId ? { leadId: model.leadId } : {}) });
            const response = await global.fetch(`${model.options.apiBase}/api/commercial-calendar?${query}`, {
                method: body ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal,
                headers: { Authorization: `Bearer ${model.options.getToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Calendar request failed. Review before retrying.');
            return result;
        } finally { clearTimeout(timer); }
    }
    const status = (model, text) => { model.root.querySelector('[data-calendar-status]').textContent = text; };
    function renderAgenda(model) {
        const result = model.data;
        const rows = result.entries.map(entry => `<tr>
            <td>${escape(date(entry.starts_at))}<br>${escape(date(entry.ends_at))}</td>
            <td><button type="button" class="commercial-calendar-open" data-calendar-open="${escape(entry.lead_id)}">${escape(entry.customer)}</button><br><span class="commercial-operations-note">${escape(entry.location || 'Location not recorded')}</span></td>
            <td>${escape(entry.effective_state)}${entry.effective_state === 'tentative' ? `<br>Blocks time until ${escape(date(entry.expires_at))}` : ''}
                ${entry.job_id ? `<br><span class="commercial-operations-note">Job: ${escape(entry.job_status)} · ${entry.preparation.ready ? 'Prep reviewed' : 'Prep blocked'}</span>` : ''}</td>
            </tr>`).join('');
        model.root.querySelector('[data-calendar-entries]').innerHTML = `<div class="commercial-calendar-table"><table>
            <caption>${escape(result.name)} &middot; ${escape(timeZone())}</caption>
            <thead><tr><th scope="col">Start / end</th><th scope="col">Customer / location</th><th scope="col">Status</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3">No time reserved for this day.</td></tr>'}</tbody></table></div>`;
        model.root.querySelectorAll('[data-calendar-open]').forEach(button => {
            button.setAttribute('aria-label', `Open lead and linked job: ${button.textContent}`);
            button.onclick = async () => {
                button.disabled = true;
                try { await model.options.onOpenLead(button.dataset.calendarOpen); }
                catch (error) { status(model, error.message); }
                finally { button.disabled = false; }
            };
        });
    }
    function renderLead(model) {
        const booking = model.data.booking, state = booking?.effective_state;
        const active = state === 'tentative' || state === 'confirmed';
        const actions = !active ? [['hold', 'Hold time'], ['confirm', 'Confirm agreed booking']]
            : state === 'confirmed' ? [['reschedule', 'Reschedule'], ['cancel', 'Cancel booking']]
                : [['confirm', 'Confirm agreed booking'], ['reschedule', 'Reschedule hold'], ['cancel', 'Release hold']];
        model.root.querySelector('[data-calendar-editor]').innerHTML = `
            <p>${booking ? `<strong>${escape(state)}</strong>: ${escape(date(booking.starts_at))} - ${escape(date(booking.ends_at))}
                ${state === 'tentative' ? ` &middot; expires ${escape(date(booking.expires_at))}` : ''}` : 'No installation time reserved.'}</p>
            <form class="commercial-operations-form" data-calendar-form>
                <label>Calendar action<select name="calendarAction" class="form-select">${actions.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label>
                ${model.options.dateInput('calendarStart', `Start (${timeZone()})`, active ? booking.starts_at : '', 'required')}
                ${model.options.dateInput('calendarEnd', `End (${timeZone()})`, active ? booking.ends_at : '', 'required')}
                ${model.options.dateInput('calendarExpiry', `Hold expiry (${timeZone()})`, state === 'tentative' ? booking.expires_at : '')}
                <label class="commercial-operations-wide commercial-operations-check"><input type="checkbox" name="customerAgreed"> Customer agreed to this installation window</label>
                <label class="commercial-operations-wide">Reason / agreement notes<input name="calendarReason" required maxlength="1000"></label>
                <button type="submit" class="commercial-workload-btn">Save calendar action</button>
                <button type="button" class="commercial-workload-btn" data-calendar-discard>Discard calendar draft</button>
            </form>
            <details><summary>Calendar history</summary><ul class="commercial-operations-history">${model.data.history.map(event =>
                `<li><strong>${escape(event.action)}</strong><time>${escape(date(event.created_at))} &middot; ${escape(event.actor_name)}</time>
                <span>${escape(event.after_state.reason)}</span></li>`).join('') || '<li>No calendar changes recorded.</li>'}</ul></details>`;
        const form = model.root.querySelector('[data-calendar-form]');
        if (model.options.readOnly) {
            form.insertAdjacentHTML('beforebegin','<p class="commercial-operations-note">Linked work has started or ended. Its reservation is read-only; lead follow-up and payment tracking remain separate.</p>');
            form.remove();
            return;
        }
        const sync = () => {
            const action = form.elements.calendarAction.value, cancel = action === 'cancel';
            for (const name of ['calendarStart', 'calendarEnd']) form.elements[name].disabled = cancel;
            const expiryRequired = !cancel && (action === 'hold' || action === 'reschedule' && state === 'tentative');
            form.elements.calendarExpiry.disabled = !expiryRequired;
            form.elements.calendarExpiry.required = expiryRequired;
            form.elements.customerAgreed.disabled = cancel || expiryRequired;
            form.elements.customerAgreed.required = !cancel && !expiryRequired;
        };
        sync();
        form.oninput = form.onchange = () => { model.dirty = true; model.options.onDirty(true); sync(); };
        form.onsubmit = event => { event.preventDefault(); save(model, form); };
        model.root.querySelector('[data-calendar-discard]').onclick = () => {
            if (model.saving) return;
            model.dirty = false; model.options.onDirty(false); renderLead(model); load(model);
        };
    }
    async function load(model) {
        if (model.loading || model.saving || model.dirty) return;
        model.loading = true;
        const day = model.day;
        try {
            const result = await request(model);
            if (model.token !== model.options.getToken() || model.dirty || day !== model.day) return;
            model.data = result.calendar;
            if (model.leadId) renderLead(model); else renderAgenda(model);
            status(model, '');
            return true;
        } catch (error) { status(model, `${error.message} ${model.data ? 'Previously loaded calendar retained.' : 'Calendar not loaded.'}`); }
        finally { model.loading = false; if (day !== model.day && model.root.isConnected) load(model); }
    }
    async function save(model, form) {
        if (model.saving || !form.reportValidity()) return;
        let payload;
        const action = form.elements.calendarAction.value;
        try {
            payload = { reason: form.elements.calendarReason.value };
            if (action !== 'cancel') Object.assign(payload, {
                start: model.options.instantValue(form, 'calendarStart'), end: model.options.instantValue(form, 'calendarEnd'),
                expiresAt: form.elements.calendarExpiry.disabled ? '' : model.options.instantValue(form, 'calendarExpiry'),
                customerAgreed: form.elements.customerAgreed.checked, timezone: timeZone(),
            });
        } catch (error) { status(model, error.message); return; }
        const signature = JSON.stringify([action, payload, model.data.booking?.revision || 0]);
        if (model.retry?.signature !== signature) model.retry = { signature, operationId: global.crypto.randomUUID() };
        model.saving = true;
        const controls = Array.from(form.elements), disabled = controls.map(node => node.disabled);
        controls.forEach(node => { node.disabled = true; });
        status(model, 'Saving calendar action...');
        try {
            const saved = await request(model, { leadId: model.leadId, revision: model.data.booking?.revision || 0,
                action, payload, operationId: model.retry.operationId });
            model.data.booking = { ...saved.booking, effective_state: saved.booking.state };
            model.retry = null; model.dirty = false; model.options.onDirty(false);
            model.saving = false;
            const refreshed = await load(model);
            if (refreshed) status(model, 'Calendar saved. No message, payment, assignment or installation start was triggered.');
            else {
                renderLead(model);
                status(model, 'Calendar saved, but latest history could not be reloaded. Refresh to review. No message was triggered.');
            }
            model.options.onActivity();
            const agenda = document.getElementById('commercialCalendar');
            if (agenda && models.has(agenda)) load(models.get(agenda));
        } catch (error) {
            controls.forEach((node, index) => { node.disabled = disabled[index]; });
            status(model, `${error.message} Draft retained; unchanged retry uses the same operation key.`);
        } finally { model.saving = false; }
    }
    function mount(root, options, leadId) {
        if (!root) return;
        const old = models.get(root);
        if (old && old.token === options.getToken()) { old.options = options; return; }
        const model = { root, options, leadId, day: today(), token: options.getToken(), dirty: false };
        models.set(root, model);
        root.innerHTML = `<h4 class="commercial-queue-detail__section-title">${leadId ? 'Installation reservation' : 'Installation agenda'}</h4>
            <p class="commercial-operations-note">One shared calendar. Tentative holds block time until their selected expiry; confirmed bookings reserve time until rescheduled or cancelled.
            Expired and cancelled entries do not block time. No business hours, travel buffers or customer availability are inferred.</p>
            <p role="status" aria-live="polite" data-calendar-status>Loading calendar...</p>
            ${leadId ? '<div data-calendar-editor></div>' : `<form class="commercial-operations-form" data-agenda-day>
                <label>Calendar day (${escape(timeZone())})<input type="date" name="day" required value="${model.day}"></label>
                <button type="submit" class="commercial-workload-btn">Show day / refresh</button></form><div data-calendar-entries></div>`}`;
        if (!leadId) root.querySelector('form').onsubmit = event => {
            event.preventDefault();
            if (!event.target.reportValidity()) return;
            model.day = event.target.elements.day.value;
            load(model);
        };
        load(model);
    }
    global.H2SCommercialCalendar = {
        mountDashboard(root, options) { mount(root, options); },
        mountLead(root, leadId, options) { mount(root, options, leadId); },
        refreshDashboard() {
            const root=document.getElementById('commercialCalendar');
            if (root && models.has(root)) return load(models.get(root));
        },
    };
    global.setInterval(() => {
        if (document.hidden) return;
        const root = document.getElementById('commercialCalendar');
        if (root?.getClientRects().length && models.has(root)) load(models.get(root));
    }, 30000);
})(window);
