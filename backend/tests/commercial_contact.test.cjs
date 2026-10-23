const test = require('node:test');
const assert = require('node:assert/strict');
const { createFixture, queuePage } = require('./helpers/commercial_contact_fixture.cjs');
const { validateCommercialContact, buildSlotSuggestions } = require('../lib/commercial_consultation.js');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { JSDOM, VirtualConsole } = require('jsdom');

const suggested = buildSlotSuggestions()[0];
const slot = { selectedSlotStart: suggested.startIso, selectedSlotEnd: suggested.endIso };
const contact = (method, patch = {}) => ({
  fullName: 'Fixture Contact', companyName: 'Fixture Project', contactPreference: method,
  email: method === 'email' ? 'fixture@example.invalid' : '', phone: method === 'email' ? '' : '+15550000005',
  smsOptIn: method === 'sms', serviceNeeds: ['Security Cameras'], ...patch,
});
async function save(fixture, payload) {
  const response = await fixture.post('commercial-intake', payload);
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  return (await response.json()).lead;
}

test('email-only and call-first save one lead and submit actionable manual requests without customer texts or appointments', async t => {
  for (const method of ['email', 'call']) await t.test(method, async () => {
    const f = createFixture();
    const lead = await save(f, contact(method, { notes: 'Retain this project detail' }));
    const draftQueue = await f.queue();
    assert.equal(draftQueue.queue[0].followUp.submitted, false);
    assert.match(draftQueue.queue[0].followUp.statusLabel, /draft.*not submitted/i);
    const update = await f.post('commercial-intake', contact(method, { publicToken: lead.publicToken, revision: lead.revision, notes: 'Retain this project detail' }));
    assert.equal(update.status, 200);
    const response = await f.post('commercial-consultation', { publicToken: lead.publicToken, ...slot, assignedTechnicianPhone: '+15550000099' });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.consultation.metadata.request_kind, 'manual_follow_up');
    assert.equal(result.consultation.metadata.contact_preference, method);
    assert.ok(Number.isFinite(Date.parse(result.consultation.metadata.submitted_at)));
    assert.equal(result.consultation.nextReminderAt, null);
    assert.equal(result.notifications.customer.skipped, true);
    assert.equal(result.notifications.manualReviewRequired, true);
    assert.equal(f.tables.commercial_leads.length, 1);
    assert.equal(f.tables.commercial_leads[0].notes, 'Retain this project detail');
    assert.equal(f.tables.commercial_leads[0].contact_preference, method);
    assert.equal(f.tables.commercial_leads[0].email, method === 'email' ? 'fixture@example.invalid' : null);
    assert.deepEqual(f.sms.map(message => message.to), ['+15550000001']);
    assert.ok(!f.sms[0].body.includes('commercial-approval'));
    assert.equal(f.appointments.length, 0);
    const queued = (await f.queue()).queue[0];
    assert.equal(queued.followUp.submitted, true);
    assert.equal(queued.followUp.requestedContactMethod, method);
    assert.equal(queued.contactPreference, method);
    assert.equal(queued.email, method === 'email' ? 'fixture@example.invalid' : '');
    assert.equal(queued.consultation.selectedSlotStart, slot.selectedSlotStart);
    assert.match(queued.followUp.nextAction, method === 'email' ? /Manually email fixture@example.invalid/ : /Manually call \+15550000005/);
    assert.match(queued.followUp.nextAction, /not a confirmed appointment/);
    const reload = await f.route('commercial-intake').GET(new Request(`http://localhost/api/commercial-intake?token=${lead.publicToken}`));
    const reloaded = await reload.json();
    assert.equal(reloaded.lead.publicToken, lead.publicToken);
    assert.equal(reloaded.lead.contactPreference, method);
    assert.equal(reloaded.lead.email, method === 'email' ? 'fixture@example.invalid' : null);
    assert.equal(reloaded.submission.requestId, result.consultation.requestId);
    const duplicate = await f.post('commercial-consultation', { publicToken: lead.publicToken, ...slot });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).consultation.requestId, result.consultation.requestId);
    assert.equal(f.tables.commercial_consultation_requests.length, 1);
    assert.equal(f.sms.length, 1, 'Reload and replay must not send another staff alert');
  });
});

