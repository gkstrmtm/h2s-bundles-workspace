const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'management-operations.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t) {
  const dom = new JSDOM('<div id="h2s-app"><div class="app-sidebar-group" data-group-id="admin"><div class="app-sidebar-group-items"></div></div><main class="app-content"><p id="existing">Existing hiring workflow</p></main></div>',
    { runScripts: 'outside-only', url: 'https://fixture.invalid/dash.html' });
  t.after(() => dom.window.close());
  const w = dom.window, calls = [], session = { isAdmin: true, token: 'fixture-only-session' };
  const state = { fingerprint: 'a'.repeat(64), error: null, complete: false, exported: null };
  const issue = () => ({ id: 'orphan_assignment:fixture-record', fingerprint: state.fingerprint, category: 'orphan_assignment', status: 'unresolved',
    reason: 'Missing dispatch job; <img src=x onerror=alert(1)> is not proof.', remediation: 'Investigate original records; never auto-repair.',
    records: [{ source: 'h2s_dispatch_job_assignments', id: 'fixture-record', fields: { job_id: 'missing-job', state: 'accepted' } }] });
  const job = () => ({ jobId: 'fixture-job', orderReference: 'ORD-FIXTURE', service: 'TV installation', rawStatus: 'queued',
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
      view, complete: state.complete, scope: 'Bounded source reads, not availability clearance.', summary: { jobs: 1, issues: 1 },
      jobs: view === 'schedule' ? [job()] : [], issues: view === 'reconciliation' ? [issue()] : [],
      page: { total: 26, hasMore: url.searchParams.get('offset') === '0' } }) };
  };
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.eval(source);
  const module = w.H2SManagementOperations;
  module.configure({ apiBase: 'https://backend.fixture.invalid', getSession: () => session });
  const root = w.document.getElementById('operations-pane');
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
  await f.click('[data-operations-action="refresh"]'); assert.equal(formattedZones.filter(zone => zone === 'Asia/Tokyo').length, 2);
  await f.click('[data-planning-filter="unscheduled"]'); assert.match(f.calls.at(-1).url, /filter=unscheduled/);
  await f.click('[data-operations-action="next"]'); assert.match(f.calls.at(-1).url, /offset=25/);
  await f.click('[data-assignment-job]'); assert.match(f.w.document.body.textContent, /disabled/i);
  assert.equal(f.w.document.getElementById('existing').textContent, 'Existing hiring workflow');
  for (const call of f.calls) { assert.equal(call.options.method, 'GET'); assert.equal(call.options.cache, 'no-store'); assert.equal(call.options.body, undefined); }
  assert.equal(f.w.localStorage.length, 0);
});
test('review classifications are explicit session drafts, require supporting evidence, escape data and export without tokens or production writes', async t => {
  const f = fixture(t); await f.enter();
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
test('draft evidence invalidation, account changes, permission errors and reset cannot leak or silently approve earlier reviews', async t => {
  const f = fixture(t); await f.enter(); f.save();
  f.state.fingerprint = 'b'.repeat(64); await f.click('[data-operations-action="refresh"]');
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
