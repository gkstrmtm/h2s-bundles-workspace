const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'frontend', 'dash.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'frontend', 'dash.js'), 'utf8');
const ast = ts.createSourceFile('dash.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map(ast.statements.filter(ts.isFunctionDeclaration).map(node => [node.name.text, node.getText(ast)]));
const declarations = new Map();
for (const statement of ast.statements.filter(ts.isVariableStatement)) {
  for (const declaration of statement.declarationList.declarations) {
    declarations.set(declaration.name.getText(ast), statement.getText(ast));
  }
}
const names = [
  'getDashboardSessionToken', 'setDashboardSessionToken', 'isAdminRole', 'checkAdminAuth',
  'verifySharedAdminCredential', 'promptAdminPassword', 'checkCachedUser', 'dashboardAccountLogin',
  'normalizeShellTabId', 'getShellTabConfig', 'isValidShellTab', 'clearPersistedActiveShellTab',
  'getActiveShellTab', 'setSidebarGroupOpenState', 'ensureSidebarGroupForTab', 'switchToTab',
  'closeMobileSidebar', 'toggleMobileSidebar', 'initMobileSidebar',
];
const variables = [
  'DASH_SESSION_TOKEN_KEY', 'ADMIN_CREDENTIAL_KEY', 'STORAGE_KEY', 'DASH_SHELL_DEFAULT_TAB',
  'DASH_SHELL_SIDEBAR_STORAGE_PREFIX', 'DASH_SHELL_TABS',
  'verifiedAdminSessionToken', 'verifiedLegacyAdminKey', 'currentUser', 'currentRole',
  'mobileSidebarOpen', 'mobileSidebarPreviousOverflow', 'mobileSidebarBackgroundState',
];

test('dashboard initialization runs when the dynamic bundle arrives before or after DOMContentLoaded', async () => {
  const startup = ast.statements.find(node => ts.isIfStatement(node) && node.expression.getText(ast) === "document.readyState === 'loading'");
  assert.ok(startup);
  for (const readyState of ['loading', 'complete']) {
    let starts = 0;
    let listener;
    const context = vm.createContext({
      document: {
        readyState,
        addEventListener: (event, callback, options) => {
          assert.equal(event, 'DOMContentLoaded');
          assert.equal(options.once, true);
          listener = callback;
        },
      },
      initializeDashboardSession: () => { starts++; },
      queueMicrotask,
    });
    vm.runInContext(startup.getText(ast), context);
    if (readyState === 'loading') {
      assert.equal(starts, 0);
      listener();
    }
    await new Promise(resolve => queueMicrotask(resolve));
    assert.equal(starts, 1);
  }
});

function fixture(t, width = 390) {
  const dom = new JSDOM(html, { url: 'https://fixture.invalid/dash.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  const media = { matches: width <= 1024, listeners: [], addEventListener: (_, fn) => media.listeners.push(fn) };
  w.matchMedia = () => media;
  w.setTimeout = () => 0;
  w.requestAnimationFrame = fn => fn();
  w.showToast = (message, kind) => w.toasts.push({ message, kind });
  w.toasts = [];
  w.initDashboard = () => { w.initialized = true; };
  w.closeDetailDrawer = () => {};
  w.scrollTo = () => {};
  w.closeModal = () => w.document.getElementById('modalOverlay').classList.remove('active');
  w.fetch = async () => { throw new Error('Unexpected request'); };
  const context = dom.getInternalVMContext();
  vm.runInContext([
    "const API_URL = 'https://fixture.invalid/api/v1';",
    ...variables.map(name => {
      assert.ok(declarations.has(name), `Declaration exists: ${name}`);
      return declarations.get(name);
    }),
    ...names.map(name => {
      assert.ok(functions.has(name), `Function exists: ${name}`);
      return functions.get(name);
    }),
  ].join('\n'), context);
  return { w, document: w.document, media, context };
}

test('host constraint cleanup leaves responsive main width under stylesheet control', t => {
  const { w, document, context } = fixture(t);
  vm.runInContext(functions.get('neutralizeGHLConstraints'), context);
  const main = document.querySelector('#h2s-app .app-main');
  for (const width of [390, 768, 1440, 390]) {
    w.innerWidth = width;
    w.neutralizeGHLConstraints();
    assert.equal(main.style.getPropertyValue('width'), '');
    assert.equal(main.style.getPropertyValue('max-width'), '');
  }
  const css = fs.readFileSync(path.join(root, 'frontend', 'dash.css'), 'utf8');
  assert.doesNotMatch(css, /#h2s-app \.app-main\s*\{[^}]*240px/);
});

test('every tab destination is a semantic button and existing destinations are retained', t => {
  const { document } = fixture(t);
  const tabs = [...document.querySelectorAll('.app-sidebar-nav-item[data-tab]')];
  assert.equal(tabs.length, 13);
  for (const tab of tabs) {
    assert.equal(tab.tagName, 'BUTTON');
    assert.equal(tab.type, 'button');
  }
  assert.equal(document.getElementById('appNavToggle').getAttribute('aria-controls'), 'appSidebar');
});

test('mobile Log Hours keeps its icon treatment and label without the shared logout typography override', t => {
  const { document } = fixture(t);
  const button = document.getElementById('logHoursQuickBtn');
  assert.equal(button.type, 'button');
  assert.equal(button.getAttribute('aria-label'), 'Log hours');
  assert.equal(button.getAttribute('title'), 'Log hours');
  assert.equal(button.getAttribute('onclick'), 'openHoursModal()');
  const css = fs.readFileSync(path.join(root, 'frontend', 'dash.css'), 'utf8');
  assert.match(css, /\.logout-btn:not\(#logHoursQuickBtn\)\s*\{[^}]*font-size:\s*12px !important/s);
  const localStyles = Array.from(document.querySelectorAll('style'), element => element.textContent).join('\n');
  assert.match(localStyles, /#logHoursQuickBtn\s*\{[^}]*font-size:\s*0\s*;/s);
  assert.match(localStyles, /#logHoursQuickBtn::before\s*\{[^}]*background-image:/s);
  const back = document.querySelector('.commercial-queue-back');
  assert.equal(back.className, 'commercial-queue-back');
  assert.equal(back.type, 'button');
  assert.equal(back.getAttribute('onclick'), 'window.commercialQueueUI.backToQueue()');
  assert.match(css, /\.commercial-queue-back\s*\{[^}]*background:\s*transparent/s);
});

test('mobile drawer opens, isolates the background, closes with Escape and restores focus and scroll state', t => {
  const { w, document } = fixture(t);
  document.body.style.overflow = 'auto';
  w.initMobileSidebar();
  assert.equal(document.getElementById('appSidebar').inert, true);
  w.toggleMobileSidebar();
  assert.equal(document.getElementById('appNavToggle').getAttribute('aria-expanded'), 'true');
  assert.equal(document.getElementById('appSidebar').getAttribute('aria-modal'), 'true');
  assert.equal(document.querySelector('.app-main').inert, true);
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(document.activeElement.getAttribute('aria-label'), 'Close navigation');
  document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(document.getElementById('appSidebar').classList.contains('open'), false);
  assert.equal(document.getElementById('appSidebarBackdrop').hidden, true);
  assert.equal(document.activeElement.id, 'appNavToggle');
  assert.equal(document.body.style.overflow, 'auto');
  assert.notEqual(document.querySelector('.app-main').inert, true);
});

test('group expansion does not dismiss the drawer, but selecting a destination does', t => {
  const { w, document } = fixture(t);
  w.initMobileSidebar();
  w.toggleMobileSidebar();
  document.querySelector('.app-sidebar-group-header').click();
  assert.equal(document.getElementById('appSidebar').classList.contains('open'), true);
  document.querySelector('[data-tab="tasks"].app-sidebar-nav-item').click();
  assert.equal(document.getElementById('appSidebar').classList.contains('open'), false);
});

test('Tab wraps in both directions and attempts to focus the background return to navigation', t => {
  const { w, document } = fixture(t);
  w.initMobileSidebar();
  w.toggleMobileSidebar();
  const first = document.querySelector('.app-nav-close');
  const last = document.querySelector('.app-sidebar-nav-item[data-tab="sms"]');
  first.getClientRects = last.getClientRects = () => [{}];
  first.focus();
  document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, last);
  document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, first);
  document.getElementById('logoutBtn').focus();
  assert.equal(document.activeElement, first);
});

test('desktop resize clears modal state, and Menu cannot open the desktop sidebar as a modal', t => {
  const { w, document, media } = fixture(t);
  w.initMobileSidebar();
  w.toggleMobileSidebar();
  media.matches = false;
  media.listeners.forEach(fn => fn());
  w.toggleMobileSidebar();
  assert.equal(document.getElementById('appSidebar').inert, false);
  assert.equal(document.getElementById('appSidebar').hasAttribute('aria-modal'), false);
  assert.equal(document.getElementById('appNavToggle').getAttribute('aria-expanded'), 'false');
  assert.equal(document.body.style.overflow, '');
});

test('local role, legacy key and session flags alone cannot unlock admin tools', t => {
  const { w, context } = fixture(t);
  w.localStorage.setItem('h2s_current_user', JSON.stringify({ role: 'ADMIN' }));
  w.localStorage.setItem('h2s_proof_admin_key', 'unverified-fixture-key');
  w.sessionStorage.setItem('h2s_admin_authenticated', 'true');
  w.setDashboardSessionToken('unverified-fixture-session');
  vm.runInContext("currentRole = 'ADMIN';", context);
  assert.equal(w.checkAdminAuth(), false);
});

test('restored server-validated ADMIN session opens Commercial Queue without a shared key or prompt', async t => {
  const { w, document } = fixture(t);
  w.setDashboardSessionToken('fixture-admin-session');
  w.fetch = async () => ({ ok: true, json: async () => ({ ok: true, me: { username: 'ADMIN_FIXTURE', role: 'ADMIN' } }) });
  assert.equal(await w.checkCachedUser(), true);
  assert.equal(w.checkAdminAuth(), true);
  w.promptAdminPassword = () => { throw new Error('ADMIN session must not be prompted'); };
  w.switchToTab('commercialqueue', { smooth: false });
  assert.equal(document.querySelector('.pane.active').id, 'commercialqueue-pane');
  assert.equal(document.activeElement.id, 'commercialqueue-pane');
  assert.equal(document.querySelector('[data-tab="commercialqueue"].app-sidebar-nav-item').getAttribute('aria-current'), 'page');
});

test('fresh ADMIN login validates access and changing its session token invalidates the cached capability', async t => {
  const { w, document } = fixture(t);
  document.getElementById('dashLoginUser').value = 'ADMIN_FIXTURE';
  document.getElementById('dashLoginPin').value = '00000000';
  w.fetch = async () => ({
    ok: true, json: async () => ({
      ok: true, dashboardLogin: { token: 'fixture-new-admin-session', user: { username: 'ADMIN_FIXTURE', role: 'ADMIN' } },
    }),
  });
  await w.dashboardAccountLogin();
  assert.equal(w.checkAdminAuth(), true);
  w.setDashboardSessionToken('different-unverified-session');
  assert.equal(w.checkAdminAuth(), false);
});

test('VA account remains blocked from admin navigation and invalid sessions do not acquire admin capability', async t => {
  const { w, document } = fixture(t);
  w.setDashboardSessionToken('fixture-va-session');
  w.fetch = async () => ({ ok: true, json: async () => ({ ok: true, me: { username: 'VA_FIXTURE', role: 'VA' } }) });
  await w.checkCachedUser();
  assert.equal(w.checkAdminAuth(), false);
  let prompted = false;
  w.promptAdminPassword = () => { prompted = true; };
  w.switchToTab('commercialqueue', { smooth: false });
  assert.equal(prompted, true);
  assert.notEqual(document.querySelector('.pane.active')?.id, 'commercialqueue-pane');
  w.fetch = async () => ({ ok: false });
  assert.equal(await w.checkCachedUser(), false);
  assert.equal(w.getDashboardSessionToken(), '');
  assert.equal(w.checkAdminAuth(), false);
});

test('shared-key verification explicitly omits session auth and uses only a read request', async t => {
  const { w } = fixture(t);
  w.fetch = async (url, options) => {
    assert.match(url, /action=commercialQueue&limit=1/);
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.authorization, '');
    assert.equal(options.headers['x-h2s-admin-key'], 'fixture-admin-key');
    return { ok: true, json: async () => ({ ok: true }) };
  };
  await w.verifySharedAdminCredential('fixture-admin-key');
  assert.equal(w.localStorage.getItem('h2s_proof_admin_key'), null);
});

test('the actual fetch wrapper honors explicit session suppression while ordinary API reads retain bearer auth', async t => {
  const { w, context } = fixture(t);
  const wrapper = ast.statements.find(node => ts.isExpressionStatement(node) && node.getText(ast).includes('function wrapFetchForDashboardAuth'));
  assert.ok(wrapper);
  w.Headers = Headers;
  w.Request = Request;
  w.setDashboardSessionToken('fixture-wrapper-session');
  const requests = [];
  w.fetch = async (url, options) => {
    requests.push({ url, headers: options.headers });
    return { ok: true, json: async () => ({ ok: true }) };
  };
  vm.runInContext(wrapper.getText(ast), context);
  await w.verifySharedAdminCredential('fixture-admin-key');
  assert.equal(requests[0].headers.get('authorization'), '');
  assert.equal(requests[0].headers.get('x-h2s-admin-key'), 'fixture-admin-key');
  await w.fetch('https://fixture.invalid/api/v1?action=dashboardMe');
  assert.equal(requests[1].headers.get('authorization'), 'Bearer fixture-wrapper-session');
});

test('incorrect shared key stays rejected without a success toast or saving it', async t => {
  const { w, document } = fixture(t);
  w.fetch = async () => ({ ok: false, json: async () => ({ ok: false, error: 'Invalid admin token' }) });
  await w.promptAdminPassword(() => { throw new Error('Incorrect key must not grant access'); });
  document.getElementById('adminPasswordInput').value = 'wrong-fixture-key';
  await document.getElementById('modalConfirmBtn').onclick();
  assert.equal(w.localStorage.getItem('h2s_proof_admin_key'), null);
  assert.equal(w.checkAdminAuth(), false);
  assert.match(document.getElementById('adminAccessStatus').textContent, /Invalid admin token/);
  assert.equal(w.toasts.some(toast => toast.kind === 'success'), false);
});

test('network failure during shared-key verification is visible and retry remains available', async t => {
  const { w, document } = fixture(t);
  w.fetch = async () => { throw new Error('Fixture network unavailable'); };
  await w.promptAdminPassword(() => { throw new Error('Network failure must not grant access'); });
  document.getElementById('adminPasswordInput').value = 'retry-fixture-key';
  await document.getElementById('modalConfirmBtn').onclick();
  assert.match(document.getElementById('adminAccessStatus').textContent, /network unavailable/);
  assert.equal(document.getElementById('modalConfirmBtn').disabled, false);
  assert.equal(w.checkAdminAuth(), false);
  assert.equal(w.localStorage.getItem('h2s_proof_admin_key'), null);
});

test('verified shared credential is saved only after verification; stored credentials are reverified', async t => {
  const { w, document } = fixture(t);
  let calls = 0;
  w.fetch = async () => { calls++; return { ok: true, json: async () => ({ ok: true }) }; };
  let granted = false;
  await w.promptAdminPassword(ok => { granted = ok; });
  document.getElementById('adminPasswordInput').value = 'valid-fixture-key';
  await document.getElementById('modalConfirmBtn').onclick();
  assert.equal(granted, true);
  assert.equal(w.checkAdminAuth(), true);
  assert.equal(calls, 1);
  w.setDashboardSessionToken('');
  assert.equal(w.checkAdminAuth(), false);
  await w.promptAdminPassword(ok => { granted = ok; });
  assert.equal(calls, 2);
  assert.equal(w.checkAdminAuth(), true);
});

test('cancelling during shared credential verification cannot grant late access', async t => {
  const { w, document } = fixture(t);
  let complete;
  w.fetch = () => new Promise(resolve => { complete = resolve; });
  const outcomes = [];
  await w.promptAdminPassword(ok => outcomes.push(ok));
  document.getElementById('adminPasswordInput').value = 'cancelled-fixture-key';
  const pending = document.getElementById('modalConfirmBtn').onclick();
  assert.equal(document.getElementById('modalConfirmBtn').disabled, true);
  document.querySelector('.modal-btn-cancel').onclick();
  complete({ ok: true, json: async () => ({ ok: true }) });
  await pending;
  assert.deepEqual(outcomes, [false]);
  assert.equal(w.localStorage.getItem('h2s_proof_admin_key'), null);
  assert.equal(w.checkAdminAuth(), false);
});
