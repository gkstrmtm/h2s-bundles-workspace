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
const messages = fs.readFileSync(path.join(root, 'frontend', 'dash-messages.js'), 'utf8');
const noFlicker = fs.readFileSync(path.join(root, 'frontend', 'sms-no-flicker.js'), 'utf8');
const ast = ts.createSourceFile('dash.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = new Map(ast.statements.filter(ts.isFunctionDeclaration).map(n => [n.name.text, n.getText(ast)]));
const declarations = new Map();
for (const statement of ast.statements.filter(ts.isVariableStatement)) {
  for (const declaration of statement.declarationList.declarations) {
    declarations.set(declaration.name.getText(ast), statement.getText(ast));
  }
}
const authWrapper = ast.statements.find(n => ts.isExpressionStatement(n) && n.getText(ast).includes('function wrapFetchForDashboardAuth(')).getText(ast);
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function mount(t, { flicker = true } = {}) {
  const dom = new JSDOM(html, { url: 'https://fixture.invalid/dash.html', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  const timers = new Map();
  let nextTimer = 0;
  w.setTimeout = (fn, delay) => { const key = ++nextTimer; timers.set(key, { fn, delay }); return key; };
  w.clearTimeout = w.clearInterval = key => timers.delete(key);
  w.setInterval = () => { throw new Error('Legacy SMS polling must not start in internal messaging'); };
  w.Headers = Headers;
  w.Request = Request;
  w.toasts = [];
  w.showToast = (message, kind) => w.toasts.push({ message, kind });
  w.showConfirm = async () => true;
  w.showModal = (_title, body) => { w.document.getElementById('modalBody').innerHTML = body; };
  w.closeModal = () => {};
  w.console.error = (...args) => fixture.errors.push(args.map(String).join(' '));
  w.isAdminRole = () => fixture.role === 'ADMIN';
  w.localStorage.setItem('h2s_dashboard_session_token_v1', 'fixture-session');
  const fixture = {
    role: 'ADMIN', calls: [], errors: [], faults: new Map(), blockers: new Map(),
    users: [
      { userId: id(1), username: 'ADMIN_FIXTURE', displayName: 'Admin Fixture', email: 'admin@example.invalid' },
      { userId: id(2), username: 'VA_FIXTURE', displayName: 'VA Fixture', email: 'va@example.invalid' },
    ],
    conversations: [
      { conversation_id: id(10), title: 'Operations fixture', last_message_at: '2026-10-20T12:00:00Z', last_message_preview: 'Fixture message', unread_count: 0 },
      { conversation_id: id(11), title: 'Second fixture', last_message_at: '2026-10-20T12:00:00Z', last_message_preview: 'Other fixture', unread_count: 1 },
    ],
    rows: [{ message_id: id(100), body: 'Fixture message', created_at: '2026-10-20T12:00:00Z', sent_by_user_id: id(2), sent_by_username: 'VA_FIXTURE' }],
  };
  w.fetch = async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.origin, 'https://fixture.invalid', 'Never allow a real API origin');
    const action = url.searchParams.get('action');
    const headers = new Headers(options.headers);
    const body = options.body ? JSON.parse(options.body) : null;
    fixture.calls.push({ action, method: options.method || 'GET', headers, body });
    if (fixture.blockers.has(action)) await fixture.blockers.get(action).promise;
    const fault = fixture.faults.get(action);
    if (fault) return { ok: false, status: fault, json: async () => ({ ok: false, error: fault === 401 ? 'Not authenticated' : 'Access denied' }) };
    if (headers.get('authorization') !== 'Bearer fixture-session') {
      return { ok: false, status: 401, json: async () => ({ ok: false, error: 'Not authenticated' }) };
    }
    let payload;
    switch (action) {
      case 'dashboardMe': payload = { me: fixture.users[0] }; break;
      case 'messagesUsers': payload = { messagesUsers: fixture.users }; break;
      case 'messagesConversations': payload = { messagesConversations: fixture.conversations }; break;
      case 'messagesConversation': payload = { messagesConversation: {
        conversation: fixture.conversations.find(c => c.conversation_id === url.searchParams.get('conversation_id')),
        viewer_user_id: id(1), members: fixture.users.map(u => ({ user_id: u.userId, username: u.username })),
        messages: url.searchParams.has('before') ? [] : fixture.rows.slice(),
      } }; break;
      case 'messagesSend':
        assert.equal(options.method, 'POST');
        fixture.rows.push({ message_id: id(100 + fixture.rows.length), body: body.body, sent_by_user_id: id(1), created_at: '2026-10-20T12:01:00Z' });
        payload = { messagesSend: fixture.rows.at(-1) };
        break;
      case 'messagesConversationUpsert':
        assert.equal(options.method, 'POST');
        payload = { messagesConversationUpsert: { conversation_id: body.conversation_id || id(10), title: body.title } };
        break;
      case 'messagesDeleteConversation': payload = { messagesDeleteConversation: { deleted: true } }; break;
      case 'messagesPolishDraft': payload = { messagesPolishDraft: { polished_text: 'Polished fixture draft', summary: 'Fixture rewrite' } }; break;
      default: throw new Error(`Unexpected or legacy API action: ${action}`);
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, ...payload }) };
  };
  const context = dom.getInternalVMContext();
  vm.runInContext([
    "const API_URL='https://fixture.invalid/api/v1'; const DASH_SESSION_TOKEN_KEY='h2s_dashboard_session_token_v1'; let currentUser='ADMIN_FIXTURE';",
    ...Array.from(declarations).filter(([name]) => name.startsWith('__sms')).map(([, value]) => value),
    ...['getDashboardSessionToken', 'syncLegacyMessagingWindowState', 'smsEscapeHtml', 'smsGetComposerEls', 'smsSetComposerEnabled', 'smsIsTabActive', 'stopSmsAutoRefresh', 'smsRemoveRecipient']
      .map(name => { assert.ok(functions.has(name), name); return functions.get(name); }),
    authWrapper,
  ].join('\n'), context);
  w.__h2sSyncMessagesState = w.syncLegacyMessagingWindowState;
  w.syncLegacyMessagingWindowState();
  w.document.querySelectorAll('.pane.active,.app-sidebar-nav-item.active').forEach(e => e.classList.remove('active'));
  w.document.getElementById('sms-pane').classList.add('active');
  w.document.querySelector('[data-tab="sms"]').classList.add('active');
  vm.runInContext(messages, context, { filename: 'dash-messages.js' });
  if (flicker) vm.runInContext(noFlicker, context, { filename: 'sms-no-flicker.js' });
  return { w, dom, context, fixture, timers, async tick() {
    const entry = Array.from(timers).find(([, timer]) => [1200, 2500].includes(timer.delay));
    assert.ok(entry, 'One messaging poll timer exists');
    timers.delete(entry[0]);
    await entry[1].fn();
  } };
}

