import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function pickChromePath() {
  const env = process.env.CHROME_PATH;
  if (env) return env;

  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  return candidates[0];
}

async function waitForJson(url, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) return await res.json();
    } catch {
      // ignore
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function createCdpClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = new Map();

  function on(method, handler) {
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(handler);
    return () => listeners.get(method)?.delete(handler);
  }

  function send(method, params) {
    const msgId = ++id;
    socket.send(JSON.stringify({ id: msgId, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(msgId, { resolve, reject, method });
    });
  }

  const ready = new Promise((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = (e) => reject(e);
  });

  socket.onmessage = (evt) => {
    let msg;
    try {
      msg = JSON.parse(String(evt.data));
    } catch {
      return;
    }

    if (msg.id) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method} failed: ${msg.error.message || 'Unknown error'}`));
      else p.resolve(msg.result);
      return;
    }

    if (msg.method) {
      const set = listeners.get(msg.method);
      if (!set) return;
      for (const handler of set) {
        try {
          handler(msg.params);
        } catch {
          // ignore
        }
      }
    }
  };

  return {
    ready,
    send,
    on,
    close: () => socket.close()
  };
}

function analyzeLongTasks(traceEvents, { limit = 25, minMs = 50 } = {}) {
  const minDurUs = minMs * 1000;

  const navigationStart = traceEvents.find((e) => e?.name === 'navigationStart' && typeof e.ts === 'number');
  const earliestTs = traceEvents.reduce((m, e) => (typeof e.ts === 'number' ? Math.min(m, e.ts) : m), Infinity);
  const startTs = navigationStart?.ts ?? earliestTs;

  const runTasks = traceEvents
    .filter((e) => e && e.name === 'RunTask' && e.ph === 'X' && typeof e.dur === 'number' && e.dur >= minDurUs)
    .map((e) => ({ ts: e.ts, dur: e.dur, pid: e.pid, tid: e.tid }));

  const scriptLike = traceEvents
    .filter((e) => e && (e.name === 'EvaluateScript' || e.name === 'FunctionCall') && e.ph === 'X' && typeof e.ts === 'number' && typeof e.dur === 'number')
    .map((e) => ({
      ts: e.ts,
      dur: e.dur,
      url: e.args?.data?.url || e.args?.beginData?.url || '',
      pid: e.pid,
      tid: e.tid
    }))
    .sort((a, b) => a.ts - b.ts);

  // JSSample events frequently include stack frames with URLs.
  const stackFrames = traceEvents
    .filter((e) => e && (e.name === 'JSSample' || e.name === 'V8StackTrace') && typeof e.ts === 'number')
    .map((e) => {
      const data = e.args?.data || {};
      const frames = data.stackTrace || data.frames || data.stack || data;

      function findUrl(obj) {
        if (!obj) return '';
        if (Array.isArray(obj)) {
          for (const f of obj) {
            const u = findUrl(f);
            if (u) return u;
          }
          return '';
        }
        if (typeof obj === 'object') {
          if (typeof obj.url === 'string' && obj.url) return obj.url;
          if (typeof obj.scriptName === 'string' && obj.scriptName) return obj.scriptName;
          if (typeof obj.sourceURL === 'string' && obj.sourceURL) return obj.sourceURL;
          if (obj.callFrames) return findUrl(obj.callFrames);
        }
        return '';
      }

      const url = findUrl(frames);
      return { ts: e.ts, url, pid: e.pid, tid: e.tid };
    })
    .filter((s) => s.url)
    .sort((a, b) => a.ts - b.ts);

  function bestAttribution(task) {
    const start = task.ts;
    const end = task.ts + task.dur;
    let best = null;

    // linear scan with early break (evalScripts sorted)
    for (const ev of scriptLike) {
      if (ev.ts > end) break;
      const evEnd = ev.ts + ev.dur;
      const overlaps = evEnd > start && ev.ts < end;
      if (!overlaps) continue;

      // prefer same thread
      const sameThread = ev.pid === task.pid && ev.tid === task.tid;
      const score = (sameThread ? 1e12 : 0) + ev.dur;
      if (!best || score > best.score) {
        best = { score, dur: ev.dur, url: ev.url };
      }
    }

    if (!best) return null;
    let url = best.url || '';
    if (!url) {
      // Use nearest stack frame URL (same thread) within a short window.
      const windowUs = 2500 * 1000; // 2.5s
      const candidates = stackFrames.filter((s) => s.pid === task.pid && s.tid === task.tid && s.ts >= start - windowUs && s.ts <= end + windowUs);
      if (candidates.length) url = candidates[candidates.length - 1].url;
    }
    url = String(url || '').replace(/^https?:\/\//, '').slice(0, 160);
    return { url, durMs: best.dur / 1000 };
  }

  const rows = runTasks
    .sort((a, b) => b.dur - a.dur)
    .slice(0, limit)
    .map((t, idx) => {
      // If navigationStart lands after early RunTask events, fall back to earliest event ts
      const baseTs = (navigationStart && t.ts >= navigationStart.ts) ? startTs : earliestTs;
      const startMs = (t.ts - baseTs) / 1000;
      const durMs = t.dur / 1000;
      const attr = bestAttribution(t);
      return {
        i: idx + 1,
        startMs,
        durMs,
        attr
      };
    });

  return { startTs, navigationStartFound: Boolean(navigationStart), rows, totalLongTasks: runTasks.length };
}

async function main() {
  const baseUrl = process.argv[2] || 'https://shop.home2smart.com/bundles';
  const urlObj = new URL(baseUrl);
  urlObj.searchParams.set('_lt', String(Date.now()));
  const url = urlObj.toString();

  const chromePath = pickChromePath();
  const port = Number(process.env.CDP_PORT || 9222);
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'h2s-chrome-'));

  const chromeArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-dev-shm-usage'
  ];

  const chrome = spawn(chromePath, chromeArgs, { stdio: 'ignore' });

  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`, 12000);

    // IMPORTANT: attach to a *page target* websocket, not the browser websocket.
    // Otherwise domains like Page.* will be missing.
    let target;
    try {
      target = await waitForJson(`http://127.0.0.1:${port}/json/new?about:blank`, 12000);
    } catch {
      const list = await waitForJson(`http://127.0.0.1:${port}/json/list`, 12000);
      target = Array.isArray(list) ? list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) : null;
    }

    const wsUrl = target?.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error('No page target webSocketDebuggerUrl from /json/new or /json/list');

    const cdp = createCdpClient(wsUrl);
    await cdp.ready;

    const traceEvents = [];
    const traceDone = new Promise((resolve) => {
      cdp.on('Tracing.dataCollected', (p) => {
        if (Array.isArray(p?.value)) traceEvents.push(...p.value);
      });
      cdp.on('Tracing.tracingComplete', () => resolve());
    });

    let loadFired = false;
    const loadDone = new Promise((resolve) => {
      cdp.on('Page.loadEventFired', () => {
        loadFired = true;
        resolve();
      });
    });

    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Runtime.enable');

    await cdp.send('Tracing.start', {
      transferMode: 'ReportEvents',
      categories: [
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'blink.user_timing',
        'v8.execute'
      ].join(',')
    });

    await cdp.send('Page.navigate', { url });
    await loadDone;
    // capture a bit after load to catch late-start long tasks
    await sleep(3500);

    await cdp.send('Tracing.end');
    await traceDone;

    const outPath = path.resolve('tmp-longtask-trace.json');
    await fs.writeFile(outPath, JSON.stringify({ traceEvents }, null, 2), 'utf8');

    const analysis = analyzeLongTasks(traceEvents, { limit: 30, minMs: 50 });

    console.log('\n=== Long Tasks (DevTools-ish) ===');
    console.log(`URL: ${url}`);
    console.log(`Trace events: ${traceEvents.length}`);
    console.log(`navigationStart found: ${analysis.navigationStartFound}`);
    console.log(`long tasks (>=50ms): ${analysis.totalLongTasks}`);
    console.log(`trace file: ${outPath}`);
    console.log('');

    for (const r of analysis.rows) {
      const when = r.startMs.toFixed(0).padStart(5, ' ');
      const dur = r.durMs.toFixed(1).padStart(6, ' ');
      const attr = r.attr ? ` | JS: ${r.attr.durMs.toFixed(1)}ms | ${r.attr.url || '(unknown url)'}` : '';
      console.log(`#${String(r.i).padStart(2, '0')}  t+${when}ms  ${dur}ms${attr}`);
    }

    cdp.close();
  } finally {
    try { chrome.kill(); } catch {}
    try { await fs.rm(userDataDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
