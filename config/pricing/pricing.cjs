const Ajv = require('ajv');
const baselineSchema = require('./baseline.schema.json');
const promotionsSchema = require('./promotions.schema.json');
const equipmentSchema = require('./equipment.schema.json');
const camerasSchema = require('./residential-cameras.schema.json');
const recommendationsSchema = require('./recommendations.schema.json');

const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, multipleOfPrecision: 8 });
ajv.addSchema(recommendationsSchema);
const baselineShape = ajv.compile(baselineSchema);
const promotionsShape = ajv.compile(promotionsSchema);
const offerShape = ajv.compile(promotionsSchema.properties.offers.items);
const equipmentShape = ajv.compile(equipmentSchema);
const camerasShape = ajv.compile(camerasSchema);
const siteShape = ajv.getSchema(`${camerasSchema.$id}#/definitions/siteAssessment`);
const cameraInputsShape = ajv.getSchema(`${camerasSchema.$id}#/definitions/calculationInputs`);
const tvGroups = ['residentialInstallationOnly', 'residentialWithStandardFixedMount', 'commercialInstallationOnly'];

function checkShape(validate, value, label) {
  if (!validate(value)) {
    throw new Error(`${label}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
  }
}

function cents(value, label, allowNegative = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (!allowNegative && value < 0)) {
    throw new TypeError(`${label} must be a finite ${allowNegative ? '' : 'nonnegative '}USD amount.`);
  }
  const result = Math.round(value * 100);
  if (!Number.isSafeInteger(result) || Math.abs(value * 100 - result) > 0.0000001) {
    throw new RangeError(`${label} must have at most two decimal places and fit safe integer cents.`);
  }
  return result === 0 ? 0 : result;
}

function calculateMaterialFinancials({ sellingPrice, equipmentCost, suppliesCost }) {
  const selling = cents(sellingPrice, 'sellingPrice');
  const equipment = cents(equipmentCost, 'equipmentCost');
  const supplies = cents(suppliesCost, 'suppliesCost');
  const totalCost = equipment + supplies;
  const contribution = selling - totalCost;
  if (!Number.isSafeInteger(totalCost) || !Number.isSafeInteger(contribution)) {
    throw new RangeError('Combined costs or contribution exceed safe integer cents.');
  }
  return {
    sellingPrice: selling / 100,
    equipmentCost: equipment / 100,
    suppliesCost: supplies / 100,
    materialContribution: contribution / 100,
    materialMarginPercent: selling === 0 ? null : Math.round(contribution / selling * 10000) / 100,
  };
}

function validateBaseline(baseline) {
  checkShape(baselineShape, baseline, 'Baseline schema');
  const errors = [];
  for (const group of tvGroups) {
    const tiers = baseline.prices.tvMounting[group];
    let nextMinimum = 1;
    for (const [index, tier] of tiers.entries()) {
      const minimum = index === 0 ? tier.minInches ?? 1 : tier.minInches;
      const label = `prices.tvMounting.${group}[${index}]`;
      if (!Number.isSafeInteger(minimum) || tier.maxInches !== undefined && !Number.isSafeInteger(tier.maxInches)) {
        errors.push(`${label}: size boundaries must be safe integers.`);
      }
      if (minimum !== nextMinimum) errors.push(`${label}: size boundaries must be unique, ascending and contiguous from 1 inch.`);
      if (tier.maxInches === undefined) {
        if (index !== tiers.length - 1 || tier.quoteRequired !== true || tier.price !== undefined) {
          errors.push(`${label}: only the final, quote-required TV tier can have no upper bound; it cannot have a fixed price.`);
        }
      } else {
        if (minimum === undefined || tier.maxInches < minimum) errors.push(`${label}: maxInches must be at least minInches.`);
        if (index === tiers.length - 1) errors.push(`${label}: the final TV tier must explicitly handle larger sizes as quote-required.`);
      }
      nextMinimum = tier.maxInches === undefined ? Infinity : tier.maxInches + 1;
    }
  }
  const quantities = [
    ['tvMounting.commercialBundlesInstallationOnlyUpTo65Inches', baseline.prices.tvMounting.commercialBundlesInstallationOnlyUpTo65Inches],
    ...Object.entries(baseline.prices.cameras).map(([name, rows]) => [`cameras.${name}`, rows]),
  ];
  for (const [group, tiers] of quantities) {
    let previous = 0;
    for (const tier of tiers) {
      if (!Number.isSafeInteger(tier.quantity) || tier.quantity <= previous) errors.push(`prices.${group}: quantities must be safe integers, unique and strictly ascending.`);
      previous = tier.quantity;
    }
  }
  for (const [service, groups] of Object.entries(baseline.prices)) {
    for (const [group, tiers] of Object.entries(groups)) {
      for (const [index, tier] of tiers.entries()) {
        for (const key of ['price', 'priceFrom']) {
          if (tier[key] !== undefined) cents(tier[key], `prices.${service}.${group}[${index}].${key}`);
        }
      }
    }
  }
  const ids = new Set();
  for (const scenario of baseline.costScenarios) {
    if (ids.has(scenario.id)) errors.push(`costScenarios: duplicate id ${scenario.id}.`);
    ids.add(scenario.id);
    const financials = calculateMaterialFinancials({
      sellingPrice: scenario.sellingPrice,
      equipmentCost: scenario.equipmentCost,
      suppliesCost: scenario.suppliesCostEstimate,
    });
    if (cents(scenario.grossMaterialProfit, 'grossMaterialProfit', true) !== cents(financials.materialContribution, 'materialContribution', true)) {
      errors.push(`costScenarios.${scenario.id}: grossMaterialProfit must equal selling price minus equipment and supplies.`);
    }
    if (scenario.grossMaterialMarginPercent !== financials.materialMarginPercent) {
      errors.push(`costScenarios.${scenario.id}: grossMaterialMarginPercent must equal contribution / selling price * 100, rounded to two decimals.`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return baseline;
}

function validatePromotions(promotions, baseline) {
  validateBaseline(baseline);
  checkShape(promotionsShape, promotions, 'Promotions schema');
  if (promotions.baselineVersion !== baseline.schemaVersion || promotions.currency !== baseline.currency) {
    throw new Error('Promotions must explicitly reference the matching baseline version and currency.');
  }
  const ids = new Set();
  for (const offer of promotions.offers) {
    if (ids.has(offer.id)) throw new Error(`Duplicate promotion id: ${offer.id}`);
    ids.add(offer.id);
    if (offer.discount.type === 'fixed_amount') cents(offer.discount.amount, `offers.${offer.id}.discount.amount`);
  }
  return promotions;
}

function validateEquipmentCatalog(catalog, baseline) {
  validateBaseline(baseline);
  checkShape(equipmentShape, catalog, 'Equipment schema');
  if (catalog.baselineReference.version !== baseline.schemaVersion || catalog.currency !== baseline.currency) {
    throw new Error('Equipment catalog must reference the matching baseline version and currency.');
  }
  const ids = new Set();
  const supplierIds = new Set();
  for (const entry of [...catalog.items, ...(catalog.cameraItems ?? []), ...catalog.costAllowances, ...catalog.customerUpgrades]) {
    if (ids.has(entry.id)) throw new Error(`Duplicate equipment catalog id: ${entry.id}`);
    ids.add(entry.id);
  }
  const items = new Map(catalog.items.map(item => [item.id, item]));
  for (const item of catalog.items) {
    const { supplier, tvCompatibility: tv, dimensionsInches: dimensions } = item;
    if (supplierIds.has(supplier.itemId)) throw new Error(`Duplicate supplier item ID: ${supplier.itemId}`);
    supplierIds.add(supplier.itemId);
    if (supplier.url !== `https://www.walmart.com/ip/${supplier.itemId}` || item.verification.sourceUrl !== supplier.url) {
      throw new Error(`${item.id}: supplier URL, item ID and compatibility source must agree.`);
    }
    validatePriceCheckDate(supplier.priceCheckDate, item.id);
    cents(supplier.observedPrice, `${item.id}.supplier.observedPrice`);
    cents(item.costAssumption.amount, `${item.id}.costAssumption.amount`);
    if (dimensions.wallDistance && dimensions.wallDistance.minimum > dimensions.wallDistance.maximum) {
      throw new Error(`${item.id}: wall distance bounds are reversed.`);
    }
    if (item.type === 'raceway' ? tv !== null : tv === null) {
      throw new Error(`${item.id}: TV compatibility must be supplied for mounts and null for raceways.`);
    }
    if (tv) {
      if (!Number.isSafeInteger(tv.minInches) || !Number.isSafeInteger(tv.maxInches) || tv.minInches > tv.maxInches) {
        throw new Error(`${item.id}: TV size bounds must be safe integers in ascending order.`);
      }
      const vesa = tv.vesaMm;
      if (vesa) {
        const bounds = [vesa.minimumWidth, vesa.minimumHeight, vesa.maximumWidth, vesa.maximumHeight];
        if (!bounds.every(Number.isSafeInteger) || vesa.minimumWidth > vesa.maximumWidth || vesa.minimumHeight > vesa.maximumHeight) {
          throw new Error(`${item.id}: VESA bounds must be safe integers in ascending order.`);
        }
        for (const pattern of vesa.supportedPatterns ?? []) {
          if (!Number.isSafeInteger(pattern.width) || !Number.isSafeInteger(pattern.height)
            || pattern.width < vesa.minimumWidth || pattern.width > vesa.maximumWidth
            || pattern.height < vesa.minimumHeight || pattern.height > vesa.maximumHeight) {
            throw new Error(`${item.id}: supported VESA pattern lies outside the stated bounds.`);
          }
        }
      }
    }
  }
  for (const allowance of catalog.costAllowances) {
    cents(allowance.amountPerTv, `${allowance.id}.amountPerTv`);
  }
  if (Boolean(catalog.cameraItems) !== Boolean(catalog.cameraConfiguration)) {
    throw new Error('Camera items and their linked residential camera configuration must be supplied together.');
  }
  const productIds = new Set();
  for (const camera of catalog.cameraItems ?? []) {
    const { supplier, power, solar } = camera;
    if (productIds.has(camera.productId)) throw new Error(`Duplicate camera product ID: ${camera.productId}`);
    productIds.add(camera.productId);
    if (!camera.productId.startsWith(camera.modelNumber) || supplier.itemId !== camera.productId
      || supplier.url !== `https://www.eufy.com/products/${camera.productId.toLowerCase()}`
      || !camera.verification.sourceUrls.includes(supplier.url)) {
      throw new Error(`${camera.id}: product, model, supplier and official source references must agree.`);
    }
    validatePriceCheckDate(supplier.priceCheckDate, camera.id);
    cents(supplier.observedPrice, `${camera.id}.observedPrice`);
    cents(camera.costAssumption.amount, `${camera.id}.costAssumption.amount`);
    cents(camera.costAssumption.originalPlanningAmount, `${camera.id}.costAssumption.originalPlanningAmount`);
    for (const retailer of camera.retailerListings) {
      if (retailer.url !== `https://www.walmart.com/ip/${retailer.itemId}`) {
        throw new Error(`${camera.id}: retailer item ID and URL must agree.`);
      }
      validatePriceCheckDate(retailer.priceCheckDate, camera.id);
      cents(retailer.observedPrice, `${camera.id}.retailer.observedPrice`);
    }
    const categoryModes = {
      standard_wired_power: 'continuous_usb_c_dc',
      default_residential_outdoor_solar: 'rechargeable_battery_solar',
      premium_hardwired_lighting: 'hardwired_ac',
      budget_fixed_solar: 'rechargeable_battery_solar',
      premium_tracking_solar: 'rechargeable_battery_solar',
      shared_storage_fixed_solar: 'rechargeable_battery_solar',
    };
    if (categoryModes[camera.installationCategory] !== power.mode
      || solar.supported !== (power.mode === 'rechargeable_battery_solar')
      || solar.panelIncluded !== solar.supported
      || solar.supported && solar.minimumDirectSunHoursPerDay === null && camera.storage.strategy !== 'required_homebase'
      || !solar.supported && solar.minimumDirectSunHoursPerDay !== null) {
      throw new Error(`${camera.id}: installation category, power mode and solar requirements disagree.`);
    }
    if (power.mode === 'continuous_usb_c_dc' && (power.dcVolts === null || power.adapterAmps === null)
      || power.mode === 'hardwired_ac' && (power.acMinVolts === null || power.acMaxVolts === null
        || power.acMinVolts > power.acMaxVolts || power.frequencyHz === null)) {
      throw new Error(`${camera.id}: applicable power requirements must be specified.`);
    }
  }
  for (const upgrade of catalog.customerUpgrades) {
    cents(upgrade.additionalPrice, `${upgrade.id}.additionalPrice`);
    const equipment = items.get(upgrade.equipmentId), replaced = items.get(upgrade.replacesEquipmentId);
    if (!equipment || !replaced || !['mount_tilt', 'mount_full_motion'].includes(equipment.type) || replaced.type !== 'mount_fixed') {
      throw new Error(`${upgrade.id}: upgrade must reference an existing tilt/full-motion mount and fixed replacement mount.`);
    }
    if (Math.max(equipment.tvCompatibility.minInches, replaced.tvCompatibility.minInches)
      > Math.min(equipment.tvCompatibility.maxInches, replaced.tvCompatibility.maxInches)) {
      throw new Error(`${upgrade.id}: upgrade and replacement TV size ranges must overlap.`);
    }
    if (upgrade.baselinePriceGroup !== null) {
      const group = upgrade.baselinePriceGroup.slice('/prices/tvMounting/'.length);
      if (group !== 'residentialWithStandardFixedMount' || !Object.hasOwn(baseline.prices.tvMounting, group)) {
        throw new Error(`${upgrade.id}: upgrade price reference must identify a fixed-mount-inclusive baseline group, not installation-only pricing.`);
      }
    }
  }
  return catalog;
}

