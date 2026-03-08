const fs = require('fs');

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractBetween(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
  const end = text.indexOf(endMarker, start);
  if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
  return {
    start,
    end,
    segment: text.slice(start, end),
  };
}

function replaceBetween(text, startMarker, endMarker, newSegment) {
  const { start, end } = extractBetween(text, startMarker, endMarker);
  return text.slice(0, start) + newSegment + text.slice(end);
}

function detectNewline(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function prevNonWhitespaceChar(text, idx) {
  for (let i = idx; i >= 0; i -= 1) {
    const c = text[i];
    if (!c) return null;
    if (c !== ' ' && c !== '\t' && c !== '\r' && c !== '\n') return c;
  }
  return null;
}

function isRegexStart(text, slashIdx) {
  const prev = prevNonWhitespaceChar(text, slashIdx - 1);
  if (prev === null) return true;
  if ('([{:;=,+-!*?<>|&^~%'.includes(prev)) return true;
  const before = text.slice(0, slashIdx).replace(/\s+$/g, '');
  if (/\b(return|throw|case|else|do)\s*$/.test(before)) return true;
  return false;
}

function findMatchingCurly(text, openIdx) {
  if (text[openIdx] !== '{') throw new Error('findMatchingCurly: openIdx must point at {');

  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let inRegex = false;
  let inRegexCharClass = false;

  // Nested template literals support.
  // Each stack frame tracks the depth we should return to when a ${...} closes.
  const templateStack = [];

  for (let i = openIdx; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inSingle) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }

    if (inRegex) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === '[') {
        inRegexCharClass = true;
        continue;
      }
      if (ch === ']') {
        inRegexCharClass = false;
        continue;
      }
      if (ch === '/' && !inRegexCharClass) {
        inRegex = false;
        // consume flags
        while (/[a-z]/i.test(text[i + 1] || '')) i += 1;
      }
      continue;
    }

    // If we're inside a template literal *text* portion, ignore almost everything.
    if (templateStack.length) {
      const top = templateStack[templateStack.length - 1];
      const inTemplateExpr = top.exprTargets.length > 0;

      if (!inTemplateExpr) {
        if (ch === '\\') {
          i += 1;
          continue;
        }
        if (ch === '`') {
          templateStack.pop();
          continue;
        }
        if (ch === '$' && next === '{') {
          top.exprTargets.push(depth);
          depth += 1; // for the '{' in ${
          i += 1; // skip '{'
          continue;
        }
        continue;
      }
      // else: we're in template expression; fall through to normal code handling.
    }

    // comment starts
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    // string starts
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '`') {
      templateStack.push({ exprTargets: [] });
      continue;
    }

    // regex literal start (best-effort)
    if (ch === '/' && isRegexStart(text, i)) {
      inRegex = true;
      inRegexCharClass = false;
      continue;
    }

    // brace tracking
    if (ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;

      if (templateStack.length) {
        const top = templateStack[templateStack.length - 1];
        if (top.exprTargets.length) {
          const target = top.exprTargets[top.exprTargets.length - 1];
          if (depth === target) {
            top.exprTargets.pop();
          }
        }
      }

      if (depth === 0) return i;
      continue;
    }
  }

  throw new Error('matching } not found');
}

function extractConstObject(text, constName) {
  const re = new RegExp(`\\bconst\\s+${escapeRegExp(constName)}\\s*=\\s*\\{`, 'm');
  const m = re.exec(text);
  if (!m) throw new Error(`const object not found: ${constName}`);

  const start = m.index;
  const braceIdx = start + m[0].lastIndexOf('{');
  const closeBraceIdx = findMatchingCurly(text, braceIdx);

  let end = closeBraceIdx + 1;
  while (end < text.length && /\s/.test(text[end])) end += 1;
  if (text[end] === ';') end += 1;

  return {
    start,
    end,
    segment: text.slice(start, end),
  };
}

function main() {
  const goodHtmlPath = 'frontend/_dash_good_proofpacks.html';

  // Baseline (everything-else) sources already downloaded from the baseline deployment
  const baseHtmlPath = 'frontend/_dash_base_everythingelse.html';
  const baseJsPath = 'frontend/_base_dash.js';
  const baseCssPath = 'frontend/_base_dash.css';

  // Repo targets
  const dashHtmlPath = 'frontend/dash.html';
  const dashJsPath = 'frontend/dash.js';
  const dashCssPath = 'frontend/dash.css';

  const goodHtml = fs.readFileSync(goodHtmlPath, 'utf8');

  // 1) Merge HTML pane between markers
  const htmlStart = '                <!-- PROOF PACKS PANE -->';
  const htmlEnd = '                <!-- OFFER BUILDER PANE -->';
  const goodPane = extractBetween(goodHtml, htmlStart, htmlEnd).segment;

  const baseHtml = fs.readFileSync(baseHtmlPath, 'utf8');
  const mergedHtml = replaceBetween(baseHtml, htmlStart, htmlEnd, goodPane);
  fs.writeFileSync(dashHtmlPath, mergedHtml);

  // 2) Merge JS proofPacks block using stable top-level markers (template-literal safe)
  const baseJs = fs.readFileSync(baseJsPath, 'utf8');
  const baseObj = extractConstObject(baseJs, 'proofPacks');
  const goodObj = extractConstObject(goodHtml, 'proofPacks');
  const mergedJs = baseJs.slice(0, baseObj.start) + goodObj.segment + baseJs.slice(baseObj.end);
  fs.writeFileSync(dashJsPath, mergedJs);

  // 3) Keep baseline CSS (ProofPacks design in HTML/JS is being transplanted; CSS stays baseline)
  if (fs.existsSync(baseCssPath)) {
    fs.copyFileSync(baseCssPath, dashCssPath);
  }

  process.stdout.write(
    [
      'Merged ProofPacks tab:',
      `- HTML: replaced segment between markers`,
      `- JS: replaced const proofPacks object (${baseObj.segment.length} -> ${goodObj.segment.length} chars)`,
      `- CSS: set to baseline _base_dash.css`,
    ].join('\n') + '\n'
  );
}

main();
