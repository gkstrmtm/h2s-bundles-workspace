/*
Brute-force probe: discover candidate backend origins in this repo, then fetch offers payloads
and scan the RAW response text for Texas markers.

Why:
- If the dashboard is pointing at an older Vercel deployment or a portal-proxied origin,
  you can see "TX/Houston" offers even when the canonical backend shows only 17.

Usage (PowerShell):
  node .\tools\probe-offers-multi-backends.js

Options:
  --timeoutMs 8000
  --limit 5000
  --maxOrigins 50
  --includeShop 1
*/

const fs = require('fs');
const path = require('path');

const TX_RE = /(\baustin\b|\bhouston\b|\bdallas\b|san\s+antonio|\btexas\b|(^|[^a-z])tx([^a-z]|$))/i;

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function parseArgs(argv) {
  const out = {
    timeoutMs: 8000,
    limit: 5000,
    maxOrigins: 60,
    includeShop: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--timeoutMs') out.timeoutMs = clampInt(argv[i + 1], 1000, 30000, out.timeoutMs);
    if (a === '--limit') out.limit = clampInt(argv[i + 1], 1, 20000, out.limit);
    if (a === '--maxOrigins') out.maxOrigins = clampInt(argv[i + 1], 1, 500, out.maxOrigins);
    if (a === '--includeShop') out.includeShop = String(argv[i + 1] || '1').trim() !== '0';
  }
  return out;
}

function safeOrigin(raw) {
  try {
    if (!raw) return null;
    let v = String(raw).trim();
    if (!v) return null;
    if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
    return new URL(v).origin;
  } catch {
    return null;
  }
}

function shouldScanFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.html', '.js', '.ts', '.md', '.ps1'].includes(ext)) return false;
  const base = path.basename(filePath).toLowerCase();
  if (base.includes('node_modules')) return false;
  return true;
}

async function walk(dir, results) {
  let entries;
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    // Skip huge / irrelevant folders
    if (ent.isDirectory()) {
      const dn = ent.name.toLowerCase();
      if (dn === 'node_modules' || dn === '.git' || dn === '.next' || dn === 'dist' || dn === 'build') continue;
      await walk(full, results);
      continue;
    }
    if (!ent.isFile()) continue;
    if (!shouldScanFile(full)) continue;

    try {
      const st = await fs.promises.stat(full);
      if (st.size > 2_000_000) continue; // keep it quick
      results.push(full);
    } catch {
      // ignore
    }
  }
}

function extractOrigins(text) {
  const origins = new Set();

  // Capture URLs like https://h2s-backend-xxxxx.vercel.app/... or https://h2s-backend.vercel.app
  const re = /https?:\/\/h2s-backend[^\s"'<>)]*/gi;
  let m;
  while ((m = re.exec(text))) {
    const origin = safeOrigin(m[0]);
    if (origin) origins.add(origin);
  }

  // Capture bare hosts like h2s-backend-xxxx.vercel.app
  const re2 = /\bh2s-backend-[a-z0-9-]+\.vercel\.app\b/gi;
  while ((m = re2.exec(text))) {
    const origin = safeOrigin(m[0]);
    if (origin) origins.add(origin);
  }

  return origins;
}

async function fetchWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => '');
    return { ok: true, res, text };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? 'timeout' : String(e && e.message ? e.message : e) };
  } finally {
    clearTimeout(t);
  }
}

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function scanOfferRowsForTexas(data, maxHits = 10) {
  try {
    if (!data || typeof data !== 'object') return [];
    const rows = Array.isArray(data.offers)
      ? data.offers
      : (Array.isArray(data.offer) ? data.offer : []);
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const hits = [];
    for (const row of rows) {
      const blob = JSON.stringify(row || {});
      if (!TX_RE.test(blob)) continue;

      const offerId = String(row?.Offer_ID || row?.offer_id || row?.id || '').trim();
      const name = String(row?.Offer_Name || row?.offerName || row?.offer_name || row?.name || '').trim();
      const market = String(row?.Market || row?.market || '').trim();
      const createdBy = String(row?.Created_By || row?.created_by || '').trim();

      // Extract a short snippet around the first match.
      let snippet = '';
      try {
        const m = blob.match(TX_RE);
        if (m && m.index != null) {
          const idx = m.index;
          const start = Math.max(0, idx - 80);
          const end = Math.min(blob.length, idx + 120);
          snippet = blob.slice(start, end);
        }
      } catch {
        snippet = '';
      }

      hits.push({ offerId, name, market, createdBy, snippet });
      if (hits.length >= maxHits) break;
    }
    return hits;
  } catch {
    return [];
  }
}

