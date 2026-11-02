const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { loadContext, validate, quoteTier, quoteTvs, recommendQuote, calculate } = require('./reconcile.cjs');
const { createReport, markdown } = require('./report.cjs');
const exact = require('../offers/residential/tv-financials.cjs');
const context = loadContext();
const clone = () => structuredClone(context);
const camera = (quantity, options = {}) => quoteTier(context, 'cameras', 'residentialEquipmentIncluded', { quantity }, options);
const tvs = count => Array.from({ length: count }, () => ({ inches: 60, customerSuppliedMount: false, compatibilityVerified: true }));

function consultation(count = 2, priority = 'budget') {
  return {
    locations: Array.from({ length: count }, (_, index) => ({
      id: `position_${index + 1}`, coverage: [['front_door','driveway','backyard','side_yard'][index % 4]], outdoor: true,
      coveragePositionVerified: true, sunlightSuitable: true, directSunHours: 5, batteryMaintenanceAccepted: true,
      c31PowerCompatible: false, floodlightPowerCompatible: false, wifiConfirmed: true, homebaseLinkConfirmed: true,
      mountingCompatible: true, standardInstallation: true, requiredFeatures: [], preferredEquipmentId: null,
    })),
    preferences: { priority, storage: 'no_preference', homebaseType: 'homebase_2' }, budget: null,
    existingHub: { type: 'none', compatibilityVerified: false, availableCameraSlots: null }, hubRouterConnectionConfirmed: true,
    materialUnitCosts: {
      camera_consumables: { amount: 10, notes: 'TEST ONLY supplementary material budget.' },
      solar_initial_charging_materials: { amount: 0, notes: 'TEST ONLY existing compatible charging supplies verified;not an unknown-zero default.' },
      homebase_installation_materials: { amount: 10, notes: 'TEST ONLY hypothetical hub material allowance.' },
    },
  };
}

test('preserves original baseline, catalog, recommendation definitions, PDF and all 66 source rows', () => {
  assert.equal(validate(context), context);
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(digest(context.baseline), 'e976cb48076c37e76d54e86125e41ea28b64bad9dc288aa43a71ada7bb33bf28');
  assert.equal(context.catalog.cameraItems.length, 6);
  assert.equal(Object.values(context.baseline.prices).flatMap(Object.values).reduce((n, rows) => n + rows.length, 0), 40);
  assert.equal(Object.values(context.pdf.groups).reduce((n, group) => n + group.rows.length, 0), 66);
  assert.equal(Object.values(context.canonical.prices).flatMap(Object.values).reduce((n, rows) => n + rows.length, 0), 70);
  assert.equal(context.pdf.sha256, 'f7c8e510f69421949cd6e89279d215aefbceff66eabc36a5f377b6c8fbb05edd');
  for (const name of ['v1-original','v2-margin-protected','v3-tv-margin-improvement','v4-tv-219-experimental','v5-launch-proposed']) {
    const base = path.join(__dirname, '..', 'offers', 'residential', name);
    const checksum = fs.readFileSync(`${base}.sha256`, 'utf8').trim().split(/\s/)[0];
    assert.equal(createHash('sha256').update(fs.readFileSync(`${base}.json`)).digest('hex'), checksum);
  }
});

for (const [name, edit, error] of [
  ['activation', c => c.canonical.activationAllowed = true, /schema/i],
  ['approved status', c => c.canonical.status = 'approved', /schema/i],
  ['effective date', c => c.canonical.effectiveDate = '2026-11-02', /schema/i],
  ['weakened margin', c => c.canonical.assumptions.minimumCompanyMarginPercent = 17.99, /schema/i],
  ['owner labor', c => c.canonical.assumptions.ownerInstallationLaborDeduction = true, /schema/i],
  ['unknown field', c => c.canonical.checkout = true, /schema/i],
  ['invalid date', c => c.canonical.checkedDate = '2026-02-30', /date/i],
  ['changed history', c => c.baseline.prices.tvMounting.residentialInstallationOnly[0].price = 111, /baseline changed/i],
  ['omitted quantity', c => c.canonical.prices.cameras.residentialWirelessInstallationOnly.splice(2,1), /omitted/i],
  ['duplicate quantity', c => c.canonical.prices.cameras.residentialWirelessInstallationOnly[1].quantity = 1, /unsorted/i],
  ['size gap', c => c.canonical.prices.tvMounting.residentialInstallationOnly[1].minInches = 45, /contiguous/i],
  ['unknown SKU', c => c.canonical.prices.cameras.residentialEquipmentIncluded[1].equipmentId = 'cheaper_camera', /reference/i],
  ['cheaper unverified replacement', c => c.verification.observations[0].modeledCost = 10, /cost basis/i],
  ['supplier mismatch', c => c.verification.observations[0].sourceUrl = 'https://www.walmart.com/ip/123', /URL mismatch/i],
  ['missing exact SKU', c => c.verification.observations[0].productId = null, /exact model/i],
  ['fixed PoE scope', c => { const r = c.canonical.prices.cameras.residentialWiredInstallationOnly[0]; r.price = r.priceFrom; delete r.priceFrom; delete r.quoteRequired; }, /quote-required/i],
]) {
  test(`rejects ${name}`, () => { const c = clone(); edit(c); assert.throws(() => validate(c), error); });
}

