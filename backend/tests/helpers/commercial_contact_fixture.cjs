const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ts = require('typescript');
const utils = require('../../lib/commercial_consultation.js');

const backend = path.resolve(__dirname, '..', '..');
const root = path.dirname(backend);
const compiled = new Map();
const copy = value => JSON.parse(JSON.stringify(value));

function evaluate(filename, source, imports, globals) {
  if (!compiled.has(source)) compiled.set(source, ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText);
  const module = { exports: {} };
  vm.runInNewContext(compiled.get(source), {
    module, exports: module.exports, console, URL, Request, Response, Buffer, Error,
    require(name) {
      assert.ok(Object.hasOwn(imports, name), `Unmocked dependency blocked: ${name}`);
      return imports[name];
    },
    ...globals,
  }, { filename });
  return module.exports;
}

function queueFunctions() {
  const filename = path.join(backend, 'app', 'api', 'v1', 'route.ts');
  const source = fs.readFileSync(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const names = ['readJsonArraySafe', 'formatCommercialSlotLabel', 'loadCommercialQueueSnapshot'];
  return names.map(name => {
    const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
    assert.ok(node, `Missing queue function: ${name}`);
    return node.getText(ast);
  }).join('\n') + '\nmodule.exports = { loadCommercialQueueSnapshot };';
}

function queueWidgetSource() {
  const filename = path.join(root, 'frontend', 'dash.js');
  const ast = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let widget;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'commercialQueueUI') widget = node.initializer.getText(ast);
    if (!widget) ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(widget, 'Commercial Queue widget is missing');
  return widget;
}

function matchesPostgrestFilter(row, expression) {
  const group = /^(and|or)\((.*)\)$/s.exec(expression);
  if (group) {
    const children = [];
    let depth = 0, quoted = false, escaped = false, start = 0;
    for (let index = 0; index < group[2].length; index++) {
      const char = group[2][index];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') quoted = !quoted;
      if (quoted) continue;
      if (char === '(') depth++;
      if (char === ')') depth--;
      if (char === ',' && depth === 0) { children.push(group[2].slice(start, index)); start = index + 1; }
    }
    children.push(group[2].slice(start));
    return group[1] === 'and' ? children.every(child => matchesPostgrestFilter(row, child)) : children.some(child => matchesPostgrestFilter(row, child));
  }
  const match = /^(.+?)\.(ilike|eq|lt|is)\.(.*)$/s.exec(expression);
  assert.ok(match, `Unsupported fixture filter: ${expression}`);
  const [, field, operator, encoded] = match;
  const [column, index] = field.split('->>');
  const value = index === undefined ? row[column] : row[column]?.[index];
  const expected = encoded.startsWith('"') ? JSON.parse(encoded) : encoded;
  if (operator==='is') {assert.equal(expected,'null');return value==null;}
  if (value === null || value === undefined) return false;
  if (operator === 'eq') return String(value) === expected;
  if (operator === 'lt') return column.endsWith('_at') ? Date.parse(value) < Date.parse(expected) : String(value) < expected;
  const literal = char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pattern = '';
  for (let position = 0; position < expected.length; position++) {
    const char = expected[position];
    if (char === '\\') pattern += literal(expected[++position]);
    else pattern += char === '%' ? '.*' : char === '_' ? '.' : literal(char);
  }
  return new RegExp(`^${pattern}$`, 'is').test(String(value));
}

