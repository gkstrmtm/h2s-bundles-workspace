/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');

const HARD_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20000);

function dumpActiveHandles() {
  try {
    const handles = (typeof process._getActiveHandles === 'function')
      ? process._getActiveHandles()
      : [];
    const requests = (typeof process._getActiveRequests === 'function')
      ? process._getActiveRequests()
      : [];
    const summarize = (arr) => arr
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
    return { handles: summarize(handles), requests: summarize(requests) };
  } catch (_) {
    return null;
  }
}

function hardFail(code, msg, extra) {
  if (msg) console.error(msg);
  if (extra) console.error(extra);
  const active = dumpActiveHandles();
  if (active) {
    console.error('Active handles summary:', active.handles);
    console.error('Active requests summary:', active.requests);
  }
  process.exit(code);
}

function makeDom() {
  const html = `<!doctype html>
<html>
  <head></head>
  <body>
    <form id="newTrainingForm"></form>

    <div id="toastContainer"></div>

    <input id="newTrainingTitle" type="text" value="Smoke Training" />
    <input id="editResourceId" type="hidden" value="" />

    <select id="newTrainingCategory">
      <option value="General" selected>General</option>
      <option value="Onboarding">Onboarding</option>
    </select>

    <textarea id="newTrainingDescription"></textarea>

    <div id="newTrainingUrls">
      <div class="training-url-row">
        <input class="training-url-input" type="url" value="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />
        <button class="training-url-remove" type="button">Remove</button>
      </div>
      <div class="training-url-row">
        <input class="training-url-input" type="url" value="https://www.loom.com/share/abc123abc123abc123abc123" />
        <button class="training-url-remove" type="button">Remove</button>
      </div>
    </div>

    <button id="addTrainingUrlBtn" type="button">Add another link</button>

    <div id="adminTrainingList"></div>
    <div id="trainingResources"></div>
  </body>
</html>`;

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', (e) => console.error('[jsdom:error]', e));
  virtualConsole.on('warn', (e) => console.warn('[jsdom:warn]', e));

  return new JSDOM(html, {
    url: 'https://smoke.local/dash',
    runScripts: 'outside-only',
    pretendToBeVisual: false,
    virtualConsole
  });
}

