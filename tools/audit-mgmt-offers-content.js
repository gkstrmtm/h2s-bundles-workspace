/*
Audit MGMT Offers for:
- offer_builder.offerDescription
- AI_Analysis.offer_frameworks

Usage:
  node .\\tools\\audit-mgmt-offers-content.js --limit 200
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
  return String(v == null ? '' : v).trim();
}

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function parseArgs(argv) {
  const args = { limit: 200 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = clampInt(argv[++i], 1, 1000, args.limit);
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

  const { data: offers, error: offersErr } = await sb
    .from('Offers')
    .select('Offer_ID, Created_By, Updated_At, Message_Context, AI_Analysis')
    .order('Updated_At', { ascending: false })
    .limit(args.limit);

  if (offersErr) throw new Error(`Failed to load MGMT Offers: ${offersErr.message}`);

  const rows = Array.isArray(offers) ? offers : [];

  let scanned = 0;
  let withDesc = 0;
  let withFrameworks = 0;
  let withGuidance = 0;
  let missingDesc = 0;
  let missingFrameworks = 0;
  let missingGuidance = 0;

  const missingDescExamples = [];
  const missingFwExamples = [];
  const missingGuidanceExamples = [];

  for (const row of rows) {
    scanned++;
    const offerId = safeTrim(row.Offer_ID);

    let ctx = parseMaybeJson(row.Message_Context) || row.Message_Context;
    if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) ctx = {};

    let ob = parseMaybeJson(ctx.offer_builder || ctx.offerBuilder) || ctx.offer_builder || ctx.offerBuilder || {};
    if (!ob || typeof ob !== 'object' || Array.isArray(ob)) ob = {};

    const desc = safeTrim(ob.offerDescription || ob.offer_description || '');
    const hasDesc = !!desc && desc.length >= 20;

    let ai = parseMaybeJson(row.AI_Analysis) || row.AI_Analysis;
    if (!ai || typeof ai !== 'object' || Array.isArray(ai)) ai = {};

    const fw = ai.offer_frameworks;
    const hasFw = !!(fw && typeof fw === 'object' && Array.isArray(fw.pillars) && fw.pillars.length);

    const fwObj = (fw && typeof fw === 'object' && !Array.isArray(fw)) ? fw : {};
    const summary = safeTrim(fwObj.summary || fwObj.framework_summary || '');
    const tof = safeTrim(fwObj.tof_guidance || fwObj.tofGuidance || '');
    const bof = safeTrim(fwObj.bof_guidance || fwObj.bofGuidance || '');
    const hasGuidance = !!(summary || tof || bof);

    if (hasDesc) withDesc++;
    else {
      missingDesc++;
      if (missingDescExamples.length < 6) missingDescExamples.push({ offerId, createdBy: row.Created_By, updatedAt: row.Updated_At });
    }

    if (hasFw) withFrameworks++;
    else {
      missingFrameworks++;
      if (missingFwExamples.length < 6) missingFwExamples.push({ offerId, createdBy: row.Created_By, updatedAt: row.Updated_At });
    }

    if (hasGuidance) withGuidance++;
    else {
      missingGuidance++;
      if (missingGuidanceExamples.length < 6) missingGuidanceExamples.push({ offerId, createdBy: row.Created_By, updatedAt: row.Updated_At });
    }
  }

  console.log('=== MGMT OFFERS CONTENT AUDIT ===');
  console.log({ scanned, withDesc, missingDesc, withFrameworks, missingFrameworks, withGuidance, missingGuidance });
  console.log('missingDescExamples:', missingDescExamples);
  console.log('missingFrameworksExamples:', missingFwExamples);
  console.log('missingGuidanceExamples:', missingGuidanceExamples);
}

main().catch((e) => {
  console.error('FAILED:', e && e.message ? e.message : e);
  process.exit(1);
});
