const test=require('node:test'),assert=require('node:assert/strict');
const {createWalkthrough}=require('./walkthrough-fixture.cjs');
const {seedSalesPreview}=require('./sales-preview-seed.cjs');
test('eight-screen review seeds only isolated records through actual contracts and stops before bank settlement',async t=>{
    const engine=await createWalkthrough({origin:'https://127.0.0.1:9443'});t.after(()=>engine.close());
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYs8AAAAASUVORK5CYII=','base64');
    const gallery=await seedSalesPreview(engine,png);
    assert.equal(new Set([gallery.completedLeadId,gallery.assessmentLeadId,gallery.quoteLeadId]).size,3);
    const status=await engine.status();
    assert.equal(status.earnings.entries.length,1);
    assert.equal(status.flags.settled,false);
    assert.equal(status.earnings.externalPaymentInitiated,false);
    assert.ok(gallery.jobId);assert.ok(gallery.runId);assert.ok(gallery.draftQuoteId);
    const response=await engine.request('field-sales','GET',null,'sales');
    const records=await response.json();
    assert.equal(records.ok,true);
    assert.ok(JSON.stringify(records).includes('Avery Chen'));
    assert.ok(JSON.stringify(records).includes('Taylor Brooks'));
});
