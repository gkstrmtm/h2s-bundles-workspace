#!/usr/bin/env node
/*
  Restores the JS/CSS from a specific backup file (dash.html.bak.20260215_102510)
  into frontend/dash.css and frontend/dash.js.

  Why:
  - The current dash.js has "Sidebar" logic for Ad Modules.
  - The backup has "Modal/Popup" logic which the user prefers.
*/

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const frontendDir = path.join(root, 'frontend');
const defaultBackupPath = path.join(frontendDir, 'dash.html.bak.20260215_102510');
const cssPath = path.join(frontendDir, 'dash.css');
const jsPath = path.join(frontendDir, 'dash.js');

function findInDirRecursive(dir, fileName) {
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === fileName) return fullPath;
    if (entry.isDirectory()) {
      const found = findInDirRecursive(fullPath, fileName);
      if (found) return found;
    }
  }
  return null;
}

function resolveBackupPath() {
  const arg = process.argv[2];
  if (arg) {
    const candidate = path.isAbsolute(arg) ? arg : path.join(root, arg);
    if (fs.existsSync(candidate)) return candidate;
    fail(`Backup path arg does not exist: ${candidate}`);
  }

  if (fs.existsSync(defaultBackupPath)) return defaultBackupPath;

  const archiveDir = path.join(root, 'archive', 'dashboard-html');
  const found = findInDirRecursive(archiveDir, 'dash.html.bak.20260215_102510');
  if (found) return found;

  fail(
    `Missing backup file. Tried:\n- ${defaultBackupPath}\n- ${archiveDir}/**/dash.html.bak.20260215_102510\n` +
      'You can also pass an explicit path as the first argument.'
  );
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function findFirstStyleBlock(html) {
  const openIdx = html.indexOf('<style>');
  if (openIdx < 0) return null;
  const openEnd = html.indexOf('>', openIdx);
  if (openEnd < 0) fail('Malformed <style> tag');
  const closeIdx = html.indexOf('</style>', openEnd);
  if (closeIdx < 0) fail('Missing </style> for first <style>');
  
  return {
    start: openIdx,
    end: closeIdx + '</style>'.length,
    contentStart: openEnd + 1,
    contentEnd: closeIdx,
  };
}

function findMainScriptBlock(html) {
  const marker = '// Configuration - H2S Backend API';
  const markerIdx = html.indexOf(marker);
  if (markerIdx < 0) return null;

  const scriptOpenIdx = html.lastIndexOf('<script', markerIdx);
  if (scriptOpenIdx < 0) fail('Could not find <script> start tag for main app script');

  const openEnd = html.indexOf('>', scriptOpenIdx);
  if (openEnd < 0) fail('Malformed <script> tag for main app script');

  const openTag = html.slice(scriptOpenIdx, openEnd + 1);
  if (/\bsrc\s*=\s*/i.test(openTag)) {
      // Ignore
  }

  const scriptCloseIdx = html.indexOf('</script>', openEnd);
  if (scriptCloseIdx < 0) fail('Missing </script> for main app script');

  return {
    start: scriptOpenIdx,
    end: scriptCloseIdx + '</script>'.length,
    contentStart: openEnd + 1,
    contentEnd: scriptCloseIdx,
  };
}

function main() {
  const backupPath = resolveBackupPath();

  console.log(`Reading backup ${backupPath}...`);
  const originalHtmlRaw = fs.readFileSync(backupPath, 'utf8');

  const styleBlock = findFirstStyleBlock(originalHtmlRaw);
  if (!styleBlock) fail('No <style> block found in backup');
  console.log(`Found style block at index ${styleBlock.start}`);

  const scriptBlock = findMainScriptBlock(originalHtmlRaw);
  if (!scriptBlock) fail('Could not find main app script marker in backup');
  console.log(`Found script block at index ${scriptBlock.start}`);

  const cssContent = originalHtmlRaw.slice(styleBlock.contentStart, styleBlock.contentEnd);
  const jsContent = originalHtmlRaw.slice(scriptBlock.contentStart, scriptBlock.contentEnd);

  console.log(`Overwriting ${cssPath}...`);
  fs.writeFileSync(cssPath, cssContent.trim(), 'utf8');
  
  console.log(`Overwriting ${jsPath}...`);
  fs.writeFileSync(jsPath, jsContent.trim(), 'utf8');

  // We DO NOT rewrite dash.html here, because it's already a shell pointing to these files.
  // We just updated the content of the linked files to match the "good" logic.

  console.log('Restoration complete.');
}

main();
