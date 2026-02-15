/*
Read-only profiler: find commonalities for "organic" offers vs seeded/test/Texas-pattern offers.

Goals:
- Connect to Supabase (MGMT and/or primary) using env from backend/.env.local (+ fallbacks)
- Load recent offers (default limit 2000)
- Classify rows by text markers (seed/test/demo/sample vs Texas markets)
- Compare creator/status, and whether rows have Deliverables (offer_brief) and creative links

Usage (PowerShell):
  # From repo root (runs with backend node_modules resolution)
  cd backend
  node ..\tools\profile-offers-organic-vs-seed.js --db both --limit 2000 --show 25

Args:
  --db mgmt|primary|both   (default both)
  --limit N               (default 2000; max 5000)
  --show N                (default 20)

Safety:
- Read-only
- Does not print secrets
- Prints only short snippets for context
*/

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadDotEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const envVars = {};

  for (const line of content.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const match = line.match(/^([^=#\s]+)=(.*)$/);
    if (!match) continue;
    const key = String(match[1] || '').trim();
    const value = String(match[2] || '').trim().replace(/^['"]|['"]$/g, '');
    if (!key) continue;
    if (envVars[key] == null || envVars[key] === '') envVars[key] = value;
  }

  return envVars;
}

function loadEnv() {
  const candidates = [
    path.join(__dirname, '..', 'backend', '.env.local'),
    path.join(__dirname, '..', 'backend', '.env'),
    path.join(__dirname, '..', '.env'),
  ];
  const fromFiles = candidates.reduce((acc, p) => Object.assign(acc, loadDotEnvFile(p)), {});
  return { ...fromFiles, ...process.env };
}

function pickFirst(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function safeTrim(raw) {
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function parseArgs(argv) {
  const out = { db: 'both', limit: 2000, show: 20 };
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--db') out.db = String(argv[i + 1] || out.db).trim();
    if (a === '--limit') out.limit = clampInt(argv[i + 1], 1, 5000, out.limit);
    if (a === '--show') out.show = clampInt(argv[i + 1], 0, 200, out.show);
  }
  out.db = ['mgmt', 'primary', 'both'].includes(out.db) ? out.db : 'both';
  return out;
}

const SEED_RE = /(\bseed\b|seeded|seed pack|\btest\b|demo|sample|lorem|ipsum|asdf|tmp|temp)/i;
const TX_RE = /(\baustin\b|\bhouston\b|\bdallas\b|san\s+antonio|\btexas\b|(^|[^a-z])tx([^a-z]|$))/i;

function classifyOffer(row) {
  let ctx = row?.Message_Context ?? row?.message_context ?? row?.messageContext ?? null;
  try {
    if (typeof ctx === 'string') ctx = JSON.parse(ctx || '{}');
  } catch {
    // ignore
  }
  if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) ctx = {};

  const ob = (ctx.offer_builder || ctx.offerBuilder || ctx.offer || null) && typeof (ctx.offer_builder || ctx.offerBuilder || ctx.offer) === 'object'
    ? (ctx.offer_builder || ctx.offerBuilder || ctx.offer)
    : {};

  const name = safeTrim(
    ctx.offerName ||
      ctx.offer_name ||
      ctx.name ||
      ctx.title ||
      ob.name ||
      ob.offerName ||
      row?.Offer_Name ||
      row?.offerName ||
      row?.name ||
      row?.Title ||
      ''
  );
  const who = safeTrim(row?.Created_By || row?.created_by || '');
  const status = safeTrim(row?.Status || row?.status || '');
  const id = safeTrim(row?.Offer_ID || row?.offer_id || row?.id || '');

  const ctxRaw = row?.Message_Context ?? row?.message_context ?? row?.messageContext ?? '';
  const aiRaw = row?.AI_Analysis ?? row?.ai_analysis ?? '';
  const hay = `${name} ${who} ${status} ${id} ${String(ctxRaw || '')} ${String(aiRaw || '')}`;

  const isSeed = SEED_RE.test(hay);
  const isTexas = TX_RE.test(hay);

  return { isSeed, isTexas };
}

function inc(map, key) {
  const k = safeTrim(key || '(missing)') || '(missing)';
  map.set(k, (map.get(k) || 0) + 1);
}

function topN(map, n = 10) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, n));
}

async function loadOffers(db, limit) {
  const tryTable = async (table) => {
    const { data, error } = await db
      .from(table)
      .select('Offer_ID, Created_By, Created_At, Updated_At, Status, Message_Context, AI_Analysis')
      .order('Updated_At', { ascending: false })
      .limit(limit);
    return { table, data, error };
  };

  // Some envs use lowercase table names.
  const attempts = [await tryTable('Offers'), await tryTable('offers')];
  const ok = attempts.find((a) => !a.error);
  if (ok) return Array.isArray(ok.data) ? ok.data : [];

  const err = attempts[0].error || attempts[1].error;
  throw new Error(`Failed to load Offers: ${err?.message || String(err)}`);
}

async function loadDeliverableSignals(db, offerIds) {
  const hasAnyDeliverable = new Set();
  const hasOfferBrief = new Set();

  const pickDeliverablesTable = async () => {
    const tables = ['Deliverables', 'deliverables'];
    for (const t of tables) {
      const { error } = await db.from(t).select('Offer_ID').limit(1);
      if (!error) return t;
      const msg = String(error.message || '').toLowerCase();
      if (msg.includes('could not find the table') || (msg.includes('relation') && msg.includes('does not exist'))) continue;
    }
    return null;
  };

  const deliverablesTable = await pickDeliverablesTable();
  if (!deliverablesTable) return { hasAnyDeliverable, hasOfferBrief };

  const chunkSize = 200;
  for (let i = 0; i < offerIds.length; i += chunkSize) {
    const chunk = offerIds.slice(i, i + chunkSize);
    const { data, error } = await db
      .from(deliverablesTable)
      .select('Offer_ID, Deliverable_Type')
      .in('Offer_ID', chunk);

    if (error) throw new Error(`Failed to load Deliverables: ${error.message || String(error)}`);

    for (const d of (Array.isArray(data) ? data : [])) {
      const id = safeTrim(d.Offer_ID);
      if (!id) continue;
      hasAnyDeliverable.add(id);
      const t = safeTrim(d.Deliverable_Type).toLowerCase();
      if (t === 'offer_brief') hasOfferBrief.add(id);
    }
  }

  return { hasAnyDeliverable, hasOfferBrief };
}

async function loadCreativeLinkSignals(db, offerIds) {
  const hasCreativeLinks = new Set();
  const chunkSize = 200;

  for (let i = 0; i < offerIds.length; i += chunkSize) {
    const chunk = offerIds.slice(i, i + chunkSize);

    const { data, error } = await db
      .from('ad_creative_links')
      .select('offer_id')
      .in('offer_id', chunk);

    if (error) {
      const msg = String(error.message || '').toLowerCase();
      if (msg.includes('relation') && msg.includes('does not exist')) {
        return { hasCreativeLinks, missingTable: true };
      }
      throw new Error(`Failed to load ad_creative_links: ${error.message || String(error)}`);
    }

    for (const r of (Array.isArray(data) ? data : [])) {
      const id = safeTrim(r.offer_id);
      if (id) hasCreativeLinks.add(id);
    }
  }

  return { hasCreativeLinks, missingTable: false };
}

function summarize(label, rows, signals, showN) {
  const creators = new Map();
  const statuses = new Map();

  let texas = 0;
  let seeded = 0;
  let texasAndSeeded = 0;

  let texasWithOfferBrief = 0;
  let texasWithoutOfferBrief = 0;

  let seededWithOfferBrief = 0;
  let seededWithoutOfferBrief = 0;

  for (const r of rows) {
    inc(creators, r.Created_By);
    inc(statuses, r.Status);

    const c = classifyOffer(r);
    if (c.isTexas) texas++;
    if (c.isSeed) seeded++;
    if (c.isTexas && c.isSeed) texasAndSeeded++;

    const id = safeTrim(r.Offer_ID);
    const hasBrief = signals.hasOfferBrief.has(id);

    if (c.isTexas) {
      if (hasBrief) texasWithOfferBrief++;
      else texasWithoutOfferBrief++;
    }

    if (c.isSeed) {
      if (hasBrief) seededWithOfferBrief++;
      else seededWithoutOfferBrief++;
    }
  }

  const texasRows = rows
    .map((r) => ({ r, c: classifyOffer(r) }))
    .filter((x) => x.c.isTexas)
    .slice(0, Math.max(0, showN));

  console.log(`\n=== ${label} Offers profile ===`);
  console.log('total:', rows.length);
  console.log('texas_marker:', texas, 'seed_marker:', seeded, 'texas_and_seed:', texasAndSeeded);
  console.log('texas_with_offer_brief:', texasWithOfferBrief, 'texas_without_offer_brief:', texasWithoutOfferBrief);
  console.log('seed_with_offer_brief:', seededWithOfferBrief, 'seed_without_offer_brief:', seededWithoutOfferBrief);
  console.log('top_creators:', topN(creators, 10));
  console.log('top_statuses:', topN(statuses, 10));

  if (texasRows.length) {
    console.log(`\nSample texas_marker offers (up to ${texasRows.length}):`);
    for (const { r, c } of texasRows) {
      const id = safeTrim(r.Offer_ID);
      const hasBrief = signals.hasOfferBrief.has(id) ? 1 : 0;
      const hasAnyDel = signals.hasAnyDeliverable.has(id) ? 1 : 0;
      const hasCreative = signals.hasCreativeLinks.has(id) ? 1 : 0;
      const name = safeTrim((() => {
        let ctx = r.Message_Context;
        try {
          if (typeof ctx === 'string') ctx = JSON.parse(ctx || '{}');
        } catch {
          ctx = {};
        }
        if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) ctx = {};
        const ob = (ctx.offer_builder || ctx.offerBuilder || ctx.offer || null) && typeof (ctx.offer_builder || ctx.offerBuilder || ctx.offer) === 'object'
          ? (ctx.offer_builder || ctx.offerBuilder || ctx.offer)
          : {};
        return ctx.offerName || ctx.offer_name || ctx.name || ctx.title || ob.name || ob.offerName || '';
      })());

      const ctxText = String(r.Message_Context == null ? '' : r.Message_Context);
      const snip = safeTrim(ctxText).slice(0, 140);

      console.log(
        `- ${id} by=${safeTrim(r.Created_By) || 'UNKNOWN'} status=${safeTrim(r.Status)} seed=${c.isSeed ? 1 : 0} offer_brief=${hasBrief} any_del=${hasAnyDel} creative_links=${hasCreative} name=${name || '(no name)'} snip=${snip ? JSON.stringify(snip) : '(none)'}`
      );
    }
  } else {
    console.log('\nNo texas_marker offers found in this sample.');
  }
}

