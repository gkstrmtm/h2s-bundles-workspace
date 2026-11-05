'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createWalkthrough } = require('./walkthrough-fixture.cjs');
const origin = 'https://127.0.0.1:9443';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYs8AAAAASUVORK5CYII=';

async function call(e, name, method, body, actor = 'admin', query = '') {
  const response = await e.request(name, method, body, actor, query);
  const result = await response.json();
  assert.equal(response.status, 200, `${name}: ${JSON.stringify(result)}`);
  assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
  return result;
}
const command = (e, name, body, actor = 'admin') =>
  call(e, name, 'POST', { operationId: crypto.randomUUID(), ...body }, actor);
const workflow = async e => (await e.status()).workflow;
const wfCommand = async (e, record, body) => command(e, 'field-sales-workflow',
  { ...record, revision: (await workflow(e))?.revision || 0, ...body });

for (const scenario of ['tv', 'camera', 'exception']) {
  test(`connected native endpoint walkthrough: ${scenario}`, async t => {
    const e = await createWalkthrough({ origin }); t.after(() => e.close());
    const initial = await e.control('reset', { scenario });
    assert.equal(initial.stage, 'prospect');
    assert.equal(initial.current.orderId, null);
    assert.equal(initial.flags.completed, false);
    assert.equal(initial.provider.sessions.length, 0);
    assert.equal(initial.earnings.entries.length, 0);
    const adminMe = await call(e, 'v1', 'GET', null, 'admin', '?action=dashboardMe');
    assert.deepEqual(adminMe, { ok: true, me: { userId: initial.roles.admin.userId,
      username: 'ADMIN_FIXTURE', displayName: 'Fixture Admin', role: 'ADMIN' } });
    const salesMe = await call(e, 'v1', 'GET', null, 'sales', '?action=dashboardMe');
    assert.deepEqual(salesMe, { ok: true, me: { userId: initial.roles.sales.userId,
      username: 'SALESA', displayName: 'SALESA', role: 'SALES' } });
    assert.deepEqual((await call(e, 'portal_jobs', 'GET', null, 'pro')).completed, []);
    assert.equal((await call(e, 'portal_me', 'GET', null, 'pro')).pro.pro_id, initial.roles.pro.userId);
    assert.equal((await call(e, 'portal_payouts', 'GET', null, 'pro')).ok, true);

    const created = await command(e, 'field-sales', { action: 'create', fullName: `SIMULATED ONLY ${scenario} customer`,
      phone: '+15551112223', address: '100 Synthetic Review Lane', city: 'Review City', market: 'residential',
      services: [initial.suggestions.serviceId], notes: 'SIMULATED ONLY isolated review', followUpAt: null }, 'sales');
    const leadId = created.leadId;
    const quoted = await command(e, 'field-sales-transactions', { action: 'quote', leadId,
      catalogId: initial.suggestions.catalogId, lines: initial.suggestions.lines }, 'sales');
    const submitted = await command(e, 'field-sales-transactions', { action: 'submit', leadId, quoteId: quoted.id }, 'sales');
    let quoteId = submitted.id;
    if (scenario === 'exception') {
      assert.equal((await e.status()).stage, 'approval');
      assert.equal((await e.request('field-sales-transactions', 'POST', { action: 'approve', operationId: crypto.randomUUID(),
        leadId, quoteId, reason: 'Reviewed scope', scopeConfirmation: 'Reviewed masonry mounting' }, 'sales')).status, 403);
      const approved = await command(e, 'field-sales-transactions', { action: 'approve', leadId, quoteId,
        reason: 'SIMULATED ONLY management-reviewed masonry exception',
        scopeConfirmation: 'SIMULATED ONLY sound masonry substrate, reviewed anchoring and access' });
      quoteId = approved.id;
    }
    const record = { leadId, quoteId };
    assert.equal((await e.status()).totals.netPaidCents, 0);
    await wfCommand(e, record, { action: 'enroll', ...initial.suggestions.enrollment });
    let w = await workflow(e);
    await wfCommand(e, record, { action: 'documents_publish', artifacts: w.requiredArtifacts,
      evidence: { reference: 'SIMULATED ONLY reviewed document copies' } });
    const prepared = await command(e, 'field-sales-transactions', { action: 'agreement', ...record }, 'sales');
    assert.equal(new URL(prepared.agreementUrl).origin, origin);
    const token = new URLSearchParams(new URL(prepared.agreementUrl).hash.slice(1)).get('token');
    const facts = await call(e, 'field-sales-agreement', 'GET', null, token);
    await command(e, 'field-sales-agreement', { name: 'Synthetic customer', email: 'synthetic@example.invalid',
      accepted: true, electronicDelivery: true, quoteHash: facts.quote.quote_hash,
      policyVersion: facts.agreement.policy_snapshot.version }, token);
    assert.equal((await e.status()).flags.accepted, true);
    assert.equal((await e.request('field-sales-agreement', 'POST', { action: 'checkout', kind: 'balance',
      operationId: crypto.randomUUID() }, token)).status, 503);
    const deposit = await command(e, 'field-sales-agreement', { action: 'checkout', kind: 'deposit' }, token);
    assert.match(deposit.checkoutUrl, /^https:\/\/checkout\.stripe\.com\//);
    const sid = (await e.status()).provider.sessionId;
    assert.ok(deposit.checkoutUrl.endsWith(sid));
    assert.equal((await e.status()).checkouts[0].url, deposit.checkoutUrl);
    await assert.rejects(e.control('provider_capture', { sessionId: sid, amountCents: 1 }), /reserved amount/);
    await assert.rejects(e.control('provider_capture', { sessionId: sid, feeCents: -1 }), /provider fee/);
    if (scenario === 'exception') {
      const declined = await e.control('provider_decline', { sessionId: sid });
      assert.equal(declined.paid, false);
      assert.equal((await e.status()).totals.netPaidCents, 0);
    }
    const capture = await e.control('provider_capture', { sessionId: sid, feeCents: 151 });
    assert.equal(capture.amountCents, (await e.status()).totals.depositCents);
    assert.equal((await e.control('provider_capture', { sessionId: sid, feeCents: 151 })).replayed, true);
    await assert.rejects(e.control('provider_capture', { sessionId: sid, feeCents: 152 }), /cannot be changed/);
    assert.equal((await e.status()).totals.processingFeeCents, 151);
    let suggestions = (await e.status()).suggestions;
    await wfCommand(e, record, { action: 'schedule', ...suggestions.schedule });
    suggestions = (await e.status()).suggestions;
    await wfCommand(e, record, { action: 'preparation', ...suggestions.preparation });
    suggestions = (await e.status()).suggestions;
    await wfCommand(e, record, { action: 'assign', ...suggestions.assignment });
    w = await workflow(e);
    const jobId = w.jobId;
    const offers = await call(e, 'portal_jobs', 'GET', null, 'pro');
    assert.ok(offers.offers.some(job => job.job_id === jobId), JSON.stringify(offers));
    assert.equal((await call(e, 'portal_jobs', 'GET', null, 'pro', '?job_id=' + jobId)).job.job_id, jobId);
    assert.equal((await e.request('portal_accept', 'POST', { job_id: jobId }, 'pro_other')).status, 403);
    assert.equal((await e.request('portal_jobs', 'GET', null, 'pro_other', '?job_id=' + jobId)).status, 403);
    await call(e, 'portal_accept', 'POST', { job_id: jobId }, 'pro');
    const nativeJob = await call(e, 'portal_jobs', 'GET', null, 'pro', '?job_id=' + jobId);
    assert.equal(nativeJob.job.job_id, jobId);
    assert.equal(nativeJob.job.metadata_json.field_sales_workflow.quoteId, quoteId);
    const readPro = () => call(e, 'field-sales-installation', 'GET', null, 'pro', '?job_id=' + jobId);
    let pro = (await readPro()).workflow;
    assert.equal(pro.canComplete, false);
    const completion = () => ({ job_id: jobId, operationId: crypto.randomUUID(), workflowRevision: pro.revision,
      expenses: suggestions.expenses, hours: suggestions.hours, evidence: suggestions.completionEvidence });
    assert.equal((await e.request('portal_mark_done', 'POST', completion(), 'pro')).status, 400);
    const bindings = [], checklists = [];
    for (const requirement of pro.proof.requirements) {
      if (requirement.type === 'checklist') {
        checklists.push({ serviceId: requirement.serviceId, requirementId: requirement.id, affirmed: true,
          evidence: { reference: 'SIMULATED ONLY operation tested onsite' } });
      } else {
        const artifactIds = [];
        for (let i = 0; i < requirement.minimumCount; i++) {
          const upload = await call(e, requirement.type === 'signature' ? 'portal_upload_signature' : 'portal_upload_artifact',
            'POST', { job_id: jobId, type: requirement.type, data: png, filename: 'synthetic.png', mimetype: 'image/png' }, 'pro');
          artifactIds.push(upload.artifact.artifact_id);
          const asset = new URL(upload.artifact.url || upload.artifact.storage_url);
          assert.equal(asset.origin, origin);
          const downloaded = await e.request('walkthrough-artifact', 'GET', null, 'pro', asset.search);
          assert.equal(downloaded.status, 200);
          assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), Buffer.from(png, 'base64'));
          assert.equal((await e.request('walkthrough-artifact', 'GET', null, 'pro_other', asset.search)).status, 403);
        }
        bindings.push({ serviceId: requirement.serviceId, requirementId: requirement.id, artifactIds });
      }
    }
    pro = (await readPro()).workflow;
    await command(e, 'field-sales-installation', { action: 'proof_record', job_id: jobId,
      workflowRevision: pro.revision, bindings, checklists }, 'pro');
    pro = (await readPro()).workflow;
    assert.equal(pro.canComplete, true);
    const artifacts = await call(e, 'portal_get_artifacts', 'POST', { job_id: jobId }, 'pro');
    assert.ok(artifacts.artifacts.length >= (scenario === 'camera' ? 3 : 2));
    const complete = await call(e, 'portal_mark_done', 'POST', completion(), 'pro');
    assert.equal(complete.completed, true);
    assert.equal((await e.status()).flags.completed, true);
    assert.equal((await e.status()).flags.earned, false);
    const balance = await command(e, 'field-sales-agreement', { action: 'checkout', kind: 'balance' }, token);
    assert.match(balance.checkoutUrl, /^https:\/\/checkout\.stripe\.com\//);
    await e.control('provider_capture', { sessionId: (await e.status()).provider.sessionId, feeCents: 249 });
    assert.equal((await e.status()).flags.earned, false);
    await wfCommand(e, record, { action: 'cost_review', expenses: suggestions.expenses,
      evidence: suggestions.costReviewEvidence });
    let final = await e.status();
    assert.equal(final.flags.earned, true);
    assert.equal(final.totals.netPaidCents, final.totals.totalCents);
    assert.equal(final.totals.processingFeeCents, 400);
    const entry = final.earnings.entries[0];
    assert.equal(entry.tenureDay, 40);
    assert.equal(entry.rateBasisPoints, 5000);
    assert.equal(entry.basisCents, final.totals.totalCents - suggestions.expenses.reduce((n, e) => n + e.amountCents, 0) - 400);
    const run = await command(e, 'field-sales-earnings', { action: 'create_run',
      settlementPolicyId: final.suggestions.settlement.settlementPolicyId, runDate: final.suggestions.settlement.runDate });
    await command(e, 'field-sales-earnings', { action: 'approve_run', runId: run.runId, evidence: 'SIMULATED ONLY reviewed Friday run' });
    await command(e, 'field-sales-earnings', { action: 'export_run', runId: run.runId, evidence: 'SIMULATED ONLY manual export' });
    assert.equal((await e.status()).flags.settled, false);
    await command(e, 'field-sales-earnings', { action: 'record_settlement', runId: run.runId, proof: {
      reference: 'synthetic-independent-' + run.runId, method: final.suggestions.settlement.method, settledAt: new Date().toISOString(),
      amountCents: entry.amountCents, beneficiaries: [{ representativeId: final.roles.sales.userId, amountCents: entry.amountCents }],
      evidence: { statement: 'SIMULATED ONLY independent bank reconciliation fixture' }, independentReconciliation: true
    } });
    final = await e.status();
    assert.equal(final.flags.settled, true);
    assert.equal(final.earnings.externalPaymentInitiated, false);
    assert.equal((await call(e, 'field-sales-earnings', 'GET', null, 'sales_other')).entries.length, 0);
    const reset = await e.control('reset', { scenario: 'tv' });
    assert.equal(reset.current.leadId, null);
    assert.equal(reset.totals.netPaidCents, 0);
    assert.equal((await e.request('field-sales-agreement', 'GET', null, token)).status >= 400, true);
  });
}

