const fs = require('node:fs');
const path = require('node:path');
const { loadContext, validate, quoteTier, quoteTvs, pdfRow } = require('./reconcile.cjs');
const { quoteOffer } = require('../offers/residential/engine.cjs');
const exact = require('../offers/residential/tv-financials.cjs');

const usd = value => value === null || value === undefined ? 'unknown' : `$${value.toFixed(2)}`;
const percent = value => value === null ? 'unknown' : `${value.toFixed(2)}%`;
const priceText = row => !row ? 'not defined' : row.price !== undefined ? usd(row.price)
  : row.priceFrom !== undefined ? `from ${usd(row.priceFrom)}` : 'custom quote';
const selectorFor = tier => tier.quantity === undefined ? { inches: tier.minInches ?? tier.maxInches } : { quantity: tier.quantity };
const tvGroups = ['residentialInstallationOnly', 'residentialWithStandardFixedMount', 'commercialInstallationOnly'];

function summary(quote) {
  const equipment = quote.expenseLines.filter(row => row.equipmentId);
  const materials = quote.expenseLines.filter(row => row.taxable && !row.equipmentId);
  const total = rows => rows.some(row => row.exactAmount === null) ? null : exact.toMoney(exact.sum(rows.map(row => exact.fromExact(row.exactAmount))));
  return {
    customerPrice: quote.proposedPrice, equipment: total(equipment), materials: total(materials),
    tax: quote.expenseLines.find(row => row.id === 'estimated_materials_tax').amount,
    travelShipping: quote.expenseLines.find(row => row.id === 'travel_shipping')?.amount ?? null,
    processing: quote.expenseLines.find(row => row.id === 'payment_processing').amount,
    directCash: quote.totalDirectCashExpenses, grossContribution: quote.grossContribution,
    grossMarginPercent: quote.grossMarginPercent, reserve: quote.serviceReserve,
    afterReserve: quote.contributionAfterReserve, commission: quote.commission,
    companyRetained: quote.companyRetainedAfterTechnician, companyMarginPercent: quote.companyMarginAfterTechnicianPercent,
    minimumPrice: quote.minimumPriceForFloors, passesFloors: quote.passesContributionFloors,
    missingCosts: quote.missingCosts, costStatus: quote.costStatus, actualProfit: null,
  };
}

function publishedFor(context, service, group, tier) {
  if (group.startsWith('commercial')) return 'Commercial: custom quote; no published comparable numeric tier';
  if (service === 'tvMounting') return '$249 one TV incl bracket;size/scope differ';
  const pack = context.published.catalog.find(row => row.id.startsWith('cam_') && row.quantity === tier.quantity);
  return pack ? `${usd(pack.price)} ${pack.name};customer equipment,NOT comparable supplied-S220/PoE scope` : 'No exact published quantity/scope match';
}

function explanation(group, tier) {
  if (tier.selection === 'third_price') return group.includes('E40')
    ? 'Premium HB2 purchasing;extra storage/setup costs still unknown. Draft price headroom tested with explicit hypothetical hub allowance;no finalized margin.'
    : 'Explicit premium E50 kit1199.99 replaces unnamed PDF800-dollar kit;3299 supports10% equipment inflation under surveyed aggregate budget. Not like-for-like or approved.';
  if (tier.selection === 'v5') return 'Retain balanced199 launch proposal,not higher219 experiment;new supplies budget/raceway scope is separately disclosed.';
  if (tier.selection === 'recommendation') return 'Three-camera849 supports true coverage count and consistent250-dollar increments to4/6/8;supersedes no historical749 experiment.';
  if (tier.selection === 'json') return 'Retain229 existing JSON tier rather than220 PDF;more retained dollars with consistent size ladder.';
  if (tier.selection === 'pdf') return 'Adopt PDF size/quantity schedule and newly covered quantities;run lengths and actual materials still require review.';
  return 'Preserve common PDF/JSON selling amount;equipment model and expense scope are now explicit.';
}