async function profileDb(label, url, key, limit, showN) {
  if (!url || !key) {
    console.log(`\n=== ${label} skipped (missing env) ===`);
    return;
  }

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  let offers = [];
  try {
    offers = await loadOffers(db, limit);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e).toLowerCase();
    if (msg.includes('could not find the table') || (msg.includes('relation') && msg.includes('does not exist'))) {
      console.log(`\n=== ${label} skipped (offers table not found in this DB) ===`);
      return;
    }
    throw e;
  }

  const offerIds = offers.map((r) => safeTrim(r.Offer_ID)).filter(Boolean);
  const deliverableSignals = offerIds.length
    ? await loadDeliverableSignals(db, offerIds)
    : { hasAnyDeliverable: new Set(), hasOfferBrief: new Set() };

  const creativeSignals = offerIds.length
    ? await loadCreativeLinkSignals(db, offerIds)
    : { hasCreativeLinks: new Set(), missingTable: false };

  const signals = {
    hasAnyDeliverable: deliverableSignals.hasAnyDeliverable,
    hasOfferBrief: deliverableSignals.hasOfferBrief,
    hasCreativeLinks: creativeSignals.hasCreativeLinks,
  };

  summarize(label, offers, signals, showN);

  if (creativeSignals.missingTable) {
    console.log('(note) ad_creative_links table missing in this DB; creative link signal unavailable.');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();

  const primaryUrl = pickFirst(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_URL);
  const primaryKey = pickFirst(env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_SERVICE_KEY);

  const mgmtUrl = pickFirst(env.SUPABASE_URL_MGMT, env.NEXT_PUBLIC_SUPABASE_URL_MGMT);
  const mgmtKey = pickFirst(env.SUPABASE_SERVICE_ROLE_KEY_MGMT, env.SUPABASE_SERVICE_KEY_MGMT);

  console.log('=== Offer profiler (read-only) ===');
  console.log('db:', args.db, 'limit:', args.limit, 'show:', args.show);
  console.log('primary_url_present:', !!primaryUrl, 'primary_key_present:', !!primaryKey);
  console.log('mgmt_url_present:', !!mgmtUrl, 'mgmt_key_present:', !!mgmtKey);

  if (args.db === 'primary' || args.db === 'both') {
    await profileDb('PRIMARY', primaryUrl, primaryKey, args.limit, args.show);
  }

  if (args.db === 'mgmt' || args.db === 'both') {
    await profileDb('MGMT', mgmtUrl, mgmtKey, args.limit, args.show);
  }
}

main().catch((e) => {
  console.error('FAILED:', e && e.stack ? e.stack : e);
  process.exit(1);
});
