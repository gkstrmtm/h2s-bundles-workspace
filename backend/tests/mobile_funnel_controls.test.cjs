const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { JSDOM } = require('jsdom');
const frontend = path.resolve(__dirname, '..', '..', 'frontend');
const source = file => fs.readFileSync(path.join(frontend, file), 'utf8');
async function waitFor(condition) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise(setImmediate);
  }
  assert.fail('Mobile control did not reach the expected state');
}

test('shared popup fits a narrow viewport and follows the keyboard without reading stylesheet rules', () => {
  const dom = new JSDOM('<input><div></div>', { runScripts: 'outside-only' });
  try {
    const w = dom.window, popup = w.document.querySelector('div'), input = w.document.querySelector('input');
    Object.defineProperties(w, { innerWidth: { value: 320 }, innerHeight: { value: 667 } });
    Object.defineProperty(w.document, 'styleSheets', { get() { throw new Error('Cross-origin stylesheet'); } });
    const viewport = new w.EventTarget();
    Object.assign(viewport, { width: 320, height: 667, offsetLeft: 0, offsetTop: 0 });
    Object.defineProperty(w, 'visualViewport', { value: viewport });
    let reads = 0;
    input.getBoundingClientRect = () => { reads++; return { left: 270, top: 620, bottom: 664 }; };
    Object.defineProperties(popup, {
      offsetWidth: { get: () => Math.min(304, parseFloat(popup.style.maxWidth) || Infinity) },
      offsetHeight: { get: () => Math.min(380, parseFloat(popup.style.maxHeight) || Infinity) },
    });
    w.eval(source('date-popup.js'));
    const options = w.h2sDatePopupOptions, instance = { input, calendarContainer: popup };
    options.position(instance);
    assert.equal(parseFloat(popup.style.left), 8);
    assert.ok(parseFloat(popup.style.top) + popup.offsetHeight <= 659);
    options.onOpen([], '', instance);
    options.onOpen([], '', instance);
    reads = 0;
    Object.assign(viewport, { height: 240, offsetTop: 200 });
    viewport.dispatchEvent(new w.Event('resize'));
    assert.equal(reads, 1, 'Repeated opening must not duplicate viewport listeners');
    assert.equal(popup.style.maxHeight, '224px');
    assert.equal(popup.style.overflowY, 'auto');
    assert.equal(parseFloat(popup.style.top), 208);
    const top = popup.style.top;
    options.onClose([], '', instance);
    viewport.offsetTop = 100;
    viewport.dispatchEvent(new w.Event('scroll'));
    assert.equal(popup.style.top, top);
    options.onOpen([], '', instance);
    options.onDestroy([], '', instance);
    w.dispatchEvent(new w.Event('resize'));
    assert.equal(popup.style.top, top);
  } finally { dom.window.close(); }
});

test('both residential pages load shared popup logic and vendor CSS before application overrides', () => {
  for (const page of ['residential.html', 'residential-review.html']) {
    const html = source(page);
    assert.ok(html.indexOf('/date-popup.js') < html.indexOf(page === 'residential.html' ? '/residential.js' : '/residential-workspace.js'));
    assert.ok(html.indexOf('flatpickr.min.css') < html.indexOf('/dash.css'));
  }
  const dashboard = source('dash.html');
  assert.ok(dashboard.indexOf("'date-popup.js'") < dashboard.indexOf("'commercial-calendar.js'"));
  const portal = source('portal.html');
  assert.ok(portal.indexOf('/date-popup.js') < portal.indexOf('src="/dash.PORTAL_BUILD_'));
});
test('shared date popup positions relative to a modal and follows its scrolling content', () => {
  const dom=new JSDOM('<dialog><input><div></div></dialog>',{runScripts:'outside-only'});
  try {
    const w=dom.window,parent=w.document.querySelector('dialog'),input=parent.querySelector('input'),popup=parent.querySelector('div');
    Object.defineProperties(w,{innerWidth:{value:320},innerHeight:{value:667}});
    parent.getBoundingClientRect=()=>({left:20,top:100});
    parent.scrollTop=50;
    Object.defineProperties(parent,{clientLeft:{value:1},clientTop:{value:1}});
    let reads=0;
    input.getBoundingClientRect=()=>{reads++;return {left:32,top:160,bottom:204};};
    Object.defineProperties(popup,{offsetParent:{value:parent},offsetWidth:{value:280},offsetHeight:{value:360}});
    w.eval(source('date-popup.js'));
    const instance={input,calendarContainer:popup},options=w.h2sDatePopupOptions;
    options.position(instance);
    assert.equal(popup.style.left,'11px');assert.equal(popup.style.top,'161px');
    options.onOpen([],'',instance);reads=0;
    parent.dispatchEvent(new w.Event('scroll'));
    assert.equal(reads,1);
    options.onDestroy([],'',instance);
  } finally {dom.window.close();}
});
test('production residential pages do not contain local preview navigation or fixture credentials', () => {
  for(const name of ['residential.html','residential-review.html','residential.js','residential-review.js','residential-workspace.js','residential.css']) {
    assert.doesNotMatch(source(name),/PreviewOwner|LOCAL DEMO|Saved owner workspace|New inquiry review|data-local-preview-toolbar/);
  }
});

