'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('./helpers/commercial_operations_fixture.cjs');
const runId = 'c326ee0d-172a-4a14-8f21-e123456789ab', schema = 'h2s_test_' + runId.replace(/-/g,'');
const origin = 'https://nkccbnrduojnzjfrpwva.supabase.co';
function load(overrides = {}) {
  return evaluate('lib\\stagingSandbox.ts', {}, { Headers, fetch, process: { env: {
    H2S_STAGING_SANDBOX_RUN_ID: runId, H2S_STAGING_DATABASE_SCHEMA: schema,
    H2S_STAGING_SYNTHETIC_ONLY: 'true', VERCEL_ENV: 'preview', H2S_FIELD_STRIPE_MODE: 'test',
    H2S_FIELD_STRIPE_LIVE_ENABLED: 'false', ...overrides,
  } } });
}
test('ordinary production client remains unchanged; a misconfigured sandbox never falls back to public', () => {
  assert.equal(Object.keys(load({ H2S_STAGING_SANDBOX_RUN_ID: undefined }).stagingSandboxOptions(origin)).length, 0);
  for (const changes of [{ VERCEL_ENV: 'production' }, { H2S_FIELD_STRIPE_MODE: 'live' },
    { H2S_STAGING_DATABASE_SCHEMA: 'public' }, { H2S_STAGING_SYNTHETIC_ONLY: 'false' }]) {
    assert.throws(() => load(changes).stagingSandboxOptions(origin));
  }
});
test('every native read/write/RPC profile is forced into the exact run, overriding public profile requests', async () => {
  const seen = [], transport = async (url, init) => { seen.push({ url: String(url), init }); return new Response('{}'); };
  const scoped = load().stagingSandboxOptions(origin, transport).global.fetch;
  for (const method of ['GET','POST','PATCH','DELETE']) {
    await scoped(origin + '/rest/v1/commercial_leads', { method, headers: { 'Accept-Profile': 'public' } });
  }
  await scoped(origin + '/rest/v1/rpc/field_sales_command', { method: 'POST' });
  for (const call of seen) {
    assert.equal(call.init.headers.get('Accept-Profile'), schema);
    assert.equal(call.init.headers.get('Content-Profile'), schema);
  }
});
test('storage is remapped only into exact run buckets; other providers/buckets/auth/function endpoints are refused', async () => {
  const urls = [], transport = async url => { urls.push(String(url)); return new Response('{}'); };
  const scoped = load().stagingSandboxOptions(origin, transport).global.fetch;
  await scoped(origin + '/storage/v1/bucket/commercial-private-files');
  await scoped(origin + '/storage/v1/object/sign/h2s-job-artifacts/proof.png', { method: 'POST' });
  assert.ok(urls[0].includes('h2s-test-' + runId + '-files'));
  assert.ok(urls[1].includes('h2s-test-' + runId + '-proof'));
  for (const url of [origin + '/storage/v1/bucket', origin + '/storage/v1/object/other-bucket/a',
    origin + '/functions/v1/production-action', origin + '/auth/v1/user', 'https://example.invalid/rest/v1/a']) {
    await assert.rejects(scoped(url));
  }
  assert.equal(urls.length, 2);
});
