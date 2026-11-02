const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const baseline = require('../home2smart.v1.json');
const catalog = require('../equipment.v1.json');
const config = require('../residential-cameras.v1.json');
const { validateEquipmentCatalog, validateCameraConfiguration, selectResidentialCamera, calculateCameraPackage } = require('../pricing.cjs');
const copy = value => structuredClone(value);
const goodSite = {
  outdoor: true, suitableSunlight: true, wifiCoverageConfirmed: true, mountingCompatible: true,
  installationComplexityStandard: true, powerAssessmentComplete: true, c31PowerCompatible: false,
  floodlightPowerCompatible: false, lightingRequested: false,
};
const select = site => selectResidentialCamera(config, catalog, baseline, site);
const calculate = (id, inputs) => calculateCameraPackage(config, catalog, baseline, id, inputs);

test('all original TV catalog fields, assumptions and upgrades survive byte-equivalent JSON serialization', () => {
  const { cameraItems, cameraConfiguration, purchasingOptions, ...legacy } = catalog;
  assert.equal(createHash('sha256').update(JSON.stringify(legacy)).digest('hex'),
    'a78c723b8f2b992fea2737935a23b30c7c3650774b67210097b70af624eb751e');
  assert.equal(validateEquipmentCatalog(legacy, baseline), legacy);
  assert.equal(cameraItems.length, 6);
  assert.ok(purchasingOptions.length);
  assert.equal(cameraConfiguration.file, 'residential-cameras.v1.json');
  assert.equal(Object.values(baseline.prices).flatMap(Object.values).flat().length, 40);
});

test('exact camera models, original planning costs and independent observations are preserved', () => {
  assert.deepEqual(catalog.cameraItems.slice(0, 3).map(camera => [
    camera.id, camera.productId, camera.modelNumber, camera.costAssumption.amount, camera.supplier.observedPrice,
  ]), [
    ['eufy_wired_cam_c31', 'T817L121', 'T817L', 59.99, 59.99],
    ['eufy_solocam_e30', 'T8171121', 'T8171', 149.99, 149.99],
    ['eufy_floodlight_e30', 'T8426121', 'T8426', 149.99, 149.99],
  ]);
  assert.equal(catalog.cameraItems[2].retailerListings[0].observedPrice, 119.98);
  assert.equal(catalog.cameraItems[1].retailerListings[0].comparison, 'different_bundle_not_comparable');
  for (const camera of catalog.cameraItems) {
    assert.equal(camera.supplier.priceCheckDate, '2026-10-30');
    assert.equal(camera.status, 'proposed_pending_approval');
    assert.equal(camera.verification.manualCompatibilityCheckRequired, true);
    assert.equal(camera.costAssumption.originalPlanningAmount, camera.costAssumption.amount);
  }
});

test('model-specific power, storage, accessories and connectivity remain distinct', () => {
  const [wired, solar, floodlight] = catalog.cameraItems;
  assert.equal(wired.power.dcVolts, 5);
  assert.equal(wired.power.adapterAmps, 1);
  assert.equal(wired.storage.microSdMaxGb, 256);
  assert.equal(wired.storage.builtInStorageGb, 0);
  assert.ok(wired.includedAccessories.includes('5V/1A USB power adapter'));
  assert.ok(!wired.storage.homeBaseModels.includes('HomeBase 2'));
  assert.equal(solar.solar.panelIncluded, true);
  assert.equal(solar.power.mode, 'rechargeable_battery_solar');
  assert.equal(solar.storage.recording, 'motion_events');
  assert.equal(solar.storage.microSdMaxGb, 128);
  assert.equal(floodlight.power.acMinVolts, 100);
  assert.equal(floodlight.power.acMaxVolts, 240);
  assert.match(floodlight.power.requirements, /USB-C is for setup ONLY/);
  for (const camera of catalog.cameraItems) {
    assert.deepEqual(camera.wifi.bandsGhz, [2.4]);
    assert.equal(camera.storage.cardIncluded, false);
    assert.equal(camera.storage.subscriptionRequiredForLocalRecording, false);
  }
});

