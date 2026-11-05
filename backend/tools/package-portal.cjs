'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_ROOT = path.resolve(__dirname, '..', '..');
const BACKEND_ORIGIN = 'https://h2s-backend.vercel.app';
const ASSETS = Object.freeze([
  'frontend/field-workflow.css',
  'frontend/field-installation.js',
]);

function packagePortal({ outputDir, sourceRoot = SOURCE_ROOT } = {}) {
  if (!outputDir) throw new Error('An explicit outputDir is required');
  const output = path.resolve(outputDir);
  const root = path.resolve(sourceRoot);
  const sourceFiles = ['portal.html', ...ASSETS];
  for (const relative of sourceFiles) {
    const source = path.join(root, ...relative.split('/'));
    if (source === output || source.startsWith(output + path.sep)) {
      throw new Error('Output must not contain the canonical sources');
    }
  }

  // Read every input before writing anything; a missing dependency must fail the build.
  let html = fs.readFileSync(path.join(root, 'portal.html'), 'utf8');
  const assets = ASSETS.map(relative => ({
    relative,
    content: fs.readFileSync(path.join(root, ...relative.split('/'))),
  }));
  for (const { relative } of assets) {
    const reference = `./${relative}`;
    if (html.split(`"${reference}"`).length !== 2) {
      throw new Error(`Expected exactly one canonical asset reference: ${reference}`);
    }
    // The portal-domain catchall serves HTML even for same-origin asset requests.
    html = html.replace(`"${reference}"`, `"${BACKEND_ORIGIN}/${relative}"`);
  }

  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'portal.html'), html, 'utf8');
  for (const { relative, content } of assets) {
    const destination = path.join(output, ...relative.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  return sourceFiles;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--output' || !args[1])) {
      throw new Error('Usage: node tools/package-portal.cjs [--output <directory>]');
    }
    const outputDir = args.length ? args[1] : path.resolve(__dirname, '..', 'public');
    const files = packagePortal({ outputDir });
    console.log(`Packaged ${files.length} portal files into ${path.resolve(outputDir)}`);
  } catch (error) {
    console.error(`Portal packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { packagePortal, ASSETS, BACKEND_ORIGIN };
