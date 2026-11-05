const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
const { createSalesFixture, id } = require('./helpers/field_sales_fixture.cjs');
const migration = () => fs.readFileSync(path.join(__dirname, '..', 'migrations', '045_field_sales_launch_contracts.sql'), 'utf8');
const prospect = n => ({ action: 'create', fullName: 'Synthetic launch customer', phone: '+155500015' + String(n).padStart(2, '0'),
  address: '100 Fixture Lane', city: 'Fixture City', market: 'residential', services: ['tv_mounting', 'cameras_owned'], notes: '' });
const post = (f, body, actor = 'admin') => f.request('field-sales', 'POST', { operationId: crypto.randomUUID(), ...body }, actor);
const read = (f, actor = 'admin', lead) => f.request('field-sales', 'GET', null, actor, lead ? '?leadId=' + lead : '');
function identityRpc(f) {
  const previous = f.client.rpc.bind(f.client);
  f.client.rpc = async (name, args) => {
    if (name !== 'field_sales_identity_command') return previous(name, args);
    try {
      const out = await f.db.query('select field_sales_identity_command($1::uuid,$2::uuid,$3::jsonb) result',
        [args.p_actor, args.p_operation, JSON.stringify(args.p_payload)]);
      return { data: out.rows[0].result, error: null };
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  };
}
test('launch migration leaves activation and historical identity untouched; new origin is immutable', async t => {
  const f = await createSalesFixture(); t.after(() => f.db.close()); await f.enable();
  const old = await (await post(f, prospect(1), 'a')).json();
  const baseline = (await f.db.query('select created_by,created_at from field_sales_opportunities where lead_id=$1', [old.leadId])).rows[0];
  await f.db.exec(migration()); identityRpc(f);
  const historical = await (await read(f, 'a', old.leadId)).json();
  assert.equal(historical.opportunity.originating_user_id, null, 'Do not backfill a guess from current owner');
  assert.equal(historical.opportunity.created_by, baseline.created_by);
  assert.equal(new Date(historical.opportunity.created_at).toISOString(), new Date(baseline.created_at).toISOString());
  await assert.rejects(f.db.query('update field_sales_opportunities set originating_user_id=$1 where lead_id=$2',
    [id(20), old.leadId]), /immutable/);
  const created = await (await post(f, { ...prospect(2), originating_user_id: id(21), created_by: id(9) }, 'a')).json();
  const record = await (await read(f, 'a', created.leadId)).json();
  assert.equal(record.opportunity.created_by, id(20));
  assert.equal(record.opportunity.originating_user_id, id(20));
  assert.equal((await post(f, { action: 'assign', leadId: created.leadId, ownerId: id(21),
    revision: record.opportunity.revision, note: 'Synthetic verified reassignment' })).status, 200);
  assert.equal((await read(f, 'a', created.leadId)).status, 404);
  const assigned = await (await read(f, 'b', created.leadId)).json();
  assert.equal(assigned.opportunity.owner_user_id, id(21));
  assert.equal(assigned.opportunity.originating_user_id, id(20));
  assert.equal(assigned.opportunity.created_by, id(20));
  for (const field of ['created_by', 'originating_user_id']) await assert.rejects(
    f.db.query(`update field_sales_opportunities set ${field}=$1 where lead_id=$2`, [id(9), created.leadId]), /immutable/);
  await assert.rejects(f.db.query('delete from field_sales_opportunities where lead_id=$1', [created.leadId]), /retained/);
  const listing = await (await read(f, 'b')).json();
  assert.equal(listing.opportunities[0].originating_user_id, id(20));
});
test('management start evidence is revisioned, idempotent, isolated and explicitly unsettable', async t => {
  const f = await createSalesFixture(); t.after(() => f.db.close()); await f.db.exec(migration()); identityRpc(f);
  const body = { action: 'representative_terms', operationId: crypto.randomUUID(), userId: id(20),
    commissionStartDate: '2026-11-04', commissionStartEvidence: 'Synthetic approved start evidence', termsRevision: 0 };
  assert.equal((await post(f, body)).status, 503);
  await f.enable();
  assert.equal((await post(f, body, 'a')).status, 403);
  assert.equal((await post(f, body, 'va')).status, 403);
  assert.equal((await post(f, body)).status, 200);
  assert.equal((await (await post(f, body)).json()).replayed, true);
  assert.equal((await post(f, { ...body, commissionStartDate: '2026-11-05' })).status, 409);
  assert.equal((await post(f, { ...body, operationId: crypto.randomUUID() })).status, 409);
  const own = await (await read(f, 'a')).json(), other = await (await read(f, 'b')).json();
  assert.equal(own.commissionProfile.commission_start_date, '2026-11-04');
  assert.equal(other.commissionProfile.commission_start_date, null);
  assert.deepEqual(other.representatives, []);
  const reps = (await (await read(f)).json()).representatives;
  assert.equal(reps.find(row => row.user_id === id(20)).commission_terms_revision, 1);
  for (const date of ['2026-02-30', '0000-01-01', '2026-1-4', undefined]) {
    assert.equal((await post(f, { ...body, operationId: crypto.randomUUID(), termsRevision: 1, commissionStartDate: date })).status, 400);
  }
  assert.equal((await post(f, { ...body, operationId: crypto.randomUUID(), termsRevision: 1,
    commissionStartDate: null, commissionStartEvidence: 'Policy correction pending review' })).status, 200);
  assert.equal((await (await read(f, 'a')).json()).commissionProfile.commission_start_date, null);
  const permissions = (await f.db.query(`select
    has_function_privilege('anon','field_sales_identity_command(uuid,uuid,jsonb)','EXECUTE') anonymous,
    has_function_privilege('authenticated','field_sales_read(uuid,uuid)','EXECUTE') direct_read,
    has_table_privilege('service_role','field_sales_representatives','UPDATE') direct_update`)).rows[0];
  assert.deepEqual(permissions, { anonymous: false, direct_read: false, direct_update: false });
});
test('five synthetic representatives retain own customer records without a headcount cap or production enrollment', async t => {
  const f = await createSalesFixture(); t.after(() => f.db.close()); await f.db.exec(migration()); await f.enable();
  for (const [index, alias] of ['c', 'd', 'e'].entries()) {
    const userId = crypto.randomUUID(); f.actors[alias] = userId;
    assert.equal((await post(f, { action: 'account_create', operationId: userId, username: 'SYNTHETIC' + alias.toUpperCase(),
      displayName: 'Synthetic representative ' + index, pin: 'synthetic-isolated-password-' + alias })).status, 200);
    assert.equal((await post(f, { action: 'account_state', userId, active: true })).status, 200);
  }
  for (const [index, alias] of ['a', 'b', 'c', 'd', 'e'].entries()) {
    const created = await (await post(f, prospect(10 + index), alias)).json();
    assert.equal(created.ok, true, created.error);
    for (const other of ['a', 'b', 'c', 'd', 'e'].filter(value => value !== alias)) assert.equal((await read(f, other, created.leadId)).status, 404);
    assert.equal((await (await read(f, alias)).json()).opportunities.length, 1);
  }
  assert.equal((await (await read(f)).json()).opportunities.length, 5);
});
