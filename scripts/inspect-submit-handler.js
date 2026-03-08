/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const HARD_TIMEOUT_MS = Number(process.env.INSPECT_TIMEOUT_MS || 15000);

function dumpActiveHandles() {
  try {
    const handles = (typeof process._getActiveHandles === 'function')
      ? process._getActiveHandles()
      : [];
    return handles
      .map((h) => {
        try {
          return (h && h.constructor && h.constructor.name) ? h.constructor.name : typeof h;
        } catch (_) {
          return 'unknown';
        }
      })
      .reduce((acc, name) => {
        acc[name] = (acc[name] || 0) + 1;
        return acc;
      }, {});
  } catch (_) {
    return null;
  }
}

const html = `<!doctype html>
<html>
  <body>
    <form id="newTrainingForm"></form>
    <input id="newTrainingTitle" type="text" value="" />
    <select id="newTrainingCategory"><option value="General" selected>General</option></select>
    <textarea id="newTrainingDescription"></textarea>
    <div id="newTrainingUrls">
      <div class="training-url-row"><input class="training-url-input" type="url" value="https://www.youtube.com/watch?v=dQw4w9WgXcQ" /></div>
      <div class="training-url-row"><input class="training-url-input" type="url" value="https://www.loom.com/share/abc123abc123abc123abc123" /></div>
    </div>
    <div id="adminTrainingList"></div>
    <div id="trainingResources"></div>
  </body>
</html>`;

const dom = new JSDOM(html, { url: 'https://smoke.local/dash', runScripts: 'outside-only' });
const { window } = dom;

const hardTimeout = setTimeout(() => {
  console.error(`TIMEOUT: exceeded ${HARD_TIMEOUT_MS}ms`);
  const active = dumpActiveHandles();
  if (active) console.error('Active handles summary:', active);
  try { window.close(); } catch (_) {}
  process.exit(2);
}, HARD_TIMEOUT_MS);
if (hardTimeout && typeof hardTimeout.unref === 'function') hardTimeout.unref();

// Prevent timers created by dash.js from keeping Node alive.
try {
  const realSetTimeout = window.setTimeout.bind(window);
  const realSetInterval = window.setInterval.bind(window);
  window.setTimeout = (fn, ms, ...rest) => {
    const h = realSetTimeout(fn, ms, ...rest);
    if (h && typeof h.unref === 'function') h.unref();
    return h;
  };
  window.setInterval = (fn, ms, ...rest) => {
    const h = realSetInterval(fn, ms, ...rest);
    if (h && typeof h.unref === 'function') h.unref();
    return h;
  };
  window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(Date.now()), 0);
} catch (_) {}

window.API_URL = 'https://smoke.local/api/v1';
window.DEFAULT_API_HOST = 'https://smoke.local';
window.showToast = () => {};
window.loadAdminTrainingList = () => {};
window.loadTrainingResources = () => {};

window.fetch = async (url) => {
  const u = String(url);
  if (u.includes('action=linkPreview')) {
    let requestedUrl = '';
    try {
      requestedUrl = String(new URL(u).searchParams.get('url') || '');
    } catch (_) {}
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true, linkPreview: { url: requestedUrl, provider: 'x', title: 't' } };
      }
    };
  }
  return {
    ok: true,
    status: 200,
    async json() {
      return { ok: true };
    }
  };
};

const dashJsPath = path.join(process.cwd(), 'frontend', 'dash.js');
const dash = fs.readFileSync(dashJsPath, 'utf8');
try {
  window.eval(dash);
} catch (e) {
  console.error('dash.js threw during evaluation', e);
  const active = dumpActiveHandles();
  if (active) console.error('Active handles summary:', active);
  try { clearTimeout(hardTimeout); } catch (_) {}
  try { window.close(); } catch (_) {}
  process.exit(3);
}

const src = String(window.submitNewTraining);
console.log('submitNewTraining defined:', typeof window.submitNewTraining);
console.log('submitNewTraining includes "assets":', src.includes('assets'));
console.log('submitNewTraining includes "assetsMeta":', src.includes('assetsMeta'));
console.log('submitNewTraining includes "urls":', src.includes('urls'));
console.log('--- excerpt ---');
console.log(src.slice(0, 900));

try { clearTimeout(hardTimeout); } catch (_) {}
try { window.close(); } catch (_) {}
process.exit(0);
