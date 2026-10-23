const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const utils = require('../lib/commercial_consultation.js');

const backend = path.resolve(__dirname, '..');
const trustedPhones = ['+15550000001', '+15550000002', '+15550000003'];
const forgedPhone = '+15550000099';
const sourceCache = new Map();
const slot = utils.buildSlotSuggestions(new Date())[0];

function evaluateTs(filename, source, imports, globals = {}) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console, URL, Request, Response, Buffer, Error,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), `Unexpected dependency (no live transports or SQL allowed): ${name}`);
      return imports[name];
    },
    ...globals,
  }, { filename });
  return module.exports;
}

function loadTs(relative, imports, globals) {
  if (!sourceCache.has(relative)) sourceCache.set(relative, fs.readFileSync(path.join(backend, relative), 'utf8'));
  return evaluateTs(relative, sourceCache.get(relative), imports, globals);
}

function pendingRequest() {
  return {
    request_id: 'request-fixture', lead_id: 'lead-fixture', reference_code: 'COM-ABCDEF',
    response_token: 'approval-token-fixture', status: 'pending', reminder_count: 0,
    next_reminder_at: '2000-01-01T00:00:00.000Z',
    selected_slot_start: slot.startIso,
    selected_slot_end: slot.endIso,
    metadata: {},
    assigned_technician_phone: forgedPhone, assigned_technician_name: 'Untrusted historical assignment',
  };
}

function fixture({ env = {}, requests = [], missingTable = null } = {}) {
  const environment = {
    NODE_ENV: 'test', COMMERCIAL_PUBLIC_BASE_URL: 'https://commercial.example.invalid',
    COMMERCIAL_CONSULTATION_TECH_PHONE: trustedPhones[0],
    COMMERCIAL_CONSULTATION_TECH_PHONES: `${trustedPhones[1]},${trustedPhones[0]}`,
    DISPATCH_PHONES: trustedPhones[2], COMMERCIAL_CONSULTATION_TECH_NAME: 'Configured technician',
    CRON_SECRET: 'fake-cron-secret-for-unit-tests',
    TWILIO_ACCOUNT_SID: 'fake-account', TWILIO_AUTH_TOKEN: 'fake-token', TWILIO_FROM_NUMBER: '+15550000004',
    ...env,
  };
  const calls = [];
  const sms = [];
  const network = [];
  let databaseAccess = 0;
  const tables = {
    commercial_leads: [{
      lead_id: 'lead-fixture', public_token: 'public-token-fixture', full_name: 'Fixture Contact',
      company_name: 'Fixture Company', phone: '+15550000005', email: 'fixture@example.invalid',
      service_needs: ['Cameras'], project_photo_urls: [],
      contact_preference: 'sms', attribution: { communicationConsent: { smsOptIn: true } },
    }],
    commercial_consultation_requests: requests.map(row => ({ ...row })),
    sms_threads: [], sms_messages: [],
  };
  const database = {
    async rpc(name, args) {
      const row = tables.commercial_consultation_requests.find(item => item.request_id === args.p_request_id);
      if (name === 'commercial_submit_request') {
        const saved = { request_id: 'request-fixture', reminder_count: 0, ...args.p_patch, lead_id: args.p_lead_id };
        tables.commercial_consultation_requests.push(saved);
        return { data: { request: saved, created: true }, error: null };
      }
      if (name === 'commercial_reschedule_request') {
        Object.assign(row, args.p_patch);
        return { data: { request: row, replayed: false }, error: null };
      }
      if (name === 'commercial_claim_effect') return { data: true, error: null };
      if (name === 'commercial_finish_effect') {
        row.metadata = { ...row.metadata, workflow: { ...row.metadata?.workflow, [args.p_kind]: { state: args.p_state, details: args.p_details } } };
        return { data: null, error: null };
      }
      throw new Error(`Unexpected RPC; DDL and unreviewed calls are forbidden: ${name}`);
    },
    from(table) {
      assert.ok(Object.hasOwn(tables, table), `Unexpected database table: ${table}`);
      const operation = { table, mode: 'select', filters: [], single: false, limit: Infinity };
      calls.push(operation);
      const query = new Proxy({}, {
        get(_, method) {
          if (method === 'then') return (resolve, reject) => Promise.resolve().then(() => {
            if (table === missingTable) return { data: null, error: { code: '42P01', message: `relation ${table} does not exist` } };
            let rows = tables[table].filter(row => operation.filters.every(filter => filter(row)));
            if (operation.mode === 'insert' || operation.mode === 'upsert') {
              const row = {
                request_id: 'request-fixture', thread_id: 'thread-fixture',
                ...operation.values,
              };
              tables[table].push(row);
              rows = [row];
            } else if (operation.mode === 'update') {
              for (const row of rows) Object.assign(row, operation.values);
            }
            rows = rows.slice(0, operation.limit);
            return { data: operation.single ? rows[0] || null : rows, error: null };
          }).then(resolve, reject);
          return (...args) => {
            if (['insert', 'upsert', 'update'].includes(method)) {
              operation.mode = method;
              operation.values = args[0];
            } else if (method === 'eq') operation.filters.push(row => row[args[0]] === args[1]);
            else if (method === 'in') operation.filters.push(row => args[1].includes(row[args[0]]));
            else if (method === 'lte') operation.filters.push(row => row[args[0]] != null && row[args[0]] <= args[1]);
            else if (method === 'limit') operation.limit = args[0];
            else if (method === 'single' || method === 'maybeSingle') operation.single = true;
            else assert.ok(['select', 'order'].includes(method), `Unexpected database operation: ${method}`);
            return query;
          };
        },
      });
      return query;
    },
  };
  const imports = {
    '@/lib/supabase': { getSupabase: () => { databaseAccess += 1; return database; } },
    '@/lib/commercial_consultation.js': utils,
    twilio: () => ({
      messages: { create: async message => {
        sms.push(message);
        return { sid: `fake-${sms.length}`, status: 'queued' };
      } },
    }),
    'node:crypto': crypto,
    'next/server': { NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), {
      ...options, headers: { 'Content-Type': 'application/json', ...options.headers },
    }) } },
  };
  const globals = {
    process: { env: environment },
    fetch: async (...args) => {
      network.push(args);
      throw new Error('Unexpected network or appointment call');
    },
  };
  imports['@/lib/sms_delivery'] = loadTs('lib\\sms_delivery.ts', {}, globals);
  const runtime = loadTs('lib\\commercial_consultation_runtime.ts', imports, globals);
  imports['@/lib/commercial_consultation_runtime'] = runtime;
  return {
    runtime, calls, sms, network, tables,
    get databaseAccess() { return databaseAccess; },
    route: name => loadTs(`app\\api\\${name}\\route.ts`, imports, globals),
  };
}

