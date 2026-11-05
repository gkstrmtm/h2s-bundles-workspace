const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dash.js'), 'utf8');
const controlsSource = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dashboard-controls.js'), 'utf8');

test('candidate and task overlays stay inside the canonical styled dashboard and the drawer starts hidden', () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dash.html'), 'utf8'));
  try {
    const doc = dom.window.document, app = doc.getElementById('h2s-app');
    for (const id of ['taskModal', 'adFrameworkModal', 'detailDrawer']) assert.ok(app.contains(doc.getElementById(id)), id);
    const drawer = doc.getElementById('detailDrawer');
    assert.equal(drawer.hidden, true);
    assert.equal(drawer.getAttribute('aria-labelledby'), 'drawerTitle');
    assert.equal(drawer.querySelector('button').getAttribute('aria-label'), 'Close candidate details');
    assert.equal(doc.getElementById('appNavToggle').textContent, 'Menu');
    const hours = doc.getElementById('logHoursQuickBtn');
    assert.ok(hours.closest('.app-topbar-right'));
    assert.equal(hours.getAttribute('onclick'), 'openHoursModal()');
    assert.equal(dom.window.getComputedStyle(hours).position, 'static');
  } finally { dom.window.close(); }
});

test('candidate drawer opens, closes and returns focus without exposing idle content', () => {
  const dom = new JSDOM('<button id="candidate">Candidate</button><div id="detailDrawer" hidden><button class="detail-drawer-close">Close</button></div>', { runScripts: 'outside-only' });
  try {
    const w = dom.window, trigger = w.document.getElementById('candidate'), drawer = w.document.getElementById('detailDrawer');
    w.eval(source.slice(source.indexOf('        let detailDrawerReturnFocus = null;'), source.indexOf('        function viewCandidate(')));
    trigger.focus();
    w.openDetailDrawer();
    assert.equal(drawer.hidden, false);
    assert.ok(drawer.classList.contains('open'));
    assert.equal(w.document.activeElement, drawer.querySelector('button'));
    w.closeDetailDrawer();
    assert.equal(drawer.hidden, true);
    assert.equal(drawer.classList.contains('open'), false);
    assert.equal(w.document.activeElement, trigger);
  } finally { dom.window.close(); }
});

function fixture(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const { window } = dom;
  window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'date-popup.js'), 'utf8'));
  window.eval(controlsSource);
  Object.assign(window,window.H2SDashboardControls);
  const calls = [];
  window.flatpickr = (input, options) => {
    calls.push({ input, options });
    const altInput = window.document.createElement('input');
    input.after(altInput);
    const instance = input._flatpickr = {
      altInput, selectedDates: [], config: options,
      set(key, value) { this.config[key] = value; },
      setDate(value) { this.lastSetDate = value; },
    };
    return instance;
  };
  return { dom, window, calls, close: () => window.close() };
}

test('global initializer covers date, time and local datetime without a form-input class', () => {
  const f = fixture('<input type=date><input type=time><input type=datetime-local><input type=file>');
  try {
    f.window.h2sInitDateInputs();
    assert.equal(f.calls.length, 3);
    assert.deepEqual(f.calls.map(call => call.options.dateFormat), ['Y-m-d', 'H:i', 'Y-m-d\\TH:i']);
    for (const { options } of f.calls) {
      assert.equal(options.disableMobile, true);
      assert.equal(options.monthSelectorType, 'static');
      assert.equal(options.minuteIncrement, 1);
    }
    assert.equal(f.window.document.querySelector('[type=file]')._flatpickr, undefined);
    f.window.h2sInitDateInputs();
    assert.equal(f.calls.length, 3);
  } finally { f.close(); }
});

test('initialization accepts a newly inserted input itself, not just a container', () => {
  const f = fixture('<main></main>');
  try {
    const input = f.window.document.createElement('input');
    input.type = 'datetime-local';
    input.value = '2099-02-01T09:35';
    f.window.document.querySelector('main').append(input);
    f.window.h2sInitDateInputs(input);
    assert.equal(f.calls.length, 1);
    assert.equal(input._flatpickr.lastSetDate, '2099-02-01T09:35');
    assert.equal(input.value, '2099-02-01T09:35');
  } finally { f.close(); }
});

