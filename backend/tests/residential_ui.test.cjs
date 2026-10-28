const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const front=path.resolve(__dirname,'..','..','frontend');
const file=name=>fs.readFileSync(path.join(front,name),'utf8');
async function waitFor(condition) {
  for(let attempt=0;attempt<100;attempt++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,5));}
  assert.fail('UI did not reach its expected state');
}
function homeowner(handler) {
  const dom=new JSDOM(file('residential.html'),{url:'http://localhost/residential',runScripts:'outside-only'});
  const {window}=dom,requests=[],pickers=[];
  window.fetch=async(url,options)=>{
    requests.push({url,options});
    return options.method==='GET'?Response.json({ok:true,enabled:true}):handler(JSON.parse(options.body));
  };
  window.flatpickr=(input,options)=>{
    const picker={options,open(){},destroy(){}};
    pickers.push(picker);return picker;
  };
  window.console.warn=()=>{};
  window.eval(file('date-popup.js'));window.eval(file('media-placement-style.js'));
  window.TextEncoder=TextEncoder;
  Object.defineProperty(window.crypto,'subtle',{value:require('node:crypto').webcrypto.subtle});
  window.eval(file('residential-media.js'));window.eval(file('residential.js'));
  const form=window.document.getElementById('residential-form');
  const fill=()=>{form.elements.fullName.value='Browser Fixture';form.elements.phone.value='+15550000005';form.elements.city.value='Fixture City';form.querySelector('[name=service]').checked=true;};
  return {dom,window,form,fill,requests,pickers,close:()=>window.close()};
}
test('minimal homeowner form sends one service and contact without requiring availability or long assessment',async()=>{
  const f=homeowner(async body=>Response.json({ok:true,reference:'HOME-FIXTURE',bookingConfirmed:false,notifications:{enabled:false}}));
  try{
    await waitFor(()=>!f.form.querySelector('[type=submit]').disabled);f.fill();
    f.form.requestSubmit();
    await waitFor(()=>f.window.document.getElementById('residential-status').textContent.includes('HOME-FIXTURE'));
    const body=JSON.parse(f.requests.find(value=>value.options.method==='POST').options.body);
    assert.deepEqual(body.serviceNeeds,['TV Mounting']);assert.deepEqual(body.availabilityPreferences,[]);assert.equal(body.smsOptIn,false);
    assert.equal(body.fullName,'Browser Fixture');assert.ok(body.publicToken.length>=20);
    assert.match(f.window.document.getElementById('residential-status').textContent,/No installation is booked/);
    assert.equal(f.requests.filter(value=>value.options.method==='POST').length,1);
  }finally{f.close();}
});
test('residential calendar removes decorative overflow without disabling constrained viewport scrolling',()=>{
  assert.match(file('residential.css'),/\.residential-page \.flatpickr-calendar::before,\s*\.residential-page \.flatpickr-calendar::after\s*\{\s*display:\s*none;\s*\}/);
  assert.match(file('date-popup.js'),/popup\.style\.overflowY = 'auto'/);
});
test('preferred days use popup calendars, cap at three, support removal, and remain explicitly preferences',async()=>{
  const f=homeowner(async()=>Response.json({ok:true,reference:'HOME-DATES',notifications:{enabled:false}}));
  try{
    await waitFor(()=>!f.form.querySelector('[type=submit]').disabled);f.fill();
    assert.equal(f.form.querySelector('details'),null);
    const add=f.window.document.getElementById('residential-add-day');
    for(let index=0;index<3;index++)add.click();
    assert.equal(f.pickers.length,3);assert.equal(add.disabled,true);
    for(const picker of f.pickers){assert.equal(picker.options.disableMobile,true);assert.equal(picker.options.monthSelectorType,'static');
      assert.equal(picker.options.altInput,true);assert.equal(picker.options.altFormat,'M j, Y');assert.equal(picker.options.dateFormat,'Y-m-d');
      assert.equal(picker.options.position,f.window.h2sDatePopupOptions.position);}
    f.window.document.querySelector('[data-remove]').click();
    assert.equal(add.disabled,false);
    Array.from(f.window.document.querySelectorAll('[data-date]')).forEach((input,index)=>{input.value=`2099-01-0${index+1}`;});
    f.form.requestSubmit();
    await waitFor(()=>f.requests.some(value=>value.options.method==='POST'));
    assert.equal(JSON.parse(f.requests.find(value=>value.options.method==='POST').options.body).availabilityPreferences.length,2);
  }finally{f.close();}
});
test('initial contact has no address lookup or accordion; note, dates and unchecked consent remain independent',async()=>{
  const f=homeowner(async()=>Response.json({ok:true,reference:'HOME-OPTIONAL',notifications:{enabled:false}}));
  try{
    await waitFor(()=>!f.form.querySelector('[type=submit]').disabled);f.fill();
    assert.equal(f.form.querySelector('[name=street]'),null);
    assert.equal(f.window.document.querySelector('script[src="/address-autocomplete.js"]'),null);
    assert.equal(f.form.elements.smsOptIn.checked,false);
    f.form.elements.notes.value='I have my own TV and mount.';
    f.window.document.getElementById('residential-add-day').click();
    f.form.elements.smsOptIn.checked=true;
    f.form.requestSubmit();
    await waitFor(()=>f.requests.some(value=>value.options.method==='POST'));
    const body=JSON.parse(f.requests.find(value=>value.options.method==='POST').options.body);
    assert.equal(body.installationAddress,undefined);
    assert.deepEqual(body.availabilityPreferences,[]);
    assert.equal(body.notes,'I have my own TV and mount.');
    assert.equal(body.smsOptIn,true);
  }finally{f.close();}
});
test('required errors are attached to their controls and validation does not submit',async()=>{
  const f=homeowner(async()=>{assert.fail('Invalid contact must not submit');});
  try{
    await waitFor(()=>!f.form.querySelector('[type=submit]').disabled);
    f.form.requestSubmit();
    assert.match(f.window.document.getElementById('residential-service-error').textContent,/Choose/);
    for(const name of ['fullName','phone','city'])assert.equal(f.form.elements[name].getAttribute('aria-invalid'),'true');
    f.fill();f.form.elements.phone.value='123';f.form.requestSubmit();
    assert.match(f.window.document.getElementById('residential-phone-error').textContent,/valid area code/);
    assert.equal(f.requests.filter(value=>value.options.method==='POST').length,0);
  }finally{f.close();}
});
test('uncertain submission locks the original payload and retry cannot create a second identity',async()=>{
  let attempt=0;
  const f=homeowner(async()=>{if(!attempt++)throw new Error('Fixture connection lost');return Response.json({ok:true,reference:'HOME-RETRY',notifications:{enabled:false}});});
  try{
    await waitFor(()=>!f.form.querySelector('[type=submit]').disabled);f.fill();f.form.requestSubmit();
    await waitFor(()=>f.form.querySelector('[type=submit]').textContent.includes('Retry this same'));
    assert.equal(f.form.elements.fullName.disabled,true);
    f.form.requestSubmit(f.form.querySelector('[type=submit]'));
    await waitFor(()=>f.window.document.getElementById('residential-status').textContent.includes('HOME-RETRY'));
    const posts=f.requests.filter(value=>value.options.method==='POST');
    assert.equal(posts.length,2);assert.equal(posts[0].options.body,posts[1].options.body);
  }finally{f.close();}
});
test('validation rejections allow corrected details; provider review warnings are not hidden',async()=>{
  let attempt=0;
  const f=homeowner(async()=>!attempt++?Response.json({ok:false,error:'Enter a valid phone number.'},{status:400}):
    Response.json({ok:true,reference:'HOME-REVIEW',notifications:{enabled:true,staff:{ok:false,skipped:true,needsReview:true}}}));
  try{
    await waitFor(()=>!f.form.querySelector('[type=submit]').disabled);f.fill();f.form.requestSubmit();
    await waitFor(()=>f.form.querySelector('[type=submit]').textContent==='Review and send request');
    assert.equal(f.form.elements.phone.disabled,false);f.form.elements.phone.value='+15550000006';
    f.form.requestSubmit(f.form.querySelector('[type=submit]'));
    await waitFor(()=>f.window.document.getElementById('residential-status').textContent.includes('HOME-REVIEW'));
    assert.match(f.window.document.getElementById('residential-status').textContent,/notification needs staff review/i);
    const posts=f.requests.filter(value=>value.options.method==='POST').map(value=>JSON.parse(value.options.body));
    assert.equal(posts[1].phone,'+15550000006');
    assert.equal(posts[1].publicToken,posts[0].publicToken);assert.equal(posts[1].submissionKey,posts[0].submissionKey);
  }finally{f.close();}
});
test('review page GET never accepts; the actual explicit button posts its unique token and decision',async()=>{
  const dom=new JSDOM(file('residential-review.html'),{url:'http://localhost/residential-review?token=fixture-review-token-00001',runScripts:'outside-only'});
  const {window}=dom,calls=[];
  try{
    window.fetch=async(url,options)=>{
      calls.push({url,options});
      return Response.json(options.method==='GET'?{ok:true,inquiry:{reference:'HOME-DOM',status:'pending',name:'<script>Fixture</script>',
        phone:'+15550000005',city:'Fixture City',services:['TV Mounting'],availability:'2099-01-01 (flexible)',notes:''}}:
        {ok:true,status:'approved',bookingConfirmed:false,customer:{ok:true}});
    };
    window.eval(file('residential-review.js'));
    const form=window.document.getElementById('residential-review-form');
    await waitFor(()=>!form.hidden);
    assert.equal(calls.length,1);assert.equal(calls[0].options.method,'GET');
    assert.equal(window.document.querySelectorAll('script:not([src])').length,0);
    assert.match(window.document.getElementById('residential-customer-name').textContent,/<script>Fixture<\/script>/);
    form.querySelector('[value=approve]').click();
    await waitFor(()=>calls.length===2 && form.hidden);
    assert.deepEqual(JSON.parse(calls[1].options.body),{token:'fixture-review-token-00001',action:'approve',note:''});
    assert.match(window.document.getElementById('residential-review-status').textContent,/Follow-up accepted/);
  }finally{window.close();}
});
function calendar(overrides = {}) {
  const dom=new JSDOM('<section id="commercialCalendar"></section>',{url:'http://localhost',runScripts:'outside-only'});
  const {window}=dom,requests=[],opened=[];
  const root=window.document.getElementById('commercialCalendar'),now=new Date(),start=new Date(now);
  start.setHours(12,0,0,0);const end=new Date(start);end.setHours(13);
  const entries=[{lead_id:'residential-fixture',customer:'Residential <Fixture>',market:'residential',starts_at:start.toISOString(),ends_at:end.toISOString(),effective_state:'confirmed'},
    {lead_id:'commercial-fixture',customer:'Commercial Fixture',market:'commercial',starts_at:start.toISOString(),ends_at:end.toISOString(),effective_state:'tentative',expires_at:end.toISOString()}];
  window.fetch=async(url,options)=>{
    requests.push({url,options});
    return Response.json({ok:true,calendar:{name:'Shared company calendar',entries,booking:null,history:[]}});
  };
  window.eval(file('commercial-calendar.js'));
  const options={apiBase:'',getToken:()=>'fixture-admin',onOpenLead:async id=>{opened.push(id);},...overrides};
  window.H2SCommercialCalendar.mountDashboard(root,options);
  return {window,root,requests,opened,options,close:()=>window.close()};
}
test('company calendar renders a real 42-day month, filters markets, opens the lead, and toggles to day agenda',async()=>{
  const f=calendar();
  try{
    await waitFor(()=>f.root.querySelectorAll('.commercial-calendar-day').length===42);
    assert.equal(f.root.classList.contains('commercial-calendar'),true);
    assert.equal(f.root.querySelectorAll('.commercial-calendar-event').length,2);
    assert.equal(f.root.querySelectorAll('.commercial-calendar-event script').length,0);
    const range=new URL(f.requests[0].url,'http://localhost').searchParams;
    assert.ok((Date.parse(range.get('end'))-Date.parse(range.get('start')))/86400000>40);
    f.root.querySelector('[data-calendar-market=residential]').click();
    assert.equal(f.root.querySelectorAll('.commercial-calendar-event').length,1);
    f.root.querySelector('.commercial-calendar-event').click();await waitFor(()=>f.opened.length===1);
    assert.equal(f.opened[0],'residential-fixture');
    f.root.querySelector('[data-calendar-view=agenda]').click();
    await waitFor(()=>!f.root.querySelector('.commercial-calendar-month'));
    assert.equal(f.root.querySelectorAll('.commercial-calendar-reservation').length,1);
    assert.match(f.root.querySelector('.commercial-calendar-agenda').textContent,/Residential/);
    f.root.querySelector('[data-calendar-market=all]').click();
    assert.equal(f.root.querySelectorAll('.commercial-calendar-reservation').length,2);
    f.root.querySelector('[data-calendar-view=month]').click();
    await waitFor(()=>f.root.querySelectorAll('.commercial-calendar-day').length===42);
    const before=f.root.querySelector('[name=day]').value;
    f.root.querySelector('[data-calendar-shift="1"]').click();
    await waitFor(()=>f.root.querySelector('[name=day]').value!==before && f.requests.length>=4);
  }finally{f.close();}
});

