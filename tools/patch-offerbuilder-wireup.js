#!/usr/bin/env node
/*
  Patch frontend/dash.js in-place to restore Offer Library ↔ Offer Builder wiring.

  Why a script?
  - The repo's frontend/dash.js is very large and line-ending-sensitive.
  - VS Code apply_patch tooling can be unreliable on multi-MB CRLF files.

  Safety:
  - Creates a timestamped backup next to the file before writing.
  - Idempotent: if markers are already present, it exits without changes.
*/

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const dashJsPath = path.join(repoRoot, 'frontend', 'dash.js');

const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check') || args.has('--dry-run') || args.has('--dryrun');

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    '_',
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join('');
}

function bail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function writeBackup(original) {
  const backupPath = dashJsPath + `.bak_offerbuilder_wireup_${nowStamp()}`;
  fs.writeFileSync(backupPath, original, 'utf8');
  return backupPath;
}

function ensureInsertedOfferBuilderMethods(src) {
  const marker = 'createNewOfferFromLibrary()';
  if (src.includes(marker) && src.includes('_autoEnsureActiveOfferHydratedInBuilder')) {
    return { src, changed: false, note: 'OfferBuilder methods already present' };
  }

  const eol = src.includes('\r\n') ? '\r\n' : '\n';

  const needle = [
    '            _shortRef(id) {',
    '                const s = this._safeTrim(id);',
    "                if (!s) return '';",
    '                if (s.length <= 14) return s;',
    '                return `${s.slice(0, 8)}…${s.slice(-4)}`;',
    '            },',
    '',
    '            _renderActiveOfferLabel() {',
  ].join(eol);

  const idx = src.indexOf(needle);
  if (idx < 0) {
    bail('Could not locate insertion point near _shortRef/_renderActiveOfferLabel');
  }

  const insertBlock = [
    '',
    '            _activeOfferStorageKeys() {',
    '                return {',
    "                    id: 'h2s_ob_active_offer_id_v1',",
    "                    name: 'h2s_ob_active_offer_name_v1'",
    '                };',
    '            },',
    '',
    '            getActiveOffer() {',
    '                try {',
    '                    if (this._activeOffer && this._safeTrim(this._activeOffer.id)) return this._activeOffer;',
    '                } catch (_) {}',
    '',
    '                try {',
    '                    const keys = this._activeOfferStorageKeys();',
    '                    const id = this._safeTrim(localStorage.getItem(keys.id));',
    '                    const name = this._safeTrim(localStorage.getItem(keys.name));',
    '                    if (!id) return null;',
    '                    this._activeOffer = { id, name };',
    '                    return this._activeOffer;',
    '                } catch (_) {',
    '                    return null;',
    '                }',
    '            },',
    '',
    '            setActiveOffer(active) {',
    '                try {',
    '                    const keys = this._activeOfferStorageKeys();',
    '                    const id = this._safeTrim(active && (active.offer_id || active.id));',
    '                    const name = this._safeTrim(active && (active.name || active.offerName));',
    '                    if (!id) {',
    '                        try { localStorage.removeItem(keys.id); } catch (_) {}',
    '                        try { localStorage.removeItem(keys.name); } catch (_) {}',
    '                        this._activeOffer = null;',
    '                        try { this._renderActiveOfferLabel(); } catch (_) {}',
    '                        return;',
    '                    }',
    '                    try { localStorage.setItem(keys.id, id); } catch (_) {}',
    '                    try { localStorage.setItem(keys.name, name); } catch (_) {}',
    '                    this._activeOffer = { id, name };',
    '                    try { this._renderActiveOfferLabel(); } catch (_) {}',
    '                } catch (_) {}',
    '            },',
    '',
    '            async openOfferInBuilder(offerId, opts = {}) {',
    '                const id = this._safeTrim(offerId);',
    '                if (!id) return;',
    '                try {',
    '                    const nm = this._safeTrim((opts && opts.name) || \'\');',
    '                    this.setActiveOffer({ offer_id: id, name: nm });',
    '                } catch (_) {}',
    '                try { this.setSubTab(\'builder\'); } catch (_) {}',
    '                try { await this.loadOfferFromDb(id); } catch (_) {}',
    '            },',
    '',
    '            async _autoEnsureActiveOfferHydratedInBuilder(opts = {}) {',
    '                try {',
    '                    const active = this.getActiveOffer();',
    '                    const activeId = this._safeTrim(active && active.id);',
    '                    const activeName = this._safeTrim(active && active.name);',
    '                    if (!activeId) return false;',
    '',
    '                    const currentId = this._safeTrim(this.offer && this.offer.offer_id);',
    '                    if (currentId && String(currentId) === String(activeId)) return false;',
    '',
    '                    const force = !!(opts && opts.force);',
    '                    if (!force) {',
    '                        // Don\'t clobber typed edits if we have a baseline.',
    '                        try {',
    '                            const sig = String(this._computeDraftSig() || \'\');',
    '                            const base = String(this._builderHydration && this._builderHydration.sig ? this._builderHydration.sig : \'\');',
    '                            if (base && sig && sig !== base) return false;',
    '                        } catch (_) {}',
    '                    }',
    '',
    '                    await this.openOfferInBuilder(activeId, { name: activeName, source: (opts && opts.reason) || \'autoEnsure\' });',
    '                    return true;',
    '                } catch (_) {',
    '                    return false;',
    '                }',
    '            },',
    '',
    '            createNewOfferFromLibrary() {',
    '                try { this.setSubTab(\'builder\'); } catch (_) {}',
    '                try { this._autosave.allowServerSave = false; } catch (_) {}',
    '',
    '                const offerId = this._uuidv4();',
    '                const blank = {',
    '                    offer_id: offerId,',
    "                    name: '',",
    '                    lineItems: [],',
    '                    hooks: [],',
    '                    objectionsRebuttals: [],',
    '                    proofIdeas: [],',
    '                    whatToSayInHome: [],',
    '                    offerFrameworks: null',
    '                };',
    '                try { this.loadOfferData(blank, null); } catch (_) {}',
    '',
    '                try {',
    '                    const sig = this._computeDraftSig();',
    '                    this._builderHydration = { sig: String(sig || \'\'), offerId: String(offerId || \'\'), ts: Date.now() };',
    '                } catch (_) {}',
    '',
    '                try { this._renderActiveOfferLabel(); } catch (_) {}',
    '            },',
  ].join(eol);

  const next = src.slice(0, idx) + needle.replace(eol + '            _renderActiveOfferLabel() {', insertBlock + eol + '            _renderActiveOfferLabel() {') + src.slice(idx + needle.length);

  if (!next.includes('h2s_ob_active_offer_id_v1') || !next.includes('createNewOfferFromLibrary()')) {
    bail('Insertion failed sanity check (expected strings missing)');
  }

  return { src: next, changed: true, note: 'Inserted OfferBuilder methods' };
}

