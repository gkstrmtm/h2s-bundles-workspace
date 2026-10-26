const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const frontend=path.resolve(__dirname,'..','..','frontend');
const html=fs.readFileSync(path.join(frontend,'dash.html'),'utf8');
const source=fs.readFileSync(path.join(frontend,'dash.js'),'utf8');
const start=html.indexOf('<section id="notificationRouting"');
const markup=html.slice(start,html.indexOf('</section>',start)+10);
const declaration=source.slice(source.indexOf('const notificationRoutingUI = {'),source.indexOf('window.notificationRoutingUI = notificationRoutingUI;'));
function fixture(){
  const dom=new JSDOM(markup,{runScripts:'outside-only',url:'http://fixture.invalid/dash'});
  const w=dom.window,state={role:'ADMIN',token:'fixture-admin',posts:[],failure:null,pending:null,confirm:true};
  const routing={owner:{phone:'+15550000007',revision:0,source:'environment',updatedAt:null,updatedBy:null},
    commercialTechnicians:['+15550000001'],managementEscalation:['+15550000002']};
  w.isAdminRole=()=>state.role==='ADMIN';w.getDashboardSessionToken=()=>state.token;
  w.API_BASE='http://fixture.invalid';w.confirm=()=>state.confirm;
  w.fetch=async(url,options)=>{
    assert.equal(url,'http://fixture.invalid/api/notification-routing');
    assert.equal(options.headers.Authorization,'Bearer '+state.token);
    assert.equal(options.cache,'no-store');
    if(options.method==='POST'){
      const body=JSON.parse(options.body);state.posts.push(body);
      if(state.pending)await state.pending;
      if(state.failure)throw new Error(state.failure);
      if(body.revision!==routing.owner.revision)return Response.json({ok:false,error:'Record changed. Review latest; your draft is retained.'},{status:409});
      routing.owner={phone:body.phone,revision:body.revision+1,source:'saved',updatedAt:'2026-10-26T18:00:00Z',
        updatedBy:{id:'fixture-admin',name:'Fixture Admin',role:'ADMIN'}};
      return Response.json({ok:true,owner:routing.owner,verified:false});
    }
    if(state.failure)throw new Error(state.failure);
    return Response.json({ok:true,routing});
  };
  w.eval(declaration+'\nwindow.ui=notificationRoutingUI;');
  const el=suffix=>w.document.getElementById('notificationRouting'+suffix);
  return {dom,w,state,routing,ui:w.ui,el,save:()=>w.ui.save({preventDefault(){}})};
}
test('routing appears only for ADMIN and shows explicit scope, fallback, unchanged routes and unverified status',async t=>{
  const f=fixture();t.after(()=>f.dom.window.close());
  f.state.role='VA';await f.ui.load();assert.equal(f.el('').hidden,true);
  f.state.role='ADMIN';f.state.token='';await f.ui.load();assert.equal(f.el('').hidden,true);
  f.state.token='fixture-admin';await f.ui.load();
  assert.equal(f.el('').hidden,false);assert.equal(f.el('Owner').textContent,'+15550000007');
  assert.match(f.el('Source').textContent,/environment default/);assert.match(f.el('Source').textContent,/not verified/i);
  assert.equal(f.el('Technicians').textContent,'+15550000001');assert.equal(f.el('Escalation').textContent,'+15550000002');
  assert.equal(f.el('Form').hidden,true);assert.match(f.el('').textContent,/media-upload reminders/);
  assert.equal(f.el('Title').textContent,'Owner notifications');
  assert.equal(f.el('').querySelector('details').open,false,'Secondary routes do not dominate the overview');
});
test('cancel has no POST and refreshes the current saved value; editing/reopening preserve task state',async t=>{
  const f=fixture();t.after(()=>f.dom.window.close());await f.ui.load();
  f.ui.edit();f.el('Phone').value='+15550000008';await f.ui.load();
  assert.equal(f.el('Phone').value,'+15550000008','Navigating back does not replace an active draft');
  f.routing.owner.phone='+15550000009';await f.ui.cancel();
  assert.equal(f.state.posts.length,0);assert.equal(f.el('Form').hidden,true);
  assert.equal(f.el('Owner').textContent,'+15550000009');f.ui.edit();assert.equal(f.el('Phone').value,'+15550000009');
});
test('save requires acknowledgment, persists on reload and never reports verification or a test send',async t=>{
  const f=fixture();t.after(()=>f.dom.window.close());await f.ui.load();f.ui.edit();f.el('Phone').value='+15550000008';
  await f.save();assert.equal(f.state.posts.length,0);assert.match(f.el('Status').textContent,/Acknowledge/);
  f.el('Acknowledge').checked=true;await f.save();
  assert.equal(f.state.posts.length,1);assert.equal(f.state.posts[0].revision,0);
  assert.equal(f.el('Owner').textContent,'+15550000008');assert.equal(f.el('Form').hidden,true);
  assert.equal(f.el('Edit').disabled,false);assert.match(f.el('Status').textContent,/Saved\. No text sent/);
  assert.match(f.el('Status').textContent,/not verified/);
  await f.ui.load();assert.equal(f.el('Owner').textContent,'+15550000008');
  f.ui.edit();assert.equal(f.el('Phone').value,'+15550000008');assert.equal(f.el('Acknowledge').checked,false);
});
test('conflicting changes retain the draft and require explicit discard/reload rather than silently overwriting',async t=>{
  const f=fixture();t.after(()=>f.dom.window.close());await f.ui.load();f.ui.edit();
  f.el('Phone').value='+15550000008';f.el('Acknowledge').checked=true;
  f.routing.owner={...f.routing.owner,phone:'+15550000009',revision:1};
  await f.save();assert.equal(f.el('').dataset.state,'error');assert.equal(f.el('Phone').value,'+15550000008');
  assert.equal(f.el('Form').hidden,false);assert.equal(f.el('Reload').hidden,false);
  f.state.confirm=false;await f.ui.reload();assert.equal(f.el('Phone').value,'+15550000008');
  f.state.confirm=true;await f.ui.reload();assert.equal(f.el('Owner').textContent,'+15550000009');
  f.ui.edit();f.el('Phone').value='+15550000010';f.el('Acknowledge').checked=true;
  await f.save();assert.equal(f.state.posts.at(-1).revision,1);assert.equal(f.el('Owner').textContent,'+15550000010');
});
test('uncertain save and read failures remain explicit; no duplicate save while in flight',async t=>{
  const f=fixture();t.after(()=>f.dom.window.close());await f.ui.load();f.ui.edit();
  f.el('Phone').value='+15550000008';f.el('Acknowledge').checked=true;
  let finish;f.state.pending=new Promise(resolve=>{finish=resolve;});
  const saving=f.save();await Promise.resolve();
  assert.equal(f.el('Save').disabled,true);assert.equal(f.el('Cancel').disabled,true);
  await f.save();assert.equal(f.state.posts.length,1);
  f.state.failure='Fixture network interruption';finish();await saving;
  assert.match(f.el('Status').textContent,/uncertain/);assert.equal(f.el('Phone').value,'+15550000008');
  assert.equal(f.el('Save').disabled,false);
  await f.ui.reload();assert.equal(f.el('Owner').textContent,'Unavailable');
  assert.equal(f.el('Edit').disabled,true);assert.equal(f.el('').dataset.state,'error');
});
test('saved actor names render as text, not markup, and the panel stays scoped to the canonical workspace',async t=>{
  const f=fixture();t.after(()=>f.dom.window.close());
  f.routing.owner={...f.routing.owner,source:'saved',revision:1,updatedAt:'2026-10-26T18:00:00Z',updatedBy:{name:'<img src=x onerror=alert(1)>'}};
  await f.ui.load();assert.equal(f.el('').querySelector('img'),null);assert.match(f.el('Source').textContent,/<img/);
  assert.ok(html.indexOf('id="workspace-pane"')<start);
  assert.match(source,/notificationRoutingUI\.load\(\)/);
  const css=fs.readFileSync(path.join(frontend,'dash.css'),'utf8');
  assert.match(css,/\.notification-routing \.btn \{ min-height: 44px;/);
  assert.match(css,/\.notification-routing__rows \{ grid-template-columns: 1fr;/);
});
