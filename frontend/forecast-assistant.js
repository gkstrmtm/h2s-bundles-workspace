(function (global) {
    'use strict';
    let current = null;
    let configuration = null;
    const clone = value => JSON.parse(JSON.stringify(value));
    const conversationText = text => text.length > 2000 ? text.slice(0, 1975) + ' [context shortened]' : text;
    const readable = value => String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const money = value => value == null ? 'Not available' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100);
    const metricName = key => ({
        cplCents: 'Paid CPL', cacCents: 'Blended advertising CAC / completed job',
        breakEvenCacCents: 'Break-even advertising CAC', repRateBps: 'Projected representative rate',
        operatingProfitCents: 'Estimated operating profit', cashCollectedCents: 'Expected customer cash collections',
        materialsCents: 'Equipment + materials', processingCents: 'Payment processing',
        representativeCommissionCents: 'Projected representative commissions',
        technicianCompensationCents: 'Installer compensation (separate)'
    })[key] || readable(key.replace(/Cents$|Bps$/, ''));
    const metricValue = (key, value) => value == null ? 'Not available' : /Cents$/.test(key) ? money(value)
        : /Bps$/.test(key) ? `${value / 100}%` : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
    function node(tag, text, attributes = {}) {
        const element = document.createElement(tag);
        if (text != null) element.textContent = text;
        for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
        return element;
    }
    function paragraph(parent, text, className) {
        const element = node('p', text);
        if (className) element.className = className;
        parent.append(element);
        return element;
    }
    function list(parent, values) {
        if (!values?.length) return;
        const element = node('ul');
        for (const value of values) element.append(node('li', value));
        parent.append(element);
    }
    function button(parent, label, action) {
        const element = node('button', label, { type: 'button' });
        element.addEventListener('click', action);
        parent.append(element);
        return element;
    }
    function markChanged(state) {
        state.editVersion++;
        state.dirty = true;
        state.unsaved = true;
        state.status.textContent = 'Assumptions changed. Previous results are not current; calculate the reviewed scenario.';
        state.status.setAttribute('role', 'status');
    }
    function announce(state, text, error = false) {
        state.status.textContent = text;
        state.status.setAttribute('role', error ? 'alert' : 'status');
    }
    function authorized(state) {
        return current === state && state.root.isConnected && state.options.isAdmin()
            && state.token === state.options.getToken();
    }
    function clearProtected(state) {
        state.scenario = null;
        state.result = null;
        state.conversation = [];
        state.saved = [];
        state.selectedSaved = new Set();
        state.name = 'Untitled scenario';
        state.snapshotId = null;
        state.template = null;
        state.catalog = [];
        state.capabilities = {};
        state.library?.replaceChildren();
        if (state.nameInput) state.nameInput.value = '';
        state.body.replaceChildren();
        state.prompt.value = '';
    }
    function checkSession(state) {
        if (current === state && (!state.options.isAdmin() || state.token !== state.options.getToken())) {
            state.controller?.abort();
            clearProtected(state);
            announce(state, 'Administrator sign-in changed. Reopen Forecast with the current session.', true);
            return false;
        }
        return true;
    }
    function refinementSummary(previous, scenario) {
        const changes = [];
        for (const market of scenario.markets) {
            const old = previous?.markets.find(item => item.id === market.id);
            if (!old) { changes.push('Added comparison: ' + market.label); continue; }
            for (const key of ['reps', 'technicians', 'adBudgetCents', 'cplCents', 'bookingBps', 'completionBps', 'travelMinutesPerJob']) {
                if (old[key] !== market[key]) changes.push(`${market.label}: ${metricName(key)} ${metricValue(key, old[key])} → ${metricValue(key, market[key])}`);
            }
        }
        return (changes.length ? changes.slice(0, 8).join('; ') + '.' : 'Scenario context and reviewed assumptions retained.')
            + ' Review assumptions, sources and deterministic results before making a decision.';
    }
    async function request(state, action, payload) {
        if (state.busy) return;
        if (!authorized(state)) {
            clearProtected(state);
            announce(state, 'Administrator sign-in changed. Reopen Forecast with the current session.', true);
            return;
        }
        state.busy = true;
        state.controller = new AbortController();
        const epoch = ++state.requestVersion, editVersion = state.editVersion;
        const timer = setTimeout(() => state.controller.abort(), action === 'interpret' ? 90000 : 30000);
        for (const control of state.actions.querySelectorAll('button')) control.disabled = true;
        for (const control of state.library.querySelectorAll('input,select,button')) control.disabled = true;
        announce(state, action === 'interpret' ? 'Interpreting the scenario, checking connected sources and calculating each market…'
            : action === 'calculate' ? 'Calculating reviewed assumptions…' : 'Checking Forecast connections…');
        try {
            const response = await global.fetch(state.options.endpoint, {
                method: action === 'capabilities' ? 'GET' : 'POST',
                cache: 'no-store', signal: state.controller.signal,
                headers: { Authorization: 'Bearer ' + state.token, 'Content-Type': 'application/json' },
                ...(payload ? { body: JSON.stringify({ action, ...payload }) } : {})
            });
            if ([401, 403].includes(response.status)) clearProtected(state);
            const data = await response.json();
            if (!response.ok || data.ok !== true) throw Error(data.error || 'Forecast service is unavailable. No synchronization or research success is implied.');
            if (!checkSession(state) || !authorized(state) || epoch !== state.requestVersion) return;
            if (editVersion !== state.editVersion) {
                announce(state, 'Inputs changed while this request was running. Your edits were retained; calculate again.', true);
                return;
            }
            if (!data.scenario || typeof data.scenario !== 'object' || !Array.isArray(data.scenario.markets)) {
                throw Error('Forecast returned an incomplete scenario.');
            }
            if (action !== 'capabilities' && !Array.isArray(data.comparisons)) throw Error('Forecast returned incomplete market comparisons.');
            state.capabilities = data.capabilities || {};
            state.catalog = data.catalog || state.catalog || [];
            if (!state.library.childElementCount) renderLibrary(state);
            const previousScenario = state.scenario;
            state.scenario = clone(data.scenario);
            if (action === 'capabilities') state.template = clone(data.scenario);
            state.result = action === 'capabilities' ? null : data;
            state.dirty = false;
            state.unsaved = action !== 'capabilities';
            state.loadedSnapshot = false;
            if (action !== 'capabilities') state.calculatedAt = new Date().toISOString();
            state.comparisonIndex = 0;
            if (action === 'interpret') {
                state.conversation.push({ role: 'user', content: conversationText(payload.text) });
                state.conversation.push({ role: 'assistant', content: conversationText(data.summary || refinementSummary(previousScenario, data.scenario)) });
                state.conversation = state.conversation.slice(-12);
            }
            state.tab = action === 'capabilities' ? 'workspace' : 'results';
            renderCapabilities(state);
            renderTab(state);
            announce(state, action === 'capabilities'
                ? 'Review the assumptions or describe a scenario. No paid provider is activated by opening this screen.'
                : 'Forecast calculated. These are projections, not verified collections, approved offers or actual profit.');
            if (action !== 'capabilities' && typeof state.tabs.scrollIntoView === 'function') {
                state.tabs.scrollIntoView({ block: 'start', behavior: 'instant' });
                global.scrollBy({ top: -(document.querySelector('#h2s-app .app-topbar')?.getBoundingClientRect().height || 0), behavior: 'instant' });
                state.body.focus({ preventScroll: true });
            }
        } catch (error) {
            if (!checkSession(state) || !authorized(state) || epoch !== state.requestVersion) return;
            console.error('Contextual Forecast request failed:', error.name);
            if (!state.scenario) { state.tab = 'workspace'; renderCapabilities(state); renderTab(state); }
            announce(state, error.name === 'AbortError' ? 'Forecast request timed out. Your inputs were retained; retry when the connection is available.' : error.message, true);
        } finally {
            clearTimeout(timer);
            if (epoch === state.requestVersion) {
                state.busy = false;
                for (const control of state.actions.querySelectorAll('button')) control.disabled = false;
                for (const control of state.library.querySelectorAll('input,select,button')) control.disabled = false;
            }
        }
    }
    function renderCapabilities(state) {
        state.connections.replaceChildren();
        const entries = Object.entries(state.capabilities);
        if (!entries.length) {
            paragraph(state.connections, 'Connection status was not supplied. No live research is implied.');
            return;
        }
        for (const [key, value] of entries) {
            const status = typeof value === 'object' && value !== null
                ? value.message || value.reason || value.status || (value.available ? 'Connected' : 'Not connected')
                : typeof value === 'boolean' ? value ? 'Connected' : 'Not connected' : String(value);
            paragraph(state.connections, `${key === 'ai' ? 'AI' : readable(key)}: ${status}`, 'forecast-workbench__secondary');
        }
    }
    function metrics(parent, values, names) {
        const dl = node('dl');
        for (const key of names || Object.keys(values || {})) {
            if (!Object.hasOwn(values || {}, key)) continue;
            const raw = values[key], item = node('div');
            item.append(node('dt', metricName(key)));
            item.append(node('dd', metricValue(key, raw)));
            dl.append(item);
        }
        parent.append(dl);
    }
    function renderResults(state, comparisonOnly = false) {
        const result = state.result;
        if (!result) {
            paragraph(state.body, 'No forecast has been calculated. Review the assumptions, then calculate or use the connected AI interpreter.');
            return;
        }
        paragraph(state.body, result.summary || 'Each market is calculated independently using its own reviewed inputs. Identical assumptions can produce identical financial results; no arbitrary geographic multiplier is applied.');
        list(state.body, result.warnings);
        if (state.loadedSnapshot) paragraph(state.body, 'Saved calculation snapshot. Source versions and evidence dates are retained; calculate again to revalidate current sources.', 'forecast-workbench__secondary');
        if (state.dirty) paragraph(state.body, 'Inputs changed after this calculation. These results are not current.', 'forecast-workbench__secondary');
        const comparisons = result.comparisons || [];
        if (comparisons.length) {
            const headline = ['bookedRevenueCents', 'completedRevenueCents', 'cashCollectedCents', 'operatingProfitCents', 'cacCents', 'breakEvenCacCents'];
            const wrapper = node('div', null, { class: 'forecast-workbench__table forecast-workbench__summary-table', role: 'region', tabindex: '0', 'aria-label': 'Market forecast comparison' });
            const table = node('table'), thead = node('thead'), heading = node('tr');
            heading.append(node('th', 'Market / pricing context', { scope: 'col' }));
            for (const key of headline) heading.append(node('th', metricName(key), { scope: 'col' }));
            thead.append(heading); table.append(thead);
            const tbody = node('tbody');
            for (const comparison of comparisons) {
                const row = node('tr'), base = comparison.cases.find(item => item.name === 'base');
                row.append(node('th', `${comparison.market} · ${comparison.pricingContext === 'existing_baseline' ? 'Existing baseline' : 'Market strategy'}`, { scope: 'row' }));
                for (const key of headline) row.append(node('td', metricValue(key, base?.metrics[key])));
                tbody.append(row);
            }
            table.append(tbody); wrapper.append(table); state.body.append(wrapper);
            if (comparisonOnly) return;
            const label = node('label', 'Inspect market comparison'), select = node('select', null, { 'aria-label': 'Inspect market comparison' });
            comparisons.forEach((comparison, index) => select.append(node('option', `${comparison.market} · ${comparison.pricingContext === 'existing_baseline' ? 'Existing baseline' : 'Market strategy'}`, { value: String(index) })));
            select.value = String(Math.min(state.comparisonIndex || 0, comparisons.length - 1));
            select.addEventListener('change', () => { state.comparisonIndex = Number(select.value); renderTab(state); });
            label.append(select); state.body.append(label);
        }
        for (const comparison of comparisons.slice(state.comparisonIndex || 0, (state.comparisonIndex || 0) + 1)) {
            const panel = node('section', null, { class: 'forecast-workbench__panel' });
            panel.append(node('h3', comparison.market));
            paragraph(panel, comparison.pricingContext === 'existing_baseline' ? 'Existing-price baseline · approval depends on each price source'
                : 'Market strategy projection · no offer is published', 'forecast-workbench__secondary');
            paragraph(panel, `Evidence confidence: ${comparison.confidence || 'Not established'}`, 'forecast-workbench__secondary');
            const market = state.scenario.markets.find(item => item.id === comparison.marketId);
            if (market) {
                const serviceMix = comparison.pricingContext === 'existing_baseline' ? market.baselineServices || market.services : market.services;
                paragraph(panel, `${market.reps} representatives · ${market.technicians} technicians · ${money(market.adBudgetCents)} monthly advertising. Service mix: ${serviceMix.map(service => `${service.label} (${service.shareBps / 100}%)`).join('; ')}.`);
            }
            const base = comparison.cases?.find(item => item.name === 'base');
            if (base) metrics(panel, base.metrics, ['capacityJobs', 'completedJobs', 'materialsCents', 'representativeCommissionCents', 'technicianCompensationCents', 'grossContributionCents']);
            list(panel, comparison.missing?.map(item => 'Needs review: ' + item));
            if (comparison.recommendations?.length) {
                panel.append(node('h4', 'Recommended next decisions'));
                list(panel, comparison.recommendations);
            }
            for (const advisory of comparison.advisory || []) paragraph(panel, `${advisory.author === 'ai' ? 'AI advisory' : 'Model guidance'}: ${advisory.text}`);
            if (comparison.cases?.length) {
                panel.append(node('h4', 'Downside / base / best sensitivity'));
                const wrapper = node('div', null, { class: 'forecast-workbench__table', tabindex: '0', role: 'region', 'aria-label': comparison.market + ' sensitivity comparison' });
                const table = node('table'), head = node('tr');
                head.append(node('th', 'Result', { scope: 'col' }));
                for (const item of comparison.cases) head.append(node('th', readable(item.name), { scope: 'col' }));
                const thead = node('thead'); thead.append(head); table.append(thead);
                const tbody = node('tbody');
                for (const key of Object.keys(base?.metrics || {})) {
                    const row = node('tr'); row.append(node('th', metricName(key), { scope: 'row' }));
                    for (const item of comparison.cases) {
                        const raw = item.metrics[key];
                        row.append(node('td', metricValue(key, raw)));
                    }
                    tbody.append(row);
                }
                table.append(tbody); wrapper.append(table); panel.append(wrapper);
            }
            state.body.append(panel);
        }
    }
    function renderResearch(state) {
        paragraph(state.body, 'Research facts are not sales conversion or advertising guarantees. Missing local cost, competition, tax or acquisition evidence must remain assumptions.');
        const comparisons = state.result?.comparisons || [];
        if (!comparisons.length) paragraph(state.body, 'Calculate a market scenario to inspect available research and explicit connection limitations.');
        for (const comparison of comparisons) {
            const section = node('section', null, { class: 'forecast-workbench__panel' });
            section.append(node('h3', comparison.market));
            for (const fact of comparison.evidence || []) {
                const item = node('article');
                item.append(node('h4', readable(fact.label || fact.name || 'Market evidence')));
                paragraph(item, fact.value == null ? 'Value unavailable' : `${new Intl.NumberFormat('en-US').format(fact.value)} ${fact.unit || ''}`);
                paragraph(item, [fact.dataset || 'Official market evidence', fact.datasetYear, fact.fetchedAt ? 'Retrieved ' + fact.fetchedAt : 'Retrieval time unavailable',
                    fact.stale ? 'Stale; verify before relying on this evidence' : 'ACS survey estimate, not an exact current count'].filter(Boolean).join(' · '), 'forecast-workbench__secondary');
                try {
                    const url = new URL(fact.url || fact.sourceUrl);
                    if (url.protocol === 'https:') item.append(node('a', 'View source', { href: url.href, target: '_blank', rel: 'noopener noreferrer' }));
                    else paragraph(item, 'Source link unavailable; do not treat this as verified market intelligence.');
                } catch {
                    paragraph(item, 'Source link unavailable; do not treat this as verified market intelligence.');
                }
                section.append(item);
            }
            if (!comparison.evidence?.length) paragraph(section, 'No current verified market research was retrieved for this scenario.');
            list(section, comparison.missing);
            if (comparison.audit?.length) {
                section.append(node('h4', 'Assumption provenance'));
                for (const entry of comparison.audit) paragraph(section, `${readable(entry.provenance)} · ${entry.detail}`);
            }
            state.body.append(section);
        }
    }
    function renderConversation(state) {
        state.body.append(node('h3', 'Scenario Workspace'));
        paragraph(state.body, 'Describe a decision above, refine one assumption, then review the forecast. Name and save alternatives for this management planning session.');
        paragraph(state.body, 'Recent planning context retains 12 turns; long earlier messages are shortened. The structured scenario retains reviewed assumptions.', 'forecast-workbench__secondary');
        button(state.body, 'Review model assumptions', () => { state.tab = 'assumptions'; renderTab(state); });
        if (!state.scenario) button(state.body, 'Retry Forecast connection', () => request(state, 'capabilities'));
        paragraph(state.body, 'Refine one assumption in the scenario box above. Existing assumptions are retained unless explicitly changed. No conversation is saved to browser storage.');
        if (!state.conversation.length) paragraph(state.body, 'No AI-assisted scenario turns in this session.');
        for (const turn of state.conversation) {
            const item = node('article', null, { class: 'forecast-workbench__thread' });
            item.append(node('h4', turn.role === 'user' ? 'Management' : 'Forecast assistant'));
            paragraph(item, turn.content);
            state.body.append(item);
        }
    }
    function renderAssumptions(state) {
        paragraph(state.body, 'Review source-aware model inputs before calculating. Blank required costs remain unknown, not zero. Editing an approved-price comparison must never publish an offer.');
        if (!state.scenario) {
            button(state.body, 'Retry Forecast connection', () => request(state, 'capabilities'));
            return;
        }
        renderScenarioEditor(state);
        for (const comparison of state.result?.comparisons || []) {
            if (!comparison.audit?.length) continue;
            state.body.append(node('h3', comparison.market + ' · calculation sources'));
            for (const entry of comparison.audit) paragraph(state.body, `${readable(entry.provenance)} · ${entry.detail}`);
        }
    }
    function renderComparison(state) {
        state.body.append(node('h3', 'Scenario Comparison'));
        paragraph(state.body, 'Compare current market strategies and up to four saved calculations. This reads preserved outputs; it does not rerun AI or duplicate financial calculations.');
        const choices = node('fieldset'); choices.append(node('legend', 'Saved calculations to compare'));
        if (!state.saved.length) paragraph(choices, 'Save a named scenario with a current calculation to compare alternatives.');
        for (const saved of state.saved) {
            const label = node('label', null, { class: 'forecast-workbench__choice' });
            const checkbox = node('input', null, { type: 'checkbox', 'aria-label': 'Compare ' + saved.name });
            checkbox.checked = state.selectedSaved.has(saved.id);
            checkbox.disabled = !saved.result || saved.dirty;
            checkbox.addEventListener('change', () => {
                if (checkbox.checked && state.selectedSaved.size >= 4) {
                    checkbox.checked = false; announce(state, 'Compare at most four saved scenarios at a time.', true); return;
                }
                if (checkbox.checked) state.selectedSaved.add(saved.id); else state.selectedSaved.delete(saved.id);
                renderTab(state);
            });
            label.append(checkbox, node('span', saved.name + (checkbox.disabled ? ' · calculate the saved inputs before comparing' : ' · saved ' + new Date(saved.savedAt).toLocaleString())));
            choices.append(label);
        }
        state.body.append(choices);
        const comparisons = [];
        if (state.result && !state.dirty) comparisons.push(...state.result.comparisons.map(item => ({ ...item, market: 'Current: ' + item.market })));
        for (const saved of state.saved.filter(item => state.selectedSaved.has(item.id) && item.result && !item.dirty)) {
            comparisons.push(...saved.result.comparisons.map(item => ({ ...item, market: saved.name + ': ' + item.market })));
        }
        if (comparisons.length) renderResults({ ...state, loadedSnapshot: true, dirty: false,
            result: { comparisons, warnings: ['Saved forecasts are dated projections, not actual financial records. Recalculate restored inputs to check current sources.'] } }, true);
        else paragraph(state.body, 'No current calculated scenarios are selected. Calculate reviewed inputs first; missing results are not zero.');
    }
    function renderLibrary(state) {
        state.library.replaceChildren();
        state.library.append(node('h3', 'Planning scenarios'));
        paragraph(state.library, 'Private to this signed-in page session. Not shared or stored on the server; reload/sign-out clears saved scenarios.', 'forecast-workbench__secondary');
        const fields = node('div', null, { class: 'forecast-workbench__fields' });
        const label = node('label', 'Scenario name');
        state.nameInput = node('input', null, { type: 'text', maxlength: '120', 'aria-label': 'Scenario name' });
        state.nameInput.value = state.name;
        state.nameInput.addEventListener('input', () => { state.name = state.nameInput.value; state.unsaved = true; });
        label.append(state.nameInput); fields.append(label);
        const savedLabel = node('label', 'Revisit saved scenario'), select = node('select', null, { 'aria-label': 'Revisit saved scenario' });
        select.append(node('option', 'Choose a saved scenario', { value: '' }));
        for (const saved of state.saved) select.append(node('option', saved.name, { value: saved.id }));
        select.value = state.snapshotId || '';
        select.addEventListener('change', () => {
            const saved = state.saved.find(item => item.id === select.value);
            if (!saved) return;
            if (!checkSession(state)) return;
            if (state.unsaved && !global.confirm('Replace unsaved working inputs with this saved scenario?')) { renderLibrary(state); return; }
            state.editVersion++;
            state.snapshotId = saved.id; state.name = saved.name;
            state.scenario = clone(saved.scenario); state.result = clone(saved.result);
            state.conversation = clone(saved.conversation); state.prompt.value = saved.prompt;
            state.dirty = saved.dirty; state.unsaved = false; state.loadedSnapshot = !!saved.result;
            state.calculatedAt = saved.calculatedAt; state.tab = 'workspace';
            renderLibrary(state); renderTab(state);
            announce(state, 'Saved scenario restored with its original calculation provenance. Recalculate to check current sources.');
        });
        savedLabel.append(select); fields.append(savedLabel); state.library.append(fields);
        const actions = node('div', null, { class: 'forecast-workbench__actions' });
        const save = asCopy => {
            if (!checkSession(state) || state.busy) return;
            if (!state.scenario) { announce(state, 'Load a scenario before saving.', true); return; }
            const name = state.name.trim();
            if (!name || name.length > 120) { announce(state, 'Enter a scenario name between 1 and 120 characters.', true); return; }
            const old = !asCopy && state.saved.find(item => item.id === state.snapshotId);
            if (!old && state.saved.length >= 20) { announce(state, 'This session holds at most 20 scenarios. Remove one before saving another.', true); return; }
            const snapshot = { id: old?.id || 'snapshot-' + (++state.nextId), name: asCopy ? name.slice(0, 115) + ' copy' : name,
                scenario: clone(state.scenario), result: clone(state.result), conversation: clone(state.conversation),
                prompt: state.prompt.value, dirty: state.dirty, calculatedAt: state.calculatedAt, savedAt: new Date().toISOString() };
            if (old) state.saved[state.saved.indexOf(old)] = snapshot; else state.saved.push(snapshot);
            state.snapshotId = snapshot.id; state.name = snapshot.name; state.unsaved = false;
            if (!snapshot.result || snapshot.dirty) state.selectedSaved.delete(snapshot.id);
            if (snapshot.result && !snapshot.dirty && state.selectedSaved.size < 4) state.selectedSaved.add(snapshot.id);
            renderLibrary(state); if (state.tab === 'comparison') renderTab(state);
            announce(state, 'Scenario saved in this signed-in page session only, with inputs, calculation and source provenance.');
        };
        button(actions, 'Save scenario', () => save(false));
        button(actions, 'Save as copy', () => save(true));
        button(actions, 'New scenario', () => {
            if (!checkSession(state) || state.busy) return;
            if (!state.template) { announce(state, 'Load the Forecast connection before creating another scenario.', true); return; }
            if (state.unsaved && !global.confirm('Start a new scenario without saving the current working inputs?')) return;
            state.editVersion++; state.scenario = clone(state.template); state.result = null; state.conversation = [];
            state.prompt.value = ''; state.name = 'Untitled scenario'; state.snapshotId = null;
            state.dirty = false; state.unsaved = false; state.loadedSnapshot = false; state.tab = 'workspace';
            renderLibrary(state); renderTab(state); announce(state, 'New hypothetical scenario. No existing saved scenario was changed.');
        });
        button(actions, 'Remove saved scenario', () => {
            if (!checkSession(state) || state.busy) return;
            const saved = state.saved.find(item => item.id === state.snapshotId);
            if (!saved) { announce(state, 'Choose a saved scenario to remove.', true); return; }
            if (!global.confirm('Remove this saved scenario from the current page session?')) return;
            state.saved = state.saved.filter(item => item !== saved); state.selectedSaved.delete(saved.id);
            state.snapshotId = null; renderLibrary(state); if (state.tab === 'comparison') renderTab(state);
            announce(state, 'Saved entry removed. Current working inputs are retained.');
        });
        state.library.append(actions);
    }
    function renderTab(state) {
        state.body.replaceChildren();
        for (const tab of state.tabs.querySelectorAll('[role="tab"]')) {
            const selected = tab.dataset.tab === state.tab;
            tab.setAttribute('aria-selected', String(selected));
            tab.tabIndex = selected ? 0 : -1;
        }
        state.body.setAttribute('aria-labelledby', 'forecast-tab-' + state.tab);
        ({ workspace: renderConversation, results: renderResults, assumptions: renderAssumptions, research: renderResearch, comparison: renderComparison })[state.tab](state);
    }
    function renderScenarioEditor(state) {
        const field = (parent, object, key, title, settings = {}) => {
            const label = node('label', title);
            let control;
            if (settings.choices) {
                control = node('select', null, { 'aria-label': title });
                for (const [value, text] of settings.choices) control.append(node('option', text, { value }));
                control.value = object[key] || settings.choices[0][0];
            } else {
                const numeric = settings.number || /Cents$|Bps$/.test(key);
                control = node('input', null, { type: numeric ? 'number' : 'text', 'aria-label': title });
                const scale = /Cents$|Bps$/.test(key) ? 100 : 1;
                control.value = object[key] == null ? '' : numeric ? object[key] / scale : object[key];
                if (numeric) {
                    control.min = settings.min ?? 0;
                    control.step = scale === 100 ? '0.01' : '1';
                    if (settings.max != null) control.max = settings.max;
                    else if (/Bps$/.test(key)) control.max = '100';
                    if (!settings.nullable) control.required = true;
                } else control.maxLength = settings.maxLength || 500;
                if (settings.nullable) control.placeholder = 'Unknown';
            }
            control.addEventListener(settings.choices ? 'change' : 'input', () => {
                if (control.type === 'number') object[key] = control.value === '' ? null : Math.round(Number(control.value) * (/Cents$|Bps$/.test(key) ? 100 : 1));
                else object[key] = control.value;
                markChanged(state);
            });
            label.append(control);
            if (settings.hint) label.append(node('small', settings.hint));
            parent.append(label);
            return control;
        };
        const group = (parent, title) => {
            const section = node('fieldset'); section.append(node('legend', title));
            const grid = node('div', null, { class: 'forecast-workbench__fields' }); section.append(grid); parent.append(section);
            return grid;
        };
        const id = prefix => prefix + '-' + (++state.nextId) + '-' + Date.now().toString(36);
        const services = (parent, market, key, title) => {
            const rows = market[key];
            const section = node('section', null, { class: 'forecast-workbench__panel' });
            section.append(node('h4', title));
            paragraph(section, 'Mix shares must total 100%. Each row is one reviewed job/offer scope. Materials include all consumed equipment, supplies and landed acquisition tax; customer-owned equipment does not mean supplies cost zero.', 'forecast-workbench__secondary');
            rows.forEach((service, index) => {
                const grid = group(section, service.label || `Service ${index + 1}`);
                field(grid, service, 'label', 'Service / exact installation scope');
                field(grid, service, 'shareBps', 'Service mix (%)', { hint: 'Share of distinct jobs, not number of devices.' });
                field(grid, service, 'jobMinutes', 'Installation minutes per job', { number: true, min: 1, max: 2880 });
                field(grid, service, 'ownership', 'Equipment ownership', { choices: [['customer_owned', 'Customer-owned'], ['supplied', 'Company-supplied']] });
                field(grid, service, 'equipmentSku', 'Exact supplied SKU / kit', { hint: 'A supplied approved offer requires an exact eligible catalog equipment match.' });
                field(grid, service, 'materialsCents', 'Equipment + materials per job ($)', { nullable: true, hint: 'Editable management allowance, not an invoice or supplier verification.' });
                const label = node('label', 'Selling price source');
                const select = node('select', null, { 'aria-label': 'Selling price source' });
                select.append(node('option', 'Unknown', { value: 'unknown' }), node('option', 'Hypothetical management price', { value: 'hypothetical' }));
                const eligible = state.catalog.filter(item => !item.starting && !item.qualified && item.markets.includes(market.context.property));
                eligible.forEach((offer, offerIndex) => {
                    select.append(node('option', `Published ${offer.version}: ${offer.label} · ${money(offer.amountCents)}`, { value: 'catalog-' + offerIndex }));
                });
                const approvedIndex = eligible.findIndex(offer => offer.catalogId === service.price.catalogId && offer.serviceId === service.price.serviceId && offer.offerId === service.price.offerId);
                select.value = service.price.kind === 'approved' && approvedIndex >= 0 ? 'catalog-' + approvedIndex : service.price.kind === 'hypothetical' ? 'hypothetical' : 'unknown';
                select.addEventListener('change', () => {
                    const offer = select.value.startsWith('catalog-') ? eligible[Number(select.value.slice(8))] : null;
                    service.price = offer ? { kind: 'approved', amountCents: offer.amountCents, catalogId: offer.catalogId, serviceId: offer.serviceId, offerId: offer.offerId }
                        : { kind: select.value, amountCents: select.value === 'hypothetical' ? service.price.amountCents : null };
                    markChanged(state); renderTab(state);
                });
                label.append(select); grid.append(label);
                if (service.price.kind === 'hypothetical') field(grid, service.price, 'amountCents', 'Hypothetical job selling price ($)', { nullable: true });
                else paragraph(grid, service.price.kind === 'approved' ? `Published job price: ${money(service.price.amountCents)}. Server rechecks exact version and scope.` : 'Selling price unknown. Revenue and complete profit cannot be calculated.');
                const remove = button(grid, 'Remove service', () => { rows.splice(index, 1); markChanged(state); renderTab(state); });
                remove.disabled = rows.length <= 1;
            });
            const add = button(section, 'Add service', () => {
                rows.push({ id: id('service'), label: 'New service — scope requires review', shareBps: 0, jobMinutes: 120, ownership: 'customer_owned', price: { kind: 'unknown', amountCents: null }, materialsCents: null });
                markChanged(state); renderTab(state);
            });
            add.disabled = rows.length >= 12; parent.append(section);
        };
        state.scenario.markets.forEach((market, marketIndex) => {
            const panel = node('section', null, { class: 'forecast-workbench__panel' });
            panel.append(node('h3', market.label));
            const identity = group(panel, 'Market & business context');
            field(identity, market, 'label', 'Scenario / market label');
            field(identity, market.geography, 'place', 'City / Census place');
            field(identity, market.geography, 'state', 'Full state name or Census FIPS', { hint: 'Use Texas rather than TX; ambiguous places are not guessed.' });
            for (const [key, title] of [['entry', 'Market-entry strategy'], ['household', 'Household profile'], ['channels', 'Sales channels & deduplication'], ['goals', 'Financial objectives'], ['constraints', 'Local installation constraints']]) field(identity, market.context, key, title);
            field(identity, market.context, 'property', 'Property / catalog market', { choices: [['residential', 'Residential'], ['commercial', 'Commercial']] });
            const capacity = group(panel, 'Staffing & fulfillment capacity');
            for (const [key, title, settings] of [
                ['reps', 'Representatives', { max: 1000 }], ['repTenureDays', 'Representative tenure (days)', { nullable: true, min: 1, max: 36500, hint: '55% / 50% / 45% policy projection; not an earning or payout.' }],
                ['technicians', 'Technicians', { max: 1000 }], ['workDays', 'Working days this month', { min: 1, max: 31 }],
                ['hoursPerDay', 'Technician hours per day', { min: 1, max: 24 }], ['productiveBps', 'Productive technician time (%)', {}],
                ['travelMinutesPerJob', 'Travel minutes per job', { nullable: true, max: 1440, hint: 'Explicit local travel assumption; no invented city multiplier.' }]
            ]) field(capacity, market, key, title, { number: true, ...settings });
            const demand = group(panel, 'Demand & acquisition');
            for (const [key, title, settings] of [
                ['adBudgetCents', 'Monthly advertising ($)', {}], ['cplCents', 'Paid cost per lead ($)', { nullable: true, min: .01 }],
                ['repLeadsPerDay', 'Distinct leads per representative / day', { number: true }],
                ['organicLeads', 'Additional distinct organic leads / month', { number: true }],
                ['bookingBps', 'Lead-to-booking conversion (%)', {}], ['cancellationBps', 'Booking cancellation (%)', {}],
                ['completionBps', 'Remaining-booking completion this month (%)', {}]
            ]) field(demand, market, key, title, settings);
            paragraph(panel, 'Channels use the distinct paid, representative and organic counts above. Channel/context prose never silently changes the funnel. CPL and conversion are hypotheses unless separately evidenced.', 'forecast-workbench__secondary');
            const financial = group(panel, 'Cash timing & separately modeled expenses');
            for (const [key, title, settings] of [
                ['depositCollectedBps', 'Active-booking deposits collected this month (%)', {}],
                ['balanceCollectedBps', 'Completed-job balances collected this month (%)', {}],
                ['processingBps', 'Estimated processing variable fee (%)', { nullable: true }],
                ['processingFixedCents', 'Estimated fixed fee per transaction ($)', { nullable: true }],
                ['techHourlyCents', 'Technician hourly expense ($)', { nullable: true }],
                ['techPerJobCents', 'Additional technician expense per completed job ($)', { nullable: true }],
                ['overheadCents', 'Monthly operating overhead ($)', { nullable: true }]
            ]) field(financial, market, key, title, settings);
            paragraph(panel, 'Deposit obligations use the exact 25% ceiling and remaining balance. Collection percentages explicitly model period timing, not verified payments. Technician hourly and per-job amounts are additive; enter explicit zero for an inapplicable component. Profit is an estimate, not bank settlement or tax/legal clearance.', 'forecast-workbench__secondary');
            services(panel, market, 'services', 'Service mix & proposed market strategy');
            if (market.baselineServices) services(panel, market, 'baselineServices', 'Existing-price baseline (source reviewed separately)');
            else button(panel, 'Compare against this existing-price baseline', () => { market.baselineServices = clone(market.services); markChanged(state); renderTab(state); });
            for (const key of ['downside', 'best']) {
                const sensitivity = group(panel, readable(key) + ' explicit sensitivity assumptions');
                field(sensitivity, market.sensitivities[key], 'demandBps', 'Demand relative to base (%)', { min: key === 'best' ? 100 : 0, max: key === 'downside' ? 100 : 300 });
                field(sensitivity, market.sensitivities[key], 'cplBps', 'Paid CPL relative to base (%)', { min: key === 'downside' ? 100 : .01, max: key === 'downside' ? 300 : 100 });
                field(sensitivity, market.sensitivities[key], 'completionBps', 'Completion rate in this case (%)', { min: key === 'best' ? market.completionBps / 100 : 0, max: key === 'downside' ? market.completionBps / 100 : 100 });
            }
            const actions = node('div', null, { class: 'forecast-workbench__actions' });
            const duplicate = button(actions, 'Duplicate for another market / pricing strategy', () => {
                const copy = clone(market); copy.id = id('market'); copy.label = market.label + ' comparison';
                state.scenario.markets.push(copy); markChanged(state); renderTab(state);
            });
            duplicate.disabled = state.scenario.markets.length >= 6;
            const remove = button(actions, 'Remove comparison market', () => { state.scenario.markets.splice(marketIndex, 1); markChanged(state); renderTab(state); });
            remove.disabled = state.scenario.markets.length <= 1;
            panel.append(actions); state.body.append(panel);
        });
    }
    function styles() {
        if (document.getElementById('forecast-assistant-style')) return;
        const link = node('link', null, { id: 'forecast-assistant-style', rel: 'stylesheet',
            href: typeof global.__h2sResolveDashSiblingAsset === 'function' ? global.__h2sResolveDashSiblingAsset('forecast-assistant.css') : './forecast-assistant.css' });
        link.addEventListener('error', () => {
            console.error('Contextual Forecast stylesheet failed to load.');
            if (current) announce(current, 'Forecast styling could not load. Reload the dashboard before reviewing this screen.', true);
        });
        document.head.append(link);
    }
    async function mount(root, options) {
        current?.controller?.abort();
        const token = options.getToken();
        const previous = current?.token === token ? current : null;
        const state = { root, options, token, scenario: previous?.scenario || null, result: previous?.result || null,
            conversation: previous?.conversation || [], capabilities: previous?.capabilities || {}, catalog: previous?.catalog || [],
            template: previous?.template || null, name: previous?.name || 'Untitled scenario',
            saved: previous?.saved || [], selectedSaved: previous?.selectedSaved || new Set(), snapshotId: previous?.snapshotId || null,
            unsaved: previous?.unsaved || false, loadedSnapshot: previous?.loadedSnapshot || false, calculatedAt: previous?.calculatedAt || null,
            editVersion: 0, requestVersion: 0, nextId: previous?.nextId || 0, comparisonIndex: previous?.comparisonIndex || 0,
            busy: false, dirty: previous?.dirty || false, tab: previous?.tab || 'workspace' };
        current = state;
        root.classList.add('forecast-workbench');
        root.style.containerType = 'inline-size';
        root.replaceChildren();
        root.append(node('h2', 'Strategy & Forecasting'));
        paragraph(root, 'Contextual market scenarios · read-only projections · no pricing publication or payment activation', 'forecast-workbench__secondary');
        const composer = node('section', null, { class: 'forecast-workbench__composer' });
        composer.append(node('h3', 'Describe Your Scenario'));
        const label = node('label', 'Compare markets or refine one assumption');
        state.prompt = node('textarea', null, { id: 'forecastNaturalLanguageInput',
            placeholder: 'Compare five representatives in Dallas versus Los Angeles, primarily TV mounting and eufy installations, with $10,000 monthly advertising per market.' });
        state.prompt.value = previous?.prompt?.value || '';
        state.prompt.addEventListener('input', () => { state.editVersion++; state.unsaved = true; });
        label.append(state.prompt); composer.append(label);
        state.actions = node('div', null, { class: 'forecast-workbench__actions' });
        const analyze = () => {
            const text = state.prompt.value.trim();
            if (!text) { announce(state, 'Describe a scenario or a change to the current scenario.', true); return; }
            if (text.length > 12000) { announce(state, 'Keep the scenario below 12,000 characters.', true); return; }
            request(state, 'interpret', { text, scenario: state.scenario, conversation: state.conversation });
        };
        button(state.actions, 'Analyze with AI', analyze).setAttribute('data-primary', '');
        button(state.actions, 'Calculate reviewed assumptions', () => {
            if (!state.scenario) { announce(state, 'Load a scenario before calculating.', true); return; }
            const invalid = root.querySelector(':invalid');
            if (invalid) { invalid.reportValidity(); return; }
            request(state, 'calculate', { scenario: state.scenario });
        });
        state.prompt.addEventListener('keydown', event => { if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); analyze(); } });
        composer.append(state.actions);
        state.connections = node('div', null, { 'aria-label': 'Forecast connections' }); composer.append(state.connections);
        root.append(composer);
        state.library = node('section', null, { class: 'forecast-workbench__panel', 'aria-label': 'Planning scenarios' });
        root.append(state.library);
        renderLibrary(state);
        state.status = node('p', null, { role: 'status', 'aria-live': 'polite' }); root.append(state.status);
        state.tabs = node('div', null, { class: 'forecast-workbench__tabs', role: 'tablist', 'aria-label': 'Forecast context' });
        for (const [key, title] of [['workspace', 'Scenario Workspace'], ['results', 'Forecast Results'], ['research', 'Market Intelligence'], ['comparison', 'Scenario Comparison'], ['assumptions', 'Assumptions & Sources']]) {
            const tab = button(state.tabs, title, () => { state.tab = key; renderTab(state); });
            tab.id = 'forecast-tab-' + key;
            tab.dataset.tab = key; tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'forecastMainGrid');
        }
        state.tabs.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            const tabs = [...state.tabs.children], index = tabs.indexOf(document.activeElement);
            const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            event.preventDefault(); tabs[target].click(); tabs[target].focus();
        });
        root.append(state.tabs);
        state.body = node('section', null, { id: 'forecastMainGrid', role: 'tabpanel', tabindex: '0' });
        root.append(state.body);
        styles();
        if (!options.isAdmin() || !token) {
            clearProtected(state);
            announce(state, 'Administrator sign-in is required for Forecast.', true);
            return;
        }
        if (state.scenario) {
            renderCapabilities(state); renderTab(state);
            announce(state, state.dirty ? 'Unsaved assumptions retained. Calculate to update results.' : 'Scenario retained in this signed-in session. Calculate again to check current sources.');
        } else {
            renderTab(state);
            await request(state, 'capabilities');
        }
    }
    global.addEventListener('pagehide', () => { current?.controller?.abort(); if (current) clearProtected(current); current = null; });
    for (const event of ['focus', 'storage']) global.addEventListener(event, () => { if (current) checkSession(current); });
    document.addEventListener('visibilitychange', () => { if (current) checkSession(current); });
    function reset() {
        current?.controller?.abort();
        if (current) { clearProtected(current); current.root.replaceChildren(); }
        current = null;
        const navigation = document.getElementById('strategyNavigation');
        if (navigation) navigation.hidden = true;
    }
    global.H2SForecast = {
        mount, reset,
        configure(options) {
            if (current && (current.token !== options.getToken() || !options.isAdmin())) reset();
            configuration = options;
            const navigation = document.getElementById('strategyNavigation');
            if (navigation) navigation.hidden = !options.isAdmin() || !options.getToken();
        },
        open() {
            const root = document.getElementById('strategyForecastWorkspace');
            if (!root || !configuration?.isAdmin() || !configuration.getToken()) { reset(); return Promise.resolve(false); }
            if (current?.root === root && current.token === configuration.getToken() && root.childElementCount) return Promise.resolve(true);
            return mount(root, configuration);
        }
    };
})(window);
