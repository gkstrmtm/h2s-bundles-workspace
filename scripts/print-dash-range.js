/* eslint-disable no-console */

const fs = require('fs');

const filePath = 'frontend/dash.js';
const start = Number(process.argv[2] || 20440);
const end = Number(process.argv[3] || 20540);

const src = fs.readFileSync(filePath, 'utf8');
const lines = src.split(/\r?\n/);

for (let i = start; i <= end; i++) {
  const line = lines[i - 1];
  if (line === undefined) break;
  console.log(`${String(i).padStart(6, ' ')} | ${line}`);
}
