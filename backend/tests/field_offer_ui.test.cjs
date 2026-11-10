const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {JSDOM}=require('jsdom');
const {createOfferFixture,answers}=require('./helpers/field_offer_fixture.cjs');
const until=async(predicate,message)=>{for(let i=0;i<1000;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,5));}throw Error(message);};
async function ui(t,f,leadId,fault={}) {
  const dom=new JSDOM('<main id="h2s-app"><section class="pane active field-sales"><div id="offers"></div></section></main>',{url:'https://fixture.invalid',runScripts:'outside-only'});
  const w=dom.window,root=w.document.getElementById('offers'),calls=[],opened=[];
  w.crypto.randomUUID=crypto.randomUUID;w.confirm=()=>true;w.console.error=()=>{};
  w.fetch=async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;calls.push(body);
    const response=await f.offerRequest(options.method,body,'a',leadId);
    if(body && fault.action===body.action && !fault.used){fault.used=true;return Response.json({ok:false,error:'Synthetic lost response after committed write'},{status:503});}
    return response;
  };
  w.eval(fs.readFileSync(path.join(__dirname,'..','..','frontend','field-offers.js'),'utf8'));
  w.H2SFieldOffers.mount(root,{apiBase:'https://fixture.invalid',leadId,getSession:()=>({token:'a',role:'SALES'}),openQuotes:id=>opened.push(id),reviewAssessment:()=>opened.push('assessment')});
  t.after(()=>{w.H2SFieldOffers.reset();w.close();});
  await until(()=>root.querySelector('[data-offer-start]') || root.querySelector('[data-offer-discovery]'),'Offer UI failed to load');
  const set=(selector,value)=>{
    const el=root.querySelector(selector);assert.ok(el,selector);
    if(el.type==='checkbox')el.checked=value;else el.value=String(value??'');
    el.dispatchEvent(new w.Event('change',{bubbles:true}));return el;
  };
  const click=selector=>{const el=root.querySelector(selector);assert.ok(el,selector);assert.equal(el.disabled,false,selector);el.click();};
  const settled=()=>until(()=>!w.H2SFieldOffers.isDirty(),'Discovery did not finish saving');
  return {w,root,calls,opened,set,click,settled};
}
test('guided offer UI completes the real local API/SQL journey and restores persisted progress',async t=>{
  const f=await createOfferFixture();t.after(()=>f.db.close());await f.enable();await f.publish();
  await t.test('adaptive TV steps create a correctly priced draft without approval or checkout',async t=>{
    const leadId=await f.lead(),x=await ui(t,f,leadId);
    x.click('[data-offer-start]');await x.settled();
    x.set('[data-offer-service="tv"]',true);x.set('[data-offer-path="catalogId"]',f.catalogId);x.set('[data-offer-path="tvQuantity"]',1);
    x.click('[data-offer-next]');await x.settled();
    assert.match(x.root.textContent,/TV 1 - scope/);assert.ok(!x.root.querySelector('[data-offer-path="tvs.0.weight"]'));
    for(const [field,value] of Object.entries({location:'Living room',size:60,ownership:'supplied',mountStyle:'fixed',surface:'drywall',concealment:'external'}))x.set(`[data-offer-path="tvs.0.${field}"]`,value);
    x.click('[data-offer-next]');await x.settled();
    assert.match(x.root.textContent,/TV 1 - compatibility/);
    for(const [field,value] of Object.entries({weight:45,vesaWidth:400,vesaHeight:200,compatibilityVerified:'yes'}))x.set(`[data-offer-path="tvs.0.${field}"]`,value);
    x.click('[data-offer-next]');await x.settled();
    assert.match(x.root.textContent,/\$199\.00/);assert.equal(x.root.querySelector('[data-offer-quote]').disabled,false);
    assert.equal(x.w.H2SFieldOffers.canLeave(),true);
    x.click('[data-offer-quote]');await until(()=>x.opened.length===1,'Quote handoff not confirmed');
    const quote=(await f.db.query('select snapshot,state from field_sales_quotes where quote_id=$1',[x.opened[0]])).rows[0];
    assert.equal(quote.state,'draft');assert.equal(quote.snapshot.totalCents,19900);assert.equal(f.stripeCalls.length,0);
    const restored=await ui(t,f,leadId);
    assert.match(restored.root.textContent,/\$199\.00/);
    assert.ok(restored.root.querySelector('[data-offer-step-title]'));assert.match(restored.root.textContent,/Recommendation and next action/);
  });
  await t.test('incomplete answers survive leaving and reopening without invented qualifications',async t=>{
    const leadId=await f.lead(),data=answers();data.tvs[0].weight=null;data.tvs[0].compatibilityVerified=null;data.step=2;
    assert.equal((await f.save(leadId,data)).status,200);
    const x=await ui(t,f,leadId);assert.equal(x.root.querySelector('[data-offer-path="tvs.0.weight"]').value,'');
    assert.equal(x.root.querySelector('[data-offer-path="tvs.0.compatibilityVerified"]').value,'');
    x.click('[data-offer-next]');await x.settled();
    assert.equal(x.root.querySelector('[data-offer-quote]').disabled,true);assert.match(x.root.textContent,/Still needs qualification/);
    assert.match(x.root.textContent,/Management review required/);
  });
  await t.test('interrupted save retries identical payload and operation, without duplicating revision',async t=>{
    const leadId=await f.lead(),data=answers();assert.equal((await f.save(leadId,data)).status,200);
    const fault={action:'save'},x=await ui(t,f,leadId,fault);
    x.set('[data-offer-path="tvQuantity"]',2);x.click('[data-offer-save]');
    await until(()=>fault.used && !x.root.querySelector('[data-offer-retry]').hidden,'Interrupted save was not retained');
    assert.equal(x.w.H2SFieldOffers.canLeave(),false);
    x.click('[data-offer-retry]');await x.settled();
    const writes=x.calls.filter(body=>body?.action==='save');assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);
    const records=(await f.db.query('select revision from field_sales_offer_discoveries where lead_id=$1 order by revision',[leadId])).rows;
    assert.deepEqual(records.map(row=>row.revision),[1,2]);
  });
  await t.test('uncertain quote creation retries the original operation and preserves one draft',async t=>{
    const leadId=await f.lead(),data=answers();data.step=3;assert.equal((await f.save(leadId,data)).status,200);
    const fault={action:'quote'},x=await ui(t,f,leadId,fault);
    x.click('[data-offer-quote]');await until(()=>fault.used && !x.root.querySelector('[data-offer-retry-quote]').hidden,'Interrupted quote was not retained');
    assert.equal(x.opened.length,0);assert.equal(x.w.H2SFieldOffers.canLeave(),false);
    x.click('[data-offer-retry-quote]');await until(()=>x.opened.length===1,'Identical quote retry did not confirm');
    const writes=x.calls.filter(body=>body?.action==='quote');assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);
    assert.equal((await f.db.query('select count(*)::int n from field_sales_quotes where lead_id=$1',[leadId])).rows[0].n,1);
  });
  await t.test('product search and absent AI use the controlled reference without changing discovery',async t=>{
    const leadId=await f.lead(),x=await ui(t,f,leadId);
    const search=x.root.querySelector('[data-offer-search]');search.value='S220';search.dispatchEvent(new x.w.Event('input',{bubbles:true}));
    assert.match(x.root.querySelector('[data-offer-reference-results]').textContent,/SoloCam S220/);
    const form=x.root.querySelector('[data-offer-ask]');form.elements.question.value='Does S220 record continuously?';
    form.dispatchEvent(new x.w.Event('submit',{bubbles:true,cancelable:true}));
    await until(()=>x.root.querySelector('[data-offer-ask-status]').textContent.includes('AI is not enabled'),'AI absence not explained');
    assert.match(x.root.querySelector('[data-offer-ask-results]').textContent,/Motion-event|motion-event/);
    assert.equal((await f.db.query('select count(*)::int n from field_sales_offer_discoveries where lead_id=$1',[leadId])).rows[0].n,0);
    assert.equal(f.ai.requests.length,0);
  });
  await t.test('unsupported quantity is captured and routed to management without a fabricated total',async t=>{
    const leadId=await f.lead(),x=await ui(t,f,leadId);
    x.click('[data-offer-start]');await x.settled();x.set('[data-offer-service="tv"]',true);
    x.set('[data-offer-path="catalogId"]',f.catalogId);x.set('[data-offer-path="tvQuantity"]',40);
    x.click('[data-offer-next]');await x.settled();
    assert.match(x.root.textContent,/unsupported quantities require management/i);assert.equal(x.root.querySelector('[data-offer-quote]').disabled,true);
    const saved=(await f.db.query('select document from field_sales_offer_discoveries where lead_id=$1 order by revision desc limit 1',[leadId])).rows[0];
    assert.equal(saved.document.answers.tvQuantity,40);assert.equal(saved.document.recommendation.verifiedPriceCents,null);
  });
});
