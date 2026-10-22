const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const heroes = require('../../frontend/media-page-heroes.js');
const catalog = require('../lib/mediaPlacementCatalog.json');
const root = path.resolve(__dirname, '..', '..');
const asset = { asset_id: 'candidate', service: 'tv_mounting', original_filename: 'Office install', media_url: '/photo.jpg' };

test('Bundles resolves curated fallback, explicit precedence and exclusions through one shared selector', () => {
  assert.equal(heroes.bundlesSelection([], []).fallbackAssetId, heroes.bundlesFallbackAssetId);
  const explicit = { ...asset, media_placement: { enabled: true } };
  assert.equal(heroes.bundlesSelection([explicit], []).asset, explicit);
  assert.equal(heroes.bundlesSelection([explicit], []).mode, 'override');
  assert.equal(heroes.bundlesSelection([], [{ asset_source: 'proof_asset', asset_id: heroes.bundlesFallbackAssetId }]).mode, 'empty');
  assert.equal(heroes.bundlesSelection([], [{ asset_source: 'owner_media', asset_id: heroes.bundlesFallbackAssetId }]).mode, 'automatic');
});

test('Commercial preserves explicit empty states and photo-first rail fallback ordering', () => {
  assert.deepEqual(heroes.commercialCandidates({ commercial_hero: { items: [] }, commercial_security_rail: { items: [asset] } }), []);
  const video = { ...asset, asset_id: 'video', media_kind: 'video' };
  assert.deepEqual(heroes.commercialCandidates({
    commercial_security_rail: { items: [video] }, commercial_display_rail: { items: [asset] },
  }).map(item => item.asset_id), ['candidate', 'video']);
  assert.equal(heroes.commercialCandidates({ commercial_hero: { items: [{ asset_id: 'no-url' }, asset] } })[0], asset);
});

test('hero readers use public GET data, resolve actual automatic media and fail explicitly if unavailable', async () => {
  const reads = [];
  const selected = await heroes.read('bundles', async url => {
    reads.push(url);
    return url.includes('proof-slots') ? { ok: true, hero_media: [], hero_exclusions: [] }
      : { ok: true, asset: { ...asset, asset_id: heroes.bundlesFallbackAssetId } };
  });
  assert.equal(selected.mode, 'automatic');
  assert.equal(selected.asset.asset_id, heroes.bundlesFallbackAssetId);
  assert.equal(reads.length, 2);
  assert.equal((await heroes.read('commercial_intake', async () => ({
    ok: true, sections: { commercial_hero: { items: [asset] } },
  }))).asset, asset);
  await assert.rejects(heroes.read('bundles', async () => ({ ok: false, error: 'Fixture offline' })), /Fixture offline/);
});

test('usage describes only current supported destinations, preserves source identity and caps mixed video/photo rails', async () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ ...asset, asset_id: `camera-${i}`, media_kind: i ? 'photo' : 'video' }));
  const selected = await heroes.read('commercial_intake', async () => ({
    ok: true, sections: { commercial_hero: { items: [] }, commercial_security_rail: { items } },
  }));
  assert.equal(selected.areas.commercial_security_rail.length, 4);
  assert.match(heroes.usesForAsset({ commercial_intake: selected }, 'proof_asset', 'camera-0')[0].label, /Commercial \/ Security camera rail/);
  assert.deepEqual(heroes.usesForAsset({ commercial_intake: selected }, 'proof_asset', 'camera-4'), []);
  assert.deepEqual(heroes.usesForAsset({ commercial_intake: selected }, 'owner_media', 'camera-0'), []);
  assert.deepEqual(heroes.usesForAsset({ commercial_intake: { ...selected, mode: 'unavailable' } }, 'proof_asset', 'camera-0'), []);
  assert.deepEqual(heroes.usesForAsset({ bundles: { mode: 'automatic', areas: { pre_cta: [asset] } } }, 'proof_asset', asset.asset_id), []);
});

