const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const runner = require('../apply_migration_pg');
const ref = 'nkccbnrduojnzjfrpwva';
const direct = `postgresql://postgres:example@db.${ref}.supabase.co:5432/postgres?sslmode=require`;
const registeredTarget = () => runner.loadTarget('production', { DATABASE_URL_DIRECT: direct });
const target = () => {
  const config = registeredTarget();
  return {
    ...config,
    authorizedMigrations: config.authorizedMigrations.filter(version => version !== '031_commercial_reliability.sql'),
    commercial031: { ...config.commercial031, reviewOnly: true, authorization: undefined },
  };
};

test('registered production authorization includes exactly the owner-approved reviewed migration scope', () => {
  const config = registeredTarget();
  assert.deepEqual(config.authorizedMigrations, runner.migrations().map(file => file.version));
  assert.equal(config.commercial031.reviewOnly, false);
  assert.match(config.commercial031.authorization, /2026-10-20/);
  assert.equal(config.commercial031.sqlSha256, 'c0e2425df45f7bea99fa6d45dc9becd0dd99ccac80cee95417c8add00de1b071');
  assert.doesNotThrow(() => runner.authorizeApply(config, ref));
});

test('target is explicit, no MGMT or generic URL fallback, and exact project/session port is checked', () => {
  assert.throws(() => runner.loadTarget('missing', {}), /registered/);
  assert.throws(() => runner.loadTarget('production', { DATABASE_URL: direct }), /Missing DATABASE_URL_DIRECT/);
  for (const url of [direct.replace(ref, 'wrongproject'), direct.replace(':5432', ':6543'), direct.replace('/postgres?', '/other?')]) {
    assert.throws(() => runner.loadTarget('production', { DATABASE_URL_DIRECT: url }), /target mismatch/);
  }
  const config = target();
  assert.equal(config.environment, 'production');
  assert.equal(new URL(config.connectionString).searchParams.has('sslmode'), false);
  assert.doesNotThrow(() => runner.loadTarget('production', {
    DATABASE_URL_DIRECT: `postgresql://postgres.${ref}:example@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  }));
});

test('unknown/unapproved targets, missing baseline, missing confirmation, and extra migrations are blocked', () => {
  const config = target();
  assert.throws(() => runner.authorizeApply({ ...config, environment: 'unknown' }, ref), /unclassified/);
  assert.throws(() => runner.authorizeApply({ ...config, applyAuthorized: false }, ref), /authorized/);
  assert.throws(() => runner.authorizeApply(config, 'wrong'), /confirm-project/);
  assert.throws(() => runner.authorizeApply({ ...config, baselineSha256: null }, ref), /baseline/);
  assert.throws(() => runner.authorizeApply({ ...config, authorizedMigrations: [] }, ref), /scope/);
  assert.throws(() => runner.authorizeApply(config, ref), /scope/);
  const future = { ...config, authorizedMigrations: runner.migrations().map(file => file.version) };
  assert.throws(() => runner.authorizeApply(future, ref), /review-only/);
  assert.doesNotThrow(() => runner.authorizeApply({
    ...future, commercial031: { ...future.commercial031, reviewOnly: false, authorization: 'Local test only; no remote authority' },
  }, ref));
});

test('TLS requires a CA, keeps certificate/hostname verification, and rejects insecure global overrides', () => {
  assert.throws(() => runner.sslOptions({}), /MIGRATION_CA_CERT_PATH/);
  assert.throws(() => runner.sslOptions({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }), /forbidden/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'h2s-ca-test-'));
  const filename = path.join(directory, 'ca.crt');
  try {
    fs.writeFileSync(filename, tls.rootCertificates[0]);
    const ssl = runner.sslOptions({ MIGRATION_CA_CERT_PATH: filename });
    assert.equal(ssl.rejectUnauthorized, true);
    assert.equal(ssl.checkServerIdentity, undefined);
    assert.ok(ssl.ca.includes(tls.rootCertificates[0]));
    fs.writeFileSync(filename, 'not a certificate');
    assert.throws(() => runner.sslOptions({ MIGRATION_CA_CERT_PATH: filename }));
  } finally {
    fs.unlinkSync(filename);
    fs.rmdirSync(directory);
  }
});

test('only reviewed migrations are selected and history detects changed or out-of-order SQL', () => {
  const files = runner.migrations();
  assert.equal(files.length, 3);
  assert.deepEqual(files.map((file) => file.version), ['029_create_media_placements.sql', '030_owner_media_placement_fields.sql', '031_commercial_reliability.sql']);
  const config = target();
  const rows = files.map((file) => ({
    version: file.version, sha256: file.sha256, project_ref: ref, environment: 'production',
  }));
  assert.doesNotThrow(() => runner.checkHistory(rows, files, config));
  assert.throws(() => runner.checkHistory([{ ...rows[0], sha256: 'changed' }], files, config), /mismatch/);
  assert.throws(() => runner.checkHistory(rows.slice().reverse(), files, config), /mismatch/);
  assert.throws(() => runner.checkHistory([{ ...rows[0], project_ref: 'other' }], files, config), /mismatch/);
  assert.ok(files.every((file) => !/create table if not exists public\.(media_placements|owner_media_uploads)/i.test(file.sql)));
});

test('apply rolls back on unreviewed schema drift before running any migration or recording history', async () => {
  const queries = [];
  const client = { async query(sql) {
    queries.push(sql);
    return { rows: sql.includes('to_regclass') ? [{ name: null }] : [] };
  } };
  const config = target();
  const future = { ...config, authorizedMigrations: runner.migrations().map(file => file.version),
    commercial031: { ...config.commercial031, reviewOnly: false, authorization: 'Local test only; no remote authority' } };
  await assert.rejects(runner.apply(client, future, ref), /differs from.*baseline/);
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.ok(!queries.some((sql) => /create table|insert into|alter table/i.test(sql)));
});

test('programmatic apply also rejects 031 before making any database call', async () => {
  const client = { async query() { assert.fail('An unauthorized apply must not contact the database'); } };
  await assert.rejects(runner.apply(client, target(), ref), /scope/);
});

test('031 baseline accepts only the inspected catalog and detects untracked objects or policy drift', () => {
  const review = require('../lib/commercial_migration_review.cjs');
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'migration-baselines', '031_commercial_reliability.json'))).schema;
  assert.doesNotThrow(() => review.assertBaseline(baseline, target()));
  for (const field of ['relations', 'columns', 'indexes', 'policies', 'routines', 'triggers', 'defaultPrivileges']) {
    const changed = structuredClone(baseline);
    changed[field].push({ name: 'untracked-object' });
    assert.throws(() => review.assertBaseline(changed, target()), /differs/);
  }
  assert.throws(() => review.assertBaseline(baseline, { ...target(), commercial031: { ...target().commercial031, sqlSha256: 'changed' } }), /checksum/);
});
