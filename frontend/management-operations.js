(function (global) {
    'use strict';
    const root = document.createElement('section');
    root.id = 'operations-pane';
    root.className = 'pane management-operations';
    root.setAttribute('aria-label', 'Operations');
    const nav = document.createElement('button');
    nav.type = 'button';
    nav.className = 'app-sidebar-nav-item';
    nav.dataset.tab = 'operations';
    nav.textContent = 'Operations';
    nav.hidden = true;
    nav.addEventListener('click', () => global.switchToTab('operations'));
    document.querySelector('.app-sidebar-group[data-group-id="admin"] .app-sidebar-group-items').append(nav);
    document.querySelector('#h2s-app .app-content').append(root);
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = typeof global.__h2sResolveDashSiblingAsset === 'function'
        ? global.__h2sResolveDashSiblingAsset('management-operations.css') : './management-operations.css';
    stylesheet.addEventListener('error', () => {
        console.error('Operations stylesheet failed to load.');
        root.textContent = 'Operations styling is unavailable. Reload the dashboard before opening this view.';
    });
    document.head.append(stylesheet);
    let options = null, controller = null, requestId = 0, offset = 0, filter = 'all', data = null;
    let assignmentDialog = null, assignmentController = null, assignmentVersion = 0, assignmentAttempt = null;
    const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g,
        char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const evidence = value => value.status === 'available' ? value.value : null;
    const date = value => value && Number.isFinite(Date.parse(value))
        ? new Date(value).toLocaleString() : 'Schedule not recorded';
    const labels = { all: 'All records', upcoming: 'Upcoming installations', assignments: 'Assignment review',
        readiness: 'Preparation review', payments: 'Payment exceptions', payouts: 'Payout review' };
    const done = job => ['completed', 'done', 'cancelled', 'canceled'].includes(job.rawStatus);
    function matches(job) {
        if (filter === 'upcoming') return job.kind === 'installation' && !done(job)
            && !!job.scheduledAt && Date.parse(job.scheduledAt) >= Date.now();
        if (filter === 'assignments') {
            const assignments = evidence(job.assignments);
            return !done(job) && (!assignments || assignments.length !== 1 || !assignments[0].proId
                || !['accepted', 'assigned', 'scheduled', 'in_progress'].includes(assignments[0].rawState));
        }
        if (filter === 'readiness') return job.kind !== 'consultation'
            && (!evidence(job.preparation) || !job.preparation.value.ready);
        if (filter === 'payments') return !['paid', 'not_applicable'].includes(job.payment.status);
        if (filter === 'payouts') return !evidence(job.payouts) || !job.payouts.value.length
            || job.payouts.value.some(row => row.status !== 'paid');
        return true;
    }
    function frame() {
        root.innerHTML = `<header class="management-operations__header"><div><h2>Operations</h2>
            <p>Dispatch records. Technician offers require a separate review and confirmation; management writes are disabled by default.
            No scheduling, payment or payout changes are made here.</p></div>
            <button type="button" class="commercial-workload-btn" data-operations-action="refresh">Refresh</button></header>
            <div class="management-operations__filters" role="group" aria-label="Filter this page">
            ${Object.entries(labels).map(([key, label]) => `<button type="button" data-operations-filter="${key}"
                aria-pressed="${key === filter}">${label}</button>`).join('')}</div>
            <p data-operations-status role="status" aria-live="polite"></p>
            <div data-operations-jobs></div>
            <footer class="management-operations__footer"><span data-operations-page></span><div>
            <button type="button" data-operations-action="previous" disabled>Previous</button>
            <button type="button" data-operations-action="next" disabled>Next</button></div></footer>`;
    }
    function render() {
        const jobs = data.jobs.filter(matches);
        root.querySelector('[data-operations-status]').textContent = data.jobs.length
            ? `Read ${new Date(data.readAt).toLocaleString()}. Showing ${jobs.length} of ${data.jobs.length} records on this page. Filters apply to this page only.`
            : 'No Dispatch records found.';
        root.querySelector('[data-operations-jobs]').innerHTML = jobs.length ? jobs.map(job => {
            const order = evidence(job.order), assignments = evidence(job.assignments),
                preparation = evidence(job.preparation), equipment = evidence(job.equipment), payouts = evidence(job.payouts);
            const assignedText = assignments ? assignments.length
                ? assignments.map(row => `${row.name || 'Technician identity unresolved'} (${row.rawState})`).join('; ')
                : 'No active assignment recorded' : job.assignments.detail;
            const payoutText = payouts ? payouts.length ? payouts.map(row =>
                `Settlement: ${row.status || 'unknown'}; approval: ${row.state || 'not recorded'}; amount: ${row.amount == null ? 'not recorded' : row.amount}`).join('; ')
                : 'No ledger entries recorded for verified job/technician' : job.payouts.detail;
            return `<article class="management-operations__job"><h3>${escape(order?.service || 'Service requires reconciliation')}</h3>
                <p>${escape(order?.customerName || 'Customer not verified')} / ${escape(order?.address || 'Address not verified')}</p>
                <p class="management-operations__identity">${escape(job.jobId)} / ${escape(order?.reference || job.order.detail)} / ${escape(job.kind)}</p>
                <dl><div><dt>Job / schedule</dt><dd>${escape(job.rawStatus)} / ${escape(date(job.scheduledAt))}</dd></div>
                <div><dt>Technician assignment</dt><dd>${escape(assignedText)}${assignments?.length > 1 ? ' / Conflicting assignments' : ''}</dd></div>
                <div><dt>Preparation</dt><dd>${escape(preparation ? preparation.ready ? 'Preparation ready (not payment clearance)'
                    : preparation.blockers.join('; ') || 'Preparation review required' : job.preparation.detail)}</dd></div>
                <div><dt>Equipment requirements</dt><dd>${escape(equipment ? `Required: ${equipment.required === null ? 'unverified' : equipment.required ? 'yes' : 'no'}; stage: ${equipment.stage || 'not recorded'}`
                    : job.equipment.detail)}${equipment?.scope ? `<pre>${escape(equipment.scope)}</pre>` : ''}</dd></div>
                <div><dt>Payment verification</dt><dd>${escape(job.payment.status)} / ${escape(job.payment.detail)}</dd></div>
                <div><dt>Technician payout</dt><dd>${escape(payoutText)}</dd></div></dl>
                <button type="button" data-assignment-job="${escape(job.jobId)}">Review job / technician offer</button></article>`;
        }).join('') : `<p class="management-operations__empty">${data.jobs.length ? 'No records match this filter on this page.' : 'There are no jobs to display.'}</p>`;
        root.querySelector('[data-operations-page]').textContent = `Latest records, page ${Math.floor(offset / 25) + 1}`;
        root.querySelector('[data-operations-action="previous"]').disabled = offset === 0;
        root.querySelector('[data-operations-action="next"]').disabled = !data.page.hasMore || offset >= 10000;
    }
    function reset() {
        assignmentVersion++;
        if (assignmentController) assignmentController.abort();
        assignmentAttempt = null;
        if (assignmentDialog) { assignmentDialog.remove(); assignmentDialog = null; }
        requestId++;
        if (controller) controller.abort();
        controller = null; data = null; offset = 0;
        frame();
        root.querySelector('[data-operations-status]').textContent = 'Open Operations with an ADMIN dashboard account to load records.';
    }
    async function openAssignment(jobId, trigger) {
        const session = options?.getSession();
        if (!session?.isAdmin || !session.token) { reset(); return; }
        if (assignmentAttempt) jobId = assignmentAttempt.jobId;
        if (assignmentController) assignmentController.abort();
        if (assignmentDialog) assignmentDialog.remove();
        const version = ++assignmentVersion;
        const current = () => version === assignmentVersion && options?.getSession().token === session.token
            && options.getSession().isAdmin;
        const dialog = assignmentDialog = document.createElement('dialog');
        dialog.className = 'management-operations management-assignment';
        dialog.setAttribute('aria-labelledby', 'management-assignment-title');
        dialog.innerHTML = `<h2 id="management-assignment-title">Technician offer review</h2>
            <p>Creating an offer does not accept a job, collect payment or create a payout.</p>
            <div data-assignment-details></div><p data-assignment-status role="status" aria-live="polite">Loading job and assignment evidence...</p>
            <div data-assignment-controls></div><footer><button type="button" data-assignment-close>Close</button></footer>`;
        document.querySelector('#h2s-app').append(dialog);
        const status = dialog.querySelector('[data-assignment-status]'), controls = dialog.querySelector('[data-assignment-controls]');
        let submitting = false;
        const close = () => {
            if (submitting) return;
            assignmentVersion++;
            if (assignmentController) assignmentController.abort();
            dialog.remove(); assignmentDialog = null;
            if (trigger?.isConnected) trigger.focus();
        };
        dialog.querySelector('[data-assignment-close]').addEventListener('click', close);
        dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
        dialog.showModal();
        const announce = message => { status.textContent = message; };
        const clientRequest = async (method, body) => {
            const localController = assignmentController = new AbortController();
            const timer = setTimeout(() => localController.abort(), 20000);
            try {
                const response = await global.fetch(`${options.apiBase}/api/management-assignments${method === 'GET' ? `?jobId=${encodeURIComponent(jobId)}` : ''}`, {
                    method, cache: 'no-store', signal: localController.signal,
                    headers: { Authorization: `Bearer ${session.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
                    ...(body ? { body: JSON.stringify(body) } : {}),
                });
                const result = await response.json();
                if (!response.ok || !result.ok) {
                    const error = new Error(result.error || 'Assignment request failed.');
                    error.code = result.code; error.retryable = result.retryable; throw error;
                }
                return result;
            } finally { clearTimeout(timer); if (assignmentController === localController) assignmentController = null; }
        };
        function confirmView(name) {
            controls.innerHTML = `<h3>Confirm proposed offer</h3><p>${escape(name)} / job ${escape(assignmentAttempt.jobId)}</p>
                <p>${escape(assignmentAttempt.note)}</p><p>The technician must still accept in the established portal.</p>
                <button type="button" data-assignment-confirm>Confirm pending offer</button>`;
            const confirm = controls.querySelector('[data-assignment-confirm]');
            confirm.addEventListener('click', async () => {
                if (submitting) return;
                submitting = true; confirm.disabled = true;
                dialog.querySelector('[data-assignment-close]').disabled = true;
                status.setAttribute('role', 'status');
                announce('Submitting the reviewed offer. Do not create another request.');
                try {
                    const result = await clientRequest('POST', assignmentAttempt);
                    if (!current()) return;
                    assignmentAttempt = null;
                    controls.innerHTML = '';
                    const recordedAssignment = dialog.querySelector('[data-assignment-current]');
                    if (recordedAssignment) recordedAssignment.textContent = `Recorded offer: ${name} / pending technician acceptance. Reopen this review for refreshed audit history.`;
                    announce(`Offer recorded (${result.assignment.state}). Technician acceptance is required.${result.assignment.replayed ? ' The original request was already saved; no duplicate was created.' : ''}`);
                    load();
                } catch (error) {
                    if (!current()) return;
                    console.error('Management assignment confirmation failed', { code: error.code || 'TRANSPORT_FAILURE' });
                    status.setAttribute('role', 'alert');
                    announce(`${error.message} Retry uses the identical operation key. If the result is uncertain, resolve this attempt before another job.`);
                    if (['STALE_REVIEW', 'INELIGIBLE_ASSIGNMENT', 'ASSIGNMENT_CONFLICT'].includes(error.code)) {
                        assignmentAttempt = null;
                        controls.innerHTML = '<button type="button" data-assignment-reload>Reload job review</button>';
                        controls.querySelector('button').addEventListener('click', () => openAssignment(jobId, trigger));
                    } else confirm.textContent = 'Retry identical offer';
                } finally {
                    submitting = false;
                    if (current()) { confirm.disabled = false; dialog.querySelector('[data-assignment-close]').disabled = false; }
                }
            });
        }
        if (assignmentAttempt) {
            announce('An unresolved request is retained. Retry it before proposing another assignment.');
            confirmView('Previously selected technician');
            return;
        }
        try {
            const result = await clientRequest('GET');
            if (!current()) return;
            if (!result.enabled) { announce('Management technician assignments are disabled. Existing Dispatch and technician workflows are unchanged.'); return; }
            const job = result.job;
            dialog.querySelector('[data-assignment-details]').innerHTML = `<h3>${escape(job.service || 'Installation')}</h3>
                <p>${escape(job.customerName)} / ${escape(job.orderReference)} / ${escape(date(job.scheduledAt))}</p>
                <p>Job status: ${escape(job.rawStatus)}</p><p data-assignment-current>Recorded assignments: ${escape(job.assignments.length
                    ? job.assignments.map(row => `${row.proReference}: ${row.state || 'unknown'}`).join('; ') : 'None')}</p>
                ${job.legacyPayoutBridge ? '' : '<p>No verified legacy payout-job bridge. This offer creates no payout or legacy job.</p>'}
                <details><summary>Assignment audit (latest 20 events)</summary>${result.history?.length ? `<ul>${result.history.map(event =>
                    `<li>${escape(date(event.created_at))}: ${escape(event.old_state || 'none')} to ${escape(event.new_state)} / ${escape(event.actor_user_id || event.source)}${event.note ? ` / ${escape(event.note)}` : ''}</li>`).join('')}</ul>` : '<p>No management audit events recorded.</p>'}</details>`;
            if (!job.eligible) { announce(job.reason); return; }
            if (!result.technicians.length) { announce('No eligible named active technicians are available for this review.'); return; }
            controls.innerHTML = `<fieldset><legend>Eligible technicians (active directory, no same-time recorded conflict)</legend>
                ${result.technicians.map((pro, index) => `<label><input type="radio" name="management-technician" value="${escape(pro.proId)}" ${index === 0 ? 'checked' : ''}> ${escape(pro.name)}</label>`).join('')}</fieldset>
                <label>Assignment note<textarea data-assignment-note maxlength="2000" rows="3"></textarea></label>
                <button type="button" data-assignment-review>Review proposed offer</button>`;
            announce('Review the job and technician. Availability is rechecked when you confirm; this is not a full travel or capacity planner.');
            controls.querySelector('[data-assignment-review]').addEventListener('click', () => {
                const note = controls.querySelector('textarea').value.trim(), proId = controls.querySelector('input:checked')?.value;
                if (!note || !proId) { announce('Choose a technician and enter an assignment note.'); return; }
                assignmentAttempt = { jobId, proId, context: job.context, note, operationId: global.crypto.randomUUID() };
                confirmView(result.technicians.find(pro => pro.proId === proId).name);
            });
        } catch (error) {
            if (!current()) return;
            console.error('Management assignment review failed.');
            status.setAttribute('role', 'alert');
            announce(`${error.message} Close and reopen the review to retry.`);
        }
    }
    async function load() {
        const session = options?.getSession();
        if (!session?.isAdmin || !session.token) { reset(); return; }
        if (controller) controller.abort();
        const localController = controller = new AbortController(), id = ++requestId;
        data = null;
        frame();
        root.querySelector('[data-operations-status]').textContent = 'Reading existing operational records...';
        const timer = setTimeout(() => localController.abort(), 55000);
        const current = () => id === requestId && options?.getSession().token === session.token && options.getSession().isAdmin;
        try {
            const response = await global.fetch(`${options.apiBase}/api/management-operations?offset=${offset}&limit=25`, {
                method: 'GET', cache: 'no-store', signal: localController.signal, referrerPolicy: 'no-referrer',
                headers: { Authorization: `Bearer ${session.token}` },
            });
            if (!current()) return;
            const result = await response.json();
            if (!current()) return;
            if (!response.ok || !result.ok) throw new Error(result.error || 'Operations read failed.');
            if (!Array.isArray(result.jobs) || !result.page || result.readOnly !== true) throw new Error('Operations response is incomplete.');
            data = result; render();
        } catch (error) {
            if (!current()) return;
            console.error('Operations view read failed.');
            const status = root.querySelector('[data-operations-status]');
            status.setAttribute('role', 'alert');
            status.textContent = `${error.name === 'AbortError' ? 'Operations read timed out.' : error.message} Use Refresh to retry.`;
        } finally {
            clearTimeout(timer);
            if (controller === localController) controller = null;
        }
    }
    root.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button || !root.contains(button) || button.disabled) return;
        if (button.dataset.assignmentJob) openAssignment(button.dataset.assignmentJob, button);
        else if (button.dataset.operationsFilter) {
            filter = button.dataset.operationsFilter;
            frame(); if (data) render();
            else root.querySelector('[data-operations-status]').textContent = controller
                ? 'Reading existing operational records...' : 'Use Refresh to load records.';
        } else if (button.dataset.operationsAction === 'refresh') load();
        else if (button.dataset.operationsAction === 'next') { offset += 25; load(); }
        else if (button.dataset.operationsAction === 'previous') { offset = Math.max(0, offset - 25); load(); }
    });
    global.addEventListener('storage', () => reset());
    global.H2SManagementOperations = {
        configure(value) { options = value; reset(); nav.hidden = !options.getSession().isAdmin; },
        open() { return load(); },
        reset,
    };
    reset();
})(window);
