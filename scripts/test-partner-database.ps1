param(
  [switch]$SmokeWrite,
  [string]$ExpectedProjectRef = 'ulbzmgmxrqyipclrbohi'
)

$ErrorActionPreference = 'Stop'
$connectionString = $env:H2S_MIGRATION_DATABASE_URL

if ([string]::IsNullOrWhiteSpace($connectionString)) {
  throw 'Set H2S_MIGRATION_DATABASE_URL for this PowerShell session. The script never reads or writes the application database variables.'
}

if (-not $connectionString.Contains($ExpectedProjectRef, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Connection refused: H2S_MIGRATION_DATABASE_URL does not identify expected Supabase project $ExpectedProjectRef."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $repoRoot 'backend'
if (-not (Test-Path -LiteralPath (Join-Path $backendPath 'node_modules\pg'))) {
  throw 'The backend pg dependency is missing. Run npm install in the backend directory first.'
}

$mode = if ($SmokeWrite) { 'smoke-write' } else { 'read-only' }
$javascript = @'
import pg from 'pg';

const { Client } = pg;
const mode = process.argv[1] || 'read-only';
const connectionString = process.env.H2S_MIGRATION_DATABASE_URL;
const client = new Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  application_name: 'h2s_partner_migration_test'
});

const requiredTables = [
  'h2s_realtor_partners',
  'h2s_partner_attributions',
  'h2s_partner_status_events',
  'h2s_partner_attribution_events'
];

const requiredColumns = {
  h2s_realtor_partners: ['auth_user_id', 'headshot_url', 'public_slug', 'referral_token', 'status'],
  h2s_partner_attributions: ['order_id', 'job_id', 'satisfaction_status', 'follow_up_status', 'follow_up_ready_at'],
  h2s_partner_attribution_events: ['event_type', 'idempotency_key', 'occurred_at', 'metadata']
};

const failures = [];
const pass = message => console.log(`PASS  ${message}`);
const fail = message => { failures.push(message); console.error(`FAIL  ${message}`); };

try {
  await client.connect();
  const identity = await client.query('select current_database() as database, current_user as role, version() as version');
  pass(`connected to ${identity.rows[0].database} as ${identity.rows[0].role}`);

  const tables = await client.query(`
    select c.relname as table_name, c.relrowsecurity as rls_enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any($1::text[])
  `, [requiredTables]);
  const tableMap = new Map(tables.rows.map(row => [row.table_name, row]));

  for (const table of requiredTables) {
    const found = tableMap.get(table);
    if (!found) fail(`missing table public.${table}`);
    else if (!found.rls_enabled) fail(`RLS is disabled on public.${table}`);
    else pass(`public.${table} exists with RLS enabled`);
  }

  const columns = await client.query(`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = any($1::text[])
  `, [Object.keys(requiredColumns)]);
  const columnSet = new Set(columns.rows.map(row => `${row.table_name}.${row.column_name}`));
  for (const [table, names] of Object.entries(requiredColumns)) {
    for (const name of names) {
      const key = `${table}.${name}`;
      if (columnSet.has(key)) pass(`column ${key} exists`);
      else fail(`missing column ${key}`);
    }
  }

  const privileges = await client.query(`
    select table_name,
      has_table_privilege('anon', format('public.%I', table_name), 'SELECT,INSERT,UPDATE,DELETE') as anon_access,
      has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT,INSERT,UPDATE,DELETE') as authenticated_access
    from unnest($1::text[]) as table_name
  `, [requiredTables]);
  for (const row of privileges.rows) {
    if (row.anon_access) fail(`anon still has data privileges on public.${row.table_name}`);
    else if (row.authenticated_access) fail(`authenticated still has data privileges on public.${row.table_name}`);
    else pass(`browser roles have no data privileges on public.${row.table_name}`);
  }

  const idempotencyConstraint = await client.query(`
    select 1
    from pg_constraint
    where conname = 'h2s_partner_attribution_events_idempotency_key_key'
  `);
  if (idempotencyConstraint.rowCount === 1) pass('event idempotency constraint exists');
  else fail('event idempotency constraint is missing');

  if (mode === 'smoke-write' && failures.length === 0) {
    await client.query('begin');
    try {
      const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const partner = await client.query(`
        insert into public.h2s_realtor_partners
          (first_name, last_name, brokerage, market, email, phone, status, public_slug, referral_token, approved_at)
        values ('Database', 'Smoke Test', 'Home2Smart Test', 'Greenville', $1, '8645550100', 'approved', $2, $3, now())
        returning id
      `, [`partner-smoke-${nonce}@example.invalid`, `partner-smoke-${nonce}`, `token-${nonce}`]);
      const attribution = await client.query(`
        insert into public.h2s_partner_attributions
          (partner_id, referral_token, source, order_id, job_id, status)
        values ($1, $2, 'manual_admin', $3, $4, 'converted')
        returning id
      `, [partner.rows[0].id, `token-${nonce}`, `TEST-ORDER-${nonce}`, `TEST-JOB-${nonce}`]);
      await client.query(`
        insert into public.h2s_partner_attribution_events
          (attribution_id, partner_id, event_type, idempotency_key, order_id, job_id)
        values ($1, $2, 'booking_created', $3, $4, $5)
      `, [attribution.rows[0].id, partner.rows[0].id, `smoke:${nonce}`, `TEST-ORDER-${nonce}`, `TEST-JOB-${nonce}`]);
      pass('rollback-only partner lifecycle write succeeded');
    } finally {
      await client.query('rollback');
      pass('smoke-test transaction rolled back');
    }
  }
} catch (error) {
  fail(error?.message || String(error));
} finally {
  await client.end().catch(() => {});
}

if (failures.length) {
  console.error(`\n${failures.length} database check(s) failed.`);
  process.exit(1);
}
console.log(`\nPartner database checks passed in ${mode} mode.`);
'@

Push-Location $backendPath
try {
  & node --input-type=module -e $javascript $mode
  if ($LASTEXITCODE -ne 0) {
    throw "Partner database test failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
