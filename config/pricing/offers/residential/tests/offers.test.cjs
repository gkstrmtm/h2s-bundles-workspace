const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadContext, loadScenario, validateScenario, quoteOffer, projectMonth, compareVersions, createVersion, recordReview, validateReview, sourceFingerprints, hash, dataHash } = require('../engine.cjs');
const directory = path.join(__dirname, '..');
const context = loadContext();
const read = id => JSON.parse(fs.readFileSync(path.join(directory, `${id}.json`), 'utf8'));
const original = read('v1-original'), protectedOffer = read('v2-margin-protected');
const copy = value => structuredClone(value);
const tvJob = (count, extra = {}) => ({ tvs: Array.from({ length: count }, () =>
  ({ inches: 60, customerSuppliedMount: false, compatibilityVerified: true })), cameraPackageQuantity: 0, ...extra });
const cameraJob = (count, extra = {}) => ({ tvs: [], cameraPackageQuantity: count, ...extra });
const costs = {
  cameraSuppliesPerCamera: { amount: 3, notes: 'TEST ONLY hypothetical camera supplies, not an adopted allowance.' },
  solarChargingPerCamera: { amount: 0, notes: 'TEST ONLY compatible available charging supply verified.' },
  travelPerVisit: { amount: 20, notes: 'TEST ONLY hypothetical travel cost.' },
  shippingPerVisit: { amount: 0, notes: 'TEST ONLY verified free supplier shipping.' },
};
const quote = (scenario, job) => quoteOffer(scenario, job, context);
const costedCamera = (count, extra = {}) => cameraJob(count, { costOverrides: costs, ...extra });
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h2s-offer-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const id of ['v1-original', 'v2-margin-protected']) {
    for (const extension of ['json', 'sha256']) fs.copyFileSync(path.join(directory, `${id}.${extension}`), path.join(dir, `${id}.${extension}`));
  }
  return dir;
}

test('preserves exact requested versions, prices, shared assumptions, IDs and baseline', () => {
  assert.equal(hash(fs.readFileSync(path.join(directory, 'v1-original.json'))), '6e5a0928832337df53525f0e735dcda354c23fe285848c6ffaa7eb97b7d5e925');
  assert.equal(hash(fs.readFileSync(path.join(directory, 'v2-margin-protected.json'))), '545ae698cc0e95b0f2b2f80fcd1ac70f439676efdcb001528fb6ce03d41e1bb5');
  assert.deepEqual(original.tv.examples.map(row => row.revenue), [179, 340.1, 492.25]);
  assert.deepEqual(protectedOffer.tv, original.tv);
  assert.deepEqual(original.cameras.packages.map(row => row.price), [499, 699, 899]);
  assert.deepEqual(protectedOffer.cameras.packages.map(row => row.price), [499, 749, 999]);
  assert.deepEqual(original.assumptions, protectedOffer.assumptions);
  assert.equal(original.assumptions.commissionPercent, 55);
  assert.equal(original.assumptions.materialsTaxPercent, 8);
  assert.equal(original.assumptions.processingPercent, 3);
  assert.equal(original.assumptions.serviceReservePercent, 5);
  assert.equal(original.assumptions.ownerInstallationLaborDeduction, false);
  assert.equal(dataHash(context.baseline), 'e976cb48076c37e76d54e86125e41ea28b64bad9dc288aa43a71ada7bb33bf28');
  validateScenario(original, context);
  validateScenario(protectedOffer, context);
});

for (const [count, revenue] of [[1, 179], [2, 340.1], [3, 492.25]]) {
  test(`marginal discounts reproduce ${count} included-mount TV example`, () => {
    assert.equal(quote(original, tvJob(count)).customerRevenue, revenue);
    assert.equal(quote(protectedOffer, tvJob(count)).customerRevenue, revenue);
  });
}

test('TV size, supplied mount and deterministic highest-price-first ordering use existing tiers', () => {
  const job = tvJob(3);
  job.tvs = [
    { inches: 40, customerSuppliedMount: false, compatibilityVerified: true },
    { inches: 75, customerSuppliedMount: false, compatibilityVerified: true },
    { inches: 60, customerSuppliedMount: true, compatibilityVerified: true },
  ];
  const result = quote(original, job);
  assert.deepEqual(result.revenueLines.map(row => [row.basePrice, row.discountPercent, row.amount]), [[219, 0, 219], [149, 10, 134.1], [139, 15, 118.15]]);
  assert.equal(result.customerRevenue, 471.25);
  assert.equal(result.expenseLines.filter(row => row.id.startsWith('mount_')).length, 2);
});

