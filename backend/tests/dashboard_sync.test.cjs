const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'..','..','frontend','dashboard-sync.js'),'utf8');
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(t){
    const dom=new JSDOM('<main><p role="status"></p><input value="saved"></main>',{runScripts:'outside-only',url:'https://fixture.invalid'});
    t.after(()=>dom.window.close());
    const w=dom.window,timers=new Map();let now=100000,next=0,visibility='visible';
    w.Date.now=()=>now;w.setInterval=(fn,ms)=>{const id=++next;timers.set(id,{fn,ms});return id;};w.clearInterval=id=>timers.delete(id);
    Object.defineProperty(w.document,'visibilityState',{get:()=>visibility});
    w.console.error=()=>{};w.eval(source);
    return {w,timers,advance:ms=>{now+=ms;},visibility:value=>{visibility=value;}};
}
test('focus, visibility and polling coalesce; hidden/inactive work does not poll; minimum interval applies',async t=>{
    const f=fixture(t);let active=true,calls=0,resolve;
    const sync=f.w.H2SDataSync.register({id:'test',isActive:()=>active,refresh:()=>{calls++;return new Promise(done=>resolve=done);}});
    const first=sync.request('return');f.w.dispatchEvent(new f.w.Event('focus'));sync.request('poll');await settle();
    assert.equal(calls,1);resolve(true);await first;
    await sync.request('focus');assert.equal(calls,1);
    f.advance(16000);f.w.dispatchEvent(new f.w.Event('focus'));await settle();assert.equal(calls,2);resolve(true);await settle();
    assert.equal([...f.timers.values()][0].ms,60000);
    f.visibility('hidden');f.advance(60000);await [...f.timers.values()][0].fn();assert.equal(calls,2);
    f.visibility('visible');active=false;await sync.request('return',{force:true});assert.equal(calls,2);
    sync.destroy();assert.equal(f.timers.size,0);
});
test('an authorized initial mount reads once in a background editor; hidden polling and inactive mounts remain blocked',async t=>{
    const f=fixture(t);f.visibility('hidden');let calls=0,active=true;
    const sync=f.w.H2SDataSync.register({id:'initial',isActive:()=>active,refresh:async()=>{calls++;return true;}});
    assert.equal(await sync.request('mount',{force:true}),true);assert.equal(calls,1);
    await sync.request('focus',{force:true});await sync.request('poll',{force:true});assert.equal(calls,1);
    active=false;await sync.request('mount',{force:true});assert.equal(calls,1);
});
test('dirty input stays intact; errors never become current and have Retry',async t=>{
    const f=fixture(t),input=f.w.document.querySelector('input'),states=[];let dirty=true,fail=true;
    input.value='unsaved';
    let sync;sync=f.w.H2SDataSync.register({id:'test',isActive:()=>true,isDirty:()=>dirty,
        refresh:async()=>{if(fail)throw Error('backend unavailable');return true;},
        onState:s=>{states.push(s.status);f.w.H2SDataSync.feedback(f.w.document,'[role]',s,()=>sync.request('retry',{force:true}));}});
    await sync.request('poll');assert.deepEqual(states,['stale']);assert.equal(input.value,'unsaved');
    dirty=false;await sync.request('focus',{force:true});assert.equal(states.at(-1),'error');
    assert.equal(f.w.document.querySelector('button').textContent,'Retry');
    fail=false;f.w.document.querySelector('button').click();await settle();assert.equal(states.at(-1),'current');assert.equal(input.value,'unsaved');
});
test('mutation invalidation queues one later read and replacement discards old notifications',async t=>{
    const f=fixture(t),states=[];let calls=0,finish;
    const sync=f.w.H2SDataSync.register({id:'test',isActive:()=>true,refresh:()=>{calls++;return new Promise(resolve=>finish=resolve);},onState:s=>states.push(s.status)});
    const read=sync.request('return');await settle();sync.invalidate();sync.request('mutation',{force:true});assert.equal(calls,1);
    finish(true);await read;await settle();assert.equal(calls,2);assert.equal(states.includes('current'),false);
    const other=f.w.H2SDataSync.register({id:'test',isActive:()=>false,refresh:async()=>true});
    finish(true);await settle();assert.equal(states.includes('current'),false);assert.equal(f.timers.size,1);other.destroy();
});
test('read signals are bounded and cancel when their parent is reset',t=>{
    const f=fixture(t),timeouts=new Map();let next=0;
    f.w.setTimeout=(fn,ms)=>{const id=++next;timeouts.set(id,{fn,ms});return id;};f.w.clearTimeout=id=>timeouts.delete(id);
    const parent=new f.w.AbortController(),signal=f.w.H2SDataSync.signal(parent.signal);
    assert.equal([...timeouts.values()][0].ms,15000);parent.abort();assert.equal(signal.aborted,true);assert.equal(timeouts.size,0);
    const other=f.w.H2SDataSync.signal(new f.w.AbortController().signal);[...timeouts.values()][0].fn();assert.equal(other.aborted,true);
    const ended=new f.w.AbortController();ended.abort();
    assert.equal(f.w.H2SDataSync.signal(ended.signal).aborted,true);assert.equal(timeouts.size,0);
});
test('open shared dropdowns pause reads even when their search portal is outside the module',t=>{
    const f=fixture(t),root=f.w.document.querySelector('main');
    root.insertAdjacentHTML('beforeend','<button aria-haspopup="listbox" aria-expanded="true">Choose</button>');
    const search=f.w.document.createElement('input');f.w.document.body.append(search);search.focus();
    assert.equal(f.w.H2SDataSync.interacting(root),true);
    root.querySelector('button').setAttribute('aria-expanded','false');
    assert.equal(f.w.H2SDataSync.interacting(root),false);
    root.querySelector('input').focus();assert.equal(f.w.H2SDataSync.interacting(root),true);
});
test('read-only contextual tabs and scroll are restored without smooth-scroll drift',t=>{
    const f=fixture(t),root=f.w.document.querySelector('main');
    root.innerHTML='<div role="tablist"><button role="tab">Overview</button><button role="tab" aria-selected="true">Payments</button></div>';
    f.w.scrollY=120;let restored;
    f.w.scrollTo=options=>{restored=options;};
    f.w.H2SDataSync.preserveView(root,()=>{
        f.w.scrollY=0;root.innerHTML='<div role="tablist"><button role="tab">Overview</button><button role="tab">Payments</button></div>';
        root.querySelectorAll('button').forEach(button=>button.onclick=()=>button.setAttribute('aria-selected','true'));
    });
    assert.equal(root.querySelector('[aria-selected="true"]').textContent,'Payments');
    assert.equal(restored.top,120);assert.equal(restored.behavior,'instant');
});
