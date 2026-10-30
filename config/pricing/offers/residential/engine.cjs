const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Ajv = require('ajv');
const schema = require('./scenario.schema.json');
const { usdCents, safeCentResult, validateBaseline } = require('../../pricing.cjs');
const exact = require('./tv-financials.cjs');

const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, multipleOfPrecision: 8 });
const scenarioShape = ajv.compile(schema);
const definition = name => ajv.getSchema(`${schema.$id}#/definitions/${name}`);
const hash = value => createHash('sha256').update(value).digest('hex');
const dataHash = value => hash(JSON.stringify(value));
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sum = values => values.reduce((total, value) => safeCentResult(total + value), 0);
const money = value => value === null ? null : value / 100;
const scaled = (amount, quantity) => safeCentResult(amount * quantity);
const versionNumber = id => Number(id.split('-')[0].slice(1));
const marginPercent = (amount, revenue) => amount === null || !revenue ? null : Math.round(amount / revenue * 10000) / 100;
const belowMargin = (amount, revenue, rate) => amount === null || !revenue ? null
  : BigInt(amount) * 10000n < BigInt(revenue) * BigInt(usdCents(rate, 'margin threshold'));

function shape(validate, value, label) {
  if (!validate(value)) throw new Error(`${label}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
}

function percent(amount, rate) {
  return safeCentResult(Number((BigInt(amount) * BigInt(usdCents(rate, 'percentage')) + 5000n) / 10000n));
}

function validDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid calendar date: ${value}`);
}

function loadContext() {
  return {
    baseline: readJson(path.join(__dirname, '..', '..', 'home2smart.v1.json')),
    catalog: readJson(path.join(__dirname, '..', '..', 'equipment.v1.json')),
    cameraConfig: readJson(path.join(__dirname, '..', '..', 'residential-cameras.v1.json')),
    cameraAlgorithmSha256: hash(fs.readFileSync(path.join(__dirname, '..', '..', 'camera-recommendations.cjs'))),
  };
}

function sourceFingerprints(context) {
  return {
    baseline: dataHash(context.baseline), equipment: dataHash(context.catalog),
    cameraConfiguration: dataHash(context.cameraConfig), cameraAlgorithm: context.cameraAlgorithmSha256,
  };
}

function tvTier(scenario, baseline, tv) {
  const group = tv.customerSuppliedMount ? scenario.tv.customerMountTierGroup : scenario.tv.includedMountTierGroup;
  const tier = baseline.prices.tvMounting[group].find(row => tv.inches >= (row.minInches ?? 1) && tv.inches <= (row.maxInches ?? Infinity));
  if (!tier) throw new Error(`No referenced TV tier for ${tv.inches} inches.`);
  const override = !tv.customerSuppliedMount && scenario.tv.priceOverrides?.find(row => row.minInches === tier.minInches && row.maxInches === tier.maxInches);
  return { group, baselineTier: tier, tier: override ? { ...tier, price: override.price } : tier };
}