function getOffersCount(data) {
  try {
    if (!data || typeof data !== 'object') return null;
    const arr = Array.isArray(data.offers) ? data.offers : (Array.isArray(data.offer) ? data.offer : null);
    if (arr) return arr.length;
    return null;
  } catch {
    return null;
  }
}

async function probeOrigin(origin, args) {
  const endpoints = [
    { label: 'v1 offers', url: `${origin}/api/v1?action=offers&limit=${encodeURIComponent(args.limit)}&_ts=${Date.now()}` },
    { label: 'offers index', url: `${origin}/api/offers?limit=250&_ts=${Date.now()}` },
  ];

  const out = [];
  for (const ep of endpoints) {
    const r = await fetchWithTimeout(ep.url, args.timeoutMs);
    if (!r.ok) {
      out.push({ origin, label: ep.label, url: ep.url, ok: false, error: r.error });
      continue;
    }

    const data = parseJson(r.text);
    const hasTexas = TX_RE.test(r.text);
    const offersCount = getOffersCount(data);
    const texasHits = hasTexas ? scanOfferRowsForTexas(data, 6) : [];

    out.push({
      origin,
      label: ep.label,
      url: ep.url,
      ok: true,
      status: r.res.status,
      contentType: String(r.res.headers.get('content-type') || ''),
      offersCount,
      hasTexas,
      texasHits,
      rawPreview: String(r.text || '').slice(0, 1000),
      rawLen: String(r.text || '').length,
    });
  }

  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, '..');

  console.log('=== Multi-backend offers probe ===');
  console.log('root:', root);
  console.log('timeoutMs:', args.timeoutMs, 'limit:', args.limit, 'maxOrigins:', args.maxOrigins);

  const files = [];
  await walk(root, files);

  const origins = new Set();
  for (const f of files) {
    let text = '';
    try {
      text = await fs.promises.readFile(f, 'utf8');
    } catch {
      continue;
    }
    for (const o of extractOrigins(text)) origins.add(o);
  }

  // Always include canonical prod.
  origins.add('https://h2s-backend.vercel.app');

  if (args.includeShop) {
    origins.add('https://shop.home2smart.com');
    origins.add('https://home2smart.com');
  }

  const list = Array.from(origins).slice(0, args.maxOrigins);
  console.log('candidate_origins:', list.length);

  const all = [];
  for (let i = 0; i < list.length; i++) {
    const origin = list[i];
    process.stdout.write(`[${i + 1}/${list.length}] ${origin} ... `);
    const results = await probeOrigin(origin, args);
    all.push(...results);

    const okAny = results.some(r => r.ok && r.status >= 200 && r.status < 400);
    const texasAny = results.some(r => r.ok && r.hasTexas);
    console.log(`${okAny ? 'ok' : 'no'}${texasAny ? ' (TEXAS_MARKER_FOUND)' : ''}`);
  }

  const ok = all.filter(r => r.ok);
  const texas = ok.filter(r => r.hasTexas);

  console.log('\n=== Summary ===');
  console.log('ok_responses:', ok.length, 'texas_marker_responses:', texas.length);

  if (!texas.length) {
    console.log('No Texas markers found in any probed RAW payloads.');
    console.log('If you still see TX/Houston in UI, it is coming from a base/origin not referenced in this repo (or from cached UI state).');
    return;
  }

  console.log('\n=== Texas marker hits ===');
  for (const hit of texas) {
    console.log(`- ${hit.origin} :: ${hit.label} :: HTTP ${hit.status} :: offersCount=${hit.offersCount} :: ${hit.url}`);
    if (Array.isArray(hit.texasHits) && hit.texasHits.length) {
      for (const h of hit.texasHits) {
        console.log(`    offerId=${h.offerId || '(missing)'} by=${h.createdBy || '(missing)'} market=${h.market || '(missing)'} name=${h.name || '(missing)'}`);
        if (h.snippet) console.log(`    snippet: ${h.snippet}`);
      }
    } else {
      console.log('    (TX marker found in raw response, but could not attribute to a specific offer row)');
    }
  }

  console.log('\nTip: re-run with --maxOrigins larger if needed.');
}

main().catch((e) => {
  console.error('FAILED:', e && e.stack ? e.stack : e);
  process.exit(1);
});
