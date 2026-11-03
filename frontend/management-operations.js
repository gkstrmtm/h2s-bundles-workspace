(function (global) {
    'use strict';
    const root = document.createElement('section');
    root.id = 'operations-pane';
    root.className = 'pane management-operations';
    root.setAttribute('aria-label', 'Read-only operations');
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
            return !done(job) && (!assignments || assignments.length !== 1 || !assignments[0].proId);
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
            <p>Read-only Dispatch records. No scheduling, assignment, payment or payout changes are made here.</p></div>
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
                <div><dt>Technician payout</dt><dd>${escape(payoutText)}</dd></div></dl></article>`;
        }).join('') : `<p class="management-operations__empty">${data.jobs.length ? 'No records match this filter on this page.' : 'There are no jobs to display.'}</p>`;
        root.querySelector('[data-operations-page]').textContent = `Latest records, page ${Math.floor(offset / 25) + 1}`;
        root.querySelector('[data-operations-action="previous"]').disabled = offset === 0;
        root.querySelector('[data-operations-action="next"]').disabled = !data.page.hasMore || offset >= 10000;
    }
    function reset() {
        requestId++;
        if (controller) controller.abort();
        controller = null; data = null; offset = 0;
        frame();
        root.querySelector('[data-operations-status]').textContent = 'Open Operations with an ADMIN dashboard account to load records.';
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
        if (button.dataset.operationsFilter) {
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