test('solar is preferred even when compatible wired power exists, without mandating solar at every site', () => {
  const result = select({ ...goodSite, c31PowerCompatible: true });
  assert.equal(result.recommendedEquipmentId, 'eufy_solocam_e30');
  assert.equal(result.status, 'proposed_recommendation');
  assert.ok(result.candidates.some(row => row.equipmentId === 'eufy_wired_cam_c31'));
  const shade = select({ ...goodSite, suitableSunlight: false, c31PowerCompatible: true });
  assert.equal(shade.recommendedEquipmentId, null);
  assert.equal(shade.status, 'manual_review');
  assert.ok(shade.candidates.some(row => row.equipmentId === 'eufy_wired_cam_c31'));
  assert.ok(shade.reviewReasons.includes('sunlight_insufficient_or_uncertain'));
});

test('floodlight is a lighting-requested, power-compatible candidate that always requires electrical review', () => {
  const result = select({ ...goodSite, lightingRequested: true, floodlightPowerCompatible: true });
  assert.equal(result.candidates[0].equipmentId, 'eufy_floodlight_e30');
  assert.equal(result.recommendedEquipmentId, null);
  assert.ok(result.reviewReasons.includes('candidate_installation_requires_manual_review'));
  assert.ok(!select({ ...goodSite, floodlightPowerCompatible: true }).candidates.some(row => row.equipmentId === 'eufy_floodlight_e30'));
  assert.ok(!select({ ...goodSite, lightingRequested: true }).candidates.some(row => row.equipmentId === 'eufy_floodlight_e30'));
  assert.ok(select({ ...goodSite, lightingRequested: true }).reviewReasons.includes('requested_lighting_power_unconfirmed'));
});

for (const fact of ['outdoor', 'suitableSunlight', 'wifiCoverageConfirmed', 'mountingCompatible', 'installationComplexityStandard', 'powerAssessmentComplete']) {
  for (const value of [false, null]) {
    test(`unconfirmed ${fact}=${value} requires manual review rather than automatic selection`, () => {
      const result = select({ ...goodSite, [fact]: value });
      assert.equal(result.status, 'manual_review');
      assert.equal(result.recommendedEquipmentId, null);
      assert.ok(result.reviewReasons.length);
    });
  }
}

test('an outlet alone, missing facts, unknown fields and string booleans are not model-specific power verification', () => {
  assert.throws(() => select({ outletExists: true }), /schema|assessment/i);
  assert.throws(() => select({ ...goodSite, c31PowerCompatible: 'true' }), /assessment/i);
  const result = select({ ...goodSite, suitableSunlight: false });
  assert.equal(result.candidates.length, 0);
  assert.ok(result.reviewReasons.includes('no_compatible_camera_candidate'));
});

const expectedPackages = [
  ['front_back_solar', 299.98, 599, 'starting', 2],
  ['front_back_mixed', 209.98, 599, 'starting', 2],
  ['front_back_floodlight', 299.98, 599, 'starting', 2],
  ['perimeter_solar', 599.96, 1099, 'fixed', 4],
  ['perimeter_mixed', 419.96, 1099, 'fixed', 4],
  ['perimeter_floodlight', 599.96, 1099, 'fixed', 4],
];
for (const [id, equipmentCost, price, kind, count] of expectedPackages) {
  test(`draft ${id} computes exact equipment costs and preserves incomplete materials at the baseline ${kind} price`, () => {
    const result = calculate(id);
    assert.equal(result.equipmentCost, equipmentCost);
    assert.equal(result.customerPrice.amount, price);
    assert.equal(result.customerPrice.kind, kind);
    assert.equal(result.selectedEquipment.reduce((sum, row) => sum + row.quantity, 0), count);
    assert.equal(result.requiredMaterials.find(row => row.materialId === 'camera_micro_sd_128gb').quantity, count);
    assert.equal(result.requiredMaterials.find(row => row.materialId === 'camera_consumables').quantity, count);
    assert.equal(result.knownMaterialsCost, equipmentCost);
    assert.equal(result.costingComplete, false);
    assert.equal(result.totalEstimatedDirectMaterialsCost, null);
    assert.equal(result.remainingContribution, null);
    assert.equal(result.contributionUpperBoundBeforeUncostedMaterials, Math.round((price - equipmentCost) * 100) / 100);
    assert.equal(result.status, 'proposed_pending_approval');
    assert.equal(result.comparisonOnly, true);
    assert.equal(result.requiresManualReview, true);
    assert.ok(result.reviewReasons.includes('required_material_costs_unknown'));
    assert.ok(result.reviewReasons.includes('proposed_configuration_not_approved'));
  });
}

