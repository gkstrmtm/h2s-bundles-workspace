const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const {create}=require('../../frontend/residential-tracking.js');
const front=path.resolve(__dirname,'..','..','frontend');
const query='?utm_source=flyer&utm_medium=qr&utm_campaign=residential_cameras_2026_11&utm_content=camera_flyer';
function fixture(search=query) {
  const dom=new JSDOM(fs.readFileSync(path.join(front,'residential.html'),'utf8'),
    {url:'https://fixture.invalid/residential'+search,runScripts:'outside-only'});
  const {window}=dom,events=[],inquiries=[],warnings=[];
  window.console.warn=(...args)=>warnings.push(args);
  window.fetch=async(url,options={})=>{
    if(url==='/api/track'){events.push(JSON.parse(options.body));return Response.json({ok:true});}
    if(url==='/api/residential-intake'){
      if(options.method==='POST'){inquiries.push(JSON.parse(options.body));return Response.json({ok:true,reference:'HOME-TRACK',notifications:{enabled:false}});}
      return Response.json({ok:true,enabled:true});
    }
    return Response.json({ok:true,surface:'residential',sections:{}});
  };
  return {dom,window,events,inquiries,warnings,close:()=>window.close()};
}
async function until(condition){
  for(let n=0;n<100;n++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,5));}
  assert.fail('Tracking fixture did not complete');
}
test('QR campaign captures safe tags without recording raw query strings, contact data or lookup tokens',async()=>{
  const f=fixture(query+'&email=private%40fixture.invalid&token=secret');
  try{
    const tracking=create(f.window);await tracking.pageView();
    assert.equal(f.events.length,1);
    const event=f.events[0];
    assert.equal(event.page_path,'/residential');assert.equal(event.event_type,'page_view');
    assert.equal(event.utm_source,'flyer');assert.equal(event.utm_medium,'qr');
    assert.equal(event.utm_campaign,'residential_cameras_2026_11');assert.equal(event.utm_content,'camera_flyer');
    assert.equal(event.page_url,undefined);assert.doesNotMatch(JSON.stringify(event),/private|secret/);
    assert.match(event.visitor_id,/^[a-f0-9-]{36}$/);
  }finally{f.close();}
});
test('refreshes deduplicate campaign visits and direct returns retain attribution within the session',async()=>{
  const f=fixture();
  try{
    const first=create(f.window);await first.pageView();await create(f.window).pageView();
    assert.equal(f.events.length,1);
    f.window.history.replaceState({},'','/residential');
    const returned=create(f.window);await returned.pageView();
    assert.equal(f.events.length,1);assert.deepEqual(returned.attribution(),first.attribution());
    f.window.history.replaceState({},'','/residential'+query.replace('residential_cameras_2026_11','residential_tv_2026_11').replace('camera_flyer','tv_flyer'));
    await create(f.window).pageView();assert.equal(f.events.length,2);
    assert.equal(f.events[1].utm_content,'tv_flyer');
    assert.equal(f.events[1].utm_campaign,'residential_tv_2026_11');
    assert.equal(f.events[1].visitor_id,f.events[0].visitor_id);
  }finally{f.close();}
});
test('session expiry starts a new visit while retaining the browser visitor ID',async()=>{
  const f=fixture();
  try{
    await create(f.window).pageView();
    const key='h2s:residential:tracking:v1',state=JSON.parse(f.window.sessionStorage.getItem(key));
    state.expiresAt=Date.now()-1;f.window.sessionStorage.setItem(key,JSON.stringify(state));
    await create(f.window).pageView();
    assert.equal(f.events.length,2);assert.notEqual(f.events[0].session_id,f.events[1].session_id);
    assert.equal(f.events[0].visitor_id,f.events[1].visitor_id);
  }finally{f.close();}
});
test('tracking rejects ignored responses visibly and retries with the same deduplication ID',async()=>{
  const f=fixture();
  try{
    let calls=0;
    f.window.fetch=async(url,options)=>{f.events.push(JSON.parse(options.body));return Response.json(++calls===1?{ok:true,ignored:true,reason:'blocked'}:{ok:true});};
    const tracking=create(f.window);await tracking.pageView();assert.equal(f.warnings.length,1);
    await tracking.pageView();assert.equal(f.events.length,2);
    assert.equal(f.events[0].event_id,f.events[1].event_id);
    await tracking.lead('local-only-inquiry-token');await create(f.window).lead('local-only-inquiry-token');
    assert.equal(f.events.filter(event=>event.event_type==='lead').length,1);
    assert.doesNotMatch(JSON.stringify(f.events),/local-only-inquiry-token/);
  }finally{f.close();}
});
test('invalid UTM values and corrupt storage are reported and never forwarded',async()=>{
  const f=fixture('?utm_source=flyer&utm_campaign=%3Cscript%3E&utm_content='+('x'.repeat(101)));
  try{
    f.window.sessionStorage.setItem('h2s:residential:tracking:v1','not-json');
    const tracking=create(f.window);await tracking.pageView();
    assert.equal(f.events[0].utm_source,'flyer');assert.equal(f.events[0].utm_campaign,undefined);
    assert.equal(f.events[0].utm_content,undefined);assert.ok(f.warnings.length>=3);
  }finally{f.close();}
});
test('real residential UI submits campaign attribution and emits a lead only after a saved inquiry',async()=>{
  const f=fixture();
  try{
    f.window.TextEncoder=TextEncoder;
    Object.defineProperty(f.window.crypto,'subtle',{value:require('node:crypto').webcrypto.subtle});
    for(const name of ['media-placement-style.js','residential-media.js','residential-tracking.js','residential.js']){
      f.window.eval(fs.readFileSync(path.join(front,name),'utf8'));
    }
    const form=f.window.document.getElementById('residential-form');
    await until(()=>!form.querySelector('[type=submit]').disabled);
    assert.equal(f.events.filter(event=>event.event_type==='lead').length,0);
    form.elements.fullName.value='Tracking Fixture';form.elements.phone.value='+15550000005';form.elements.city.value='Fixture City';
    form.querySelector('[name=service][value="Security Cameras"]').checked=true;
    form.requestSubmit();await until(()=>f.events.some(event=>event.event_type==='lead'));
    assert.equal(f.inquiries.length,1);assert.equal(f.inquiries[0].attribution.utm_content,'camera_flyer');
    assert.deepEqual(f.inquiries[0].serviceNeeds,['Security Cameras']);
    assert.equal(f.events.find(event=>event.event_type==='lead').session_id,f.inquiries[0].attribution.session_id);
    assert.doesNotMatch(JSON.stringify(f.events),/Tracking Fixture|15550000005|Fixture City/);
  }finally{f.close();}
});
test('analytics network failures do not block an inquiry or erase its saved campaign attribution',async()=>{
  const f=fixture();
  try{
    const fetch=f.window.fetch;
    f.window.fetch=(url,options)=>url==='/api/track'?Promise.reject(new Error('Fixture analytics unavailable')):fetch(url,options);
    f.window.TextEncoder=TextEncoder;
    Object.defineProperty(f.window.crypto,'subtle',{value:require('node:crypto').webcrypto.subtle});
    for(const name of ['media-placement-style.js','residential-media.js','residential-tracking.js','residential.js']){
      f.window.eval(fs.readFileSync(path.join(front,name),'utf8'));
    }
    const form=f.window.document.getElementById('residential-form');
    await until(()=>!form.querySelector('[type=submit]').disabled);
    form.elements.fullName.value='Tracking Fixture';form.elements.phone.value='+15550000005';form.elements.city.value='Fixture City';
    form.querySelector('[name=service]').checked=true;
    form.requestSubmit();
    await until(()=>f.window.document.getElementById('residential-status').textContent.includes('HOME-TRACK'));
    assert.equal(f.inquiries[0].attribution.utm_source,'flyer');
    assert.equal(f.inquiries.length,1);assert.ok(f.warnings.length>=1);
    assert.match(f.window.document.getElementById('residential-status').textContent,/No installation is booked/);
  }finally{f.close();}
});
test('rejected inquiries never emit a saved-lead event',async()=>{
  const f=fixture();
  try{
    const fetch=f.window.fetch;
    f.window.fetch=(url,options)=>url==='/api/residential-intake'&&options.method==='POST'
      ?Promise.resolve(Response.json({ok:false,error:'Fixture validation rejection'},{status:400})):fetch(url,options);
    f.window.TextEncoder=TextEncoder;
    Object.defineProperty(f.window.crypto,'subtle',{value:require('node:crypto').webcrypto.subtle});
    for(const name of ['media-placement-style.js','residential-media.js','residential-tracking.js','residential.js']){
      f.window.eval(fs.readFileSync(path.join(front,name),'utf8'));
    }
    const form=f.window.document.getElementById('residential-form');
    await until(()=>!form.querySelector('[type=submit]').disabled);
    form.elements.fullName.value='Tracking Fixture';form.elements.phone.value='+15550000005';form.elements.city.value='Fixture City';
    form.querySelector('[name=service]').checked=true;form.requestSubmit();
    await until(()=>form.querySelector('[type=submit]').textContent==='Review and send request');
    assert.equal(f.events.filter(event=>event.event_type==='lead').length,0);
  }finally{f.close();}
});
