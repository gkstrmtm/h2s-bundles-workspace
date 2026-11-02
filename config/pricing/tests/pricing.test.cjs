const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateBaseline, validatePromotions, validateEquipmentCatalog, calculateMaterialFinancials, compareOfferScenario } = require('../pricing.cjs');
const baseline = require('../home2smart.v1.json');
const promotions = require('../promotions/experiments.v1.json');
const original = require('../source/pricing.v1.json');
const equipment = require('../equipment.v1.json');
const copy = value => structuredClone(value);

test('all received baseline fields survive unchanged; the original inactive offer is extracted losslessly', () => {
  const { offers, ...expectedBaseline } = original;
  assert.deepEqual(baseline, expectedBaseline);
  assert.equal(promotions.offers[0].discount.amount, offers.newHomeSetupBundleDiscount);
  assert.equal(promotions.offers[0].status, offers.status);
  assert.equal(promotions.offers[0].eligibility, null);
  const handoff = fs.readFileSync(path.join(__dirname, '..', 'source', 'AGENT_HANDOFF.v1.md'), 'utf8');
  for (const rule of ['eufy', 'Greenwood, Greenville, Spartanburg', 'customer-supplied bracket',
    'equipment-inclusive', 'licensing, insurance', 'NOT net profit']) {
    assert.ok(handoff.toLowerCase().includes(rule.toLowerCase()), `Original handoff policy missing: ${rule}`);
  }
});

test('the received proposal validates without normalization, rounding or activation of its data', () => {
  const before = JSON.stringify({ baseline, promotions });
  assert.equal(validateBaseline(baseline), baseline);
  assert.equal(validatePromotions(promotions, baseline), promotions);
  assert.equal(JSON.stringify({ baseline, promotions }), before);
  assert.equal(baseline.status, 'proposed_baseline_pending_approval');
  assert.equal(baseline.effectiveDate, null);
});