for (const [count, revenue, retained, margin] of [[1,199,53.66,26.97],[2,378.10,103.59,27.40],[3,547.25,149.39,27.30]]) {
  test(`exact ${count}-TV discounts and more conservative materials`, () => {
    const q = quoteTvs(context, tvs(count), { eligibilityVerified: true });
    assert.equal(q.customerRevenue, revenue); assert.equal(q.modeledCompanyRetained, retained);
    assert.equal(q.companyContributionMarginPercent, margin);
    assert.equal(q.passesContributionFloors, true);
    assert.equal(q.expenseLines.find(row => row.id === 'travel_shipping').amount, 10);
    assert.equal(q.actualProfit, null); assert.equal(q.bookable, false);
  });
}

test('multi-TV ordering, customer brackets, unsupported sizes/counts and subcent precision', () => {
  const mixed = quoteTvs(context, [
    { inches: 60, customerSuppliedMount: true, compatibilityVerified: true },
    { inches: 80, customerSuppliedMount: false, compatibilityVerified: true },
  ]);
  assert.deepEqual(mixed.revenueLines.map(row => row.basePrice), [285,155]);
  assert.equal(mixed.customerRevenue, 424.50);
  assert.equal(quoteTvs(context, tvs(4)).customerRevenue, null);
  assert.equal(quoteTier(context, 'tvMounting', 'residentialWithStandardFixedMount', { inches: 27 }).customerRevenue, null);
  assert.equal(quoteTier(context, 'tvMounting', 'residentialWithStandardFixedMount', { inches: 86 }).requiresCustomQuote, true);
  const c = clone(); c.canonical.prices.tvMounting.residentialWithStandardFixedMount[2].price = 199.99;
  c.canonical.prices.tvMounting.residentialWithStandardFixedMount[2].selection = 'third_price';
  const q = quoteTvs(c, tvs(2));
  assert.equal(q.exactFinancials.customerRevenue, '379.981');
  assert.equal(q.customerRevenue, 379.98);
});

test('commercial bundles require actual count, same site, each screen up to65 and no extra discounts', () => {
  const group = 'commercialBundlesInstallationOnlyUpTo65Inches';
  assert.equal(quoteTier(context, 'tvMounting', group, { quantity: 4 }).customerRevenue, null);
  assert.equal(quoteTier(context, 'tvMounting', group, { quantity: 4 }, { sameLocation: true, tvSizes: [65,65,66,65] }).customerRevenue, null);
  const q = quoteTier(context, 'tvMounting', group, { quantity: 4 }, { sameLocation: true, tvSizes: [65,65,65,65] });
  assert.equal(q.customerRevenue, 749);
  assert.equal(q.expenseLines.find(row => row.id === 'tv_supplies').amount, 48);
  assert.equal(quoteTier(context, 'tvMounting', group, { quantity: 3 }).customerRevenue, null);
});

test('mount upgrades map exact costs,stay undiscounted and enforce supplier size eligibility', () => {
  const tilt = quoteTier(context, 'tvMounting', 'residentialWithStandardFixedMount', { inches: 60 }, { mountUpgradeId: 'tilt_mount' });
  assert.equal(tilt.customerRevenue, 224);
  assert.equal(tilt.expenseLines.find(row => row.equipmentId === 'onn_tilt_50_86').amount, 25.24);
  assert.equal(tilt.modeledCompanyRetained, 63.84);
  const motion = quoteTier(context, 'tvMounting', 'residentialWithStandardFixedMount', { inches: 60 }, { mountUpgradeId: 'large_full_motion_mount' });
  assert.equal(motion.customerRevenue, 274);
  assert.equal(motion.expenseLines.find(row => row.equipmentId === 'onn_full_motion_50_86').amount, 54);
  assert.equal(motion.modeledCompanyRetained, 70.56);
  assert.equal(quoteTier(context, 'tvMounting', 'residentialWithStandardFixedMount', { inches: 45 }, { mountUpgradeId: 'tilt_mount' }).customerRevenue, null);
  assert.equal(quoteTier(context, 'tvMounting', 'residentialWithStandardFixedMount', { inches: 45 }, { mountUpgradeId: 'small_full_motion_mount' }).customerRevenue, null);
  assert.throws(() => quoteTier(context, 'tvMounting', 'residentialInstallationOnly', { inches: 60 }, { mountUpgradeId: 'tilt_mount' }), /customer-bracket/i);
  const two = quoteTvs(context, tvs(2).map(row => ({ ...row, mountUpgradeId: 'tilt_mount' })));
  assert.equal(two.customerRevenue, 428.10);
});

