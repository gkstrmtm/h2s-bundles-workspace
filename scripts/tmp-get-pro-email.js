// Temporary helper: load .env.production and print a few technician login candidates.
// Prints NO secrets.

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFile(filePath) {
  const abs = path.resolve(filePath);
  const text = fs.readFileSync(abs, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function pick(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return '';
}

async function main() {
  const envPath = path.resolve(__dirname, '..', '.env.production');
  loadEnvFile(envPath);

  const url = pick(process.env.SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = pick(process.env.SUPABASE_SERVICE_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY_DISPATCH);

  if (!url || !key) {
    console.error('Missing SUPABASE_URL and/or service key env (not printing values).');
    process.exit(1);
  }

  const sb = createClient(url, key);
  const { data, error } = await sb
    .from('h2s_pros')
    .select('pro_id,email,home_zip,zip,postal_code,zip_code,is_active')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) throw error;

  const rows = (data || []).map((r) => ({
    pro_id: r.pro_id,
    email: r.email,
    zip: r.home_zip || r.zip || r.postal_code || r.zip_code || null,
    is_active: r.is_active,
  }));

  console.log(JSON.stringify({ count: rows.length, candidates: rows }, null, 2));
}

main().catch((e) => {
  console.error('Error:', e?.message || String(e));
  process.exit(1);
});
