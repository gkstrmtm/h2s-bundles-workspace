/*
Read-only probe (optionally purge) Texas/seeded offers via the deployed /api/v1 endpoint.

Why:
- Local Supabase env vars might point at a different DB than the deployed dashboard.
- The dashboard Offer Library falls back to /api/v1?action=offers.

Usage (PowerShell):
  node .\tools\probe-texas-offers-via-api.js --base https://h2s-backend.vercel.app --limit 500

Optional purge (PREVIEW):
  node .\tools\probe-texas-offers-via-api.js --base https://h2s-backend.vercel.app --purgePreview --adminKey <KEY>

Apply purge (DELETES):
  node .\tools\probe-texas-offers-via-api.js --base https://h2s-backend.vercel.app --purgeApply --adminKey <KEY>

Notes:
- adminKey is sent as x-h2s-admin-key
- purge endpoint returns preview list even in preview mode
*/

function safeTrim(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function parseArgs(argv) {
  const out = {
    base: 'https://h2s-backend.vercel.app',
    limit: 500,
    show: 50,
    adminKey: '',
    purgePreview: false,
    purgeApply: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--base') out.base = String(argv[i + 1] || out.base).trim();
    if (a === '--limit') out.limit = clampInt(argv[i + 1], 1, 5000, out.limit);
    if (a === '--show') out.show = clampInt(argv[i + 1], 0, 200, out.show);
    if (a === '--adminKey') out.adminKey = String(argv[i + 1] || '').trim();
    if (a === '--purgePreview') out.purgePreview = true;
    if (a === '--purgeApply') out.purgeApply = true;
  }

  if (out.base && !/^https?:\/\//i.test(out.base)) out.base = `https://${out.base}`;
  try {
    out.base = new URL(out.base).origin;
  } catch {
    // keep as-is
  }

  if (out.purgeApply) out.purgePreview = false;

  return out;
}

const SEED_RE = /(\bseed\b|seeded|seed pack|\btest\b|demo|sample|lorem|ipsum|asdf|tmp|temp)/i;
const TX_RE = /(\baustin\b|\bhouston\b|\bdallas\b|san\s+antonio|\btexas\b|(^|[^a-z])tx([^a-z]|$))/i;

function stringifyLoose(v) {
  try {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  } catch {
    try { return String(v); } catch { return ''; }
  }
}

function classify(row) {
  const parts = [
    safeTrim(row?.Offer_Name || row?.offerName || row?.name || ''),
    safeTrim(row?.Market || row?.market || ''),
    safeTrim(row?.Created_By || row?.created_by || ''),
    safeTrim(row?.Status || row?.status || ''),
    safeTrim(row?.Offer_ID || row?.offer_id || row?.id || ''),
    stringifyLoose(row?.Message_Context ?? row?.message_context ?? row?.messageContext ?? ''),
    stringifyLoose(row?.AI_Analysis ?? row?.ai_analysis ?? ''),
  ].join(' ');

  return {
    isSeed: SEED_RE.test(parts),
    isTexas: TX_RE.test(parts),
  };
}

function topN(map, n) {
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function tryParseJson(v) {
  try {
    if (!v) return null;
    if (typeof v === 'object') return v;
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!s) return null;
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function extractLegacyDescription(row) {
  try {
    const ctx = tryParseJson(row?.Message_Context ?? row?.message_context ?? row?.messageContext);
    if (!ctx || typeof ctx !== 'object') return '';
    const d1 = ctx?.latest_offer_brief?.metadata?.description;
    const d2 = ctx?.latest_offer_brief?.description;
    return safeTrim(d1 || d2 || '');
  } catch {
    return '';
  }
}

function extractOfferBuilderName(row) {
  try {
    const ctx = tryParseJson(row?.Message_Context ?? row?.message_context ?? row?.messageContext);
    if (!ctx || typeof ctx !== 'object') return '';
    const ob = ctx.offer_builder || ctx.offerBuilder;
    if (!ob || typeof ob !== 'object') return '';
    return safeTrim(ob.name || ob.offerName || '');
  } catch {
    return '';
  }
}

function findTexasLines(text) {
  try {
    const s = String(text || '');
    if (!s) return [];
    const lines = s.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    return lines.filter(l => TX_RE.test(l)).slice(0, 4);
  } catch {
    return [];
  }
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { res, data, text };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log('=== Probe Texas offers via API ===');
  console.log('base:', args.base);

  // 1) Read-only offers listing
  const offersUrl = `${args.base}/api/v1?action=offers&limit=${encodeURIComponent(args.limit)}&_ts=${Date.now()}`;
  const { res, data } = await fetchJson(offersUrl, { method: 'GET', headers: { 'accept': 'application/json' } });

  if (!res.ok || !data || data.ok !== true) {
    throw new Error(`Failed to load offers via API (${res.status}): ${data?.error || 'unknown error'}`);
  }

  const rows = Array.isArray(data.offers) ? data.offers : [];
  console.log('offers_returned:', rows.length);

  const creators = new Map();
  const statuses = new Map();
  let texas = 0;
  let seeded = 0;
  let both = 0;

  const texasRows = [];
  const nonTexasSeedRows = [];

  for (const r of rows) {
    const who = safeTrim(r?.Created_By || r?.created_by || '');
    const st = safeTrim(r?.Status || r?.status || '');
    creators.set(who || '(missing)', (creators.get(who || '(missing)') || 0) + 1);
    statuses.set(st || '(missing)', (statuses.get(st || '(missing)') || 0) + 1);

    const c = classify(r);
    if (c.isTexas) texas++;
    if (c.isSeed) seeded++;
    if (c.isTexas && c.isSeed) both++;

    const offerId = safeTrim(r?.Offer_ID || r?.offer_id || r?.id || '');
    const createdBy = who;
    const status = st;
    const obName = extractOfferBuilderName(r);
    const legacyDesc = extractLegacyDescription(r);
    const texasLines = findTexasLines(legacyDesc);

    if (c.isTexas && texasRows.length < args.show) {
      texasRows.push({
        offerId,
        createdBy,
        status,
        name: safeTrim(r?.Offer_Name || r?.offerName || r?.name || '') || obName,
        seed: c.isSeed ? 1 : 0,
        texasLines,
      });
    }

    if (!c.isTexas && c.isSeed && nonTexasSeedRows.length < args.show) {
      nonTexasSeedRows.push({
        offerId,
        createdBy,
        status,
        name: safeTrim(r?.Offer_Name || r?.offerName || r?.name || '') || obName,
      });
    }
  }

  console.log('texas_marker:', texas, 'seed_marker:', seeded, 'texas_and_seed:', both);
  console.log('top_creators:', topN(creators, 8));
  console.log('top_statuses:', topN(statuses, 8));

  if (texasRows.length) {
    console.log(`\nSample texas_marker offers (up to ${texasRows.length}):`);
    texasRows.forEach((x, idx) => {
      console.log(`- ${idx + 1}. ${x.offerId} by=${x.createdBy || 'UNKNOWN'} status=${x.status} seed=${x.seed} name=${x.name || '(no name)'}`);
      if (Array.isArray(x.texasLines) && x.texasLines.length) {
        x.texasLines.forEach((l) => console.log(`    TX-line: ${l}`));
      }
    });
  }

  if (nonTexasSeedRows.length) {
    console.log(`\nSample seed_marker BUT NOT texas_marker offers (up to ${nonTexasSeedRows.length}):`);
    nonTexasSeedRows.forEach((x, idx) => {
      console.log(`- ${idx + 1}. ${x.offerId} by=${x.createdBy || 'UNKNOWN'} status=${x.status} name=${x.name || '(no name)'}`);
    });
  }

  // 2) Optional purge endpoint (preview/apply)
  if (args.purgePreview || args.purgeApply) {
    if (!args.adminKey) throw new Error('Missing --adminKey for purge');

    const purgeUrl = `${args.base}/api/v1?action=purgeTexasOffers&_ts=${Date.now()}`;
    const body = {
      apply: !!args.purgeApply,
      limit: Math.max(1, Math.min(5000, args.limit)),
      reason: args.purgeApply ? 'purgeTexasOffers_apply' : 'purgeTexasOffers_preview',
    };

    const { res: pRes, data: pData } = await fetchJson(purgeUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-h2s-admin-key': args.adminKey,
      },
      body: JSON.stringify(body),
    });

    if (!pRes.ok || !pData || pData.ok !== true) {
      throw new Error(`purgeTexasOffers failed (${pRes.status}): ${pData?.error || 'unknown error'}`);
    }

    console.log(`\n=== purgeTexasOffers result (apply=${pData.apply}) ===`);
    console.log('scanned:', pData.scanned, 'matches:', pData.matches);
    if (Array.isArray(pData.preview) && pData.preview.length) {
      console.log('preview (first 20):');
      pData.preview.slice(0, 20).forEach((x, idx) => {
        console.log(`- ${idx + 1}. ${x.offerId} by=${x.createdBy || 'UNKNOWN'} status=${x.status || ''} name=${x.name || ''}`);
      });
    }
    if (pData.apply) {
      console.log('deleted:', pData.deleted, 'errors:', Array.isArray(pData.errors) ? pData.errors.length : 0);
    }
  }
}

main().catch((e) => {
  console.error('FAILED:', e && e.stack ? e.stack : e);
  process.exit(1);
});
