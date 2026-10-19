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

function createFixture() {
  const tables = { commercial_leads: [], commercial_consultation_requests: [], sms_threads: [], sms_messages: [] };
  const sms = [];
  const appointments = [];
  const calls = [];
  const env = {
    NODE_ENV: 'test', COMMERCIAL_PUBLIC_BASE_URL: 'http://localhost:3002',
    COMMERCIAL_CONSULTATION_TECH_PHONE: '+15550000001', COMMERCIAL_ESCALATION_PHONES: '+15550000002',
    TWILIO_ACCOUNT_SID: 'fixture-only', TWILIO_AUTH_TOKEN: 'fixture-only', TWILIO_FROM_NUMBER: '+15550000004',
    CRON_SECRET: 'fixture-only-cron-secret',
  };
  const database = {
    from(table) {
      assert.ok(Object.hasOwn(tables, table), `Unexpected database table: ${table}`);
      const operation = { table, mode: 'select', filters: [], orders: [], limit: Infinity, single: false };
      const query = new Proxy({}, {
        get(_, method) {
          if (method === 'then') return (resolve, reject) => Promise.resolve().then(() => {
            calls.push({ table, mode: operation.mode });
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
            if (operation.orders.length) {
              rows = rows.slice().sort((left, right) => {
                for (const [key, ascending] of operation.orders) {
                  if (left[key] !== right[key]) return (left[key] > right[key] ? 1 : -1) * (ascending ? 1 : -1);
                }
                return 0;
              });
            }
            rows = rows.slice(0, operation.limit);
            return { data: copy(operation.single ? rows[0] || null : rows), error: null };
          }).then(resolve, reject);
          return (...args) => {
            if (['insert', 'upsert', 'update'].includes(method)) { operation.mode = method; operation.value = args[0]; }
            else if (method === 'eq') operation.filters.push(row => row[args[0]] === args[1]);
            else if (method === 'in') operation.filters.push(row => args[1].includes(row[args[0]]));
            else if (method === 'lte') operation.filters.push(row => row[args[0]] != null && row[args[0]] <= args[1]);
            else if (method === 'limit') operation.limit = args[0];
            else if (method === 'order') operation.orders.push([args[0], args[1]?.ascending !== false]);
            else if (method === 'single' || method === 'maybeSingle') operation.single = true;
            else assert.equal(method, 'select', `Unexpected query method: ${method}`);
            return query;
          };
        },
      });
      return query;
    },
  };
  const globals = {
    process: { env },
    fetch: async (url, options) => {
      assert.equal(new URL(url).pathname, '/api/schedule-appointment', 'Unexpected network call');
      appointments.push(JSON.parse(options.body));
      return Response.json({ success: true, appointment: { id: 'fixture-appointment' } });
    },
  };
  const imports = {
    '@/lib/supabase': { getSupabase: () => database },
    '@/lib/commercial_consultation.js': utils,
    'node:crypto': crypto,
    twilio: () => ({ messages: { create: async message => {
      sms.push(copy(message));
      return { sid: `fixture-${sms.length}`, status: 'queued' };
    } } }),
    'next/server': { NextResponse: { json: (body, options = {}) => new Response(JSON.stringify(body), {
      ...options, headers: { 'Content-Type': 'application/json', ...options.headers },
    }) } },
  };
  const modules = new Map();
  function load(relative) {
    if (!modules.has(relative)) {
      const filename = path.join(backend, relative);
      modules.set(relative, evaluate(filename, fs.readFileSync(filename, 'utf8'), imports, globals));
    }
    return modules.get(relative);
  }
  const runtime = load('lib\\commercial_consultation_runtime.ts');
  imports['@/lib/commercial_consultation_runtime'] = runtime;
  const queue = evaluate('commercial-queue-projection.ts', queueFunctions(), {}, {
    getSupabase: () => database, safeTrim: value => String(value || '').trim(),
    toInt: (value, fallback) => Number.parseInt(value, 10) || fallback,
    isMissingTableError: () => false, isManualCommercialFollowUp: utils.isManualCommercialFollowUp,
  });
  function route(name) { return load(`app\\api\\${name}\\route.ts`); }
  return {
    tables, sms, appointments, calls, runtime, route,
    queue: () => queue.loadCommercialQueueSnapshot(150),
    post: (name, body) => route(name).POST(new Request(`http://localhost:3002/api/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })),
  };
}

function queuePage() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Commercial Queue - local fixture</title><link rel="stylesheet" href="/dash.css"></head><body>
  <main id="commercialqueue-pane" class="commercial-queue-shell"><h1>Commercial Queue - local fixture</h1><p>In-memory test data only. No real SMS, emails, or appointments.</p>
  <input id="commercialQueueSearch" aria-label="Search queue" oninput="commercialQueueUI.onSearchInput()">
  <select id="commercialQueueFilter" aria-label="Filter queue" onchange="commercialQueueUI.onFilterChange()"><option value="all">All</option><option value="attention">Needs attention</option></select>
  <div id="commercialQueueSummary"></div><div id="commercialQueueUpdatedAt"></div><div id="commercialQueueListMeta"></div><div id="commercialQueueList"></div><div id="commercialQueueDetail"></div></main>
  <script>
  const API_URL='/api/v1';
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const uiRenderState=options=>escapeHtml(options.title+' '+options.message);
  const uiRenderSkeletonStack=()=>'<p>Loading local fixture queue...</p>';
  const showToast=message=>console.error(message);
  const commercialQueueUI=${queueWidgetSource()};
  window.commercialQueueUI=commercialQueueUI;commercialQueueUI.state.filter='all';commercialQueueUI.refresh();
  </script></body></html>`;
}

function startServer(port = 3003) {
  let fixture = createFixture();
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://localhost:${port}`);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      let result;
      if (url.pathname === '/api/_fixture/reset' && request.method === 'POST') { fixture = createFixture(); result = Response.json({ ok: true }); }
      else if (url.pathname === '/api/_fixture/state') result = Response.json({ fixture: true, tables: fixture.tables, sms: fixture.sms, appointments: fixture.appointments });
      else if (url.pathname === '/api/_fixture/queue') result = new Response(queuePage(), { headers: { 'Content-Type': 'text/html' } });
      else if (url.pathname === '/api/v1' && url.searchParams.get('action') === 'commercialQueue') result = Response.json({ ok: true, commercialQueue: await fixture.queue() });
      else if (['/api/track', '/api/owner-media/public', '/api/proof-gallery'].includes(url.pathname)) result = Response.json({ ok: true, assets: [], photos: [], items: [] });
      else {
        const name = url.pathname.slice('/api/'.length);
        assert.ok(['commercial-intake', 'commercial-consultation', 'commercial-consultation-response'].includes(name), 'Unsupported fixture route');
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