test('calendar state filters update day counts and a date tap keeps month context with readable day details',async()=>{
  const f=calendar();
  try{
    await waitFor(()=>f.root.querySelectorAll('.commercial-calendar-event').length===2);
    assert.match(f.root.querySelector('.commercial-calendar-day-count').getAttribute('aria-label'),/Show 2 reservations/);
    const state=f.root.querySelector('[data-calendar-state]');
    state.value='confirmed';state.dispatchEvent(new f.window.Event('change'));
    assert.equal(f.root.querySelectorAll('.commercial-calendar-event').length,1);
    assert.match(f.root.querySelector('.commercial-calendar-day-count').getAttribute('aria-label'),/Show 1 reservations/);
    f.root.querySelector('.commercial-calendar-day-count').click();
    assert.equal(f.root.querySelectorAll('.commercial-calendar-day').length,42);
    assert.equal(f.root.querySelector('[data-calendar-view=month]').getAttribute('aria-pressed'),'true');
    assert.equal(f.root.querySelectorAll('.commercial-calendar-day.is-selected').length,1);
    assert.match(f.root.querySelector('.commercial-calendar-agenda').textContent,/Residential/);
    assert.doesNotMatch(f.root.querySelector('.commercial-calendar-agenda').textContent,/Commercial Fixture/);
    state.value='cancelled';state.dispatchEvent(new f.window.Event('change'));
    assert.match(f.root.querySelector('.commercial-calendar-agenda').textContent,/No reservations match these filters/);
    assert.match(f.root.querySelector('[data-calendar-filter-summary]').textContent,/Cancelled/);
    state.value='active';state.dispatchEvent(new f.window.Event('change'));
    assert.equal(f.root.querySelectorAll('.commercial-calendar-agenda [data-calendar-open]').length,2);
    f.root.querySelector('.commercial-calendar-agenda [data-calendar-open]').click();await waitFor(()=>f.opened.length===1);
    assert.equal(f.opened[0],'residential-fixture');
  }finally{f.close();}
});

