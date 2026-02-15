/*
Repair MGMT Offers rows using MGMT Deliverables offer_brief descriptions.

Problem:
- MGMT Offers.Message_Context.offer_builder exists but lineItems/pricing are empty, so portal economics show $0.
- MGMT Deliverables contains offer_brief rows with a compact Description containing Services + Customer Price.

What this script does:
- Reads MGMT Deliverables where Deliverable_Type='offer_brief' (most recent first)
- Parses Description for:
  - services list (name + qty)
  - customer price
- If the linked Offer's offer_builder snapshot has missing/empty lineItems, writes back a minimal lineItems array.
  - baseUnitPrice is inferred by evenly splitting customer price across total qty units.
  - pricingStrategy is set to 'sum' (so totals compute from lineItems).

Safety:
- Dry-run by default.
- Does not print secrets.

Usage:
  node .\\tools\\repair-mgmt-offers-from-brief-deliverables.js --limit 200           # dry-run
  node .\\tools\\repair-mgmt-offers-from-brief-deliverables.js --limit 200 --apply   # write updates
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
    let value = String(match[2] || '').trim();
    value = value.replace(/^['"]|['"]$/g, '');
    if (key && envVars[key] == null) envVars[key] = value;
  }

  return envVars;
}

function pickFirst(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function safeTrim(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

function parseMoney(text) {
  const s = safeTrim(text);
  if (!s) return 0;
  const cleaned = s.replace(/[^0-9.]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function parseBriefDescription(descRaw) {
  const desc = safeTrim(descRaw);
  if (!desc) return { ok: false, error: 'empty_description' };

  // Customer Price
  const priceMatch = desc.match(/Customer\s*Price\s*:\s*\$\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
  const customerPrice = priceMatch ? parseMoney(priceMatch[1]) : 0;

  // Services section: between "Services:" and "Customer Price:" (or end)
  const servicesMatch = desc.match(/Services\s*:\s*(.+?)(?:\s+Customer\s*Price\s*:|$)/i);
  const servicesRaw = servicesMatch ? safeTrim(servicesMatch[1]) : '';

  const services = [];
  if (servicesRaw) {
    // Split on commas that separate items.
    const parts = servicesRaw.split(/\s*,\s*/).map(s => safeTrim(s)).filter(Boolean);
    for (const part of parts) {
      // Supports "x" or "×"
      const m = part.match(/^(.*?)(?:\s*[x×]\s*(\d+))?$/i);
      if (!m) continue;
      const name = safeTrim(m[1]);
      const qty = Math.max(1, Number(m[2] || 1) || 1);
      if (!name) continue;
      services.push({ name, qty });
    }
  }

  if (!services.length) return { ok: false, error: 'no_services_parsed', customerPrice };
  if (!(customerPrice > 0)) return { ok: false, error: 'no_customer_price', customerPrice, services };

  return { ok: true, customerPrice, services };
}

function getOfferBuilderSnapshot(messageContext) {
  if (!messageContext || typeof messageContext !== 'object') return null;
  return messageContext.offer_builder || messageContext.offerBuilder || null;
}

function normalizeOfferNameFromTitle(title) {
  const t = safeTrim(title);
  if (!t) return '';
  const prefix = 'offer brief:';
  if (t.toLowerCase().startsWith(prefix)) return safeTrim(t.slice(prefix.length));
  return t;
}

