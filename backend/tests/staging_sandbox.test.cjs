'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runNames, migrationSources, transactionBody, prepareSandbox, cleanupSandbox } = require('../tools/staging-sandbox.cjs');
const runId = 'c326ee0d-172a-4a14-8f21-e123456789ab';
test('sandbox derives exact private run namespaces and never accepts public or injected identifiers', () => {
  const names = runNames(runId);
  assert.equal(names.schema, 'h2s_test_c326ee0d172a4a148f21e123456789ab');
  assert.equal(names.role, names.schema + '_owner');
  for (const invalid of ['public', '', null, runId + '; drop schema public cascade', runId.toUpperCase()]) {
    assert.throws(() => runNames(invalid));
  }
});
test('sandbox cleanup requires exact matching run confirmation before issuing SQL', async () => {
  let calls = 0;
  const client = { query: async () => { calls++; throw Error('SQL must not run'); } };
  await assert.rejects(cleanupSandbox(client, { runId, confirmRun: 'public' }), /exact matching/);
  assert.equal(calls, 0);
  await assert.rejects(prepareSandbox(client, { runId: 'public', sourceCommit: 'a'.repeat(40) }));
  assert.equal(calls, 0);
});
test('reviewed native candidate sources are available, checksummed and do not contain outer commit after wrapping', () => {
  const sources = migrationSources();
  assert.equal(sources.at(-1).file, '059_field_sales_offer_business_conflicts.sql');
  assert.ok(!sources.some(s => s.file.startsWith('040_')));
  for (const source of sources) {
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(transactionBody(source.sql), /^\s*(?:commit|rollback)\s*;\s*$/im, source.file);
  }
});
test('reviewed transaction wrapping preserves PL/pgSQL bodies and rejects unmatched outer boundaries', () => {
  assert.equal(transactionBody('begin;\nselect 1;\ncommit;'), '\nselect 1;\n');
  assert.equal(transactionBody('select 1;'), 'select 1;');
  assert.throws(() => transactionBody('begin;\nselect 1;'), /not closed/);
  assert.throws(() => transactionBody('select 1;\ncommit;'), /Unexpected transaction boundary/);
});