test('tap-first day details preserve the month, filter context and focus without posting or refetching a loaded month',async()=>{
  const f=calendar({openLabel:'Check reservation'});
  try{
    await waitFor(()=>f.root.querySelectorAll('.commercial-calendar-day').length===42);
    const current=f.root.querySelector('[name=day]').value,count=f.requests.length;
    const another=[...f.root.querySelectorAll('[data-calendar-day]')].find(button=>
      button.dataset.calendarDay.slice(0,7)===current.slice(0,7) && button.dataset.calendarDay!==current);
    another.click();
    assert.equal(f.requests.length,count);
    assert.equal(f.root.querySelectorAll('.commercial-calendar-day').length,42);
    assert.equal(f.root.querySelector('table'),null);
    assert.match(f.root.querySelector('.commercial-calendar-empty').textContent,/not a promise of availability/);
    assert.equal(f.root.querySelector('.is-selected [data-calendar-day]').dataset.calendarDay,another.dataset.calendarDay);
    assert.equal(f.window.document.activeElement,f.root.querySelector('[data-calendar-selected-heading]'));
    f.root.querySelector('[data-calendar-state-choice=tentative]').click();
    assert.equal(f.root.querySelector('[data-calendar-state]').hidden,true);
    assert.equal(f.root.querySelector('[data-calendar-state]').value,'tentative');
    assert.match(f.root.querySelector('[data-calendar-filter-summary]').textContent,/Both markets.*Holds/);
    assert.equal(f.window.document.activeElement,f.root.querySelector('[data-calendar-selected-heading]'));
    f.root.querySelector(`[data-calendar-day="${current}"]`).click();
    assert.equal(f.root.querySelectorAll('.commercial-calendar-reservation').length,1);
    assert.match(f.root.querySelector('.commercial-calendar-agenda').textContent,/Commercial Fixture/);
    assert.match(f.root.querySelector('.commercial-calendar-agenda').textContent,/Hold expires/);
    assert.equal(f.root.querySelector('.commercial-calendar-open').textContent,'Check reservation');
    assert.equal(f.requests.length,count);
    assert.ok(f.requests.every(call=>call.options.method==='GET'));
  }finally{f.close();}
});
test('shared calendar disables expired authentication and a fresh authenticated mount recovers',async()=>{
  let failures=0,authStatus;
  const f=calendar({onAuthError:code=>{failures++;authStatus=code;}});
  try{
    await waitFor(()=>f.root.querySelectorAll('.commercial-calendar-day').length===42);
    const successfulFetch=f.window.fetch;
    f.window.fetch=async()=>Response.json({ok:false,error:'Session expired'},{status:401});
    f.root.querySelector('[data-calendar-shift="1"]').click();
    await waitFor(()=>failures===1);
    assert.equal(authStatus,401);
    assert.ok([...f.root.querySelectorAll('input,select,button')].every(node=>node.disabled));
    assert.match(f.root.querySelector('[data-calendar-status]').textContent,/Calendar authorization required/);
    f.window.fetch=successfulFetch;
    f.window.H2SCommercialCalendar.mountDashboard(f.root,{...f.options,getToken:()=>'fresh-fixture-admin'});
    await waitFor(()=>f.root.querySelectorAll('.commercial-calendar-day').length===42);
    assert.equal(f.root.querySelector('[data-calendar-shift="1"]').disabled,false);
    assert.equal(f.requests.at(-1).options.referrerPolicy,'no-referrer');
  }finally{f.close();}
});