function review(fetch) {
  const dom = new JSDOM(source('commercial-approval.html'), {
    url: 'https://example.invalid/commercial-approval?token=fake-mobile-token&action=approve', runScripts: 'outside-only',
  });
  dom.window.fetch = fetch;
  dom.window.eval(source('commercial-approval.js'));
  return { dom, get: id => dom.window.document.getElementById(id), close: () => dom.window.close() };
}
const context = status => ({ ok: true, consultation: { referenceCode: 'COM-MOBILE', status }, lead: { companyName: 'Mobile Fixture' } });

test('commercial approval blocks double taps and locks a completed decision', async () => {
  let posts = 0, finish;
  const f = review(async (_, options) => {
    if (options.method !== 'POST') return Response.json(context('pending'));
    posts++;
    return new Promise(resolve => { finish = resolve; });
  });
  try {
    await waitFor(() => f.get('approvalMessage').textContent.startsWith('Ready to '));
    f.get('approvalNote').value = 'Mobile review';
    f.get('approveBtn').click(); f.get('approveBtn').click(); f.get('declineBtn').click();
    assert.equal(posts, 1);
    assert.equal(f.get('approvalNote').disabled, true);
    finish(Response.json({ ...context('approved'), appointment: { ok: true }, notifications: { customer: { ok: true } } }));
    await waitFor(() => f.get('approvalMessage').textContent.startsWith('Appointment exists.'));
    assert.equal(f.get('approveBtn').disabled, true);
    assert.equal(f.get('declineBtn').disabled, true);
    assert.equal(f.get('approvalNote').value, 'Mobile review');
  } finally { f.close(); }
});

test('an interrupted commercial decision exposes uncertainty instead of allowing an opposing decision', async () => {
  const f = review(async (_, options) => {
    if (options.method === 'POST') throw new TypeError('Fixture connection lost');
    return Response.json(context('pending'));
  });
  try {
    await waitFor(() => f.get('approvalMessage').textContent.startsWith('Ready to '));
    f.get('approveBtn').click();
    await waitFor(() => f.get('approvalMessage').textContent.includes('may have been saved'));
    assert.match(f.get('approvalMessage').textContent, /Reload this link to check its status/);
    assert.equal(f.get('approvalMessage').getAttribute('data-tone'), 'error');
    assert.equal(f.get('approveBtn').disabled, true);
    assert.equal(f.get('declineBtn').disabled, true);
  } finally { f.close(); }
});

test('commercial load failure is explicit and reopening an approved link cannot reverse its decision', async () => {
  for (const terminal of [false, true]) {
    const f = review(async () => {
      if (!terminal) throw new TypeError('Fixture offline');
      return Response.json(context('approved'));
    });
    try {
      await waitFor(() => /Could not load|no longer awaiting/.test(f.get('approvalMessage').textContent));
      assert.equal(f.get('approveBtn').disabled, true);
      assert.equal(f.get('declineBtn').disabled, true);
      assert.doesNotMatch(f.get('approvalMessage').textContent, /Ready to approve/);
    } finally { f.close(); }
  }
});
