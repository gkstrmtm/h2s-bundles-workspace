// Patches frontend/dash.js in-place to ensure Offer Factory "active offer" is selection-first (Offer Library) and includes a proof marker.
// This is a one-off repair script to align the deployed artifact with the intended UX.

const fs = require('fs');

const filePath = 'frontend/dash.js';

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function main() {
  if (!fs.existsSync(filePath)) die(`Missing ${filePath}`);

  const original = fs.readFileSync(filePath, 'utf8');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';

  const re = /^([ \t]*_renderActiveOfferLabel\(\) \{)[\s\S]*?^([ \t]*\},)\s*$/m;
  const match = original.match(re);
  if (!match) die('Could not find offerBuilder._renderActiveOfferLabel() block');

  const indent = (match[1].match(/^[ \t]*/)[0]) || '';
  const indent2 = indent + '    ';

  const replacement = [
    indent + '_renderActiveOfferLabel() {',
    indent2 + '// Proof marker for deploy verification.',
    indent2 + "// (Used by verify-portal-dashjs.ps1 to confirm the correct JS is live.)",
    indent2 + "const __H2S_ACTIVE_OFFER_SOT_V1 = 'H2S_ACTIVE_OFFER_SOT_V1';",
    '',
    indent2 + 'const activeId = (() => {',
    indent2 + '    const sid = this._safeTrim(this.offerLibraryState && this.offerLibraryState.selectedId);',
    indent2 + '    if (sid) return sid;',
    indent2 + '    return this._safeTrim(this.offer && (this.offer.offer_id || this.offer.Offer_ID || this.offer.id));',
    indent2 + '})();',
    '',
    indent2 + 'const activeName = (() => {',
    indent2 + '    const id = this._safeTrim(activeId);',
    indent2 + '    if (id) {',
    indent2 + '        try {',
    indent2 + '            if (Array.isArray(this._offerLibraryRows)) {',
    indent2 + "                const row = this._offerLibraryRows.find(r => String(r && (r.Offer_ID || r.offer_id || r.id) || '') === String(id)) || null;",
    indent2 + '                if (row) {',
    indent2 + "                    const ob = (typeof this._extractOfferBuilderData === 'function') ? this._extractOfferBuilderData(row) : null;",
    indent2 + '                    const nm = this._safeTrim((ob && (ob.name || ob.offerName || ob.offer_name || ob.title)) || row.Offer_Name || row.offerName || row.name);',
    indent2 + '                    if (nm) return nm;',
    indent2 + '                }',
    indent2 + '            }',
    indent2 + '        } catch (_) {}',
    indent2 + '    }',
    indent2 + '    return this._safeTrim(this.offer && this.offer.name);',
    indent2 + '})();',
    '',
    indent2 + "const ref = activeId ? this._shortRef(activeId) : '';",
    '',
    indent2 + "// Update Ad Frameworks simplified label if present.",
    indent2 + "const elAf = document.getElementById('obAfActiveOffer');",
    indent2 + 'try {',
    indent2 + '    if (elAf) {',
    indent2 + '        elAf.textContent = activeName',
    indent2 + '            ? (ref ? `${activeName} (${ref})` : activeName)',
    indent2 + "            : (ref ? `Draft (${ref})` : 'Draft');",
    indent2 + '    }',
    indent2 + '} catch (_) {',
    indent2 + "    try { if (elAf) elAf.textContent = '—'; } catch (_) {}",
    indent2 + '}',
    '',
    indent2 + "// Update main Offer Builder header (Offer Factory context).",
    indent2 + "const elTitle = document.getElementById('obHeaderMainTitle');",
    indent2 + "const elCrumbs = document.getElementById('obHeaderCrumbs');",
    indent2 + "const elSub = document.getElementById('obHeaderSubtitle');",
    '',
    indent2 + 'if (elTitle && elSub) {',
    indent2 + "    const tab = this.subTab || 'builder';",
    indent2 + '    const ctxName = activeName;',
    '',
    indent2 + '    // Global offer context pill in the top bar.',
    indent2 + '    try {',
    indent2 + "        const elGlobal = document.getElementById('currentOfferTitle');",
    indent2 + '        if (elGlobal) {',
    indent2 + '            const label = ctxName ? `Offer: ${ctxName}` : (ref ? `Offer: Draft (${ref})` : \'\');',
    indent2 + "            if (label) { elGlobal.textContent = label; elGlobal.style.display = ''; }",
    indent2 + "            else { elGlobal.textContent = ''; elGlobal.style.display = 'none'; }",
    indent2 + '        }',
    indent2 + '    } catch (_) {}',
    '',
    indent2 + "    if (tab === 'library') {",
    indent2 + "        elTitle.textContent = 'Offer Library';",
    indent2 + "        if (elCrumbs) elCrumbs.style.display = 'none';",
    indent2 + "        elSub.textContent = ctxName ? `Selected: ${ctxName}` : 'Browse, manage, and engage your service offers.';",
    indent2 + "    } else if (tab === 'adframeworks' || tab === 'adresources') {",
    indent2 + "        elTitle.textContent = 'Ad Frameworks';",
    indent2 + "        if (elCrumbs) elCrumbs.style.display = 'none';",
    indent2 + "        elSub.textContent = ctxName ? `Offer: ${ctxName} — status-driven modules + resources.` : 'Select an offer in Offer Library to see module status + resources.';",
    indent2 + '    } else {',
    indent2 + '        if (ctxName) {',
    indent2 + "            elTitle.textContent = 'Offer Builder';",
    indent2 + "            if (elCrumbs) elCrumbs.style.display = 'none';",
    indent2 + '            elSub.textContent = `Offer: ${ctxName} — editing details, pricing, and messaging.`;',
    indent2 + '        } else {',
    indent2 + "            elTitle.textContent = 'Build Your Offer';",
    indent2 + "            if (elCrumbs) elCrumbs.style.display = 'none';",
    indent2 + "            elSub.textContent = 'Create service packages and bundles. Add services, set pricing, and generate a complete offer brief.';",
    indent2 + '        }',
    indent2 + '    }',
    indent2 + '}',
    '',
    indent2 + "// Keep the global area title aligned with the Offer Factory subtab (only when Offer Builder is active).",
    indent2 + 'try {',
    indent2 + "    const obPane = document.getElementById('offerbuilder-pane');",
    indent2 + "    const isObActive = !!(obPane && obPane.classList && obPane.classList.contains('active'));",
    indent2 + '    if (!isObActive) return;',
    indent2 + "    const titleEl = document.getElementById('currentAreaTitle');",
    indent2 + '    if (!titleEl) return;',
    indent2 + "    const tab = this.subTab || 'builder';",
    indent2 + "    if (tab === 'library') titleEl.textContent = 'Offer Library';",
    indent2 + "    else if (tab === 'adframeworks' || tab === 'adresources') titleEl.textContent = 'Ad Frameworks';",
    indent2 + "    else titleEl.textContent = 'Offer Builder';",
    indent2 + ' } catch (_) {}',
    indent + '},',
  ].join(newline);

  const updated = original.replace(re, replacement);
  if (updated === original) die('Replacement resulted in no changes');

  fs.writeFileSync(filePath, updated, 'utf8');
  console.log('OK: patched offerBuilder._renderActiveOfferLabel in', filePath);
}

main();
