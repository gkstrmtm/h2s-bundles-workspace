const test = require('node:test'), assert = require('node:assert/strict');
const { createDashboardPreview } = require('./dashboard-preview-fixture.cjs');
const origin = 'http://127.0.0.1:9444';

test('dashboard read fixture exercises native queue/media readers, keeps markets and filters, and never accepts writes', async () => {
    const preview = createDashboardPreview();
    const read = async (name, query = '') => {
        const response = await preview.request(name, 'GET', 'admin', query, origin);
        assert.ok(response.ok);
        return response.json();
    };
    const all = await read('v1', '?action=commercialQueue&market=all&filter=all');
    assert.equal(all.commercialQueue.queue.length, 2);
    const residential = await read('v1', '?action=commercialQueue&market=residential&filter=all');
    assert.equal(residential.commercialQueue.queue.length, 1);
    assert.equal(residential.commercialQueue.queue[0].market, 'residential');
    assert.ok(JSON.stringify(residential).includes('Wellington'));
    const searched = await read('v1', '?action=commercialQueue&market=all&filter=all&q=Northwind');
    assert.equal(searched.commercialQueue.queue.length, 1);
    assert.equal((await read('v1', '?action=commercialQueue&market=all&filter=all&q=NO_MATCH')).commercialQueue.queue.length, 0);
    const packs = await read('admin/proof-packs', '?surface=bundles&service=cameras');
    assert.equal(packs.packs.length, 1);
    const assets = await read('admin/proof-assets', '?pack_id=' + packs.packs[0].pack_id);
    assert.equal(assets.assets.length, 1);
    assert.equal(assets.assets[0].service, 'cameras');
    assert.equal(preview.hasMedia('review-media', assets.assets[0].storage_path), true);
    assert.equal(preview.hasMedia('private', 'unknown'), false);
    const before = JSON.stringify(preview.fixture.tables);
    for (const name of ['admin/proof-assets', 'v1', 'commercial-calendar']) {
        assert.equal(await preview.request(name, 'POST', 'admin', '?action=commercialQueue', origin), null);
    }
    assert.equal(JSON.stringify(preview.fixture.tables), before);
    assert.equal((await preview.request('v1', 'GET', 'sales', '?action=commercialQueue', origin)).status, 403);
    assert.equal(await preview.request('v1', 'GET', 'admin', '?action=unavailableIntegration', origin), null);
    const operations = await read('management-operations');
    assert.equal(operations.readOnly, true);
    assert.equal(operations.jobs.length, 1);
    assert.equal(operations.jobs[0].payment.status, 'unverified');
    const emptyPage = await read('management-operations', '?offset=1');
    assert.equal(emptyPage.jobs.length, 0);
    assert.equal((await read('management-planning', '?view=schedule&filter=all')).jobs.length, 1);
    assert.equal((await preview.request('management-operations', 'GET', 'admin', '?offset=-1', origin)).status, 400);
});

test('Operations native readers and selectable UI handle zero, one, ten and sixty synthetic jobs', async t => {
    const { JSDOM } = require('jsdom'), fs = require('node:fs'), path = require('node:path');
    const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'management-operations.js'), 'utf8');
    const settle = async () => { for (let i=0;i<5;i++) await new Promise(resolve=>setImmediate(resolve)); };
    for (const count of [0,1,10,60]) await t.test(`${count} jobs`, async () => {
        const preview=createDashboardPreview({jobCount:count});
        const dom=new JSDOM('<div id="h2s-app"><div class="app-sidebar-group" data-group-id="admin"><div class="app-sidebar-group-items"></div></div><div class="app-content"></div></div>',
            {runScripts:'outside-only',url:origin});
        try {
            const w=dom.window,calls=[];
            w.console.error=()=>{};
            w.fetch=(url,options)=>{const u=new URL(url);calls.push({u,options});return preview.request(u.pathname.replace('/api/',''),options.method,'admin',u.search,origin);};
            w.eval(source);
            w.H2SManagementOperations.configure({apiBase:origin,getSession:()=>({token:'synthetic-admin',isAdmin:true})});
            await w.H2SManagementOperations.open();
            const root=w.document.getElementById('operations-pane'),buttons=()=>root.querySelectorAll('[data-operation-record]');
            assert.equal(buttons().length,Math.min(count,25));
            assert.equal(root.querySelectorAll('details, summary').length,0);
            if(count) assert.match(root.textContent,/filters and search apply to this page/);
            if(!count){assert.match(root.textContent,/No Dispatch records/);return;}
            assert.equal(root.querySelectorAll('[data-job-section]').length,6);
            assert.equal(root.querySelector('[data-assignment-job]'),null);
            if(count>1){
                buttons()[1].click();
                assert.equal(root.querySelector('[data-selected-title]').textContent,'Jordan Morgan');
                buttons()[1].dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
                assert.equal(root.querySelector('[data-selected-title]').textContent,'Taylor Morgan');
                assert.equal(root.querySelectorAll('[data-operation-record][aria-pressed="true"]').length,1);
                assert.equal(w.document.activeElement.dataset.operationRecord,buttons()[2].dataset.operationRecord);
                assert.doesNotMatch(root.querySelector('[data-selected-title]').textContent,/SYNTHETIC|household \d/i);
                const completed=preview.fixture.tables.h2s_dispatch_jobs.filter(job=>job.status==='completed');
                assert.ok(completed.every(job=>Date.parse(job.due_at)<Date.now()),'completed sample installations must not be scheduled in the future');
                const search=root.querySelector('[data-operations-search]');
                search.value='No matching household';search.dispatchEvent(new w.Event('input',{bubbles:true}));
                assert.equal(buttons().length,0);assert.match(root.textContent,/Other pages may contain/);
                search.value='';search.dispatchEvent(new w.Event('input',{bubbles:true}));
            }
            root.querySelector('[data-operations-view="schedule"]').click();await settle();
            assert.equal(buttons().length,Math.min(count,25));
            assert.ok(root.querySelector('[data-selected-title]').textContent.includes('Morgan'));
            if(count>1){
                assert.ok(calls.some(call=>call.u.searchParams.has('jobId')));
                assert.match(root.querySelector('[data-job-section="payments"]').textContent,/Full-order payment/);
                assert.match(root.querySelector('[data-job-section="payments"]').textContent,/Verified depositNot available/);
                assert.match(root.querySelector('[data-operations-audit]').textContent,/SYNTHETIC full-order payment evidence/);
            }
            if(count>25){
                root.querySelector('[data-operations-action="next"]').click();await settle();
                assert.match(root.querySelector('[data-operations-page]').textContent,/60 matching records · page 2/);
                assert.equal(buttons().length,25);
            }
            root.querySelector('[data-operations-context="audit"]').click();
            assert.equal(root.querySelector('[data-operations-audit]').hidden,false);
            assert.equal(root.querySelector('[data-operations-detail]').hidden,true);
            assert.match(root.querySelector('[data-operations-audit]').textContent,/selectedRecord/);
            if(count>=10){
                root.querySelector('[data-operations-view="reconciliation"]').click();await settle();
                const labels=[...buttons()].map(button=>button.querySelector('strong').textContent);
                assert.ok(labels.length>1);
                assert.equal(new Set(labels).size,labels.length,'historical cases with the same category must remain distinguishable');
                assert.ok(labels.every(label=>/Check \d+/.test(label)));
                assert.doesNotMatch(root.querySelector('[data-operations-detail]').textContent,/Exactly one explicit|legacy relationship|category-based triage/i);
            }
            assert.ok(calls.every(call=>call.options.method==='GET'));
        } finally {dom.window.close();}
    });
});
