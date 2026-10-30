const exact = require('./tv-financials.cjs');
const { usdCents } = require('../../pricing.cjs');

function validateLaunchPolicy(scenario, context) {
  const policy = scenario.launchPolicy;
  if (!policy) return;
  if (scenario.assumptions.minimumCompanyMarginPercent < 18) throw new Error('Launch policy cannot weaken the 18% contribution floor.');
  if (!scenario.tv.costModel) throw new Error('Launch policy requires the explicit compatible-TV cost model.');
  if (new Set(policy.cameraAllowances.map(row => row.quantity)).size !== 3
    || new Set(policy.futureExperiments.map(row => row.id)).size !== 4) throw new Error('Launch allowance quantities and experiment IDs must be unique.');
  for (const row of policy.cameraAllowances) if (row.cost.amount !== null) usdCents(row.cost.amount, 'camera incidentals');
  if (!policy.tvMaterialEquipmentIds.includes(scenario.tv.includedMountEquipmentId)
    || !policy.tvMaterialEquipmentIds.includes('wire_trak_raceway_54')) throw new Error('TV launch inclusions must reference the fixed mount and external raceway.');
  const materials = policy.tvMaterialEquipmentIds.map(id => {
    const snapshot = scenario.equipmentCostSnapshots.find(row => row.equipmentId === id);
    if (!snapshot) throw new Error(`Missing launch inclusion cost snapshot: ${id}`);
    return usdCents(snapshot.amount, id);
  });
  const allowance = context.catalog.costAllowances.find(row => row.id === policy.tvSuppliesAllowanceId);
  if (!allowance) throw new Error('Missing TV consumables catalog reference.');
  const modeled = scenario.tv.costModel.equipmentAndSuppliesPerTv.amount;
  if (modeled === null || materials.reduce((a, b) => a + b, 0) + usdCents(scenario.assumptions.allowances.tvSuppliesPerTv.amount, 'TV supplies')
    !== usdCents(modeled, 'TV materials')) throw new Error('TV launch material references must reconcile to the explicit combined cost assumption.');
  for (const id of policy.coveredCameraMaterialIds) {
    if (![...context.cameraConfig.materialAssumptions, ...context.cameraConfig.recommendationPolicy.additionalMaterials].some(row => row.id === id)) {
      throw new Error(`Unknown launch-covered material ID: ${id}`);
    }
  }
}

function enforceLaunchFloors(result, scenario) {
  if (!scenario.launchPolicy) return result;
  const value = result.exactFinancials?.companyContribution;
  const company = value === null || result.companyContribution === null ? null
    : value === undefined ? exact.fromMoney(result.companyContribution) : exact.fromExact(value);
  const belowDollars = company === null ? null : company < exact.fromMoney(scenario.launchPolicy.minimumCompanyContribution);
  const passes = belowDollars || result.belowMinimumCompanyMargin ? false
    : company === null || result.belowMinimumCompanyMargin === null ? null : true;
  const flags = new Set(result.flags);
  if (belowDollars) flags.add('company_contribution_below_dollar_floor');
  if (passes !== true || result.missingCosts.length) flags.add('manual_review_required_for_contribution_or_missing_costs');
  const reserveLine = result.expenseLines.find(row => row.id === 'service_reserve');
  const reserve = reserveLine?.exactAmount === undefined
    ? reserveLine?.amount === null || !reserveLine ? null : exact.fromMoney(reserveLine.amount)
    : reserveLine.exactAmount === null ? null : exact.fromExact(reserveLine.exactAmount);
  return {
    ...result, minimumCompanyContribution: scenario.launchPolicy.minimumCompanyContribution,
    belowMinimumCompanyContribution: belowDollars, passesContributionFloors: passes,
    serviceReserveHeld: exact.toMoney(reserve),
    companyRetainedIncludingReserve: company === null || reserve === null ? null : exact.toMoney(company + reserve),
    requiresCustomQuote: result.requiresCustomQuote || passes !== true || result.missingCosts.length > 0,
    flags: [...flags],
  };
}

