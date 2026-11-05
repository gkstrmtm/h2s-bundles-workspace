const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { JSDOM } = require('../../node_modules/jsdom');
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
async function navigation(t) {
    const dom = new JSDOM(fs.readFileSync(path.join(__dirname, 'walkthrough.html'), 'utf8'), {
        url: 'https://127.0.0.1:50271/', runScripts: 'outside-only'
    });
    t.after(() => dom.window.close());
    const calls = [], state = { scenario: 'tv', stage: 'new', suggestions: {}, checkouts: [] };
    dom.window.confirm = () => true;
    dom.window.fetch = async (url, options) => {
        calls.push({ url, options });
        if (url === '/walkthrough/control') {
            const body = JSON.parse(options.body);
            if (body.action === 'reset') state.scenario = body.scenario;
            return { ok: true, json: async () => ({ok:true}) };
        }
        return {ok:true,json:async()=>({...state})};
    };
    dom.window.eval(fs.readFileSync(path.join(__dirname, 'walkthrough.js'), 'utf8'));
    await tick();
    return { window: dom.window, doc: dom.window.document, calls, state };
}
test('navigator begins in actual representative application and blocks an unavailable customer handoff', async t => {
    const f = await navigation(t);
    assert.match(f.doc.querySelector('iframe').src, /dash\.html\?reviewRole=SALES/);
    assert.equal(f.doc.querySelector('[data-role="customer"]').disabled, true);
    assert.match(f.doc.querySelector('#step-label').textContent, /1\/21/);
    assert.equal(f.calls.some(call => call.url === '/walkthrough/control'), false);
});
test('changing guided steps navigates without creating or paying an application record', async t => {
    const f = await navigation(t);
    f.doc.querySelector('#forward').click(); await tick();
    assert.match(f.doc.querySelector('#step-label').textContent, /2\/21/);
    assert.equal(f.calls.some(call => call.url === '/walkthrough/control'), false);
    f.doc.querySelector('#back').click(); await tick();
    assert.match(f.doc.querySelector('#step-label').textContent, /1\/21/);
});
test('scenario reset affects only the explicit isolated control and never advances completed records', async t => {
    const f = await navigation(t);
    f.doc.querySelector('[data-scenario="camera"]').click(); await tick();
    const controls = f.calls.filter(call => call.url === '/walkthrough/control');
    assert.equal(controls.length, 1);
    assert.deepEqual(JSON.parse(controls[0].options.body), {action:'reset',scenario:'camera'});
    assert.equal(f.doc.querySelector('[data-scenario="camera"]').getAttribute('aria-pressed'), 'true');
});
function message(f, data) {
    const frame=f.doc.querySelector('iframe');
    f.window.dispatchEvent(new f.window.MessageEvent('message',{origin:f.window.location.origin,source:frame.contentWindow,data}));
}
test('stale provider navigation cannot replace a newer representative perspective', async t => {
    const f=await navigation(t), frame=f.doc.querySelector('iframe');
    const oldVersion=Number(new URL(frame.src).searchParams.get('reviewNavigation'));
    f.doc.querySelector('[data-step="18"]').click();await tick();
    const current=frame.src;
    message(f,{type:'h2s-review-navigation',documentVersion:oldVersion,url:'/field-agreement.html#old-synthetic-token'});
    assert.equal(frame.src,current);
    assert.equal(frame.dataset.role,'sales');
    const version=Number(new URL(current).searchParams.get('reviewNavigation'));
    message(f,{type:'h2s-review-navigation',documentVersion:version,url:'/field-agreement.html#current-synthetic-token'});
    assert.equal(frame.dataset.role,'customer');
    assert.equal(new URL(frame.src).hash,'#current-synthetic-token');
    assert.notEqual(Number(new URL(frame.src).searchParams.get('reviewNavigation')),version);
});
test('provider return cannot cancel a management switch while its status request is pending', async t => {
    const f=await navigation(t), frame=f.doc.querySelector('iframe');
    const oldVersion=Number(new URL(frame.src).searchParams.get('reviewNavigation'));
    let resolve;
    f.window.fetch=()=>new Promise(done=>{resolve=done;});
    f.doc.querySelector('[data-step="10"]').click();
    message(f,{type:'h2s-review-navigation',documentVersion:oldVersion,url:'/field-agreement.html#late-provider-return'});
    resolve({ok:true,json:async()=>({...f.state})});await tick();
    assert.equal(frame.dataset.role,'admin');
    assert.match(frame.src,/dash\.html\?reviewRole=ADMIN/);
    assert.equal(new URL(frame.src).hash,'');
});
test('technician next step preserves actual open job and enables optional inputs', async t => {
    const f=await navigation(t);f.state.jobId='synthetic-job';
    f.doc.querySelector('[data-step="13"]').click();await tick();
    const frame=f.doc.querySelector('iframe'), url=frame.src;
    message(f,{type:'h2s-review-ready',documentVersion:Number(new URL(url).searchParams.get('reviewNavigation'))});
    f.doc.querySelector('#forward').click();await tick();
    assert.equal(frame.src,url);
    assert.equal(f.doc.querySelector('#photo').disabled,false);
    assert.equal(f.doc.querySelector('#suggest').disabled,false);
});
test('unavailable customer acceptance form fails explicitly rather than claiming sample entry succeeded', async t => {
    const f=await navigation(t);f.state.agreementUrl='https://127.0.0.1:50271/field-agreement.html#synthetic-token';
    f.doc.querySelector('[data-step="8"]').click();await tick();
    const frame=f.doc.querySelector('iframe');
    message(f,{type:'h2s-review-ready',documentVersion:Number(new URL(frame.src).searchParams.get('reviewNavigation'))});
    f.doc.querySelector('#suggest').click();await tick();
    assert.match(f.doc.querySelector('#error').textContent,/Customer acceptance form is not available/);
    assert.doesNotMatch(f.doc.querySelector('#instructions').textContent,/Sample values filled/);
});
test('synthetic native photo selection survives input replacement and restores exact picker behavior', async t => {
    const f=await navigation(t);f.state.jobId='synthetic-job';
    f.doc.querySelector('[data-step="14"]').click();await tick();
    const frame=f.doc.querySelector('iframe'), d=frame.contentDocument, w=frame.contentWindow;
    d.open();d.write('<body><button data-photos="synthetic-job">Photos</button><input type="file" id="upload-synthetic-job" accept="image/*"><input type="file" id="other-job" accept="image/*"></body>');d.close();
    message(f,{type:'h2s-review-ready',documentVersion:Number(new URL(frame.src).searchParams.get('reviewNavigation'))});
    let nativeClicks=0, unrelatedClicks=0, selected=0;
    const prototype=w.HTMLInputElement.prototype;
    prototype.click=function(){if(this.id==='other-job')unrelatedClicks++;else nativeClicks++;};
    const original=prototype.click;
    Object.defineProperty(prototype,'files',{configurable:true,get(){return this._files;},set(value){this._files=value;}});
    w.DataTransfer=class {constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}};
    const fetch=f.window.fetch;
    f.window.fetch=async(url,options)=>url==='/walkthrough/sample-photo.png'?{blob:async()=>new w.Blob(['synthetic'],{type:'image/png'})}:fetch(url,options);
    d.querySelector('button').onclick=async()=>{
        await tick();
        const replacement=d.createElement('input');replacement.type='file';replacement.id='upload-synthetic-job';replacement.accept='image/*';
        d.querySelector('#upload-synthetic-job').replaceWith(replacement);
        replacement.onchange=()=>{selected++;assert.equal(replacement.files[0].name,'SYNTHETIC-review-photo.png');};
        d.querySelector('#other-job').click();
        replacement.click();
    };
    f.doc.querySelector('#photo').click();f.doc.querySelector('#photo').click();
    for(let n=0;n<20&&!selected;n++)await tick();
    assert.equal(selected,1);
    assert.equal(nativeClicks,0);
    assert.equal(unrelatedClicks,1);
    assert.equal(prototype.click,original);
    assert.equal(f.doc.querySelector('#error').textContent,'');
});
test('review HTML labels simulation and keeps navigation outside the original application', () => {
    const html = fs.readFileSync(path.join(__dirname, 'walkthrough.html'), 'utf8');
    assert.match(html, /ISOLATED SYNTHETIC DATA/);
    assert.match(html, /<iframe id="application"/);
    assert.match(html, /you still submit actual application forms/i);
    assert.doesNotMatch(html, /data-agreement-accept|data-installation-form|data-commerce-create/);
});
async function bootstrap(t, role = 'SALES') {
    const dom = new JSDOM('<html><head><script src="/walkthrough/boot.js"></script></head><body><a id="checkout" href="https://checkout.stripe.com/c/pay/cs_test_fixture">Checkout</a></body></html>', {
        url: 'https://127.0.0.1:50271/dash.html?reviewRole=' + role, runScripts: 'outside-only'
    });
    t.after(() => dom.window.close());
    const calls = [], messages = [], alerts = [];
    dom.window.Headers = Headers; dom.window.Request = Request;
    dom.window.alert = value => alerts.push(value);
    dom.window.postMessage = value => messages.push(value);
    dom.window.fetch = async (url, options) => {
        calls.push({url,options});
        return {ok:true,json:async()=>({checkouts:[{sessionId:'cs_test_fixture',url:'https://checkout.stripe.com/c/pay/cs_test_fixture'}]})};
    };
    dom.window.eval(fs.readFileSync(path.join(__dirname, 'bootstrap.js'), 'utf8'));
    await tick();
    return {window:dom.window,calls,messages,alerts};
}
test('review bootstrap maps production API addresses to loopback while preserving the pro session contract', async t => {
    const f = await bootstrap(t, 'PRO');
    await f.window.fetch('https://h2s-backend.vercel.app/api/portal_jobs');
    assert.equal(f.calls.at(-1).url, 'https://127.0.0.1:50271/api/portal_jobs');
    assert.equal(f.calls.at(-1).options.headers.get('Authorization'), 'Bearer local-review-pro');
    assert.equal(f.window.localStorage.getItem('h2s_portal_token'), 'pro');
    await assert.rejects(f.window.fetch('https://example.invalid/private'), /External network access is blocked/);
});
test('native HTTPS checkout URL navigates only to its exact reserved simulated provider session', async t => {
    const f = await bootstrap(t);
    f.window.document.querySelector('#checkout').click(); await tick();
    const navigation = f.messages.find(message => message.type === 'h2s-review-navigation');
    assert.equal(navigation.url, 'https://127.0.0.1:50271/walkthrough/provider?session=cs_test_fixture');
    assert.equal(f.alerts.length, 0);
    f.window.document.querySelector('#checkout').href = 'https://checkout.stripe.com/c/pay/cs_test_unknown';
    f.window.document.querySelector('#checkout').click(); await tick();
    assert.equal(f.messages.filter(message => message.type === 'h2s-review-navigation').length, 1);
    assert.match(f.alerts[0], /No matching synthetic provider reservation/);
});
