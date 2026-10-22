const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dash.js'), 'utf8');
const tree = ts.createSourceFile('dash.js', source, ts.ScriptTarget.Latest, true);
let proofSource;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'proofPacks') proofSource = node.initializer.getText(tree);
  else ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(proofSource);
const asset = (id, patch = {}) => ({
  asset_id: id, media_kind: 'photo', service: 'tv_mounting', storage_path: `${id}.webp`, is_visible: true, ...patch,
});
function fixture(t) {
  const dom = new JSDOM('<input id="ppSurface" value="bundles"><input id="search"><div id="ppAssetsStatus"></div><div id="ppAssetsList"></div>', {
    url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.console.error = () => {};
  let scroll = 450;
  Object.defineProperty(w, 'scrollY', { get: () => scroll });
  w.scrollTo = options => { scroll = options.top; };
  const ui = w.eval(`(${proofSource})`);
  w.proofPacks = ui;
  ui.state = { assets: { items: [asset('one'), asset('two')], renderLimit: 30 }, selectedIds: new Set(['one']) };
  ui.getConfig = () => ({ base: '' });
  ui.ensureSupabaseConfig = async () => {};
  ui.safeReadJson = () => null;
  ui.safeWriteJson = () => {};
  ui.publicStorageUrl = (_bucket, key) => '/' + key;
  ui.setupLibraryInfiniteScroll = () => {};
  ui.fetchLiveAssetIds = async () => ({ ids: new Set(['one']), counts: new Map([['one', 1]]) });
  ui.fetchJson = async url => url.includes('proof-packs') ? { ok: true, packs: [{ pack_id: 'pack' }] }
    : { ok: true, assets: [asset('one'), asset('two')] };
  ui.setAssetsUi(ui.state.assets);
  return { w, ui, document: w.document };
}
test('background refresh deduplicates and preserves gallery nodes, selection, filters, focus, scroll and an open draft', async t => {
  const { w, ui, document } = fixture(t);
  const original = document.querySelector('[data-asset-id="one"]');
  const select = original.querySelector('button');
  select.focus();
  ui.libraryFilters.search = 'one';
  ui.applyAllFilters();
  const draft = { scope: 'placement', focal_x: 23, zoom: 1.6 };
  ui.state.edit = draft;
  let release;
  ui.fetchLiveAssetIds = () => new Promise(resolve => { release = resolve; });
  const first = ui.refreshAssets();
  const second = ui.refreshAssets();
  assert.equal(first, second);
  assert.equal(document.querySelector('[data-asset-id="one"]'), original);
  assert.equal(document.querySelector('.gallery-loading'), null);
  await new Promise(resolve => setImmediate(resolve));
  release({ ids: new Set(['one']), counts: new Map([['one', 1]]) });
  await first;
  assert.equal(document.querySelector('[data-asset-id="one"]'), original);
  assert.equal(document.activeElement, select);
  assert.equal(w.scrollY, 450);
  assert.equal(ui.libraryFilters.search, 'one');
  assert.equal(ui.state.edit, draft);
  assert.equal(ui.state.selectedIds.has('one'), true);
  assert.equal(document.querySelector('[data-asset-id="two"]').dataset.matchesFilters, '0');
  assert.equal(document.querySelector('[data-library-retry]').hidden, true);
});
test('failed updates retain usable data and show contextual Retry; retry recovers without a loading takeover', async t => {
  const { ui, document } = fixture(t);
  const original = document.querySelector('[data-asset-id="one"]');
  const fetchJson = ui.fetchJson;
  ui.fetchJson = async () => { throw new Error('Fixture offline'); };
  await ui.refreshAssets();
  assert.equal(ui.state.assets.items.length, 2);
  assert.equal(document.querySelector('[data-asset-id="one"]'), original);
  assert.match(document.querySelector('[data-library-status]').textContent, /Fixture offline.*retained/);
  assert.equal(document.querySelector('[data-library-retry]').hidden, false);
  ui.fetchJson = fetchJson;
  document.querySelector('[data-library-retry]').focus();
  document.querySelector('[data-library-retry]').click();
  await ui._assetsRequest.promise;
  assert.equal(document.querySelector('[data-asset-id="one"]'), original);
  assert.equal(document.querySelector('[data-library-retry]').hidden, true);
  assert.equal(document.activeElement, document.querySelector('[data-library-status]'));
});
test('superseded pack responses cannot clear or overwrite newer gallery and usage state', async t => {
  const { ui, document } = fixture(t);
  let release;
  const loadPacks = ui.ensureLibraryPacksLoaded.bind(ui);
  ui.ensureLibraryPacksLoaded = surface => surface === 'bundles'
    ? new Promise(resolve => { release = resolve; }) : loadPacks(surface);
  const old = ui.refreshAssets();
  document.getElementById('ppSurface').value = 'commercial_intake';
  await ui.refreshAssets();
  const latest = ui.state.assets;
  const packs = ui.state.libraryPacks;
  release({ tv_mounting: [], cameras: [] });
  await old;
  assert.equal(ui.state.assets, latest);
  assert.equal(ui.state.libraryPacks, packs);
  assert.equal(ui.state.liveAssetIds.has('one'), true);
});
test('gallery refresh never schedules write-backed thumbnail repair and selection remains reversible', async t => {
  const { ui, document } = fixture(t);
  ui.generateBatchThumbnails = () => { throw new Error('Background reads must not write thumbnails'); };
  await ui.refreshAssets();
  ui.toggleSelection('two', true);
  assert.equal(document.querySelector('[data-asset-id="two"] button').getAttribute('aria-pressed'), 'true');
  ui.toggleSelection('two', false);
  assert.equal(document.querySelector('[data-asset-id="two"] button').getAttribute('aria-pressed'), 'false');
});

test('failed thumbnails stop their error handler instead of repeatedly requesting a malformed data URL', t => {
  const { w, document } = fixture(t);
  const image = document.querySelector('.tile-image');
  const source = image.getAttribute('src');
  w.Function(image.getAttribute('onerror')).call(image);
  assert.equal(image.onerror, null);
  assert.equal(image.getAttribute('src'), source);
  assert.equal(image.hidden, true);
  assert.equal(image.nextElementSibling.hidden, false);
  assert.equal(image.nextElementSibling.textContent, 'Thumbnail unavailable');
});

test('existing local image optimization still resizes proportionally and emits a WebP without network or placement writes', async t => {
  const { w, ui } = fixture(t);
  let draw;
  let encoded;
  w.createImageBitmap = async () => ({ width: 2400, height: 1600 });
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage(...args) { draw = args; } });
  w.HTMLCanvasElement.prototype.toBlob = function (done, mime, quality) {
    encoded = { width: this.width, height: this.height, mime, quality };
    done(new w.Blob([new Uint8Array(512)], { type: mime }));
  };
  const input = new w.File([new Uint8Array(2048)], 'original.jpg', { type: 'image/jpeg' });
  const originalState = JSON.stringify(ui.state.assets);
  const result = await ui.convertImageFile(input, { format: 'webp', quality: 0.72, maxDim: 1200 });
  assert.deepEqual(encoded, { width: 1200, height: 800, mime: 'image/webp', quality: 0.72 });
  assert.deepEqual(draw.slice(1), [0, 0, 1200, 800]);
  assert.equal(result.name, 'original.webp');
  assert.equal(result.type, 'image/webp');
  assert.equal(input.name, 'original.jpg');
  assert.equal(JSON.stringify(ui.state.assets), originalState);
});