test('Email-first routes only manual staff alerts, preserves normalized email and refuses technician automation', async () => {
  const f = createFixture({ COMMERCIAL_CONSULTATION_TECH_PHONES: '+15550000001,+15550000003' });
  const lead = await save(f, contact('email', { email:' Email.Fixture@Example.invalid ',phone:'+15550000005',smsOptIn:true }));
  assert.equal(lead.email, 'email.fixture@example.invalid');
  assert.equal(lead.contactPreference, 'email');
  const response = await f.post('commercial-consultation', { publicToken:lead.publicToken,assignedTechnicianPhone:'+15550000005' });
  assert.equal(response.status, 201);
  const data = await response.json(), request = f.tables.commercial_consultation_requests[0];
  assert.equal(data.notifications.customer.skipped, true);
  assert.equal(data.notifications.manualReviewRequired, true);
  assert.equal(request.next_reminder_at, null);
  assert.deepEqual(f.sms.map(message => message.to), ['+15550000001','+15550000003']);
  for (const message of f.sms) {
    assert.match(message.body, /manual follow-up.*Contact by email: email\.fixture@example\.invalid/);
    assert.doesNotMatch(message.body, /commercial-approval|reply YES|reply NO/i);
  }
  request.next_reminder_at = '2000-01-01T00:00:00.000Z';
  for (let run = 0; run < 2; run++) {
    const maintenance = await f.route('commercial-consultation-maintenance').GET(new Request('http://localhost/api/commercial-consultation-maintenance', {
      headers:{ Authorization:'Bearer fixture-only-cron-secret' },
    }));
    assert.equal(maintenance.status, 200);
    assert.deepEqual((await maintenance.json()).processed, []);
  }
  const storedLead = f.tables.commercial_leads[0];
  for (const decision of ['approve','decline']) {
    const result = await f.runtime.applyConsultationDecision({ request:new Request('http://localhost/approval'),consultation:request,
      lead:storedLead,action:decision,channel:'web' });
    assert.equal(result.ok, false);
    assert.match(result.error, /manual customer follow-up/);
  }
  assert.equal(storedLead.contact_preference, 'email');
  assert.equal(storedLead.email, lead.email);
  assert.equal(f.sms.length, 2);
  assert.equal(f.appointments.length, 0);
});

test('manual follow-up can be submitted without a preferred window', async () => {
  const f = createFixture();
  const lead = await save(f, contact('email'));
  const response = await f.post('commercial-consultation', { publicToken: lead.publicToken });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).consultation.selectedSlotStart, null);
});

test('manual preference wins even when an optional phone and prior text permission are present', async () => {
  for (const method of ['email', 'call']) {
    const f = createFixture();
    const lead = await save(f, contact(method, { phone: '+15550000005', smsOptIn: true }));
    const response = await f.post('commercial-consultation', { publicToken: lead.publicToken, ...slot });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).notifications.customer.skipped, true);
    assert.deepEqual(f.sms.map(message => message.to), ['+15550000001']);
    const request = f.tables.commercial_consultation_requests[0];
    request.next_reminder_at = '2000-01-01T00:00:00.000Z';
    const maintenance = await f.route('commercial-consultation-maintenance').GET(new Request('http://localhost/api/commercial-consultation-maintenance', {
      headers: { Authorization: 'Bearer fixture-only-cron-secret' },
    }));
    assert.equal(maintenance.status, 200);
    assert.equal(f.sms.length, 1);
    assert.equal(f.appointments.length, 0);
  }
});

test('chosen contact rules reject missing, malformed, unsupported and nonexplicit consent inputs', async () => {
  for (const payload of [
    contact('email', { email: '' }), contact('email', { email: 'broken@' }),
    contact('call', { phone: '' }), contact('call', { phone: '123' }),
    contact('sms', { phone: '' }), contact('sms', { smsOptIn: false }),
    contact('sms', { smsOptIn: 'true' }), contact('call', { email: 'broken@' }),
    contact('email', { phone: 'invalid' }), contact('unsupported'),
  ]) {
    const f = createFixture();
    assert.ok(validateCommercialContact(payload));
    const response = await f.post('commercial-intake', payload);
    assert.equal(response.status, 400);
    assert.ok((await response.json()).field);
    assert.equal(f.tables.commercial_leads.length, 0);
    assert.equal(f.sms.length, 0);
  }
});

