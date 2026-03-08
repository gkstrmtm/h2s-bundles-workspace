const fs = require('fs');

function extractProofPacksBlock(text) {
  const needle = 'const proofPacks =';
  const startIdx = text.indexOf(needle);
  if (startIdx < 0) throw new Error(`needle not found: ${needle}`);

  const firstBrace = text.indexOf('{', startIdx);
  if (firstBrace < 0) throw new Error('no opening { after needle');

  let i = firstBrace;
  let depth = 0;

  let mode = 'code'; // code | str | tmpl | linec | blockc
  let quote = null;
  let tmplExprDepth = 0;

  while (i < text.length) {
    const c = text[i];
    const n = i + 1 < text.length ? text[i + 1] : '';

    if (mode === 'code') {
      if (c === '\'' || c === '"') {
        mode = 'str';
        quote = c;
        i += 1;
        continue;
      }

      if (c === '`') {
        mode = 'tmpl';
        i += 1;
        continue;
      }

      if (c === '/') {
        if (n === '*') {
          mode = 'blockc';
          i += 2;
          continue;
        }
        if (n === '/') {
          mode = 'linec';
          i += 2;
          continue;
        }
      }

      if (c === '{') depth += 1;
      if (c === '}') depth -= 1;

      if (depth === 0 && i > firstBrace) {
        let end = i + 1;
        while (end < text.length && /\s/.test(text[end])) end += 1;
        while (end < text.length && text[end] !== ';') end += 1;
        if (end < text.length && text[end] === ';') {
          return text.slice(startIdx, end + 1);
        }
        throw new Error('found closing brace but no trailing semicolon');
      }

      i += 1;
      continue;
    }

    if (mode === 'str') {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === quote) {
        mode = 'code';
        quote = null;
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }

    if (mode === 'tmpl') {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') {
        mode = 'code';
        i += 1;
        continue;
      }
      if (c === '$') {
        if (n === '{') {
          tmplExprDepth += 1;
          i += 2;
          continue;
        }
      }
      if (c === '}') {
        if (tmplExprDepth > 0) {
          tmplExprDepth -= 1;
          i += 1;
          continue;
        }
      }
      i += 1;
      continue;
    }

    if (mode === 'blockc') {
      if (c === '*') {
        if (n === '/') {
          mode = 'code';
          i += 2;
          continue;
        }
      }
      i += 1;
      continue;
    }

    if (mode === 'linec') {
      if (c === '\n') {
        mode = 'code';
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }

    throw new Error(`unknown mode: ${mode}`);
  }

  throw new Error('no end found');
}

function main() {
  const basePath = 'frontend/dash.js';
  const goodHtmlPath = 'frontend/_dash_good_proofpacks.html';

  const baseText = fs.readFileSync(basePath, 'utf8');
  const goodText = fs.readFileSync(goodHtmlPath, 'utf8');

  const baseBlock = extractProofPacksBlock(baseText);
  const goodBlock = extractProofPacksBlock(goodText);

  fs.writeFileSync('frontend/_pp_base.js', baseBlock + '\n');
  fs.writeFileSync('frontend/_pp_good.js', goodBlock + '\n');

  process.stdout.write(
    `Extracted proofPacks blocks:\n- base: ${baseBlock.length} chars\n- good: ${goodBlock.length} chars\n`
  );
}

main();
