const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { buildDefinition, configureRelay } = require('../tools/configure-business-call-relay.cjs');
const { normalizePhone } = require('../lib/commercial_consultation.js');

const source = '+15551230001';
const destination = '+15551230002';

test('public business call links and support messages use the owned local Twilio number', () => {
  const root = path.resolve(__dirname, '../..');
  const business = '+18643878413';
  for (const name of ['commercial', 'bundles', 'shop-home']) {
    const html = fs.readFileSync(path.join(root, 'frontend', `${name}.html`), 'utf8');
    const dom = new JSDOM(html);
    try {
      const links = [...dom.window.document.querySelectorAll('a[href^="tel:"]')];
      assert.ok(links.length, `${name} must expose a call action`);
      for (const link of links) assert.equal(normalizePhone(link.getAttribute('href').slice(4)), business, name);
      assert.doesNotMatch(html, /864[\s().-]*528[\s.-]*1475/);
    } finally {
      dom.window.close();
    }
  }
  for (const relative of [
    'frontend/commercial.js', 'frontend/bundles.js', 'frontend/bundles-app.js',
    'backend/app/api/schedule-appointment/route.ts',
  ]) {
    const source = fs.readFileSync(path.resolve(root, relative), 'utf8');
    assert.doesNotMatch(source, /864[\s().-]*528[\s.-]*1475/, relative);
    assert.match(source, /864[\s().-]*387[\s.-]*8413/, relative);
  }
});

function fixture(patch = {}) {
  const calls = [];
  const number = {
    sid: 'PN-fixture', accountSid: 'AC-fixture', phoneNumber: source, capabilities: { voice: true },
    voiceUrl: 'https://demo.twilio.com/welcome/voice/', voiceMethod: 'POST', voiceApplicationSid: '',
    smsUrl: 'https://example.invalid/inbound-sms', smsMethod: 'POST', smsApplicationSid: '',
    ...patch,
  };
  let flow;
  const numbers = () => ({
    update: async values => { calls.push('update-number'); Object.assign(number, values); return structuredClone(number); },
    fetch: async () => structuredClone(number),
  });
  numbers.list = async () => [structuredClone(number)];
  const flows = () => ({
    update: async values => { calls.push('update-flow'); Object.assign(flow, values); return structuredClone(flow); },
    fetch: async () => structuredClone(flow),
  });
  flows.list = async () => flow ? [structuredClone(flow)] : [];
  flows.create = async values => { calls.push('create-flow'); flow = { sid: 'FW-fixture', ...values }; return structuredClone(flow); };
  const client = {
    incomingPhoneNumbers: numbers,
    studio: { v2: { flows, flowValidate: { update: async () => { calls.push('validate'); return { valid: true }; } } } },
  };
  Object.defineProperties(client, {
    calls: { get() { throw new Error('Tests must never place calls'); } },
    messages: { get() { throw new Error('Voice configuration must not send SMS'); } },
  });
  return { client, calls, number };
}

test('relay definition dials exactly one configured recipient, without recordings or SMS', () => {
  const definition = buildDefinition(source, destination);
  const dial = definition.states.find(state => state.type === 'connect-call-to');
  assert.equal(dial.properties.to, destination);
  assert.equal(dial.properties.caller_id, source);
  assert.equal(dial.properties.record, false);
  assert.equal(dial.properties.timeout, 30);
  assert.equal(definition.states.filter(state => state.type === 'connect-call-to').length, 1);
  assert.ok(!definition.states.some(state => state.type.includes('message') || state.type.includes('record')));
  const result = definition.states.find(state => state.name === 'check_result');
  assert.equal(result.transitions.find(transition => transition.event === 'noMatch').next, 'unavailable');
  assert.equal(result.transitions.find(transition => transition.event === 'match').conditions[0].value, 'completed');
});

test('invalid, international, missing, and self-referential relay numbers fail before provider access', async () => {
  for (const target of ['', 'not-a-number', '+442071234567', source]) {
    const f = fixture();
    await assert.rejects(configureRelay(f.client, { source, destination: target, apply: true }));
    assert.equal(f.calls.length, 0);
  }
});

test('default check validates but does not publish a flow or modify a number', async () => {
  const f = fixture();
  const result = await configureRelay(f.client, { source, destination });
  assert.equal(result.mode, 'check');
  assert.deepEqual(f.calls, ['validate']);
  assert.equal(f.number.voiceUrl, 'https://demo.twilio.com/welcome/voice/');
});

test('apply and repeat apply verify one published relay without changing SMS settings or making calls', async () => {
  const f = fixture();
  const before = structuredClone(f.number);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await configureRelay(f.client, { source, destination, apply: true });
    assert.equal(result.verified, true);
    assert.equal(result.smsSettingsUnchanged, true);
    assert.equal(result.callPlaced, false);
    assert.equal(f.number.smsUrl, before.smsUrl);
    assert.equal(f.number.smsMethod, before.smsMethod);
  }
  assert.equal(f.calls.filter(call => call === 'create-flow').length, 1);
  assert.equal(f.calls.filter(call => call === 'update-flow').length, 1);
});

test('unowned, nonvoice, application-managed, and unrelated voice routes cannot be overwritten', async () => {
  for (const patch of [
    { phoneNumber: '+15551239999' }, { capabilities: { voice: false } },
    { voiceApplicationSid: 'AP-fixture' }, { voiceUrl: 'https://example.invalid/established-voice-handler' },
  ]) {
    const f = fixture(patch);
    await assert.rejects(configureRelay(f.client, { source, destination, apply: true }));
    assert.equal(f.calls.length, 0);
  }
});

test('provider validation failure cannot publish or modify routing', async () => {
  const f = fixture();
  f.client.studio.v2.flowValidate.update = async () => ({ valid: false });
  await assert.rejects(configureRelay(f.client, { source, destination, apply: true }), /rejected/);
  assert.equal(f.calls.length, 0);
});
