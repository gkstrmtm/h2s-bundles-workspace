const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const front=path.resolve(__dirname,'..','..','frontend');
const file=name=>fs.readFileSync(path.join(front,name),'utf8');
const token='fixture-review-token-00001',sessionKey='h2s_dashboard_session_token_v1';
const retryKey='h2s_residential_callback_retry_v1:lead-home';
async function waitFor(condition) {
  for(let attempt=0;attempt<100;attempt++){if(condition())return;await new Promise(resolve=>setTimeout(resolve,5));}
  assert.fail('Workspace UI did not reach expected state');
}
function fixture(options={}) {
  const dom=new JSDOM(file('residential-review.html'),{url:`http://localhost/residential-review?token=${options.reviewToken || token}`,runScripts:'outside-only'});
  const {window}=dom,requests=[],mounts=[],pickers=[],scrolls=[];
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  window.scrollTo=value=>scrolls.push(value);
  let workspace={leadId:options.leadId || 'lead-home',reference:options.reference || 'HOME-SAME',reviewStatus:options.reviewStatus || 'approved',
    callback:{revision:3,status:'scheduled',dueAt:'2099-01-01T14:30:00.000Z',note:'Call after lunch',...options.callback},
    notices:options.notices || [{kind:'owner_callback',state:'pending',due_at:'2099-01-01T14:15:00.000Z'}],booking:options.booking || null};
  if(options.session)window.localStorage.setItem(sessionKey,options.session);
  if(options.retry)window.sessionStorage.setItem(retryKey,JSON.stringify(options.retry));
  if(options.noStorage)for(const key of ['localStorage','sessionStorage'])Object.defineProperty(window,key,{get(){throw new Error('Storage blocked');}});
  window.flatpickr=(input,config)=>{
    const picker={setDate(){},config,close(){this.closed=true;config.onClose?.([],'',this);},
      destroy(){this.destroyed=true;config.onDestroy?.([],'',this);delete input._flatpickr;}};
    input._flatpickr=picker;pickers.push(picker);return picker;
  };
  window.fetch=async(url,config={})=>{
    requests.push({url,options:config});
    if(url.startsWith('/api/residential-review')) {
      if(config.method==='POST') {
        if(options.reviewPost)return options.reviewPost(JSON.parse(config.body));
        workspace.reviewStatus=JSON.parse(config.body).action==='approve'?'approved':'declined';
        return Response.json({ok:true,status:workspace.reviewStatus,customer:{ok:true}});
      }
      return Response.json({ok:true,inquiry:{reference:workspace.reference,status:workspace.reviewStatus,
        name:options.name || 'Current Homeowner',phone:options.phone || '+1 (555) 000-0005',city:options.city || 'Fixture City',services:options.services || ['TV Mounting'],availability:options.availability || 'Discuss availability by phone',notes:'',bookingConfirmed:false}});
    }
    if(url.startsWith('/api/v1'))return Response.json({ok:true,dashboardLogin:{token:'admin-session',user:{role:options.role || 'ADMIN'}}});
    if(url.startsWith('/api/residential-workspace')) {
      if(options.expectedSession && config.headers?.Authorization!==`Bearer ${options.expectedSession}`)return Response.json({ok:false,error:'Wrong session header'},{status:401});
      if(options.workspaceError || options.role && options.role!=='ADMIN')return Response.json({ok:false,error:'Unavailable'},{status:options.workspaceError || 403});
      if(config.method==='POST') {
        const payload=JSON.parse(config.body);
        if(options.post)return options.post(payload,config);
        workspace={...workspace,callback:{revision:workspace.callback.revision+1,
          status:payload.action==='complete_callback'?'completed':payload.action==='cancel_callback'?'cancelled':'scheduled',
          dueAt:payload.dueAt || workspace.callback.dueAt,note:payload.note}};
      }
      return Response.json({ok:true,workspace});
    }
    if(url.startsWith('/api/commercial-calendar')) {
      if(options.expectedSession && config.headers?.Authorization!==`Bearer ${options.expectedSession}`)return Response.json({ok:false,error:'Wrong session header'},{status:401});
      if(config.method==='POST') {
        const payload=JSON.parse(config.body);
        if(options.calendarPost)return options.calendarPost(payload);
        workspace={...workspace,booking:{...workspace.booking,revision:(workspace.booking?.revision || 0)+1,
          state:payload.action==='cancel'?'cancelled':payload.action==='hold'?'tentative':'confirmed',
          starts_at:payload.payload.start || workspace.booking?.starts_at,ends_at:payload.payload.end || workspace.booking?.ends_at,
          timezone:payload.payload.timezone || workspace.booking?.timezone,expires_at:payload.payload.expiresAt}};
        return Response.json({ok:true,booking:workspace.booking,notifications:options.calendarNotifications || {enabled:false}});
      }
      return Response.json({ok:true,calendar:{name:'Company',entries:[],booking:workspace.booking,history:[]}});
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  if(options.realCalendar)window.eval(file('commercial-calendar.js'));
  else window.H2SCommercialCalendar={
    mountDashboard(root,config){mounts.push({type:'dashboard',root,config});root.textContent='Company calendar';},
    mountLead(root,leadId,config){mounts.push({type:'lead',root,leadId,config});root.innerHTML='<input name="draft" value="Original">';},
    refreshDashboard(){}
  };
  window.eval(file('date-popup.js'));window.eval(file('residential-workspace.js'));window.eval(file('residential-review.js'));
  const get=id=>window.document.getElementById(id);
  async function signIn() {
    const form=get('workspace-login');form.elements.username.value='owner';form.elements.pin.value='1234';
    form.requestSubmit();await waitFor(()=>get('workspace-status').textContent!=='Signing in...');
  }
  return {window,requests,mounts,pickers,scrolls,get,signIn,close:()=>{window.dispatchEvent(new window.Event('pagehide'));window.close();}};
}
test('removed reservation inputs destroy their date pickers and signing out closes the callback picker',async()=>{
  const f=fixture({session:'admin-session'});
  try {
    await waitFor(()=>f.mounts.length===2);
    const root=f.get('workspace-reservation'),input=f.window.document.createElement('input');
    input.type='datetime-local';root.append(input);
    await waitFor(()=>!!input._flatpickr);
    const picker=input._flatpickr,callbackPicker=f.window.document.querySelector('[name=dueAt]')._flatpickr;
    assert.equal(picker.config.position,f.window.h2sDatePopupOptions.position);
    root.replaceChildren();
    await waitFor(()=>picker.destroyed);
    f.get('workspace-signout').click();
    assert.equal(callbackPicker.closed,true);
  } finally {f.close();}
});
test('signed-out same link is review-only, safe call link and no persisted review token',async()=>{
  const f=fixture();
  try {
    await waitFor(()=>f.get('residential-call').hasAttribute('href'));
    assert.equal(f.requests.length,1);assert.equal(f.mounts.length,0);
    assert.equal(f.get('workspace-authenticated').hidden,true);
    assert.equal(f.get('residential-call').getAttribute('href'),'tel:+15550000005');
    assert.equal(f.window.localStorage.length,0);assert.equal(f.window.sessionStorage.length,0);
    assert.equal(f.window.document.querySelector('meta[name=referrer]').content,'no-referrer');
    assert.equal(f.window.document.querySelector('meta[name=robots]').content,'noindex,nofollow');
    assert.equal(f.get('residential-primary-action').textContent,'Sign in');
    assert.equal(f.get('residential-next-time').textContent,'Sign in to view saved times.');
    assert.equal(f.get('workspace-login-explanation').hidden,false);
  } finally {f.close();}
});
test('owner date pickers display readable dates while retaining minute-precision machine fields',async()=>{
  const f=fixture({session:'admin-session',realCalendar:true});
  try {
    await waitFor(()=>f.pickers.length>=4);
    for(const picker of f.pickers) {
      assert.equal(picker.config.altInput,true);
      assert.equal(picker.config.altFormat,picker.config.enableTime?'M j, Y, h:i K':'M j, Y');
      assert.equal(picker.config.dateFormat,picker.config.enableTime?'Y-m-d\\TH:i':'Y-m-d');
      assert.equal(picker.config.enableSeconds,false);
      assert.equal(picker.config.time_24hr,false);
    }
  } finally {f.close();}
});
test('editing only a callback note preserves the original instant including seconds',async()=>{
  const original='2099-01-01T14:30:42.123Z';
  const f=fixture({session:'admin-session',callback:{dueAt:original}});
  try {
    await waitFor(()=>f.mounts.length===2);
    const form=f.get('workspace-callback');
    form.elements.note.value='Same callback time, clarified note';
    form.requestSubmit(form.querySelector('button[value=schedule_callback]'));
    await waitFor(()=>f.requests.some(request=>request.options.method==='POST'));
    const body=JSON.parse(f.requests.find(request=>request.options.method==='POST').options.body);
    assert.equal(body.dueAt,original);
    await waitFor(()=>f.get('workspace-status').textContent==='Callback saved.');
  } finally {f.close();}
});
test('reservation details show month names and timezone without timestamp seconds',async()=>{
  const f=fixture({session:'admin-session',realCalendar:true,booking:{
    state:'confirmed',effective_state:'confirmed',starts_at:'2099-01-01T15:30:42Z',
    ends_at:'2099-01-01T17:30:57Z',timezone:'America/New_York',revision:1}});
  try {
    await waitFor(()=>f.get('workspace-reservation').querySelector('[data-calendar-form]'));
    const text=f.get('residential-installation-time').textContent;
    assert.match(text,/Jan 1/);
    assert.doesNotMatch(text,/\b\d{1,2}:\d{2}:\d{2}\b/);
  } finally {f.close();}
});
test('text update times omit seconds and explicitly flag invalid saved reminder times',async()=>{
  for(const [dueAt,expected] of [['2099-01-01T14:15:42Z',/Jan 1/],['invalid-time',/Reminder time unavailable/]]) {
    const f=fixture({session:'admin-session',notices:[{kind:'owner_callback',state:'pending',due_at:dueAt}]});
    try {
      await waitFor(()=>f.mounts.length===2);
      const text=f.get('workspace-notices').textContent;
      assert.match(text,expected);
      assert.doesNotMatch(text,/\b\d{1,2}:\d{2}:\d{2}\b/);
    } finally {f.close();}
  }
});
const noCallback={status:'none',dueAt:null,note:''};
const installation={state:'confirmed',effective_state:'confirmed',revision:1,starts_at:'2099-01-01T15:00:00Z',
  ends_at:'2099-01-01T17:00:00Z',timezone:'America/New_York'};
for(const example of [
  {name:'unscheduled',callback:noCallback,status:'Needs follow-up',when:/Installation not scheduled/,action:'call',label:'Call customer'},
  {name:'callback due',callback:{status:'scheduled',dueAt:'2000-01-01T15:00:00Z'},status:'Callback due',when:/Installation not scheduled/,action:'call',label:'Call customer'},
  {name:'confirmed',booking:installation,callback:noCallback,status:'Installation confirmed',when:/Jan 1.*10:00.*12:00.*EST/,action:'reschedule',label:'Reschedule'},
  {name:'cancelled',booking:{...installation,state:'cancelled',effective_state:'cancelled'},callback:noCallback,status:'Installation cancelled',when:/Cancelled:/,action:'confirm',label:'Book installation'},
  {name:'completed',booking:{...installation,state:'completed',effective_state:'completed'},callback:noCallback,status:'Installation completed',when:/Completed:.*Jan 1/,action:'installation-summary',label:'View installation'},
])test(`compact ${example.name} overview identifies customer, location, saved time and a single next action`,async()=>{
  const f=fixture({session:'admin-session',...example,name:'Maya Bennett',city:'Charlotte',services:['TV Mounting','Security Cameras']});
  try {
    await waitFor(()=>f.mounts.length===2);
    assert.equal(f.get('residential-customer-name').tagName,'H1');
    assert.equal(f.get('residential-customer-name').textContent,'Maya Bennett');
    assert.equal(f.get('residential-customer-context').textContent,'TV Mounting, Security Cameras · Charlotte');
    assert.equal(f.get('residential-operational-status').textContent,example.status);
    assert.match(f.get('residential-next-time').textContent,example.when);
    const visible=['residential-primary-action','residential-primary-call'].map(f.get).filter(element=>!element.hidden);
    assert.equal(visible.length,1);assert.equal(visible[0].textContent,example.label);
    assert.equal(f.get('workspace-task-dialog').open,false);
    assert.equal(f.get('workspace-callback-editor').hidden,true);
    assert.equal(f.get('workspace-installation-editor').hidden,true);
    assert.equal(f.get('workspace-calendar-details').hidden,true);
    assert.equal(f.get('workspace-login-explanation').hidden,true);
    assert.equal(f.get('residential-customer-details').tagName,'SECTION');
    assert.equal(f.get('residential-customer-details').hidden,false);
    assert.match(f.get('residential-review-details').textContent,/HOME-SAME/);
    assert.equal(f.window.document.querySelectorAll('#residential-installation-time').length,1);
    const before=f.requests.filter(request=>request.options.method==='POST').length;
    if(example.action==='call')assert.equal(visible[0].getAttribute('href'),'tel:+15550000005');
    else {
      visible[0].click();
      assert.equal(f.get('workspace-task-dialog').open,true);
      assert.equal(f.get('workspace-installation-editor').hidden,example.action==='installation-summary');
      assert.equal(f.requests.filter(request=>request.options.method==='POST').length,before);
    }
    if(example.name==='confirmed' || example.name==='completed')assert.doesNotMatch(f.get('residential-next-action').textContent,/agree|discuss|book a new/i);
    if(example.name==='completed') {
      assert.equal(f.get('workspace-installation-label').textContent,'Book another installation');
      assert.match(f.get('workspace-installation-help').textContent,/another visit/);
    } else assert.equal(f.get('workspace-installation-help').textContent,'');
  } finally {f.close();}
});
test('the primary acceptance uses the existing review form once and remains separate from booking',async()=>{
  let finish;
  const f=fixture({reviewStatus:'pending',reviewPost:()=>new Promise(resolve=>{finish=resolve;})});
  try {
    await waitFor(()=>!f.get('residential-primary-action').hidden);
    assert.equal(f.get('residential-primary-action').textContent,'Accept follow-up');
    assert.equal(f.get('residential-review-boundary').hidden,false);
    f.get('residential-primary-action').click();f.get('residential-primary-action').click();
    await waitFor(()=>!!finish);
    assert.equal(f.get('residential-primary-action').disabled,true);
    const posts=f.requests.filter(request=>request.options.method==='POST');
    assert.equal(posts.length,1);assert.match(posts[0].url,/residential-review$/);
    assert.deepEqual(JSON.parse(posts[0].options.body),{token,action:'approve',note:''});
    finish(Response.json({ok:true,status:'approved',customer:{ok:true}}));
    await waitFor(()=>!f.get('residential-primary-action').disabled);
    assert.equal(f.get('residential-primary-action').textContent,'Sign in');
    assert.equal(f.get('residential-review-boundary').hidden,true);
    assert.equal(f.requests.some(request=>request.url.includes('commercial-calendar')),false);
  } finally {f.close();}
});
test('focused callback editor saves and returns while the saved summary survives reopening',async()=>{
  const f=fixture({session:'admin-session',callback:noCallback});
  try {
    await waitFor(()=>f.mounts.length===2);
    f.get('workspace-callback-label').click();
    const form=f.get('workspace-callback');
    form.elements.note.value='Call about the wall type';
    form.elements.dueAt.value='2099-02-01T12:30';
    form.elements.note.dispatchEvent(new f.window.Event('input',{bubbles:true}));
    assert.equal(f.get('residential-primary-action').textContent,'Continue callback edit');
    form.requestSubmit(form.querySelector('button[value=schedule_callback]'));
    await waitFor(()=>f.get('workspace-status').textContent==='Callback saved.');
    assert.equal(f.get('workspace-task-dialog').open,false);
    assert.match(f.get('workspace-saved').textContent,/Call scheduled.*Call about the wall type/);
    assert.equal(f.get('workspace-callback-label').textContent,'Edit callback');
    f.get('residential-primary-action').click();
    assert.equal(f.get('workspace-callback-editor').hidden,false);
    assert.equal(form.elements.note.value,'Call about the wall type');
  } finally {f.close();}
});
test('confirmed primary action opens the existing reservation editor without submitting or losing its draft',async()=>{
  const f=fixture({session:'admin-session',callback:noCallback,booking:installation,realCalendar:true});
  try {
    await waitFor(()=>f.get('workspace-reservation').querySelector('[data-calendar-form]'));
    f.get('residential-primary-action').click();
    const form=f.get('workspace-reservation').querySelector('[data-calendar-form]');
    assert.equal(form.elements.calendarAction.value,'reschedule');
    assert.equal(f.get('workspace-installation-editor').hidden,false);
    form.elements.calendarReason.value='Keep this agreed-window draft';
    form.elements.calendarReason.dispatchEvent(new f.window.Event('input',{bubbles:true}));
    f.get('residential-primary-action').click();
    assert.equal(form.elements.calendarReason.value,'Keep this agreed-window draft');
    assert.equal(f.requests.some(request=>request.options.method==='POST'),false);
    f.get('workspace-signout').click();
    assert.equal(f.get('residential-next-time').textContent,'Sign in to view saved times.');
    assert.equal(f.get('residential-primary-action').textContent,'Sign in');
    assert.doesNotMatch(f.get('residential-next-time').textContent,/Jan 1|Confirmed/);
  } finally {f.close();}
});
test('one focused task replaces the overview accordions and protects callback edits when switching',async()=>{
  const f=fixture({session:'admin-session'});
  try {
    await waitFor(()=>f.mounts.length===2);
    assert.equal(f.window.document.querySelectorAll('main details').length,0);
    assert.equal(f.get('residential-customer-details').hidden,false);
    assert.match(f.get('workspace-saved').textContent,/Call after lunch/);
    Object.defineProperty(f.window,'scrollY',{value:168,configurable:true});
    f.get('workspace-callback-label').click();
    const form=f.get('workspace-callback');
    form.elements.note.value='Keep this callback draft';
    form.elements.note.dispatchEvent(new f.window.Event('input',{bubbles:true}));
    assert.equal(f.get('workspace-callback-recovery').hidden,true);
    const calendar=f.get('workspace-task-nav').querySelector('[data-workspace-task=calendar]');
    calendar.click();
    assert.equal(f.get('workspace-task-exit').hidden,false);
    assert.equal(f.get('workspace-task-body').hidden,true);
    f.get('workspace-task-keep').click();
    assert.equal(form.elements.note.value,'Keep this callback draft');
    assert.equal(f.get('workspace-callback-editor').hidden,false);
    calendar.click();f.get('workspace-task-discard').click();
    await waitFor(()=>!f.get('workspace-calendar-details').hidden);
    assert.equal(form.elements.note.value,'Call after lunch');
    assert.equal(f.window.document.querySelectorAll('[data-workspace-task-panel]:not([hidden])').length,1);
    assert.match(f.get('workspace-task-customer').textContent,/Current Homeowner.*Fixture City/);
    f.get('workspace-task-cancel').click();
    assert.equal(f.get('workspace-task-dialog').open,false);
    assert.equal(f.scrolls.at(-1).top,168);
    assert.equal(f.requests.some(request=>request.options.method==='POST'),false);
    await waitFor(()=>f.get('workspace-status').textContent==='');
  } finally {f.close();}
});
test('Cancel discards only local callback edits and reopening uses the saved values',async()=>{
  const f=fixture({session:'admin-session'});
  try {
    await waitFor(()=>f.mounts.length===2);
    f.get('workspace-callback-label').click();
    const form=f.get('workspace-callback');
    form.elements.note.value='Unsaved change';
    form.elements.note.dispatchEvent(new f.window.Event('input',{bubbles:true}));
    f.get('workspace-task-cancel').click();
    assert.equal(f.get('workspace-task-dialog').open,true);
    f.get('workspace-task-discard').click();
    assert.equal(f.get('workspace-task-dialog').open,false);
    f.get('workspace-callback-label').click();
    assert.equal(form.elements.note.value,'Call after lunch');
    assert.equal(f.requests.some(request=>request.options.method==='POST'),false);
    f.get('workspace-task-cancel').click();
    assert.equal(f.get('workspace-task-dialog').open,false);
    await waitFor(()=>f.get('workspace-status').textContent==='');
  } finally {f.close();}
});
test('focused callback Save submits once, returns to the overview and reopens saved values',async()=>{
  const f=fixture({session:'admin-session',callback:noCallback});
  try {
    await waitFor(()=>f.mounts.length===2);
    assert.equal(f.get('workspace-callback-label').textContent,'Set callback');
    f.get('workspace-callback-label').click();
    assert.equal(f.get('workspace-task-title').textContent,'Set callback');
    const form=f.get('workspace-callback');
    form.elements.dueAt.value='2099-02-01T12:30';form.elements.note.value='New callback agreement';
    form.elements.note.dispatchEvent(new f.window.Event('input',{bubbles:true}));
    f.get('workspace-task-save').click();f.get('workspace-task-save').click();
    await waitFor(()=>f.get('workspace-status').textContent==='Callback saved.');
    assert.equal(f.requests.filter(request=>request.options.method==='POST').length,1);
    assert.equal(f.get('workspace-task-dialog').open,false);
    assert.match(f.get('workspace-saved').textContent,/New callback agreement/);
    f.get('workspace-callback-label').click();
    assert.equal(f.get('workspace-task-title').textContent,'Edit callback');
    assert.equal(form.elements.note.value,'New callback agreement');
    assert.equal(form.elements.dueAt.value,'2099-02-01 12:30');
  } finally {f.close();}
});
test('Escape follows Cancel and saving prevents task switching or abandoning an in-flight callback',async()=>{
  let resolveSave;
  const f=fixture({session:'admin-session',post:()=>new Promise(resolve=>{resolveSave=resolve;})});
  try {
    await waitFor(()=>f.mounts.length===2);
    f.get('workspace-callback-label').click();
    const form=f.get('workspace-callback');
    form.elements.note.value='Agreed callback change';
    form.elements.note.dispatchEvent(new f.window.Event('input',{bubbles:true}));
    const escape=new f.window.Event('cancel',{cancelable:true});
    f.get('workspace-task-dialog').dispatchEvent(escape);
    assert.equal(escape.defaultPrevented,true);assert.equal(f.get('workspace-task-exit').hidden,false);
    f.get('workspace-task-keep').click();f.get('workspace-task-save').click();
    await waitFor(()=>!!resolveSave);
    assert.equal(f.get('workspace-task-cancel').disabled,true);
    f.get('workspace-task-dialog').dispatchEvent(new f.window.Event('cancel',{cancelable:true}));
    assert.equal(f.get('workspace-task-exit').hidden,true);
    assert.equal(f.get('workspace-task-dialog').open,true);
    assert.equal(f.get('workspace-task-nav').querySelector('[data-workspace-task=calendar]').disabled,true);
    resolveSave(Response.json({ok:true,workspace:{leadId:'lead-home',reference:'HOME-SAME',reviewStatus:'approved',booking:null,notices:[],
      callback:{revision:4,status:'scheduled',dueAt:'2099-01-01T14:30:00.000Z',note:'Agreed callback change'}}}));
    await waitFor(()=>f.get('workspace-status').textContent==='Callback saved.');
    assert.equal(f.get('workspace-task-dialog').open,false);
  } finally {f.close();}
});
for(const action of ['complete_callback','cancel_callback'])test(`focused callback Save preserves ${action} without requiring a new time`,async()=>{
  const f=fixture({session:'admin-session'});
  try {
    await waitFor(()=>f.mounts.length===2);
    f.get('workspace-callback-label').click();
    const form=f.get('workspace-callback');
    form.elements.callbackAction.value=action;form.elements.note.value='Customer follow-up recorded';
    form.elements.callbackAction.dispatchEvent(new f.window.Event('change',{bubbles:true}));
    assert.equal(f.get('workspace-callback-time-field').hidden,true);
    f.get('workspace-task-save').click();
    await waitFor(()=>f.get('workspace-status').textContent==='Callback saved.');
    const body=JSON.parse(f.requests.find(request=>request.options.method==='POST').options.body);
    assert.equal(body.action,action);assert.equal(body.dueAt,undefined);
    assert.equal(f.get('workspace-task-dialog').open,false);
  } finally {f.close();}
});
test('installation switching discards its local draft, not the saved reservation, and history is not nested',async()=>{
  const f=fixture({session:'admin-session',realCalendar:true,booking:installation,callback:noCallback});
  try {
    await waitFor(()=>f.get('workspace-reservation').querySelector('[data-calendar-form]'));
    f.get('residential-primary-action').click();
    const form=f.get('workspace-reservation').querySelector('form');
    form.elements.calendarReason.value='Unsaved reservation note';
    form.elements.calendarReason.dispatchEvent(new f.window.Event('input',{bubbles:true}));
    f.get('workspace-task-nav').querySelector('[data-workspace-task=calendar]').click();
    assert.equal(f.get('workspace-task-exit').hidden,false);
    f.get('workspace-task-discard').click();
    await waitFor(()=>!f.get('workspace-calendar-details').hidden);
    f.get('workspace-task-nav').querySelector('[data-workspace-task=installation]').click();
    await waitFor(()=>!f.get('workspace-installation-editor').hidden);
    assert.equal(f.get('workspace-reservation').querySelector('[name=calendarReason]').value,'');
    assert.equal(f.get('workspace-reservation').querySelectorAll('details').length,0);
    assert.match(f.get('workspace-calendar-history').textContent,/No calendar changes recorded/);
    assert.match(f.get('residential-installation-time').textContent,/Confirmed:/);
    assert.equal(f.requests.some(request=>request.options.method==='POST'),false);
    await waitFor(()=>f.get('workspace-status').textContent==='');
  } finally {f.close();}
});
test('installation Save returns once, keeps notification warnings visible and reopens the saved window',async()=>{
  const f=fixture({session:'admin-session',realCalendar:true,booking:installation,callback:noCallback,
    calendarNotifications:{enabled:true,needsReview:true}});
  try {
    await waitFor(()=>f.get('workspace-reservation').querySelector('[data-calendar-form]'));
    f.get('residential-primary-action').click();
    let form=f.get('workspace-reservation').querySelector('form');
    form.elements.calendarStart.value='2099-02-01T12:30';form.elements.calendarEnd.value='2099-02-01T14:30';
    form.elements.customerAgreed.checked=true;form.elements.calendarReason.value='Customer agreed by phone';
    form.elements.calendarReason.dispatchEvent(new f.window.Event('input',{bubbles:true}));
    f.get('workspace-task-save').click();f.get('workspace-task-save').click();
    await waitFor(()=>!f.get('workspace-task-dialog').open);
    assert.equal(f.requests.filter(request=>request.options.method==='POST').length,1);
    assert.match(f.get('workspace-calendar-result').textContent,/needs review/);
    assert.match(f.get('workspace-calendar-message').textContent,/do not resend/);
    f.get('residential-primary-action').click();
    form=f.get('workspace-reservation').querySelector('form');
    assert.equal(form.elements.calendarStart.value,'2099-02-01T12:30');
    await waitFor(()=>f.get('workspace-status').textContent==='');
  } finally {f.close();}
});
test('focused installation shows hold-only fields only when holding time and keeps its rules intact',async()=>{
  const f=fixture({session:'admin-session',realCalendar:true,callback:noCallback});
  try {
    await waitFor(()=>f.get('workspace-reservation').querySelector('[data-calendar-form]'));
    f.get('workspace-installation-label').click();
    const form=f.get('workspace-reservation').querySelector('form');
    assert.equal(form.elements.calendarExpiry.closest('label').hidden,true);
    assert.equal(form.elements.customerAgreed.closest('label').hidden,false);
    assert.equal(form.elements.customerAgreed.required,true);
    form.elements.calendarAction.value='hold';
    form.elements.calendarAction.dispatchEvent(new f.window.Event('change',{bubbles:true}));
    assert.equal(form.elements.calendarExpiry.closest('label').hidden,false);
    assert.equal(form.elements.calendarExpiry.required,true);
    assert.equal(form.elements.customerAgreed.closest('label').hidden,true);
    assert.equal(form.elements.customerAgreed.disabled,true);
    form.elements.calendarAction.value='confirm';
    form.elements.calendarAction.dispatchEvent(new f.window.Event('change',{bubbles:true}));
    assert.equal(form.elements.calendarExpiry.closest('label').hidden,true);
    assert.equal(form.elements.customerAgreed.required,true);
    await waitFor(()=>f.get('workspace-status').textContent==='');
  } finally {f.close();}
});
test('uncertain installation saves stay in the focused task and unchanged retry retains the operation key',async()=>{
  const f=fixture({session:'admin-session',realCalendar:true,booking:installation,callback:noCallback,
    calendarPost:async()=>Response.json({ok:false,error:'Uncertain network result'},{status:503})});
  try {
    await waitFor(()=>f.get('workspace-reservation').querySelector('[data-calendar-form]'));
    f.get('residential-primary-action').click();
    const form=f.get('workspace-reservation').querySelector('form');
    form.elements.customerAgreed.checked=true;form.elements.calendarReason.value='Customer agreed by phone';
    form.elements.calendarReason.dispatchEvent(new f.window.Event('input',{bubbles:true}));
    f.get('workspace-task-save').click();
    await waitFor(()=>f.get('workspace-reservation').textContent.includes('Uncertain network result'));
    assert.equal(f.get('workspace-task-dialog').open,true);
    f.get('workspace-task-cancel').click();
    assert.match(f.get('workspace-task-exit-message').textContent,/may already have reached the server/);
    f.get('workspace-task-keep').click();f.get('workspace-task-save').click();
    await waitFor(()=>f.requests.filter(request=>request.options.method==='POST').length===2&&!f.get('workspace-task-save').disabled);
    const bodies=f.requests.filter(request=>request.options.method==='POST').map(request=>JSON.parse(request.options.body));
    assert.equal(bodies[0].operationId,bodies[1].operationId);
  } finally {f.close();}
});
test('Account lives in the header and existing sign-in returns to the saved overview',async()=>{
  const f=fixture({session:'admin-session'});
  try {
    await waitFor(()=>f.mounts.length===2);
    assert.ok(f.get('workspace-account-trigger').closest('header'));
    assert.equal(f.get('workspace-authenticated').contains(f.get('workspace-signout')),false);
    f.get('workspace-account-trigger').click();
    assert.equal(f.get('workspace-task-title').textContent,'Account');
    f.get('workspace-signout').click();
    assert.equal(f.get('workspace-authenticated').hidden,true);
    assert.match(f.get('workspace-saved').textContent,/Sign in/);
    await f.signIn();await waitFor(()=>!f.get('workspace-task-dialog').open);
    assert.match(f.get('workspace-saved').textContent,/Call after lunch/);
  } finally {f.close();}
});
test('customer availability stays separate from the authenticated confirmed installation window',async()=>{
  const f=fixture({availability:'Tuesday through Thursday, afternoon preferred',
    booking:{state:'confirmed',effective_state:'confirmed',revision:1,starts_at:'2099-01-01T15:00:00Z',ends_at:'2099-01-01T17:00:00Z',timezone:'America/New_York'}});
  try {
    await waitFor(()=>f.get('residential-customer-name').textContent==='Current Homeowner');
    const reviewStatus=f.get('residential-review-status');
    assert.doesNotMatch(reviewStatus.textContent,/No installation is booked|No booking was created/);
    assert.equal(reviewStatus.textContent,'');
    assert.match(f.get('residential-review-details').textContent,/Tuesday through Thursday, afternoon preferred/);
    assert.match(f.get('residential-installation-time').textContent,/Sign in/);
    await f.signIn();await waitFor(()=>f.mounts.length===2);
    assert.match(f.get('residential-installation-time').textContent,/Confirmed:.*Jan 1.*10:00.*12:00.*EST/);
    f.mounts[1].config.onActivity();
    await waitFor(()=>f.get('workspace-status').textContent==='');
    assert.doesNotMatch(reviewStatus.textContent,/No installation is booked|No booking was created/);
    assert.equal(reviewStatus.textContent,'');
    assert.match(f.get('residential-review-details').textContent,/Tuesday through Thursday, afternoon preferred/);
  } finally {f.close();}
});
test('inline admin login reopens saved callback and both shared calendar surfaces without switching customer',async()=>{
  const f=fixture();
  try {
    await f.signIn();await waitFor(()=>f.mounts.length===2);
    assert.match(f.get('workspace-saved').textContent,/Call scheduled.*Call after lunch/);
    assert.doesNotMatch(f.get('workspace-saved').textContent,/Revision/);
    assert.equal(f.get('workspace-callback').elements.note.value,'Call after lunch');
    assert.equal(f.get('workspace-login').elements.pin.value,'');
    assert.equal(f.window.localStorage.getItem(sessionKey),'admin-session');
    assert.equal(f.mounts[1].leadId,'lead-home');
    const originalInstant='2099-01-01T14:30:42.000Z';
    const dateMarkup=f.mounts[1].config.dateInput('calendarStart','Start',originalInstant,'required');
    const dateForm=f.window.document.createElement('form');dateForm.innerHTML=dateMarkup;
    assert.equal(f.mounts[1].config.instantValue(dateForm,'calendarStart'),originalInstant);
    dateForm.elements.calendarStart.type='text';dateForm.elements.calendarStart.value='not-a-time';
    assert.throws(()=>f.mounts[1].config.instantValue(dateForm,'calendarStart'),/valid local time|Invalid/);
    f.mounts[0].config.onOpenLead('other-customer');
    assert.match(f.get('workspace-calendar-context').textContent,/another customer.*remains selected/);
    f.mounts[0].config.onOpenLead('lead-home');
    assert.match(f.get('workspace-calendar-context').textContent,/Choose Installation/);
    assert.match(f.get('workspace-context').textContent,/Signed in.*dashboard/);
    assert.match(f.get('residential-review-details').textContent,/HOME-SAME/);
    assert.equal(f.window.location.search,`?token=${token}`);
    assert.equal(f.mounts.length,2);
    assert.equal(f.requests.find(call=>call.url.includes('residential-workspace')).options.headers.Authorization,'Bearer admin-session');
    for(const request of f.requests)assert.equal(request.options.referrerPolicy,'no-referrer');
    assert.doesNotMatch(f.window.localStorage.getItem(sessionKey),new RegExp(token));
  } finally {f.close();}
});
test('stored admin session reopens persistent server callback, while pending review gates scheduling',async()=>{
  const f=fixture({session:'stored-admin',reviewStatus:'pending'});
  try {
    await waitFor(()=>!f.get('workspace-authenticated').hidden);
    assert.equal(f.mounts.length,1);assert.equal(f.get('workspace-callback').hidden,true);
    assert.equal(f.get('workspace-reservation-section').hidden,true);
    assert.match(f.get('workspace-approval').textContent,/Accept follow-up/);
    assert.equal(f.get('residential-review-form').hidden,false);
  } finally {f.close();}
});
test('fixture-admin seeded before either script restores with the exact first workspace Authorization header and no login',async()=>{
  const f=fixture({session:'fixture-admin',expectedSession:'fixture-admin',realCalendar:true});
  try {
    await waitFor(()=>f.get('workspace-reservation').querySelector('[data-calendar-form]'));
    const workspaceRequests=f.requests.filter(call=>call.url.startsWith('/api/residential-workspace'));
    assert.equal(workspaceRequests.length,1);
    assert.equal(workspaceRequests[0].options.method,'GET');
    assert.equal(workspaceRequests[0].options.headers.Authorization,'Bearer fixture-admin');
    assert.equal(f.requests.some(call=>call.url.startsWith('/api/v1')),false);
    assert.equal(f.get('workspace-authenticated').hidden,false);
    assert.equal(f.window.localStorage.getItem(sessionKey),'fixture-admin');
    assert.match(f.get('workspace-saved').textContent,/Call scheduled.*Call after lunch/);
    const calendarRequests=f.requests.filter(call=>call.url.startsWith('/api/commercial-calendar'));
    assert.equal(calendarRequests.length,2);
    for(const request of calendarRequests)assert.equal(request.options.headers.Authorization,'Bearer fixture-admin');
  } finally {f.close();}
});
test('expired staff sessions require login; forbidden staff keep their valid dashboard session without a login loop',async()=>{
  for(const options of [{role:'VA'},{session:'invalid',workspaceError:401},{session:'staff-session',workspaceError:403}]) {
    const f=fixture(options);
    try {
      if(!options.session)await f.signIn();
      await waitFor(()=>/ADMIN role|expired/.test(f.get('workspace-status').textContent));
      assert.equal(f.mounts.length,0);assert.equal(f.get('workspace-authenticated').hidden,true);
      if(options.workspaceError===401) {
        assert.equal(f.window.localStorage.getItem(sessionKey),null);
        assert.equal(f.get('workspace-login').hidden,false);
      } else {
        assert.equal(f.window.localStorage.getItem(sessionKey),options.session || 'admin-session');
        assert.equal(f.get('workspace-login').hidden,true);
        assert.equal(f.get('workspace-account-switch').hidden,false);
        const count=f.requests.length;
        f.window.dispatchEvent(new f.window.Event('focus'));await new Promise(resolve=>setTimeout(resolve,20));
        assert.equal(f.requests.length,count);
        f.get('workspace-account-switch').click();
        assert.equal(f.get('workspace-login').hidden,false);
      }
    } finally {f.close();}
  }
});
test('unavailable storage explicitly permits in-memory login; disabled workspace does not mount calendars',async()=>{
  const f=fixture({noStorage:true}),disabled=fixture({session:'admin',workspaceError:503});
  try {
    await f.signIn();await waitFor(()=>f.mounts.length===2);
    assert.match(f.get('workspace-storage').textContent,/unavailable.*memory only/);
    await waitFor(()=>disabled.get('workspace-status').textContent.includes('Unable to load'));
    assert.equal(disabled.mounts.length,0);assert.equal(disabled.get('workspace-authenticated').hidden,true);
  } finally {f.close();disabled.close();}
});
test('workspace refresh preserves dirty callback and reservation drafts; uncertain retry reuses exact persisted operation',async()=>{
  let attempts=0;
  const f=fixture({session:'admin',post:async payload=>{
    if(!attempts++)throw new Error('Lost response');
    return Response.json({ok:true,workspace:{leadId:'lead-home',reference:'HOME-SAME',reviewStatus:'approved',
      callback:{revision:4,status:'scheduled',dueAt:payload.dueAt,note:payload.note},notices:[],booking:null}});
  }});
  try {
    await waitFor(()=>f.mounts.length===2);
    const form=f.get('workspace-callback');
    form.elements.note.value='New callback draft';form.elements.note.dispatchEvent(new f.window.Event('input',{bubbles:true}));
    form.elements.dueAt.value='2099-02-01T12:30';
    const draft=f.get('workspace-reservation').firstChild;draft.value='Unsaved installation';f.mounts[1].config.onDirty(true);
    assert.equal(f.get('workspace-refresh'),null);
    f.window.dispatchEvent(new f.window.Event('focus'));
    await waitFor(()=>f.get('workspace-status').textContent.includes('Unsaved drafts'));
    assert.equal(form.elements.note.value,'New callback draft');assert.equal(draft.value,'Unsaved installation');assert.equal(f.mounts.length,2);
    form.requestSubmit(form.querySelector('button[value=schedule_callback]'));
    await waitFor(()=>f.get('workspace-status').textContent.includes('uncertain'));
    const retry=JSON.parse(f.window.sessionStorage.getItem(retryKey));
    assert.equal(retry.note,'New callback draft');assert.ok(retry.operationId);assert.equal(retry.token,undefined);
    assert.equal(form.elements.note.disabled,true);
    f.get('workspace-retry').click();
    await waitFor(()=>f.get('workspace-status').textContent.startsWith('Callback saved'));
    const posts=f.requests.filter(call=>call.url==='/api/residential-workspace' && call.options.method==='POST');
    assert.equal(posts.length,2);assert.equal(posts[0].options.body,posts[1].options.body);
    assert.equal(f.window.sessionStorage.getItem(retryKey),null);
    assert.equal(draft.value,'Unsaved installation');
  } finally {f.close();}
});
test('409 retains draft until explicit discard/reload; saved state refresh does not silently overwrite it',async()=>{
  const f=fixture({session:'admin',post:()=>Response.json({ok:false,error:'Revision changed'},{status:409})});
  try {
    await waitFor(()=>f.mounts.length===2);const form=f.get('workspace-callback');
    form.elements.note.value='Conflict draft';
    form.requestSubmit(form.querySelector('button[value=complete_callback]'));
    await waitFor(()=>f.get('workspace-status').textContent.includes('changed elsewhere'));
    assert.equal(form.elements.note.value,'Conflict draft');assert.equal(f.get('workspace-retry').hidden,true);
    f.window.dispatchEvent(new f.window.Event('focus'));await waitFor(()=>f.get('workspace-status').textContent.includes('draft is still here'));
    assert.equal(form.elements.note.value,'Conflict draft');
    f.get('workspace-discard').click();await waitFor(()=>form.elements.note.value==='Call after lunch');
    assert.equal(f.window.sessionStorage.getItem(retryKey),null);
  } finally {f.close();}
});
test('retained uncertain callback operation can reopen and complete/cancel actions carry no dueAt',async()=>{
  const pending={revision:3,operationId:'11111111-1111-4111-8111-111111111111',action:'cancel_callback',note:'Homeowner cancelled'};
  const f=fixture({session:'admin',retry:pending});
  try {
    await waitFor(()=>!f.get('workspace-retry').hidden);
    assert.equal(f.get('workspace-callback').elements.note.value,pending.note);
    f.get('workspace-retry').click();await waitFor(()=>f.get('workspace-status').textContent.startsWith('Callback saved'));
    assert.match(f.get('workspace-saved').textContent,/cancelled/);
    const body=JSON.parse(f.requests.find(call=>call.options.method==='POST').options.body);
    assert.deepEqual(body,{token,...pending});assert.equal(body.dueAt,undefined);
  } finally {f.close();}
});
test('actual shared calendar and reservation editor mount only after authorized workspace and initialize date pickers',async()=>{
  const f=fixture({realCalendar:true});
  try {
    await waitFor(()=>f.get('residential-call').hasAttribute('href'));
    assert.equal(f.requests.some(call=>call.url.startsWith('/api/commercial-calendar')),false);
    await f.signIn();
    await waitFor(()=>f.get('workspace-reservation').querySelector('[data-calendar-form]'));
    assert.equal(f.get('commercialCalendar').querySelectorAll('.commercial-calendar-day').length,42);
    assert.ok(f.pickers.length>=4);
    const reservation=f.get('workspace-reservation').querySelector('[data-calendar-form]');
    reservation.elements.calendarReason.value='Keep installation draft';
    reservation.elements.calendarReason.dispatchEvent(new f.window.Event('input',{bubbles:true}));
    f.window.dispatchEvent(new f.window.Event('focus'));await waitFor(()=>f.get('workspace-status').textContent.includes('Unsaved drafts'));
    assert.equal(reservation.elements.calendarReason.value,'Keep installation draft');
  } finally {f.close();}
});
test('calendar authentication error immediately removes both scheduling surfaces but retains callback draft in memory',async()=>{
  const f=fixture({session:'admin'});
  try {
    await waitFor(()=>f.mounts.length===2);
    f.get('workspace-callback').elements.note.value='Keep owner note';
    f.mounts[0].config.onAuthError();
    assert.equal(f.get('workspace-authenticated').hidden,true);
    assert.equal(f.get('commercialCalendar').childNodes.length,0);
    assert.equal(f.get('workspace-reservation').childNodes.length,0);
    assert.equal(f.get('workspace-callback').elements.note.value,'Keep owner note');
    assert.equal(f.window.localStorage.getItem(sessionKey),null);
  } finally {f.close();}
});

test('existing dashboard email and PIN sign-in returns directly to the customer and reuses its session on another link',async()=>{
  const first=fixture();
  let second;
  try{
    const form=first.get('workspace-login');
    form.elements.username.value='staff@example.invalid';form.elements.pin.value='1234';form.requestSubmit();
    await waitFor(()=>first.mounts.length===2);
    const login=first.requests.find(call=>call.url==='/api/v1?action=dashboardLogin');
    assert.deepEqual(JSON.parse(login.options.body),{username:'staff@example.invalid',pin:'1234',device:'residential-review'});
    assert.equal(first.window.location.search,`?token=${token}`);
    second=fixture({session:first.window.localStorage.getItem(sessionKey),expectedSession:'admin-session',
      reviewToken:'second-customer-token-0002',leadId:'second-lead',reference:'HOME-SECOND',name:'Second Customer'});
    await waitFor(()=>second.mounts.length===2);
    assert.equal(second.requests.some(call=>call.url.startsWith('/api/v1')),false);
    assert.match(second.requests.find(call=>call.url.startsWith('/api/residential-workspace')).url,/token=second-customer-token-0002$/);
    assert.equal(second.mounts[1].leadId,'second-lead');
    assert.match(second.get('residential-review-details').textContent,/HOME-SECOND/);
    assert.equal(second.get('residential-customer-name').textContent,'Second Customer');
  }finally{first.close();second?.close();}
});

test('calendar 403 hides scheduling without clearing a valid staff session or requesting a needless sign-in',async()=>{
  const f=fixture({session:'staff-session'});
  try{
    await waitFor(()=>f.mounts.length===2);
    f.mounts[0].config.onAuthError(403);
    assert.equal(f.get('workspace-authenticated').hidden,true);
    assert.equal(f.get('workspace-login').hidden,true);
    assert.equal(f.window.localStorage.getItem(sessionKey),'staff-session');
    assert.match(f.get('workspace-status').textContent,/ADMIN role/);
    assert.equal(f.get('workspace-reservation').childElementCount,0);
    assert.equal(f.get('commercialCalendar').childElementCount,0);
    assert.equal(f.mounts[1].config.getToken(),'');
  }finally{f.close();}
});

test('plain text updates keep send problems visible without exposing internal notice codes as labels',async()=>{
  const f=fixture({session:'admin',notices:[
    {kind:'owner_callback',state:'pending',due_at:'2099-01-01T14:15:00Z'},
    {kind:'customer_confirmation',state:'review_required'},
    {kind:'customer_installation',state:'accepted'},
  ]});
  try{
    await waitFor(()=>f.mounts.length===2);
    const updates=f.get('workspace-notices').textContent;
    assert.match(updates,/Staff call reminder: Scheduled/);
    assert.match(updates,/Customer confirmation: Needs staff review/);
    assert.match(updates,/delivery not confirmed/);
    assert.doesNotMatch(updates,/owner_callback|review_required|customer_installation/);
    assert.equal(f.get('workspace-task-dialog').open,false);
    assert.equal(f.get('workspace-message-details').hidden,true);
    assert.match(f.get('workspace-notice-warning').textContent,/staff review/);
  }finally{f.close();}
});

test('unbooked, cancelled and expired holds are not presented as confirmed installation windows',async()=>{
  for(const [booking,expected] of [
    [null,/Installation not scheduled/],
    [{state:'cancelled',starts_at:'2099-01-01T15:00:00Z',ends_at:'2099-01-01T17:00:00Z',timezone:'America/New_York'},/^Cancelled:/],
    [{state:'tentative',expires_at:'2000-01-01T00:00:00Z',starts_at:'2099-01-01T15:00:00Z',ends_at:'2099-01-01T17:00:00Z',timezone:'America/New_York'},/^Hold expired - not booked:/],
  ]){
    const f=fixture({session:'admin',booking});
    try{
      await waitFor(()=>f.mounts.length===2);
      assert.match(f.get('residential-installation-time').textContent,expected);
      assert.doesNotMatch(f.get('residential-installation-time').textContent,/^Confirmed:/);
    }finally{f.close();}
  }
});
