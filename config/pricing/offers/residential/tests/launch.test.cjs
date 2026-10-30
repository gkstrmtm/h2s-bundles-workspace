const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadContext, loadScenario, validateScenario, quoteOffer, projectMonth, compareVersions, dataHash } = require('../engine.cjs');
const exact = require('../tv-financials.cjs');
const fixture = require('./fixtures/handoff-unit-economics.v1.json');
const context = loadContext(), scenario = loadScenario('v5-launch-proposed'), parent = loadScenario('v3-tv-margin-improvement');
const tvJob = count => ({ tvs: Array.from({ length: count }, () =>
  ({ inches: 60, customerSuppliedMount: false, compatibilityVerified: true })), cameraPackageQuantity: 0 });
const cameraJob = count => ({ tvs: [], cameraPackageQuantity: count });
const quote = input => quoteOffer(scenario, input, context);

for (const row of fixture.offers) {
  test(`handoff economics ${row.offer_id}: every supplied expense, commission, contribution and margin reconciles`, () => {
    const result = quote(row.service === 'tv' ? tvJob(row.quantity) : cameraJob(row.quantity));
    const line = id => result.expenseLines.find(item => item.id === id).amount;
    assert.equal(result.customerRevenue, row.customer_revenue_usd);
    assert.equal(line(row.service === 'tv' ? 'tv_equipment_and_supplies' : 'camera_equipment'), row.materials_equipment_usd);
    assert.equal(line('estimated_materials_tax'), row.equipment_tax_allowance_usd);
    assert.equal(line(row.service === 'tv' ? 'additional_tv_job_allowance' : 'camera_incidentals'), row.combined_incidental_job_allowance_usd);
    assert.equal(line('payment_processing'), row.processing_usd);
    assert.equal(line('service_reserve'), row.service_reserve_usd);
    assert.equal(result.contributionBeforeCommission, row.commissionable_contribution_usd);
    assert.equal(result.commission, row.rep_commission_usd);
    assert.equal(result.companyContribution, row.company_contribution_after_reserve_usd);
    assert.equal(result.companyContributionMarginPercent, row.company_contribution_margin_pct);
    assert.equal(result.passesContributionFloors, row.passes_18pct_and_30usd_floor);
    assert.equal(result.serviceReserveHeld, row.service_reserve_usd);
    assert.equal(result.requiresReview, true);
    assert.equal(result.activationAllowed, false);
  });
}

test('preserves canonical baseline, original versions, mount definitions and parent prices', () => {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', `${scenario.id}.json`))).digest('hex'),
    '2c19ef84757089a983d23313c33e8e23dc1b5ba4af10d3195a03542e708fd66f');
  assert.deepEqual(scenario.cameras, parent.cameras);
  assert.deepEqual(scenario.tv.priceOverrides, parent.tv.priceOverrides);
  assert.equal(scenario.parentVersion, parent.id);
  assert.equal(dataHash(context.baseline), 'e976cb48076c37e76d54e86125e41ea28b64bad9dc288aa43a71ada7bb33bf28');
  assert.equal(scenario.equipmentCostSnapshots.find(row => row.equipmentId === 'wire_trak_raceway_54').amount, 14.96);
  assert.equal(24.88 + 14.96 + 3, 42.84);
  for (const tv of [{ inches: 50, customerSuppliedMount: false, compatibilityVerified: true },
    { inches: 60, customerSuppliedMount: true, compatibilityVerified: true }]) {
    const input = { tvs: [tv], cameraPackageQuantity: 0 };
    const current = quote(input), previous = quoteOffer(parent, input, context);
    assert.deepEqual(current.revenueLines, previous.revenueLines);
    assert.deepEqual(current.expenseLines, previous.expenseLines);
  }
  assert.deepEqual(scenario.launchPolicy.advertisedCameraQuantities, [2, 4]);
  assert.deepEqual(scenario.launchPolicy.supportedCameraQuantities, [1, 2, 3, 4]);
  assert.equal(quote(tvJob(4)).customerRevenue, null);
});

