const test=require('node:test'),assert=require('node:assert/strict');
const{buildStagingSalesConfig}=require('../tools/staging-sales-config.cjs');
const{evaluate}=require('./helpers/commercial_operations_fixture.cjs');
const crypto=require('node:crypto');
class BusinessError extends Error{}
const engine=evaluate('lib\\fieldQuote.ts',{'@/lib/commercial_business':{BusinessError}});
test('staging catalog preserves source prices, provisional status and exact quote/proof contracts',()=>{
  const config=buildStagingSalesConfig();
  const catalog={catalog_id:crypto.randomUUID(),version:config.version,status:'staging_only',
    definition:config.definition,digest:crypto.createHash('sha256').update(JSON.stringify(config.definition)).digest('hex')};
  assert.equal(config.sourceEvidence.productionApproved,false);
  assert.equal(config.sourceEvidence.stagingOnly,true);
  assert.ok(config.sourceEvidence.sources.every(source=>source.status.includes('proposed')&&source.sha256.length===64));
  assert.equal(config.costAssumptions.fixedMountCents,2488);assert.equal(config.costAssumptions.consumablesPerTvCents,300);
  const tv=engine.calculateFieldQuote(catalog,[config.lines.tv],'residential');
  const camera=engine.calculateFieldQuote(catalog,[config.lines.camera],'residential');
  assert.equal(tv.totalCents,17900);assert.equal(camera.totalCents,59900);
  assert.equal(tv.pricingStatus,'staging_only');assert.equal(camera.pricingStatus,'staging_only');
  assert.throws(()=>engine.calculateFieldQuote(catalog,[{...config.lines.tv,answers:{size:66}}],'residential'));
  assert.throws(()=>engine.calculateFieldQuote(catalog,[{...config.lines.camera,quantity:3}],'residential'));
  assert.ok(config.definition.services.every(service=>service.completionRequirements.length===3));
});