test('loaded-library counts do not depend on mix goals, selected packs, filters or render limits', t => {
  const { ui, document } = fixture(t);
  document.body.insertAdjacentHTML('beforeend', '<span id="ppAssetsCount"></span><span id="ppPhotoStats"></span><span id="ppVideoStats"></span>');
  ui.getSelectedPack = () => { throw new Error('Counts must not need a selected pack'); };
  ui.state.assets.items = [asset('photo'), asset('video', { media_kind: 'video' }), asset('hidden', { is_visible: false })];
  ui.state.assets.renderLimit = 1;
  ui.libraryFilters.search = 'nothing';
  ui.renderMixGoals();
  assert.equal(document.getElementById('ppAssetsCount').textContent, '3');
  assert.equal(document.getElementById('ppPhotoStats').textContent, '2');
  assert.equal(document.getElementById('ppVideoStats').textContent, '1');
  ui.state.assets.items = [];
  ui.renderMixGoals();
  assert.equal(document.getElementById('ppAssetsCount').textContent, '0');
});

test('thumbnail selection uses the existing positioned checkbox styles rather than an in-flow blank button', t => {
  const { document } = fixture(t);
  const button = document.querySelector('#ppAssetsList [data-asset-id] button');
  assert.ok(button.classList.contains('tile-checkbox'));
  assert.equal(button.getAttribute('aria-pressed'), 'true');
});

