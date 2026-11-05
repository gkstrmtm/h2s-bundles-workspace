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
function fixture(html = '<div id="h2s-app"><div class="app-sidebar-group" data-group-id="admin"><div class="app-sidebar-group-items"></div></div><main class="app-content"><div id="pipeline-pane" class="pane active">Existing workflow</div></main></div>', dataSync = null) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://fixture.invalid/dash.html' });
  const w = dom.window, calls = [], errors = [], session = { token: 'fixture-session', isAdmin: true };
  w.console.error = (...args) => errors.push(args);
  w.__h2sResolveDashSiblingAsset = name => `https://fixture.invalid/${name}?build=fixture`;
  w.switchToTab = tab => calls.push({ tab });
  if (dataSync) w.H2SDataSync = dataSync;
  w.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => payload() }; };
  w.eval(source);
  const module = w.H2SManagementOperations;
  module.configure({ apiBase: 'https://backend.fixture.invalid', getSession: () => session });
  return { dom, w, module, session, calls, errors, root: w.document.getElementById('operations-pane') };
}
const click = (f, selector) => {
  const control=f.root.querySelector(selector);
  if(control.tagName==='OPTION'){control.parentElement.value=control.value;control.parentElement.dispatchEvent(new f.w.Event('change',{bubbles:true}));}
  else control.click();
};

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
    for (let index = 0; pending[index]; index++) {
      if (pending[index].src.includes('management-operations.js')) pending[index].onerror();
      else pending[index].onload();
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.ok(pending.some(script => script.src.includes('dashboard-controls.js')));
    assert.ok(pending.some(script => script.src.includes('management-operations.js')));
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
    assert.equal(f.root.querySelector('[data-operations-action="refresh"]'), null);
    assert.equal(f.root.querySelector('[data-operations-action="retry"]').hidden, true);
    assert.match(f.root.querySelector('[data-operations-secondary-metrics]').textContent, /Loaded jobs1/);
    assert.match(f.root.textContent, /Next step/);
    assert.match(f.root.textContent, /Browser display; job timezone unknown/);
    assert.match(f.root.textContent, /<img src=x onerror=alert\(1\)>/); assert.equal(f.root.querySelector('img'), null);
    assert.match(f.root.querySelector('[data-operations-evidence]').textContent, /"status": "pending"/);
    assert.match(f.root.querySelector('[data-operations-evidence]').textContent, /"state": "approved"/);
    assert.match(f.root.textContent, /Preparation ready/);
    assert.match(f.root.textContent, /filters and search apply to this page/);
    assert.ok(f.root.querySelector('.management-operations__summary').compareDocumentPosition(f.root.querySelector('[data-operations-jobs]')) & f.w.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.match(f.root.textContent, /2 mounts/);
    assert.match(f.root.querySelector('article header').textContent, /ORD-FIXTURE/);
    assert.doesNotMatch(f.root.querySelector('article header').textContent, /fixture-job/);
    const audit = f.root.querySelector('[data-operations-audit]');
    assert.equal(audit.hidden, true); assert.match(audit.textContent, /fixture-job/);
    assert.equal(f.root.querySelector('details'), null);
    click(f, '[data-operations-context="audit"]'); assert.equal(audit.hidden, false);
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
    assert.equal(f.root.querySelector('[data-operations-action="retry"]').hidden, false);
    f.w.fetch = async () => ({ ok: true, json: async () => payload([]) });
    click(f, '[data-operations-action="retry"]'); await new Promise(resolve => setImmediate(resolve));
    assert.match(f.root.textContent, /No Dispatch records found/);
    assert.equal(f.root.querySelector('[data-operations-status]').getAttribute('role'), 'status');
    f.w.fetch = async () => { throw Error('Fixture network failure'); };
    assert.equal(await f.module.open(), false); assert.match(f.root.textContent, /Fixture network failure/);
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
    resolve({ ok: true, json: async () => payload() }); assert.equal(await read, false);
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
    assert.match(f.root.querySelector('[data-operations-metrics]').textContent, /0\+1 not verified/);
  } finally { f.dom.window.close(); }
});