const invalidBaselines = [
  ['wrong currency', b => { b.currency = 'EUR'; }],
  ['unapproved activation', b => { b.status = 'approved'; }],
  ['unapproved effective date', b => { b.effectiveDate = '2026-10-25'; }],
  ['unknown top-level field', b => { b.fallbackPrice = 99; }],
  ['experimental offer in baseline', b => { b.offers = original.offers; }],
  ['additional active service', b => { b.scope.push('smart_locks'); }],
  ['missing commercial market', b => { b.markets.pop(); }],
  ['duplicate market', b => { b.markets[1] = 'residential'; }],
  ['renamed commercial group', b => {
    b.prices.tvMounting.commercial = b.prices.tvMounting.commercialInstallationOnly;
    delete b.prices.tvMounting.commercialInstallationOnly;
  }],
  ['residential-only field in commercial group', b => { b.prices.tvMounting.commercialInstallationOnly[0].customerMount = true; }],
  ['missing price group', b => { delete b.prices.cameras.commercialWirelessInstallationOnly; }],
  ['negative travel reach', b => { b.serviceArea.maximumOneWayDriveHours = -1; }],
  ['changed formula', b => { b.pricingRules.grossMaterialProfitFormula = 'sellingPrice - equipmentCost'; }],
  ['omitted labor exclusion', b => { b.pricingRules.excludedCosts.shift(); }],
  ['missing quote trigger', b => { b.pricingRules.quoteRequired.pop(); }],
  ['string price', b => { b.prices.tvMounting.residentialInstallationOnly[0].price = '109'; }],
  ['zero price', b => { b.prices.tvMounting.residentialInstallationOnly[0].price = 0; }],
  ['negative price', b => { b.prices.tvMounting.residentialInstallationOnly[0].price = -1; }],
  ['sub-cent price', b => { b.prices.tvMounting.residentialInstallationOnly[0].price = 109.001; }],
  ['nonfinite price', b => { b.prices.tvMounting.residentialInstallationOnly[0].price = Infinity; }],
  ['unsafe price', b => { b.prices.tvMounting.residentialInstallationOnly[0].price = 1e20; }],
  ['both fixed and from', b => { b.prices.tvMounting.residentialInstallationOnly[0].priceFrom = 99; }],
  ['no price and no quote flag', b => { delete b.prices.tvMounting.residentialInstallationOnly[0].price; }],
  ['fixed price marked quote-only', b => { b.prices.tvMounting.residentialInstallationOnly[0].quoteRequired = true; }],
  ['size gap', b => { b.prices.tvMounting.residentialInstallationOnly[1].minInches = 45; }],
  ['size overlap', b => { b.prices.tvMounting.residentialInstallationOnly[1].minInches = 43; }],
  ['reversed range', b => { b.prices.tvMounting.residentialInstallationOnly[1].maxInches = 42; }],
  ['fractional inches', b => { b.prices.tvMounting.residentialInstallationOnly[1].minInches = 44.5; }],
  ['duplicate tier', b => { b.prices.tvMounting.residentialInstallationOnly.splice(1, 0, copy(b.prices.tvMounting.residentialInstallationOnly[0])); }],
  ['open tier before last', b => { delete b.prices.tvMounting.residentialInstallationOnly[1].maxInches; }],
  ['unquoted open TV tier', b => { b.prices.tvMounting.residentialInstallationOnly.at(-1).quoteRequired = false; }],
  ['unhandled large TV sizes', b => { b.prices.tvMounting.residentialInstallationOnly.pop(); }],
  ['missing quantity', b => { delete b.prices.cameras.residentialWirelessInstallationOnly[0].quantity; }],
  ['zero quantity', b => { b.prices.cameras.residentialWirelessInstallationOnly[0].quantity = 0; }],
  ['duplicate quantity with different price', b => { b.prices.cameras.residentialWirelessInstallationOnly[1].quantity = 1; }],
  ['descending quantities', b => { b.prices.tvMounting.commercialBundlesInstallationOnlyUpTo65Inches.reverse(); }],
  ['quote-only camera converted to free', b => { b.prices.cameras.commercialWiredEquipmentIncluded.at(-1).price = 0; }],
  ['incorrect contribution', b => { b.costScenarios[0].grossMaterialProfit += 1; }],
  ['incorrect margin', b => { b.costScenarios[0].grossMaterialMarginPercent += 1; }],
  ['negative equipment cost', b => { b.costScenarios[0].equipmentCost = -1; }],
  ['duplicate scenario ID', b => { b.costScenarios[1].id = b.costScenarios[0].id; }],
  ['unverified cost falsely marked verified', b => { b.costScenarios[0].equipmentCostStatus = 'verified'; }],
];
for (const [name, mutate] of invalidBaselines) {
  test(`rejects ${name}`, () => {
    const candidate = copy(baseline);
    mutate(candidate);
    assert.throws(() => validateBaseline(candidate));
  });
}

test('each market and equipment mode has separate arrays; a valid residential price edit never affects commercial', () => {
  const candidate = copy(baseline), commercialBefore = copy(candidate.prices.tvMounting.commercialInstallationOnly);
  candidate.prices.tvMounting.residentialInstallationOnly[0].price = 119;
  validateBaseline(candidate);
  assert.deepEqual(candidate.prices.tvMounting.commercialInstallationOnly, commercialBefore);
  assert.equal(baseline.prices.tvMounting.residentialInstallationOnly[0].price, 109);
  assert.notStrictEqual(candidate.prices.cameras.residentialWirelessInstallationOnly, candidate.prices.cameras.residentialEquipmentIncluded);
});

test('fixed, starting and quote-only amounts remain distinct and missing quantities are not interpolated', () => {
  const cameras = baseline.prices.cameras;
  assert.deepEqual(cameras.residentialEquipmentIncluded.find(row => row.quantity === 1), { quantity: 1, priceFrom: 299 });
  assert.deepEqual(cameras.residentialEquipmentIncluded.find(row => row.quantity === 4), { quantity: 4, price: 1099 });
  assert.deepEqual(cameras.commercialWiredEquipmentIncluded.at(-1), { quantity: 16, quoteRequired: true });
  assert.equal(cameras.residentialWirelessInstallationOnly.find(row => row.quantity === 3), undefined);
});

