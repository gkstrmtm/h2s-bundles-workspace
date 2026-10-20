const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..', '..');
const helperPath = path.join(root, 'frontend', 'media-placements.js');
const { style } = require(helperPath);

function loadTs(relativePath, imports) {
  const filename = path.join(root, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, console, URL,
    require: (name) => {
      if (name === './mediaPlacementCatalog.json') return require('../lib/mediaPlacementCatalog.json');
      assert.ok(name in imports, `Unexpected dependency: ${name}`);
      return imports[name];
    },
  }, { filename });
  return module.exports;
}

const library = loadTs('backend\\lib\\mediaPlacements.ts', {
  '@/lib/supabase': { getSupabase: () => { throw new Error('No database in pure tests'); } },
  '@/lib/ownerMediaDb': { OWNER_MEDIA_DB_BUCKET: 'owner-media-db' },
});
const assetId = '11111111-1111-4111-8111-111111111111';
const placement = (patch = {}) => ({
  asset_source: 'proof_asset', asset_id: assetId, surface: 'bundles', area: 'mid_proof_rail',
  enabled: true, display_order: 10, fit: 'cover', focal_x: 20, focal_y: 80, zoom: 1.5,
  ...patch,
});

test('placement validation accepts only valid page/area pairs and bounded numeric framing', () => {
  assert.equal(library.parseMediaPlacement(placement()).area, 'mid_proof_rail');
  assert.throws(() => library.parseMediaPlacement(placement({ surface: 'commercial_intake' })), /display area/);
  assert.throws(() => library.parseMediaPlacement(placement({ focal_x: 101 })), /focal_x/);
  assert.throws(() => library.parseMediaPlacement(placement({ zoom: 0.9 })), /zoom/);
  assert.throws(() => library.parseMediaPlacement(placement({ display_order: 1.5 })), /display_order/);
  assert.throws(() => library.parseMediaPlacement(placement({ enabled: 'true' })), /Visibility/);
  assert.throws(() => library.parseMediaPlacement(placement({ asset_id: 'not-a-uuid' })), /UUID/);
  assert.throws(() => library.parseMediaPlacement(placement({ asset_source: 'bad' })), /source/);
});

test('same photo has independent settings by area without mutating shared crop metadata', () => {
  const photo = { asset_id: assetId, source: 'proof_asset', service: 'tv_mounting', smart_crop_details: { mode: 'contain' } };
  const rail = placement();
  const cart = placement({ area: 'pre_cta', fit: 'contain', focal_x: 80, zoom: 1 });
  const rows = [rail, cart];
  const first = library.mergeMediaPlacements([photo], [], rows, 'mid_proof_rail', 5);
  const second = library.mergeMediaPlacements([photo], [], rows, 'pre_cta', 5);
  assert.equal(first[0].media_placement.focal_x, 20);
  assert.equal(second[0].media_placement.focal_x, 80);
  assert.equal(second[0].media_placement.fit, 'contain');
  assert.equal(photo.media_placement, undefined);
  assert.equal(photo.smart_crop_details.mode, 'contain');
});

test('overrides prioritize deterministic order, dedupe, respect service and exclude only their area', () => {
  const photo = { asset_id: assetId, source: 'proof_asset', service: 'tv_mounting' };
  const camera = { asset_id: 'camera', source: 'proof_asset', service: 'cameras' };
  const alternate = { asset_id: 'alternate', source: 'proof_asset', service: 'tv_mounting' };
  const hidden = placement({ enabled: false });
  assert.equal(library.mergeMediaPlacements([photo], [], [hidden], 'mid_proof_rail', 5).length, 0);
  assert.equal(library.mergeMediaPlacements([photo], [], [hidden], 'pre_cta', 5).length, 1);
  const explicit = [
    { ...photo, media_placement: placement({ display_order: 20 }) },
    { ...alternate, media_placement: placement({ asset_id: 'alternate', display_order: 1 }) },
  ];
  const result = library.mergeMediaPlacements([photo, camera], explicit, [], 'mid_proof_rail', 5, 'tv_mounting');
  assert.equal(result.map((asset) => asset.asset_id).join(','), `alternate,${assetId}`);
  assert.equal(library.mergeMediaPlacements([photo, camera], [], [], 'mid_proof_rail', 1).length, 1);
});

test('page framing emits only bounded CSS, overrides legacy transforms, and supports full-image fit', () => {
  assert.equal(style(placement({ fit: 'contain', zoom: 1 })), 'object-fit:contain;object-position:20% 80%;transform-origin:20% 80%;transform:scale(1);');
  assert.match(style({ fit: 'url(bad)', focal_x: -200, focal_y: 999, zoom: 9 }), /object-fit:cover;object-position:0% 100%;.*scale\(3\)/);
  assert.equal(style(null), '');
});

