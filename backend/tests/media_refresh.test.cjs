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
  w.matchMedia = () => ({ matches: false });
  w.console.error = () => {};
  let scroll = 450;
  Object.defineProperty(w, 'scrollY', { get: () => scroll });
  w.scrollTo = options => { scroll = options.top; };
  const ui = w.eval(`(${proofSource})`);
  w.proofPacks = ui;
  ui.state = { assets: { items: [asset('one'), asset('two')], renderLimit: 30 }, selectedIds: new Set(['one']),
    liveAssetIds: new Set(['one']), assetUsageCounts: new Map([['one', 1]]) };
  ui.getConfig = () => ({ base: '' });
  ui.ensureSupabaseConfig = async () => {};
  ui.safeReadJson = () => null;
  ui.safeWriteJson = () => {};
  ui.publicStorageUrl = (_bucket, key) => '/' + key;
  ui.setupLibraryInfiniteScroll = () => {};
  const readJson = ui.fetchJson.bind(ui);
  ui.fetchJson = async url => url.includes('proof-packs') ? { ok: true, packs: [{ pack_id: 'pack' }] }
    : { ok: true, assets: [asset('one'), asset('two')] };
  ui.setAssetsUi(ui.state.assets);
  return { w, ui, readJson, document: w.document };
}

async function destinationFixture(t) {
  const e = fixture(t), { ui, w, document } = e;
  w.H2SPageHeroes = require('../../frontend/media-page-heroes.js');
  w.H2SMediaPlacements = { style: () => '' };
  w.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'residential-media.js'), 'utf8'));
  w.getDashboardSessionToken = () => 'fixture-only';
  document.body.insertAdjacentHTML('beforeend', '<div id="ppPageMediaPages"></div><div id="ppPageMediaAreas"></div><div id="ppPageHeroesContent"></div><p id="ppPageMediaStatus"></p><div id="ppPlacementSelection" hidden></div><button data-filter="live:yes"></button><button data-filter="live:no"></button>');
  const camera = { ...asset('two'), media_url: '/camera.jpg', original_filename: 'Camera installation' };
  const hero = { ...asset('one'), media_url: '/hero.jpg', original_filename: 'Chosen hero', media_placement: { enabled: true } };
  const eligible = { ...asset('eligible'), media_url: '/eligible.jpg' };
  const sections = { commercial_hero: { items: [hero, eligible] },
    commercial_security_rail: { items: [camera] }, commercial_display_rail: { items: [] } };
  e.reads = [];
  ui.fetchJson = async url => {
    e.reads.push(url);
    return url.includes('surface=residential') ? {ok:true,surface:'residential',sections:{
      residential_tv_proof:{items:[hero]},residential_camera_proof:{items:[camera]}}}
      : url.includes('proof-slots') ? { ok: true, hero_media: [], hero_exclusions: [
      { asset_source: 'proof_asset', asset_id: w.H2SPageHeroes.bundlesFallbackAssetId },
    ], slots: { hero: { tv_mounting: [eligible] } } }
      : { ok: true, sections };
  };
  ui.state.assets.items.push(eligible);
  ui.setAssetsUi(ui.state.assets);
  await ui.refreshLivePreview();
  return { ...e, sections, camera, hero, eligible };
}