test('consultation API revalidates saved contact details and cannot be bypassed with request-body consent', async () => {
  for (const method of ['email', 'call', 'sms']) {
    const f = createFixture();
    const lead = await save(f, contact(method));
    if (method === 'email') f.tables.commercial_leads[0].email = '';
    else if (method === 'call') f.tables.commercial_leads[0].phone = '';
    else f.tables.commercial_leads[0].attribution.communicationConsent.smsOptIn = false;
    const response = await f.post('commercial-consultation', { publicToken: lead.publicToken, smsOptIn: true, ...slot });
    assert.equal(response.status, 400);
    assert.equal(f.tables.commercial_consultation_requests.length, 0);
    assert.equal(f.sms.length, 0);
  }
});

test('consented text-first sends customer texts; manual and unconsented approval paths cannot schedule or text', async () => {
  const f = createFixture();
  const lead = await save(f, contact('sms', { email: 'fixture@example.invalid' }));
  const response = await f.post('commercial-consultation', { publicToken: lead.publicToken, ...slot });
  assert.equal(response.status, 201);
  assert.deepEqual(f.sms.map(message => message.to), ['+15550000001', '+15550000005']);
  const request = f.tables.commercial_consultation_requests[0];
  const storedLead = f.tables.commercial_leads[0];
  for (const method of ['email', 'call']) {
    storedLead.contact_preference = method;
    const before = f.sms.length;
    assert.equal((await f.runtime.sendCustomerPendingAcknowledgement(request, storedLead)).skipped, true);
    for (const action of ['approve', 'decline']) {
      const decision = await f.runtime.applyConsultationDecision({ request: new Request('http://localhost/approval'), consultation: request, lead: storedLead, action, channel: 'web' });
      assert.equal(decision.ok, false);
      assert.match(decision.error, /manual customer follow-up/);
    }
    assert.equal(f.sms.length, before);
    assert.equal(f.appointments.length, 0);
  }
  storedLead.contact_preference = 'sms';
  storedLead.attribution.communicationConsent.smsOptIn = false;
  assert.equal((await f.runtime.sendCustomerPendingAcknowledgement(request, storedLead)).skipped, true);
  const denied = await f.runtime.applyConsultationDecision({ request: new Request('http://localhost/approval'), consultation: request, lead: storedLead, action: 'approve', channel: 'web' });
  assert.equal(denied.ok, false);
  assert.equal(f.appointments.length, 0);
  storedLead.attribution.communicationConsent.smsOptIn = true;
  const approved = await f.runtime.applyConsultationDecision({ request: new Request('http://localhost/approval'), consultation: request, lead: storedLead, action: 'approve', channel: 'web' });
  assert.equal(approved.ok, true);
  assert.equal(f.appointments.length, 1);
});

test('legacy saved leads load without manufacturing consent or submission status', async () => {
  const f = createFixture();
  f.tables.commercial_leads.push({ lead_id: 'legacy', public_token: 'legacy-token', contact_preference: 'email', email: 'legacy@example.invalid', phone: null, attribution: {} });
  const response = await f.route('commercial-intake').GET(new Request('http://localhost/api/commercial-intake?token=legacy-token'));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.lead.email, 'legacy@example.invalid');
  assert.equal(payload.submission, null);
  assert.deepEqual(payload.lead.attribution, {});
});

test('frontend and server enforce the same chosen-contact rules', () => {
  const filename = path.resolve(__dirname, '..', '..', 'frontend', 'commercial.js');
  const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const names = ['normalizePhoneDigits', 'hasMessagingConsent', 'requiresMessagingConsent', 'validateContact'];
  const functions = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) functions.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(functions.length, names.length);
  const frontend = vm.runInNewContext(`${functions.join('\n')}\nvalidateContact`);
  for (const payload of [
    contact('email'), contact('call'), contact('sms'),
    contact('email', { email: '' }), contact('email', { email: 'broken@' }),
    contact('sms', { smsOptIn: false }), contact('sms', { smsOptIn: 'true' }),
    contact('sms', { phone: '123' }), contact('call', { phone: '' }),
    contact('email', { phone: 'invalid' }), contact('sms', { phone: '+442012345678' }),
    contact('call', { email: 'broken@' }), contact('unsupported'),
  ]) {
    assert.equal(JSON.stringify(frontend(payload)), JSON.stringify(validateCommercialContact(payload)));
  }
});