test('routine image defaults and every retained advanced setting control local encoding', async t => {
  const { w, ui, document } = fixture(t);
  const input = new w.File([new Uint8Array(2048)], 'original.jpg', { type: 'image/jpeg' });
  let encoded;
  w.createImageBitmap = async () => ({ width: 2400, height: 1600 });
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,fixture';
  w.HTMLCanvasElement.prototype.toBlob = function (done, mime, quality) {
    encoded = { width: this.width, height: this.height, mime, quality };
    done(new w.Blob([new Uint8Array(512)], { type: mime }));
  };
  await ui.prepareImageFile(input);
  assert.deepEqual(encoded, { width: 1920, height: 1280, mime: 'image/webp', quality: 0.72 });
  document.body.insertAdjacentHTML('beforeend', '<input id="ppOptimizeImages" type="checkbox" checked><select id="ppImageFormat"><option value="webp">WebP</option><option value="avif">AVIF</option></select><input id="ppImageQuality" value="48"><select id="ppImageMaxDim"><option value="1280">1280</option><option value="0">Original</option></select>');
  document.getElementById('ppImageFormat').value = 'avif';
  const output = await ui.prepareImageFile(input);
  assert.equal(output.type, 'image/avif');
  assert.deepEqual(encoded, { width: 1280, height: 853, mime: 'image/avif', quality: 0.48 });
  document.getElementById('ppImageMaxDim').value = '0';
  document.getElementById('ppImageFormat').value = 'webp';
  await ui.prepareImageFile(input);
  assert.deepEqual(encoded, { width: 2400, height: 1600, mime: 'image/webp', quality: 0.48 });
  document.getElementById('ppOptimizeImages').checked = false;
  assert.equal(await ui.prepareImageFile(input), input);
  document.getElementById('ppOptimizeImages').checked = true;
  const video = new w.File(['video'], 'fixture.webm', { type: 'video/webm' });
  assert.equal(await ui.prepareImageFile(video), video);
});

test('unsupported AVIF encoding cannot produce a mislabeled PNG, and failed WebP aborts optimization', async t => {
  const { w, ui } = fixture(t);
  w.console.warn = () => {};
  w.createImageBitmap = async () => ({ width: 1200, height: 800 });
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  const requested = [];
  w.HTMLCanvasElement.prototype.toBlob = function (done, mime) {
    requested.push(mime);
    done(new w.Blob(['bytes'], { type: mime === 'image/avif' ? 'image/png' : mime }));
  };
  const input = new w.File(['source'], 'original.jpg', { type: 'image/jpeg' });
  const output = await ui.convertImageFile(input, { format: 'avif' });
  assert.deepEqual(requested, ['image/avif', 'image/webp']);
  assert.equal(output.type, 'image/webp');
  assert.equal(output.name, 'original.webp');
  w.HTMLCanvasElement.prototype.toBlob = done => done(new w.Blob(['bytes'], { type: 'image/png' }));
  await assert.rejects(ui.convertImageFile(input, { format: 'webp' }), /could not encode/);
});

