(function (global) {
    'use strict';
    const models = new Map(), recoveryDelays = [2000, 5000, 15000];
    let authKey = '';
    const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const date = value => !value ? 'Not recorded' : !Number.isFinite(new Date(value).getTime()) ? 'Date needs review'
        : new Date(value).toLocaleString(undefined, {month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
    const views = {overview:'Overview',followup:'Follow-up',schedule:'Schedule',installation:'Installation',records:'Records',activity:'Activity'};
    function showView(model, view) {
        if (!views[view]) throw new Error('Unknown lead workspace view.');
        model.view = view;
        model.root.querySelectorAll('[data-operations-view]').forEach(panel => {
            panel.id = `commercial-view-${model.id}-${panel.dataset.operationsView}`;
            panel.hidden = panel.dataset.operationsView !== view;
        });
        model.root.querySelectorAll('[data-operations-view-choice]').forEach(button => {
            button.setAttribute('aria-pressed',String(button.dataset.operationsViewChoice === view));
            button.setAttribute('aria-controls',`commercial-view-${model.id}-${button.dataset.operationsViewChoice}`);
        });
        const detail = model.root.closest('.commercial-queue-detail');
        if (detail) {
            detail.dataset.recordView = view;
            detail.querySelectorAll('[data-record-context]').forEach(panel => {
                panel.hidden = panel.dataset.recordContext !== view && !(view === 'overview' && panel.dataset.recordContext === 'followup');
            });
        }
        model.root.querySelectorAll('input').forEach(input => {
            if (input._flatpickr?.isOpen && input.closest('[hidden]')) input._flatpickr.close();
        });
        if (view === 'installation' && model.locationOpen) model.address?.activate?.();
    }
    const label = value => String(value || '').replace(/_/g, ' ');
    const signature = value => JSON.stringify(value, (key, item) => key === 'checkedAt' ? undefined : item);
    const localInput = value => {
        if (!value) return '';
        const instant = new Date(value);
        if (!Number.isFinite(instant.getTime())) throw new Error('Saved date is invalid; review the record before editing.');
        return new Date(instant.getTime() - instant.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    function instantValue(form, name) {
        const node = form.elements.namedItem(name), value = node.value;
        if (!value) return '';
        if (value === node.dataset.localValue && node.dataset.instant) return node.dataset.instant;
        const instant = new Date(value);
        if (!Number.isFinite(instant.getTime()) || localInput(instant) !== value) {
            throw new Error(`This local time does not exist in ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Choose a valid time.`);
        }
        for (let delta = -180; delta <= 180; delta += 15) {
            if (delta && localInput(new Date(instant.getTime() + delta * 60000)) === value) {
                throw new Error('This time occurs twice during a timezone clock change. Choose an unambiguous time; unchanged saved times retain their original instant.');
            }
        }
        return instant.toISOString();
    }
    const dateInput = (name, title, value, extra = '') => input(name, title, localInput(value), 'datetime-local',
        `data-instant="${escape(value || '')}" data-local-value="${escape(localInput(value))}" ${extra}`);
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
                model.operationsError = '';
                const active = document.activeElement;
                if (model.dirty || model.businessDirty || model.calendarDirty
                    || Array.from(model.root.querySelectorAll('input[data-h2s-date-bound]')).some(input => input._flatpickr?.isOpen)
                    || (model.root.contains(active) && (active.matches('input,textarea,select') || active.closest('.dashboard-custom-select-shell.is-open')))) {
                    if (model.data && changed(model.data, next)) message(model, 'Updated record available. Your edits are retained; review latest before saving.');
                    else message(model, 'Current record checked. Unsaved edits are retained.');
                    renderOverview(model);
                    return;
                }
                if (model.signature !== signature(next)) {
                    model.data = next;
                    model.signature = signature(next);
                    render(model);
                } else { message(model, ''); renderOverview(model); }
                global.H2SCommercialBusiness?.refresh?.(model.id);
                global.H2SCommercialCalendar?.refreshLead?.(model.root.querySelector('[data-installation-reservation]'));
            } catch (error) {
                if (generation !== model.generation) return;
                model.operationsError = error.message;
                renderOverview(model);
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
    function orderScope(order) {
        let items=order.items;
        if (typeof items==='string' && items.trim().startsWith('[')) {
            try {items=JSON.parse(items);}
            catch (error) {console.error('Recorded job scope format needs review',error);return 'Recorded order items could not be read; review the existing order before acknowledging scope.';}
        }
        if (Array.isArray(items)) return items.map(item=>{
            if (!item || typeof item!=='object') return 'Order item needs review';
            const name=[item.service_name,item.name,item.description].find(value=>typeof value==='string'&&value.trim()) || 'Order item needs review';
            const raw=item.quantity ?? item.qty,quantity=typeof raw==='number'||typeof raw==='string'&&raw.trim()?Number(raw):NaN;
            return `${name}${raw==null?'':Number.isFinite(quantity)&&quantity>0?` (quantity ${quantity})`:' (quantity needs review)'}`;
        }).join('; ');
        return typeof items==='string'?items:items?'Recorded order items need review.':'';
    }
    function communications(data) {
        const summary = data.communications;
        if (!summary?.available) return '<p class="commercial-operations-note">Communication records unavailable. No delivery or customer acknowledgement is assumed.</p>';
        const events = summary.events || [];
        const latest = events.slice().sort((a, b) => (Date.parse(b.at || '') || 0) - (Date.parse(a.at || '') || 0))[0];
        const primary = [...new Set([...events.filter(event => event.processingIssue || ['failed','uncertain'].includes(event.result)).slice(0, 2), latest].filter(Boolean))];
        const rest = events.filter(event => !primary.includes(event));
        const receipts = {
            'Signed provider update received. Not proof of reading, approval or customer acknowledgement.':'Signed provider receipt',
            'Delivery recorded; receipt timestamp unavailable.':'Delivery recorded; receipt time unavailable',
            'Recorded failure; delivery is not confirmed.':'Recorded failure; delivery unconfirmed',
            'No delivery receipt recorded; this does not establish failure.':'No delivery receipt; failure not established',
        };
        const render = event => `<li class="commercial-operations-communication">
            <div class="commercial-communication-head"><strong>${escape(event.purpose)}</strong><span class="commercial-operations-badge" data-result="${escape(event.result)}">${escape(event.statusLabel || label(event.result))}</span></div>
            <div class="commercial-communication-meta"><span>${escape(event.role)}${event.recipient ? ` · ${escape(event.recipient)}` : ''}</span>
                <time>${escape(event.timeLabel)}: ${escape(date(event.at))}</time></div>
            <span>${escape(receipts[event.receipt] || event.receipt)}</span>
            ${event.processingIssue ? `<span role="alert">${escape(event.processingIssue)}</span>` : ''}
            ${event.errorCode || event.errorMessage ? `<span role="alert">${escape([event.errorCode,event.errorMessage].filter(Boolean).join(' · '))}</span>` : ''}</li>`;
        return `<p class="commercial-operations-note">Delivery is transport evidence, not reading, approval or customer acknowledgement. Provider acceptance is not delivery. Notification recipients are not assigned installers.</p>
            ${!summary.receiptLookupAvailable ? '<p class="commercial-operations-note">Receipt lookup unavailable; only application attempt records are shown.</p>' : ''}
            <ul class="commercial-operations-communications">${[...primary,...rest].map(render).join('') || '<li>No recorded communication attempts.</li>'}</ul>
            ${summary.limited ? '<p class="commercial-operations-note">Latest available records shown; older attempts may exist.</p>' : ''}
            <section class="commercial-operation-block" data-section="sms-history"><h5>Customer SMS conversation</h5>
                <p class="commercial-operations-note">Shared phone conversation; may include other projects. Loading sends nothing. New sends stay in Messages with existing consent protections.</p>
                <button type="button" class="commercial-workload-btn" data-load-sms>Load latest SMS history</button>
                <div data-sms-history role="status" aria-live="polite"></div></section>
            <section class="commercial-operation-block" data-section="routing"><h5>Commercial notification routes · read-only</h5>
                <dl class="commercial-operations-facts">
                    ${row('Technician requests',escape(summary.technicianRouting?.available ? summary.technicianRouting.recipients.join(', ') || 'No recipients configured' : 'Configuration unavailable; staff review required'))}
                    ${row('Staff escalation',escape(summary.escalationRecipients?.join(', ') || 'No recipients configured'))}
                </dl><p class="commercial-operations-note">These are not installer assignments. The Queue's Owner alert number setting controls Residential alerts only.</p></section>`;
    }
    async function loadSharedSms(model, button) {
        const host=model.root.querySelector('[data-sms-history]'),phone=model.data.lead.phone,token=model.options.getToken();
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
        button.disabled=true;host.textContent='Loading existing SMS history...';
        try {
            const query=new URLSearchParams({action:'smsMessages',contact_phone:phone,limit:'20'});
            const response=await global.fetch(`${model.options.apiBase}/api/v1?${query}`,{
                cache:'no-store',signal:controller.signal,headers:{Authorization:`Bearer ${token}`},
            });
            if (token!==model.options.getToken() || host!==model.root.querySelector('[data-sms-history]')) return;
            if (response.status===404) {host.textContent='No existing SMS thread found for this phone. No message was sent.';return;}
            const result=await response.json();
            if (token!==model.options.getToken() || host!==model.root.querySelector('[data-sms-history]')) return;
            if (!response.ok || !result.ok || !Array.isArray(result.messages)
                || String(result.thread?.contact_phone || '').replace(/\D/g,'')!==String(phone || '').replace(/\D/g,'')) {
                throw new Error('Shared SMS history could not be verified. Use Messages to review the conversation.');
            }
            host.innerHTML=`<ul class="commercial-operations-history">${result.messages.map(item=>`<li>
                <strong>${String(item.direction).toUpperCase()==='INBOUND'?'Received SMS':String(item.direction).toUpperCase()==='OUTBOUND'?'Outbound SMS':'SMS (direction unavailable)'} · ${escape(label(item.status || 'status unavailable'))}</strong>
                <time>${escape(date(item.created_at))}</time><span>${escape(item.body)}</span></li>`).join('') || '<li>No messages returned for this existing thread.</li>'}</ul>
                ${result.page?.has_more?'<p class="commercial-operations-note">Showing the latest 20. Older history remains in Messages.</p>':''}`;
        } catch (error) {
            console.error('Commercial shared SMS read unavailable',error);
            host.textContent=`${error.message} No message was sent.`;
        } finally {clearTimeout(timer);button.disabled=false;}
    }
    function renderOverview(model) {
        const host = model.root.querySelector('[data-customer-overview]');
        if (!host || !model.data) return;
        const data = model.latest || model.data, {lead, state, installation, routing} = data;
        const job = installation?.job, booking = model.calendarSnapshot?.data?.booking;
        const calendarKnown = model.calendarSnapshot?.available === true;
        const recordsKnown = model.businessSnapshot?.available === true;
        const quote = recordsKnown ? model.businessSnapshot.data.quote : null;
        const bookingActive = calendarKnown && ['tentative','confirmed'].includes(booking?.effective_state);
        const latestContact = data.history.find(event => event.payload.contact);
        const held = state.disposition !== 'closed' && Date.parse(state.hold_until || '') > Date.now();
        const followUpDue = state.disposition !== 'closed' && state.next_follow_up_at
            && Date.parse(state.next_follow_up_at) <= Date.now() && !(data.followUp?.mode === 'automatic' && data.followUp.completed);
        let next;
        if (model.operationsError) next = ['activity','Verify customer state',`${model.operationsError} Previously loaded facts are retained; review latest before acting.`];
        else if (['completed','done'].includes(job?.status)) next = ['activity','Review completed work','Completion is already recorded. Review proof and activity; do not create another installation.'];
        else if (job?.status === 'in_progress') next = ['installation','Review work in progress','Use the linked job for progress, proof and guarded completion.'];
        else if (job?.status === 'cancelled') next = ['installation','Review cancelled installation','The existing installation is cancelled. Review the record before arranging further work.'];
        else if (state.disposition === 'closed') next = ['activity','Review closed customer record','Sales follow-up is closed. Existing reservations, installation and payment remain separate.'];
        else if (held) next = ['followup','Review customer hold',`Sales follow-up is held until ${date(state.hold_until)}. Existing appointments remain in place.`];
        else if (state.sales_chasing_paused) next = ['followup','Review paused follow-up','Sales chasing is paused. Review the saved reason before contacting the customer; existing bookings are unchanged.'];
        else if (!calendarKnown) next = ['schedule','Review installation timing',model.calendarSnapshot
            ? 'Calendar could not be verified. Do not treat unavailable data as an empty schedule.'
            : 'Loading the saved reservation. No appointment is assumed from the inquiry.'];
        else if (bookingActive && booking.effective_state === 'tentative') next = ['schedule','Review tentative hold','Time is held, not confirmed. Confirm only after the customer agrees; otherwise change or release the hold.'];
        else if (bookingActive && !installation) next = ['installation','Link the booked installation','A confirmed reservation exists, but no installation order/job is linked. Link the intended existing job; do not book the customer again.'];
        else if (bookingActive && new Set(installation.assignments.map(item => item.pro_id)).size > 1) next = ['installation','Reconcile installer assignments','More than one installer is recorded for this job. Reconcile the existing assignments before starting work.'];
        else if (bookingActive && installation.preparation?.ready && !installation.assignments.length) next = ['installation','Assign an installer','The booking and preparation are recorded, but no active installer assignment exists. Choose the intended installer explicitly.'];
        else if (bookingActive && installation.preparation?.ready && installation.payment.status !== 'paid') next = ['installation','Review payment evidence',installation.payment.detail || 'Payment is not verified as paid. Review the existing payment platform before starting.'];
        else if (bookingActive) next = ['installation',installation.preparation?.ready ? 'Review installation readiness' : 'Resolve installation blockers',
            installation.preparation?.ready ? 'Preparation is reviewed. Use the existing job and verify assignment and payment before starting.'
                : (installation.preparation?.blockers || []).join('; ') || 'Review scope, materials and site access for the linked job.'];
        else if (followUpDue) next = ['followup','Complete the due follow-up',`${data.followUp?.reason || state.disposition_reason || 'Saved customer follow-up'} · ${date(state.next_follow_up_at)}. Contact logging does not send a message.`];
        else if (state.next_follow_up_at && Date.parse(state.next_follow_up_at) > Date.now() && !data.followUp?.completed) next = ['followup','Review scheduled follow-up',`The next follow-up is set for ${date(state.next_follow_up_at)}. Respect the saved timing rather than starting another contact attempt now.`];
        else if (!recordsKnown) next = ['records','Review saved quote',model.businessSnapshot
            ? 'Business records could not be verified. Do not recreate a quote based on an unavailable record.'
            : 'Loading saved business records before recommending a quote action.'];
        else if (quote?.amountCents && quote.status !== 'accepted') next = ['records','Review quote and customer approval',`Saved quote: ${label(quote.status || 'draft')}. Approval must be supported by recorded customer agreement.`];
        else if (quote?.amountCents && !installation) next = ['installation','Link the agreed installation','An accepted quote is recorded. Link its intended existing installation order/job; approval does not create one automatically.'];
        else if (installation || quote?.amountCents) next = ['schedule','Arrange installation time','No active installation reservation is recorded. Agree a time with the customer and check the shared calendar before confirming.'];
        else if (latestContact) next = ['records','Review scope and prepare quote','Use the saved request and contact history. No approved quote or installation price is inferred.'];
        else next = ['followup','Review request and contact customer',`Use the saved ${label(lead.contact_preference || 'contact')} preference to clarify scope and timing. A request is not an approved quote or booking.`];
        const bookingText = !calendarKnown ? model.calendarSnapshot ? 'Unavailable — review Schedule' : 'Loading saved reservation'
            : booking ? `${label(booking.effective_state)} · ${date(booking.starts_at)} – ${date(booking.ends_at)}`
                : 'No installation time reserved';
        const quoteText = !recordsKnown ? model.businessSnapshot ? 'Unavailable — review Records' : 'Loading saved records'
            : quote?.amountCents ? `${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(quote.amountCents / 100)} · ${label(quote.status || 'draft')}`
                : 'No quote recorded';
        const intake = model.options.intake;
        const assignments = installation?.assignments || [];
        const installerNames = [...new Set(assignments.map(item => item.pro_id))].map(id =>
            data.installers?.find(person => person.id === id)?.name || 'Recorded installer — name unavailable');
        const restoreFocus = host.contains(document.activeElement);
        host.innerHTML = `<p class="commercial-operations-note">Populated from saved intake, calendar, job and business records. Opening this record does not book, charge, assign or complete work.</p>
            <dl class="commercial-operations-facts">
                ${intake?.scopeSummary ? row('Customer request',escape(intake.scopeSummary)) : ''}
                ${row('Contact preference',escape(`${label(lead.contact_preference || 'Not recorded')}${lead.phone ? ` · ${lead.phone}` : ''}`))}
                ${row('Work location',escape([lead.project_address,lead.project_city,lead.project_state,lead.project_postal_code].filter(Boolean).join(', ') || 'Not provided — clarify before installation'))}
                ${row('Follow-up review',escape(label(routing.consultationStatus || 'Not recorded') + ' — not an installation reservation'))}
                ${row('Installation reservation',escape(bookingText))}
                ${row('Quote',escape(quoteText))}
                ${row('Linked installation',escape(job ? `${installation.order.order_id} · ${label(job.status)}` : 'No order/job linked'))}
                ${installation ? row('Installer',escape(installerNames.length ? installerNames.join(', ') : 'Not assigned')) : ''}
                ${installation ? row('Preparation',escape(installation.preparation?.ready ? 'Reviewed' : (installation.preparation?.blockers || []).join('; ') || 'Needs review')) : ''}
                ${installation ? row('Payment evidence',escape(`${label(installation.payment.status)} · ${installation.payment.detail}`)) : ''}
                ${row('Next follow-up',escape(state.disposition === 'closed' ? 'Sales follow-up closed' : state.next_follow_up_at ? `${date(state.next_follow_up_at)}${followUpDue ? ' · due' : ''}` : 'No date recorded'))}
            </dl>
            <section class="commercial-operation-block" aria-label="Recommended next action">
                <h5>${escape(next[1])}</h5><p class="commercial-operations-note">${escape(next[2])}</p>
                <button type="button" class="commercial-workload-btn commercial-action-primary" data-workspace-next>Open ${views[next[0]]}</button>
            </section>`;
        host.querySelector('[data-workspace-next]').onclick = () => showView(model,next[0]);
        if (restoreFocus) host.querySelector('[data-workspace-next]').focus({preventScroll:true});
    }
    function render(model) {
        if (!global.H2SCommercialCalendar) model.calendarSnapshot = {available:false,error:'Calendar controls did not load.'};
        if (!global.H2SCommercialBusiness) model.businessSnapshot = {available:false,error:'Business controls did not load.'};
        const { state, lead, staff, history, installation, routing } = model.data;
        const active = model.root.contains(document.activeElement) ? document.activeElement : null;
        const activeForm = active?.closest('form')?.dataset.action;
        const scroller = model.root.closest('.commercial-queue-detail'), scroll = scroller?.scrollTop;
        const viewport = { x: global.scrollX, y: global.scrollY };
        const job = installation?.job, order = installation?.order;
        const preparation = installation?.preparation, prepared = preparation?.record;
        const scope = order ? orderScope(order) : '';
        const followUp = model.data.followUp, timeZone = new Intl.DateTimeFormat(undefined, {timeZoneName:'longGeneric'}).formatToParts(new Date()).find(part => part.type === 'timeZoneName').value;
        const held = state.disposition !== 'closed' && Date.parse(state.hold_until || '') > Date.now();
        const paused = state.disposition === 'closed' || held || state.sales_chasing_paused;
        const latestContact = history.find(event => event.payload.contact);
        const overdue = state.disposition !== 'closed' && state.next_follow_up_at && Date.parse(state.next_follow_up_at) < Date.now();
        const assignments = installation?.assignments || [];
        const installerIds = [...new Set(assignments.map(item => item.pro_id))];
        const installer = model.data.installers?.find(person => person.id === installerIds[0]);
        const upcoming = [];
        if (state.disposition !== 'closed' && state.next_follow_up_at && !(followUp?.mode === 'automatic' && followUp.completed)) upcoming.push(`<li><strong>${overdue ? 'Overdue customer follow-up' : 'Customer follow-up'}</strong><time>${escape(date(state.next_follow_up_at))}</time><span>${escape(followUp?.reason || 'Staff-set internal follow-up; no message is scheduled.')}</span></li>`);
        if (['queued','assigned'].includes(job?.status) && job.due_at) upcoming.push(`<li><strong>Installation window</strong><time>${escape(date(job.due_at))} · ${escape(order.delivery_time || '')}</time></li>`);
        if (routing.nextReminderAt && !paused) upcoming.push(`<li><strong>Consultation reminder on record</strong><time>${escape(date(routing.nextReminderAt))}</time><span>Existing consultation rules determine whether it runs.</span></li>`);
        const historyItem = event => `<li><strong>${escape(event.payload.workload
            ? ({ next_action: 'Next action set', hold: 'Lead held', close: 'Lead closed', reopen: 'Lead reopened' }[event.payload.workload.intent] || 'Lead action')
            : event.action === 'follow_up' && event.payload.contact ? 'Contact attempt recorded' : label(event.action))}</strong>
            <time>${escape(date(event.created_at))} · ${escape(event.actor_name)}</time>
            <span>${escape(event.payload.contact?.note || event.payload.note || (event.action === 'follow_up' ? event.payload.reason || 'Follow-up responsibility and disposition saved.'
                : event.action === 'schedule' ? 'Installation window saved.' : event.action === 'assign' ? `Installer: ${event.payload.proName || 'Existing directory record'}.`
                    : event.action === 'location' ? 'Lead location updated; order address unchanged.' : 'Existing order and installation linked.'))}</span>
            ${event.payload.followUp?.reason ? `<span>${escape(event.payload.followUp.reason)}</span>` : ''}</li>`;
        model.root.innerHTML = `
            <h4 class="commercial-queue-detail__section-title">Customer workspace</h4>
            <div class="commercial-record-views" role="group" aria-label="Lead workspace">
                ${Object.entries(views).map(([view,title]) => `<button type="button" class="commercial-workload-btn" data-operations-view-choice="${view}" aria-pressed="false">${title}</button>`).join('')}
            </div>
            <p data-operations-status role="status" aria-live="polite"></p>
            <section data-operations-view="overview" aria-label="Customer overview"><div data-customer-overview></div></section>
            <section data-operations-view="followup" aria-label="Follow-up">
            <dl class="commercial-operations-facts commercial-operations-facts--summary">
                ${row('Lead', escape(held ? `Held until ${date(state.hold_until)}` : label(state.disposition)))}
                ${state.closure_outcome ? row('Closure outcome', escape(label(state.closure_outcome))) : ''}
                ${row('Responsible', escape(state.responsible_name || 'Not assigned'))}
                ${row('Latest contact', escape(latestContact ? latestContact.payload.contact.outcome === 'email_submitted'
                    ? 'Staff email submitted; see Activity for delivery evidence' : label(latestContact.payload.contact.outcome) : 'No attempt recorded'))}
                ${row('Next action', escape(state.disposition === 'closed' ? 'Lead closed; installation and payment remain separate'
                    : state.next_follow_up_at ? `${state.disposition_reason || 'Staff follow-up'} · ${date(state.next_follow_up_at)}`
                        : !installation ? 'Review Records, then link the intended installation in Installation' : 'Follow up or open Installation'))}
            </dl>
            ${paused ? `<p class="commercial-operations-note">Sales chasing paused${held ? ` until ${escape(date(state.hold_until))}` : ''}. Booked appointments and their appointment reminders are unchanged.
                ${!routing.consultationOrderId && ['pending','escalated','reschedule_requested','approved'].includes(routing.consultationStatus) ? 'Unresolved consultation request: staff review required; it has not been cancelled.' : ''}</p>` : ''}
            <div class="commercial-workload-actions" role="group" aria-label="Lead workload">
                ${state.disposition === 'closed' ? '<button type="button" class="commercial-workload-btn" data-workload-intent="reopen">Reopen lead</button>'
                    : '<button type="button" class="commercial-workload-btn" data-workload-intent="next_action">Set next action</button><button type="button" class="commercial-workload-btn" data-workload-intent="hold">Hold until</button><button type="button" class="commercial-workload-btn" data-workload-intent="close">Close lead</button>'}
            </div>
            <form id="commercial-workload-${escape(model.id)}" data-action="workload" class="commercial-operations-form" hidden>
                <h5 class="commercial-operations-wide" data-workload-title>Lead action</h5>
                <input type="hidden" name="intent">
                <label>Responsible staff<select name="responsibleId" class="form-select"><option value="">Choose owner</option>
                    ${staff.map(person => `<option value="${escape(person.User_ID)}"${person.User_ID === state.responsible_id ? ' selected' : ''}>${escape(person.Display_Name || person.Username)}</option>`).join('')}
                </select></label>
                ${dateInput('nextFollowUpAt', `Due / hold until (${timeZone})`, state.next_follow_up_at)}
                <label>Closure outcome<select name="outcome" class="form-select">${[['won','Won / handed to installation'],['declined','Customer declined'],['no_response','No response'],['duplicate','Duplicate'],['not_a_fit','Not a fit'],['other','Other']].map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label>
                <label class="commercial-operations-wide">Next action / reason<textarea name="reason" maxlength="1000" rows="2" required></textarea></label>
                ${state.sales_chasing_paused && lead.contact_preference === 'sms' && !routing.consultationOrderId
                    && ['pending','escalated','reschedule_requested'].includes(routing.consultationStatus) && Date.parse(routing.selectedSlotStart || '') > Date.now()
                    ? '<label class="commercial-operations-wide commercial-operations-check"><input type="checkbox" name="resumeConsultationChasing"> I reviewed the pending consultation; resume its reminders when reopening / setting next action</label>' : ''}
                <div class="commercial-form-actions">
                    <button type="submit" class="commercial-workload-btn commercial-action-primary" data-workload-save>Save lead action</button>
                    <button type="button" class="commercial-workload-btn" data-workload-cancel>Cancel</button>
                </div>
            </form>
            <section class="commercial-operation-block" data-section="followup"><h5>Update follow-up</h5>
                <form data-action="follow_up" class="commercial-operations-form">
                    <p class="commercial-calendar-zone commercial-operations-wide">Times shown in ${escape(timeZone)}.</p>
                    <label>Responsible staff<select name="responsibleId" class="form-select"><option value="">Not assigned</option>
                        ${state.responsible_id && !staff.some(person => person.User_ID === state.responsible_id) ? `<option value="${escape(state.responsible_id)}" selected>${escape(state.responsible_name)} (inactive)</option>` : ''}
                        ${staff.map(person => `<option value="${escape(person.User_ID)}"${person.User_ID === state.responsible_id ? ' selected' : ''}>${escape(person.Display_Name || person.Username)}</option>`).join('')}
                    </select></label>
                    ${dateInput('nextFollowUpAt', 'Next follow-up', state.next_follow_up_at)}
                    <label>Follow-up timing<select name="followUpMode" class="form-select">
                        <option value="manual"${!followUp || followUp.mode === 'manual' ? ' selected' : ''}>Staff-set time</option>
                        <option value="customer_callback"${followUp?.mode === 'customer_callback' ? ' selected' : ''}>Customer callback</option>
                        <option value="automatic"${followUp?.mode === 'automatic' && followUp.enabled ? ' selected' : ''}${followUp?.enabled ? '' : ' disabled'}>Automatic policy${followUp?.enabled ? '' : ' (not enabled)'}</option>
                    </select></label>
                    <label>Lead status<select name="disposition" class="form-select"><option value="open">Open</option><option value="closed"${state.disposition === 'closed' ? ' selected' : ''}>Closed</option></select></label>
                    <label class="commercial-operations-wide">Reason / context<textarea name="reason" maxlength="1000" rows="2" placeholder="Required when closing the lead">${escape(state.disposition_reason || '')}</textarea></label>
                    <label class="commercial-operations-wide commercial-operations-check"><input type="checkbox" name="recordContact"> Log a contact attempt — does not send a message</label>
                    <label>Contact channel<select name="channel" class="form-select">${[['call','Call'],['email','Email'],['sms','Text'],['other','Other']].map(([value, name]) =>
                        `<option value="${value}"${value === (lead.contact_preference || 'call') ? ' selected' : ''}>${name}</option>`).join('')}</select></label>
                    <label>Outcome<select name="outcome" class="form-select">${['no_response','reached','left_message','requested_callback','other'].map(value => `<option value="${value}">${escape(label(value))}</option>`).join('')}</select></label>
                    <label class="commercial-operations-wide">Contact notes<textarea name="note" maxlength="4000" rows="2"></textarea></label>
                    <div class="commercial-form-actions">
                        <button class="commercial-workload-btn commercial-action-primary" type="submit">Save follow-up</button>
                        <span class="commercial-form-caption">Saves staff records. Sends no message.</span>
                    </div>
                    <p class="commercial-operations-note commercial-operations-wide">Callbacks require an agreed time; automatic policy controls its own date. Closing pauses sales chasing, not booked appointments or their reminders. Installation and payment stay separate; responsibility grants no access.</p>
                    ${followUp?.enabled && followUp.proposedAt && !state.next_follow_up_at ? `<p class="commercial-operations-note commercial-operations-wide">Calculated: ${escape(date(followUp.proposedAt))}. ${escape(followUp.proposedReason)}</p>` : ''}
                </form>
            </section>
            </section>
            <section data-operations-view="schedule" aria-label="Schedule" hidden>
                <section data-installation-reservation></section>
            </section>
            <section data-operations-view="installation" aria-label="Installation" hidden>
            <section class="commercial-operation-block" data-section="location"><h5>Work location</h5>
                <p class="commercial-operations-note">${escape([lead.project_address,lead.project_city,lead.project_state,lead.project_postal_code].filter(Boolean).join(', ') || 'No saved work address.')}</p>
                <button type="button" class="commercial-workload-btn" data-location-toggle aria-expanded="${String(!!model.locationOpen)}" aria-controls="commercial-location-${escape(model.id)}">${model.locationOpen ? 'Close address editor' : 'Edit address'}</button>
                <form id="commercial-location-${escape(model.id)}" data-action="location" class="commercial-operations-form"${model.locationOpen ? '' : ' hidden'}>
                <div class="commercial-operations-wide"><span>Find address (optional)</span><div data-address-search></div>
                    <p class="commercial-operations-note" data-address-status role="status">Search or edit the saved details below.</p></div>
                ${input('address', 'Street address', lead.project_address || '', 'text', 'maxlength="300"')}
                ${input('unit', 'Apartment, unit or suite (optional)', '', 'text', 'maxlength="40" autocomplete="address-line2"')}
                ${input('city', 'City', lead.project_city || '', 'text', 'maxlength="100"')}
                ${input('state', 'State', lead.project_state || '', 'text', 'maxlength="100"')}
                ${input('postalCode', 'Postal code', lead.project_postal_code || '', 'text', 'maxlength="100"')}
                ${job && ['queued','assigned'].includes(job.status) ? '<label class="commercial-operations-wide commercial-operations-check"><input type="checkbox" name="applyToJob"> Also apply this work location to the linked job/order; preparation will need review</label>' : ''}
                <p class="commercial-operations-note commercial-operations-wide">The linked job retains its work location unless explicitly selected above.</p><button class="commercial-workload-btn" type="submit">Save location</button>
            </form></section>
            <section aria-label="Installation and payment" class="commercial-operations-section">
                ${installation ? `<h5>Linked job · preparation and execution</h5>
                <dl class="commercial-operations-facts">
                    ${row('Installation', escape(job ? `${label(job.status)}${installerIds.length > 1 ? ' · conflicting assignments — reconcile' : installer ? ` · ${installer.name}` : ' · installer name unavailable'}` : 'No installation linked'))}
                    ${row('Payment', `<strong>${escape(label(installation.payment.status))}</strong> · ${escape(installation.payment.detail)}`)}
                    ${order ? row('Existing order', `${escape(order.order_id)} · ${escape(money(order))}`) + row('Work location', escape([order.address,order.city,order.state,order.zip].filter(Boolean).join(', ') || 'Missing — reconcile the existing order address before starting')) : ''}
                    ${job ? row('Linked job ID', escape(job.job_id)) : ''}
                    ${state.completed_at ? row('Completion recorded', `${escape(date(state.completed_at))} · ${escape(state.completed_by?.name)}. No payout or communication was triggered.`) : ''}
                </dl>` : ''}
                ${!installation ? `<section class="commercial-operation-block" data-section="link"><h5>Link an existing installation</h5>
                    <p class="commercial-operations-note">Finding an order does not link or schedule it. Inspect payments in the native payment platform.</p>
                    <form data-lookup class="commercial-operations-form commercial-order-lookup">${input('orderRef', 'Existing order reference', '', 'text', 'required maxlength="150"')}<button class="commercial-workload-btn" type="submit">Find order</button></form><div data-candidate></div></section>` : `
                    <p class="commercial-operations-note">Existing scope: ${escape(order.service_name || 'Review the linked order and quote in Records')}${order.special_instructions ? ` · ${escape(order.special_instructions)}` : ''}</p>
                    ${scope ? `<p class="commercial-operations-note" data-job-scope>${escape(scope)}</p>` : ''}
                    <p data-preparation-summary><strong>${preparation.ready ? 'Preparation reviewed' : 'Preparation blocked'}</strong>${preparation.blockers.length ? ` · ${escape(preparation.blockers.join('; '))}` : ' · Booking, assignment and payment remain separate.'}</p>
                    <section class="commercial-operation-block" data-section="preparation"><h5>Job preparation</h5>
                    ${['queued','assigned'].includes(job.status) ? `<form data-action="preparation" class="commercial-operations-form">
                        <label class="commercial-operations-wide commercial-operations-check"><input type="checkbox" name="scopeReviewed"${prepared?.scope_reviewed ? ' checked' : ''}> I reviewed the existing job scope and quote</label>
                        <label>Materials<select name="materials" class="form-select">${[['unreviewed','Not reviewed'],['blocked','Blocked / waiting'],['ready','Ready'],['not_required','No materials required']].map(([value,text])=>`<option value="${value}"${prepared?.materials===value?' selected':''}>${text}</option>`).join('')}</select></label>
                        <label>Site / access<select name="access" class="form-select">${[['unreviewed','Not reviewed'],['blocked','Blocked / waiting'],['ready','Reviewed / ready']].map(([value,text])=>`<option value="${value}"${prepared?.access===value?' selected':''}>${text}</option>`).join('')}</select></label>
                        <label class="commercial-operations-wide">Unresolved blockers<textarea name="blockers" maxlength="4000" rows="2">${escape(prepared?.blockers || '')}</textarea></label>
                        <label class="commercial-operations-wide">Preparation / scope and access notes<textarea name="note" required maxlength="4000" rows="2">${escape(prepared?.note || '')}</textarea></label>
                        <p class="commercial-operations-note commercial-operations-wide">Internal review only. Does not order materials, book, assign, start work, mark payment or send messages. Scope, location, equipment or schedule changes require review again.</p>
                        <button type="submit" class="commercial-workload-btn">Save preparation review</button>
                    </form>` : `<p>${escape(prepared?.note || 'No preparation review recorded.')}</p>`}
                    </section>
                    ${['queued','assigned'].includes(job.status) ? `<section class="commercial-operation-block" data-section="assign"><h5>Assign installer</h5><form data-action="assign" class="commercial-operations-form">
                        <label>Existing active installer<select name="proId" class="form-select" required><option value="">Choose installer</option>${model.data.installers.filter(person => person.name !== 'Name unavailable').map(person => `<option value="${escape(person.id)}">${escape(person.name)}</option>`).join('')}</select></label>
                        <label>Assignment notes<textarea name="note" required maxlength="4000" rows="2"></textarea></label><button class="commercial-workload-btn" type="submit">Record assignment</button>
                        <p class="commercial-operations-note commercial-operations-wide">Explicit ADMIN assignment; no technician acceptance, notification or portal action is implied. Conflicting assignments require reconciliation.</p>
                    </form></section>` : ''}
                    <p class="commercial-operations-note">Use Schedule to hold, confirm, reschedule or cancel the shared window. Confirmed changes update this linked installation too.</p>
                    ${job.status === 'assigned' ? `<section class="commercial-operation-block" data-section="start"><h5>Start installation</h5><form data-action="start" class="commercial-operations-form">
                        <label class="commercial-operations-wide">Start notes<textarea name="note" required maxlength="4000" rows="2"></textarea></label>
                        <p class="commercial-operations-note commercial-operations-wide">Requires reviewed preparation with no unresolved blockers, a confirmed reservation, recorded installer, work address and delivered equipment where ordering is required.</p><button class="commercial-workload-btn" type="submit"${preparation.ready ? '' : ' disabled'}>Record installation started</button>
                    </form></section>` : ''}
                    <section class="commercial-operation-block" data-section="completion"><h5>Installation completion</h5><form data-action="complete" class="commercial-operations-form">
                        <label class="commercial-operations-wide">Completion notes<textarea name="note" required maxlength="4000" rows="2"></textarea></label>
                        <p class="commercial-operations-note commercial-operations-wide">Requires in-progress work, recorded assignment, notes and resolved critical flags. Records facts only: no payout, review email, receipt or customer communication.</p>
                        <button class="commercial-workload-btn" type="submit"${job.status !== 'in_progress' ? ' disabled' : ''}>Record installation completed</button>
                    </form></section>
                    <section class="commercial-operation-block" data-section="evidence"><h5>Recorded work evidence (${installation.artifacts.length})</h5><ul>${installation.artifacts.map(asset => {
                        let safe = false;
                        try { safe = new URL(asset.url).protocol === 'https:'; } catch (_) { /* Stored invalid URLs are not made interactive. */ }
                        return `<li>${safe ? `<a href="${escape(asset.url)}" target="_blank" rel="noopener noreferrer">${escape(asset.caption || label(asset.artifact_type))}</a>` : 'Evidence link unavailable'}</li>`;
                    }).join('') || '<li>No legacy job evidence recorded. Private installation proof is available in Records; completion remains a separate action.</li>'}</ul></section>`}
            </section>
            </section>
            <section data-operations-view="records" aria-label="Records" hidden>
                <section aria-label="Commercial business tools" data-business-tools><p class="hint">Business tools are unavailable. Reload the dashboard.</p></section>
            </section>
            <section data-operations-view="activity" aria-label="Activity" hidden>
            <section class="commercial-operations-section" aria-label="Recorded commercial communications"><h5>Communications</h5>${communications(model.data)}</section>
            <section class="commercial-operations-section" aria-label="Activity and upcoming actions"><h5>Upcoming actions</h5>
                <ul class="commercial-operations-timeline commercial-operations-upcoming">${upcoming.join('') || '<li>No dated action recorded.</li>'}</ul>
                ${!followUp?.enabled && followUp?.proposedAt && !state.next_follow_up_at ? `<p class="commercial-operations-note">Policy proposal only, inactive: ${escape(date(followUp.proposedAt))}. ${escape(followUp.proposedReason)}</p>` : ''}
                <h5>Recorded activity</h5><ol class="commercial-operations-timeline">${history.slice(0, 3).map(historyItem).join('') || '<li>No operational activity recorded.</li>'}</ol>
                ${history.length > 3 ? `<h5>Earlier activity</h5><ol class="commercial-operations-timeline">${history.slice(3).map(historyItem).join('')}</ol>` : ''}
            </section>
            <section class="commercial-operation-block"><h5>Calendar activity</h5><div data-calendar-history></div></section>
            <section class="commercial-operation-block"><h5>Preparation activity</h5><ol class="commercial-operations-timeline">${(installation?.preparationHistory || []).map(event=>`<li><strong>Preparation reviewed</strong><time>${escape(date(event.created_at))} · ${escape(event.actor_name)}</time><span>${escape(event.payload.note)}</span></li>`).join('') || '<li>No preparation activity recorded.</li>'}</ol>
                ${installation?.hasOlderPreparationHistory ? '<p class="commercial-operations-note">Showing the latest 50 preparation changes.</p>' : ''}</section>
            <div data-business-activity></div>
            </section>
            <button type="button" class="commercial-operations-review" data-reload>Review latest / discard draft</button>`;
        const smsButton=model.root.querySelector('[data-load-sms]');
        if (smsButton) smsButton.onclick=()=>loadSharedSms(model,smsButton);
        model.root.querySelectorAll('[data-operations-view-choice]').forEach(button => {
            button.onclick = () => showView(model,button.dataset.operationsViewChoice);
        });
        showView(model,model.view || 'overview');
        renderOverview(model);
        model.address?.destroy();
        const locationForm = model.root.querySelector('[data-action="location"]');
        model.root.querySelector('[data-location-toggle]').onclick = event => {
            model.locationOpen = !model.locationOpen;
            locationForm.hidden = !model.locationOpen;
            event.currentTarget.setAttribute('aria-expanded',String(model.locationOpen));
            event.currentTarget.textContent = model.locationOpen ? 'Close address editor' : 'Edit address';
            if (model.locationOpen) {
                model.address?.activate?.();
                locationForm.elements.address.focus();
            }
        };
        if (global.H2SAddressAutocomplete) {
            model.address = global.H2SAddressAutocomplete.create(locationForm, model.data.addressLookup, {
                fields: { street: 'address' }, holder: locationForm.querySelector('[data-address-search]'),
                status: locationForm.querySelector('[data-address-status]'),defer:true,
            });
            if (model.view === 'installation' && model.locationOpen) model.address.activate?.();
            model.address.restore(global.H2SAddressAutocomplete.splitLine(lead.project_address));
        }
        model.root.querySelectorAll('form').forEach(form => {
            const syncTiming = () => {
                if (form.dataset.action !== 'follow_up') return;
                const fields = form.elements;
                const callback = fields.recordContact.checked && fields.outcome.value === 'requested_callback';
                ['channel','outcome','note'].forEach(name => { fields[name].closest('label').hidden = !fields.recordContact.checked; });
                if (callback && fields.followUpMode.value !== 'customer_callback') {
                    fields.followUpMode.value = 'customer_callback';
                    fields.followUpMode.dispatchEvent(new Event('change', { bubbles: true }));
                }
                fields.nextFollowUpAt.disabled = fields.disposition.value === 'closed' || (fields.followUpMode.value === 'automatic' && !callback);
                fields.nextFollowUpAt.required = fields.disposition.value !== 'closed' && fields.followUpMode.value === 'customer_callback';
            };
            form.oninput = form.onchange = () => { model.dirty = true; syncTiming(); };
            form.onsubmit = event => { event.preventDefault(); if (form.hasAttribute('data-lookup')) lookup(model, form); else save(model, form); };
            syncTiming();
        });
        const workloadForm = model.root.querySelector('[data-action="workload"]');
        model.root.querySelectorAll('[data-workload-intent]').forEach(button => {
            button.setAttribute('aria-controls',workloadForm.id);
            button.onclick = () => {
                if (model.saving) return;
                if (model.dirty || model.businessDirty || model.calendarDirty) {
                    message(model, 'Save or discard the current draft before choosing another lead action.');
                    return;
                }
                workloadForm.hidden = false;
                model.root.querySelector('[data-section="followup"]').hidden = true;
                model.root.querySelectorAll('[data-workload-intent]').forEach(choice => choice.setAttribute('aria-pressed',String(choice === button)));
                const intent = button.dataset.workloadIntent, timed = ['hold','next_action'].includes(intent);
                workloadForm.elements.intent.value = intent;
                workloadForm.elements.nextFollowUpAt.disabled = !timed;
                workloadForm.elements.nextFollowUpAt.required = timed;
                workloadForm.elements.nextFollowUpAt.closest('label').hidden = !timed;
                workloadForm.elements.responsibleId.required = timed;
                workloadForm.elements.outcome.disabled = intent !== 'close';
                workloadForm.elements.outcome.closest('label').hidden = intent !== 'close';
                workloadForm.querySelector('[data-workload-save]').textContent = button.textContent;
                workloadForm.querySelector('[data-workload-title]').textContent = button.textContent;
                workloadForm.elements.reason.focus({ preventScroll: true });
            };
        });
        workloadForm.querySelector('[data-workload-cancel]').onclick = () => {
            if (model.saving) return;
            const trigger = model.root.querySelector('[data-workload-intent][aria-pressed="true"]');
            workloadForm.reset(); workloadForm.hidden = true;
            model.root.querySelector('[data-section="followup"]').hidden = false;
            model.root.querySelectorAll('[data-workload-intent]').forEach(button => button.setAttribute('aria-pressed','false'));
            model.dirty = false;
            trigger?.focus({preventScroll:true});
        };
        model.root.querySelector('[data-reload]').onclick = () => {
            if (model.saving || ((model.dirty || model.businessDirty || model.calendarDirty) && !global.confirm('Discard unsaved changes and review the latest record?'))) return;
            model.dirty = false;
            model.businessDirty = false;
            model.calendarDirty = false;
            global.H2SCommercialBusiness?.discard(model.id);
            model.retry = null;
            if (model.latest) {
                model.data = model.latest;
                model.signature = signature(model.data);
                render(model);
            }
            refresh(model);
        };
        global.H2SCommercialBusiness?.mount(model.root.querySelector('[data-business-tools]'), model.id, {
            ...model.options, dateInput, instantValue, onDirty: value => { model.businessDirty = value; }, onActivity: () => refresh(model),
            activityRoot:model.root.querySelector('[data-business-activity]'),onOpen:()=>showView(model,'records'),
            onReviewActivity:()=>showView(model,'activity'),
            onStatus:text=>message(model,text),
            onSnapshot:snapshot => { model.businessSnapshot = snapshot; renderOverview(model); },
        });
        global.H2SCommercialCalendar?.mountLead(model.root.querySelector('[data-installation-reservation]'), model.id, {
            ...model.options, dateInput, instantValue,
            historyRoot:model.root.querySelector('[data-calendar-history]'),
            readOnly: !!job && !['queued','assigned'].includes(job.status),
            onDirty: value => { model.calendarDirty = value; },
            onActivity: () => { refresh(model); model.options.onActivity?.(); },
            onSnapshot:snapshot => { model.calendarSnapshot = snapshot; renderOverview(model); },
        });
        if (active) {
            const target = activeForm ? model.root.querySelector(`form[data-action="${activeForm}"] ${active.name ? `[name="${active.name}"]` : 'button[type="submit"]'}`)
                : active.dataset.operationsViewChoice ? model.root.querySelector(`[data-operations-view-choice="${active.dataset.operationsViewChoice}"]`) : null;
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
                <button class="commercial-workload-btn" type="submit"${found.jobs.length ? '' : ' disabled'}>Link existing order and job</button></form>`;
            const link = host.querySelector('form');
            link.onchange = () => { model.dirty = true; };
            link.onsubmit = event => { event.preventDefault(); save(model, link); };
            message(model, found.jobs.length ? 'Candidate only. Choose and explicitly link the existing installation.' : 'No matching installation. Job creation is not connected here.');
        } catch (error) { message(model, error.message); }
        finally { model.lookingUp = false; button.disabled = false; }
    }
    async function save(model, form) {
        if (model.saving || !form.reportValidity()) return;
        if (model.calendarDirty) { message(model, 'Save or discard your calendar draft before changing the lead.'); return; }
        const fields = Object.fromEntries(new FormData(form)), action = form.dataset.action;
        let payload;
        try {
            if (action === 'workload') {
                payload = { intent: fields.intent, responsibleId: fields.responsibleId,
                    nextFollowUpAt: ['hold','next_action'].includes(fields.intent) ? instantValue(form, 'nextFollowUpAt') : '',
                    outcome: fields.outcome || '', reason: fields.reason };
                payload.resumeConsultationChasing = fields.resumeConsultationChasing === 'on';
            } else if (action === 'follow_up') {
                const callback = fields.recordContact && fields.outcome === 'requested_callback';
                payload = { responsibleId: fields.responsibleId,
                    nextFollowUpAt: fields.disposition === 'closed' || (fields.followUpMode === 'automatic' && !callback) ? '' : instantValue(form, 'nextFollowUpAt'),
                    followUpMode: callback ? 'customer_callback' : fields.followUpMode, disposition: fields.disposition, reason: fields.reason };
                if (payload.followUpMode === 'customer_callback' && fields.disposition !== 'closed' && !payload.nextFollowUpAt) throw new Error('Enter the exact customer-requested callback time.');
                if (fields.recordContact) payload.contact = { channel: fields.channel, outcome: fields.outcome, note: fields.note };
                if (fields.recordContact && !fields.note.trim()) throw new Error('Contact notes are required.');
                if (fields.disposition === 'closed' && !fields.reason.trim()) throw new Error('A nonblank closure reason is required.');
            } else if (action === 'location') payload = { ...fields, expectedUpdatedAt: model.data.lead.updated_at,
                ...(fields.applyToJob ? {applyToJob:true,expectedJobUpdatedAt:model.data.installation.job.updated_at,expectedOrderUpdatedAt:model.data.installation.order.updated_at} : {}) };
            else if (action === 'preparation') payload = {scopeReviewed:fields.scopeReviewed==='on',materials:fields.materials,access:fields.access,
                blockers:fields.blockers,note:fields.note,preparationRevision:model.data.installation.preparation.record?.revision || 0,
                context:model.data.installation.preparation.context,expectedJobUpdatedAt:model.data.installation.job.updated_at,
                expectedOrderUpdatedAt:model.data.installation.order.updated_at};
            else if (action === 'link') payload = { orderId: model.candidate.id, jobId: fields.jobId };
            else payload = {
                ...(action === 'schedule' ? { start: instantValue(form, 'start'), end: instantValue(form, 'end'), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : { note: fields.note, ...(action === 'assign' ? { proId: fields.proId } : {}) }),
                expectedJobUpdatedAt: model.data.installation.job.updated_at, expectedOrderUpdatedAt: model.data.installation.order.updated_at,
            };
        } catch (error) { message(model, error.message); return; }
        const key = JSON.stringify([action, payload, model.data.state.revision]);
        if (!model.retry || model.retry.signature !== key) model.retry = { signature: key, operationId: global.crypto.randomUUID() };
        model.saving = model.dirty = true;
        model.address?.setDisabled(true);
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
            model.options.onActivity?.();
        } catch (error) {
            model.address?.setDisabled(false);
            message(model, `${error.message} Draft retained. Only an explicit unchanged save reuses the operation key.`);
        } finally {
            controls.forEach((node, index) => { node.disabled = disabled[index]; });
            model.saving = false;
        }
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
                host.innerHTML = '<h4 class="commercial-queue-detail__section-title">Customer workspace</h4><p data-operations-status role="status">Loading operational details…</p>';
            } else {
                model.options = options;
                const active = model.root.contains(document.activeElement) ? document.activeElement : null;
                if (host !== model.root) host.replaceWith(model.root);
                if (active) active.focus({ preventScroll: true });
            }
            if (model.data) {
                showView(model,model.view || 'overview');
                renderOverview(model);
            }
            return resume(model, false) || Promise.resolve();
        },
        refresh(id) { const model = models.get(id); return model ? refresh(model) : Promise.resolve(); },
    };
    global.addEventListener('online', returnToView);
    document.addEventListener('visibilitychange', returnToView);
    global.setInterval(() => models.forEach(model => { if (visible(model)) refresh(model); }), 45000);
})(window);