function validatePriceCheckDate(value, label) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label}: priceCheckDate must be a real calendar date.`);
  }
}

function uniqueIds(entries, label) {
  const ids = entries.map(entry => entry.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${label}: duplicate IDs.`);
}

function validateCameraLocations(locations, quantity, cameras) {
  const expected = quantity === 2 ? ['back', 'front'] : ['back', 'front', 'left', 'right'];
  if (locations.length !== quantity || [...locations].map(row => row.id).sort().join() !== expected.join()) {
    throw new Error('Camera package locations must uniquely cover front/back or the four perimeter positions at the referenced quantity.');
  }
  for (const location of locations) {
    if (!cameras.has(location.equipmentId)) throw new Error(`Unknown camera reference: ${location.equipmentId}`);
  }
}

function validateCameraConfiguration(config, catalog, baseline) {
  validateEquipmentCatalog(catalog, baseline);
  checkShape(camerasShape, config, 'Residential camera schema');
  if (!catalog.cameraItems?.length || catalog.cameraConfiguration?.version !== config.schemaVersion
    || config.catalogReference.version !== catalog.schemaVersion
    || config.baselineReference.version !== baseline.schemaVersion || config.currency !== baseline.currency) {
    throw new Error('Residential camera configuration must match its linked catalog, baseline version and currency.');
  }
  uniqueIds(config.selectionRules, 'Camera selection rules');
  uniqueIds(config.materialAssumptions, 'Camera materials');
  uniqueIds(config.packages, 'Camera packages');
  if (new Set(config.reviewRules.map(rule => rule.fact)).size !== config.reviewRules.length) {
    throw new Error('Camera review rules must cover each required safety fact exactly once.');
  }
  const cameras = new Map(catalog.cameraItems.map(camera => [camera.id, camera]));
  const materials = new Set(config.materialAssumptions.map(material => material.id));
  for (const material of config.materialAssumptions) {
    if (material.unitCost !== null) cents(material.unitCost, `${material.id}.unitCost`);
  }
  for (const camera of cameras.values()) {
    const required = ['camera_consumables'];
    if (camera.storage.strategy === 'standalone_micro_sd') required.push('camera_micro_sd_128gb');
    if (camera.power.mode === 'continuous_usb_c_dc') required.push('c31_power_weather_protection');
    if (camera.power.mode === 'hardwired_ac') required.push('floodlight_electrical_materials');
    if (required.some(id => !camera.requiredMaterialIds.includes(id))
      || camera.requiredMaterialIds.some(id => !materials.has(id))) {
      throw new Error(`${camera.id}: recording, consumables and model-specific power material references must exist.`);
    }
  }
  const selectedIds = new Set();
  for (const rule of config.selectionRules) {
    const camera = cameras.get(rule.equipmentId);
    if (!camera || selectedIds.has(rule.equipmentId) || rule.when.outdoor !== true) {
      throw new Error(`${rule.id}: selection rules require distinct known outdoor camera references.`);
    }
    selectedIds.add(rule.equipmentId);
    const valid = camera.power.mode === 'rechargeable_battery_solar'
      ? rule.when.suitableSunlight === true && rule.role === 'initial_preferred_option'
      : camera.power.mode === 'continuous_usb_c_dc'
        ? rule.when.c31PowerCompatible === true && rule.role === 'lower_cost_alternative'
        : rule.when.floodlightPowerCompatible === true && rule.when.lightingRequested === true
          && rule.manualReviewRequired && rule.role === 'premium_lighting_candidate';
    if (!valid) throw new Error(`${rule.id}: selection rule omits model-specific power, solar or lighting requirements.`);
  }
  const legacyCategories = new Set(['standard_wired_power', 'default_residential_outdoor_solar', 'premium_hardwired_lighting']);
  if ([...cameras.values()].some(camera => legacyCategories.has(camera.installationCategory) && !selectedIds.has(camera.id))) {
    throw new Error('Each legacy camera must have a selection rule.');
  }
  for (const draft of config.packages) {
    const { group, quantity } = draft.baselinePriceReference;
    const tier = baseline.prices.cameras[group].find(row => row.quantity === quantity);
    if (!tier || tier.quoteRequired || tier.price === undefined && tier.priceFrom === undefined) {
      throw new Error(`${draft.id}: draft must reference an existing priced residential equipment-inclusive quantity.`);
    }
    validateCameraLocations(draft.locations, quantity, cameras);
    if (draft.referenceCostScenarioId !== null) {
      const scenario = baseline.costScenarios.find(row => row.id === draft.referenceCostScenarioId);
      if (quantity !== 4 || scenario?.id !== 'residential_eufy_four_camera_example' || scenario.sellingPrice !== (tier.price ?? tier.priceFrom)) {
        throw new Error(`${draft.id}: historical cost reference must match the residential four-camera example.`);
      }
    }
  }
  return config;
}

