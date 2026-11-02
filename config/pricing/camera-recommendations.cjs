const Ajv = require('ajv');
const schema = require('./recommendations.schema.json');
const { validateCameraConfiguration, usdCents, safeCentResult } = require('./pricing.cjs');

const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false, multipleOfPrecision: 8 });
ajv.addSchema(schema);
const inputShape = ajv.getSchema(`${schema.$id}#/definitions/consultation`);
const outputShape = ajv.getSchema(`${schema.$id}#/definitions/output`);

function shape(validate, value, label) {
  if (!validate(value)) throw new Error(`${label}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
}

function sum(values) {
  return values.reduce((total, value) => safeCentResult(total + value), 0);
}

function percentOf(amountCents, percent) {
  const result = Number((BigInt(amountCents) * BigInt(usdCents(percent, 'percentage')) + 5000n) / 10000n);
  return safeCentResult(result);
}

function validateRecommendationConfiguration(config, catalog, baseline) {
  validateCameraConfiguration(config, catalog, baseline);
  const policy = config.recommendationPolicy;
  if (!policy) throw new Error('Homeowner recommendations require a recommendationPolicy.');
  const ids = new Set(catalog.cameraItems.map(camera => camera.id));
  const profiles = policy.profiles.map(profile => profile.equipmentId);
  if (new Set(profiles).size !== profiles.length || profiles.length !== ids.size || profiles.some(id => !ids.has(id))) {
    throw new Error('Recommendation profiles must reference every camera exactly once.');
  }
  const quantities = policy.priceRules.map(rule => rule.quantity);
  if (new Set(quantities).size !== 4) throw new Error('Recommendation prices must uniquely cover quantities 1, 2, 3 and 4.');
  for (const rule of policy.priceRules) {
    if (rule.quantity === 3) {
      if (rule.baselineQuantity !== null || rule.draftPrice !== 849 || rule.kind !== 'unapproved_draft') {
        throw new Error('Three-camera pricing must remain an unapproved $849 draft, not a baseline override.');
      }
    } else {
      const tier = baseline.prices.cameras.residentialEquipmentIncluded.find(row => row.quantity === rule.quantity);
      if (rule.baselineQuantity !== rule.quantity || rule.draftPrice !== null
        || rule.kind !== (tier.price === undefined ? 'starting' : 'fixed')) {
        throw new Error('One/two/four-camera amounts must reference unchanged baseline price semantics.');
      }
    }
  }
  const materials = [...config.materialAssumptions, ...policy.additionalMaterials];
  if (new Set(materials.map(row => row.id)).size !== materials.length) throw new Error('Duplicate recommendation material ID.');
  for (const material of materials) if (material.unitCost !== null) usdCents(material.unitCost, material.id);
  for (const id of ['homebase_installation_materials', 'solar_initial_charging_materials']) {
    if (!materials.some(row => row.id === id)) throw new Error(`${id}: material assumption is required.`);
  }
  if (policy.financialAssumptions.equipmentSalesTaxPercent !== null) {
    usdCents(policy.financialAssumptions.equipmentSalesTaxPercent, 'equipmentSalesTaxPercent');
  }
  for (const camera of catalog.cameraItems) {
    if (camera.storage.strategy === 'built_in' && (camera.storage.builtInStorageGb !== 8 || camera.storage.microSdMaxGb !== null)
      || camera.storage.strategy === 'required_homebase' && camera.storage.microSdMaxGb !== null) {
      throw new Error(`${camera.id}: built-in/HomeBase storage cannot be silently replaced by microSD.`);
    }
    const profile = policy.profiles.find(row => row.equipmentId === camera.id);
    if ((profile.connectivity === 'homebase_link') !== (camera.storage.strategy === 'required_homebase')) {
      throw new Error(`${camera.id}: connectivity and storage requirements disagree.`);
    }
    if (camera.storage.strategy !== 'standalone_micro_sd' && camera.requiredMaterialIds.includes('camera_micro_sd_128gb')) {
      throw new Error(`${camera.id}: standalone memory/HomeBase cameras do not require a separate microSD.`);
    }
  }
  const optionIds = new Set();
  for (const option of catalog.purchasingOptions ?? []) {
    if (optionIds.has(option.id) || !ids.has(option.equipmentId)) throw new Error('Duplicate or unknown purchasing option reference.');
    optionIds.add(option.id);
    const camera = catalog.cameraItems.find(row => row.id === option.equipmentId);
    const date = new Date(`${option.priceCheckDate}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== option.priceCheckDate) {
      throw new Error(`${option.id}: invalid price verification date.`);
    }
    usdCents(option.planningCost, `${option.id}.planningCost`);
    usdCents(option.observedPrice, `${option.id}.observedPrice`);
    if (option.includedHub !== null && camera.storage.strategy !== 'required_homebase'
      || (option.includedHub === null) !== (option.includedHubStorageGb === null)) {
      throw new Error(`${option.id}: hub contents do not match this purchasing option.`);
    }
    if (option.eligibleForOptimization && option.sourceUrl !== `https://www.eufy.com/products/${option.productId.toLowerCase()}`) {
      throw new Error(`${option.id}: optimization requires an exact verified product URL, not a comparison or alternate kit.`);
    }
    if (option.includedHub !== null && option.includedHubStorageGb !== 16) throw new Error('Initial E40 hubs have 16GB included storage.');
  }
  if (!catalog.purchasingOptions?.some(option => option.id === 'e40_homebase2_kit' && option.includedHub === 'homebase_2'
    && option.quantity === 2 && option.productId === 'E8144121')) {
    throw new Error('The distinct two-camera E40 HomeBase 2 purchasing reference is required.');
  }
  return config;
}

