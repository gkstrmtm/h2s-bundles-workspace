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
  t.after(() => {
    dom.window.document.querySelectorAll('details').forEach(details => { details.ontoggle = null; });
    dom.window.close();
  });
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

async function destinationFixture(t) {
  const e = fixture(t), { ui, w, document } = e;
  w.H2SPageHeroes = require('../../frontend/media-page-heroes.js');
  w.H2SMediaPlacements = { style: () => '' };
  w.getDashboardSessionToken = () => 'fixture-only';
  document.body.insertAdjacentHTML('beforeend', '<div id="ppPageHeroesContent"></div><p id="ppPageMediaStatus"></p><p id="ppPageMediaContext"></p><button id="ppInspectSavedMedia"></button><p id="ppPageMediaInventoryStatus"></p><div id="ppPlacementSelection" hidden></div><button data-filter="live:yes"></button><button data-filter="live:no"></button>');
  const camera = { ...asset('two'), media_url: '/camera.jpg', original_filename: 'Camera installation' };
  const hero = { ...asset('one'), media_url: '/hero.jpg', original_filename: 'Chosen hero', media_placement: { enabled: true } };
  const eligible = { ...asset('eligible'), media_url: '/eligible.jpg' };
  const sections = { commercial_hero: { items: [hero, eligible] },
    commercial_security_rail: { items: [camera] }, commercial_display_rail: { items: [] } };
  e.reads = [];
  ui.fetchJson = async url => {
    e.reads.push(url);
    return url.includes('proof-slots') ? { ok: true, hero_media: [], hero_exclusions: [
      { asset_source: 'proof_asset', asset_id: w.H2SPageHeroes.bundlesFallbackAssetId },
    ], slots: { hero: { tv_mounting: [eligible] } } }
      : { ok: true, sections };
  };
  ui.state.assets.items.push(eligible);
  ui.setAssetsUi(ui.state.assets);
  await ui.refreshLivePreview();
  return { ...e, sections, camera, hero, eligible };
}

test('destination provenance and bounded deduplicated saved-settings inspection never write or disturb edits', async t => {
  const { ui, document } = await destinationFixture(t);
  assert.match(document.getElementById('ppPageMediaContext').textContent, /Local customer rules.*http:\/\/localhost.*Checked.*rendering unverified/);
  assert.equal(document.querySelector('[data-page-area="commercial_security_rail"] a').href, 'http://localhost/commercial.html#cameraProofRail');
  const draft = { focal_x: 22, zoom: 1.4 };
  ui.state.edit = draft;
  const focus = document.getElementById('search');
  focus.focus();
  const requests = [];
  let active = 0, peak = 0;
  ui.fetchJson = async (url, options) => {
    requests.push(url);
    assert.equal(options.headers.Authorization, 'Bearer fixture-only');
    assert.equal(options.method, undefined);
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return { ok: true, placements: new URL('http://localhost' + url).searchParams.get('asset_id') === 'eligible'
      ? [{ surface: 'commercial_intake', area: 'commercial_hero', enabled: false }] : [] };
  };
  const first = ui.loadPageMediaInventory();
  assert.equal(ui.loadPageMediaInventory(), first);
  await first;
  assert.ok(peak <= 3);
  assert.equal(requests.length, 3);
  assert.equal(new Set(requests).size, 3);
  assert.match(document.getElementById('ppPageMediaInventoryStatus').textContent, /3\/3 loaded assets verified.*not an audit/);
  assert.equal(document.querySelector('[data-media-inventory] img'), null, 'collapsed inventory does not fan out media requests');
  const inventory = document.querySelector('[data-page-area="commercial_hero"] [data-media-inventory]');
  inventory.closest('details').open = true;
  ui.renderPageMediaInventory();
  assert.match(inventory.textContent, /Hero load-error alternative.*Excluded from this area/s);
  const edited = [];
  ui.beginPlacementEdit = options => edited.push(options);
  inventory.querySelector('[data-inspect-open="proof_asset:eligible"]').click();
  assert.equal(edited[0].initialPlacement.area, 'commercial_hero');
  assert.equal(edited[0].asset.asset_id, 'eligible');
  assert.equal(ui.state.edit, draft);
  assert.equal(document.activeElement, focus);
  assert.equal(ui.state.selectedIds.has('one'), true);
});

