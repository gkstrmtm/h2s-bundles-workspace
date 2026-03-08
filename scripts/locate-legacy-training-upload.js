/* eslint-disable no-console */

const fs = require('fs');

const filePath = 'frontend/dash.js';
const src = fs.readFileSync(filePath, 'utf8');
const needles = [
  "url: document.getElementById('newTrainingURL').value",
  "document.getElementById('newTrainingURL').value",
  "newTrainingURL').value",
  "newTrainingDuration').value",
  "title: document.getElementById('newTrainingTitle').value"
];

for (const needle of needles) {
  const idx = src.indexOf(needle);
  console.log('\nNEEDLE:', needle);
  console.log('  found:', idx >= 0);
  if (idx < 0) continue;

  const before = src.slice(0, idx);
  const line = before.split(/\r?\n/).length; // 1-based
  const lastNewline = Math.max(before.lastIndexOf('\n'), before.lastIndexOf('\r'));
  const col = idx - (lastNewline >= 0 ? lastNewline + 1 : 0) + 1;

  console.log(`  at: ${filePath}:${line}:${col}`);

  const lines = src.split(/\r?\n/);
  const start = Math.max(1, line - 5);
  const end = Math.min(lines.length, line + 5);

  for (let i = start; i <= end; i++) {
    const prefix = i === line ? '>>' : '  ';
    console.log(`${prefix} ${String(i).padStart(6, ' ')} | ${lines[i - 1]}`);
  }
}