function purchasingOptions(camera, catalog) {
  const explicit = (catalog.purchasingOptions ?? []).filter(option => option.equipmentId === camera.id && option.eligibleForOptimization);
  if (explicit.length) return explicit;
  return [{
    id: `${camera.id}_single`, equipmentId: camera.id, quantity: 1, includedHub: null, includedHubStorageGb: null,
    productId: camera.productId, planningCost: camera.costAssumption.amount, observedPrice: camera.supplier.observedPrice,
    sourceUrl: camera.supplier.url, priceCheckDate: camera.supplier.priceCheckDate,
  }];
}

function bestPurchase(camera, count, catalog, input) {
  const needsHub = camera.storage.strategy === 'required_homebase';
  const hubType = input.preferences.homebaseType;
  const existing = needsHub && input.existingHub.type === hubType && input.existingHub.compatibilityVerified === true
    && input.existingHub.availableCameraSlots !== null && input.existingHub.availableCameraSlots >= count
    && input.hubRouterConnectionConfirmed === true;
  const options = purchasingOptions(camera, catalog).filter(option => !option.includedHub || option.includedHub === hubType);
  const limit = count + Math.max(1, ...options.map(option => option.quantity)) - 1;
  const states = Array.from({ length: limit + 1 }, () => [null, null]);
  states[0][existing ? 1 : 0] = { cents: 0, planningCents: 0, hubs: 0, options: [] };
  for (let quantity = 0; quantity <= limit; quantity++) {
    for (let hasHub = 0; hasHub < 2; hasHub++) {
      const state = states[quantity][hasHub];
      if (!state) continue;
      for (const option of options) {
        const nextQuantity = quantity + option.quantity;
        if (nextQuantity > limit) continue;
        const nextHub = hasHub || option.includedHub ? 1 : 0;
        const next = {
          cents: sum([state.cents, usdCents(option.observedPrice, option.id)]),
          planningCents: sum([state.planningCents, usdCents(option.planningCost, option.id)]),
          hubs: state.hubs + (option.includedHub ? 1 : 0), options: [...state.options, option],
        };
        const previous = states[nextQuantity][nextHub];
        if (!previous || next.cents < previous.cents || next.cents === previous.cents
          && (next.hubs < previous.hubs || next.hubs === previous.hubs && next.options.length < previous.options.length)) {
          states[nextQuantity][nextHub] = next;
        }
      }
    }
  }
  const finalists = states.slice(count).map((state, index) => {
    const candidate = state[needsHub ? 1 : 0];
    return candidate ? { ...candidate, surplusCameras: index } : null;
  }).filter(Boolean).sort((a, b) => a.cents - b.cents || a.surplusCameras - b.surplusCameras || a.hubs - b.hubs);
  const best = finalists[0];
  if (!best) return null;
  return { ...best, existingHubUsed: existing, installedHub: needsHub ? hubType : null,
    surplusHubs: Math.max(0, best.hubs - (needsHub && !existing ? 1 : 0)) };
}

