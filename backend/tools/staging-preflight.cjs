'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { sslOptions } = require('../apply_migration_pg.js');

const forbiddenRefs = new Set(['nkccbnrduojnzjfrpwva', 'ngnskohzqijcmyhzmwnm', 'ulbzmgmxrqyipclrbohi']);
const requiredBaseline = {
  Dashboard_Users: ['User_ID', 'Role', 'Is_Disabled'],
  commercial_leads: ['lead_id'],
  h2s_orders: ['id', 'order_id'],
  h2s_jobs: ['job_id'],
  h2s_dispatch_jobs: ['job_id', 'order_id'],
  h2s_dispatch_job_assignments: ['assign_id', 'job_id', 'pro_id', 'state', 'updated_at'],
  h2s_pros: ['pro_id', 'email', 'is_active'],
  h2s_dispatch_job_artifacts: ['artifact_id', 'job_id', 'pro_id', 'type', 'url', 'created_at'],
};
function loadStagingTarget(env, confirmedRef) {
  const ref = env.STAGING_PROJECT_REF;
  if (!ref || !/^[a-z]{20}$/.test(ref) || ref !== confirmedRef || forbiddenRefs.has(ref)) {
    throw new Error('An explicitly confirmed isolated staging project reference is required; established main, management and campaign projects are forbidden');
  }
  let database, supabase;
  try {
    database = new URL(env.STAGING_DATABASE_URL);
    supabase = new URL(env.STAGING_SUPABASE_URL);
  } catch { throw new Error('Explicit STAGING_DATABASE_URL and STAGING_SUPABASE_URL are required'); }
  const databaseRef = /^db\.([a-z]+)\.supabase\.co$/.exec(database.hostname)?.[1]
    || (/\.pooler\.supabase\.com$/.test(database.hostname)
      ? /^postgres\.([a-z]+)$/.exec(decodeURIComponent(database.username))?.[1] : null);
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || databaseRef !== ref
    || database.pathname !== '/postgres' || (database.port && database.port !== '5432')
    || supabase.origin !== `https://${ref}.supabase.co` || supabase.username || supabase.password
    || supabase.pathname !== '/' || supabase.search || supabase.hash) {
    throw new Error('Native staging database/API identity mismatch');
  }
  for (const key of [...database.searchParams.keys()]) {
    if (key.startsWith('ssl') || key === 'uselibpqcompat') database.searchParams.delete(key);
  }
  return { ref, connectionString: database.href };
}
function migrationManifest() {
  const directory = path.resolve(__dirname, '..', 'migrations');
  const prefixes = ['007_', '014_create_commercial_', '031_', '032_', '035_', '036_', '037_',
    '041_', '042_', '043_', '044_', '045_', '046_', '047_', '048_', '049_', '050_', '051_'];
  return prefixes.map(prefix => {
    const matches = fs.readdirSync(directory).filter(file => file.startsWith(prefix) && file.endsWith('.sql'));
    if (matches.length !== 1) throw new Error(`Ambiguous migration prerequisite: ${prefix}`);
    const sql = fs.readFileSync(path.join(directory, matches[0]), 'utf8').replace(/\r\n/g, '\n');
    return { file: matches[0], sha256: crypto.createHash('sha256').update(sql).digest('hex') };
  });
}
async function preflight(env, confirmedRef) {
  const target = loadStagingTarget(env, confirmedRef);
  const client = new Client({ connectionString: target.connectionString, ssl: sslOptions(env),
    connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    await client.query("begin read only; set local statement_timeout='10s'");
    const columns = (await client.query(`select table_name,column_name from information_schema.columns
      where table_schema='public' and table_name=any($1::text[])`, [Object.keys(requiredBaseline)])).rows;
    const missingBaseline = Object.entries(requiredBaseline).flatMap(([table, names]) =>
      names.filter(name => !columns.some(row => row.table_name === table && row.column_name === name))
        .map(name => `${table}.${name}`));
    const roles = (await client.query(`select rolname from pg_roles where rolname in
      ('anon','authenticated','service_role')`)).rows.map(row => row.rolname);
    const storageAvailable = (await client.query("select to_regclass('storage.buckets') is not null as available")).rows[0].available;
    const buckets = storageAvailable ? (await client.query(`select id,public,file_size_limit,allowed_mime_types
      from storage.buckets where id=any($1::text[])`, [['commercial-private-files', 'h2s-job-artifacts']])).rows : [];
    const functions = roles.length === 3 ? (await client.query(`select p.proname as name,p.prosecdef as security_definer,
      p.proconfig as configuration,has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute,
      has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as browser_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'field_sales_%' order by p.proname`)).rows : [];
    const tableAccess = roles.length === 3 ? (await client.query(`select c.relname as table_name,
      c.relrowsecurity as rls_enabled,
      has_table_privilege('service_role',c.oid,'SELECT') as service_select,
      has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE') as service_direct_write,
      has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
      has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as browser_access
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p') and c.relname like 'field_sales_%'
      order by c.relname`)).rows : [];
    const storageObjectAccess = storageAvailable && roles.length === 3 ? (await client.query(`select
      c.relrowsecurity as rls_enabled,
      exists(select 1 from pg_policy p where p.polrelid=c.oid and p.polpermissive
        and (0=any(p.polroles) or exists(select 1 from unnest(p.polroles) role_id where role_id<>0
          and (pg_has_role('anon',role_id,'USAGE') or pg_has_role('authenticated',role_id,'USAGE')))))
        as browser_permissive_policy_present
      from pg_class c where c.oid=to_regclass('storage.objects')`)).rows : [];
    await client.query('rollback');
    return { projectRef: target.ref, tlsVerified: true, readOnly: true, missingBaseline, roles, buckets, functions,
      tableAccess, storageObjectAccess,
      candidateMigrations: migrationManifest(),
      migrationApplyAuthorized: false, nativeIntegrationCertified: false,
      note: 'Metadata preflight only. Reconcile native schema/ledger and exact staged migration authorization; separately prove private upload/download, browser denial, Stripe and the real workflow.' };
  } finally { await client.end(); }
}
if (require.main === module) {
  (async () => {
    const result = process.argv[2] === '--manifest'
      ? { candidateMigrations: migrationManifest(), apply: false, draft040Excluded: true }
      : await preflight(process.env, process.argv[2]);
    console.log(JSON.stringify(result, null, 2));
    if (result.missingBaseline?.length) process.exitCode = 1;
  })().catch(error => {
    console.error(`Native staging preflight blocked: ${error.code || error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[database URL omitted]')}`);
    process.exitCode = 1;
  });
}
module.exports = { loadStagingTarget, migrationManifest };
