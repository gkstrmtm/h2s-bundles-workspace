const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
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