function parseArgs(argv) {
  const args = { limit: 200, apply: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = Math.max(1, Math.min(1000, Number(argv[++i]) || args.limit));
    else if (a === '--apply') args.apply = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  const envPath = path.join(__dirname, '..', 'backend', '.env.local');
  const env = loadDotEnvFile(envPath);

  const mgmtUrl = pickFirst(env.SUPABASE_URL_MGMT, env.NEXT_PUBLIC_SUPABASE_URL_MGMT);
  const mgmtKey = pickFirst(env.SUPABASE_SERVICE_ROLE_KEY_MGMT, env.SUPABASE_SERVICE_KEY_MGMT);

  if (!mgmtUrl || !mgmtKey) {
    console.error('Missing SUPABASE_URL_MGMT + SUPABASE_SERVICE_KEY_MGMT in backend/.env.local');
    process.exit(2);
  }

  const sb = createClient(mgmtUrl, mgmtKey, { auth: { persistSession: false, autoRefreshToken: false } });

  console.log('=== REPAIR MGMT OFFERS FROM OFFER_BRIEF DELIVERABLES ===');
  console.log(`Mode: ${args.apply ? 'APPLY (writes updates)' : 'DRY-RUN'}`);
  console.log(`Scan limit: ${args.limit}`);

  const { data: briefs, error: briefsErr } = await sb
    .from('Deliverables')
    .select('Deliverable_ID, Offer_ID, Deliverable_Type, Title, Description, Created_At')
    .eq('Deliverable_Type', 'offer_brief')
    .not('Offer_ID', 'is', null)
    .order('Created_At', { ascending: false })
    .limit(args.limit);

  if (briefsErr) throw new Error(`Failed to load offer briefs: ${briefsErr.message}`);
  const rows = Array.isArray(briefs) ? briefs : [];

  let scanned = 0;
  let parsedOk = 0;
  let offersLoaded = 0;
  let needsRepair = 0;
  let updated = 0;
  let skippedAlreadyHasLineItems = 0;
  let skippedParseFail = 0;
  let errors = 0;

  const examples = [];

  for (const d of rows) {
    scanned++;
    const offerId = safeTrim(d.Offer_ID);
    if (!offerId) continue;

    const parsed = parseBriefDescription(d.Description);
    if (!parsed.ok) {
      skippedParseFail++;
      continue;
    }
    parsedOk++;

    const { data: offerRow, error: offerErr } = await sb
      .from('Offers')
      .select('Offer_ID, Message_Context, Updated_At')
      .eq('Offer_ID', offerId)
      .maybeSingle();

    if (offerErr) {
      errors++;
      continue;
    }
    if (!offerRow) continue;
    offersLoaded++;

    let ctx = offerRow.Message_Context;
    try { if (typeof ctx === 'string') ctx = JSON.parse(ctx || '{}'); } catch { ctx = {}; }
    if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) ctx = {};

    let ob = getOfferBuilderSnapshot(ctx);
    try { if (typeof ob === 'string') ob = JSON.parse(ob || '{}'); } catch { ob = {}; }
    if (!ob || typeof ob !== 'object' || Array.isArray(ob)) ob = {};

    const existingItems = Array.isArray(ob.lineItems) ? ob.lineItems.filter(Boolean) : [];
    if (existingItems.length > 0) {
      skippedAlreadyHasLineItems++;
      continue;
    }

    needsRepair++;

    // Package pricing model:
    // - keep service rows for operator clarity (priced at $0)
    // - add a single priced line item so subtotalBase/customerPrice compute correctly
    const nextLineItems = parsed.services.map((s) => ({
      name: s.name,
      qty: s.qty,
      baseUnitPrice: 0,
      unitPrice: 0,
      equipMode: 'BYO',
      equipCostPerUnit: 0,
      isIncludedInOffer: true,
    }));
    nextLineItems.push({
      name: 'Package Price',
      qty: 1,
      baseUnitPrice: round2(parsed.customerPrice),
      unitPrice: round2(parsed.customerPrice),
      equipMode: 'BYO',
      equipCostPerUnit: 0,
      isIncludedInOffer: true,
    });

    const offerName = normalizeOfferNameFromTitle(d.Title) || safeTrim(ob.name) || safeTrim(ctx.offerName) || '';

    const nextOb = {
      ...ob,
      ...(offerName ? { name: offerName } : {}),
      lineItems: nextLineItems,
      pricingStrategy: 'sum',
      percentOff: 0,
      dollarOff: 0,
      bundlePrice: 0,
      expectedAOV: Number(ob.expectedAOV || 0) || 0,
    };

    const nextCtx = {
      ...ctx,
      ...(offerName ? { offerName } : {}),
      offer_builder: nextOb,
    };

    if (examples.length < 8) {
      examples.push({
        offerId,
        offerName,
        services: parsed.services,
        customerPrice: parsed.customerPrice,
        pricingApproach: 'package_line_item',
      });
    }

    if (!args.apply) continue;

    const { error: updErr } = await sb
      .from('Offers')
      .update({ Message_Context: nextCtx, Updated_At: new Date().toISOString() })
      .eq('Offer_ID', offerId);

    if (updErr) {
      errors++;
      continue;
    }
    updated++;
  }

  console.log('\n--- Summary ---');
  console.log({
    scannedBriefs: scanned,
    parsedOk,
    offersLoaded,
    needsRepair,
    skippedAlreadyHasLineItems,
    skippedParseFail,
    updated,
    errors,
  });

  if (examples.length) {
    console.log('\nExamples (what would be written):');
    for (const ex of examples) console.log(ex);
  }

  if (!args.apply) {
    console.log('\nDry-run complete. Re-run with --apply to write updates.');
  } else {
    console.log('\nApply complete. Re-run the audit to verify Offers now have lineItems/pricing signals.');
  }
}

main().catch((e) => {
  console.error('Fatal:', e && e.message ? e.message : String(e));
  process.exit(1);
});