function ensureOfferLibraryWiring(src) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';

  const re = /selectOfferLibraryOffer\(offerId\)\s*\{[\s\S]*?\n\s*\},\s*\n\s*openOfferInFactory\(offerId\)\s*\{[\s\S]*?\n\s*\},/;
  const m = re.exec(src);
  if (!m) {
    bail('Could not locate Offer Library handlers (selectOfferLibraryOffer/openOfferInFactory)');
  }

  const existingBlock = m[0] || '';
  if (
    existingBlock.includes('offer_library_open') &&
    existingBlock.includes('openOfferInBuilder') &&
    existingBlock.includes('setActiveOffer')
  ) {
    return { src, changed: false, note: 'Offer Library handlers already rewired' };
  }

  const replacement = [
    'selectOfferLibraryOffer(offerId) {',
    '                const id = this._safeTrim(offerId);',
    '                if (!id) return;',
    '',
    '                // Persist selection as the "active offer" so the Builder can hydrate from it.',
    '                try {',
    '                    const rows = Array.isArray(this._offerLibraryRows) ? this._offerLibraryRows : [];',
    '                    const row = rows.find(r => String(r && (r.Offer_ID || r.offer_id || r.id) || \'\').trim() === id);',
    '                    const ob = row ? this._extractOfferBuilderData(row) : null;',
    '                    const name = String((ob && ob.name) || (row && (row.Offer_Name || row.offerName || row.name)) || \'\').trim();',
    '                    this.setActiveOffer({ offer_id: id, name });',
    '                } catch (_) {}',
    '',
    '                this.offerLibraryState.selectedId = id;',
    '                try { this._renderOfferLibraryFromCache(); } catch (_) {}',
    '            },',
    '',
    '            openOfferInFactory(offerId) {',
    '                const id = this._safeTrim(offerId);',
    '                if (!id) return;',
    '                try {',
    '                    const rows = Array.isArray(this._offerLibraryRows) ? this._offerLibraryRows : [];',
    '                    const row = rows.find(r => String(r && (r.Offer_ID || r.offer_id || r.id) || \'\').trim() === id);',
    '                    const ob = row ? this._extractOfferBuilderData(row) : null;',
    '                    const name = String((ob && ob.name) || (row && (row.Offer_Name || row.offerName || row.name)) || \'\').trim();',
    '                    this.openOfferInBuilder(id, { name, source: \'offer_library_open\' });',
    '                } catch (_) {',
    '                    try { this.openOfferInBuilder(id, { source: \'offer_library_open\' }); } catch (_) {}',
    '                }',
    '            },',
  ].join(eol);

  const next = src.replace(re, replacement);
  if (next === src) {
    // If we matched the block but replacing produced no change, treat as "already rewired".
    return { src, changed: false, note: 'Offer Library handlers already rewired' };
  }
  if (!next.includes('offer_library_open') || !next.includes('this.setActiveOffer')) {
    bail('Offer Library wiring replacement failed sanity check');
  }

  return { src: next, changed: true, note: 'Rewired Offer Library handlers' };
}

