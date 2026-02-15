/*
Read-only DB audit for the Offer pipeline.

Goal: Prove what actually exists in Supabase for:
- Offers.Message_Context.offer_builder (lineItems + pricing fields)
- Offers.Economics blob presence
- Offers.AI_Analysis frameworks presence
- Deliverables linkage for Offer Briefs (Offer_ID + Deliverable_Type)

Safety:
- Never prints secret keys
- Avoids dumping full JSON blobs; prints counts + a few IDs only

Usage (PowerShell):
  $env:SUPABASE_URL='https://...supabase.co'
  $env:SUPABASE_SERVICE_ROLE_KEY='...'
  $env:SUPABASE_URL_MGMT='https://...supabase.co'           # optional
  $env:SUPABASE_SERVICE_ROLE_KEY_MGMT='...'                 # optional
  node .\tools\audit-offers-truth.js --limit 30

Optional:
  --limit 30
  --show-ids 10
*/

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function formatSbError(error) {
  if (!error) return 'Unknown error';
  return String(
    error.message ||
    error.details ||
    error.hint ||
    error.code ||
    JSON.stringify(error)
  );
}

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
  const merged = { ...fromFiles, ...process.env };
  return merged;
}

function pickFirst(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function redactUrl(url) {
  if (!url) return '(missing)';
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '(invalid url)';
  }
}

function keyKind(env, keyValue, { allowAnon = true } = {}) {
  if (!keyValue) return 'missing';
  if (keyValue === env.SUPABASE_SERVICE_ROLE_KEY || keyValue === env.SUPABASE_SERVICE_KEY) return 'service';
  if (allowAnon && keyValue === env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return 'anon';
  // could be provided via process.env under different name
  if (keyValue === env.SUPABASE_SERVICE_ROLE_KEY_MGMT || keyValue === env.SUPABASE_SERVICE_KEY_MGMT) return 'service';
  return 'unknown';
}

function safeObjKeys(obj) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.keys(obj);
}

function getOfferBuilderSnapshot(messageContext) {
  if (!messageContext || typeof messageContext !== 'object') return null;
  return (
    messageContext.offer_builder ||
    messageContext.offerBuilder ||
    messageContext.offer ||
    null
  );
}

function getLegacyBriefDescription(messageContext) {
  try {
    const d = messageContext?.latest_offer_brief?.metadata?.description;
    if (typeof d === 'string' && d.trim()) return d;
  } catch (_) {}
  return null;
}