test('page and area choices show one placement, retain state across refresh and cancel stale chooser scope without writes', async t => {
  const {ui,document,sections} = await destinationFixture(t);
  const visible = () => [...document.querySelectorAll('[data-page-media-key]')].filter(panel => !panel.hidden);
  assert.equal(visible().length,1);
  assert.equal(visible()[0].dataset.pageArea,'residential_tv_proof');
  const pages = document.getElementById('ppPageMediaPages');
  assert.equal(pages.querySelectorAll('button').length,3);
  document.querySelector('[data-media-area-choice="residential_camera_proof"]').click();
  assert.equal(visible()[0].dataset.pageArea,'residential_camera_proof');
  document.querySelector('[data-media-page-choice="commercial_intake"]').click();
  assert.equal(visible()[0].dataset.pageArea,'commercial_hero');
  assert.equal(document.querySelectorAll('[data-media-area-choice]').length,3);
  const camera = document.querySelector('[data-media-area-choice="commercial_security_rail"]');
  camera.focus(); camera.click();
  const node = visible()[0];
  await ui.refreshLivePreview();
  assert.equal(visible()[0],node);
  assert.equal(document.activeElement,camera);
  assert.equal(camera.getAttribute('aria-pressed'),'true');
  sections.commercial_security_rail.items[0] = {...sections.commercial_security_rail.items[0],original_filename:'Updated selected camera'};
  await ui.refreshLivePreview();
  assert.equal(visible()[0].dataset.pageArea,'commercial_security_rail');
  assert.match(visible()[0].textContent,/Updated selected camera/);
  document.querySelector('[data-media-page-choice="bundles"]').click();
  assert.equal(visible()[0].dataset.pageHero,'bundles');
  assert.equal(document.getElementById('ppPageMediaAreas').hidden,true);
  ui.state.placementTarget = {surface:'bundles',area:'hero'};
  document.querySelector('[data-media-page-choice="residential"]').click();
  assert.equal(ui.state.placementTarget,null);
  assert.equal(visible()[0].dataset.pageArea,'residential_camera_proof');
  assert.equal(document.querySelectorAll('[data-page-media-key]').length,6,'Hidden destinations retain their existing placement connections');
});

test('page and area switching is always visible, not a responsive disclosure', () => {
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dash.html'), 'utf8'));
  try {
    const root = dom.window.document.getElementById('ppPageMediaDetails');
    assert.equal(root.tagName,'SECTION');
    assert.equal(root.querySelector('details'),null);
    for (const id of ['ppInspectSavedMedia','ppPageMediaInventoryStatus','ppPageMediaContext']) {
      assert.equal(root.querySelector('#'+id),null);
    }
    for (const id of ['ppPageMediaPages','ppPageMediaAreas','ppPageHeroesContent']) {
      assert.equal(root.querySelector('#'+id).closest('details'),null);
    }
    assert.equal(source.includes('bindPageMediaDisclosure'),false);
  } finally { dom.window.close(); }
});

test('canonical mobile markup keeps upload content shrinkable and contains no fixture footer', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dash.html'), 'utf8');
  const dom = new JSDOM(html);
  try {
    const doc = dom.window.document;
    assert.ok(doc.querySelector('#ppDropzone .pp-dropzone-copy'));
    assert.equal(doc.getElementById('ppDropzone').getAttribute('role'), 'group');
    assert.equal(doc.getElementById('ppChooseUpload').type, 'button');
    assert.equal(doc.getElementById('ppOpenMediaGallery').classList.contains('btn'), false);
    assert.equal(doc.querySelector('#ppDropzone .pp-dropzone-copy').style.minWidth, '');
    assert.ok(doc.querySelector('#ppDropzonePrompt > .pp-dropzone-hint'), 'optimization hint must center across the whole prompt, not the indented text column');
    assert.ok(doc.querySelector('.pp-assets-summary #ppAssetsCount'));
    assert.ok(doc.querySelector('#ppMediaGallery #ppAssetsGrid'));
    assert.ok(doc.querySelector('#proofpacks-pane #ppMediaGallery'));
    assert.ok(doc.querySelector('#ppMediaGallery #ppLibraryFilters'));
    assert.ok(doc.querySelector('#ppGalleryFilterPanel #ppFilterChips'));
    assert.ok(doc.querySelector('#ppGalleryFilterPanel .pp-controls-row'));
    assert.equal(doc.querySelector('#ppMediaGallery #ppLibraryEditor'), null, 'reuse the existing editor outside the gallery surface');
    assert.ok(doc.querySelector('#ppPageMediaDetails > header'));
    assert.ok(doc.querySelector('#ppPageMediaDetails #ppPageHeroesContent'));
    assert.doesNotMatch(html, /Local fixtures only|data-fixture-notice|Local preview.*test data/);
  } finally { dom.window.close(); }
});

test('Your Assets has explicit section spacing without changing its inner padding', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dash.css'), 'utf8');
  const rule = css.match(/^\s*\.pp-assets-summary\s*\{[^}]+\}/m);
  assert.ok(rule);
  const dom = new JSDOM('<style>' + rule[0] + '</style><div class="pp-assets-summary"></div>');
  try {
    const style = dom.window.getComputedStyle(dom.window.document.querySelector('.pp-assets-summary'));
    assert.equal(style.marginTop, '16px');
    assert.equal(style.paddingTop, '24px');
    assert.equal(style.paddingBottom, '24px');
  } finally { dom.window.close(); }
});