function validateScenario(scenario, context = loadContext()) {
  shape(scenarioShape, scenario, 'Offer scenario');
  validDate(scenario.createdDate);
  if (!Number.isSafeInteger(versionNumber(scenario.id))) throw new Error('Version number must be a safe integer.');
  if (scenario.parentVersion && versionNumber(scenario.parentVersion) >= versionNumber(scenario.id)) {
    throw new Error('A new experiment must use a later version number than its parent.');
  }
  validateBaseline(context.baseline);
  if (dataHash(context.baseline) !== scenario.references.baselineDataSha256) throw new Error('Referenced baseline changed; reconcile in a new offer version.');
  const warnings = ['offline_proposal_not_approved', 'camera_work_requires_reconciliation_before_commit_or_approval', 'verify_local_taxability'];
  const snapshots = new Set();
  for (const snapshot of scenario.equipmentCostSnapshots) {
    validDate(snapshot.checkedDate);
    usdCents(snapshot.amount, snapshot.equipmentId);
    if (snapshots.has(snapshot.equipmentId)) throw new Error(`Duplicate equipment cost snapshot: ${snapshot.equipmentId}`);
    snapshots.add(snapshot.equipmentId);
    const item = [...context.catalog.items, ...(context.catalog.cameraItems ?? [])].find(row => row.id === snapshot.equipmentId);
    if (!item || (item.productId ?? item.supplier.itemId) !== snapshot.productId) throw new Error(`Equipment reference mismatch: ${snapshot.equipmentId}`);
    if (snapshot.amount !== item.costAssumption.amount) warnings.push(`catalog_cost_changed_since_snapshot:${snapshot.equipmentId}`);
  }
  for (const id of [scenario.tv.includedMountEquipmentId, scenario.cameras.standardEquipmentId]) {
    if (!snapshots.has(id)) throw new Error(`Missing explicit equipment cost snapshot: ${id}`);
  }
  const mount = context.catalog.items.find(row => row.id === scenario.tv.includedMountEquipmentId);
  if (!mount || mount.type !== 'mount_fixed') throw new Error('The included-mount TV tier requires a fixed-mount reference.');
  const camera = context.catalog.cameraItems.find(row => row.id === scenario.cameras.standardEquipmentId);
  if (!camera || camera.productId !== 'T8134121' || camera.storage.strategy !== 'built_in') {
    throw new Error('Standard offers must reference the catalog S220 with built-in storage, not substitute a different model.');
  }
  const discounts = scenario.tv.discounts.percentsByPosition;
  const overriddenTiers = new Set();
  for (const override of scenario.tv.priceOverrides ?? []) {
    const tier = context.baseline.prices.tvMounting[scenario.tv.includedMountTierGroup]
      .find(row => row.minInches === override.minInches && row.maxInches === override.maxInches);
    const key = `${override.minInches}:${override.maxInches}`;
    if (!tier || tier.price === undefined || tier.quoteRequired || overriddenTiers.has(key)) {
      throw new Error('TV experiment overrides require unique exact fixed-price baseline tier references.');
    }
    overriddenTiers.add(key);
    usdCents(override.price, 'TV experiment override');
    if (override.status !== scenario.developmentStage) throw new Error('TV override status must match the scenario development stage.');
  }
  if (scenario.tv.costModel) {
    for (const key of ['equipmentAndSuppliesPerTv', 'additionalJobAllowance']) {
      const value = scenario.tv.costModel[key].amount;
      if (value !== null) usdCents(value, key);
    }
  }
  if (discounts[0] !== 0 || discounts.some((rate, index) => index > 0 && rate < discounts[index - 1])) {
    throw new Error('Marginal discounts must start at zero and be nondecreasing.');
  }
  const { minInches, maxInches } = scenario.tv.exampleTier;
  const example = context.baseline.prices.tvMounting[scenario.tv.includedMountTierGroup].find(row => row.minInches === minInches && row.maxInches === maxInches);
  if (!example || example.price === undefined) throw new Error('TV example must reference an exact fixed-price baseline tier.');
  const exampleCounts = new Set();
  for (const row of scenario.tv.examples) {
    if (exampleCounts.has(row.quantity) || row.quantity > discounts.length) throw new Error('Invalid/duplicate TV example quantity.');
    exampleCounts.add(row.quantity);
    const override = scenario.tv.priceOverrides?.find(tier => tier.minInches === minInches && tier.maxInches === maxInches);
    const base = usdCents(override?.price ?? example.price, 'TV example price');
    const expected = sum(discounts.slice(0, row.quantity).map(rate => base - percent(base, rate)));
    if (expected !== usdCents(row.revenue, 'TV example revenue')) throw new Error('TV examples do not match referenced tier and marginal discounts.');
  }
  const quantities = new Set();
  for (const pack of scenario.cameras.packages) {
    usdCents(pack.price, 'camera package price');
    if (!Number.isSafeInteger(pack.quantity) || quantities.has(pack.quantity)) throw new Error('Camera quantities must be safe and unique.');
    quantities.add(pack.quantity);
    const tier = context.baseline.prices.cameras[scenario.cameras.baselineTierGroup].find(row => row.quantity === pack.quantity);
    if (pack.baselineQuantityReference !== (tier ? pack.quantity : null)) throw new Error('Camera baseline quantity references cannot invent/interpolate missing tiers.');
  }
  for (const key of ['tvSuppliesPerTv', 'cameraSuppliesPerCamera', 'solarChargingPerCamera', 'travelPerVisit', 'shippingPerVisit']) {
    if (!Object.hasOwn(scenario.assumptions.allowances, key)) throw new Error(`Missing explicit allowance: ${key}`);
    const amount = scenario.assumptions.allowances[key].amount;
    if (amount !== null) usdCents(amount, key);
  }
  if (scenario.assumptions.overhead.monthlyAmount !== null) usdCents(scenario.assumptions.overhead.monthlyAmount, 'overhead');
  return warnings;
}