test('shared calendar auth callback may clear its root without an old response restoring it',async()=>{
  let failures=0,authStatus;
  const f=calendar({onAuthError:code=>{failures++;authStatus=code;f.root.replaceChildren();}});
  try{
    await waitFor(()=>f.root.querySelectorAll('.commercial-calendar-day').length===42);
    f.window.fetch=async()=>Response.json({ok:false,error:'Administrator required'},{status:403});
    f.root.querySelector('[data-calendar-shift="1"]').click();
    await waitFor(()=>failures===1);
    assert.equal(authStatus,403);
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(f.root.childElementCount,0);
  }finally{f.close();}
});

test('dashboard-controlled market updates an existing calendar without resetting date, view or state filter',async()=>{
  const f=calendar({market:'residential'});
  try{
    await waitFor(()=>f.root.querySelectorAll('.commercial-calendar-event').length===1);
    assert.equal(f.root.querySelector('[aria-label="Calendar market filter"]').hidden,true);
    f.root.querySelector('.commercial-calendar-day-count').click();
    assert.ok(f.root.querySelector('.commercial-calendar-agenda'));
    const day=f.root.querySelector('[name=day]'),value=day.value;
    const state=f.root.querySelector('[data-calendar-state]');
    state.value='tentative';state.dispatchEvent(new f.window.Event('change'));
    f.window.H2SCommercialCalendar.mountDashboard(f.root,{...f.options,market:'commercial'});
    assert.equal(f.root.querySelector('[name=day]'),day);assert.equal(day.value,value);
    assert.equal(f.root.querySelector('[data-calendar-view=month]').getAttribute('aria-pressed'),'true');
    assert.equal(state.value,'tentative');
    assert.match(f.root.querySelector('.commercial-calendar-agenda').textContent,/Commercial Fixture/);
    assert.doesNotMatch(f.root.querySelector('.commercial-calendar-agenda').textContent,/Residential/);
  }finally{f.close();}
});

