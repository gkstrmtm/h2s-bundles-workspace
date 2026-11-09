const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { createSalesFixture } = require('./helpers/field_sales_fixture.cjs');
const { evaluate } = require('./helpers/commercial_operations_fixture.cjs');
test('sales login and session checks accept legacy or NC role metadata and reject malformed or unauthorized roles',async t=>{
  const f=await createSalesFixture();t.after(()=>f.db.close());await f.enable();
  const rpc=f.client.rpc.bind(f.client);
  let access='SALES';
  f.client.rpc=(name,args)=>name==='field_sales_access'?Promise.resolve({data:access,error:null}):rpc(name,args);
  const login=()=>f.auth.dashboardLogin(new Request('https://fixture.invalid'),
    {username:'SALESA',pin:'temporary-fixture-password-a'});
  for(const value of ['SALES',{role:'SALES',doorToDoorLaunch:null},
    {role:'SALES',doorToDoorLaunch:{enabled:true,jurisdiction:'NC',municipality:'Charlotte'}}]){
    access=value;
    const result=await login();
    assert.match(result.token,/^h2s-sales:/);
    const request=new Request('https://fixture.invalid',{headers:{authorization:'Bearer '+result.token}});
    assert.equal((await f.auth.dashboardMe(request)).role,'SALES');
    access={role:'ADMIN'};
    assert.equal((await f.auth.dashboardMe(request)).status,401,'Session enrollment is revalidated');
  }
  for(const value of [null,{},[],[{role:'SALES'}],'ADMIN',{role:'ADMIN'},{role:true},{Role:'SALES'}]){
    access=value;
    assert.equal((await login()).status,403,JSON.stringify(value));
  }
  access={role:'SALES'};f.env.H2S_FIELD_SALES_ENABLED='false';
  assert.equal((await login()).status,403,'Metadata does not override the feature gate');
});
test('five real synthetic dashboard login tokens authenticate owned sales records and retain legacy isolation', async t => {
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
  const command = (token, body) => route.POST(new Request('https://fixture.invalid/api/field-sales', {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ operationId: crypto.randomUUID(), ...body })
  }));
  const credentials = f.sales.newCredentials('synthetic-management-password');
  await f.db.query('update "Dashboard_Users" set "Pin_Salt"=$1,"Pin_Hash"=$2 where "User_ID"=$3',
    [credentials.pinSalt, credentials.pinHash, f.actors.admin]);
  const manager = await f.auth.dashboardLogin(new Request('https://fixture.invalid'),
    { username: 'ADMIN_FIXTURE', pin: 'synthetic-management-password' });
  assert.ok(manager.token, manager.error);
  const tokens = [a.token, b.token];
  for (const alias of ['c', 'd', 'e']) {
    const userId = crypto.randomUUID(), pin = 'synthetic-isolated-password-' + alias;
    assert.equal((await command(manager.token, { action: 'account_create', operationId: userId,
      username: 'SYNTHETIC' + alias.toUpperCase(), displayName: 'Synthetic representative ' + alias, pin })).status, 200);
    assert.equal((await command(manager.token, { action: 'account_state', userId, active: true })).status, 200);
    const loggedIn = await f.auth.dashboardLogin(new Request('https://fixture.invalid'),
      { username: 'SYNTHETIC' + alias.toUpperCase(), pin });
    assert.match(loggedIn.token, /^h2s-sales:/);
    tokens.push(loggedIn.token);
  }
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
  const leads = [leadId];
  for (let index = 1; index < tokens.length; index++) {
    const result = await command(tokens[index], { action: 'create', fullName: 'Synthetic session customer ' + index,
      phone: '+155500019' + String(index + 1).padStart(2, '0'), address: '100 Fixture Lane',
      city: 'Fixture City', market: index === 4 ? 'commercial' : 'residential',
      services: ['tv_mounting', 'cameras_included'], notes: '' });
    assert.equal(result.status, 200);
    leads.push((await result.json()).leadId);
  }
  for (let owner = 0; owner < tokens.length; owner++) {
    assert.equal((await auth.getDashboardAuthUserFromSession(request(tokens[owner]),
      { allowSales: true, touchSession: false })).role, 'SALES');
    for (let viewer = 0; viewer < tokens.length; viewer++) {
      assert.equal((await route.GET(request(tokens[viewer], '?leadId=' + leads[owner]))).status,
        owner === viewer ? 200 : 404);
    }
  }
  assert.equal((await f.auth.guardGET(new Request('https://fixture.invalid/api/v1?action=commercialQueue',
    { headers: { authorization: 'Bearer ' + a.token } }))).status, 403);
  await f.db.query('update "Dashboard_Sessions" set "Expires_At"=$1 where "User_ID"=$2', ['2000-01-01', f.actors.a]);
  assert.equal((await route.GET(request(a.token))).status, 401);
  await f.db.query('update "Dashboard_Users" set "Is_Disabled"=true where "User_ID"=$1', [f.actors.b]);
  assert.equal((await route.GET(request(b.token))).status, 401);
});
