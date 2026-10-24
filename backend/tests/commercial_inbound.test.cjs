const test = require('node:test');
const assert = require('node:assert/strict');
const twilio = require('twilio');
const { createFixture } = require('./helpers/commercial_contact_fixture.cjs');
const { buildSlotSuggestions } = require('../lib/commercial_consultation.js');

const owner = '+15550000001', customer = '+15550000005', sender = '+15550000004';
const account = 'AC' + '1'.repeat(32), token = 'fixture-only-auth-token';
const url = 'https://backend.example.invalid/api/twilio/inbound-sms';
const env = { TWILIO_ACCOUNT_SID: account, TWILIO_AUTH_TOKEN: token, TWILIO_INBOUND_SMS_WEBHOOK_URL: url };
let sequence = 0;
function inbound(f, body, patch = {}, signature = true) {
  const fields = { AccountSid: account, MessageSid: 'SM' + (++sequence).toString(16).padStart(32, '0'),
    From: owner, To: sender, Body: body, ...patch };
  return f.route('twilio\\inbound-sms').POST(new Request(url, { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature ? twilio.getExpectedTwilioSignature(token, url, fields) : 'invalid' },
    body: new URLSearchParams(fields) }));
}
async function submit(f, name = 'Commercial fixture') {
  const saved = await f.post('commercial-intake', { fullName: name, companyName: 'Fixture business',
    phone: customer, contactPreference: 'sms', smsOptIn: true, serviceNeeds: ['Security Cameras'] });
  assert.equal(saved.status, 201);
  const lead = (await saved.json()).lead;
  const slot = buildSlotSuggestions()[0];
  const result = await f.post('commercial-consultation', { publicToken: lead.publicToken,
    selectedSlotStart: slot.startIso, selectedSlotEnd: slot.endIso });
  assert.equal(result.status, 201);
  return f.tables.commercial_consultation_requests.find(row => row.lead_id === lead.leadId);
}
function maintenance(f) {
  return f.route('commercial-consultation-maintenance').GET(new Request('http://localhost/maintenance', {
    headers: { Authorization: 'Bearer fixture-only-cron-secret' },
  }));
}

test('only the request-specific review link approves its consultation; opening a link does not approve', async () => {
  const f = createFixture(env), first = await submit(f, 'First customer'), second = await submit(f, 'Second customer');
  assert.notEqual(first.response_token, second.response_token);
  const before = f.sms.length;
  const context = await f.route('commercial-consultation-response').GET(new Request(
    'http://localhost/api/commercial-consultation-response?token=' + first.response_token + '&action=approve'));
  assert.equal(context.status, 200);
  assert.equal((await context.json()).lead.fullName, 'First customer');
  assert.equal(first.status, 'pending'); assert.equal(second.status, 'pending');
  assert.equal(f.sms.length, before); assert.equal(f.appointments.length, 0);
  const response = await f.post('commercial-consultation-response', { token: first.response_token, action: 'approve' });
  assert.equal(response.status, 200);
  assert.equal(first.status, 'approved'); assert.equal(first.response_channel, 'web');
  assert.equal(second.status, 'pending'); assert.equal(f.appointments.length, 1);
  assert.equal(f.sms.length, before + 1);
  assert.equal(f.sms.at(-1).to, customer);
  assert.match(f.sms.at(-1).body, /accepted.*Expect our call during/);
  assert.match(f.sms.at(-1).body, /phone consultation, not an installation/);
  assert.equal(Date.parse(first.next_reminder_at), Date.parse(first.selected_slot_start) - 15 * 60000);
});