async function run() {
  const startedAt = Date.now();
  const log = (...args) => console.log('[smoke]', ...args);

  const hardTimeout = setTimeout(() => {
    hardFail(2, `TIMEOUT: exceeded ${HARD_TIMEOUT_MS}ms`);
  }, HARD_TIMEOUT_MS);
  if (hardTimeout && typeof hardTimeout.unref === 'function') hardTimeout.unref();

  const dom = makeDom();
  const { window } = dom;

  const toasts = [];
  const calls = [];
  const missingIds = [];

  const teardown = () => {
    try { clearTimeout(hardTimeout); } catch (_) {}
    try { window.close(); } catch (_) {}
  };

  process.on('unhandledRejection', (reason) => {
    teardown();
    hardFail(3, 'UNHANDLED REJECTION', reason);
  });

  process.on('uncaughtException', (err) => {
    teardown();
    hardFail(4, 'UNCAUGHT EXCEPTION', err);
  });

  // Prevent timers created by dash.js from keeping Node alive.
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

  // Constants expected by dash.js.
  window.API_URL = 'https://smoke.local/api/v1';
  window.DEFAULT_API_HOST = 'https://smoke.local';

  // UI helpers expected by dash.js.
  window.showToast = (message, type) => {
    const entry = { message: String(message), type: String(type || 'info') };
    toasts.push(entry);
    console.log(`[toast:${entry.type}] ${entry.message}`);
  };
  window.loadAdminTrainingList = () => {};
  window.loadTrainingResources = () => {};

  // Network stubs.
  window.fetch = async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, options: { ...options } });

    if (u.includes('action=linkPreview')) {
      log('fetch linkPreview');
      let requestedUrl = '';
      try {
        const parsed = new URL(u);
        requestedUrl = String(parsed.searchParams.get('url') || '');
      } catch (_) {}
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            ok: true,
            linkPreview: {
              url: requestedUrl || u,
              provider: (requestedUrl && requestedUrl.includes('loom.com')) ? 'loom' : 'youtube',
              title: (requestedUrl && requestedUrl.includes('loom.com')) ? 'Test Loom Video' : 'Test YouTube Video'
            }
          };
        }
      };
    }

    if (u.includes('action=createTraining')) {
      log('fetch createTraining');
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, createTraining: { Resource_ID: 'SMOKE_1' } };
        }
      };
    }

    return {
      ok: false,
      status: 404,
      async json() {
        return { ok: false, error: 'not found' };
      }
    };
  };

  // Load and evaluate dash.js.
  const dashJsPath = path.join(__dirname, '..', 'frontend', 'dash.js');
  const dashJs = fs.readFileSync(dashJsPath, 'utf8');
  const dashLines = dashJs.split(/\r?\n/);

  log('dashJsPath', dashJsPath);
  log('dash.js bytes', Buffer.byteLength(dashJs, 'utf8'));
  log('dash.js has legacy newTrainingURL).value', dashJs.includes("newTrainingURL').value"));
  log('dash.js has legacy newTrainingDuration).value', dashJs.includes("newTrainingDuration').value"));
  log('dash.js has legacy getElementById(newTrainingURL).value', dashJs.includes("getElementById('newTrainingURL').value"));

  log('evaluating dash.js');
  try {
    window.eval(dashJs);
  } catch (e) {
    teardown();
    hardFail(5, 'dash.js threw during evaluation', e);
  }
  log('dash.js evaluated');

  try {
    const src = String(window.submitNewTraining);
    log('submitNewTraining includes "assets"', src.includes('assets'));
    log('submitNewTraining includes "assetsMeta"', src.includes('assetsMeta'));
    log('submitNewTraining includes "urls"', src.includes('urls'));
    log('submitNewTraining snippet:', src.slice(0, 400).replace(/\s+/g, ' '));
  } catch (_) {}

  // dash.js can define/overwrite these globals; re-stub to keep the smoke test bounded.
  window.showToast = (message, type) => {
    const entry = { message: String(message), type: String(type || 'info') };
    toasts.push(entry);
    console.log(`[toast:${entry.type}] ${entry.message}`);
  };
  window.loadAdminTrainingList = () => {};
  window.loadTrainingResources = () => {};

  // Track missing DOM ids during the submit path to pinpoint null .value reads.
  try {
    const realGet = window.document.getElementById.bind(window.document);
    window.document.getElementById = (id) => {
      const el = realGet(id);
      if (!el) missingIds.push(String(id));
      return el;
    };
  } catch (_) {}

  assert.equal(typeof window.submitNewTraining, 'function', 'submitNewTraining should be defined');

  // Simulate clicking submit.
  log('calling submitNewTraining');
  try {
    missingIds.length = 0;
    const evt = new window.Event('submit');
    evt.preventDefault = () => {};

    await Promise.race([
      window.submitNewTraining(evt),
      new Promise((_, reject) => setTimeout(() => reject(new Error('submitNewTraining timed out')), 8000))
    ]);
  } catch (e) {
    teardown();
    console.error('Missing element ids during submit:', Array.from(new Set(missingIds)));
    console.error('Toasts so far:', toasts);
    try {
      const stack = String(e && e.stack || '');
      const m = stack.match(/<anonymous>:(\d+):(\d+)/);
      if (m) {
        const lineNo = Number(m[1]);
        const colNo = Number(m[2]);
        const start = Math.max(1, lineNo - 4);
        const end = Math.min(dashLines.length, lineNo + 4);
        console.error(`dash.js snippet around <anonymous>:${lineNo}:${colNo}`);
        for (let i = start; i <= end; i++) {
          const prefix = i === lineNo ? '>>' : '  ';
          console.error(`${prefix} ${String(i).padStart(6, ' ')} | ${dashLines[i - 1]}`);
        }
      } else {
        console.error('Could not parse <anonymous>:line:col from stack');
      }
    } catch (snipErr) {
      console.error('Failed to print dash.js snippet', snipErr);
    }
    hardFail(6, 'submitNewTraining threw', e);
  }
  log('submitNewTraining returned');

  // Assertions: ensure it actually attempted the createTraining call.
  const createCall = calls.find((c) => c.url.includes('action=createTraining'));
  if (!createCall) {
    teardown();
    console.error('Calls:', calls);
    console.error('Toasts:', toasts);
    hardFail(7, 'Expected a createTraining API call but none occurred');
  }

  const body = createCall.options && createCall.options.body ? String(createCall.options.body) : '';
  if (!body) {
    teardown();
    hardFail(8, 'Expected createTraining request body');
  }

  let payload = null;
  try {
    payload = JSON.parse(body);
  } catch (_) {
    payload = null;
  }

  // Ensure title present (auto-filled when blank).
  const hasTitle = payload ? !!payload.title : body.includes('"title"');
  if (!hasTitle) {
    teardown();
    console.error('Payload:', body);
    hardFail(10, 'Expected title in payload');
  }

  // Ensure assetsMeta included (either map or array).
  const hasAssetsMeta = payload
    ? (payload.assetsMeta !== undefined || payload.assets_meta !== undefined)
    : (body.includes('"assetsMeta"') || body.includes('"assets_meta"'));

  if (!hasAssetsMeta) {
    teardown();
    console.error('Payload:', body);
    hardFail(9, 'Expected assetsMeta in payload');
  }

  // Ensure multi-link URLs are sent (accept either `assets` or legacy `urls`).
  const list = payload
    ? (Array.isArray(payload.assets) ? payload.assets : (Array.isArray(payload.urls) ? payload.urls : null))
    : null;

  if (payload && (!list || list.length < 2)) {
    teardown();
    console.error('Payload:', body);
    hardFail(11, 'Expected `assets` or `urls` array with at least 2 entries');
  }

  if (!body.includes('youtube.com') || !body.includes('loom.com')) {
    teardown();
    console.error('Payload:', body);
    hardFail(12, 'Expected both URLs in payload');
  }

  teardown();
  const elapsedMs = Date.now() - startedAt;
  log(`OK: training upload smoke test passed (${elapsedMs}ms)`);
  process.exit(0);
}

run().catch((e) => hardFail(1, 'Fatal error running smoke test', e));
