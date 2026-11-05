const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'management-operations.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, withSync = false) {
  const dom = new JSDOM('<div id="h2s-app"><div class="app-sidebar-group" data-group-id="admin"><div class="app-sidebar-group-items"></div></div><main class="app-content"><p id="existing">Existing hiring workflow</p></main></div>',
    { runScripts: 'outside-only', url: 'https://fixture.invalid/dash.html' });
  t.after(() => dom.window.close());
  const w = dom.window, calls = [], session = { isAdmin: true, token: 'fixture-only-session' };
  const state = { fingerprint: 'a'.repeat(64), error: null, complete: false, exported: null };
  const issue = () => ({ id: 'orphan_assignment:fixture-record', fingerprint: state.fingerprint, category: 'orphan_assignment', status: 'unresolved',
    reason: 'Missing dispatch job; <img src=x onerror=alert(1)> is not proof.', remediation: 'Investigate original records; never auto-repair.',
    records: state.records || [{ source: 'h2s_dispatch_job_assignments', id: 'fixture-record', fields: { job_id: 'missing-job', state: 'accepted' } }] });
  const job = () => ({ jobId: 'fixture-job', orderReference: 'ORD-FIXTURE', service: 'TV installation', rawStatus: 'queued', kind: 'installation',
    window: { state: 'incomplete', start: '2027-01-01T14:00:00Z', end: state.end || null, timezone: state.timezone || null }, assignments: [],
    availability: [], attention: ['Missing end/timezone'], reservation: null, reservationEvidence: 'unverified', legacyLink: { verified: false },
    preparation: { status: 'needs_review', detail: 'Preparation evidence missing.' },
    conflicts: [{ code: 'pending_offer_overlap', reference: 'other-job', detail: 'Not a confirmed reservation.' }] });
  w.console.error = () => {};
  w.switchToTab = () => {};
  w.URL.createObjectURL = blob => { state.exported = blob; return 'blob:fixture'; }; w.URL.revokeObjectURL = () => {};
  w.HTMLAnchorElement.prototype.click = () => {};
  w.fetch = async (input, options) => {
    calls.push({ url: String(input), options });
    const url = new URL(input);
    if (state.error) return { ok: false, status: state.error, json: async () => ({ ok: false, error: 'Access denied or source unavailable.' }) };
    if (url.pathname.endsWith('management-operations')) return { ok: true, json: async () => ({
      ok: true, readOnly: true, readAt: '2026-11-03T20:00:00Z', jobs: [], page: { hasMore: false },
    }) };
    if (url.pathname.endsWith('management-assignments')) return { ok: true, json: async () => ({ ok: true, enabled: false }) };
    const view = url.searchParams.get('view');
    return { ok: true, json: async () => ({ ok: true, readOnly: true, readAt: '2026-11-03T20:00:00Z', reviewOwnerId: 'fixture-admin',
      view, complete: state.complete, scope: 'At most 1000 complete rows per source; separate SELECTs, not an atomic snapshot. Revalidate before any approved repair. No availability clearance is implied.', summary: { jobs: state.boundedJobs || 1, issues: 1 },
      jobs: view === 'schedule' ? state.jobs || [job()] : [], issues: view === 'reconciliation' ? [issue()] : [],
      page: { total: 26, hasMore: url.searchParams.get('offset') === '0' } }) };
  };
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  if (withSync) w.eval(fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'dashboard-sync.js'), 'utf8'));
  w.eval(source);
  const module = w.H2SManagementOperations;
  module.configure({ apiBase: 'https://backend.fixture.invalid', getSession: () => session });
  const root = w.document.getElementById('operations-pane');
  root.classList.add('active');
  const click = async selector => { root.querySelector(selector).click(); await tick(); };
  const enter = async () => { await module.open(); await click('[data-operations-view="reconciliation"]'); };
  const save = (status = 'reviewed', notes = 'Reviewed original evidence', evidence = 'Source record reference') => {
    const form = root.querySelector('form[data-review-issue]');
    form.elements.classification.value = status; form.elements.notes.value = notes; form.elements.evidence.value = evidence;
    form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  };
  return { w, root, module, session, state, calls, click, enter, save };
}
test('scheduling mode renders uncertainty, paginates server-wide filters and preserves established workflows with GET only', async t => {
  const f = fixture(t); await f.module.open(); await f.click('[data-operations-view="schedule"]');
  assert.match(f.root.textContent, /Incomplete evidence/); assert.match(f.root.textContent, /not appointment confirmation/);
  assert.match(f.root.textContent, /pending_offer_overlap/); assert.match(f.root.textContent, /No verified technician/);
  assert.match(f.root.textContent, /Preparation evidence missing/);
  assert.match(f.root.textContent, /2027-01-01T14:00:00.000Z \(recorded instant; local timezone unresolved\)/);
  const formattedZones = [], format = f.w.Date.prototype.toLocaleString;
  f.w.Date.prototype.toLocaleString = function (locale, options) { formattedZones.push(options?.timeZone); return format.call(this, locale, options); };
  f.state.timezone = 'Asia/Tokyo'; f.state.end = '2027-01-01T16:00:00Z';
  await f.module.open(); assert.equal(formattedZones.filter(zone => zone === 'Asia/Tokyo').length, 2);
  assert.match(f.root.textContent, /\(Asia\/Tokyo\)/);
  await f.click('[data-planning-filter="unscheduled"]'); assert.match(f.calls.at(-1).url, /filter=unscheduled/);
  await f.click('[data-operations-action="next"]'); assert.match(f.calls.at(-1).url, /offset=25/);
  await f.click('[data-assignment-job]'); assert.match(f.w.document.body.textContent, /disabled/i);
  assert.equal(f.w.document.getElementById('existing').textContent, 'Existing hiring workflow');
  for (const call of f.calls) { assert.equal(call.options.method, 'GET'); assert.equal(call.options.cache, 'no-store'); assert.equal(call.options.body, undefined); }
  assert.equal(f.w.localStorage.length, 0);
});
test('scheduling operational counts remain page-scoped and distinguish starts, pending offers, preparation and full readiness', async t => {
  const f = fixture(t);
  f.state.boundedJobs = 40;
  const row = (changes = {}) => ({ jobId: 'fixture-job', service: 'TV installation', orderReference: 'ORD-FIXTURE',
    kind: 'installation', rawStatus: 'queued', window: { state: 'complete', start: '2027-01-01T14:00:00Z', end: '2027-01-01T16:00:00Z', timezone: 'UTC' },
    assignments: [{ state: 'accepted', identity: { name: 'Fixture Installer', status: 'verified_portal_id' } }],
    availability: [], attention: [], conflicts: [], preparation: { status: 'available', value: { ready: true, blockers: [] } },
    reservationEvidence: 'unverified', ...changes });
  f.state.jobs = [
    row(), // A queued job with a complete window is scheduled, not awaiting scheduling.
    row({ window: { state: 'unscheduled', start: null, end: null, timezone: null }, assignments: [],
      preparation: { status: 'available', value: { ready: false, blockers: ['Scope'] } }, attention: ['Missing window'] }),
    row({ assignments: [{ state: 'pending', identity: { status: 'unresolved' } }], attention: ['Pending offer'],
      preparation: { status: 'unavailable', detail: 'Unknown readiness' } }),
    row({ window: { state: 'invalid', start: 'invalid', end: null, timezone: null },
      assignments: [{ state: null, identity: { status: 'unresolved' } }], conflicts: [{ code: 'technician_overlap', detail: 'Observed overlap', reference: 'other-job' }] }),
    row({ window: { state: 'incomplete', start: '2027-01-01T14:00:00Z', end: null, timezone: null },
      preparation: { status: 'needs_review', detail: 'Preparation unverified' } }),
    row({ rawStatus: 'completed', window: { state: 'unscheduled', start: null },
      assignments: [{ state: 'pending', identity: { status: 'unresolved' } }] }),
    row({ rawStatus: 'cancelled', window: { state: 'unscheduled', start: null } }),
  ];
  await f.module.open(); await f.click('[data-operations-view="schedule"]');
  const metric = label => Array.from(f.root.querySelectorAll('.management-operations__summary dl > div'))
    .find(node => node.querySelector('dt').textContent === label).querySelector('strong').textContent;
  assert.equal(metric('Jobs in bounded read'), '40');
  assert.equal(metric('Loaded scheduling jobs'), '7');
  assert.equal(metric('Awaiting scheduling'), '1 known · 1 unknown');
  assert.equal(metric('Scheduled (recorded start)'), '3 known · 1 unknown');
  assert.equal(metric('Pending technician acceptance'), '1 known · 1 unknown');
  assert.equal(metric('Ready for installation'), 'Unknown / unavailable');
  assert.equal(metric('Completed'), '1');
  assert.equal(metric('Attention'), '3 known · 4 unknown');
  assert.match(f.root.querySelector('[data-operations-metrics]').textContent, /2 known · 2 unknown preparation-ready/);
  assert.match(f.root.querySelector('[data-operations-status]').textContent, /Counts cover loaded records/);
  assert.match(f.root.textContent, /Customer details are not provided/);
  f.state.complete = true; await f.module.open();
  assert.equal(metric('Attention'), '3', 'complete bounded evidence supports zero observed flags on the other loaded jobs, not clearance');
});
test('normal scheduling copy stays compact while exact source limitations and criteria remain secondary', async t => {
  const f = fixture(t); await f.module.open(); await f.click('[data-operations-view="schedule"]');
  const status = f.root.querySelector('[data-operations-status]'), metrics = f.root.querySelector('[data-operations-metrics]');
  assert.ok(f.root.querySelector('header p').textContent.length < 60);
  assert.ok(status.textContent.length < 100);
  assert.match(status.textContent, /Incomplete evidence/);
  assert.match(status.textContent, /Counts cover loaded records/);
  assert.equal(metrics.querySelectorAll('dt').length, 6);
  assert.equal(metrics.querySelectorAll('dd span').length, 1, 'only concise preparation evidence remains visible under a metric');
  assert.ok(metrics.textContent.length < 350);
  assert.match(metrics.textContent, /Unknown \/ unavailable/);
  const limits = f.root.querySelector('[data-operations-scope]').closest('details');
  assert.equal(limits.open, false);
  assert.match(limits.textContent, /At most 1000 complete rows per source; separate SELECTs, not an atomic snapshot/);
  assert.match(limits.textContent, /Revalidate before any approved repair/);
  assert.match(Array.from(metrics.children).find(node => node.querySelector('dt').textContent === 'Scheduled (recorded start)').title, /not a confirmed booking/);
  const routine = f.root.cloneNode(true); routine.querySelectorAll('details').forEach(node => node.remove());
  assert.doesNotMatch(routine.textContent, /separate SELECTs|atomic snapshot|1000 complete rows|Revalidate before any approved repair/);
});
test('review classifications are explicit session drafts, require supporting evidence, escape data and export without tokens or production writes', async t => {
  const f = fixture(t); await f.enter();
  assert.match(f.root.textContent, /Review priority: High/);
  assert.match(f.root.textContent, /category-based triage, not a verified incident severity/);
  assert.match(f.root.textContent, /Affected relationships \(1 source records\)/);
  assert.match(f.root.textContent, /Dispatch Job Assignments · Name unavailable · 1 source record/);
  assert.match(f.root.textContent, /Recommended review:/);
  assert.match(f.root.querySelector('[data-operations-secondary-metrics]').textContent, /Incomplete \/ unknown/);
  assert.equal(f.root.querySelector('img'), null); assert.match(f.root.textContent, /<img src=x/);
  const before = f.calls.length; f.save('reviewed', '', '');
  assert.match(f.root.textContent, /Reviewed drafts require notes/);
  f.save(); assert.equal(f.calls.length, before);
  assert.match(f.root.textContent, /reviewed \(session draft, not resolution\)/);
  await f.click('[data-review-export]');
  const text = await new Promise((resolve, reject) => {
    const reader = new f.w.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(f.state.exported);
  });
  const packet = JSON.parse(text);
  assert.equal(packet.approval, false); assert.equal(packet.draftOnly, true);
  assert.equal(packet.reviews[0].reviewerId, 'fixture-admin'); assert.equal(packet.reviews[0].history.length, 1);
  assert.doesNotMatch(text, /fixture-only-session|Authorization/); assert.equal(f.w.localStorage.length, 0);
});
test('routine reconciliation relationships never expose UUIDs or raw record keys outside technical evidence', async t => {
  const f = fixture(t);
  const jobId = 'a1111111-1111-4111-8111-111111111111', orderId = 'b2222222-2222-4222-8222-222222222222',
    assignmentId = 'c3333333-3333-4333-8333-333333333333', proId = 'd4444444-4444-4444-8444-444444444444';
  f.state.records = [
    { source: 'h2s_dispatch_jobs', id: jobId, fields: { job_id: jobId, order_id: orderId } },
    { source: 'h2s_dispatch_job_assignments', id: assignmentId, fields: { job_id: jobId, pro_id: proId } },
    { source: 'h2s_orders', id: orderId, fields: { order_id: 'SYNTHETIC-ORDER-1', customer_name: 'Fixture Customer' } },
    { source: 'h2s_orders', id: orderId, fields: { order_id: orderId, customer_name: `Unverified ${proId}` } },
  ];
  await f.enter();
  const article = f.root.querySelector('article'), routine = article.cloneNode(true);
  routine.querySelectorAll('details').forEach(node => node.remove());
  assert.doesNotMatch(routine.textContent, /[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/i);
  assert.doesNotMatch(routine.textContent, /fixture-record|missing-job/);
  assert.match(routine.textContent, /Dispatch Jobs · Name unavailable · 1 source record/);
  assert.match(routine.textContent, /Recorded order reference: SYNTHETIC-ORDER-1 · Recorded customer name: Fixture Customer/);
  assert.match(routine.textContent, /Orders · Name unavailable · 1 source record/);
  assert.match(routine.textContent, /Affected relationships \(4 source records\)/);
  const technical = article.querySelector('details');
  assert.equal(technical.open, false);
  for (const id of [jobId, orderId, assignmentId, proId]) assert.ok(technical.textContent.includes(id));
});
  test('unsubmitted review inputs survive view and filter changes without becoming approved or exportable drafts', async t => {
    const f = fixture(t); await f.enter();
    const form = f.root.querySelector('form[data-review-issue]');
    form.elements.classification.value = 'needs_investigation';
    form.elements.evidence.value = 'Original source reference';
    form.elements.notes.value = 'Unsubmitted review notes';
    form.elements.notes.dispatchEvent(new f.w.Event('input', { bubbles: true }));
    await f.click('[data-operations-view="schedule"]');
    await f.click('[data-operations-view="reconciliation"]');
    let restored = f.root.querySelector('form[data-review-issue]');
    assert.equal(restored.elements.notes.value, 'Unsubmitted review notes');
    assert.equal(restored.elements.evidence.value, 'Original source reference');
    assert.equal(restored.elements.classification.value, 'needs_investigation');
    assert.equal(f.root.querySelector('[data-review-export]').disabled, true);
    assert.doesNotMatch(f.root.querySelector('article > p').textContent, /session draft/);
    await f.click('[data-planning-filter="orphan_assignment"]');
    restored = f.root.querySelector('form[data-review-issue]');
    assert.equal(restored.elements.notes.value, 'Unsubmitted review notes');
    assert.equal(restored.querySelector('select').dataset.customSelect, undefined);
    assert.equal(f.w.localStorage.length, 0);
    assert.ok(f.calls.every(call => call.options.method === 'GET'));
  });
  test('unsubmitted inputs are invalidated with explicit feedback on changed evidence and cleared across accounts', async t => {
    const f = fixture(t); await f.enter();
    const note = f.root.querySelector('[name="notes"]');
    note.value = 'Private unsubmitted note'; note.dispatchEvent(new f.w.Event('input', { bubbles: true }));
    f.state.fingerprint = 'c'.repeat(64); await f.module.open();
    assert.equal(f.root.querySelector('[name="notes"]').value, '');
    assert.match(f.root.textContent, /Unsubmitted inputs refer to older evidence/);
    f.state.fingerprint = 'a'.repeat(64);
    f.session.token = 'different-account'; await f.module.open();
    assert.equal(f.root.querySelector('[name="notes"]').value, '');
    assert.doesNotMatch(f.root.textContent, /Private unsubmitted note/);
  });
test('draft evidence invalidation, account changes, permission errors and reset cannot leak or silently approve earlier reviews', async t => {
  const f = fixture(t); await f.enter(); f.save();
  f.state.fingerprint = 'b'.repeat(64); await f.module.open();
  assert.match(f.root.textContent, /Earlier draft is stale/); assert.equal(f.root.querySelector('[name="notes"]').value, '');
  f.save('needs_investigation', 'Changed evidence', '');
  f.session.token = 'new-fixture-session'; await f.module.open();
  assert.doesNotMatch(f.root.textContent, /session draft, not resolution/);
  assert.equal(f.root.querySelector('[data-review-export]').disabled, true);
  f.save(); f.state.error = 403; await f.module.open();
  assert.equal(f.root.querySelector('form[data-review-issue]'), null); assert.match(f.root.textContent, /Access denied/);
  f.state.error = null; await f.module.open();
  assert.equal(f.root.querySelector('[data-review-export]').disabled, true);
  f.save(); f.module.reset(); assert.doesNotMatch(f.root.textContent, /fixture-record/);
  f.session.isAdmin = false; const reads = f.calls.length; await f.module.open(); assert.equal(f.calls.length, reads);
});
test('a late planning response cannot repopulate private records after logout', async t => {
  const f = fixture(t); await f.enter();
  let resolve;
  f.w.fetch = () => new Promise(value => { resolve = value; });
  const pending = f.module.open(); f.module.reset();
  resolve({ ok: true, json: async () => ({ ok: true, readOnly: true, jobs: [], issues: [{ id: 'private-late-record' }], page: {} }) });
  await pending; assert.doesNotMatch(f.root.textContent, /private-late-record/);
});
test('real shared sync refreshes on visible focus but preserves review inputs and saved session drafts', async t => {
  const f = fixture(t, true); await f.enter();
  let now = f.w.Date.now(); f.w.Date.now = () => now;
  now += 16000;
  let before = f.calls.length; f.w.dispatchEvent(new f.w.Event('focus')); await tick();
  assert.equal(f.calls.length, before + 1);
  assert.match(f.root.querySelector('[data-operations-sync]').textContent, /Automatic sync current/);
  assert.doesNotMatch(f.root.querySelector('[data-operations-sync]').textContent, /Schedule not recorded/);
  const notes = f.root.querySelector('[name="notes"]');
  notes.value = 'Unsubmitted private review'; notes.focus(); notes.dispatchEvent(new f.w.Event('input', { bubbles: true }));
  before = f.calls.length; now += 16000; f.w.dispatchEvent(new f.w.Event('focus')); await tick();
  assert.equal(f.calls.length, before); assert.equal(f.root.querySelector('[name="notes"]'), notes);
  assert.equal(notes.value, 'Unsubmitted private review'); assert.equal(f.w.document.activeElement, notes);
  assert.match(f.root.querySelector('[data-operations-sync]').textContent, /edits are preserved/);
  f.save(); before = f.calls.length; now += 16000;
  f.w.dispatchEvent(new f.w.Event('focus')); await tick();
  assert.equal(f.calls.length, before); assert.match(f.root.textContent, /reviewed \(session draft, not resolution\)/);
  f.state.error = 500; await f.click('[data-planning-filter="orphan_assignment"]');
  assert.equal(f.root.querySelector('[data-operations-action="retry"]').hidden, false);
  f.state.error = null; await f.click('[data-operations-action="retry"]');
  assert.match(f.root.textContent, /reviewed \(session draft, not resolution\)/);
  assert.equal(f.root.querySelector('[data-operations-action="retry"]').hidden, true);
});
test('expanded reconciliation combobox with an external search portal blocks sync and drops a pending read', async t => {
  const f = fixture(t, true); await f.enter();
  let now = f.w.Date.now(); f.w.Date.now = () => now;
  const form = f.root.querySelector('form[data-review-issue]'), combo = f.w.document.createElement('button'),
    search = f.w.document.createElement('input');
  combo.type = 'button'; combo.setAttribute('role', 'combobox'); combo.setAttribute('aria-expanded', 'true');
  form.append(combo); f.w.document.body.append(search); search.focus();
  const before = f.calls.length; now += 16000; f.w.dispatchEvent(new f.w.Event('focus')); await tick();
  assert.equal(f.calls.length, before);
  assert.equal(f.root.querySelector('form[data-review-issue]'), form);
  assert.equal(combo.getAttribute('aria-expanded'), 'true');
  assert.equal(f.w.document.activeElement, search);
  assert.match(f.root.querySelector('[data-operations-sync]').textContent, /edits are preserved/);
  combo.setAttribute('aria-expanded', 'false');
  const originalFetch = f.w.fetch;
  f.state.fingerprint = 'e'.repeat(64);
  const response = await originalFetch('https://backend.fixture.invalid/api/management-planning?view=reconciliation&filter=all&offset=0&limit=25', { method: 'GET' });
  let resolve;
  f.w.fetch = () => new Promise(value => { resolve = value; });
  now += 16000; const pending = f.module.open(); await tick();
  assert.equal(typeof resolve, 'function');
  combo.setAttribute('aria-expanded', 'true'); search.focus();
  resolve(response); assert.equal(await pending, false);
  assert.equal(f.root.querySelector('form[data-review-issue]'), form);
  assert.equal(form.id, `review-${'a'.repeat(64)}`);
  assert.equal(combo.getAttribute('aria-expanded'), 'true');
  assert.equal(f.w.document.activeElement, search);
  assert.match(f.root.querySelector('[data-operations-sync]').textContent, /edits are preserved/);
});
