#!/usr/bin/env node

/*
  Counts dispatch pros and capacity rows.

  Usage:
    cd backend
    node scripts/count-dispatch-pros.js

  Env:
    Uses backend/.env.local for SUPABASE_URL(_DISPATCH) and SUPABASE_SERVICE_KEY(_DISPATCH)
*/

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFileIfPresent(envPath) {
  try {
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // ignore
  }
}

async function main() {
  loadEnvFileIfPresent(path.join(__dirname, '..', '.env.local'));
  loadEnvFileIfPresent(path.join(__dirname, '..', '.env'));

  const dispatchUrl = process.env.SUPABASE_URL_DISPATCH || process.env.SUPABASE_URL;
  const dispatchKey = process.env.SUPABASE_SERVICE_KEY_DISPATCH || process.env.SUPABASE_SERVICE_KEY;

  if (!dispatchUrl || !dispatchKey) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          error: 'Missing SUPABASE_URL(_DISPATCH) and/or SUPABASE_SERVICE_KEY(_DISPATCH). Check backend/.env.local',
        },
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }

  const sb = createClient(dispatchUrl, dispatchKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const [{ count: prosCount, error: prosErr }, { count: capCount, error: capErr }] = await Promise.all([
    sb.from('h2s_dispatch_pros').select('*', { count: 'exact', head: true }),
    sb.from('h2s_dispatch_pro_capacity').select('*', { count: 'exact', head: true }),
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        dispatch_url: dispatchUrl,
        pros: { count: prosCount ?? null, error: prosErr ? prosErr.message : null },
        capacity: { count: capCount ?? null, error: capErr ? capErr.message : null },
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: e?.message || String(e) }, null, 2));
  process.exitCode = 1;
});
