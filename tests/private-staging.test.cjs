'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { createProxy, LIMIT } = require('../tools/staging/proxy.cjs');
const { stagingOrigin, adaptText, adaptRuntimeText, assertNoSecret, isRuntimeFile, verifyFrontendStamp, nativeMiddlewareSource } = require('../tools/staging/prepare.cjs');
const backendOrigin = 'https://h2s-staging-backend.vercel.app';
const frontendOrigin = 'https://h2s-staging-frontend.vercel.app';
const bypassSecret = 'synthetic-server-only-bypass';
test('preparation preserves the immutable shared-provider identity guard without preserving ordinary embedded provider targets',()=>{
  const guard=fs.readFileSync(path.join(__dirname,'..','backend','lib','stagingSandbox.ts'),'utf8');
  const args=['https://h2s-staging-backend.vercel.app','https://h2s-staging-frontend.vercel.app'];
  assert.equal(adaptRuntimeText(guard,path.join('backend','lib','stagingSandbox.ts'),...args),guard);
  assert.ok(adaptRuntimeText(guard,path.join('frontend','example.js'),...args).includes('https://staging-not-configured.invalid'));
  assert.ok(adaptRuntimeText(guard,path.join('backend','lib','otherClient.ts'),...args).includes('https://staging-not-configured.invalid'));
});
function stagingMiddleware(env) {
  const ts=require('typescript'),vm=require('node:vm');
  const load=(source,imports={})=>{
    const module={exports:{}};
    vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
      {module,exports:module.exports,require:name=>{assert.ok(name in imports);return imports[name];},
        process:{env},Response,console:{error(){}},NextResponse:{json:(body,options)=>Response.json(body,options)}});
    return module.exports;
  };
  const identity=load(fs.readFileSync(path.join(__dirname,'..','backend','lib','stagingSandbox.ts'),'utf8'));
  return load(nativeMiddlewareSource('export function middleware(req: NextRequest) { return NextResponse.json({ reached: true }); }','a'.repeat(40)),
    {'./lib/stagingSandbox':identity}).middleware;
}
test('prepared middleware never opens legacy or nonisolated routes, even if an old quarantine flag is false',async()=>{
  const run='c6316381-64f5-4b67-b41f-41711416cdcc';
  const env={VERCEL_ENV:'preview',H2S_STAGING_SANDBOX_RUN_ID:run,H2S_STAGING_DATABASE_SCHEMA:'h2s_test_'+run.replaceAll('-',''),
    H2S_STAGING_SYNTHETIC_ONLY:'true',H2S_FIELD_STRIPE_MODE:'test',H2S_FIELD_STRIPE_LIVE_ENABLED:'false',H2S_STAGING_QUARANTINE:'false'};
  const req=(url,method='GET',body='')=>({nextUrl:new URL('https://fixture.invalid'+url),method,clone:()=>({text:async()=>body})});
  const valid=stagingMiddleware(env);
  assert.equal((await valid(req('/api/field-sales'))).status,200);
  assert.equal((await valid(req('/api/v1?action=dashboardLogin','POST','{}'))).status,200);
  assert.equal((await valid(req('/api/v1?action=dashboardLogin','POST','{"action":"forceDeleteAll"}'))).status,400);
  assert.equal((await valid(req('/api/v1?action=forceDeleteAll','POST','{}'))).status,503);
  assert.equal((await valid(req('/api/staging-certification','POST','{}'))).status,503);
  for(const override of [{H2S_STAGING_SANDBOX_RUN_ID:''},{VERCEL_ENV:'production'},{H2S_FIELD_STRIPE_MODE:'live'},
    {H2S_FIELD_STRIPE_LIVE_ENABLED:'true'},{H2S_STAGING_DATABASE_SCHEMA:'public'}]){
    assert.equal((await stagingMiddleware({...env,...override})(req('/api/field-sales'))).status,503);
  }
});
function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
}
function request(chunks = [], overrides = {}) {
  return Object.assign(Readable.from(chunks), { method: 'GET', url: '/api/field-sales?search=older&__staging_path=field-sales',
    headers: {}, ...overrides });
}
test('only exact HTTPS staging origins are accepted', () => {
  assert.equal(stagingOrigin(backendOrigin, 'backend'), backendOrigin);
  for (const origin of ['https://h2s-backend.vercel.app', 'https://portal.home2smart.com',
    'http://h2s-staging-backend.vercel.app', backendOrigin + '/api', backendOrigin + '.attacker.invalid',
    'https://user:pass@h2s-staging-backend.vercel.app']) {
    assert.throws(() => stagingOrigin(origin, 'backend'));
    assert.throws(() => createProxy({ backendOrigin: origin, bypassSecret }));
  }
});
test('runtime origin adaptation removes production and legacy native targets', () => {
  const text = 'https://h2s-backend.vercel.app/api https://h2s-backend-old-123.vercel.app/api '
    + 'https://portal.home2smart.com/dash https://shop.home2smart.com/bundles '
    + 'https://h2s-campaign-intake.vercel.app/intake https://oldproject.supabase.co/rest/v1 '
    + 'https://script.google.com/macros/s/old';
  const result = adaptText(text, frontendOrigin, frontendOrigin);
  assert.doesNotMatch(result, /h2s-backend|home2smart\.com|oldproject\.supabase|script\.google\.com/);
  assert.match(result, /staging-not-configured\.invalid/);
  assert.match(result, /_staging-blocked\/legacy/);
});
test('credential-like secrets and service-role JWTs block upload without echoing values', () => {
  assertNoSecret('sk_test_build_only_not_configured', 'safe.js');
  const secret = 'sk_live_' + 'a'.repeat(30);
  assert.throws(() => assertNoSecret(secret, 'unsafe.js'), error =>
    error.message.includes('unsafe.js') && !error.message.includes(secret));
  const jwt = Buffer.from('{"alg":"HS256"}').toString('base64url') + '.'
    + Buffer.from('{"role":"service_role"}').toString('base64url') + '.signature';
  assert.throws(() => assertNoSecret(jwt, 'unsafe.js'), /Service-role/);
});
test('only runtime authorities and assets are eligible, never maintenance scripts or credentials', () => {
  for (const file of ['backend/app/api/field-sales/route.ts', 'backend/lib/fieldSales.ts',
    'backend/schema.prisma', 'backend/tools/package-portal.cjs', 'frontend/field-sales.js', 'portal.html']) {
    assert.equal(isRuntimeFile(file.split('/').join(path.sep)), true, file);
  }
  for (const file of ['backend/force-fix-data.js', 'backend/tests/fixture.cjs', 'backend/scripts/migrate.js',
    'backend/tools/clone_supabase_project.js', 'backend/.env.local', 'frontend/.env.local',
    'frontend/_base_dash.js', 'frontend/temp-vercel-dash.js', 'backend/private.key']) {
    assert.equal(isRuntimeFile(file.split('/').join(path.sep)), false, file);
  }
});
test('hosted dashboard stamp must resolve to the current canonical CSS and JS, not older or missing files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'h2s-stamp-test-'));
  const frontend = path.join(root, 'frontend'), commit = 'a'.repeat(40), stamp = 'PORTAL_BUILD_STAGING_aaaaaaa';
  fs.mkdirSync(frontend);
  t.after(() => {
    for (const file of fs.readdirSync(frontend)) fs.unlinkSync(path.join(frontend, file));
    fs.rmdirSync(frontend); fs.rmdirSync(root);
  });
  const html = `const DASH_BUILD_STAMP = '${stamp}'; /dash.${stamp}.css /dash.${stamp}.js`;
  fs.writeFileSync(path.join(frontend, 'dash.html'), html);
  fs.writeFileSync(path.join(frontend, 'dash.css'), 'current-style-fixture');
  fs.writeFileSync(path.join(frontend, 'dash.js'), 'current-script-fixture');
  assert.throws(() => verifyFrontendStamp(root, commit), /ENOENT/);
  fs.writeFileSync(path.join(frontend, `dash.${stamp}.css`), 'current-style-fixture');
  fs.writeFileSync(path.join(frontend, `dash.${stamp}.js`), 'stale-script-fixture');
  assert.throws(() => verifyFrontendStamp(root, commit), /canonical current source/);
  fs.copyFileSync(path.join(frontend, 'dash.js'), path.join(frontend, `dash.${stamp}.js`));
  assert.equal(verifyFrontendStamp(root, commit).changes.length, 2);
  fs.appendFileSync(path.join(frontend, 'dash.html'), ' /dash.PORTAL_BUILD_OLD.js');
  assert.throws(() => verifyFrontendStamp(root, commit), /stale stamped asset/);
});
test('proxy preserves authorization, scoped query and exact body while keeping bypass server-side', async () => {
  const body = Buffer.from('{"operation":"repeatOpportunity","evidence":"exact"}');
  let observed;
  const proxy = createProxy({ backendOrigin, bypassSecret, fetchImpl: async (url, options) => {
    observed = { url, options };
    return new Response('{"ok":false,"error":"quarantined"}', { status: 503,
      headers: { 'content-type': 'application/json', 'set-cookie': 'must-not-forward=secret' } });
  } });
  const req = request([body], { method: 'POST', headers: {
    authorization: 'Bearer fixture-session', 'content-type': 'application/json',
    cookie: 'private-frontend-cookie', 'x-vercel-protection-bypass': 'untrusted',
  } });
  const res = response();
  await proxy(req, res);
  assert.equal(observed.url, backendOrigin + '/api/field-sales?search=older');
  assert.deepEqual(observed.options.body, body);
  assert.equal(observed.options.headers.authorization, 'Bearer fixture-session');
  assert.equal(observed.options.headers['x-vercel-protection-bypass'], bypassSecret);
  assert.equal(observed.options.headers.cookie, undefined);
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['set-cookie'], undefined);
  assert.doesNotMatch(String(res.body), /synthetic-server-only-bypass/);
});
test('invalid paths and oversized requests never contact the backend', async () => {
  let calls = 0;
  const proxy = createProxy({ backendOrigin, bypassSecret, fetchImpl: async () => { calls++; } });
  for (const raw of ['../production', 'https://production.invalid', '/api/v1', '%2e%2e', ['v1', 'other']]) {
    const res = response();
    await proxy(request([], { query: { __staging_path: raw } }), res);
    assert.equal(res.statusCode, 400);
  }
  const res = response();
  await proxy(request([Buffer.alloc(LIMIT + 1)], { method: 'POST' }), res);
  assert.equal(res.statusCode, 413);
  assert.equal(calls, 0);
});
test('unexpected redirects and network errors remain explicit failures', async () => {
  for (const fetchImpl of [async () => new Response(null, { status: 302,
    headers: { location: 'https://portal.home2smart.com' } }), async () => { throw Error('unavailable'); }]) {
    const proxy = createProxy({ backendOrigin, bypassSecret, fetchImpl });
    const res = response();
    await proxy(request(), res);
    assert.equal(res.statusCode, 502);
    assert.equal(JSON.parse(res.body).ok, false);
  }
});
