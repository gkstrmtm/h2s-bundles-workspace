const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { loadContext, loadScenario, validateScenario, quoteOffer, projectMonth, compareVersions, dataHash, hash } = require('../engine.cjs');
const { fromExact, toMoney, percentage } = require('../tv-financials.cjs');
const context = loadContext();
const previous = loadScenario('v2-margin-protected');
const improved = loadScenario('v3-tv-margin-improvement');
const experimental = loadScenario('v4-tv-219-experimental');
const job = count => ({
  tvs: Array.from({ length: count }, () => ({ inches: 60, customerSuppliedMount: false, compatibilityVerified: true })),
  cameraPackageQuantity: 0,
});
const quote = (scenario, input) => quoteOffer(scenario, input, context);

for (const [count, revenue, company, margin, exactCompany, direct] of [
  [1, 199, 57.07, 28.68, '57.06576', '72.1872'],
  [2, 378.1, 110.39, 29.2, '110.39292', '132.7824'],
  [3, 547.25, 159.6, 29.16, '159.60078', '192.5816'],
]) {
  test(`v3 ${count}-TV package matches requested revenue, contribution and margin without intermediate rounding`, () => {
    const result = quote(improved, job(count));
    assert.equal(result.customerRevenue, revenue);
    assert.equal(result.companyContribution, company);
    assert.equal(result.companyContributionMarginPercent, margin);
    assert.equal(result.exactFinancials.companyContribution, exactCompany);
    assert.equal(result.exactFinancials.directExpenses, direct);
    assert.equal(result.calculationMode, 'full_precision_display_only');
    assert.equal(result.belowMinimumCompanyMargin, false);
    assert.equal(result.commissionPercent, 55);
    assert.deepEqual(result.missingCosts, []);
    assert.ok(result.flags.includes('modeled_tv_job_allowance_coverage_requires_review'));
    assert.ok(!result.expenseLines.some(row => /mount_|tvSuppliesPerTv|travelPerVisit|shippingPerVisit/.test(row.id)));
    assert.equal(result.expenseLines.find(row => row.id === 'additional_tv_job_allowance').amount, 10);
  });
}

for (const [count, revenue, company, margin] of [
  [1, 219, 65.35, 29.84], [2, 416.1, 126.12, 30.31], [3, 602.25, 182.37, 30.28],
]) {
  test(`v4 ${count}-TV $219 experiment remains unapproved and applies the same marginal discounts`, () => {
    const result = quote(experimental, job(count));
    assert.equal(result.customerRevenue, revenue);
    assert.equal(result.companyContribution, company);
    assert.equal(result.companyContributionMarginPercent, margin);
    assert.ok(result.flags.includes('experimental_not_approved'));
    assert.equal(result.activationAllowed, false);
    assert.equal(result.requiresReview, true);
  });
}

test('new versions preserve parent camera prices, snapshots, discounts and baseline content', () => {
  assert.equal(hash(fs.readFileSync(path.join(__dirname, '..', `${improved.id}.json`))), '84702dc881703bd2087422f82ace7b6de184e48c7ad5828e3932944d67f0b687');
  assert.equal(hash(fs.readFileSync(path.join(__dirname, '..', `${experimental.id}.json`))), '1924c01f16e70eafed97d87000bc807a90db33bc15bae9b5da609f17542f4f0c');
  assert.equal(improved.parentVersion, previous.id);
  assert.equal(experimental.parentVersion, improved.id);
  for (const scenario of [improved, experimental]) {
    assert.deepEqual(scenario.cameras, previous.cameras);
    assert.deepEqual(scenario.equipmentCostSnapshots, previous.equipmentCostSnapshots);
    assert.deepEqual(scenario.assumptions, previous.assumptions);
    assert.deepEqual(scenario.tv.discounts, previous.tv.discounts);
    assert.equal(scenario.tv.priceOverrides.length, 1);
    assert.equal(scenario.tv.priceOverrides[0].minInches, 56);
    assert.equal(scenario.tv.priceOverrides[0].maxInches, 65);
  }
  assert.equal(dataHash(context.baseline), 'e976cb48076c37e76d54e86125e41ea28b64bad9dc288aa43a71ada7bb33bf28');
  assert.equal(context.baseline.prices.tvMounting.residentialWithStandardFixedMount.find(row => row.minInches === 56).price, 179);
});