test('saved-settings authorization failures stop bounded work and retain unverified rather than empty assignments', async t => {
  const { ui, document } = await destinationFixture(t);
  ui.state.assets.items.push(...Array.from({ length: 125 }, (_, i) => asset('extra-' + i)));
  let requests = 0;
  ui.fetchJson = async () => { requests++; throw Object.assign(new Error('Fixture forbidden'), { status: 403 }); };
  await ui.loadPageMediaInventory();
  assert.ok(requests <= 3);
  assert.equal(Object.keys(ui.state.pageMediaInventory.records).length, 100);
  assert.match(document.getElementById('ppPageMediaInventoryStatus').textContent, /0\/100 loaded assets verified.*unverified/);
  const inventory = document.querySelector('[data-page-area="commercial_hero"] [data-media-inventory]');
  inventory.closest('details').open = true;
  ui.renderPageMediaInventory();
  assert.match(inventory.textContent, /Saved setting unverified/);
  assert.doesNotMatch(inventory.textContent, /No explicit assignment/);
});

test('a placement save invalidates inspection and rejects concurrent stale inspection results', async t => {
  const { ui, document } = await destinationFixture(t);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  ui.fetchJson = async () => { await pending; return { ok: true, placements: [] }; };
  const inspection = ui.loadPageMediaInventory();
  ui.invalidatePageMediaInventory();
  release();
  await inspection;
  assert.equal(ui.state.pageMediaInventory, null);
  assert.match(document.getElementById('ppPageMediaInventoryStatus').textContent, /saved settings changed.*inspect.*again/);
  assert.match(document.querySelector('[data-media-inventory]').textContent, /Expand/);
});

test('destination inspection and usage filters use public selections rather than legacy eligibility or hero alternatives', async t => {
  const { ui, document, reads } = await destinationFixture(t);
  assert.equal(document.querySelectorAll('[data-page-area]').length, 4);
  assert.match(document.querySelector('[data-page-area="commercial_security_rail"]').textContent, /Camera installation.*Automatic selection/s);
  assert.match(document.querySelector('[data-page-area="commercial_hero"]').textContent, /Chosen for this area/);
  assert.match(document.querySelector('[data-page-area="commercial_hero"] summary').textContent, /load-error alternative.*not selected/);
  assert.equal(ui.state.liveAssetIds.has('eligible'), false);
  assert.equal(document.querySelector('[data-asset-id="eligible"] .pp-media-usage'), null);
  assert.equal(document.querySelectorAll('.pp-media-usage').length, 2);
  ui.libraryFilters.live = 'yes';
  ui.applyAllFilters();
  assert.equal(document.querySelector('[data-asset-id="eligible"]').dataset.matchesFilters, '0');
  ui.libraryFilters.live = 'no';
  ui.applyAllFilters();
  assert.equal(document.querySelector('[data-asset-id="eligible"]').dataset.matchesFilters, '1');
  assert.equal(document.querySelector('[data-asset-id="one"]').dataset.matchesFilters, '0');
  assert.equal(reads.some(url => url.includes('limit=50')), false);
});

test('Replace immediately opens a compatible picker without touching the gallery, then opens exact framing', async t => {
  const { w, ui, document, sections, hero } = await destinationFixture(t);
  sections.commercial_display_rail.items = [hero];
  await ui.refreshLivePreview();
  const messages = [];
  w.showToast = message => messages.push(message);
  ui.libraryFilters.service = 'cameras';
  ui.libraryFilters.media = 'photo';
  const edits = [];
  ui.beginPlacementEdit = options => edits.push(options);
  let picker;
  w.H2SMediaPlacements.chooseReplacement = options => { picker = options; };
  const gallery = document.getElementById('ppAssetsList');
  const previous = gallery.innerHTML;
  document.querySelector('[data-page-area="commercial_display_rail"] [data-media-replace]').click();
  assert.equal(picker.current.asset_id, 'one');
  assert.match(picker.title, /Commercial.*Display and TV rail/);
  assert.equal(picker.assets.every(asset => asset.service === 'tv_mounting' && asset.is_visible), true);
  assert.equal(picker.selectedIds.includes('one'), true);
  assert.equal(gallery.innerHTML, previous);
  assert.equal(document.getElementById('ppPlacementSelection').hidden, true);
  picker.onSelect(hero);
  assert.equal(edits.length, 0, 'cannot replace with media already selected in this area');
  assert.equal(messages.length, 1);
  picker.onSelect(picker.assets.find(asset => asset.asset_id === 'eligible'));
  assert.equal(edits.length, 1);
  assert.equal(edits[0].replacement.asset_id, 'one');
  assert.equal(edits[0].initialPlacement.area, 'commercial_display_rail');
  assert.equal(ui.state.placementTarget == null, true);
  assert.equal(ui.libraryFilters.service, 'cameras');
  assert.equal(ui.libraryFilters.media, 'photo');
  assert.equal(document.querySelectorAll('[data-media-replace]').length, 2, 'no replacement controls on heroes or alternatives');
});

