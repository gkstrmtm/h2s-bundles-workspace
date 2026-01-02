import fs from 'node:fs';
import vm from 'node:vm';

function indexToLineCol(text, index) {
  let line = 1;
  let lastNl = -1;
  // Fast-ish: count newlines up to index
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) { // \n
      line++;
      lastNl = i;
    }
  }
  const col = index - lastNl; // 1-based
  return { line, col };
}

function parseStackLineCol(stack) {
  // Node SyntaxError stack often contains: at <anonymous>:LINE:COL
  if (!stack) return null;
  const m = String(stack).match(/:(\d+):(\d+)\)?\s*$/m);
  if (!m) return null;
  return { line: Number(m[1]), col: Number(m[2]) };
}

function isLikelyJsType(attrs) {
  const m = attrs.match(/\btype\s*=\s*(["'])(.*?)\1/i);
  if (!m) return true; // default is JS
  const t = (m[2] || '').toLowerCase().trim();
  if (!t) return true;
  if (t.includes('javascript') || t.includes('ecmascript') || t === 'module') return true;
  // Treat other types (ld+json, text/plain, etc) as non-JS
  return false;
}

function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node tools/scan-html-scripts.mjs <path-to-html>');
    process.exit(2);
  }

  const html = fs.readFileSync(target, 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

  let match;
  let scriptIndex = 0;
  let errorCount = 0;

  while ((match = re.exec(html))) {
    scriptIndex++;
    const attrs = match[1] || '';
    const body = match[2] || '';

    if (!isLikelyJsType(attrs)) continue;

    // Skip inert / intentional non-executed scripts
    if (/\bid\s*=\s*(["'])__H2S_APP_MONOLITH__\1/i.test(attrs)) continue;
    if (/\btype\s*=\s*(["'])text\/plain\1/i.test(attrs)) continue;

    const bodyStartIndex = match.index + match[0].indexOf('>') + 1;
    const start = indexToLineCol(html, bodyStartIndex);

    const code = body;
    const filename = `${target}#script${scriptIndex}`;

    try {
      // Parse-only compile
      new vm.Script(code, { filename, displayErrors: true });
    } catch (err) {
      errorCount++;
      const loc = parseStackLineCol(err && err.stack);
      const relLine = loc?.line ?? 1;
      const relCol = loc?.col ?? 1;
      const absLine = start.line + (relLine - 1);

      console.log('---');
      console.log(`SyntaxError in script #${scriptIndex} at ${target}:${absLine}:${relCol}`);
      console.log(String(err && err.message ? err.message : err));

      // Print a small context window from the original HTML
      const lines = html.split(/\r?\n/);
      const from = Math.max(1, absLine - 2);
      const to = Math.min(lines.length, absLine + 2);
      for (let ln = from; ln <= to; ln++) {
        const prefix = ln === absLine ? '>' : ' ';
        console.log(prefix + String(ln).padStart(5, ' ') + ' | ' + lines[ln - 1]);
      }
    }
  }

  console.log('---');
  if (errorCount === 0) {
    console.log(`OK: No JS parse errors found across ${scriptIndex} <script> blocks.`);
  } else {
    console.log(`Found ${errorCount} JS parse error(s) across ${scriptIndex} <script> blocks.`);
    process.exitCode = 1;
  }
}

main();