test('required, constraints, disabled and read-only changes reach the visible control', () => {
  const f = fixture('<input type=time required min="09:00" max="18:00" aria-describedby="hint">');
  try {
    const input = f.window.document.querySelector('input');
    f.window.h2sInitDateInputs();
    const { altInput, config } = input._flatpickr;
    assert.equal(config.minTime, '09:00');
    assert.equal(config.maxTime, '18:00');
    assert.equal(altInput.required, true);
    assert.equal(altInput.getAttribute('aria-describedby'), 'hint');
    let closed = false;
    input._flatpickr.isOpen = true;
    input._flatpickr.close = () => { closed = true; };
    input.disabled = input.readOnly = true;
    input.required = false;
    input.removeAttribute('aria-describedby');
    f.window.h2sInitDateInputs();
    assert.equal(altInput.disabled, true);
    assert.equal(altInput.readOnly, true);
    assert.equal(altInput.required, false);
    assert.equal(config.clickOpens, false);
    assert.equal(closed, true);
    assert.equal(altInput.hasAttribute('aria-describedby'), false);
  } finally { f.close(); }
});

test('unchanged control synchronization does not perpetually mutate observed attributes', async () => {
  const f = fixture('<input type=date required readonly aria-describedby="hint">');
  try {
    f.window.h2sInitDateInputs();
    const alt = f.calls[0].input._flatpickr.altInput;
    const changes = [];
    const observer = new f.window.MutationObserver(records => changes.push(...records));
    observer.observe(alt, { attributes: true });
    f.window.h2sInitDateInputs();
    await Promise.resolve();
    observer.disconnect();
    assert.equal(changes.length, 0);
  } finally { f.close(); }
});

test('Queue filter participates in the same global styled-select lifecycle', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dash.html'), 'utf8');
  const filter = /<select\s+id="commercialQueueFilter"[\s\S]*?<\/select>/.exec(html)[0];
  assert.doesNotMatch(filter, /data-custom-select="off"/);
  assert.match(controlsSource, /dashboardSyncAllCustomSelects\(document\);\s+h2sInitDateInputs\(document\)/);
  assert.ok(controlsSource.includes('record.removedNodes.forEach(h2sDestroyDetachedDateInputs)'));
});

test('destroyed pickers reinitialize with the original type, value and constraints; moved inputs stay live', () => {
  const f = fixture('<section><input type="datetime-local" value="2099-02-01T09:35" min="2099-01-01T08:00"></section><main></main>');
  try {
    const input = f.window.document.querySelector('input');
    f.window.h2sInitDateInputs();
    const original = input._flatpickr;
    let destroyed = 0;
    original.destroy = () => { destroyed++; original.altInput.remove(); delete original.config; delete original.altInput; };
    f.window.document.querySelector('main').append(input);
    f.window.h2sDestroyDetachedDateInputs(input);
    f.window.h2sInitDateInputs();
    assert.equal(destroyed, 0);
    assert.equal(input._flatpickr, original);
    input.remove();
    f.window.h2sDestroyDetachedDateInputs(input);
    assert.equal(destroyed, 1);
    assert.equal(input._flatpickr, undefined);
    f.window.document.querySelector('main').append(input);
    f.window.h2sInitDateInputs(input);
    assert.equal(f.calls.length, 2);
    assert.equal(input.value, '2099-02-01T09:35');
    assert.equal(input._flatpickr.config.dateFormat, 'Y-m-d\\TH:i');
    assert.equal(input._flatpickr.config.minDate, '2099-01-01T08:00');
    input._flatpickr.altInput.remove();
    input._flatpickr = { destroy() {} };
    f.window.h2sInitDateInputs(input);
    assert.equal(f.calls.length, 3, 'A stale external destroy reference must not suppress reinitialization');
    assert.equal(input._flatpickr.altInput.isConnected, true);
  } finally { f.close(); }
});