function consultationRequest(body = {}) {
  return new Request('https://untrusted-api.example.invalid/api/commercial-consultation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Origin: 'https://localhost.attacker.example.invalid',
      Host: 'attacker.example.invalid', 'X-Forwarded-Host': 'attacker.example.invalid', 'X-Forwarded-Proto': 'http',
    },
    body: JSON.stringify({
      publicToken: 'public-token-fixture', selectedSlotStart: slot.startIso,
      selectedSlotEnd: slot.endIso, ...body,
    }),
  });
}

function maintenanceRequest(method, headers = {}, query = '') {
  return new Request(`https://attacker.example.invalid/api/commercial-consultation-maintenance${query}`, {
    method, headers: { Origin: 'https://attacker.example.invalid', ...headers },
  });
}

function assertNoEffects(f) {
  assert.equal(f.databaseAccess, 0);
  assert.equal(f.calls.length, 0);
  assert.equal(f.sms.length, 0);
  assert.equal(f.network.length, 0);
}

test('public create and reschedule ignore both assignment naming conventions and use canonical approval links', async t => {
  for (const mode of ['create', 'reschedule']) {
    for (const naming of ['camel', 'snake']) {
      await t.test(`${mode}: ${naming}`, async () => {
        const f = fixture({ requests: mode === 'reschedule' ? [pendingRequest()] : [] });
        const forged = naming === 'camel'
          ? { assignedTechnicianPhone: forgedPhone, assignedTechnicianName: 'Attacker' }
          : { assigned_technician_phone: forgedPhone, assigned_technician_name: 'Attacker' };
        const response = await f.route('commercial-consultation').POST(consultationRequest({
          mode, requestId: 'request-fixture', ...forged,
        }));
        assert.equal(response.status, mode === 'create' ? 201 : 200, JSON.stringify(await response.clone().json()));
        const saved = f.tables.commercial_consultation_requests[0];
        assert.equal(saved.assigned_technician_phone, trustedPhones[0]);
        assert.equal(saved.assigned_technician_name, 'Configured technician');
        assert.deepEqual(f.sms.map(message => message.to), [...trustedPhones, '+15550000005']);
        for (const message of f.sms.slice(0, trustedPhones.length)) {
          assert.ok(message.body.includes(`https://commercial.example.invalid/commercial-approval?token=${saved.response_token}`));
          assert.ok(!message.body.includes('attacker.example.invalid'));
        }
        assert.equal(f.network.length, 0);
      });
    }
  }
});