test('verified material-cost inputs produce exact totals and contribution without activating the package', () => {
  const result = calculate('front_back_solar', {
    materialUnitCosts: {
      camera_micro_sd_128gb: { amount: 12.34, notes: 'TEST ONLY: hypothetical compatible card cost, not catalog evidence.' },
      camera_consumables: { amount: 2.5, notes: 'TEST ONLY: hypothetical surveyed allowance.' },
    },
    siteFactsByLocation: { front: goodSite, back: goodSite },
  });
  assert.equal(result.costingComplete, true);
  assert.equal(result.knownAccessoryAndConsumablesCost, 29.68);
  assert.equal(result.totalEstimatedDirectMaterialsCost, 329.66);
  assert.equal(result.remainingContribution, 269.34);
  assert.equal(result.customerPrice.kind, 'starting');
  assert.equal(result.contributionBasis, 'baseline_starting_price_not_final_quote');
  assert.equal(result.requiresManualReview, true);
  assert.equal(result.excludedExpenses.includes('commissions'), true);
});

test('custom location-specific combinations require correct power, coverage and extra materials', () => {
  const result = calculate('front_back_solar', {
    locations: [{ id: 'front', equipmentId: 'eufy_wired_cam_c31' }, { id: 'back', equipmentId: 'eufy_floodlight_e30' }],
    siteFactsByLocation: { front: goodSite, back: goodSite },
  });
  assert.equal(result.equipmentCost, 209.98);
  assert.deepEqual(result.selectedEquipment.map(row => row.quantity), [1, 1]);
  assert.ok(result.unknownMaterialIds.includes('c31_power_weather_protection'));
  assert.ok(result.unknownMaterialIds.includes('floodlight_electrical_materials'));
  assert.ok(result.reviewReasons.includes('selected_camera_requirements_unconfirmed:front'));
  assert.ok(result.reviewReasons.includes('selected_camera_requirements_unconfirmed:back'));
  assert.ok(result.locationAssessments.every(row => row.status === 'manual_review'));
  assert.ok(result.reviewReasons.includes('installation_scope_requires_review'));
});

test('configuration and calculation never mutate baseline, promotions, catalog or original planning costs', () => {
  const before = JSON.stringify({ config, catalog, baseline });
  assert.equal(validateCameraConfiguration(config, catalog, baseline), config);
  for (const draft of config.packages) calculate(draft.id);
  select(goodSite);
  assert.equal(JSON.stringify({ config, catalog, baseline }), before);
  const candidate = copy(catalog);
  candidate.cameraItems[1].costAssumption.amount = 140.01;
  const result = calculateCameraPackage(config, candidate, baseline, 'front_back_solar');
  assert.equal(result.equipmentCost, 280.02);
  assert.equal(candidate.cameraItems[1].supplier.observedPrice, 149.99);
  assert.equal(candidate.cameraItems[1].costAssumption.originalPlanningAmount, 149.99);
  assert.equal(catalog.cameraItems[1].costAssumption.amount, 149.99);
});

test('baseline assumptions are not approval and hardware equality does not erase floodlight installation requirements', () => {
  assert.ok(calculate('front_back_solar').reviewReasons.includes('baseline_cost_assumptions_unestablished'));
  for (const id of ['perimeter_solar', 'perimeter_floodlight']) {
    const result = calculate(id);
    assert.ok(result.reviewReasons.includes('equipment_exceeds_historical_baseline_assumption'));
    assert.ok(result.reviewReasons.includes('materials_exceed_historical_baseline_assumption'));
    assert.ok(result.reviewReasons.includes('historical_cost_reference_unverified'));
  }
  assert.ok(!calculate('perimeter_mixed').reviewReasons.includes('equipment_exceeds_historical_baseline_assumption'));
  assert.ok(calculate('perimeter_floodlight').reviewReasons.includes('installation_scope_requires_review'));
});