test('combined order adds category prices and conservative allowances, charging fees/reserve/tax only once', () => {
  const result = quote({ ...tvJob(2), cameraPackageQuantity: 3 });
  assert.equal(result.customerRevenue, 1127.1);
  assert.deepEqual(result.revenueLines.map(row => row.amount), [199, 179.1, 749]);
  assert.equal(result.expenseLines.find(row => row.id === 'additional_tv_job_allowance').amount, 10);
  assert.equal(result.expenseLines.find(row => row.id === 'camera_incidentals').amount, 30);
  for (const id of ['estimated_materials_tax', 'payment_processing', 'service_reserve']) {
    assert.equal(result.expenseLines.filter(row => row.id === id).length, 1);
  }
  assert.ok(result.flags.includes('conservative_added_category_allowances_no_shared_travel_savings_assumed'));
  assert.equal(result.passesContributionFloors, true);
  const replaced = quote({ ...tvJob(2), cameraPackageQuantity: 3, incidentalAllowance: { amount: 35, notes: 'TEST ONLY verified combined-order incidentals.' } });
  assert.equal(replaced.expenseLines.find(row => row.id === 'combined_order_incidentals').amount, 35);
  assert.ok(!replaced.expenseLines.some(row => ['additional_tv_job_allowance', 'camera_incidentals'].includes(row.id)));
  assert.ok(!replaced.flags.includes('conservative_added_category_allowances_no_shared_travel_savings_assumed'));
  assert.ok(replaced.flags.includes('documented_combined_order_allowance_replaces_category_allowances'));
});

function consultation(count = 2, priority = 'budget') {
  return {
    locations: Array.from({ length: count }, (_, index) => ({
      id: `place_${index}`, coverage: [index === 0 ? 'front_door' : 'backyard'], outdoor: true, coveragePositionVerified: true,
      sunlightSuitable: true, directSunHours: 5, batteryMaintenanceAccepted: true, c31PowerCompatible: false,
      floodlightPowerCompatible: false, wifiConfirmed: true, homebaseLinkConfirmed: true, mountingCompatible: true,
      standardInstallation: true, requiredFeatures: [], preferredEquipmentId: null,
    })),
    preferences: { priority, storage: 'no_preference', homebaseType: 'homebase_2' }, budget: null,
    existingHub: { type: 'none', compatibilityVerified: false, availableCameraSlots: null }, hubRouterConnectionConfirmed: true,
  };
}
const coverage = { verified: true, notes: 'TEST ONLY required ordinary supplies and compatible initial charging covered by incidentals.' };

test('actual S220 consultation cannot treat unverified required accessories as free', () => {
  const input = { ...cameraJob(2), cameraConsultation: consultation() };
  const missing = quote(input);
  assert.equal(missing.companyContribution, null);
  assert.equal(missing.requiresCustomQuote, true);
  assert.ok(missing.missingCosts.includes('solar_initial_charging_materials'));
  const verified = quote({ ...input, allowanceCoverage: coverage });
  assert.equal(verified.customerRevenue, 499);
  assert.equal(verified.companyContribution, 98.15);
  assert.equal(verified.passesContributionFloors, true);
  assert.match(verified.expenseLines.find(row => row.id === 'camera_consumables').notes, /Explicitly included/);
});

test('unsuitable solar, weak connectivity and unknown mounts never force S220 onto a site', () => {
  for (const field of ['sunlightSuitable', 'wifiConfirmed', 'mountingCompatible']) {
    const input = consultation(); input.locations[0][field] = null;
    const result = quote({ ...cameraJob(2), cameraConsultation: input, allowanceCoverage: coverage });
    assert.equal(result.requiresCustomQuote, true);
    assert.equal(result.passesContributionFloors, null);
    assert.equal(result.companyContribution, null);
  }
});

test('premium E40 equipment uses verified procurement and custom incidentals, never disabled test prices', () => {
  const input = consultation(2, 'balanced');
  const missing = quote({ ...cameraJob(2), cameraConsultation: input, allowanceCoverage: coverage });
  assert.equal(missing.customerRevenue, 599);
  assert.equal(missing.expenseLines.find(row => row.id === 'camera_equipment').amount, 279.99);
  assert.equal(missing.requiresCustomQuote, true);
  assert.equal(missing.companyContribution, null);
  assert.ok(missing.missingCosts.includes('camera_incidentals'));
  input.materialUnitCosts = { homebase_installation_materials: { amount: 0, notes: 'TEST ONLY verified included hub supplies.' } };
  const custom = quote({ ...cameraJob(2), cameraConsultation: input, allowanceCoverage: coverage,
    incidentalAllowance: { amount: 35, notes: 'TEST ONLY itemized premium installation incidentals.' },
    customPrice: { amount: 700, notes: 'TEST ONLY manually proposed premium equipment price.' } });
  assert.equal(custom.customerRevenue, 700);
  assert.notEqual(custom.companyContribution, null);
  assert.equal(custom.requiresCustomQuote, true);
  assert.ok(custom.flags.includes('premium_or_mixed_camera_cost_sensitive_custom_quote'));
});