test('unsupported quantity, large TV or invalid mount compatibility requires custom quote, never interpolation', () => {
  assert.equal(quote(original, tvJob(4)).customerRevenue, null);
  assert.equal(quote(original, tvJob(4)).requiresCustomQuote, true);
  const large = tvJob(1); large.tvs[0].inches = 90;
  assert.equal(quote(original, large).customerRevenue, null);
  const small = tvJob(1); small.tvs[0].inches = 25;
  assert.ok(quote(original, small).flags.includes('included_mount_outside_size_range:1'));
  assert.equal(quote(original, cameraJob(5)).customerRevenue, null);
});

test('default missing costs yield null expense/commission/company totals and explicit review flags', () => {
  const result = quote(original, cameraJob(3));
  assert.equal(result.customerRevenue, 699);
  assert.equal(result.directExpenses, null);
  assert.equal(result.companyContribution, null);
  assert.equal(result.companyContributionMarginPercent, null);
  assert.equal(result.belowMinimumCompanyMargin, null);
  assert.ok(result.flags.includes('missing_costs'));
  assert.ok(result.missingCosts.includes('cameraSuppliesPerCamera'));
  assert.ok(result.missingCosts.includes('solarChargingPerCamera'));
  assert.ok(result.missingCosts.includes('travelPerVisit'));
  assert.ok(result.missingCosts.includes('shippingPerVisit'));
});

test('complete modeled direct expenses include tax, processing, reserve and travel exactly once before 55% commission', () => {
  const result = quote(original, costedCamera(4));
  assert.equal(result.customerRevenue, 899);
  assert.equal(result.expenseLines.find(row => row.id === 'estimated_materials_tax').amount, 32.96);
  assert.equal(result.expenseLines.find(row => row.id === 'payment_processing').amount, 26.97);
  assert.equal(result.expenseLines.find(row => row.id === 'service_reserve').amount, 44.95);
  assert.equal(result.directExpenses, 536.84);
  assert.equal(result.contributionBeforeCommission, 362.16);
  assert.equal(result.commission, 199.19);
  assert.equal(result.companyContribution, 162.97);
  assert.equal(result.companyContributionMarginPercent, 18.13);
  assert.equal(result.belowMinimumCompanyMargin, false);
});

test('v2 increases only targeted revenue and corresponding revenue-based expenses/commission', () => {
  const v1 = quote(original, costedCamera(4)), v2 = quote(protectedOffer, costedCamera(4));
  assert.equal(v2.customerRevenue - v1.customerRevenue, 100);
  assert.equal(v2.directExpenses, 544.84);
  assert.equal(v2.companyContribution, 204.37);
  assert.equal(v2.companyContributionMarginPercent, 20.46);
});

for (const [scenario, count, company, margin] of [
  [original, 2, 97.48, 19.54], [original, 3, 130.23, 18.63],
  [protectedOffer, 2, 97.48, 19.54], [protectedOffer, 3, 150.93, 20.15],
]) {
  test(`documented illustrative ${scenario.id} ${count}-camera comparison matches exact output`, () => {
    const result = quote(scenario, costedCamera(count));
    assert.equal(result.companyContribution, company);
    assert.equal(result.companyContributionMarginPercent, margin);
  });
}

test('18% threshold uses exact contribution rather than the rounded display percentage', () => {
  const job = tvJob(1, {
    customPrice: { amount: 1000, notes: 'TEST ONLY threshold boundary.' },
    costOverrides: {
      tvSuppliesPerTv: { amount: 0, notes: 'TEST ONLY verified included supplies.' },
      travelPerVisit: { amount: 520, notes: 'TEST ONLY boundary expense.' },
      shippingPerVisit: { amount: 0, notes: 'TEST ONLY verified free shipping.' },
    },
  });
  job.tvs[0].customerSuppliedMount = true;
  assert.equal(quote(original, job).companyContributionMarginPercent, 18);
  assert.equal(quote(original, job).belowMinimumCompanyMargin, false);
  job.costOverrides.travelPerVisit.amount = 520.02;
  const below = quote(original, job);
  assert.equal(below.companyContributionMarginPercent, 18);
  assert.equal(below.belowMinimumCompanyMargin, true);
});

