const { usdCents, safeCentResult } = require('../../pricing.cjs');

// Fourteen decimal places exactly cover money, two percentage stages and reinvestment.
const SCALE = 100000000000000n;
const fromMoney = (value, label = 'money') => BigInt(usdCents(value, label, true)) * (SCALE / 100n);
const sum = values => values.reduce((total, value) => total + value, 0n);

function roundedDivide(numerator, denominator) {
  const sign = numerator < 0n ? -1n : 1n;
  const magnitude = numerator * sign;
  return sign * ((magnitude + denominator / 2n) / denominator);
}

function toMoney(value) {
  return value === null ? null : safeCentResult(Number(roundedDivide(value, SCALE / 100n))) / 100;
}

function exactString(value) {
  if (value === null) return null;
  const sign = value < 0n ? '-' : '';
  const magnitude = value < 0n ? -value : value;
  const fraction = (magnitude % SCALE).toString().padStart(14, '0').replace(/0+$/, '');
  return `${sign}${magnitude / SCALE}${fraction ? `.${fraction}` : ''}`;
}

function fromExact(value) {
  if (!/^-?\d+(?:\.\d{1,14})?$/.test(value)) throw new Error('Invalid exact financial amount.');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  return (BigInt(whole) * SCALE + BigInt(fraction.padEnd(14, '0'))) * (negative ? -1n : 1n);
}

function percentage(value, rate) {
  if (value === null) return null;
  const numerator = value * BigInt(usdCents(rate, 'percentage'));
  if (numerator % 10000n !== 0n) throw new RangeError('Exact percentage exceeds supported precision; no intermediate rounding is permitted.');
  return numerator / 10000n;
}

function margin(value, revenue) {
  return value === null || !revenue ? null : safeCentResult(Number(roundedDivide(value * 10000n, revenue))) / 100;
}

function belowMargin(value, revenue, threshold) {
  return value === null || !revenue ? null : value * 10000n < revenue * BigInt(usdCents(threshold, 'margin threshold'));
}

function expenseLine(id, value, taxable, notes, quantity = 1) {
  return { id, quantity, amount: toMoney(value), exactAmount: exactString(value), taxable, notes };
}

function finalizeExactQuote(scenario, job, { revenue, revenueLines, expenseLines: inputs, flags: initialFlags, custom = false, recommendation = null }) {
  const assumptions = scenario.assumptions;
  const flags = new Set(initialFlags), expenseLines = [...inputs];
  const taxable = expenseLines.filter(row => row.taxable);
  const taxBase = taxable.some(row => row.exactAmount === null) ? null : sum(taxable.map(row => fromExact(row.exactAmount)));
  expenseLines.push(
    expenseLine('estimated_materials_tax', percentage(taxBase, assumptions.materialsTaxPercent), false, 'Estimated tax on itemized equipment and supplies; incidentals excluded.'),
    expenseLine('payment_processing', percentage(revenue, assumptions.processingPercent), false, 'Revenue-based processing estimate.'),
    expenseLine('service_reserve', percentage(revenue, assumptions.serviceReservePercent), false, 'Company-owned reserve retained before commission; not cash spent.')
  );
  const missingCosts = new Set(expenseLines.filter(row => row.exactAmount === null).map(row => row.id));
  const known = sum(expenseLines.filter(row => row.exactAmount !== null).map(row => fromExact(row.exactAmount)));
  const direct = missingCosts.size ? null : known;
  const before = direct === null || revenue === null ? null : revenue - direct;
  const rate = job.commissionPercent ?? assumptions.commissionPercent;
  const commission = before === null ? null : percentage(before > 0n ? before : 0n, rate);
  const company = commission === null ? null : before - commission;
  const below = belowMargin(company, revenue, assumptions.minimumCompanyMarginPercent);
  if (missingCosts.size) flags.add('missing_costs');
  if (revenue === null) flags.add('customer_price_required');
  if (revenue === 0n) flags.add('zero_revenue_margin_undefined');
  if (below) flags.add('company_contribution_margin_below_threshold');
  if (company !== null && company < 0n) { flags.add('negative_company_contribution'); custom = true; }
  if (scenario.developmentStage === 'experimental_not_approved') flags.add('experimental_not_approved');
  const exactFinancials = Object.fromEntries(Object.entries({
    customerRevenue: revenue, knownDirectExpenses: known, directExpenses: direct,
    contributionBeforeCommission: before, commission, companyContribution: company,
  }).map(([key, value]) => [key, exactString(value)]));
  return {
    calculationMode: 'full_precision_display_only', exactFinancials,
    revenueLines, expenseLines, customerRevenue: toMoney(revenue), knownDirectExpenses: toMoney(known), directExpenses: toMoney(direct),
    contributionBeforeCommission: toMoney(before), commissionPercent: rate, commission: toMoney(commission), companyContribution: toMoney(company),
    companyContributionMarginPercent: margin(company, revenue), belowMinimumCompanyMargin: below,
    minimumCompanyMarginPercent: assumptions.minimumCompanyMarginPercent, missingCosts: [...missingCosts],
    flags: [...flags], requiresCustomQuote: custom, recommendation,
  };
}