test('dispatch operational categories use loaded evidence, not queued status, acceptance or unknown readiness', async () => {
  const f = fixture();
  try {
    const queued = job(); queued.rawStatus = 'queued';
    const unscheduled = job(); unscheduled.scheduledAt = null; unscheduled.assignments = available([]);
    unscheduled.preparation = available({ ready: false, blockers: ['Scope not ready'] });
    const pending = job(); pending.assignments.value[0].rawState = 'pending';
    pending.preparation = { status: 'unavailable', detail: 'Preparation unavailable' };
    const invalid = job(); invalid.scheduledAt = 'invalid-start';
    invalid.assignments = { status: 'unavailable', detail: 'Assignments unavailable' };
    invalid.preparation = { status: 'needs_review', detail: 'Preparation unverified' };
    const completed = job(); completed.rawStatus = 'done'; completed.scheduledAt = null;
    completed.assignments.value[0].rawState = 'pending';
    const cancelled = job(); cancelled.rawStatus = 'cancelled'; cancelled.scheduledAt = null;
    cancelled.assignments.value[0].rawState = 'pending';
    const consultation = job(); consultation.kind = 'consultation'; consultation.scheduledAt = null;
    const unknown = job(); unknown.kind = 'unresolved';
    for (const key of ['order', 'assignments', 'preparation', 'equipment', 'payouts']) {
      unknown[key] = { status: 'unavailable', detail: `${key} unavailable` };
    }
    unknown.payment = { status: 'unavailable', detail: 'Payment unavailable' };
    const rows = [queued, unscheduled, pending, invalid, completed, cancelled, consultation, unknown];
    f.w.fetch = async () => ({ ok: true, json: async () => payload(rows, true) });
    await f.module.open();
    const metric = label => Array.from(f.root.querySelectorAll('[data-operations-metrics] > div'))
      .find(node => node.querySelector('dt').textContent === label).querySelector('strong').textContent;
    assert.equal(metric('Awaiting scheduling'), '1+');
    assert.equal(metric('Scheduled start'), '2+');
    assert.equal(metric('Awaiting technician'), '1+');
    assert.equal(metric('Installation readiness'), 'Not verified');
    assert.equal(metric('Completed'), '1');
    assert.equal(metric('Needs attention'), '5+');
    assert.match(f.root.querySelector('[data-operations-metrics]').textContent, /2 not verified/);
    assert.match(Array.from(f.root.querySelectorAll('[data-operations-metrics] > div'))
      .find(node => node.querySelector('dt').textContent === 'Scheduled start').title, /not a confirmed booking/);
    assert.match(f.root.querySelector('[data-operations-summary-title]').textContent, /This page/);
    click(f, '[data-operations-filter="payments"]');
    assert.equal(metric('Scheduled start'), '2+', 'overview totals cover loaded page, not selected filter or later pages');
  } finally { f.dom.window.close(); }
});

test('shared automatic sync registers once, preserves focused edits and ignores an in-flight response when editing starts', async () => {
  let registration, registrations = 0;
  const requests = [];
  const f = fixture(undefined, { register(spec) {
    registration = spec; registrations++;
    return { invalidate() {}, destroy() {}, request(reason, options) {
      requests.push({ reason, options });
      return spec.refresh();
    } };
  } });
  try {
    f.root.classList.add('active');
    assert.equal(await f.module.open(), true);
    assert.equal(registrations, 1); assert.equal(requests[0].reason, 'show');
    assert.equal(registration.intervalMs, 60000); assert.equal(registration.minIntervalMs, 15000);
    assert.equal(registration.isActive(), true);
    registration.onState({ status: 'stale', reason: 'dirty' });
    assert.match(f.root.querySelector('[data-operations-sync]').textContent, /edits are preserved/);
    const input = f.w.document.createElement('input'); input.value = 'Focused unsaved input'; f.root.append(input); input.focus();
    const before = f.calls.length; assert.equal(await registration.refresh(), false);
    assert.equal(f.calls.length, before); assert.equal(f.w.document.activeElement, input);
    input.blur(); input.remove();
    let resolve;
    f.w.fetch = () => new Promise(value => { resolve = value; });
    const pending = registration.refresh();
    const edit = f.w.document.createElement('textarea'); edit.value = 'Started during fetch'; f.root.append(edit); edit.focus();
    const changed = job(); changed.order.value.customerName = 'New response customer';
    resolve({ ok: true, json: async () => payload([changed]) }); assert.equal(await pending, false);
    assert.equal(f.w.document.activeElement, edit); assert.equal(edit.value, 'Started during fetch');
    assert.doesNotMatch(f.root.textContent, /New response customer/);
    f.session.isAdmin = false; assert.equal(registration.isActive(), false);
    assert.equal(await f.module.open(), false); assert.doesNotMatch(f.root.textContent, /Fixture Customer/);
  } finally { f.dom.window.close(); }
});

