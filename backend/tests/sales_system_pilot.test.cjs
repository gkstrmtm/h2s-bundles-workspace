const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { createWorkflowFixture, id } = require('./helpers/field_workflow_fixture.cjs');

async function checked(response, label) {
  const result = await response.json();
  assert.equal(result.ok, true, label + ': ' + (result.error || JSON.stringify(result)));
  return result;
}
const dateShift = (date, days) => {
  const value = new Date(date + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

test('five representatives each complete TV and camera sales through actual authorities and Friday review', { timeout: 180000 }, async t => {
  const f = await createWorkflowFixture(); t.after(() => f.db.close());
  f.definition.services.find(service => service.id === 'tv_mounting').offers[0].unitCents = 10001;
  f.definition.services.find(service => service.id === 'equipment_cameras').offers[0].unitCents = 20003;
  f.definition.services.find(service => service.id === 'tv_mounting').completionRequirements = [
    { id: 'finished_tv', label: 'Synthetic installed TV photo', type: 'photo', minimumCount: 1 }
  ];
  f.definition.services.find(service => service.id === 'equipment_cameras').completionRequirements = [
    { id: 'camera_security', label: 'Synthetic camera security check', type: 'checklist', minimumCount: 1 }
  ];
  await f.enable();
  const policies = (await checked(await f.read(null), 'Policy read')).policies;
  const commission = policies.find(policy => policy.kind === 'commission');
  const settlement = policies.find(policy => policy.kind === 'settlement');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: commission.definition.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const representatives = ['a', 'b', 'c', 'd', 'e'], offsets = [0, 29, 30, 59, 60], rates = [5500, 5500, 5000, 5000, 4500];
  const oldJobs = await f.db.query('select to_jsonb(j) row from h2s_dispatch_jobs j where job_id in ($1,$2) order by job_id', [id(101), id(202)]);
  const oldOrders = await f.db.query('select to_jsonb(o) row from h2s_orders o where id in ($1,$2) order by id', [id(100), id(200)]);
  for (const alias of representatives.slice(2)) {
    const userId = crypto.randomUUID(); f.actors[alias] = userId;
    await checked(await f.request('field-sales', 'POST', { action: 'account_create', operationId: userId,
      username: 'PILOT' + alias.toUpperCase(), displayName: 'Synthetic pilot ' + alias,
      pin: 'synthetic-pilot-password-' + alias }, 'admin'), 'Synthetic account');
    await checked(await f.request('field-sales', 'POST', { action: 'account_state',
      operationId: crypto.randomUUID(), userId, active: true }, 'admin'), 'Synthetic enrollment');
  }
  const earningsRead = async (actor = 'admin', quoteId = null) => (await f.db.query(
    'select field_sales_earnings_read($1::uuid,null::uuid,$2::uuid) result', [f.actors[actor], quoteId])).rows[0].result;
  const earningsCommand = async (action, input) => (await f.db.query(
    'select field_sales_earnings_command($1::uuid,$2::uuid,$3::text,$4::jsonb) result',
    [f.actors.admin, crypto.randomUUID(), action, JSON.stringify(input)])).rows[0].result;
  const workflow = async record => {
    const data = await checked(await f.read(record.leadId), 'Workflow read');
    const found = data.workflows.find(item => item.quoteId === record.quoteId);
    assert.ok(found, 'Exact quote has one enrolled workflow');
    return found;
  };
  const manage = async (record, action, extra) => {
    const current = await workflow(record);
    return checked(await f.admin({ action, leadId: record.leadId, quoteId: record.quoteId,
      revision: current.revision, ...extra }), action);
  };
  const capture = async (record, kind, amountCents, fee) => {
    const operationId = crypto.randomUUID(), before = f.sessions.size;
    const payment = await checked(await f.request('field-sales-agreement', 'POST',
      { action: 'checkout', operationId, kind }, record.token), kind + ' Checkout');
    assert.equal(f.sessions.size, before + 1);
    const sessionId = [...f.sessions.keys()].at(-1), paid = f.paid(sessionId);
    assert.equal(paid.session.amount_total, amountCents, 'Provider amount is the authoritative cent amount');
    paid.charge.balance_transaction = { id: 'txn_pilot_' + sessionId, source: paid.charge.id,
      amount: amountCents, fee, net: amountCents - fee, currency: 'usd', fee_details: [] };
    const eventId = 'evt_pilot_' + crypto.randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await f.webhook('checkout.session.completed', paid.session, eventId);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).received, true, 'Signed receipt and retry are explicitly acknowledged');
    }
    const replay = await f.request('field-sales-agreement', 'POST', { action: 'checkout', operationId, kind }, record.token);
    const replayResult = await replay.json();
    assert.ok(replay.ok ? replayResult.ok : replayResult.ok === false && typeof replayResult.error === 'string',
      'A duplicate Checkout explicitly reuses or refuses the existing attempt');
    assert.equal(f.sessions.size, before + 1, 'No duplicate provider session');
    assert.equal((await f.db.query('select count(*)::int count from field_sales_payment_events where event_id=$1', ['stripe:' + eventId])).rows[0].count, 1);
    return payment;
  };
  const leadIds = [], entryIds = [], expectedAmounts = [];
  for (const [index, alias] of representatives.entries()) {
    const terms = (await f.db.query('select commission_terms_revision from field_sales_representatives where user_id=$1', [f.actors[alias]])).rows[0];
    await checked(await f.request('field-sales', 'POST', { action: 'representative_terms', operationId: crypto.randomUUID(),
      userId: f.actors[alias], commissionStartDate: dateShift(today, -offsets[index]),
      commissionStartEvidence: 'Synthetic approved pilot start ' + alias,
      termsRevision: terms.commission_terms_revision }, 'admin'), 'Evidenced start');
    const lead = await checked(await f.request('field-sales', 'POST', { action: 'create', operationId: crypto.randomUUID(),
      fullName: 'Synthetic customer', phone: '+155500024' + String(index + 1).padStart(2, '0'),
      address: '100 Synthetic Pilot Lane', city: 'Synthetic City', market: index === 4 ? 'commercial' : 'residential',
      services: ['tv_mounting', 'cameras_included'], notes: 'Isolated pilot only; no approved live prices.' }, alias), 'Prospect');
    leadIds.push(lead.leadId);
    for (const other of representatives.filter(value => value !== alias)) {
      assert.equal((await f.request('field-sales', 'GET', null, other, '?leadId=' + lead.leadId)).status, 404);
    }
    const lines = [
      { serviceId: 'tv_mounting', offerId: 'standard', quantity: 1, answers: { size: 50, wall: 'drywall' }, options: [] },
      { serviceId: 'equipment_cameras', offerId: 'package', quantity: 2, answers: { size: 50, wall: 'drywall' }, options: [] }
    ];
    for (const [serviceIndex, line] of lines.entries()) {
      const standalone = await checked(await f.post({ action: 'quote', leadId: lead.leadId, catalogId: f.catalogId,
        lines: [line] }, alias), 'Standalone authoritative service draft');
      const priced = (await f.db.query('select snapshot from field_sales_quotes where quote_id=$1', [standalone.id])).rows[0];
      assert.equal(priced.snapshot.totalCents, serviceIndex ? 20003 : 10001);
    }
    {
      const draft = await checked(await f.post({ action: 'quote', leadId: lead.leadId, catalogId: f.catalogId,
        lines }, alias), 'Combined authoritative draft');
      let quote = await checked(await f.post({ action: 'submit', leadId: lead.leadId, quoteId: draft.id }, alias), 'Quote submission');
      quote = await checked(await f.post({ action: 'approve', leadId: lead.leadId, quoteId: quote.id,
        reason: 'Synthetic combined scope review', scopeConfirmation: 'Synthetic TV and two-camera installation explicitly reviewed.' }, 'admin'), 'Starting-price approval');
      let record = { leadId: lead.leadId, quoteId: quote.id };
      await checked(await f.admin({ action: 'enroll', ...record, revision: 0,
        legalPolicyId: f.policyIds.legal, commissionPolicyId: f.policyIds.commission,
        settlementPolicyId: f.policyIds.settlement, representativeId: f.actors[alias],
        creditEvidence: { reference: 'synthetic-pilot-credit-' + alias } }), 'Explicit new-sale enrollment');
      record = await f.documents(record, alias); record = await f.accept(record);
      let w = await workflow(record);
      assert.equal(w.totalCents, 30004);
      assert.equal(w.depositCents, Math.ceil(w.totalCents * 0.25));
      assert.equal(w.agreedBalanceCents, w.totalCents - w.depositCents);
      const beforeEarly = f.sessions.size;
      const early = await f.request('field-sales-agreement', 'POST', { action: 'checkout',
        operationId: crypto.randomUUID(), kind: 'balance' }, record.token);
      const earlyResult = await early.json();
      assert.equal(early.ok, false, 'No pre-install balance');
      assert.equal(earlyResult.ok, false);
      assert.ok(earlyResult.error);
      assert.equal(f.sessions.size, beforeEarly, 'Blocked balance creates no provider session');
      await capture(record, 'deposit', w.depositCents, 31);
      w = await workflow(record);
      assert.equal(w.netPaidCents, w.depositCents);
      assert.ok(new Date(w.cancellationDeadline) <= new Date(), 'Only explicitly synthetic zero-day fixture clearance');
      const start = new Date(Date.now() + 86400000 + index * 10800000);
      await manage(record, 'schedule', { reservationRevision: w.reservation?.revision || 0,
        start: start.toISOString(), end: new Date(start.getTime() + 7200000).toISOString(),
        timezone: 'UTC', customerAgreed: true, reason: 'Synthetic customer-agreed appointment' });
      w = await workflow(record);
      await manage(record, 'preparation', { preparationRevision: w.preparation.record?.revision || 0,
        scopeReviewed: true, materials: 'ready', access: 'ready', blockers: '', note: 'Synthetic scope/site/material review' });
      w = await workflow(record);
      await manage(record, 'assign', { proId: id(500), context: w.assignmentPreview.job.context, note: 'Synthetic scoped assignment' });
      w = await workflow(record);
      await f.db.query("select h2s_management_respond_to_offer($1::uuid,$2::uuid,'accept')", [w.jobId, id(500)]);
      await f.uploadProof(w.jobId);
      const pro = await checked(await f.proRead(w.jobId), 'Assigned technician configured proof');
      assert.equal(pro.workflow.gates.canComplete, false, 'Native uploads do not satisfy unbound configured requirements');
      const photo = pro.workflow.proof.candidates.find(artifact => artifact.type === 'photo');
      assert.ok(photo, 'Only an actual native installation artifact is selected');
      await checked(await f.complete({ job_id: w.jobId, operationId: crypto.randomUUID(),
        workflowRevision: pro.workflow.revision, action: 'proof_record',
        bindings: [{ serviceId: 'tv_mounting', requirementId: 'finished_tv', artifactIds: [photo.artifactId] }],
        checklists: [{ serviceId: 'equipment_cameras', requirementId: 'camera_security', affirmed: true,
          evidence: { reference: 'synthetic-camera-security-checked' } }] }), 'Pinned service evidence save');
      const proofReady = await checked(await f.proRead(w.jobId), 'Refreshed proof clearance');
      assert.equal(proofReady.workflow.proof.complete, true);
      assert.equal(proofReady.workflow.gates.canComplete, true);
      const expenses = [
        { category: 'equipment', quantity: 1, unitCents: 1500, amountCents: 1500,
          actual: true, evidence: { reference: 'synthetic-equipment-receipt' } },
        { category: 'materials', quantity: 0.07, unitCents: 100, amountCents: 7, actual: true,
          evidence: { reference: 'synthetic-material-allocation' } }
      ];
      w = await workflow(record);
      await checked(await f.complete({ job_id: w.jobId, operationId: crypto.randomUUID(), workflowRevision: w.revision,
        hours: 2, expenses, evidence: { reference: 'synthetic-completed-installation' } }), 'Actual-cost/hours/proof completion');
      w = await workflow(record);
      assert.ok(w.completedAt);
      assert.equal(w.netPaidCents, w.depositCents, 'Installation finishes before the final balance');
      assert.equal((await earningsRead('admin', record.quoteId)).entries.length, 0);
      await capture(record, 'balance', w.totalCents - w.netPaidCents, 79);
      const held = await earningsRead('admin', record.quoteId);
      assert.ok(held.orders[0].qualifiesAt, 'Qualification is captured despite unreviewed actual costs');
      assert.equal(held.entries.length, 0, 'Technician-entered expenses are not payable-approved actual costs');
      await manage(record, 'cost_review', { expenses,
        evidence: { reference: 'synthetic-manager-reviewed-actuals', actualCostsReviewed: true } });
      w = await workflow(record);
      assert.equal(w.balanceCents, 0);
      assert.equal(w.processingFeeCents, 110);
      const earned = await earningsRead('admin', record.quoteId), entry = earned.entries[0];
      assert.ok(entry, 'One immutable commission entry');
      assert.equal(earned.entries.length, 1);
      assert.equal(entry.representativeId, f.actors[alias]);
      assert.equal(entry.rateBasisPoints, rates[index]);
      assert.equal(entry.tenureDay, offsets[index] + 1);
      const basis = w.totalCents - expenses.reduce((sum, item) => sum + item.amountCents, 0) - 110;
      assert.equal(entry.basisCents, basis, 'Technician wages are not deducted');
      assert.equal(entry.amountCents, Math.floor((basis * rates[index] + 5000) / 10000));
      entryIds.push(entry.entryId); expectedAmounts.push(entry.amountCents);
    }
  }
  const reviewDate = new Date(today + 'T12:00:00Z');
  reviewDate.setUTCDate(reviewDate.getUTCDate() + (((5 - reviewDate.getUTCDay() + 7) % 7) || 7));
  const run = await earningsCommand('create_run', { settlementPolicyId: settlement.policy_id,
    runDate: reviewDate.toISOString().slice(0, 10) });
  assert.equal(run.state, 'draft');
  assert.equal(run.beneficiaries.length, 5);
  assert.equal(run.amountCents, expectedAmounts.reduce((sum, amount) => sum + amount, 0));
  await earningsCommand('approve_run', { runId: run.runId, evidence: { reference: 'synthetic-Friday-manager-review' } });
  const exported = await earningsCommand('export_run', { runId: run.runId, evidence: { reference: 'synthetic-bookkeeping-export' } });
  assert.equal(exported.state, 'exported');
  const final = await earningsRead();
  assert.equal(final.entries.length, 5);
  assert.equal(new Set(entryIds).size, 5);
  assert.equal(final.summary.reconciledPaidCents, 0, 'Export is never actual payment proof');
  for (const alias of representatives) {
    const own = await checked(await f.request('field-sales-earnings', 'GET', null, alias), 'Representative earnings API');
    assert.equal(own.entries.length, 1);
    assert.ok(own.entries.every(entry => entry.representativeId === f.actors[alias]));
    for (const entry of own.entries) {
      assert.equal(entry.snapshot.facts, undefined);
      assert.equal(entry.snapshot.policy, undefined);
      assert.equal(entry.snapshot.qualification, undefined);
      assert.equal(JSON.stringify(entry.snapshot).includes('Synthetic customer'), false);
      assert.equal(JSON.stringify(entry.snapshot).includes('100 Synthetic Pilot Lane'), false);
    }
  }
  assert.equal((await f.db.query('select count(*)::int count from commercial_leads where lead_id=any($1::uuid[])', [leadIds])).rows[0].count, 5);
  assert.equal((await f.db.query('select count(*)::int count from field_sales_orders where lead_id=any($1::uuid[])', [leadIds])).rows[0].count, 5);
  assert.deepEqual((await f.db.query('select to_jsonb(j) row from h2s_dispatch_jobs j where job_id in ($1,$2) order by job_id', [id(101), id(202)])).rows, oldJobs.rows);
  assert.deepEqual((await f.db.query('select to_jsonb(o) row from h2s_orders o where id in ($1,$2) order by id', [id(100), id(200)])).rows, oldOrders.rows);
});