test('desktop library sections share 16px spacing for filters, batch actions and both gallery views', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dash.css'), 'utf8');
  const rule = css.match(/@media \(min-width: 821px\) \{\s*(#proofpacks-pane #ppLibraryFilters,[^}]+\})\s*\}/);
  assert.ok(rule, 'desktop section spacing must not override the mobile gallery layout');
  const ids = ['ppLibraryFilters', 'ppBatchToolbar', 'ppAssetsList', 'ppAssetsGrid'];
  const dom = new JSDOM('<style>' + rule[1] + '</style><div id="proofpacks-pane">' +
    ids.map(id => `<div id="${id}"></div>`).join('') + '</div>');
  try {
    for (const id of ids) {
      assert.equal(dom.window.getComputedStyle(dom.window.document.getElementById(id)).marginTop, '16px', id);
    }
  } finally { dom.window.close(); }
});

test('media sort control is compact for native and enhanced selects with an accessible label', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dash.css'), 'utf8');
  const rules = [
    css.match(/#ppLibraryFilters \.pp-controls-row > \.pp-select-custom,[^}]+\}/)[0],
    css.match(/\.pp-controls-row\s*\{[^}]+\}/)[0],
    css.match(/\.pp-view-group\s*\{[^}]+\}/)[0],
    css.match(/\.pp-asset-count-label\s*\{[^}]+\}/)[0],
  ].join('\n');
  const dom = new JSDOM(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dash.html'), 'utf8'));
  try {
    const doc = dom.window.document;
    doc.head.innerHTML = '<style>' + rules + '</style>';
    const select = doc.querySelector('#ppLibraryFilters .pp-select-custom');
    assert.equal(select.getAttribute('aria-label'), 'Sort media by date');
    const shell = doc.createElement('div');
    shell.className = 'dashboard-custom-select-shell';
    select.after(shell);
    for (const control of [select, shell]) {
      const style = dom.window.getComputedStyle(control);
      assert.equal(style.width, '160px');
      assert.equal(style.maxWidth, '160px');
    }
    assert.equal(dom.window.getComputedStyle(select.parentElement).gap, '16px');
    assert.equal(dom.window.getComputedStyle(doc.getElementById('ppFilterCount')).whiteSpace, 'nowrap');
    assert.equal(dom.window.getComputedStyle(doc.querySelector('.pp-view-group')).gap, '16px');
  } finally { dom.window.close(); }
});

test('media workspace uses the upload optimizer without manual ID tools or duplicate optimization actions', t => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'dash.html'), 'utf8');
  const dom = new JSDOM(html);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  assert.equal(doc.getElementById('ppQuickAssetInput'), null);
  assert.doesNotMatch(html, /Advanced media tools|Quick Asset Tools|quickOptimizeAsset|quickOpenAsset/);
  assert.equal(doc.getElementById('ppOptimizeImages').checked, true);
  assert.ok(doc.getElementById('ppChooseUpload'));
  const { document } = fixture(t);
  const bar = document.getElementById('ppBulkActionsBar');
  assert.doesNotMatch(bar.textContent, /Optimize/);
  assert.ok(bar.querySelector('[onclick="proofPacks.bulkSetLive()"]'));
  assert.ok(bar.querySelector('[onclick="proofPacks.bulkDelete()"]'));
});