for (const rate of [50, 55, 60]) {
  test(`commission ${rate}% is an illustrative positive-contribution scenario, not live compensation`, () => {
    const result = quote(original, costedCamera(4, { commissionPercent: rate }));
    assert.equal(result.commissionPercent, rate);
    assert.equal(Math.round((result.companyContribution + result.commission) * 100), 36216);
    assert.equal(result.activationAllowed, false);
    assert.equal(result.comparisonOnly, true);
    assert.equal(result.belowMinimumCompanyMargin, rate === 60);
  });
}

test('losses are retained, zero revenue has no invented margin and no negative commission is paid', () => {
  const result = quote(original, costedCamera(2, { customPrice: { amount: 1, notes: 'TEST ONLY loss case.' } }));
  assert.equal(result.commission, 0);
  assert.ok(result.companyContribution < 0);
  assert.equal(result.belowMinimumCompanyMargin, true);
  const free = quote(original, costedCamera(2, { customPrice: { amount: 0, notes: 'TEST ONLY zero revenue.' } }));
  assert.equal(free.companyContributionMarginPercent, null);
});

test('mixed TV/camera visit charges travel, shipping and revenue percentage expenses once', () => {
  const job = costedCamera(2); job.tvs = tvJob(1).tvs;
  const result = quote(original, job);
  assert.equal(result.customerRevenue, 678);
  for (const id of ['travelPerVisit', 'shippingPerVisit', 'payment_processing', 'service_reserve']) {
    assert.equal(result.expenseLines.filter(row => row.id === id).length, 1);
  }
});

function consultation(count = 2) {
  return {
    locations: Array.from({ length: count }, (_, index) => ({
      id: `place_${index}`, coverage: [index === 0 ? 'front_door' : 'backyard'], outdoor: true, coveragePositionVerified: true,
      sunlightSuitable: true, directSunHours: 5, batteryMaintenanceAccepted: true, c31PowerCompatible: false,
      floodlightPowerCompatible: false, wifiConfirmed: true, homebaseLinkConfirmed: true, mountingCompatible: true,
      standardInstallation: true, requiredFeatures: [], preferredEquipmentId: null,
    })),
    preferences: { priority: 'balanced', storage: 'no_preference', homebaseType: 'homebase_2' }, budget: null,
    existingHub: { type: 'none', compatibilityVerified: false, availableCameraSlots: null }, hubRouterConnectionConfirmed: true,
    materialUnitCosts: { homebase_installation_materials: { amount: 0, notes: 'TEST ONLY verified included hub supplies.' } },
  };
}

test('camera adapter supports E40 premium procurement and recomputes offer tax/fees/reserve without duplicate commissions', () => {
  const result = quote(original, costedCamera(2, { cameraConsultation: consultation() }));
  assert.equal(result.recommendation.quote.purchasing.observedEquipmentCost, 279.99);
  assert.equal(result.customerRevenue, 599);
  assert.equal(result.requiresCustomQuote, true);
  assert.equal(result.expenseLines.find(row => row.id === 'linked_camera_equipment').amount, 279.99);
  assert.equal(result.expenseLines.find(row => row.id === 'estimated_materials_tax').amount, 22.88);
  assert.equal(result.expenseLines.find(row => row.id === 'payment_processing').amount, 17.97);
  assert.equal(result.expenseLines.find(row => row.id === 'service_reserve').amount, 29.95);
  assert.equal(result.expenseLines.filter(row => row.id === 'camera_consumables').length, 1);
  assert.ok(!result.expenseLines.some(row => row.id === 'cameraSuppliesPerCamera'));
});

test('camera adapter applies S220 experimental package prices, preserves algorithm defaults and unresolved site reviews', () => {
  const input = consultation(3); input.preferences.priority = 'budget';
  const result = quote(protectedOffer, costedCamera(3, { cameraConsultation: input }));
  assert.equal(result.customerRevenue, 749);
  assert.equal(result.recommendation.quote.customerPrice.amount, 849);
  input.locations[0].sunlightSuitable = null;
  const unresolved = quote(protectedOffer, costedCamera(3, { cameraConsultation: input }));
  assert.equal(unresolved.directExpenses, null);
  assert.equal(unresolved.requiresCustomQuote, true);
});

