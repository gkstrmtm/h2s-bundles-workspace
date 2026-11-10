const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createOfferFixture,answers,camera,id}=require('./helpers/field_offer_fixture.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
test('guided offers use existing quote authority and append-only owned discovery',async t=>{
  const f=await createOfferFixture();t.after(()=>f.db.close());await f.enable();
  const leadId=await f.lead();
  const read=async()=>{const response=await f.offerRequest('GET',null,'a',leadId);assert.equal(response.status,200);return response.json();};
  let catalog=(await read()).catalogs[0];
  await t.test('draft catalogs are never verified or payable',()=>{
    const a=answers();a.catalogId=f.catalogId;const r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential');
    assert.equal(r.catalogStatus,'draft');assert.equal(r.verifiedPriceCents,null);assert.equal(r.canCreateQuote,false);
  });
  await f.publish();catalog=(await read()).catalogs[0];
  await t.test('TV boundary tiers and supplied versus customer-owned mounts',()=>{
    for(const [size,expected] of [[32,16000],[43,16000],[44,17000],[55,17000],[56,19900],[65,19900],[66,23000],[75,23000],[76,28500],[85,28500]]){
      for(const ownership of ['supplied','customer']){
        const a=answers();a.catalogId=f.catalogId;a.tvs[0].size=size;a.tvs[0].ownership=ownership;
        const r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential');
        assert.equal(r.canCreateQuote,true,JSON.stringify(r.missing));assert.equal(r.verifiedPriceCents,expected);
        assert.match(r.quoteInput[0].offerId,ownership==='supplied'?/fixed/:/install/);
      }
    }
    for(const size of [19,31,86,100]){
      const a=answers();a.catalogId=f.catalogId;a.tvs[0].size=size;
      const r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential');
      assert.equal(r.canCreateQuote,false);assert.equal(r.verifiedPriceCents,null);
    }
  });
  await t.test('marginal discounts use descending base prices, not aggregate or upgrade discounts',()=>{
    const a=answers();a.catalogId=f.catalogId;a.tvs=[copy(a.tvs[0]),copy(a.tvs[0]),copy(a.tvs[0])];a.tvQuantity=3;
    let r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential');
    assert.equal(r.verifiedPriceCents,54725);assert.equal(r.calculatedQuote.lines.reduce((sum,line)=>sum+line.discountCents,0),4975);
    a.tvs[0].size=50;a.tvs[1].size=40;
    r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential');assert.equal(r.verifiedPriceCents,48800);
    a.tvs[2].mountStyle='full_motion';r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential');
    assert.equal(r.verifiedPriceCents,55300);assert.equal(r.quoteInput[2].options[0],'motion');assert.equal(r.calculatedQuote.lines[2].addOns[0].amountCents,6500);
    a.tvs.push(copy(a.tvs[0]));a.tvQuantity=4;r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential');
    assert.equal(r.canCreateQuote,false);assert.equal(r.calculatedQuote.totalCents,null);assert.match(r.missing.join(' '),/custom.quote/i);
  });
  await t.test('unpublished discount schedules and unsupported equipment never invent prices',()=>{
    const a=answers();a.catalogId=f.catalogId;a.tvs.push(copy(a.tvs[0]));a.tvQuantity=2;
    const noDiscount=copy(catalog);delete noDiscount.definition.services[0].tvMarginalDiscounts;
    let r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[noDiscount],'residential');
    assert.equal(r.verifiedPriceCents,null);assert.match(r.missing.join(' '),/not authorize/);
    a.tvs=[a.tvs[0]];a.tvQuantity=1;a.tvs[0].mountStyle='tilt';a.tvs[0].size=44;
    r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential');assert.equal(r.canCreateQuote,false);
    a.tvs[0].size=60;a.tvs[0].weight=200;r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential');assert.equal(r.canCreateQuote,false);
    a.tvs[0].weight=45;a.tvs[0].vesaWidth=700;r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential');assert.equal(r.canCreateQuote,false);
    const generic=copy(catalog);delete generic.definition.services[0].offers.find(offer=>offer.id==='tv_fixed_56_65').guidance;
    const simple=answers();simple.catalogId=f.catalogId;
    r=f.offer.recommendOffer(f.offer.validateDiscovery(simple),[generic],'residential');assert.equal(r.canCreateQuote,false);
    assert.match(r.missing.join(' '),/exact supplied mount/);
  });
  await t.test('discount publication metadata rejects commercial, aggregate or altered schedules',()=>{
    for(const change of [c=>c.definition.services[0].markets.push('commercial'),c=>c.definition.services[0].tvMarginalDiscounts.percentsByPosition=[0,10,10],
      c=>c.definition.services[0].tvMarginalDiscounts.basis='whole_quote']){
      const invalid=copy(catalog);change(invalid);assert.throws(()=>f.engine.validateQuoteCatalog(invalid));
    }
  });
  await t.test('camera quantities and exact published model mapping override historical package assumptions',()=>{
    const a=answers();a.services=['cameras'];a.tvQuantity=null;a.tvs=[];a.cameraQuantity=2;a.cameras=[camera(0),camera(1)];a.catalogId=f.catalogId;
    let r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential');
    assert.equal(r.canCreateQuote,true,JSON.stringify(r.missing));assert.equal(r.verifiedPriceCents,59900,'Exact synthetic catalog price, not historical $499');
    assert.ok(r.suggestions.every(s=>s.equipmentId==='eufy_solocam_s220'));
    a.cameras.push(camera(2));a.cameraQuantity=3;r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential');
    assert.equal(r.canCreateQuote,false);assert.equal(r.verifiedPriceCents,null);
    const generic=copy(catalog);delete generic.definition.services[1].offers[0].guidance;
    a.cameras.pop();a.cameraQuantity=2;r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[generic],'residential');
    assert.equal(r.canCreateQuote,false);assert.match(r.missing.join(' '),/exact camera/);
  });
  await t.test('continuous recording never selects solar event cameras; compatible DC and media can qualify C31',()=>{
    const a=answers();a.services=['cameras'];a.tvQuantity=null;a.tvs=[];a.cameraQuantity=1;a.catalogId=f.catalogId;
    a.cameras=[camera(0,{recording:'continuous'})];
    let r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential');
    assert.equal(r.suggestions[0].equipmentId,null);assert.equal(r.canCreateQuote,false);
    a.cameras[0].preferredEquipmentId='eufy_wired_cam_c31';a.cameras[0].c31PowerCompatible=true;
    r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential');assert.equal(r.canCreateQuote,true,JSON.stringify(r.missing));
    assert.equal(r.suggestions[0].equipmentId,'eufy_wired_cam_c31');
    for(const key of ['c31PowerCompatible','wifiConfirmed','storageVerified','equipmentCompatibilityVerified','mountingCompatible','standardInstallation']){
      const invalid=copy(a);invalid.cameras[0][key]=null;const result=f.offer.recommendOffer(f.offer.validateDiscovery(invalid),[catalog],'residential');
      assert.equal(result.canCreateQuote,false,key);assert.equal(result.suggestions[0].equipmentId,null,key);
    }
  });
  await t.test('sunlight, shared storage, HomeBase and unknown customer equipment stay unresolved',()=>{
    const a=answers();a.services=['cameras'];a.tvQuantity=null;a.tvs=[];a.cameraQuantity=2;a.catalogId=f.catalogId;a.cameras=[camera(0),camera(1)];
    for(const change of [data=>data.cameras[0].directSunHours=2,data=>data.cameras[0].sunlightSuitable=null,
      data=>data.preferences.storage='shared_homebase',data=>{data.cameras[0].ownership='customer';data.cameras[0].preferredEquipmentId='unknown';}]){
      const invalid=copy(a);change(invalid);const r=f.offer.recommendOffer(f.offer.validateDiscovery(invalid),[catalog],'residential');
      assert.equal(r.canCreateQuote,false);assert.equal(r.verifiedPriceCents,null);
    }
    const e40=f.offer.productKnowledge().entries.find(e=>e.requiresHomebase);assert.ok(e40);
    a.cameras[0].preferredEquipmentId=e40.id;a.cameras[0].homebaseLinkConfirmed=true;
    const r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential');assert.equal(r.suggestions[0].equipmentId,null);assert.match(r.missing.join(' '),/HomeBase/);
  });
  await t.test('all six camera families retain their model-specific power, features and storage requirements',()=>{
    const models=f.offer.productKnowledge().entries.filter(entry=>entry.recording);
    assert.equal(models.length,6);
    for(const model of models){
      const a=answers();a.services=['cameras'];a.tvs=[];a.tvQuantity=null;a.cameraQuantity=1;a.catalogId=f.catalogId;
      a.existingHub={type:'homebase_s380',compatibilityVerified:true,availableCameraSlots:16};a.hubRouterConnectionConfirmed=true;
      a.cameras=[camera(0,{preferredEquipmentId:model.id,directSunHours:8,c31PowerCompatible:true,floodlightPowerCompatible:true,homebaseLinkConfirmed:true,
        requiredFeatures:model.powerMode==='hardwired_ac'?['floodlighting']:[]})];
      const r=f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential');
      assert.equal(r.suggestions[0].equipmentId,model.id,JSON.stringify(r.missing));
      if(model.solarSupported){a.cameras[0].sunlightSuitable=null;assert.equal(f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential').suggestions[0].equipmentId,null);}
      if(model.powerMode==='hardwired_ac'){a.cameras[0].floodlightPowerCompatible=false;assert.equal(f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential').suggestions[0].equipmentId,null);}
    }
  });
  await t.test('invalid, conflicting and manipulated discovery is rejected',()=>{
    for(const mutate of [a=>a.price=1,a=>a.tvs[0].priceCents=1,a=>a.tvQuantity=1.5,a=>a.existingHub.compatibilityVerified=true,
      a=>{a.services=['cameras'];a.tvs=[];a.tvQuantity=null;a.cameraQuantity=1;a.cameras=[camera(0,{recording:'events',requiredFeatures:['continuous_recording']})];}]){
      const a=answers();mutate(a);assert.throws(()=>f.offer.validateDiscovery(a));
    }
    const a=answers();a.catalogId=f.catalogId;a.quoteAnswers['tv_mounting:tv_fixed_56_65:0']={size:64};
    assert.throws(()=>f.offer.recommendOffer(f.offer.validateDiscovery(a),[catalog],'residential'),/cannot override/);
  });
  let saved;
  await t.test('structured discovery restores and repeated operation does not append another revision',async()=>{
    const operationId=crypto.randomUUID(),data=answers();
    const response=await f.save(leadId,data,0,{operationId});assert.equal(response.status,200);saved=await response.json();
    assert.equal(saved.discovery.revision,1);assert.equal(saved.discovery.document.recommendation.canCreateQuote,true);
    const replay=await f.save(leadId,data,0,{operationId});assert.equal(replay.status,200);assert.equal((await replay.json()).discovery.revision,1);
    const restored=await read();assert.equal(restored.discovery.document.answers.tvs[0].location,'Living room');assert.equal(restored.history.length,1);
    assert.ok(restored.discovery.document.recommendation.knowledgeSnapshot.some(entry=>entry.id==='onn_fixed_32_86'));
  });
  await t.test('concurrent revisions, different-operation replay and cross-owner access reject',async()=>{
    assert.equal((await f.save(leadId,answers(),0)).status,409);
    assert.equal((await f.offerRequest('GET',null,'b',leadId)).status,404);
    assert.equal((await f.offerRequest('GET',null,'va',leadId)).status,403);
    assert.equal((await f.offerRequest('GET',null,'unknown',leadId)).status,401);
    const payload={action:'quote',leadId,revision:1,knowledgeHash:f.offer.offerKnowledgeHash,lines:[{unitCents:1}]};
    assert.equal((await f.offerRequest('POST',payload)).status,400);
    await assert.rejects(()=>f.db.query('update field_sales_offer_discoveries set document=$1 where lead_id=$2',[JSON.stringify({}),leadId]),/immutable/);
    const permissions=await f.db.query("select has_function_privilege('authenticated','field_sales_offer_save(uuid,uuid,uuid,integer,jsonb)','EXECUTE') allowed");
    assert.equal(permissions.rows[0].allowed,false);
  });
  let quoteId;
  await t.test('qualified discovery creates one exact draft through the existing quote authority',async()=>{
    const operationId=crypto.randomUUID(),payload={action:'quote',leadId,operationId,revision:1,knowledgeHash:f.offer.offerKnowledgeHash};
    let response=await f.offerRequest('POST',payload);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));quoteId=(await response.json()).id;
    response=await f.offerRequest('POST',payload);assert.equal(response.status,200);assert.equal((await response.json()).id,quoteId);
    const quotes=(await f.db.query('select * from field_sales_quotes where lead_id=$1',[leadId])).rows;
    assert.equal(quotes.length,1);assert.equal(quotes[0].state,'draft');assert.equal(quotes[0].snapshot.totalCents,19900);
    assert.equal(quotes[0].snapshot.discoveryReference.revision,1);
    assert.equal(f.stripeCalls.length,0);assert.equal((await f.db.query('select count(*)::int n from field_sales_checkouts')).rows[0].n,0);
  });
  await t.test('catalog change detection blocks stale handoff without modifying historical quote',async()=>{
    const original=(await f.db.query('select snapshot,quote_hash from field_sales_quotes where quote_id=$1',[quoteId])).rows[0];
    await f.db.query("update field_sales_catalogs set status='retired' where catalog_id=$1",[f.catalogId]);
    assert.equal((await read()).changed,true);
    assert.equal((await f.offerRequest('POST',{action:'quote',leadId,revision:1,knowledgeHash:f.offer.offerKnowledgeHash})).status,409);
    assert.deepEqual((await f.db.query('select snapshot,quote_hash from field_sales_quotes where quote_id=$1',[quoteId])).rows[0],original);
  });
  await t.test('AI absence uses controlled references; no prompts or PII are retained',async()=>{
    const response=await f.offerRequest('POST',{action:'ask',leadId,question:'Can S220 record continuously?'});
    assert.equal(response.status,200);const result=await response.json();assert.equal(result.mode,'reference');assert.equal(f.ai.requests.length,0);
    assert.ok(result.entries.length);
    const events=(await f.db.query("select payload from field_sales_commands where lead_id=$1 and action='offer.knowledge'",[leadId])).rows;
    assert.ok(events.length);assert.ok(events.every(event=>!JSON.stringify(event.payload).includes('continuously')));
    const reference=f.offer.productKnowledge();assert.ok(!JSON.stringify(reference).includes('costAssumption'));assert.ok(!JSON.stringify(reference).includes('observedPrice'));
  });
  await t.test('optional AI selects bounded existing references and never receives raw customer text',async()=>{
    f.env.H2S_FIELD_OFFER_AI_ENABLED='true';f.env.OPENAI_API_KEY='synthetic-configured-provider';
    const response=await f.offerRequest('POST',{action:'ask',leadId,question:'Customer SecretName at 1234567890 asks about S220 recording.'});
    assert.equal(response.status,200);const result=await response.json();assert.equal(result.mode,'ai_reference');
    assert.ok(result.entries.some(entry=>entry.id==='recording_and_storage'));
    const sent=f.ai.requests.at(-1).messages[1].content;assert.ok(!sent.includes('SecretName'));assert.ok(!sent.includes('1234567890'));
    assert.ok(!sent.includes('Living room'));assert.equal((await read()).discovery.revision,1);
  });
  await t.test('provider failure and unknown generated references do not change discovery or prices',async()=>{
    f.ai.error=new Error('synthetic provider unavailable');
    assert.equal((await f.offerRequest('POST',{action:'ask',leadId,question:'S220 storage'})).status,503);
    f.ai.error=null;f.ai.entryIds=['invented_price'];
    assert.equal((await f.offerRequest('POST',{action:'ask',leadId,question:'S220 storage'})).status,502);
    f.ai.entryIds=[];f.ai.extra={entryIds:['price_authority'],priceCents:1};
    assert.equal((await f.offerRequest('POST',{action:'ask',leadId,question:'S220 storage'})).status,502);
    f.ai.extra=null;f.ai.entryIds=['price_authority'];f.ai.finishReason='length';
    assert.equal((await f.offerRequest('POST',{action:'ask',leadId,question:'S220 storage'})).status,502);f.ai.finishReason='stop';
    assert.equal((await read()).discovery.revision,1);
  });
  await t.test('persistent per-user usage limits apply before another provider call',async()=>{
    let limited=false;
    for(let i=0;i<15;i++){const response=await f.offerRequest('POST',{action:'ask',leadId,question:'S220 storage'});if(response.status===429){limited=true;break;}assert.equal(response.status,200);}
    assert.equal(limited,true);
  });
});
