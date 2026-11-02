const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Ajv = require('ajv');
const schema = require('./schema.v1.json');
const { validateBaseline, validateEquipmentCatalog, usdCents } = require('../pricing.cjs');
const { validateRecommendationConfiguration, recommendResidentialCameras } = require('../camera-recommendations.cjs');
const exact = require('../offers/residential/tv-financials.cjs');

const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, multipleOfPrecision: 8 });
const recommendationSchema = require('../recommendations.schema.json');
ajv.addSchema(recommendationSchema);
const canonicalShape = ajv.compile(schema);
const shapeFor = name => ajv.getSchema(`${schema.$id}#/definitions/${name}`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const root = path.resolve(__dirname, '..');
const tvSizeGroups = ['residentialInstallationOnly', 'residentialWithStandardFixedMount', 'commercialInstallationOnly'];
const money = amount => amount === null ? null : exact.fromMoney(amount);
const amount = row => row.price ?? row.priceFrom ?? null;

function checkShape(validate, value, label) {
  if (!validate(value)) throw new Error(`${label}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
}

function checkDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`Invalid verification date: ${value}`);
}

function loadContext() {
  const canonical = readJson(path.join(root, 'home2smart.v2.json'));
  return {
    canonical,
    baseline: readJson(path.join(root, canonical.references.baseline)),
    catalog: readJson(path.join(root, canonical.references.equipment)),
    cameraConfig: readJson(path.join(root, canonical.references.cameraConfiguration)),
    launchOffer: readJson(path.join(root, canonical.references.launchOffer)),
    pdf: readJson(path.join(root, canonical.references.pdf)),
    published: readJson(path.join(root, canonical.references.published)),
    verification: readJson(path.join(root, canonical.references.verification)),
  };
}

function validate(context = loadContext()) {
  const { canonical, baseline, catalog, cameraConfig, pdf, verification, published } = context;
  checkShape(canonicalShape, canonical, 'Reconciled pricing schema');
  checkDate(canonical.checkedDate);
  validateBaseline(baseline);
  validateEquipmentCatalog(catalog, baseline);
  validateRecommendationConfiguration(cameraConfig, catalog, baseline);
  if (hash(JSON.stringify(baseline)) !== canonical.references.baselineDataSha256) throw new Error('Historical 40-tier baseline changed.');
  if (hash(fs.readFileSync(path.join(__dirname, 'source', pdf.source))) !== pdf.sha256) throw new Error('Archived PDF checksum mismatch.');
  checkDate(pdf.retrievedDate); checkDate(verification.checkedDate); checkDate(published.checkedDate);
  if (verification.status !== 'proposed_pending_approval' || verification.catalogReference !== '../equipment.v1.json') {
    throw new Error('Verification supplement must remain pending and linked to the original catalog.');
  }
  const originals = new Map([...catalog.items, ...catalog.cameraItems, ...catalog.purchasingOptions].map(row => [row.id, row]));
  const linked = new Map(verification.linkedEquipment.map(row => [row.id, row]));
  if (linked.size !== verification.linkedEquipment.length || [...linked.keys()].some(id => originals.has(id))) {
    throw new Error('Linked equipment IDs must be unique and must not overwrite original products.');
  }
  const observations = new Set();
  for (const item of verification.observations) {
    const record = originals.get(item.equipmentId) ?? linked.get(item.equipmentId);
    if (!record || observations.has(item.equipmentId)) throw new Error(`Unknown/duplicate equipment observation: ${item.equipmentId}`);
    observations.add(item.equipmentId);
    if (item.productId !== null && item.productId !== (record.productId ?? record.supplier?.itemId)) {
      throw new Error(`Equipment model mismatch: ${item.equipmentId}`);
    }
    if (item.productId === null && item.equipmentId !== 'e40_s380_kit_reference') throw new Error(`Missing exact model: ${item.equipmentId}`);
    const supplierUrl = record.supplier?.url ?? record.sourceUrl;
    if (item.productId !== null && item.sourceUrl !== supplierUrl) throw new Error(`Supplier URL mismatch: ${item.equipmentId}`);
    for (const key of ['planningCost', 'observedPrice', 'modeledCost']) if (item[key] !== null) usdCents(item[key], `${item.equipmentId}.${key}`);
    if (item.modeledCost !== Math.max(item.planningCost ?? 0, item.observedPrice)) throw new Error(`Conservative cost basis mismatch: ${item.equipmentId}`);
    if (!item.verification || !item.notes || !['https://www.eufy.com/', 'https://www.walmart.com/'].some(prefix => item.sourceUrl.startsWith(prefix))) {
      throw new Error(`Missing verification evidence: ${item.equipmentId}`);
    }
  }
  for (const id of originals.keys()) if (!observations.has(id)) throw new Error(`Missing supplier observation: ${id}`);
  for (const item of linked.values()) if (item.status !== 'proposed_pending_approval') throw new Error(`Linked model must remain pending: ${item.id}`);
  for (const [service, groups] of Object.entries(canonical.prices)) {
    for (const [group, tiers] of Object.entries(groups)) {
      let previous = 0;
      for (const [index, tier] of tiers.entries()) {
        if (tvSizeGroups.includes(group)) {
          if ((tier.minInches ?? 1) !== previous + 1 || (index === tiers.length - 1) !== (tier.maxInches === undefined)) {
            throw new Error(`Noncontiguous TV size bands: ${group}`);
          }
          if (tier.maxInches !== undefined && tier.maxInches < (tier.minInches ?? 1)) throw new Error(`Reversed TV size band: ${group}`);
          if (index === tiers.length - 1 && tier.quoteRequired !== true) throw new Error(`Large TVs require a quote: ${group}`);
          previous = tier.maxInches;
        } else {
          if (tier.quantity <= previous) throw new Error(`Duplicate/unsorted quantities: ${group}`);
          previous = tier.quantity;
        }
        if (tier.equipmentId && !observations.has(tier.equipmentId)) throw new Error(`Missing verified equipment reference: ${tier.equipmentId}`);
        if (group.includes('EquipmentIncluded') && tier.quantity !== 16 && !tier.equipmentId && !(group === 'commercialWiredEquipmentIncluded' && tier.quantity === 8)) {
          throw new Error(`Equipment-inclusive price requires an explicit model: ${group}`);
        }
        if (tier.equipmentId && !['eufy_solocam_s220', 'eufycam_e40', 'eufy_nvr_e50_4_kit'].includes(tier.equipmentId)) {
          throw new Error(`Nonstandard models require custom quotes, not a silent package substitution: ${group}`);
        }
        if (service === 'cameras') {
          const expectedEquipment = ['residentialEquipmentIncluded', 'commercialWirelessEquipmentIncluded'].includes(group) ? 'eufy_solocam_s220'
            : group === 'residentialE40EquipmentIncluded' ? 'eufycam_e40'
            : group.includes('WiredEquipmentIncluded') && tier.quantity === 4 ? 'eufy_nvr_e50_4_kit' : null;
          if ((tier.equipmentId ?? null) !== expectedEquipment) throw new Error(`Camera package equipment/scope mismatch: ${group}`);
        }
        if (service === 'cameras' && group.includes('Wired') && tier.quoteRequired !== true) throw new Error(`Unsurveyed PoE work must remain quote-required: ${group}`);
        if (['pdf', 'json', 'unchanged'].includes(tier.selection)) {
          const historical = baseline.prices[service][group]?.find(row => tvSizeGroups.includes(group)
            ? (row.maxInches ?? null) === (tier.maxInches ?? null) : row.quantity === tier.quantity);
          const expected = tier.selection === 'pdf' ? pdfRow(context, group, tier)?.[1] : historical ? amount(historical) : undefined;
          if (expected === undefined || expected !== amount(tier)) throw new Error(`Selected source price mismatch: ${group}`);
        }
        if (tier.selection === 'v5') {
          const source = context.launchOffer.tv.priceOverrides.find(row => row.minInches === tier.minInches && row.maxInches === tier.maxInches);
          if (group !== 'residentialWithStandardFixedMount' || source?.price !== amount(tier)) throw new Error(`Launch source price mismatch: ${group}`);
        }
        if (tier.selection === 'recommendation') {
          const source = cameraConfig.recommendationPolicy.priceRules.find(row => row.quantity === tier.quantity);
          if (group !== 'residentialEquipmentIncluded' || source?.draftPrice !== amount(tier)) throw new Error(`Recommendation source price mismatch: ${group}`);
        }
      }
    }
  }
  let pdfRows = 0;
  for (const [group, data] of Object.entries(pdf.groups)) {
    const service = tvSizeGroups.includes(group) || group.startsWith('commercialBundles') ? 'tvMounting' : 'cameras';
    for (const row of data.rows) {
      pdfRows++;
      if (row.length !== 8) throw new Error(`Invalid PDF transcription row: ${group}`);
      for (const value of row.slice(1)) if (value !== null) usdCents(value, `PDF ${group}`);
      const tiers = canonical.prices[service][group];
      if (!tiers?.some(tier => tvSizeGroups.includes(group) ? (tier.maxInches ?? null) === row[0] : tier.quantity === row[0])) {
        throw new Error(`PDF service/variation omitted: ${group} ${row[0]}`);
      }
      if (row[1] !== null && row[2] !== null) {
        if (Math.abs(Math.round((row[1] * 0.029 + 0.30) * 100) / 100 - row[4]) > 0.011
          || Math.abs((row[1] - row[2] - row[3] - row[4]) * 0.45 - row[6]) > 0.011) throw new Error(`PDF financial transcription mismatch: ${group}`);
      }
    }
  }
  if (pdfRows !== 66) throw new Error('All 66 PDF rows must be preserved.');
  const ids = new Set();
  for (const addon of canonical.addOns) {
    if (ids.has(addon.id)) throw new Error(`Duplicate add-on: ${addon.id}`);
    ids.add(addon.id);
    for (const id of [addon.equipmentId, addon.replacesEquipmentId]) if (id !== null && !observations.has(id)) throw new Error(`Unknown add-on equipment: ${id}`);
  }
  return context;
}

function observation(context, id) {
  const item = context.verification.observations.find(row => row.equipmentId === id);
  if (!item || item.productId === null) throw new Error(`Exact procurement model is not verified: ${id}`);
  return item;
}

function pdfRow(context, group, tier) {
  return context.pdf.groups[group]?.rows.find(row => tvSizeGroups.includes(group) ? row[0] === (tier.maxInches ?? null) : row[0] === tier.quantity);
}

function line(id, unitCost, quantity, taxable, basis, equipmentId = null) {
  return { id, unitCost, quantity, taxable, basis, equipmentId };
}

function priceFloor(context, baseCash, technician, commissionPercent, technicianOrderPercent = null) {
  if (baseCash === null || technician === null) return null;
  const a = context.canonical.assumptions;
  const test = cents => {
    const revenue = BigInt(cents) * exact.fromMoney(0.01);
    const before = revenue - exact.percentage(revenue, a.processingPercent) - exact.percentage(revenue, a.serviceReservePercent) - baseCash;
    const payroll = technicianOrderPercent === null ? technician : exact.percentage(revenue, technicianOrderPercent);
    const company = before - exact.percentage(before > 0n ? before : 0n, commissionPercent) - payroll;
    return company >= exact.fromMoney(a.minimumCompanyContribution) && !exact.belowMargin(company, revenue, a.minimumCompanyMarginPercent);
  };
  // Search whole cents while checking thresholds against unrounded financial amounts.
  const limit = 1000000000000;
  let high = 1;
  while (!test(high)) {
    high *= 2;
    if (high > limit) return null;
  }
  let low = 0;
  while (high - low > 1) {
    const middle = Math.floor((high + low) / 2);
    if (test(middle)) high = middle; else low = middle;
  }
  return high / 100;
}

function calculate(context, price, priceKind, lines, options = {}, flags = []) {
  checkShape(shapeFor('options'), options, 'Quote options');
  if (typeof price === 'bigint' ? price < 0n : price !== null && usdCents(price, 'Revenue') < 0) throw new Error('Revenue must be nonnegative.');
  const materialIds = new Set(lines.map(row => row.id));
  if (materialIds.size !== lines.length) throw new Error('Duplicate expense IDs are not allowed.');
  for (const row of lines) {
    if (!Number.isSafeInteger(row.quantity) || row.quantity < 1) throw new Error(`Invalid material quantity: ${row.id}`);
    if (row.unitCost !== null) usdCents(row.unitCost, row.id);
    if (typeof row.taxable !== 'boolean' || typeof row.basis !== 'string' || !row.basis.length) throw new Error(`Cost classification/evidence missing: ${row.id}`);
  }
  for (const id of Object.keys(options.materialCosts ?? {})) if (!materialIds.has(id)) throw new Error(`Unknown cost override: ${id}`);
  const inputs = lines.map(row => {
    const override = options.materialCosts?.[row.id];
    let value = money(override ? override.amount : row.unitCost);
    if (value !== null) value *= BigInt(row.quantity);
    if (row.equipmentId && value !== null && options.equipmentIncreasePercent !== undefined) value += exact.percentage(value, options.equipmentIncreasePercent);
    return { ...exact.expenseLine(row.id, value, row.taxable, override?.notes ?? row.basis, row.quantity), equipmentId: row.equipmentId };
  });
  if (options.extraMaterials) inputs.push(exact.expenseLine('additional_materials', money(options.extraMaterials.amount), true, options.extraMaterials.notes));
  const revenue = options.sellingPrice ? money(options.sellingPrice.amount) : typeof price === 'bigint' ? price : money(price);
  const technician = options.technicianOrderScenario ? exact.percentage(revenue, options.technicianOrderScenario.percent)
    : options.technicianCash ? money(options.technicianCash.amount) : 0n;
  const assumptions = { ...context.canonical.assumptions,
    ...(options.materialsTax ? { materialsTaxPercent: options.materialsTax.percent } : {}) };
  const result = exact.finalizeExactQuote({ assumptions }, options, {
    revenue, revenueLines: [{ id: 'proposed_service', amount: exact.toMoney(revenue), exactAmount: exact.exactString(revenue) }],
    expenseLines: inputs, flags: ['offline_pending_approval', 'estimated_bom_and_trip_require_verification', ...flags],
    custom: priceKind !== 'fixed' || options.eligibilityVerified !== true,
  });
  const reserve = revenue === null ? null : exact.percentage(revenue, context.canonical.assumptions.serviceReservePercent);
  const direct = result.exactFinancials.directExpenses === null ? null : exact.fromExact(result.exactFinancials.directExpenses);
  const cash = direct === null || reserve === null ? null : direct - reserve;
  const gross = cash === null || revenue === null ? null : revenue - cash;
  const company = result.exactFinancials.companyContribution === null ? null : exact.fromExact(result.exactFinancials.companyContribution);
  const afterTechnician = company === null || technician === null ? null : company - technician;
  const base = cash === null || revenue === null ? null : cash - exact.percentage(revenue, context.canonical.assumptions.processingPercent);
  const belowMargin = exact.belowMargin(afterTechnician, revenue, context.canonical.assumptions.minimumCompanyMarginPercent);
  const belowDollars = afterTechnician === null ? null : afterTechnician < exact.fromMoney(context.canonical.assumptions.minimumCompanyContribution);
  const passes = belowMargin === true || belowDollars === true ? false
    : belowMargin === null || belowDollars === null ? null : true;
  const missingCosts = [...result.missingCosts, ...(technician === null ? ['technician_cash'] : [])];
  const minimumPrice = priceFloor(context, base, technician, result.commissionPercent, options.technicianOrderScenario?.percent ?? null);
  return {
    ...result,
    proposedPrice: { amount: exact.toMoney(revenue), kind: options.sellingPrice ? 'custom_quote' : priceKind },
    activationAllowed: false, bookable: false, requiresManualReview: true,
    requiresCustomQuote: result.requiresCustomQuote || passes !== true || missingCosts.length > 0,
    costStatus: missingCosts.length ? 'incomplete_estimate' : 'modeled_estimate_only',
    actualProfit: null, missingCosts,
    materialsTaxPercent: assumptions.materialsTaxPercent,
    materialsTaxEvidence: options.materialsTax?.notes ?? '8% planning assumption;confirm jurisdiction and taxability.',
    totalDirectCashExpenses: exact.toMoney(cash === null || technician === null ? null : cash + technician),
    cashExpensesBeforeTechnician: exact.toMoney(cash),
    grossContribution: exact.toMoney(gross), grossMarginPercent: exact.margin(gross, revenue),
    grossAfterTechnician: exact.toMoney(gross === null || technician === null ? null : gross - technician),
    serviceReserve: exact.toMoney(reserve), contributionAfterReserve: result.contributionBeforeCommission,
    modeledCompanyRetained: result.companyContribution,
    technicianCash: exact.toMoney(technician), companyRetainedAfterTechnician: exact.toMoney(afterTechnician),
    companyMarginAfterTechnicianPercent: exact.margin(afterTechnician, revenue),
    belowMinimumCompanyMargin: belowMargin, belowMinimumCompanyContribution: belowDollars,
    passesContributionFloors: passes, minimumPriceForFloors: minimumPrice,
    flags: [...new Set([...result.flags, ...(passes === false ? ['retained_contribution_floor_failed'] : []),
      ...(minimumPrice === null && base !== null && technician !== null ? ['no_price_can_satisfy_current_margin_policy'] : []),
      ...(options.sellingPrice ? ['custom_price_not_approved'] : []),
      ...(options.technicianCash || options.technicianOrderScenario ? ['technician_paid_separately_after_rep_commission'] : ['owner_performed_planning_case_no_owner_labor_deduction'])])],
    exactReconciliation: {
      cashExpensesBeforeTechnician: exact.exactString(cash), grossContribution: exact.exactString(gross),
      companyRetainedAfterTechnician: exact.exactString(afterTechnician), serviceReserve: exact.exactString(reserve),
    },
  };
}

function findTier(context, service, group, selector) {
  checkShape(shapeFor('selector'), selector, 'Service selector');
  const tiers = context.canonical.prices[service]?.[group];
  if (!tiers) throw new Error(`Unknown service price group: ${service}.${group}`);
  if (tvSizeGroups.includes(group)) {
    if (selector.inches === undefined || selector.quantity !== undefined) throw new Error('Size-based TV tiers require inches only.');
    return tiers.find(row => selector.inches >= (row.minInches ?? 1) && selector.inches <= (row.maxInches ?? Infinity));
  }
  if (selector.quantity === undefined || selector.inches !== undefined) throw new Error('Quantity price groups require quantity only.');
  return tiers.find(row => row.quantity === selector.quantity);
}

function costLines(context, service, group, tier, options) {
  const policy = context.canonical.costPolicy, source = pdfRow(context, group, tier), lines = [], flags = [];
  const quantity = tier.quantity ?? 1;
  const suppliedMount = group === 'residentialWithStandardFixedMount';
  const poe = group.includes('Wired');
  const e40 = tier.equipmentId === 'eufycam_e40';
  if (service === 'tvMounting') {
    if (suppliedMount) {
      const upgrade = options.mountUpgradeId ? context.canonical.addOns.find(row => row.id === options.mountUpgradeId) : null;
      for (const [id, count] of [[upgrade?.equipmentId ?? policy.tvMountEquipmentId, quantity], [policy.tvRacewayEquipmentId, quantity * policy.tvRacewayKitsPerSuppliedMountTv]]) {
        const item = observation(context, id);
        lines.push(line(id, item.modeledCost, count, true, item.notes, id));
      }
      flags.push('new_external_raceway_inclusion_not_in_pdf', 'pdf_unspecified_bracket_replaced_explicitly_with_onn_777842123');
      if (upgrade) flags.push(`proposed_mount_upgrade:${upgrade.id}`);
    }
    lines.push(line('tv_supplies', source?.[3] ?? null, 1, true, 'PDF size/quantity aggregate budget; exact bolt/lag/washer/spacer/anchor quantities unverified.'));
    const trip = options.travelAllowance ?? { amount: policy.tvJobAllowance, notes: 'Proposed core-zone TV trip/shipping budget; not three-hour-radius travel coverage.' };
    lines.push(line('travel_shipping', trip.amount, 1, false, trip.notes));
  } else {
    if (tier.equipmentId === 'eufy_solocam_s220') {
      lines.push(line(tier.equipmentId, observation(context, tier.equipmentId).modeledCost, quantity, true, 'Exact S220;8GB storage included,no standalone microSD.', tier.equipmentId));
    } else if (e40) {
      const kits = Math.floor(quantity / 2), singles = quantity % 2;
      lines.push(line('e40_homebase2_kit', observation(context, 'e40_homebase2_kit').modeledCost, kits, true, 'Exact two-camera HB2 kits;not S380.', 'e40_homebase2_kit'));
      if (singles) lines.push(line('e40_single', observation(context, 'eufycam_e40').modeledCost, singles, true, 'Exact E40 add-on using included compatible HB2.', 'eufycam_e40'));
      lines.push(line('homebase_installation_materials', null, 1, true, 'Verify hub adapter/Ethernet/cable reach and price missing hardware;unknown is not zero.'));
      if (kits > 1) flags.push('surplus_included_homebase_requires_review');
    } else if (tier.equipmentId === 'eufy_nvr_e50_4_kit') {
      lines.push(line(tier.equipmentId, observation(context, tier.equipmentId).modeledCost, 1, true, 'EXPLICIT model change:verified E50 is1199.99,not PDF unnamed800-dollar PoE kit.', tier.equipmentId));
      flags.push('premium_e50_model_change_not_like_for_like_with_unnamed_pdf_poe_kit');
    } else if (group.includes('EquipmentIncluded')) {
      lines.push(line('unmapped_equipment', null, 1, true, 'Exact cameras/NVR/switches/storage and compatible purchase quantities unknown.'));
    }
    const supplies = e40 || tier.equipmentId === 'eufy_solocam_s220' ? policy.cameraSuppliesPerCamera * quantity : source?.[3] ?? null;
    lines.push(line('camera_materials', supplies, 1, true, poe
      ? 'PDF cable/connector/contingency aggregate;exact Cat6 feet,ends,glands,clips and supplied kit cable contents unknown.'
      : 'Aggregate supplementary fastener/weatherproofing/charging BUDGET;exact SKU quantities and actual required materials must be surveyed. Not a verified expense.'));
    const trip = options.travelAllowance ?? { amount: poe ? policy.poeTravelShippingAllowance : policy.cameraTravelShippingAllowances[quantity],
      notes: 'Separate proposed travel/shipping budget,not v5 combined supplies-inclusive incidentals.' };
    lines.push(line('travel_shipping', trip.amount ?? null, 1, false, trip.notes));
    if (poe) flags.push('poe_run_lengths_and_recorder_compatibility_require_survey');
    if (tier.equipmentId === 'eufy_solocam_s220') flags.push('s220_sunlight_2_4ghz_fixed_view_and_charging_review');
  }
  return { lines, flags };
}

function quoteTier(context, service, group, selector, options = {}) {
  validate(context);
  checkShape(shapeFor('options'), options, 'Quote options');
  const tier = findTier(context, service, group, selector);
  if (options.mountUpgradeId && group !== 'residentialWithStandardFixedMount') throw new Error('Supplied-mount upgrades cannot be charged to customer-bracket/camera/commercial tiers.');
  if (!tier) return calculate(context, null, 'custom_quote', [line('unsupported_scope', null, 1, true, 'No exact quantity tier;do not interpolate or pad camera count.')], options, ['unsupported_quantity_custom_quote']);
  const { lines, flags } = costLines(context, service, group, tier, options);
  const priceKind = tier.price !== undefined ? 'fixed' : tier.priceFrom !== undefined ? 'starting' : 'custom_quote';
  let price = amount(tier);
  if (options.mountUpgradeId) {
    const upgrade = context.canonical.addOns.find(row => row.id === options.mountUpgradeId);
    const compatibility = context.catalog.items.find(row => row.id === upgrade.equipmentId).tvCompatibility;
    if (upgrade.price === undefined || price === null || selector.inches < compatibility.minInches || selector.inches > compatibility.maxInches) {
      price = null; flags.push('mount_upgrade_size_or_price_requires_custom_quote');
    } else price += upgrade.price;
  }
  if (group === 'residentialWithStandardFixedMount' && selector.inches < observationMount(context).minInches) {
    price = null; flags.push('no_fixed_mount_sku_for_under_32_inches');
  }
  if (group === 'commercialBundlesInstallationOnlyUpTo65Inches'
    && (options.sameLocation !== true || options.tvSizes?.length !== tier.quantity || options.tvSizes.some(size => size > 65))) {
    price = null; flags.push('commercial_bundle_same_site_each_tv_up_to_65_required');
  }
  return { service, group, tier: { ...tier }, ...calculate(context, price, price === null ? 'custom_quote' : priceKind, lines, options, flags) };
}

function observationMount(context) {
  return context.catalog.items.find(row => row.id === context.canonical.costPolicy.tvMountEquipmentId).tvCompatibility;
}

function quoteTvs(context, tvs, options = {}) {
  validate(context);
  checkShape(shapeFor('tvs'), tvs, 'Residential TVs');
  checkShape(shapeFor('options'), options, 'Quote options');
  if (options.materialCosts) throw new Error('Multi-TV costs are uniquely itemized;use the itemized tier API for material overrides.');
  if (options.mountUpgradeId) throw new Error('Use each TV mountUpgradeId for mixed/multi-TV quotes.');
  const rows = tvs.map((tv, index) => {
    const group = tv.customerSuppliedMount ? 'residentialInstallationOnly' : 'residentialWithStandardFixedMount';
    return { tv, index, group, tier: findTier(context, 'tvMounting', group, { inches: tv.inches }) };
  }).sort((a, b) => (amount(b.tier) ?? 0) - (amount(a.tier) ?? 0) || a.index - b.index);
  const lines = [], flags = [], revenueLines = [];
  let revenue = 0n, complete = tvs.length <= 3, compatible = true;
  for (const [position, row] of rows.entries()) {
    const rate = context.canonical.residentialTvDiscounts.percentsByPosition[position];
    const value = amount(row.tier);
    const outsideSku = !row.tv.customerSuppliedMount && row.tv.inches < observationMount(context).minInches;
    if (row.tv.customerSuppliedMount && row.tv.mountUpgradeId) throw new Error('Do not charge an H2S mount upgrade to a customer-supplied bracket.');
    const upgrade = row.tv.mountUpgradeId ? context.canonical.addOns.find(item => item.id === row.tv.mountUpgradeId) : null;
    const upgradeCompatibility = upgrade ? context.catalog.items.find(item => item.id === upgrade.equipmentId).tvCompatibility : null;
    if (upgrade && (upgrade.price === undefined || row.tv.inches < upgradeCompatibility.minInches || row.tv.inches > upgradeCompatibility.maxInches)) {
      complete = false; flags.push('mount_upgrade_size_or_price_requires_custom_quote');
    }
    if (rate === undefined || row.tier.quoteRequired || value === null || outsideSku) complete = false;
    if (outsideSku) flags.push('no_fixed_mount_sku_for_under_32_inches');
    const discounted = rate === undefined || value === null ? null : exact.fromMoney(value) - exact.percentage(exact.fromMoney(value), rate) + exact.fromMoney(upgrade?.price ?? 0);
    if (discounted !== null) revenue += discounted;
    compatible &&= row.tv.compatibilityVerified === true;
    revenueLines.push({ id: `tv_${row.index + 1}`, inches: row.tv.inches, group: row.group, basePrice: value, discountPercent: rate ?? null, mountUpgradeId: upgrade?.id ?? null, mountUpgradePrice: upgrade?.price ?? null, amount: exact.toMoney(discounted), exactAmount: exact.exactString(discounted) });
    const costs = costLines(context, 'tvMounting', row.group, row.tier, { ...options, ...(upgrade ? { mountUpgradeId: upgrade.id } : {}) });
    for (const cost of costs.lines.filter(item => item.id !== 'travel_shipping')) lines.push({ ...cost, id: `${cost.id}_${row.index + 1}` });
    flags.push(...costs.flags);
  }
  const trip = options.travelAllowance ?? { amount: context.canonical.costPolicy.tvJobAllowance, notes: 'Once per TV job,not per TV.' };
  lines.push(line('travel_shipping', trip.amount, 1, false, trip.notes));
  if (!complete) flags.push('unsupported_tv_scope_custom_quote');
  const result = calculate(context, complete ? revenue : null, complete ? 'fixed' : 'custom_quote', lines, { ...options, eligibilityVerified: compatible && options.eligibilityVerified === true }, flags);
  return { ...result, revenueLines };
}

function recommendQuote(context, input, options = {}) {
  validate(context);
  checkShape(shapeFor('options'), options, 'Quote options');
  if (options.mountUpgradeId || options.tvSizes || options.sameLocation !== undefined) throw new Error('TV-only inputs cannot alter camera recommendations.');
  checkShape(ajv.getSchema(`${recommendationSchema.$id}#/definitions/consultation`), input, 'Homeowner consultation');
  if (input.budget !== null) usdCents(input.budget, 'Customer budget');
  const catalog = structuredClone(context.catalog);
  for (const camera of catalog.cameraItems) camera.supplier.observedPrice = observation(context, camera.id).modeledCost;
  for (const camera of catalog.cameraItems) camera.supplier.priceCheckDate = context.verification.checkedDate;
  for (const option of catalog.purchasingOptions) {
    if (!option.eligibleForOptimization) continue;
    const record = context.verification.observations.find(row => row.equipmentId === option.id);
    if (record) { option.observedPrice = record.modeledCost; option.priceCheckDate = context.verification.checkedDate; }
  }
  // Reuse suitability and compatible procurement, but do not expose old quantity-only financials.
  const selectionInput = { ...input, budget: null };
  const selected = recommendResidentialCameras(context.cameraConfig, catalog, context.baseline, selectionInput);
  function costSelection(locations, procurement) {
    if (!procurement) return calculate(context, null, 'custom_quote', [line('unresolved_camera_configuration', null, 1, true, 'Power,coverage,Wi-Fi or compatible procurement unresolved.')], options);
    const count = locations.length, ids = new Set(locations.map(row => row.equipmentId));
    const group = ids.size === 1 && ids.has('eufy_solocam_s220') ? 'residentialEquipmentIncluded'
      : ids.size === 1 && ids.has('eufycam_e40') ? 'residentialE40EquipmentIncluded' : null;
    const tier = group ? findTier(context, 'cameras', group, { quantity: count }) : null;
    const lines = procurement.purchasing.lines.map(purchase => line(purchase.optionId, purchase.observedUnitPrice, purchase.purchaseQuantity, true,
      `Existing compatible purchasing optimizer;${purchase.productId}.`,
      context.verification.observations.find(row => row.productId === purchase.productId)?.equipmentId ?? purchase.optionId));
    for (const material of procurement.requiredMaterials) {
      const budgeted = material.materialId === 'camera_consumables';
      lines.push(line(material.materialId, budgeted && !input.materialUnitCosts?.[material.materialId]
        ? context.canonical.costPolicy.cameraSuppliesPerCamera : material.unitCost, material.quantity, true,
      budgeted && !input.materialUnitCosts?.[material.materialId]
        ? `New proposed supplementary-material budget,not a verified expense. ${material.notes}` : material.notes));
    }
    const trip = options.travelAllowance ?? { amount: context.canonical.costPolicy.cameraTravelShippingAllowances[count] ?? null, notes: 'Separate proposed travel/shipping budget.' };
    lines.push(line('travel_shipping', trip.amount, 1, false, trip.notes));
    if (input.shipping) lines.push(line('explicit_shipping', input.shipping.amount, 1, false, `${input.shipping.notes} Travel budget is conservatively retained separately,not silently reduced.`));
    if (options.materialsTax && input.salesTax) throw new Error('Supply tax evidence once,either consultation salesTax or quote materialsTax.');
    const calculationOptions = input.salesTax ? { ...options, materialsTax: input.salesTax } : options;
    const quote = calculate(context, tier ? amount(tier) : null, tier?.price !== undefined ? 'fixed' : tier ? 'starting' : 'custom_quote', lines, calculationOptions,
      [...procurement.reviewFlags.filter(flag => !flag.startsWith('three_camera_price') && !flag.startsWith('exceeds_unverified_historical_')), ...(group ? [] : ['nonstandard_camera_combination_custom_quote'])]);
    if (input.budget !== null && (quote.proposedPrice.amount === null || quote.proposedPrice.amount > input.budget)) {
      quote.flags.push('customer_budget_below_reconciled_price_or_custom_quote'); quote.requiresCustomQuote = true;
    }
    const requiredMaterials = procurement.requiredMaterials.map(material => {
      const expense = quote.expenseLines.find(row => row.id === material.materialId);
      return { ...material, unitCost: expense.exactAmount === null ? null
        : exact.toMoney(exact.fromExact(expense.exactAmount) / BigInt(material.quantity)),
      totalCost: expense.amount, notes: expense.notes };
    });
    const microSd = requiredMaterials.find(material => material.materialId === 'camera_micro_sd_128gb');
    const storage = procurement.storage.map(row => {
      if (row.strategy !== 'standalone_micro_sd') return row;
      const count = locations.filter(location => location.equipmentId === row.equipmentId).length;
      return { ...row, storageCost: microSd.unitCost === null ? null : exact.toMoney(exact.fromMoney(microSd.unitCost) * BigInt(count)) };
    });
    return { ...quote, purchasing: procurement.purchasing, storage, requiredMaterials };
  }
  const primaryQuote = costSelection(selected.locations, selected.quote);
  return {
    status: context.canonical.status, activationAllowed: false, recommendedCameraCount: selected.recommendedCameraCount,
    locations: selected.locations, requiresManualReview: true,
    requiresCustomQuote: primaryQuote.requiresCustomQuote || selected.requiresCustomQuote,
    quote: primaryQuote,
    alternatives: selected.alternatives.map(alternative => ({ strategy: alternative.strategy, locations: alternative.locations, quote: costSelection(alternative.locations, alternative.quote) })),
    selectionReviewFlags: selected.reviewFlags.filter(flag => !flag.startsWith('customer_budget_below_') && !flag.startsWith('starting_price_not_budget_')),
  };
}

module.exports = { loadContext, validate, quoteTier, quoteTvs, recommendQuote, calculate, findTier, pdfRow };
