const fs = require('fs');
const path = require('path');

const filePath = process.argv[2] || path.join('Home2Smart-Dashboard', 'portal.html');
const s = fs.readFileSync(filePath, 'utf8');

const re = /\bGET\(\s*['\"]([^'\"]+)['\"]/g;
const set = new Set();
let m;
while ((m = re.exec(s))) set.add(m[1]);

const arr = [...set].sort();
console.log('portal actions count:', arr.length);
console.log(arr.join('\n'));
