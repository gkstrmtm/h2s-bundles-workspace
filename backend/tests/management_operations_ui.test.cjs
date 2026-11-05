const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const frontend = path.resolve(__dirname, '..', '..', 'frontend');
const source = fs.readFileSync(path.join(frontend, 'management-operations.js'), 'utf8');
const available = value => ({ status: 'available', value });
const job = () => ({
  jobId: 'fixture-job', rawStatus: 'assigned', kind: 'installation', scheduledAt: '2099-01-01T15:00:00Z',
  order: available({ service: 'TV installation', customerName: 'Fixture Customer', address: 'Fixture Lane', reference: 'ORD-FIXTURE' }),
  assignments: available([{ name: 'Fixture Installer', proId: 'fixture-pro', rawState: 'accepted' }]),
  preparation: available({ ready: true, blockers: [] }), equipment: available({ required: true, stage: 'delivered', scope: '2 mounts' }),
  payment: { status: 'paid', detail: 'Verified fixture only' },
  payouts: available([{ status: 'pending', state: 'approved', amount: 420 }]),
});
const payload = (jobs = [job()], hasMore = false) => ({
  ok: true, readOnly: true, jobs, page: { hasMore }, readAt: '2026-01-01T12:00:00Z',
});
function fixture(html = '<div id="h2s-app"><div class="app-sidebar-group" data-group-id="admin"><div class="app-sidebar-group-items"></div></div><main class="app-content"><div id="pipeline-pane" class="pane active">Existing workflow</div></main></div>') {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://fixture.invalid/dash.html' });
  const w = dom.window, calls = [], errors = [], session = { token: 'fixture-session', isAdmin: true };
  w.console.error = (...args) => errors.push(args);
  w.__h2sResolveDashSiblingAsset = name => `https://fixture.invalid/${name}?build=fixture`;
  w.switchToTab = tab => calls.push({ tab });
  w.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => payload() }; };
  w.eval(source);
  const module = w.H2SManagementOperations;
  module.configure({ apiBase: 'https://backend.fixture.invalid', getSession: () => session });
  return { dom, w, module, session, calls, errors, root: w.document.getElementById('operations-pane') };
}
const click = (f, selector) => f.root.querySelector(selector).click();