test('Commercial hero fallback does not inherit rail-specific framing', () => {
  const railPhoto = {
    asset_id: assetId, source: 'proof_asset', service: 'cameras',
    media_placement: placement({ surface: 'commercial_intake', area: 'commercial_security_rail', focal_x: 99 }),
  };
  const hero = library.mergeMediaPlacements([railPhoto], [], [], 'commercial_hero', 1);
  assert.equal(hero[0].media_placement, undefined);
  assert.equal(railPhoto.media_placement.focal_x, 99);
});

test('shared assets retain independent page/area selection and framing in the actual public renderers', () => {
  const alternateId = '22222222-2222-4222-8222-222222222222';
  const pool = [assetId, alternateId].map(id => ({
    asset_id: id, source: 'proof_asset', media_kind: 'photo', service: 'cameras',
    direct_url: `https://fixture.invalid/${id}.jpg`, smart_crop_details: { mode: 'contain' },
  }));
  const original = JSON.stringify(pool);
  const rows = [
    placement({ area: 'hero', focal_x: 10, zoom: 1.75 }),
    placement({ asset_id: alternateId, area: 'hero', enabled: false }),
    placement({ surface: 'commercial_intake', area: 'commercial_security_rail', focal_x: 90, fit: 'contain', display_order: 20 }),
    placement({ asset_id: alternateId, surface: 'commercial_intake', area: 'commercial_security_rail', focal_x: 40, display_order: 1 }),
  ];
  const resolve = (surface, area) => {
    const scoped = rows.filter(row => row.surface === surface);
    const explicit = pool.filter(asset => scoped.some(row => row.area === area && row.asset_id === asset.asset_id && row.enabled))
      .map(asset => ({ ...asset, media_placement: scoped.find(row => row.area === area && row.asset_id === asset.asset_id) }));
    const config = library.MEDIA_PAGES[surface].areas.find(entry => entry.key === area);
    return library.mergeMediaPlacements(pool, explicit, scoped, area, config.limit, config.service);
  };
  const dom = new JSDOM('<div id="hero"></div><div id="rail"></div>', { runScripts: 'outside-only' });
  try {
    const { window } = dom;
    window.eval(fs.readFileSync(helperPath, 'utf8'));
    const extract = (filename, names) => {
      const source = fs.readFileSync(path.join(root, 'frontend', filename), 'utf8');
      const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const found = new Map();
      const visit = node => {
        if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) found.set(node.name.text, node.getText(ast));
        ts.forEachChild(node, visit);
      };
      visit(ast);
      assert.equal(found.size, names.length);
      return names.map(name => found.get(name)).join('\n');
    };
    window.eval(`
      const resolveProofAssetMediaUrl = asset => asset.direct_url;
      const getProofAssetVersionToken = () => '';
      const appendCacheBust = url => url;
      ${extract('commercial.js', ['escapeHtml', 'escapeAttr', 'mediaUrlFor', 'mediaPosterFor', 'normalizeMediaItems', 'bindProofTileState', 'renderProofRail'])}
      const absolutizeMediaUrl = url => url;
      const qsa = selector => Array.from(document.querySelectorAll(selector));
      ${extract('bundles.js', ['renderProofHeroMedia', 'buildProofMediaStyle'])}
      window.renderFixtureHero = renderProofHeroMedia;
      window.renderFixtureRail = renderProofRail;
      window.fixtureMediaStyle = buildProofMediaStyle;
    `);
    const hero = resolve('bundles', 'hero');
    const rail = resolve('commercial_intake', 'commercial_security_rail');
    assert.deepEqual(Array.from(hero, asset => asset.asset_id), [assetId]);
    assert.deepEqual(Array.from(rail, asset => asset.asset_id), [alternateId, assetId]);
    assert.equal(window.renderFixtureHero(window.document.getElementById('hero'), hero[0]), true);
    window.renderFixtureRail(window.document.getElementById('rail'), rail);
    const heroImage = window.document.querySelector('#hero img');
    const railImages = window.document.querySelectorAll('#rail img');
    assert.equal(heroImage.style.objectPosition, '10% 80%');
    assert.equal(heroImage.style.transform, 'scale(1.75)');
    assert.equal(railImages[1].style.objectPosition, '90% 80%');
    assert.equal(railImages[1].style.objectFit, 'contain');
    assert.equal(railImages[0].getAttribute('src'), pool[1].direct_url);
    assert.equal(window.fixtureMediaStyle(hero[0]), style(rows[0]));
    rows[0].focal_x = 25;
    window.renderFixtureHero(window.document.getElementById('hero'), resolve('bundles', 'hero')[0]);
    assert.equal(window.document.querySelector('#hero img').style.objectPosition, '25% 80%');
    assert.equal(railImages[1].style.objectPosition, '90% 80%');
    assert.equal(resolve('bundles', 'pre_cta').length, 2, 'Exclusion must not hide another area');
    assert.equal(JSON.stringify(pool), original, 'Source files/shared crop metadata must not change');
  } finally { dom.window.close(); }
});

