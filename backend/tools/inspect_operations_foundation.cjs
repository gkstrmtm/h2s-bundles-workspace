const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { loadTarget, sslOptions } = require('../apply_migration_pg.js');

const tables = [
  'Dashboard_Users', 'Dashboard_Sessions', 'commercial_leads', 'commercial_consultation_requests',
  'commercial_lead_operations', 'commercial_lead_activity', 'commercial_business_records',
  'commercial_business_activity', 'commercial_business_files', 'commercial_reservations',
  'commercial_calendar_activity', 'h2s_orders', 'h2s_dispatch_jobs', 'h2s_dispatch_job_assignments',
  'h2s_pros', 'h2s_recipients', 'h2s_jobs', 'h2s_payouts_ledger', 'job_customer_uploads', 'h2s_job_artifacts',
  'h2s_job_preparation', 'h2s_job_preparation_activity', 'services', 'bundles', 'price_tiers',
  'h2s_services', 'h2s_bundles', 'h2s_dispatch_job_artifacts',
];

async function inspect(client) {
  await client.query('BEGIN READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '10s'");
    const columns = (await client.query(`
      select table_name, column_name, udt_name as data_type, is_nullable
      from information_schema.columns where table_schema='public' and table_name=any($1::text[])
      order by table_name, ordinal_position`, [tables])).rows;
    const constraints = (await client.query(`
      select c.relname as table_name, x.conname as name, x.contype as type,
        pg_get_constraintdef(x.oid) as definition
      from pg_constraint x join pg_class c on c.oid=x.conrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=any($1::text[]) order by 1,2`, [tables])).rows;
    const functions = (await client.query(`
      select p.proname as name, pg_get_function_identity_arguments(p.oid) as arguments
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname=any($1::text[]) order by 1,2`,
    [['commercial_record_operation', 'commercial_business_record', 'commercial_file_record',
      'commercial_record_reservation', 'commercial_calendar_snapshot', 'h2s_job_readiness',
      'h2s_record_job_preparation', 'stripe_patch_order']])).rows;
    const ledgerExists = (await client.query("select to_regclass('public.h2s_schema_migrations') as name")).rows[0].name;
    const migrations = ledgerExists
      ? (await client.query('select version,sha256,project_ref,applied_at from public.h2s_schema_migrations order by version')).rows
      : null;
    return {
      tables: tables.map(name => ({
        name, present: columns.some(column => column.table_name === name),
        columns: columns.filter(column => column.table_name === name),
        constraints: constraints.filter(constraint => constraint.table_name === name),
      })),
      functions, migrations,
    };
  } finally {
    await client.query('ROLLBACK');
  }
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 2 || argv[0] !== '--target' || !argv[1]) {
    throw new Error('Usage: node tools\\inspect_operations_foundation.cjs --target <registered-target>');
  }
  const dotenv = require('dotenv');
  for (const name of ['.env.migrations.local', '.env.local']) {
    const filename = path.join(__dirname, '..', name);
    if (fs.existsSync(filename)) {
      const parsed = dotenv.parse(fs.readFileSync(filename));
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
    }
  }
  const target = loadTarget(argv[1]);
  const client = new Client({
    connectionString: target.connectionString, ssl: sslOptions(),
    connectionTimeoutMillis: 12000, application_name: 'h2s-readonly-foundation-inspection',
  });
  try {
    await client.connect();
    const result = await inspect(client);
    console.log(JSON.stringify({ projectRef: target.projectRef, environment: target.environment,
      readOnly: true, tlsVerified: true, ...result }, null, 2));
  } finally {
    await client.end();
  }
}

module.exports = { tables, inspect, main };
if (require.main === module) main().catch(() => {
  console.error('Foundation inspection failed. Verify the registered target, database access and CA certificate. No row data or credentials are logged.');
  process.exitCode = 1;
});