test('monthly allocation sums to volume, overhead comes before 25% reinvestment and equal owner distributions', () => {
  const input = { monthlyVolume: 3, salesMix: [
    { id: 'four', percent: 50, job: costedCamera(4) }, { id: 'two', percent: 50, job: costedCamera(2) },
  ], overhead: { amount: 100, notes: 'TEST ONLY monthly overhead.' } };
  const result = projectMonth(protectedOffer, input, context);
  assert.deepEqual(result.rows.map(row => row.count), [2, 1]);
  assert.equal(result.afterOverhead, Math.round((result.companyContributionBeforeOverhead - 100) * 100) / 100);
  assert.equal(Math.round((result.reinvestment + result.distributableToOwners) * 100), Math.round(result.afterOverhead * 100));
  assert.equal(Math.round(result.ownerDistributions.reduce((a, b) => a + b, 0) * 100), Math.round(result.distributableToOwners * 100));
  assert.ok(Math.max(...result.ownerDistributions) - Math.min(...result.ownerDistributions) <= 0.010000001);
  assert.equal(result.companyContributionMarginPercent, Math.round(result.companyContributionBeforeOverhead / result.customerRevenue * 10000) / 100);
});

test('unknown overhead or missing active-job costs prevent distributions; overhead losses pay nothing', () => {
  const input = { monthlyVolume: 10, salesMix: [{ id: 'four', percent: 100, job: cameraJob(4) }], overhead: { amount: null, notes: 'Unknown.' } };
  const unknown = projectMonth(original, input, context);
  assert.equal(unknown.reinvestment, null);
  assert.deepEqual(unknown.ownerDistributions, [null, null, null]);
  input.salesMix[0].job = costedCamera(4);
  input.overhead = { amount: 10000, notes: 'TEST ONLY loss case.' };
  const loss = projectMonth(original, input, context);
  assert.ok(loss.afterOverhead < 0);
  assert.equal(loss.reinvestment, 0);
  assert.deepEqual(loss.ownerDistributions, [0, 0, 0]);
});

test('zero-volume and zero-weight offers do not introduce nonexistent costs into monthly projections', () => {
  const result = projectMonth(original, { monthlyVolume: 0, salesMix: [{ id: 'unused', percent: 100, job: cameraJob(4) }],
    overhead: { amount: 0, notes: 'TEST ONLY no overhead.' } }, context);
  assert.equal(result.customerRevenue, 0);
  assert.equal(result.companyContributionBeforeOverhead, 0);
  assert.equal(result.reinvestment, 0);
});

test('reference drift is flagged without silently replacing frozen costs; invalid product/baseline references fail', () => {
  const changed = copy(context);
  changed.catalog.items[0].costAssumption.amount = 99;
  const result = quoteOffer(original, tvJob(1), changed);
  assert.equal(result.expenseLines.find(row => row.id === 'mount_1').amount, 24.88);
  assert.ok(result.flags.includes('catalog_cost_changed_since_snapshot:onn_fixed_32_86'));
  changed.catalog.items[0].supplier.itemId = 'wrong';
  assert.throws(() => validateScenario(original, changed), /reference mismatch/);
  const base = copy(context); base.baseline.prices.tvMounting.residentialInstallationOnly[0].price = 110;
  assert.throws(() => validateScenario(original, base), /baseline changed/);
});

test('historical seals reject edits and creation is exclusive, version-increasing and parent-linked', t => {
  const dir = temporary(t);
  assert.equal(loadScenario(original.id, dir).id, original.id);
  const before = fs.readFileSync(path.join(dir, `${original.id}.json`));
  const next = createVersion(protectedOffer.id, { id: 'v3-test', parentVersion: protectedOffer.id, changeNotes: 'TEST ONLY new experiment.' }, dir, context);
  assert.equal(loadScenario(next.id, dir).id, next.id);
  assert.deepEqual(fs.readFileSync(path.join(dir, `${original.id}.json`)), before);
  assert.throws(() => createVersion(protectedOffer.id, { id: 'v3-test', parentVersion: protectedOffer.id }, dir, context), /cannot be overwritten/);
  fs.appendFileSync(path.join(dir, `${original.id}.json`), ' ');
  assert.throws(() => loadScenario(original.id, dir), /seal mismatch/);
  assert.throws(() => loadScenario('..\\..\\equipment.v1', dir));
});