test('maintenance ignores poisoned historical assignments and still sends configured technician reminders', async () => {
  const f = fixture({ requests: [pendingRequest()] });
  const response = await f.route('commercial-consultation-maintenance').GET(maintenanceRequest('GET', {
    Authorization: 'Bearer fake-cron-secret-for-unit-tests', 'x-vercel-cron': '1',
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(f.sms.map(message => message.to), trustedPhones);
  assert.ok(f.sms.every(message => message.body.includes('https://commercial.example.invalid/commercial-approval?token=approval-token-fixture')));
  assert.equal(f.tables.commercial_consultation_requests[0].assigned_technician_phone, forgedPhone);
  assert.equal(f.tables.commercial_consultation_requests[0].reminder_count, 1);
  assert.equal(f.network.length, 0);
});

test('public call configuration respects explicit overrides and otherwise uses the configured owned sender', async () => {
  for (const [env, expected] of [
    [{}, '+15550000004'],
    [{ PUBLIC_PHONE_NUMBER: '+15550000011' }, '+15550000011'],
    [{ COMMERCIAL_CALL_NUMBER: '+15550000012', PUBLIC_PHONE_NUMBER: '+15550000011' }, '+15550000012'],
    [{ TWILIO_FROM_NUMBER: '', TWILIO_PHONE_NUMBER: '+15550000013' }, '+15550000013'],
  ]) {
    const f = fixture({ env });
    const response = await f.route('commercial-intake').GET(new Request('https://untrusted.example.invalid/api/commercial-intake'));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.config.callNumber, expected);
    assert.equal(payload.config.publicBaseUrl, 'https://commercial.example.invalid');
    assert.equal(f.sms.length, 0);
    assert.equal(f.network.length, 0);
  }
});

test('dispatch SMS keeps the review URL separate from safe text-reply instructions', async () => {
  for (const rescheduled of [false, true]) {
    const pending = pendingRequest();
    if (rescheduled) pending.metadata.last_reschedule_key = 'fixture-reschedule';
    const f = fixture({ requests: [pending] });
    const row = f.tables.commercial_consultation_requests[0];
    const sent = await f.runtime.sendTechnicianConsultationRequest(row, f.tables.commercial_leads[0]);
    const lines = sent.body.split('\n');
    assert.equal(lines.filter(line => line.startsWith('https://')).length, 1);
    assert.ok(lines.includes(sent.links.reviewUrl));
    assert.equal(new URL(sent.links.reviewUrl).searchParams.has('action'), false);
    assert.ok(sent.body.includes(`${sent.links.reviewUrl}\n\n`));
    if (rescheduled) {
      assert.match(sent.body, /text replies cannot approve a rescheduled window/);
      assert.doesNotMatch(sent.body, /Or reply YES/);
    } else {
      assert.match(sent.body, /Or reply YES COM-ABCDEF or NO COM-ABCDEF\./);
    }
    assert.deepEqual(f.sms.map(message => message.to), trustedPhones);
    assert.equal(f.network.length, 0);
  }
});

test('historically assigned but unconfigured phones cannot authorize technician SMS replies', async () => {
  const f = fixture({ requests: [pendingRequest()] });
  assert.equal(await f.runtime.findConsultationForTechnicianReply(forgedPhone, 'YES COM-ABCDEF'), null);
  assert.equal(await f.runtime.findConsultationForTechnicianReply(forgedPhone, 'YES'), null);
  assert.equal(await f.runtime.loadConsultationContextByReference('COM-ABCDEF', forgedPhone), null);
  assertNoEffects(f);
  f.tables.commercial_consultation_requests[0].assigned_technician_phone = trustedPhones[0];
  const context = await f.runtime.findConsultationForTechnicianReply(trustedPhones[0], 'YES COM-ABCDEF');
  assert.equal(context.consultation.request_id, 'request-fixture');
});

test('canonical URL fallbacks are explicit and HTTP is confined to configured nonproduction loopback', () => {
  for (const key of ['COMMERCIAL_PUBLIC_BASE_URL', 'PUBLIC_SITE_URL', 'NEXT_PUBLIC_SITE_URL']) {
    const f = fixture({ env: { COMMERCIAL_PUBLIC_BASE_URL: undefined, [key]: 'https://canonical.example.invalid/' } });
    assert.equal(f.runtime.getPublicBaseUrl(), 'https://canonical.example.invalid');
  }
  for (const origin of ['http://localhost:3198', 'http://127.0.0.1:3198', 'http://[::1]:3198']) {
    assert.equal(fixture({ env: { COMMERCIAL_PUBLIC_BASE_URL: origin } }).runtime.getPublicBaseUrl(), origin);
    for (const flag of ['NODE_ENV', 'VERCEL_ENV']) {
      assert.throws(() => fixture({ env: { [flag]: 'production', COMMERCIAL_PUBLIC_BASE_URL: origin } }).runtime.getPublicBaseUrl(), /canonical HTTPS origin/);
    }
  }
});

test('intake config ignores request Origin and Host, including localhost origins', async () => {
  for (const origin of ['https://attacker.example.invalid', 'http://localhost:3197', 'null']) {
    const f = fixture();
    const response = await f.route('commercial-intake').GET(new Request('https://attacker.example.invalid/api/commercial-intake', {
      headers: { Origin: origin, Host: 'attacker.example.invalid', 'X-Forwarded-Host': 'attacker.example.invalid' },
    }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).config.publicBaseUrl, 'https://commercial.example.invalid');
    assertNoEffects(f);
  }
});

test('plural-only configured technicians work without a public assignment override', async () => {
  const f = fixture({ env: {
    COMMERCIAL_CONSULTATION_TECH_PHONE: undefined, DISPATCH_PHONES: undefined,
    COMMERCIAL_CONSULTATION_TECH_PHONES: trustedPhones[1], COMMERCIAL_CONSULTATION_TECH_NAME: undefined,
  } });
  const response = await f.route('commercial-consultation').POST(consultationRequest());
  assert.equal(response.status, 201);
  assert.equal(f.tables.commercial_consultation_requests[0].assigned_technician_phone, trustedPhones[1]);
  assert.equal(f.tables.commercial_consultation_requests[0].assigned_technician_name, null);
  assert.deepEqual(f.sms.map(message => message.to), [trustedPhones[1], '+15550000005']);
});

test('missing or invalid canonical configuration fails before intake, consultation, or maintenance effects', async () => {
  for (const base of [
    undefined, 'not a URL', 'http://external.example.invalid', 'http://localhost.attacker.example.invalid',
    'https://user:password@example.invalid', 'https://canonical.example.invalid/path',
    'https://canonical.example.invalid/?query=1', 'https://canonical.example.invalid/#fragment',
  ]) {
    for (const name of ['commercial-intake', 'commercial-consultation', 'commercial-consultation-maintenance']) {
      const f = fixture({ env: { COMMERCIAL_PUBLIC_BASE_URL: base } });
      const route = f.route(name);
      const response = name === 'commercial-consultation-maintenance'
        ? await route.GET(maintenanceRequest('GET', { Authorization: 'Bearer fake-cron-secret-for-unit-tests' }))
        : await route.POST(name === 'commercial-intake'
          ? new Request('https://attacker.example.invalid/api/commercial-intake', {
            method: 'POST', body: JSON.stringify({ email: 'fixture@example.invalid', contactPreference: 'email' }),
          }) : consultationRequest());
      assert.equal(response.status, 503, `${name}: ${base}`);
      assert.match((await response.json()).error, /COMMERCIAL_PUBLIC_BASE_URL/);
      assertNoEffects(f);
    }
  }
});

test('invalid or missing technician configuration cannot be rescued by public assignment fields', async () => {
  for (const phone of [undefined, 'invalid phone']) {
    for (const name of ['commercial-consultation', 'commercial-consultation-maintenance']) {
      const f = fixture({ env: {
        COMMERCIAL_CONSULTATION_TECH_PHONE: phone,
        COMMERCIAL_CONSULTATION_TECH_PHONES: undefined, DISPATCH_PHONES: undefined,
      } });
      const route = f.route(name);
      const response = name === 'commercial-consultation'
        ? await route.POST(consultationRequest({ assignedTechnicianPhone: forgedPhone }))
        : await route.GET(maintenanceRequest('GET', { Authorization: 'Bearer fake-cron-secret-for-unit-tests' }));
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /technician phone configuration|COMMERCIAL_CONSULTATION_TECH_PHONE/);
      assertNoEffects(f);
    }
  }
  const partial = fixture({ env: { COMMERCIAL_CONSULTATION_TECH_PHONES: 'invalid phone' } });
  assert.throws(() => partial.runtime.getTechnicianPhones(), /COMMERCIAL_CONSULTATION_TECH_PHONES/);
  assertNoEffects(partial);
});

test('GET and POST maintenance reject forged cron headers, query secrets, malformed and incorrect credentials', async () => {
  for (const method of ['GET', 'POST']) {
    for (const headers of [
      {}, { 'x-vercel-cron': '1' }, { Authorization: 'Bearer wrong', 'x-vercel-cron': '1' },
      { Authorization: 'Bearer fake-cron-secret-for-unit-testX' },
      { Authorization: 'Basic fake-cron-secret-for-unit-tests' },
      { Authorization: 'Bearer fake-cron-secret-for-unit-tests extra' },
      { 'x-maintenance-token': 'fake-cron-secret-for-unit-tests' },
    ]) {
      const f = fixture();
      const response = await f.route('commercial-consultation-maintenance')[method](maintenanceRequest(method, headers));
      assert.equal(response.status, 401);
      assert.match((await response.json()).error, /Unauthorized/);
      assertNoEffects(f);
    }
    const f = fixture();
    const response = await f.route('commercial-consultation-maintenance')[method](
      maintenanceRequest(method, {}, '?token=fake-cron-secret-for-unit-tests'));
    assert.equal(response.status, 401);
    assertNoEffects(f);
  }
});

test('valid cron bearer and dedicated manual header authentication preserve authorized maintenance', async () => {
  for (const method of ['GET', 'POST']) {
    for (const [env, headers] of [
      [{}, { Authorization: 'Bearer fake-cron-secret-for-unit-tests' }],
      [{ CRON_SECRET: undefined, COMMERCIAL_MAINTENANCE_TOKEN: 'fake-manual-token' }, { Authorization: 'Bearer fake-manual-token' }],
      [{ CRON_SECRET: undefined, COMMERCIAL_MAINTENANCE_TOKEN: 'fake-manual-token' }, { 'x-maintenance-token': 'fake-manual-token' }],
    ]) {
      const f = fixture({ env });
      const response = await f.route('commercial-consultation-maintenance')[method](maintenanceRequest(method, headers));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).ok, true);
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0].mode, 'select');
      assert.equal(f.sms.length, 0);
      assert.equal(f.network.length, 0);
    }
  }
});

