const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const frontend=path.join(__dirname,'..','..','frontend'),tick=()=>new Promise(resolve=>setTimeout(resolve,20));
async function fixture(t,{token,role='SALES',fetch:customFetch,url='https://portal.example/sales.html?view=quotes'}={}){
    const dom=new JSDOM(fs.readFileSync(path.join(frontend,'sales.html'),'utf8'),{url,runScripts:'outside-only'});
    t.after(()=>dom.window.close());
    const w=dom.window,calls=[],mounted=[];
    if(token)w.localStorage.setItem('h2s_dashboard_session_token_v1',token);
    w.H2SFieldSales={reset(){},configure(options){mounted.push(options);},activate(){throw Error('Redundant initial activation');},navigate(view){mounted.push(view);}};
    w.H2SDashboardControls={bootstrapDashboardCustomSelects(){}};
    w.fetch=async(url,options)=>{
        calls.push({url,options});
        if(customFetch)return customFetch(url,options);
        const action=new URL(url).searchParams.get('action');
        return {ok:true,status:200,json:async()=>action==='dashboardLogin'
            ?{ok:true,dashboardLogin:{token:'synthetic-login-token'}}
            :{ok:true,me:{userId:'synthetic-rep',username:'Synthetic Rep',role}}};
    };
    w.eval(fs.readFileSync(path.join(frontend,'sales-app.js'),'utf8'));await tick();
    return {w,calls,mounted,doc:w.document};
}
test('dedicated entry has no management navigation and requires the existing account',async t=>{
    const f=await fixture(t);
    assert.equal(f.doc.getElementById('sales-login').hidden,false);
    assert.equal(f.doc.getElementById('h2s-app').hidden,true);
    assert.equal(f.calls.length,0);
    assert.equal(f.doc.querySelector('.app-sidebar'),null);
    assert.doesNotMatch(f.doc.body.textContent,/Hiring|Technician screening|Administrator tools/);
});
test('cached salesperson token is verified by native dashboardMe before mounting',async t=>{
    const f=await fixture(t,{token:'synthetic-existing'});
    assert.match(f.calls[0].url,/\/api\/v1\?action=dashboardMe$/);
    assert.equal(f.calls[0].options.headers.Authorization,'Bearer synthetic-existing');
    assert.equal(f.doc.getElementById('h2s-app').hidden,false);
    assert.equal(f.mounted[0].getSession().role,'SALES');
    assert.equal(f.mounted[1],'quotes');
});
test('management account does not acquire a representative workspace or lose shared session',async t=>{
    const f=await fixture(t,{token:'synthetic-admin',role:'ADMIN'});
    assert.equal(f.mounted.length,0);
    assert.equal(f.doc.getElementById('sales-management').hidden,false);
    assert.equal(f.doc.getElementById('h2s-app').hidden,true);
    assert.equal(f.w.localStorage.getItem('h2s_dashboard_session_token_v1'),'synthetic-admin');
});
test('default entry mounts Home once; unknown links surface an error without mounting a blank workspace',async t=>{
    const home=await fixture(t,{token:'synthetic-existing',url:'https://portal.example/sales.html'});
    assert.equal(home.mounted[1],'home');
    const invalid=await fixture(t,{token:'synthetic-existing',url:'https://portal.example/sales.html?view=unavailable'});
    assert.equal(invalid.doc.getElementById('h2s-app').hidden,true);
    assert.match(invalid.doc.getElementById('sales-access-status').textContent,/link is not recognized/);
    assert.equal(invalid.w.localStorage.getItem('h2s_dashboard_session_token_v1'),'synthetic-existing');
});
test('login uses existing username/PIN endpoint and verifies returned token independently',async t=>{
    const f=await fixture(t),form=f.doc.getElementById('sales-login');
    form.elements.username.value='Synthetic Rep';form.elements.pin.value='test-pin';
    form.dispatchEvent(new f.w.Event('submit',{bubbles:true,cancelable:true}));await tick();
    assert.match(f.calls[0].url,/action=dashboardLogin$/);
    assert.equal(JSON.parse(f.calls[0].options.body).username,'Synthetic Rep');
    assert.match(f.calls[1].url,/action=dashboardMe$/);
    assert.equal(f.calls[1].options.headers.Authorization,'Bearer synthetic-login-token');
    assert.equal(f.mounted[0].getSession().token,'synthetic-login-token');
});
test('invalid cached session is removed and server error is visible',async t=>{
    const f=await fixture(t,{token:'synthetic-expired',fetch:async()=>({ok:false,status:401,json:async()=>({ok:false,error:'Session expired'})})});
    assert.equal(f.w.localStorage.getItem('h2s_dashboard_session_token_v1'),null);
    assert.equal(f.doc.getElementById('sales-access-status').textContent,'Session expired');
    assert.equal(f.doc.getElementById('sales-access-status').getAttribute('role'),'alert');
    assert.equal(f.mounted.length,0);
});
test('a late account response cannot restore a session after another tab signs out',async t=>{
    let resolve;
    const f=await fixture(t,{token:'synthetic-old',fetch:()=>new Promise(done=>{resolve=done;})});
    f.w.localStorage.removeItem('h2s_dashboard_session_token_v1');
    f.w.dispatchEvent(new f.w.StorageEvent('storage',{key:'h2s_dashboard_session_token_v1'}));await tick();
    resolve({ok:true,status:200,json:async()=>({ok:true,me:{userId:'old',username:'Old',role:'SALES'}})});await tick();
    assert.equal(f.mounted.length,0);
    assert.equal(f.doc.getElementById('h2s-app').hidden,true);
});
test('both applications load one original shared date and styled-select implementation',()=>{
    const sales=fs.readFileSync(path.join(frontend,'sales.html'),'utf8'),dash=fs.readFileSync(path.join(frontend,'dash.html'),'utf8');
    assert.match(sales,/dashboard-controls\.js/);assert.match(dash,/loadScript\('dashboard-controls\.js'\)/);
    assert.doesNotMatch(fs.readFileSync(path.join(frontend,'dash.js'),'utf8'),/function dashboardSyncCustomSelect\(/);
});
test('shared dropdown keeps native form value, required validation and keyboard interaction',t=>{
    const dom=new JSDOM('<label>Service<select required><option value="">Choose service</option><option value="tv">TV mounting</option><option value="camera" disabled>Cameras</option></select></label>',{runScripts:'outside-only'});
    t.after(()=>dom.window.close());
    const w=dom.window;w.eval(fs.readFileSync(path.join(frontend,'dashboard-controls.js'),'utf8'));
    w.H2SDashboardControls.bootstrapDashboardCustomSelects();
    const select=w.document.querySelector('select'),trigger=w.document.querySelector('.dashboard-custom-select-trigger');
    assert.equal(trigger.getAttribute('aria-label'),'Service');
    assert.equal(select.checkValidity(),false);
    trigger.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
    assert.equal(trigger.getAttribute('aria-expanded'),'true');
    const option=w.document.querySelector('[data-value=tv]');option.click();
    assert.equal(select.value,'tv');assert.equal(select.checkValidity(),true);
    assert.equal(trigger.getAttribute('aria-expanded'),'false');
    assert.equal(w.document.querySelector('[data-value=camera]').disabled,true);
});
