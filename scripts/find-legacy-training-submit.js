/* eslint-disable no-console */

const fs = require('fs');

const filePath = 'frontend/dash.js';
const src = fs.readFileSync(filePath, 'utf8');
const lines = src.split(/\r?\n/);

const needles = [
  "document.getElementById('newTrainingURL').value",
  "document.getElementById('newTrainingDuration').value",
  "async function submitNewTraining(event)",
];

for (const needle of needles) {
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(needle)) hits.push(i + 1);
  }

  console.log(`\nNEEDLE: ${needle}`);
  console.log(`  count: ${hits.length}`);
  console.log(`  hits:  ${hits.slice(0, 50).join(', ')}`);

  for (const ln of hits.slice(0, 5)) {
    const start = Math.max(1, ln - 8);
    const end = Math.min(lines.length, ln + 12);
    console.log(`\n  --- context around ${filePath}:${ln} ---`);
    for (let i = start; i <= end; i++) {
      const prefix = i === ln ? '>>' : '  ';
      const raw = lines[i - 1];
      console.log(`${prefix} ${String(i).padStart(6, ' ')} | ${raw}`);
      if (i === ln) {
        console.log(`     RAW_JSON: ${JSON.stringify(raw)}`);
        const lead = (raw.match(/^[\t ]*/)||[''])[0];
        console.log(`     LEADING: spaces=${(lead.match(/ /g)||[]).length} tabs=${(lead.match(/\t/g)||[]).length} totalLeadChars=${lead.length} lineLen=${raw.length}`);

        try {
          const hex = Buffer.from(raw, 'utf8').toString('hex');
          console.log(`     HEX: ${hex}`);
        } catch (_) {}

        const crIdx = raw.indexOf('\r');
        const lfIdx = raw.indexOf('\n');
        if (crIdx >= 0 || lfIdx >= 0) {
          console.log(`     HAS_CRLF_IN_LINE: crIdx=${crIdx} lfIdx=${lfIdx}`);
        }

        const specials = [
          { name: 'U+2028', ch: '\u2028' },
          { name: 'U+2029', ch: '\u2029' },
          { name: 'U+FEFF', ch: '\uFEFF' },
        ];

        for (const s of specials) {
          const idx = raw.indexOf(s.ch);
          if (idx >= 0) {
            console.log(`     HAS_SPECIAL: ${s.name} at index ${idx}`);
          }
        }

        // Also report any control chars < 0x20 (except tab) to catch invisible breakage.
        const ctrl = [];
        for (let k = 0; k < raw.length; k++) {
          const code = raw.charCodeAt(k);
          if (code < 0x20 && code !== 0x09) ctrl.push({ idx: k, code });
        }
        if (ctrl.length) {
          console.log(`     CONTROL_CHARS: ${JSON.stringify(ctrl.slice(0, 20))}${ctrl.length > 20 ? ' ...' : ''}`);
        }
      }
    }
  }
}
