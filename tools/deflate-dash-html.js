#!/usr/bin/env node
/*
  Deflates frontend/dash.html by extracting the huge inline <style> and bottom <script>
  into frontend/dash.css and frontend/dash.js, then rewriting dash.html to reference them.

  Safe behavior:
  - Writes a timestamped backup of dash.html next to the file.
  - Overwrites dash.css and dash.js from the inline content so behavior stays identical.
*/

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const dashHtmlPath = path.join(repoRoot, 'frontend', 'dash.html');
const dashCssPath = path.join(repoRoot, 'frontend', 'dash.css');
const dashJsPath = path.join(repoRoot, 'frontend', 'dash.js');

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join('');
}

function findContainingTagBlockByMarker(html, tagName, marker, withinStart = 0, withinEnd = html.length) {
  const lower = html.toLowerCase();
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;
  if (markerIndex < withinStart || markerIndex >= withinEnd) return null;

  const tagOpenNeedle = `<${tagName}`;
  const tagCloseNeedle = `</${tagName}>`;

  const openIndex = lower.lastIndexOf(tagOpenNeedle, markerIndex);
  if (openIndex < withinStart) return null;

  const openTagEnd = lower.indexOf('>', openIndex);
  if (openTagEnd < 0 || openTagEnd >= withinEnd) return null;
  const contentStart = openTagEnd + 1;

  const closeIndex = lower.indexOf(tagCloseNeedle, markerIndex);
  if (closeIndex < 0 || closeIndex >= withinEnd) return null;

  const content = html.slice(contentStart, closeIndex);
  return {
    openIndex,
    closeIndex: closeIndex + tagCloseNeedle.length,
    content,
  };
}

function findLargestInlineTagBlock(html, tagName, withinStart = 0, withinEnd = html.length) {
  const lower = html.toLowerCase();
  const openNeedle = `<${tagName}`;
  const closeNeedle = `</${tagName}>`;

  let cursor = withinStart;
  let best = null;

  while (cursor < withinEnd) {
    const openIndex = lower.indexOf(openNeedle, cursor);
    if (openIndex < 0 || openIndex >= withinEnd) break;

    const openTagEnd = lower.indexOf('>', openIndex);
    if (openTagEnd < 0 || openTagEnd >= withinEnd) break;
    const contentStart = openTagEnd + 1;

    const closeIndex = lower.indexOf(closeNeedle, contentStart);
    if (closeIndex < 0 || closeIndex >= withinEnd) break;

    const content = html.slice(contentStart, closeIndex);
    const candidate = {
      openIndex,
      closeIndex: closeIndex + closeNeedle.length,
      content,
    };

    if (!best || candidate.content.length > best.content.length) best = candidate;
    cursor = closeIndex + closeNeedle.length;
  }

  return best;
}

function writeFileUtf8(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: 'utf8' });
}

function main() {
  if (!fs.existsSync(dashHtmlPath)) {
    console.error(`ERROR: Missing ${dashHtmlPath}`);
    process.exit(1);
  }

  const before = fs.readFileSync(dashHtmlPath, 'utf8');
  const beforeLines = before.split(/\r?\n/).length;

  const headStart = before.search(/<head\b/i);
  const headEnd = before.search(/<\/head>/i);
  const headWithinStart = headStart >= 0 ? headStart : 0;
  const headWithinEnd = headEnd >= 0 ? headEnd : before.length;

  // CSS: extract the big head inline CSS block.
  let cssBlock = findContainingTagBlockByMarker(before, 'style', 'CRITICAL CSS', headWithinStart, headWithinEnd);
  if (!cssBlock) {
    cssBlock = findLargestInlineTagBlock(before, 'style', headWithinStart, headWithinEnd);
  }

  // JS: extract the large bottom script (the one that defines API_BASE/API_URL etc).
  // Important: do NOT extract the tiny head script (console filtering / about badge),
  // because it needs to stay in <head>.
  let jsBlock = findContainingTagBlockByMarker(before, 'script', '// Configuration - H2S Backend API');
  if (!jsBlock) {
    const appEndIndex = before.indexOf('<!-- End #h2s-app -->');
    const searchStart = appEndIndex >= 0 ? appEndIndex : 0;
    jsBlock = findLargestInlineTagBlock(before, 'script', searchStart, before.length);
  }

  if (!cssBlock && !jsBlock) {
    console.log('OK: Nothing to deflate (no large inline <style>/<script> blocks found).');
    return;
  }

  const backupPath = `${dashHtmlPath}.bak.${nowStamp()}`;
  writeFileUtf8(backupPath, before);

  // Normalize extracted contents slightly:
  // - Remove a single leading newline if present (keeps files nicer)
  const extractedCss = cssBlock ? cssBlock.content.replace(/^\r?\n/, '') : null;
  const extractedJs = jsBlock ? jsBlock.content.replace(/^\r?\n/, '') : null;

  if (extractedCss) {
    writeFileUtf8(
      dashCssPath,
      `/* Auto-extracted from dash.html to reduce HTML size. */\n\n${extractedCss}`
    );
  }
  if (extractedJs) {
    writeFileUtf8(
      dashJsPath,
      `// Auto-extracted from dash.html to reduce HTML size.\n\n${extractedJs}`
    );
  }

  // Rewrite dash.html with external references.
  const cssReplacement = `\n    <!-- Extracted CSS to reduce file size -->\n    <link rel=\"stylesheet\" href=\"/dash.css\">\n`;
  const jsReplacement = `\n    <!-- Extracted JS to reduce file size -->\n    <script src=\"/dash.js\"></script>\n`;

  let rewritten = before;

  const blocks = [];
  if (cssBlock) blocks.push({ ...cssBlock, replacement: cssReplacement });
  if (jsBlock) blocks.push({ ...jsBlock, replacement: jsReplacement });

  // Replace from back to front to keep indices valid.
  blocks.sort((a, b) => b.openIndex - a.openIndex);
  for (const b of blocks) {
    rewritten = rewritten.slice(0, b.openIndex) + b.replacement + rewritten.slice(b.closeIndex);
  }

  // Cleanup: avoid duplicate links/scripts.
  const dupCssRe = new RegExp('(<link\\s+[^>]*href=["\\\']\\/dash\\.css["\\\'][^>]*>\\s*){2,}', 'gi');
  const dupJsRe = new RegExp('(<script\\s+[^>]*src=["\\\']\\/dash\\.js["\\\'][^>]*>\\s*<\\/script>\\s*){2,}', 'gi');
  rewritten = rewritten.replace(dupCssRe, '<link rel="stylesheet" href="/dash.css">\n');
  rewritten = rewritten.replace(dupJsRe, '<script src="/dash.js"></script>\n');

  writeFileUtf8(dashHtmlPath, rewritten);

  const afterLines = rewritten.split(/\r?\n/).length;

  console.log('OK: Deflated dash.html');
  console.log(`- Backup: ${path.relative(repoRoot, backupPath)}`);
  if (extractedCss) console.log(`- Wrote:  ${path.relative(repoRoot, dashCssPath)} (${extractedCss.split(/\r?\n/).length} lines extracted)`);
  if (extractedJs) console.log(`- Wrote:  ${path.relative(repoRoot, dashJsPath)} (${extractedJs.split(/\r?\n/).length} lines extracted)`);
  console.log(`- Lines:  ${beforeLines} -> ${afterLines}`);
}

main();
