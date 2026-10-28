const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {webcrypto}=require('node:crypto'),{JSDOM}=require('jsdom');
const {createResidentialFixture}=require('./helpers/residential_fixture.cjs');
const {createFixture}=require('./helpers/commercial_contact_fixture.cjs');
const front=path.resolve(__dirname,'..','..','frontend'),file=name=>fs.readFileSync(path.join(front,name),'utf8');
const receiptKey='h2s:residential:submission:v1';
async function waitFor(condition) {
  for(let n=0;n<200;n++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.fail('Residential UI did not settle');
}
function storage() {
  const data=new Map();
  return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
}
function page(handler,saved=storage(),enabled=true) {
  const dom=new JSDOM(file('residential.html'),{url:'http://localhost/residential',runScripts:'outside-only'});
  const w=dom.window,posts=[],pickers=[];
  w.TextEncoder=TextEncoder;Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});
  Object.defineProperty(w,'sessionStorage',{value:saved});
  w.console.warn=()=>{};w.console.error=()=>{};
  w.fetch=async(url,options)=>{
    if(url.includes('owner-media'))return Response.json({ok:true,surface:'residential',sections:{}});
    if(options.method==='GET')return Response.json({ok:true,enabled});
    const body=JSON.parse(options.body);posts.push(body);return handler(body);
  };
  w.flatpickr=(input,options)=>{const picker={open(){},destroy(){},options};pickers.push(picker);return picker;};
  for(const name of ['media-placement-style.js','residential-media.js','residential.js'])w.eval(file(name));
  const form=w.document.getElementById('residential-form'),submit=w.document.getElementById('residential-submit');
  const fill=(note='Fixture-only TV installation.')=>{
    form.elements.fullName.value='Reload Fixture';form.elements.phone.value='(555) 000-0005';
    form.elements.city.value='Greenville';form.elements.notes.value=note;form.querySelector('[name=service]').checked=true;
  };
  return {w,dom,form,submit,posts,pickers,fill,close:()=>w.close()};
}
test('canonical intake contains no fixture UI, keeps short required fields and supports both entry paths',()=>{
  const html=file('residential.html'),config=JSON.parse(file('vercel.json'));
  assert.doesNotMatch(html+file('residential.css')+file('residential.js'),/LOCAL DEMO|local-preview|PreviewOwner|Maya Bennett|Daniel Brooks|57891/);
  assert.deepEqual(Array.from(html.matchAll(/name="([^"]+)"[^>]*\brequired/g),m=>m[1]),['fullName','phone','city']);
  assert.doesNotMatch(html,/name="(?:street|unit|state|postalCode)"|address-autocomplete\.js/);
  assert.match(html,/logo-180\.png/);assert.match(html,/href="\/commercial" class="residential-business-link"/);
  assert.ok(config.rewrites.some(row=>row.source==='/residential'&&row.destination==='/residential.html'));
  assert.equal((config.redirects||[]).some(row=>row.source==='/residential.html'),false);
  for(const [,url] of html.matchAll(/src="(\/[^"]+\.js)"/g))assert.ok(fs.existsSync(path.join(front,url.slice(1))),url);
});
test('reload receipt prevents duplicate inquiry and messages; explicit separate project and Queue data remain correct',async t=>{
  const f=await createResidentialFixture({},{routing:true}),saved=storage(),pages=[];
  t.after(async()=>{pages.forEach(p=>p.close());await f.close();});
  const open=()=>{const p=page(body=>f.post('residential-intake',body),saved);pages.push(p);return p;};
  let p=open();await waitFor(()=>!p.submit.disabled);p.fill();
  p.form.elements.smsOptIn.checked=true;p.w.document.getElementById('residential-add-day').click();
  p.form.querySelector('[data-date]').value='2099-01-02';
  p.form.querySelector('[value=afternoon]').checked=true;
  p.form.requestSubmit();p.form.requestSubmit();
  await waitFor(()=>p.submit.textContent==='Request received');
  assert.equal(p.posts.length,1);assert.equal(f.sms.length,2);
  const receipt=JSON.parse(saved.getItem(receiptKey));
  assert.deepEqual(Object.keys(receipt).sort(),['digest','publicToken','reference','submissionKey']);
  assert.equal(JSON.stringify(receipt).includes('Reload Fixture'),false);
  assert.equal(JSON.stringify(receipt).includes('+15550000005'),false);
  const q=createFixture();
  for(const table of ['commercial_leads','commercial_consultation_requests'])q.tables[table]=(await f.db.query('select * from '+table)).rows;
  const lead=q.tables.commercial_leads[0],item=(await q.queue(new URLSearchParams({filter:'all',market:'residential'}))).queue[0];
  assert.equal(item.fullName,'Reload Fixture');assert.equal(item.phone,'+15550000005');assert.equal(item.projectCity,'Greenville');
  assert.deepEqual(item.serviceNeeds,['TV Mounting']);assert.equal(item.notes,'Fixture-only TV installation.');
  assert.equal(item.contactPreference,'sms');assert.equal(lead.attribution.communicationConsent.smsOptIn,true);
  assert.deepEqual(item.availabilityPreferences,[{date:'2099-01-02',period:'afternoon'}]);
  p=open();await waitFor(()=>!p.submit.disabled);
  assert.equal(p.posts.length,0);assert.equal(p.form.elements.fullName.value,'');assert.equal(p.form.elements.smsOptIn.checked,false);
  p.fill();p.form.elements.phone.value='+1 555 000 0005';p.form.elements.smsOptIn.checked=true;
  p.w.document.getElementById('residential-add-day').click();p.form.querySelector('[data-date]').value='2099-01-02';
  p.form.querySelector('[value=afternoon]').checked=true;p.form.requestSubmit();
  await waitFor(()=>p.submit.textContent==='Request received');
  assert.equal(p.posts.length,0);assert.match(p.w.document.getElementById('residential-status').textContent,/not sent again/);
  assert.equal(f.sms.length,2);
  p.w.document.getElementById('residential-separate').click();
  assert.equal(p.form.elements.smsOptIn.checked,false);assert.equal(p.form.querySelectorAll('[data-date]').length,0);
  p.fill();p.form.elements.smsOptIn.checked=true;
  p.w.document.getElementById('residential-add-day').click();p.form.querySelector('[data-date]').value='2099-01-02';
  p.form.querySelector('[value=afternoon]').checked=true;p.form.requestSubmit();
  await waitFor(()=>p.submit.textContent==='Request received');
  assert.notEqual(p.posts[0].publicToken,receipt.publicToken);
  assert.notEqual(p.posts[0].submissionKey,receipt.submissionKey);
  assert.equal((await f.db.query('select count(*)::int n from commercial_consultation_requests')).rows[0].n,2);
  assert.equal(f.sms.length,4);
});
test('uncertain receipt survives reload without restoring a draft; retries reuse identity and notification effects',async t=>{
  const f=await createResidentialFixture({},{routing:true}),saved=storage(),pages=[];
  t.after(async()=>{pages.forEach(p=>p.close());await f.close();});
  const p=page(async body=>{await f.post('residential-intake',body);throw new Error('Fixture lost response');},saved);pages.push(p);
  await waitFor(()=>!p.submit.disabled);p.fill();p.form.requestSubmit();
  await waitFor(()=>p.submit.textContent==='Retry this same request');
  assert.equal(f.sms.length,1);
  const reopened=page(body=>f.post('residential-intake',body),saved);pages.push(reopened);
  await waitFor(()=>!reopened.submit.disabled);assert.equal(reopened.form.elements.fullName.value,'');
  reopened.fill();reopened.form.requestSubmit();await waitFor(()=>reopened.submit.textContent==='Request received');
  assert.equal(reopened.posts[0].publicToken,p.posts[0].publicToken);
  assert.equal(reopened.posts[0].submissionKey,p.posts[0].submissionKey);assert.equal(f.sms.length,1);
  assert.equal((await f.db.query('select count(*)::int n from commercial_leads')).rows[0].n,1);
});
test('storage failures, malformed receipts and changed uncertain requests never silently create new inquiries',async t=>{
  for(const kind of ['blocked','malformed','uncertain'])await t.test(kind,async()=>{
    const saved=storage();
    if(kind==='blocked')saved.setItem=()=>{throw new Error('Fixture blocked storage');};
    if(kind==='malformed')saved.setItem(receiptKey,'broken');
    if(kind==='uncertain')saved.setItem(receiptKey,JSON.stringify({digest:'0'.repeat(64),publicToken:'a'.repeat(24),submissionKey:'b'.repeat(24),reference:null}));
    const p=page(async()=>assert.fail('Must not submit'),saved);
    try{
      await waitFor(()=>!p.submit.disabled);p.fill();p.form.requestSubmit();
      await waitFor(()=>p.submit.textContent==='Review and send request');
      assert.equal(p.posts.length,0);assert.equal(p.form.elements.fullName.disabled,false);
      assert.match(p.w.document.getElementById('residential-status').textContent,/not sent/);
      if(kind==='uncertain')assert.equal(p.w.document.getElementById('residential-separate').hidden,false);
    }finally{p.close();}
  });
});
test('calendar unavailability and photo errors remain explicit and do not block a minimal inquiry',async()=>{
  const p=page(async()=>Response.json({ok:true,reference:'HOME-OPTIONAL',notifications:{enabled:false}}));
  try{
    await waitFor(()=>!p.submit.disabled);p.w.flatpickr=undefined;
    p.w.document.getElementById('residential-add-day').click();
    assert.match(p.w.document.getElementById('residential-preferences-status').textContent,/calendar could not load/);
    assert.match(p.w.document.getElementById('residential-proof-status').textContent,/photos are unavailable/);
    p.fill('');p.form.requestSubmit();await waitFor(()=>p.submit.textContent==='Request received');
    assert.equal(p.posts[0].smsOptIn,false);assert.deepEqual(p.posts[0].availabilityPreferences,[]);
  }finally{p.close();}
});
test('a missing photo script cannot prevent initial form readiness or a city-only request',async()=>{
  const p=page(async()=>Response.json({ok:true,reference:'HOME-NO-MEDIA',notifications:{enabled:false}}));
  try{
    delete p.w.H2SResidentialMedia;
    await waitFor(()=>!p.submit.disabled);
    await waitFor(()=>p.w.document.getElementById('residential-proof-status').textContent.includes('could not load'));
    assert.equal(p.w.document.getElementById('residential-proof-media').getAttribute('aria-busy'),'false');
    p.fill('');p.form.requestSubmit();await waitFor(()=>p.submit.textContent==='Request received');
    assert.equal(p.posts.length,1);
  }finally{p.close();}
});
test('installation previews share the canonical renderer, apply only destination framing and show image failures',async()=>{
  const dom=new JSDOM('<div id="media"></div><p id="status"></p>',{url:'http://localhost/residential',runScripts:'outside-only'});
  try{
    const w=dom.window;w.eval(file('media-placement-style.js'));w.eval(file('residential-media.js'));
    const original={asset_id:'photo',service:'tv_mounting',media_kind:'photo',media_url:'/approved.jpg',
      media_placement:{fit:'contain',focal_x:23,focal_y:71,zoom:1.2}};
    const before=JSON.stringify(original);
    const selected=await w.H2SResidentialMedia.read(async url=>{
      assert.match(url,/surface=residential/);
      return {ok:true,surface:'residential',sections:{residential_tv_proof:{items:[original]},
        residential_camera_proof:{items:[{...original,media_kind:'video'}]}}};
    });
    const container=w.document.getElementById('media'),status=w.document.getElementById('status');
    w.H2SResidentialMedia.render(container,selected,status);
    const img=container.querySelector('img');
    assert.equal(img.style.objectFit,'contain');assert.equal(img.style.objectPosition,'23% 71%');
    assert.equal(img.style.transform,'scale(1.2)');assert.equal(JSON.stringify(original),before);
    assert.equal(container.querySelectorAll('figure').length,1);
    const heroes=require('../../frontend/media-page-heroes.js');
    assert.match(heroes.destinationLinks('residential','residential_tv_proof','http://localhost/dash.html').local,/residential.html#/);
    assert.equal(heroes.describeUse(original,'proof_asset','residential','residential_tv_proof',{residential:selected},null).selected,true);
    assert.match(file('dash.js'),/frame\.replaceChildren\(window\.H2SResidentialMedia\.image\(asset, document\)\)/);
    img.dispatchEvent(new w.Event('error'));assert.equal(container.children.length,0);
    assert.match(status.textContent,/photo could not load.*still send/);
  }finally{dom.window.close();}
});
