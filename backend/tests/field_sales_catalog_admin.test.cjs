const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const fs = require('node:fs'), path = require('node:path');
const { createSalesFixture } = require('./helpers/field_sales_fixture.cjs');
const { evaluate } = require('./helpers/commercial_operations_fixture.cjs');
async function fixture() {
  const f = await createSalesFixture();
  for (const name of ['044_field_sales_transactions.sql', '048_field_sales_catalog_administration.sql']) {
    await f.db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', name), 'utf8'));
  }
  const prior = f.client.rpc.bind(f.client), casts = {
    field_sales_catalog_admin_read: ['uuid', 'uuid'], field_sales_catalog_admin_command: ['uuid', 'uuid', 'text', 'jsonb'],
  };
  f.client.rpc = async (name, args) => {
    if (!casts[name]) return prior(name, args);
    try {
      const values = Object.values(args).map(value => value && typeof value === 'object' ? JSON.stringify(value) : value);
      const result = await f.db.query(`select ${name}(${values.map((_, n) => '$' + (n + 1) + '::' + casts[name][n]).join(',')}) result`, values);
      return { data: result.rows[0].result, error: null };
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  };
  const imports = { '@/lib/fieldSales': f.sales, '@/lib/supabase': { getSupabase: () => f.client },
    '@/lib/adminAuth': { corsHeaders: () => ({}) }, '@/lib/commercial_business': f.business };
  const engine = evaluate('lib\\fieldQuote.ts', imports); imports['@/lib/fieldQuote'] = engine;
  const route = evaluate('app\\api\\field-sales-catalog\\route.ts', imports, { process: { env: f.env } });
  const request = (method = 'GET', body, actor = 'admin', query = '') => route[method](new Request('https://fixture.invalid/api/field-sales-catalog' + query,
    { method, headers: { authorization: 'Bearer ' + actor, 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) }));
  const post = (body, actor) => request('POST', { operationId: crypto.randomUUID(), ...body }, actor);
  const definition = { currency: 'usd', validForMinutes: 180, services: [
    { id: 'tv_mounting', label: 'Synthetic TV mounting', markets: ['residential', 'commercial'], offers: [{
      id: 'standard', label: 'Synthetic size/quantity tier', enabled: true, unitCents: 10001, basis: 'per_unit',
      minimum: 1, maximum: 10, starting: false, equipment: ['Synthetic fixed mount'], scope: ['Synthetic surveyed installation'],
      exclusions: ['Structural work requires approval'], questions: [], options: [], qualifications: [],
    }] },
    { id: 'cameras_owned', label: 'Synthetic customer-owned cameras', markets: ['residential', 'commercial'], offers: [{
      id: 'install', label: 'Synthetic camera installation', enabled: true, unitCents: 20000, basis: 'per_unit',
      minimum: 1, maximum: 16, starting: true, equipment: [], scope: ['Synthetic surveyed installation'],
      exclusions: ['Unsurveyed wiring requires approval'], questions: [], options: [], qualifications: [],
    }] },
  ] };
  return { ...f, request, post, definition };
}
test('catalog administration is separately default-off and ADMIN-only with explicit database errors', async t => {
  const f = await fixture(); t.after(() => f.db.close()); await f.enable();
  assert.equal((await (await f.request()).json()).enabled, false);
  assert.equal((await f.request('GET', null, 'a')).status, 403);
  assert.equal((await f.request('GET', null, 'va')).status, 403);
  assert.equal((await f.post({ action: 'create_draft', catalogId: crypto.randomUUID() })).status, 503);
  f.env.H2S_FIELD_CATALOG_ADMIN_ENABLED = 'true';
  assert.equal((await f.request()).status, 503);
  assert.equal((await f.db.query('select count(*)::int n from field_sales_catalogs')).rows[0].n, 0);
});
test('catalog draft/publication/retirement is versioned, checked, idempotent and cannot mutate accepted price versions', async t => {
  const f = await fixture(); t.after(() => f.db.close()); await f.enable();
  f.env.H2S_FIELD_CATALOG_ADMIN_ENABLED = 'true'; await f.db.exec('update field_sales_catalog_admin_settings set enabled=true');
  const catalogId = crypto.randomUUID(), operationId = crypto.randomUUID();
  const draft = { action: 'create_draft', operationId, catalogId, version: 'synthetic-launch-v1',
    definition: f.definition, sourceEvidence: { mode: 'isolated_test_only', approvalEvidence: null } };
  assert.equal((await f.post(draft)).status, 200);
  assert.equal((await (await f.post(draft)).json()).replayed, true);
  assert.equal((await f.post({ ...draft, version: 'changed-version' })).status, 409);
  const records = await (await f.request()).json(), row = records.catalogs[0];
  assert.equal(row.status, 'draft'); assert.match(row.digest, /^[a-f0-9]{64}$/);
  assert.equal((await f.post({ action: 'publish', catalogId, expectedDigest: 'a'.repeat(64), approvalEvidence: 'Synthetic approval' })).status, 409);
  assert.equal((await f.post({ action: 'publish', catalogId, expectedDigest: row.digest, approvalEvidence: '' })).status, 400);
  const publication = { action: 'publish', operationId: crypto.randomUUID(), catalogId, expectedDigest: row.digest,
    approvalEvidence: 'Synthetic approved prices/scope/equipment/taxes - isolated only' };
  assert.equal((await f.post(publication)).status, 200);
  assert.equal((await (await f.post(publication)).json()).replayed, true);
  assert.equal((await (await f.request()).json()).catalogs[0].status, 'published');
  await assert.rejects(f.db.query("update field_sales_catalogs set definition='{}' where catalog_id=$1", [catalogId]), /immutable/);
  assert.equal((await f.post({ action: 'retire', catalogId, expectedDigest: row.digest })).status, 200);
  assert.equal((await (await f.request()).json()).catalogs[0].status, 'retired');
  const unpricedId = crypto.randomUUID(), definition = structuredClone(f.definition);
  definition.validForMinutes = null;
  assert.equal((await f.post({ action: 'create_draft', catalogId: unpricedId, version: 'synthetic-incomplete', definition,
    sourceEvidence: { mode: 'isolated_test_only' } })).status, 200);
  const incomplete = (await (await f.request('GET', null, 'admin', '?catalogId=' + unpricedId)).json()).catalogs[0];
  assert.equal((await f.post({ action: 'publish', catalogId: unpricedId, expectedDigest: incomplete.digest, approvalEvidence: 'Synthetic approval' })).status, 503);
  const bad = structuredClone(f.definition); bad.services[0].label = { unsafe: 'not a string' };
  assert.equal((await f.post({ action: 'create_draft', catalogId: crypto.randomUUID(), version: 'synthetic-invalid',
    definition: bad, sourceEvidence: {} })).status, 503);
  const permission = (await f.db.query("select has_function_privilege('authenticated','field_sales_catalog_admin_command(uuid,uuid,text,jsonb)','EXECUTE') allowed")).rows[0];
  assert.equal(permission.allowed, false);
});