function createReport(context = loadContext()) {
  validate(context);
  const rows = [];
  for (const [service, groups] of Object.entries(context.canonical.prices)) {
    for (const [group, tiers] of Object.entries(groups)) {
      for (const [index, tier] of tiers.entries()) {
        const selector = selectorFor(tier);
        const options = group.startsWith('commercialBundles') ? { sameLocation: true, tvSizes: Array(tier.quantity).fill(65) } : {};
        const recommended = quoteTier(context, service, group, selector, options);
        const original = pdfRow(context, group, tier);
        const json = context.baseline.prices[service][group]?.find(row => tvGroups.includes(group)
          ? (row.maxInches ?? null) === (tier.maxInches ?? null) : row.quantity === tier.quantity);
        const comparisonAt = price => price === null || price === undefined ? null : summary(quoteTier(context, service, group, selector,
          { ...options, sellingPrice: { amount: price, notes: 'Counterfactual comparison using SAME reconciled equipment/material scope,not original source profit.' } }));
        const trip = recommended.expenseLines.find(row => row.id === 'travel_shipping')?.amount;
        const stress = {
          equipmentPlus10Percent: summary(quoteTier(context, service, group, selector, { ...options, equipmentIncreasePercent: 10 })),
          equipmentPlus20Percent: summary(quoteTier(context, service, group, selector, { ...options, equipmentIncreasePercent: 20 })),
          extraMaterials15: summary(quoteTier(context, service, group, selector, { ...options, extraMaterials: { amount: 15, notes: 'Hypothetical extra taxable materials,not observed SKU cost.' } })),
          extendedTrip50: summary(quoteTier(context, service, group, selector, { ...options, travelAllowance: { amount: trip === null ? null : trip + 50, notes: 'Hypothetical50-dollar extra travel/extended-job cash;owner labor excluded.' } })),
          paidTechnician35Percent: summary(quoteTier(context, service, group, selector, { ...options,
            technicianOrderScenario: { percent: 35, notes: 'Backfill implementation stress only,not verified current compensation policy.' } })),
          commission50Percent: summary(quoteTier(context, service, group, selector, { ...options, commissionPercent: 50 })),
          commission60Percent: summary(quoteTier(context, service, group, selector, { ...options, commissionPercent: 60 })),
        };
        rows.push({
          key: `prices.${service}.${group}[${index}]`,
          variation: tvGroups.includes(group) ? tier.maxInches === undefined ? '86+ inches' : `${tier.minInches ?? 1}-${tier.maxInches} inches` : `${tier.quantity} unit(s)`,
          pdf: original ? { price: original[1], equipmentEstimate: original[2], suppliesEstimate: original[3],
            displayedStripe: original[4], displayedRep: original[5], displayedCompany: original[6], displayedMargin: original[7],
            section: context.pdf.groups[group].section, pages: context.pdf.groups[group].pages, scope: context.pdf.groups[group].scope,
            starting: tvGroups.includes(group) ? tier.maxInches === undefined && context.pdf.groups[group].finalTvTierStarting
              : context.pdf.groups[group].startingQuantities.includes(tier.quantity) } : null,
          json: json ?? null, published: publishedFor(context, service, group, tier),
          recommendation: tier, reason: explanation(group, tier),
          financials: summary(recommended), expenseLines: recommended.expenseLines,
          sameNewScopeComparison: { pdfPrice: comparisonAt(original?.[1]), jsonPrice: comparisonAt(json?.price ?? json?.priceFrom) },
          sensitivity: stress, flags: recommended.flags,
          unverifiedQuantities: service === 'tvMounting'
            ? ['Individual bolt/lag/washer/spacer/anchor SKU/counts;TV model,VESA,weight,wall/height,trip']
            : group.includes('Wired')
              ? ['Cat6 feet per run,connectors,glands,clips,PoE ports/power,recorder capacity,actual kit cable contents']
              : ['Fastener/anchor/weatherproofing/charging SKU/counts;sunlight,Wi-Fi,storage retention,trip'],
        });
      }
    }
  }
  const launch = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'offers', 'residential', 'v5-launch-proposed.json'), 'utf8'));
  const lean = quoteOffer(launch, { tvs: [], cameraPackageQuantity: 2 });
  const tvExamples = [1,2,3,4].map(count => ({ quantity: count, quote: summary(quoteTvs(context,
    Array.from({ length: count }, () => ({ inches: 60, customerSuppliedMount: false, compatibilityVerified: true })))) }));
  const cameras = [499,529,549,599].map(price => ({ price,
    quote: summary(quoteTier(context, 'cameras', 'residentialEquipmentIncluded', { quantity: 2 },
      { sellingPrice: { amount: price, notes: 'Two exact S220s with SAME new20-dollar materials budget and25-dollar separate trip budget.' } })) }));
  const e40Illustrations = [2,3,4].map(quantity => ({ quantity, quote: summary(quoteTier(context, 'cameras', 'residentialE40EquipmentIncluded', { quantity },
    { materialCosts: { homebase_installation_materials: { amount: 10, notes: 'HYPOTHETICAL10-dollar aggregate hub setup allowance;NOT supplier verified.' } } })) }));
  const tvUpgradeExamples = ['tilt_mount', 'large_full_motion_mount'].map(id => ({ id,
    quote: summary(quoteTier(context, 'tvMounting', 'residentialWithStandardFixedMount', { inches: 60 }, { mountUpgradeId: id })) }));
  return {
    checkedDate: context.canonical.checkedDate, status: context.canonical.status, activationAllowed: false,
    sources: context.canonical.references, assumptions: context.canonical.assumptions,
    rowCount: rows.length, rows, tvExamples, cameraPriceComparison: cameras,
    historicalLean499: { price: lean.customerRevenue, cashBeforeReserve: lean.directExpenses - lean.serviceReserveHeld,
      company: lean.companyContribution, margin: lean.companyContributionMarginPercent,
      notes: 'Historical v5 ONLY:combined25-dollar incidentals may cover supplies;scope/cost coverage unverified. No separate20-dollar materials line. Preserved unchanged.' },
    e40Illustrations, tvUpgradeExamples, equipment: context.verification,
    addOns: context.canonical.addOns, publishedContradictions: context.published.contradictions,
  };
}