test('mobile gallery preserves search, scroll, focus and filter choices across close/reopen and returns desktop inline', t => {
  const { ui, w, document } = fixture(t);
  let mobile = true, locks = 0;
  w.matchMedia = () => ({ matches: mobile });
  w.lockBodyScroll = () => { locks++; };
  w.unlockBodyScroll = () => { locks--; };
  document.body.insertAdjacentHTML('beforeend', `
    <button id="ppOpenMediaGallery">Open gallery <span id="ppMediaGalleryCount"></span></button>
    <div id="ppLibraryEditor" class="is-hidden"></div>
    <div id="ppMediaGallery">
      <header><button id="ppCloseMediaGallery">Close</button></header>
      <div id="ppLibraryFilters">
        <input id="gallerySearch" value="mount">
        <button id="ppOpenGalleryFilters">Filters</button>
        <div id="ppGalleryFilterPanel"><button>Done</button></div>
      </div>
      <div><button class="pp-view-btn active" data-view="list">List</button><button class="pp-view-btn" data-view="grid">Grid</button></div>
    </div>`);
  ui.libraryFilters = { search: 'mount', media: 'photo', service: null };
  const modes = [];
  ui.setViewMode = mode => modes.push(mode);
  ui.bindMobileGallery();
  const gallery = document.getElementById('ppMediaGallery');
  const launch = document.getElementById('ppOpenMediaGallery');
  assert.equal(gallery.inert, true);
  launch.focus();
  ui.openMobileGallery();
  assert.equal(locks, 1);
  assert.equal(gallery.getAttribute('role'), 'dialog');
  assert.equal(gallery.inert, false);
  assert.equal(document.activeElement.id, 'ppCloseMediaGallery');
  assert.equal(document.getElementById('ppOpenGalleryFilters').textContent, 'Filters (1)');
  document.body.insertAdjacentHTML('beforeend', '<dialog open id="existingPlacementChoice"></dialog>');
  document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(gallery.classList.contains('is-open'), true, 'the existing destination dialog must own Escape');
  document.getElementById('existingPlacementChoice').remove();
  ui.setMobileGalleryFilters(true);
  assert.equal(gallery.classList.contains('is-filtering'), true);
  assert.equal(document.getElementById('gallerySearch').inert, true);
  document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(gallery.classList.contains('is-filtering'), false);
  assert.equal(gallery.classList.contains('is-open'), true);
  gallery.scrollTop = 320;
  ui.closeMobileGallery();
  assert.equal(locks, 0);
  assert.equal(document.activeElement, launch);
  ui.openMobileGallery();
  assert.equal(gallery.scrollTop, 320);
  assert.equal(document.getElementById('gallerySearch').value, 'mount');
  assert.equal(ui.libraryFilters.media, 'photo');
  mobile = false;
  w.dispatchEvent(new w.Event('resize'));
  assert.equal(locks, 0);
  assert.equal(gallery.inert, false);
  assert.equal(gallery.hasAttribute('aria-hidden'), false);
  assert.equal(gallery.hasAttribute('role'), false);
  assert.deepEqual(modes, ['grid', 'grid', 'list']);
});

test('grid placement actions use dedicated compact controls and preserve the asset target', t => {
  const { ui, document } = fixture(t);
  document.body.insertAdjacentHTML('beforeend', '<div id="ppAssetsGrid"></div>');
  ui.state.assets.items[0].psychological_weight = 50;
  ui.state.assets.items[1].media_kind = 'video';
  ui.renderGridView();
  const actions = [...document.querySelectorAll('#ppAssetsGrid .pp-placement-action')];
  assert.equal(actions.length, 2);
  for (const action of actions) {
    const id = action.closest('[data-asset-id]').dataset.assetId;
    assert.equal(action.textContent, 'Use on page');
    assert.equal(action.classList.contains('btn-tonal'), false);
    assert.match(action.getAttribute('aria-label'), /Use on page for /);
    assert.ok(action.getAttribute('onclick').includes(`openPagePlacement('${id}')`));
    assert.match(action.getAttribute('onclick'), /event\.stopPropagation/);
  }
  const downloads = [...document.querySelectorAll('#ppAssetsGrid .pp-download-action')];
  assert.equal(downloads.length,2);
  for (const action of downloads) {
    const id = action.closest('[data-asset-id]').dataset.assetId;
    assert.equal(action.textContent,'Download');
    assert.match(action.getAttribute('aria-label'),/Download original/);
    assert.ok(action.getAttribute('onclick').includes(`downloadOriginalAsset('${id}')`));
  }
  assert.equal(document.querySelectorAll('#ppAssetsGrid .pp-featured-star').length, 0);
  assert.equal(ui.state.assets.items[0].psychological_weight, 50, 'removing the unexplained star must not change saved priority');
  assert.equal(document.querySelectorAll('#ppAssetsGrid .pp-grid-open').length, 2);
  assert.equal(document.querySelectorAll('#ppAssetsGrid button button').length, 0);
  assert.match(document.querySelector('#ppAssetsGrid .pp-grid-open').getAttribute('onclick'), /beginEditAssetMedia/);
  assert.ok(document.querySelector('#ppAssetsGrid .pp-grid-kind'));
  ui.state.placementTarget = { surface: 'bundles', area: 'hero' };
  ui.renderGridView();
  assert.equal(document.querySelector('#ppAssetsGrid .pp-placement-action').textContent, 'Use here');
  assert.match(document.querySelector('#ppAssetsGrid .pp-grid-open').getAttribute('onclick'), /openPagePlacement/);
  document.querySelectorAll('.pp-library-item').forEach(item => { item.dataset.matchesFilters = '0'; });
  ui.renderGridView();
  assert.equal(document.querySelectorAll('#ppAssetsGrid .pp-grid-item').length, 0);
  assert.match(document.querySelector('#ppAssetsGrid [role="status"]').textContent, /No media matches/);
});

