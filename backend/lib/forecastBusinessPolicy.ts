import snapshot from '@/lib/generated/forecastBusinessPolicy.json';
import { BusinessError } from '@/lib/commercial_business';
import { defaultForecastScenario, validateForecastScenario, sumPolicyAmounts } from '@/lib/forecast';
import type { ForecastMarket, ForecastScenario } from '@/lib/forecast';

export type ForecastBusinessOffer = {
  id: string; label: string; market: string; equipmentSku: string; ownership: 'supplied' | 'customer_owned';
  priceKind: string; amountCents: number | null;
  materialsExact: string | null; travelExact: string | null; processingExact: string | null;
  reserveExact: string | null; commissionExact: string | null; beforeCommissionExact: string | null;
  companyRetainedExact: string | null; passesContributionFloors: boolean | null;
  minimumPriceForFloors: number | null; missingCosts: string[]; flags: string[]; scopeConditions: string[];
};
export type ForecastBusinessPolicy = {
  schemaVersion: number; id: string; digest: string; status: string; pricingSource: string; pricingStatus: string; checkedDate: string;
  activationAllowed: false;
  payments: { depositBps: number; balanceBps: number; depositRounding: string };
  assumptions: { processingPercent: number; serviceReservePercent: number; commissionPercent: number;
    materialsTaxPercent: number; minimumCompanyMarginPercent: number; minimumCompanyContribution: number; ownerInstallationLaborDeduction: false };
  operatingDefaults: Partial<ForecastMarket>;
  defaultServices: { id: string; policyOfferId: string; shareBps: number; jobMinutes: number }[];
  nativeCommissionReference: { basis: string; rates: { throughDay: number | null; basisPoints: number }[];
    reviewDay: string; automaticTransfers: false; notes: string };
  assumptionNotes: string[]; sourceHashes: Record<string, string>; offers: ForecastBusinessOffer[];
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
function validOffer(value: unknown): value is ForecastBusinessOffer {
  if (!record(value) || !['id','label','market','equipmentSku','priceKind'].every(key => typeof value[key] === 'string')
    || !['supplied','customer_owned'].includes(String(value.ownership))
    || (value.amountCents !== null && (!Number.isSafeInteger(value.amountCents) || Number(value.amountCents) < 0))
    || !['materialsExact','travelExact','processingExact','reserveExact','commissionExact','beforeCommissionExact','companyRetainedExact']
      .every(key => value[key] === null || typeof value[key] === 'string' && /^-?\d+(?:\.\d{1,14})?$/.test(value[key]))
    || value.passesContributionFloors !== null && typeof value.passesContributionFloors !== 'boolean'
    || !strings(value.missingCosts) || !strings(value.flags) || !strings(value.scopeConditions)) return false;
  return value.minimumPriceForFloors === null || typeof value.minimumPriceForFloors === 'number' && Number.isFinite(value.minimumPriceForFloors);
}
function assertPolicy(value: unknown): asserts value is ForecastBusinessPolicy {
  if (!record(value) || value.schemaVersion !== 1 || value.activationAllowed !== false || value.status !== 'internal_planning_only'
    || !['id','digest','pricingSource','pricingStatus','checkedDate'].every(key => typeof value[key] === 'string')
    || typeof value.digest !== 'string' || !/^[a-f0-9]{64}$/.test(value.digest)
    || !record(value.payments) || value.payments.depositBps !== 2500 || value.payments.balanceBps !== 7500
    || value.payments.depositRounding !== 'ceiling_cent' || !record(value.assumptions)
    || !['processingPercent','serviceReservePercent','commissionPercent','materialsTaxPercent','minimumCompanyMarginPercent','minimumCompanyContribution']
      .every(key => typeof value.assumptions === 'object' && value.assumptions !== null
        && typeof Reflect.get(value.assumptions, key) === 'number' && Number.isFinite(Reflect.get(value.assumptions, key)))
    || value.assumptions.ownerInstallationLaborDeduction !== false || !record(value.operatingDefaults)
    || !Array.isArray(value.defaultServices) || !value.defaultServices.length
    || !value.defaultServices.every(row => record(row) && typeof row.id === 'string' && typeof row.policyOfferId === 'string'
      && Number.isSafeInteger(row.shareBps) && Number.isSafeInteger(row.jobMinutes))
    || !record(value.nativeCommissionReference) || value.nativeCommissionReference.automaticTransfers !== false
    || value.nativeCommissionReference.reviewDay !== 'Friday' || typeof value.nativeCommissionReference.basis !== 'string'
    || typeof value.nativeCommissionReference.notes !== 'string' || !Array.isArray(value.nativeCommissionReference.rates)
    || !value.nativeCommissionReference.rates.every(row => record(row) && (row.throughDay === null || Number.isSafeInteger(row.throughDay))
      && typeof row.basisPoints === 'number' && Number.isInteger(row.basisPoints) && row.basisPoints >= 0 && row.basisPoints <= 10000)
    || !strings(value.assumptionNotes) || !record(value.sourceHashes)
    || !Object.values(value.sourceHashes).every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))
    || !Array.isArray(value.offers) || !value.offers.length || !value.offers.every(validOffer)
    || new Set(value.offers.map(offer => offer.id)).size !== value.offers.length) {
    throw new BusinessError('Canonical forecast business policy is invalid. No fallback pricing is used.',503);
  }
}
export function loadForecastBusinessPolicy(): ForecastBusinessPolicy {
  const value: unknown = snapshot;
  assertPolicy(value);
  return structuredClone(value);
}
export function canonicalForecastScenario(policy: ForecastBusinessPolicy): ForecastScenario {
  const scenario = defaultForecastScenario();
  scenario.policyMode = 'canonical_v2';
  const market = scenario.markets[0];
  Object.assign(market, policy.operatingDefaults);
  market.services = policy.defaultServices.map(row => ({ id:row.id,label:row.id,shareBps:row.shareBps,jobMinutes:row.jobMinutes,
    ownership:'customer_owned',price:{kind:'canonical',amountCents:null,policyOfferId:row.policyOfferId},materialsCents:null }));
  return applyForecastBusinessPolicy(scenario, policy);
}
export function applyForecastBusinessPolicy(input: ForecastScenario, policy: ForecastBusinessPolicy): ForecastScenario {
  const scenario = validateForecastScenario(input);
  if (!scenario.policyMode) throw new BusinessError('This scenario is not linked to the business policy. Reload the V2 defaults or explicitly choose a custom hypothesis.',409);
  if (scenario.policyMode === 'hypothetical') {
    if (scenario.markets.some(m => [...m.services,...m.baselineServices || []].some(row => row.price.kind === 'canonical'))) {
      throw new BusinessError('Canonical V2 services require the canonical business model.');
    }
    return scenario;
  }
  for (const market of scenario.markets) {
    market.processingBps = Math.round(policy.assumptions.processingPercent * 100);
    market.processingFixedCents = 0;
    for (const row of [...market.services,...market.baselineServices || []]) {
      const offer = policy.offers.find(item => item.id === row.price.policyOfferId && item.market === market.context.property);
      if (row.price.kind !== 'canonical' || !offer) throw new BusinessError('Choose an exact V2 service scope for this market. Unsupported equipment/quantities require a custom quote.');
      row.price = { kind:'canonical',amountCents:offer.amountCents,policyOfferId:offer.id };
      row.label = offer.label;
      row.ownership = offer.ownership;
      if (offer.equipmentSku) row.equipmentSku = offer.equipmentSku; else delete row.equipmentSku;
      row.materialsCents = sumPolicyAmounts([{amount:offer.materialsExact,count:1}]);
    }
  }
  return validateForecastScenario(scenario);
}
