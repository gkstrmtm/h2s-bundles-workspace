const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('jsdom'), crypto = require('node:crypto');
const script = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'field-sales.js'), 'utf8');
const service = { service_id: 'future_fixture', version: 3, enabled: true, definition: { label: 'Future configurable service',
  queueLabel: 'Fixture interest', markets: ['residential','commercial'], photos: ['Fixture location'],
  questions: [{ id: 'quantity', label: 'Fixture quantity', type: 'number', required: true, min: 1, max: 10 },
    { id: 'equipment', label: 'Equipment preference', type: 'select', required: false, options: ['Customer equipment','Review needed'] }] } };
const lead = '00000000-0000-4000-8000-000000000001';
function fixture(t, role = 'SALES') {
  const dom = new JSDOM('<div id="h2s-app"><div class="app-topbar"></div><div class="app-sidebar-group" data-group-id="admin"><div class="app-sidebar-group-items"><button class="app-sidebar-nav-item">Staff only</button></div></div><div class="app-content"><section class="pane active">Staff pane</section></div></div><span id="currentAreaTitle"></span>',
    { runScripts: 'outside-only', url: 'https://fixture.invalid' });
  t.after(() => dom.window.close());
  const w = dom.window, calls = [], revoked = [];
  let actor = { token: 'h2s-sales:fixture', role }, response;
  const listing = { ok: true, enabled: true, services: [service], representatives: [{ user_id: 'rep', display_name: 'Fixture rep', username: 'SALESFIXTURE', active: true }],
    opportunities: [{ lead_id: lead, full_name: '<img src=x onerror=alert(1)>', phone: '+15555550100', address: 'Fixture property', market: 'residential',
      owner_user_id: 'rep', status: 'assessing', services: ['future_fixture'], follow_up_at: '2020-01-01T00:00:00Z' }], total: 1 };
  const detail = { ok: true, lead: { full_name: 'Synthetic customer', phone: '+15555550100', project_address: 'Fixture property', project_city: 'Fixture City', attribution: { market: 'residential' } },
    opportunity: { lead_id: lead, revision: 2, owner_user_id: 'rep', status: 'assessing', services: ['future_fixture'],
      assessments: { future_fixture: { version: 3, answers: { quantity: 2 } } }, notes: '', photo_consent: true, consent_note: 'Synthetic explicit permission' },
    history: [], photos: [{ file_id: 'photo-fixture', service_id: 'future_fixture', label: 'Fixture location', state: 'ready' }], followUpAt: null };
  w.crypto.randomUUID = crypto.randomUUID;
  w.console.error = () => {};
  w.URL.createObjectURL = () => 'blob:fixture'; w.URL.revokeObjectURL = url => revoked.push(url);
  w.fetch = async (url, init) => {
    calls.push({ url, init, body: init.body && JSON.parse(init.body) });
    if (response) return response(url, init);
    return Response.json(init.method === 'POST' ? { ok: true, leadId: lead } : url.includes('?leadId=') ? detail : listing);
  };
  w.eval(script);
  let loggedOut = false;
  w.H2SFieldSales.configure({ apiBase: 'https://fixture.invalid', getSession: () => actor, onLogout: () => { loggedOut = true; w.H2SFieldSales.reset(); } });
  const click = selector => { const target = w.document.querySelector(selector); assert.ok(target, selector); target.click(); };
  return { w, calls, revoked, listing, detail, click, setActor: value => { actor = value; }, respond: fn => { response = fn; }, get loggedOut() { return loggedOut; } };
}
const settle = async () => { for (let n = 0; n < 5; n++) await new Promise(resolve => setImmediate(resolve)); };
test('SALES mobile enclave, assigned worklist, generic configured assessment, escaped identity and draft payload', async t => {
  const f = fixture(t); f.w.H2SFieldSales.activate(); await settle();
  assert.equal(f.w.document.getElementById('h2s-app').dataset.fieldSales, 'true');
  assert.equal(f.w.document.querySelector('.app-sidebar-nav-item').hidden, true);
  assert.equal(f.w.document.querySelector('[data-sales-list] img'), null, 'Untrusted customer name is text');
  const due=[...f.w.document.querySelectorAll('.field-sales__metric')].find(el=>el.querySelector('span').textContent==='Follow-ups due');
  assert.ok(due);assert.equal(due.querySelector('strong').textContent,'1');
  assert.equal(f.w.document.querySelector('.field-sales__management-nav'),null,'SALES has no management destinations');
  f.click('[data-sales-lead]'); await settle();
  assert.equal(f.w.document.querySelector('[data-question="quantity"]').value, '2');
  assert.equal(f.w.document.querySelector('[data-sales-questions] legend').textContent,'Future configurable service');
  assert.equal(f.w.document.querySelector('[data-question="quantity"]').min,'1');
  assert.equal(f.w.document.querySelector('[data-question="quantity"]').max,'10');
  assert.deepEqual([...f.w.document.querySelector('[data-question="equipment"]').options].map(option=>option.textContent),['Choose','Customer equipment','Review needed']);
  assert.doesNotMatch(f.w.document.querySelector('[data-sales-questions]').textContent,/definition v3|future_fixture/);
  assert.match(f.w.document.querySelector('[data-sales-content]').textContent, /Assessment progress: 1\/1 required answers/);
  f.w.document.querySelector('[data-question="quantity"]').value = '4';
  const form = f.w.document.querySelector('[data-sales-form="save"]');
  form.dispatchEvent(new f.w.SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: form.querySelector('button') }));
  await settle();
  const body = f.calls.find(call => call.body?.action === 'save').body;
  assert.equal(body.answers.future_fixture.quantity, 4); assert.equal(body.revision, 2); assert.equal(body.photoConsent, true); assert.equal(body.submit, false);
  assert.deepEqual(body.services, ['future_fixture']); assert.equal(body.followUpAt, null);
  f.click('[data-sales-logout]'); assert.equal(f.loggedOut, true); assert.equal(f.w.document.querySelector('[data-sales-content]'), null);
});
test('ADMIN oversight/reps/exact inquiry attach; VA cannot read; default-off is explicit', async t => {
  const f = fixture(t, 'ADMIN'); f.w.H2SFieldSales.open(); await settle();
  assert.equal(f.w.document.querySelector('[data-sales-content] h3').textContent,'Sales overview');
  const owners=f.w.document.querySelector('[data-sales-owner]');
  assert.ok(owners);assert.equal(owners.options[0].textContent,'All representatives');
  assert.equal(owners.options[1].value,'rep');assert.equal(owners.options[1].textContent,'Fixture rep');
  assert.ok(f.w.document.querySelector('[data-sales-mode="representatives"]'),'ADMIN retains representative oversight');
  f.click('[data-sales-mode="new"]'); await settle(); assert.ok(f.w.document.querySelector('[data-sales-form="attach"]'));
  f.click('[data-sales-mode="representatives"]'); await settle();
  assert.ok(f.w.document.querySelector('[data-sales-form="account_create"]')); assert.ok(f.w.document.querySelector('[data-rep-state]'));
  f.w.H2SFieldSales.reset(); f.setActor({ token: 'va', role: 'VA' }); const count = f.calls.length;
  f.w.H2SFieldSales.open(); await settle(); assert.equal(f.calls.length, count);
  f.setActor({ token: 'admin', role: 'ADMIN' }); f.respond(async () => Response.json({ ok: true, enabled: false }));
  f.w.H2SFieldSales.open(); await settle(); assert.match(f.w.document.querySelector('[data-sales-status]').textContent, /disabled/);
});
test('configured future-service cards and ADMIN linking/terms remain accessible primary workflows', async t => {
  const f = fixture(t, 'ADMIN'); await f.w.H2SFieldSales.navigate('new'); await settle();
  const card = f.w.document.querySelector('.field-sales__service');
  assert.equal(card.tagName, 'LABEL');
  assert.equal(card.querySelector('input').getAttribute('aria-label'), 'Future configurable service');
  assert.match(card.querySelector('small').textContent, /Fixture quantity.*Equipment preference/);
  assert.doesNotMatch(card.textContent, /Popular service|Select to assess/);
  const attach = f.w.document.querySelector('[data-sales-form="attach"]');
  assert.equal(attach.closest('details'), null);
  assert.ok(attach.closest('section[aria-label="Link existing inquiry"]'));
  f.click('[data-sales-mode="representatives"]'); await settle();
  const terms = f.w.document.querySelector('[data-sales-form="representative_terms"]');
  assert.equal(terms.closest('details'), null);
  assert.equal(terms.elements.userId.value, 'rep');
  assert.equal(terms.elements.termsRevision.value, '0');
  assert.equal(terms.elements.commissionStartEvidence.required, true);
});
test('assessment DOM draft survives navigation without transferring across the same-token role boundary', async t => {
  const f = fixture(t, 'ADMIN'); await f.w.H2SFieldSales.navigate('assessment', lead); await settle();
  const form = f.w.document.querySelector('[data-sales-form="save"]');
  form.querySelector('[data-question="quantity"]').value = '7'; form.elements.notes.value = 'Private unsaved admin note';
  const checkbox = form.querySelector('[name="services"]');
  checkbox.checked = false; checkbox.dispatchEvent(new f.w.Event('change', { bubbles: true }));
  checkbox.checked = true; checkbox.dispatchEvent(new f.w.Event('change', { bubbles: true }));
  assert.equal(form.querySelector('[data-question="quantity"]').value, '7');
  await f.w.H2SFieldSales.navigate('home'); await f.w.H2SFieldSales.navigate('assessment', lead); await settle();
  assert.equal(f.w.document.querySelector('[data-sales-form="save"]'), form);
  assert.equal(form.elements.notes.value, 'Private unsaved admin note');
  f.setActor({ token: 'h2s-sales:fixture', role: 'SALES' });
  await f.w.H2SFieldSales.navigate('assessment', lead); await settle();
  assert.notEqual(f.w.document.querySelector('[data-sales-form="save"]'), form);
  assert.doesNotMatch(f.w.document.querySelector('#field-sales-pane').textContent, /Private unsaved admin note|Identity & ownership audit/);
  assert.equal(f.w.document.querySelector('[data-sales-form="assign"]'), null);
});
test('uncertain save retains exact operation and payload on retry; malformed/offline responses are explicit', async t => {
  const f = fixture(t); f.w.H2SFieldSales.open(); await settle(); f.click('[data-sales-lead]'); await settle();
  f.respond(async () => { throw Error('Synthetic connection loss'); });
  const submit = () => { const form = f.w.document.querySelector('[data-sales-form="save"]'); form.dispatchEvent(new f.w.SubmitEvent('submit', { bubbles: true, cancelable: true })); };
  submit(); await settle(); const first = f.calls.at(-1).body;
  assert.match(f.w.document.querySelector('[role="alert"]').textContent, /connection loss/);
  f.w.document.querySelector('[name="notes"]').value = 'Changed locally after uncertain outcome';
  submit(); await settle(); assert.deepEqual(f.calls.at(-1).body, first);
});
test('late JSON and private photo blobs are discarded after session reset or account change', async t => {
  const f = fixture(t);
  let complete;
  f.respond(async () => ({ status: 200, ok: true, json: () => new Promise(resolve => { complete = resolve; }) }));
  f.w.H2SFieldSales.open(); await settle(); f.w.H2SFieldSales.reset(); f.setActor({ token: 'other', role: 'SALES' });
  complete(f.listing); await settle(); assert.equal(f.w.document.querySelector('[data-sales-list]'), null);
  f.respond(null); f.w.H2SFieldSales.open(); await settle(); f.click('[data-sales-lead]'); await settle();
  f.respond(async () => ({ status: 200, ok: true, blob: () => new Promise(resolve => { complete = resolve; }) }));
  f.click('[data-sales-photo]'); await settle(); f.w.H2SFieldSales.reset(); f.setActor({ token: 'third', role: 'SALES' });
  complete(new Blob(['synthetic'], { type: 'image/jpeg' })); await settle();
  assert.equal(f.w.document.querySelector('#field-sales-pane img'), null);
});
test('private viewing revokes object URLs; access loss clears records and announces failure', async t => {
  const f = fixture(t); f.w.H2SFieldSales.open(); await settle(); f.click('[data-sales-lead]'); await settle();
  f.respond(async () => new Response(new Blob(['synthetic'], { type: 'image/jpeg' })));
  f.click('[data-sales-photo]'); await settle(); assert.ok(f.w.document.querySelector('#field-sales-pane img'));
  f.w.H2SFieldSales.reset(); assert.deepEqual(f.revoked, ['blob:fixture']);
  f.respond(async () => new Response(null, { status: 403 })); f.w.H2SFieldSales.open(); await settle();
  assert.equal(f.w.document.querySelector('[data-sales-list]'), null);
  assert.match(f.w.document.querySelector('[role="alert"]').textContent, /Access ended/);
});
test('real dashboard SALES startup clears old ADMIN credentials, skips staff initialization and fails closed on missing module/storage failure', () => {
  const ts = require('typescript'), vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dash.js'), 'utf8');
  const ast = ts.createSourceFile('dash.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let branch;
  const walk = node => {
    if (ts.isIfStatement(node) && node.expression.getText(ast) === "currentRole === 'SALES'" && node.thenStatement.getText(ast).includes('userGate')) branch = node.getText(ast);
    ts.forEachChild(node, walk);
  };
  walk(ast); assert.ok(branch, 'Use actual startup branch, not a copied implementation');
  for (const scenario of ['sales','missing','storage','va']) {
    const calls = [], gate = { classList: { remove: value => calls.push(value) }, style: {} };
    const context = { currentRole: scenario === 'va' ? 'VA' : 'SALES', verifiedLegacyAdminKey: 'synthetic-old-proof',
      ADMIN_CREDENTIAL_KEY: 'h2s_proof_admin_key', window: { H2SFieldSales: scenario === 'missing' ? undefined : { activate: () => calls.push('activate') } },
      localStorage: { removeItem: key => { assert.equal(key, 'h2s_proof_admin_key'); if (scenario === 'storage') throw Error('Synthetic storage fault'); calls.push('removed-proof'); } },
      document: { querySelectorAll: () => [], getElementById: () => gate },
      setDashboardSessionToken: value => calls.push('token:' + value), showToast: (_message, type) => calls.push(type),
      console: { error() {} }, staffStarts: 0 };
    vm.runInNewContext(`(()=>{${branch};staffStarts++;})()`, context);
    assert.equal(context.staffStarts, scenario === 'va' ? 1 : 0);
    assert.equal(calls.includes('activate'), scenario === 'sales');
    if (['missing','storage'].includes(scenario)) { assert.ok(calls.includes('token:')); assert.ok(calls.includes('error')); }
    if (scenario !== 'va') assert.equal(context.verifiedLegacyAdminKey, '');
  }
});
