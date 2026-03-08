const fs = require('fs');

const paths = [
  'frontend/dash.PORTAL_BUILD_20260225_171447_4809419.js',
  'frontend/dash.js',
];

function scan(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const lines = code.split(/\r?\n/);

  const findAll = (needle) => {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(needle)) out.push(i + 1);
    }
    return out;
  };

  const findRegex = (regex) => {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) out.push(i + 1);
    }
    return out;
  };

  console.log(`\n=== ${filePath} ===`);
  console.log('bytes', code.length, 'lines', lines.length);

  try {
    // eslint-disable-next-line no-new-func
    new Function(code);
    console.log('PARSE: OK');
  } catch (e) {
    console.log('PARSE: FAIL', (e && e.message) || String(e));
  }

  const editDefs = findRegex(/(^|\s)(async\s+)?function\s+editTraining\b/);
  console.log('editTraining defs:', editDefs.length, 'at', editDefs.slice(0, 10));

  console.log('stub text lines:', findAll('Edit functionality coming soon'));
  console.log('loading details lines:', findAll('Loading details'));

  const resetDefs = findRegex(/function\s+resetTrainingForm\b/);
  console.log('resetTrainingForm defs:', resetDefs.length, 'at', resetDefs.slice(0, 10));

  console.log('legacy btn=form.querySelector lines:', findAll('const btn = form.querySelector'));

  return code;
}

const a = scan(paths[0]);
const b = scan(paths[1]);
console.log(`\nA == dash.js ? ${a === b}`);