function loadScenario(id, directory = __dirname) {
  shape(definition('version'), id, 'Version ID');
  const file = path.join(directory, `${id}.json`);
  const bytes = fs.readFileSync(file);
  const seal = fs.readFileSync(path.join(directory, `${id}.sha256`), 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(seal) || hash(bytes) !== seal) throw new Error(`Immutable scenario seal mismatch: ${id}`);
  const scenario = JSON.parse(bytes.toString('utf8'));
  if (scenario.id !== id) throw new Error('Scenario ID and filename disagree.');
  return scenario;
}

function quoteOffer(scenario, job, context = loadContext()) {
  const flags = new Set(validateScenario(scenario, context));
  shape(definition('job'), job, 'Offer job');
  if (!job.tvs.length && !job.cameraPackageQuantity && !job.cameraConsultation) throw new Error('At least one TV or camera position is required.');
  if (!Number.isSafeInteger(job.cameraPackageQuantity)) throw new Error('Camera count must be safe.');
  const assumptions = scenario.assumptions;
  const allowances = { ...assumptions.allowances, ...job.costOverrides };
  for (const [id, cost] of Object.entries(allowances)) if (cost.amount !== null) usdCents(cost.amount, id);
  const tvs = job.tvs.map((tv, index) => ({ tv, index, ...tvTier(scenario, context.baseline, tv) }))
    .sort((a, b) => (b.tier.price ?? b.tier.priceFrom ?? 0) - (a.tier.price ?? a.tier.priceFrom ?? 0) || a.index - b.index);
  const model = scenario.tv.costModel;
  const modeledTvOnly = model && tvs.length > 0 && !job.cameraPackageQuantity && !job.cameraConsultation
    && tvs.every(({ tv, tier }) => !tv.customerSuppliedMount && tier.minInches === model.minInches && tier.maxInches === model.maxInches);
  if (modeledTvOnly) {
    if (['tvSuppliesPerTv', 'travelPerVisit', 'shippingPerVisit'].some(key => Object.hasOwn(job.costOverrides ?? {}, key))) {
      throw new Error('Scoped TV model replaces legacy supplies/travel/shipping; use explicit tvCostOverrides instead.');
    }
    for (const [id, cost] of Object.entries(job.tvCostOverrides ?? {})) if (cost.amount !== null) usdCents(cost.amount, id);
    return {
      scenarioId: scenario.id, comparisonOnly: true, activationAllowed: false, requiresReview: true,
      sourceFingerprints: sourceFingerprints(context), ...exact.quoteTvModel(scenario, job, tvs, flags),
      exclusions: ['owner_installation_labor', 'technician_payroll'],
      overheadTreatment: 'separate_monthly_projection_before_reinvestment_and_owner_distributions',
    };
  }
  if (job.tvCostOverrides) throw new Error('tvCostOverrides require a matching-tier Home2Smart-fixed-mount TV-only job.');
  const missingCosts = new Set(), expenseLines = [], revenueLines = [];
  let customQuote = false, recommendation = null;
  function expense(id, amount, taxable, quantity = 1, notes = '') {
    if (amount === null) missingCosts.add(id);
    const total = amount === null ? null : scaled(usdCents(amount, id), quantity);
    expenseLines.push({ id, quantity, unitAmount: amount, amount: money(total), taxable, notes });
  }
  function allowance(id, quantity, taxable) {
    const cost = allowances[id];
    expense(id, cost.amount, taxable, quantity, cost.notes);
  }
  function snapshotCost(id) {
    return scenario.equipmentCostSnapshots.find(row => row.equipmentId === id).amount;
  }
  for (const [position, { tv, index, group, tier }] of tvs.entries()) {
    const rate = scenario.tv.discounts.percentsByPosition[position];
    const unresolved = tier.quoteRequired || tier.price === undefined || rate === undefined;
    if (unresolved) customQuote = true;
    const base = tier.price === undefined ? null : usdCents(tier.price, 'TV tier');
    revenueLines.push({ id: `tv_${index + 1}`, baselineTierGroup: group, minInches: tier.minInches ?? 1, maxInches: tier.maxInches ?? null,
      basePrice: tier.price ?? null, discountPercent: rate ?? null,
      amount: unresolved ? null : money(base - percent(base, rate)) });
    if (tv.compatibilityVerified !== true) { customQuote = true; flags.add(`tv_compatibility_unverified:${index + 1}`); }
    if (!tv.customerSuppliedMount) {
      const mount = context.catalog.items.find(row => row.id === scenario.tv.includedMountEquipmentId);
      if (tv.inches < mount.tvCompatibility.minInches || tv.inches > mount.tvCompatibility.maxInches) {
        customQuote = true; flags.add(`included_mount_outside_size_range:${index + 1}`);
      }
      expense(`mount_${index + 1}`, snapshotCost(mount.id), true, 1, `Frozen cost snapshot; catalog reference ${mount.id}. No duplicated specifications.`);
    }
  }
  if (tvs.length) allowance('tvSuppliesPerTv', tvs.length, true);
  if (job.cameraConsultation) {
    const { recommendResidentialCameras } = require('../../camera-recommendations.cjs');
    const consultation = structuredClone(job.cameraConsultation);
    consultation.materialUnitCosts = { ...consultation.materialUnitCosts };
    for (const [materialId, allowanceId] of [['camera_consumables', 'cameraSuppliesPerCamera'], ['solar_initial_charging_materials', 'solarChargingPerCamera']]) {
      if (!Object.hasOwn(consultation.materialUnitCosts, materialId)) consultation.materialUnitCosts[materialId] = allowances[allowanceId];
    }
    recommendation = recommendResidentialCameras(context.cameraConfig, context.catalog, context.baseline, consultation);
    if (job.cameraPackageQuantity && recommendation.recommendedCameraCount !== job.cameraPackageQuantity) throw new Error('Consultation and requested camera quantities disagree.');
    const cameraQuote = recommendation.quote;
    const allStandard = recommendation.locations.every(row => row.equipmentId === scenario.cameras.standardEquipmentId);
    const pack = allStandard && scenario.cameras.packages.find(row => row.quantity === recommendation.recommendedCameraCount);
    revenueLines.push({ id: 'camera_recommendation', amount: pack ? pack.price : cameraQuote?.customerPrice.amount ?? null,
      priceBasis: pack ? 'offline_S220_experiment' : 'linked_camera_algorithm_proposed_price_not_approved' });
    if (!cameraQuote) expense('unresolved_camera_configuration', null, true);
    else {
      expense('linked_camera_equipment', cameraQuote.purchasing.observedEquipmentCost, true, 1, 'Current catalog purchasing optimizer; not a frozen offer snapshot.');
      for (const material of cameraQuote.requiredMaterials) expense(material.materialId, material.unitCost, true, material.quantity, material.notes);
      for (const flag of cameraQuote.reviewFlags) flags.add(`camera:${flag}`);
    }
    customQuote ||= recommendation.requiresCustomQuote || !allStandard;
    flags.add('linked_camera_output_requires_reconciliation');
  } else if (job.cameraPackageQuantity) {
    const pack = scenario.cameras.packages.find(row => row.quantity === job.cameraPackageQuantity);
    if (!pack) customQuote = true;
    revenueLines.push({ id: 'S220_package', amount: pack?.price ?? null, baselineQuantityReference: pack?.baselineQuantityReference ?? null });
    expense('S220_equipment', snapshotCost(scenario.cameras.standardEquipmentId), true, job.cameraPackageQuantity, 'Frozen equipment cost, not a site suitability recommendation.');
    allowance('cameraSuppliesPerCamera', job.cameraPackageQuantity, true);
    allowance('solarChargingPerCamera', job.cameraPackageQuantity, true);
    flags.add('S220_site_suitability_not_yet_surveyed');
  }
  allowance('travelPerVisit', 1, false);
  allowance('shippingPerVisit', 1, false);
  let revenue = revenueLines.some(row => row.amount === null) ? null : sum(revenueLines.map(row => usdCents(row.amount, row.id)));
  if (job.customPrice) {
    customQuote = true; flags.add('explicit_custom_price_not_approved');
    revenue = job.customPrice.amount === null ? null : usdCents(job.customPrice.amount, 'custom price');
  }
  if (revenue === null) flags.add('customer_price_required');
  const taxable = expenseLines.filter(row => row.taxable);
  const materialTax = taxable.some(row => row.amount === null) ? null : percent(sum(taxable.map(row => usdCents(row.amount, row.id))), assumptions.materialsTaxPercent);
  expense('estimated_materials_tax', money(materialTax), false);
  const fee = revenue === null ? null : percent(revenue, assumptions.processingPercent);
  const reserve = revenue === null ? null : percent(revenue, assumptions.serviceReservePercent);
  expense('payment_processing', money(fee), false);
  expense('service_reserve', money(reserve), false);
  const knownDirect = sum(expenseLines.filter(row => row.amount !== null).map(row => usdCents(row.amount, row.id)));
  const direct = missingCosts.size ? null : knownDirect;
  const before = direct === null || revenue === null ? null : safeCentResult(revenue - direct);
  const commissionPercent = job.commissionPercent ?? assumptions.commissionPercent;
  const commission = before === null ? null : percent(Math.max(0, before), commissionPercent);
  const company = commission === null ? null : safeCentResult(before - commission);
  const belowThreshold = belowMargin(company, revenue, assumptions.minimumCompanyMarginPercent);
  if (belowThreshold) flags.add('company_contribution_margin_below_threshold');
  if (missingCosts.size) flags.add('missing_costs');
  if (company !== null && company < 0) { flags.add('negative_company_contribution'); customQuote = true; }
  if (revenue === 0) flags.add('zero_revenue_margin_undefined');
  return {
    scenarioId: scenario.id, comparisonOnly: true, activationAllowed: false, requiresReview: true, requiresCustomQuote: customQuote,
    sourceFingerprints: sourceFingerprints(context),
    revenueLines, expenseLines, customerRevenue: money(revenue), knownDirectExpenses: money(knownDirect), directExpenses: money(direct),
    contributionBeforeCommission: money(before), commissionPercent, commission: money(commission), companyContribution: money(company),
    companyContributionMarginPercent: marginPercent(company, revenue),
    belowMinimumCompanyMargin: belowThreshold, minimumCompanyMarginPercent: assumptions.minimumCompanyMarginPercent,
    missingCosts: [...missingCosts], flags: [...flags], recommendation,
    exclusions: ['owner_installation_labor', 'technician_payroll'], overheadTreatment: 'separate_monthly_projection_before_reinvestment_and_owner_distributions',
  };
}