for (const [quantity, price, retained] of [[1,299,61.33],[2,599,129.83],[3,849,177.62],[4,1099,225.42],[6,1599,321.01],[8,2099,416.59]]) {
  test(`S220 ${quantity}-camera price/equipment/tax/reserve mapping`, () => {
    const q = camera(quantity);
    assert.equal(q.customerRevenue, price); assert.equal(q.modeledCompanyRetained, retained);
    assert.equal(q.expenseLines.find(row => row.id === 'eufy_solocam_s220').quantity, quantity);
    assert.equal(q.expenseLines.find(row => row.id === 'camera_materials').amount, quantity * 10);
    assert.equal(q.actualProfit, null);
  });
}

test('499 fails new scope18%;599 passes and price floor is checked in exact cents', () => {
  const q = camera(2, { sellingPrice: { amount: 499, notes: 'TEST counterfactual same scope.' } });
  assert.equal(q.cashExpensesBeforeTechnician, 277.55);
  assert.equal(q.modeledCompanyRetained, 88.43); assert.equal(q.passesContributionFloors, false);
  assert.equal(q.minimumPriceForFloors, 504.96);
  const justBelow = camera(2, { sellingPrice: { amount: 504.95, notes: 'TEST exact boundary.' } });
  const atFloor = camera(2, { sellingPrice: { amount: 504.96, notes: 'TEST exact boundary.' } });
  assert.equal(justBelow.passesContributionFloors, false); assert.equal(atFloor.passesContributionFloors, true);
  assert.equal(camera(2).passesContributionFloors, true);
});

test('paid-technician cash and35% scenario are separate and cannot masquerade as owner labor', () => {
  const base = camera(2), paid = camera(2, { technicianCash: { amount: 50, notes: 'TEST actual cash compensation input.' } });
  assert.equal(paid.commission, base.commission);
  assert.equal(paid.companyRetainedAfterTechnician, 79.83);
  assert.equal(paid.totalDirectCashExpenses, 330.55);
  assert.equal(paid.passesContributionFloors, false);
  const percent = camera(2, { technicianOrderScenario: { percent: 35, notes: 'TEST backfill stress only.' } });
  assert.equal(percent.technicianCash, 209.65);
  assert.equal(percent.companyRetainedAfterTechnician, -79.82);
  assert.equal(percent.minimumPriceForFloors, null);
  assert.equal(percent.passesContributionFloors, false);
});

test('E40 uses exact compatible kits and add-ons;unknown hub material costs never become zero', () => {
  for (const [count, price, equipment] of [[2,799,279.99],[3,1199,429.98],[4,1599,559.98]]) {
    const q = quoteTier(context, 'cameras', 'residentialE40EquipmentIncluded', { quantity: count });
    assert.equal(q.customerRevenue, price); assert.equal(q.modeledCompanyRetained, null);
    assert.ok(q.missingCosts.includes('homebase_installation_materials'));
    const lines = q.expenseLines.filter(row => row.equipmentId);
    assert.equal(lines.reduce((sum, row) => sum + row.amount, 0), equipment);
    const costed = quoteTier(context, 'cameras', 'residentialE40EquipmentIncluded', { quantity: count },
      { materialCosts: { homebase_installation_materials: { amount: 10, notes: 'TEST hypothetical hub cost;not verified.' } } });
    assert.equal(costed.passesContributionFloors, true);
  }
});

