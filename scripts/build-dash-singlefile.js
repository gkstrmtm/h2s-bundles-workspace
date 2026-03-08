/*
  Build a single-file dashboard HTML for backend/public.

  Why:
  - Editing very large consolidated .html files can cause VS Code (renderer) OOM crashes.
  - Keep editable sources split (frontend/dash.html + frontend/dash.css + frontend/dash.js).
  - Generate the consolidated artifact only when needed.

  Usage:
    node scripts/build-dash-singlefile.js

  Output:
    backend/public/dash.html
*/

const fs = require('fs');
const path = require('path');

function readUtf8OrThrow(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function ensureDirExists(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeNewlines(s) {
  return String(s).replace(/\r\n/g, '\n');
}

function injectInlineCss(html, hrefRegex, cssText, styleId) {
  const styleTag = `\n    <style id="${styleId}">\n${cssText}\n    </style>\n`;
  const before = html;
  const next = html.replace(hrefRegex, styleTag);
  if (next === before) {
    throw new Error(`Failed to replace CSS link for ${styleId}`);
  }
  return next;
}

function injectInlineJs(html, srcRegex, jsText, scriptId) {
  // Put the inline script where the stamped <script src="..."> was.
  // Note: we do NOT keep defer; it will execute immediately at that position in the HTML.
  const scriptTag = `\n    <script id="${scriptId}">\n${jsText}\n    </script>\n`;
  const before = html;
  const next = html.replace(srcRegex, scriptTag);
  if (next === before) {
    throw new Error(`Failed to replace JS script src for ${scriptId}`);
  }
  return next;
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');

  const inputHtmlPath = path.join(repoRoot, 'frontend', 'dash.html');
  const dashCssPath = path.join(repoRoot, 'frontend', 'dash.css');
  const dashJsPath = path.join(repoRoot, 'frontend', 'dash.js');

  const designSystemCandidates = [
    path.join(repoRoot, 'frontend', 'dashboard-design-system.css'),
    path.join(repoRoot, 'dashboard-design-system.css')
  ];
  const designSystemPath = designSystemCandidates.find(p => fs.existsSync(p));
  if (!designSystemPath) {
    throw new Error('Missing dashboard-design-system.css (checked frontend/ and repo root)');
  }

  let html = normalizeNewlines(readUtf8OrThrow(inputHtmlPath));
  const dashCss = normalizeNewlines(readUtf8OrThrow(dashCssPath));
  const dashJs = normalizeNewlines(readUtf8OrThrow(dashJsPath));
  const designCss = normalizeNewlines(readUtf8OrThrow(designSystemPath));

  // Replace:
  //   <link rel="stylesheet" href="/dashboard-design-system.css">
  // with an inline <style>.
  html = injectInlineCss(
    html,
    /\s*<link\s+rel=["']stylesheet["']\s+href=["']\/dashboard-design-system\.css["']\s*>\s*/i,
    designCss,
    'h2s-inline-design-system'
  );

  // Replace stamped dash css, e.g.
  //   <link rel="stylesheet" href="/dash.PORTAL_BUILD_....css">
  // with inline dash.css.
  html = injectInlineCss(
    html,
    /\s*<link\s+rel=["']stylesheet["']\s+href=["']\/dash\.PORTAL_BUILD_[A-Za-z0-9_]+\.css["']\s*>\s*/i,
    dashCss,
    'h2s-inline-dash-css'
  );

  // Replace stamped dash js, e.g.
  //   <script src="/dash.PORTAL_BUILD_....js" defer></script>
  // with inline dash.js.
  html = injectInlineJs(
    html,
    /\s*<script\s+src=["']\/dash\.PORTAL_BUILD_[A-Za-z0-9_]+\.js["']\s+defer\s*>\s*<\/script>\s*/i,
    dashJs,
    'h2s-inline-dash-js'
  );

  // Write output.
  const outPath = path.join(repoRoot, 'backend', 'public', 'dash.html');
  ensureDirExists(path.dirname(outPath));
  fs.writeFileSync(outPath, html.replace(/\n/g, '\r\n'), 'utf8');

  const outBytes = fs.statSync(outPath).size;
  process.stdout.write(`OK: wrote backend/public/dash.html (${outBytes} bytes)\n`);
}

main();