test('background read failures retain visibly stale evidence and authorization errors clear it', async () => {
  let registration;
  const f = fixture(undefined, { register(spec) {
    registration = spec;
    return { invalidate() {}, destroy() {}, request: () => spec.refresh() };
  } });
  try {
    await f.module.open();
    f.w.fetch = async () => { throw Error('Fixture sync failure'); };
    await assert.rejects(registration.refresh(), /Fixture sync failure/);
    assert.match(f.root.textContent, /Fixture Customer/);
    assert.match(f.root.textContent, /Displayed records are stale/);
    f.w.fetch = async () => ({ ok: false, status: 403, json: async () => ({ ok: false, error: 'Access denied' }) });
    await assert.rejects(registration.refresh(), /Access denied/);
    assert.doesNotMatch(f.root.textContent, /Fixture Customer/);
    assert.equal(f.root.querySelector('[data-operations-action="retry"]').hidden, false);
  } finally { f.dom.window.close(); }
});

test('assignment review pauses sync and a successful confirmed offer invalidates then rereads after closing', async () => {
  let registration, invalidations = 0;
  const requests = [];
  const f = fixture(undefined, { register(spec) {
    registration = spec;
    return { invalidate() { invalidations++; }, destroy() {}, request(reason, options) {
      requests.push({ reason, options }); return spec.refresh();
    } };
  } });
  try {
    f.w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    f.root.classList.add('active');
    f.w.fetch = async (url, options) => {
      f.calls.push({ url, options });
      if (url.includes('/api/management-operations')) return { ok: true, json: async () => ({ ...payload(), assignmentManagementEnabled: true }) };
      return { ok: true, json: async () => options.method === 'POST'
        ? { ok: true, assignment: { state: 'pending' } }
        : { ok: true, enabled: true, job: { jobId: 'fixture-job', eligible: true, service: 'TV installation',
          customerName: 'Fixture Customer', orderReference: 'ORD-FIXTURE', assignments: [], context: 'fixture-context' },
          technicians: [{ proId: 'fixture-pro', name: 'Fixture Installer' }] } };
    };
    await f.module.open(); click(f, '[data-assignment-job]'); await new Promise(resolve => setImmediate(resolve));
    const dialog = f.w.document.querySelector('dialog'), before = f.calls.length;
    const note = dialog.querySelector('[data-assignment-note]'); note.value = 'Reviewed technician offer'; note.focus();
    assert.equal(registration.isDirty(), true); await registration.refresh();
    assert.equal(f.calls.length, before); assert.equal(dialog.querySelector('[data-assignment-note]'), note);
    dialog.querySelector('[data-assignment-review]').click();
    dialog.querySelector('[data-assignment-confirm]').click(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 1);
    assert.ok(invalidations > 0);
    assert.equal(requests.find(request => request.reason === 'assignment-saved').options.force, true);
    assert.equal(f.w.document.querySelector('dialog'), dialog); assert.match(dialog.textContent, /Offer recorded/);
    dialog.querySelector('[data-assignment-close]').click(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.w.document.querySelector('dialog'), null); assert.equal(registration.isDirty(), false);
    assert.equal(requests.at(-1).reason, 'assignment-review-closed');
    assert.equal(f.calls.filter(call => call.url.includes('/api/management-operations')).length, 2);
  } finally { f.dom.window.close(); }
});
