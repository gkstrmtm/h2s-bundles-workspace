const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { assertNoTemplateTokens } = require('./portal-template-check.cjs');

function extractPortal(originalHtml) {
  const dom = new JSDOM(originalHtml, { includeNodeLocations: true });
  try {
    const styles = [...dom.window.document.querySelectorAll('style')];
    const scripts = [...dom.window.document.querySelectorAll('script:not([src])')]
      .sort((a, b) => b.textContent.length - a.textContent.length);
    if (!styles.length) throw Error('No HTML style blocks found in portal source');
    if (!scripts.length) throw Error('No inline application script found in portal source');
    const mainScript = scripts[0], location = dom.nodeLocation(mainScript);
    const js = '// Auto-extracted from portal.html to reduce HTML size.\n' +
      originalHtml.slice(location.startTag.endOffset, location.endTag.startOffset).replace(/^\n+/, '');
    const css = '/* Auto-extracted from portal.html to reduce HTML size. */\n' +
      styles.map((style, index) => `\n/* ---- inline style block ${index + 1} ---- */\n${style.textContent.trimEnd()}\n`).join('\n');
    const replacements = styles.map((style, index) => ({
      ...dom.nodeLocation(style), content: index ? '' : '<link rel="stylesheet" href="./dash.css">'
    }));
    replacements.push({ ...location, content: '<script src="./dash.js" defer></script>' });
    let html = originalHtml;
    for (const replacement of replacements.sort((a, b) => b.startOffset - a.startOffset)) {
      html = html.slice(0, replacement.startOffset) + replacement.content + html.slice(replacement.endOffset);
    }
    for (const [name, content] of Object.entries({html, css, js})) assertNoTemplateTokens(content, name);
    return { html, css, js };
  } finally { dom.window.close(); }
}

function main() {
  const portalPath = path.join('frontend', 'portal.html');
  const result = extractPortal(fs.readFileSync(portalPath, 'utf8'));
  for (const [filename, content] of [['dash.css', result.css], ['dash.js', result.js],
    ['dash.html', result.html], ['portal.html', result.html]]) {
    const output = path.join('frontend', filename);
    fs.writeFileSync(output, content, 'utf8');
    console.log('Wrote:', output, { bytes: fs.statSync(output).size });
  }
}
if (require.main === module) main();
module.exports = { extractPortal };