test('the existing review page loads each unique request and posts only after an explicit approve or decline click', async () => {
  const fs = require('node:fs'), path = require('node:path'), { JSDOM } = require('jsdom');
  const frontend = path.resolve(__dirname, '..', '..', 'frontend');
  const f = createFixture(env), first = await submit(f, 'First customer'), second = await submit(f, 'Second customer');
  const waitFor = async predicate => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (predicate()) return;
      await new Promise(setImmediate);
    }
    assert.fail('Review page did not reach the expected fixture state');
  };
  for (const [row, action] of [[first, 'approve'], [second, 'decline']]) {
    const posts = [];
    const dom = new JSDOM(fs.readFileSync(path.join(frontend, 'commercial-approval.html'), 'utf8'), {
      url: 'https://shop.example.invalid/commercial-approval?token=' + row.response_token + '&action=' + action,
      runScripts: 'outside-only',
    });
    try {
      dom.window.fetch = async (input, options = {}) => {
        if (options.method === 'POST') {
          const body = JSON.parse(options.body);
          posts.push(body);
          return f.post('commercial-consultation-response', body);
        }
        return f.route('commercial-consultation-response').GET(new Request(new URL(input, dom.window.location.href)));
      };
      dom.window.eval(fs.readFileSync(path.join(frontend, 'commercial-approval.js'), 'utf8'));
      const doc = dom.window.document;
      await waitFor(() => doc.getElementById('approvalMessage').textContent.startsWith('Ready to '));
      assert.equal(doc.getElementById('approvalReference').textContent, row.reference_code);
      assert.equal(doc.getElementById('approvalStatus').textContent, 'pending');
      assert.equal(posts.length, 0, 'Even action=approve in a URL must not auto-approve');
      doc.getElementById('approvalNote').value = 'Reviewed this specific fixture inquiry';
      doc.getElementById(action === 'approve' ? 'approveBtn' : 'declineBtn').click();
      await waitFor(() => doc.getElementById('approvalStatus').textContent === (action === 'approve' ? 'approved' : 'declined'));
      assert.deepEqual(posts, [{ token: row.response_token, action, note: 'Reviewed this specific fixture inquiry' }]);
      assert.match(doc.getElementById('approvalMessage').textContent,
        action === 'approve' ? /Appointment exists.*provider accepted/ : /Decline recorded/);
    } finally {
      dom.window.close();
    }
    if (action === 'approve') assert.equal(second.status, 'pending');
  }
  assert.equal(f.appointments.length, 1);
});

test('signed YES/NO and reference replies stay in Messages and never approve or decline any request', async () => {
  const f = createFixture(env), first = await submit(f), second = await submit(f), before = f.sms.length;
  for (const body of ['YES', 'NO', 'approve', 'decline', 'YES ' + first.reference_code, 'NO ' + second.reference_code]) {
    const response = await inbound(f, body);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<Response></Response>');
  }
  assert.equal(first.status, 'pending'); assert.equal(second.status, 'pending');
  assert.equal(f.appointments.length, 0); assert.equal(f.sms.length, before);
  assert.equal(f.tables.sms_messages.filter(message => message.direction === 'INBOUND').length, 6);
});

test('provider retries save one inbound message and cannot mutate a consultation or send confirmations', async () => {
  const f = createFixture(env), row = await submit(f), sid = 'SM' + 'a'.repeat(32), before = f.sms.length;
  const nextReminder = row.next_reminder_at;
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal((await inbound(f, 'YES ' + row.reference_code, { MessageSid: sid })).status, 200);
  }
  assert.equal(row.status, 'pending'); assert.equal(row.next_reminder_at, nextReminder);
  assert.equal(f.appointments.length, 0); assert.equal(f.sms.length, before);
  assert.equal(f.tables.sms_messages.filter(message => message.direction === 'INBOUND').length, 1);
});

test('simultaneous and repeated link approvals create one appointment and customer confirmation', async () => {
  const f = createFixture(env), row = await submit(f);
  const approve = () => f.post('commercial-consultation-response', { token: row.response_token, action: 'approve' });
  const responses = await Promise.all([approve(), approve()]);
  assert.ok(responses.some(response => response.status === 200));
  assert.ok(responses.every(response => [200,409].includes(response.status)));
  const next = row.next_reminder_at;
  assert.equal((await approve()).status, 200);
  assert.equal(f.appointments.length, 1);
  assert.deepEqual(f.sms.map(message => message.to), [owner, customer, customer]);
  assert.equal(row.next_reminder_at, next);
});

