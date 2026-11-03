const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { createSalesFixture, id } = require('./helpers/field_sales_fixture.cjs');
const post = (f, body, actor = 'admin') => f.request('field-sales', 'POST', { operationId: crypto.randomUUID(), ...body }, actor);
const prospect = phone => ({ action: 'create', fullName: 'Synthetic customer', phone, address: '100 Fixture Lane', city: 'Fixture City',
  market: 'residential', services: ['tv_mounting'], notes: '', followUpAt: null });
const get = (f, lead, actor) => f.request('field-sales', 'GET', null, actor, lead ? '?leadId=' + lead : '');
test('default-off gates, account creation, secure login, revocation and legacy staff isolation', async t => {
  const f = await createSalesFixture(); t.after(() => f.db.close());
  assert.equal((await post(f, { action: 'account_create', username: 'SALESNEW', displayName: 'Synthetic representative', pin: 'synthetic-password-at-least-16' })).status, 503);
  await f.enable();
  assert.equal((await get(f, null, 'va')).status, 403); assert.equal((await get(f, null, 'missing')).status, 401);
  const operationId = crypto.randomUUID(), payload = { action: 'account_create', operationId, username: 'SALESNEW', displayName: 'Synthetic representative', pin: 'synthetic-password-at-least-16' };
  assert.equal((await post(f, payload, 'a')).status, 403);
  assert.equal((await post(f, payload)).status, 200); assert.equal((await post(f, payload)).status, 200, 'Identical credential retry');
  let user = (await f.db.query('select * from "Dashboard_Users" where "User_ID"=$1', [operationId])).rows[0];
  assert.equal(user.Role, 'SALES'); assert.equal(user.Is_Disabled, true);
  assert.equal((await f.auth.dashboardLogin(new Request('https://fixture.invalid'), { username: 'SALESNEW', pin: payload.pin })).status, 403);
  assert.equal((await post(f, { action: 'account_state', userId: operationId, active: true })).status, 200);
  await assert.rejects(f.db.query('update "Dashboard_Users" set "Role"=$1 where "User_ID"=$2', ['VA', operationId]), /Sales role transitions/);
  const login = await f.auth.dashboardLogin(new Request('https://fixture.invalid'), { username: 'SALESNEW', pin: payload.pin });
  assert.equal(login.user.role, 'SALES'); assert.match(login.token, /^h2s-sales:/);
  assert.ok(Date.parse(login.expiresAt) <= Date.now() + 8 * 3600000);
  const request = new Request('https://fixture.invalid/api/v1?action=dashboardMe', { headers: { authorization: 'Bearer ' + login.token } });
  assert.equal((await f.auth.dashboardMe(request)).role, 'SALES');
  for (const method of ['GET', 'POST']) {
    for (const action of ['dashboardUsers', 'getTasks', 'dashboardImpersonate', 'commercialQueue', 'updateUser']) {
      const response = await f.auth['guard' + method](new Request('https://fixture.invalid/api/v1?action=' + action, { headers: { authorization: 'Bearer ' + login.token } }));
      assert.equal(response.status, 403, method + action);
    }
  }
  assert.equal((await f.db.query('select count(*)::int n from "Dashboard_Sessions" where "User_ID"=$1', [operationId])).rows[0].n, 1);
  await post(f, { action: 'account_state', userId: operationId, active: false });
  assert.equal((await f.db.query('select count(*)::int n from "Dashboard_Sessions" where "User_ID"=$1', [operationId])).rows[0].n, 0);
  assert.equal((await f.auth.dashboardMe(request)).status, 401);
  f.env.H2S_FIELD_SALES_ENABLED = 'false';
  assert.equal((await (await get(f, null, 'admin')).json()).enabled, false);
});
test('lead reuse, customer isolation, stale ownership, atomic retries and shared queue activity', async t => {
  const f = await createSalesFixture(); t.after(() => f.db.close()); await f.enable();
  const operationId = crypto.randomUUID(), create = { ...prospect('+15550001001'), operationId };
  const created = await (await post(f, create, 'a')).json(); assert.equal(created.ok, true, created.error);
  const lead = created.leadId;
  const spoofed = await (await post(f, { ...prospect('+15550001006'), ownerId: id(20) }, 'b')).json();
  assert.equal((await (await get(f, spoofed.leadId, 'b')).json()).opportunity.owner_user_id, id(21), 'Owner comes from the authenticated representative, not submitted input');
  assert.equal((await (await post(f, create, 'a')).json()).replayed, true);
  assert.equal((await post(f, { ...create, fullName: 'Different payload' }, 'a')).status, 409);
  assert.equal((await post(f, { ...prospect('+15550001001'), ownerId: id(21) }, 'b')).status, 409);
  assert.equal((await get(f, lead, 'b')).status, 404);
  assert.equal((await (await get(f, null, 'b')).json()).opportunities.length, 1);
  assert.equal((await (await get(f, null, 'admin')).json()).opportunities.length, 2);
  let record = await (await get(f, lead, 'a')).json();
  assert.equal(record.opportunity.owner_user_id, id(20)); assert.equal(record.history[0].action, 'field_sales.create');
  const assigned = await post(f, { action: 'assign', leadId: lead, ownerId: id(21), revision: record.opportunity.revision, note: 'Verified reassignment' });
  assert.equal(assigned.status, 200);
  assert.equal((await get(f, lead, 'a')).status, 404); assert.equal((await post(f, create, 'a')).status, 404, 'Replayed writes revalidate current ownership');
  assert.equal((await post(f, { action: 'review', leadId: lead, revision: record.opportunity.revision, status: 'reviewed', note: 'Stale review' })).status, 409);
  const count = (await f.db.query('select count(*)::int n from commercial_leads')).rows[0].n;
  assert.equal((await post(f, { action: 'attach', leadId: id(1), ownerId: id(20), evidence: 'Verified original inquiry record' })).status, 200);
  assert.equal((await f.db.query('select count(*)::int n from commercial_leads')).rows[0].n, count, 'Exact attachment reuses lead');
  assert.equal((await post(f, { action: 'attach', leadId: id(2), ownerId: id(20), evidence: 'Guess' }, 'a')).status, 403);
  const denied = await f.db.query("select has_table_privilege('authenticated','field_sales_opportunities','SELECT') allowed");
  assert.equal(denied.rows[0].allowed, false);
  const rpc = await f.db.query("select has_function_privilege('anon','field_sales_command(uuid,uuid,text,jsonb)','EXECUTE') allowed");
  assert.equal(rpc.rows[0].allowed, false);
});
test('service configuration rejects malformed/null questions and invalid numeric bounds; field-origin queue labels stay synchronized', async t => {
  const f = await createSalesFixture(); t.after(() => f.db.close()); await f.enable();
  const lead = (await (await post(f, prospect('+15550001007'), 'a')).json()).leadId;
  const record = await (await get(f, lead, 'a')).json();
  const save = { action: 'save', leadId: lead, revision: record.opportunity.revision, services: ['smart_locks'],
    answers: { smart_locks: { quantity: -1 } }, photoConsent: false, consentNote: '', notes: '', followUpAt: null, submit: false };
  assert.equal((await post(f, save, 'a')).status, 400);
  save.answers.smart_locks.quantity = 1;
  assert.equal((await post(f, save, 'a')).status, 200);
  assert.deepEqual((await f.db.query('select service_needs from commercial_leads where lead_id=$1', [lead])).rows[0].service_needs, ['Smart Locks']);
  await f.db.exec(`update field_sales_services set definition=jsonb_set(definition,'{questions}','[null]'::jsonb) where service_id='smart_locks'`);
  assert.equal((await get(f, null, 'a')).status, 503);
});
test('configurable complete catalog, assessment versions, review states and private permissioned photo retries', async t => {
  const f = await createSalesFixture(); t.after(() => f.db.close()); await f.enable();
  const services = await f.sales.serviceDefinitions();
  assert.deepEqual(services.map(s => s.service_id).sort(), ['cameras_included','cameras_owned','smart_home_setup','smart_locks','soundbar_mounting','tv_mounting']);
  const original = (await f.db.query('select (select count(*) from h2s_orders)::int orders,(select count(*) from h2s_dispatch_jobs)::int jobs,(select count(*) from h2s_payouts_ledger)::int payouts')).rows[0];
  const created = await (await post(f, { ...prospect('+15550001002'), services: ['smart_locks'] }, 'a')).json();
  assert.equal(created.ok, true, created.error); const lead = created.leadId;
  let record = await (await get(f, lead, 'a')).json();
  let save = { action: 'save', leadId: lead, revision: record.opportunity.revision, services: ['smart_locks'], answers: { smart_locks: { quantity: 2 } },
    photoConsent: false, consentNote: '', submit: true, followUpAt: null, notes: 'Synthetic assessment' };
  assert.equal((await post(f, save, 'a')).status, 400, 'Required service questions enforced on submit');
  assert.equal((await post(f, { ...save, answers: { smart_locks: { quantity: 2, requirements: 'Existing deadbolt / customer equipment' } }, photoConsent: true, consentNote: 'Customer expressly permits assessment photographs' }, 'a')).status, 200);
  record = await (await get(f, lead, 'a')).json(); assert.equal(record.opportunity.status, 'ready_for_review');
  const photo = { operationId: crypto.randomUUID(), leadId: lead, serviceId: 'smart_locks', label: 'Door and existing lock', filename: 'assessment.jpg', data: 'data:image/jpeg;base64,/9j/AA==' };
  assert.equal((await f.request('field-sales-photos', 'POST', photo, 'b')).status, 404);
  assert.equal((await f.request('field-sales-photos', 'POST', { ...photo, label: 'Unconfigured label' }, 'a')).status, 400);
  f.businessFaults.upload = true;
  assert.equal((await f.request('field-sales-photos', 'POST', photo, 'a')).status, 503);
  let files = (await (await get(f, lead, 'a')).json()).photos; assert.equal(files[0].state, 'pending');
  f.businessFaults.upload = false;
  assert.equal((await f.request('field-sales-photos', 'POST', photo, 'a')).status, 200);
  assert.equal((await f.request('field-sales-photos', 'POST', photo, 'a')).status, 200, 'Idempotent verified upload');
  record = await (await get(f, lead, 'a')).json();
  assert.equal(record.opportunity.status, 'assessing', 'New evidence invalidates ready/reviewed assessment');
  assert.equal(record.history.filter(event => event.action === 'field_sales.photo').length, 1, 'Photo retry audits once');
  assert.equal(record.opportunity.revision, save.revision + 2, 'Save and photo completion each advance revision once');
  const image = await f.request('field-sales-photos', 'GET', null, 'a', `?leadId=${lead}&photoId=${photo.operationId}`);
  assert.equal(image.status, 200); assert.match(image.headers.get('cache-control'), /private, no-store/);
  assert.equal((await f.request('field-sales-photos', 'GET', null, 'b', `?leadId=${lead}&photoId=${photo.operationId}`)).status, 404);
  record = await (await get(f, lead, 'a')).json();
  await post(f, { ...save, submit: false, revision: record.opportunity.revision }, 'a');
  assert.equal((await f.request('field-sales-photos', 'GET', null, 'a', `?leadId=${lead}&photoId=${photo.operationId}`)).status, 403, 'Revoked customer consent denies photo reads');
  f.businessFaults.publicBucket = true;
  assert.equal((await f.request('field-sales-photos', 'POST', { ...photo, operationId: crypto.randomUUID() }, 'a')).status, 503);
  assert.deepEqual((await f.db.query('select (select count(*) from h2s_orders)::int orders,(select count(*) from h2s_dispatch_jobs)::int jobs,(select count(*) from h2s_payouts_ledger)::int payouts')).rows[0], original);
  await f.db.exec("update field_sales_services set version=2 where service_id='smart_locks'");
  const stale = await f.client.rpc('field_sales_command', { p_actor: id(20), p_operation: crypto.randomUUID(), p_action: 'save',
    p_payload: { ...save, revision: record.opportunity.revision + 1, services: ['smart_locks'], assessments: { smart_locks: { version: 1, answers: {} } } } });
  assert.equal(stale.error.code, '40001');
});
test('shared session reader retains ADMIN/VA and requires explicit SALES opt-in; disabled, expired and unknown users fail closed', async t => {
  const { evaluate } = require('./helpers/commercial_operations_fixture.cjs');
  const f = await createSalesFixture(); t.after(() => f.db.close()); await f.enable();
  const auth = evaluate('lib\\dashboardAuth.ts', { 'node:crypto': crypto,
    '@/lib/supabase': { getSupabase: () => f.client, getSupabaseMgmt: () => f.client } }, { Buffer });
  const request = token => new Request('https://fixture.invalid', { headers: { authorization: 'Bearer ' + token } });
  for (const [actor, role] of [['admin','ADMIN'],['va','VA'],['a','SALES']]) {
    const token = 'isolated-shared-session-' + actor;
    await f.db.query('insert into "Dashboard_Sessions"("User_ID","Token_Hash","Expires_At") values($1,$2,now()+interval \'1 hour\')',
      [f.actors[actor], crypto.createHash('sha256').update(token).digest('base64url')]);
    assert.equal((await auth.getDashboardAuthUserFromSession(request(token), { allowSales: true, touchSession: false })).role, role);
    assert.equal(!!await auth.getDashboardAuthUserFromSession(request(token), { touchSession: false }), role !== 'SALES');
  }
  await f.db.query('update "Dashboard_Sessions" set "Expires_At"=now()-interval \'1 minute\' where "User_ID"=$1', [id(20)]);
  assert.equal(await auth.getDashboardAuthUserFromSession(request('isolated-shared-session-a'), { allowSales: true }), null);
  await f.db.query('update "Dashboard_Users" set "Role"=$1 where "User_ID"=$2', ['UNKNOWN', id(10)]);
  assert.equal(await auth.getDashboardAuthUserFromSession(request('isolated-shared-session-va')), null);
  await f.db.query('update "Dashboard_Users" set "Is_Disabled"=true where "User_ID"=$1', [id(9)]);
  assert.equal(await auth.getDashboardAuthUserFromSession(request('isolated-shared-session-admin')), null);
});
test('failed audit transaction rolls back inquiry creation and photo completion without deleting private evidence', async t => {
  const f = await createSalesFixture(); t.after(() => f.db.close()); await f.enable();
  const lead = (await (await post(f, prospect('+15550001004'), 'a')).json()).leadId;
  const record = await (await get(f, lead, 'a')).json();
  await post(f, { action: 'save', leadId: lead, revision: record.opportunity.revision, services: ['tv_mounting'], answers: {},
    photoConsent: true, consentNote: 'Explicit synthetic permission', notes: '', followUpAt: null, submit: false }, 'a');
  const before = await (await get(f, lead, 'a')).json();
  const count = (await f.db.query('select count(*)::int n from commercial_leads')).rows[0].n;
  await f.db.exec(`create function sales_test_fail_audit() returns trigger language plpgsql as $$begin raise exception 'Isolated audit fault'; end$$;
    create trigger sales_test_fail_audit before insert on commercial_lead_activity for each row execute function sales_test_fail_audit();`);
  assert.equal((await post(f, prospect('+15550001005'), 'a')).status, 503);
  assert.equal((await f.db.query('select count(*)::int n from commercial_leads')).rows[0].n, count);
  const photo = { operationId: crypto.randomUUID(), leadId: lead, serviceId: 'tv_mounting', label: 'Wall and mounting location',
    filename: 'assessment.jpg', data: 'data:image/jpeg;base64,/9j/AA==' };
  // Use the actual configurable label rather than a duplicate policy.
  photo.label = (await f.sales.serviceDefinitions()).find(service => service.service_id === 'tv_mounting').definition.photos[0];
  assert.equal((await f.request('field-sales-photos', 'POST', photo, 'a')).status, 503);
  const after = await (await get(f, lead, 'a')).json();
  assert.equal(after.opportunity.revision, before.opportunity.revision); assert.equal(after.photos[0].state, 'pending');
  assert.equal(after.history.length, before.history.length);
  await f.db.exec('drop trigger sales_test_fail_audit on commercial_lead_activity');
  assert.equal((await f.request('field-sales-photos', 'POST', photo, 'a')).status, 200, 'Exact retry completes retained pending evidence');
});
