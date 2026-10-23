const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dash.js'), 'utf8');

function fixture(html) {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const { window } = dom;
  const block = source.slice(source.indexOf('        function h2sDispatchDateInputEvents('),
    source.indexOf('        function taskCreatorOpenDueField('));
  window.eval(block);
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
  assert.match(source, /dashboardSyncAllCustomSelects\(document\);\s+h2sInitDateInputs\(document\)/);
  assert.match(source, /removed\.forEach\(input => \{ if \(input\._flatpickr\) input\._flatpickr\.destroy\(\)/);
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
