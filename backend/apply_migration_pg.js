const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const tls = require('node:tls');
const { Client } = require('pg');
const commercialReview = require('./lib/commercial_migration_review.cjs');
const operationsReview = require('./lib/commercial_operations_review.cjs');
const stripeMetadataReview = require('./lib/stripe_order_metadata_review.cjs');
const queueReview = require('./lib/commercial_queue_review.cjs');
const businessReview = require('./lib/commercial_business_review.cjs');
const calendarReview = require('./lib/commercial_calendar_review.cjs');

const root = __dirname;
const prerequisiteTables = ['owner_media_uploads', 'proof_assets'];
const managedTables = [...prerequisiteTables, 'media_placements'];
const ledger = 'public.h2s_schema_migrations';
const stripeMetadataVersion = stripeMetadataReview.version;
const versions = ['029_create_media_placements.sql', '030_owner_media_placement_fields.sql', commercialReview.version, operationsReview.version, stripeMetadataVersion, queueReview.version, businessReview.version, calendarReview.version];
const migrationOrder = versions;

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function loadTarget(name, env = process.env) {
  const targets = JSON.parse(fs.readFileSync(path.join(root, 'migration-targets.json'), 'utf8'));
  if (!Object.hasOwn(targets, name)) throw new Error('Specify a registered --target from migration-targets.json');
  const target = targets[name];
  const raw = env[target.connectionEnv];
  if (!raw) throw new Error(`Missing ${target.connectionEnv}; configure it outside Git`);
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${target.connectionEnv} is not a PostgreSQL URL`); }
  const ref = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(url.hostname)?.[1]
    || (/\.pooler\.supabase\.com$/.test(url.hostname) ? /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(url.username))?.[1] : null);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || ref !== target.projectRef
    || url.pathname !== '/postgres' || (url.port && url.port !== '5432')) {
    throw new Error('Database target mismatch: expected registered project, postgres database and direct/session port 5432');
  }
  // pg's URL SSL options otherwise override the verified SSL object.
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('ssl') || key === 'uselibpqcompat') url.searchParams.delete(key);
  }
  return { name, ...target, connectionString: url.href };
}

function sslOptions(env = process.env) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('NODE_TLS_REJECT_UNAUTHORIZED=0 is forbidden for migrations');
  if (!env.MIGRATION_CA_CERT_PATH) throw new Error('Missing MIGRATION_CA_CERT_PATH; use the CA downloaded from the Supabase dashboard');
  const pem = fs.readFileSync(env.MIGRATION_CA_CERT_PATH, 'utf8');
  const certificate = new crypto.X509Certificate(pem);
  if (!certificate.ca || Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) <= Date.now()) {
    throw new Error('MIGRATION_CA_CERT_PATH must contain a valid, unexpired CA certificate');
  }
  return {
    rejectUnauthorized: true,
    ca: [...tls.rootCertificates, ...(tls.getCACertificates ? tls.getCACertificates('system') : []), pem],
  };
}

function authorizeApply(target, confirmProject) {
  if (!['development', 'staging', 'production'].includes(target.environment)
    || !target.applyAuthorized || !target.authorization) {
    throw new Error('Target is unclassified or not authorized; remote schema changes are blocked');
  }
  if (confirmProject !== target.projectRef) throw new Error('Apply requires --confirm-project matching the registered project reference');
  if (!target.baselineSha256 || !target.securitySha256) throw new Error('Inspect and reconcile the existing schema before recording its baseline fingerprints');
  if (migrationOrder.some((version) => !target.authorizedMigrations?.includes(version))) {
    throw new Error('Migration is outside the explicitly authorized scope');
  }
  if (target.commercial031?.reviewOnly !== false || !target.commercial031?.authorization) {
    throw new Error('031 remains review-only; separate explicit authorization is required');
  }
  if (target.commercial032?.reviewOnly !== false || !target.commercial032?.authorization
    || target.commercial032?.sqlSha256 !== migrations().find(file => file.version === operationsReview.version).sha256) {
    throw new Error('032 remains review-only; separate explicit authorization and reviewed checksum are required');
  }
  if (target.stripe033?.reviewOnly !== false || !target.stripe033?.authorization
    || target.stripe033?.sqlSha256 !== migrations().find(file => file.version === stripeMetadataVersion).sha256) {
    throw new Error('033 remains review-only; separate explicit authorization and reviewed checksum are required');
  }
  if (target.queue034?.reviewOnly !== false || !target.queue034?.authorization
    || target.queue034?.sqlSha256 !== migrations().find(file => file.version === queueReview.version).sha256) {
    throw new Error('034 remains review-only; separate explicit authorization and reviewed checksum are required');
  }
  if (target.business035?.reviewOnly !== false || !target.business035?.authorization
    || target.business035?.sqlSha256 !== migrations().find(file => file.version === businessReview.version).sha256) {
    throw new Error('035 remains review-only; separate explicit authorization and reviewed checksum are required');
  }
  if (target.calendar036?.reviewOnly !== false || !target.calendar036?.authorization
    || target.calendar036?.sqlSha256 !== migrations().find(file => file.version === calendarReview.version).sha256) {
    throw new Error('036 remains review-only; separate explicit authorization and reviewed checksum are required');
  }
}

function migrations() {
  return migrationOrder.map((version) => {
    const sql = fs.readFileSync(path.join(root, 'migrations', version), 'utf8').replace(/\r\n/g, '\n');
    if (/^\s*(begin|commit|rollback)\s*;/im.test(sql)) throw new Error(`${version}: transaction control belongs to the runner`);
    return { version, sql, sha256: digest(sql) };
  });
}

async function snapshot(client, tables = managedTables) {
  const params = [tables];
  const tableRows = (await client.query(`
    select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls,
      c.relacl::text as acl
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname=any($1::text[]) order by 1`, params)).rows;
  const columns = (await client.query(`
    select c.relname as table_name,a.attname as name,format_type(a.atttypid,a.atttypmod) as type,
      a.attnotnull as not_null,a.attgenerated as generated,pg_get_expr(d.adbin,d.adrelid) as default_value
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname='public' and c.relname=any($1::text[]) and a.attnum>0 and not a.attisdropped
    order by c.relname,a.attnum`, params)).rows;
  const constraints = (await client.query(`
    select c.relname as table_name,x.conname as name,x.contype as type,pg_get_constraintdef(x.oid) as definition,
      x.convalidated as validated from pg_constraint x join pg_class c on c.oid=x.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[]) order by 1,2`, params)).rows;
  const indexes = (await client.query(`
    select tablename as table_name,indexname as name,indexdef as definition from pg_indexes
    where schemaname='public' and tablename=any($1::text[]) order by 1,2`, params)).rows;
  const policies = (await client.query(`
    select tablename as table_name,policyname,permissive,roles::text,cmd,qual,with_check from pg_policies
    where schemaname='public' and tablename=any($1::text[]) order by 1,2`, params)).rows;
  return { tables: tableRows, columns, constraints, indexes, policies };
}

function securityDigest(schema) {
  return digest(JSON.stringify({
    tables: schema.tables.filter((row) => prerequisiteTables.includes(row.name)),
    policies: schema.policies.filter((row) => prerequisiteTables.includes(row.table_name)),
  }));
}

async function history(client) {
  const exists = (await client.query('select to_regclass($1) as name', [ledger])).rows[0].name;
  return exists ? (await client.query(`select version,sha256,project_ref,environment,after_schema_sha256,applied_at from ${ledger} order by applied_at,version`)).rows : [];
}

function checkHistory(rows, files, target) {
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    if (seen.has(row.version)) throw new Error('Duplicate migration history entry');
    seen.add(row.version);
    const file = files[index];
    if (!file || file.version !== row.version || file.sha256 !== row.sha256
      || row.project_ref !== target.projectRef || row.environment !== target.environment) {
      throw new Error(`Migration history mismatch: ${row.version}; reconcile before applying`);
    }
  }
}

function assertSchema(schema, rows, files, target) {
  checkHistory(rows, files, target);
  if (rows.length !== files.length) throw new Error('Required migrations have not all been applied');
  const column = (table, name, type, defaultPattern, generated = '') => {
    const found = schema.columns.find((row) => row.table_name === table && row.name === name);
    if (!found || found.type !== type || !found.not_null || found.generated !== generated
      || (defaultPattern && !defaultPattern.test(found.default_value || ''))) {
      throw new Error(`Schema verification failed: ${table}.${name}`);
    }
  };
  column('owner_media_uploads', 'frontend_destinations', 'text[]', /'\{\}'::text\[\]/);
  column('owner_media_uploads', 'display_order', 'integer', /^100$/);
  column('owner_media_uploads', 'psychological_weight', 'integer', /^20$/);
  const table = schema.tables.find((row) => row.name === 'media_placements');
  if (!table?.rls) throw new Error('media_placements must have RLS enabled');
  for (const [name, type, defaultPattern, generated] of [
    ['asset_source', 'text', null, 's'], ['asset_id', 'text', null, 's'],
    ['surface', 'text'], ['area', 'text'], ['enabled', 'boolean', /^true$/],
    ['display_order', 'integer', /^100$/], ['fit', 'text', /'cover'::text/],
    ['focal_x', 'numeric', /^50$/], ['focal_y', 'numeric', /^50$/], ['zoom', 'numeric', /^1$/],
    ['updated_at', 'timestamp with time zone', /now\(\)/], ['updated_by', 'text'],
  ]) column('media_placements', name, type, defaultPattern, generated);
  const constraints = schema.constraints.filter((row) => row.table_name === 'media_placements');
  for (const [name, pattern] of [
    ['media_placements_pkey', /PRIMARY KEY \(asset_source, asset_id, surface, area\)/],
    ['media_placements_one_asset', /proof_asset_id IS NOT NULL.*owner_asset_id IS NOT NULL/],
    ['media_placements_area', /surface.*area/],
    ['media_placements_display_order_check', /display_order >= 0.*display_order <= 999/],
    ['media_placements_fit_check', /cover.*contain/],
    ['media_placements_focal_x_check', /focal_x >=.*0.*focal_x <=.*100/],
    ['media_placements_focal_y_check', /focal_y >=.*0.*focal_y <=.*100/],
    ['media_placements_zoom_check', /zoom >=.*1.*zoom <=.*3/],
    ['media_placements_proof_asset_id_fkey', /REFERENCES proof_assets\(asset_id\) ON DELETE CASCADE/],
    ['media_placements_owner_asset_id_fkey', /REFERENCES owner_media_uploads\(asset_id\) ON DELETE CASCADE/],
  ]) {
    if (!constraints.some((row) => row.name === name && row.validated && pattern.test(row.definition))) {
      throw new Error(`Missing or incorrect constraint: ${name}`);
    }
  }
  for (const name of ['media_placements_surface_area_idx', 'owner_media_uploads_frontend_destinations_idx', 'owner_media_uploads_display_order_idx']) {
    if (!schema.indexes.some((row) => row.name === name)) throw new Error(`Missing index: ${name}`);
  }
  if (target.securitySha256 !== securityDigest(schema)) throw new Error('Existing Owner Uploads/proof access controls changed');
  if (rows.at(-1).after_schema_sha256 !== digest(JSON.stringify(schema))) throw new Error('Managed schema drift detected');
}

async function verify(client, target) {
  const schema = await snapshot(client);
  const rows = await history(client);
  const files = migrations();
  checkHistory(rows, files, target);
  if (rows.length < 2) throw new Error('Required media migrations have not all been applied');
  assertSchema(schema, rows, files.slice(0, rows.length), target);
  const commercial031 = await commercialReview.inspect(client, target, rows.some(row => row.version === commercialReview.version));
  const commercial032 = await operationsReview.inspect(client, rows.some(row => row.version === operationsReview.version));
  const stripe033 = await stripeMetadataReview.inspect(client, rows.some(row => row.version === stripeMetadataVersion));
  const queue034 = await queueReview.inspect(client, rows.some(row => row.version === queueReview.version));
  const business035 = await businessReview.inspect(client, rows.some(row => row.version === businessReview.version));
  const calendar036 = await calendarReview.inspect(client, rows.some(row => row.version === calendarReview.version));
  const access = (await client.query(`
    select has_table_privilege('anon','public.media_placements','SELECT') as anon_select,
      has_table_privilege('authenticated','public.media_placements','INSERT') as authenticated_insert,
      (select bool_and(has_table_privilege('service_role','public.media_placements',p))
        from unnest(array['SELECT','INSERT','UPDATE','DELETE']) p) as service_access`)).rows[0];
  if (access.anon_select || access.authenticated_insert || !access.service_access) throw new Error('Unexpected placement table access grants');
  const pending = files.slice(rows.length).map(file => file.version);
  return { verified: pending.length === 0, appliedHistoryVerified: true, pending, commercial031, commercial032, stripe033, queue034, business035, calendar036,
    columns: schema.columns.filter((row) => row.table_name === 'media_placements').map((row) => row.name), access, migrations: rows };
}

async function apply(client, target, confirmProject) {
  authorizeApply(target, confirmProject);
  await client.query('BEGIN');
  try {
    await client.query("set local lock_timeout='5s'");
    await client.query("select pg_advisory_xact_lock(hashtext('h2s/versioned-migrations'))");
    const rows = await history(client);
    const files = migrations();
    checkHistory(rows, files, target);
    const before = await snapshot(client);
    const expected = rows.length ? rows.at(-1).after_schema_sha256 : target.baselineSha256;
    if (digest(JSON.stringify(before)) !== expected || securityDigest(before) !== target.securitySha256) {
      throw new Error('Remote schema differs from the inspected baseline/history; reconcile without marking migrations applied');
    }
    if (!rows.length && before.tables.some((row) => row.name === 'media_placements')) {
      throw new Error('Untracked media_placements already exists; reconcile rather than recreating it');
    }
    await commercialReview.inspect(client, target, rows.some(row => row.version === commercialReview.version));
    await operationsReview.inspect(client, rows.some(row => row.version === operationsReview.version));
    await stripeMetadataReview.inspect(client, rows.some(row => row.version === stripeMetadataVersion));
    await queueReview.inspect(client, rows.some(row => row.version === queueReview.version));
    await businessReview.inspect(client, rows.some(row => row.version === businessReview.version));
    await calendarReview.inspect(client, rows.some(row => row.version === calendarReview.version));
    await client.query(`create table if not exists ${ledger} (
      version text primary key,sha256 text not null,project_ref text not null,environment text not null,
      after_schema_sha256 text not null,applied_at timestamptz not null default clock_timestamp(),
      applied_by text not null default current_user
    )`);
    await client.query(`alter table ${ledger} enable row level security`);
    await client.query(`revoke all on ${ledger} from public,anon,authenticated`);
    for (const file of files.slice(rows.length)) {
      await client.query(file.sql);
      if (file.version === commercialReview.version) await commercialReview.inspect(client, target, true);
      if (file.version === operationsReview.version) await operationsReview.inspect(client, true);
      if (file.version === stripeMetadataVersion) await stripeMetadataReview.inspect(client, true);
      if (file.version === queueReview.version) await queueReview.inspect(client, true);
      if (file.version === businessReview.version) await businessReview.inspect(client, true);
      if (file.version === calendarReview.version) await calendarReview.inspect(client, true);
      const after = await snapshot(client);
      if (securityDigest(after) !== target.securitySha256) throw new Error('Migration changed existing access controls');
      await client.query(`insert into ${ledger} (version,sha256,project_ref,environment,after_schema_sha256) values ($1,$2,$3,$4,$5)`,
        [file.version, file.sha256, target.projectRef, target.environment, digest(JSON.stringify(after))]);
    }
    const result = await verify(client, target);
    await client.query("NOTIFY pgrst, 'reload schema'");
    await client.query('COMMIT');
    return { ...result, applied: files.slice(rows.length).map((file) => file.version) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];
  const arg = (name) => argv[argv.indexOf(name) + 1];
  if (!['inspect', 'status', 'apply', 'verify'].includes(command) || !argv.includes('--target')) {
    throw new Error('Usage: node apply_migration_pg.js inspect|status|verify|apply --target NAME [--confirm-project REF]. Legacy untracked execution is disabled.');
  }
  // Explicit local configuration only; no production exports or MGMT fallback.
  require('dotenv').config({ path: path.join(root, '.env.migrations.local'), quiet: true });
  require('dotenv').config({ path: path.join(root, '.env.local'), quiet: true });
  const target = loadTarget(arg('--target'));
  if (command === 'apply') authorizeApply(target, argv.includes('--confirm-project') ? arg('--confirm-project') : null);
  const client = new Client({
    connectionString: target.connectionString, ssl: sslOptions(), connectionTimeoutMillis: 12000,
    statement_timeout: 60000, application_name: 'h2s-versioned-migrations',
  });
  try {
    await client.connect();
    let result;
    if (command === 'apply') result = await apply(client, target, arg('--confirm-project'));
    else {
      await client.query('BEGIN READ ONLY');
      if (command === 'verify') result = await verify(client, target);
      else {
        const schema = await snapshot(client);
        const rows = await history(client);
        checkHistory(rows, migrations(), target);
        result = {
          baselineSha256: digest(JSON.stringify(schema)), securitySha256: securityDigest(schema),
          tables: schema.tables, columns: schema.columns.map((row) => `${row.table_name}.${row.name}:${row.type}`),
          constraints: schema.constraints, indexes: schema.indexes.map((row) => row.name),
          migrations: rows, pending: migrations().filter((file) => !rows.some((row) => row.version === file.version)).map((file) => file.version),
          commercial031: await commercialReview.inspect(client, target, rows.some(row => row.version === commercialReview.version)),
          commercial032: await operationsReview.inspect(client, rows.some(row => row.version === operationsReview.version)),
          stripe033: await stripeMetadataReview.inspect(client, rows.some(row => row.version === stripeMetadataVersion)),
        };
      }
      await client.query('ROLLBACK');
    }
    console.log(JSON.stringify({ target: target.name, projectRef: target.projectRef, environment: target.environment, tlsVerified: true, ...result }, null, 2));
  } finally {
    await client.end();
  }
}

module.exports = { loadTarget, sslOptions, authorizeApply, migrations, checkHistory, assertSchema, digest, apply, verify, snapshot, history };
if (require.main === module) main().catch((error) => {
  // Connection strings and pg error detail can contain credentials or row values.
  const message = String(error.message).replace(/postgres(?:ql)?:\/\/\S+/gi, '[database URL omitted]');
  console.error(`Migration command failed: ${message}`);
  process.exitCode = 1;
});
