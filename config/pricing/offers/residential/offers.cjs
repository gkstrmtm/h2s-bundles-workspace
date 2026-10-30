const fs = require('node:fs');
const path = require('node:path');
const { loadContext, loadScenario, validateScenario, compareVersions, projectMonth, createVersion, recordReview, validateReview, hash } = require('./engine.cjs');

function run(args) {
  const [command = 'compare', ...rest] = args;
  const context = loadContext();
  if (command === 'validate') {
    if (rest.length) throw new Error('Usage: offers.cjs validate');
    const files = fs.readdirSync(__dirname).filter(file => /^v[1-9][0-9]*-[a-z][a-z0-9-]*\.json$/.test(file));
    const versions = files.map(file => loadScenario(path.basename(file, '.json')));
    const ids = new Set(versions.map(row => row.id));
    if (!ids.has('v1-original') || !ids.has('v2-margin-protected')) throw new Error('Both original historical offer versions must be preserved.');
    const numbers = versions.map(row => Number(row.id.split('-')[0].slice(1)));
    if (new Set(numbers).size !== numbers.length) throw new Error('Version numbers cannot be reused.');
    for (const scenario of versions) {
      if (scenario.parentVersion && !ids.has(scenario.parentVersion)) throw new Error(`Missing parent: ${scenario.parentVersion}`);
      const warnings = validateScenario(scenario, context);
      console.log(`${scenario.id}: sealed JSON, schema and linked references valid; ${warnings.join(', ')}`);
    }
    const reviews = path.join(__dirname, 'reviews');
    if (fs.existsSync(reviews)) {
      for (const file of fs.readdirSync(reviews).filter(file => file.endsWith('.json'))) {
        const bytes = fs.readFileSync(path.join(reviews, file));
        if (hash(bytes) !== fs.readFileSync(path.join(reviews, file.replace(/\.json$/, '.sha256')), 'utf8').trim()) throw new Error(`Review seal mismatch: ${file}`);
        const review = JSON.parse(bytes.toString('utf8'));
        if (file !== `${review.scenarioId}-${review.id}.json`) throw new Error(`Review filename mismatch: ${file}`);
        const result = validateReview(review, __dirname, context);
        console.log(`${file}: sealed historical review valid; ${result.currentSourcesMatch ? 'sources match' : 'STALE FOR CURRENT SOURCES: new reconciliation/review required'}.`);
      }
    }
    return;
  }
  if (command === 'create') {
    if (rest.length !== 2) throw new Error('Usage: offers.cjs create <parent-version> <patch.json>');
    const result = createVersion(rest[0], JSON.parse(fs.readFileSync(rest[1], 'utf8')), __dirname, context);
    console.log(`Created sealed ${result.id}; no historical scenario was modified.`);
    return;
  }
  if (command === 'review') {
    if (rest.length !== 1) throw new Error('Usage: offers.cjs review <review.json>');
    recordReview(JSON.parse(fs.readFileSync(rest[0], 'utf8')), __dirname, context);
    console.log('Created sealed offline review record; no offer was activated.');
    return;
  }
  if (!['compare', 'project'].includes(command)) throw new Error('Commands: validate, compare, project, create, review.');
  const inputIndex = rest.indexOf('--input');
  let input;
  if (inputIndex !== -1) {
    if (inputIndex !== rest.length - 2) throw new Error('--input must be the final option followed by a JSON file.');
    input = JSON.parse(fs.readFileSync(rest[inputIndex + 1], 'utf8'));
    rest.splice(inputIndex, 2);
  }
  const ids = rest.length ? rest : fs.readdirSync(__dirname)
    .filter(file => /^v[1-9][0-9]*-[a-z][a-z0-9-]*\.json$/.test(file))
    .map(file => file.slice(0, -5))
    .sort((a, b) => Number(a.split('-')[0].slice(1)) - Number(b.split('-')[0].slice(1)));
  const scenarios = ids.map(id => loadScenario(id));
  if (command === 'project') {
    if (!input) throw new Error('Usage: offers.cjs project [version IDs] --input <projection.json>');
    console.log(JSON.stringify(scenarios.map(scenario => projectMonth(scenario, input, context)), null, 2));
  } else {
    const compared = compareVersions(scenarios, input ?? {}, context);
    const sideBySide = compared[0].offers.map((offer, index) => ({
      offer: offer.id,
      versions: Object.fromEntries(compared.map(version => [version.scenarioId, version.offers[index]])),
    }));
    console.log(JSON.stringify(sideBySide, null, 2));
  }
}

if (require.main === module) {
  try { run(process.argv.slice(2)); }
  catch (error) { console.error(`Residential offer command failed: ${error.message}`); process.exitCode = 1; }
}

module.exports = { run };
