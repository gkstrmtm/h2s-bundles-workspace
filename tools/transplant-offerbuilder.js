#!/usr/bin/env node
/*
  Transplant ONLY the `const offerBuilder = { ... }` block from a reference dash.js
  into a baseline dash.js, leaving everything else identical to the baseline.

  Usage:
    node tools/transplant-offerbuilder.js <baseline.js> <reference.js> <out.js>

  Defaults:
    baseline:  tools/_remote/baseline_alias_dash_raw.js
    reference: tools/_remote/reference_vercel_dash_raw.js
    out:       frontend/dash.js
*/

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

const baselinePath = path.resolve(repoRoot, process.argv[2] || 'tools/_remote/baseline_alias_dash_raw.js');
const referencePath = path.resolve(repoRoot, process.argv[3] || 'tools/_remote/reference_vercel_dash_raw.js');
const outPath = path.resolve(repoRoot, process.argv[4] || 'frontend/dash.js');

function bail(msg) {
  console.error('ERROR:', msg);
  process.exit(1);
}

function read(p) {
  if (!fs.existsSync(p)) bail(`Missing file: ${p}`);
  return fs.readFileSync(p, 'utf8').replace(/^\uFEFF+/, '');
}

function extractOfferBuilderBlock(src, label) {
  const startNeedle = '        const offerBuilder = {';
  const endNeedle = '        // Expose for inline onclick handlers (HTML attribute scope is not reliable with const bindings).';

  const startIdx = src.indexOf(startNeedle);
  if (startIdx < 0) bail(`[${label}] Could not find offerBuilder start needle`);

  const endIdx = src.indexOf(endNeedle, startIdx);
  if (endIdx < 0) bail(`[${label}] Could not find offerBuilder end needle`);

  const block = src.slice(startIdx, endIdx);
  if (!block.includes('openOfferInFactory') || !block.includes('selectOfferLibraryOffer')) {
    console.warn(`WARN: [${label}] offerBuilder block did not contain expected Offer Library handlers (still proceeding)`);
  }
  return { startIdx, endIdx, block };
}

const baseline = read(baselinePath);
const reference = read(referencePath);

const baseOb = extractOfferBuilderBlock(baseline, 'baseline');
const refOb = extractOfferBuilderBlock(reference, 'reference');

const next = baseline.slice(0, baseOb.startIdx) + refOb.block + baseline.slice(baseOb.endIdx);

// Sanity checks
if (!next.includes('const offerBuilder = {')) bail('Output missing offerBuilder');
if (!next.includes('openOfferInFactory') || !next.includes('setSubTab')) {
  console.warn('WARN: Output missing some expected Offer Builder markers (check manually).');
}

fs.writeFileSync(outPath, next, 'utf8');
console.log('Wrote:', path.relative(repoRoot, outPath));
console.log('Baseline:', path.relative(repoRoot, baselinePath));
console.log('Reference:', path.relative(repoRoot, referencePath));
console.log('Baseline offerBuilder chars:', baseOb.block.length);
console.log('Reference offerBuilder chars:', refOb.block.length);
