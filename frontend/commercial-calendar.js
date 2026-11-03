(function (global) {
    'use strict';
    const models = new WeakMap();
    const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timeZoneLabel = () => new Intl.DateTimeFormat(undefined, {timeZoneName:'longGeneric'}).formatToParts(new Date()).find(part => part.type === 'timeZoneName').value;
    const date = value => !value ? 'Not recorded' : !Number.isFinite(new Date(value).getTime()) ? 'Date needs review' : new Date(value).toLocaleString(undefined,{
        month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'
    });
    const stateLabels = {all:'All states',active:'Blocking time',confirmed:'Confirmed',tentative:'Holds',completed:'Completed',cancelled:'Cancelled',expired:'Expired'};
    const dayLabel = day => new Date(`${day}T12:00`).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
    const clock = value => new Date(value).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
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
    function monthDays(day) {
        const anchor = new Date(`${day}T12:00`);
        anchor.setDate(1);
        anchor.setDate(1 - anchor.getDay());
        return Array.from({ length: 42 }, (_, index) => {
            const date = new Date(anchor);
            date.setDate(anchor.getDate() + index);
            return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
        });
    }
    function visibleRange(model) {
        if (model.leadId || model.view !== 'month') return range(model.day);
        const days=monthDays(model.day);
        return {start:range(days[0]).start,end:range(days[41]).end};
    }
    async function request(model, body) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
        try {
            const query = new URLSearchParams({ ...visibleRange(model), ...(model.leadId ? { leadId: model.leadId } : {}) });
            const response = await global.fetch(`${model.options.apiBase}/api/commercial-calendar?${query}`, {
                method: body ? 'POST' : 'GET', cache: 'no-store', signal: controller.signal, referrerPolicy: 'no-referrer',
                headers: { Authorization: `Bearer ${model.options.getToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
            if (models.get(model.root) !== model || model.authFailed) throw new Error('Calendar session changed. Reopen the workspace.');
            if (response.status === 401 || response.status === 403) {
                model.authFailed = true;
                model.root.querySelectorAll('button, input, select, textarea').forEach(control => { control.disabled = true; });
                model.options.onAuthError?.(response.status);
                throw new Error('Calendar authorization required.');
            }
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || 'Calendar request failed. Review before retrying.');
            return result;
        } finally { clearTimeout(timer); }
    }
    const status = (model, text) => {
        const target = models.get(model.root) === model && model.root.querySelector('[data-calendar-status]');
        if (target) target.textContent = text;
    };
    function renderAgenda(model) {
        const refocus=model.root.querySelector('[data-calendar-selected-heading]')===document.activeElement;
        const result = model.data;
        const entries=result.entries.filter(entry=>(model.market==='all' || entry.market===model.market)
            && (model.stateFilter==='all' || model.stateFilter==='active' && ['tentative','confirmed'].includes(entry.effective_state)
                || entry.effective_state===model.stateFilter));
        if (model.view==='month') renderMonth(model,entries);
        else model.root.querySelector('[data-calendar-entries]').replaceChildren();
        const window=range(model.day), start=Date.parse(window.start), end=Date.parse(window.end);
        const selected=entries.filter(entry=>Date.parse(entry.starts_at)<end && Date.parse(entry.ends_at)>start)
            .sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at));
        const timeLabel=value=>new Date(value).toLocaleDateString()===new Date(`${model.day}T12:00`).toLocaleDateString()
            ? clock(value) : new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
        model.root.querySelector('[data-calendar-entries]').insertAdjacentHTML('beforeend',`
            <section class="commercial-calendar-agenda" aria-label="Selected day reservations">
              <header class="commercial-calendar-agenda-heading">
                <h5 tabindex="-1" data-calendar-selected-heading>${escape(dayLabel(model.day))}</h5>
                <span>${selected.length} ${selected.length===1?'reservation':'reservations'} shown &middot; ${escape(timeZone())}</span>
              </header>
              ${selected.length ? `<ul class="commercial-calendar-agenda-list">${selected.map(entry=>`<li class="commercial-calendar-reservation">
                <div class="commercial-calendar-reservation-top"><strong>${escape(timeLabel(entry.starts_at))} &ndash; ${escape(timeLabel(entry.ends_at))}</strong>
                  <span class="commercial-calendar-reservation-state" data-state="${escape(entry.effective_state)}">${escape(stateLabels[entry.effective_state] || entry.effective_state)}</span></div>
                <strong class="commercial-calendar-customer">${escape(entry.customer)}</strong>
                <span>${entry.market==='residential'?'Residential':'Commercial'} &middot; ${escape(entry.location || 'Location not recorded')}</span>
                ${entry.effective_state==='tentative'?`<span>Hold expires ${escape(date(entry.expires_at))}</span>`:''}
                ${entry.job_id?`<span>Job: ${escape(entry.job_status)} &middot; ${entry.preparation.ready?'Prep reviewed':'Prep blocked'}</span>`:''}
                <button type="button" class="commercial-calendar-open" data-calendar-open="${escape(entry.lead_id)}" data-calendar-customer="${escape(entry.customer)}">${escape(model.options.openLabel || 'Open customer')}</button>
              </li>`).join('')}</ul>` : '<p class="commercial-calendar-empty">No reservations match these filters for this day. This is not a promise of availability; other bookings may still block time.</p>'}
            </section>`);
        bindOpen(model);
        if(refocus)model.root.querySelector('[data-calendar-selected-heading]').focus({preventScroll:true});
    }
    function bindOpen(model) {
        model.root.querySelectorAll('[data-calendar-open]').forEach(button => {
            button.setAttribute('aria-label', `${model.options.openLabel || 'Open lead and linked job'}: ${button.dataset.calendarCustomer || button.textContent}`);
            button.onclick = async () => {
                button.disabled = true;
                try { await model.options.onOpenLead(button.dataset.calendarOpen); }
                catch (error) { status(model, error.message); }
                finally { button.disabled = false; }
            };
        });
    }
    function renderMonth(model,entries) {
        const days=monthDays(model.day), month=model.day.slice(0,7);
        model.root.querySelector('[data-calendar-entries]').innerHTML=`
            <h5 class="commercial-calendar-month-title">${escape(new Date(`${model.day}T12:00`).toLocaleDateString(undefined,{month:'long',year:'numeric'}))}</h5>
            <div class="commercial-calendar-weekdays" aria-hidden="true">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(value=>`<span>${value}</span>`).join('')}</div>
            <div class="commercial-calendar-month" aria-label="Company reservations by day">${days.map(day=>{
                const window=range(day), start=Date.parse(window.start), end=Date.parse(window.end);
                const dayEntries=entries.filter(entry=>Date.parse(entry.starts_at)<end && Date.parse(entry.ends_at)>start);
                return `<section class="commercial-calendar-day${day.slice(0,7)!==month?' is-outside':''}${day===today()?' is-today':''}${day===model.day?' is-selected':''}" aria-label="${escape(day)}">
                    <button type="button" class="commercial-calendar-day-label" data-calendar-day="${day}" aria-pressed="${day===model.day}" ${day===today()?'aria-current="date"':''}
                        aria-label="${escape(dayLabel(day))}, ${dayEntries.length} reservations"><span>${Number(day.slice(-2))}</span>
                        ${dayEntries.length ? `<span class="commercial-calendar-day-count" aria-label="Show ${dayEntries.length} reservations for ${day}">${dayEntries.length}<span> scheduled</span></span>` : ''}
                    </button>
                    ${dayEntries.map(entry=>`<button type="button" class="commercial-calendar-event" data-state="${escape(entry.effective_state)}" data-calendar-open="${escape(entry.lead_id)}">
                        <span>${entry.market==='residential'?'Residential':'Commercial'} &middot; ${escape(entry.effective_state)}</span>
                        <strong>${escape(entry.customer)}</strong><span>${escape(new Date(entry.starts_at).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}))}</span>
                    </button>`).join('')}
                </section>`;
            }).join('')}</div>`;
        model.root.querySelectorAll('[data-calendar-day]').forEach(button=>{button.onclick=()=>{
            const sameMonth=model.day.slice(0,7)===button.dataset.calendarDay.slice(0,7);
            model.day=button.dataset.calendarDay;syncControls(model);
            const reveal=()=>{
                const heading=model.root.querySelector('[data-calendar-selected-heading]');
                heading?.focus({preventScroll:true});
                if(global.matchMedia?.('(max-width: 720px)').matches)model.root.querySelector('.commercial-calendar-agenda')?.scrollIntoView({
                    block:'nearest',behavior:global.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
            };
            if(sameMonth && model.data && !model.loading) {renderAgenda(model);reveal();}
            else load(model).then(loaded=>{if(loaded)reveal();});
        };});
    }
    function syncControls(model) {
        model.root.querySelectorAll('[data-calendar-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.calendarView===model.view)));
        model.root.querySelectorAll('[data-calendar-market]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.calendarMarket===model.market)));
        model.root.querySelectorAll('[data-calendar-state-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.calendarStateChoice===model.stateFilter)));
        const summary=model.root.querySelector('[data-calendar-filter-summary]');
        summary.textContent=`Filters: ${model.market==='all'?'Both markets':model.market==='residential'?'Residential':'Commercial'} · ${stateLabels[model.stateFilter]}`;
        model.root.querySelectorAll('[data-calendar-shift]').forEach(button=>button.setAttribute('aria-label',
            `${Number(button.dataset.calendarShift)<0?'Previous':'Next'} ${model.view==='month'?'month':'day'}`));
        const input=model.root.querySelector('[name=day]');
        if (input._flatpickr) input._flatpickr.setDate(model.day,false); else input.value=model.day;
    }
    function renderLead(model) {
        const booking = model.data.booking, state = booking?.effective_state;
        const active = state === 'tentative' || state === 'confirmed';
        const actions = !active ? [['hold', 'Hold time'], ['confirm', 'Confirm booking']]
            : state === 'confirmed' ? [['reschedule', 'Reschedule'], ['cancel', 'Cancel booking']]
                : [['confirm', 'Confirm booking'], ['reschedule', 'Reschedule hold'], ['cancel', 'Release hold']];
        const actionLabels = {hold:'Time held',confirm:'Booking confirmed',reschedule:'Time changed',cancel:'Booking cancelled',expire:'Hold expired'};
        const historyItem = event => `<li><strong>${escape(actionLabels[event.action] || String(event.action || 'Calendar updated').replace(/_/g, ' '))}</strong>
            <time>${escape(date(event.created_at))} &middot; ${escape(event.actor_name || 'System')}</time>
            <span>${escape(event.after_state?.reason || 'No note recorded.')}</span></li>`;
        const history = `<ol class="commercial-operations-timeline">${model.data.history.map(historyItem).join('') || '<li>No calendar changes recorded.</li>'}</ol>`;
        if (model.options.historyRoot) model.options.historyRoot.innerHTML = history;
        model.root.querySelector('[data-calendar-editor]').innerHTML = `
            ${model.options.focused ? '' : `<div class="commercial-calendar-current" data-state="${escape(state || 'unbooked')}">
                <strong>${escape(state === 'confirmed' ? 'Confirmed installation' : state === 'tentative' ? 'Tentative hold · needs confirmation' : 'No installation time reserved')}</strong>
                ${booking ? `<span>${active ? '' : `${escape(stateLabels[state] || state)} window: `}${escape(date(booking.starts_at))} &ndash; ${escape(date(booking.ends_at))}</span>
                ${state === 'tentative' ? `<span>Hold expires ${escape(date(booking.expires_at))}</span>` : ''}` : ''}
            </div>`}
            <form class="commercial-operations-form" data-calendar-form>
                <div class="commercial-operations-wide commercial-calendar-actions" role="group" aria-label="Calendar action">
                    ${actions.map(([value, text]) => `<button type="button" class="commercial-workload-btn" data-calendar-action="${value}" aria-pressed="false">${text}</button>`).join('')}
                </div>
                <select name="calendarAction" hidden data-custom-select="off" aria-label="Calendar action">${actions.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select>
                <p class="commercial-operations-wide commercial-calendar-zone">Times shown in ${escape(timeZoneLabel())}.</p>
                ${model.options.dateInput('calendarStart', 'Start', active ? booking.starts_at : '', 'required')}
                ${model.options.dateInput('calendarEnd', 'End', active ? booking.ends_at : '', 'required')}
                ${model.options.dateInput('calendarExpiry', 'Hold expires', state === 'tentative' ? booking.expires_at : '')}
                <label class="commercial-operations-wide commercial-operations-check"><input type="checkbox" name="customerAgreed"> Customer agreed to this installation window</label>
                <label class="commercial-operations-wide">Reason / agreement notes<textarea name="calendarReason" required maxlength="1000" rows="2"></textarea></label>
                <div class="commercial-form-actions"${model.options.focused ? ' hidden' : ''}>
                    <button type="submit" class="commercial-workload-btn commercial-action-primary" ${model.options.focused ? 'hidden' : ''}>Save calendar action</button>
                    <button type="button" class="commercial-workload-btn" data-calendar-discard aria-label="Discard unsaved calendar changes" ${model.options.focused ? 'hidden' : ''}>Cancel changes</button>
                </div>
            </form>
            ${model.options.historyRoot ? '' : `<section class="commercial-calendar-activity" aria-label="Calendar activity"><h5>Calendar activity</h5>${history}</section>`}`;
        const form = model.root.querySelector('[data-calendar-form]');
        if (model.options.defaultAction && [...form.elements.calendarAction.options].some(option => option.value === model.options.defaultAction)) {
            form.elements.calendarAction.value = model.options.defaultAction;
        }
        if (model.options.readOnly) {
            form.insertAdjacentHTML('beforebegin','<p class="commercial-operations-note">Linked work has started or ended. Its reservation is read-only; lead follow-up and payment tracking remain separate.</p>');
            form.remove();
            return;
        }
        const sync = () => {
            const action = form.elements.calendarAction.value, cancel = action === 'cancel';
            for (const name of ['calendarStart', 'calendarEnd']) {
                form.elements[name].disabled = cancel;
                form.elements[name].closest('label').hidden = cancel;
            }
            const expiryRequired = !cancel && (action === 'hold' || action === 'reschedule' && state === 'tentative');
            form.elements.calendarExpiry.disabled = !expiryRequired;
            form.elements.calendarExpiry.required = expiryRequired;
            form.elements.customerAgreed.disabled = cancel || expiryRequired;
            form.elements.customerAgreed.required = !cancel && !expiryRequired;
            form.elements.calendarExpiry.closest('label').hidden = !expiryRequired;
            form.elements.customerAgreed.closest('label').hidden = cancel || expiryRequired;
            form.querySelectorAll('[data-calendar-action]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.calendarAction === action)));
            form.querySelector('[type=submit]').textContent = {hold:'Save hold',confirm:'Confirm booking',reschedule:'Save changed time',cancel:state === 'tentative' ? 'Release hold' : 'Cancel booking'}[action];
        };
        sync();
        form.oninput = form.onchange = () => { model.dirty = true; model.options.onDirty(true); sync(); };
        form.querySelectorAll('[data-calendar-action]').forEach(button => {
            button.onclick = () => {
                form.elements.calendarAction.value = button.dataset.calendarAction;
                form.elements.calendarAction.dispatchEvent(new Event('change', {bubbles:true}));
            };
        });
        form.onsubmit = event => { event.preventDefault(); save(model, form); };
        model.root.querySelector('[data-calendar-discard]').onclick = () => {
            if (model.saving) return;
            model.dirty = false; model.options.onDirty(false); renderLead(model); load(model);
        };
    }
    async function load(model) {
        if (model.loading || model.saving || model.dirty || model.authFailed) return;
        model.loading = true;
        const day = model.day, view=model.view;
        try {
            const result = await request(model);
            if (models.get(model.root) !== model || model.authFailed || model.token !== model.options.getToken() || model.dirty || day !== model.day || view!==model.view) return;
            model.data = result.calendar;
            if (model.leadId) renderLead(model); else renderAgenda(model);
            model.snapshot = { available:true, data:model.data };
            model.options.onSnapshot?.(model.snapshot);
            status(model, !model.leadId && !model.root.querySelector('[name=day]').value
                ? 'Choose a calendar day. The previously selected calendar is still shown.' : '');
            return true;
        } catch (error) {
            status(model, `${error.message} ${model.data ? 'Previously loaded calendar retained.' : 'Calendar not loaded.'}`);
            model.snapshot = { available:false, data:model.data || null, error:error.message };
            model.options.onSnapshot?.(model.snapshot);
        }
        finally { model.loading = false; model.options.onStateChange?.(); if ((day !== model.day || view!==model.view) && model.root.isConnected) load(model); }
    }
    async function save(model, form) {
        if (model.saving || model.authFailed || !form.reportValidity()) return;
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
        model.options.onStateChange?.();
        try {
            const saved = await request(model, { leadId: model.leadId, revision: model.data.booking?.revision || 0,
                action, payload, operationId: model.retry.operationId });
            model.data.booking = { ...saved.booking, effective_state: saved.booking.state };
            model.retry = null; model.dirty = false; model.options.onDirty(false);
            model.saving = false;
            const refreshed = await load(model);
            const notices = saved.notifications;
            const message = notices?.needsReview ? 'Calendar saved. Notification delivery/history needs staff review; do not resend automatically.'
                : notices?.enabled ? 'Calendar saved. Due notifications processed; provider acceptance is not delivery. Future reminders remain subject to current booking and consent.'
                : 'Calendar saved. Automatic notifications are disabled. No payment, assignment or installation start was triggered.';
            if (refreshed) status(model, message);
            else {
                if (!model.authFailed && models.get(model.root) === model) renderLead(model);
                status(model, `${message} Latest history could not be reloaded; refresh to review.`);
            }
            model.options.onActivity({ message, booking: saved.booking, historyLoaded: !!refreshed, notifications: notices });
            const agenda = document.getElementById('commercialCalendar');
            if (agenda && models.has(agenda)) load(models.get(agenda));
        } catch (error) {
            if (!model.authFailed && models.get(model.root) === model) controls.forEach((node, index) => { node.disabled = disabled[index]; });
            status(model, `${error.message} Draft retained; unchanged retry uses the same operation key.`);
        } finally { model.saving = false; model.options.onStateChange?.(); }
    }
    function mount(root, options, leadId) {
        if (!root) return;
        const old = models.get(root);
        if (old && !old.authFailed && old.token === options.getToken()) {
            old.options = options;
            if (old.snapshot) options.onSnapshot?.(old.snapshot);
            if (!leadId && options.market !== undefined && old.market !== options.market) {
                old.market = options.market;syncControls(old);
                if (old.data && !old.loading) renderAgenda(old);
            }
            return;
        }
        const model = { root, options, leadId, day: today(), view:'month',market:options.market || 'all',stateFilter:'all',token: options.getToken(), dirty: false };
        models.set(root, model);
        root.classList.add('commercial-calendar');
        root.classList.toggle('commercial-calendar--editor',!!leadId);
        root.innerHTML = `${options.focused ? '' : `<h4 class="commercial-queue-detail__section-title">${leadId ? 'Installation reservation' : 'Company calendar'}</h4>`}
            <p class="commercial-operations-note">${leadId?'Confirm only a time agreed with the customer. Holds are tentative.':`Saved reservations across residential and commercial. Times shown in ${escape(timeZoneLabel())}.`}</p>
            <p role="status" aria-live="polite" data-calendar-status>Loading calendar...</p>
            ${leadId ? '<div data-calendar-editor></div>' : `<form class="commercial-operations-form" data-agenda-day>
                <label>Go to date<input type="date" name="day" required value="${model.day}"></label>
                <button type="button" class="commercial-workload-btn" data-calendar-shift="-1" aria-label="Previous month or day">Prev</button>
                <button type="button" class="commercial-workload-btn" data-calendar-shift="1" aria-label="Next month or day">Next</button></form>
                <div class="commercial-calendar-controls" role="group" aria-label="Calendar view">
                  <button type="button" class="commercial-workload-btn" data-calendar-view="month">Month</button>
                  <button type="button" class="commercial-workload-btn" data-calendar-view="agenda">Day agenda</button>
                </div>
                <section class="commercial-calendar-filters" aria-label="Visible calendar filters"><p class="commercial-operations-note" data-calendar-filter-summary></p>
                <select data-calendar-state data-custom-select="off" hidden aria-hidden="true" tabindex="-1">${Object.entries(stateLabels).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select>
                <div class="commercial-calendar-controls" role="group" aria-label="Reservation status filter">
                  ${Object.entries(stateLabels).map(([value,label])=>`<button type="button" class="commercial-workload-btn" data-calendar-state-choice="${value}">${label}</button>`).join('')}
                </div>
                <div class="commercial-calendar-controls" role="group" aria-label="Calendar market filter" ${options.market === undefined ? '' : 'hidden'}>
                  <button type="button" class="commercial-workload-btn" data-calendar-market="all">Both markets</button>
                  <button type="button" class="commercial-workload-btn" data-calendar-market="residential">Residential</button>
                  <button type="button" class="commercial-workload-btn" data-calendar-market="commercial">Commercial</button>
                </div></section>
                <p class="commercial-calendar-mobile-hint commercial-operations-note">Tap a date. Its reservations appear below the month.</p>
                <div data-calendar-entries></div>`}`;
        if (!options.focused && !leadId) root.insertAdjacentHTML('beforeend',`<div class="commercial-calendar-help">
            <p class="commercial-operations-note">Holds block time until expiry. Confirmed bookings reserve time until rescheduled or cancelled. Expired and cancelled entries do not block time.
            Filters change visibility, not capacity. Travel, business hours and availability are not inferred.</p></div>`);
        if (!leadId) {
            const form = root.querySelector('[data-agenda-day]'), dayInput = form.elements.day;
            const changeDay = () => {
                if (!dayInput.value || !dayInput.validity.valid) {
                    status(model, 'Choose a calendar day. The previously selected calendar is still shown.');
                    return;
                }
                if (model.day === dayInput.value) { status(model, ''); return; }
                model.day = dayInput.value;
                load(model);
            };
            dayInput.addEventListener('change', changeDay);
            form.onsubmit = event => { event.preventDefault(); changeDay(); };
            root.querySelector('[data-calendar-state]').onchange = event => {
                model.stateFilter=event.target.value;
                syncControls(model);
                if (model.data && !model.loading) renderAgenda(model);
            };
            root.querySelectorAll('[data-calendar-state-choice]').forEach(button=>{button.onclick=()=>{
                const select=root.querySelector('[data-calendar-state]');
                select.value=button.dataset.calendarStateChoice;select.dispatchEvent(new Event('change'));
            };});
            root.querySelectorAll('[data-calendar-view]').forEach(button=>{button.onclick=()=>{
                model.view=button.dataset.calendarView;syncControls(model);load(model);
            };});
            root.querySelectorAll('[data-calendar-market]').forEach(button=>{button.onclick=()=>{
                model.market=button.dataset.calendarMarket;syncControls(model);
                if (model.data && !model.loading) renderAgenda(model);
            };});
            root.querySelectorAll('[data-calendar-shift]').forEach(button=>{button.onclick=()=>{
                const next=new Date(`${model.day}T12:00`);
                if (model.view==='month') {next.setDate(1);next.setMonth(next.getMonth()+Number(button.dataset.calendarShift));}
                else next.setDate(next.getDate()+Number(button.dataset.calendarShift));
                model.day=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`;
                syncControls(model);load(model);
            };});
            syncControls(model);
            global.h2sInitDateInputs?.(root);
        }
        load(model);
    }
    global.H2SCommercialCalendar = {
        mountDashboard(root, options) { mount(root, options); },
        mountLead(root, leadId, options) { mount(root, options, leadId); },
        refreshLead(root) { const model = models.get(root); return model ? load(model) : Promise.resolve(); },
        leadState(root) {
            const model = models.get(root);
            return { ready: !!model?.data && !model.authFailed, saving: !!model?.saving, retry: !!model?.retry };
        },
        discardLead(root) {
            const model = models.get(root);
            if (!model?.data || model.saving || model.authFailed) return false;
            model.retry = null; model.dirty = false;
            renderLead(model); model.options.onDirty(false); load(model);
            return true;
        },
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