function candidateReasons(camera, profile, location, input) {
  const failures = [];
  if (location.outdoor !== true) failures.push('outdoor_location_unconfirmed');
  if (location.coveragePositionVerified !== true) failures.push('independent_coverage_position_unverified');
  if (location.mountingCompatible !== true) failures.push('mounting_unconfirmed');
  if (location.standardInstallation !== true) failures.push('installation_complexity_unconfirmed');
  for (const feature of location.requiredFeatures) if (!profile.features.includes(feature)) failures.push(`unsupported_feature:${feature}`);
  if (location.coverage.length > 1 && profile.features.includes('pan_tilt')) {
    failures.push('rotating_camera_cannot_imply_simultaneous_separate_area_coverage');
  }
  if (input.preferences.storage === 'standalone' && camera.storage.strategy === 'required_homebase') failures.push('standalone_storage_required');
  if (input.preferences.storage === 'shared_homebase' && camera.storage.strategy !== 'required_homebase') failures.push('shared_storage_path_not_standardized');
  if (profile.connectivity === 'homebase_link') {
    if (location.homebaseLinkConfirmed !== true) failures.push('homebase_radio_link_unconfirmed');
    if (input.hubRouterConnectionConfirmed !== true) failures.push('homebase_router_connection_unconfirmed');
  } else if (location.wifiConfirmed !== true) failures.push('router_wifi_unconfirmed');
  if (camera.solar.supported) {
    if (location.sunlightSuitable !== true) failures.push('sunlight_inadequate_or_unverified');
    if (location.batteryMaintenanceAccepted !== true) failures.push('battery_maintenance_unconfirmed');
    if (camera.solar.minimumDirectSunHoursPerDay !== null
      && (location.directSunHours === null || location.directSunHours < camera.solar.minimumDirectSunHoursPerDay)) {
      failures.push('insufficient_verified_model_specific_sun_hours');
    }
  } else if (camera.power.mode === 'continuous_usb_c_dc' && location.c31PowerCompatible !== true) {
    failures.push('specific_c31_power_unconfirmed');
  } else if (camera.power.mode === 'hardwired_ac') {
    if (location.floodlightPowerCompatible !== true) failures.push('specific_floodlight_power_unconfirmed');
    if (!location.requiredFeatures.includes('floodlighting')) failures.push('lighting_not_requested');
  }
  return failures;
}

function rankCamera(camera, profile, location, input, count, cheapest) {
  if (location.preferredEquipmentId === camera.id) return -100;
  if (cheapest) return camera.supplier.observedPrice;
  if (input.preferences.priority === 'premium' && profile.preference === 'premium_tracking_zoom') return -10;
  if (profile.preference === 'existing_floodlight') return 0;
  if (count > 1 && profile.preference === 'multi_location_shared_storage') return 1;
  const ranks = { budget_solar: 2, solar_pan_tilt: 3, economical_compatible_wired: 4, premium_tracking_zoom: 5, multi_location_shared_storage: 6 };
  return ranks[profile.preference];
}