test('actual queue widget renders contact method, pending window and manual action from the queue projection', async () => {
  const f = createFixture();
  const lead = await save(f, contact('email', { phone: '+15550000005' }));
  await f.post('commercial-consultation', { publicToken: lead.publicToken, ...slot });
  const errors = [];
  const console = new VirtualConsole();
  console.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(queuePage(), {
    url: 'http://localhost:3002/api/_fixture/queue', runScripts: 'dangerously', virtualConsole: console,
    beforeParse(window) {
      window.fetch = async () => ({ ok: true, json: async () => ({ ok: true, commercialQueue: await f.queue() }) });
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.deepEqual(errors, []);
    const detail = dom.window.document.querySelector('#commercialQueueDetail').textContent;
    assert.match(detail, /Email first \(manual\)/);
    assert.match(detail, /Manually email fixture@example.invalid/);
    assert.match(detail, /Preferred window pending manual review/);
    assert.match(detail, /No appointment is confirmed/);
    assert.ok(detail.includes('fixture@example.invalid'));
    const call = await save(f, contact('call'));
    await f.post('commercial-consultation', { publicToken: call.publicToken });
    await dom.window.commercialQueueUI.refresh();
    dom.window.commercialQueueUI.selectLead(call.leadId);
    const callDetail = dom.window.document.querySelector('#commercialQueueDetail').textContent;
    assert.match(callDetail, /No preferred window selected/);
    assert.match(callDetail, /No appointment is confirmed/);
    assert.doesNotMatch(callDetail, /Preferred window pending manual review/);
    const draft = await save(f, contact('email', { fullName: 'Draft fixture' }));
    await dom.window.commercialQueueUI.refresh();
    dom.window.commercialQueueUI.selectLead(draft.leadId);
    const draftDetail = dom.window.document.querySelector('#commercialQueueDetail').textContent;
    assert.match(draftDetail, /Saved draft - not submitted/);
    assert.doesNotMatch(draftDetail, /Preferred window pending manual review/);
  } finally { dom.window.close(); }
});

test('manual request tokens cannot approve or directly create an appointment', async () => {
  const f = createFixture();
  const lead = await save(f, contact('email'));
  await f.post('commercial-consultation', { publicToken: lead.publicToken, ...slot });
  const request = f.tables.commercial_consultation_requests[0];
  const before = f.sms.length;
  for (const action of ['approve', 'decline']) {
    const response = await f.post('commercial-consultation-response', { token: request.response_token, action });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /manual customer follow-up/);
  }
  const appointment = await f.runtime.maybeCreateAppointment(new Request('http://localhost/approval'), request, f.tables.commercial_leads[0]);
  assert.equal(appointment.skipped, 'contact_policy');
  assert.equal(request.status, 'pending');
  assert.equal(f.sms.length, before);
  assert.equal(f.appointments.length, 0);
});

test('actual queue GET keeps administrator authorization and dashboard wiring', async () => {
  const filename = path.resolve(__dirname, '..', 'app', 'api', 'v1', 'route.ts');
  const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const selected = ['requireAdminToken', 'GET'].map(name => {
    const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
    assert.ok(node, `Missing queue integration function: ${name}`);
    return node.getText(ast);
  });
  const f = createFixture();
  await save(f, contact('email'));
  const initialQueries = f.calls.length;
  const module = { exports: {} };
  const compiled = ts.transpileModule(selected.join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports, URL, console,
    NextResponse: { json: (body, options) => Response.json(body, options) },
    getConfiguredAnyAdminKey: () => 'fixture-admin-key',
    getDashboardAuthUserFromSession: async request => {
      const role = request.headers.get('x-fixture-session-role');
      return role ? { role } : null;
    },
    getCachedPathRules: async () => [], getSupabase: () => ({}), getSupabaseMgmt: () => ({}),
    corsHeaders: () => ({}), loadCommercialQueueSnapshot: () => f.queue(),
  });
  for (const [headers, status] of [
    [{}, 401],
    [{ 'x-h2s-admin-key': 'wrong-fixture-key' }, 403],
    [{ 'x-fixture-session-role': 'VA' }, 401],
    [{ 'x-h2s-admin-key': 'fixture-admin-key' }, 200],
    [{ 'x-fixture-session-role': 'ADMIN' }, 200],
  ]) {
    const response = await module.exports.GET(new Request('http://localhost/api/v1?action=commercialQueue', { headers }));
    assert.equal(response.status, status);
    if (status === 200) assert.equal((await response.json()).commercialQueue.queue.length, 1);
    else assert.equal(f.calls.length, initialQueries, 'Denied queue access must not query commercial records');
  }
  const frontend = path.resolve(__dirname, '..', '..', 'frontend');
  const markup = new JSDOM(fs.readFileSync(path.join(frontend, 'dash.html'), 'utf8'));
  try {
    assert.ok(markup.window.document.querySelector('[data-tab="commercialqueue"]'));
    assert.ok(markup.window.document.querySelector('#commercialqueue-pane #commercialQueueDetail'));
    assert.match(fs.readFileSync(path.join(frontend, 'dash.js'), 'utf8'),
      /commercialqueue:\s*\{[^\n]*requiresAdmin:\s*true/);
  } finally { markup.window.close(); }
});

test('full commercial frontend restores distinct draft, manual and text request states', async t => {
  for (const [method, submitted] of [['email', false], ['email', true], ['call', true], ['sms', true]]) {
    await t.test(`${method}: ${submitted ? 'submitted' : 'saved draft'}`, async () => {
      const f = createFixture();
      const lead = await save(f, contact(method));
      if (submitted) {
        const response = await f.post('commercial-consultation', { publicToken: lead.publicToken, ...slot });
        assert.equal(response.status, 201);
      }
      const before = { sms: f.sms.length, appointments: f.appointments.length };
      const errors = [];
      const console = new VirtualConsole();
      console.on('jsdomError', error => errors.push(error.message));
      const frontend = path.resolve(__dirname, '..', '..', 'frontend');
      const dom = new JSDOM(fs.readFileSync(path.join(frontend, 'commercial.html'), 'utf8'), {
        url: `http://localhost:3002/commercial?lead=${encodeURIComponent(lead.publicToken)}`,
        runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: console,
      });
      dom.window.HTMLElement.prototype.scrollIntoView = () => {};
      dom.window.scrollTo = () => {};
      dom.window.fetch = async (input, options = {}) => {
        const url = new URL(String(input), dom.window.location.href);
        if (url.pathname === '/api/commercial-intake') {
          assert.equal(options.method || 'GET', 'GET', 'Reload must not save or submit');
          return f.route('commercial-intake').GET(new Request(url));
        }
        assert.ok(['/api/track', '/api/owner-media/public', '/api/proof-gallery'].includes(url.pathname),
          `Unexpected frontend request: ${url.pathname}`);
        return Response.json({ ok: true, assets: [], items: [], photos: [] });
      };
      try {
        dom.window.eval(fs.readFileSync(path.join(frontend, 'commercial-labels.js'), 'utf8'));
        dom.window.eval(fs.readFileSync(path.join(frontend, 'media-page-heroes.js'), 'utf8'));
        dom.window.eval(fs.readFileSync(path.join(frontend, 'commercial.js'), 'utf8'));
        await new Promise(resolve => setImmediate(resolve));
        const document = dom.window.document;
        assert.deepEqual(errors, []);
        assert.equal(document.querySelector('#contactPreference').value, method);
        assert.equal(document.querySelector('#saveStateText').textContent, submitted ? 'Request submitted' : 'Draft saved');
        assert.equal(document.querySelector('#consultationSuccessPanel').classList.contains('hidden'), !submitted);
        assert.equal(document.querySelector('#requestConsultationBtn').disabled, submitted);
        if (submitted) {
          assert.match(document.querySelector('#successStatus').textContent,
            method === 'sms' ? /Request submitted; awaiting technician review/ : /Manual follow-up pending review/);
          if (method === 'email') {
            assert.match(document.querySelector('#successCopy').textContent, /We'll follow up by email\./);
            assert.match(document.querySelector('#successCopy').textContent, /No automated customer texts or emails/);
            assert.equal(document.querySelector('#email').value,'fixture@example.invalid');
          }
        }
        assert.equal(f.sms.length, before.sms);
        assert.equal(f.appointments.length, before.appointments);
      } finally { dom.window.close(); }
    });
  }
});
