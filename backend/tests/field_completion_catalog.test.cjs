const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { evaluate } = require('./helpers/commercial_operations_fixture.cjs');
const { validateQuoteCatalog, calculateFieldQuote } = evaluate(path.join('lib', 'fieldQuote.ts'),
  { '@/lib/commercial_business': { BusinessError: class BusinessError extends Error {} } });
const catalog = () => ({
  catalog_id: 'synthetic-only', version: 'fixture', status: 'published', digest: 'synthetic',
  definition: { currency: 'usd', validForMinutes: 60, services: [{
    id: 'tv_mounting', label: 'TV mounting', markets: ['residential'], offers: [{
      id: 'standard', label: 'Synthetic installation', enabled: true, unitCents: 10001, basis: 'per_unit',
      minimum: 1, maximum: 10, starting: false, equipment: [], scope: [], exclusions: [],
      questions: [], options: [], qualifications: []
    }]
  }] }
});
const line = { serviceId: 'tv_mounting', offerId: 'standard', quantity: 1, answers: {}, options: [] };
test('catalog pins explicit per-service completion evidence without changing absent legacy fields or price', () => {
  const c = catalog(), original = calculateFieldQuote(c, [line], 'residential');
  assert.equal(original.totalCents, 10001);
  assert.equal(Object.hasOwn(original.lines[0], 'completionRequirements'), false);
  c.definition.services[0].completionRequirements = [
    { id: 'finished_wall', label: 'Finished wall and TV', type: 'photo', minimumCount: 2 },
    { id: 'onsite_customer', label: 'Onsite customer signature', type: 'signature', minimumCount: 1 },
    { id: 'safe_mount', label: 'Mount security checked', type: 'checklist', minimumCount: 1 }
  ];
  const quote = calculateFieldQuote(c, [line], 'residential');
  assert.equal(quote.totalCents, original.totalCents);
  assert.deepEqual(JSON.parse(JSON.stringify(quote.lines[0].completionRequirements)), c.definition.services[0].completionRequirements);
  c.definition.services[0].completionRequirements[0].minimumCount = 1;
  assert.equal(quote.lines[0].completionRequirements[0].minimumCount, 2, 'The quote is not a mutable catalog alias');
});
test('malformed evidence/counts/IDs/checklists/unknown policy fields cannot publish or quote', () => {
  const valid = { id: 'finished_wall', label: 'Finished wall', type: 'photo', minimumCount: 1 };
  for (const invalid of [null, {}, 'photo', { ...valid, id: 'Bad ID' }, { ...valid, label: '' },
    { ...valid, type: 'external' }, { ...valid, minimumCount: 0 }, { ...valid, minimumCount: 1.5 },
    { ...valid, minimumCount: 101 }, { ...valid, type: 'checklist', minimumCount: 2 },
    { ...valid, allowSharedArtifacts: true }]) {
    const c = catalog(); c.definition.services[0].completionRequirements = [invalid];
    assert.throws(() => validateQuoteCatalog(c), /completion evidence/);
    assert.throws(() => calculateFieldQuote(c, [line], 'residential'), /completion evidence/);
  }
  for (const value of [null, {}, [valid, valid], Array.from({ length: 101 }, (_, n) => ({ ...valid, id: 'photo_' + n }))]) {
    const c = catalog(); c.definition.services[0].completionRequirements = value;
    assert.throws(() => validateQuoteCatalog(c), /completion evidence/);
  }
  const c = catalog();
  assert.throws(() => calculateFieldQuote(c, [{ ...line, completionRequirements: [] }], 'residential'), /overrides/);
});
test('a quote cannot promise minimum proof that cannot fit the actual ingestion cap', () => {
  const c = catalog(), service = c.definition.services[0];
  service.completionRequirements = Array.from({ length: 100 }, (_, n) =>
    ({ id: 'photo_' + n, label: 'Configured photo group', type: 'photo', minimumCount: 100 }));
  assert.equal(calculateFieldQuote(c, [line], 'residential').totalCents, 10001, 'Full supported per-service capacity remains usable');
  c.definition.services = Array.from({ length: 30 }, (_, n) => ({ ...service, id: 'service_' + n }));
  const lines = c.definition.services.map(value => ({ ...line, serviceId: value.id }));
  assert.throws(() => calculateFieldQuote(c, lines, 'residential'), /completion evidence exceeds the supported record size/);
  const one = catalog(); one.definition.services[0].completionRequirements = service.completionRequirements;
  assert.equal(calculateFieldQuote(one, Array(30).fill(line), 'residential').totalCents, 300030,
    'Repeated lines of one service retain per-order requirements, not invented quantity scaling');
});