test('ordinary customer replies and negated or mixed owner text stay in Messages without approving or broadcasting', async () => {
  const f = createFixture(env), row = await submit(f), before = f.sms.length;
  for (const [from, body] of [[customer, 'YES'], [customer, 'Please call after lunch'], [owner, 'not yes'], [owner, 'yes no']]) {
    const response = await inbound(f, body, { From: from });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<Response></Response>');
  }
  assert.equal(row.status, 'pending');
  assert.equal(f.sms.length, before);
  assert.equal(f.tables.sms_messages.filter(message => message.direction === 'INBOUND').length, 4);
});

test('invalid signatures, spoofed accounts and unowned destinations cannot write or accept; production cannot bypass signatures', async () => {
  const f = createFixture({ ...env, NODE_ENV: 'production', TWILIO_DISABLE_SIGNATURE_VALIDATION: '1' });
  assert.equal((await inbound(f, 'YES', {}, false)).status, 403);
  for (const patch of [{ AccountSid: 'AC' + '2'.repeat(32) }, { To: '+15550000099' }, { MessageSid: '' }]) {
    assert.equal((await inbound(f, 'YES', patch)).status, 400);
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.sms.length, 0);
});

test('link approval reports appointment failure without promising a customer call or scheduling reminders', async () => {
  const f = createFixture(env), row = await submit(f);
  f.faults.commercial_create_appointment = 'Fixture appointment failure';
  const response = await f.post('commercial-consultation-response', { token: row.response_token, action: 'approve' });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.appointment.ok, false);
  assert.equal(payload.notifications.customer, null);
  assert.equal(f.appointments.length, 0);
  assert.deepEqual(f.sms.map(message => message.to), [owner, customer]);
  assert.equal(row.next_reminder_at, null);
});

test('link approval exposes customer send rejection and safely retries without rebooking', async () => {
  const f = createFixture(env), row = await submit(f);
  f.faults.sms = 'rejected';
  const approve = () => f.post('commercial-consultation-response', { token: row.response_token, action: 'approve' });
  const response = await approve();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).notifications.customer.ok, false);
  assert.equal(f.appointments.length, 1);
  delete f.faults.sms;
  assert.equal((await approve()).status, 200);
  assert.equal(f.appointments.length, 1);
});

test('accepted consultations remind only their assigned owner 15 minutes before and at the start, once across simultaneous cron runs', async () => {
  let clock = Date.now();
  const f = createFixture(env, { now: () => clock }), row = await submit(f);
  await f.post('commercial-consultation-response', { token: row.response_token, action: 'approve' });
  const start = Date.parse(row.selected_slot_start), before = f.sms.length;
  f.tables.commercial_lead_operations.push({ lead_id: row.lead_id, disposition: 'closed', sales_chasing_paused: true });
  clock = start - 16 * 60000;
  assert.equal((await maintenance(f)).status, 200); assert.equal(f.sms.length, before);
  clock = start - 15 * 60000;
  for (const response of await Promise.all([maintenance(f), maintenance(f)])) assert.equal(response.status, 200);
  assert.equal(f.sms.length, before + 1); assert.equal(f.sms.at(-1).to, owner);
  assert.match(f.sms.at(-1).body, /Upcoming call/);
  assert.equal(Date.parse(row.next_reminder_at), start);
  await maintenance(f); assert.equal(f.sms.length, before + 1);
  clock = start;
  for (const response of await Promise.all([maintenance(f), maintenance(f)])) assert.equal(response.status, 200);
  assert.equal(f.sms.length, before + 2); assert.equal(f.sms.at(-1).to, owner);
  assert.match(f.sms.at(-1).body, /Call now/);
  assert.equal(row.next_reminder_at, null);
  await maintenance(f); assert.equal(f.sms.length, before + 2);
  assert.ok(f.sms.slice(before).every(message => message.to === owner && message.body.includes(customer)));
});

test('missed pre-window reminder does not create a burst at window start, and old unenrolled appointments stay untouched', async () => {
  let clock = Date.now();
  const f = createFixture(env, { now: () => clock }), row = await submit(f);
  await f.post('commercial-consultation-response', { token: row.response_token, action: 'approve' });
  const before = f.sms.length;
  clock = Date.parse(row.selected_slot_start) + 1000;
  await maintenance(f);
  assert.equal(f.sms.length, before + 1);
  assert.match(f.sms.at(-1).body, /Call now/);
  row.next_reminder_at = null;
  await maintenance(f); assert.equal(f.sms.length, before + 1);
});