test('required scripts load serially and login stays disabled until all dependencies are ready', async t => {
  const dom = new JSDOM(html, { url: 'https://fixture.invalid/dash.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  const pending = [];
  w.document.head.appendChild = script => { pending.push(script); return script; };
  const scripts = Array.from(w.document.scripts).map(s => s.textContent);
  vm.runInContext(scripts.find(s => s.includes('function bindDashboardLoginGate()')), dom.getInternalVMContext());
  w.document.getElementById('dashLoginUser').value = 'ADMIN_FIXTURE';
  w.document.getElementById('dashLoginPin').value = '00000000';
  vm.runInContext(scripts.find(s => s.includes('function loadDashboardScripts()')), dom.getInternalVMContext());
  w.syncDashboardLoginEnabled();
  assert.equal(w.document.getElementById('dashLoginBtn').disabled, true);
  for (const [index, name] of ['commercial-labels.js', 'commercial-operations.js', 'dash.js', 'media-placement-style.js', 'media-page-heroes.js', 'media-placements.js', 'dash-messages.js', 'sms-no-flicker.js'].entries()) {
    assert.equal(pending.length, index + 1);
    assert.equal(new URL(pending[index].src).pathname, `/${name}`);
    pending[index].onload();
    await settle();
  }
  await w.__h2sDashboardScriptsReady;
  assert.equal(w.__h2sDashboardScriptsLoaded, true);
  assert.equal(w.document.getElementById('dashLoginBtn').disabled, false);
});

test('a missing support script is explicit and blocks startup and login rather than falling back to SMS', async t => {
  const dom = new JSDOM(html, { url: 'https://fixture.invalid/dash.html', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const w = dom.window;
  const pending = [];
  w.console.error = () => {};
  w.document.head.appendChild = script => { pending.push(script); return script; };
  const loader = Array.from(w.document.scripts).find(s => s.textContent.includes('function loadDashboardScripts()')).textContent;
  vm.runInContext(loader, dom.getInternalVMContext());
  pending[0].onload();
  await settle();
  pending[1].onload();
  await settle();
  pending[2].onload();
  await settle();
  pending[3].onload();
  await settle();
  pending[4].onload();
  await settle();
  const rejected = assert.rejects(w.__h2sDashboardScriptsReady, /media-placements.js/);
  pending[5].onerror();
  await rejected;
  await settle();
  assert.equal(w.__h2sDashboardScriptsLoaded, false);
  assert.match(w.document.getElementById('dashLoginStatus').textContent, /media-placements.js.*Reload/);
  assert.equal(w.document.getElementById('dashLoginBtn').disabled, true);
});

test('dashboard session initialization waits for required scripts', async t => {
  const dom = new JSDOM('', { runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const ready = deferred();
  let starts = 0;
  dom.window.__h2sDashboardScriptsReady = ready.promise;
  dom.window.initMobileSidebar = () => { starts++; throw new Error('Fixture reached session initialization'); };
  vm.runInContext(declarations.get('initializeDashboardSession'), dom.getInternalVMContext());
  const init = vm.runInContext('initializeDashboardSession()', dom.getInternalVMContext());
  assert.equal(starts, 0);
  const finished = assert.rejects(init, /Fixture reached session initialization/);
  ready.resolve();
  await finished;
  assert.equal(starts, 1);
});

test('internal conversations load with session auth, escape content and remain searchable without repainting unchanged rows', async t => {
  const { w, fixture } = mount(t);
  await w.loadSmsThreads(false);
  const list = w.document.getElementById('smsThreadsList');
  const first = list.firstChild;
  await w.loadSmsThreads(true);
  assert.equal(list.firstChild, first);
  w.document.getElementById('smsThreadSearch').value = 'Second';
  w.smsFilterThreads();
  assert.doesNotMatch(list.textContent, /Operations fixture/);
  assert.match(list.textContent, /Second fixture/);
  w.document.getElementById('smsThreadSearch').value = '';
  w.smsFilterThreads();
  fixture.conversations[0].title = '<img src=x onerror=alert(1)>';
  await w.loadSmsThreads(true);
  assert.match(list.textContent, /<img/);
  assert.equal(list.querySelector('img'), null);
  assert.ok(fixture.calls.every(c => c.headers.get('authorization') === 'Bearer fixture-session'));
  assert.equal(w.isSmsTabActive(), true);
});

test('same-data refresh restores a replaced loading/error list and installing patches twice adds no wrapper or poll', async t => {
  const { w, fixture, context, timers } = mount(t);
  await w.loadSmsThreads(false);
  const render = w.renderSmsConversations;
  const poll = w.startSmsAutoRefresh;
  vm.runInContext(messages, context);
  vm.runInContext(noFlicker, context);
  assert.equal(w.renderSmsConversations, render);
  assert.equal(w.startSmsAutoRefresh, poll);
  assert.equal(timers.size, 0);
  const list = w.document.getElementById('smsThreadsList');
  list.innerHTML = '<p>Replaced by a loading or error state</p>';
  await w.loadSmsThreads(true);
  assert.match(list.textContent, /Operations fixture/);
  assert.equal(fixture.calls.filter(c => c.action.startsWith('sms')).length, 0);
});

test('opening, sending and refreshing an internal chat use one send and retain a draft after failure', async t => {
  const { w, fixture } = mount(t);
  await w.loadSmsThreads();
  await w.openSmsThread(id(10));
  const input = w.document.getElementById('smsSendInput');
  input.value = 'Fixture send only';
  await w.smsSendFromComposer({ preventDefault() {} });
  assert.equal(fixture.calls.filter(c => c.action === 'messagesSend').length, 1);
  assert.equal(fixture.rows.at(-1).body, 'Fixture send only');
  assert.equal(input.value, '');
  fixture.faults.set('messagesSend', 500);
  input.value = 'Retain failed draft';
  await w.smsSendFromComposer();
  assert.equal(input.value, 'Retain failed draft');
  assert.ok(w.toasts.some(t => t.kind === 'error'));
});

test('an in-flight send cannot be submitted twice or erase a newly edited draft', async t => {
  const { w, fixture } = mount(t);
  await w.loadSmsThreads();
  await w.openSmsThread(id(10));
  const pending = deferred();
  fixture.blockers.set('messagesSend', pending);
  const input = w.document.getElementById('smsSendInput');
  input.value = 'Submitted fixture';
  const first = w.smsSendFromComposer();
  await settle();
  input.value = 'New unsent draft';
  await w.smsSendFromComposer();
  pending.resolve();
  await first;
  assert.equal(fixture.calls.filter(c => c.action === 'messagesSend').length, 1);
  assert.equal(input.value, 'New unsent draft');
});

test('background thread refresh preserves reader scroll and composer focus/draft', async t => {
  const { w, fixture } = mount(t);
  await w.loadSmsThreads();
  await w.openSmsThread(id(10));
  const wrap = w.document.getElementById('smsMessagesList');
  Object.defineProperties(wrap, { scrollHeight: { value: 2000 }, clientHeight: { value: 300 } });
  wrap.scrollTop = 420;
  const input = w.document.getElementById('smsSendInput');
  input.value = 'Unsent fixture draft';
  input.focus();
  fixture.rows.push({ message_id: id(101), body: 'New inbound fixture', created_at: '2026-10-20T12:01:00Z' });
  await w.refreshActiveSmsThread();
  assert.equal(wrap.scrollTop, 420);
  assert.equal(w.document.activeElement, input);
  assert.equal(input.value, 'Unsent fixture draft');
  assert.match(wrap.textContent, /New inbound fixture/);
});

test('concurrent new-chat submission stays guarded while resolving typed teammates', async t => {
  const { w, fixture } = mount(t);
  await w.loadSmsThreads();
  let to = w.document.getElementById('smsToInput');
  if (!to) {
    to = w.document.createElement('input');
    to.id = 'smsToInput';
    w.document.body.appendChild(to);
  }
  to.value = 'VA_FIXTURE';
  w.document.getElementById('smsSendInput').value = 'New chat fixture';
  const blocked = deferred();
  fixture.blockers.set('messagesUsers', blocked);
  const first = w.smsSendFromComposer();
  await settle();
  const second = w.smsSendFromComposer();
  blocked.resolve();
  await Promise.all([first, second]);
  assert.equal(fixture.calls.filter(c => c.action === 'messagesConversationUpsert').length, 1);
  assert.equal(fixture.calls.filter(c => c.action === 'messagesSend').length, 1);
});

test('a broken or absent confirmation service cannot delete a chat', async t => {
  const { w, fixture } = mount(t);
  w.showConfirm = async () => { throw new Error('Fixture dialog unavailable'); };
  await w.messagesDeleteConversation(id(10), 'Fixture');
  w.showConfirm = undefined;
  await w.messagesDeleteConversation(id(10), 'Fixture');
  assert.equal(fixture.calls.some(c => c.action === 'messagesDeleteConversation'), false);
  assert.ok(w.toasts.some(t => t.kind === 'error'));
});

test('polling is sequential, refreshes the list once per tick and does not multiply when restarted', async t => {
  const { w, fixture, timers, tick } = mount(t);
  await w.loadSmsThreads();
  await w.openSmsThread(id(10));
  fixture.calls.length = 0;
  w.startSmsAutoRefresh();
  w.startSmsAutoRefresh();
  assert.equal(timers.size, 1);
  fixture.rows.push({ message_id: id(101), body: 'Poll fixture', created_at: '2026-10-20T12:01:00Z' });
  await tick();
  assert.equal(fixture.calls.filter(c => c.action === 'messagesConversation').length, 1);
  assert.equal(fixture.calls.filter(c => c.action === 'messagesConversations').length, 1);
  assert.equal(timers.size, 1);
  w.stopSmsAutoRefresh();
  assert.equal(timers.size, 0);
});

test('stopping or restarting during an in-flight poll cannot resurrect the old poll loop', async t => {
  const { w, fixture, timers, tick } = mount(t);
  await w.loadSmsThreads();
  const blocked = deferred();
  fixture.blockers.set('messagesConversations', blocked);
  w.startSmsAutoRefresh();
  const running = tick();
  await settle();
  w.stopSmsAutoRefresh();
  w.startSmsAutoRefresh();
  blocked.resolve();
  await running;
  assert.equal(timers.size, 1);
  w.stopSmsAutoRefresh();
  assert.equal(timers.size, 0);
});

test('hidden or inactive messaging makes no polling requests', async t => {
  const { w, fixture, tick, timers } = mount(t);
  Object.defineProperty(w.document, 'hidden', { configurable: true, value: true });
  w.startSmsAutoRefresh();
  await tick();
  assert.equal(fixture.calls.length, 0);
  assert.equal(timers.size, 1);
  Object.defineProperty(w.document, 'hidden', { configurable: true, value: false });
  w.document.querySelector('[data-tab="sms"]').classList.remove('active');
  await tick();
  assert.equal(fixture.calls.length, 0);
  assert.equal(timers.size, 0);
});

for (const status of [401, 403]) {
  test(`messaging HTTP ${status} disables composing and stops polling; successful reauthentication restores access`, async t => {
    const { w, fixture, timers } = mount(t);
    await w.loadSmsThreads();
    await w.openSmsThread(id(10));
    w.startSmsAutoRefresh();
    fixture.faults.set('messagesConversation', status);
    await w.refreshActiveSmsThread();
    assert.equal(w.document.getElementById('smsSendBtn').disabled, true);
    assert.equal(w.messagesCanStartConversation(), false);
    assert.equal(timers.size, 0);
    const sends = fixture.calls.filter(c => c.action === 'messagesSend').length;
    w.document.getElementById('smsSendInput').value = 'Must not send';
    await w.smsSendFromComposer();
    assert.equal(fixture.calls.filter(c => c.action === 'messagesSend').length, sends);
    fixture.faults.set('messagesConversations', 500);
    await w.loadSmsThreads();
    assert.equal(w.messagesCanStartConversation(), false);
    assert.equal(w.document.getElementById('smsSendBtn').disabled, true);
    fixture.faults.clear();
    await w.loadSmsThreads();
    assert.equal(w.messagesCanStartConversation(), true);
    assert.equal(w.document.getElementById('smsSendBtn').disabled, false);
  });
}

test('an older successful list response cannot restore composing after a newer authorization failure', async t => {
  const { w, fixture } = mount(t);
  await w.loadSmsThreads();
  await w.openSmsThread(id(10));
  await settle();
  const blocked = deferred();
  fixture.blockers.set('messagesConversations', blocked);
  const stale = w.loadSmsThreads(true);
  await settle();
  fixture.faults.set('messagesConversation', 401);
  await w.refreshActiveSmsThread();
  blocked.resolve();
  await stale;
  assert.equal(w.messagesCanStartConversation(), false);
  assert.equal(w.document.getElementById('smsSendBtn').disabled, true);
});

test('new teammate chat, rename, draft polishing and admin-only deletion retain their existing internal endpoints', async t => {
  const { w, fixture } = mount(t);
  await w.loadSmsThreads();
  await w.messagesOpenNewConversationModal();
  assert.equal(w.document.querySelectorAll('.msg-newconv-user').length, 1);
  w.document.querySelector('.msg-newconv-user').checked = true;
  w.document.getElementById('messagesNewConvTitle').value = 'Fixture-only new chat';
  await w.document.getElementById('modalConfirmBtn').onclick();
  assert.ok(fixture.calls.some(c => c.action === 'messagesConversationUpsert' && c.body.title === 'Fixture-only new chat'));
  w.prompt = () => 'Renamed fixture';
  w.document.querySelector('.sms-thread-header__title').click();
  await settle();
  assert.ok(fixture.calls.some(c => c.action === 'messagesConversationUpsert' && c.body.title === 'Renamed fixture'));
  w.document.getElementById('smsSendInput').value = 'Draft to polish';
  w.messagesPolishDraft();
  await settle();
  assert.equal(w.document.getElementById('smsSendInput').value, 'Polished fixture draft');
  fixture.role = 'VA';
  await w.messagesDeleteConversation(id(10), 'Fixture');
  assert.equal(fixture.calls.some(c => c.action === 'messagesDeleteConversation'), false);
  fixture.role = 'ADMIN';
  await w.messagesDeleteConversation(id(10), 'Fixture');
  assert.equal(fixture.calls.filter(c => c.action === 'messagesDeleteConversation').length, 1);
});
