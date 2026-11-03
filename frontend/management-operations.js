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
    let view = 'overview', planningFilter = 'all', reviewToken = null;
    const reviewDrafts = new Map();
    const views = { overview: 'Dispatch records', schedule: 'Scheduling visibility', reconciliation: 'Reconciliation review' };
    const planningLabels = {
        schedule: { all: 'All jobs', upcoming: 'Upcoming installations', scheduled: 'Scheduled starts', unscheduled: 'Unscheduled jobs', attention: 'Management attention', conflicts: 'Observed conflicts' },
        reconciliation: { all: 'All issues', orphan_assignment: 'Orphan assignments', technician_identity: 'Technician identities',
            legacy_relationship: 'Legacy job links', assignment_conflict: 'Assignment conflicts', payout_association: 'Payout associations', source_unavailable: 'Unavailable evidence' },
    };
    const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g,
        char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const evidence = value => value.status === 'available' ? value.value : null;
    const date = value => value && Number.isFinite(Date.parse(value))
        ? new Date(value).toLocaleString() : 'Schedule not recorded';
    const scheduleDate = (value, timezone) => value && Number.isFinite(Date.parse(value))
        ? timezone ? new Date(value).toLocaleString(undefined, { timeZone: timezone })
            : `${new Date(value).toISOString()} (recorded instant; local timezone unresolved)` : 'Schedule not recorded';
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
            <div class="management-operations__filters" role="group" aria-label="Operations view">${Object.entries(views).map(([key, label]) =>
                `<button type="button" data-operations-view="${key}" aria-pressed="${key === view}">${label}</button>`).join('')}</div>
            <div class="management-operations__filters" role="group" aria-label="${view === 'overview' ? 'Filter this page' : 'Filter bounded dataset'}">
            ${Object.entries(view === 'overview' ? labels : planningLabels[view]).map(([key, label]) => `<button type="button" ${view === 'overview' ? 'data-operations-filter' : 'data-planning-filter'}="${key}"
                aria-pressed="${key === (view === 'overview' ? filter : planningFilter)}">${label}</button>`).join('')}</div>
            ${view === 'reconciliation' ? '<p>Review drafts are held only in this Operations session. They are not shared, saved to production, repair instructions or approvals. Export before signing out. Reviewed does not mean resolved.</p><button type="button" data-review-export disabled>Export session review drafts</button>' : ''}
            <p data-operations-status role="status" aria-live="polite"></p>
            <div data-operations-jobs></div>
            <footer class="management-operations__footer"><span data-operations-page></span><div>
            <button type="button" data-operations-action="previous" disabled>Previous</button>
            <button type="button" data-operations-action="next" disabled>Next</button></div></footer>`;
    }
    function render() {
        if (view !== 'overview') { renderPlanning(); return; }
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
    function renderPlanning() {
        const status = root.querySelector('[data-operations-status]');
        status.textContent = `${data.complete ? 'Complete bounded source reads' : 'Incomplete evidence: unavailable sources are not empty or clear'}. ${data.summary.jobs} jobs; ${data.summary.issues} reconciliation issues. ${data.scope}`;
        const content = root.querySelector('[data-operations-jobs]');
        if (view === 'schedule') {
            content.innerHTML = data.jobs.length ? data.jobs.map(job => `<article class="management-operations__job">
                <h3>${escape(job.service || 'Unresolved service')}</h3>
                <p class="management-operations__identity">${escape(job.jobId)} / ${escape(job.orderReference || 'Order unresolved')}</p>
                <dl><div><dt>Installation window / ${escape(job.rawStatus)}</dt><dd>${escape(job.window.state)}: ${escape(scheduleDate(job.window.start, job.window.timezone))}
                    to ${escape(job.window.end ? scheduleDate(job.window.end, job.window.timezone) : 'End not recorded')} / ${escape(job.window.timezone || 'Timezone unresolved')}</dd></div>
                <div><dt>Technician assignments</dt><dd>${escape(job.assignments.length ? job.assignments.map(a =>
                    `${a.identity.name || a.pro_id || 'Unknown reference'} / ${a.state || 'unknown'} / ${a.identity.status}`).join('; ') : 'No unclosed assignment')}</dd></div>
                <div><dt>Customer reservation</dt><dd>${escape(job.reservationEvidence)}. Assignment acceptance is not appointment confirmation.</dd></div>
                <div><dt>Availability evidence</dt><dd>${escape(job.availability.length ? job.availability.map(a => `${a.status}: ${a.detail}`).join('; ') : 'No verified technician to evaluate')}
                    ${job.availability.some(a => a.dispatchCapacity.length) ? 'Dispatch capacity rows exist; no cross-directory identity or capacity clearance is inferred.' : ''}</dd></div>
                <div><dt>Installation readiness</dt><dd>${escape(job.preparation.status === 'available' ? job.preparation.value.ready ? 'Preparation ready (not payment clearance)'
                    : job.preparation.value.blockers.join('; ') || 'Preparation review required' : job.preparation.detail)}</dd></div>
                <div><dt>Observed scheduling conflicts</dt><dd>${escape(job.conflicts.length ? job.conflicts.map(c => `${c.code}: ${c.detail} (${c.reference})`).join('; ')
                    : 'None observed in available evidence; not availability clearance.')}</dd></div></dl>
                ${job.attention.length ? `<p><strong>Management attention:</strong> ${escape(job.attention.join(' '))}</p>` : ''}
                <details><summary>Source evidence</summary><pre>${escape(JSON.stringify({ reservation: job.reservation,
                    availability: job.availability, legacyLink: job.legacyLink }, null, 2))}</pre></details>
                <button type="button" data-assignment-job="${escape(job.jobId)}">Review job / technician offer</button></article>`).join('')
                : '<p class="management-operations__empty">No jobs match this scheduling filter.</p>';
        } else {
            content.innerHTML = data.issues.length ? data.issues.map(issue => {
                const prior = reviewDrafts.get(issue.id), draft = prior?.fingerprint === issue.fingerprint ? prior : null;
                const classification = draft?.status || issue.status;
                return `<article class="management-operations__job">
                    <h3>${escape(planningLabels.reconciliation[issue.category] || issue.category)}</h3>
                    <p class="management-operations__identity">${escape(issue.id)} / evidence ${escape(issue.fingerprint)}</p>
                    <p><strong>${escape(classification.replaceAll('_', ' '))}${draft ? ' (session draft, not resolution)' : ''}</strong></p>
                    ${prior && !draft ? '<p role="status">Earlier draft is stale: supporting evidence changed. Review again.</p>' : ''}
                    <p>${escape(issue.reason)}</p><p><strong>Proposed remediation:</strong> ${escape(issue.remediation)}</p>
                    <details><summary>Affected records and supporting evidence</summary><pre>${escape(JSON.stringify(issue.records, null, 2))}</pre></details>
                    <form id="review-${escape(issue.fingerprint)}" data-review-issue="${escape(issue.id)}" class="management-review">
                        <label>Session review classification<select name="classification" data-custom-select="off">${['unresolved', 'needs_investigation', 'reviewed'].map(value =>
                            `<option value="${value}"${value === classification ? ' selected' : ''}>${value.replaceAll('_', ' ')}</option>`).join('')}</select></label>
                        <label>Evidence reference (required for reviewed)<input name="evidence" maxlength="2000" value="${escape(draft?.evidence || '')}"></label>
                        <label class="management-review__notes">Review notes<textarea name="notes" maxlength="2000">${escape(draft?.notes || '')}</textarea></label>
                        <button type="submit">Keep session draft</button><p data-review-status role="status"></p>
                    </form></article>`;
            }).join('') : '<p class="management-operations__empty">No issues match this category. Unavailable evidence is listed separately; reviewed drafts do not clear operational issues.</p>';
            root.querySelector('[data-review-export]').disabled = reviewDrafts.size === 0;
        }
        root.querySelector('[data-operations-page]').textContent = `${data.page.total} matching records; page ${Math.floor(offset / 25) + 1}. Filters cover the bounded dataset, not just this page.`;
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
        reviewDrafts.clear(); reviewToken = null;
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
        if (reviewToken && reviewToken !== session.token) reviewDrafts.clear();
        reviewToken = session.token;
        if (controller) controller.abort();
        const localController = controller = new AbortController(), id = ++requestId;
        data = null;
        frame();
        root.querySelector('[data-operations-status]').textContent = 'Reading existing operational records...';
        const timer = setTimeout(() => localController.abort(), 55000);
        const current = () => id === requestId && options?.getSession().token === session.token && options.getSession().isAdmin;
        try {
            const endpoint = view === 'overview' ? `management-operations?offset=${offset}&limit=25`
                : `management-planning?view=${view}&filter=${planningFilter}&offset=${offset}&limit=25`;
            const response = await global.fetch(`${options.apiBase}/api/${endpoint}`, {
                method: 'GET', cache: 'no-store', signal: localController.signal, referrerPolicy: 'no-referrer',
                headers: { Authorization: `Bearer ${session.token}` },
            });
            if (!current()) return;
            const result = await response.json();
            if (!current()) return;
            if ([401, 403].includes(response.status)) { reviewDrafts.clear(); reviewToken = null; }
            if (!response.ok || !result.ok) throw new Error(result.error || 'Operations read failed.');
            if (!Array.isArray(result.jobs) || !result.page || result.readOnly !== true) throw new Error('Operations response is incomplete.');
            if (view !== 'overview' && (result.view !== view || !Array.isArray(result.issues) || !result.summary
                || typeof result.complete !== 'boolean' || typeof result.scope !== 'string' || typeof result.reviewOwnerId !== 'string')) {
                throw new Error('Planning response is incomplete.');
            }
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
        if (button.dataset.operationsView && Object.hasOwn(views, button.dataset.operationsView)) {
            view = button.dataset.operationsView; planningFilter = 'all'; offset = 0; load();
        } else if (button.dataset.planningFilter) {
            planningFilter = button.dataset.planningFilter; offset = 0; load();
        } else if (button.hasAttribute('data-review-export')) {
            const session = options?.getSession();
            if (!session?.isAdmin || session.token !== reviewToken || !data) { reset(); return; }
            try {
                const packet = { version: 1, draftOnly: true, approval: false, exportedAt: new Date().toISOString(),
                    warning: 'Untrusted session review drafts, not an operational change or repair authorization. Revalidate every source and obtain separate approval.',
                    reviews: [...reviewDrafts.values()] };
                const url = global.URL.createObjectURL(new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' }));
                const link = document.createElement('a'); link.href = url; link.download = 'h2s-operations-review-drafts.json';
                document.body.append(link); link.click(); link.remove(); setTimeout(() => global.URL.revokeObjectURL(url), 0);
            } catch (error) {
                console.error('Operations review draft export failed.');
                root.querySelector('[data-operations-status]').textContent = 'Review draft export failed. Drafts remain in this session; retry before signing out.';
                root.querySelector('[data-operations-status]').setAttribute('role', 'alert');
            }
        } else if (button.dataset.assignmentJob) openAssignment(button.dataset.assignmentJob, button);
        else if (button.dataset.operationsFilter) {
            filter = button.dataset.operationsFilter;
            frame(); if (data) render();
            else root.querySelector('[data-operations-status]').textContent = controller
                ? 'Reading existing operational records...' : 'Use Refresh to load records.';
        } else if (button.dataset.operationsAction === 'refresh') load();
        else if (button.dataset.operationsAction === 'next') { offset += 25; load(); }
        else if (button.dataset.operationsAction === 'previous') { offset = Math.max(0, offset - 25); load(); }
    });
    root.addEventListener('submit', event => {
        const form = event.target.closest('form[data-review-issue]');
        if (!form) return;
        event.preventDefault();
        const session = options?.getSession();
        if (!session?.isAdmin || session.token !== reviewToken) { reset(); return; }
        const issue = data?.issues?.find(value => value.id === form.dataset.reviewIssue);
        if (!issue || view !== 'reconciliation') return;
        const status = form.elements.classification.value, evidence = form.elements.evidence.value.trim(), notes = form.elements.notes.value.trim();
        const message = form.querySelector('[data-review-status]');
        if (!['unresolved', 'needs_investigation', 'reviewed'].includes(status) || evidence.length > 2000 || notes.length > 2000
            || status === 'reviewed' && (!evidence || !notes)) {
            message.setAttribute('role', 'alert'); message.textContent = 'Reviewed drafts require notes and an evidence reference (maximum 2000 characters each).'; return;
        }
        const previous = reviewDrafts.get(issue.id), changedAt = new Date().toISOString();
        reviewDrafts.set(issue.id, { issueId: issue.id, fingerprint: issue.fingerprint, status, evidence, notes,
            reviewerId: data.reviewOwnerId, changedAt, readAt: data.readAt, approval: false,
            records: issue.records.map(record => ({ source: record.source, id: record.id })),
            history: [...(previous?.history || []), { status, evidence, notes, fingerprint: issue.fingerprint, changedAt, reviewerId: data.reviewOwnerId }] });
        renderPlanning();
        const saved = document.getElementById(`review-${issue.fingerprint}`);
        saved.querySelector('[data-review-status]').textContent = 'Draft kept in this session only. Export before signing out.';
        saved.querySelector('button').focus();
    });
    global.addEventListener('storage', () => reset());
    global.H2SManagementOperations = {
        configure(value) { options = value; reset(); nav.hidden = !options.getSession().isAdmin; },
        open() { return load(); },
        reset,
    };
    reset();
})(window);
