const fs = require('fs');

function readUtf8NoBom(p) {
  const raw = fs.readFileSync(p);
  const s = raw.toString('utf8');
  return s.replace(/^\uFEFF+/, '');
}

function extractOfferPane(html) {
  const endNeedle = '<!-- End offer builder workspace';
  const end = html.indexOf(endNeedle);
  if (end < 0) throw new Error(`Missing end needle: ${endNeedle}`);

  const idNeedle = 'id="offerbuilder-pane"';
  const idIdx = html.indexOf(idNeedle);
  if (idIdx < 0) throw new Error(`Missing offer pane id: ${idNeedle}`);

  const start = html.lastIndexOf('<div', idIdx);
  if (start < 0) throw new Error('Could not find <div start for offer pane');

  return { start, end, pane: html.slice(start, end) };
}

const baselinePath = process.argv[2];
const referencePath = process.argv[3];

if (!baselinePath || !referencePath) {
  console.error('Usage: node tools/transplant-offer-pane.js <baseline.html> <reference.html>');
  process.exit(2);
}

const baselineHtml = readUtf8NoBom(baselinePath);
const referenceHtml = readUtf8NoBom(referencePath);

const b = extractOfferPane(baselineHtml);
const r = extractOfferPane(referenceHtml);

const out = baselineHtml.slice(0, b.start) + r.pane + baselineHtml.slice(b.end);

fs.writeFileSync(baselinePath, out.replace(/^\uFEFF+/, ''), 'utf8');

console.log('Transplanted offer pane.');
console.log('baseline pane chars:', b.pane.length);
console.log('reference pane chars:', r.pane.length);
console.log('output chars:', out.length);