function canUseLaunchModel(scenario, job, tvs) {
  return scenario.launchPolicy && tvs.every(({ tv, tier }) => !tv.customerSuppliedMount
    && tier.minInches === scenario.tv.costModel.minInches && tier.maxInches === scenario.tv.costModel.maxInches);
}

function quoteLaunch(scenario, job, context, tvs, initialFlags) {
  const policy = scenario.launchPolicy;
  if (job.tvCostOverrides || Object.keys(job.costOverrides ?? {}).length) {
    throw new Error('Launch combined allowances cannot be mixed with legacy TV cost overrides; use incidentalAllowance or a new scenario.');
  }
  if (job.allowanceCoverage && !job.cameraConsultation) throw new Error('Allowance coverage verification requires an actual camera consultation.');
  const flags = new Set(initialFlags), revenueLines = [], expenseLines = [];
  let custom = false, recommendation = null;
  const revenueParts = [];
  function expense(id, amount, taxable, notes, quantity = 1) {
    expenseLines.push(exact.expenseLine(id, amount, taxable, notes, quantity));
  }
  function dollars(cost, quantity = 1) { return cost.amount === null ? null : exact.fromMoney(cost.amount) * BigInt(quantity); }
  if (tvs.length) {
    const tvResult = exact.quoteTvModel(scenario, { ...job, customPrice: undefined }, tvs, flags);
    revenueLines.push(...tvResult.revenueLines);
    revenueParts.push(tvResult.exactFinancials.customerRevenue === null ? null : exact.fromExact(tvResult.exactFinancials.customerRevenue));
    expenseLines.push(...tvResult.expenseLines.filter(row => ['tv_equipment_and_supplies', 'additional_tv_job_allowance'].includes(row.id)));
    custom ||= tvResult.requiresCustomQuote;
    for (const flag of tvResult.flags) if (!flag.startsWith('company_contribution_')) flags.add(flag);
  }
  const count = job.cameraConsultation?.locations?.length ?? job.cameraPackageQuantity;
  if (job.cameraPackageQuantity && job.cameraConsultation && count !== job.cameraPackageQuantity) throw new Error('Consultation and camera quantity disagree.');
  const cameraOnly = job.cameraService === 'installation_only';
  const allowance = policy.cameraAllowances.find(row => row.quantity === count)?.cost;
  let cameraPrice = null, cameraIncidental = allowance ?? { amount: null, notes: 'No standard allowance for this camera scope.' };
  if (count) {
    if (cameraOnly) {
      if (job.cameraConsultation) throw new Error('Installation-only equipment requires a separate compatibility review, not equipment-inclusive recommendation.');
      const tier = context.baseline.prices.cameras.residentialWirelessInstallationOnly.find(row => row.quantity === count);
      cameraPrice = tier?.price ?? null;
      expense('customer_camera_installation_materials', null, true, 'Customer-supplied equipment; required materials and installation scope must be priced.');
      cameraIncidental = { amount: null, notes: 'Installation-only incidentals require a documented site-specific input.' };
      flags.add('customer_camera_compatibility_review_required'); custom = true;
    } else if (job.cameraConsultation) {
      const input = structuredClone(job.cameraConsultation);
      if (job.allowanceCoverage?.verified === true) {
        input.materialUnitCosts = { ...input.materialUnitCosts };
        for (const id of policy.coveredCameraMaterialIds) {
          if (input.materialUnitCosts[id]?.amount > 0) throw new Error(`Do not double count ${id}: it is explicitly covered by the incidental allowance.`);
          input.materialUnitCosts[id] = { amount: 0, notes: `Explicitly verified included in combined incidentals: ${job.allowanceCoverage.notes}` };
        }
      }
      const { recommendResidentialCameras } = require('../../camera-recommendations.cjs');
      recommendation = recommendResidentialCameras(context.cameraConfig, context.catalog, context.baseline, input);
      const cameraQuote = recommendation.quote;
      const standard = recommendation.locations.every(row => row.equipmentId === scenario.cameras.standardEquipmentId);
      const pack = standard && scenario.cameras.packages.find(row => row.quantity === count);
      cameraPrice = pack ? pack.price : cameraQuote?.customerPrice.amount ?? null;
      if (!cameraQuote) expense('unresolved_camera_configuration', null, true, 'No verified complete purchasing configuration.');
      else {
        expense('camera_equipment', exact.fromMoney(cameraQuote.purchasing.observedEquipmentCost), true, 'Current verified camera purchasing optimizer, not a forced S220 selection.');
        for (const material of cameraQuote.requiredMaterials) {
          const covered = policy.coveredCameraMaterialIds.includes(material.materialId) && job.allowanceCoverage?.verified === true;
          expense(material.materialId, material.unitCost === null ? null : exact.fromMoney(material.unitCost) * BigInt(material.quantity),
            !covered, covered ? 'Explicitly included in the documented combined incidental allowance.' : material.notes, material.quantity);
        }
        for (const flag of cameraQuote.reviewFlags) flags.add(`camera:${flag}`);
      }
      if (!standard) {
        cameraIncidental = { amount: null, notes: 'Premium/mixed camera installation incidentals are not established by the S220 budget allowance.' };
        custom = true; flags.add('premium_or_mixed_camera_cost_sensitive_custom_quote');
      }
      custom ||= recommendation.requiresCustomQuote;
    } else {
      const pack = scenario.cameras.packages.find(row => row.quantity === count);
      cameraPrice = pack?.price ?? context.baseline.prices.cameras.residentialEquipmentIncluded.find(row => row.quantity === count)?.priceFrom ?? null;
      if (pack) {
        const snapshot = scenario.equipmentCostSnapshots.find(row => row.equipmentId === scenario.cameras.standardEquipmentId);
        expense('camera_equipment', exact.fromMoney(snapshot.amount) * BigInt(count), true, 'S220 planning reference only, not site suitability approval.', count);
        flags.add('camera_reference_configuration_requires_site_and_allowance_verification');
      } else {
        expense('unresolved_camera_materials', null, true, 'Canonical starting price retained; exact equipment/materials require consultation.');
        custom = true;
      }
    }
    revenueLines.push({ id: 'camera_service', amount: cameraPrice, exactAmount: cameraPrice === null ? null : exact.exactString(exact.fromMoney(cameraPrice)),
      service: cameraOnly ? 'installation_only' : 'equipment_included', priceBasis: 'separate_camera_line_no_cross_category_discount' });
    revenueParts.push(cameraPrice === null ? null : exact.fromMoney(cameraPrice));
    if (job.incidentalAllowance && tvs.length) {
      const included = expenseLines.findIndex(row => row.id === 'additional_tv_job_allowance');
      expenseLines.splice(included, 1);
      expense('combined_order_incidentals', dollars(job.incidentalAllowance), false, job.incidentalAllowance.notes);
    } else {
      const cost = job.incidentalAllowance ?? cameraIncidental;
      expense('camera_incidentals', dollars(cost), false, cost.notes);
    }
  } else if (job.incidentalAllowance) {
    const included = expenseLines.findIndex(row => row.id === 'additional_tv_job_allowance');
    expenseLines.splice(included, 1);
    expense('additional_tv_job_allowance', dollars(job.incidentalAllowance), false, job.incidentalAllowance.notes);
  }
  if (tvs.length && count) flags.add(job.incidentalAllowance
    ? 'documented_combined_order_allowance_replaces_category_allowances'
    : 'conservative_added_category_allowances_no_shared_travel_savings_assumed');
  let revenue = revenueParts.includes(null) ? null : exact.sum(revenueParts);
  if (job.customPrice) {
    revenue = job.customPrice.amount === null ? null : exact.fromMoney(job.customPrice.amount);
    custom = true; flags.add('explicit_custom_price_not_approved');
  }
  const result = exact.finalizeExactQuote(scenario, job, { revenue, revenueLines, expenseLines, flags, custom, recommendation });
  return enforceLaunchFloors(result, scenario);
}

module.exports = { validateLaunchPolicy, enforceLaunchFloors, canUseLaunchModel, quoteLaunch };
