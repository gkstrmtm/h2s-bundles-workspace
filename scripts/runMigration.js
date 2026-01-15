#!/usr/bin/env node

/**
 * Run the checkout traces migration
 * Reads SQL file and executes against Supabase
 */

const fs = require('fs');
const https = require('https');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
  process.exit(1);
}

console.log('\n========== RUNNING MIGRATION ==========\n');

// Read the SQL file
const sqlPath = path.join(__dirname, '../backend/migrations/add_checkout_traces.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

console.log('Migration SQL:');
console.log('---');
console.log(sql);
console.log('---\n');

// Execute via Supabase REST API
const url = new URL('/rest/v1/rpc/exec_sql', SUPABASE_URL);

const payload = JSON.stringify({
  query: sql
});

const options = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Prefer': 'return=representation'
  }
};

console.log('Executing migration...');

const req = https.request(url, options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('\n✅ Migration completed successfully!');
      console.log('Tables created:');
      console.log('  - h2s_checkout_traces');
      console.log('  - h2s_checkout_failures\n');
    } else {
      console.error(`\n❌ Migration failed (HTTP ${res.statusCode})`);
      console.error('Response:', data);
    }
  });
});

req.on('error', (err) => {
  console.error('\n❌ Network error:', err.message);
});

req.write(payload);
req.end();
