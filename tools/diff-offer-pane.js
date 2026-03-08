const fs = require('fs');

function extractOfferPane(html) {
  const endNeedle = '<!-- End offer builder workspace';
  const end = html.indexOf(endNeedle);
  if (end < 0) throw new Error(`Missing end needle: ${endNeedle}`);

  const idNeedle = 'id="offerbuilder-pane"';
  const idIdx = html.indexOf(idNeedle);
  if (idIdx < 0) throw new Error(`Missing offer pane id: ${idNeedle}`);

  const start = html.lastIndexOf('<div', idIdx);
  if (start < 0) throw new Error('Could not find <div start for offer pane');

  return html.slice(start, end);
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : n;
}

function snippet(s, i, before = 200, after = 500) {
  const start = Math.max(0, i - before);
  const end = Math.min(s.length, i + after);
  return s.slice(start, end).replace(/\s+/g, ' ');
}

const baselinePath = process.argv[2];
const referencePath = process.argv[3];

if (!baselinePath || !referencePath) {
  console.error('Usage: node tools/diff-offer-pane.js <baseline.html> <reference.html>');
  process.exit(2);
}

const baselineHtml = fs.readFileSync(baselinePath, 'utf8');
const referenceHtml = fs.readFileSync(referencePath, 'utf8');

const baselinePane = extractOfferPane(baselineHtml);
const referencePane = extractOfferPane(referenceHtml);

console.log('baseline offer pane chars:', baselinePane.length);
console.log('reference offer pane chars:', referencePane.length);

let offsetA = 0;
let offsetB = 0;

for (let k = 0; k < 3; k++) {
  const a = baselinePane.slice(offsetA);
  const b = referencePane.slice(offsetB);
  const idx = firstDiff(a, b);
  if (idx === -1) {
    console.log('No further diffs (remaining text identical).');
    break;
  }

  const absA = offsetA + idx;
  const absB = offsetB + idx;
  console.log(`\nDiff #${k + 1} at baseline[${absA}] vs ref[${absB}]`);
  console.log('--- baseline snippet ---');
  console.log(snippet(baselinePane, absA));
  console.log('--- reference snippet ---');
  console.log(snippet(referencePane, absB));

  // Advance past this diff region to find another later difference.
  offsetA = absA + 1;
  offsetB = absB + 1;
}