test('four-plus TVs have no automatic price; explicit custom prices remain proposed', () => {
  for (const count of [4, 5]) {
    const result = quote(improved, job(count));
    assert.equal(result.customerRevenue, null);
    assert.equal(result.companyContribution, null);
    assert.equal(result.requiresCustomQuote, true);
  }
  const result = quote(improved, { ...job(4), customPrice: { amount: 700, notes: 'TEST ONLY manually proposed total.' } });
  assert.equal(result.customerRevenue, 700);
  assert.equal(result.requiresCustomQuote, true);
  assert.ok(result.flags.includes('explicit_custom_price_not_approved'));
});

test('other TV sizes and customer-supplied mounts retain legacy pricing and costing', () => {
  for (const [inches, customerSuppliedMount] of [[43, false], [55, false], [75, false], [85, false], [60, true]]) {
    const input = job(1);
    input.tvs[0] = { inches, customerSuppliedMount, compatibilityVerified: true };
    const old = quote(previous, input);
    for (const scenario of [improved, experimental]) {
      const current = quote(scenario, input);
      assert.equal(current.customerRevenue, old.customerRevenue);
      assert.deepEqual(current.expenseLines, old.expenseLines);
      assert.equal(current.calculationMode, undefined);
      assert.equal(current.directExpenses, null);
    }
  }
});

test('mixed TV sizes use only the single tier-price override, retaining legacy costing and highest-price-first rules', () => {
  const input = job(2); input.tvs[0].inches = 75;
  const result = quote(improved, input);
  assert.deepEqual(result.revenueLines.map(row => [row.basePrice, row.discountPercent, row.amount]), [[219, 0, 219], [199, 10, 179.1]]);
  assert.equal(result.customerRevenue, 398.1);
  assert.equal(result.calculationMode, undefined);
  assert.ok(result.missingCosts.includes('travelPerVisit'));
});

test('camera-only financial output remains identical apart from scenario ID', () => {
  for (const count of [2, 3, 4]) {
    const { scenarioId, ...old } = quote(previous, { tvs: [], cameraPackageQuantity: count });
    for (const scenario of [improved, experimental]) {
      const { scenarioId: currentId, ...current } = quote(scenario, { tvs: [], cameraPackageQuantity: count });
      assert.notEqual(currentId, scenarioId);
      assert.deepEqual(current, old);
    }
  }
});

test('TV/camera mixed jobs retain legacy cost behavior and camera prices', () => {
  const result = quote(improved, { ...job(1), cameraPackageQuantity: 2 });
  assert.equal(result.customerRevenue, 698);
  assert.equal(result.calculationMode, undefined);
  assert.ok(result.expenseLines.some(row => row.id === 'S220_equipment'));
  assert.ok(result.missingCosts.includes('travelPerVisit'));
});

test('normalization makes old/new margins comparable without mutating sealed history or camera outputs', () => {
  const before = dataHash({ previous, improved, experimental, context });
  const results = compareVersions([previous, improved, experimental], { tvCostModelFrom: improved.id }, context);
  assert.deepEqual(results[0].offers.slice(0, 3).map(row => [row.customerRevenue, row.companyContribution, row.companyContributionMarginPercent]),
    [[179, 48.79, 27.25], [340.1, 94.66, 27.83], [492.25, 136.83, 27.8]]);
  assert.ok(results[0].offers[0].comparisonCostBasis.includes('historical_scenario_unchanged'));
  assert.equal(results[0].offers[3].comparisonCostBasis, undefined);
  assert.equal(quote(previous, job(1)).companyContribution, null);
  assert.equal(dataHash({ previous, improved, experimental, context }), before);
  assert.throws(() => compareVersions([previous, improved], { tvCostModelFrom: 'v99-missing' }, context), /normalization/);
});

test('monthly projections aggregate raw contributions instead of rounded job displays', () => {
  const result = projectMonth(improved, {
    monthlyVolume: 100, salesMix: [{ id: 'one-tv', percent: 100, job: job(1) }],
    overhead: { amount: 100, notes: 'TEST ONLY monthly overhead.' },
  }, context);
  assert.equal(result.companyContributionBeforeOverhead, 5706.58);
  assert.equal(result.exactFinancials.companyContributionBeforeOverhead, '5706.576');
  assert.equal(result.exactFinancials.afterOverhead, '5606.576');
  assert.equal(result.exactFinancials.reinvestment, '1401.644');
  assert.notEqual(result.companyContributionBeforeOverhead, 57.07 * 100);
  assert.equal(Math.round((result.reinvestment + result.distributableToOwners) * 100), Math.round(result.afterOverhead * 100));
  assert.equal(Math.round(result.ownerDistributions.reduce((a, b) => a + b, 0) * 100), Math.round(result.distributableToOwners * 100));
});

