const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const utils = require('../lib/commercial_consultation.js');
const { createFixture } = require('./helpers/commercial_contact_fixture.cjs');
const wrongBrand = /\bHome(?:\s+(?:Too|To|Two|2)\s*|Too|Two|2\s+)Smart\b/i;
function branded(body) {
  assert.match(body, /\bHome2Smart\b/);
  assert.doesNotMatch(body, wrongBrand);
}
function attempts(f) {
  assert.ok(f.providerAttempts.length);
  f.providerAttempts.forEach(message => branded(message.body));
}
async function submit(f, method = 'sms') {
  const response = await f.post('commercial-intake', {
    fullName: 'Branding Fixture', companyName: 'Fixture Offices', contactPreference: method,
    phone: method === 'email' ? '' : '+15550000005', email: 'fixture@example.invalid',
    smsOptIn: method === 'sms', serviceNeeds: ['Security Cameras'],
  });
  assert.equal(response.status, 201);
  const saved = (await response.json()).lead;
  const slot = utils.buildSlotSuggestions()[0];
  const submitted = await f.post('commercial-consultation', {
    publicToken: saved.publicToken, selectedSlotStart: slot.startIso, selectedSlotEnd: slot.endIso,
    submissionKey: 'branding-fixture-submit-0001',
  });
  assert.equal(submitted.status, 201);
  return f.tables.commercial_consultation_requests[0];
}
test('all commercial message builders use the canonical brand without changing links or references, including legacy sparse inputs', () => {
  const input = { referenceCode: 'COM-BRAND', customerName: 'Fixture Contact', companyName: 'Fixture Offices',
    serviceNeeds: ['Security Cameras'], baseUrl: 'https://approval.example.invalid', responseToken: 'keep-token&value',
    slotLabel: 'Future requested window', ageMinutes: 30 };
  const request = utils.buildTechnicianRequestMessage(input);
  branded(request);
  assert.ok(request.includes(utils.buildApprovalLinks(input.baseUrl, input.responseToken).reviewUrl));
  for (const builder of [utils.buildCustomerPendingMessage, utils.buildCustomerConfirmedMessage, utils.buildEscalationMessage]) {
    branded(builder(input));
    branded(builder({}));
    assert.ok(builder(input).includes(input.referenceCode));
  }
  for (const method of ['call', 'email']) branded(utils.buildManualFollowUpMessage(
    { reference_code: 'COM-LEGACY' }, { contact_preference: method }, 'Pending review'));
});
test('initial sends, no-response reminders and escalation stay branded without rewriting historical messages', async () => {
  const f = createFixture();
  const historical = { message_id: 'historical-branding-fixture', body: 'Home Too Smart historical message - preserve verbatim' };
  f.tables.sms_messages.push(structuredClone(historical));
  const row = await submit(f);
  assert.equal(f.sms.length, 2);
  for (let count = 0; count <= f.runtime.getMaxReminderCount(); count++) {
    row.next_reminder_at = '2000-01-01T00:00:00Z';
    const response = await f.route('commercial-consultation-maintenance').GET(new Request('http://localhost/maintenance', {
      headers: { Authorization: 'Bearer fixture-only-cron-secret' },
    }));
    assert.equal(response.status, 200);
  }
  assert.equal(row.status, 'escalated');
  attempts(f);
  assert.match(f.sms.at(-1).body, /Home2Smart.*needs review/);
  assert.deepEqual(f.tables.sms_messages.find(message => message.message_id === historical.message_id), historical);
});
test('manual email/call follow-up notifications identify Home2Smart without adding customer sends or appointments', async () => {
  for (const method of ['email', 'call']) {
    const f = createFixture();
    await submit(f, method);
    assert.deepEqual(f.sms.map(message => message.to), ['+15550000001']);
    assert.match(f.sms[0].body, /Home2Smart.*manual follow-up/);
    assert.equal(f.appointments.length, 0);
    attempts(f);
  }
});
test('YES/NO replies, confirmation/decline sends and rejected/uncertain/appointment failure paths stay branded', async t => {
  for (const action of ['YES', 'NO']) for (const failure of [null, 'rejected', 'timeout', 'appointment']) {
    await t.test(`${action}: ${failure || 'accepted'}`, async () => {
      const f = createFixture(), row = await submit(f);
      if (failure === 'appointment') f.faults.commercial_create_appointment = 'Fixture appointment failure';
      else if (failure) f.faults.sms = failure;
      const result = await f.runtime.handleTechnicianReply(new Request('http://localhost'), '+15550000001', `${action} ${row.reference_code}`);
      assert.equal(result.handled, true);
      branded(result.replyText);
      attempts(f);
      if (action === 'NO' || failure === 'appointment') assert.equal(f.appointments.length, 0);
    });
  }
});
test('rescheduling and unmatched, delayed or invalid technician replies retain branding and current approval authority', async () => {
  const f = createFixture(), row = await submit(f);
  const unknown = await f.runtime.handleTechnicianReply(new Request('http://localhost'), '+15550000001', 'YES COM-UNKNOWN');
  branded(unknown.replyText);
  const slot = utils.buildSlotSuggestions()[1];
  const reschedule = await f.post('commercial-consultation', {
    publicToken: f.tables.commercial_leads[0].public_token, mode: 'reschedule', requestId: row.request_id,
    selectedSlotStart: slot.startIso, selectedSlotEnd: slot.endIso, submissionKey: 'branding-fixture-reschedule-0001',
  });
  assert.equal(reschedule.status, 200);
  attempts(f);
  const delayed = await f.runtime.handleTechnicianReply(new Request('http://localhost'), '+15550000001', `YES ${row.reference_code}`);
  assert.equal(delayed.ok, false);
  branded(delayed.replyText);
  assert.match(delayed.replyText, /current approval link/);
  const g = createFixture(), invalid = await submit(g);
  g.tables.commercial_leads[0].phone = '';
  const rejected = await g.runtime.handleTechnicianReply(new Request('http://localhost'), '+15550000001', `YES ${invalid.reference_code}`);
  assert.equal(rejected.ok, false);
  branded(rejected.replyText);
});
test('safe recovery regenerates branded messages but never resends accepted or uncertain effects', async () => {
  for (const failure of ['rejected', 'timeout']) {
    const f = createFixture(), row = await submit(f);
    f.faults.sms = failure;
    await f.runtime.handleTechnicianReply(new Request('http://localhost'), '+15550000001', `YES ${row.reference_code}`);
    const before = f.providerAttempts.length;
    delete f.faults.sms;
    await f.runtime.retryCommercialProcessing(new Request('http://localhost'), row.request_id);
    assert.equal(f.providerAttempts.length, before + (failure === 'rejected' ? 1 : 0));
    attempts(f);
    const accepted = f.providerAttempts.length;
    await f.runtime.retryCommercialProcessing(new Request('http://localhost'), row.request_id);
    assert.equal(f.providerAttempts.length, accepted);
  }
});
test('approval branding persists on loading/error screens; commercial approval has no active legacy email/scheduling sender', () => {
  const root = path.resolve(__dirname, '..', '..');
  const html = fs.readFileSync(path.join(root, 'frontend', 'commercial-approval.html'), 'utf8');
  const dom = new JSDOM(html);
  try {
    branded(dom.window.document.title);
    branded(dom.window.document.querySelector('.section-kicker').textContent);
    dom.window.document.getElementById('approvalHeading').textContent = 'Request unavailable';
    branded(dom.window.document.querySelector('.section-kicker').textContent);
  } finally { dom.window.close(); }
  const runtime = fs.readFileSync(path.join(root, 'backend', 'lib', 'commercial_consultation_runtime.ts'), 'utf8');
  assert.match(runtime, /commercialRpc\('commercial_create_appointment'/);
  assert.doesNotMatch(runtime, /sendMail|sendEmail|schedule-appointment|dataOrchestration/);
  const mail = fs.readFileSync(path.join(root, 'backend', 'lib', 'mail.ts'), 'utf8');
  assert.match(mail, /name: 'Home2Smart Portal'/);
  for (const file of ['commercial.html', 'commercial.js', 'commercial-approval.html', 'commercial-approval.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, 'frontend', file), 'utf8'), wrongBrand, file);
  }
});
