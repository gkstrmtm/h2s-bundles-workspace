/*
  Force-patch frontend/dash.js ON DISK.

  Why:
  - In this repo it's easy to end up with VS Code showing an unsaved buffer,
    while deploy scripts stamp/copy the on-disk file.
  - This script makes the training UX changes deterministic and persistent.

  What it does (idempotent):
  - Guard recommendedCount textContent (prevents null errors)
  - Patch loadTrainingResources() to include vaName + _ts + container null-guard
  - Make legacy renderTrainingResources() immediately delegate to a compact
    renderer that opens the Training Viewer modal (no inline iframes)
  - Inject Training Viewer modal controller + helpers if missing
*/

const fs = require('fs');
const path = require('path');

function readUtf8(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeUtf8(filePath, text) {
  fs.writeFileSync(filePath, text, 'utf8');
}

function ensureOnce(haystack, needle, injectAtIndex, injection) {
  if (haystack.includes(needle)) return haystack;
  return haystack.slice(0, injectAtIndex) + injection + haystack.slice(injectAtIndex);
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const dashPath = path.join(repoRoot, 'frontend', 'dash.js');
    const injectPath = path.join(repoRoot, 'scripts', '_inject_training_modal_block.txt');

  let s = readUtf8(dashPath);
  const original = s;

  // 1) Null-guard recommendedCount.
  s = s.replace(
    /document\.getElementById\('recommendedCount'\)\.textContent\s*=\s*recommendedResourceIds\.length;?/g,
    "const recommendedCountEl = document.getElementById('recommendedCount');\n            if (recommendedCountEl) recommendedCountEl.textContent = recommendedResourceIds.length;"
  );

  // 2) loadTrainingResources: add container null-guard.
  // Insert right after: const container = document.getElementById('trainingContainer');
  s = s.replace(
    /const container = document\.getElementById\('trainingContainer'\);\s*/,
    (m) => m + "\n            if (!container) return;\n\n"
  );

  // 3) loadTrainingResources: include vaName + _ts.
  s = s.replace(
    /const response = await fetch\(`\$\{API_URL\}\?action=training`,\s*\{\s*cache:\s*'no-store'\s*\}\s*\);/g,
    [
      "const base = `${API_URL}?action=training`;",
      "                const vaParam = currentUser ? `&vaName=${encodeURIComponent(currentUser)}` : '';",
      "                const url = `${base}${vaParam}&_ts=${Date.now()}`;",
      "                const response = await fetch(url, { cache: 'no-store' });"
    ].join('\n')
  );

  // 4) Make legacy renderTrainingResources delegate to compact renderer.
  if (!s.includes('function renderTrainingResourcesCompact(')) {
    // Inject compact renderer + viewer helpers before Knowledge Profile section.
    const marker = '\n        // Knowledge Profile Functions';
    const idx = s.indexOf(marker);
    if (idx === -1) {
      throw new Error('Could not find insertion marker: "// Knowledge Profile Functions"');
    }

    if (!fs.existsSync(injectPath)) {
      throw new Error(`Missing injection block: ${injectPath}`);
    }
    const injected = `\n\n${readUtf8(injectPath)}\n\n`;
    s = ensureOnce(s, 'function renderTrainingResourcesCompact(', idx, injected);
  }

  // Ensure the legacy function delegates.
  s = s.replace(
    /function renderTrainingResources\(resources\) \{\s*/,
    (m) => {
      if (s.includes('return renderTrainingResourcesCompact(resources);')) return m;
      return m + "            try { return renderTrainingResourcesCompact(resources); } catch (e) { console.error('[Training] compact renderer failed', e); }\n\n";
    }
  );

  // 5) Fix TDZ bug in compact renderer.
  // Crash signature (in production): "Cannot access 'isVideo' before initialization"
  // Root cause: previewHtml references `isVideo` before `const isVideo = ...` runs.
  // Fix: move the isVideo declaration above previewHtml.
  try {
    const previewNeedle = 'const previewHtml = isVideo ?';
    const clickNeedle = 'const clickHandler = isVideo';
    const srcNeedle = 'const src = previewUrl ? escapeHtml(previewUrl) : TRAINING_THUMB_BLANK_PIXEL;';
    const isVideoNeedle = "const isVideo = type === 'VIDEO' || videos.length > 0;";

    const nl = s.includes('\r\n') ? '\r\n' : '\n';

    const previewIdx = s.indexOf(previewNeedle);
    if (previewIdx !== -1) {
      const clickIdx = s.indexOf(clickNeedle, previewIdx);
      if (clickIdx !== -1) {
        const beforePreview = s.slice(0, previewIdx);
        const srcIdx = beforePreview.lastIndexOf(srcNeedle);

        // Only patch if the src line is near the preview block (prevents accidental edits elsewhere).
        if (srcIdx !== -1 && (previewIdx - srcIdx) < 10_000) {
          const srcLineStart = Math.max(0, beforePreview.lastIndexOf('\n', srcIdx) + 1);
          const indentMatch = beforePreview.slice(srcLineStart, srcIdx).match(/^[\t ]*/);
          const indent = indentMatch ? indentMatch[0] : '';
          const afterSrcIdx = srcIdx + srcNeedle.length;

          const betweenSrcAndPreview = s.slice(afterSrcIdx, previewIdx);
          const alreadyBefore = betweenSrcAndPreview.includes(isVideoNeedle);
          if (!alreadyBefore) {
            // Insert isVideo right after src.
            s = s.slice(0, afterSrcIdx) + nl + indent + isVideoNeedle + s.slice(afterSrcIdx);

            // Re-find indices after insertion.
            const previewIdx2 = s.indexOf(previewNeedle, srcIdx);
            const clickIdx2 = s.indexOf(clickNeedle, previewIdx2);

            if (previewIdx2 !== -1 && clickIdx2 !== -1) {
              const between = s.slice(previewIdx2, clickIdx2);
              const dupRel = between.indexOf(isVideoNeedle);
              if (dupRel !== -1) {
                const dupAbs = previewIdx2 + dupRel;
                const dupLineStart = Math.max(0, s.lastIndexOf('\n', dupAbs) + 1);
                let dupLineEnd = s.indexOf('\n', dupAbs);
                if (dupLineEnd === -1) dupLineEnd = s.length;

                // Remove the whole line containing the duplicate isVideo decl.
                const endIncl = dupLineEnd < s.length ? dupLineEnd + 1 : dupLineEnd;
                s = s.slice(0, dupLineStart) + s.slice(endIncl);
              }
            }
          }
        }
      }
    }
  } catch (e) {
    // Don't block deploy on a patcher mismatch.
    process.stdout.write(`WARN: could not patch isVideo TDZ: ${e.message}\n`);
  }

  // If nothing changed, keep quiet.
  if (s === original) {
    process.stdout.write('OK: no changes needed (already patched)\n');
    return;
  }

  writeUtf8(dashPath, s);
  process.stdout.write('OK: wrote frontend/dash.js (patched training modal + loader + guards)\n');
}

main();