test('Eastern call reminders retain the same local window on both sides of DST and reject stale rescheduled snapshots', async () => {
  for (const [start, end] of [['2027-03-15T13:00:00Z','2027-03-15T13:30:00Z'],
    ['2027-11-08T14:00:00Z','2027-11-08T14:30:00Z']]) {
    const f = createFixture(env), row = await submit(f);
    await f.post('commercial-consultation-response', { token: row.response_token, action: 'approve' });
    row.selected_slot_start = start; row.selected_slot_end = end;
    row.next_reminder_at = new Date(Date.parse(start) - 15 * 60000).toISOString();
    Object.assign(f.tables.h2s_orders[0].metadata_json, { slot_start_iso: start, slot_end_iso: end });
    const result = await f.runtime.sendConsultationCallReminder(row, f.tables.commercial_leads[0],
      new Date(Date.parse(start) - 15 * 60000));
    assert.equal(result.action, 'call_reminder_accepted');
    assert.match(f.sms.at(-1).body, /9:00 AM to 9:30 AM Eastern Time/);
    const stale = structuredClone(row), before = f.sms.length;
    row.response_token = 'rescheduled-token-fixture'; row.status = 'reschedule_requested';
    const changed = await f.runtime.sendConsultationCallReminder(stale, f.tables.commercial_leads[0], new Date(start));
    assert.equal(changed.action, 'request_changed');
    assert.equal(f.sms.length, before);
  }
});

test('elapsed and canceled due windows are removed from the cron due set without sending or starving future work', async () => {
  let clock = Date.now();
  const f = createFixture(env, { now: () => clock }), row = await submit(f);
  await f.post('commercial-consultation-response', { token: row.response_token, action: 'approve' });
  const before = f.sms.length;
  clock = Date.parse(row.selected_slot_end) + 1;
  const result = await (await maintenance(f)).json();
  assert.equal(result.processed[0].action, 'window_passed');
  assert.equal(row.next_reminder_at, null); assert.equal(f.sms.length, before);
});

test('canceled, mismatched, unassigned, unbooked, premature and elapsed consultations cannot send misleading call reminders', async () => {
  for (const fault of ['cancelled','mismatched','unassigned','unbooked','premature','elapsed']) {
    const f = createFixture(env), row = await submit(f);
    await f.post('commercial-consultation-response', { token: row.response_token, action: 'approve' });
    const start = Date.parse(row.selected_slot_start), before = f.sms.length;
    let now = start - 10 * 60000;
    if (fault === 'cancelled') f.tables.h2s_orders[0].status = 'cancelled';
    if (fault === 'mismatched') f.tables.h2s_orders[0].metadata_json.slot_start_iso = new Date(start + 3600000).toISOString();
    if (fault === 'unassigned') row.assigned_technician_phone = '+15550000099';
    if (fault === 'unbooked') row.related_order_id = null;
    if (fault === 'premature') now = start - 16 * 60000;
    if (fault === 'elapsed') now = Date.parse(row.selected_slot_end);
    const result = await f.runtime.sendConsultationCallReminder(row, f.tables.commercial_leads[0], new Date(now));
    assert.notEqual(result.action, 'call_reminder_accepted', fault);
    assert.equal(f.sms.length, before, fault);
  }
});

test('owner acknowledgements and reminders appear with separate role and purpose in existing communication history', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'commercial_communications.ts'), 'utf8');
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    { module, exports: module.exports, require: () => ({ communicationLabels: { provider_accepted: 'Accepted' } }) });
  const events = module.exports.commercialCommunicationSummary(['owner_reply:approve', 'owner_call:before', 'owner_call:start'].map(kind =>
    ({ kind, state: 'accepted', details: { to: owner } })), []);
  assert.equal(events.length, 3);
  assert.ok(events.every(event => event.role === 'Consultation owner' && event.recipient === owner));
  assert.match(events[1].purpose, /15 minutes before/);
  assert.match(events[2].purpose, /window start/);
});
