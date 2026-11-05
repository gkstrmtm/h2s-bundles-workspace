const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), { JSDOM } = require('jsdom');
const workspace = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(workspace, 'portal.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
const functions = new Map();
for (const script of scripts) {
  const ast = ts.createSourceFile('portal.js', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  function collect(node) {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(ast));
    ts.forEachChild(node, collect);
  }
  collect(ast);
}
const helperNames = ['fieldInstallationHint', 'fieldInstallationSession', 'destroyFieldInstallation',
  'mountFieldInstallation', 'routeFieldInstallationCompletion', 'doSignOut'];
const job = id => ({ job_id: id, metadata_json: { field_sales_workflow:
  { enrolled: true, quoteId: '00000000-0000-4000-8000-000000000001', leadId: 'synthetic-lead', orderId: 'synthetic-order' } } });

function fixture(t) {
  const dom = new JSDOM(html, { url: 'https://fixture.invalid/portal.html' });
  t.after(() => dom.window.close());
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.localStorage.setItem('h2s_portal_token', 'synthetic-pro-token');
  const mounts = [], messages = [], opened = [], effects = { jobs: 0, payouts: 0 };
  dom.window.H2SFieldInstallation = { mount(slot, options) {
    const record = { slot, options, destroyed: 0, ready: Promise.resolve({ enabled: true, enrolled: true }) };
    record.destroy = () => record.destroyed++;
    mounts.push(record);
    slot.textContent = 'Synthetic component host';
    return record;
  } };
  const context = vm.createContext({
    window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage, LS_TOKEN: 'h2s_portal_token', LS_ADMIN_TOKEN: 'h2s_admin_token',
    VERCEL_API: 'https://fixture.invalid/api', isAdmin: false, token: 'synthetic-pro-token', adminToken: '',
    me: {}, realtimeChannel: null, supabaseClient: null, tabCache: {}, currentJobsData: { upcoming: [] },
    $: id => dom.window.document.getElementById(id), toast: text => messages.push(text),
    console: { error: (...args) => messages.push(args[0]) }, stopJobPolling() {}, hideMenuButton() {},
    closeMenu() {}, showAuth() {}, renderMenuItems() {},
    loadJobs: async () => effects.jobs++, loadPayouts: async () => effects.payouts++,
    showJobDetails: value => { opened.push(value); context.mountFieldInstallation(value); }
  });
  vm.runInContext('let fieldInstallationMount=null;const fieldInstallationEnrollments=new Set();\n' +
    helperNames.map(name => functions.get(name)).join('\n'), context);
  return { dom, context, mounts, messages, opened, effects, slot: dom.window.document.getElementById('md-field-installation') };
}

test('actual pro source scripts parse and both real shells load the integrated modules', () => {
  scripts.forEach((script, index) => new vm.Script(script, { filename: 'portal-inline-' + index + '.js' }));
  assert.match(html, /href="\.\/frontend\/field-workflow\.css"/);
  assert.match(html, /src="\.\/frontend\/field-installation\.js"/);
  assert.match(functions.get('showJobDetails'), /mountFieldInstallation\(job\)/);
  assert.match(functions.get('showOfferDetails'), /destroyFieldInstallation\(\)/);
  assert.match(html, /md-close"\)\.addEventListener\("click", \(\) => \{\s*destroyFieldInstallation\(\)/);
  assert.match(html, /if \(e\.target === \$\("modal"\)\) \{\s*destroyFieldInstallation\(\)/);
  const completionStart = html.indexOf('if (doneBtn)');
  const routeIndex = html.indexOf('if (routeFieldInstallationCompletion(jobId)) return;', completionStart);
  assert.ok(routeIndex >= completionStart);
  assert.ok(routeIndex > html.indexOf('if (!photoOnFile[jobId])', completionStart));
  assert.ok(routeIndex > html.indexOf('if (!signatureOnFile[jobId])', completionStart));
  assert.ok(routeIndex < html.indexOf("modal.querySelector('#final-complete-confirm')", completionStart));
  const dashboard = fs.readFileSync(path.join(workspace, 'frontend', 'dash.html'), 'utf8');
  assert.ok(dashboard.indexOf("'field-workflow.js'") < dashboard.indexOf("loadScript('field-sales.js')"));
  assert.ok(dashboard.indexOf("'field-earnings.js'") < dashboard.indexOf("loadScript('field-sales.js')"));
});

test('legacy jobs preserve completion and do not probe inactive workflow endpoints', t => {
  const f = fixture(t), legacy = { job_id: 'legacy-job', metadata_json: { unrelated: true } };
  f.context.currentJobsData.upcoming = [legacy];
  f.context.mountFieldInstallation(legacy);
  assert.equal(f.mounts.length, 0);
  assert.equal(f.slot.hidden, true);
  assert.equal(f.context.routeFieldInstallationCompletion(legacy.job_id), false);
});

test('known enrollment routes through actual reporting rather than legacy completion', async t => {
  const f = fixture(t), enrolled = job('enrolled-job');
  f.context.currentJobsData.upcoming = [enrolled];
  assert.equal(f.context.routeFieldInstallationCompletion(enrolled.job_id), true);
  assert.equal(f.opened.length, 1);
  const mounted = f.mounts[0];
  assert.equal(mounted.options.apiBase, 'https://fixture.invalid/api');
  assert.equal(mounted.options.getSession().token, 'synthetic-pro-token');
  assert.equal(mounted.options.quoteId, enrolled.metadata_json.field_sales_workflow.quoteId);
  mounted.options.onCapability({ enabled: true, enrolled: true, workflow: {} });
  assert.equal(f.slot.hidden, false);
  await mounted.options.onCompleted({ ok: true });
  assert.deepEqual(f.effects, { jobs: 1, payouts: 1 });
  assert.equal(mounted.destroyed, 1);
  assert.equal(f.slot.hidden, true);
  assert.equal(f.dom.window.document.getElementById('modal').getAttribute('aria-hidden'), 'true');
});

test('disabled, mapping-error and missing-module enrolled states cannot fall back', t => {
  const f = fixture(t), enrolled = job('held-job');
  f.context.currentJobsData.upcoming = [enrolled];
  f.context.mountFieldInstallation(enrolled);
  f.mounts[0].options.onCapability({ enabled: false, enrolled: null });
  assert.match(f.slot.textContent, /disabled/);
  assert.equal(f.context.routeFieldInstallationCompletion(enrolled.job_id), true);
  f.mounts.at(-1).options.onUnavailable(new Error('Synthetic mapping error'));
  assert.ok(f.messages.some(message => /unavailable/.test(message)));
  f.dom.window.H2SFieldInstallation = undefined;
  assert.equal(f.context.routeFieldInstallationCompletion(enrolled.job_id), true);
  assert.match(f.slot.textContent, /unavailable/);
  delete enrolled.metadata_json.field_sales_workflow;
  assert.equal(f.context.routeFieldInstallationCompletion(enrolled.job_id), true);
  assert.match(f.messages.at(-1), /legacy completion is blocked/);
});

test('closing, changing session and signing out discard late private callbacks', async t => {
  const f = fixture(t), first = job('first-job'), second = job('second-job');
  f.context.mountFieldInstallation(first);
  const old = f.mounts[0];
  f.context.mountFieldInstallation(second);
  assert.equal(old.destroyed, 1);
  old.options.onCapability({ enabled: false, enrolled: null });
  assert.equal(f.slot.textContent, 'Synthetic component host');
  f.dom.window.localStorage.setItem('h2s_portal_token', 'different-synthetic-pro');
  f.mounts[1].options.onCapability({ enabled: false, enrolled: null });
  assert.equal(f.slot.textContent, 'Synthetic component host');
  f.context.doSignOut();
  assert.equal(f.slot.textContent, '');
  assert.equal(f.slot.hidden, true);
  old.options.onUnavailable(new Error('Late error'));
  await old.options.onCompleted({});
  assert.equal(f.slot.textContent, '');
  assert.deepEqual(f.effects, { jobs: 0, payouts: 0 });
  f.context.currentJobsData.upcoming = [first];
  assert.equal(f.context.routeFieldInstallationCompletion(first.job_id), true);
  assert.equal(f.opened.length, 0, 'No cached customer modal resurrected after logout');
});

test('canonical backend enrollment survives assignment metadata without changing legacy merges', () => {
  const source = fs.readFileSync(path.join(workspace, 'backend', 'app', 'api', 'portal_jobs', 'route.ts'), 'utf8');
  const ast = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'mergeJobAssignment');
  const code = ts.transpileModule(fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const context = vm.createContext({});
  vm.runInContext(code, context);
  const canonical = job('canonical-job');
  const merged = context.mergeJobAssignment(canonical, { state: 'accepted',
    metadata_json: { assignment_note: 'Synthetic note', field_sales_workflow: { enrolled: true, quoteId: 'wrong-quote' } } });
  assert.equal(merged.metadata_json.field_sales_workflow.quoteId, canonical.metadata_json.field_sales_workflow.quoteId);
  assert.equal(merged.metadata_json.assignment_note, 'Synthetic note');
  assert.equal(merged.assign_state, 'accepted');
  const legacy = context.mergeJobAssignment({ job_id: 'old', status: 'in_progress', metadata_json: { job: true } },
    { state: 'accepted', metadata_json: { assignment: true } });
  assert.equal(legacy.metadata_json.assignment, true);
  assert.equal(legacy.metadata_json.job, undefined);
  assert.equal(legacy.status, 'in_progress');
});
