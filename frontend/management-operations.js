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
    let sync = null, syncState = null;
    let search = '', detailTab = 'record', detailData = null, detailError = '', detailController = null, detailVersion = 0;
    const selected = { overview: null, schedule: null, reconciliation: null };
    const reviewDrafts = new Map();
    const reviewInputs = new Map();
    const views = { overview: 'Dispatch Records', schedule: 'Scheduling Visibility', reconciliation: 'Reconciliation Review' };
    const planningLabels = {
        schedule: { all: 'All jobs', upcoming: 'Upcoming installations', scheduled: 'Scheduled starts', unscheduled: 'Unscheduled jobs', attention: 'Management attention', conflicts: 'Observed conflicts' },
        reconciliation: { all: 'All issues', orphan_assignment: 'Orphan assignments', technician_identity: 'Technician identities',
            legacy_relationship: 'Legacy job links', assignment_conflict: 'Assignment conflicts', payout_association: 'Payout associations', source_unavailable: 'Unavailable evidence' },
    };
    const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g,
        char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const evidence = value => value?.status === 'available' ? value.value : null;
    const readable = value => String(value || 'Not recorded').replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
    const date = value => value != null && Number.isFinite(new Date(value).getTime())
        ? `${new Date(value).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone || 'browser local time'})` : 'Schedule not recorded';
    const scheduleDate = (value, timezone) => {
        if (!value || !Number.isFinite(Date.parse(value))) return 'Schedule not recorded';
        if (timezone) {
            try { return `${new Date(value).toLocaleString(undefined, { timeZone: timezone })} (${timezone})`; } catch { /* Keep the recorded instant if the zone cannot be formatted. */ }
        }
        return `${new Date(value).toISOString()} (recorded instant; local timezone unresolved)`;
    };
    const labels = { all: 'All records', upcoming: 'Upcoming installations', assignments: 'Assignment review',
        readiness: 'Preparation review', payments: 'Payment exceptions', payouts: 'Payout review' };
    const done = job => ['completed', 'done', 'cancelled', 'canceled'].includes(job.rawStatus);
    function isDirty() {
        return !!assignmentDialog || !!assignmentAttempt || view === 'reconciliation' && (reviewInputs.size > 0 || reviewDrafts.size > 0)
            || !!global.H2SDataSync?.interacting?.(root)
            || root.contains(document.activeElement) && document.activeElement.matches('input, textarea, select, [contenteditable="true"]');
    }
    function syncStatus() {
        const status = root.querySelector('[data-operations-sync]');
        if (!status) return;
        const messages = { loading: 'Checking for updates…', current: 'Automatic sync current.', stale: 'Updates pending; current edits are preserved.', error: 'Automatic sync failed; displayed evidence may be stale.' };
        status.textContent = syncState ? messages[syncState.status] || '' : 'Read-only evidence.';
        status.title = syncState?.updatedAt ? `Last checked ${date(syncState.updatedAt)}` : '';
    }
    function registerSync() {
        if (sync || !global.H2SDataSync?.register) return;
        sync = global.H2SDataSync.register({
            id: 'management-operations', intervalMs: 60000, minIntervalMs: 15000,
            isActive: () => root.classList.contains('active') && !!options?.getSession()?.isAdmin,
            isDirty,
            refresh: () => load({ background: true }),
            onState(state) { syncState = state; syncStatus(); },
        });
    }
    function metric(label, count, detail, note = '') {
        return `<div title="${escape(detail)}"><dt>${escape(label)}</dt><dd><strong>${escape(count)}</strong>${note ? `<span>${escape(note)}</span>` : ''}</dd></div>`;
    }
    function measured(jobs, known, test) {
        const verified = jobs.filter(known), unknown = jobs.length - verified.length;
        return { count: unknown ? `${verified.filter(test).length} known · ${unknown} unknown` : verified.filter(test).length,
            detail: unknown ? 'Unknown evidence is not zero or clearance.' : 'Verified evidence in loaded records only.' };
    }
    function operationalMetrics(jobs, planning = false) {
        const validStart = value => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/i.test(value) && Number.isFinite(Date.parse(value));
        const startRecorded = job => {
            const start = planning ? job.window?.start : job.scheduledAt;
            if (start === null && (!planning || job.window?.state === 'unscheduled')) return false;
            if (planning && job.window?.state === 'invalid') return null;
            return validStart(start) ? true : null;
        };
        const installation = (job, evaluate) => done(job) || job.kind === 'consultation' ? false
            : job.kind === 'installation' ? evaluate(job) : null;
        const assignmentRows = job => planning ? Array.isArray(job.assignments) ? job.assignments : null : evidence(job.assignments);
        const assignmentState = row => planning ? row.state : row.rawState;
        const committed = ['accepted', 'assigned', 'scheduled', 'in_progress'];
        const knownStates = [...committed, 'pending', 'declined', 'expired', 'cancelled', 'canceled', 'completed', 'done', 'rejected'];
        const pending = job => {
            const rows = assignmentRows(job);
            if (!rows) return null;
            if (rows.some(row => assignmentState(row) === 'pending')) return true;
            return rows.every(row => knownStates.includes(assignmentState(row))) ? false : null;
        };
        const preparationReady = job => {
            const preparation = evidence(job.preparation);
            return typeof preparation?.ready === 'boolean' ? preparation.ready : null;
        };
        const count = evaluate => {
            const results = jobs.map(evaluate), known = results.filter(value => value === true).length,
                unknown = results.filter(value => value === null).length;
            return unknown ? `${known} known · ${unknown} unknown` : known;
        };
        const attention = job => {
            if (planning) {
                if (job.attention?.length || job.conflicts?.length) return true;
                return Array.isArray(job.attention) && Array.isArray(job.conflicts) && data.complete ? false : null;
            }
            if (done(job)) return false;
            const rows = assignmentRows(job), preparation = preparationReady(job);
            const sources = ['order', 'assignments', 'preparation', 'equipment', 'payouts'].map(key => job[key]);
            if (sources.some(source => source?.status === 'needs_review') || job.scheduledAt === null
                || typeof job.scheduledAt === 'string' && !validStart(job.scheduledAt)
                || rows && (rows.length !== 1 || !rows[0].proId || !committed.includes(rows[0].rawState))
                || preparation === false || job.payment?.status === 'unpaid'
                || evidence(job.payouts)?.some(row => row.status && row.status !== 'paid')) return true;
            return sources.every(source => source?.status === 'available') && startRecorded(job) === true
                && preparation !== null && ['paid', 'not_applicable'].includes(job.payment?.status) ? false : null;
        };
        return metric('Awaiting scheduling', count(job => installation(job, value => {
            const recorded = startRecorded(value); return recorded === null ? null : !recorded;
        })), 'Active installations with no recorded start, not jobs merely marked queued. Loaded page only; unresolved kind/window is unknown.')
            + metric('Scheduled (recorded start)', count(job => installation(job, startRecorded)),
                'Active installations with a valid recorded start; not a confirmed booking, complete window or technician acceptance. Loaded page only.')
            + metric('Pending technician acceptance', count(job => installation(job, pending)),
                'Active installations with an explicit pending assignment. Unknown assignment evidence/state is not zero; acceptance is not booking confirmation.')
            + metric('Ready for installation', 'Unknown / unavailable',
                'Preparation alone cannot establish overall installation readiness or payment / availability clearance.',
                `${count(job => installation(job, preparationReady))} preparation-ready`)
            + metric('Completed', count(job => typeof job.rawStatus === 'string' && job.rawStatus ? ['completed', 'done'].includes(job.rawStatus) : null),
                'Loaded jobs explicitly marked completed or done; cancelled jobs are excluded. Not proof of settlement.')
            + metric('Attention', count(attention), planning
                ? 'Loaded jobs with projected attention items or observed conflicts. Empty flags with incomplete evidence remain unknown; not availability clearance.'
                : 'Active loaded jobs with observed schedule, relationship, assignment, preparation, payment or payout review indicators. Unavailable evidence without a known indicator remains unknown.');
    }
    function nextAction(job) {
        if (done(job)) return ['completed', 'done'].includes(job.rawStatus) ? 'Review completion evidence' : 'Review cancellation record';
        if (job.conflicts?.length) return 'Review scheduling conflict';
        if (view === 'schedule') {
            if (!job.window?.start) return 'Review scheduling eligibility';
            if (job.assignments.some(row => row.state === 'pending')) return 'Review technician offer';
            const payment = detailData?.job?.jobId === job.jobId ? detailData.job.payment : null;
            if (payment && !['paid', 'not_applicable'].includes(payment.status)) return 'Review payment issue';
            if (!evidence(job.preparation)?.ready) return 'Review installation readiness';
            return 'Review scheduling eligibility';
        }
        if (!evidence(job.order)) return 'Review customer / order link';
        const assignments = evidence(job.assignments);
        if (!assignments) return 'Review missing technician evidence';
        if (assignments.length !== 1 || !assignments[0].proId) return 'Review technician assignment.';
        if (assignments[0].rawState === 'pending') return 'Review technician offer';
        if (!job.scheduledAt) return 'Review installation window.';
        if (!['paid', 'not_applicable'].includes(job.payment.status)) return 'Review payment issue';
        if (!evidence(job.preparation)?.ready) return 'Review installation readiness';
        return 'Review appointment and technician commitment';
    }
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
            <p>Dispatch, scheduling and reconciliation review.</p></div>
            <button type="button" data-operations-action="retry" hidden>Retry read</button></header>
            <p data-operations-sync role="status" aria-live="polite"></p>
            <div class="management-operations__filters" role="group" aria-label="Operations view">${Object.entries(views).map(([key, label]) =>
                `<button type="button" data-operations-view="${key}" aria-pressed="${key === view}">${label}</button>`).join('')}</div>
            ${view === 'reconciliation' ? '<p>Session drafts only. Reviewed does not mean resolved. Export before sign-out.</p><button type="button" data-review-export disabled>Export session review drafts</button>' : ''}
            <p data-operations-status role="status" aria-live="polite"></p>
            <div class="management-operations__toolbar">
                <label class="management-operations__search">Search ${view === 'reconciliation' ? 'cases' : 'jobs'} on this loaded page
                    <input type="search" data-operations-search maxlength="200" value="${escape(search)}" placeholder="${view === 'reconciliation' ? 'Category or recorded relationship' : 'Customer, service, address or order reference'}"></label>
                <label class="management-operations__search">${view === 'overview' ? 'Filter this page' : 'Filter bounded dataset'}
                    <select data-operations-category aria-label="${view === 'reconciliation' ? 'Case category' : 'Job filter'}">${Object.entries(view === 'overview' ? labels : planningLabels[view]).map(([key, label]) =>
                        `<option value="${key}" ${view === 'overview' ? 'data-operations-filter' : 'data-planning-filter'}="${key}"${key === (view === 'overview' ? filter : planningFilter) ? ' selected' : ''}>${label}</option>`).join('')}</select>
                </label>
            </div>
            <div data-operations-jobs class="management-operations__workbench">
                <section class="management-operations__list" aria-label="${view === 'reconciliation' ? 'Reconciliation cases' : 'Installation jobs'}"><h3>${view === 'reconciliation' ? 'Historical review cases' : 'Installation jobs'}</h3><div data-operations-list></div>
                    <footer class="management-operations__footer"><span data-operations-page></span><div>
                        <button type="button" data-operations-action="previous" disabled>Previous</button>
                        <button type="button" data-operations-action="next" disabled>Next</button></div></footer>
                </section>
                <section class="management-operations__selected" aria-label="Selected record">
                    <div class="management-operations__filters" role="group" aria-label="Selected record context">
                        <button type="button" data-operations-context="record" aria-pressed="${detailTab === 'record'}">${view === 'reconciliation' ? 'Case review' : 'Installation details'}</button>
                        <button type="button" data-operations-context="audit" aria-pressed="${detailTab === 'audit'}">Audit / Technical Evidence</button>
                    </div>
                    <div data-operations-detail ${detailTab === 'audit' ? 'hidden' : ''}></div>
                    <section data-operations-audit ${detailTab === 'record' ? 'hidden' : ''}><h3>Scope and source evidence</h3><p data-operations-scope></p>
                        <dl data-operations-secondary-metrics></dl>
                        <p>Unknown evidence is not zero or clearance. Recorded starts and technician acceptance do not confirm a customer booking. Preparation is not payment or availability clearance.</p>
                        <p>No scheduling, payment, payout or automatic repair changes are made here. Session review drafts are not shared, repair instructions or approvals.</p>
                        <h3>Selected record references</h3><pre data-operations-evidence></pre>
                    </section>
                </section>
            </div>
            <section class="management-operations__summary" aria-label="Loaded-scope summary"><h3 data-operations-summary-title></h3><dl data-operations-metrics></dl></section>`;
        syncStatus();
    }
    function render() {
        if (view !== 'overview') { renderPlanning(); return; }
        const jobs = data.jobs.filter(matches);
        const assignmentMetric = measured(data.jobs.filter(job => !done(job)), job => evidence(job.assignments) !== null, job => {
            const rows = job.assignments.value;
            return rows.length !== 1 || !rows[0].proId || !['accepted', 'assigned', 'scheduled', 'in_progress'].includes(rows[0].rawState);
        });
        const preparationMetric = measured(data.jobs.filter(job => job.kind !== 'consultation'), job => evidence(job.preparation) !== null, job => !job.preparation.value.ready);
        const paymentMetric = measured(data.jobs, job => ['paid', 'unpaid', 'not_applicable'].includes(job.payment.status), job => job.payment.status === 'unpaid');
        root.querySelector('[data-operations-summary-title]').textContent = 'Dispatch overview · loaded page only';
        root.querySelector('[data-operations-secondary-metrics]').innerHTML = metric('Loaded jobs', data.jobs.length, `${jobs.length} match the selected page filter; not a business-wide total.`)
            + metric('Active-job assignment review', assignmentMetric.count, assignmentMetric.detail)
            + metric('Preparation blockers', preparationMetric.count, preparationMetric.detail)
            + metric('Verified unpaid', paymentMetric.count, paymentMetric.detail);
        root.querySelector('[data-operations-metrics]').innerHTML = operationalMetrics(data.jobs);
        root.querySelector('[data-operations-scope]').textContent = `Read ${date(data.readAt)}. Latest records, at most 25 per page. Counts cover loaded records only, not the business. Filters apply to this page only.`;
        root.querySelector('[data-operations-status]').textContent = data.jobs.length
            ? `${jobs.length} of ${data.jobs.length} loaded jobs shown. Filters apply to this page only.`
            : 'No Dispatch records found.';
        renderWorkbench(jobs);
        root.querySelector('[data-operations-page]').textContent = `Latest records, page ${Math.floor(offset / 25) + 1}`;
        root.querySelector('[data-operations-action="previous"]').disabled = offset === 0;
        root.querySelector('[data-operations-action="next"]').disabled = !data.page.hasMore || offset >= 10000;
    }
    function renderPlanning() {
        const status = root.querySelector('[data-operations-status]');
        status.textContent = `${data.complete ? 'Bounded read complete' : 'Incomplete evidence'}. Counts cover loaded records, not all jobs.`;
        root.querySelector('[data-operations-scope]').textContent = `Read ${date(data.readAt)}. ${data.scope}`;
        root.querySelector('[data-operations-summary-title]').textContent = view === 'schedule' ? 'Scheduling · loaded page' : 'Reconciliation · loaded cases';
        const scopeDetail = data.complete ? 'Complete bounded read; not an organization-wide total.' : 'Known in bounded read; additional issues may be unknown.';
        root.querySelector('[data-operations-secondary-metrics]').innerHTML = metric('Jobs in bounded read', data.summary.jobs ?? 'Unknown', scopeDetail)
            + metric('Observed reconciliation issues', data.summary.issues ?? 'Unknown', scopeDetail)
            + (view === 'schedule' ? metric('Loaded scheduling jobs', data.jobs.length, `${data.jobs.filter(job => job.conflicts.length).length} with observed conflicts on this page; absence is not clearance.`)
                : metric('Loaded review cases', data.issues.length, 'Session classifications do not resolve production issues.'))
            + metric('Evidence coverage', data.complete ? 'Bounded read complete' : 'Incomplete / unknown', 'Separate reads, not an atomic snapshot.');
        root.querySelector('[data-operations-metrics]').innerHTML = view === 'schedule' ? operationalMetrics(data.jobs, true)
            : metric('Loaded review cases', data.issues.length, 'Cases on this page only; session classifications do not resolve production issues.');
        if (view === 'schedule') {
            renderWorkbench(data.jobs);
        } else {
            renderWorkbench(data.issues);
            root.querySelector('[data-review-export]').disabled = reviewDrafts.size === 0;
        }
        root.querySelector('[data-operations-page]').textContent = `${data.page.total ?? 'Unknown number of'} matching records; page ${Math.floor(offset / 25) + 1}. Filters cover the bounded dataset, not just this page. Search applies to the loaded page only.`;
        root.querySelector('[data-operations-action="previous"]').disabled = offset === 0;
        root.querySelector('[data-operations-action="next"]').disabled = !data.page.hasMore || offset >= 10000;
    }
    function caseLabel(issue) {
        return `Case ${offset + data.issues.indexOf(issue) + 1} in this result set`;
    }
    function renderCase(issue) {
                const prior = reviewDrafts.get(issue.id), draft = prior?.fingerprint === issue.fingerprint ? prior : null;
                const classification = draft?.status || issue.status;
                const pending = reviewInputs.get(issue.id), input = pending?.fingerprint === issue.fingerprint ? pending : null;
                const priority = ['assignment_conflict', 'payout_association', 'orphan_assignment'].includes(issue.category) ? 'High'
                    : issue.category === 'source_unavailable' ? 'Evidence gap' : 'Relationship review';
                const relationships = issue.records.map(record => {
                    const fields = record.fields || {};
                    const humanLabel = value => typeof value === 'string' && value.trim()
                        && !/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i.test(value) ? value : null;
                    const orderReference = record.source === 'h2s_orders' ? humanLabel(fields.order_id) : null;
                    const customer = record.source === 'h2s_orders' ? humanLabel(fields.customer_name) : null;
                    return `${readable(record.source.replace(/^h2s_/, ''))} · ${[
                        orderReference ? `Recorded order reference: ${orderReference}` : null,
                        customer ? `Recorded customer name: ${customer}` : null,
                    ].filter(Boolean).join(' · ') || 'Name unavailable'} · 1 source record`;
                });
                return `<article class="management-operations__job">
                    <h3>${escape(planningLabels.reconciliation[issue.category] || issue.category)}</h3>
                    <p>${escape(caseLabel(issue))}</p>
                    <p><strong>${escape(classification.replaceAll('_', ' '))}${draft ? ' (session draft, not resolution)' : ''}</strong></p>
                    <p class="management-operations__priority"><strong>Review priority: ${escape(priority)}</strong> · category-based triage, not a verified incident severity</p>
                    ${prior && !draft ? '<p role="status">Earlier draft is stale: supporting evidence changed. Review again.</p>' : ''}
                    ${pending && !input ? '<p role="status">Unsubmitted inputs refer to older evidence. Review current records before re-entering them.</p>' : ''}
                    <p><strong>Evidence / concern:</strong> ${escape(issue.reason)}</p>
                    <p><strong>Affected relationships (${issue.records.length} source records):</strong></p><ul>${relationships.map(value => `<li>${escape(value)}</li>`).join('')}</ul>
                    <p class="management-operations__next"><strong>Recommended review:</strong> ${escape(issue.remediation)}</p>
                    <p>No automatic repair. Reviewed does not mean resolved; approval and any production change remain separate.</p>
                    <form id="review-${escape(issue.fingerprint)}" data-review-issue="${escape(issue.id)}" class="management-review">
                        <label>Session review classification<select name="classification">${['unresolved', 'needs_investigation', 'reviewed'].map(value =>
                            `<option value="${value}"${value === (input?.classification || classification) ? ' selected' : ''}>${value.replaceAll('_', ' ')}</option>`).join('')}</select></label>
                        <label>Evidence reference (required for reviewed)<input name="evidence" maxlength="2000" value="${escape(input?.evidence ?? draft?.evidence ?? '')}"></label>
                        <label class="management-review__notes">Review notes<textarea name="notes" maxlength="2000">${escape(input?.notes ?? draft?.notes ?? '')}</textarea></label>
                        <button type="submit">Keep session draft</button><p data-review-status role="status"></p>
                    </form></article>`;
    }
    function identity(job) {
        const order = view === 'schedule' ? { customerName: job.customerName, service: job.service, address: job.address, reference: job.orderReference }
            : evidence(job.order) || {};
        return { ...order, reference: humanReference(order.reference) };
    }
    function humanReference(value) {
        return typeof value === 'string' && !/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i.test(value) ? value : null;
    }
    function equipmentScope(value) {
        if (!value) return 'Not provided';
        if (!/^[\[{]/.test(value.trim())) return value;
        try {
            const rows = JSON.parse(value);
            if (Array.isArray(rows) && rows.every(row => row && typeof row.name === 'string')) return rows.map(row =>
                `${row.name}${Number.isFinite(row.quantity) ? ' × ' + row.quantity : ''}`).join('; ');
        } catch { /* Raw source remains accessible in Audit. */ }
        return 'Equipment scope requires source review in Audit';
    }
    function technician(job) {
        const rows = view === 'schedule' ? job.assignments : evidence(job.assignments);
        if (!rows) return 'Technician evidence unavailable';
        return rows.length ? rows.map(row => `${view === 'schedule' ? row.identity?.name || 'Identity not verified' : row.name || 'Identity not verified'} · ${readable(row.state || row.rawState)}`).join('; ')
            : 'No technician assigned';
    }
    function preparation(job) {
        const value = evidence(job.preparation);
        return value ? value.ready ? 'Preparation ready (not payment clearance)' : value.blockers.join('; ') || 'Readiness review required' : 'Readiness evidence unavailable';
    }
    function section(key, title, fields) {
        return `<section class="management-operations__section" data-job-section="${key}" tabindex="-1"><h3>${title}</h3><dl>${fields.map(([label, value]) =>
            `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl></section>`;
    }
    function renderJob(job) {
        const record = view === 'overview' ? job : detailData?.job;
        const customer = record ? evidence(record.order) || {} : identity(job);
        const equipment = evidence(record?.equipment), payment = record?.payment;
        const planning = view === 'schedule', window = planning ? job.window : null;
        const action = nextAction(job);
        const target = /completion|settlement/i.test(action) ? 'completion' : /payment/i.test(action) ? 'payments'
            : /readiness|preparation|blocker/i.test(action) ? 'readiness' : /technician|assignment|offer/i.test(action) ? 'technician'
                : /schedul|window|appointment|commitment|conflict/i.test(action) ? 'schedule' : 'overview';
        const conflicts = job.conflicts || [];
        return `<article class="management-operations__job">
            <header><h3 data-selected-title tabindex="-1">${escape(customer.customerName || 'Customer not verified')}</h3>
                <p>${escape(customer.service || 'Service not verified')} · ${escape(readable(job.rawStatus))}</p>
                <p>${escape(humanReference(customer.reference) || 'Order reference not verified')}</p>
                <button type="button" data-return-job-list>Choose another job</button></header>
            <div class="management-operations__next"><strong>Next review:</strong> ${escape(action)}
                <button type="button" data-job-focus="${target}">${escape(action)}</button></div>
            ${planning ? `<p data-selected-read-status role="${detailError ? 'alert' : 'status'}">${escape(detailError || (record ? 'Selected job evidence loaded separately from scheduling; see Audit for read times.' : 'Checking selected job, equipment and payment evidence…'))}
                ${detailError ? '<button type="button" data-selected-retry>Retry selected job read</button>' : ''}</p>` : ''}
            <div class="management-operations__sections">
                ${section('overview', 'Overview', [['Customer', customer.customerName || 'Not verified'], ['Service', customer.service || 'Not verified'],
                    ['Address', customer.address || 'Not verified'], ['Installation status', readable(job.rawStatus)], ['Order status', 'Not provided by this read'],
                    ['Assigned representative', 'Not provided by this read']])}
                ${section('schedule', 'Schedule', [['Appointment', planning ? scheduleDate(window.start, window.timezone) : date(job.scheduledAt)],
                    ['Appointment end', planning ? scheduleDate(window.end, window.timezone) : 'Not provided by dispatch read'],
                    ['Timezone', planning ? window.timezone || 'Timezone unresolved' : 'Browser timezone; job timezone is not provided by this dispatch read.'],
                    ['Reservation status', planning ? readable(job.reservationEvidence) + ' · assignment acceptance is not appointment confirmation.' : 'Not provided by dispatch read'],
                    ['Rescheduling', 'Requires management review; no schedule change is made here.'],
                    ['Scheduling conflicts', conflicts.length ? conflicts.map(c => readable(c.code) + ': ' + c.detail).join('; ') : 'None observed in this read; not availability clearance.']])}
                ${section('technician', 'Technician', [['Assignment / offer', technician(job)],
                    ['Acceptance', 'Recorded offer status above; acceptance is not bound to a rescheduled appointment.'],
                    ['Availability', planning ? job.availability.length ? job.availability.map(row => readable(row.status)).join('; ') + ' · not full capacity clearance'
                        : 'No verified technician to evaluate' : 'Not provided by dispatch read'],
                    ['Next action', done(job) ? 'Review recorded installation outcome' : 'Review offer and verify the current installation window']])}
                ${(record ? data.assignmentManagementEnabled === true || detailData?.assignmentManagementEnabled === true : false) && !done(job)
                    ? `<button type="button" data-assignment-job="${escape(job.jobId)}">Review job / technician offer</button>` : ''}
                ${section('readiness', 'Readiness', [['Preparation', preparation(job)], ['Equipment', equipment
                    ? `Required: ${equipment.required === null ? 'unverified' : equipment.required ? 'yes' : 'no'}; stage: ${equipment.stage || 'not recorded'}` : 'Equipment evidence not available'],
                    ['Equipment scope', equipmentScope(equipment?.scope)], ['Materials', 'Item-level evidence not provided by this read'],
                    ['Access / approvals', 'Individual access and approval evidence not provided; review recorded blockers.']])}
                ${section('payments', 'Payments', [['Verified order payment', payment ? readable(payment.status) + ' · ' + payment.detail : 'Not checked; selected job evidence required'],
                    ['Verified deposit', 'Deposit allocation not provided by this read'], ['Outstanding balance', 'Balance ledger not provided by this read'],
                    ['Payment checked', payment?.checkedAt ? date(payment.checkedAt) : 'No verification timestamp provided']])}
                ${section('completion', 'Completion', [['Installation status', readable(job.rawStatus)], ['Installation evidence', 'Completion artifacts not provided by this read'],
                    ['Actual costs', 'Actual-cost evidence not provided by this read'], ['Technician settlement', evidence(record?.payouts)
                        ? 'Recorded settlement evidence is available in Audit; no payout changes here.' : 'Settlement relationship not verified']])}
            </div></article>`;
    }
    function renderWorkbench(rows) {
        const query = search.trim().toLocaleLowerCase();
        const matchesSearch = item => {
            const value = view === 'reconciliation'
                ? [planningLabels.reconciliation[item.category], item.reason, ...item.records.map(record => JSON.stringify(record.fields))]
                : Object.values(identity(item));
            return !query || value.filter(Boolean).join(' ').toLocaleLowerCase().includes(query);
        };
        const shown = rows.filter(matchesSearch), id = item => view === 'reconciliation' ? item.id : item.jobId;
        if (selected[view] === null && shown.length) selected[view] = id(shown[0]);
        const item = shown.find(row => id(row) === selected[view]);
        const list = root.querySelector('[data-operations-list]'), scrollTop = list.scrollTop;
        list.innerHTML = `<p>${shown.length} of ${rows.length} records on this page match search.</p>` + (shown.length ? shown.map(row => {
            const person = view === 'reconciliation' ? null : identity(row);
            return `<button type="button" class="management-operations__record" data-operation-record="${escape(id(row))}" aria-pressed="${id(row) === selected[view]}">
                <strong>${escape(person ? person.customerName || 'Customer not verified' : `${caseLabel(row)} · ${planningLabels.reconciliation[row.category] || readable(row.category)}`)}</strong>
                <span>${escape(person ? person.service || 'Service not verified' : readable(row.status))}</span>
                ${person ? `<span class="management-operations__badge">${escape(readable(row.rawStatus))}</span>
                    <span>${escape(view === 'schedule' ? scheduleDate(row.window.start, row.window.timezone) : date(row.scheduledAt))}</span>
                    <span>${escape(person.reference || 'Order reference not verified')}</span><span>${escape(technician(row))}</span><span>${escape(preparation(row))}</span>
                    <span>Payment: ${escape(row.payment ? readable(row.payment.status) : row.jobId === detailData?.job?.jobId ? readable(detailData.job.payment?.status) : 'Not checked in scheduling list')}</span>
                    <span class="management-operations__record-next">${escape(nextAction(row))}</span>` : `<span>${escape(row.records.length)} affected source records · historical review</span>`}</button>`;
        }).join('') : '<p class="management-operations__empty">No records match on this page. Other pages may contain matching records.</p>');
        list.scrollTop = scrollTop;
        const focusTitle = root.querySelector('[data-selected-title]') === document.activeElement;
        root.querySelector('[data-operations-detail]').innerHTML = item ? view === 'reconciliation' ? renderCase(item) : renderJob(item)
            : '<p class="management-operations__empty">Select a record from the loaded list. The previous selection is not in this filtered page.</p>';
        root.querySelector('[data-operations-evidence]').textContent = JSON.stringify({ readAt: data.readAt, sources: data.sources || null,
            selectedRecord: item || null, selectedDispatchEvidence: view === 'schedule' && item?.jobId === detailData?.job?.jobId ? detailData : null }, null, 2);
        if (focusTitle) root.querySelector('[data-selected-title]')?.focus({ preventScroll: true });
    }
    async function readSelectedJob() {
        if (detailController) detailController.abort();
        const id = ++detailVersion, jobId = selected[view], token = options?.getSession().token;
        detailData = null; detailError = '';
        if (view !== 'schedule' || !jobId || !data?.jobs.some(row => row.jobId === jobId)) return;
        const local = detailController = new AbortController();
        const timer = setTimeout(() => local.abort(), 30000);
        const current = () => id === detailVersion && view === 'schedule' && selected.schedule === jobId
            && options.getSession().token === token && options.getSession().isAdmin;
        try {
            const response = await global.fetch(`${options.apiBase}/api/management-operations?jobId=${encodeURIComponent(jobId)}&offset=0&limit=1`, {
                method: 'GET', cache: 'no-store', signal: local.signal, headers: { Authorization: `Bearer ${token}` },
            });
            const result = await response.json();
            if (!current()) return;
            if ([401, 403].includes(response.status)) {
                reset();
                root.querySelector('[data-operations-status]').textContent = 'Selected job access was denied. Sign in again.';
                root.querySelector('[data-operations-status]').setAttribute('role', 'alert');
                return;
            }
            if (!response.ok || !result.ok) throw new Error(result.error || 'Selected job evidence could not be loaded.');
            if (result.readOnly !== true || result.jobs?.length !== 1 || result.jobs[0].jobId !== jobId) throw new Error('Selected job was not found or its relationship changed. No other job was substituted.');
            detailData = { job: result.jobs[0], readAt: result.readAt, assignmentManagementEnabled: result.assignmentManagementEnabled === true };
            renderWorkbench(data.jobs);
        } catch (error) {
            if (id !== detailVersion) return;
            if (!current()) {
                if (!data) { root.querySelector('[data-operations-status]').textContent = error.message; root.querySelector('[data-operations-status]').setAttribute('role', 'alert'); }
                return;
            }
            console.error('Operations selected job read failed.');
            detailError = error.name === 'AbortError' ? 'Selected job read timed out. No verified payment or equipment status is implied.' : error.message;
            renderWorkbench(data.jobs);
        } finally { clearTimeout(timer); if (detailController === local) detailController = null; }
    }
    function reset() {
        detailVersion++; detailController?.abort(); detailController = null;
        detailData = null; detailError = ''; search = ''; detailTab = 'record';
        for (const key of Object.keys(selected)) selected[key] = null;
        sync?.invalidate();
        syncState = null;
        assignmentVersion++;
        if (assignmentController) assignmentController.abort();
        assignmentAttempt = null;
        if (assignmentDialog) { assignmentDialog.remove(); assignmentDialog = null; }
        requestId++;
        if (controller) controller.abort();
        controller = null; data = null; offset = 0;
        reviewDrafts.clear(); reviewInputs.clear(); reviewToken = null;
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
            if (sync) sync.request('assignment-review-closed');
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
            controls.innerHTML = `            <h3>Confirm proposed offer</h3><p>${escape(name)} / selected installation</p>
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
                    if (sync) { sync.invalidate(); sync.request('assignment-saved', { force: true }); }
                    else load();
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
            dialog.querySelector('[data-assignment-details]').innerHTML = `<div role="group" aria-label="Offer review context">
                <button type="button" data-assignment-context="record" aria-pressed="true">Offer review</button>
                <button type="button" data-assignment-context="audit" aria-pressed="false">Audit / Technical Evidence</button></div>
                <section data-assignment-record><h3>${escape(job.service || 'Installation')}</h3>
                <p>${escape(job.customerName)} / ${escape(job.orderReference)} / ${escape(date(job.scheduledAt))}</p>
                <p>Job status: ${escape(job.rawStatus)}</p><p data-assignment-current>Recorded assignments: ${escape(job.assignments.length
                    ? job.assignments.map(row => `${row.proReference}: ${row.state || 'unknown'}`).join('; ') : 'None')}</p>
                ${job.legacyPayoutBridge ? '' : '<p>No verified legacy payout-job bridge. This offer creates no payout or legacy job.</p>'}
                </section>
                <section data-assignment-audit hidden><h3>Assignment audit (latest 20 events)</h3>${result.history?.length ? `<ul>${result.history.map(event =>
                    `<li>${escape(date(event.created_at))}: ${escape(event.old_state || 'none')} to ${escape(event.new_state)} / ${escape(event.actor_user_id || event.source)}${event.note ? ` / ${escape(event.note)}` : ''}</li>`).join('')}</ul>` : '<p>No management audit events recorded.</p>'}</section>`;
            dialog.querySelectorAll('[data-assignment-context]').forEach(button => button.addEventListener('click', () => {
                const audit = button.dataset.assignmentContext === 'audit';
                dialog.querySelector('[data-assignment-audit]').hidden = !audit;
                dialog.querySelector('[data-assignment-record]').hidden = audit;
                controls.hidden = audit;
                dialog.querySelectorAll('[data-assignment-context]').forEach(control => control.setAttribute('aria-pressed', String((control.dataset.assignmentContext === 'audit') === audit)));
            }));
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
    async function load({ background = false } = {}) {
        const session = options?.getSession();
        if (!session?.isAdmin || !session.token) { reset(); return false; }
        const accountChanged = reviewToken && reviewToken !== session.token;
        if (accountChanged) reset();
        if (background && isDirty()) return false;
        reviewToken = session.token;
        detailVersion++; detailController?.abort(); detailController = null;
        if (controller) controller.abort();
        const localController = controller = new AbortController(), id = ++requestId;
        const preserve = background && !!data;
        if (!preserve) {
            data = null; detailData = null; detailError = '';
            frame();
            root.querySelector('[data-operations-status]').textContent = 'Reading existing operational records...';
        }
        const timer = setTimeout(() => localController.abort(), 55000);
        const current = () => id === requestId && options?.getSession().token === session.token && options.getSession().isAdmin;
        try {
            const endpoint = view === 'overview' ? `management-operations?offset=${offset}&limit=25`
                : `management-planning?view=${view}&filter=${planningFilter}&offset=${offset}&limit=25`;
            const response = await global.fetch(`${options.apiBase}/api/${endpoint}`, {
                method: 'GET', cache: 'no-store', signal: localController.signal, referrerPolicy: 'no-referrer',
                headers: { Authorization: `Bearer ${session.token}` },
            });
            if (!current()) return false;
            const result = await response.json();
            if (!current()) return false;
            if ([401, 403].includes(response.status)) {
                reviewDrafts.clear(); reviewInputs.clear(); reviewToken = null; data = null;
                assignmentVersion++; assignmentAttempt = null;
                if (assignmentController) assignmentController.abort();
                if (assignmentDialog) { assignmentDialog.remove(); assignmentDialog = null; }
                frame();
            }
            if (!response.ok || !result.ok) throw new Error(result.error || 'Operations read failed.');
            if (!Array.isArray(result.jobs) || !result.page || result.readOnly !== true) throw new Error('Operations response is incomplete.');
            if (view !== 'overview' && (result.view !== view || !Array.isArray(result.issues) || !result.summary
                || typeof result.complete !== 'boolean' || typeof result.scope !== 'string' || typeof result.reviewOwnerId !== 'string')) {
                throw new Error('Planning response is incomplete.');
            }
            if (background && isDirty()) { sync?.invalidate(); return false; }
            data = result;
            detailData = null; detailError = '';
            root.querySelector('[data-operations-status]').setAttribute('role', 'status');
            root.querySelector('[data-operations-action="retry"]').hidden = true;
            render();
            if (view === 'schedule') readSelectedJob();
            return true;
        } catch (error) {
            if (!current()) return false;
            console.error('Operations view read failed.');
            const status = root.querySelector('[data-operations-status]');
            status.setAttribute('role', 'alert');
            status.textContent = `${error.name === 'AbortError' ? 'Operations read timed out.' : error.message} ${data ? 'Displayed records are stale; no current clearance is implied. ' : ''}Use Retry read to retry.`;
            root.querySelector('[data-operations-action="retry"]').hidden = false;
            if (background) throw error;
            return false;
        } finally {
            clearTimeout(timer);
            if (controller === localController) controller = null;
        }
    }
    root.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button || !root.contains(button) || button.disabled) return;
        if (button.dataset.operationsContext) {
            detailTab = button.dataset.operationsContext;
            root.querySelector('[data-operations-detail]').hidden = detailTab !== 'record';
            root.querySelector('[data-operations-audit]').hidden = detailTab !== 'audit';
            root.querySelectorAll('[data-operations-context]').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.operationsContext === detailTab)));
        } else if (button.dataset.operationRecord) {
            const session = options?.getSession();
            if (!session?.isAdmin || session.token !== reviewToken) { reset(); return; }
            selected[view] = button.dataset.operationRecord;
            detailTab = 'record'; detailData = null; detailError = '';
            root.querySelector('[data-operations-detail]').hidden = false; root.querySelector('[data-operations-audit]').hidden = true;
            root.querySelectorAll('[data-operations-context]').forEach(control => control.setAttribute('aria-pressed', String(control.dataset.operationsContext === 'record')));
            render(); if (view === 'schedule') readSelectedJob();
            const list = root.querySelector('[data-operations-list]'), row = root.querySelector('[data-operation-record][aria-pressed="true"]');
            if (row) {
                const bounds = list.getBoundingClientRect(), selectedBounds = row.getBoundingClientRect();
                if (selectedBounds.top < bounds.top) list.scrollTop += selectedBounds.top - bounds.top;
                else if (selectedBounds.bottom > bounds.bottom) list.scrollTop += selectedBounds.top - bounds.top;
            }
            const title = root.querySelector('[data-selected-title]') || root.querySelector('[data-operations-detail] h3');
            if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); if (global.matchMedia?.('(max-width: 1024px)').matches) title.scrollIntoView?.({ block: 'center', behavior: 'instant' }); }
        } else if (button.dataset.jobFocus) {
            const section = root.querySelector(`[data-job-section="${button.dataset.jobFocus}"]`);
            section?.focus({ preventScroll: true }); section?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
        } else if (button.hasAttribute('data-return-job-list')) {
            const record = root.querySelector('[data-operation-record][aria-pressed="true"]');
            record?.focus(); record?.scrollIntoView?.({ block: 'center', behavior: 'instant' });
        } else if (button.hasAttribute('data-selected-retry')) readSelectedJob();
        else if (button.dataset.operationsView && Object.hasOwn(views, button.dataset.operationsView)) {
            view = button.dataset.operationsView; planningFilter = 'all'; offset = 0; search = ''; detailTab = 'record'; load();
        } else if (button.dataset.planningFilter) {
            planningFilter = button.dataset.planningFilter; selected[view] = null; offset = 0; load();
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
            filter = button.dataset.operationsFilter; selected[view] = null;
            frame(); if (data) render();
            else root.querySelector('[data-operations-status]').textContent = controller
                ? 'Reading existing operational records...' : 'Reopen Operations to load records.';
        } else if (button.dataset.operationsAction === 'retry') {
            if (sync && !isDirty()) sync.request('retry', { force: true });
            else load();
        } else if (button.dataset.operationsAction === 'next') { selected[view] = null; offset += 25; load(); }
        else if (button.dataset.operationsAction === 'previous') { selected[view] = null; offset = Math.max(0, offset - 25); load(); }
    });
    root.addEventListener('keydown', event => {
        const item = event.target.closest('[data-operation-record]');
        if (!item || !['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...root.querySelectorAll('[data-operation-record]')], index = buttons.indexOf(item);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
        event.preventDefault();
        const id = buttons[next].dataset.operationRecord; buttons[next].click();
        [...root.querySelectorAll('[data-operation-record]')].find(button => button.dataset.operationRecord === id)?.focus();
    });
    function rememberReviewInput(event) {
        if (event.target.matches('[data-operations-category]')) {
            if (event.type !== 'change') return;
            selected[view] = null; offset = 0;
            if (view === 'overview') { filter = event.target.value; if (data) render(); }
            else { planningFilter = event.target.value; load(); }
            return;
        }
        if (event.target.matches('[data-operations-search]')) {
            search = event.target.value; if (data) render(); return;
        }
        const form = event.target.closest('form[data-review-issue]');
        const session = options?.getSession();
        if (!form || !session?.isAdmin || session.token !== reviewToken) return;
        const issue = data?.issues?.find(value => value.id === form.dataset.reviewIssue);
        if (!issue) return;
        reviewInputs.set(issue.id, { fingerprint: issue.fingerprint, classification: form.elements.classification.value,
            evidence: form.elements.evidence.value, notes: form.elements.notes.value });
    }
    root.addEventListener('input', rememberReviewInput);
    root.addEventListener('change', rememberReviewInput);
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
        reviewInputs.delete(issue.id);
        renderPlanning();
        const saved = document.getElementById(`review-${issue.fingerprint}`);
        saved.querySelector('[data-review-status]').textContent = 'Draft kept in this session only. Export before signing out.';
        saved.querySelector('button').focus();
    });
    global.addEventListener('storage', () => reset());
    global.H2SManagementOperations = {
        configure(value) { options = value; reset(); nav.hidden = !options.getSession().isAdmin; registerSync(); },
        open() {
            const session = options?.getSession();
            if (!session?.isAdmin || !session.token) { reset(); return Promise.resolve(false); }
            if (reviewToken && reviewToken !== session.token) reset();
            registerSync();
            return sync ? sync.request('show') : load();
        },
        reset,
    };
    reset();
})(window);
