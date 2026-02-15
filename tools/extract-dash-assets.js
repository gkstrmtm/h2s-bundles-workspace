#!/usr/bin/env node
/*
  Extracts the large inline <style> and main inline <script> from frontend/dash.html
  into frontend/dash.css and frontend/dash.js, then rewrites dash.html to reference them.

  Why:
  - dash.html is ~46k lines and slows down VS Code.

  Safety:
  - Only touches the FIRST <style> block (head critical css) and the main app <script>
    block that contains the marker string "// Configuration - H2S Backend API".
*/

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const frontendDir = path.join(root, 'frontend');
const htmlPath = path.join(frontendDir, 'dash.html');
const cssPath = path.join(frontendDir, 'dash.css');
const jsPath = path.join(frontendDir, 'dash.js');

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
    fail('Main app script appears to be an external <script src=...>; refusing to extract');
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

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, '\n');
}

function main() {
  if (!fs.existsSync(htmlPath)) fail(`Missing ${htmlPath}`);

  const originalHtmlRaw = fs.readFileSync(htmlPath, 'utf8');
  const originalHtml = normalizeNewlines(originalHtmlRaw);

  const styleBlock = findFirstStyleBlock(originalHtml);
  if (!styleBlock) fail('No <style> block found in dash.html');

  const scriptBlock = findMainScriptBlock(originalHtml);
  if (!scriptBlock) fail('Could not find main app script marker in dash.html');

  const cssContent = originalHtml.slice(styleBlock.contentStart, styleBlock.contentEnd);
  const jsContent = originalHtml.slice(scriptBlock.contentStart, scriptBlock.contentEnd);

  // Write extracted assets
  fs.writeFileSync(cssPath, cssContent.trimStart().replace(/\n+$/g, '\n'), 'utf8');
  fs.writeFileSync(jsPath, jsContent.trimStart().replace(/\n+$/g, '\n'), 'utf8');

  // Rewrite HTML: replace first <style> with link, and main script with external script.
  let rewritten = originalHtml;

  rewritten =
    rewritten.slice(0, styleBlock.start) +
    '    <link rel="stylesheet" href="./dash.css">\n' +
    rewritten.slice(styleBlock.end);

  // Because we changed string length, re-find script block in the rewritten html.
  const scriptBlock2 = findMainScriptBlock(rewritten);
  if (!scriptBlock2) fail('After rewriting CSS, could not re-locate main app script block');

  rewritten =
    rewritten.slice(0, scriptBlock2.start) +
    '    <script src="./dash.js" defer></script>\n' +
    rewritten.slice(scriptBlock2.end);

  // Preserve original newline style as CRLF for Windows (matches repo file style)
  const finalHtml = rewritten.replace(/\n/g, '\r\n');
  fs.writeFileSync(htmlPath, finalHtml, 'utf8');

  const oldLineCount = originalHtml.split('\n').length;
  const newLineCount = rewritten.split('\n').length;

  console.log('OK: Extracted inline assets');
  console.log(`- Wrote: ${path.relative(root, cssPath)} (${cssContent.length} chars)`);
  console.log(`- Wrote: ${path.relative(root, jsPath)} (${jsContent.length} chars)`);
  console.log(`- Rewrote: ${path.relative(root, htmlPath)} (lines ${oldLineCount} -> ${newLineCount})`);
}

main();