function getOfferName(messageContext) {
  if (!messageContext || typeof messageContext !== 'object') return null;
  const candidates = [
    messageContext.offerName,
    messageContext.offer_name,
    messageContext.name,
    messageContext.offerTitle,
    messageContext.offer_title,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

function findLineItemsInfo(snapshot, { maxDepth = 4 } = {}) {
  const queue = [{ value: snapshot, path: 'offer_builder', depth: 0 }];
  const seen = new Set();
  const candidateKeys = new Set(['lineItems', 'line_items']);

  while (queue.length) {
    const { value, path, depth } = queue.shift();
    if (!value || typeof value !== 'object') continue;
    if (seen.has(value)) continue;
    seen.add(value);

    if (depth > maxDepth) continue;

    for (const k of Object.keys(value)) {
      const v = value[k];
      if (candidateKeys.has(k) && Array.isArray(v)) {
        return { path: `${path}.${k}`, items: v.filter(Boolean) };
      }
    }

    for (const k of Object.keys(value)) {
      const v = value[k];
      if (!v || typeof v !== 'object') continue;
      if (Array.isArray(v)) continue; // don't walk arbitrary arrays
      queue.push({ value: v, path: `${path}.${k}`, depth: depth + 1 });
    }
  }

  return { path: null, items: [] };
}

function normalizeLineItems(snapshot) {
  const info = findLineItemsInfo(snapshot);
  return info.items;
}

function countPricingSignals(items) {
  let withBaseUnitPrice = 0;
  let withUnitPrice = 0;
  let withAnyPrice = 0;
  let placeholders = 0;

  for (const it of items) {
    const base = Number(it.baseUnitPrice ?? it.base_unit_price ?? 0) || 0;
    const unit = Number(it.unitPrice ?? it.unit_price ?? 0) || 0;
    const qty = Number(it.qty ?? it.quantity ?? 1) || 1;
    const name = String(it.name ?? '').trim();

    if (base > 0) withBaseUnitPrice++;
    if (unit > 0) withUnitPrice++;
    if (base > 0 || unit > 0) withAnyPrice++;

    const isPlaceholder = !name && base <= 0 && unit <= 0 && qty === 1;
    if (isPlaceholder) placeholders++;
  }

  return { withBaseUnitPrice, withUnitPrice, withAnyPrice, placeholders };
}

function frameworksSummary(aiAnalysis, messageContext) {
  const sources = [
    aiAnalysis?.offer_frameworks,
    aiAnalysis?.offerFrameworks,
    messageContext?.offer_frameworks,
    messageContext?.offerFrameworks,
  ];

  for (const fw of sources) {
    if (!fw || typeof fw !== 'object') continue;
    const pillars = Array.isArray(fw.pillars) ? fw.pillars : [];
    if (pillars.length) {
      return { present: true, pillars: pillars.length };
    }
    // still consider "present" if object has keys
    const keys = safeObjKeys(fw);
    if (keys.length) return { present: true, pillars: 0 };
  }

  return { present: false, pillars: 0 };
}

function parseArgs(argv) {
  const args = { limit: 30, showIds: 10 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = Number(argv[++i]) || args.limit;
    else if (a === '--show-ids') args.showIds = Number(argv[++i]) || args.showIds;
  }
  return args;
}

async function auditOffers(sb, tableName, { limit, showIds }) {
  const res = {
    scanned: 0,
    withSnapshot: 0,
    withLineItems: 0,
    withAnyPrice: 0,
    withBaseUnitPrice: 0,
    onlyUnitPrice: 0,
    placeholdersOnly: 0,
    withLegacyDesc: 0,
    economicsNonEmpty: 0,
    frameworksPresent: 0,
    ghostLike: 0,
    examples: {
      onlyUnitPrice: [],
      placeholdersOnly: [],
      ghostLike: [],
    },
    samples: [],
  };

  async function fetchRows(orderColumn) {
    const q = sb.from(tableName).select('*').limit(limit);
    if (orderColumn) q.order(orderColumn, { ascending: false });
    return q;
  }

  let data = null;
  let error = null;
  ({ data, error } = await fetchRows('Created_At'));
  if (error) ({ data, error } = await fetchRows('created_at'));
  if (error) ({ data, error } = await fetchRows(null));

  if (error) throw new Error(`Offers query failed: ${formatSbError(error)}`);
  const rows = Array.isArray(data) ? data : [];

  for (const row of rows) {
    res.scanned++;

    const messageContext = row.Message_Context || row.message_context;
    const snapshot = getOfferBuilderSnapshot(messageContext);
    const legacyDesc = getLegacyBriefDescription(messageContext);
    const lineItemsInfo = findLineItemsInfo(snapshot);
    const items = lineItemsInfo.items;
    const pricing = countPricingSignals(items);
    const econKeys = safeObjKeys(row.Economics || row.economics);
    const fw = frameworksSummary(row.AI_Analysis || row.ai_analysis, messageContext);

    if (snapshot) res.withSnapshot++;
    if (items.length) res.withLineItems++;

    if (pricing.withAnyPrice > 0) res.withAnyPrice++;
    if (pricing.withBaseUnitPrice > 0) res.withBaseUnitPrice++;

    const hasOnlyUnitPrice = pricing.withUnitPrice > 0 && pricing.withBaseUnitPrice === 0;
    if (hasOnlyUnitPrice) {
      res.onlyUnitPrice++;
      const offerId = row.Offer_ID || row.offer_id || row.id || null;
      if (offerId && res.examples.onlyUnitPrice.length < showIds) res.examples.onlyUnitPrice.push(offerId);
    }

    const hasOnlyPlaceholders = items.length > 0 && pricing.placeholders === items.length;
    if (hasOnlyPlaceholders) {
      res.placeholdersOnly++;
      const offerId = row.Offer_ID || row.offer_id || row.id || null;
      if (offerId && res.examples.placeholdersOnly.length < showIds) res.examples.placeholdersOnly.push(offerId);
    }

    if (legacyDesc) res.withLegacyDesc++;
    if (econKeys.length) res.economicsNonEmpty++;
    if (fw.present) res.frameworksPresent++;

    const hasMeaningfulSignals =
      (snapshot && !hasOnlyPlaceholders) ||
      pricing.withAnyPrice > 0 ||
      !!legacyDesc ||
      econKeys.length > 0 ||
      fw.present;

    if (!hasMeaningfulSignals) {
      res.ghostLike++;
      const offerId = row.Offer_ID || row.offer_id || row.id || null;
      if (offerId && res.examples.ghostLike.length < showIds) res.examples.ghostLike.push(offerId);
    }

    if (res.samples.length < 3) {
      const offerId = row.Offer_ID || row.offer_id || row.id || null;
      const createdAt = row.Created_At || row.created_at || null;
      const offerName = getOfferName(messageContext);

      const pricingStrategy = snapshot && typeof snapshot === 'object'
        ? (snapshot.pricingStrategy || snapshot.pricing_strategy || '')
        : '';
      const bundlePrice = snapshot && typeof snapshot === 'object' ? Number(snapshot.bundlePrice || snapshot.bundle_price || 0) || 0 : 0;
      const percentOff = snapshot && typeof snapshot === 'object' ? Number(snapshot.percentOff || snapshot.percent_off || 0) || 0 : 0;
      const dollarOff = snapshot && typeof snapshot === 'object' ? Number(snapshot.dollarOff || snapshot.dollar_off || 0) || 0 : 0;
      const expectedAOV = snapshot && typeof snapshot === 'object' ? Number(snapshot.expectedAOV || snapshot.expected_aov || 0) || 0 : 0;

      res.samples.push({
        offerId,
        createdAt,
        offerName,
        snapshotKeys: safeObjKeys(snapshot).slice(0, 30),
        lineItemsPath: lineItemsInfo.path,
        lineItemsCount: items.length,
        pricingStrategy: String(pricingStrategy || ''),
        bundlePrice,
        percentOff,
        dollarOff,
        expectedAOV,
        pricingSignals: pricing,
        economicsKeys: econKeys.slice(0, 30),
        frameworksPresent: fw.present,
      });
    }
  }

  return res;
}

async function probeTableName(sb, tableName) {
  const { error } = await sb.from(tableName).select('*').limit(1);
  if (!error) return { ok: true, error: null };
  const msg = String(error.message || 'Unknown error');
  // Heuristic: missing from PostgREST schema cache means table isn't present/exposed in this project.
  if (/Could not find the table/i.test(msg) || /schema cache/i.test(msg)) {
    return { ok: false, error: msg };
  }
  // Any other error still indicates the table likely exists but query failed (RLS/privileges/etc.).
  return { ok: true, error: msg };
}

async function probeFirstWorkingTable(sb, candidates) {
  for (const name of candidates) {
    const p = await probeTableName(sb, name);
    if (p.ok) return { exists: true, tableName: name, error: p.error };
  }
  return { exists: false, tableName: null, error: null };
}

async function auditDeliverables(sb, tableName, { limit, showIds }) {
  const res = {
    offerBriefCount: null,
    offerBriefLinkedCount: null,
    offerBriefUnlinkedCount: null,
    legacyTitleCount: null,
    schema: {
      hasOfferId: false,
      hasDeliverableType: false,
      hasMetadata: false,
    },
    examples: {
      offerBriefUnlinked: [],
      legacyTitle: [],
    },
  };

  // Detect which columns exist in this Deliverables table (schema differs across deployments).
  {
    const { data, error } = await sb.from(tableName).select('*').limit(1);
    if (error) throw new Error(`Deliverables schema probe failed: ${formatSbError(error)}`);
    const row = Array.isArray(data) && data.length ? data[0] : null;
    const keys = row ? Object.keys(row) : [];
    const hasKey = (k) => keys.includes(k) || keys.includes(k.toLowerCase());

    res.schema.hasOfferId = hasKey('Offer_ID') || hasKey('offer_id');
    res.schema.hasDeliverableType = hasKey('Deliverable_Type') || hasKey('deliverable_type');
    res.schema.hasMetadata = hasKey('Metadata') || hasKey('metadata');
  }

  if (res.schema.hasDeliverableType) {
    {
      const { count, error } = await sb
        .from(tableName)
        .select('Deliverable_ID', { count: 'exact', head: true })
        .eq('Deliverable_Type', 'offer_brief');
      if (error) throw new Error(`Deliverables count (offer_brief) failed: ${formatSbError(error)}`);
      res.offerBriefCount = count ?? 0;
    }

    if (res.schema.hasOfferId) {
      {
        const { count, error } = await sb
          .from(tableName)
          .select('Deliverable_ID', { count: 'exact', head: true })
          .eq('Deliverable_Type', 'offer_brief')
          .not('Offer_ID', 'is', null);
        if (error) throw new Error(`Deliverables count (offer_brief linked) failed: ${formatSbError(error)}`);
        res.offerBriefLinkedCount = count ?? 0;
      }
      {
        const { count, error } = await sb
          .from(tableName)
          .select('Deliverable_ID', { count: 'exact', head: true })
          .eq('Deliverable_Type', 'offer_brief')
          .is('Offer_ID', null);
        if (error) throw new Error(`Deliverables count (offer_brief unlinked) failed: ${formatSbError(error)}`);
        res.offerBriefUnlinkedCount = count ?? 0;
      }
    }
  } else {
    {
      const { count, error } = await sb
        .from(tableName)
        .select('Deliverable_ID', { count: 'exact', head: true })
        .ilike('Title', 'Offer Brief:%');
      if (error) throw new Error(`Deliverables count (legacy Title prefix) failed: ${formatSbError(error)}`);
      res.legacyTitleCount = count ?? 0;
    }
    res.offerBriefCount = res.legacyTitleCount;
  }

  // Sample some rows that are unlinked offer briefs (only if schema supports it)
  if (res.schema.hasDeliverableType && res.schema.hasOfferId) {
    const { data, error } = await sb
      .from(tableName)
      .select('Deliverable_ID, Title, Offer_ID, Deliverable_Type, Created_At')
      .eq('Deliverable_Type', 'offer_brief')
      .is('Offer_ID', null)
      .order('Created_At', { ascending: false })
      .limit(Math.min(limit, showIds));
    if (error) throw new Error(`Deliverables sample (unlinked offer_brief) failed: ${formatSbError(error)}`);
    res.examples.offerBriefUnlinked = (data || []).map(r => r.Deliverable_ID).slice(0, showIds);
  }

  // Sample some legacy-title rows
  {
    const cols = ['Deliverable_ID', 'Title', 'Created_At'];
    if (res.schema.hasOfferId) cols.push('Offer_ID');
    if (res.schema.hasDeliverableType) cols.push('Deliverable_Type');

    const { data, error } = await sb
      .from(tableName)
      .select(cols.join(', '))
      .ilike('Title', 'Offer Brief:%')
      .order('Created_At', { ascending: false })
      .limit(Math.min(limit, showIds));
    if (error) throw new Error(`Deliverables sample (legacy title) failed: ${formatSbError(error)}`);
    res.examples.legacyTitle = (data || []).map(r => r.Deliverable_ID).slice(0, showIds);
  }

  return res;
}

async function main() {
  const args = parseArgs(process.argv);
  const env = loadEnv();

  const mainUrl = pickFirst(env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_URL);
  const mainKey = pickFirst(env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_SERVICE_KEY, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  const mgmtUrl = pickFirst(env.SUPABASE_URL_MGMT, env.NEXT_PUBLIC_SUPABASE_URL_MGMT);
  const mgmtKey = pickFirst(env.SUPABASE_SERVICE_ROLE_KEY_MGMT, env.SUPABASE_SERVICE_KEY_MGMT);

  console.log('=== OFFER PIPELINE DB TRUTH AUDIT (read-only) ===');
  console.log(`Main DB URL: ${redactUrl(mainUrl)}`);
  console.log(`Main DB key: ${keyKind(env, mainKey)} (len=${mainKey ? String(mainKey).length : 0})`);
  console.log(`MGMT DB URL: ${redactUrl(mgmtUrl)}`);
  console.log(`MGMT DB key: ${keyKind(env, mgmtKey, { allowAnon: false })} (len=${mgmtKey ? String(mgmtKey).length : 0})`);

  const clients = [];
  if (mainUrl && mainKey) {
    clients.push({
      name: 'main',
      url: mainUrl,
      sb: createClient(mainUrl, mainKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    });
  }
  if (mgmtUrl && mgmtKey) {
    clients.push({
      name: 'mgmt',
      url: mgmtUrl,
      sb: createClient(mgmtUrl, mgmtKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    });
  }

  if (!clients.length) {
    console.error('\n❌ Missing Supabase creds. Provide at least SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.');
    console.error('   This script reads from process env or backend/.env.local if present.');
    process.exit(2);
  }

  // Probe where the canonical tables actually live.
  const probes = {};
  for (const c of clients) {
    probes[c.name] = {
      Offers: await probeFirstWorkingTable(c.sb, ['Offers', 'offers']),
      Deliverables: await probeFirstWorkingTable(c.sb, ['Deliverables', 'deliverables']),
    };
  }

  console.log('\n--- Table Probe ---');
  for (const c of clients) {
    const p = probes[c.name];
    console.log(`${c.name.toUpperCase()} (${redactUrl(c.url)})`);
    console.log(`  Offers: ${p.Offers.exists ? `YES (${p.Offers.tableName})` : 'NO'}${p.Offers.error ? ` (${p.Offers.error})` : ''}`);
    console.log(`  Deliverables: ${p.Deliverables.exists ? `YES (${p.Deliverables.tableName})` : 'NO'}${p.Deliverables.error ? ` (${p.Deliverables.error})` : ''}`);
  }

  const offersClient = clients.find(c => probes[c.name].Offers.exists) || null;
  if (offersClient) {
    const offersTable = probes[offersClient.name].Offers.tableName;
    console.log(`\n--- Offers (${offersClient.name} DB, table=${offersTable}) ---`);
    try {
      const offers = await auditOffers(offersClient.sb, offersTable, args);
      console.log(`Scanned (most recent): ${offers.scanned}`);
      console.log(`With offer_builder snapshot: ${offers.withSnapshot}`);
      console.log(`With lineItems: ${offers.withLineItems}`);
      console.log(`With any price signal (baseUnitPrice or unitPrice): ${offers.withAnyPrice}`);
      console.log(`With baseUnitPrice > 0: ${offers.withBaseUnitPrice}`);
      console.log(`Only unitPrice (no baseUnitPrice): ${offers.onlyUnitPrice}`);
      console.log(`LineItems placeholders-only: ${offers.placeholdersOnly}`);
      console.log(`Legacy brief description present: ${offers.withLegacyDesc}`);
      console.log(`Economics blob non-empty: ${offers.economicsNonEmpty}`);
      console.log(`Frameworks present (AI_Analysis / Message_Context): ${offers.frameworksPresent}`);
      console.log(`Ghost-like (no meaningful signals): ${offers.ghostLike}`);

      if (offers.examples.onlyUnitPrice.length) {
        console.log(`Example Offer_IDs (only unitPrice): ${offers.examples.onlyUnitPrice.join(', ')}`);
      }
      if (offers.examples.placeholdersOnly.length) {
        console.log(`Example Offer_IDs (placeholders-only lineItems): ${offers.examples.placeholdersOnly.join(', ')}`);
      }
      if (offers.examples.ghostLike.length) {
        console.log(`Example Offer_IDs (ghost-like): ${offers.examples.ghostLike.join(', ')}`);
      }

      if (offers.samples && offers.samples.length) {
        console.log('\nSample recent offers (redacted snapshot):');
        for (const s of offers.samples) {
          const id = s.offerId || '(no id)';
          const created = s.createdAt ? String(s.createdAt) : '(no created_at)';
          const name = s.offerName ? JSON.stringify(s.offerName) : '(no offerName)';
          const keys = Array.isArray(s.snapshotKeys) ? s.snapshotKeys.join(', ') : '';
          const lineItems = `${s.lineItemsCount || 0} @ ${s.lineItemsPath || '(none)'}`;
          const pricing = s.pricingSignals || {};
          const econ = Array.isArray(s.economicsKeys) ? s.economicsKeys.join(', ') : '';
          const fw = s.frameworksPresent ? 'YES' : 'NO';
          const strategy = s.pricingStrategy ? String(s.pricingStrategy) : '';
          const bundlePrice = Number(s.bundlePrice || 0) || 0;
          const percentOff = Number(s.percentOff || 0) || 0;
          const dollarOff = Number(s.dollarOff || 0) || 0;
          const expectedAOV = Number(s.expectedAOV || 0) || 0;
          console.log(`- Offer_ID=${id} createdAt=${created}`);
          console.log(`  offerName=${name}`);
          console.log(`  snapshotKeys=[${keys}]`);
          console.log(`  lineItems=${lineItems}`);
          console.log(`  pricingStrategy=${strategy || '(missing)'} bundlePrice=${bundlePrice} percentOff=${percentOff} dollarOff=${dollarOff} expectedAOV=${expectedAOV}`);
          console.log(
            `  pricingSignals={any:${pricing.withAnyPrice || 0}, base:${pricing.withBaseUnitPrice || 0}, unit:${pricing.withUnitPrice || 0}, placeholders:${pricing.placeholders || 0}}`
          );
          console.log(`  economicsKeys=[${econ}] frameworksPresent=${fw}`);
        }
      }
    } catch (e) {
      console.log(`❌ Offers audit failed: ${e && e.message ? e.message : String(e)}`);
    }
  } else {
    console.log('\n--- Offers ---');
    console.log('❌ Could not find an accessible Offers table in any configured Supabase project.');
  }

  const deliverablesClients = clients.filter(c => probes[c.name].Deliverables.exists);
  if (deliverablesClients.length) {
    for (const c of deliverablesClients) {
      const delivsTable = probes[c.name].Deliverables.tableName;
      console.log(`\n--- Deliverables (${c.name} DB, table=${delivsTable}) ---`);
      try {
        const delivs = await auditDeliverables(c.sb, delivsTable, args);
        console.log(
          `Schema: Deliverable_Type=${delivs.schema.hasDeliverableType ? 'YES' : 'NO'} | Offer_ID=${delivs.schema.hasOfferId ? 'YES' : 'NO'} | Metadata=${delivs.schema.hasMetadata ? 'YES' : 'NO'}`
        );

        if (delivs.schema.hasDeliverableType) {
          console.log(`offer_brief count (Deliverable_Type='offer_brief'): ${delivs.offerBriefCount}`);
          if (delivs.schema.hasOfferId) {
            console.log(`offer_brief linked (Offer_ID set): ${delivs.offerBriefLinkedCount}`);
            console.log(`offer_brief unlinked (Offer_ID null): ${delivs.offerBriefUnlinkedCount}`);
          }
        } else {
          console.log(`offer brief count (legacy Title ilike 'Offer Brief:%'): ${delivs.legacyTitleCount}`);
        }

        if (delivs.examples.offerBriefUnlinked.length) {
          console.log(`Example Deliverable_IDs (offer_brief unlinked): ${delivs.examples.offerBriefUnlinked.join(', ')}`);
        }
        if (delivs.examples.legacyTitle.length) {
          console.log(`Example Deliverable_IDs (legacy title): ${delivs.examples.legacyTitle.join(', ')}`);
        }
      } catch (e) {
        console.log(`❌ Deliverables audit failed: ${e && e.message ? e.message : String(e)}`);
      }
    }
  } else {
    console.log('\n--- Deliverables ---');
    console.log('⚠️  Could not find an accessible Deliverables table in any configured Supabase project.');
  }

  console.log('\n✅ Audit complete.');
}

main().catch((err) => {
  console.error(`\n❌ Audit failed: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});
