const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ts=require('typescript'),{JSDOM}=require('jsdom');
const frontend=path.join(__dirname,'..','..','frontend');
const source=fs.readFileSync(path.join(frontend,'dash.js'),'utf8');
const ast=ts.createSourceFile('dash.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),objects={};
function visit(node){
    if(ts.isVariableDeclaration(node)&&['bugReportsUI','adResources'].includes(node.name.getText(ast)))objects[node.name.getText(ast)]=node.initializer.getText(ast);
    ts.forEachChild(node,visit);
}
visit(ast);
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(t,name){
    const dom=new JSDOM('<div id="modalOverlay" class="active"><p id="adResMeta"></p><div id="adResList"></div></div>',{runScripts:'outside-only',url:'https://fixture.invalid'});
    t.after(()=>dom.window.close());const w=dom.window,calls=[];
    w.API_URL='https://fixture.invalid/api/v1';w.getDashboardSessionToken=()=> 'synthetic';w.isAdminRole=()=>true;
    w.showToast=()=>{};w.console.log=()=>{};w.console.error=()=>{};
    w.eval(fs.readFileSync(path.join(frontend,'dashboard-sync.js'),'utf8'));
    w.fetch=async(url,init)=>{calls.push({url,init});return Response.json({ok:true,creatives:[],bug_reports:{reports:[]}});};
    w.eval('window.consumer=('+objects[name]+');');
    return {w,calls,consumer:w.consumer,overlay:w.document.getElementById('modalOverlay')};
}
test('native bug-report automatic reads reuse fresh empty cache and cannot reopen a closed modal',async t=>{
    const f=fixture(t,'bugReportsUI');let shown=0,config;
    f.consumer.getAdminToken=()=>null;
    f.w.showModal=(title,html)=>{shown++;f.overlay.classList.add('active');f.overlay.innerHTML=html;};
    const register=f.w.H2SDataSync.register;
    f.w.H2SDataSync.register=options=>{config=options;return register(options);};
    await f.consumer.openAdminModal();assert.equal(f.calls.length,1);assert.equal(shown,1);
    f.consumer.cache.reports=null;
    await config.refresh();assert.equal(f.calls.length,2);assert.equal(shown,2,'empty results rerender without a second fetch');
    let release;f.w.fetch=()=>new Promise(resolve=>release=resolve);
    const read=config.refresh();await settle();f.overlay.classList.remove('active');
    release(Response.json({ok:true,bug_reports:{reports:[{id:'synthetic'}]}}));
    assert.equal(await read,false);assert.equal(shown,2);
});
test('native Ad Resources rejects malformed reads rather than replacing loaded records with empty success',async t=>{
    const f=fixture(t,'adResources');f.consumer.state={list:[{id:'retained'}]};
    f.consumer._renderList=()=>assert.fail('malformed reads must not replace the list');
    f.w.fetch=async()=>Response.json({ok:true});
    await assert.rejects(f.consumer.refresh(false,true),/response incomplete/);
    assert.equal(f.consumer.state.list[0].id,'retained');
});
test('native Ad Resources aborts superseded reads and discards results after the modal closes',async t=>{
    const f=fixture(t,'adResources');f.consumer.state={list:[{id:'retained'}]};let rendered=0;
    f.consumer._renderList=()=>rendered++;
    const pending=[];f.w.fetch=(url,init)=>new Promise(resolve=>pending.push({resolve,signal:init.signal}));
    const first=f.consumer.refresh(false,true),second=f.consumer.refresh(false,true);
    assert.equal(pending[0].signal.aborted,true);
    pending[0].resolve(Response.json({ok:true,creatives:[{id:'old'}]}));assert.equal(await first,false);
    f.overlay.classList.remove('active');pending[1].resolve(Response.json({ok:true,creatives:[{id:'closed'}]}));
    assert.equal(await second,false);assert.equal(rendered,0);assert.equal(f.consumer.state.list[0].id,'retained');
});