function projectMonth(scenario, input, context = loadContext()) {
  validateScenario(scenario, context);
  shape(definition('projection'), input, 'Monthly projection');
  if (!Number.isSafeInteger(input.monthlyVolume)) throw new Error('Monthly volume must be a safe integer.');
  if (new Set(input.salesMix.map(row => row.id)).size !== input.salesMix.length) throw new Error('Sales mix IDs must be unique.');
  const weights = input.salesMix.map(row => usdCents(row.percent, 'sales mix percent'));
  if (sum(weights) !== 10000) throw new Error('Sales mix percentages must sum to exactly 100.');
  const allocations = weights.map((weight, index) => {
    const raw = BigInt(input.monthlyVolume) * BigInt(weight);
    return { index, count: Number(raw / 10000n), remainder: Number(raw % 10000n) };
  });
  const remaining = input.monthlyVolume - sum(allocations.map(row => row.count));
  const ordered = [...allocations].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < remaining; index++) ordered[index].count++;
  const rows = input.salesMix.map((row, index) => ({ id: row.id, count: allocations[index].count, quote: quoteOffer(scenario, row.job, context) }));
  const active = rows.filter(row => row.count > 0);
  if (active.some(row => row.quote.exactFinancials)) return exact.projectExactMonth(scenario, input, rows);
  const total = key => active.some(row => row.quote[key] === null) ? null
    : sum(active.map(row => scaled(usdCents(row.quote[key], key, true), row.count)));
  const company = total('companyContribution');
  const revenue = total('customerRevenue');
  const belowThreshold = belowMargin(company, revenue, scenario.assumptions.minimumCompanyMarginPercent);
  const overhead = input.overhead.amount === null ? null : usdCents(input.overhead.amount, 'monthly overhead');
  const afterOverhead = company === null || overhead === null ? null : safeCentResult(company - overhead);
  const reinvestment = afterOverhead === null ? null : percent(Math.max(0, afterOverhead), scenario.assumptions.reinvestmentPercent);
  const distributable = afterOverhead === null ? null : Math.max(0, afterOverhead) - reinvestment;
  const owners = distributable === null ? [null, null, null] : Array.from({ length: 3 }, (_, index) =>
    money(Math.floor(distributable / 3) + (index < distributable % 3 ? 1 : 0)));
  return {
    scenarioId: scenario.id, comparisonOnly: true, monthlyVolume: input.monthlyVolume, rows,
    customerRevenue: money(revenue), directExpenses: money(total('directExpenses')),
    commissions: money(total('commission')), companyContributionBeforeOverhead: money(company),
    companyContributionMarginPercent: marginPercent(company, revenue), belowMinimumCompanyMargin: belowThreshold,
    overhead: input.overhead, afterOverhead: money(afterOverhead), reinvestment: money(reinvestment),
    distributableToOwners: money(distributable), ownerDistributions: owners,
    flags: [...new Set([...active.flatMap(row => row.quote.flags), ...(overhead === null ? ['monthly_overhead_missing'] : []),
      ...(afterOverhead !== null && afterOverhead < 0 ? ['post_overhead_loss_no_distribution'] : []),
      ...(belowThreshold ? ['monthly_company_contribution_margin_below_threshold'] : [])])],
  };
}

