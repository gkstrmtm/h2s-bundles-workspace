const assert = require('node:assert/strict');
const { normalizePhone } = require('../lib/commercial_consultation.js');

function buildDefinition(source, destination) {
  for (const phone of [source, destination]) {
    assert.match(phone, /^\+1\d{10}$/, 'Call routing requires explicit US E.164 numbers');
  }
  assert.notEqual(source, destination, 'The relay must not dial the business number itself');
  return {
    description: 'Home2Smart business voice relay; no recording or SMS',
    initial_state: 'Trigger',
    flags: { allow_concurrent_calls: true },
    states: [
      {
        name: 'Trigger', type: 'trigger', properties: { offset: { x: 0, y: 0 } },
        transitions: [{ event: 'incomingCall', next: 'forward_call' }, { event: 'incomingMessage' }, { event: 'incomingRequest' }],
      },
      {
        name: 'forward_call', type: 'connect-call-to',
        properties: {
          offset: { x: 0, y: 200 }, caller_id: source, noun: 'number', to: destination,
          timeout: 30, record: false,
        },
        transitions: [{ event: 'callCompleted', next: 'check_result' }, { event: 'hangup' }],
      },
      {
        name: 'check_result', type: 'split-based-on',
        properties: { offset: { x: 0, y: 400 }, input: '{{widgets.forward_call.DialCallStatus}}' },
        transitions: [
          { event: 'noMatch', next: 'unavailable' },
          {
            event: 'match',
            conditions: [{
              friendly_name: 'Call connected', arguments: ['{{widgets.forward_call.DialCallStatus}}'],
              type: 'equal_to', value: 'completed',
            }],
          },
        ],
      },
      {
        name: 'unavailable', type: 'say-play',
        properties: {
          offset: { x: 0, y: 600 }, loop: 1, language: 'en-US', voice: 'alice',
          say: 'We could not reach our team. Please submit your project details on our website to request a follow-up. Goodbye.',
        },
        transitions: [{ event: 'audioComplete' }],
      },
    ],
  };
}

function smsSettings(number) {
  return [number.smsUrl, number.smsMethod, number.smsFallbackUrl, number.smsFallbackMethod, number.smsApplicationSid];
}

async function configureRelay(client, { source, destination, apply = false }) {
  const definition = buildDefinition(source, destination);
  const numbers = await client.incomingPhoneNumbers.list({ phoneNumber: source, limit: 2 });
  const number = numbers.find(item => item.phoneNumber === source);
  assert.ok(number?.capabilities?.voice, 'The business number must be owned by this account and voice-enabled');
  assert.ok(!number.voiceApplicationSid, 'An existing voice application requires separate review');
  const friendlyName = `Home2Smart call relay ${source}`;
  const flows = await client.studio.v2.flows.list({ limit: 101 });
  assert.ok(flows.length <= 100, 'Too many Studio flows for a bounded lookup; review the target manually');
  const matches = flows.filter(flow => flow.friendlyName === friendlyName);
  assert.ok(matches.length <= 1, 'Multiple matching relay flows require manual reconciliation');
  const existing = matches[0];
  const webhook = flowSid => `https://webhooks.twilio.com/v1/Accounts/${number.accountSid}/Flows/${flowSid}`;
  const demoRoute = number.voiceUrl === 'https://demo.twilio.com/welcome/voice/';
  assert.ok(demoRoute || (existing && number.voiceUrl === webhook(existing.sid)),
    'Refusing to replace an unrelated voice handler');
  const validated = await client.studio.v2.flowValidate.update({ friendlyName, definition, status: 'published' });
  assert.equal(validated.valid, true, 'Twilio rejected the relay definition');
  const result = {
    mode: apply ? 'apply' : 'check', source, destination, definitionValid: true,
    previousVoiceUrl: number.voiceUrl, previousVoiceMethod: number.voiceMethod,
  };
  if (!apply) return result;

  const flow = existing
    ? await client.studio.v2.flows(existing.sid).update({ definition, status: 'published' })
    : await client.studio.v2.flows.create({ friendlyName, definition, status: 'published' });
  result.flowSid = flow.sid;
  result.voiceUrl = webhook(flow.sid);
  try {
    await client.incomingPhoneNumbers(number.sid).update({ voiceUrl: result.voiceUrl, voiceMethod: 'POST' });
  } catch (error) {
    throw new Error(`Voice update did not complete cleanly. Read back the number before retrying; preserve flow ${flow.sid}. Provider code: ${error.code || 'unknown'}`);
  }
  const verified = await client.incomingPhoneNumbers(number.sid).fetch();
  assert.equal(verified.voiceUrl, result.voiceUrl, 'Voice route verification failed');
  assert.equal(verified.voiceMethod, 'POST');
  assert.deepEqual(smsSettings(verified), smsSettings(number), 'SMS settings changed unexpectedly; investigate before proceeding');
  const published = await client.studio.v2.flows(flow.sid).fetch();
  assert.equal(published.status, 'published');
  assert.deepEqual(published.definition, definition, 'Published relay definition did not match the validated definition');
  return { ...result, verified: true, smsSettingsUnchanged: true, callPlaced: false };
}

async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.every(arg => arg === '--apply'), 'Usage: node tools\\configure-business-call-relay.cjs [--apply]');
  const env = process.env;
  assert.ok(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN, 'TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required');
  const client = require('twilio')(env.TWILIO_ACCOUNT_SID.trim(), env.TWILIO_AUTH_TOKEN.trim(), { autoRetry: false, timeout: 20000 });
  const result = await configureRelay(client, {
    source: normalizePhone(env.TWILIO_PHONE_NUMBER || ''),
    destination: normalizePhone(env.TWILIO_VOICE_FORWARD_TO || ''),
    apply: args.includes('--apply'),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { buildDefinition, configureRelay };