test('financial examples are recomputed from equipment and supplies, not copied as illustrative profit constants', () => {
  for (const scenario of baseline.costScenarios) {
    const result = calculateMaterialFinancials({
      sellingPrice: scenario.sellingPrice, equipmentCost: scenario.equipmentCost, suppliesCost: scenario.suppliesCostEstimate,
    });
    assert.equal(result.materialContribution, scenario.grossMaterialProfit);
    assert.equal(result.materialMarginPercent, scenario.grossMaterialMarginPercent);
  }
  assert.deepEqual(calculateMaterialFinancials({ sellingPrice: 0.30, equipmentCost: 0.10, suppliesCost: 0.20 }), {
    sellingPrice: 0.30, equipmentCost: 0.10, suppliesCost: 0.20, materialContribution: 0, materialMarginPercent: 0,
  });
  const changed = copy(baseline);
  const scenario = changed.costScenarios[0];
  scenario.equipmentCost += 10;
  const result = calculateMaterialFinancials({ sellingPrice: scenario.sellingPrice,
    equipmentCost: scenario.equipmentCost, suppliesCost: scenario.suppliesCostEstimate });
  scenario.grossMaterialProfit = result.materialContribution;
  scenario.grossMaterialMarginPercent = result.materialMarginPercent;
  validateBaseline(changed);
});

test('losses remain visible and a zero-price giveaway has an explicitly undefined margin, not fake profit', () => {
  const loss = calculateMaterialFinancials({ sellingPrice: 100, equipmentCost: 110, suppliesCost: 5 });
  assert.equal(loss.materialContribution, -15);
  assert.equal(loss.materialMarginPercent, -15);
  const free = calculateMaterialFinancials({ sellingPrice: 0, equipmentCost: 10, suppliesCost: 5 });
  assert.equal(free.materialContribution, -15);
  assert.equal(free.materialMarginPercent, null);
});

test('financial calculation rejects missing, sub-cent, unsafe, nonfinite and negative cost inputs', () => {
  for (const value of [undefined, null, '100', NaN, Infinity, -1, 0.001, 1e20]) {
    assert.throws(() => calculateMaterialFinancials({ sellingPrice: 100, equipmentCost: value, suppliesCost: 5 }));
  }
  assert.throws(() => calculateMaterialFinancials({ sellingPrice: 100, equipmentCost: 80000000000000, suppliesCost: 80000000000000 }));
});

const invalidPromotions = [
  ['version mismatch', p => { p.baselineVersion = '2.0.0'; }],
  ['currency mismatch', p => { p.currency = 'EUR'; }],
  ['duplicate offer ID', p => { p.offers.push(copy(p.offers[0])); }],
  ['automatic activation', p => { p.offers[0].status = 'active'; }],
  ['invented eligibility', p => { p.offers[0].eligibility = 'all_customers'; }],
  ['baseline price override', p => { p.prices = baseline.prices; }],
  ['zero discount', p => { p.offers[0].discount.amount = 0; }],
  ['negative discount', p => { p.offers[0].discount.amount = -50; }],
  ['sub-cent discount', p => { p.offers[0].discount.amount = 0.001; }],
  ['unsupported discount type', p => { p.offers[0].discount.type = 'free_install'; }],
  ['over-100 percent', p => { p.offers[0].discount = { type: 'percentage', percent: 101 }; }],
  ['mixed discounts', p => { p.offers[0].discount.percent = 10; }],
];
for (const [name, mutate] of invalidPromotions) {
  test(`promotion rejects ${name}`, () => {
    const candidate = copy(promotions);
    mutate(candidate);
    assert.throws(() => validatePromotions(candidate, baseline));
  });
}

test('different offers can be compared without modifying baseline, costs, scenarios or experimental definitions', () => {
  const scenario = { sellingPrice: 1099, equipmentCost: 559.99, suppliesCost: 30 };
  const fixed = copy(promotions.offers[0]), percent = { ...copy(fixed), id: 'ten_percent_example',
    discount: { type: 'percentage', percent: 10 } };
  const before = JSON.stringify({ baseline, scenario, fixed, percent });
  const fixedResult = compareOfferScenario(scenario, fixed);
  const percentResult = compareOfferScenario(scenario, percent);
  assert.equal(fixedResult.comparisonOnly, true);
  assert.equal(fixedResult.standard.materialContribution, 509.01);
  assert.equal(fixedResult.experimental.sellingPrice, 1049);
  assert.equal(fixedResult.experimental.materialContribution, 459.01);
  assert.equal(percentResult.discountAmount, 109.90);
  assert.equal(percentResult.experimental.sellingPrice, 989.10);
  assert.equal(JSON.stringify({ baseline, scenario, fixed, percent }), before);
  assert.throws(() => compareOfferScenario({ ...scenario, sellingPrice: 49 }, fixed), /exceeds/);
  const free = compareOfferScenario(scenario, { ...percent, discount: { type: 'percentage', percent: 100 } });
  assert.equal(free.experimental.materialMarginPercent, null);
});