test('every destination opens exact existing placement controls without saving and rail-only updates repaint', async t => {
  const { w, ui, document, sections } = await destinationFixture(t);
  const edits = [];
  ui.beginPlacementEdit = options => edits.push(options);
  document.querySelector('[data-page-area="commercial_security_rail"] [data-hero-edit]').click();
  assert.deepEqual(JSON.parse(JSON.stringify(edits[0].initialPlacement)),
    { surface: 'commercial_intake', area: 'commercial_security_rail' });
  assert.equal(edits[0].asset.asset_id, 'two');
  const notice = document.getElementById('ppPlacementSelection');
  notice.scrollIntoView = () => {};
  document.querySelector('[data-hero-choose][data-media-area="commercial_display_rail"]').click();
  assert.equal(ui.state.placementTarget.area, 'commercial_display_rail');
  assert.match(notice.textContent, /Display and TV rail/);
  notice.querySelector('button').click();
  assert.equal(ui.state.placementTarget, null);
  assert.equal(edits.length, 1);
  sections.commercial_security_rail.items[0] = { ...sections.commercial_security_rail.items[0], original_filename: 'Replacement camera' };
  await ui.refreshLivePreview();
  assert.match(document.querySelector('[data-page-area="commercial_security_rail"]').textContent, /Replacement camera/);
  const image = document.querySelector('[data-page-area="commercial_security_rail"] img');
  image.dispatchEvent(new w.Event('error'));
  assert.equal(image.hidden, true);
  assert.equal(image.closest('[data-hero-edit]').disabled, false);
  assert.match(image.parentElement.textContent, /Preview unavailable/);
  document.querySelector('[data-preview-retry]').click();
  assert.equal(image.hidden, false);
  assert.equal(image.parentElement.querySelector('[data-thumbnail-error]').hidden, true);
  assert.equal(document.querySelector('[data-preview-retry]'), null);
});

test('partial read failures retain unverified thumbnails, pause usage filters and recover without clearing drafts', async t => {
  const { ui, document } = await destinationFixture(t);
  const draft = { focal_x: 23, zoom: 1.6 };
  ui.state.edit = draft;
  ui.libraryFilters.live = 'no';
  const get = ui.fetchJson;
  ui.fetchJson = async url => {
    if (url.includes('owner-media') || url.includes('proof-gallery')) throw new Error('Fixture offline');
    return get(url);
  };
  await ui.refreshLivePreview();
  assert.equal(ui.state.pageMediaUsageComplete, false);
  assert.match(document.getElementById('ppPageMediaStatus').textContent, /filters are paused/);
  assert.equal(document.querySelector('[data-filter="live:no"]').disabled, true);
  const row = document.querySelector('[data-page-area="commercial_security_rail"]');
  assert.match(row.textContent, /retained media is not a verified current selection/);
  assert.equal(row.querySelector('[data-hero-edit]').disabled, true);
  assert.equal(row.querySelector('img').getAttribute('src'), '/camera.jpg');
  assert.equal(ui.state.edit, draft);
  assert.equal(document.querySelector('[data-asset-id="one"]').dataset.matchesFilters, '1');
  ui.fetchJson = get;
  await ui.refreshLivePreview();
  assert.equal(ui.state.pageMediaUsageComplete, true);
  assert.equal(document.querySelector('[data-filter="live:no"]').disabled, false);
  assert.equal(document.querySelector('[data-asset-id="one"]').dataset.matchesFilters, '0');
  assert.equal(ui.state.edit, draft);
  assert.equal(ui.libraryFilters.live, 'no');
});

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