test('the common single/bulk upload path optimizes before fixture writes and preserves staged intent', async t => {
  const { w, ui, document } = fixture(t);
  document.body.insertAdjacentHTML('beforeend', '<input id="ppIntent" value="result_proof"><input id="ppSlotKey" value="hero"><div id="ppUploadStatus"></div>');
  const notices = [];
  w.showToast = message => notices.push(message);
  const original = new w.File(['original'], 'source.jpg', { type: 'image/jpeg' });
  original._intentMeta = { customer_intent: 'working_shot', frontend_destinations: ['hero'], psychological_weight: 8 };
  const optimized = new w.File(['optimized'], 'source.webp', { type: 'image/webp' });
  ui.state.file = original;
  ui.state.analysis = { width_px: 2400, height_px: 1600 };
  ui.getSelectedPack = () => ({ pack_id: 'fixture-pack', week_of: '2026-10-01' });
  ui.recommendSlots = () => ({ allowed: ['hero'], warnings: [] });
  ui.effectiveMediaKind = () => 'photo';
  ui.validateTrimWindow = () => ({ ok: true });
  ui.prepareImageFile = async file => {
    assert.equal(file, original);
    return optimized;
  };
  ui.analyzeFile = async file => {
    assert.equal(file, optimized);
    return { width_px: 1280, height_px: 853, file_size_kb: 1 };
  };
  const writes = [];
  ui.fetchJson = async (url, options) => {
    writes.push({ url, options });
    if (url.endsWith('/proof-upload')) return { ok: true, bucket: 'proof', path: 'source.webp', content_type: 'image/webp' };
    if (url.endsWith('/proof-assets')) return { ok: true, asset_id: 'fixture-created' };
    return { ok: true };
  };
  ui.refreshAssets = async () => {};
  ui.refreshCoverage = () => {};
  await ui.uploadAndAssignInternal();
  assert.equal(document.getElementById('ppUploadStatus').textContent, 'Done.');
  assert.equal(writes[0].url, '/api/admin/proof-upload');
  assert.equal(writes[0].options.body.get('file').type, 'image/webp');
  const created = JSON.parse(writes.find(item => item.url.endsWith('/proof-assets')).options.body);
  assert.equal(created.width_px, 1280);
  assert.equal(created.height_px, 853);
  assert.equal(created.customer_intent, 'working_shot');
  assert.equal(created.psychological_weight, 80);
  assert.deepEqual(created.frontend_destinations, ['hero']);
  writes.length = 0;
  ui.state.file = original;
  ui.prepareImageFile = async () => { throw new Error('Fixture encoding failed'); };
  await ui.uploadAndAssignInternal();
  assert.equal(writes.length, 0);
  assert.equal(document.getElementById('ppUploadStatus').textContent, 'Failed.');
  assert.match(notices.at(-1), /Fixture encoding failed/);
});

test('expandable hero choices report saved scope/usage and open the existing editor without writing', async t => {
  const { w, ui, document } = fixture(t);
  w.getDashboardSessionToken = () => 'fixture-session';
  const menu = document.createElement('div');
  document.body.appendChild(menu);
  const reads = [];
  ui.fetchJson = async (url, options) => {
    reads.push({ url, options });
    return { ok: true, placements: [{ surface: 'bundles', area: 'hero', enabled: true, display_order: 7 }] };
  };
  let selected;
  ui.openPagePlacement = (...args) => { selected = args; };
  await ui.appendHeroPlacementMenu(menu, 'one');
  const details = menu.querySelector('details');
  assert.equal(details.open, false);
  details.open = true;
  assert.match(details.textContent, /Bundles \/ Hero background.*Included.*order 7/s);
  assert.match(details.textContent, /Commercial \/ Hero photo.*No saved override/s);
  menu.querySelector('[data-hero-surface="commercial_intake"]').click();
  assert.equal(selected[0], 'one');
  assert.equal(selected[1].surface, 'commercial_intake');
  assert.equal(selected[1].area, 'commercial_hero');
  assert.equal(reads.length, 1);
  assert.equal(reads[0].options.method, undefined);
});