function dbMock(rows = []) {
  const calls = [];
  const client = {
    from(table) {
      let query;
      let single = false;
      query = new Proxy({}, {
        get(_, method) {
          if (method === 'then') return (resolve) => resolve({ data: single ? rows[0] || null : rows, error: null });
          return (...args) => {
            if (method === 'single' || method === 'maybeSingle') single = true;
            calls.push({ table, method, args });
            return query;
          };
        },
      });
      return query;
    },
  };
  return { client, calls };
}

test('public resolution applies review/rights/visibility gates to explicitly assigned assets', async () => {
  const db = dbMock([{ asset_id: assetId, media_kind: 'photo', service_type: 'tv_mounting' }]);
  const lib = loadTs('backend\\lib\\mediaPlacements.ts', {
    '@/lib/supabase': { getSupabase: () => db.client },
    '@/lib/ownerMediaDb': { OWNER_MEDIA_DB_BUCKET: 'owner-media-db' },
  });
  const rows = [placement(), placement({ asset_source: 'owner_media', asset_id: 'owner-one' })];
  await lib.resolvePlacementAssets(rows, 'mid_proof_rail');
  const filters = db.calls.filter((call) => call.method === 'eq' || call.method === 'neq');
  assert.ok(filters.some((call) => call.table === 'proof_assets' && call.args[0] === 'is_visible' && call.args[1] === true));
  for (const [field, value] of [['review_state', 'published'], ['qa_hold', false], ['usage_rights_status', 'social_allowed'], ['customer_media_opt_in', 'declined']]) {
    assert.ok(filters.some((call) => call.table === 'owner_media_uploads' && call.args[0] === field && call.args[1] === value));
  }
});

function adminRoute(user, db) {
  return loadTs('backend\\app\\api\\admin\\media-placements\\route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options.status }) } },
    '@/lib/dashboardAuth': { getDashboardAuthUserFromSession: async () => user },
    '@/lib/supabase': { getSupabase: () => db },
    '@/lib/mediaPlacements': library,
  });
}

test('placement API saves only a placement row and never rewrites the shared asset', async () => {
  const db = dbMock([{ asset_id: assetId, is_visible: true, service: 'tv_mounting' }]);
  const route = adminRoute({ role: 'ADMIN', userId: 'admin-one' }, db.client);
  const response = await route.PUT(new Request('http://localhost/api/admin/media-placements', {
    method: 'PUT', body: JSON.stringify(placement()),
  }));
  assert.equal(response.status, 200);
  const write = db.calls.find((call) => call.method === 'upsert');
  assert.equal(write.table, 'media_placements');
  assert.equal(write.args[0].proof_asset_id, assetId);
  assert.equal(write.args[0].owner_asset_id, null);
  assert.equal(write.args[0].surface, 'bundles');
  assert.equal(write.args[0].area, 'mid_proof_rail');
  assert.equal(write.args[0].updated_by, 'admin-one');
  assert.equal(write.args[0].storage_path, undefined);
  assert.equal(write.args[0].smart_crop_details, undefined);
  assert.equal(write.args[1].onConflict, 'asset_source,asset_id,surface,area');
  assert.ok(!db.calls.some((call) => call.table === 'proof_assets' && ['update', 'upsert', 'delete'].includes(call.method)));
});

test('placement API rejects unpublished owner media and incompatible commercial rails', async () => {
  for (const row of [
    { asset_id: assetId, review_state: 'pending', usage_rights_status: 'social_allowed', qa_hold: false, service_type: 'cameras' },
    { asset_id: assetId, review_state: 'published', usage_rights_status: 'social_allowed', qa_hold: false, customer_media_opt_in: 'declined', service_type: 'cameras' },
    { asset_id: assetId, review_state: 'published', usage_rights_status: 'social_allowed', qa_hold: false, service_type: 'tv_mounting' },
  ]) {
    const db = dbMock([row]);
    const route = adminRoute({ role: 'ADMIN', userId: 'admin-one' }, db.client);
    const response = await route.PUT(new Request('http://localhost/api/admin/media-placements', {
      method: 'PUT',
      body: JSON.stringify(placement({ asset_source: 'owner_media', surface: 'commercial_intake', area: 'commercial_security_rail' })),
    }));
    assert.equal(response.status, 409);
    assert.ok(!db.calls.some((call) => call.method === 'upsert'));
  }
});

test('placement API requires an authenticated administrator', async () => {
  for (const [user, status] of [[null, 401], [{ role: 'VA' }, 403]]) {
    const route = adminRoute(user, null);
    const response = await route.GET(new Request('http://localhost/api/admin/media-placements'));
    assert.equal(response.status, status);
  }
});

test('placement API restores only the exact source/asset/page/area key', async () => {
  const db = dbMock();
  const route = adminRoute({ role: 'ADMIN', userId: 'admin-one' }, db.client);
  const response = await route.DELETE(new Request('http://localhost/api/admin/media-placements', {
    method: 'DELETE', body: JSON.stringify(placement()),
  }));
  assert.equal(response.status, 200);
  for (const [key, value] of [['asset_source', 'proof_asset'], ['asset_id', assetId], ['surface', 'bundles'], ['area', 'mid_proof_rail']]) {
    assert.ok(db.calls.some((call) => call.method === 'eq' && call.args[0] === key && call.args[1] === value));
  }
});