test('missing maintenance secrets fail clearly and legacy unrelated secrets grant no maintenance authority', async () => {
  for (const method of ['GET', 'POST']) {
    const f = fixture({ env: {
      CRON_SECRET: ' ', COMMERCIAL_MAINTENANCE_TOKEN: undefined,
      NOTIFY_DRAIN_TOKEN: 'old-secret', DISPATCH_ADMIN_TOKEN: 'old-secret',
    } });
    const response = await f.route('commercial-consultation-maintenance')[method](maintenanceRequest(method, {
      Authorization: 'Bearer old-secret', 'x-vercel-cron': '1',
    }));
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /Configure CRON_SECRET/);
    assertNoEffects(f);
  }
});

test('missing commercial schema remains actionable without executing SQL or provisioning', async () => {
  for (const [table, lookup] of [
    ['commercial_leads', runtime => runtime.getLeadByToken('public-token-fixture')],
    ['commercial_leads', runtime => runtime.getLeadById('lead-fixture')],
    ['commercial_consultation_requests', runtime => runtime.getConsultationByToken('approval-token-fixture')],
    ['commercial_consultation_requests', runtime => runtime.findActiveConsultationForLead('lead-fixture')],
  ]) {
    const f = fixture({ missingTable: table });
    await assert.rejects(() => lookup(f.runtime), /reviewed versioned migration.*DATABASE_MIGRATIONS/);
    assert.equal(f.runtime.ensureCommercialConsultationTables, undefined);
    assert.ok(f.calls.every(call => call.mode === 'select'));
    assert.equal(f.sms.length, 0);
  }
  const f = fixture({ missingTable: 'commercial_consultation_requests' });
  const response = await f.route('commercial-consultation-maintenance').GET(maintenanceRequest('GET', {
    Authorization: 'Bearer fake-cron-secret-for-unit-tests',
  }));
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /Request-time schema setup is disabled/);
  assert.equal(f.sms.length, 0);
  for (const code of ['42P01', 'PGRST205', '42703', 'PGRST204']) {
    assert.match(f.runtime.commercialDatabaseErrorMessage({ code }), /reviewed versioned migration/);
  }
  for (const relative of [
    'lib\\commercial_consultation_runtime.ts', 'app\\api\\commercial-consultation-maintenance\\route.ts',
    'app\\api\\commercial-consultation\\route.ts', 'app\\api\\commercial-intake\\route.ts',
  ]) {
    const source = fs.readFileSync(path.join(backend, relative), 'utf8');
    assert.doesNotMatch(source, /ensureCommercialConsultationTables|\$executeRaw|@\/lib\/prisma|\b(?:create|alter|drop)\s+(?:table|policy|function|trigger|index|extension)\b/i);
  }
});

