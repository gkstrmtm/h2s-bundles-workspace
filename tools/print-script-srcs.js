#!/usr/bin/env node

const fs = require('fs');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node tools/print-script-srcs.js <path-to-html>');
  process.exit(2);
}

const html = fs.readFileSync(filePath, 'utf8');
const re = /<script[^>]+src="([^"]+)"/gi;
let m;
const srcs = [];
while ((m = re.exec(html))) srcs.push(m[1]);

console.log('script src count', srcs.length);
for (const s of srcs) console.log(s);