test('HomeBase variants remain distinct and mixed-camera BOMs retain unknown storage and power materials', () => {
  const hub = consultation(2, 'balanced');
  hub.preferences.homebaseType = 'homebase_s380';
  hub.preferences.storage = 'shared_homebase';
  assert.equal(quote({ ...cameraJob(2), cameraConsultation: hub, allowanceCoverage: coverage }).companyContribution, null);
  hub.existingHub = { type: 'homebase_s380', compatibilityVerified: true, availableCameraSlots: 2 };
  const existing = quote({ ...cameraJob(2), cameraConsultation: hub, allowanceCoverage: coverage });
  assert.equal(existing.expenseLines.find(row => row.id === 'camera_equipment').amount, 299.98);
  assert.equal(existing.recommendation.quote.storage[0].hub, 'homebase_s380');
  const mixed = consultation(3, 'balanced');
  mixed.locations[1].sunlightSuitable = false; mixed.locations[1].c31PowerCompatible = true;
  mixed.locations[2].preferredEquipmentId = 'eufy_solocam_s220';
  const result = quote({ ...cameraJob(3), cameraConsultation: mixed, allowanceCoverage: coverage });
  assert.deepEqual(result.recommendation.locations.map(row => row.equipmentId), ['eufycam_e40', 'eufy_wired_cam_c31', 'eufy_solocam_s220']);
  assert.ok(result.missingCosts.includes('camera_micro_sd_128gb'));
  assert.ok(result.missingCosts.includes('c31_power_weather_protection'));
  assert.equal(result.companyContribution, null);
  assert.equal(result.requiresCustomQuote, true);
});

test('one camera and customer-equipment installation-only prices remain canonical, with unknown costs visible', () => {
  const one = quote(cameraJob(1));
  assert.equal(one.customerRevenue, 299);
  assert.equal(one.companyContribution, null);
  for (const [quantity, amount] of [[1, 129], [2, 229], [4, 399]]) {
    const result = quote({ ...cameraJob(quantity), cameraService: 'installation_only' });
    assert.equal(result.customerRevenue, amount);
    assert.equal(result.companyContribution, null);
    assert.equal(result.requiresCustomQuote, true);
  }
  assert.equal(quote({ ...cameraJob(3), cameraService: 'installation_only' }).customerRevenue, null);
});

test('both floors are order-level safeguards, including a dollar failure despite a passing percentage', () => {
  const small = quote({ ...tvJob(1), customPrice: { amount: 100, notes: 'TEST ONLY floor isolation.' },
    incidentalAllowance: { amount: 0, notes: 'TEST ONLY no extra incidentals.' } });
  assert.ok(small.companyContributionMarginPercent > 18);
  assert.ok(small.companyContribution < 30);
  assert.equal(small.belowMinimumCompanyMargin, false);
  assert.equal(small.belowMinimumCompanyContribution, true);
  assert.equal(small.passesContributionFloors, false);
  assert.equal(small.requiresCustomQuote, true);
  const low = quote({ ...cameraJob(2), commissionPercent: 60 });
  assert.equal(low.belowMinimumCompanyMargin, true);
  assert.equal(low.passesContributionFloors, false);
  for (const [commissionPercent, companyContribution] of [[50, 109.05], [55, 98.15], [60, 87.24]]) {
    assert.equal(quote({ ...cameraJob(2), commissionPercent }).companyContribution, companyContribution);
  }
  const { enforceLaunchFloors } = require('../launch.cjs');
  const base = { ...small, belowMinimumCompanyMargin: false, companyContribution: 30,
    exactFinancials: { ...small.exactFinancials, companyContribution: '30' } };
  assert.equal(enforceLaunchFloors(base, scenario).passesContributionFloors, true);
  assert.equal(enforceLaunchFloors({ ...base, exactFinancials: { ...base.exactFinancials, companyContribution: '29.99999999999999' } }, scenario).passesContributionFloors, false);
  assert.equal(enforceLaunchFloors({ ...base, companyContribution: -1, belowMinimumCompanyMargin: null,
    exactFinancials: { ...base.exactFinancials, companyContribution: '-1' } }, scenario).passesContributionFloors, false);
});

