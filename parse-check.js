const fs = require('fs');

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node parse-check.js <file1> [file2 ...]');
  process.exit(2);
}

let hadError = false;
for (const file of files) {
  try {
    const code = fs.readFileSync(file, 'utf8');
    // eslint-disable-next-line no-new-func
    new Function(code);
    console.log(`${file}: OK`);
  } catch (err) {
    hadError = true;
    console.error(`${file}: FAIL`);
    console.error(err && err.stack ? err.stack : String(err));
  }
}

process.exit(hadError ? 1 : 0);