test('losses remain visible and excessive known costs require pricing review', () => {
  const result = calculate('front_back_solar', { materialUnitCosts: {
    camera_micro_sd_128gb: { amount: 300, notes: 'TEST ONLY: deliberately excessive cost.' },
    camera_consumables: { amount: 0, notes: 'TEST ONLY: verified no extra materials needed.' },
  } });
  assert.equal(result.totalEstimatedDirectMaterialsCost, 899.98);
  assert.equal(result.remainingContribution, -300.98);
  assert.ok(result.reviewReasons.includes('known_materials_exceed_baseline_customer_price'));
  assert.equal(result.customerPrice.amount, 599);
});

const invalidCatalogs = [
  ['camera activation', c => { c.cameraItems[0].status = 'approved'; }],
  ['missing camera link', c => { delete c.cameraConfiguration; }],
  ['orphaned camera configuration link', c => { delete c.cameraItems; }],
  ['duplicate ID across TV and cameras', c => { c.cameraItems[0].id = c.items[0].id; }],
  ['duplicate product ID', c => { c.cameraItems[1].productId = c.cameraItems[0].productId; }],
  ['wrong supplier SKU', c => { c.cameraItems[0].supplier.itemId = 'T817L122'; }],
  ['wrong official URL', c => { c.cameraItems[0].supplier.url = c.cameraItems[1].supplier.url; }],
  ['wrong model identifier', c => { c.cameraItems[0].modelNumber = 'T8426'; }],
  ['missing official source', c => { c.cameraItems[0].verification.sourceUrls = ['https://example.com/spec']; }],
  ['impossible date', c => { c.cameraItems[0].supplier.priceCheckDate = '2026-02-30'; }],
  ['wrong retailer URL', c => { c.cameraItems[0].retailerListings[0].itemId = '123'; }],
  ['impossible retailer date', c => { c.cameraItems[0].retailerListings[0].priceCheckDate = '2026-13-01'; }],
  ['unsafe planning cost', c => { c.cameraItems[0].costAssumption.amount = 1e20; }],
  ['sub-cent planning cost', c => { c.cameraItems[0].costAssumption.amount = 59.999; }],
  ['unsafe original planning cost', c => { c.cameraItems[0].costAssumption.originalPlanningAmount = 1e20; }],
  ['negative retail observation', c => { c.cameraItems[0].supplier.observedPrice = -1; }],
  ['incompatible installation category', c => { c.cameraItems[0].installationCategory = 'premium_hardwired_lighting'; }],
  ['invented solar compatibility', c => { c.cameraItems[0].solar.supported = true; }],
  ['missing solar panel', c => { c.cameraItems[1].solar.panelIncluded = false; }],
  ['missing DC requirement', c => { c.cameraItems[0].power.dcVolts = null; }],
  ['reversed AC bounds', c => { c.cameraItems[2].power.acMinVolts = 250; }],
  ['invented 5GHz support', c => { c.cameraItems[0].wifi.bandsGhz = [5]; }],
  ['claimed included microSD', c => { c.cameraItems[1].storage.cardIncluded = true; }],
  ['bypassed site verification', c => { c.cameraItems[0].verification.manualCompatibilityCheckRequired = false; }],
];
for (const [name, mutate] of invalidCatalogs) {
  test(`camera catalog rejects ${name}`, () => {
    const candidate = copy(catalog);
    mutate(candidate);
    assert.throws(() => validateEquipmentCatalog(candidate, baseline));
  });
}