function main() {
  if (!fs.existsSync(dashJsPath)) bail(`Missing file: ${dashJsPath}`);
  const original = fs.readFileSync(dashJsPath, 'utf8');

  if (checkOnly) {
    const missing = [];
    if (!original.includes('createNewOfferFromLibrary()')) missing.push('OfferBuilder.createNewOfferFromLibrary');
    if (!original.includes('_autoEnsureActiveOfferHydratedInBuilder')) missing.push('OfferBuilder._autoEnsureActiveOfferHydratedInBuilder');
    if (!original.includes('h2s_ob_active_offer_id_v1')) missing.push('localStorage key h2s_ob_active_offer_id_v1');
    if (!original.includes('h2s_ob_active_offer_name_v1')) missing.push('localStorage key h2s_ob_active_offer_name_v1');
    if (!original.includes("source: 'offer_library_open'")) missing.push("Offer Library open source 'offer_library_open'");
    if (!original.includes('setActiveOffer({ offer_id: id')) missing.push('Offer Library selection setActiveOffer');
    if (!original.includes('openOfferInBuilder(id')) missing.push('Offer Library open openOfferInBuilder');

    if (missing.length) {
      console.error('CHECK FAILED: missing expected markers:');
      for (const m of missing) console.error(' -', m);
      process.exit(1);
    }

    console.log('CHECK OK: Offer Builder wiring present.');
    return;
  }

  let changed = false;
  let next = original;

  const out1 = ensureInsertedOfferBuilderMethods(next);
  if (out1.changed) changed = true;
  next = out1.src;

  const out2 = ensureOfferLibraryWiring(next);
  if (out2 && out2.changed) changed = true;
  next = out2 ? out2.src : next;

  if (!changed) {
    console.log('No changes needed.');
    return;
  }

  const backupPath = writeBackup(original);
  fs.writeFileSync(dashJsPath, next, 'utf8');

  console.log('Patched:', path.relative(repoRoot, dashJsPath));
  console.log('Backup:', path.relative(repoRoot, backupPath));
}

main();