test('percentage comparisons round once to cents, and calculation never evaluates formula strings', () => {
  const offer = { ...copy(promotions.offers[0]), discount: { type: 'percentage', percent: 50 } };
  const result = compareOfferScenario({ sellingPrice: 0.05, equipmentCost: 0, suppliesCost: 0 }, offer);
  assert.equal(result.discountAmount, 0.03);
  assert.equal(result.experimental.sellingPrice, 0.02);
  const candidate = copy(baseline);
  candidate.pricingRules.grossMaterialProfitFormula = 'process.exit(99)';
  assert.throws(() => validateBaseline(candidate), /schema/);
});

test('equipment catalog preserves baseline, original source, cameras and promotions without activation', () => {
  const before = JSON.stringify({ baseline, original, promotions, equipment });
  assert.equal(validateEquipmentCatalog(equipment, baseline), equipment);
  assert.equal(JSON.stringify({ baseline, original, promotions, equipment }), before);
  assert.equal(equipment.status, 'proposed_pending_approval');
  assert.equal(equipment.effectiveDate, null);
  assert.equal(equipment.items.length, 5);
  assert.equal(equipment.customerUpgrades.length, 2);
  for (const entry of [...equipment.items, ...equipment.costAllowances, ...equipment.customerUpgrades]) {
    assert.equal(entry.status, 'proposed_pending_approval');
  }
});

test('equipment costs, exact supplier variants and observed rollback prices remain distinct', () => {
  const expected = [
    ['onn_fixed_32_86', '777842123', 24.88, 24.88],
    ['onn_tilt_50_86', '299960224', 25.24, 25.24],
    ['onn_full_motion_50_86', '866844895', 54, 44.94],
    ['onn_full_motion_19_50', '990431788', 26.96, 26.96],
    ['wire_trak_raceway_54', '342180027', 14.96, 14.96],
  ];
  assert.deepEqual(equipment.items.map(item => [
    item.id, item.supplier.itemId, item.costAssumption.amount, item.supplier.observedPrice,
  ]), expected);
  for (const item of equipment.items) {
    assert.equal(item.supplier.priceCheckDate, '2026-10-30');
    assert.equal(item.supplier.url, `https://www.walmart.com/ip/${item.supplier.itemId}`);
    assert.equal(item.costAssumption.editable, true);
    assert.equal(item.verification.manualCompatibilityCheckRequired, true);
  }
  const candidate = copy(equipment), before = JSON.stringify({ baseline, promotions });
  candidate.items[2].costAssumption.amount = 55.01;
  validateEquipmentCatalog(candidate, baseline);
  assert.equal(candidate.items[2].supplier.observedPrice, 44.94);
  assert.equal(equipment.items[2].costAssumption.amount, 54);
  assert.equal(JSON.stringify({ baseline, promotions }), before);
});

test('unknown compatibility stays explicit and does not expand baseline size coverage', () => {
  assert.equal(equipment.items[0].tvCompatibility.minInches, 32);
  assert.equal(equipment.items[1].tvCompatibility.minInches, 50);
  assert.equal(equipment.items[1].tvCompatibility.vesaMm, null);
  assert.equal(equipment.items[2].tvCompatibility.maxInches, 86);
  assert.equal(equipment.items[3].tvCompatibility.maxInches, 50);
  assert.equal(equipment.items[3].tvCompatibility.maxWeightLb, 50);
  assert.equal(equipment.items[4].tvCompatibility, null);
  assert.equal(equipment.items[4].dimensionsInches.totalLength, 54);
  for (const item of equipment.items.filter(item => item.type !== 'raceway')) {
    assert.equal(item.dimensionsInches.width, null);
    if (item.tvCompatibility.vesaMm) assert.equal(item.tvCompatibility.vesaMm.supportedPatterns, null);
  }
  assert.deepEqual(baseline.prices.tvMounting.residentialWithStandardFixedMount.at(-1), {
    minInches: 86, quoteRequired: true,
  });
});