async function chooser(t, { fail = false, pending = false } = {}) {
  const dom = new JSDOM('<button id="origin">Page placement</button><input id="draft" value="Keep this">', {
    url: 'http://localhost/dash.html', runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());
  const w = dom.window, requests = [], selections = [];
  let release;
  const gate = pending ? new Promise(resolve => { release = resolve; }) : null;
  w.console.error = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.fetch = async (url, options) => {
    requests.push({ url, method: options.method });
    if (gate) await gate;
    return { ok: !fail, json: async () => fail ? { ok: false, error: 'Fixture offline' } : {
      ok: true, pages: catalog, placements: [{ surface: 'commercial_intake', area: 'commercial_hero', enabled: false, display_order: 7 }],
    } };
  };
  for (const file of ['media-placement-style.js', 'media-placements.js']) w.eval(fs.readFileSync(path.join(root, 'frontend', file), 'utf8'));
  w.H2SPageHeroes = heroes;
  w.document.getElementById('origin').focus();
  const controller = w.H2SMediaPlacements.chooseDestination({
    asset, source: 'proof_asset', base: '', token: 'fixture-only',
    onSelect: destination => selections.push(destination),
  });
  if (!pending) await controller.ready;
  return { w, requests, selections, controller, release, dialog: w.document.querySelector('dialog') };
}

test('destination loading reserves its content area, focuses the heading and does not steal focus when choices arrive', async t => {
  const e = await chooser(t, { pending: true });
  assert.equal(e.w.document.activeElement.id, 'mediaDestinationTitle');
  assert.equal(e.dialog.getAttribute('aria-describedby'), 'mediaDestinationDescription');
  assert.equal(e.dialog.querySelector('[data-destinations]').getAttribute('aria-busy'), 'true');
  const cancel = e.dialog.querySelector('[data-close]');
  assert.ok(cancel.closest('.media-destination-actions'));
  cancel.focus();
  e.release();
  await e.controller.ready;
  assert.equal(e.dialog.querySelector('[data-destinations]').getAttribute('aria-busy'), 'false');
  assert.equal(e.w.document.activeElement, cancel);
  assert.equal(e.selections.length, 0);
});

test('Cancel during a pending destination read closes immediately and never reopens after the response', async t => {
  const e = await chooser(t, { pending: true });
  e.dialog.querySelector('[data-close]').click();
  e.release();
  await e.controller.ready;
  assert.equal(e.w.document.querySelector('dialog'), null);
  assert.equal(e.w.document.activeElement.id, 'origin');
  assert.equal(e.requests.every(request => request.method === 'GET'), true);
});

test('unscoped placement requires a supported destination, shows saved uses and never opens a preview or writes', async t => {
  const e = await chooser(t);
  assert.equal(e.dialog.querySelectorAll('[data-destination-surface]').length, 4);
  assert.equal(e.dialog.querySelector('[data-destination-area="mid_proof_rail"]'), null);
  assert.equal(e.dialog.querySelector('[data-destination-area="commercial_security_rail"]').disabled, true);
  assert.match(e.dialog.textContent, /Excluded here; order 7/);
  assert.match(e.dialog.textContent, /Up to 4 photos or videos/);
  assert.equal(e.w.document.querySelector('iframe,img,video'), null);
  assert.equal(e.selections.length, 0);
  e.dialog.querySelector('[data-destination-area="commercial_hero"]').click();
  assert.equal(e.selections[0].surface, 'commercial_intake');
  assert.equal(e.selections[0].area, 'commercial_hero');
  assert.equal(e.requests.every(request => request.method === 'GET'), true);
});

test('destination Cancel leaves drafts untouched and returns keyboard focus', async t => {
  const e = await chooser(t);
  e.dialog.querySelector('[data-close]').click();
  assert.equal(e.w.document.querySelector('dialog'), null);
  assert.equal(e.w.document.getElementById('draft').value, 'Keep this');
  assert.equal(e.w.document.activeElement.id, 'origin');
  assert.equal(e.selections.length, 0);
});

test('failed destination reads show contextual Retry rather than selecting a default', async t => {
  const e = await chooser(t, { fail: true });
  assert.match(e.dialog.querySelector('[role="alert"]').textContent, /Fixture offline/);
  assert.equal(e.dialog.querySelector('[data-destination-area]'), null);
  assert.match(e.dialog.textContent, /Retry destinations/);
  assert.equal(e.selections.length, 0);
});