test('E50 is1199.99,not unnamed800-dollar kit;inflation and unmapped8/16 tiers are explicit', () => {
  const q = quoteTier(context, 'cameras', 'residentialWiredEquipmentIncluded', { quantity: 4 });
  assert.equal(q.customerRevenue, 3299);
  assert.equal(q.expenseLines.find(row => row.equipmentId === 'eufy_nvr_e50_4_kit').amount, 1199.99);
  assert.equal(q.modeledCompanyRetained, 667.39); assert.equal(q.passesContributionFloors, true);
  assert.equal(quoteTier(context, 'cameras', 'residentialWiredEquipmentIncluded', { quantity: 4 }, { equipmentIncreasePercent: 10 }).passesContributionFloors, true);
  const eight = quoteTier(context, 'cameras', 'commercialWiredEquipmentIncluded', { quantity: 8 });
  assert.equal(eight.modeledCompanyRetained, null); assert.ok(eight.missingCosts.includes('unmapped_equipment'));
});

for (const count of [2,3,4]) {
  test(`recommendation reuses coverage/selection/storage and canonical ${count}-S220 price`, () => {
    const q = recommendQuote(context, consultation(count));
    assert.equal(q.recommendedCameraCount, count);
    assert.ok(q.locations.every(row => row.equipmentId === 'eufy_solocam_s220'));
    assert.equal(q.quote.customerRevenue, [599,849,1099][count - 2]);
    assert.ok(q.quote.storage.every(row => row.strategy === 'built_in'));
    assert.equal(q.quote.actualProfit, null);
    assert.ok(q.alternatives.every(row => row.quote.activationAllowed === false));
  });
}

test('premium E40,S380 exclusion,shaded/weak Wi-Fi,mixed storage and budget flags remain safe', () => {
  const balanced = recommendQuote(context, consultation(3, 'balanced'));
  assert.ok(balanced.locations.every(row => row.equipmentId === 'eufycam_e40'));
  assert.equal(balanced.quote.customerRevenue, 1199);
  assert.deepEqual(balanced.quote.purchasing.lines.map(row => row.productId).sort(), ['E8144121','T8144121']);
  const shaded = consultation(); shaded.locations.forEach(row => row.sunlightSuitable = false);
  assert.ok(recommendQuote(context, shaded).locations.every(row => row.equipmentId === null));
  const weak = consultation(); weak.locations.forEach(row => { row.wifiConfirmed = null; row.homebaseLinkConfirmed = null; });
  assert.equal(recommendQuote(context, weak).quote.requiresCustomQuote, true);
  const budget = consultation(); budget.budget = 499;
  assert.ok(recommendQuote(context, budget).quote.flags.includes('customer_budget_below_reconciled_price_or_custom_quote'));
  const mixed = consultation();
  mixed.locations[0].c31PowerCompatible = true; mixed.locations[0].sunlightSuitable = false;
  const result = recommendQuote(context, mixed);
  assert.ok(result.locations.some(row => row.equipmentId === 'eufy_wired_cam_c31'));
  assert.equal(result.quote.proposedPrice.kind, 'custom_quote');
  assert.ok(result.quote.missingCosts.includes('camera_micro_sd_128gb'));
  const premium = consultation(); premium.locations[0].requiredFeatures = ['zoom_detail'];
  assert.equal(recommendQuote(context, premium).quote.requiresCustomQuote, true);
});

test('invalid inputs,unknown costs,missing budgets and negative contributions are explicit', () => {
  assert.throws(() => camera(2, { unexpected: true }), /options/i);
  assert.throws(() => camera(2, { materialCosts: { surprise: { amount: 0, notes: 'No.' } } }), /Unknown cost/i);
  assert.throws(() => camera(2, { technicianCash: { amount: 1, notes: 'cash' }, technicianOrderScenario: { percent: 35, notes: 'percent' } }), /options/i);
  assert.throws(() => quoteTier(context, 'cameras', 'bad', { quantity: 2 }), /Unknown service/i);
  const invalid = consultation(); invalid.budget = -1;
  assert.throws(() => recommendQuote(context, invalid), /consultation/i);
  const missing = camera(2, { travelAllowance: { amount: null, notes: 'Unknown travel.' } });
  assert.equal(missing.grossContribution, null); assert.equal(missing.modeledCompanyRetained, null);
  const loss = camera(2, { extraMaterials: { amount: 1000, notes: 'TEST substantial extra materials.' } });
  assert.equal(loss.commission, 0); assert.equal(loss.passesContributionFloors, false);
  assert.equal(loss.requiresCustomQuote, true);
  const zero = camera(2, { sellingPrice: { amount: 0, notes: 'TEST zero-revenue diagnostic,not an offer.' } });
  assert.equal(zero.companyContributionMarginPercent, null);
  assert.equal(zero.belowMinimumCompanyContribution, true);
  assert.equal(zero.passesContributionFloors, false);
});

