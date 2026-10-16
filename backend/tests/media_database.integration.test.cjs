const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');
const runner = require('../apply_migration_pg');

test('real media database enforces framing, independent scopes, foreign keys and anonymous access', {
  skip: !process.env.H2S_MEDIA_DB_TEST_TARGET,
}, async () => {
  require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env.migrations.local'), quiet: true });
  require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env.local'), quiet: true });
  const target = runner.loadTarget(process.env.H2S_MEDIA_DB_TEST_TARGET);
  runner.authorizeApply(target, process.env.H2S_MEDIA_DB_TEST_PROJECT);
  const client = new Client({ connectionString: target.connectionString, ssl: runner.sslOptions(), connectionTimeoutMillis: 12000 });
  await client.connect();
  try {
    await client.query('BEGIN');
    const asset = (await client.query('select asset_id,to_jsonb(a) as original from public.proof_assets a order by asset_id limit 1')).rows[0];
    assert.ok(asset, 'A pre-existing proof asset is required; this test does not create or alter source media');
    const surface = `migration_probe_${crypto.randomBytes(6).toString('hex')}`;
    const insert = `insert into public.media_placements
      (proof_asset_id,surface,area,fit,focal_x,focal_y,zoom,updated_by)
      values ($1,$2,$3,'cover',25,75,$4,'rollback-only-verification') returning *`;
    await client.query(insert, [asset.asset_id, surface, 'first_frame', 1.5]);
    await client.query(insert, [asset.asset_id, surface, 'other_frame', 2]);
    const rows = (await client.query(`select asset_source,asset_id,area,zoom::float8 as zoom
      from public.media_placements where surface=$1 order by area`, [surface])).rows;
    assert.deepEqual(rows.map((row) => row.zoom), [1.5, 2]);
    assert.ok(rows.every((row) => row.asset_source === 'proof_asset' && row.asset_id === asset.asset_id));
    const invalid = async (sql, params, code = '23514') => {
      await client.query('SAVEPOINT invalid_value');
      await assert.rejects(client.query(sql, params), (error) => error.code === code);
      await client.query('ROLLBACK TO SAVEPOINT invalid_value');
    };
    for (const patch of ["zoom=0.9", "zoom=3.1", "focal_x=-1", "focal_y=101", "fit='stretch'", "display_order=1000", "owner_asset_id='invalid'"]) {
      await invalid(`update public.media_placements set ${patch} where surface=$1 and area='first_frame'`, [surface]);
    }
    await invalid("update public.media_placements set proof_asset_id=null where surface=$1 and area='first_frame'", [surface], '23502');
    await invalid(`update public.media_placements set proof_asset_id=$2 where surface=$1 and area='first_frame'`,
      [surface, crypto.randomUUID()], '23503');
    await invalid(insert, [asset.asset_id, surface, 'first_frame', 1.5], '23505');
    const after = (await client.query('select to_jsonb(a) as original from public.proof_assets a where asset_id=$1', [asset.asset_id])).rows[0];
    assert.equal(runner.digest(JSON.stringify(after.original)), runner.digest(JSON.stringify(asset.original)));
    await client.query('SAVEPOINT anonymous_access');
    await client.query('SET LOCAL ROLE anon');
    await assert.rejects(client.query('select * from public.media_placements limit 1'), (error) => error.code === '42501');
    await client.query('ROLLBACK TO SAVEPOINT anonymous_access');
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