function proposedPrice(policy, baseline, count) {
  const rule = policy.priceRules.find(row => row.quantity === count);
  if (!rule) return { amount: null, kind: 'custom_quote', quantity: count };
  if (rule.draftPrice !== null) return { amount: rule.draftPrice, kind: rule.kind, quantity: count };
  const tier = baseline.prices.cameras.residentialEquipmentIncluded.find(row => row.quantity === rule.baselineQuantity);
  return { amount: tier.price ?? tier.priceFrom, kind: rule.kind, quantity: count };
}

function buildQuote(config, catalog, baseline, input, selections) {
  if (selections.some(selection => !selection.equipmentId)) return null;
  const policy = config.recommendationPolicy, reviewFlags = new Set(['proposed_combination_not_approved', 'reverify_procurement_prices_and_box_contents']);
  const counts = new Map(), materialCounts = new Map();
  const cameras = new Map(catalog.cameraItems.map(camera => [camera.id, camera]));
  for (const selection of selections) counts.set(selection.equipmentId, (counts.get(selection.equipmentId) ?? 0) + 1);
  const purchaseLines = [], equipment = [], storage = [];
  let observedCents = 0, planningPurchaseCents = 0;
  for (const [id, quantity] of counts) {
    const camera = cameras.get(id), purchase = bestPurchase(camera, quantity, catalog, input);
    if (!purchase) return null;
    observedCents = sum([observedCents, purchase.cents]);
    planningPurchaseCents = sum([planningPurchaseCents, purchase.planningCents]);
    equipment.push({ equipmentId: id, productId: camera.productId, modelNumber: camera.modelNumber, quantity,
      originalPlanningUnitCost: camera.costAssumption.originalPlanningAmount, editablePlanningUnitCost: camera.costAssumption.amount,
      observedSingleUnitPrice: camera.supplier.observedPrice, includedAccessories: [...camera.includedAccessories] });
    for (const option of purchase.options) {
      const line = purchaseLines.find(row => row.optionId === option.id);
      if (line) { line.purchaseQuantity++; line.totalCost = sum([usdCents(line.totalCost, option.id), usdCents(option.observedPrice, option.id)]) / 100; }
      else purchaseLines.push({ optionId: option.id, productId: option.productId, purchaseQuantity: 1,
        camerasPerPurchase: option.quantity, includedHub: option.includedHub, observedUnitPrice: option.observedPrice,
        planningUnitCost: option.planningCost, totalCost: option.observedPrice, sourceUrl: option.sourceUrl, priceCheckDate: option.priceCheckDate });
    }
    for (const materialId of camera.requiredMaterialIds) materialCounts.set(materialId, (materialCounts.get(materialId) ?? 0) + quantity);
    if (camera.solar.supported) {
      materialCounts.set('solar_initial_charging_materials', (materialCounts.get('solar_initial_charging_materials') ?? 0) + quantity);
    }
    if (purchase.installedHub) {
      storage.push({ equipmentId: id, strategy: 'required_homebase', hub: purchase.installedHub, storageGb: 16,
        existingHubUsed: purchase.existingHubUsed, storageCost: 0, costBasis: purchase.existingHubUsed ? 'verified_existing_hub' : 'included_in_purchase_total' });
      if (!purchase.existingHubUsed) materialCounts.set('homebase_installation_materials', 1);
      if (purchase.surplusHubs) reviewFlags.add(`unused_included_hubs:${purchase.surplusHubs}`);
      reviewFlags.add('homebase_storage_retention_and_firmware_review');
    } else {
      storage.push({ equipmentId: id, strategy: camera.storage.strategy, hub: null, storageGb: camera.storage.builtInStorageGb,
        existingHubUsed: false, storageCost: camera.storage.strategy === 'built_in' ? 0 : null,
        costBasis: camera.storage.strategy === 'built_in' ? 'included_in_camera' : 'micro_sd_material_line' });
    }
    if (purchase.surplusCameras) reviewFlags.add(`uninstalled_purchased_cameras:${id}:${purchase.surplusCameras}`);
    if (camera.supplier.observedPrice !== camera.costAssumption.amount) reviewFlags.add(`planning_vs_observed_price:${id}`);
    const profile = policy.profiles.find(row => row.equipmentId === id);
    for (const flag of profile.reviewFlags) reviewFlags.add(flag);
  }
  const materialDefinitions = new Map([...config.materialAssumptions, ...policy.additionalMaterials].map(row => [row.id, row]));
  let knownAccessoryCents = 0;
  const requiredMaterials = [...materialCounts].map(([id, quantity]) => {
    const definition = materialDefinitions.get(id), override = input.materialUnitCosts?.[id];
    const unitCost = override ? override.amount : definition.unitCost;
    const total = unitCost === null ? null : safeCentResult(usdCents(unitCost, id) * quantity);
    if (total !== null) knownAccessoryCents = sum([knownAccessoryCents, total]);
    return { materialId: id, name: definition.name, quantity, unitCost, totalCost: total === null ? null : total / 100,
      notes: override ? override.notes : definition.notes };
  });
  const microSd = requiredMaterials.find(row => row.materialId === 'camera_micro_sd_128gb');
  for (const row of storage) {
    if (row.strategy === 'standalone_micro_sd' && microSd.unitCost !== null) {
      row.storageCost = safeCentResult(usdCents(microSd.unitCost, 'microSD') * counts.get(row.equipmentId)) / 100;
    }
  }
  const missingCosts = requiredMaterials.filter(row => row.totalCost === null).map(row => row.materialId);
  const knownMaterials = sum([observedCents, knownAccessoryCents]);
  const taxPercent = input.salesTax ? input.salesTax.percent : policy.financialAssumptions.equipmentSalesTaxPercent;
  const equipmentTax = taxPercent === null ? null : percentOf(observedCents, taxPercent);
  const totalTax = taxPercent === null || missingCosts.length ? null : percentOf(knownMaterials, taxPercent);
  if (taxPercent === null) missingCosts.push('sales_tax_rate');
  const shipping = input.shipping?.amount ?? null;
  if (shipping === null) missingCosts.push('shipping');
  const shippingCents = shipping === null ? null : usdCents(shipping, 'shipping');
  const price = proposedPrice(policy, baseline, selections.length);
  const fee = price.amount === null ? null : percentOf(usdCents(price.amount, 'customer price'), policy.financialAssumptions.paymentProcessingPercent);
  const complete = missingCosts.length === 0;
  const directCost = complete ? sum([knownMaterials, totalTax, shippingCents]) : null;
  const remaining = directCost === null || fee === null ? null : safeCentResult(usdCents(price.amount, 'price') - directCost - fee);
  const scenarios = policy.financialAssumptions.illustrativeContributionCommissionPercents.map(percent => {
    const commission = remaining === null ? null : percentOf(Math.max(0, remaining), percent);
    return { percent, status: 'illustrative_not_approved_policy', repCommission: commission === null ? null : commission / 100,
      home2SmartContribution: commission === null ? null : safeCentResult(remaining - commission) / 100 };
  });
  if (missingCosts.length) reviewFlags.add('incomplete_cost_estimate');
  if (price.kind === 'unapproved_draft') reviewFlags.add('three_camera_price_unapproved');
  if (counts.size > 1) reviewFlags.add('mixed_system_storage_and_installation_review');
  if (counts.has('eufy_solocam_s340')) reviewFlags.add('premium_configuration_price_unapproved');
  if (remaining !== null && remaining < 0) reviewFlags.add('negative_pre_commission_contribution');
  const historical = baseline.costScenarios.find(row => row.id === 'residential_eufy_four_camera_example');
  if (selections.length === 4 && observedCents > usdCents(historical.equipmentCost, 'historical cost')) {
    reviewFlags.add('exceeds_unverified_historical_equipment_assumption');
  }
  if (selections.length === 4 && knownMaterials > sum([
    usdCents(historical.equipmentCost, 'historical equipment'), usdCents(historical.suppliesCostEstimate, 'historical supplies'),
  ])) reviewFlags.add('exceeds_unverified_historical_materials_assumption');
  return {
    equipment, purchasing: { optimizedBy: 'lowest_observed_catalog_price_covering_selected_camera_counts_and_compatible_hub',
      scope: 'verified_catalog_options_only_before_tax_shipping_and_unknown_materials', lines: purchaseLines,
      purchasedCameraCount: purchaseLines.reduce((total, line) => total + line.purchaseQuantity * line.camerasPerPurchase, 0),
      surplusCameraCount: purchaseLines.reduce((total, line) => total + line.purchaseQuantity * line.camerasPerPurchase, 0) - selections.length,
      observedEquipmentCost: observedCents / 100, planningPurchaseCost: planningPurchaseCents / 100 },
    storage, requiredMaterials, knownMaterialsCost: knownMaterials / 100,
    estimatedDirectMaterialsCost: requiredMaterials.some(row => row.totalCost === null) ? null : knownMaterials / 100,
    estimatedEquipmentSalesTax: equipmentTax === null ? null : equipmentTax / 100,
    estimatedMaterialsSalesTax: totalTax === null ? null : totalTax / 100, taxPercent, shipping,
    assumptionNotes: {
      salesTax: input.salesTax?.notes ?? policy.financialAssumptions.notes,
      shipping: input.shipping?.notes ?? 'Shipping cost is unknown; no free-shipping assumption.',
      taxation: 'Planning tax on all equipment and separately purchased materials, excluding shipping and installation service; verify jurisdiction and shipping taxability.',
    },
    totalEstimatedDirectCost: directCost === null ? null : directCost / 100, customerPrice: price,
    paymentProcessingFee: fee === null ? null : fee / 100, paymentProcessingPercent: 3,
    remainingBeforeCommission: remaining === null ? null : remaining / 100,
    illustrativeCommissionScenarios: scenarios, costingComplete: complete, missingCosts,
    contributionBasis: 'proposed_customer_amount_minus_materials_sales_tax_shipping_and_3_percent_processing',
    excludedExpenses: ['owner_installation_labor', 'technician_payroll', 'overhead', 'travel', 'insurance'],
    reviewFlags: [...reviewFlags],
  };
}