test('library download saves the original blob with its recorded filename and falls back to opening it', async t => {
  const { ui, w, document } = fixture(t);
  const asset=ui.state.assets.items[0];
  asset.original_filename='Fixture original.webp';
  asset.storage_bucket='proof';
  asset.storage_path='uploads/fixture.webp';
  ui.publicStorageUrl=(_bucket,storagePath)=>`https://fixture.invalid/api/proof-asset-media?path=${encodeURIComponent(storagePath)}`;
  const clicked=[];
  w.HTMLAnchorElement.prototype.click=function(){clicked.push({href:this.href,download:this.download});};
  w.URL.createObjectURL=blob=>{assert.equal(blob.type,'image/webp');return 'blob:fixture-download';};
  w.URL.revokeObjectURL=()=>{};
  w.showToast=()=>{};
  let opened='';
  w.open=url=>{opened=String(url);};
  w.fetch=async url=>{
    assert.match(String(url),/proof-asset-media/);
    return {ok:true,blob:async()=>new w.Blob(['fixture'],{type:'image/webp'})};
  };
  assert.equal(await ui.downloadOriginalAsset(asset.asset_id),true);
  assert.deepEqual(clicked,[{href:'blob:fixture-download',download:'Fixture original.webp'}]);
  w.fetch=async()=>{throw new Error('Fixture blocked');};
  assert.equal(await ui.downloadOriginalAsset(asset.asset_id),false);
  assert.match(opened,/proof-asset-media/);
  assert.equal(document.querySelectorAll('a').length,0);
});

test('mobile Choose media opens the contextual replacement popup, never the general gallery', async t => {
  const { ui, w, document } = await destinationFixture(t);
  w.matchMedia = () => ({ matches: true });
  let opened = 0, selected, picker;
  ui.openMobileGallery = () => { opened++; };
  ui.beginPlacementEdit = options => { selected = options; };
  w.H2SMediaPlacements.chooseReplacement = options => { picker = options; };
  ui.choosePageHero('bundles', 'hero');
  assert.equal(opened, 0);
  assert.equal(document.getElementById('ppPlacementSelection').hidden, true, 'do not send phone users to an external notice');
  assert.match(picker.title, /Bundles.*Hero background/);
  picker.onSelect(picker.assets.find(item => item.asset_id === 'one'));
  assert.equal(selected.initialPlacement.surface, 'bundles');
  assert.equal(selected.initialPlacement.area, 'hero');
  assert.equal(selected.replacement, null, 'this fixture has no current Bundles image');
  assert.equal(ui.state.placementTarget, null);
});
test('page media omits diagnostic dropdowns and inspection requests without disturbing edits or replacement controls', async t => {
  const { ui, document, reads } = await destinationFixture(t);
  assert.equal(document.querySelector('[data-page-area="commercial_security_rail"] a').href, 'http://localhost/commercial.html#cameraProofRail');
  const draft = { focal_x: 22, zoom: 1.4 };
  ui.state.edit = draft;
  const focus = document.getElementById('search');
  focus.focus();
  await ui.refreshLivePreview();
  assert.equal(document.querySelector('[data-media-inventory]'), null);
  assert.doesNotMatch(document.getElementById('ppPageHeroesContent').textContent, /Other loaded media|saved inclusion, exclusions and eligibility/);
  assert.equal(reads.some(url => url.includes('/api/admin/media-placements')), false);
  assert.equal(typeof ui.loadPageMediaInventory, 'undefined');
  assert.ok(document.querySelector('[data-media-replace="residential"]'));
  assert.ok(document.querySelector('[data-hero-edit="residential"]'));
  assert.equal(ui.state.edit, draft);
  assert.equal(document.activeElement, focus);
  assert.equal(ui.state.selectedIds.has('one'), true);
});