test('calendar date changes load immediately without a Show/refresh button; Clear retains the selected range explicitly',async()=>{
  const f=calendar();
  try{
    await waitFor(()=>f.root.querySelectorAll('.commercial-calendar-day').length===42);
    const form=f.root.querySelector('[data-agenda-day]'),input=form.elements.day;
    assert.equal(form.querySelector('[type=submit]'),null);
    assert.doesNotMatch(form.textContent,/Show \/ refresh/);
    input.value='2099-01-15';input.dispatchEvent(new f.window.Event('change'));
    await waitFor(()=>f.root.querySelector('.commercial-calendar-month-title').textContent.includes('2099'));
    assert.match(f.root.querySelector('.commercial-calendar-month-title').textContent,/January 2099/);
    const requested=new URL(f.requests.at(-1).url,'http://localhost').searchParams;
    assert.equal(new Date(requested.get('start')).getFullYear(),2098);
    const before=f.requests.length;
    input.dispatchEvent(new f.window.Event('change'));
    assert.equal(f.requests.length,before,'Selecting the same date must not duplicate a request');
    input.value='';input.dispatchEvent(new f.window.Event('change'));
    assert.equal(f.requests.length,before);
    assert.match(f.root.querySelector('[data-calendar-status]').textContent,/Choose a calendar day.*previously selected calendar/);
    assert.match(f.root.querySelector('.commercial-calendar-month-title').textContent,/January 2099/);
    f.root.querySelector('[data-calendar-shift="1"]').click();
    await waitFor(()=>f.root.querySelector('.commercial-calendar-month-title').textContent.includes('February 2099'));
    assert.equal(input.value,'2099-02-01');assert.equal(f.root.querySelector('[data-calendar-status]').textContent,'');
    input.value='2099-03-20';form.dispatchEvent(new f.window.Event('submit',{cancelable:true}));
    await waitFor(()=>f.root.querySelector('.commercial-calendar-month-title').textContent.includes('March 2099'));
  }finally{f.close();}
});

test('rapid automatic date changes discard an older response and load the latest selected range',async()=>{
  const f=calendar();
  try{
    await waitFor(()=>f.root.querySelectorAll('.commercial-calendar-day').length===42);
    const original=f.window.fetch,urls=[];
    let resolveFirst;
    f.window.fetch=async(url,options)=>{
      urls.push(url);
      if(urls.length===1)await new Promise(resolve=>{resolveFirst=resolve;});
      return original(url,options);
    };
    const input=f.root.querySelector('[name=day]');
    input.value='2099-02-15';input.dispatchEvent(new f.window.Event('change'));
    input.value='2099-03-15';input.dispatchEvent(new f.window.Event('change'));
    resolveFirst();
    await waitFor(()=>f.root.querySelector('.commercial-calendar-month-title').textContent.includes('March 2099'));
    assert.equal(urls.length,2);
    assert.equal(input.value,'2099-03-15');
    const latest=new URL(urls[1],'http://localhost').searchParams;
    assert.equal(new Date(latest.get('start')).getMonth(),2);
  }finally{f.close();}
});
