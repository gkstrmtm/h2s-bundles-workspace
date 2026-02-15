const fs = require('fs');
const path = require('path');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const portalPath = path.join('frontend', 'portal.html');
if (!fs.existsSync(portalPath)) fail('Missing frontend/portal.html');

const originalHtml = fs.readFileSync(portalPath, 'utf8');

// Extract all <style> blocks.
const styleRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const styles = [];
let styleMatch;
while ((styleMatch = styleRegex.exec(originalHtml)) !== null) {
  styles.push(styleMatch[1]);
}
if (styles.length === 0) fail('No <style> blocks found in frontend/portal.html');

// Remove style blocks but keep a placeholder where the first one was.
let html = originalHtml.replace(styleRegex, '%%H2S_STYLE_PLACEHOLDER%%');
html = html.replace(/(?:\s*%%H2S_STYLE_PLACEHOLDER%%\s*)+/g, '\n    %%H2S_STYLE_PLACEHOLDER%%\n');

// Extract inline <script> blocks without src.
const inlineScriptRegex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const inlineScripts = [];
let scriptMatch;
while ((scriptMatch = inlineScriptRegex.exec(html)) !== null) {
  inlineScripts.push({
    full: scriptMatch[0],
    content: scriptMatch[1],
  });
}
if (inlineScripts.length === 0) fail('No inline <script> blocks found in frontend/portal.html');

// Choose the largest inline script as the main app script (leave small head bootstrap inline).
inlineScripts.sort((a, b) => b.content.length - a.content.length);
const mainScript = inlineScripts[0];

const dashCssPath = path.join('frontend', 'dash.css');
const dashJsPath = path.join('frontend', 'dash.js');
const dashHtmlPath = path.join('frontend', 'dash.html');

const cssBanner = '/* Auto-extracted from portal.html to reduce HTML size. */\n';
const cssContent =
  cssBanner +
  styles
    .map((s, i) => `\n/* ---- inline style block ${i + 1} ---- */\n${s.trimEnd()}\n`)
    .join('\n');

const jsBanner = '// Auto-extracted from portal.html to reduce HTML size.\n';
const jsContent = jsBanner + mainScript.content.replace(/^\n+/, '');

fs.writeFileSync(dashCssPath, cssContent, 'utf8');
fs.writeFileSync(dashJsPath, jsContent, 'utf8');

// Rewrite HTML: insert link tag, replace main script with external script tag.
let newHtml = html;
newHtml = newHtml.replace('%%H2S_STYLE_PLACEHOLDER%%', '    <link rel="stylesheet" href="./dash.css">');
newHtml = newHtml.replace(mainScript.full, '<script src="./dash.js" defer></script>');
newHtml = newHtml.replace(/%%H2S_STYLE_PLACEHOLDER%%/g, '');

// Write both dash.html (source) and portal.html (deploy entry) to the same smaller HTML.
fs.writeFileSync(dashHtmlPath, newHtml, 'utf8');
fs.writeFileSync(portalPath, newHtml, 'utf8');

function stat(p) {
  const st = fs.statSync(p);
  const lines = fs.readFileSync(p, 'utf8').split(/\r\n|\n|\r/).length;
  return { bytes: st.size, lines };
}

console.log('Wrote:');
console.log(' -', dashHtmlPath, stat(dashHtmlPath));
console.log(' -', portalPath, stat(portalPath));
console.log(' -', dashCssPath, stat(dashCssPath));
console.log(' -', dashJsPath, stat(dashJsPath));