function evaluateCameraSelection(config, site) {
  checkShape(siteShape, site, 'Camera site assessment');
  const reviewReasons = config.reviewRules.filter(rule => site[rule.fact] !== rule.expected).map(rule => rule.reason);
  if (site.lightingRequested === null) reviewReasons.push('lighting_requirements_unconfirmed');
  if (site.lightingRequested && site.floodlightPowerCompatible !== true) reviewReasons.push('requested_lighting_power_unconfirmed');
  const candidates = config.selectionRules.filter(rule => Object.entries(rule.when).every(([fact, value]) => site[fact] === value));
  // Solar stays ahead of the cheaper wired alternative regardless of editable rule order.
  const rank = { premium_lighting_candidate: 0, initial_preferred_option: 1, lower_cost_alternative: 2 };
  candidates.sort((left, right) => rank[left.role] - rank[right.role]);
  if (!candidates.length) reviewReasons.push('no_compatible_camera_candidate');
  if (candidates[0]?.manualReviewRequired) reviewReasons.push('candidate_installation_requires_manual_review');
  return {
    comparisonOnly: true,
    status: reviewReasons.length ? 'manual_review' : 'proposed_recommendation',
    recommendedEquipmentId: reviewReasons.length ? null : candidates[0].equipmentId,
    candidates: candidates.map(rule => ({ equipmentId: rule.equipmentId, role: rule.role })),
    reviewReasons,
  };
}