test('module attaches to the real dashboard, preserves existing panes, and shell hooks are registered', async () => {
  const html = fs.readFileSync(path.join(frontend, 'dash.html'), 'utf8');
  const f = fixture(html);
  try {
    const doc = f.w.document, nav = doc.querySelector('[data-tab="operations"]');
    assert.ok(doc.getElementById('h2s-app').contains(f.root)); assert.equal(nav.hidden, false);
    for (const id of ['pipeline-pane', 'training-pane', 'tasks-pane', 'admin-pane', 'commercialqueue-pane']) {
      assert.ok(doc.getElementById(id), `${id} must remain available`);
    }
    nav.click(); assert.equal(f.calls[0].tab, 'operations');
    assert.match(doc.querySelector('link[href*="management-operations.css"]').href, /build=fixture/);
    const shell = fs.readFileSync(path.join(frontend, 'dash.js'), 'utf8');
    assert.match(shell, /operations: \{ label: 'Operations'.*requiresAdmin: true/);
    assert.match(shell, /normalizedTargetTab === 'operations'[\s\S]{0,100}H2SManagementOperations\?\.open/);
    assert.ok(html.indexOf("await loadScript('management-operations.js')") < html.indexOf("'dash.js', 'media-placement-style.js'"));
  } finally { f.dom.window.close(); }
});

test('an unavailable optional Operations script does not prevent established dashboard startup', async () => {
  const html = fs.readFileSync(path.join(frontend, 'dash.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://fixture.invalid/dash.html' });
  try {
    const w = dom.window, pending = [], errors = [];
    w.console.error = (...args) => errors.push(args);
    w.document.head.appendChild = script => { pending.push(script); return script; };
    const loader = Array.from(w.document.scripts).find(script => script.textContent.includes('function loadDashboardScripts()')).textContent;
    vm.runInContext(loader, dom.getInternalVMContext());
    assert.match(pending[0].src, /dashboard-controls.js/);
    pending[0].onload();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(pending[1].src, /management-operations.js/);
    pending[1].onerror();
    await new Promise(resolve => setImmediate(resolve));
    for (let index = 2; pending[index]; index++) {
      pending[index].onload();
      await new Promise(resolve => setImmediate(resolve));
    }
    await w.__h2sDashboardScriptsReady;
    assert.equal(w.__h2sDashboardScriptsLoaded, true);
    assert.equal(errors.length, 1); assert.match(errors[0][0], /existing dashboard remains available/);
  } finally { dom.window.close(); }
});

test('read-only view renders evidence, escapes content, filters loaded page, and paginates with GET only', async () => {
  const f = fixture();
  try {
    const row = job(); row.order.value.customerName = '<img src=x onerror=alert(1)>';
    f.w.fetch = async (url, options) => { f.calls.push({ url, options }); return { ok: true, json: async () => payload([row], true) }; };
    await f.module.open();
    assert.match(f.root.textContent, /<img src=x onerror=alert\(1\)>/); assert.equal(f.root.querySelector('img'), null);
    assert.match(f.root.textContent, /Settlement: pending; approval: approved/);
    assert.match(f.root.textContent, /Preparation ready \(not payment clearance\)/);
    assert.match(f.root.textContent, /Filters apply to this page only/);
    assert.match(f.root.textContent, /2 mounts/);
    assert.match(f.root.querySelector('article > p:nth-of-type(2)').textContent, /ORD-FIXTURE/);
    assert.doesNotMatch(f.root.querySelector('article > p:nth-of-type(2)').textContent, /fixture-job/);
    const audit = f.root.querySelector('details');
    assert.equal(audit.open, false); assert.match(audit.textContent, /fixture-job/);
    click(f, '[data-operations-filter="payments"]');
    assert.equal(f.root.querySelectorAll('article').length, 0);
    click(f, '[data-operations-filter="payouts"]');
    assert.equal(f.root.querySelectorAll('article').length, 1);
    click(f, '[data-operations-action="next"]');
    await new Promise(resolve => setImmediate(resolve));
    assert.match(f.calls.at(-1).url, /offset=25&limit=25/);
    for (const call of f.calls) {
      assert.equal(call.options.method, 'GET'); assert.equal(call.options.cache, 'no-store');
      assert.equal(call.options.headers.Authorization, 'Bearer fixture-session'); assert.equal(call.options.body, undefined);
    }
    assert.equal(f.w.document.getElementById('pipeline-pane').textContent, 'Existing workflow');
    assert.equal(f.w.localStorage.length, 0, 'No operational records or tokens are cached by this module');
  } finally { f.dom.window.close(); }
});

test('unauthorized and failed reads clear private records, announce errors, and allow retry', async () => {
  const f = fixture();
  try {
    await f.module.open(); assert.match(f.root.textContent, /Fixture Customer/);
    f.w.fetch = async () => ({ ok: false, json: async () => ({ ok: false, error: 'Access denied.' }) });
    await f.module.open();
    assert.doesNotMatch(f.root.textContent, /Fixture Customer/); assert.match(f.root.textContent, /Access denied/);
    assert.equal(f.root.querySelector('[data-operations-status]').getAttribute('role'), 'alert');
    f.w.fetch = async () => ({ ok: true, json: async () => payload([]) });
    await f.module.open(); assert.match(f.root.textContent, /No Dispatch records found/);
    assert.equal(f.root.querySelector('[data-operations-status]').getAttribute('role'), 'status');
    f.w.fetch = async () => { throw Error('Fixture network failure'); };
    await f.module.open(); assert.match(f.root.textContent, /Fixture network failure/);
    assert.equal(f.errors.length, 2);
  } finally { f.dom.window.close(); }
});

test('VA does not fetch records; resets and token changes prevent late private responses', async () => {
  const f = fixture();
  try {
    f.session.isAdmin = false;
    f.module.configure({ apiBase: 'https://backend.fixture.invalid', getSession: () => f.session });
    await f.module.open(); assert.equal(f.calls.length, 0);
    assert.equal(f.w.document.querySelector('[data-tab="operations"]').hidden, true);
    f.session.isAdmin = true;
    let resolve;
    f.w.fetch = () => new Promise(value => { resolve = value; });
    const read = f.module.open(); f.session.token = 'different-session'; f.module.reset();
    resolve({ ok: true, json: async () => payload() }); await read;
    assert.doesNotMatch(f.root.textContent, /Fixture Customer/);
    f.w.fetch = async () => ({ ok: true, json: async () => payload() });
    await f.module.open(); assert.match(f.root.textContent, /Fixture Customer/);
    f.w.dispatchEvent(new f.w.StorageEvent('storage'));
    assert.doesNotMatch(f.root.textContent, /Fixture Customer/);
  } finally { f.dom.window.close(); }
});

test('partial evidence is visibly unavailable rather than unpaid, unassigned or paid', async () => {
  const f = fixture();
  try {
    const row = job();
    for (const key of ['order', 'assignments', 'preparation', 'equipment', 'payouts']) {
      row[key] = { status: 'unavailable', detail: `${key} source unavailable` };
    }
    row.payment = { status: 'unavailable', detail: 'Stripe verification unavailable' };
    f.w.fetch = async () => ({ ok: true, json: async () => payload([row]) });
    await f.module.open();
    for (const key of ['order', 'assignments', 'preparation', 'equipment', 'payouts']) assert.match(f.root.textContent, new RegExp(`${key} source unavailable`));
    assert.match(f.root.textContent, /Stripe verification unavailable/);
    assert.doesNotMatch(f.root.textContent, /Settlement: paid|No active assignment recorded/);
  } finally { f.dom.window.close(); }
});
