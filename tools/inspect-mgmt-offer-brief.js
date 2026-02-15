/*
Read-only inspector for a recent MGMT Deliverables.offer_brief row.
Prints a redacted description prefix and metadata keys only.

Usage:
  node .\tools\inspect-mgmt-offer-brief.js
*/

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const envVars = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const match = line.match(/^([^=#\s]+)=(.*)$/);
    if (!match) continue;
    const key = String(match[1] || '').trim();
    let value = String(match[2] || '').trim();
    value = value.replace(/^['"]|['"]$/g, '');
    if (key) envVars[key] = value;
  }
  return envVars;
}

function redactWhitespace(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function parseArgs(argv) {
  const out = { limit: 5 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') out.limit = Math.max(1, Math.min(50, Number(argv[++i]) || out.limit));
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const envPath = path.join(__dirname, '..', 'backend', '.env.local');
  const env = loadDotEnvFile(envPath);

  const url = env.SUPABASE_URL_MGMT;
  const key = env.SUPABASE_SERVICE_KEY_MGMT || env.SUPABASE_SERVICE_ROLE_KEY_MGMT;

  if (!url || !key) {
    console.error('Missing SUPABASE_URL_MGMT or SUPABASE_SERVICE_KEY_MGMT in backend/.env.local');
    process.exit(2);
  }

  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await sb
    .from('Deliverables')
    .select('Deliverable_ID, Offer_ID, Deliverable_Type, Title, Description, Metadata, Created_At')
    .eq('Deliverable_Type', 'offer_brief')
    .order('Created_At', { ascending: false })
    .limit(args.limit);

  if (error) {
    console.error('Query failed:', error.message || error);
    process.exit(1);
  }

  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) {
    console.log('No offer_brief deliverables found.');
    return;
  }

  console.log(`MGMT Deliverables offer_brief samples (redacted, n=${rows.length}):`);
  for (const row of rows) {
    const desc = String(row.Description || '');
    const descPrefix = redactWhitespace(desc.slice(0, 900));
    const md = row.Metadata;
    const mdKeys = md && typeof md === 'object' && !Array.isArray(md) ? Object.keys(md).slice(0, 40) : [];

    console.log({
      Deliverable_ID: row.Deliverable_ID,
      Offer_ID: row.Offer_ID,
      Created_At: row.Created_At,
      Title: row.Title,
      descLen: desc.length,
      descPrefix,
      metadataKeys: mdKeys,
    });
  }
}

main().catch((e) => {
  console.error('Fatal:', e && e.message ? e.message : String(e));
  process.exit(1);
});
