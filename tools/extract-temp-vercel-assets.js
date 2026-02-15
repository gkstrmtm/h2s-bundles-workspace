#!/usr/bin/env node
/*
  Extracts the large inline <style> and main inline <script> from frontend/temp_vercel_dash.html
  into frontend/temp-vercel-dash.css and frontend/temp-vercel-dash.js, 
  then rewrites temp_vercel_dash.html to reference them.
*/

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const frontendDir = path.join(root, 'frontend');
const htmlPath = path.join(frontendDir, 'temp_vercel_dash.html');
const cssPath = path.join(frontendDir, 'temp-vercel-dash.css');
const jsPath = path.join(frontendDir, 'temp-vercel-dash.js');

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
     // No op
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
  if (!fs.existsSync(htmlPath)) fail(`Missing ${htmlPath}`);
  
  console.log(`Reading ${htmlPath}...`);
  const originalHtmlRaw = fs.readFileSync(htmlPath, 'utf8');
  // Keep strict content
  const originalHtml = originalHtmlRaw;

  const styleBlock = findFirstStyleBlock(originalHtml);
  if (!styleBlock) fail('No <style> block found');
  console.log(`Found style block at index ${styleBlock.start}, length ${styleBlock.end - styleBlock.start}`);

  const scriptBlock = findMainScriptBlock(originalHtml);
  if (!scriptBlock) fail('Could not find main app script marker');
  console.log(`Found script block at index ${scriptBlock.start}, length ${scriptBlock.end - scriptBlock.start}`);

  const cssContent = originalHtml.slice(styleBlock.contentStart, styleBlock.contentEnd);
  const jsContent = originalHtml.slice(scriptBlock.contentStart, scriptBlock.contentEnd);

  console.log(`Writing ${cssPath}...`);
  fs.writeFileSync(cssPath, cssContent.trim(), 'utf8');
  
  console.log(`Writing ${jsPath}...`);
  fs.writeFileSync(jsPath, jsContent.trim(), 'utf8');

  // Rewrite HTML
  // Replace BLOCKS completely with <link> and <script src>
  
  let blocks = [
      { ...styleBlock, type: 'style' },
      { ...scriptBlock, type: 'script' }
  ].sort((a, b) => b.start - a.start); // descending order

  let rewritten = originalHtml;

  for (const block of blocks) {
      const replacement = block.type === 'style' 
          ? '    <link rel="stylesheet" href="./temp-vercel-dash.css">' 
          : '    <script src="./temp-vercel-dash.js"></script>';
          
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