function compareVersions(scenarios, options = {}, context = loadContext()) {
  shape(definition('comparisonOptions'), options, 'Comparison options');
  if (!scenarios.length || new Set(scenarios.map(scenario => scenario.id)).size !== scenarios.length) {
    throw new Error('Comparison requires distinct scenario versions.');
  }
  const { tvCostModelFrom, tvCostOverrides, ...commonOptions } = options;
  const source = tvCostModelFrom && scenarios.find(scenario => scenario.id === tvCostModelFrom);
  if (tvCostModelFrom && !source?.tv.costModel) throw new Error('TV cost normalization requires a compared scenario with an explicit TV cost model.');
  const jobs = [
    ...[1, 2, 3].map(quantity => ({ id: `tv_${quantity}`, tvs: Array.from({ length: quantity }, () =>
      ({ inches: 60, customerSuppliedMount: false, compatibilityVerified: null })), cameraPackageQuantity: 0 })),
    ...[2, 3, 4].map(quantity => ({ id: `S220_${quantity}`, tvs: [], cameraPackageQuantity: quantity })),
  ];
  return scenarios.map(scenario => ({
    scenarioId: scenario.id,
    offers: jobs.map(({ id, ...job }) => {
      const normalized = source && job.tvs.length ? { ...scenario, tv: { ...scenario.tv, costModel: source.tv.costModel } } : scenario;
      const result = quoteOffer(normalized, {
        ...job, ...commonOptions, ...(job.tvs.length && tvCostOverrides ? { tvCostOverrides } : {}),
      }, context);
      return { id, ...result, ...(source && job.tvs.length ? { comparisonCostBasis: `normalized_tv_cost_model_from:${source.id}; historical_scenario_unchanged` } : {}) };
    }),
  }));
}

