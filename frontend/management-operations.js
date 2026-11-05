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
    const reviewDrafts = new Map();
    const reviewInputs = new Map();
    const views = { overview: 'Overview / dispatch', schedule: 'Scheduling visibility', reconciliation: 'Reconciliation review' };
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
        return !!assignmentDialog || !!assignmentAttempt || reviewInputs.size > 0 || reviewDrafts.size > 0
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
        if (!evidence(job.order)) return 'Verify customer / order link.';
        const assignments = evidence(job.assignments);
        if (!assignments) return 'Restore assignment evidence.';
        if (assignments.length !== 1 || !assignments[0].proId) return 'Review technician assignment.';
        if (!job.scheduledAt) return 'Review installation window.';
        if (!['paid', 'not_applicable'].includes(job.payment.status)) return 'Verify payment separately.';
        if (!evidence(job.preparation)?.ready) return 'Review preparation blockers.';
        if (done(job)) return 'Review completion / settlement.';
        return 'Confirm appointment and technician commitment.';
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
            <div class="management-operations__filters" role="group" aria-label="${view === 'overview' ? 'Filter this page' : 'Filter bounded dataset'}">
            ${Object.entries(view === 'overview' ? labels : planningLabels[view]).map(([key, label]) => `<button type="button" ${view === 'overview' ? 'data-operations-filter' : 'data-planning-filter'}="${key}"
                aria-pressed="${key === (view === 'overview' ? filter : planningFilter)}">${label}</button>`).join('')}</div>
            ${view === 'reconciliation' ? '<p>Session drafts only. Reviewed does not mean resolved. Export before sign-out.</p><button type="button" data-review-export disabled>Export session review drafts</button>' : ''}
            <p data-operations-status role="status" aria-live="polite"></p>
            <section class="management-operations__summary" aria-label="Loaded-scope summary"><h3 data-operations-summary-title></h3><dl data-operations-metrics></dl>
            <details><summary>Scope and evidence limits</summary><p data-operations-scope></p>
            <dl data-operations-secondary-metrics></dl>
            <p>Metric criteria are available in each metric's tooltip. Unknown evidence is not zero or clearance. Recorded starts and technician acceptance do not confirm a customer booking. Preparation is not payment or availability clearance.</p>
            <p>Technician offers require separate review and confirmation. No scheduling, payment, payout or automatic repair changes are made here. Session review drafts are not shared, saved to production, repair instructions or approvals.</p></details></section>
            <div data-operations-jobs></div>
            <footer class="management-operations__footer"><span data-operations-page></span><div>
            <button type="button" data-operations-action="previous" disabled>Previous</button>
            <button type="button" data-operations-action="next" disabled>Next</button></div></footer>`;
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
        root.querySelector('[data-operations-jobs]').innerHTML = jobs.length ? jobs.map(job => {
            const order = evidence(job.order), assignments = evidence(job.assignments),
                preparation = evidence(job.preparation), equipment = evidence(job.equipment), payouts = evidence(job.payouts);
            const assignedText = assignments ? assignments.length
                ? assignments.map(row => `${row.name || 'Technician identity unresolved'} (${readable(row.rawState)})`).join('; ')
                : 'No active assignment recorded' : job.assignments.detail;
            const payoutText = payouts ? payouts.length ? payouts.map(row =>
                `Settlement: ${row.status || 'unknown'}; approval: ${row.state || 'not recorded'}; amount: ${row.amount == null ? 'not recorded' : row.amount}`).join('; ')
                : 'No ledger entries recorded for verified job/technician' : job.payouts.detail;
            return `<article class="management-operations__job"><h3>${escape(order?.service || 'Service requires reconciliation')}</h3>
                <p>${escape(order?.customerName || 'Customer not verified')} / ${escape(order?.address || 'Address not verified')}</p>
                <p>${escape(order?.reference || job.order.detail || 'Order reference unverified')} / ${escape(job.kind === 'installation' ? 'Installation' : job.kind === 'consultation' ? 'Consultation' : 'Job record')}</p>
                <p class="management-operations__next"><strong>Next review:</strong> ${escape(nextAction(job))}</p>
                <dl><div><dt>Job / schedule</dt><dd>${escape(readable(job.rawStatus))} / ${escape(date(job.scheduledAt))}<p>Browser timezone; job timezone is not provided by this dispatch read.</p></dd></div>
                <div><dt>Technician assignment</dt><dd>${escape(assignedText)}${assignments?.length > 1 ? ' / Conflicting assignments' : ''}</dd></div>
                <div><dt>Preparation</dt><dd>${escape(preparation ? preparation.ready ? 'Preparation ready (not payment clearance)'
                    : preparation.blockers.join('; ') || 'Preparation review required' : job.preparation.detail)}</dd></div>
                <div><dt>Equipment requirements</dt><dd>${escape(equipment ? `Required: ${equipment.required === null ? 'unverified' : equipment.required ? 'yes' : 'no'}; stage: ${equipment.stage || 'not recorded'}`
                    : job.equipment.detail)}${equipment?.scope ? `<pre>${escape(equipment.scope)}</pre>` : ''}</dd></div>
                <div><dt>Payment verification</dt><dd>${escape(readable(job.payment.status))} / ${escape(job.payment.detail)}${job.payment.checkedAt ? `<p>Checked ${escape(date(job.payment.checkedAt))}</p>` : ''}</dd></div>
                <div><dt>Technician payout</dt><dd>${escape(payoutText)}</dd></div></dl>
                <button type="button" data-assignment-job="${escape(job.jobId)}">Review job / technician offer</button>
                <details><summary>Technical record references</summary><p class="management-operations__identity">Job ${escape(job.jobId)}</p></details></article>`;
        }).join('') : `<p class="management-operations__empty">${data.jobs.length ? 'No records match this filter on this page.' : 'There are no jobs to display.'}</p>`;
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
        const content = root.querySelector('[data-operations-jobs]');
        if (view === 'schedule') {
            content.innerHTML = data.jobs.length ? data.jobs.map(job => `<article class="management-operations__job">
                <h3>${escape(job.service || 'Unresolved service')}</h3>
                <p>Customer details are not provided by this scheduling read · ${escape(job.orderReference || 'Order unresolved')}</p>
                <p class="management-operations__next"><strong>Next review:</strong> ${escape(job.conflicts.length ? 'Review overlapping commitments.'
                    : job.attention.length ? 'Review attention items and missing evidence.' : 'Verify reservation and availability.')}</p>
                <dl><div><dt>Installation window / ${escape(readable(job.rawStatus))}</dt><dd>${escape(readable(job.window.state))}: ${escape(scheduleDate(job.window.start, job.window.timezone))}
                    to ${escape(job.window.end ? scheduleDate(job.window.end, job.window.timezone) : 'End not recorded')} / ${escape(job.window.timezone || 'Timezone unresolved')}</dd></div>
                <div><dt>Technician assignments</dt><dd>${escape(job.assignments.length ? job.assignments.map(a =>
                    `${a.identity.name || 'Technician identity unresolved'} / ${readable(a.state)} / ${readable(a.identity.status)}`).join('; ') : 'No unclosed assignment')}</dd></div>
                <div><dt>Customer reservation</dt><dd>${escape(readable(job.reservationEvidence))}. Assignment acceptance is not appointment confirmation.</dd></div>
                <div><dt>Availability evidence</dt><dd>${escape(job.availability.length ? job.availability.map(a => `${readable(a.status)}: ${a.detail}`).join('; ') : 'No verified technician to evaluate')}
                    ${job.availability.some(a => a.dispatchCapacity.length) ? 'Dispatch capacity rows exist; no cross-directory identity or capacity clearance is inferred.' : ''}</dd></div>
                <div><dt>Installation readiness</dt><dd>${escape(job.preparation.status === 'available' ? job.preparation.value.ready ? 'Preparation ready (not payment clearance)'
                    : job.preparation.value.blockers.join('; ') || 'Preparation review required' : job.preparation.detail)}</dd></div>
                <div><dt>Observed scheduling conflicts</dt><dd>${escape(job.conflicts.length ? job.conflicts.map(c => `${readable(c.code)}: ${c.detail} (related job: ${c.reference})`).join('; ')
                    : 'None observed in available evidence; not availability clearance.')}</dd></div></dl>
                ${job.attention.length ? `<p><strong>Management attention:</strong> ${escape(job.attention.join(' '))}</p>` : ''}
                <details><summary>Source evidence</summary><pre>${escape(JSON.stringify({ jobId: job.jobId, assignments: job.assignments, reservation: job.reservation,
                    availability: job.availability, conflicts: job.conflicts, legacyLink: job.legacyLink }, null, 2))}</pre></details>
                <button type="button" data-assignment-job="${escape(job.jobId)}">Review job / technician offer</button></article>`).join('')
                : '<p class="management-operations__empty">No jobs match this scheduling filter.</p>';
        } else {
            content.innerHTML = data.issues.length ? data.issues.map(issue => {
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
                    <p><strong>${escape(classification.replaceAll('_', ' '))}${draft ? ' (session draft, not resolution)' : ''}</strong></p>
                    <p class="management-operations__priority"><strong>Review priority: ${escape(priority)}</strong> · category-based triage, not a verified incident severity</p>
                    ${prior && !draft ? '<p role="status">Earlier draft is stale: supporting evidence changed. Review again.</p>' : ''}
                    ${pending && !input ? '<p role="status">Unsubmitted inputs refer to older evidence. Review current records before re-entering them.</p>' : ''}
                    <p><strong>Evidence / concern:</strong> ${escape(issue.reason)}</p>
                    <p><strong>Affected relationships (${issue.records.length} source records):</strong></p><ul>${relationships.map(value => `<li>${escape(value)}</li>`).join('')}</ul>
                    <p class="management-operations__next"><strong>Recommended review:</strong> ${escape(issue.remediation)}</p>
                    <p>No automatic repair. Reviewed does not mean resolved; approval and any production change remain separate.</p>
                    <details><summary>Technical records and supporting evidence</summary><pre>${escape(JSON.stringify({ issueId: issue.id, fingerprint: issue.fingerprint, records: issue.records }, null, 2))}</pre></details>
                    <form id="review-${escape(issue.fingerprint)}" data-review-issue="${escape(issue.id)}" class="management-review">
                        <label>Session review classification<select name="classification">${['unresolved', 'needs_investigation', 'reviewed'].map(value =>
                            `<option value="${value}"${value === (input?.classification || classification) ? ' selected' : ''}>${value.replaceAll('_', ' ')}</option>`).join('')}</select></label>
                        <label>Evidence reference (required for reviewed)<input name="evidence" maxlength="2000" value="${escape(input?.evidence ?? draft?.evidence ?? '')}"></label>
                        <label class="management-review__notes">Review notes<textarea name="notes" maxlength="2000">${escape(input?.notes ?? draft?.notes ?? '')}</textarea></label>
                        <button type="submit">Keep session draft</button><p data-review-status role="status"></p>
                    </form></article>`;
            }).join('') : '<p class="management-operations__empty">No issues match this category. Unavailable evidence is listed separately; reviewed drafts do not clear operational issues.</p>';
            root.querySelector('[data-review-export]').disabled = reviewDrafts.size === 0;
        }
        root.querySelector('[data-operations-page]').textContent = `${data.page.total ?? 'Unknown number of'} matching records; page ${Math.floor(offset / 25) + 1}. Filters cover the bounded dataset, not just this page.`;
        root.querySelector('[data-operations-action="previous"]').disabled = offset === 0;
        root.querySelector('[data-operations-action="next"]').disabled = !data.page.hasMore || offset >= 10000;
    }
    function reset() {
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
    async function load({ background = false } = {}) {
        const session = options?.getSession();
        if (!session?.isAdmin || !session.token) { reset(); return false; }
        const accountChanged = reviewToken && reviewToken !== session.token;
        if (accountChanged) reset();
        if (background && isDirty()) return false;
        reviewToken = session.token;
        if (controller) controller.abort();
        const localController = controller = new AbortController(), id = ++requestId;
        const preserve = background && !!data;
        if (!preserve) {
            data = null;
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
            root.querySelector('[data-operations-status]').setAttribute('role', 'status');
            root.querySelector('[data-operations-action="retry"]').hidden = true;
            render();
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
                ? 'Reading existing operational records...' : 'Reopen Operations to load records.';
        } else if (button.dataset.operationsAction === 'retry') {
            if (sync && !isDirty()) sync.request('retry', { force: true });
            else load();
        } else if (button.dataset.operationsAction === 'next') { offset += 25; load(); }
        else if (button.dataset.operationsAction === 'previous') { offset = Math.max(0, offset - 25); load(); }
    });
    function rememberReviewInput(event) {
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