test('vendor date-picker styles load before dashboard overrides so popup footer spacing is retained', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dash.html'), 'utf8');
  const vendor = html.indexOf('flatpickr@4.6.13/dist/flatpickr.min.css');
  assert.ok(vendor > 0);
  assert.ok(vendor < html.indexOf('href="/dashboard-design-system.css"'));
  assert.ok(vendor < html.indexOf('data-h2s-app-styles="true"'));
  assert.equal(html.match(/flatpickr@4\.6\.13\/dist\/flatpickr\.min\.css/g).length, 1);
});

test('popup positioning stays within the viewport without reading cross-origin stylesheet rules', () => {
  const f = fixture('<input type=date>');
  try {
    f.window.h2sInitDateInputs();
    const instance = f.calls[0].input._flatpickr;
    const popup = f.window.document.createElement('div');
    Object.defineProperties(popup, { offsetWidth: { value: 308 }, offsetHeight: { value: 380 } });
    instance.calendarContainer = popup;
    instance.altInput.getBoundingClientRect = () => ({ left: 1000, top: 750, bottom: 780 });
    instance.config.position(instance);
    const left = parseFloat(popup.style.left), top = parseFloat(popup.style.top);
    assert.ok(left >= 8 && left + 308 <= f.window.innerWidth - 8);
    assert.ok(top >= 8 && top + 380 <= f.window.innerHeight - 8);
  } finally { f.close(); }
});

test('dynamic popups keep unique accessible IDs when another picker is removed', () => {
  const f = fixture('<input type=date><input type=date>');
  try {
    const ready = call => {
      const instance = call.input._flatpickr;
      instance.calendarContainer = f.window.document.createElement('div');
      instance.calendarContainer.className = 'flatpickr-calendar';
      f.window.document.body.append(instance.calendarContainer);
      call.options.onReady([], '', instance);
      return instance.calendarContainer;
    };
    f.window.h2sInitDateInputs();
    const first = ready(f.calls[0]), second = ready(f.calls[1]);
    first.remove();
    const input = f.window.document.createElement('input');
    input.type = 'date';
    f.window.document.body.append(input);
    f.window.h2sInitDateInputs(input);
    const third = ready(f.calls[2]);
    assert.notEqual(second.id, third.id);
    assert.equal(input._flatpickr.altInput.getAttribute('aria-controls'), third.id);
  } finally { f.close(); }
});

test('shared selects render zero, one and many long-labelled options without changing identities', () => {
  for (const count of [0, 1, 80]) {
    const f = fixture('<label>Customer<select></select></label>');
    try {
      const select = f.window.document.querySelector('select');
      for (let i = 0; i < count; i++) select.add(new f.window.Option(`Customer ${i} with a long household and property description`, `owned-lead-${i}`));
      f.window.dashboardSyncAllCustomSelects();
      const shell = f.window.dashboardGetCustomSelectShell(select);
      assert.equal(shell.querySelectorAll('.dashboard-custom-select-option').length, count);
      assert.equal(Boolean(shell.querySelector('.dashboard-custom-select-empty')), count === 0);
      let changes = 0;
      select.addEventListener('change', () => changes++);
      shell.querySelector('button').click();
      assert.equal(shell.querySelector('[role=listbox]').hidden, false);
      if (count) {
        shell.querySelectorAll('.dashboard-custom-select-option')[count - 1].click();
        assert.equal(select.value, `owned-lead-${count - 1}`);
        assert.equal(changes, count > 1 ? 1 : 0);
        assert.equal(shell.querySelector('[role=listbox]').hidden, true);
      }
    } finally { f.close(); }
  }
});