test('mixed monthly projections combine exact TV model with unchanged cent-rounded camera model', () => {
  const result = projectMonth(improved, {
    monthlyVolume: 2, salesMix: [
      { id: 'tv', percent: 50, job: job(1) },
      { id: 'camera', percent: 50, job: { tvs: [], cameraPackageQuantity: 2 } },
    ], overhead: { amount: 0, notes: 'TEST ONLY zero overhead.' },
  }, context);
  assert.equal(result.companyContributionBeforeOverhead, null);
  assert.deepEqual(result.ownerDistributions, [null, null, null]);
});

for (const rate of [50, 55, 60]) {
  test(`full-precision ${rate}% contribution commission is supported`, () => {
    const result = quote(improved, { ...job(1), commissionPercent: rate });
    const before = fromExact(result.exactFinancials.contributionBeforeCommission);
    const expected = before - percentage(before, rate);
    assert.equal(result.companyContribution, toMoney(expected));
  });
}

test('18% threshold checks exact contribution even when displayed margin rounds to 18%', () => {
  for (const [amount, below] of [[108.2, true], [108.21, false]]) {
    const result = quote(improved, { ...job(1), customPrice: { amount, notes: 'TEST ONLY threshold boundary.' } });
    assert.equal(result.companyContributionMarginPercent, 18);
    assert.equal(result.belowMinimumCompanyMargin, below);
    assert.equal(result.flags.includes('company_contribution_margin_below_threshold'), below);
  }
});

test('missing new-model costs, uncertain compatibility and loss cases are explicit', () => {
  const missing = quote(improved, { ...job(1), tvCostOverrides: { equipmentAndSuppliesPerTv: { amount: null, notes: 'Unknown.' } } });
  assert.equal(missing.companyContribution, null);
  assert.ok(missing.flags.includes('missing_costs'));
  const uncertain = job(1); uncertain.tvs[0].compatibilityVerified = null;
  assert.equal(quote(improved, uncertain).requiresCustomQuote, true);
  const loss = quote(improved, { ...job(1), customPrice: { amount: 1, notes: 'TEST ONLY loss.' } });
  assert.equal(loss.commission, 0);
  assert.ok(loss.companyContribution < 0);
  assert.equal(loss.belowMinimumCompanyMargin, true);
});

test('scoped overrides never silently discard legacy cost overrides or apply to unrelated jobs', () => {
  assert.throws(() => quote(improved, { ...job(1), costOverrides: { travelPerVisit: { amount: 20, notes: 'Explicit.' } } }), /replaces legacy/);
  assert.throws(() => quote(previous, { ...job(1), tvCostOverrides: {} }), /require a matching-tier/);
  assert.throws(() => quote(improved, { ...job(1), tvCostOverrides: { additionalJobAllowance: { amount: 1e20, notes: 'Unsafe.' } } }));
});

test('validation rejects nonexistent/duplicate overrides and unsafe or contradictory model metadata', () => {
  for (const mutate of [
    value => { value.tv.priceOverrides[0].minInches = 57; },
    value => { value.tv.priceOverrides.push({ ...value.tv.priceOverrides[0] }); },
    value => { value.tv.priceOverrides[0].status = 'experimental_not_approved'; },
    value => { value.tv.costModel.precision = 'round_each_line'; },
    value => { value.tv.costModel.additionalJobAllowance.amount = -1; },
    value => { value.tv.costModel.equipmentAndSuppliesPerTv.amount = 1e20; },
    value => { value.tv.examples[1].revenue = 380; },
    value => { value.activationAllowed = true; },
  ]) {
    const value = structuredClone(improved); mutate(value); assert.throws(() => validateScenario(value, context));
  }
});

test('CLI default comparison includes old versions and both new scenarios', () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, '..', 'offers.cjs'), 'compare'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const output = JSON.parse(run.stdout);
  assert.deepEqual(Object.keys(output[0].versions), [previous.parentVersion, previous.id, improved.id, experimental.id]);
  assert.equal(output[0].versions[improved.id].companyContribution, 57.07);
});