function quoteTvModel(scenario, job, tvs, initialFlags) {
  const model = scenario.tv.costModel;
  const overrides = job.tvCostOverrides ?? {};
  const flags = new Set([...initialFlags, 'modeled_tv_job_allowance_coverage_requires_review']);
  const expenseLines = [];
  let custom = false;
  const revenueValues = [];
  const revenueLines = tvs.map(({ tv, index, group, tier, baselineTier }, position) => {
    const discount = scenario.tv.discounts.percentsByPosition[position];
    const base = fromMoney(tier.price);
    const amount = discount === undefined ? null : base - percentage(base, discount);
    revenueValues.push(amount);
    if (amount === null) custom = true;
    if (tv.compatibilityVerified !== true) { custom = true; flags.add(`tv_compatibility_unverified:${index + 1}`); }
    return {
      id: `tv_${index + 1}`, baselineTierGroup: group, minInches: tier.minInches, maxInches: tier.maxInches,
      baselinePrice: baselineTier.price, basePrice: tier.price, discountPercent: discount ?? null,
      amount: toMoney(amount), exactAmount: exactString(amount),
    };
  });
  let revenue = revenueValues.includes(null) ? null : sum(revenueValues);
  if (job.customPrice) {
    revenue = job.customPrice.amount === null ? null : fromMoney(job.customPrice.amount);
    custom = true; flags.add('explicit_custom_price_not_approved');
  }
  function expense(id, value, taxable, notes, quantity = 1) {
    expenseLines.push(expenseLine(id, value, taxable, notes, quantity));
  }
  const materialsInput = overrides.equipmentAndSuppliesPerTv ?? model.equipmentAndSuppliesPerTv;
  const allowanceInput = overrides.additionalJobAllowance ?? model.additionalJobAllowance;
  const materials = materialsInput.amount === null ? null : fromMoney(materialsInput.amount) * BigInt(tvs.length);
  const allowance = allowanceInput.amount === null ? null : fromMoney(allowanceInput.amount);
  expense('tv_equipment_and_supplies', materials, true, materialsInput.notes, tvs.length);
  expense('additional_tv_job_allowance', allowance, false, allowanceInput.notes);
  return finalizeExactQuote(scenario, job, { revenue, revenueLines, expenseLines, flags, custom });
}

function projectExactMonth(scenario, input, rows) {
  const active = rows.filter(row => row.count > 0);
  const total = key => active.some(row => row.quote[key] === null) ? null : sum(active.map(row =>
    (row.quote.exactFinancials ? fromExact(row.quote.exactFinancials[key]) : fromMoney(row.quote[key])) * BigInt(row.count)));
  const revenue = total('customerRevenue'), direct = total('directExpenses'), commission = total('commission'), company = total('companyContribution');
  const overhead = input.overhead.amount === null ? null : fromMoney(input.overhead.amount);
  const after = company === null || overhead === null ? null : company - overhead;
  const positive = after === null ? null : after > 0n ? after : 0n;
  const reinvest = percentage(positive, scenario.assumptions.reinvestmentPercent);
  const rawPool = positive === null ? null : positive - reinvest;
  // Allocation is in actual cents only after the financial model is complete.
  const poolCents = positive === null ? null : usdCents(toMoney(positive), 'available cash') - usdCents(toMoney(reinvest), 'reinvestment');
  const below = belowMargin(company, revenue, scenario.assumptions.minimumCompanyMarginPercent);
  return {
    scenarioId: scenario.id, comparisonOnly: true, monthlyVolume: input.monthlyVolume, rows,
    calculationMode: 'full_precision_display_only',
    customerRevenue: toMoney(revenue), directExpenses: toMoney(direct), commissions: toMoney(commission),
    companyContributionBeforeOverhead: toMoney(company), companyContributionMarginPercent: margin(company, revenue), belowMinimumCompanyMargin: below,
    overhead: input.overhead, afterOverhead: toMoney(after), reinvestment: toMoney(reinvest),
    distributableToOwners: poolCents === null ? null : poolCents / 100,
    ownerDistributions: poolCents === null ? [null, null, null] : Array.from({ length: 3 }, (_, index) =>
      (Math.floor(poolCents / 3) + (index < poolCents % 3 ? 1 : 0)) / 100),
    exactFinancials: Object.fromEntries(Object.entries({
      customerRevenue: revenue, directExpenses: direct, commissions: commission,
      companyContributionBeforeOverhead: company, afterOverhead: after, reinvestment: reinvest, distributableToOwners: rawPool,
    }).map(([key, value]) => [key, exactString(value)])),
    flags: [...new Set([...active.flatMap(row => row.quote.flags), ...(overhead === null ? ['monthly_overhead_missing'] : []),
      ...(after !== null && after < 0n ? ['post_overhead_loss_no_distribution'] : []),
      ...(below ? ['monthly_company_contribution_margin_below_threshold'] : [])])],
  };
}

module.exports = { fromMoney, fromExact, toMoney, exactString, percentage, sum, margin, belowMargin, quoteTvModel, projectExactMonth, expenseLine, finalizeExactQuote };
