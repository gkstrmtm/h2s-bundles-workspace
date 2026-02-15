/*
Read-only report: show which MGMT Offers were created/updated today and whether they actually contain pricing inputs.

Usage:
  node .\tools\report-mgmt-offers-today.js
  node .\tools\report-mgmt-offers-today.js --since 2026-02-13
  node .\tools\report-mgmt-offers-today.js --limit 200

Safety:
- Read-only
- Avoids dumping huge JSON
*/

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadDotEnvFile(filePath) {
  if (!filePath) return {};
  if (!fs.existsSync(filePath)) return {};
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

function safeTrim(raw) {
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
}

function parseArgs(argv) {
  const out = { since: '2026-02-13', limit: 120 };
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--since') out.since = String(argv[i + 1] || out.since);
    if (a === '--limit') out.limit = Number(argv[i + 1] || out.limit) || out.limit;
  }
  return out;
}

function getOfferBuilderSnapshot(messageContext) {
  if (!messageContext || typeof messageContext !== 'object') return null;
  return messageContext.offer_builder || messageContext.offerBuilder || null;
}

function coercePositiveNumber(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return isFinite(raw) && raw > 0 ? raw : null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/-?\d[\d,]*(?:\.\d{1,2})?/);
  if (!m) return null;
  const n = Number(String(m[0]).replace(/,/g, ''));
  return isFinite(n) && n > 0 ? n : null;
}

function hasPricedLineItems(ob) {
  const items = ob && Array.isArray(ob.lineItems) ? ob.lineItems : [];
  for (const it of items) {
    const b = coercePositiveNumber(it && (it.baseUnitPrice ?? it.unitPrice));
    if (b != null) return true;
  }
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadEnv();

  const url = env.SUPABASE_URL_MGMT || env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY_MGMT || env.SUPABASE_SERVICE_KEY_MGMT || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('Missing Supabase MGMT env (SUPABASE_URL_MGMT + SUPABASE_SERVICE_KEY_MGMT).');
    process.exit(1);
  }

  const sinceIso = /T/.test(args.since) ? args.since : `${args.since}T00:00:00.000Z`;
  const sinceDate = new Date(sinceIso);

  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: offers, error: offersErr } = await db
    .from('Offers')
    .select('Offer_ID, Created_At, Updated_At, Created_By, Status, Message_Context')
    .order('Updated_At', { ascending: false })
    .limit(Math.max(1, Math.min(500, args.limit || 120)));

  if (offersErr) {
    console.error('Failed to load offers:', offersErr.message || offersErr);
    process.exit(1);
  }

  const rows = Array.isArray(offers) ? offers : [];
  const todayLike = rows.filter((r) => {
    const createdAt = new Date(String(r.Created_At || ''));
    const updatedAt = new Date(String(r.Updated_At || ''));
    return (
      (createdAt && !isNaN(createdAt.getTime()) && createdAt >= sinceDate) ||
      (updatedAt && !isNaN(updatedAt.getTime()) && updatedAt >= sinceDate)
    );
  });

  const offerIds = todayLike.map((r) => safeTrim(r.Offer_ID)).filter(Boolean);

  // Pull deliverable linkage for these offers.
  let deliverableMap = new Map();
  if (offerIds.length) {
    const { data: dels, error: delErr } = await db
      .from('Deliverables')
      .select('Offer_ID, Deliverable_Type')
      .in('Offer_ID', offerIds);

    if (!delErr && Array.isArray(dels)) {
      for (const d of dels) {
        const id = safeTrim(d.Offer_ID);
        if (!id) continue;
        if (!deliverableMap.has(id)) deliverableMap.set(id, new Set());
        deliverableMap.get(id).add(String(d.Deliverable_Type || '').toLowerCase());
      }
    }
  }

  const summary = {
    scanned: rows.length,
    since: sinceIso,
    touchedSince: todayLike.length,
    touchedSince_withLineItems: 0,
    touchedSince_withPricedLineItems: 0,
    touchedSince_emptyLineItems: 0,
    touchedSince_emptyLineItems_noDeliverables: 0,
  };

  const formatted = [];
  for (const r of todayLike) {
    let ctx = r.Message_Context;
    try {
      if (typeof ctx === 'string') ctx = JSON.parse(ctx || '{}');
    } catch {
      ctx = {};
    }
    const ob = getOfferBuilderSnapshot(ctx) || {};
    let items = Array.isArray(ob.lineItems) ? ob.lineItems : [];
    const hasItems = items.length > 0;
    const hasPrice = hasPricedLineItems(ob);

    if (hasItems) summary.touchedSince_withLineItems++;
    if (hasPrice) summary.touchedSince_withPricedLineItems++;
    if (!hasItems) {
      summary.touchedSince_emptyLineItems++;
      const id = safeTrim(r.Offer_ID);
      const types = deliverableMap.get(id);
      if (!types || !types.size) summary.touchedSince_emptyLineItems_noDeliverables++;
    }

    const id = safeTrim(r.Offer_ID);
    const delTypes = deliverableMap.get(id);
    const del = delTypes ? Array.from(delTypes).sort().join(',') : '';

    formatted.push({
      offerId: id,
      createdAt: safeTrim(r.Created_At),
      updatedAt: safeTrim(r.Updated_At),
      createdBy: safeTrim(r.Created_By),
      status: safeTrim(r.Status),
      offerName: safeTrim((ctx && (ctx.offerName || ctx.offer_name)) || (ob && (ob.name || ob.offerName)) || ''),
      lineItems: hasItems ? items.length : 0,
      priced: hasPrice ? 1 : 0,
      deliverables: del,
    });
  }

  console.log('=== MGMT Offers report (read-only) ===');
  console.log('since:', sinceIso);
  console.log('scanned:', summary.scanned);
  console.log('touchedSince:', summary.touchedSince);
  console.log('touchedSince_withLineItems:', summary.touchedSince_withLineItems);
  console.log('touchedSince_withPricedLineItems:', summary.touchedSince_withPricedLineItems);
  console.log('touchedSince_emptyLineItems:', summary.touchedSince_emptyLineItems);
  console.log('touchedSince_emptyLineItems_noDeliverables:', summary.touchedSince_emptyLineItems_noDeliverables);

  formatted
    .slice(0, 30)
    .forEach((x, idx) => {
      console.log(
        `- ${idx + 1}. ${x.offerId} createdAt=${x.createdAt || '(n/a)'} updatedAt=${x.updatedAt || '(n/a)'} by=${x.createdBy || 'UNKNOWN'} status=${x.status || ''} lineItems=${x.lineItems} priced=${x.priced} deliverables=${x.deliverables || '(none)'} name=${x.offerName || '(no name)'}`
      );
    });
}

main().catch((e) => {
  console.error('Fatal:', e && e.stack ? e.stack : e);
  process.exit(1);
});
