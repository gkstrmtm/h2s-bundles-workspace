const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), { JSDOM } = require('jsdom');
const source = ts.createSourceFile('dash.js', fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dash.js'), 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const printer = ts.createPrinter(), selected = [];
function walk(node) {
  if (ts.isFunctionDeclaration(node) && ['openAccountsAdminModal', 'resetDashboardUserPin'].includes(node.name?.text))
    selected.push(printer.printNode(ts.EmitHint.Unspecified, node, source));
  ts.forEachChild(node, walk);
}
walk(source);
assert.equal(selected.length, 2);

function fixture(t, { supplied = null, role = 'ADMIN' } = {}) {
  const dom = new JSDOM('<div id="modalBody"></div>'); t.after(() => dom.window.close());
  const users = [
    { User_ID: 'synthetic-sales', Username: 'SALESA', Display_Name: 'Synthetic Representative', Role: 'SALES', Is_Disabled: true },
    { User_ID: 'synthetic-va', Username: 'VA_FIXTURE', Display_Name: 'Synthetic VA', Role: 'VA', Is_Disabled: false },
    { User_ID: 'synthetic-admin', Username: 'ADMIN_FIXTURE', Display_Name: 'Synthetic Admin', Role: 'ADMIN', Is_Disabled: false }
  ];
  const calls = [], prompts = [], toasts = [];
  const context = {
    document: dom.window.document, currentUser: 'ADMIN_FIXTURE', API_URL: 'https://fixture.invalid/api/v1',
    isAdminRole: () => role === 'ADMIN', normalizeUsername: value => String(value).trim().toUpperCase(),
    escapeHtml: value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    console, showToast: (...args) => toasts.push(args),
    showModal: (_title, html) => { dom.window.document.getElementById('modalBody').innerHTML = html; },
    closeModal() {}, prompt: (...args) => { prompts.push(args); return supplied; },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const action = new URL(url).searchParams.get('action');
      const data = action === 'dashboardUsers' ? { ok: true, users }
        : action === 'tasks' ? { ok: true, tasks: [] }
        : action === 'hours' ? { ok: true, hours: [] }
        : { ok: true, resetDashboardUserPin: { pin: '12345678', sessionsRevoked: true } };
      return { json: async () => data };
    }
  };
  vm.createContext(context); vm.runInContext(selected.join('\n'), context);
  return { ...context, calls, prompts, toasts, doc: dom.window.document };
}

test('account directory renders SALES faithfully, with read-only managed role and no generic invite/role/state controls', async t => {
  const f = fixture(t); await f.openAccountsAdminModal();
  const rows = [...f.doc.querySelectorAll('.accounts-admin-row')];
  assert.equal(rows.length, 3);
  const sales = rows[0], va = rows[1], admin = rows[2];
  assert.match(sales.querySelector('[data-label="Role"]').textContent, /SALES.*Managed role · read-only/s);
  assert.equal(sales.querySelector('select'), null);
  assert.deepEqual([...sales.querySelectorAll('button')].map(button => button.textContent.trim()), ['Reset credential']);
  assert.match(sales.querySelector('button').getAttribute('onclick'), /resetDashboardUserPin\('synthetic-sales', true\)/);
  assert.match(sales.textContent, /Disable\/reactivate in Field Sales → Representatives/);
  assert.doesNotMatch(sales.textContent, /Send Login|Save Role|Reset PIN/);
  assert.equal(va.querySelector('select').value, 'VA');
  assert.equal(va.querySelector('select').disabled, false);
  assert.deepEqual([...va.querySelectorAll('button')].map(button => button.textContent.trim()),
    ['Save Role', 'Send Login', 'Reset PIN', 'Disable']);
  assert.equal(admin.querySelector('select').value, 'ADMIN'); assert.equal(admin.querySelector('select').disabled, true);
  assert.deepEqual([...f.doc.getElementById('acctNewRole').options].map(option => option.value), ['VA', 'ADMIN']);
});

test('SALES reset cancellation/short credentials make no request; legacy reset stays generated', async t => {
  for (const supplied of [null, '', '12345678', '               ']) {
    const f = fixture(t, { supplied }); await f.resetDashboardUserPin('synthetic-sales', true);
    assert.equal(f.calls.length, 0); assert.equal(f.prompts.length, 1);
    assert.match(f.prompts[0][0], /at least 16 characters/);
  }
  const legacy = fixture(t); await legacy.resetDashboardUserPin('synthetic-va');
  assert.deepEqual(JSON.parse(legacy.calls[0].options.body), { userId: 'synthetic-va' });
  assert.match(legacy.prompts[0][0], /PIN Reset Successful/);
});

test('SALES reset supplies the explicit credential once and explains session revocation without echoing credentials', async t => {
  const f = fixture(t, { supplied: '  synthetic-replacement-password  ' });
  await f.resetDashboardUserPin('synthetic-sales', true);
  assert.match(f.calls[0].url, /action=resetDashboardUserPin$/);
  assert.deepEqual(JSON.parse(f.calls[0].options.body),
    { userId: 'synthetic-sales', pin: 'synthetic-replacement-password' });
  assert.equal(f.prompts.length, 1);
  assert.match(f.toasts[0][0], /sessions revoked.*activation unchanged/i);
  assert.doesNotMatch(f.toasts[0][0], /synthetic-replacement-password|12345678/);
});

test('non-admin users cannot open the account directory', async t => {
  const f = fixture(t, { role: 'SALES' }); await f.openAccountsAdminModal();
  assert.equal(f.calls.length, 0); assert.equal(f.toasts[0][0], 'Admin only');
});
