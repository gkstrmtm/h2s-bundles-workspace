const test = require('node:test'), assert = require('node:assert/strict');
const { evaluate, id } = require('./helpers/commercial_operations_fixture.cjs');
function fixture(flag) {
  const env = flag === undefined ? {} : { H2S_MANAGEMENT_ASSIGNMENTS_ENABLED: flag };
  let actor = { userId: id(9), role: 'ADMIN' }, error = null, transport = false, calls = [];
  const permissions = evaluate('lib\\dashboardPermissions.ts', {
    '@/lib/dashboardAuth': { getDashboardAuthUserFromSession: async () => actor },
  });
  const db = { async rpc(name, args) {
    calls.push({ name, args });
    if (transport) throw Error('Fixture database unavailable');
    return { error, data: name.endsWith('preview') ? { enabled: true, job: {}, technicians: [] } : {
      operationId: args.p_operation_id, jobId: args.p_job_id, proId: args.p_pro_id, state: 'pending', requiresAcceptance: true,
    } };
  } };
  const service = evaluate('lib\\managementAssignments.ts', { '@/lib/dashboardPermissions': permissions }, { process: { env } });
  const route = evaluate('app\\api\\management-assignments\\route.ts', {
    '@/lib/supabase': { getSupabaseDispatch: () => db }, '@/lib/adminAuth': { corsHeaders: () => ({}) },
    '@/lib/dashboardPermissions': permissions, '@/lib/managementAssignments': service,
  });
  const input = { jobId: id(101), proId: id(500), operationId: id(700), context: 'a'.repeat(32), note: 'Fixture review' };
  const request = body => new Request('https://fixture.invalid/api/management-assignments?jobId=' + id(101), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? input),
  });
  return { service, route, input, request, calls, env,
    role(role) { actor = role ? { userId: id(9), role } : null; },
    fail(code) { error = code ? { code } : null; }, disconnect(value) { transport = value; } };
}
test('assignment API and shared operation are ADMIN-only and default-off before database access', async () => {
  for (const flag of [undefined, '', 'false', '1', 'TRUE', ' true ']) {
    const f = fixture(flag);
    assert.equal((await f.route.POST(f.request())).status, 503);
    const read = await f.route.GET(new Request('https://fixture.invalid/api/management-assignments'));
    assert.equal((await read.json()).enabled, false); assert.equal(f.calls.length, 0);
  }
  const f = fixture('true');
  for (const role of ['VA', 'OPERATIONS', 'SALES']) {
    f.role(role);
    assert.equal((await f.route.POST(f.request())).status, 403);
    assert.equal((await f.route.GET(new Request(f.request().url))).status, 403);
    await assert.rejects(f.service.assignManagementTechnician(f.request(), {}, f.input), { status: 403 });
  }
  f.role(null); assert.equal((await f.route.POST(f.request())).status, 401); assert.equal(f.calls.length, 0);
});
test('assignment API validates identities and actor provenance and returns a pending acceptance contract', async () => {
  const f = fixture('true');
  for (const input of [{ ...f.input, jobId: 'legacy-job-id' }, { ...f.input, actorUserId: id(10) }, { ...f.input, note: '' },
    { ...f.input, context: '' }, { ...f.input, operationId: 'not-uuid' }, { ...f.input, note: 'x'.repeat(2001) }]) {
    assert.equal((await f.route.POST(f.request(input))).status, 400);
  }
  assert.equal(f.calls.length, 0);
  const response = await f.route.POST(f.request());
  assert.equal(response.status, 200); assert.equal((await response.json()).assignment.requiresAcceptance, true);
  assert.equal(f.calls[0].args.p_actor_user_id, id(9)); assert.equal(f.calls[0].name, 'h2s_management_assign_technician');
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal(f.route.PATCH, undefined); assert.equal(f.route.DELETE, undefined);
  const malformed = new Request(f.request().url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' });
  assert.equal((await f.route.POST(malformed)).status, 400);
});
test('database conflicts, failures and ambiguous network outcomes return explicit retry responses', async () => {
  const f = fixture('true');
  for (const [code, status, expected] of [['23505',409,'ASSIGNMENT_CONFLICT'],['40001',409,'STALE_REVIEW'],
    ['22023',409,'INELIGIBLE_ASSIGNMENT'],['P0002',404,'JOB_NOT_FOUND'],['42501',503,'ASSIGNMENTS_DISABLED'],
    ['PGRST202',503,'ASSIGNMENT_UNAVAILABLE'],['40P01',503,'ASSIGNMENT_UNAVAILABLE']]) {
    f.fail(code); const result = await f.route.POST(f.request());
    assert.equal(result.status, status); assert.equal((await result.json()).code, expected);
  }
  f.fail(null); f.disconnect(true);
  let response = await f.route.POST(f.request());
  assert.equal(response.status, 503); assert.equal((await response.json()).retryable, true);
  f.disconnect(false); response = await f.route.POST(f.request());
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.at(-1).args, f.calls.at(-2).args, 'Retries preserve operation key and full payload');
});
