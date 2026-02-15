#!/usr/bin/env node
/*
  Extracts the large inline <style> and main inline <script> from Dash.html (root)
  into Dash.css and Dash.js, then rewrites Dash.html to reference them.

  Why:
  - Dash.html is ~35k lines and slows down VS Code.
*/

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'Dash.html');
const cssPath = path.join(root, 'Dash.css');
const jsPath = path.join(root, 'Dash.js');

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
  
  // Check if this style block is significant size (e.g. > 1000 chars) or if it's the main one
  // The first style block in Dash.html seems to be the main one based on file read.
  
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
  // Basic check for src
  if (/\bsrc\s*=\s*/i.test(openTag)) {
     // If it has src, we can't extract it. But wait, maybe the marker is inside a script that HAS src? Unlikely.
     // If marker is inside, it's inline code.
     // But sometimes <script src="..."> // code </script> is valid but ignored? No. 
     // We will trust the check.
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
  
  console.log(`Reading ${htmlPath}...`);
  const originalHtmlRaw = fs.readFileSync(htmlPath, 'utf8');
  // Keep original line endings if possible, but simplest is to normalize to verify split.
  // Actually, let's NOT normalize newlines globally to preserve existing format of untouched parts.
  const originalHtml = originalHtmlRaw; 

  const styleBlock = findFirstStyleBlock(originalHtml);
  if (!styleBlock) fail('No <style> block found in Dash.html');
  console.log(`Found style block at index ${styleBlock.start}, length ${styleBlock.end - styleBlock.start}`);

  const scriptBlock = findMainScriptBlock(originalHtml);
  if (!scriptBlock) fail('Could not find main app script marker in Dash.html');
  console.log(`Found script block at index ${scriptBlock.start}, length ${scriptBlock.end - scriptBlock.start}`);

  const cssContent = originalHtml.slice(styleBlock.contentStart, styleBlock.contentEnd);
  const jsContent = originalHtml.slice(scriptBlock.contentStart, scriptBlock.contentEnd);

  console.log(`Writing ${cssPath}...`);
  fs.writeFileSync(cssPath, cssContent.trim(), 'utf8');
  
  console.log(`Writing ${jsPath}...`);
  fs.writeFileSync(jsPath, jsContent.trim(), 'utf8');

  // Rewrite HTML
  // construct new html. 
  // IMPORTANT: The order matters. 
  // If style comes before script (likely), we replace style first, then calculate shift?
  // Easier: replace last one first.
  
  let blocks = [
      { ...styleBlock, type: 'style' },
      { ...scriptBlock, type: 'script' }
  ].sort((a, b) => b.start - a.start); // descending order

  let rewritten = originalHtml;

  for (const block of blocks) {
      const replacement = block.type === 'style' 
          ? '    <link rel="stylesheet" href="./Dash.css">' 
          : '    <script src="./Dash.js"></script>';
          
      rewritten = rewritten.slice(0, block.start) + replacement + rewritten.slice(block.end);
  }
  
  // Backup
  fs.copyFileSync(htmlPath, htmlPath + '.bak');
  console.log(`Backed up original to ${htmlPath}.bak`);

  console.log(`Writing new ${htmlPath}...`);
  fs.writeFileSync(htmlPath, rewritten, 'utf8');
  console.log('Done.');
}

main();