function recommendResidentialCameras(config, catalog, baseline, input) {
  validateRecommendationConfiguration(config, catalog, baseline);
  shape(inputShape, input, 'Homeowner consultation');
  if (new Set(input.locations.map(location => location.id)).size !== input.locations.length) throw new Error('Coverage location IDs must be unique.');
  if (input.existingHub.type === 'none' && (input.existingHub.compatibilityVerified === true || input.existingHub.availableCameraSlots > 0)) {
    throw new Error('A nonexistent HomeBase cannot have verified compatibility or available camera slots.');
  }
  if (input.budget !== null) usdCents(input.budget, 'budget');
  const policy = config.recommendationPolicy;
  const materialIds = new Set([...config.materialAssumptions, ...policy.additionalMaterials].map(row => row.id));
  for (const [id, cost] of Object.entries(input.materialUnitCosts ?? {})) {
    if (!materialIds.has(id)) throw new Error(`Unknown material input: ${id}`);
    if (cost.amount !== null) usdCents(cost.amount, id);
  }
  if (input.salesTax?.percent !== null && input.salesTax?.percent !== undefined) usdCents(input.salesTax.percent, 'sales tax percentage');
  if (input.shipping?.amount !== null && input.shipping?.amount !== undefined) usdCents(input.shipping.amount, 'shipping');
  const cameras = catalog.cameraItems;
  const evaluations = input.locations.map(location => {
    if (location.preferredEquipmentId !== null && !cameras.some(camera => camera.id === location.preferredEquipmentId)) {
      throw new Error(`Unknown preferred equipment: ${location.preferredEquipmentId}`);
    }
    const candidates = [], failures = new Set();
    for (const camera of cameras) {
      const profile = policy.profiles.find(row => row.equipmentId === camera.id);
      const reasons = candidateReasons(camera, profile, location, input);
      if (reasons.length === 0 && !bestPurchase(camera, 1, catalog, input)) reasons.push('no_verified_compatible_purchase_option_or_hub');
      if (reasons.length === 0) candidates.push({ camera, profile });
      else for (const reason of reasons) failures.add(reason);
    }
    return { location, candidates, failures: [...failures] };
  });
  const assignments = cheapest => evaluations.map(({ location, candidates, failures }) => {
    const ordered = [...candidates].sort((a, b) => rankCamera(a.camera, a.profile, location, input, input.locations.length, cheapest)
      - rankCamera(b.camera, b.profile, location, input, input.locations.length, cheapest)
      || a.camera.supplier.observedPrice - b.camera.supplier.observedPrice);
    const chosen = ordered[0];
    return {
      locationId: location.id, coverage: [...location.coverage], equipmentId: chosen?.camera.id ?? null,
      reasons: chosen ? [`meets_required_features_and_surveyed_power_connectivity`, chosen.profile.preference,
        cheapest ? 'lowest_known_single_camera_price_not_final_installed_cost' : 'configured_suitability_preference'] : [],
      candidates: ordered.map(row => row.camera.id),
      unverifiedConditions: chosen ? [...chosen.profile.reviewFlags] : failures,
    };
  });
  const cheapest = input.preferences.priority === 'budget';
  const locations = assignments(cheapest);
  const quote = buildQuote(config, catalog, baseline, input, locations);
  const alternatives = [];
  const alternativeLocations = assignments(!cheapest);
  if (alternativeLocations.map(row => row.equipmentId).join() !== locations.map(row => row.equipmentId).join()) {
    const alternativeQuote = buildQuote(config, catalog, baseline, input, alternativeLocations);
    alternatives.push({ strategy: cheapest ? 'configured_preferences' : 'lowest_known_single_camera_cost',
      locations: alternativeLocations, quote: alternativeQuote });
  }
  const reviewFlags = new Set(quote?.reviewFlags ?? ['no_complete_compatible_purchase_configuration']);
  if (input.preferences.storage === 'shared_homebase' && locations.some(row => row.equipmentId !== 'eufycam_e40')) {
    reviewFlags.add('requested_shared_storage_unresolved');
  }
  if (input.budget !== null && (quote?.customerPrice.amount === null || !quote || quote.customerPrice.amount > input.budget)) {
    reviewFlags.add('customer_budget_below_proposed_package_or_custom_quote');
  }
  if (input.budget !== null && quote?.customerPrice.kind === 'starting') reviewFlags.add('starting_price_not_budget_guarantee');
  for (const row of locations) if (!row.equipmentId) reviewFlags.add(`manual_location_review:${row.locationId}`);
  // A preferred camera that fails a hard requirement is not silently selected.
  for (const location of input.locations) {
    const selected = locations.find(row => row.locationId === location.id);
    if (location.preferredEquipmentId && location.preferredEquipmentId !== selected.equipmentId) {
      reviewFlags.add(`preferred_camera_not_selected:${location.id}`);
    }
  }
  const requiresCustomQuote = !quote || quote.customerPrice.kind === 'custom_quote'
    || input.locations.some(location => location.standardInstallation !== true)
    || locations.some(row => row.equipmentId === 'eufy_floodlight_e30' || row.equipmentId === 'eufy_solocam_s340')
    || reviewFlags.has('customer_budget_below_proposed_package_or_custom_quote')
    || reviewFlags.has('exceeds_unverified_historical_equipment_assumption')
    || reviewFlags.has('exceeds_unverified_historical_materials_assumption')
    || (quote?.remainingBeforeCommission !== null && quote?.remainingBeforeCommission < 0);
  const result = {
    status: 'proposed_pending_approval', comparisonOnly: true, recommendedCameraCount: input.locations.length,
    requiresManualReview: true, requiresCustomQuote, locations, quote, alternatives, reviewFlags: [...reviewFlags],
  };
  shape(outputShape, result, 'Homeowner recommendation output');
  return result;
}

module.exports = { validateRecommendationConfiguration, recommendResidentialCameras };
