const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom');
const { id } = require('./helpers/commercial_operations_fixture.cjs');
const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'management-operations.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const dom = new JSDOM('<div id="h2s-app"><div class="app-sidebar-group" data-group-id="admin"><div class="app-sidebar-group-items"></div></div><main class="app-content"></main></div>',
    { runScripts: 'outside-only', url: 'https://fixture.invalid/dash.html' });
  const w = dom.window, calls = [], session = { token: 'fixture-admin', isAdmin: true };
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.crypto.randomUUID = () => id(700);
  w.console.error = () => {};
  const evidence = value => ({ status: 'available', value });
  const row = { jobId: id(101), rawStatus: 'queued', kind: 'installation', scheduledAt: null,
    order: evidence({ service: 'TV installation', customerName: 'Fixture Customer', reference: 'ORD-FIXTURE' }),
    assignments: evidence([]), preparation: evidence({ ready: false, blockers: ['Review scope'] }),
    equipment: evidence({ required: null, stage: null }), payment: { status: 'unverified', detail: 'Fixture' },
    payouts: { status: 'needs_review', detail: 'No verified bridge' } };
  let enabled = false, fail = null, eligible = true, pendingResponse = null;
  w.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes('/api/management-operations')) return { ok: true, json: async () => ({
      ok: true, readOnly: true, assignmentManagementEnabled: enabled, jobs: [row], page: { hasMore: false }, readAt: '2026-01-01T12:00:00Z' }) };
    if (options.method === 'GET') return { ok: true, json: async () => ({
      ok: true, enabled, job: { jobId: id(101), customerName: 'Fixture Customer', service: 'TV installation',
        orderReference: 'ORD-FIXTURE', rawStatus: 'queued', assignments: [], eligible, reason: 'Existing assignment requires reconciliation.',
        context: 'a'.repeat(32), legacyPayoutBridge: false },
      technicians: [{ proId: id(500), name: '<img src=x onerror=alert(1)> Installer' }],
      history: [{ created_at: '2026-01-01T12:00:00Z', old_state: null, new_state: 'pending', actor_user_id: id(9), note: 'Fixture history' }],
    }) };
    if (pendingResponse) return pendingResponse;
    if (fail === 'network') throw Error('Fixture uncertain connection');
    if (fail) return { ok: false, json: async () => ({ ok: false, code: fail, error: 'Fixture assignment error', retryable: true }) };
    return { ok: true, json: async () => ({ ok: true, assignment: { state: 'pending', replayed: true } }) };
  };
  w.eval(source);
  const module = w.H2SManagementOperations;
  module.configure({ apiBase: 'https://backend.fixture.invalid', getSession: () => session });
  return { dom, w, module, session, calls, setEnabled: value => { enabled = value; }, fail: value => { fail = value; },
    setEligible: value => { eligible = value; }, pending: value => { pendingResponse = value; },
    dialog: () => w.document.querySelector('dialog'),
    async open() { await module.open(); w.document.querySelector('[data-assignment-job]').click(); await tick(); },
    review() {
      w.document.querySelector('[data-assignment-note]').value = 'Fixture reviewed offer';
      w.document.querySelector('[data-assignment-review]').click();
    }, confirm() { w.document.querySelector('[data-assignment-confirm]').click(); } };
}
test('default-off UI offers no write control and never issues a POST', async t => {
  const f = fixture(); t.after(() => f.dom.window.close());
  await f.module.open();
  assert.equal(f.w.document.querySelector('[data-assignment-job]'), null);
  assert.equal(f.w.document.querySelector('[data-assignment-confirm]'), null);
  assert.equal(f.calls.some(call => call.options.method === 'POST'), false);
});
test('job detail, eligible technician selection, note and explicit confirmation produce one pending offer', async t => {
  const f = fixture(); t.after(() => f.dom.window.close()); f.setEnabled(true);
  await f.open();
  assert.match(f.dialog().textContent, /Fixture Customer/); assert.match(f.dialog().textContent, /Fixture history/);
  assert.match(f.dialog().textContent, /No verified legacy payout-job bridge/);
  assert.equal(f.dialog().querySelector('img'), null);
  f.w.document.querySelector('[data-assignment-review]').click();
  assert.match(f.dialog().textContent, /enter an assignment note/);
  f.review();
  assert.match(f.dialog().textContent, /Confirm proposed offer/);
  assert.match(f.dialog().textContent, /technician must still accept/);
  assert.equal(f.calls.some(call => call.options.method === 'POST'), false);
  f.confirm(); await tick();
  const writes = f.calls.filter(call => call.options.method === 'POST');
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].options.body), {
    jobId: id(101), proId: id(500), context: 'a'.repeat(32), note: 'Fixture reviewed offer', operationId: id(700),
  });
  assert.match(f.dialog().textContent, /Technician acceptance is required/);
  assert.match(f.dialog().querySelector('[data-assignment-current]').textContent, /pending technician acceptance/);
  assert.match(f.dialog().textContent, /no duplicate was created/);
  assert.equal(f.w.localStorage.length, 0);
});
test('ineligible jobs have no confirmation control', async t => {
  const f = fixture(); t.after(() => f.dom.window.close()); f.setEnabled(true); f.setEligible(false);
  await f.open(); assert.match(f.dialog().textContent, /requires reconciliation/);
  assert.equal(f.dialog().querySelector('[data-assignment-review]'), null);
});
test('ambiguous network outcome retains the identical retry payload across close and reopen', async t => {
  const f = fixture(); t.after(() => f.dom.window.close()); f.setEnabled(true);
  await f.open(); f.review(); f.fail('network'); f.confirm(); await tick();
  assert.match(f.dialog().textContent, /Retry uses the identical operation key/);
  f.dialog().querySelector('[data-assignment-close]').click();
  await f.open();
  assert.match(f.dialog().textContent, /unresolved request is retained/);
  f.fail(null); f.confirm(); await tick();
  const writes = f.calls.filter(call => call.options.method === 'POST');
  assert.equal(writes.length, 2); assert.equal(writes[0].options.body, writes[1].options.body);
});
test('a stale review requires reloading rather than silently confirming changed input', async t => {
  const f = fixture(); t.after(() => f.dom.window.close()); f.setEnabled(true);
  await f.open(); f.review(); f.fail('STALE_REVIEW'); f.confirm(); await tick();
  assert.ok(f.dialog().querySelector('[data-assignment-reload]'));
  f.dialog().querySelector('[data-assignment-reload]').click(); await tick();
  assert.ok(f.dialog().querySelector('[data-assignment-review]'));
  assert.equal(f.dialog().querySelector('[data-assignment-confirm]'), null);
});
test('logout/reset closes review, rejects late success and prevents double confirmation', async t => {
  const f = fixture(); t.after(() => f.dom.window.close()); f.setEnabled(true);
  await f.open(); f.review();
  let resolve;
  f.pending(new Promise(value => { resolve = value; }));
  f.confirm(); f.confirm();
  assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 1);
  assert.equal(f.dialog().querySelector('[data-assignment-close]').disabled, true);
  f.session.token = 'different-session'; f.module.reset();
  resolve({ ok: true, json: async () => ({ ok: true, assignment: { state: 'pending' } }) }); await tick();
  assert.equal(f.dialog(), null);
  assert.doesNotMatch(f.w.document.body.textContent, /Fixture Customer|Offer recorded/);
});
