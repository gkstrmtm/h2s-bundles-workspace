const test=require('node:test'),assert=require('node:assert/strict');
const {createWalkthrough}=require('./walkthrough-fixture.cjs');
const {seedSalesPreview}=require('./sales-preview-seed.cjs');
const fs=require('node:fs'),path=require('node:path'),{JSDOM}=require('jsdom');
test('readiness gallery exposes bounded lead pages, independent repeat history and a real company installation awaiting acceptance',async t=>{
    const engine=await createWalkthrough({origin:'https://127.0.0.1:9443'});t.after(()=>engine.close());
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYs8AAAAASUVORK5CYII=','base64');
    const gallery=await seedSalesPreview(engine,png,{readiness:true});
    const page=await(await engine.request('field-sales','GET',null,'sales')).json();
    assert.equal(page.total,34);assert.equal(page.opportunities.length,25);assert.ok(page.nextCursor);
    const history=await(await engine.request('field-sales','GET',null,'admin','?customerId='+gallery.completedLeadId)).json();
    assert.equal(history.total,2);
    const workflow=await(await engine.request('field-sales-workflow','GET',null,'admin','?lead_id='+gallery.ownerInstallationLeadId)).json();
    const w=workflow.workflows[0];assert.ok(w.jobId);assert.equal(w.completedAt,null);
    const company=await(await engine.request('field-sales-company-installation','GET',null,'admin','?job_id='+w.jobId)).json();
    assert.equal(company.authorized,true);assert.equal(company.enrolled,false);
});
test('eight-screen review seeds only isolated records through actual contracts and stops before bank settlement',async t=>{
    const engine=await createWalkthrough({origin:'https://127.0.0.1:9443'});t.after(()=>engine.close());
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYs8AAAAASUVORK5CYII=','base64');
    const gallery=await seedSalesPreview(engine,png);
    assert.equal(new Set([gallery.completedLeadId,gallery.assessmentLeadId,gallery.quoteLeadId]).size,3);
    const status=await engine.status();
    assert.equal(status.earnings.entries.length,1);
    assert.equal(status.flags.settled,false);
    assert.equal(status.earnings.externalPaymentInitiated,false);
    assert.ok(gallery.jobId);assert.ok(gallery.runId);assert.ok(gallery.draftQuoteId);
    const response=await engine.request('field-sales','GET',null,'sales');
    const records=await response.json();
    assert.equal(records.ok,true);
    assert.ok(JSON.stringify(records).includes('Avery Chen'));
    assert.ok(JSON.stringify(records).includes('Taylor Brooks'));
    assert.deepEqual(records.opportunities.map(row=>row.full_name).sort(),['Avery Chen','Morgan & Jordan Wellington','Taylor Brooks']);
    assert.ok(records.opportunities.every(row=>!row.full_name.includes('SYNTHETIC')));
});
test('management Orders review opens the actual dashboard order destination at desktop width',async t=>{
    const html=fs.readFileSync(path.join(__dirname,'sales-preview.html'),'utf8');
    const dom=new JSDOM(html,{url:'http://127.0.0.1:9444/sales-review?screen=managementOrders',runScripts:'outside-only'});
    t.after(()=>dom.window.close());
    const w=dom.window;
    w.fetch=async()=>({ok:true,json:async()=>({gallery:{assessmentLeadId:'synthetic-assessment',quoteLeadId:'synthetic-quote'}})});
    w.eval(w.document.querySelector('script').textContent);
    await new Promise(resolve=>setImmediate(resolve));
    const frame=w.document.getElementById('application'),url=new URL(frame.src),messages=[];
    assert.equal(url.pathname,'/dash.html');assert.equal(url.searchParams.get('reviewRole'),'ADMIN');
    assert.equal(url.searchParams.get('reviewTab'),'fieldsales');
    assert.equal(w.document.getElementById('width').value,'1280');
    assert.equal(w.getComputedStyle(frame).maxWidth,'100%');
    assert.match(html,/width:min\(100%,var\(--review-width,390px\)\)/);
    assert.equal(w.getComputedStyle(w.document.body).overflowX,'auto');
    assert.equal(w.document.getElementById('title').textContent,'Management Orders & Customer Details');
    frame.contentWindow.postMessage=message=>messages.push(message);
    w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,origin:w.location.origin,data:{type:'h2s-review-ready'}}));
    assert.equal(messages[0].mode,'orders');
});
test('dashboard previews reuse native tabs and never force Field Sales positioning onto another application',async t=>{
    for(const [screen,tab] of Object.entries({adminDashboard:'admin',websiteMedia:'proofpacks',customerQueue:'commercialqueue',operations:'operations'})){
        const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'sales-preview.html'),'utf8'),{url:'http://127.0.0.1:9444/sales-review?screen='+screen,runScripts:'outside-only'});
        t.after(()=>dom.window.close());
        const w=dom.window;
        w.fetch=async()=>({ok:true,json:async()=>({gallery:{}})});
        w.eval(w.document.querySelector('script').textContent);
        await new Promise(resolve=>setImmediate(resolve));
        const frame=w.document.getElementById('application'),url=new URL(frame.src),messages=[];
        assert.equal(url.pathname,'/dash.html');assert.equal(url.searchParams.get('reviewRole'),'ADMIN');
        assert.equal(url.searchParams.get('reviewTab'),tab);
        assert.deepEqual([...w.document.querySelector('#width').options].map(o=>o.value),['320','390','768','1024','1280','1440']);
        frame.contentWindow.postMessage=message=>messages.push(message);
        w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,origin:w.location.origin,data:{type:'h2s-review-ready'}}));
        assert.equal(messages.length,0);
    }
});
test('management Quotes review retains ADMIN context and requests the native payment portfolio destination',async t=>{
    const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'sales-preview.html'),'utf8'),{url:'http://127.0.0.1:9444/sales-review?screen=managementQuotes',runScripts:'outside-only'});
    t.after(()=>dom.window.close());
    const w=dom.window;
    w.fetch=async()=>({ok:true,json:async()=>({gallery:{}})});
    w.eval(w.document.querySelector('script').textContent);
    await new Promise(resolve=>setImmediate(resolve));
    const frame=w.document.getElementById('application'),url=new URL(frame.src),messages=[];
    assert.equal(url.pathname,'/dash.html');assert.equal(url.searchParams.get('reviewRole'),'ADMIN');
    assert.equal(w.document.getElementById('width').value,'1280');
    frame.contentWindow.postMessage=message=>messages.push(message);
    w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,origin:w.location.origin,data:{type:'h2s-review-ready'}}));
    assert.equal(messages[0].mode,'transactions');
});
test('previews position native Operations views and the dedicated Strategy workspace',async t=>{
    for(const [screen,tab,property,value]of [
        ['scheduling','operations','operationsView','schedule'],
        ['reconciliation','operations','operationsView','reconciliation'],
        ['forecast','strategy','focusForecast',true],
        ['strategy','strategy','focusForecast',true],
        ['management','fieldsales','mode','dashboard']
    ]){
        const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'sales-preview.html'),'utf8'),{url:'http://127.0.0.1:9444/sales-review?screen='+screen,runScripts:'outside-only'});
        t.after(()=>dom.window.close());const w=dom.window,messages=[];
        w.fetch=async()=>({ok:true,json:async()=>({gallery:{}})});w.eval(w.document.querySelector('script').textContent);
        await new Promise(resolve=>setImmediate(resolve));const frame=w.document.getElementById('application');
        assert.equal(new URL(frame.src).searchParams.get('reviewTab'),tab);
        frame.contentWindow.postMessage=message=>messages.push(message);
        w.dispatchEvent(new w.MessageEvent('message',{source:frame.contentWindow,origin:w.location.origin,data:{type:'h2s-review-ready'}}));
        assert.equal(messages[0][property],value);assert.equal(messages[0].documentVersion,1);
    }
});
