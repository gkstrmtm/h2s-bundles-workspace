'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sourceRoot = path.resolve(__dirname, '..', '..');

function packageForecastPolicy({ root = sourceRoot, output = path.join(root, 'backend', 'lib', 'generated', 'forecastBusinessPolicy.json') } = {}) {
  const pricingRoot = path.join(root, 'config', 'pricing');
  const profileFile = path.join(pricingRoot, 'forecast-business.v1.json');
  const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
  if (profile.schemaVersion !== 1 || profile.status !== 'internal_planning_only' || profile.activationAllowed !== false
    || profile.pricingSource !== 'home2smart.v2.json' || profile.payments.depositBps !== 2500
    || profile.payments.balanceBps !== 7500 || profile.payments.depositRounding !== 'ceiling_cent'
    || profile.nativeCommissionReference.automaticTransfers !== false) throw new Error('Invalid bounded forecast business profile.');
  const engine = require(path.join(pricingRoot, 'reconciliation', 'reconcile.cjs'));
  const context = engine.loadContext();
  engine.validate(context);
  const files = ['forecast-business.v1.json', profile.pricingSource, ...Object.values(context.canonical.references).filter(value => typeof value === 'string' && !/^[a-f0-9]{64}$/.test(value)),
    'reconciliation/reconcile.cjs', 'offers/residential/tv-financials.cjs'];
  const sourceHashes = Object.fromEntries([...new Set(files)].map(file => [file,
    crypto.createHash('sha256').update(fs.readFileSync(path.join(pricingRoot, ...file.split('/')))).digest('hex')]));
  const offers = [];
  for (const [service, groups] of Object.entries(context.canonical.prices)) for (const [group, tiers] of Object.entries(groups)) for (const tier of tiers) {
    const sized = tier.quantity === undefined;
    const selector = sized ? { inches: tier.maxInches ?? tier.minInches } : { quantity: tier.quantity };
    const suffix = sized ? `${tier.minInches ?? 1}-${tier.maxInches ?? 'plus'}` : String(tier.quantity);
    const options = group === 'commercialBundlesInstallationOnlyUpTo65Inches'
      ? { sameLocation: true, tvSizes: Array(tier.quantity).fill(65) } : {};
    const quote = engine.quoteTier(context, service, group, selector, options);
    const materialLines = quote.expenseLines.filter(line => !['payment_processing', 'service_reserve', 'travel_shipping'].includes(line.id));
    const exactSum = lines => {
      if (lines.some(line => line.exactAmount === null)) return null;
      const exact = require(path.join(pricingRoot, 'offers', 'residential', 'tv-financials.cjs'));
      return exact.exactString(lines.reduce((sum, line) => sum + exact.fromExact(line.exactAmount), 0n));
    };
    offers.push({
      id: `${service}.${group}.${suffix}`, service, group, market: group.startsWith('commercial') ? 'commercial' : 'residential',
      label: `${group.replace(/([a-z])([A-Z])/g, '$1 $2')} · ${sized ? suffix + ' inches' : tier.quantity + ' camera/TV units'}`,
      selector, equipmentSku: tier.equipmentId ?? (group === 'residentialWithStandardFixedMount' ? context.canonical.costPolicy.tvMountEquipmentId : ''),
      ownership: group.includes('EquipmentIncluded') || group === 'residentialWithStandardFixedMount' ? 'supplied' : 'customer_owned',
      priceKind: quote.proposedPrice.kind, amountCents: quote.proposedPrice.amount === null ? null : Math.round(quote.proposedPrice.amount * 100),
      materialsExact: exactSum(materialLines),
      travelExact: quote.expenseLines.find(line => line.id === 'travel_shipping')?.exactAmount ?? null,
      processingExact: quote.expenseLines.find(line => line.id === 'payment_processing')?.exactAmount ?? null,
      reserveExact: quote.exactReconciliation.serviceReserve,
      beforeCommissionExact: quote.exactFinancials.contributionBeforeCommission,
      commissionExact: quote.exactFinancials.commission,
      companyRetainedExact: quote.exactReconciliation.companyRetainedAfterTechnician,
      expenseLines: quote.expenseLines, passesContributionFloors: quote.passesContributionFloors,
      minimumPriceForFloors: quote.minimumPriceForFloors, missingCosts: quote.missingCosts, flags: quote.flags,
      scopeConditions: group === 'commercialBundlesInstallationOnlyUpTo65Inches' ? ['Same site; every TV at most 65 inches; customer-supplied TVs and brackets.'] : [],
      activationAllowed: false, bookable: false
    });
  }
  for (const entry of profile.defaultServices) if (!offers.some(offer => offer.id === entry.policyOfferId && offer.amountCents !== null)) throw new Error('Default forecast service is not in canonical V2.');
  const data = { ...profile, checkedDate: context.canonical.checkedDate, pricingStatus: context.canonical.status,
    assumptions: context.canonical.assumptions, sourceHashes, offers };
  const digest = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const serialized = JSON.stringify({ ...data, digest }, null, 2) + '\n';
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, serialized);
  return { digest, offerCount: offers.length, output };
}
if (require.main === module) {
  try { console.log(JSON.stringify(packageForecastPolicy())); }
  catch (error) { console.error('Forecast policy packaging failed: ' + error.message); process.exitCode = 1; }
}
module.exports = { packageForecastPolicy };