const invalidConfigurations = [
  ['activation', c => { c.status = 'approved'; }],
  ['package activation', c => { c.packages[0].status = 'active'; }],
  ['material activation', c => { c.materialAssumptions[0].status = 'approved'; }],
  ['effective date', c => { c.effectiveDate = '2026-10-30'; }],
  ['currency mismatch', c => { c.currency = 'EUR'; }],
  ['baseline version mismatch', c => { c.baselineReference.version = '2.0.0'; }],
  ['duplicate review fact', c => { c.reviewRules[1].fact = c.reviewRules[0].fact; }],
  ['omitted Wi-Fi review', c => { c.reviewRules.splice(2, 1); }],
  ['unknown rule camera', c => { c.selectionRules[0].equipmentId = 'not_a_camera'; }],
  ['duplicated rule camera', c => { c.selectionRules[1].equipmentId = c.selectionRules[0].equipmentId; }],
  ['solar without sunlight', c => { delete c.selectionRules[1].when.suitableSunlight; }],
  ['C31 without specific power', c => { delete c.selectionRules[2].when.c31PowerCompatible; }],
  ['floodlight without lighting request', c => { delete c.selectionRules[0].when.lightingRequested; }],
  ['floodlight without electrical review', c => { c.selectionRules[0].manualReviewRequired = false; }],
  ['duplicate package ID', c => { c.packages[1].id = c.packages[0].id; }],
  ['unknown package camera', c => { c.packages[0].locations[0].equipmentId = 'onn_fixed_32_86'; }],
  ['duplicate location', c => { c.packages[0].locations[1].id = 'front'; }],
  ['wrong camera quantity', c => { c.packages[0].locations.pop(); }],
  ['wrong baseline group', c => { c.packages[0].baselinePriceReference.group = 'commercialWirelessEquipmentIncluded'; }],
  ['unpriced quantity', c => { c.packages[0].baselinePriceReference.quantity = 3; }],
  ['invented selling price', c => { c.packages[0].price = 500; }],
  ['wrong cost scenario', c => { c.packages[3].referenceCostScenarioId = 'commercial_eufy_e50_four_camera_example'; }],
  ['four-camera costs applied to two cameras', c => { c.packages[0].referenceCostScenarioId = 'residential_eufy_four_camera_example'; }],
  ['missing material reference', c => { c.materialAssumptions.pop(); }],
  ['duplicate material ID', c => { c.materialAssumptions[1].id = c.materialAssumptions[0].id; }],
  ['unsafe material cost', c => { c.materialAssumptions[0].unitCost = 1e20; }],
  ['negative material cost', c => { c.materialAssumptions[0].unitCost = -1; }],
];
for (const [name, mutate] of invalidConfigurations) {
  test(`camera configuration rejects ${name}`, () => {
    const candidate = copy(config);
    mutate(candidate);
    assert.throws(() => validateCameraConfiguration(candidate, catalog, baseline));
  });
}

test('removing required recording or power materials is not an allowed incomplete-cost shortcut', () => {
  for (const [index, materialId] of [[0, 'camera_micro_sd_128gb'], [0, 'c31_power_weather_protection'], [2, 'floodlight_electrical_materials']]) {
    const candidate = copy(catalog);
    candidate.cameraItems[index].requiredMaterialIds = candidate.cameraItems[index].requiredMaterialIds.filter(id => id !== materialId);
    assert.throws(() => validateCameraConfiguration(config, candidate, baseline));
  }
});

test('invalid overrides and unsupported package references fail explicitly', () => {
  assert.throws(() => calculate('missing_package'), /Unknown camera package/);
  for (const inputs of [
    { locations: [{ id: 'front', equipmentId: 'eufy_solocam_e30' }, { id: 'front', equipmentId: 'eufy_solocam_e30' }] },
    { materialUnitCosts: { missing_material: { amount: 1, notes: 'Unknown.' } } },
    { materialUnitCosts: { camera_micro_sd_128gb: { amount: 1 } } },
    { materialUnitCosts: { camera_micro_sd_128gb: { amount: -1, notes: 'Invalid.' } } },
    { materialUnitCosts: { camera_micro_sd_128gb: { amount: 1e20, notes: 'Unsafe.' } } },
    { materialUnitCosts: { camera_micro_sd_128gb: { amount: 1.001, notes: 'Sub-cent.' } } },
    { materialUnitCosts: { camera_micro_sd_128gb: { amount: 80000000000000, notes: 'Overflows at quantity two.' } } },
    { materialUnitCosts: { floodlight_electrical_materials: { amount: 1e20, notes: 'Unsafe even when unused by this package.' } } },
    { siteFactsByLocation: { left: goodSite } },
    { commissionRate: 10 },
  ]) {
    assert.throws(() => calculate('front_back_solar', inputs));
  }
});

test('CLI validates linked camera files and fails explicitly for an invalid camera input', () => {
  const root = path.resolve(__dirname, '..');
  const args = ['validate.cjs', 'home2smart.v1.json', path.join('promotions', 'experiments.v1.json'), 'equipment.v1.json', 'residential-cameras.v1.json'];
  const success = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /6 camera records, 6 inactive draft packages/);
  assert.match(success.stdout, /materials INCOMPLETE/);
  const failure = spawnSync(process.execPath, [...args.slice(0, -1), 'package.json'], { cwd: root, encoding: 'utf8' });
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /Residential camera schema/);
});
