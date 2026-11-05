const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'..','frontend','company-installation.js'),'utf8');
const settle=async()=>{for(let n=0;n<10;n++)await new Promise(resolve=>setImmediate(resolve));};
function fixture(t,respond){
    const dom=new JSDOM('<div id="company"></div>',{runScripts:'outside-only',url:'https://fixture.invalid'});
    t.after(()=>dom.window.close());
    const w=dom.window,root=w.document.getElementById('company'),calls=[],effects={refresh:0,changed:0};
    let session={role:'ADMIN',token:'synthetic-management-session'};
    w.crypto.randomUUID=crypto.randomUUID;w.console.error=()=>{};
    w.fetch=async(url,init)=>{const body=init.body&&JSON.parse(init.body);calls.push({url,init,body});return respond(body,url);};
    w.H2SFieldInstallation={mount(){return {ready:Promise.resolve(),refresh:async()=>effects.refresh++,destroy(){}};}};
    w.eval(source);
    const instance=w.H2SCompanyInstallation.mount(root,{apiBase:'https://fixture.invalid/api',getSession:()=>session,
        jobId:'company-job',revision:7,canClaim:true,onChanged:()=>effects.changed++});
    return {w,root,calls,effects,instance,session(value){session=value;},submit(form){form.dispatchEvent(new w.SubmitEvent('submit',{bubbles:true,cancelable:true}));}};
}
test('company identity authorization uses only the explicitly selected matching candidate',async t=>{
    let authorized=false;
    const f=fixture(t,body=>{
        if(body){authorized=true;return Response.json({ok:true,authorized:true});}
        return Response.json({ok:true,authorized,candidates:[{proId:'verified-owner',email:'owner@example.invalid'}],enrolled:false});
    });
    await f.instance.ready;
    const form=f.root.querySelector('[data-company-identity]');form.elements.reference.value='Verified existing company owner profile';
    f.submit(form);await settle();
    const sent=f.calls.find(c=>c.body).body;
    assert.equal(sent.action,'authorize_self');assert.equal(sent.proId,'verified-owner');assert.ok(sent.operationId);
    assert.equal(f.effects.changed,1);assert.ok(f.root.querySelector('[data-company-claim]'));
    assert.ok(f.calls.every(c=>c.init.headers.Authorization==='Bearer synthetic-management-session'));
});
test('personal acceptance retries identical evidence and then mounts retained native proof controls',async t=>{
    let attempts=0,enrolled=false;
    const f=fixture(t,body=>{
        if(body){if(++attempts===1)return Response.json({ok:false,error:'Temporary storage failure'},{status:503});enrolled=true;return Response.json({ok:true,claimed:true});}
        return Response.json({ok:true,authorized:true,enrolled,workflow:{completedAt:null}});
    });
    await f.instance.ready;
    const form=f.root.querySelector('[data-company-claim]');form.elements.reference.value='I personally perform this installation';
    f.submit(form);await settle();
    assert.match(f.root.querySelector('[role="alert"]').textContent,/Temporary storage failure/);
    form.elements.reference.value='Changed text must not replace the interrupted operation';
    f.submit(form);await settle();
    const writes=f.calls.filter(c=>c.body);assert.deepEqual(writes[1].body,writes[0].body);
    assert.equal(writes[0].body.job_id,'company-job');assert.equal(writes[0].body.workflowRevision,7);
    assert.equal(writes[0].body.proId,undefined);assert.ok(f.root.querySelector('[data-company-upload]'));
    assert.equal(f.effects.changed,1);
});
test('company proof upload sends the actual selected image and refreshes the existing proof component',async t=>{
    const f=fixture(t,body=>Response.json(body?{ok:true,artifact:{artifact_id:'native-artifact'}}:{ok:true,authorized:true,enrolled:true,workflow:{completedAt:null}}));
    await f.instance.ready;
    const form=f.root.querySelector('[data-company-upload]');
    const bytes=Buffer.from('89504e470d0a1a0a','hex');
    Object.defineProperty(form.elements.photo,'files',{value:[new f.w.File([bytes],'onsite.png',{type:'image/png'})]});
    f.submit(form);
    await new Promise(resolve=>setTimeout(resolve,30));await settle();
    const sent=f.calls.find(c=>c.body).body;
    assert.equal(sent.action,'upload');assert.equal(sent.job_id,'company-job');assert.equal(sent.type,'photo');
    assert.equal(sent.data,bytes.toString('base64'));assert.equal(sent.proId,undefined);assert.equal(f.effects.refresh,1);
});
test('a late company read cannot attach another management session to installer controls',async t=>{
    let release;
    const f=fixture(t,()=>new Promise(resolve=>{release=resolve;}));
    f.session({role:'ADMIN',token:'different-session'});
    release(Response.json({ok:true,authorized:true,enrolled:true,workflow:{completedAt:null}}));await f.instance.ready;
    assert.equal(f.root.querySelector('form'),null);assert.equal(f.effects.changed,0);
    f.instance.destroy();
});
test('real company completion uses readable service labels and automatic proof reads, with Retry only after failure',async t=>{
    const dom=new JSDOM('<div id="company"></div><div id="technician"></div>',{runScripts:'outside-only',url:'https://fixture.invalid'});
    t.after(()=>dom.window.close());const w=dom.window,root=w.document.getElementById('company');
    let failed=false;w.console.error=()=>{};
    const workflow={jobId:'company-job',revision:7,completedAt:null,canComplete:false,proof:{photoCount:0,signatureCount:0,complete:false,
        missing:['private_camera_sku: internal evidence check'],candidates:[],requirements:[{serviceId:'private_camera_sku',id:'finished',label:'Finished installation photo',type:'photo',minimumCount:1,missingCount:1,complete:false}]}};
    w.fetch=async()=>Response.json(failed?{ok:false,error:'Proof storage unavailable'}:{ok:true,enabled:true,enrolled:true,workflow},{status:failed?503:200});
    w.eval(fs.readFileSync(path.join(__dirname,'..','frontend','field-installation.js'),'utf8'));
    const options={apiBase:'https://fixture.invalid/api',getSession:()=>({role:'ADMIN',token:'synthetic-management-session'}),
        company:true,enrolled:true,jobId:'company-job',serviceNames:{private_camera_sku:'Security camera installation'}};
    const instance=w.H2SFieldInstallation.mount(root,options);await instance.ready;
    assert.equal(root.querySelector('[data-installation-refresh]'),null);assert.match(root.textContent,/Security camera installation/);
    assert.doesNotMatch(root.textContent,/private_camera_sku|internal evidence check|then refresh/);
    root.querySelector('[name="performedAt"]').value='2026-11-05T12:00';
    failed=true;await instance.refresh();
    assert.match(root.querySelector('[data-installation-refresh]').textContent,/Retry/);
    assert.match(root.querySelector('[data-installation-status]').textContent,/Proof storage unavailable/);
    failed=false;root.querySelector('[data-installation-refresh]').click();await settle();
    assert.equal(root.querySelector('[data-installation-refresh]'),null);
    assert.equal(root.querySelector('[name="performedAt"]').value,'2026-11-05T12:00');
    const technician=w.document.getElementById('technician');
    const legacy=w.H2SFieldInstallation.mount(technician,{...options,company:false});await legacy.ready;
    assert.equal(technician.querySelector('[data-installation-refresh]').textContent,'Refresh saved installation proof');
    instance.destroy();legacy.destroy();
});
