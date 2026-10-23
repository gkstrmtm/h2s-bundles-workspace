const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..', '..');
const id = n => `03200000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const compiled = new Map();
function evaluate(relative, imports, globals = {}) {
  const filename = path.join(root, relative);
  if (!compiled.has(filename)) compiled.set(filename, ts.transpileModule(fs.readFileSync(filename,'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText);
  const module = { exports: {} };
  vm.runInNewContext(compiled.get(filename), { module, exports: module.exports, console, URL, Request, Response, Date, Intl,
    setTimeout, clearTimeout, process: { env: { STRIPE_SECRET_KEY: 'sk_test_fixture_only', STRIPE_WEBHOOK_SECRET:'fixture_webhook_only' } },
    require(name) { assert.ok(Object.hasOwn(imports,name), `Unmocked dependency blocked: ${name}`); return imports[name]; }, ...globals }, { filename });
  return module.exports;
}
async function createOperationsFixture(env = {}) {
  const db = new PGlite(), calls = { stripe: [], mail: [], resolver: 0 }, faults = {};
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table "Dashboard_Users"("User_ID" uuid primary key,"Display_Name" text,"Username" text,"Role" text,"Is_Disabled" boolean);
    create table commercial_leads(lead_id uuid primary key,email text,phone text,project_address text,project_city text,
      project_state text,project_postal_code text,updated_at timestamptz default now(),revision bigint not null default 0,
      contact_preference text default 'email');
    create table commercial_consultation_requests(request_id uuid primary key,lead_id uuid,status text,selected_slot_start timestamptz,response_at timestamptz,
      next_reminder_at timestamptz,reminder_count integer,related_order_id text,metadata jsonb,created_at timestamptz default now());
    create table commercial_effects(request_id uuid,kind text,state text,details jsonb,updated_at timestamptz default now());
    create table h2s_orders(id uuid primary key,order_id text unique,total numeric,currency text,status text,
      session_id text,payment_intent_id text,commercial_request_id uuid,metadata_json jsonb,customer_name text,
      customer_email text,customer_phone text,phone text,address text,city text,state text,zip text,
      delivery_date date,delivery_time text,updated_at timestamptz default now());
    alter table h2s_orders add column created_at timestamptz default now(),add column service_name text,
      add column subtotal numeric,add column items text,add column special_instructions text;
    create table h2s_dispatch_jobs(job_id uuid primary key,order_id text,status text check(status in
      ('queued','assigned','in_progress','completed','cancelled','done')),due_at timestamptz,updated_at timestamptz default now());
    create table h2s_dispatch_job_assignments(assign_id text primary key default gen_random_uuid()::text,job_id text,pro_id text,state text,
      created_at timestamptz default now(),updated_at timestamptz default now());
    create table h2s_job_artifacts(artifact_id uuid primary key,job_id text,artifact_type text,url text,caption text,created_at timestamptz default now());
    create table h2s_jobs(job_id text primary key,customer_email text,status text);
    create table h2s_pros(pro_id uuid primary key,name text,is_active boolean not null default true);
    create table sms_messages(twilio_sid text,status text,created_at timestamptz default now());
    create table h2s_payouts_ledger(payout_id uuid primary key default gen_random_uuid(),job_id text references h2s_jobs(job_id),
      pro_id uuid references h2s_pros(pro_id),payout_type text,
      amount numeric,total_amount numeric,status text,week_start date,
      unique(job_id,pro_id,payout_type));
    insert into "Dashboard_Users" values('${id(9)}','Fixture Admin','ADMIN_FIXTURE','ADMIN',false),
      ('${id(10)}','Fixture Staff','STAFF_FIXTURE','VA',false),('${id(11)}','Inactive','INACTIVE','ADMIN',true);
    insert into commercial_leads(lead_id,email,phone,project_city,project_state,updated_at) values
      ('${id(1)}','fixture@example.invalid','+15550000005','Fixture City','NC','2026-01-01T00:00:00.123456Z'),
      ('${id(2)}','fixture@example.invalid','+15550000005','Fixture City','NC','2026-01-01');
    insert into h2s_orders(id,order_id,total,currency,status,session_id,payment_intent_id,customer_name,customer_email,address,metadata_json)
      values('${id(100)}','ORD-FIXTURE',1200,'usd','paid','cs_fixture','pi_fixture','Fixture Customer','fixture@example.invalid',
        '100 Fixture Lane','{"tech_payout_dollars":420}');
    insert into h2s_orders(id,order_id,total,currency,status,commercial_request_id) values
      ('${id(200)}','APPT-COM-FIXTURE',0,'usd','paid','${id(201)}');
    insert into h2s_dispatch_jobs(job_id,order_id,status) values('${id(101)}','ORD-FIXTURE','queued'),
      ('${id(202)}','APPT-COM-FIXTURE','queued');
    insert into h2s_dispatch_job_assignments(job_id,pro_id,state) values('${id(101)}','${id(500)}','accepted');
    insert into h2s_jobs values('${id(101)}','fixture@example.invalid','queued');
    insert into h2s_pros values('${id(500)}','Fixture Installer',true),('${id(501)}','Inactive Installer',false),
      ('${id(502)}','Second Installer',true);
    insert into h2s_job_artifacts values('${id(600)}','${id(101)}','photo','https://fixture.invalid/proof.jpg','Fixture installation photo',now());
    insert into commercial_consultation_requests(request_id,lead_id,status,selected_slot_start,next_reminder_at,reminder_count,related_order_id,metadata)
      values('${id(201)}','${id(1)}','approved','2099-01-01T15:00:00Z',null,1,'APPT-COM-FIXTURE','{}');
    insert into commercial_effects values('${id(201)}','dispatch:2099-01-01T15:00:00+00:00:initial:+15550000005','accepted',
      '{"status":"queued"}',now());
  `);
  await db.exec(fs.readFileSync(path.join(root,'migrations','032_commercial_operations.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'migrations','033_atomic_stripe_order_metadata.sql'),'utf8'));
  await db.exec(fs.readFileSync(path.join(root,'migrations','034_commercial_followup_delivery.sql'),'utf8'));
  const quote = raw => { const name = raw.trim(); assert.match(name,/^[A-Za-z_][A-Za-z0-9_]*$/); return `"${name}"`; };
  function from(table) {
    const conditions = [], args = [];
    let columns = '*', limit = 500, ordering = '', single = false, upsert, patch;
    const add = value => { args.push(value && typeof value === 'object' ? JSON.stringify(value) : value); return `$${args.length}`; };
    const builder = {
      select(value = '*') { columns = value; return builder; },
      eq(name, value) { conditions.push(`${quote(name)}=${add(value)}`); return builder; },
      gt(name, value) { conditions.push(`${quote(name)}>${add(value)}`); return builder; },
      contains(name, value) { conditions.push(`${quote(name)} @> ${add(value)}::jsonb`); return builder; },
      in(name, values) { conditions.push(values.length ? `${quote(name)} in (${values.map(add).join(',')})` : 'false'); return builder; },
      order(name, options = {}) { ordering = ` order by ${quote(name)} ${options.ascending === false ? 'desc' : 'asc'}`; return builder; },
      limit(value) { limit = value; return builder; },
      maybeSingle() { single = true; return builder; },
      single() { single = true; return builder; },
      upsert(value, options) { upsert = { value, options }; return builder; },
      update(value) { patch = value; return builder; },
      async then(resolve, reject) {
        try {
          if (faults.table === table) return resolve({ data: null, error: { message: 'Fixture database unavailable', code: faults.code || 'XX000' } });
          let rows;
          const selected = columns === '*' ? '*' : columns.split(',').map(quote).join(',');
          if (upsert) {
            const keys = Object.keys(upsert.value), parameters = keys.map(key => add(upsert.value[key]));
            rows = (await db.query(`insert into ${quote(table)}(${keys.map(quote).join(',')}) values(${parameters.join(',')})
              on conflict(${upsert.options.onConflict.split(',').map(quote).join(',')}) do update set
              ${keys.map(key => `${quote(key)}=excluded.${quote(key)}`).join(',')} returning ${selected}`, args)).rows;
          } else if (patch) {
            const assignments = Object.entries(patch).map(([key,value]) => `${quote(key)}=${add(value)}`);
            rows = (await db.query(`update ${quote(table)} set ${assignments.join(',')}${conditions.length ? ` where ${conditions.join(' and ')}` : ''} returning ${selected}`,args)).rows;
          } else rows = (await db.query(`select to_jsonb(result) value from (select ${selected} from ${quote(table)}${conditions.length ? ` where ${conditions.join(' and ')}` : ''}${ordering} limit ${Number(limit)}) result`,args)).rows.map(row => row.value);
          const data = JSON.parse(JSON.stringify(single ? rows[0] || null : rows));
          if (table === 'h2s_orders' && !patch && !upsert && faults.afterOrderRead) await faults.afterOrderRead(data);
          resolve({ data, error: null });
        } catch (error) { resolve({ data: null, error: { message: error.message, code: error.code } }); }
      },
    };
    return builder;
  }
  const client = { from, async rpc(name, args) {
    if (name === 'stripe_patch_order') {
      if (faults.stripePatch) return { data:null,error:{code:'PGRST202',message:'Fixture atomic patch unavailable'} };
      try {
        const result = await db.query('select stripe_patch_order($1,$2::jsonb,$3::jsonb) result',
          [args.p_order_id,JSON.stringify(args.p_metadata),args.p_checkout == null ? null : JSON.stringify(args.p_checkout)]);
        return { data:result.rows[0].result,error:null };
      } catch (error) { return { data:null,error:{code:error.code,message:error.message} }; }
    }
    assert.ok(['commercial_record_operation','commercial_record_follow_up','sms_record_delivery'].includes(name));
    if (name === 'commercial_record_follow_up' && faults.beforeFollowUp) {
      const before = faults.beforeFollowUp;
      delete faults.beforeFollowUp;
      await before();
    }
    const values = Object.values(args).map(value => value && typeof value === 'object' ? JSON.stringify(value) : value);
    const casts = name === 'sms_record_delivery' ? ['text','jsonb']
      : name === 'commercial_record_follow_up' ? ['uuid','integer','uuid','jsonb','jsonb'] : ['uuid','integer','uuid','jsonb','text','jsonb'];
    try {
      const result = await db.query(`select ${name}(${values.map((_,i) => `$${i+1}::${casts[i]}`).join(',')}) result`,values);
      if (name.startsWith('commercial_record_') && faults.afterSave) faults.table = 'Dashboard_Users';
      return { data: result.rows[0].result, error: null };
    } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
  } };
  const stripe = {
    checkout: { sessions: { async retrieve(ref) { calls.stripe.push(ref); if (faults.stripe) throw new Error('Fixture Stripe unavailable');
      return { amount_total: faults.amount || 120000, currency: 'usd', payment_intent: 'pi_fixture', payment_status: faults.unpaid ? 'unpaid' : 'paid' }; } } },
    paymentIntents: { async retrieve(ref) { calls.stripe.push(ref); return { currency: 'usd', amount:120000,
      amount_received: faults.unpaid ? 0 : 120000, status: faults.unpaid ? 'processing' : 'succeeded',
      latest_charge: { amount_refunded: faults.refund || 0, disputed: !!faults.dispute } }; } },
  };
  const globals = { process: { env: { STRIPE_SECRET_KEY:'sk_test_fixture_only',STRIPE_WEBHOOK_SECRET:'fixture_webhook_only',...env } } };
  const delivery = evaluate('lib\\sms_delivery.ts', {}, globals);
  const policy = evaluate('lib\\internal_follow_up.ts', { 'node:crypto': require('node:crypto') }, globals);
  const followUp = evaluate('lib\\commercial_follow_up.ts', {
    '@/lib/supabase': { getSupabase: () => client }, '@/lib/internal_follow_up': policy,
  }, globals);
  const communications = evaluate('lib\\commercial_communications.ts', { '@/lib/sms_delivery': delivery });
  const payment = evaluate('lib\\commercial_payment.ts', { stripe: class Stripe {} });
  class CommercialConfigurationError extends Error {}
  const route = evaluate('app\\api\\commercial-operations\\route.ts', {
    'next/server': { NextResponse: class extends Response { static json(value, options) { return Response.json(value,options); } } },
    stripe: class Stripe { constructor() { return stripe; } },
    '@/lib/supabase': { getSupabase: () => client },
    '@/lib/dashboardAuth': { getDashboardDb: () => client, getDashboardAuthUserFromSession: async request => {
      const token = request.headers.get('authorization');
      return token === 'Bearer fixture-admin' ? { userId:id(9),displayName:'Fixture Admin',username:'ADMIN_FIXTURE',role:'ADMIN' }
        : token === 'Bearer fixture-va' ? { userId:id(10),displayName:'Fixture Staff',username:'STAFF_FIXTURE',role:'VA' } : null;
    } },
    '@/lib/adminAuth': { corsHeaders: () => ({}) },
    '@/lib/commercial_communications': communications,
    '@/lib/commercial_follow_up': followUp,
    '@/lib/commercial_consultation_runtime': {
      CommercialConfigurationError,
      getTechnicianPhones: () => { if (faults.routing) throw new CommercialConfigurationError('Fixture routing unavailable'); return ['+15550000005']; },
      getEscalationPhones: () => ['+15550000006'],
    },
    '@/lib/jobHelpers': functions('lib\\jobHelpers.js', ['canTransitionTo']),
    '@/lib/commercial_payment': payment,
  }, globals);
  async function request(method, data, token = 'fixture-admin', query = {}) {
    const url = new URL('http://fixture.invalid/api/commercial-operations');
    if (method === 'GET') Object.entries({ leadId:id(1),...query }).forEach(([key,value]) => url.searchParams.set(key,value));
    const req = new Request(url, { method, headers: { Authorization:`Bearer ${token}`,'Content-Type':'application/json' },
      ...(method === 'POST' ? { body:JSON.stringify(data) } : {}) });
    return route[method](req);
  }
  return { db, client, faults, calls, route, request, id, stripe, followUp, policy, env:globals.process.env };
}
function functions(relative, names, globals = {}) {
  const filename = path.join(root,relative),source = fs.readFileSync(filename,'utf8');
  const ast = ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true);
  const selected = ast.statements.filter(node =>
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(item => names.includes(item.name.getText(ast))));
  const compiledSource = ts.transpileModule(selected.map(node=>node.getText(ast)).join('\n')+
    `\nmodule.exports={${names.join(',')}}`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(compiledSource,{module,exports:module.exports,console,Date,Intl,Math,Map,Set,...globals},{filename});
  return module.exports;
}
module.exports = { createOperationsFixture, evaluate, functions, id };
