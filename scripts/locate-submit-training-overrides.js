/* eslint-disable no-console */

const fs = require('fs');

const filePath = 'frontend/dash.js';
const src = fs.readFileSync(filePath, 'utf8');
const lines = src.split(/\r?\n/);

function printAround(lineNo, radius = 12) {
  const start = Math.max(1, lineNo - radius);
  const end = Math.min(lines.length, lineNo + radius);
  for (let i = start; i <= end; i++) {
    const prefix = i === lineNo ? '>>' : '  ';
    console.log(`${prefix} ${String(i).padStart(6, ' ')} | ${lines[i - 1]}`);
  }
}

const needles = [
  "window.submitNewTraining = async function submitNewTraining",
  "window.submitNewTraining = submitNewTrainingV2",
  "async function submitNewTrainingV2",
  "async function submitNewTraining(event)",
  "function submitNewTraining(event)",
  "document.addEventListener('DOMContentLoaded'",
  'document.addEventListener("DOMContentLoaded"'
];

for (const needle of needles) {
  const idx = src.indexOf(needle);
  console.log('\nNEEDLE:', needle);
  console.log('  found:', idx >= 0);
  if (idx < 0) continue;
  const before = src.slice(0, idx);
  const line = before.split(/\r?\n/).length;
  console.log(`  at: ${filePath}:${line}`);
  printAround(line);
}