async function editor({ failLoad = false, pages = library.MEDIA_PAGES, mediaKind = 'photo' } = {}) {
  const dom = new JSDOM('<button id="origin">Open editor</button><div id="ppLibraryEditor"><div id="ppLibraryEditorBody"></div></div>', { runScripts: 'outside-only', url: 'http://localhost/' });
  const { window } = dom;
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.confirm = () => true;
  window.console = { ...console, error: () => {} };
  const stored = [];
  const requests = [];
  let failSave = false;
  let unconfirmedSave = false;
  let saveGate = null;
  window.fetch = async (url, options) => {
    requests.push({ url, ...options });
    if (options.method === 'GET') return {
      ok: !failLoad,
      json: async () => failLoad ? { ok: false, error: 'Could not load saved placements' } : { ok: true, pages, placements: stored.slice() },
    };
    if (saveGate) { const gate = saveGate; saveGate = null; await gate; }
    if (failSave) return { ok: false, json: async () => ({ ok: false, error: 'Database unavailable' }) };
    const row = JSON.parse(options.body);
    const index = stored.findIndex((item) => item.surface === row.surface && item.area === row.area);
    if (index >= 0) stored.splice(index, 1);
    if (options.method === 'PUT') stored.push(row);
    return { ok: true, json: async () => ({ ok: true, ...(options.method === 'PUT' ? { placement: unconfirmedSave ? null : row } : {}) }) };
  };
  window.eval(fs.readFileSync(helperPath, 'utf8'));
  const dash = fs.readFileSync(path.join(root, 'frontend', 'dash.js'), 'utf8');
  const start = dash.indexOf('async renderEditorUI(');
  const end = dash.indexOf('// Video Resizer Logic', start);
  const methods = window.eval(`({${dash.slice(start, end)}})`);
  const proof = {
    ...methods, state: {}, escapeHtml: (value) => String(value),
    cancelEdit() {
      this._placementEditor.destroy();
      window.document.getElementById('ppLibraryEditor').classList.add('is-hidden');
      window.document.getElementById('origin').focus();
    },
  };
  const reopen = async () => {
    window.document.getElementById('ppLibraryEditor').classList.remove('is-hidden');
    await proof.renderEditorUI(
      { asset_id: assetId, media_kind: mediaKind },
      'http://localhost/api/proof-asset-media?bucket=proof&path=uploads%2Fphoto.webp&v=test',
      mediaKind === 'video', window.document.getElementById('ppLibraryEditorBody'), null, null,
      { asset: { asset_id: assetId, media_kind: mediaKind }, source: 'proof_asset', base: '', token: 'test-session' },
    );
    const media = window.document.getElementById('ppEditorVideo');
    if (mediaKind === 'video') {
      Object.defineProperty(media, 'videoWidth', { value: 1200 });
      Object.defineProperty(media, 'videoHeight', { value: 800 });
      media.play = async () => { Object.defineProperty(media, 'paused', { value: false, configurable: true }); };
      media.pause = () => { Object.defineProperty(media, 'paused', { value: true, configurable: true }); };
      media.dispatchEvent(new window.Event('loadeddata'));
    } else {
      Object.defineProperty(media, 'naturalWidth', { value: 1200 });
      Object.defineProperty(media, 'naturalHeight', { value: 800 });
      media.dispatchEvent(new window.Event('load'));
    }
  };
  window.document.getElementById('origin').focus();
  await reopen();
  return {
    dom, window, stored, requests, proof, reopen, fail: () => { failSave = true; }, recover: () => { failSave = false; },
    holdSave: () => {
      let release;
      saveGate = new Promise((resolve) => { release = resolve; });
      return release;
    },
    unconfirmed: () => { unconfirmedSave = true; },
    allowLoad: () => { failLoad = false; },
    find: (selector) => window.document.querySelector(selector),
    flush: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

test('editor saves different framing for the same image on Bundles and Commercial and reloads persisted settings', async () => {
  const e = await editor();
  const change = (selector, value) => {
    const input = e.find(selector);
    input.value = value;
    input.dispatchEvent(new e.window.Event('input', { bubbles: true }));
  };
  change('[name="focal_x"]', '10');
  e.find('form').dispatchEvent(new e.window.Event('submit', { bubbles: true, cancelable: true }));
  await e.flush();
  assert.equal(e.stored[0].surface, 'bundles');
  assert.equal(e.stored[0].focal_x, 10);
  e.find('[data-page="commercial_intake"]').click();
  change('[name="focal_x"]', '90');
  e.find('form').dispatchEvent(new e.window.Event('submit', { bubbles: true, cancelable: true }));
  await e.flush();
  assert.equal(e.stored.length, 2);
  assert.equal(e.stored[1].surface, 'commercial_intake');
  assert.equal(e.stored[1].focal_x, 90);
  e.find('[data-page="bundles"]').click();
  assert.equal(e.find('[name="focal_x"]').value, '10');
  e.proof._placementEditor.cancel();
  assert.equal(e.find('#mediaPlacementDialog'), null);
  assert.equal(e.window.document.activeElement.id, 'origin');
  await e.reopen();
  assert.equal(e.find('[name="focal_x"]').value, '10');
  assert.ok(e.requests.every((request) => request.headers.Authorization === 'Bearer test-session'));
  e.find('[data-reset]').click();
  await e.flush();
  assert.equal(e.stored.length, 1);
  assert.equal(e.stored[0].surface, 'commercial_intake');
  e.dom.window.close();
});

test('editor protects unsaved scope changes and reports failed saves without success state', async () => {
  const e = await editor();
  const input = e.find('[name="focal_x"]');
  input.value = '33';
  input.dispatchEvent(new e.window.Event('input', { bubbles: true }));
  e.window.confirm = () => false;
  e.find('[data-page="commercial_intake"]').click();
  assert.equal(e.find('[data-page="bundles"]').getAttribute('aria-pressed'), 'true');
  assert.equal(e.find('[name="focal_x"]').value, '33');
  e.find('[data-decision="keep"]').click();
  e.fail();
  e.find('form').dispatchEvent(new e.window.Event('submit', { bubbles: true, cancelable: true }));
  await e.flush();
  assert.match(e.find('#ppEditStatus').textContent, /Save failed.*Database unavailable.*draft is still open/);
  assert.equal(e.find('#ppEditStatus').getAttribute('role'), 'alert');
  assert.equal(e.stored.length, 0);
  assert.equal(e.find('#ppApplyEdits').disabled, false);
  e.dom.window.close();
});

test('visual workbench retains the shared canvas and toolbar, hides numeric fields under Advanced, and omits shared mutations', async () => {
  const e = await editor();
  assert.ok(e.find('#ppVideoStage'));
  assert.ok(e.find('#ppUndoBtn'));
  assert.ok(e.find('#ppRedoBtn'));
  assert.equal(e.find('#ppApplyEdits').textContent, 'Save this placement');
  assert.equal(e.find('[name="focal_x"]').closest('details').open, false);
  assert.equal(e.find('#ppEditIntent'), null);
  assert.equal(e.find('#ppFilterGrayscale'), null);
  assert.equal(e.find('.editor-delete'), null);
  assert.match(e.find('.editor-subtitle + .editor-subtitle').textContent, /shared file and other placements stay unchanged/);
  e.dom.window.close();
});

test('drag geometry follows the pointer for cover, zoomed panning and contain letterboxing', () => {
  const { pan } = require(helperPath);
  const frame = { width: 400, height: 300 };
  const source = { width: 1200, height: 600 };
  const initial = placement({ focal_x: 50, focal_y: 50, zoom: 1 });
  assert.equal(pan(initial, 20, 20, frame, source).focal_x, 40);
  assert.equal(pan(initial, 20, 20, frame, source).focal_y, 50);
  assert.equal(pan({ ...initial, zoom: 2 }, 80, 30, frame, source).focal_x, 40);
  assert.equal(pan({ ...initial, fit: 'contain' }, 0, 20, frame, source).focal_y, 70);
  assert.equal(pan(initial, 9999, 0, frame, source).focal_x, 0);
  assert.equal(pan(initial, -9999, 0, frame, source).focal_x, 100);
});

test('wheel zoom previews immediately, undo/redo restore exact framing, and cancel never writes', async () => {
  const e = await editor();
  const stage = e.find('#ppVideoStage');
  stage.dispatchEvent(new e.window.WheelEvent('wheel', { deltaY: -120, cancelable: true }));
  assert.match(e.find('#ppEditorVideo').style.transform, /1.05/);
  e.find('#ppUndoBtn').click();
  // A grouped wheel gesture is committed when Undo is requested.
  e.proof._placementEditor.undo();
  assert.equal(e.find('[name="zoom"]').value, '1');
  e.proof._placementEditor.redo();
  assert.equal(e.find('[name="zoom"]').value, '1.05');
  e.window.confirm = () => false;
  assert.equal(e.proof._placementEditor.cancel(), false);
  e.find('[data-decision="discard"]').click();
  assert.ok(e.find('#ppLibraryEditor').classList.contains('is-hidden'));
  assert.equal(e.requests.filter((request) => request.method !== 'GET').length, 0);
  e.dom.window.close();
});

test('failed preview disables saving, retry preserves the storage path, and a loaded preview recovers', async () => {
  const e = await editor();
  const image = e.find('#ppEditorVideo');
  image.dispatchEvent(new e.window.Event('error'));
  assert.equal(e.find('#ppApplyEdits').disabled, true);
  assert.ok(e.find('#ppStageErrorOverlay').classList.contains('is-visible'));
  e.find('#ppStageErrorOverlay button').click();
  const url = new URL(image.src);
  assert.equal(url.searchParams.get('path'), 'uploads/photo.webp');
  assert.equal(url.searchParams.getAll('v').length, 1);
  image.dispatchEvent(new e.window.Event('load'));
  assert.equal(e.find('#ppApplyEdits').disabled, false);
  assert.equal(e.find('#ppStageLoadOverlay').classList.contains('is-visible'), false);
  e.dom.window.close();
});

test('saved-settings failures block saving until a successful retry and new developer pages use the same workbench', async () => {
  const pages = {
    ...library.MEDIA_PAGES,
    developer_page: { title: 'Developer page', areas: [{ key: 'project_header', title: 'Project header', aspect: '3 / 2' }] },
  };
  const e = await editor({ failLoad: true, pages });
  assert.equal(e.find('#ppApplyEdits').disabled, true);
  assert.equal(e.find('#ppEditStatus').getAttribute('role'), 'alert');
  e.allowLoad();
  e.find('[data-reload]').click();
  await e.flush();
  e.find('[data-page="developer_page"]').click();
  assert.equal(e.find('[data-area="project_header"]'), null);
  assert.match(e.find('.media-placement-scope strong').textContent, /Developer page \/ Project header/);
  assert.equal(e.find('#ppApplyEdits').disabled, false);
  e.dom.window.close();
});

test('cache-busting initial and post-save URLs preserves query parameters and fragments', () => {
  const dash = fs.readFileSync(path.join(root, 'frontend', 'dash.js'), 'utf8');
  const method = /getCacheBustedUrl\(baseUrl\) \{[\s\S]*?\n            \},/.exec(dash)[0];
  const helper = vm.runInNewContext(`({${method}})`, { URL, location: { href: 'https://example.test/dash.html' } });
  for (const value of ['/api/proof-asset-media?bucket=proof&path=uploads%2Fphoto.webp#preview', '/photo.webp#preview']) {
    const output = new URL(helper.getCacheBustedUrl(value));
    assert.equal(output.hash, '#preview');
    assert.ok(output.searchParams.get('v'));
    if (value.includes('bucket')) assert.equal(output.searchParams.get('path'), 'uploads/photo.webp');
  }
  assert.ok(dash.includes('const url = this.getCacheBustedUrl(baseUrl);'));
});

test('saving clears dirty state, while keyboard undo/redo and exclusion remain placement scoped', async () => {
  const e = await editor();
  const field = e.find('[name="enabled"]');
  field.checked = false;
  field.dispatchEvent(new e.window.Event('input', { bubbles: true }));
  field.dispatchEvent(new e.window.Event('change', { bubbles: true }));
  const key = (value, shift = false) => e.proof._placementEditor.handleKey({
    key: value, ctrlKey: true, shiftKey: shift, target: e.find('#ppVideoStage'), preventDefault() {},
  });
  key('z');
  assert.equal(field.checked, true);
  key('z', true);
  assert.equal(field.checked, false);
  await e.proof._placementEditor.save();
  assert.equal(e.stored[0].enabled, false);
  let confirmations = 0;
  e.window.confirm = () => { confirmations++; return false; };
  assert.equal(e.proof._placementEditor.cancel(), true);
  assert.equal(confirmations, 0);
  e.dom.window.close();
});

test('registered pages drive validation and the generic public endpoint without adding editor code', async () => {
  library.MEDIA_PAGES.developer_page = {
    title: 'Developer page',
    areas: [{ key: 'project_header', title: 'Project header', aspect: '3 / 2', limit: 2 }],
  };
  try {
    assert.equal(library.parseMediaPlacement(placement({ surface: 'developer_page', area: 'project_header' })).surface, 'developer_page');
    assert.throws(() => library.parseMediaPlacement(placement({ surface: '__proto__' })), /Invalid page/);
    const route = loadTs('backend\\app\\api\\media-placements\\route.ts', {
      'next/server': { NextResponse: { json: (body, options) => ({ body, status: options.status || 200 }) } },
      '@/lib/mediaPlacements': {
        ...library,
        readMediaPlacements: async () => [],
        resolvePlacementAssets: async () => [],
      },
    });
    const response = await route.GET(new Request('http://localhost/api/media-placements?surface=developer_page'));
    assert.equal(response.status, 200);
    assert.equal(response.body.sections.project_header.aspect, '3 / 2');
    const invalid = await route.GET(new Request('http://localhost/api/media-placements?surface=unregistered'));
    assert.equal(invalid.status, 400);
  } finally { delete library.MEDIA_PAGES.developer_page; }
});

test('video placements have scoped playback, loaded-data readiness and explicit playback failures', async () => {
  const e = await editor({ mediaKind: 'video' });
  const button = e.find('[data-playback]');
  assert.equal(e.find('#ppApplyEdits').disabled, false);
  button.click();
  await e.flush();
  assert.equal(button.textContent, 'Pause preview');
  button.click();
  assert.equal(button.textContent, 'Play preview');
  e.find('#ppEditorVideo').play = async () => { throw new Error('Playback unavailable'); };
  button.click();
  await e.flush();
  assert.equal(e.find('#ppEditStatus').getAttribute('role'), 'alert');
  assert.match(e.find('#ppEditStatus').textContent, /Video playback failed/);
  assert.equal(e.find('#ppTrimRange'), null);
  e.proof._placementEditor.destroy();
  e.dom.window.close();
});

for (const scope of ['page', 'area']) {
  for (const choice of ['save', 'discard', 'keep']) {
    test(`${choice} when switching ${scope} keeps drafts and writes in the correct placement`, async () => {
      const e = await editor();
      const input = e.find('[name="focal_x"]');
      input.value = '17';
      input.dispatchEvent(new e.window.Event('input', { bubbles: true }));
      const target = scope === 'page' ? '[data-page="commercial_intake"]' : '[data-area="pre_cta"]';
      e.find(target).click();
      assert.ok(e.find('.media-placement-decision').open);
      assert.match(e.find('#mediaPlacementDecisionTitle').textContent, /Bundles \/ Hero background/);
      assert.equal(e.stored.length, 0);
      e.find(`[data-decision="${choice}"]`).click();
      await e.flush();
      assert.equal(e.find('.media-placement-decision'), null);
      if (choice === 'keep') {
        assert.equal(e.find('[name="focal_x"]').value, '17');
        assert.equal(e.find('[data-page="bundles"]').getAttribute('aria-pressed'), 'true');
        assert.equal(e.find('[data-area="hero"]').getAttribute('aria-pressed'), 'true');
      } else {
        assert.equal(e.find(target).getAttribute('aria-pressed'), 'true');
        assert.equal(e.find('[name="focal_x"]').value, '50');
        assert.equal(e.find('#ppEditStatus').dataset.state, 'automatic');
      }
      assert.equal(e.stored.length, choice === 'save' ? 1 : 0);
      if (choice === 'save') {
        assert.equal(e.stored[0].surface, 'bundles');
        assert.equal(e.stored[0].area, 'hero');
        assert.equal(e.stored[0].focal_x, 17);
      }
      e.proof._placementEditor.destroy();
      e.dom.window.close();
    });
  }
}

test('Save and switch failure stays in the original scope and preserves the draft until a successful retry', async () => {
  const e = await editor();
  const input = e.find('[name="focal_x"]');
  input.value = '23';
  input.dispatchEvent(new e.window.Event('input', { bubbles: true }));
  e.find('[data-page="commercial_intake"]').click();
  e.fail();
  e.find('[data-decision="save"]').click();
  await e.flush();
  assert.equal(e.find('[name="focal_x"]').value, '23');
  assert.equal(e.find('[data-page="bundles"]').getAttribute('aria-pressed'), 'true');
  assert.equal(e.find('#ppEditStatus').dataset.state, 'failed');
  assert.match(e.find('[data-decision-error]').textContent, /Database unavailable/);
  assert.ok(e.find('.media-placement-decision').open);
  assert.equal(e.stored.length, 0);
  e.recover();
  e.find('[data-decision="save"]').click();
  await e.flush();
  assert.equal(e.find('[data-page="commercial_intake"]').getAttribute('aria-pressed'), 'true');
  assert.equal(e.find('[name="focal_x"]').value, '50');
  assert.equal(e.stored[0].focal_x, 23);
  e.dom.window.close();
});

test('saving is announced before persistence and saved only after confirmation; no actions change scope while busy', async () => {
  const e = await editor();
  const release = e.holdSave();
  const promise = e.proof._placementEditor.save();
  assert.equal(e.find('#ppEditStatus').dataset.state, 'saving');
  assert.equal(e.find('#ppApplyEdits').textContent, 'Saving placement...');
  assert.equal(e.find('#ppApplyEdits').disabled, true);
  assert.equal(e.find('[data-page="commercial_intake"]').disabled, true);
  assert.equal(e.proof._placementEditor.cancel(), false);
  assert.equal(e.stored.length, 0);
  release();
  assert.equal(await promise, true);
  assert.equal(e.find('#ppEditStatus').dataset.state, 'saved');
  assert.equal(e.stored.length, 1);
  e.dom.window.close();
});

for (const choice of ['save', 'discard', 'keep']) {
  test(`closing with ${choice} uses the same unsaved-change protection`, async () => {
    const e = await editor();
    e.find('[name="zoom"]').value = '1.5';
    e.find('[name="zoom"]').dispatchEvent(new e.window.Event('input', { bubbles: true }));
    assert.equal(e.proof._placementEditor.cancel(), false);
    assert.equal(e.find('[data-decision="save"]').textContent, 'Save and close');
    e.find(`[data-decision="${choice}"]`).click();
    await e.flush();
    assert.equal(e.find('#ppLibraryEditor').classList.contains('is-hidden'), choice !== 'keep');
    assert.equal(e.stored.length, choice === 'save' ? 1 : 0);
    e.proof._placementEditor.destroy();
    e.dom.window.close();
  });
}

test('invalid numeric edits cannot be silently discarded when changing placement', async () => {
  const e = await editor();
  const input = e.find('[name="focal_x"]');
  input.value = '101';
  input.dispatchEvent(new e.window.Event('input', { bubbles: true }));
  e.find('[data-page="commercial_intake"]').click();
  e.find('[data-decision="save"]').click();
  await e.flush();
  assert.equal(input.value, '101');
  assert.equal(e.find('[data-page="bundles"]').getAttribute('aria-pressed'), 'true');
  assert.equal(e.stored.length, 0);
  e.find('[data-decision="keep"]').click();
  e.proof._placementEditor.destroy();
  e.dom.window.close();
});

test('Reset framing edits the draft; Restore automatic selection deletes only that override after confirmation', async () => {
  const e = await editor();
  const change = (name, value) => {
    const field = e.find(`[name="${name}"]`);
    if (field.type === 'radio') field.checked = true;
    else field.value = value;
    field.dispatchEvent(new e.window.Event('input', { bubbles: true }));
  };
  change('zoom', '1.5');
  change('focal_x', '20');
  change('display_order', '7');
  await e.proof._placementEditor.save();
  e.find('[data-page="commercial_intake"]').click();
  change('focal_x', '80');
  await e.proof._placementEditor.save();
  e.find('[data-page="bundles"]').click();
  const before = e.requests.length;
  e.find('[data-center]').click();
  assert.equal(e.find('[name="zoom"]').value, '1');
  assert.equal(e.find('[name="focal_x"]').value, '50');
  assert.equal(e.find('[name="display_order"]').value, '7');
  assert.equal(e.requests.length, before);
  assert.equal(e.stored[0].focal_x, 20);
  assert.equal(e.find('#ppEditStatus').dataset.state, 'unsaved');
  e.find('[data-reset]').click();
  await e.flush();
  assert.equal(e.stored.length, 1);
  assert.equal(e.stored[0].surface, 'commercial_intake');
  assert.equal(e.stored[0].focal_x, 80);
  assert.equal(e.find('#ppEditStatus').dataset.state, 'automatic');
  assert.equal(e.find('[name="display_order"]').value, '100');
  e.dom.window.close();
});

test('an unconfirmed save response never reports saved or switches away', async () => {
  const e = await editor();
  e.find('[name="zoom"]').value = '1.5';
  e.find('[name="zoom"]').dispatchEvent(new e.window.Event('input', { bubbles: true }));
  e.unconfirmed();
  e.find('[data-page="commercial_intake"]').click();
  e.find('[data-decision="save"]').click();
  await e.flush();
  assert.equal(e.find('#ppEditStatus').dataset.state, 'failed');
  assert.match(e.find('[data-decision-error]').textContent, /server did not confirm/);
  assert.equal(e.find('[data-page="bundles"]').getAttribute('aria-pressed'), 'true');
  assert.equal(e.find('[name="zoom"]').value, '1.5');
  e.proof._placementEditor.destroy();
  e.dom.window.close();
});

test('a failed Save and close keeps the editor and draft open for retry', async () => {
  const e = await editor();
  e.find('[name="zoom"]').value = '1.5';
  e.find('[name="zoom"]').dispatchEvent(new e.window.Event('input', { bubbles: true }));
  e.proof._placementEditor.cancel();
  e.fail();
  e.find('[data-decision="save"]').click();
  await e.flush();
  assert.ok(!e.find('#ppLibraryEditor').classList.contains('is-hidden'));
  assert.ok(e.find('.media-placement-decision').open);
  assert.equal(e.find('[name="zoom"]').value, '1.5');
  assert.equal(e.find('#ppEditStatus').dataset.state, 'failed');
  e.recover();
  e.find('[data-decision="save"]').click();
  await e.flush();
  assert.ok(e.find('#ppLibraryEditor').classList.contains('is-hidden'));
  assert.equal(e.stored[0].zoom, 1.5);
  e.dom.window.close();
});

test('failed Restore automatic selection preserves both the saved override and the current draft', async () => {
  const e = await editor();
  await e.proof._placementEditor.save();
  e.find('[name="zoom"]').value = '1.5';
  e.find('[name="zoom"]').dispatchEvent(new e.window.Event('input', { bubbles: true }));
  e.fail();
  e.find('[data-reset]').click();
  await e.flush();
  assert.equal(e.find('#ppEditStatus').dataset.state, 'failed');
  assert.match(e.find('#ppEditStatus').textContent, /Could not remove.*draft is still open/);
  assert.equal(e.find('[name="zoom"]').value, '1.5');
  assert.equal(e.stored.length, 1);
  assert.equal(e.stored[0].zoom, 1);
  e.dom.window.close();
});
