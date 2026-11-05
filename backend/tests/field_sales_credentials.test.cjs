const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const ts = require('typescript');
const { createSalesFixture } = require('./helpers/field_sales_fixture.cjs');
const { evaluate } = require('./helpers/commercial_operations_fixture.cjs');
const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'migrations', '050_field_sales_credentials.sql'), 'utf8');

async function fixture(t) {
  const f = await createSalesFixture({ legacy: true }); t.after(() => f.db.close());
  await f.db.exec(migration); await f.enable();
  const rpc = f.client.rpc.bind(f.client);
  f.client.rpc = async (name, args) => {
    const types = {
      field_sales_reset_credentials: ['uuid', 'uuid', 'text', 'text'],
      field_sales_create_session: ['uuid', 'text', 'text', 'timestamptz', 'text']
    }[name];
    if (!types) return rpc(name, args);
    try {
      const out = await f.db.query(`select ${name}(${types.map((type, i) => `$${i + 1}::${type}`).join(',')}) result`,
        Object.values(args));
      return { data: out.rows[0].result, error: null };
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  };
  const source = ts.createSourceFile('route.ts', fs.readFileSync(path.join(root, 'app', 'api', 'v1', 'route.ts'), 'utf8'),
    ts.ScriptTarget.Latest, true);
  const printer = ts.createPrinter(), print = node => printer.printNode(ts.EmitHint.Unspecified, node, source);
  const functions = source.statements.filter(ts.isFunctionDeclaration);
  const names = ['getBearerToken', 'bytesToBase64Url', 'base64UrlToBytes', 'sha256Base64Url',
    'pbkdf2Sha256Base64Url', 'constantTimeEquals', 'randomTokenBase64Url', 'normalizeDashboardUsername',
    'salesLoginAllowed', 'getDashboardAuthUserFromSession', 'generateNumericPin', 'requireAdminToken'];
  let program = names.map(name => print(functions.find(node => node.name?.text === name))).join('\n');
  const actions = ['resetDashboardUserPin', 'updateDashboardUser', 'sendDashboardLoginInvite', 'createDashboardUser'];
  const branches = new Map();
  function walk(node) {
    if (ts.isCaseClause(node) && actions.includes(node.expression.text) && !branches.has(node.expression.text))
      branches.set(node.expression.text, node);
    ts.forEachChild(node, walk);
  }
  walk(functions.find(node => node.name?.text === 'POST'));
  for (const [action, branch] of branches) program += `
    async function ${action}(request,body={}) {
      const tasksDb=getDeliverablesDb(); let result; const extraPayload={};
      switch('${action}'){${print(branch)}} return Response.json({ok:true,...extraPayload});
    }`;
  program += `\nmodule.exports={${actions.join(',')}};`;
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(program, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText, { module, exports: module.exports, crypto: crypto.webcrypto, Buffer, TextEncoder, Uint8Array,
    Date, Response, console, btoa, atob, process: { env: f.env },
    DASHBOARD_SESSION_TOKEN_HEADER: 'authorization', DASHBOARD_SESSION_TTL_DAYS: 14,
    getDeliverablesDb: () => f.client, getConfiguredAnyAdminKey: () => '',
    NextResponse: Response, corsHeaders: () => ({}), sendMail: () => { throw Error('Email must not be used for recovery'); } });
  const adminPin = 'synthetic-management-password';
  const credentials = f.sales.newCredentials(adminPin);
  await f.db.query('update "Dashboard_Users" set "Pin_Salt"=$1,"Pin_Hash"=$2 where "User_ID" in ($3,$4)',
    [credentials.pinSalt, credentials.pinHash, f.actors.admin, f.actors.va]);
  const admin = await f.auth.dashboardLogin(new Request('https://fixture.invalid'),
    { username: 'ADMIN_FIXTURE', pin: adminPin });
  const va = await f.auth.dashboardLogin(new Request('https://fixture.invalid'),
    { username: 'STAFF_FIXTURE', pin: adminPin });
  const call = (action, body, token = admin.token) => module.exports[action](new Request('https://fixture.invalid/api/v1', {
    method: 'POST', headers: { authorization: 'Bearer ' + token }
  }), body);
  const login = (alias = 'a', pin = 'temporary-fixture-password-' + alias) =>
    f.auth.dashboardLogin(new Request('https://fixture.invalid'), { username: 'SALES' + alias.toUpperCase(), pin });
  const auth = evaluate('lib\\dashboardAuth.ts', {
    'node:crypto': crypto, '@/lib/supabase': { getSupabase: () => f.client, getSupabaseMgmt: () => f.client }
  }, { Buffer });
  const authenticate = token => auth.getDashboardAuthUserFromSession(new Request('https://fixture.invalid', {
    headers: { authorization: 'Bearer ' + token }
  }), { allowSales: true, touchSession: false });
  const row = async () => (await f.db.query('select * from "Dashboard_Users" where "User_ID"=$1', [f.actors.a])).rows[0];
  return { ...f, call, login, authenticate, row, admin, va };
}

test('SALES reset requires an ADMIN identity and an explicitly supplied 16+ character credential', async t => {
  const f = await fixture(t), before = await f.row(), sales = await f.login();
  for (const token of ['', f.va.token, sales.token]) {
    assert.equal((await f.call('resetDashboardUserPin',
      { userId: f.actors.a, pin: 'synthetic-replacement-password' }, token)).status, 403);
  }
  for (const pin of [undefined, '', '12345678', '123456789012345', '                ', 1234567890123456]) {
    assert.equal((await f.call('resetDashboardUserPin', { username: 'SALESA', pin })).status, 400);
  }
  assert.equal((await f.row()).Pin_Hash, before.Pin_Hash);
  assert.ok(await f.authenticate(sales.token));
});

test('disabled managed reset revokes every session, preserves enrollment, and works after explicit reactivation', async t => {
  const f = await fixture(t), a = await f.login(), second = await f.login(), b = await f.login('b');
  assert.ok(await f.authenticate(a.token)); assert.ok(await f.authenticate(second.token));
  assert.equal((await f.request('field-sales', 'POST', {
    action: 'account_state', operationId: crypto.randomUUID(), userId: f.actors.a, active: false
  })).status, 200);
  const recovered = await f.call('resetDashboardUserPin',
    { username: 'SALESA', pin: 'synthetic-replacement-password' });
  assert.equal(recovered.status, 200);
  const payload = (await recovered.json()).resetDashboardUserPin;
  assert.equal(payload.sessionsRevoked, true); assert.equal(payload.pinWasGenerated, false);
  assert.equal(payload.pin, undefined); assert.equal(payload.user.Pin_Hash, undefined);
  assert.equal(payload.user.Is_Disabled, true);
  assert.equal((await f.db.query('select active from field_sales_representatives where user_id=$1', [f.actors.a])).rows[0].active, false);
  assert.equal(await f.authenticate(a.token), null); assert.equal(await f.authenticate(second.token), null);
  assert.ok(await f.authenticate(b.token));
  assert.equal((await f.login('a', 'synthetic-replacement-password')).status, 403);
  assert.equal((await f.request('field-sales', 'POST', {
    action: 'account_state', operationId: crypto.randomUUID(), userId: f.actors.a, active: true
  })).status, 200);
  assert.equal((await f.login()).status, 401);
  const replacement = await f.login('a', 'synthetic-replacement-password');
  assert.match(replacement.token, /^h2s-sales:/); assert.ok(await f.authenticate(replacement.token));
  assert.equal(await f.authenticate(a.token), null);
});

test('active reset is atomic: failed session deletion rolls credential changes back; successful reset revokes all devices', async t => {
  const f = await fixture(t), a = await f.login(), second = await f.login(), before = await f.row();
  await f.db.exec(`create function recovery_fixture_failure() returns trigger language plpgsql as $$
    begin raise exception 'Synthetic deletion failure'; end $$;
    create trigger recovery_fixture_failure before delete on "Dashboard_Sessions"
    for each row execute function recovery_fixture_failure();`);
  assert.equal((await f.call('resetDashboardUserPin', {
    userId: f.actors.a, pin: 'synthetic-replacement-password'
  })).status, 500);
  assert.equal((await f.row()).Pin_Hash, before.Pin_Hash);
  assert.ok(await f.authenticate(a.token)); assert.ok(await f.authenticate(second.token));
  await f.db.exec('drop trigger recovery_fixture_failure on "Dashboard_Sessions"; drop function recovery_fixture_failure();');
  assert.equal((await f.call('resetDashboardUserPin', {
    userId: f.actors.a, pin: 'synthetic-replacement-password'
  })).status, 200);
  assert.equal((await f.row()).Is_Disabled, false);
  assert.equal(await f.authenticate(a.token), null); assert.equal(await f.authenticate(second.token), null);
  assert.equal((await f.db.query('select count(*)::int count from "Dashboard_Sessions" where "User_ID"=$1',
    [f.actors.a])).rows[0].count, 0);
});

test('a delayed login verified before reset cannot mint a session using the previous credential hash', async t => {
  const f = await fixture(t), rpc = f.client.rpc.bind(f.client);
  let intercepted = false;
  f.client.rpc = async (name, args) => {
    if (name === 'field_sales_create_session' && !intercepted) {
      intercepted = true;
      assert.equal((await f.call('resetDashboardUserPin', {
        userId: f.actors.a, pin: 'synthetic-replacement-password'
      })).status, 200);
    }
    return rpc(name, args);
  };
  assert.equal((await f.login()).status, 401); assert.equal(intercepted, true);
  assert.equal((await f.db.query('select count(*)::int count from "Dashboard_Sessions" where "User_ID"=$1',
    [f.actors.a])).rows[0].count, 0);
  assert.match((await f.login('a', 'synthetic-replacement-password')).token, /^h2s-sales:/);
});

test('generic roles/invites cannot alter SALES credentials and legacy VA PIN reset still generates a PIN', async t => {
  const f = await fixture(t), before = await f.row(), a = await f.login();
  for (const identifier of [{ userId: f.actors.a }, { username: 'SALESA' }]) {
    assert.equal((await f.call('sendDashboardLoginInvite', { ...identifier, forceEnable: true, role: 'ADMIN' })).status, 400);
    assert.equal((await f.call('updateDashboardUser', { ...identifier, role: 'VA' })).status, 404);
  }
  assert.equal((await f.call('createDashboardUser', {
    username: 'SYNTHETIC', displayName: 'Synthetic account', role: 'SALES'
  })).status, 400);
  assert.equal((await f.call('updateDashboardUser', { userId: f.actors.va, role: 'SALES' })).status, 400);
  const legacy = await f.call('resetDashboardUserPin', { userId: f.actors.va });
  assert.equal(legacy.status, 200);
  const payload = (await legacy.json()).resetDashboardUserPin;
  assert.match(payload.pin, /^\d{8}$/); assert.equal(payload.pinWasGenerated, true);
  assert.ok(await f.authenticate(f.va.token), 'Legacy reset session behavior is unchanged');
  assert.equal((await f.call('updateDashboardUser', { userId: f.actors.va, role: 'ADMIN' })).status, 200);
  assert.equal((await f.call('updateDashboardUser', { userId: f.actors.va, role: 'VA' })).status, 200);
  const explicit = await f.call('resetDashboardUserPin', { userId: f.actors.va, pin: '1234' });
  assert.equal(explicit.status, 200);
  assert.equal((await explicit.json()).resetDashboardUserPin.pin, '1234');
  assert.equal((await f.row()).Role, 'SALES'); assert.equal((await f.row()).Pin_Hash, before.Pin_Hash);
  assert.ok(await f.authenticate(a.token));
});

test('credential RPCs are service-role only and SQL reset rechecks ADMIN identity', async t => {
  const f = await fixture(t), credentials = f.sales.newCredentials('synthetic-replacement-password');
  const denied = await f.client.rpc('field_sales_reset_credentials', {
    p_actor: f.actors.va, p_user: f.actors.a, p_pin_salt: credentials.pinSalt, p_pin_hash: credentials.pinHash
  });
  assert.equal(denied.error.code, '42501');
  for (const role of ['anon', 'authenticated']) {
    const result = await f.db.query(`select has_function_privilege($1,
      'public.field_sales_reset_credentials(uuid,uuid,text,text)','execute') reset,
      has_function_privilege($1,'public.field_sales_create_session(uuid,text,text,timestamptz,text)','execute') login`, [role]);
    assert.equal(result.rows[0].reset, false); assert.equal(result.rows[0].login, false);
  }
});

test('recovery works with feature gates off and missing atomic RPCs fail closed without legacy fallback', async t => {
  const f = await fixture(t), existing = await f.login();
  f.env.H2S_FIELD_SALES_ENABLED = 'false';
  await f.db.exec('update field_sales_settings set enabled=false');
  assert.equal((await f.call('resetDashboardUserPin', {
    userId: f.actors.a, pin: 'synthetic-replacement-password'
  })).status, 200);
  assert.equal(await f.authenticate(existing.token), null);
  f.env.H2S_FIELD_SALES_ENABLED = 'true';
  await f.db.exec('update field_sales_settings set enabled=true');
  const before = await f.row();
  await f.db.exec('drop function public.field_sales_reset_credentials(uuid,uuid,text,text)');
  assert.equal((await f.call('resetDashboardUserPin', {
    userId: f.actors.a, pin: 'synthetic-second-replacement-password'
  })).status, 500);
  assert.equal((await f.row()).Pin_Hash, before.Pin_Hash);
  await f.db.exec('drop function public.field_sales_create_session(uuid,text,text,timestamptz,text)');
  assert.equal((await f.login('a', 'synthetic-replacement-password')).status, 500);
  assert.equal((await f.db.query('select count(*)::int count from "Dashboard_Sessions" where "User_ID"=$1',
    [f.actors.a])).rows[0].count, 0);
  assert.equal((await f.call('resetDashboardUserPin', { userId: f.actors.va })).status, 200);
});
