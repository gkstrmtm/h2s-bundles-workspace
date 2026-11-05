const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { createSalesFixture } = require('./helpers/field_sales_fixture.cjs');
const { evaluate } = require('./helpers/commercial_operations_fixture.cjs');
test('real dashboard login tokens authenticate shared sales routes and retain default legacy role isolation', async t => {
  const f = await createSalesFixture(); t.after(() => f.db.close()); await f.enable();
  const auth = evaluate('lib\\dashboardAuth.ts', {
    'node:crypto': crypto, '@/lib/supabase': { getSupabase: () => f.client, getSupabaseMgmt: () => f.client },
  }, { Buffer });
  const imports = { 'node:crypto': crypto, '@/lib/supabase': { getSupabase: () => f.client },
    '@/lib/dashboardAuth': auth, '@/lib/commercial_business': f.business, '@/lib/adminAuth': { corsHeaders: () => ({}) } };
  const sales = evaluate('lib\\fieldSales.ts', imports, { process: { env: f.env }, Buffer });
  imports['@/lib/fieldSales'] = sales;
  const route = evaluate('app\\api\\field-sales\\route.ts', imports, { process: { env: f.env } });
  const login = alias => f.auth.dashboardLogin(new Request('https://fixture.invalid'), {
    username: 'SALES' + alias.toUpperCase(), pin: 'temporary-fixture-password-' + alias,
  });
  const a = await login('a'), b = await login('b');
  assert.match(a.token, /^h2s-sales:/); assert.match(b.token, /^h2s-sales:/);
  const request = (token, query = '') => new Request('https://fixture.invalid/api/field-sales' + query,
    { headers: { authorization: 'Bearer ' + token } });
  assert.equal(await auth.getDashboardAuthUserFromSession(request(a.token)), null, 'Default legacy auth does not opt into SALES');
  const shared = await auth.getDashboardAuthUserFromSession(request(a.token), { allowSales: true, touchSession: false });
  assert.equal(shared.userId, f.actors.a); assert.equal(shared.role, 'SALES');
  const created = await route.POST(new Request('https://fixture.invalid/api/field-sales', { method: 'POST',
    headers: { authorization: 'Bearer ' + a.token, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'create', operationId: crypto.randomUUID(), fullName: 'Synthetic session customer',
      phone: '+15550001901', address: '100 Fixture Lane', city: 'Fixture City', market: 'residential',
      services: ['tv_mounting'], notes: '' }) }));
  assert.equal(created.status, 200);
  const leadId = (await created.json()).leadId;
  assert.equal((await route.GET(request(a.token, '?leadId=' + leadId))).status, 200);
  assert.equal((await route.GET(request(b.token, '?leadId=' + leadId))).status, 404);
  assert.equal((await route.GET(request('altered-' + a.token))).status, 401);
  assert.equal((await f.auth.guardGET(new Request('https://fixture.invalid/api/v1?action=commercialQueue',
    { headers: { authorization: 'Bearer ' + a.token } }))).status, 403);
  await f.db.query('update "Dashboard_Sessions" set "Expires_At"=$1 where "User_ID"=$2', ['2000-01-01', f.actors.a]);
  assert.equal((await route.GET(request(a.token))).status, 401);
  await f.db.query('update "Dashboard_Users" set "Is_Disabled"=true where "User_ID"=$1', [f.actors.b]);
  assert.equal((await route.GET(request(b.token))).status, 401);
});
