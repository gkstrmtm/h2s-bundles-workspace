const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..', '..');
function extract(file, accept) {
  const source = fs.readFileSync(path.join(root, 'frontend', file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const selected = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && accept(node.name?.text)) selected.push(node.getText(ast));
    else if (ts.isVariableDeclaration(node) && accept(node.name.getText(ast))) selected.push(`let ${node.getText(ast)};`);
    else ts.forEachChild(node, visit);
  }
  visit(ast);
  return selected.join('\n');
}
const selects = extract('dash.js', name => /^__dashboardCustomSelect|^dashboard.*CustomSelect|^ensureDashboardCustomSelectBindings$/.test(name));
const media = extract('commercial.js', name => ['bindProofTileState', 'renderProofRail'].includes(name));
function setup(t, html) {
  const dom = new JSDOM(html, { url: 'http://fixture.invalid/', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  return dom.window;
}
function dropdown(t, html = '<form><label id="fieldLabel">Responsible staff<select id="staff" name="staff" required><option value="">Choose staff</option><option value="one">Alex</option><option value="two">Sam</option></select></label></form>') {
  const w = setup(t, html);
  w.eval(selects);
  const select = w.document.querySelector('select');
  w.dashboardSyncCustomSelect(select);
  return { w, select, shell: select.nextElementSibling, trigger: select.nextElementSibling.querySelector('button') };
}
function login(t) {
  const w = setup(t, fs.readFileSync(path.join(root, 'frontend', 'dash.html'), 'utf8'));
  const script = Array.from(w.document.scripts).find(node => node.textContent.includes('function bindDashboardLoginGate'));
  assert.ok(script);
  w.eval(script.textContent);
  w.eval(extract('dash.js', name => ['dashboardAccountLogin','toggleAdminCreateAccount','adminKeyCreateAccount'].includes(name)));
  w.API_URL = 'https://fixture.invalid/api/v1';
  w.STORAGE_KEY = 'fixture-login';
  w.showToast = () => {};
  return w;
}
test('header Sign out has one accessible name and retains the existing session-clearing behavior', async t => {
  const w = setup(t, fs.readFileSync(path.join(root, 'frontend', 'dash.html'), 'utf8'));
  const button = w.document.getElementById('logoutBtn');
  assert.equal(button.type, 'button');
  assert.equal(button.getAttribute('aria-label'), 'Sign out');
  assert.equal(button.title, 'Sign out');
  assert.equal(button.getAttribute('onclick'), 'logoutUser()');
  assert.equal(button.querySelector('svg').getAttribute('aria-hidden'), 'true');
  assert.equal(button.querySelector('svg').getAttribute('focusable'), 'false');
  for (const networkFailure of [false, true]) {
    const requests = [], removed = [], tokens = [];
    let reloads = 0;
    const context = vm.createContext({
      API_URL: 'https://fixture.invalid/api/v1', STORAGE_KEY: 'fixture-login',
      fetch: async (url, options) => {
        requests.push({ url, options });
        if (networkFailure) throw new Error('Fixture network failure');
        return { ok: true };
      },
      setDashboardSessionToken: value => tokens.push(value),
      localStorage: { removeItem: key => removed.push(key) },
      location: { reload: () => reloads++ },
    });
    vm.runInContext(extract('dash.js', name => name === 'logoutUser'), context);
    await context.logoutUser();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://fixture.invalid/api/v1?action=dashboardLogout');
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
    assert.equal(requests[0].options.body, '{}');
    assert.deepEqual(tokens, ['']);
    assert.deepEqual(removed, ['fixture-login', 'h2s_active_tab']);
    assert.equal(reloads, 1);
  }
});
test('compact sign-in retains persistent labels, PIN/autocomplete semantics and script-ready validation', t => {
  const w = login(t), doc = w.document, user = doc.getElementById('dashLoginUser'), pin = doc.getElementById('dashLoginPin');
  const button = doc.getElementById('dashLoginBtn');
  assert.equal(doc.querySelector('.user-gate-title').textContent, 'Home2Smart');
  assert.equal(doc.querySelector('.user-gate-subtitle').textContent, 'Dashboard sign in');
  assert.equal(user.labels[0].textContent.trim(), 'Username or email');
  assert.equal(pin.labels[0].textContent.trim(), 'PIN');
  assert.equal(user.autocomplete, 'username');
  assert.equal(pin.type, 'password');
  assert.equal(pin.autocomplete, 'current-password');
  user.value = 'fixture@example.invalid'; pin.value = '1234';
  user.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(button.disabled, true);
  w.__h2sDashboardScriptsLoaded = true;
  pin.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(button.disabled, false);
  pin.value = ' ';
  pin.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(button.disabled, true);
  assert.equal(doc.getElementById('dashLoginStatus').getAttribute('aria-live'), 'polite');
});
test('sign-in pending/error states and expandable admin creation retain their existing requests and validation', async t => {
  const w = login(t), doc = w.document, button = doc.getElementById('dashLoginBtn');
  doc.getElementById('dashLoginUser').value = 'fixture@example.invalid';
  doc.getElementById('dashLoginPin').value = '1234';
  let resolve, request;
  w.fetch = (url, options) => { request = { url, options }; return new Promise(done => { resolve = done; }); };
  const pending = w.dashboardAccountLogin();
  assert.equal(button.disabled, true);
  assert.equal(doc.getElementById('dashLoginStatus').textContent, 'Signing in...');
  assert.match(request.url, /action=dashboardLogin/);
  assert.equal(JSON.parse(request.options.body).username, 'fixture@example.invalid');
  assert.equal(JSON.parse(request.options.body).pin, '1234');
  resolve(Response.json({ ok: false, error: 'Fixture invalid PIN' }, { status: 401 }));
  await pending;
  assert.equal(button.disabled, false);
  assert.equal(doc.getElementById('dashLoginStatus').textContent, 'Fixture invalid PIN');
  assert.equal(doc.getElementById('dashLoginUser').value, 'fixture@example.invalid');
  const toggle = doc.querySelector('[aria-controls="dashAdminCreateWrap"]');
  const activate = () => w.Function(toggle.getAttribute('onclick')).call(toggle);
  assert.equal(doc.getElementById('dashAdminCreateWrap').style.display, 'none');
  activate();
  assert.equal(doc.getElementById('dashAdminCreateWrap').style.display, 'block');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  let creates = 0;
  w.fetch = async (url, options) => {
    creates++;
    assert.match(url, /action=createDashboardUser/);
    assert.equal(options.headers['x-h2s-admin-key'], 'fixture-admin-key');
    const payload = JSON.parse(options.body);
    assert.equal(payload.role, 'VA');
    assert.equal(payload.pin, '');
    assert.equal(payload.email, null);
    return Response.json({ ok: true, createDashboardUser: { user: { Username: 'FIXTURE' }, pin: '5678', pinWasGenerated: true } });
  };
  await w.adminKeyCreateAccount();
  assert.equal(creates, 0);
  assert.equal(doc.getElementById('dashAdminCreateStatus').textContent, 'Admin key required.');
  doc.getElementById('dashAdminCreateKey').value = 'fixture-admin-key';
  doc.getElementById('dashAdminCreateName').value = 'Fixture Staff';
  doc.getElementById('dashAdminCreateUser').value = 'FIXTURE';
  await w.adminKeyCreateAccount();
  assert.equal(creates, 1);
  assert.equal(doc.getElementById('dashAdminCreateStatus').textContent, 'Created.');
  assert.equal(doc.getElementById('dashAdminCreateName').value, '');
  activate();
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.getElementById('dashAdminCreateWrap').style.display, 'none');
});
test('custom dropdown cancels label activation, synchronizes selection once and keeps its accessible field name', t => {
  const { w, select, shell, trigger } = dropdown(t);
  let nativeClicks = 0, nativeFocus = 0, changes = 0, inputs = 0;
  select.addEventListener('click', () => nativeClicks++);
  select.addEventListener('focus', () => nativeFocus++);
  select.addEventListener('change', () => changes++);
  select.addEventListener('input', () => inputs++);
  assert.equal(trigger.getAttribute('aria-label'), 'Responsible staff');
  assert.equal(trigger.getAttribute('aria-required'), 'true');
  const click = new w.MouseEvent('click', { bubbles: true, cancelable: true });
  assert.equal(trigger.dispatchEvent(click), false);
  assert.equal(shell.classList.contains('is-open'), true);
  shell.querySelector('[data-value="two"]').click();
  assert.equal(select.value, 'two');
  assert.equal(changes, 1);
  assert.equal(inputs, 1);
  assert.equal(shell.classList.contains('is-open'), false);
  assert.equal(w.document.activeElement, trigger);
  w.document.getElementById('fieldLabel').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(nativeClicks, 0);
  assert.equal(nativeFocus, 0);
  assert.equal(w.document.activeElement, trigger);
});
test('unrelated sync preserves open options/focus; keyboard, external changes and dismissal remain usable', t => {
  const { w, select, shell, trigger } = dropdown(t);
  trigger.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  const option = shell.querySelector('[data-value="one"]');
  option.focus();
  w.dashboardSyncAllCustomSelects();
  assert.equal(shell.querySelector('[data-value="one"]'), option);
  assert.equal(w.document.activeElement, option);
  option.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  assert.equal(w.document.activeElement.dataset.value, 'two');
  w.document.activeElement.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(w.document.activeElement, trigger);
  assert.equal(shell.classList.contains('is-open'), false);
  select.value = 'one';
  select.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(trigger.textContent, 'Alex');
  select.disabled = true;
  w.dashboardSyncCustomSelect(select);
  assert.equal(trigger.disabled, true);
  trigger.click();
  assert.equal(shell.classList.contains('is-open'), false);
  select.disabled = false;
  w.dashboardSyncCustomSelect(select);
  trigger.click();
  w.document.body.click();
  assert.equal(shell.classList.contains('is-open'), false);
});
test('required validation remains native but focuses and reports through the visible custom control', t => {
  const { w, select, shell, trigger } = dropdown(t);
  assert.equal(w.document.querySelector('form').checkValidity(), false);
  assert.equal(w.document.activeElement, trigger);
  assert.equal(trigger.getAttribute('aria-invalid'), 'true');
  assert.equal(shell.querySelector('.dashboard-custom-select-error').hidden, false);
  assert.ok(shell.querySelector('.dashboard-custom-select-error').textContent);
  select.value = 'one';
  select.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(w.document.querySelector('form').checkValidity(), true);
  assert.equal(shell.querySelector('.dashboard-custom-select-error').hidden, true);
  assert.equal(new w.FormData(w.document.querySelector('form')).get('staff'), 'one');
});
test('explicit native, multiple, listbox and hidden-model selects remain unenhanced; date/file inputs are untouched', t => {
  const w = setup(t, `<select id="native" data-custom-select="off"><option>A</option></select>
    <select multiple><option>A</option></select><select size="3"><option>A</option></select>
    <select style="display:none"><option>A</option></select><input type="date"><input type="file">`);
  w.eval(selects);
  w.dashboardSyncAllCustomSelects();
  assert.equal(w.document.querySelectorAll('.dashboard-custom-select-shell').length, 0);
  assert.equal(w.document.querySelector('input[type=date]').type, 'date');
  assert.equal(w.document.querySelector('input[type=file]').type, 'file');
  const html = fs.readFileSync(path.join(root, 'frontend', 'dash.html'), 'utf8');
  assert.match(html, /id="commercialQueueFilter"[\s\S]{0,180}data-custom-select="off"/);
});
function video(t) {
  const w = setup(t, '<div id="rail"></div>');
  w.qsa = (selector, target) => Array.from(target.querySelectorAll(selector));
  w.normalizeMediaItems = (items, limit) => items.slice(0, limit);
  w.mediaPosterFor = item => item.poster;
  w.escapeAttr = value => String(value);
  w.H2SMediaPlacements = { style: () => '' };
  const timers = new Map(); let timer = 0;
  w.setTimeout = (callback, delay) => { timers.set(++timer, { callback, delay }); return timer; };
  w.clearTimeout = key => timers.delete(key);
  w.eval(media);
  const rail = w.document.getElementById('rail');
  w.renderProofRail(rail, [{ media_kind: 'video', media_url: '/synthetic.webm', poster: '/poster.svg' }]);
  const node = rail.querySelector('video'), tile = node.parentElement;
  const state = { readyState: 0, networkState: 1, paused: true, error: null };
  Object.keys(state).forEach(key => Object.defineProperty(node, key, { get: () => state[key] }));
  const event = type => node.dispatchEvent(new w.Event(type));
  let stopped = 0;
  node.pause = () => { state.paused = true; event('pause'); };
  node.load = () => { stopped++; state.networkState = 0; event('emptied'); };
  return { w, rail, node, tile, state, event, stopped: () => stopped, flush: (delay = 750) => {
    const pending = [...timers.entries()].filter(([, timer]) => timer.delay === delay);
    pending.forEach(([key]) => timers.delete(key));
    pending.forEach(([, timer]) => timer.callback());
  } };
}
test('idle preload-none video has no app overlay and retains native controls, poster and inline playback', t => {
  const { w, rail, node, tile, event, flush } = video(t);
  assert.equal(node.controls, true);
  assert.equal(node.hasAttribute('playsinline'), true);
  assert.equal(node.getAttribute('poster'), '/poster.svg');
  assert.equal(node.preload, 'none');
  event('loadstart'); flush();
  assert.equal(tile.classList.contains('is-pending'), false);
  assert.equal(tile.querySelector('.proof-media-status').hidden, true);
  w.bindProofTileState(rail);
  assert.equal(tile.querySelectorAll('.proof-media-status').length, 1);
});
test('real waiting is delayed, readiness removes feedback and brief repeated buffering never flashes', t => {
  const { tile, state, event, flush } = video(t);
  state.paused = false; state.networkState = 2;
  event('waiting');
  assert.equal(tile.querySelector('.proof-media-status').hidden, true);
  flush();
  assert.equal(tile.querySelector('.proof-media-status').hidden, false);
  assert.equal(tile.getAttribute('aria-busy'), 'true');
  state.readyState = 3; event('canplay');
  assert.equal(tile.querySelector('.proof-media-status').hidden, true);
  for (let i = 0; i < 4; i++) {
    state.readyState = 1; event('waiting');
    state.readyState = 3; event('playing'); flush();
    assert.equal(tile.querySelector('.proof-media-status').hidden, true);
  }
});
test('paused/error/disconnected media cancels loading feedback without removing controls or hiding errors', t => {
  const { rail, node, tile, state, event, flush } = video(t);
  state.paused = false; state.networkState = 2;
  event('waiting'); event('pause'); flush();
  assert.equal(tile.querySelector('.proof-media-status').hidden, true);
  state.error = { code: 4 }; event('error'); event('pause'); flush();
  assert.equal(tile.querySelector('[role=alert]').hidden, false);
  assert.match(tile.querySelector('[role=alert]').textContent, /unavailable/);
  assert.equal(node.controls, true);
  state.error = null; event('waiting'); rail.remove(); flush();
  assert.equal(tile.classList.contains('is-pending'), false);
});
test('a permanent video stall is bounded, stops delivery and retains an honest poster fallback', t => {
  const { node, tile, state, event, flush, stopped } = video(t);
  state.paused = false; state.networkState = 2;
  event('waiting'); flush();
  assert.equal(tile.getAttribute('aria-busy'), 'true');
  for (let i = 0; i < 4; i++) event('stalled');
  flush(30000);
  assert.equal(tile.getAttribute('aria-busy'), 'false');
  assert.equal(tile.classList.contains('is-pending'), false);
  assert.equal(tile.classList.contains('is-error'), true);
  assert.equal(node.hasAttribute('src'), false);
  assert.equal(node.getAttribute('poster'), '/poster.svg');
  assert.equal(node.controls, true);
  assert.equal(node.hasAttribute('playsinline'), true);
  assert.equal(stopped(), 1);
  assert.match(tile.querySelector('[role=alert]').textContent, /Video unavailable.*Reload/);
  state.readyState = 4; event('canplay'); event('playing'); flush(30000);
  assert.equal(tile.classList.contains('is-error'), true);
  assert.equal(tile.querySelector('[role=alert]').hidden, false);
});
test('playback readiness and user pause cancel the failure deadline without changing the source', t => {
  const { node, tile, state, event, flush, stopped } = video(t);
  for (const settled of ['canplay', 'pause']) {
    state.paused = false; state.networkState = 2; state.readyState = 1;
    event('waiting'); flush();
    state.readyState = settled === 'canplay' ? 3 : 1;
    event(settled); flush(30000);
    assert.equal(stopped(), 0);
    assert.equal(node.getAttribute('src'), '/synthetic.webm');
    assert.equal(tile.classList.contains('is-error'), false);
  }
});
test('loading feedback has no animation under either motion preference and native backing controls cannot override hiding', () => {
  const css = fs.readFileSync(path.join(root, 'frontend', 'commercial.css'), 'utf8');
  assert.doesNotMatch(css, /media-skeleton-shift/);
  assert.doesNotMatch(css, /\.proof-tile\.is-pending::after/);
  assert.match(css.match(/\.proof-media-status\s*\{[^}]+\}/)[0], /pointer-events:\s*none/);
  assert.doesNotMatch(css.match(/\.proof-media-status\s*\{[^}]+\}/)[0], /animation|transition|gradient/);
  const dashboardCss = fs.readFileSync(path.join(root, 'frontend', 'dash.css'), 'utf8');
  assert.match(dashboardCss, /select\.dashboard-custom-select-native\s*\{\s*display:\s*none !important/);
});