test('select menu flips and fits available viewport space rather than clipping in its parent', () => {
  const f = fixture('<label>Customer<select><option value=a>Avery</option><option value=t>Taylor</option></select></label>');
  try {
    f.window.innerWidth = 390; f.window.innerHeight = 420;
    f.window.dashboardSyncAllCustomSelects();
    const select = f.window.document.querySelector('select'), shell = f.window.dashboardGetCustomSelectShell(select);
    const trigger = shell.querySelector('button'), menu = shell.querySelector('[role=listbox]');
    trigger.getBoundingClientRect = () => ({ left: 300, top: 330, bottom: 374, width: 300 });
    menu.getBoundingClientRect = () => ({ top: 0, bottom: 0, height: Math.min(180, parseFloat(menu.style.maxHeight) || 240) });
    trigger.click();
    assert.equal(menu.getAttribute('popover'), 'manual');
    assert.equal(parseFloat(menu.style.left), 82);
    assert.equal(parseFloat(menu.style.top), 146);
    assert.ok(parseFloat(menu.style.left) + parseFloat(menu.style.width) <= 382);
    f.window.innerHeight = 120;
    trigger.getBoundingClientRect = () => ({ left: 16, top: 50, bottom: 94, width: 300 });
    f.window.dashboardSetCustomSelectOpen(select, true);
    assert.equal(parseFloat(menu.style.maxHeight), 38);
    assert.equal(parseFloat(menu.style.top), 8);
  } finally { f.close(); }
});

test('shared select keyboard search, focus, scroll boundaries and disabled state remain native-backed', () => {
  const f = fixture('<main><label>Customer<select><option value=t>Taylor</option><option value=a>Avery Chen</option><option value=m>Morgan</option></select></label></main>');
  try {
    f.window.dashboardSyncAllCustomSelects();
    const select = f.window.document.querySelector('select'), shell = f.window.dashboardGetCustomSelectShell(select);
    const trigger = shell.querySelector('button'), menu = shell.querySelector('[role=listbox]');
    const key = value => menu.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: value, bubbles: true }));
    trigger.click(); key('End');
    assert.equal(f.window.document.activeElement.textContent, 'Morgan');
    key('Home');
    assert.equal(f.window.document.activeElement.textContent, 'Taylor');
    key('A'); key('v');
    assert.equal(f.window.document.activeElement.textContent, 'Avery Chen');
    menu.dispatchEvent(new f.window.Event('scroll'));
    assert.equal(menu.hidden, false);
    key('Escape');
    assert.equal(menu.hidden, true);
    assert.equal(f.window.document.activeElement, trigger);
    assert.equal(select.value, 't');
    trigger.click();
    f.window.document.querySelector('main').dispatchEvent(new f.window.Event('scroll'));
    assert.equal(menu.hidden, true);
    select.disabled = true; f.window.dashboardSyncCustomSelect(select);
    f.window.dashboardSetCustomSelectOpen(select, true);
    assert.equal(menu.hidden, true);
  } finally { f.close(); }
});

test('an open menu refits when asynchronous option results replace an empty list', () => {
  const f = fixture('<label>Customer<select></select></label>');
  try {
    f.window.innerWidth = 390; f.window.innerHeight = 420;
    const select = f.window.document.querySelector('select');
    f.window.dashboardSyncCustomSelect(select);
    const shell = f.window.dashboardGetCustomSelectShell(select), trigger = shell.querySelector('button'), menu = shell.querySelector('[role=listbox]');
    trigger.getBoundingClientRect = () => ({ left: 16, top: 330, bottom: 374, width: 300 });
    menu.getBoundingClientRect = () => ({ height: select.options.length ? 180 : 24 });
    trigger.click();
    assert.equal(parseFloat(menu.style.top), 378);
    select.add(new f.window.Option('A long customer result', 'owned-lead'));
    f.window.dashboardSyncCustomSelect(select);
    assert.equal(parseFloat(menu.style.top), 146);
    assert.equal(menu.querySelector('.dashboard-custom-select-empty'), null);
    assert.equal(select.value, 'owned-lead');
  } finally { f.close(); }
});