test('estimated per-TV allowance and customer upgrade references do not imply approved applicability', () => {
  assert.deepEqual(equipment.costAllowances.map(row => [row.id, row.amountPerTv, row.editable, row.basis]), [
    ['extra_tv_consumables', 3, true, 'estimate'],
  ]);
  assert.deepEqual(equipment.customerUpgrades.map(row => [
    row.equipmentId, row.replacesEquipmentId, row.additionalPrice, row.baselinePriceGroup,
  ]), [
    ['onn_tilt_50_86', 'onn_fixed_32_86', 20, null],
    ['onn_full_motion_50_86', 'onn_fixed_32_86', 65, null],
  ]);
});

const invalidEquipment = [
  ['catalog activation', c => { c.status = 'approved'; }],
  ['item activation', c => { c.items[0].status = 'active'; }],
  ['allowance activation', c => { c.costAllowances[0].status = 'active'; }],
  ['upgrade activation', c => { c.customerUpgrades[0].status = 'active'; }],
  ['effective date', c => { c.effectiveDate = '2026-10-30'; }],
  ['currency mismatch', c => { c.currency = 'EUR'; }],
  ['baseline version mismatch', c => { c.baselineReference.version = '2.0.0'; }],
  ['wrong baseline file', c => { c.baselineReference.file = 'source/pricing.v1.json'; }],
  ['baseline price override', c => { c.prices = baseline.prices; }],
  ['commission field', c => { c.commissions = []; }],
  ['duplicate item ID', c => { c.items[1].id = c.items[0].id; }],
  ['duplicate ID across collections', c => { c.customerUpgrades[0].id = c.costAllowances[0].id; }],
  ['duplicate supplier SKU', c => { c.items[1].supplier = copy(c.items[0].supplier); }],
  ['wrong supplier URL SKU', c => { c.items[0].supplier.url = 'https://www.walmart.com/ip/123'; }],
  ['non-product URL', c => { c.items[0].supplier.url = 'https://www.walmart.com/search?q=mount'; }],
  ['unrelated compatibility source', c => { c.items[0].verification.sourceUrl = c.items[1].supplier.url; }],
  ['impossible calendar date', c => { c.items[0].supplier.priceCheckDate = '2026-02-30'; }],
  ['invalid calendar month', c => { c.items[0].supplier.priceCheckDate = '2026-13-01'; }],
  ['non-ISO date', c => { c.items[0].supplier.priceCheckDate = '10/30/2026'; }],
  ['missing observed price', c => { delete c.items[0].supplier.observedPrice; }],
  ['claimed manual verification', c => { c.items[0].verification.status = 'verified'; }],
  ['bypassed compatibility check', c => { c.items[0].verification.manualCompatibilityCheckRequired = false; }],
  ['negative planning cost', c => { c.items[0].costAssumption.amount = -1; }],
  ['sub-cent planning cost', c => { c.items[0].costAssumption.amount = 1.001; }],
  ['unsafe planning cost', c => { c.items[0].costAssumption.amount = 1e20; }],
  ['nonfinite planning cost', c => { c.items[0].costAssumption.amount = Infinity; }],
  ['unsafe observed price', c => { c.items[0].supplier.observedPrice = 1e20; }],
  ['negative observed price', c => { c.items[0].supplier.observedPrice = -1; }],
  ['locked planning cost', c => { c.items[0].costAssumption.editable = false; }],
  ['negative consumables', c => { c.costAllowances[0].amountPerTv = -3; }],
  ['unsafe consumables', c => { c.costAllowances[0].amountPerTv = 1e20; }],
  ['non-estimated consumables', c => { c.costAllowances[0].basis = 'verified'; }],
  ['missing mount compatibility', c => { c.items[0].tvCompatibility = null; }],
  ['TV mount compatibility on raceway', c => { c.items[4].tvCompatibility = copy(c.items[0].tvCompatibility); }],
  ['reversed TV size bounds', c => { c.items[0].tvCompatibility.minInches = 90; }],
  ['unsafe TV size bound', c => { c.items[0].tvCompatibility.maxInches = 1e20; }],
  ['zero weight limit', c => { c.items[0].tvCompatibility.maxWeightLb = 0; }],
  ['negative dimension', c => { c.items[0].dimensionsInches.width = -1; }],
  ['reversed wall distance', c => { c.items[2].dimensionsInches.wallDistance.minimum = 20; }],
  ['reversed VESA bounds', c => { c.items[0].tvCompatibility.vesaMm.minimumWidth = 700; }],
  ['out-of-bounds VESA pattern', c => {
    c.items[0].tvCompatibility.vesaMm.supportedPatterns = [{ width: 800, height: 400 }];
  }],
  ['unknown upgrade equipment', c => { c.customerUpgrades[0].equipmentId = 'missing_mount'; }],
  ['allowance as upgrade equipment', c => { c.customerUpgrades[0].equipmentId = c.costAllowances[0].id; }],
  ['raceway as upgrade equipment', c => { c.customerUpgrades[0].equipmentId = c.items[4].id; }],
  ['unknown replacement equipment', c => { c.customerUpgrades[0].replacesEquipmentId = 'missing_mount'; }],
  ['wrong replacement type', c => { c.customerUpgrades[0].replacesEquipmentId = c.items[2].id; }],
  ['non-overlapping replacement sizes', c => { c.items[0].tvCompatibility.maxInches = 49; }],
  ['unknown baseline price group', c => { c.customerUpgrades[0].baselinePriceGroup = '/prices/tvMounting/missing'; }],
  ['installation-only price reference', c => {
    c.customerUpgrades[0].baselinePriceGroup = '/prices/tvMounting/residentialInstallationOnly';
  }],
  ['camera price reference', c => {
    c.customerUpgrades[0].baselinePriceGroup = '/prices/cameras/residentialEquipmentIncluded';
  }],
  ['negative customer upgrade', c => { c.customerUpgrades[0].additionalPrice = -20; }],
  ['unsafe customer upgrade', c => { c.customerUpgrades[0].additionalPrice = 1e20; }],
  ['sub-cent customer upgrade', c => { c.customerUpgrades[0].additionalPrice = 20.001; }],
];
for (const [name, mutate] of invalidEquipment) {
  test(`equipment rejects ${name}`, () => {
    const candidate = copy(equipment);
    mutate(candidate);
    assert.throws(() => validateEquipmentCatalog(candidate, baseline));
  });
}

