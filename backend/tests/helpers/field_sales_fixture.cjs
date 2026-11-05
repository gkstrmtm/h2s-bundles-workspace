const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), vm = require('node:vm'), ts = require('typescript');
const { createBusinessFixture, id } = require('./commercial_business_fixture.cjs');
const { evaluate } = require('./commercial_operations_fixture.cjs');
async function createSalesFixture() {
  const f = await createBusinessFixture();
  await f.db.exec(`alter table "Dashboard_Users" add column "Pin_Salt" text,add column "Pin_Hash" text,
    add column "Created_At" timestamptz default now(),add column "Updated_At" timestamptz default now(),
    add column "Last_Login_At" timestamptz,add column "Email" text;
    create unique index sales_fixture_username on "Dashboard_Users"("Username");
    create table "Dashboard_Sessions"("Session_ID" uuid primary key default gen_random_uuid(),"User_ID" uuid references "Dashboard_Users",
      "Token_Hash" text,"Created_At" timestamptz,"Expires_At" timestamptz,"Last_Seen_At" timestamptz,"Device" text);
    alter table commercial_leads add column public_token text unique default gen_random_uuid()::text,
      add column service_needs jsonb default '[]',add column assessment_answers jsonb default '{}',
      add column project_photo_urls jsonb default '[]',add column notes text,add column last_submitted_at timestamptz default now();
    alter table commercial_leads alter column lead_id set default gen_random_uuid();
    alter table commercial_consultation_requests add column submission_key text,add column response_token text;`);
  const migrations = name => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', name), 'utf8');
  await f.db.exec(migrations('037_residential_inquiries.sql'));
  await f.db.exec(migrations('043_field_sales.sql'));
  const env = { H2S_FIELD_SALES_ENABLED: 'true', SUPABASE_URL: 'https://fixture.invalid', SUPABASE_URL_MGMT: 'https://fixture.invalid' };
  const from = f.client.from.bind(f.client), rpc = f.client.rpc.bind(f.client);
  f.client.from = table => {
    const b = from(table); b.returns = () => b; b.ilike = (key, value) => b.eq(key, value);
    b.insert = async value => {
      try {
        const keys = Object.keys(value);
        const out = await f.db.query(`insert into "${table}"(${keys.map(key => `"${key}"`).join(',')}) values(${keys.map((_, n) => '$' + (n + 1)).join(',')})`, Object.values(value));
        return { data: out.rows, error: null };
      } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    };
    b.delete = () => ({ eq: async (key, value) => {
      await f.db.query(`delete from "${table}" where "${key}"=$1`, [value]); return { error: null };
    } });
    return b;
  };
  const casts = { field_sales_access: ['uuid'], field_sales_read: ['uuid', 'uuid'], field_sales_command: ['uuid', 'uuid', 'text', 'jsonb'],
    field_sales_photo: ['uuid', 'uuid', 'uuid', 'jsonb', 'boolean'] };
  const calls = [];
  f.client.rpc = async (name, args) => {
    if (!casts[name]) return rpc(name, args);
    calls.push(name);
    try {
      const values = Object.values(args).map(value => value && typeof value === 'object' ? JSON.stringify(value) : value);
      const result = await f.db.query(`select ${name}(${values.map((_, n) => `$${n + 1}::${casts[name][n]}`).join(',')}) result`, values);
      return { data: result.rows[0].result, error: null };
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  };
  const actors = { admin: id(9), va: id(10), a: id(20), b: id(21) };
  const imports = { 'node:crypto': crypto, '@/lib/supabase': { getSupabase: () => f.client }, '@/lib/adminAuth': { corsHeaders: () => ({}) },
    '@/lib/commercial_business': f.business, '@/lib/dashboardAuth': { getDashboardAuthUserFromSession: async (request, opts) => {
      if (opts.touchSession !== false || opts.allowSales !== true) throw Error('Expected explicit isolated sales authentication');
      const uid = actors[request.headers.get('authorization')?.replace('Bearer ', '')];
      if (!uid) return null;
      const row = (await f.db.query('select * from "Dashboard_Users" where "User_ID"=$1', [uid])).rows[0];
      return row && !row.Is_Disabled ? { userId: uid, username: row.Username, role: row.Role } : null;
    } } };
  const globals = { process: { env }, Buffer, Blob, Headers, AbortController };
  const sales = evaluate('lib\\fieldSales.ts', imports, globals); imports['@/lib/fieldSales'] = sales;
  const routes = Object.fromEntries(['field-sales', 'field-sales-photos'].map(name => [name, evaluate(`app\\api\\${name}\\route.ts`, imports, globals)]));
  const request = (name = 'field-sales', method = 'GET', body, actor = 'admin', query = '') => routes[name][method](new Request('https://fixture.invalid/api/' + name + query,
    { method, headers: { authorization: 'Bearer ' + actor, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  async function enable() {
    await f.db.exec('update field_sales_settings set enabled=true');
    for (const [actor, uid] of Object.entries(actors).filter(([actor]) => ['a', 'b'].includes(actor))) {
      const credentials = sales.newCredentials('temporary-fixture-password-' + actor);
      await f.db.query(`insert into "Dashboard_Users"("User_ID","Username","Display_Name","Role","Is_Disabled","Pin_Salt","Pin_Hash")
        values($1,$2,$2,'SALES',false,$3,$4)`, [uid, 'SALES' + actor.toUpperCase(), credentials.pinSalt, credentials.pinHash]);
      await f.db.query('insert into field_sales_representatives(user_id,active,updated_at) values($1,true,now())', [uid]);
    }
  }
  const v1Path = path.join(__dirname, '..', '..', 'app', 'api', 'v1', 'route.ts'), source = fs.readFileSync(v1Path, 'utf8');
  const ast = ts.createSourceFile(v1Path, source, ts.ScriptTarget.Latest, true), printer = ts.createPrinter();
  const print = node => printer.printNode(ts.EmitHint.Unspecified, node, ast);
  const functions = ast.statements.filter(ts.isFunctionDeclaration);
  const helperNames = ['getBearerToken','bytesToBase64Url','base64UrlToBytes','sha256Base64Url','pbkdf2Sha256Base64Url',
    'constantTimeEquals','randomTokenBase64Url','normalizeDashboardUsername','salesLoginAllowed','getDashboardAuthUserFromSession'];
  let program = helperNames.map(name => print(functions.find(node => node.name?.text === name))).join('\n');
  for (const [method, actions] of [['GET', ['dashboardMe']], ['POST', ['dashboardLogin', 'dashboardLogout']]]) {
    const fn = functions.find(node => node.name?.text === method), cases = [];
    function walk(node) { if (ts.isCaseClause(node) && actions.includes(node.expression.text) && !cases.some(item => item.expression.text === node.expression.text)) cases.push(node); ts.forEachChild(node, walk); }
    walk(fn);
    for (const branch of cases) program += `\nasync function ${branch.expression.text}(request,body={}){ const tasksDb=getDeliverablesDb();let result;const extraPayload={};switch('${branch.expression.text}'){${print(branch)}}return result;}\n`;
    const prefix = fn.body.statements.slice(0, fn.body.statements.findIndex(node => print(node).includes("startsWith('h2s-sales:')")) + 1);
    program += `\nasync function guard${method}(request){${prefix.map(print).join('\n')}return Response.json({ok:true});}\n`;
  }
  program += '\nmodule.exports={dashboardLogin,dashboardMe,dashboardLogout,guardGET,guardPOST};';
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(program, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { module, exports: module.exports, crypto: crypto.webcrypto, Buffer, TextEncoder, Uint8Array, Date, URL, Response, console, btoa, atob,
      process: { env }, DASHBOARD_SESSION_TOKEN_HEADER: 'authorization', DASHBOARD_SESSION_TTL_DAYS: 14,
      getDeliverablesDb: () => f.client, NextResponse: Response, corsHeaders: () => ({}), missingActionResponse: () => new Response(null, { status: 400 }),
      getDashboardAuthAvailabilityError: () => null });
  return { ...f, env, sales, actors, request, enable, calls, auth: module.exports };
}
module.exports = { createSalesFixture, id };
