const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {JSDOM}=require('jsdom');
const {createResidentialFixture}=require('./helpers/residential_fixture.cjs');
const {createFixture}=require('./helpers/commercial_contact_fixture.cjs');
const front=path.resolve(__dirname,'..','..','frontend'),file=name=>fs.readFileSync(path.join(front,name),'utf8');
const flush=()=>new Promise(resolve=>setTimeout(resolve,10));
async function addressFixture(t,available=true) {
  const dom=new JSDOM(`<form id="later-address"><details id="residential-address-details"><summary>Installation address</summary>
    <div id="residential-address-search"></div><p id="residential-address-status"></p>
    ${['street','unit','city','state','postalCode'].map(name=>`<input name="${name}">`).join('')}</details></form>`,
    {url:'http://localhost/residential-review',runScripts:'outside-only'});
  t.after(()=>dom.window.close());
  const w=dom.window,form=w.document.getElementById('later-address'),calls=[];
  class Widget extends w.HTMLElement { constructor(options){super();calls.push(options);} }
  w.customElements.define('gmp-place-autocomplete',Widget);
  w.google={maps:{importLibrary:async()=>{if(!available)throw new Error('Fixture lookup unavailable');return {PlaceAutocompleteElement:Widget};}}};
  w.eval(file('address-autocomplete.js'));
  const controller=w.H2SAddressAutocomplete.create(form,{browserKey:'browser-fixture'});
  w.document.getElementById('residential-address-details').open=true;await flush();
  const widget=w.document.querySelector('gmp-place-autocomplete');
  const fields=[];
  const component=(type,longText,shortText=longText)=>({types:[type],longText,shortText});
  const place={id:'fixture-place',addressComponents:[component('street_number','100'),component('route','Fixture Lane'),
    component('locality','Greenville'),component('administrative_area_level_1','South Carolina','SC'),component('postal_code','29601')],
    fetchFields:async options=>{fields.push(options.fields);}};
  const select=()=>widget.dispatchEvent(Object.assign(new w.Event('gmp-select'),{placePrediction:{toPlace:()=>place}}));
  return {w,form,controller,calls,fields,place,select,widget};
}
test('supported Places widget fills components, uses a soft bias/minimal fields, and unit changes preserve the selected street',async t=>{
  const f=await addressFixture(t);f.select();await flush();
  assert.deepEqual(Array.from(f.fields[0]),['id','addressComponents']);
  assert.equal(f.calls[0].locationBias.radius,50000);assert.equal(f.calls[0].locationRestriction,undefined);
  assert.equal(f.form.elements.city.value,'Greenville');assert.equal(f.form.elements.state.value,'SC');
  f.form.elements.unit.value='4B';f.form.elements.unit.dispatchEvent(new f.w.Event('input',{bubbles:true}));
  assert.equal(f.controller.read().placeId,'fixture-place');assert.equal(f.controller.read().unit,'4B');
  f.form.elements.postalCode.value='29609';
  assert.equal(f.controller.read().source,'manual','Autofill/value changes without an input event must not reuse stale place metadata');
  f.form.elements.postalCode.value='29601';
  f.form.elements.street.value='101 Manual Lane';f.form.elements.street.dispatchEvent(new f.w.Event('input',{bubbles:true}));
  assert.equal(f.controller.read().source,'manual');assert.equal(f.controller.read().placeId,undefined);
  f.select();await flush();f.widget.dispatchEvent(new f.w.Event('input',{bubbles:true}));
  assert.equal(f.controller.read().source,'manual');
});
test('late selection cannot overwrite manual correction or locked uncertain submissions; failed lookup keeps manual controls usable',async t=>{
  const f=await addressFixture(t);
  let release;f.place.fetchFields=()=>new Promise(resolve=>{release=resolve;});
  f.select();f.form.elements.city.value='Manual City';f.form.elements.city.dispatchEvent(new f.w.Event('input'));
  release();await flush();assert.equal(f.form.elements.city.value,'Manual City');
  f.select();f.controller.setDisabled(true);release();await flush();
  assert.equal(f.form.elements.city.value,'Manual City');
  const failed=await addressFixture(t,false);
  assert.match(failed.w.document.getElementById('residential-address-status').textContent,/unavailable.*Enter details/);
  failed.form.elements.street.value='100 Manual Lane';assert.equal(failed.controller.read().source,'manual');
  assert.equal(failed.form.elements.street.disabled,false);
});
test('reading an autosave or correcting a unit does not cancel pending address selection',async t=>{
  const f=await addressFixture(t);
  let release;f.place.fetchFields=()=>new Promise(resolve=>{release=resolve;});
  f.select();f.form.elements.unit.value='5B';f.controller.read();
  release();await flush();
  assert.equal(f.form.elements.street.value,'100 Fixture Lane');
  assert.equal(f.controller.read().unit,'5B');
  assert.equal(f.controller.read().placeId,'fixture-place');
});
test('residential and dashboard use the same photo renderer and independent page framing',async t=>{
  const dom=new JSDOM('<div id="media"></div><p id="status"></p>',{url:'http://localhost/residential',runScripts:'outside-only'});
  t.after(()=>dom.window.close());const w=dom.window;
  w.eval(file('media-placement-style.js'));w.eval(file('residential-media.js'));
  const photo={asset_id:'photo',service:'tv_mounting',media_kind:'photo',media_url:'/approved.jpg',
    media_placement:{fit:'contain',focal_x:23,focal_y:71,zoom:1.2}};
  let requested;
  const selected=await w.H2SResidentialMedia.read(async url=>{requested=url;return {ok:true,surface:'residential',
    sections:{residential_tv_proof:{items:[photo]},residential_camera_proof:{items:[]}}};});
  assert.match(requested,/surface=residential/);
  w.H2SResidentialMedia.render(w.document.getElementById('media'),selected,w.document.getElementById('status'));
  assert.match(w.document.querySelector('img').style.cssText,/object-position: 23% 71%/);
  assert.equal(w.document.querySelector('img').style.objectFit,'contain');
  const heroes=require('../../frontend/media-page-heroes.js');
  assert.match(heroes.destinationLinks('residential','residential_tv_proof','http://localhost/dash.html').local,/residential.html#/);
  assert.equal(heroes.describeUse(photo,'proof_asset','residential','residential_tv_proof',{residential:selected},null).selected,true);
});
test('draft 040: address survives inquiry/reload and manual invalidation leaves linked orders alone',async()=>{
  const f=await createResidentialFixture({RESIDENTIAL_WORKSPACE_ENABLED:'true',RESIDENTIAL_SMS_ENABLED:'false'},{workspace:true});
  try{
    const body={publicToken:crypto.randomUUID(),submissionKey:crypto.randomUUID(),fullName:'Address Fixture',phone:'+15550000005',
      city:'Greenville',serviceNeeds:['TV Mounting'],smsOptIn:false,
      installationAddress:{street:'100 Fixture Lane',unit:'4B',state:'SC',postalCode:'29601',source:'google_places',placeId:'fixture-place'}};
    assert.equal((await f.post('residential-intake',body)).status,201);
    assert.equal((await f.post('residential-intake',body)).status,200);
    const lead=(await f.db.query('select * from commercial_leads')).rows[0],request=(await f.db.query('select * from commercial_consultation_requests')).rows[0];
    assert.equal(lead.project_address,'100 Fixture Lane, Unit 4B');
    assert.equal(lead.assessment_answers.installationAddress.placeId,'fixture-place');
    const review=await f.route('residential-review').GET(new Request('http://fixture.invalid/api/residential-review?token='+request.response_token));
    const view=(await review.json()).inquiry;assert.match(view.address,/Unit 4B.*SC.*29601/);assert.equal(view.addressSource,'google_places');
    const q=createFixture();q.tables.commercial_leads.push(lead);
    const item=(await q.queue(new URLSearchParams({filter:'all',market:'residential'}))).queue[0];
    assert.equal(item.projectPostalCode,'29601');assert.equal(item.addressSource,'google_places');
    assert.equal((await f.post('residential-review',{token:request.response_token,action:'approve'})).status,200);
    await f.db.exec('reset role');
    await f.db.exec(fs.readFileSync(path.join(__dirname,'..','migrations','040_residential_address_guards.sql'),'utf8'));
    const orderId=crypto.randomUUID(),jobId=crypto.randomUUID();
    await f.db.query(`insert into h2s_orders(id,order_id,customer_email,subtotal,total,items,address,city,state,zip)
      values($1,'RES-ADDRESS-FIXTURE','fixture@example.invalid',0,0,'[]','99 Existing Job Lane','Greenville','SC','29601')`,[orderId]);
    await f.db.query('insert into h2s_dispatch_jobs(job_id,order_id) values($1,$2)',[jobId,orderId]);
    await f.db.query(`insert into commercial_lead_operations(lead_id,order_id,installation_job_id) values($1,$2,$3)
      on conflict(lead_id) do update set order_id=excluded.order_id,installation_job_id=excluded.installation_job_id`,[lead.lead_id,orderId,jobId]);
    await f.db.query('update commercial_leads set project_address=$1 where lead_id=$2',['200 Manual Road',lead.lead_id]);
    let updated=(await f.db.query('select * from commercial_leads')).rows[0];
    assert.equal(updated.assessment_answers.installationAddress.source,'manual');
    assert.equal(updated.assessment_answers.installationAddress.placeId,null);
    await f.db.query('update commercial_leads set project_address=null where lead_id=$1',[lead.lead_id]);
    await f.db.exec('set role service_role');
    const booking={leadId:lead.lead_id,revision:0,operationId:crypto.randomUUID(),action:'confirm',
      payload:{start:'2099-01-01T14:00:00Z',end:'2099-01-01T16:00:00Z',timezone:'America/New_York',customerAgreed:true,reason:'Fixture agreement'}};
    const call=()=>f.route('commercial-calendar').POST(new Request('http://fixture.invalid/api/commercial-calendar',{
      method:'POST',headers:{Authorization:'Bearer fixture-admin','Content-Type':'application/json'},body:JSON.stringify(booking)}));
    assert.equal((await call()).status,400);
    await f.db.exec('reset role');await f.db.query('update commercial_leads set project_address=$1 where lead_id=$2',['200 Manual Road',lead.lead_id]);await f.db.exec('set role service_role');
    assert.equal((await call()).status,200);assert.equal((await call()).status,200);
    const orders=(await f.db.query('select * from h2s_orders')).rows;
    assert.equal(orders.length,1);
    assert.equal(orders[0].address,'99 Existing Job Lane');
    assert.equal(orders[0].city,'Greenville');
    assert.equal(orders[0].state,'SC');
    assert.equal(orders[0].zip,'29601');
    assert.equal(f.providerAttempts.length,0);
  }finally{await f.close();}
});