test('explicit fixed-mount price reference, valid VESA patterns and real leap dates validate without activation', () => {
  const candidate = copy(equipment);
  candidate.customerUpgrades[0].baselinePriceGroup = '/prices/tvMounting/residentialWithStandardFixedMount';
  candidate.items[0].tvCompatibility.vesaMm.supportedPatterns = [{ width: 75, height: 75 }, { width: 600, height: 400 }];
  candidate.items[0].supplier.priceCheckDate = '2028-02-29';
  validateEquipmentCatalog(candidate, baseline);
  assert.equal(candidate.customerUpgrades[0].status, 'proposed_pending_approval');
});

test('CLI works from any working directory and exits nonzero on malformed input', () => {
  const script = path.resolve(__dirname, '..', 'validate.cjs');
  const success = spawnSync(process.execPath, [script], { cwd: path.parse(script).root, encoding: 'utf8' });
  assert.equal(success.status, 0, success.stderr);
  assert.match(success.stdout, /40 tiers/);
  assert.match(success.stdout, /5 supplier items, 1 estimated allowance\(s\), 2 inactive upgrade\(s\)/);
  const failure = spawnSync(process.execPath, [script, path.join(__dirname, '..', 'package.json')], { encoding: 'utf8' });
  assert.equal(failure.status, 1);
  assert.match(failure.stderr, /Pricing validation failed/);
  const invalidCatalog = spawnSync(process.execPath, [
    script, path.resolve(__dirname, '..', 'home2smart.v1.json'),
    path.resolve(__dirname, '..', 'promotions', 'experiments.v1.json'),
    path.resolve(__dirname, '..', 'package.json'),
  ], { encoding: 'utf8' });
  assert.equal(invalidCatalog.status, 1);
  assert.match(invalidCatalog.stderr, /Equipment schema/);
  const missingCatalog = spawnSync(process.execPath, [
    script, path.resolve(__dirname, '..', 'home2smart.v1.json'),
    path.resolve(__dirname, '..', 'promotions', 'experiments.v1.json'),
    path.resolve(__dirname, 'missing-equipment.json'),
  ], { encoding: 'utf8' });
  assert.equal(missingCatalog.status, 1);
  assert.match(missingCatalog.stderr, /ENOENT/);
});