test('destination inspection and usage filters use public selections rather than legacy eligibility or hero alternatives', async t => {
  const { ui, document, reads } = await destinationFixture(t);
  assert.equal(document.querySelectorAll('[data-page-area]').length, 6);
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
  assert.equal(document.querySelectorAll('[data-media-replace]').length, 5, 'all selected images, but not empty areas or load-error alternatives, offer replacement');
});

for (const [area, service] of [['residential_tv_proof', 'tv_mounting'], ['residential_camera_proof', 'cameras']]) {
  for (const mobile of [false, true]) {
    test(`${area} ${mobile ? 'mobile' : 'desktop'} replacement shows only eligible photos and retains its exact scope`, async t => {
      const { w, ui, document } = await destinationFixture(t);
      const candidate = asset('replacement', { service, media_url: '/replacement.jpg' });
      ui.state.assets.items.push(candidate,
        asset('wrong-service', { service: service === 'cameras' ? 'tv_mounting' : 'cameras' }),
        asset('hidden', { service, is_visible: false }), asset('video', { service, media_kind: 'video' }));
      w.matchMedia = () => ({ matches: mobile });
      w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      w.HTMLDialogElement.prototype.close = function () { this.open = false; };
      for (const file of ['media-placement-style.js', 'media-placements.js']) {
        w.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', file), 'utf8'));
      }
      let galleryOpens = 0, scrolls = 0;
      ui.openMobileGallery = () => { galleryOpens++; };
      w.HTMLElement.prototype.scrollIntoView = () => { scrolls++; };
      const edits = [];
      ui.beginPlacementEdit = options => edits.push(options);
      const original = ui.state.pageHeroes.residential.areas[area][0].asset_id;
      document.querySelector(`[data-page-area="${area}"] [data-hero-choose]`).click();
      const dialog = document.querySelector('.media-replacement-picker');
      assert.ok(dialog.open);
      assert.match(dialog.textContent, /Residential.*installation proof/);
      assert.equal(dialog.querySelector('[data-kind="video"]'), null);
      for (const id of ['wrong-service', 'hidden', 'video']) assert.equal(dialog.querySelector(`[data-asset-id="${id}"]`), null);
      assert.equal(galleryOpens, 0);
      assert.equal(scrolls, 0);
      assert.equal(edits.length, 0);
      assert.equal(ui.state.pageHeroes.residential.areas[area][0].asset_id, original);
      dialog.querySelector('[data-asset-id="replacement"]').click();
      assert.equal(document.querySelector('dialog'), null);
      assert.equal(edits.length, 1);
      assert.equal(edits[0].initialPlacement.surface, 'residential');
      assert.equal(edits[0].initialPlacement.area, area);
      assert.equal(edits[0].replacement.asset_id, original);
      assert.equal(edits[0].asset.asset_id, 'replacement');
    });
  }
}

test('an empty area opens a scoped picker without inventing a replacement', async t => {
  const { w, ui } = await destinationFixture(t);
  let picker, edit;
  w.H2SMediaPlacements.chooseReplacement = options => { picker = options; };
  ui.beginPlacementEdit = options => { edit = options; };
  ui.choosePageHero('commercial_intake', 'commercial_display_rail');
  assert.equal(picker.current, null);
  picker.onSelect(picker.assets.find(item => item.asset_id === 'eligible'));
  assert.equal(edit.replacement, null);
  assert.equal(edit.initialPlacement.area, 'commercial_display_rail');
});

test('a replacement candidate hidden while the popup is open cannot proceed to framing', async t => {
  const { w, ui } = await destinationFixture(t);
  let picker, opened = 0;
  const messages = [];
  w.showToast = message => messages.push(message);
  w.H2SMediaPlacements.chooseReplacement = options => { picker = options; };
  ui.beginPlacementEdit = () => { opened++; };
  ui.choosePageHero('residential', 'residential_tv_proof');
  const candidate = picker.assets.find(item => item.asset_id === 'eligible');
  ui.state.assets.items.find(item => item.asset_id === candidate.asset_id).is_visible = false;
  picker.onSelect(candidate);
  assert.equal(opened, 0);
  assert.match(messages[0], /area changed/);
});

