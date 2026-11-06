'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStagingTarget, migrationManifest } = require('../tools/staging-preflight.cjs');
const ref = 'abcdefghijklmnopqrst';
const env = { STAGING_PROJECT_REF: ref, STAGING_SUPABASE_URL: `https://${ref}.supabase.co`,
  STAGING_DATABASE_URL: `postgresql://postgres:synthetic@db.${ref}.supabase.co:5432/postgres?sslmode=no-verify` };
test('native preflight requires exact explicitly confirmed isolated API and database identities', () => {
  assert.equal(loadStagingTarget(env, ref).ref, ref);
  assert.doesNotMatch(loadStagingTarget(env, ref).connectionString, /sslmode/);
  for (const changes of [{ STAGING_PROJECT_REF: 'nkccbnrduojnzjfrpwva' },
    { STAGING_PROJECT_REF: 'ulbzmgmxrqyipclrbohi' },
    { STAGING_PROJECT_REF: 'ngnskohzqijcmyhzmwnm' }, { STAGING_SUPABASE_URL: 'https://nkccbnrduojnzjfrpwva.supabase.co' },
    { STAGING_DATABASE_URL: env.STAGING_DATABASE_URL.replace('5432', '6543') },
    { STAGING_DATABASE_URL: env.STAGING_DATABASE_URL.replace('/postgres?', '/other?') },
    { STAGING_SUPABASE_URL: env.STAGING_SUPABASE_URL + '/rest/v1' }]) {
    assert.throws(() => loadStagingTarget({ ...env, ...changes }, changes.STAGING_PROJECT_REF || ref));
  }
  assert.throws(() => loadStagingTarget(env, 'unconfirmed'));
  assert.throws(() => loadStagingTarget({}, ref));
});
test('native preflight permits only exact project-bound session pooler identity', () => {
  assert.equal(loadStagingTarget({ ...env,
    STAGING_DATABASE_URL: `postgresql://postgres.${ref}:synthetic@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  }, ref).ref, ref);
  assert.throws(() => loadStagingTarget({ ...env,
    STAGING_DATABASE_URL: `postgresql://postgres.other:synthetic@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  }, ref));
});
test('native preflight rejects every known established project even with fully matching API and database identities', () => {
  for (const blocked of ['nkccbnrduojnzjfrpwva', 'ngnskohzqijcmyhzmwnm', 'ulbzmgmxrqyipclrbohi']) {
    assert.throws(() => loadStagingTarget({
      STAGING_PROJECT_REF: blocked,
      STAGING_SUPABASE_URL: `https://${blocked}.supabase.co`,
      STAGING_DATABASE_URL: `postgresql://postgres:synthetic@db.${blocked}.supabase.co:5432/postgres`,
    }, blocked), /established main, management and campaign projects are forbidden/);
  }
});
test('candidate native manifest is exact, checksummed, excludes draft 040 and never grants apply authorization', () => {
  const manifest = migrationManifest();
  assert.equal(manifest.length, 18);
  assert.equal(manifest[1].file, '014_create_commercial_consultation.sql');
  assert.equal(manifest.at(-1).file, '051_field_sales_company_installation.sql');
  assert.ok(manifest.every(row => /^[a-f0-9]{64}$/.test(row.sha256) && !row.file.startsWith('040')));
});
