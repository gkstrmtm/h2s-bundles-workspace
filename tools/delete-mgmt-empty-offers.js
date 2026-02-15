/*
Delete MGMT Offers that are clearly garbage: empty lineItems AND no Deliverables linked.

Default is DRY-RUN.

Usage:
  node .\tools\delete-mgmt-empty-offers.js --since 2026-02-13 --createdBy TABARIR
  node .\tools\delete-mgmt-empty-offers.js --since 2026-02-13 --createdBy TABARIR --apply

Criteria:
- OfferBuilder snapshot exists
- offer_builder.lineItems is [] (or missing)
- No Deliverables rows exist for that Offer_ID
- Optional filters: since date (Created_At >=), createdBy exact match

Safety:
- Uses service key
- Prints IDs it will delete (capped)
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
  const out = { since: null, createdBy: null, apply: false, limit: 500 };
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] || '');
    if (a === '--since') out.since = String(argv[i + 1] || '').trim() || null;
    if (a === '--createdBy') out.createdBy = String(argv[i + 1] || '').trim() || null;
    if (a === '--apply') out.apply = true;
    if (a === '--limit') out.limit = Number(argv[i + 1] || out.limit) || out.limit;
  }
  return out;
}

function getOfferBuilderSnapshot(messageContext) {
  if (!messageContext || typeof messageContext !== 'object') return null;
  return messageContext.offer_builder || messageContext.offerBuilder || null;
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

  const sinceIso = args.since ? (/T/.test(args.since) ? args.since : `${args.since}T00:00:00.000Z`) : null;
  const sinceDate = sinceIso ? new Date(sinceIso) : null;

  const db = createClient(url, key, { auth: { persistSession: false } });

  let q = db
    .from('Offers')
    .select('Offer_ID, Created_At, Created_By, Message_Context')
    .order('Created_At', { ascending: false })
    .limit(Math.max(1, Math.min(2000, args.limit || 500)));

  if (args.createdBy) q = q.eq('Created_By', args.createdBy);

  const { data: offers, error: offersErr } = await q;
  if (offersErr) {
    console.error('Failed to load offers:', offersErr.message || offersErr);
    process.exit(1);
  }

  const rows = Array.isArray(offers) ? offers : [];

  // candidate empty offers
  const candidates = [];
  for (const r of rows) {
    const offerId = safeTrim(r.Offer_ID);
    if (!offerId) continue;

    const createdAt = new Date(String(r.Created_At || ''));
    if (sinceDate && createdAt && !isNaN(createdAt.getTime()) && createdAt < sinceDate) continue;

    let ctx = r.Message_Context;
    try {
      if (typeof ctx === 'string') ctx = JSON.parse(ctx || '{}');
    } catch {
      ctx = {};
    }

    const ob = getOfferBuilderSnapshot(ctx);
    const items = ob && Array.isArray(ob.lineItems) ? ob.lineItems : [];
    if (items.length > 0) continue;

    candidates.push({ offerId, createdAt: safeTrim(r.Created_At), createdBy: safeTrim(r.Created_By) || 'UNKNOWN' });
  }

  const offerIds = candidates.map((x) => x.offerId);

  // Determine which candidates have deliverables.
  const hasDeliverables = new Set();
  if (offerIds.length) {
    const { data: dels, error: delErr } = await db
      .from('Deliverables')
      .select('Offer_ID')
      .in('Offer_ID', offerIds);

    if (delErr) {
      console.error('Failed to check deliverables:', delErr.message || delErr);
      process.exit(1);
    }

    for (const d of (Array.isArray(dels) ? dels : [])) {
      const id = safeTrim(d.Offer_ID);
      if (id) hasDeliverables.add(id);
    }
  }

  const toDelete = candidates.filter((x) => !hasDeliverables.has(x.offerId));

  console.log('=== Delete MGMT empty offers ===');
  console.log('since:', sinceIso || '(none)');
  console.log('createdBy:', args.createdBy || '(any)');
  console.log('scanned:', rows.length);
  console.log('candidates_emptyLineItems:', candidates.length);
  console.log('delete_emptyLineItems_noDeliverables:', toDelete.length);
  console.log('mode:', args.apply ? 'APPLY (will delete)' : 'DRY-RUN');

  toDelete.slice(0, 50).forEach((x, idx) => {
    console.log(`- ${idx + 1}. ${x.offerId} createdAt=${x.createdAt || '(n/a)'} by=${x.createdBy}`);
  });

  if (!args.apply) return;
  if (!toDelete.length) return;

  // Delete in chunks to stay under URL limits.
  const chunkSize = 50;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += chunkSize) {
    const chunk = toDelete.slice(i, i + chunkSize).map((x) => x.offerId);
    const { error: delErr } = await db
      .from('Offers')
      .delete()
      .in('Offer_ID', chunk);

    if (delErr) {
      console.error('Delete failed:', delErr.message || delErr);
      process.exit(1);
    }
    deleted += chunk.length;
  }

  console.log('deleted:', deleted);
}

main().catch((e) => {
  console.error('Fatal:', e && e.stack ? e.stack : e);
  process.exit(1);
});
