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
