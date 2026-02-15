const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env.production.local' });
dotenv.config({ path: '.env.vercel.production' });
dotenv.config({ path: '.env' });

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function pickArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

const migrationFile = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null;
const useMgmt = process.argv.includes('--mgmt') || process.argv.includes('--db=mgmt') || pickArg('--db') === 'mgmt';

function cleanEnvValue(v) {
  if (!v) return v;
  return String(v).trim().replace(/^"(.*)"$/, '$1');
}

const connectionString = useMgmt
  ? cleanEnvValue(process.env.DATABASE_URL_MGMT || process.env.DATABASE_URL)
  : cleanEnvValue(process.env.DATABASE_URL);

if (!migrationFile) {
  console.error('Usage: node apply_migration_pg.js <migration.sql> [--mgmt|--db mgmt]');
  process.exit(2);
}

if (!connectionString) {
  console.error(`Missing DATABASE_URL for ${useMgmt ? 'MGMT' : 'MAIN'} in .env.local`);
  console.error(useMgmt ? 'Expected DATABASE_URL_MGMT (or DATABASE_URL if shared)' : 'Expected DATABASE_URL');
  process.exit(1);
}

async function run() {
  const migrationPath = path.join(__dirname, 'migrations', migrationFile);
  if (!fs.existsSync(migrationPath)) {
    console.error(`Migration file not found: ${migrationPath}`);
    process.exit(1);
  }

  let sqlContent = fs.readFileSync(migrationPath, 'utf8');
  // Keep SQL intact; only normalize Windows line endings.
  sqlContent = sqlContent.replace(/\r\n/g, '\n');

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  console.log(`Applying Migration via direct Postgres connection (${useMgmt ? 'MGMT' : 'MAIN'})...`);

  try {
    await client.connect();
    await client.query(sqlContent);
    console.log('✅ Migration Applied Successfully (pg)');
  } catch (err) {
    console.error('❌ Migration failed (pg):', err);
    process.exitCode = 1;
  } finally {
    try { await client.end(); } catch {}
  }

  if (process.exitCode && process.exitCode !== 0) process.exit(process.exitCode);
}

run();
