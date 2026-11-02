const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const catalog = require('../equipment.v1.json');
const config = require('../residential-cameras.v1.json');
const baseline = require('../home2smart.v1.json');
const promotions = require('../promotions/experiments.v1.json');
const { validateRecommendationConfiguration, recommendResidentialCameras } = require('../camera-recommendations.cjs');
const copy = value => structuredClone(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function consultation(count = 2, priority = 'balanced') {
  const coverage = ['front_door', 'driveway', 'backyard', 'side_yard'];
  return {
    locations: Array.from({ length: count }, (_, index) => ({
      id: `position_${index + 1}`, coverage: [coverage[index % 4]], outdoor: true, coveragePositionVerified: true,
      sunlightSuitable: true, directSunHours: 5, batteryMaintenanceAccepted: true, c31PowerCompatible: false,
      floodlightPowerCompatible: false, wifiConfirmed: true, homebaseLinkConfirmed: true,
      mountingCompatible: true, standardInstallation: true, requiredFeatures: [], preferredEquipmentId: null,
    })),
    preferences: { priority, storage: 'no_preference', homebaseType: 'homebase_2' }, budget: null,
    existingHub: { type: 'none', compatibilityVerified: false, availableCameraSlots: null },
    hubRouterConnectionConfirmed: true,
  };
}
const recommend = input => recommendResidentialCameras(config, catalog, baseline, input);
function costed(input) {
  return { ...input, materialUnitCosts: {
    camera_consumables: { amount: 3, notes: 'TEST ONLY: hypothetical camera consumables, not the existing TV allowance.' },
    camera_micro_sd_128gb: { amount: 12, notes: 'TEST ONLY: hypothetical compatible card.' },
    c31_power_weather_protection: { amount: 5, notes: 'TEST ONLY: hypothetical power protection.' },
    floodlight_electrical_materials: { amount: 10, notes: 'TEST ONLY: hypothetical electrical materials.' },
    homebase_installation_materials: { amount: 0, notes: 'TEST ONLY: all needed hub supplies verified included.' },
    solar_initial_charging_materials: { amount: 0, notes: 'TEST ONLY: verified compatible charging supplies are available.' },
  }, salesTax: { percent: 7, notes: 'TEST ONLY: illustrative rate, not a local tax determination.' },
  shipping: { amount: 0, notes: 'TEST ONLY: verified free shipping for these purchases.' } };
}

test('preserves the prior entire catalog, previous camera records, old drafts, baselines and promotions', () => {
  const { purchasingOptions, ...oldCatalog } = copy(catalog);
  oldCatalog.cameraItems = oldCatalog.cameraItems.slice(0, 3);
  assert.equal(digest(oldCatalog), '4a622f1d474c6985ea25c55ab9e01e79dc0229ba4944f97b7153461977417ab4');
  assert.equal(digest(catalog.cameraItems.slice(0, 3)), '34bd2d2a71cf4bc1b256a98f24f0dc7b02d05336034a197b21b468d21b75f13e');
  const { recommendationPolicy, ...oldConfig } = config;
  assert.equal(digest(oldConfig), '0b3c5c7965f2157a9eff6340203add9c8b8ddeb94cad91e61cfdb55d7729c572');
  assert.equal(digest(baseline), 'e976cb48076c37e76d54e86125e41ea28b64bad9dc288aa43a71ada7bb33bf28');
  assert.equal(digest(promotions), 'ed1e74613df954d0e2e7fa99a19e02aa6e3dcebe3aa1e605a719b7bc58f6fe66');
  assert.equal(purchasingOptions.length, 5);
  assert.equal(recommendationPolicy.status, 'proposed_pending_approval');
});

test('six individual models retain exact identifiers, separate observations and model-specific storage', () => {
  assert.equal(catalog.cameraItems.length, 6);
  const [s220, s340, e40] = catalog.cameraItems.slice(3);
  assert.deepEqual([s220.productId, s340.productId, e40.productId], ['T8134121', 'T81701W1', 'T8144121']);
  assert.equal(s220.costAssumption.amount, 99.99);
  assert.equal(s340.costAssumption.originalPlanningAmount, 199.99);
  assert.equal(s340.supplier.observedPrice, 219.99);
  assert.equal(e40.costAssumption.amount, 149.99);
  for (const camera of [s220, s340]) {
    assert.equal(camera.storage.builtInStorageGb, 8);
    assert.equal(camera.storage.microSdMaxGb, null);
    assert.ok(!camera.requiredMaterialIds.includes('camera_micro_sd_128gb'));
  }
  assert.equal(e40.storage.strategy, 'required_homebase');
  assert.equal(e40.solar.minimumDirectSunHoursPerDay, null);
});

for (const [count, cost, amount, kind] of [
  [1, 99.99, 299, 'starting'], [2, 279.99, 599, 'starting'],
  [3, 429.98, 849, 'unapproved_draft'], [4, 559.98, 1099, 'fixed'],
]) {
  test(`exact ${count}-position home recommends ${count} cameras without package padding`, () => {
    const result = recommend(consultation(count));
    assert.equal(result.recommendedCameraCount, count);
    assert.equal(result.locations.length, count);
    assert.ok(result.locations.every(row => row.equipmentId === (count === 1 ? 'eufy_solocam_s220' : 'eufycam_e40')));
    assert.equal(result.quote.purchasing.observedEquipmentCost, cost);
    assert.equal(result.quote.customerPrice.amount, amount);
    assert.equal(result.quote.customerPrice.kind, kind);
    assert.equal(result.quote.equipment.reduce((sum, camera) => sum + camera.quantity, 0), count);
    assert.equal(result.quote.costingComplete, false);
    assert.equal(result.quote.remainingBeforeCommission, null);
    assert.ok(result.quote.illustrativeCommissionScenarios.every(row => row.repCommission === null && row.home2SmartContribution === null));
    assert.equal(result.requiresManualReview, true);
    assert.equal(result.status, 'proposed_pending_approval');
    assert.equal(result.requiresCustomQuote, false);
  });
}

test('three-camera purchasing uses one kit plus one add-on; four uses cheaper exact-count kits with an unused hub flag', () => {
  const three = recommend(consultation(3)).quote;
  assert.deepEqual(three.purchasing.lines.map(row => [row.optionId, row.purchaseQuantity]).sort(),
    [['e40_homebase2_kit', 1], ['e40_single', 1]]);
  const four = recommend(consultation(4)).quote;
  assert.deepEqual(four.purchasing.lines.map(row => [row.optionId, row.purchaseQuantity]), [['e40_homebase2_kit', 2]]);
  assert.ok(four.reviewFlags.includes('unused_included_hubs:1'));
  assert.equal(four.storage[0].hub, 'homebase_2');
  assert.equal(four.storage[0].storageGb, 16);
  assert.equal(four.storage[0].storageCost, 0);
});

test('budget preference and meaningful S220 alternative use built-in storage with no phantom microSD expense', () => {
  const budget = recommend(consultation(2, 'budget'));
  assert.ok(budget.locations.every(row => row.equipmentId === 'eufy_solocam_s220'));
  assert.equal(budget.quote.purchasing.observedEquipmentCost, 199.98);
  assert.ok(!budget.quote.requiredMaterials.some(row => row.materialId === 'camera_micro_sd_128gb'));
  assert.ok(budget.quote.storage.every(row => row.storageGb === 8 && row.storageCost === 0));
  const balanced = recommend(consultation(2));
  assert.ok(balanced.alternatives.some(row => row.locations.every(location => location.equipmentId === 'eufy_solocam_s220')));
});

test('budget is a customer total constraint, never permission to reprice or sacrifice compatibility', () => {
  const input = consultation(3);
  input.budget = 800;
  const result = recommend(input);
  assert.equal(result.quote.customerPrice.amount, 849);
  assert.equal(result.requiresCustomQuote, true);
  assert.ok(result.reviewFlags.includes('customer_budget_below_proposed_package_or_custom_quote'));
  const starting = consultation(2); starting.budget = 599;
  assert.ok(recommend(starting).reviewFlags.includes('starting_price_not_budget_guarantee'));
});

test('shaded sites never get solar recommendations; compatible wired alternatives remain possible', () => {
  const input = consultation(2);
  input.locations.forEach(row => { row.sunlightSuitable = false; row.directSunHours = 0; });
  const unresolved = recommend(input);
  assert.ok(unresolved.locations.every(row => row.equipmentId === null));
  assert.equal(unresolved.quote, null);
  assert.equal(unresolved.requiresCustomQuote, true);
  input.locations.forEach(row => { row.c31PowerCompatible = true; });
  const wired = recommend(input);
  assert.ok(wired.locations.every(row => row.equipmentId === 'eufy_wired_cam_c31'));
  assert.ok(wired.quote.requiredMaterials.some(row => row.materialId === 'c31_power_weather_protection'));
});

for (const value of [false, null]) {
  test(`uncertain sunlight ${value} blocks solar; weak/unknown Wi-Fi ${value} and hub link block wireless assumptions`, () => {
    const sun = consultation(1); sun.locations[0].sunlightSuitable = value;
    assert.equal(recommend(sun).locations[0].equipmentId, null);
    const network = consultation(2);
    network.locations.forEach(row => { row.wifiConfirmed = value; row.homebaseLinkConfirmed = value; });
    assert.ok(recommend(network).locations.every(row => row.equipmentId === null));
  });
}

test('HomeBase radio coverage can be valid without camera-to-router Wi-Fi, but hub-to-router must be verified', () => {
  const input = consultation(2);
  input.locations.forEach(row => { row.wifiConfirmed = false; });
  assert.ok(recommend(input).locations.every(row => row.equipmentId === 'eufycam_e40'));
  input.hubRouterConnectionConfirmed = null;
  assert.equal(recommend(input).quote, null);
});

test('premium tracking/zoom selects S340 and preserves the planning-vs-observed difference', () => {
  const input = consultation(1, 'premium');
  input.locations[0].requiredFeatures = ['tracking', 'zoom_detail', 'color_night_vision'];
  const result = recommend(input);
  assert.equal(result.locations[0].equipmentId, 'eufy_solocam_s340');
  assert.equal(result.quote.purchasing.observedEquipmentCost, 219.99);
  assert.equal(result.quote.purchasing.planningPurchaseCost, 199.99);
  assert.ok(result.reviewFlags.includes('planning_vs_observed_price:eufy_solocam_s340'));
  input.locations[0].directSunHours = 2;
  assert.equal(recommend(input).locations[0].equipmentId, null);
});

test('pan/tilt alone can choose E30, while fixed-view requests do not receive unsupported tracking', () => {
  const input = consultation(1);
  input.locations[0].requiredFeatures = ['pan_tilt'];
  assert.equal(recommend(input).locations[0].equipmentId, 'eufy_solocam_e30');
  input.locations[0].requiredFeatures = ['fixed_view'];
  assert.equal(recommend(input).locations[0].equipmentId, 'eufy_solocam_s220');
});

test('existing compatible floodlight location selects Floodlight E30 but requires electrical review/custom quote', () => {
  const input = consultation(1);
  input.locations[0].requiredFeatures = ['floodlighting'];
  input.locations[0].floodlightPowerCompatible = true;
  const result = recommend(input);
  assert.equal(result.locations[0].equipmentId, 'eufy_floodlight_e30');
  assert.equal(result.requiresCustomQuote, true);
  assert.ok(result.reviewFlags.includes('electrical_scope_and_licensing_review'));
  input.locations[0].floodlightPowerCompatible = null;
  assert.equal(recommend(input).quote, null);
});

test('HomeBase 2 and S380 options are not interchangeable; unverified S380 kit cannot become a cheap compatible purchase', () => {
  const input = consultation(2);
  input.preferences.homebaseType = 'homebase_s380';
  input.preferences.storage = 'shared_homebase';
  const unresolved = recommend(input);
  assert.equal(unresolved.quote, null);
  assert.equal(unresolved.requiresCustomQuote, true);
  input.existingHub = { type: 'homebase_s380', compatibilityVerified: true, availableCameraSlots: 2 };
  const existing = recommend(input);
  assert.equal(existing.quote.purchasing.observedEquipmentCost, 299.98);
  assert.equal(existing.quote.storage[0].hub, 'homebase_s380');
  assert.equal(existing.quote.storage[0].existingHubUsed, true);
  assert.ok(existing.quote.purchasing.lines.every(row => row.includedHub === null));
  input.existingHub.compatibilityVerified = null;
  assert.equal(recommend(input).quote, null);
});

test('existing hub free slots must cover the selected E40 count', () => {
  const input = consultation(3);
  input.preferences.homebaseType = 'homebase_s380';
  input.preferences.storage = 'shared_homebase';
  input.existingHub = { type: 'homebase_s380', compatibilityVerified: true, availableCameraSlots: 2 };
  assert.equal(recommend(input).quote, null);
});

test('mixed E40/C31/S220 configurations retain hub, separate microSD and built-in storage instead of sharing incompatible media', () => {
  const input = consultation(3);
  input.locations[1].sunlightSuitable = false;
  input.locations[1].c31PowerCompatible = true;
  input.locations[2].preferredEquipmentId = 'eufy_solocam_s220';
  const result = recommend(input);
  assert.deepEqual(result.locations.map(row => row.equipmentId), ['eufycam_e40', 'eufy_wired_cam_c31', 'eufy_solocam_s220']);
  const quote = result.quote;
  assert.equal(quote.requiredMaterials.find(row => row.materialId === 'camera_micro_sd_128gb').quantity, 1);
  assert.deepEqual(quote.storage.map(row => row.strategy), ['required_homebase', 'standalone_micro_sd', 'built_in']);
  assert.ok(quote.reviewFlags.includes('mixed_system_storage_and_installation_review'));
  assert.equal(quote.equipment.reduce((total, row) => total + row.quantity, 0), 3);
  assert.equal(quote.purchasing.purchasedCameraCount, 4);
  assert.equal(quote.purchasing.surplusCameraCount, 1);
  assert.ok(quote.reviewFlags.includes('uninstalled_purchased_cameras:eufycam_e40:1'));
});

test('unknown accessory costs, sales tax and shipping never become zero or finalized contribution', () => {
  const quote = recommend(consultation(2)).quote;
  assert.equal(quote.estimatedEquipmentSalesTax, null);
  assert.equal(quote.estimatedDirectMaterialsCost, null);
  assert.equal(quote.totalEstimatedDirectCost, null);
  assert.equal(quote.remainingBeforeCommission, null);
  assert.equal(quote.paymentProcessingFee, 17.97);
  assert.ok(quote.missingCosts.includes('sales_tax_rate'));
  assert.ok(quote.missingCosts.includes('shipping'));
  assert.ok(quote.missingCosts.includes('camera_consumables'));
});

test('complete illustrative financials subtract equipment, materials, tax, shipping and processing exactly once', () => {
  const quote = recommend(costed(consultation(3))).quote;
  assert.equal(quote.purchasing.observedEquipmentCost, 429.98);
  assert.equal(quote.knownMaterialsCost, 438.98);
  assert.equal(quote.estimatedEquipmentSalesTax, 30.1);
  assert.equal(quote.estimatedMaterialsSalesTax, 30.73);
  assert.equal(quote.totalEstimatedDirectCost, 469.71);
  assert.equal(quote.paymentProcessingFee, 25.47);
  assert.equal(quote.remainingBeforeCommission, 353.82);
  assert.deepEqual(quote.illustrativeCommissionScenarios.map(row => [row.percent, row.repCommission, row.home2SmartContribution]),
    [[40, 141.53, 212.29], [50, 176.91, 176.91], [60, 212.29, 141.53]]);
  assert.equal(quote.costingComplete, true);
  assert.ok(quote.illustrativeCommissionScenarios.every(row => row.status === 'illustrative_not_approved_policy'));
});

for (const [count, materials, tax, directCost, beforeCommission, company] of [
  [2, 285.99, 20.02, 306.01, 275.02, [165.01, 137.51, 110.01]],
  [4, 571.98, 40.04, 612.02, 454.01, [272.41, 227, 181.6]],
]) {
  test(`documented test-only ${count}-camera materials and contribution match exact cent calculations`, () => {
    const quote = recommend(costed(consultation(count))).quote;
    assert.equal(quote.estimatedDirectMaterialsCost, materials);
    assert.equal(quote.estimatedMaterialsSalesTax, tax);
    assert.equal(quote.totalEstimatedDirectCost, directCost);
    assert.equal(quote.remainingBeforeCommission, beforeCommission);
    assert.deepEqual(quote.illustrativeCommissionScenarios.map(row => row.home2SmartContribution), company);
  });
}

test('costed mixed-system microSD storage is attributed to the actual model and not double-counted', () => {
  const input = costed(consultation(2));
  input.locations[0].sunlightSuitable = false;
  input.locations[0].c31PowerCompatible = true;
  input.locations[1].preferredEquipmentId = 'eufy_solocam_s220';
  const quote = recommend(input).quote;
  assert.equal(quote.storage.find(row => row.equipmentId === 'eufy_wired_cam_c31').storageCost, 12);
  assert.equal(quote.storage.find(row => row.equipmentId === 'eufy_solocam_s220').storageCost, 0);
  assert.equal(quote.estimatedDirectMaterialsCost, 182.98);
});

test('eligible customer model preference is honored even in budget mode, but never overrides hard compatibility', () => {
  const input = consultation(1, 'budget');
  input.locations[0].preferredEquipmentId = 'eufy_solocam_s340';
  assert.equal(recommend(input).locations[0].equipmentId, 'eufy_solocam_s340');
  input.locations[0].directSunHours = 3;
  const fallback = recommend(input);
  assert.equal(fallback.locations[0].equipmentId, 'eufy_solocam_s220');
  assert.ok(fallback.reviewFlags.includes('preferred_camera_not_selected:position_1'));
});

test('existing hub does not exclude a cheaper kit, and unused hub never receives resale credit', () => {
  const input = consultation(2);
  input.existingHub = { type: 'homebase_2', compatibilityVerified: true, availableCameraSlots: 2 };
  const quote = recommend(input).quote;
  assert.equal(quote.purchasing.observedEquipmentCost, 279.99);
  assert.equal(quote.storage[0].existingHubUsed, true);
  assert.ok(quote.reviewFlags.includes('unused_included_hubs:1'));
});

test('loss scenarios do not pay a commission on negative contribution or hide company losses', () => {
  const input = costed(consultation(1));
  input.materialUnitCosts.camera_consumables.amount = 500;
  const quote = recommend(input).quote;
  assert.ok(quote.remainingBeforeCommission < 0);
  for (const row of quote.illustrativeCommissionScenarios) {
    assert.equal(row.repCommission, 0);
    assert.equal(row.home2SmartContribution, quote.remainingBeforeCommission);
  }
});

test('five or more cameras remain exact-count custom quotes rather than fabricated package prices', () => {
  const result = recommend(costed(consultation(5)));
  assert.equal(result.recommendedCameraCount, 5);
  assert.equal(result.quote.customerPrice.kind, 'custom_quote');
  assert.equal(result.quote.customerPrice.amount, null);
  assert.equal(result.quote.paymentProcessingFee, null);
  assert.equal(result.quote.remainingBeforeCommission, null);
  assert.equal(result.requiresCustomQuote, true);
});

test('rotating cameras cannot collapse separate coverage areas into one position', () => {
  const input = consultation(1);
  input.locations[0].coverage = ['front_door', 'backyard'];
  input.locations[0].requiredFeatures = ['tracking'];
  assert.equal(recommend(input).locations[0].equipmentId, null);
  input.locations[0].coveragePositionVerified = null;
  assert.equal(recommend(input).quote, null);
});

test('missing/weak installation facts or preferred incompatible cameras require review, never selection by price alone', () => {
  const input = consultation(1);
  input.locations[0].mountingCompatible = null;
  input.locations[0].preferredEquipmentId = 'eufy_solocam_s340';
  assert.equal(recommend(input).quote, null);
  assert.ok(recommend(input).reviewFlags.includes('preferred_camera_not_selected:position_1'));
});

test('quote is pure and price changes never mutate baseline, promotions or original camera costs', () => {
  const before = digest({ config, catalog, baseline, promotions });
  recommend(costed(consultation(4)));
  assert.equal(digest({ config, catalog, baseline, promotions }), before);
});

const invalidInputs = [
  ['string boolean', input => { input.locations[0].wifiConfirmed = 'true'; }],
  ['missing solar assessment', input => { delete input.locations[0].sunlightSuitable; }],
  ['duplicate coverage ID', input => { input.locations[1].id = input.locations[0].id; }],
  ['nonexistent verified hub', input => { input.existingHub.compatibilityVerified = true; }],
  ['unknown equipment', input => { input.locations[0].preferredEquipmentId = 'made_up_camera'; }],
  ['negative budget', input => { input.budget = -1; }],
  ['unsafe budget', input => { input.budget = 1e20; }],
  ['unknown material', input => { input.materialUnitCosts = { fake: { amount: 1, notes: 'No.' } }; }],
  ['undocumented zero', input => { input.shipping = { amount: 0 }; }],
  ['unsafe material', input => { input.materialUnitCosts = { camera_consumables: { amount: 1e20, notes: 'Unsafe.' } }; }],
  ['unsafe unused material', input => { input.materialUnitCosts = { c31_power_weather_protection: { amount: 1e20, notes: 'Unsafe.' } }; }],
  ['sub-cent tax percentage', input => { input.salesTax = { percent: 6.001, notes: 'Invalid.' }; }],
  ['unsafe shipping', input => { input.shipping = { amount: 1e20, notes: 'Invalid.' }; }],
  ['live commission override', input => { input.commissionRate = 50; }],
];
for (const [name, mutate] of invalidInputs) {
  test(`consultation rejects ${name}`, () => {
    const input = consultation(2); mutate(input);
    assert.throws(() => recommend(input));
  });
}

const invalidPolicies = [
  ['activation', (c, e) => { c.recommendationPolicy.status = 'approved'; }],
  ['altered fee', c => { c.recommendationPolicy.financialAssumptions.paymentProcessingPercent = 2; }],
  ['approved commission', c => { c.recommendationPolicy.financialAssumptions.status = 'approved'; }],
  ['duplicate model', c => { c.recommendationPolicy.profiles[1].equipmentId = c.recommendationPolicy.profiles[0].equipmentId; }],
  ['wrong storage connectivity', c => { c.recommendationPolicy.profiles[5].connectivity = 'router_wifi'; }],
  ['baseline three-camera invention', c => { c.recommendationPolicy.priceRules[2].baselineQuantity = 2; }],
  ['changed three-camera price', c => { c.recommendationPolicy.priceRules[2].draftPrice = 800; }],
  ['baseline override', c => { c.recommendationPolicy.priceRules[0].draftPrice = 299; }],
  ['missing hub materials', c => { c.recommendationPolicy.additionalMaterials = []; }],
  ['unknown purchase reference', (c, e) => { e.purchasingOptions[0].equipmentId = 'missing'; }],
  ['wrong kit URL', (c, e) => { e.purchasingOptions[0].sourceUrl = e.purchasingOptions[1].sourceUrl; }],
  ['wrong kit hub', (c, e) => { e.purchasingOptions[0].includedHub = 'homebase_s380'; }],
  ['unverified S380 marked eligible', (c, e) => { e.purchasingOptions[4].eligibleForOptimization = true; }],
  ['invalid price date', (c, e) => { e.purchasingOptions[0].priceCheckDate = '2026-02-30'; }],
  ['unsafe purchase price', (c, e) => { e.purchasingOptions[0].observedPrice = 1e20; }],
  ['phantom SD for built-in storage', (c, e) => { e.cameraItems[3].requiredMaterialIds.push('camera_micro_sd_128gb'); }],
];
for (const [name, mutate] of invalidPolicies) {
  test(`recommendation configuration rejects ${name}`, () => {
    const c = copy(config), e = copy(catalog);
    mutate(c, e);
    assert.throws(() => validateRecommendationConfiguration(c, e, baseline));
  });
}
