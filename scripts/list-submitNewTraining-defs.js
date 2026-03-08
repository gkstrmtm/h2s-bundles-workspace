/* eslint-disable no-console */

const fs = require('fs');

const filePath = 'frontend/dash.js';
const src = fs.readFileSync(filePath, 'utf8');
const lines = src.split(/\r?\n/);

const needle = 'async function submitNewTraining(event)';

const hits = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes(needle)) hits.push(i + 1);
}

console.log(`Found ${hits.length} occurrences of: ${needle}`);
for (const ln of hits) {
  console.log(`- ${filePath}:${ln}`);
  const start = Math.max(1, ln - 3);
  const end = Math.min(lines.length, ln + 15);
  for (let i = start; i <= end; i++) {
    const prefix = i === ln ? '>>' : '  ';
    console.log(`${prefix} ${String(i).padStart(6,' ')} | ${lines[i-1]}`);
  }
  console.log('');
}
