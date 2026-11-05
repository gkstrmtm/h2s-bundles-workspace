const test = require('node:test');
const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');

// Concurrent JSDOM startup is not renderer work. Bound each phase independently;
// observer convergence still has the deterministic 16-pass limit below.
const STARTUP_TIMEOUT_MS = 60000, RENDER_TIMEOUT_MS = 60000;
test('real shared controls settle on Quotes and preserve the builder through Orders',
    {timeout: STARTUP_TIMEOUT_MS + RENDER_TIMEOUT_MS + 10000}, async () => {
    const worker = new Worker(`
        const {parentPort} = require('node:worker_threads');
        const {JSDOM} = require('jsdom');
        const fs = require('node:fs'), assert = require('node:assert/strict');
        const dom = new JSDOM('<main id="h2s-app"><div class="app-content"></div></main>',
            {runScripts:'outside-only',url:'https://fixture.invalid/sales.html'});
        const w = dom.window, frames = [];
        w.requestAnimationFrame = callback => frames.push(callback);
        w.crypto.randomUUID = require('node:crypto').randomUUID;
        const listing = {ok:true,enabled:true,services:[],representatives:[],
            opportunities:[{lead_id:'fixture-lead',full_name:'Synthetic customer',market:'residential',services:[]}],total:1};
        const transactions = {ok:true,enabled:true,quotes:[],orders:[],agreements:[],payments:[],
            catalogs:[{catalog_id:'fixture-catalog',version:'Fixture version',status:'published',definition:{services:[
                {id:'tv',label:'TV Mounting',markets:['residential'],offers:[{id:'wall',label:'Wall mounting',enabled:true,minimum:1,maximum:5,
                    scope:['Wall mounting'],equipment:[],questions:[{id:'wall',label:'Wall type',type:'select',options:['Drywall','Brick']}],options:[]}]}
            ]}}]};
        w.fetch = async url => Response.json(url.includes('field-sales-transactions') ? transactions : listing);
        w.H2SFieldWorkflow = {reset(){},mount(root){root.textContent='Synthetic orders';}};
        for(const file of ['dashboard-controls.js','field-sales.js','field-commerce.js'])
            w.eval(fs.readFileSync('frontend/'+file,'utf8'));
        w.H2SFieldSales.configure({apiBase:'https://fixture.invalid',getSession:()=>({token:'synthetic-session',role:'SALES'})});
        async function settle() {
            for(let pass=0;pass<16;pass++) {
                await new Promise(resolve=>setImmediate(resolve));
                if(!frames.length)return;
                const batch=frames.splice(0);batch.forEach(callback=>callback(0));
            }
            throw Error('Shared controls did not reach a stable observer/frame boundary');
        }
        async function settleWithoutAnimationFrames() {
            // Hidden preview/background documents may never deliver the observer's queued RAF.
            for(let pass=0;pass<8;pass++)await new Promise(resolve=>setImmediate(resolve));
        }
        (async()=>{
            parentPort.postMessage({phase:'ready'});
            await w.H2SFieldSales.navigate('quotes','fixture-lead');
            w.H2SDashboardControls.bootstrapDashboardCustomSelects();
            await settle();
            const form=w.document.querySelector('[data-commerce-create]');
            assert.ok(form.querySelector('.dashboard-custom-select-shell'));
            form.querySelector('[name="quantity"]').value='4';
            form.querySelector('[name="exceptionNote"]').value='Retained exception';
            const wall=form.querySelector('[data-q="wall"]');
            wall.nextElementSibling.querySelector('[data-value="Brick"]').click();
            await settle();assert.equal(wall.value,'Brick');
            for(const width of [320,390,768,1280]) {
                w.innerWidth=width;w.dispatchEvent(new w.Event('resize'));await settle();
                await w.H2SFieldSales.navigate('orders');await settleWithoutAnimationFrames();
                await w.H2SFieldSales.navigate('quotes');await settleWithoutAnimationFrames();
                // Foregrounding resumes RAF: test the shared observer's real lifecycle, not
                // an artificial requirement to enhance controls while the document is hidden.
                await settle();
                assert.equal(w.document.querySelector('[data-commerce-create]'),form);
                assert.equal(form.querySelector('[name="quantity"]').value,'4');
                assert.equal(form.querySelector('[name="exceptionNote"]').value,'Retained exception');
                assert.equal(form.querySelector('[data-q="wall"]').value,'Brick');
                assert.equal(form.querySelectorAll('.dashboard-custom-select-shell').length,form.querySelectorAll('select').length);
                for(const select of w.document.querySelectorAll('#field-sales-pane select'))
                    assert.ok(w.H2SDashboardControls.dashboardGetCustomSelectShell(select),'resumed animation frames must enhance every customer and builder select');
            }
            dom.window.close();parentPort.postMessage({ok:true});
        })().catch(error=>{dom.window.close();parentPort.postMessage({error:error.stack});});
    `, {eval:true});
    try {
        const result = await new Promise((resolve,reject) => {
            let ready = false;
            let timeout = setTimeout(()=>reject(Error('Shared-controls worker startup watchdog expired (60000ms)')),STARTUP_TIMEOUT_MS);
            worker.on('message',result=>{
                if(result.phase==='ready' && !ready) {
                    ready = true;
                    clearTimeout(timeout);
                    timeout = setTimeout(()=>reject(Error('Shared-controls renderer watchdog expired (60000ms after worker ready)')),RENDER_TIMEOUT_MS);
                    return;
                }
                clearTimeout(timeout);resolve(result);
            });
            worker.once('error',error=>{clearTimeout(timeout);reject(error);});
            worker.once('exit',code=>{clearTimeout(timeout);reject(Error('Shared-controls worker exited without a result: '+code));});
        });
        assert.equal(result.error,undefined,result.error);
        assert.equal(result.ok,true);
    } finally { await worker.terminate(); }
});