test('null allowances and double-counted or irrelevant costs fail visibly', () => {
  const unknown = quote({ ...cameraJob(2), incidentalAllowance: { amount: null, notes: 'Unknown actual cost.' } });
  assert.equal(unknown.companyContribution, null);
  assert.ok(unknown.flags.includes('manual_review_required_for_contribution_or_missing_costs'));
  assert.throws(() => quote({ ...cameraJob(2), costOverrides: { cameraSuppliesPerCamera: { amount: 3, notes: 'Do not ignore.' } } }), /cannot be mixed/);
  assert.throws(() => quote({ ...cameraJob(2), allowanceCoverage: coverage }), /actual camera consultation/);
  const input = consultation(); input.materialUnitCosts = { camera_consumables: { amount: 3, notes: 'Already priced.' } };
  assert.throws(() => quote({ ...cameraJob(2), cameraConsultation: input, allowanceCoverage: coverage }), /double count/);
});

test('fixture sales mix reconciles, explicitly identifying rounded-job projection versus full precision and whole visits', () => {
  const weights = fixture.target_mix_example.hypothetical_100_paid_orders_by_offer;
  const jobs = fixture.offers.filter(row => weights[row.offer_id]).map(row => ({
    id: row.offer_id, percent: weights[row.offer_id], job: row.service === 'tv' ? tvJob(row.quantity) : cameraJob(row.quantity),
  }));
  const result = projectMonth(scenario, { monthlyVolume: 100, salesMix: jobs, overhead: { amount: 0, notes: 'TEST ONLY exclude overhead for sample reconciliation.' } }, context);
  const rawRevenue = exact.fromExact(result.exactFinancials.customerRevenue);
  const rawCompany = exact.fromExact(result.exactFinancials.companyContributionBeforeOverhead);
  assert.equal(exact.toMoney(rawRevenue / 100n), fixture.target_mix_example.average_order_value_usd);
  assert.equal(exact.toMoney(rawCompany / 100n), fixture.target_mix_example.avg_company_contribution_after_reserve_usd);
  assert.equal(exact.toMoney(rawCompany * 130n / 100n), 11767.05);
  const roundedPerJob = fixture.offers.reduce((sum, row) => sum + (weights[row.offer_id] ?? 0) * row.company_contribution_after_reserve_usd, 0);
  assert.equal(Math.round(roundedPerJob / 100 * 130 * 100) / 100, fixture.target_mix_example.monthly_130_completed_jobs_company_contribution_usd);
  const whole = projectMonth(scenario, { monthlyVolume: 130, salesMix: jobs, overhead: { amount: null, notes: 'Actual overhead remains unknown.' } }, context);
  assert.deepEqual(whole.rows.map(row => row.count), [65, 36, 16, 10, 3]);
  assert.notEqual(whole.companyContributionBeforeOverhead, fixture.target_mix_example.monthly_130_completed_jobs_company_contribution_usd);
  assert.equal(whole.companyContributionBeforeOverhead, 11828.86);
  assert.deepEqual(whole.ownerDistributions, [null, null, null]);
});

test('disabled future experiments, incomplete site conditions and unchanged history cannot be activated', () => {
  for (const mutate of [
    value => { value.launchPolicy.futureExperiments[0].enabled = true; },
    value => { value.launchPolicy.crossCategoryDiscountPercent = 10; },
    value => { value.launchPolicy.minimumCompanyContribution = 0; },
    value => { value.assumptions.minimumCompanyMarginPercent = 17; },
    value => { value.launchPolicy.cameraAllowances[1].quantity = 2; },
    value => { value.launchPolicy.tvMaterialEquipmentIds[1] = 'missing'; },
  ]) {
    const value = structuredClone(scenario); mutate(value); assert.throws(() => validateScenario(value, context));
  }
  const before = dataHash({ scenario, parent, context });
  compareVersions([parent, scenario], {}, context);
  assert.equal(dataHash({ scenario, parent, context }), before);
});

test('customer-facing draft contains no internal commissions, margins, reserves or owner economics', () => {
  const sheet = fs.readFileSync(path.join(__dirname, '..', 'docs', 'customer-price-sheet-v5-draft.md'), 'utf8');
  assert.doesNotMatch(sheet, /commission|margin|reserve|profit|55%|18%|\$30\b|reinvestment|owner/i);
  for (const amount of ['$199.00', '$378.10', '$547.25', '$499', '$749', '$999']) assert.ok(sheet.includes(amount));
  assert.ok(sheet.split('\n').length <= 50);
  assert.match(sheet, /no combined-package discount/);
});