test('money, role, origin, reset and unavailable guards remain fail closed', async t => {
  await assert.rejects(createWalkthrough({ origin: 'https://production.example' }), /loopback/);
  const e = await createWalkthrough({ origin }); t.after(() => e.close());
  const pending = e.request('field-sales', 'GET', null, 'admin');
  await assert.rejects(e.control('reset', { scenario: 'camera' }), /busy/);
  await pending;
  await assert.rejects(e.control('reset', { scenario: 'unknown' }), /Select/);
  await assert.rejects(e.control('advance', { completed: true }), /Unsupported/);
  await assert.rejects(e.control('provider_capture', { sessionId: 'cs_unowned', amountCents: 1 }), /exact existing/);
  assert.equal((await e.request('field-sales', 'GET', null, 'pro')).status, 401);
  assert.equal((await e.request('portal_me', 'GET', null, 'sales')).status, 401);
  assert.equal((await e.request('portal_accept', 'POST', { token: 'pro', job_id: crypto.randomUUID() }, 'sales')).status, 403);
  const nativeMe = await call(e, 'portal_me', 'GET', null, 'pro', '?token=local-review-pro');
  assert.equal(nativeMe.pro.pro_id, (await e.status()).roles.pro.userId);
  assert.deepEqual({ name: nativeMe.pro.name, vehicle_text: nativeMe.pro.vehicle_text,
    service_radius_miles: nativeMe.pro.service_radius_miles, max_jobs_per_day: nativeMe.pro.max_jobs_per_day,
    photo_url: nativeMe.pro.photo_url, bio_short: nativeMe.pro.bio_short, zip: nativeMe.pro.zip,
    geo_lat: nativeMe.pro.geo_lat, geo_lng: nativeMe.pro.geo_lng }, {
    name: 'SIMULATED ONLY Review Installer', vehicle_text: 'SIMULATED ONLY white installation van',
    service_radius_miles: 50, max_jobs_per_day: 4,
    photo_url: origin + '/walkthrough/artifact?key=synthetic-profile-photo.png',
    bio_short: 'SIMULATED ONLY existing technician profile for isolated TV and camera installation review.',
    zip: '28202', geo_lat: 35.2271, geo_lng: -80.8431
  });
  const profilePhoto = await e.request('walkthrough-artifact', 'GET', null, 'pro', new URL(nativeMe.pro.photo_url).search);
  assert.equal(profilePhoto.status, 200);
  assert.deepEqual(Buffer.from(await profilePhoto.arrayBuffer()), Buffer.from(png, 'base64'));
  assert.equal((await e.request('portal_me', 'GET', null, 'pro', '?token=local-review-pro-forged')).status, 403);
  assert.equal((await e.request('portal_me', 'GET', null, 'pro_other', '?token=local-review-pro')).status, 403);
  assert.equal((await e.request('portal_accept', 'POST', { token: 'local-review-pro', job_id: crypto.randomUUID() }, 'sales')).status, 403);
  const native = await e.request('portal_training', 'GET', null, 'pro');
  assert.equal(native.status, 503); assert.equal((await native.json()).unavailable, true);
  const webhook = await e.request('field-sales-stripe-webhook', 'POST', { fake: true }, 'admin');
  assert.equal(webhook.status, 503);
  assert.equal((await e.status()).flags.completed, false);
  const settings = await call(e, 'field-sales-catalog', 'GET');
  assert.equal(settings.enabled, true);
  assert.equal((await e.request('field-sales-catalog', 'GET', null, 'sales')).status, 403);
  const changed = structuredClone(settings.catalogs[0].definition);
  changed.services[0].completionRequirements[0].minimumCount = 3;
  const catalogId = crypto.randomUUID();
  await command(e, 'field-sales-catalog', { action: 'create_draft', catalogId, version: 'SIMULATED-ONLY-review-v2',
    definition: changed, sourceEvidence: { approvalEvidence: 'SIMULATED ONLY reviewed proof and itemized price fixture' } });
  const draft = (await call(e, 'field-sales-catalog', 'GET', null, 'admin', '?catalogId=' + catalogId)).catalogs[0];
  await command(e, 'field-sales-catalog', { action: 'publish', catalogId, expectedDigest: draft.digest,
    approvalEvidence: 'SIMULATED ONLY approved review policy and prices' });
  const revised = (await e.status()).pricing.catalogs.find(row => row.catalog_id === catalogId);
  assert.equal(revised.definition.services[0].completionRequirements[0].minimumCount, 3);
  assert.equal(revised.status, 'published');
});