function createFixture(environment = {}, integration = {}) {
  const tables = { notification_routing: [], commercial_leads: [], commercial_lead_operations: [], commercial_consultation_requests: [], commercial_effects: [], sms_threads: [], sms_messages: [], h2s_orders: [] };
  const sms = [];
  const providerAttempts = [];
  const appointments = [];
  const calls = [];
  const effects = new Map();
  const objects = new Map();
  const faults = {};
  const env = {
    NODE_ENV: 'test', COMMERCIAL_PUBLIC_BASE_URL: 'http://localhost:3002',
    COMMERCIAL_CONSULTATION_TECH_PHONE: '+15550000001', COMMERCIAL_ESCALATION_PHONES: '+15550000002',
    TWILIO_ACCOUNT_SID: 'fixture-only', TWILIO_AUTH_TOKEN: 'fixture-only', TWILIO_FROM_NUMBER: '+15550000004',
    CRON_SECRET: 'fixture-only-cron-secret',
    ...environment,
  };
  const memoryDatabase = {
    rpc(name, args) {
      calls.push({ rpc: name });
      if (faults[name]) return Promise.resolve({ data: null, error: { message: faults[name] } });
      const req = tables.commercial_consultation_requests.find(row => row.request_id === args.p_request_id);
      let data;
      if (name === 'commercial_save_lead') {
        let row = tables.commercial_leads.find(lead => lead.public_token === args.p_token);
        if (row && row.last_save_key === args.p_save_key) data = { lead: row, replayed: true };
        else if (Number(row?.revision || 0) !== args.p_revision) data = { conflict: true, lead: row };
        else {
          if (!row) {
            row = { lead_id: crypto.randomUUID(), created_at: new Date().toISOString() };
            tables.commercial_leads.push(row);
          }
          const photos = row.project_photo_urls || [];
          Object.assign(row, copy(args.p_patch), { revision: Number(row.revision || 0) + 1,
            last_save_key: args.p_save_key, project_photo_urls: photos, public_token: args.p_token });
          data = { lead: row };
        }
      } else if (name === 'commercial_submit_request') {
        let row = tables.commercial_consultation_requests.find(item => item.lead_id === args.p_lead_id &&
          (item.submission_key === args.p_key || ['pending', 'approved', 'customer_confirmed', 'escalated', 'reschedule_requested'].includes(item.status)));
        const created = !row;
        if (!row) {
          row = { ...copy(args.p_patch), request_id: crypto.randomUUID(), lead_id: args.p_lead_id,
            submission_key: args.p_key, reminder_count: 0 };
          tables.commercial_consultation_requests.push(row);
        }
        data = { request: row, created };
      } else if (name === 'commercial_reschedule_request') {
        const replayed = req.metadata.last_reschedule_key === args.p_key;
        if (!replayed) {
          assert.equal(req.response_token, args.p_expected_token);
          Object.assign(req, copy(args.p_patch), { metadata: { ...req.metadata, ...args.p_patch.metadata, last_reschedule_key: args.p_key } });
        }
        data = { request: req, replayed };
      } else if (name === 'commercial_claim_effect') {
        const key = `${args.p_request_id}:${args.p_kind}`;
        data = !effects.has(key) || effects.get(key).state === 'failed';
        if (data) {
          req.metadata.workflow = { ...req.metadata.workflow, [args.p_kind]: { state: 'processing' } };
          effects.set(key, { state: 'processing' });
          const existing = tables.commercial_effects.find(item => item.request_id === args.p_request_id && item.kind === args.p_kind);
          if (existing) existing.state = 'processing';
          else tables.commercial_effects.push({ request_id: args.p_request_id, kind: args.p_kind, state: 'processing' });
        }
      } else if (name === 'commercial_finish_effect') {
        const key = `${args.p_request_id}:${args.p_kind}`;
        const value = { state: args.p_state, details: copy(args.p_details) };
        effects.set(key, value);
        Object.assign(tables.commercial_effects.find(item => item.request_id === args.p_request_id && item.kind === args.p_kind), value);
        req.metadata.workflow = { ...req.metadata.workflow, [args.p_kind]: value };
        data = null;
      } else if (name === 'commercial_create_appointment') {
        if (!req.related_order_id) {
          const appointment = { id: crypto.randomUUID(), requestId: req.request_id };
          appointments.push(appointment);
          tables.h2s_orders.push({ id: appointment.id, commercial_request_id: req.request_id,
            status: 'queued', appointment_confirmed: true, metadata_json: {
              slot_start_iso: req.selected_slot_start, slot_end_iso: req.selected_slot_end,
            } });
          req.related_order_id = appointment.id;
        }
        delete req.metadata.appointment_error;
        data = appointments.find(item => item.id === req.related_order_id);
      } else if (name === 'commercial_record_appointment_error') {
        req.metadata.appointment_error = args.p_error;
        data = null;
      } else if (name === 'commercial_attach_photo') {
        const row = tables.commercial_leads.find(item => item.lead_id === args.p_lead_id);
        if (row.project_photo_urls.length >= 8) return Promise.resolve({ error: { message: 'Maximum eight attachments reached' } });
        row.project_photo_urls.push(args.p_url);
        data = row;
      } else throw new Error(`Unmocked RPC: ${name}`);
      return Promise.resolve({ data: copy(data ?? null), error: null });
    },
    storage: {
      getBucket: async () => ({ data: { public: faults.privateBucket !== true }, error: null }),
      from: () => ({
        upload: async (name, bytes) => { objects.set(name, bytes); return { error: null }; },
        getPublicUrl: name => ({ data: { publicUrl: `https://fixture.invalid/${name}` } }),
        remove: async names => {
          if (faults.cleanup) return { error: { message: 'Fixture cleanup failure' } };
          names.forEach(name => objects.delete(name));
          return { error: null };
        },
      }),
    },
    from(table) {
      assert.ok(Object.hasOwn(tables, table), `Unexpected database table: ${table}`);
      const operation = { table, mode: 'select', filters: [], orders: [], embeddedOrders: [], limit: Infinity, embeddedLimit: Infinity, single: false };
      const query = new Proxy({}, {
        get(_, method) {
          if (method === 'then') return (resolve, reject) => Promise.resolve().then(() => {
            calls.push({ table, mode: operation.mode, select: operation.select, logic: operation.logic, limit: operation.limit, embeddedLimit: operation.embeddedLimit });
            if (faults[table]) return { data: null, error: { message: String(faults[table]) } };
            if (operation.select?.includes('commercial_consultation_requests(') && faults.commercial_consultation_requests) return { data: null, error: { message: String(faults.commercial_consultation_requests) } };
            let rows = tables[table].filter(row => operation.filters.every(filter => filter(row)));
            if (['insert', 'upsert'].includes(operation.mode)) {
              let row = operation.mode === 'upsert' ? rows.find(item => item.contact_phone === operation.value.contact_phone) : null;
              if (!row) {
                row = { created_at: new Date().toISOString() };
                const key = { commercial_leads: 'lead_id', commercial_consultation_requests: 'request_id', sms_threads: 'thread_id', sms_messages: 'message_id' }[table];
                row[key] = crypto.randomUUID();
                tables[table].push(row);
              }
              Object.assign(row, copy(operation.value));
              rows = [row];
            } else if (operation.mode === 'update') rows.forEach(row => Object.assign(row, copy(operation.value)));
            const sort = (items, orders) => items.slice().sort((left, right) => {
                for (const [key, ascending] of orders) {
                  if (left[key] !== right[key]) return (left[key] > right[key] ? 1 : -1) * (ascending ? 1 : -1);
                }
                return 0;
              });
            if (operation.orders.length) rows = sort(rows, operation.orders);
            const count = rows.length;
            rows = rows.slice(0, operation.limit);
            if (operation.select?.includes('commercial_consultation_requests(')) rows = rows.map(row => ({
              ...row, commercial_lead_operations: tables.commercial_lead_operations.find(item => item.lead_id === row.lead_id) || null,
              commercial_consultation_requests: sort(tables.commercial_consultation_requests.filter(request => request.lead_id === row.lead_id), operation.embeddedOrders).slice(0, operation.embeddedLimit),
            }));
            return { data: operation.head ? null : copy(operation.single ? rows[0] || null : rows), count: operation.count ? count : null, error: null };
          }).then(resolve, reject);
          return (...args) => {
            if (['insert', 'upsert', 'update'].includes(method)) { operation.mode = method; operation.value = args[0]; }
            else if (method === 'eq' || method === 'is') operation.filters.push(row => (row[args[0]] ?? null) === args[1]);
            else if (method === 'in') operation.filters.push(row => args[1].includes(row[args[0]]));
            else if (method === 'lte') operation.filters.push(row => row[args[0]] != null && row[args[0]] <= args[1]);
            else if (method === 'or') { operation.logic = args[0]; operation.filters.push(row => matchesPostgrestFilter(row, `or(${args[0]})`)); }
            else if (method === 'limit') operation[args[1]?.referencedTable ? 'embeddedLimit' : 'limit'] = args[0];
            else if (method === 'order') operation[args[1]?.referencedTable ? 'embeddedOrders' : 'orders'].push([args[0], args[1]?.ascending !== false]);
            else if (method === 'single' || method === 'maybeSingle') operation.single = true;
            else if (method === 'select') { operation.select = args[0]; operation.head = args[1]?.head; operation.count = args[1]?.count; }
            else assert.fail(`Unexpected query method: ${method}`);
            return query;
          };
        },
      });
      return query;
    },
  };
  const database = integration.database || memoryDatabase;
  const globals = {
    process: { env },
    ...(integration.now ? { Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [integration.now()])); }
      static now() { return new Date(integration.now()).getTime(); }
    } } : {}),
    fetch: async (url, options) => {
      assert.equal(new URL(url).pathname, '/api/schedule-appointment', 'Unexpected network call');
      appointments.push(JSON.parse(options.body));
      return Response.json({ success: true, appointment: { id: 'fixture-appointment' } });
    },
  };
  const imports = {
    '@/lib/commercial_email': { sendInitialCommercialEmail: integration.sendInitialCommercialEmail || (async (_consultation, lead) =>
      ({ state: lead.contact_preference === 'email' ? 'unavailable' : 'not_applicable' })) },
    '@/lib/supabase': { getSupabase: () => database },
    '@/lib/dashboardAuth': { getDashboardAuthUserFromSession: integration.getDashboardAuthUserFromSession || (async () => null) },
    '../../../../lib/supabase': { getSupabase: () => database, getSupabaseMgmt: () => database },
    '../../_lib/phone': { normalizePhone: utils.normalizePhone },
    '@/lib/commercial_consultation.js': utils,
    'node:crypto': crypto,
    twilio: Object.assign(() => ({ messages: { create: async message => {
      providerAttempts.push(copy(message));
      const failure = faults.smsByRecipient?.[message.to] || faults.sms;
      if (failure) throw Object.assign(new Error('Fixture provider failure'), { status: failure === 'rejected' ? 400 : 504 });
      sms.push(copy(message));
      return { sid: `fixture-${sms.length}`, status: 'queued' };
    } } }), { validateRequest: require('twilio').validateRequest }),
    'next/server': { NextResponse: class extends Response {
      static json(body, options = {}) { return new Response(JSON.stringify(body), {
        ...options, headers: { 'Content-Type': 'application/json', ...options.headers },
      }); }
    } },
  };
  const modules = new Map();
  function load(relative) {
    if (!modules.has(relative)) {
      const filename = path.join(backend, relative);
      modules.set(relative, evaluate(filename, fs.readFileSync(filename, 'utf8'), imports, globals));
    }
    return modules.get(relative);
  }
  imports['@/lib/sms_delivery'] = load('lib\\sms_delivery.ts');
  const runtime = load('lib\\commercial_consultation_runtime.ts');
  imports['@/lib/commercial_consultation_runtime'] = runtime;
  imports['@/lib/commercial_business'] = load('lib\\commercial_business.ts');
  imports['@/lib/notification_routing'] = load('lib\\notification_routing.ts');
  imports['@/lib/residential_inquiry'] = load('lib\\residential_inquiry.ts');
  imports['@/lib/residential_workspace'] = load('lib\\residential_workspace.ts');
  imports['@/lib/adminAuth'] = { corsHeaders: runtime.corsHeaders };
  const queue = evaluate('commercial-queue-projection.ts', queueFunctions(), {}, {
    getSupabase: () => database, safeTrim: value => String(value || '').trim(),
    toInt: (value, fallback) => Number.parseInt(value, 10) || fallback,
    isMissingTableError: () => false, isManualCommercialFollowUp: utils.isManualCommercialFollowUp,
  });
  function route(name) { return load(`app\\api\\${name}\\route.ts`); }
  return {
    tables, sms, providerAttempts, appointments, calls, runtime, workspace: imports['@/lib/residential_workspace'], route, faults, effects, objects, database,
    queue: (params = 150) => queue.loadCommercialQueueSnapshot(params),
    post: (name, body) => route(name).POST(new Request(`http://localhost:3002/api/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })),
  };
}

function queuePage() {
  const html = fs.readFileSync(path.join(root, 'frontend', 'dash.html'), 'utf8');
  const start = html.indexOf('<div class="pane" id="commercialqueue-pane">');
  const end = html.indexOf('<!-- ADMIN DASHBOARD PANE -->', start);
  assert.ok(start > 0 && end > start, 'Canonical queue markup is missing');
  const pane = html.slice(start, end).replace('class="pane"', 'class="pane active"');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Commercial Queue - local fixture</title><link rel="stylesheet" href="/dashboard-design-system.css"><link rel="stylesheet" href="/dash.css"></head><body>
  <p>In-memory test data only. No real SMS, emails, or appointments.</p>${pane}
  <script>
  ${fs.readFileSync(path.join(root, 'frontend', 'commercial-labels.js'), 'utf8')}
  const API_URL='/api/v1';
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const uiRenderState=options=>escapeHtml(options.title+' '+options.message);
  const uiRenderSkeletonStack=()=>'<p>Loading local fixture queue...</p>';
  const showToast=message=>console.error(message);
  const commercialQueueUI=${queueWidgetSource()};
  window.commercialQueueUI=commercialQueueUI;commercialQueueUI.state.filter='all';document.getElementById('commercialQueueFilter').value='all';commercialQueueUI.refresh();
  </script></body></html>`;
}

function startServer(port = 3003, initialFixture = createFixture()) {
  let fixture = initialFixture;
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://localhost:${port}`);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      let result;
      if (url.pathname === '/api/_fixture/reset' && request.method === 'POST') { fixture = createFixture(); result = Response.json({ ok: true }); }
      else if (url.pathname === '/api/_fixture/faults' && request.method === 'POST') { Object.assign(fixture.faults, JSON.parse(body)); result = Response.json({ ok: true }); }
      else if (url.pathname === '/api/_fixture/state') result = Response.json({ fixture: true, tables: fixture.tables, sms: fixture.sms, appointments: fixture.appointments });
      else if (['/dash.css', '/dashboard-design-system.css'].includes(url.pathname) && request.method === 'GET') result = new Response(fs.readFileSync(path.join(root, 'frontend', path.basename(url.pathname))), { headers: { 'Content-Type': 'text/css' } });
      else if (url.pathname === '/api/_fixture/queue') result = new Response(queuePage(), { headers: { 'Content-Type': 'text/html' } });
      else if (url.pathname === '/api/v1' && url.searchParams.get('action') === 'commercialQueue') result = Response.json({ ok: true, commercialQueue: await fixture.queue(url.searchParams) });
      else if (url.pathname === '/api/v1' && url.searchParams.get('action') === 'commercialRecovery' && request.method === 'POST') result = Response.json(await fixture.runtime.retryCommercialProcessing(new Request(url), JSON.parse(body).requestId));
      else if (['/api/track', '/api/owner-media/public', '/api/proof-gallery'].includes(url.pathname)) result = Response.json({ ok: true, assets: [], photos: [], items: [] });
      else {
        const name = url.pathname.slice('/api/'.length);
        assert.ok(['commercial-intake', 'commercial-intake/photo', 'commercial-consultation', 'commercial-consultation-response'].includes(name), 'Unsupported fixture route');
        const handler = fixture.route(name)[request.method];
        assert.equal(typeof handler, 'function', 'Unsupported fixture method');
        result = await handler(new Request(url, { method: request.method, headers: request.headers,
          ...(['GET', 'HEAD'].includes(request.method) ? {} : { body }) }));
      }
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      console.error('[commercial contact fixture]', error.message);
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: error.message }));
    }
  });
  server.listen(port, '127.0.0.1', () => console.log(`Commercial contact fixture on ${port}: memory-only DB, fake SMS and appointments; no live credentials.`));
  return server;
}

module.exports = { createFixture, queueWidgetSource, queuePage, startServer };
if (require.main === module) startServer(Number(process.env.H2S_CONTACT_FIXTURE_PORT || 3003));