function writeSealed(file, data) {
  const sealFile = file.replace(/\.json$/, '.sha256');
  if (fs.existsSync(file) || fs.existsSync(sealFile)) throw new Error('Historical records cannot be overwritten; choose a new version/review ID.');
  const bytes = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(file, bytes, { flag: 'wx' });
  fs.writeFileSync(sealFile, `${hash(bytes)}\n`, { flag: 'wx' });
}

function createVersion(parentId, patch, directory = __dirname, context = loadContext()) {
  const parent = loadScenario(parentId, directory);
  validateScenario(parent, context);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Experiment patch must be a JSON object.');
  function merge(base, changes) {
    const result = structuredClone(base);
    for (const [key, value] of Object.entries(changes)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Invalid patch key.');
      result[key] = value && typeof value === 'object' && !Array.isArray(value) && base?.[key] && typeof base[key] === 'object'
        ? merge(base[key], value) : structuredClone(value);
    }
    return result;
  }
  const next = merge(parent, patch);
  if (next.id === parentId || next.parentVersion !== parentId || versionNumber(next.id) <= versionNumber(parentId)) {
    throw new Error('New experiment requires a new increasing ID and an explicit parentVersion.');
  }
  validateScenario(next, context);
  if (next.createdDate < parent.createdDate) throw new Error('A new version cannot predate its parent.');
  if (fs.readdirSync(directory).some(file => file.endsWith('.json') && file.startsWith(`${next.id.split('-')[0]}-`))) {
    throw new Error('Historical version numbers cannot be overwritten or reused; choose a new version.');
  }
  writeSealed(path.join(directory, `${next.id}.json`), next);
  return next;
}