test('missing lead remains a 404 rather than a schema failure', async () => {
  const f = fixture();
  f.tables.commercial_leads.length = 0;
  const response = await f.route('commercial-consultation').POST(consultationRequest());
  assert.equal(response.status, 404);
  assert.equal(f.sms.length, 0);
  assert.ok(f.calls.every(call => call.mode === 'select'));
});

test('existing administrator guard preserves shared-key and ADMIN-session access', async () => {
  const filename = path.join(backend, 'app\\api\\v1\\route.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const guard = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'requireAdminToken');
  assert.ok(guard);
  for (const [configured, user, headers, expected] of [
    ['fake-admin-key', null, { 'x-h2s-admin-key': 'fake-admin-key' }, true],
    ['fake-admin-key', { role: 'ADMIN' }, {}, true],
    ['', { role: 'ADMIN' }, {}, true],
    ['fake-admin-key', null, {}, false],
    ['fake-admin-key', { role: 'VA' }, { 'x-h2s-admin-key': 'wrong' }, false],
    ['', { role: 'VA' }, {}, false],
  ]) {
    const isolated = evaluateTs(filename, `${guard.getText(ast)}\nmodule.exports = { requireAdminToken };`, {}, {
      getConfiguredAnyAdminKey: () => configured,
      getDashboardAuthUserFromSession: async () => user,
    });

    const result = await isolated.requireAdminToken(new Request('http://localhost/api/v1?action=commercialQueue', { headers }));
    assert.equal(result.ok, expected);
  }
});

test('the actual recovery action rejects public and VA callers before executing any retry', async () => {
  const filename = path.join(backend, 'app\\api\\v1\\route.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const guard = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'requireAdminToken');
  let recovery;
  function visit(node) {
    if (ts.isCaseClause(node) && node.expression.getText(ast) === "'commercialRecovery'") recovery = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(recovery);
  let retries = 0;
  const isolated = evaluateTs(filename, `${guard.getText(ast)}
    async function run(request) {const body={requestId:'fixture'};let result;switch('commercialRecovery'){${recovery.getText(ast)}}return Response.json(result);}
    module.exports={run};`, {}, {
    getConfiguredAnyAdminKey: () => 'fixture-admin-key',
    getDashboardAuthUserFromSession: async request => ({ role: request.headers.get('x-fixture-role') }),
    retryCommercialProcessing: async () => { retries++; return { ok: true }; },
    safeTrim: value => String(value || '').trim(), corsHeaders: () => ({}),
    NextResponse: { json: (body, options) => Response.json(body, options) },
  });
  for (const headers of [{}, { 'x-fixture-role': 'VA' }, { 'x-h2s-admin-key': 'wrong' }]) {
    const response = await isolated.run(new Request('http://localhost/api/v1?action=commercialRecovery', { headers }));
    assert.ok([401, 403].includes(response.status));
  }
  assert.equal(retries, 0);
  for (const headers of [{ 'x-fixture-role': 'ADMIN' }, { 'x-h2s-admin-key': 'fixture-admin-key' }]) {
    assert.equal((await isolated.run(new Request('http://localhost/api/v1?action=commercialRecovery', { headers }))).status, 200);
  }
  assert.equal(retries, 2);
});