test('approval records bind exact scenario bytes, require camera reconciliation and never activate offers', t => {
  const dir = temporary(t);
  const review = { id: 'review-one', scenarioId: original.id, scenarioSha256: hash(fs.readFileSync(path.join(dir, `${original.id}.json`))),
    sourceFingerprints: sourceFingerprints(context),
    decision: 'approved_for_offline_planning', cameraWorkReconciled: false, reviewedDate: '2026-10-30',
    reviewerRole: 'TEST ONLY owner review role', notes: 'TEST ONLY offline approval.', activationAllowed: false };
  assert.throws(() => recordReview(review, dir, context), /must be reconciled/);
  review.cameraWorkReconciled = true;
  recordReview(review, dir, context);
  assert.equal(loadScenario(original.id, dir).status, 'offline_proposal_pending_reconciliation_and_review');
  assert.throws(() => recordReview(review, dir, context), /cannot be overwritten/);
  const changed = copy(context); changed.catalog.items[0].costAssumption.amount = 25;
  assert.equal(validateReview(review, dir, changed).currentSourcesMatch, false);
  assert.throws(() => recordReview({ ...review, id: 'stale-review' }, dir, changed), /fingerprints are stale/);
});

const invalidJobs = [
  ['unknown input', job => { job.ownerLabor = 10; }],
  ['missing allowance notes', job => { job.costOverrides = { travelPerVisit: { amount: 0 } }; }],
  ['sub-cent cost', job => { job.costOverrides = { travelPerVisit: { amount: 1.001, notes: 'Invalid.' } }; }],
  ['unsafe cost', job => { job.costOverrides = { travelPerVisit: { amount: 1e20, notes: 'Invalid.' } }; }],
  ['negative cost', job => { job.costOverrides = { travelPerVisit: { amount: -1, notes: 'Invalid.' } }; }],
  ['unapproved commission', job => { job.commissionPercent = 65; }],
  ['empty service', job => { job.cameraPackageQuantity = 0; }],
];
for (const [name, mutate] of invalidJobs) {
  test(`rejects ${name}`, () => { const job = cameraJob(2); mutate(job); assert.throws(() => quote(original, job)); });
}

test('invalid scenario, date, snapshot, discount, tax and baseline references are explicitly rejected', () => {
  for (const mutate of [
    value => { value.activationAllowed = true; }, value => { value.createdDate = '2026-02-30'; },
    value => { value.equipmentCostSnapshots[0].amount = 1e20; },
    value => { value.tv.examples[0].revenue = 180; }, value => { value.tv.discounts.percentsByPosition = [10, 10, 15]; },
    value => { value.cameras.packages[1].baselineQuantityReference = 2; },
    value => { delete value.assumptions.allowances.shippingPerVisit; },
    value => { value.assumptions.materialsTaxPercent = 101; }, value => { value.assumptions.ownerInstallationLaborDeduction = true; },
  ]) {
    const value = copy(original); mutate(value); assert.throws(() => validateScenario(value, context));
  }
});

test('invalid sales mixes, unsafe volume, missing overhead and undocumented zero fail clearly', () => {
  const valid = { monthlyVolume: 10, salesMix: [{ id: 'four', percent: 100, job: costedCamera(4) }], overhead: { amount: 0, notes: 'Verified.' } };
  for (const mutate of [
    value => { value.salesMix[0].percent = 99; }, value => { value.monthlyVolume = 1e20; },
    value => { delete value.overhead; }, value => { value.overhead.notes = ' '; },
  ]) {
    const value = copy(valid); mutate(value); assert.throws(() => projectMonth(original, value, context));
  }
});

test('side-by-side comparison is pure and outputs complete scenarios for all six examples', () => {
  const before = dataHash({ original, protectedOffer, context });
  const result = compareVersions([original, protectedOffer], { costOverrides: costs }, context);
  assert.equal(result.length, 2);
  assert.ok(result.every(row => row.offers.length === 6));
  assert.equal(dataHash({ original, protectedOffer, context }), before);
  assert.throws(() => compareVersions([original, original], {}, context), /distinct/);
  assert.throws(() => compareVersions([original, protectedOffer], { tvs: [] }, context), /Comparison options/);
});

test('CLI validates sealed versions and compares both without any write or activation', () => {
  for (const command of ['validate', 'compare']) {
    const run = spawnSync(process.execPath, [path.join(directory, 'offers.cjs'), command], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /v1-original/);
    assert.match(run.stdout, /v2-margin-protected/);
  }
});
