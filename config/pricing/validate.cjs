const fs = require('node:fs');
const path = require('node:path');
const { validateBaseline, validatePromotions, validateEquipmentCatalog, validateCameraConfiguration, calculateCameraPackage } = require('./pricing.cjs');
const { validateRecommendationConfiguration } = require('./camera-recommendations.cjs');

try {
  const [baselinePath = path.join(__dirname, 'home2smart.v1.json'),
    promotionsPath = path.join(__dirname, 'promotions', 'experiments.v1.json'),
    equipmentPath = path.join(__dirname, 'equipment.v1.json'), camerasPath] = process.argv.slice(2);
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const promotions = JSON.parse(fs.readFileSync(promotionsPath, 'utf8'));
  const equipment = JSON.parse(fs.readFileSync(equipmentPath, 'utf8'));
  validateBaseline(baseline);
  validatePromotions(promotions, baseline);
  validateEquipmentCatalog(equipment, baseline);
  const cameras = equipment.cameraConfiguration
    ? JSON.parse(fs.readFileSync(camerasPath ?? path.join(path.dirname(equipmentPath), equipment.cameraConfiguration.file), 'utf8'))
    : null;
  if (camerasPath && !equipment.cameraConfiguration) throw new Error('An explicit camera configuration requires a catalog link.');
  if (cameras) validateCameraConfiguration(cameras, equipment, baseline);
  if (cameras?.recommendationPolicy) validateRecommendationConfiguration(cameras, equipment, baseline);
  const groups = Object.values(baseline.prices).flatMap(service => Object.values(service));
  console.log(`Valid proposed baseline: ${groups.length} separate price groups, ${groups.reduce((sum, rows) => sum + rows.length, 0)} tiers, ${baseline.costScenarios.length} unverified cost scenarios.`);
  console.log(`Valid experimental overlay: ${promotions.offers.length} inactive offer(s). No application prices or promotions activated.`);
  console.log(`Valid proposed equipment catalog: ${equipment.items.length} supplier items, ${equipment.costAllowances.length} estimated allowance(s), ${equipment.customerUpgrades.length} inactive upgrade(s); supplier and baseline price references checked.`);
  if (cameras) {
    console.log(`Valid residential camera standard: ${equipment.cameraItems.length} camera records, ${cameras.packages.length} inactive draft packages.`);
    if (cameras.recommendationPolicy) console.log(`Valid homeowner recommendation policy: quantities 1/2/3/4, ${equipment.purchasingOptions.length} distinct E40 purchasing references; illustrative financials only.`);
    for (const draft of cameras.packages) {
      const result = calculateCameraPackage(cameras, equipment, baseline, draft.id);
      console.log(`Draft ${draft.id}: equipment $${result.equipmentCost.toFixed(2)}; ${result.customerPrice.kind} customer price $${result.customerPrice.amount.toFixed(2)}; materials ${result.costingComplete ? 'costed' : 'INCOMPLETE'}; manual review required.`);
    }
  }
  if (process.argv.length === 2) {
    require('./reconciliation/reconcile.cjs').validate();
    console.log('Valid linked reconciliation: all 66 PDF rows covered, 70 pending tiers. No live price or compensation changes.');
  }
} catch (error) {
  console.error(`Pricing validation failed: ${error.message}`);
  process.exitCode = 1;
}