function validateReview(review, directory = __dirname, context = loadContext()) {
  shape(definition('review'), review, 'Offer review');
  validDate(review.reviewedDate);
  const scenario = loadScenario(review.scenarioId, directory);
  validateScenario(scenario, context);
  const expected = hash(fs.readFileSync(path.join(directory, `${review.scenarioId}.json`)));
  if (review.reviewedDate < scenario.createdDate) throw new Error('A review cannot predate its scenario.');
  if (review.scenarioSha256 !== expected) throw new Error('Review must bind to the exact sealed scenario bytes.');
  if (review.decision === 'approved_for_offline_planning' && !review.cameraWorkReconciled) throw new Error('Camera work must be reconciled before approval.');
  return { currentSourcesMatch: Object.entries(sourceFingerprints(context)).every(([key, value]) => review.sourceFingerprints[key] === value) };
}

function recordReview(review, directory = __dirname, context = loadContext()) {
  if (!validateReview(review, directory, context).currentSourcesMatch) {
    throw new Error('Review source fingerprints are stale; reconcile the current catalog and camera work before review.');
  }
  const reviews = path.join(directory, 'reviews');
  fs.mkdirSync(reviews, { recursive: true });
  writeSealed(path.join(reviews, `${review.scenarioId}-${review.id}.json`), review);
}

module.exports = { loadContext, loadScenario, validateScenario, quoteOffer, projectMonth, compareVersions, createVersion, recordReview, validateReview, sourceFingerprints, hash, dataHash };