function selectResidentialCamera(config, catalog, baseline, site) {
  validateCameraConfiguration(config, catalog, baseline);
  return evaluateCameraSelection(config, site);
}

function safeCentResult(value) {
  if (!Number.isSafeInteger(value)) throw new RangeError('Camera materials arithmetic exceeds safe integer cents.');
  return value;
}

function calculateCameraPackage(config, catalog, baseline, packageId, inputs = {}) {
  validateCameraConfiguration(config, catalog, baseline);
  checkShape(cameraInputsShape, inputs, 'Camera calculation inputs');
  const draft = config.packages.find(row => row.id === packageId);
  if (!draft) throw new Error(`Unknown camera package: ${packageId}`);
  const cameras = new Map(catalog.cameraItems.map(camera => [camera.id, camera]));
  const locations = inputs.locations ?? draft.locations;
  validateCameraLocations(locations, draft.baselinePriceReference.quantity, cameras);
  const overrides = inputs.materialUnitCosts ?? {};
  const materialDefinitions = new Map(config.materialAssumptions.map(row => [row.id, row]));
  for (const id of Object.keys(overrides)) {
    if (!materialDefinitions.has(id)) throw new Error(`Unknown camera material cost reference: ${id}`);
    if (overrides[id].amount !== null) cents(overrides[id].amount, `${id}.override.amount`);
  }
  for (const id of Object.keys(inputs.siteFactsByLocation ?? {})) {
    if (!locations.some(location => location.id === id)) throw new Error(`Site assessment references an absent location: ${id}`);
  }
  const cameraCounts = new Map(), materialCounts = new Map();
  const reviewReasons = new Set(['proposed_configuration_not_approved']);
  const locationAssessments = [];
  for (const location of locations) {
    const camera = cameras.get(location.equipmentId);
    cameraCounts.set(camera.id, (cameraCounts.get(camera.id) ?? 0) + 1);
    for (const id of camera.requiredMaterialIds) materialCounts.set(id, (materialCounts.get(id) ?? 0) + 1);
    if (camera.power.mode !== 'rechargeable_battery_solar') reviewReasons.add('installation_scope_requires_review');
    const site = inputs.siteFactsByLocation?.[location.id];
    if (!site) {
      reviewReasons.add(`site_assessment_missing:${location.id}`);
      locationAssessments.push({ locationId: location.id, selectedEquipmentId: camera.id, status: 'manual_review' });
    } else {
      const assessment = evaluateCameraSelection(config, site);
      if (!assessment.candidates.some(candidate => candidate.equipmentId === camera.id)) {
        assessment.status = 'manual_review';
        assessment.reviewReasons.push('selected_camera_requirements_unconfirmed');
      }
      for (const reason of assessment.reviewReasons) reviewReasons.add(`${reason}:${location.id}`);
      locationAssessments.push({ locationId: location.id, selectedEquipmentId: camera.id, ...assessment });
    }
  }
  let equipmentCents = 0, accessoryCents = 0;
  const selectedEquipment = [...cameraCounts].map(([id, quantity]) => {
    const camera = cameras.get(id), unit = cents(camera.costAssumption.amount, `${id}.costAssumption.amount`);
    const total = safeCentResult(unit * quantity);
    equipmentCents = safeCentResult(equipmentCents + total);
    return { equipmentId: id, productId: camera.productId, modelNumber: camera.modelNumber, name: camera.name, quantity,
      unitCost: unit / 100, totalCost: total / 100, includedAccessories: [...camera.includedAccessories] };
  });
  const requiredMaterials = [...materialCounts].map(([id, quantity]) => {
    const material = materialDefinitions.get(id), override = overrides[id];
    const unitCost = override ? override.amount : material.unitCost;
    const total = unitCost === null ? null : safeCentResult(cents(unitCost, `${id}.unitCost`) * quantity);
    if (total !== null) accessoryCents = safeCentResult(accessoryCents + total);
    return { materialId: id, name: material.name, quantity, unitCost, totalCost: total === null ? null : total / 100,
      notes: override ? override.notes : material.notes };
  });
  const unknownMaterialIds = requiredMaterials.filter(row => row.unitCost === null).map(row => row.materialId);
  if (unknownMaterialIds.length) reviewReasons.add('required_material_costs_unknown');
  const tier = baseline.prices.cameras[draft.baselinePriceReference.group].find(row => row.quantity === draft.baselinePriceReference.quantity);
  const sellingCents = cents(tier.price ?? tier.priceFrom, 'camera baseline price');
  const knownCents = safeCentResult(equipmentCents + accessoryCents);
  const contributionCents = safeCentResult(sellingCents - knownCents);
  if (knownCents > sellingCents) reviewReasons.add('known_materials_exceed_baseline_customer_price');
  const scenario = baseline.costScenarios.find(row => row.id === draft.referenceCostScenarioId);
  if (scenario) {
    reviewReasons.add('historical_cost_reference_unverified');
    const historicalEquipment = cents(scenario.equipmentCost, 'historical equipment');
    const historicalMaterials = safeCentResult(historicalEquipment + cents(scenario.suppliesCostEstimate, 'historical supplies'));
    if (equipmentCents > historicalEquipment) reviewReasons.add('equipment_exceeds_historical_baseline_assumption');
    if (knownCents > historicalMaterials) reviewReasons.add('materials_exceed_historical_baseline_assumption');
  } else {
    reviewReasons.add('baseline_cost_assumptions_unestablished');
  }
  return {
    packageId, status: 'proposed_pending_approval', comparisonOnly: true, requiresManualReview: true,
    locations: locations.map(row => ({ ...row })), selectedEquipment, requiredMaterials, locationAssessments,
    equipmentCost: equipmentCents / 100, knownAccessoryAndConsumablesCost: accessoryCents / 100,
    knownMaterialsCost: knownCents / 100, unknownMaterialIds, costingComplete: unknownMaterialIds.length === 0,
    totalEstimatedDirectMaterialsCost: unknownMaterialIds.length ? null : knownCents / 100,
    customerPrice: { amount: sellingCents / 100, kind: tier.price === undefined ? 'starting' : 'fixed',
      baselinePriceReference: { ...draft.baselinePriceReference } },
    remainingContribution: unknownMaterialIds.length ? null : contributionCents / 100,
    contributionBasis: tier.price === undefined ? 'baseline_starting_price_not_final_quote' : 'baseline_fixed_price_not_combination_approval',
    contributionUpperBoundBeforeUncostedMaterials: contributionCents / 100,
    excludedExpenses: ['labor', 'commissions', 'payment_processing', 'taxes', 'shipping', 'travel', 'insurance', 'overhead'],
    reviewReasons: [...reviewReasons],
  };
}

function compareOfferScenario(scenario, offer) {
  checkShape(offerShape, offer, 'Comparison offer schema');
  const standard = calculateMaterialFinancials(scenario);
  const standardCents = cents(standard.sellingPrice, 'sellingPrice');
  const discountCents = offer.discount.type === 'fixed_amount'
    ? cents(offer.discount.amount, 'discount.amount')
    : Number((BigInt(standardCents) * BigInt(cents(offer.discount.percent, 'discount.percent')) + 5000n) / 10000n);
  if (discountCents > standardCents) throw new RangeError('Comparison discount exceeds the selling price; no automatic clamping is allowed.');
  return {
    comparisonOnly: true,
    offerId: offer.id,
    eligibility: 'Not established; this is not an approved offer or customer quote.',
    discountAmount: discountCents / 100,
    standard,
    experimental: calculateMaterialFinancials({ ...scenario, sellingPrice: (standardCents - discountCents) / 100 }),
  };
}

module.exports = {
  validateBaseline, validatePromotions, validateEquipmentCatalog, validateCameraConfiguration,
  selectResidentialCamera, calculateCameraPackage, calculateMaterialFinancials, compareOfferScenario,
  usdCents: cents, safeCentResult,
};