test('exact helper preserves null costs and reserves are not counted as spent cash', () => {
  const q = calculate(context, 100, 'fixed', [{ id: 'unknown', unitCost: null, quantity: 1, taxable: true, basis: 'Unknown required material.' }]);
  assert.equal(q.cashExpensesBeforeTechnician, null); assert.equal(q.actualProfit, null);
  const complete = camera(2);
  assert.equal(complete.exactReconciliation.cashExpensesBeforeTechnician, '280.5484');
  assert.equal(complete.exactReconciliation.grossContribution, '318.4516');
  assert.equal(complete.exactReconciliation.companyRetainedAfterTechnician, '129.82572');
  assert.equal(exact.fromExact(complete.exactFinancials.directExpenses) - exact.fromExact(complete.exactReconciliation.serviceReserve),
    exact.fromExact(complete.exactReconciliation.cashExpensesBeforeTechnician));
});

test('supplier source selection,tax and explicit shipping are not silently discarded', () => {
  const c = clone(); c.canonical.prices.tvMounting.residentialInstallationOnly[0].price = 136;
  assert.throws(() => validate(c), /source price mismatch/i);
  const substituted = clone(); substituted.canonical.prices.cameras.residentialEquipmentIncluded[1].equipmentId = 'eufycam_e40';
  assert.throws(() => validate(substituted), /equipment\/scope mismatch/i);
  const wrongSource = clone(); wrongSource.canonical.prices.cameras.residentialEquipmentIncluded[2].price = 749;
  assert.throws(() => validate(wrongSource), /Recommendation source price mismatch/i);
  const input = consultation(); input.salesTax = { percent: 7, notes: 'TEST jurisdiction evidence,not production tax determination.' };
  input.shipping = { amount: 12, notes: 'TEST verified shipping.' };
  const q = recommendQuote(context, input).quote;
  assert.equal(q.materialsTaxPercent, 7);
  assert.equal(q.expenseLines.find(row => row.id === 'explicit_shipping').amount, 12);
  assert.equal(q.purchasing.lines[0].priceCheckDate, '2026-11-02');
  assert.throws(() => recommendQuote(context, input, { materialsTax: { percent: 8, notes: 'Duplicate.' } }), /once/i);
});

test('late cost overrides agree with material/storage output instead of exposing stale unknown costs', () => {
  const input = consultation(1);
  input.locations[0].sunlightSuitable = false;
  input.locations[0].c31PowerCompatible = true;
  input.materialUnitCosts.c31_power_weather_protection = { amount: 5, notes: 'TEST power protection.' };
  const result = recommendQuote(context, input, {
    materialCosts: { camera_micro_sd_128gb: { amount: 12, notes: 'TEST verified recording-rated card price,not production supplier evidence.' } },
  });
  assert.equal(result.requiresCustomQuote, true);
  assert.equal(result.quote.requiredMaterials.find(row => row.materialId === 'camera_micro_sd_128gb').unitCost, 12);
  assert.equal(result.quote.storage[0].storageCost, 12);
  const uncosted = consultation(2);
  delete uncosted.materialUnitCosts.camera_consumables;
  const budget = recommendQuote(context, uncosted).quote;
  assert.equal(budget.requiredMaterials.find(row => row.materialId === 'camera_consumables').unitCost, 10);
  assert.match(budget.requiredMaterials.find(row => row.materialId === 'camera_consumables').notes, /not a verified expense/);
});

test('all source comparisons,70-tier economics,stress cases and report commands are reproducible', () => {
  const report = createReport(context);
  assert.equal(report.rows.length, 70);
  assert.equal(report.rows.filter(row => row.pdf).length, 66);
  assert.equal(report.historicalLean499.company, 98.15);
  assert.ok(report.rows.every(row => row.financials.actualProfit === null && row.sensitivity.commission60Percent));
  assert.ok(markdown(report).includes('6.4%'));
  assert.equal(fs.readFileSync(path.join(__dirname, 'REPORT-2026-11-02.md'), 'utf8').replace(/\r\n/g, '\n'), markdown(report));
  const cli = spawnSync(process.execPath, [path.join(__dirname, 'report.cjs'), 'validate'], { cwd: path.parse(__dirname).root, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr); assert.match(cli.stdout, /66 PDF rows,70 proposed tiers/);
  const invalid = spawnSync(process.execPath, [path.join(__dirname, 'report.cjs'), 'activate'], { encoding: 'utf8' });
  assert.equal(invalid.status, 1);
});