test('gallery mouse, Enter, Space and context Edit Asset share the existing editor; placement has its own visible action', t => {
  const { w, ui, document } = fixture(t);
  const calls = [];
  ui.beginEditAssetMedia = id => { calls.push(['shared', id]); };
  ui.openPagePlacement = id => { calls.push(['placement', id]); };
  ui.appendHeroPlacementMenu = async () => {};
  w.getUntitledIconMarkup = () => '';
  const tile = document.querySelector('[data-asset-id="one"]');
  w.Function(tile.getAttribute('onclick')).call(tile);
  for (const key of ['Enter', ' ']) {
    const event = new w.KeyboardEvent('keydown', { key, cancelable: true });
    Object.defineProperty(event, 'target', { value: tile });
    w.Function('event', tile.getAttribute('onkeydown')).call(tile, event);
    assert.equal(event.defaultPrevented, true);
  }
  ui.showLibraryContextMenu(new w.MouseEvent('contextmenu'), 'one');
  [...document.querySelectorAll('#ppAssetContextMenu button')].find(button => button.textContent === 'Edit Asset').click();
  const placementButton = tile.querySelector('.media-placement-secondary');
  assert.equal(placementButton.textContent, 'Page placement');
  w.Function('event', placementButton.getAttribute('onclick')).call(placementButton, new w.MouseEvent('click'));
  assert.deepEqual(calls, [
    ['shared', 'one'], ['shared', 'one'], ['shared', 'one'], ['shared', 'one'], ['placement', 'one'],
  ]);
});

test('page media reports resolved selections without exposing legacy lists or replacing unchanged rows', async t => {
  const { w, ui, document } = fixture(t);
  const container = document.createElement('div');
  container.id = 'ppPageHeroesContent';
  document.body.appendChild(container);
  w.H2SPageHeroes = {
    ...require('../../frontend/media-page-heroes.js'),
    read: async surface => ({ mode: surface === 'bundles' ? 'automatic' : 'override',
      asset: asset(surface, surface === 'bundles' ? {} : { media_placement: { enabled: true } }) }),
  };
  w.H2SMediaPlacements = { style: () => '' };
  await ui.refreshLivePreview();
  assert.equal(container.querySelectorAll('[data-page-hero]').length, 4);
  assert.match(container.textContent, /Bundles \/ Hero background.*Automatic selection/s);
  assert.match(container.textContent, /Commercial \/ Hero photo.*Chosen for this area/s);
  assert.doesNotMatch(container.textContent, /Historical|\bLIVE\b|retained|asset_id/);
  const original = container.firstElementChild;
  await ui.refreshLivePreview();
  assert.equal(container.firstElementChild, original);
  const focused = original.querySelector('button');
  focused.focus();
  w.H2SPageHeroes.read = async surface => ({
    mode: surface === 'bundles' ? 'automatic' : 'override',
    asset: asset(surface, surface === 'bundles' ? {} : { media_placement: { enabled: true } }),
    areas: { commercial_security_rail: [asset('new-rail-item')] },
  });
  await ui.refreshLivePreview();
  assert.equal(container.firstElementChild, original);
  assert.equal(document.activeElement, focused);
});

test('quiet gallery use cues update in place without changing selection, focus, drafts or scroll', t => {
  const { w, ui, document } = fixture(t);
  w.H2SPageHeroes = require('../../frontend/media-page-heroes.js');
  const tile = document.querySelector('[data-asset-id="one"]'), focused = tile.querySelector('button');
  focused.focus();
  const draft = { zoom: 1.4 };
  ui.state.edit = draft;
  ui.state.pageHeroes = { bundles: { mode: 'automatic', asset: asset('one') } };
  ui.syncPageMediaUsage();
  assert.equal(tile.querySelector('.pp-media-usage').textContent, 'In use');
  assert.equal(tile.title, "Selected on Bundles / Hero background by this frontend's rules, not confirmed deployed rendering. Hero selection can change if media fails to load.");
  assert.equal(tile.getAttribute('aria-description'), tile.title);
  assert.equal(document.querySelector('[data-asset-id="one"]'), tile);
  assert.equal(document.activeElement, focused);
  assert.equal(ui.state.selectedIds.has('one'), true);
  assert.equal(ui.state.edit, draft);
  assert.equal(w.scrollY, 450);
  ui.state.pageHeroes.bundles.mode = 'unavailable';
  ui.syncPageMediaUsage();
  assert.equal(tile.querySelector('.pp-media-usage'), null);
  assert.equal(tile.hasAttribute('aria-description'), false);
  assert.equal(document.activeElement, focused);
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
  assert.match(details.textContent, /Commercial \/ Hero photo.*No placement saved/s);
  menu.querySelector('[data-hero-surface="commercial_intake"]').click();
  assert.equal(selected[0], 'one');
  assert.equal(selected[1].surface, 'commercial_intake');
  assert.equal(selected[1].area, 'commercial_hero');
  assert.equal(reads.length, 1);
  assert.equal(reads[0].options.method, undefined);
});