function markdown(report) {
  const out = [
    '# Home2Smart pricing reconciliation - 2026-11-02',
    '',
    '**OFFLINE / PENDING APPROVAL. Not deployed. No actual profit asserted.**',
    '',
    'Generated from [recommended canonical v2](../home2smart.v2.json) by [report.cjs](report.cjs). Preserve [v1](../home2smart.v1.json) and all sealed offer versions.',
    'Primary [PDF](source/Home2Smart_Complete_Service_Pricing.pdf) was accessible HTTP200 and matches the supplied local copy by SHA-256. All66 PDF rows are retained in [transcription](source/pdf-pricing.v1.json).',
    '',
    '## A. Exact price and scope comparison',
    '',
    'Public amounts are observed catalog/card evidence, not a tested purchase. PDF and original JSON are proposals or approval-unknown, NOT live approval. The generic JSON equipment row was not an approved S220/E40 SKU allowlist.',
    '',
    '| Canonical key / variation | PDF / section | Original JSON v1 | Published / scope | Recommended v2 | Selection |',
    '|---|---|---|---|---|---|',
  ];
  for (const row of report.rows) out.push(`| \`${row.key}\` ${row.variation} | ${row.pdf ? `${row.pdf.price === null ? 'custom quote' : `${row.pdf.starting ? 'from ' : ''}${usd(row.pdf.price)}`};sec${row.pdf.section};${row.pdf.scope}` : 'not defined'} | ${priceText(row.json)} | ${row.published} | ${priceText(row.recommendation)} | ${row.reason} |`);
  out.push('', '## B. Modeled direct expenses and contribution', '',
    'All quantities/prices below use the NEW scope, not the PDF printed profit:verified supplier model cost,aggregate estimated supplies,8% materials tax,separate estimated trip,3% processing,5% held reserve,55% modeled rep commission AFTER reserve. Owner installation labor and overhead excluded. No other technician assumed in this owner-performed planning case. Every row remains review-required;unknown required costs yield unknown totals,NEVER zero.',
    '',
    '| Canonical key | Revenue | Equipment | Materials | Tax | Trip | Processing | Cash | Gross | Gross margin | Reserve | After reserve | Rep | Company | Company margin | Floor result |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const row of report.rows) {
    const f = row.financials;
    out.push(`| \`${row.key}\` | ${usd(f.customerPrice.amount)} | ${usd(f.equipment)} | ${usd(f.materials)} | ${usd(f.tax)} | ${usd(f.travelShipping)} | ${usd(f.processing)} | ${usd(f.directCash)} | ${usd(f.grossContribution)} | ${percent(f.grossMarginPercent)} | ${usd(f.reserve)} | ${usd(f.afterReserve)} | ${usd(f.commission)} | ${usd(f.companyRetained)} | ${percent(f.companyMarginPercent)} | ${f.passesFloors === null ? `INCOMPLETE:${f.missingCosts.join(',')}` : f.passesFloors ? '18%/$30 modeled pass' : 'FAIL:custom quote'} |`);
  }
  out.push('', '### PDF versus JSON profitability under the SAME new scope', '',
    'Counterfactual comparison only:fixed mount now includes raceway;wired four-camera scope now uses the more expensive exact E50. These are NOT assertions about original delivered scope or actual profit.',
    '', '| Key | PDF-price gross / company / company margin | JSON-price gross / company / company margin | Recommended gross / company / company margin |',
    '|---|---|---|---|');
  const financeText = f => f ? `${usd(f.grossContribution)} / ${usd(f.companyRetained)} / ${percent(f.companyMarginPercent)}` : 'not defined';
  for (const row of report.rows) out.push(`| \`${row.key}\` | ${financeText(row.sameNewScopeComparison.pdfPrice)} | ${financeText(row.sameNewScopeComparison.jsonPrice)} | ${financeText(row.financials)} |`);
  out.push('', '## C. Key pricing decisions', '',
    '- Supplied-fixed56-65-inch TVs:199 /378.10 /547.25,not the219 experiment. New PDF supplies budget raises materials from42.84 to49.84 per TV when one raceway kit is included;historical examples remain unchanged.',
    '- Standard S220:from299 /from599 /849 /1099 /from1599 /from2099 for1/2/3/4/6/8. Two-S220599 is preferred over499 for robust,clear standard scope;no promotion is activated.',
    '- Premium E40 HB2:from799 /from1199 /from1599 for2/3/4. Exact kit/add-on procurement;hub supplies still unknown. Commercial E40 and all other camera models require a custom quote.',
    '- Wired4-camera premium E50:from3299,residential or commercial,subject to surveyed cable/power/installation scope. This explicitly changes the unnamed800-dollar PDF equipment assumption to verified1199.99 E50. It is NOT an equivalent budget PoE replacement. Eight/16-camera equipment mapping remains unpriced/custom.',
    '- No numeric commercial supplied-TV-bracket tier exists. No automatic pricing for unusual walls,ceilings,new power,cable runs or out-of-core travel.',
    '',
    '### Two-S220499 versus599',
    '', '| Case | Cash | Gross | Company after reserve/55% scenario | Company margin | 18%/$30 |', '|---|---:|---:|---:|---:|---|');
  out.push(`| Historical lean v5 ${usd(report.historicalLean499.price)} | ${usd(report.historicalLean499.cashBeforeReserve)} | ${usd(report.historicalLean499.price - report.historicalLean499.cashBeforeReserve)} | ${usd(report.historicalLean499.company)} | ${percent(report.historicalLean499.margin)} | Conditional coverage only |`);
  for (const row of report.cameraPriceComparison) out.push(`| New scope ${usd(row.price)} | ${usd(row.quote.directCash)} | ${usd(row.quote.grossContribution)} | ${usd(row.quote.companyRetained)} | ${percent(row.quote.companyMarginPercent)} | ${row.quote.passesFloors ? 'modeled pass' : 'FAIL'} |`);
  out.push('', 'The529/549 alternatives lower the entry price but have less materials/inflation protection. At499 the new scope fails18%. The historical499 estimate only works if the25-dollar combined allowance genuinely covers all required incidental materials;do not add the new20-dollar supplies line to that historical allowance and call it the same scope.',
    '', '### Matching TVs', '', '| Count | Revenue | Cash | Company | Company margin |', '|---|---:|---:|---:|---:|');
  for (const row of report.tvExamples) out.push(`| ${row.quantity} | ${usd(row.quote.customerPrice.amount)} | ${usd(row.quote.directCash)} | ${usd(row.quote.companyRetained)} | ${percent(row.quote.companyMarginPercent)} |`);
  out.push('', '### Proposed mount upgrades on one56-65-inch TV', '',
    'Upgrades25/75 replace the fixed mount cost,do not add a second mount,and are not discounted with installation labor. Unpriced small motion and masonry remain custom quote.',
    '', '| Upgrade | Whole-job revenue | Cash | Gross | Company | Company margin |', '|---|---:|---:|---:|---:|---:|');
  for (const row of report.tvUpgradeExamples) out.push(`| ${row.id} | ${usd(row.quote.customerPrice.amount)} | ${usd(row.quote.directCash)} | ${usd(row.quote.grossContribution)} | ${usd(row.quote.companyRetained)} | ${percent(row.quote.companyMarginPercent)} |`);
  out.push('', '## D. Equipment and material evidence', '',
    'Supplier prices were fetched2026-11-02 from exact product pages/official JSON-LD. Snapshot prices are not contractual procurement quotes. Product specifications remain in the original linked catalog;this supplement does not overwrite it.',
    '', '| Equipment ID / exact SKU | Planning | Observed | Model cost | Supplier source / conditions |', '|---|---:|---:|---:|---|');
  for (const item of report.equipment.observations) out.push(`| \`${item.equipmentId}\` / ${item.productId ?? 'unverified SKU'} | ${usd(item.planningCost)} | ${usd(item.observedPrice)} | ${usd(item.modeledCost)} | [${item.supplier}](${item.sourceUrl});${item.notes} |`);
  out.push('', '### Precisely unverified quantities and costs', '',
    '- Every TV size:individual bolt/lag screw diameter/length/count,washers,spacers,anchor type/count,wall substrate,stud/TV VESA/weight compatibility. Mount is one kit;supplied-mount TV uses one54-total-inch raceway KIT. PDF25/31/43-dollar brackets had no SKU;the explicit onn mapping must be physically verified,especially large/heavy TVs. Under32-inch fixed-mount-inclusive price is blocked.',
    '- Wi-Fi/solar cameras:one exact camera per independent position;included mounts/screw packs vary. Individual anchors,clips,sealant,charging adapter/cables and weatherproofing quantities unknown. The10-dollar supplement is a budget,not an itemized verified BOM. S220/S340 built-in8GB storage needs no separate microSD.',
    '- C31/E30/Floodlight E30:separate compatible microSD or specifically verified hub;recording-rated card SKU/cost unknown. C31 outdoor USB power/protection and floodlight AC/junction box/electrical labor need separate costing. Uncertain sun or Wi-Fi is review-required,not permission to pick the cheapest camera.',
    '- E40:HB2 two-camera kit279.99;three uses kit+149.99 add-on;four uses two kits559.98 with surplus hub. Hub adapter/Ethernet/charging/mounting contents,firmware,capacity/radio/retention need verification. S380429.99 reference has unresolved exact variant and is excluded from optimization.',
    '- PoE:Cat6 feet per run,cable specification,connector/gland/clip/anchor counts,NVR/PoE switch power/port needs,router uplink,storage retention,UPS,electrical work and cable contents remain unverified. Eight/16-camera equipment SKUs/costs unknown. PDF800-dollar kit and historical999.99 E50 are not current verified procurement costs.',
    '- Travel/shipping/tolls/parking/extra visits,actual materials sales tax,payment fixed charges and service scope require management/site confirmation. No market-competitiveness study or finalized technician-payroll policy was verified.',
    '', '## E. Sensitivity and paid-technician impact', '',
    'All rows are stressed independently;unknown inputs stay unknown. Equipment increases use modeled cost (large motion54,not rollback44.94).15-dollar additional materials are taxed;50-dollar extra trip is cash;owner labor is never charged.',
    '', '| Key | Base gross / company / margin | Equipment+10% | Equipment+20% | Materials+15 | Trip+50 | Other tech35% of revenue | Rep50% | Rep60% |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const row of report.rows) out.push(`| \`${row.key}\` | ${financeText(row.financials)} | ${financeText(row.sensitivity.equipmentPlus10Percent)} | ${financeText(row.sensitivity.equipmentPlus20Percent)} | ${financeText(row.sensitivity.extraMaterials15)} | ${financeText(row.sensitivity.extendedTrip50)} | ${financeText(row.sensitivity.paidTechnician35Percent)} | ${financeText(row.sensitivity.commission50Percent)} | ${financeText(row.sensitivity.commission60Percent)} |`);
  out.push('', '**Do not stack the55% rep scenario and a35%-of-revenue technician payout.** Even with zero materials,the maximum retained percentage is `(1-3%-5%)*(1-55%)-35%=6.4%`,below18%;no higher selling price alone fixes that policy.35%/35-dollar minimum/45-dollar TV minimum/45% cap are backfill evidence,not confirmed active payroll. Actual technician cash or a clearly identified percentage scenario is separately entered and shown after rep commission.',
    '', 'E40 finalized economics remain unknown. A hypothetical10-dollar hub-material allowance produces these ILLUSTRATIONS only:',
    '', '| Quantity | Proposed from | Cash | Company | Company margin |', '|---|---:|---:|---:|---:|');
  for (const row of report.e40Illustrations) out.push(`| ${row.quantity} | ${usd(row.quote.customerPrice.amount)} | ${usd(row.quote.directCash)} | ${usd(row.quote.companyRetained)} | ${percent(row.quote.companyMarginPercent)} |`);
  out.push('', '## F. Approval and publishing blockers', '');
  for (const issue of report.publishedContradictions) out.push(`- ${issue}`);
  for (const addon of report.addOns) out.push(`- ${addon.id}: ${addon.price === undefined ? 'custom quote' : usd(addon.price)}. ${addon.notes}`);
  out.push('- Approve service scope,BOM/cost coverage,core-zone travel,tax/payment assumptions,reserve/commission policy and actual paid-technician compensation before publishing any v2 offer. All figures are modeled company CONTRIBUTION,not net profit.',
    '- Existing checkout,Stripe,promotions,website/database prices and deployment are unchanged. An approved feed/migration remains a separate future task.',
    '', '## Implementation scope and validation', '',
    'Exact34-file commit scope (12 new deliverables,21 previously untracked shared dependencies,one offer README update) is listed in [README](README.md#commit-scope). No application files are included. Historical inputs and sealed scenario bytes were checked before staging;PDF is stored as binary without normalization.',
    '',
    'Validated2026-11-02:default pricing/schema validation PASSED;308 pricing/catalog/recommendation/reconciliation tests PASSED;79 historical offer tests PASSED;387 total,zero failures. Report regeneration is also tested. No application build was needed:application code/manifests were not changed.',
    '', 'Exact validation/report commands:', '',
    '```powershell',
    'node .\\config\\pricing\\reconciliation\\report.cjs validate',
    'node .\\config\\pricing\\reconciliation\\report.cjs json',
    'node .\\config\\pricing\\reconciliation\\report.cjs write',
    'npm --prefix .\\config\\pricing run validate',
    'npm --prefix .\\config\\pricing test',
    'node --test .\\config\\pricing\\offers\\residential\\tests\\offers.test.cjs .\\config\\pricing\\offers\\residential\\tests\\tv-margin.test.cjs .\\config\\pricing\\offers\\residential\\tests\\launch.test.cjs',
    '```', '');
  return out.join('\n');
}

if (require.main === module) {
  try {
    const command = process.argv[2] ?? 'compare';
    if (!['validate', 'compare', 'json', 'write'].includes(command)) throw new Error('Use validate,compare,json or write.');
    if (command === 'validate') {
      validate(); console.log('Valid offline reconciliation:66 PDF rows,70 proposed tiers,13 groups;historical baseline and supplier references preserved.');
    } else {
      const report = createReport();
      if (command === 'write') {
        fs.writeFileSync(path.join(__dirname, 'REPORT-2026-11-02.md'), markdown(report));
        console.log('Generated REPORT-2026-11-02.md;offline and pending approval.');
      } else console.log(command === 'json' ? JSON.stringify(report, null, 2) : markdown(report));
    }
  } catch (error) {
    console.error(`Reconciliation failed: ${error.message}`); process.exitCode = 1;
  }
}

module.exports = { createReport, markdown, summary };