test('every destination opens exact existing placement controls without saving and rail-only updates repaint', async t => {
  const { w, ui, document, sections } = await destinationFixture(t);
  const edits = [];
  let picker;
  w.H2SMediaPlacements.chooseReplacement = options => { picker = options; };
  ui.beginPlacementEdit = options => edits.push(options);
  document.querySelector('[data-page-area="commercial_security_rail"] [data-hero-edit]').click();
  assert.deepEqual(JSON.parse(JSON.stringify(edits[0].initialPlacement)),
    { surface: 'commercial_intake', area: 'commercial_security_rail' });
  assert.equal(edits[0].asset.asset_id, 'two');
  const notice = document.getElementById('ppPlacementSelection');
  notice.scrollIntoView = () => {};
  document.querySelector('[data-hero-choose][data-media-area="commercial_display_rail"]').click();
  assert.match(picker.title, /Display and TV rail/);
  assert.equal(notice.hidden, true);
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

test('selected video previews use saved posters without decoding MOV files and edit the original video', async t => {
  const { w, ui, document, sections } = await destinationFixture(t);
  const video = { ...asset('selected-video'), media_kind: 'video', media_url: '/original.mov',
    video_thumbnail_url: '/saved-thumbnail.jpg', media_placement: { enabled: true } };
  sections.commercial_security_rail.items = [video];
  await ui.refreshLivePreview();
  const row = () => document.querySelector('[data-page-area="commercial_security_rail"]');
  assert.equal(row().querySelector('video'), null);
  assert.equal(row().querySelector('img').getAttribute('src'), '/saved-thumbnail.jpg');
  const edits = [];
  ui.beginPlacementEdit = options => edits.push(options);
  row().querySelector('[data-hero-edit]').click();
  assert.equal(edits[0].url, '/original.mov');
  assert.equal(edits[0].asset.media_kind, 'video');
  assert.equal(edits[0].initialPlacement.area, 'commercial_security_rail');
  assert.ok(row().querySelector('[data-media-replace]'));
  const image = row().querySelector('img');
  image.dispatchEvent(new w.Event('error'));
  assert.equal(image.hidden, true);
  assert.equal(row().querySelector('[data-thumbnail-error]').hidden, false);
  row().querySelector('[data-preview-retry]').click();
  assert.equal(image.hidden, false);
  assert.match(image.src, /saved-thumbnail\.jpg/);
  assert.equal(row().querySelector('[data-thumbnail-error]').hidden, true);
});

test('video preview can use a loaded library poster and retains video preview when no poster exists', async t => {
  const { ui, document, sections } = await destinationFixture(t);
  const video = { ...asset('library-video'), media_kind: 'video', media_url: '/original.mp4' };
  sections.commercial_security_rail.items = [video];
  ui.state.assets.items.push({ ...video, video_thumbnail_url: '/library-thumbnail.jpg' });
  await ui.refreshLivePreview();
  const row = () => document.querySelector('[data-page-area="commercial_security_rail"]');
  assert.equal(row().querySelector('video'), null);
  assert.equal(row().querySelector('img').getAttribute('src'), '/library-thumbnail.jpg');
  sections.commercial_security_rail.items = [{ ...video, asset_id: 'no-poster' }];
  await ui.refreshLivePreview();
  assert.equal(row().querySelector('img'), null);
  assert.equal(row().querySelector('video').getAttribute('src'), '/original.mp4');
  assert.equal(row().querySelector('video').getAttribute('preload'), 'metadata');
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
  const fetchJson = ui.fetchJson;
  const pending = new Promise(resolve => { release = resolve; });
  ui.fetchJson = async (...args) => { await pending; return fetchJson(...args); };
  const first = ui.refreshAssets();
  const second = ui.refreshAssets();
  assert.equal(first, second);
  assert.equal(document.querySelector('[data-asset-id="one"]'), original);
  assert.equal(document.querySelector('.gallery-loading'), null);
  await new Promise(resolve => setImmediate(resolve));
  release();
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

test('the media gallery finishes without waiting for page-preview requests', async t => {
  const { ui, document } = fixture(t);
  ui.fetchLiveAssetIds = () => { throw new Error('Gallery must not wait for destination previews'); };
  await ui.refreshAssets();
  assert.equal(ui.state.assets.refreshing, false);
  assert.equal(ui.state.assets.error, '');
  assert.equal(document.querySelector('[data-asset-id="one"]').dataset.assetId, 'one');
});

test('a slow first load becomes a visible timeout, never a successful empty library, and Retry recovers', async t => {
  const { ui, w, document } = fixture(t);
  ui.state.assets = { items: [], renderLimit: 30 };
  const timers = new Map(), originalTimeout = w.setTimeout, originalClear = w.clearTimeout;
  w.setTimeout = (fn, delay) => { timers.set(delay, fn); return delay; };
  w.clearTimeout = id => timers.delete(id);
  t.after(() => { w.setTimeout = originalTimeout; w.clearTimeout = originalClear; });
  const loadPacks = ui.ensureLibraryPacksLoaded.bind(ui);
  ui.ensureLibraryPacksLoaded = (_surface, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new w.DOMException('Aborted', 'AbortError')), { once: true });
  });
  const pending = ui.refreshAssets();
  assert.equal(document.getElementById('ppAssetsList').getAttribute('aria-busy'), 'true');
  timers.get(5000)();
  assert.match(document.querySelector('[data-library-status]').textContent, /Still loading media/);
  timers.get(20000)();
  await pending;
  assert.match(document.querySelector('[data-library-status]').textContent, /timed out/);
  assert.match(document.getElementById('ppAssetsList').textContent, /Media library unavailable/);
  assert.doesNotMatch(document.getElementById('ppAssetsList').textContent, /No assets found/);
  assert.equal(document.getElementById('ppAssetsList').getAttribute('aria-busy'), 'false');
  assert.equal(document.querySelector('[data-library-retry]').hidden, false);
  assert.equal(timers.size, 0);
  ui.ensureLibraryPacksLoaded = loadPacks;
  await ui.refreshAssets();
  assert.equal(ui.state.assets.items.length, 2);
  assert.equal(document.querySelector('[data-library-retry]').hidden, true);
});

test('media reads time out through response-body loading, propagate cancellation, and leave writes untouched', async t => {
  const { w, readJson } = fixture(t);
  w.Headers = Headers;
  w.AbortController = AbortController;
  const timers = new Map(), originalTimeout = w.setTimeout, originalClear = w.clearTimeout;
  w.setTimeout = (fn, delay) => { timers.set(delay, fn); return delay; };
  w.clearTimeout = id => timers.delete(id);
  t.after(() => { w.setTimeout = originalTimeout; w.clearTimeout = originalClear; });
  w.fetch = async (_url, { signal }) => ({
    ok: true, headers: new Headers({ 'Content-Type': 'application/json' }),
    json: () => new Promise((_resolve, reject) => {
      if (signal.aborted) reject(new Error('aborted'));
      else signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  const stalled = readJson('/api/admin/proof-packs');
  const timeoutError = assert.rejects(stalled, /Media request timed out/);
  await Promise.resolve();
  timers.get(15000)();
  await timeoutError;
  assert.equal(timers.size, 0);
  const parent = new AbortController();
  const cancelled = readJson('/api/admin/proof-packs', { signal: parent.signal });
  const cancelError = assert.rejects(cancelled, /aborted/);
  await Promise.resolve();
  parent.abort();
  await cancelError;
  assert.equal(timers.size, 0);
  w.fetch = async (_url, options) => {
    assert.equal(options.signal, undefined);
    assert.equal(timers.size, 0, 'write requests must not inherit automatic read retry semantics');
    return Response.json({ ok: true });
  };
  assert.equal((await readJson('/api/admin/proof-assets', { method: 'PATCH' })).ok, true);
  w.fetch = async () => new Response('<html>Wrong server</html>', { status: 404 });
  await assert.rejects(readJson('/api/admin/proof-packs'), error =>
    error.status === 404 && /unexpected response/.test(error.message) && !error.message.includes('<html>'));
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
  assert.equal(placementButton.textContent, 'Use on page');
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
  assert.equal(container.querySelectorAll('[data-page-hero]').length, 6);
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
