'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { retargetSql } = require('./staging-sql-namespace.cjs');

const marker = 'home2smart-native-test-run-v1';
const baseline = ['Dashboard_Users','Dashboard_Sessions','commercial_leads','commercial_consultation_requests',
  'h2s_orders','h2s_jobs','h2s_dispatch_jobs','h2s_dispatch_job_assignments','h2s_pros',
  'h2s_dispatch_job_artifacts','h2s_job_artifacts','h2s_payouts_ledger','sms_messages'];
const migrations = ['014_create_commercial_consultation.sql','031_commercial_reliability.sql',
  '032_commercial_operations.sql','033_atomic_stripe_order_metadata.sql','034_commercial_followup_delivery.sql',
  '035_commercial_business_tools.sql','036_commercial_calendar_workload.sql','037_residential_inquiries.sql',
  '038_residential_workspace.sql','039_notification_routing.sql','041_management_assignment.sql',
  '042_management_offer_reliability.sql','043_field_sales.sql','044_field_sales_transactions.sql',
  '045_field_sales_launch_contracts.sql','046_field_sales_workflow.sql','047_field_sales_earnings.sql',
  '048_field_sales_catalog_administration.sql','049_field_sales_opportunities.sql',
  '050_field_sales_credentials.sql','051_field_sales_company_installation.sql','052_shared_dispatch_installation.sql',
  '053_staging_configuration_scope.sql','054_field_sales_residential_booking.sql',
  '056_field_sales_customer_signature.sql','057_field_sales_nc_launch.sql','058_field_sales_offer_assistant.sql',
  '059_field_sales_offer_business_conflicts.sql'];
const quote = name => '"' + String(name).replace(/"/g, '""') + '"';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
function runNames(runId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(runId || '')) {
    throw new Error('An exact UUIDv4 test-run ID is required');
  }
  const schema = 'h2s_test_' + runId.replace(/-/g, '');
  return { runId, schema, storageSchema: schema + '_storage', role: schema + '_owner' };
}
async function publicFingerprint(client) {
  const previous = (await client.query("select current_setting('search_path') as value")).rows[0].value;
  await client.query("select set_config('search_path','pg_catalog',false)");
  try {
  const rows = (await client.query(`select 'column' as kind,c.relname as name,a.attnum::text as part,
      md5(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||
        coalesce(pg_get_expr(d.adbin,d.adrelid),'')) as hash
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname='public' and c.relkind in ('r','p')
    union all select 'constraint',c.relname,k.conname,md5(pg_get_constraintdef(k.oid))
      from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public'
    union all select 'function',p.proname,pg_get_function_identity_arguments(p.oid),md5(pg_get_functiondef(p.oid))
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
    order by 1,2,3`)).rows;
    return digest(JSON.stringify(rows));
  } finally { await client.query("select set_config('search_path',$1,false)", [previous]); }
}
async function nativePlan(client) {
  const tables = (await client.query(`with recursive needed(oid) as (
    select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=any($1::text[]) and c.relkind='r'
    union select k.confrelid from pg_constraint k join needed on needed.oid=k.conrelid where k.contype='f'
    ) select c.relname,n.nspname from needed join pg_class c on c.oid=needed.oid
    join pg_namespace n on n.oid=c.relnamespace order by n.nspname,c.relname`, [baseline])).rows;
  if (tables.some(t => t.nspname !== 'public')) throw new Error('Native baseline references an unreviewed external schema');
  const names = tables.map(t => t.relname);
  if (baseline.some(t => !names.includes(t))) throw new Error('Required native baseline table is absent');
  const columns = (await client.query(`select c.relname,a.attname,pg_get_expr(d.adbin,d.adrelid) as default_expression,
    a.attidentity,a.attgenerated,format_type(a.atttypid,a.atttypmod) as type
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname='public' and c.relname=any($1::text[]) order by c.relname,a.attnum`, [names])).rows;
  if (columns.some(c => c.default_expression && /nextval\s*\(/i.test(c.default_expression))) {
    throw new Error('Native serial sequence requires an explicitly isolated sequence plan');
  }
  if (columns.some(c => /^(?:public\.|"?public"?\.)/.test(c.type))) {
    throw new Error('Native user-defined types require an explicitly isolated type plan');
  }
  const foreignKeys = (await client.query(`select c.relname,k.conname,pg_get_constraintdef(k.oid,true) as definition
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and k.contype='f' and c.relname=any($1::text[]) order by c.relname,k.conname`, [names])).rows;
  return { names, columns, foreignKeys, fingerprint: digest(JSON.stringify({ tables, columns, foreignKeys })) };
}
function migrationSources() {
  const directory = path.resolve(__dirname, '..', 'migrations');
  return migrations.map(file => {
    const sql = fs.readFileSync(path.join(directory, file), 'utf8').replace(/\r\n/g, '\n');
    return { file, sql, sha256: digest(sql) };
  });
}
function sandboxMigration(source) {
  if (source.file !== '031_commercial_reliability.sql') return transactionBody(source.sql);
  const start = source.sql.indexOf('create or replace function public.commercial_protect_appointment()');
  if (start < 0) throw new Error('Reviewed 031 native-baseline boundary changed');
  return source.sql.slice(start);
}
function transactionBody(sql) {
  const withoutComments = sql.replace(/^\s*--[^\n]*(?:\n|$)/gm, '');
  if (!/^\s*begin\s*;/i.test(withoutComments)) {
    if (/^\s*(?:begin|commit|rollback)\s*;\s*$/im.test(withoutComments)) {
      throw new Error('Unexpected transaction boundary in reviewed migration');
    }
    return sql;
  }
  if (!/commit\s*;\s*$/i.test(withoutComments)) throw new Error('Reviewed outer transaction is not closed');
  return sql.replace(/(^|\n)(\s*)begin\s*;/i, '$1$2')
    .replace(/commit\s*;\s*$/i, '');
}
async function prepareSandbox(client, { runId, sourceCommit }) {
  const names = runNames(runId);
  if (!/^[a-f0-9]{40}$/.test(sourceCommit || '')) throw new Error('Exact reviewed source commit is required');
  const before = await publicFingerprint(client);
  const sources = migrationSources();
  await client.query('begin');
  let phase = 'owned_namespace';
  try {
    await client.query("set local lock_timeout='500ms'; set local statement_timeout='15s'; set local standard_conforming_strings=on");
    const exists = (await client.query('select to_regnamespace($1) is not null as present', [names.schema])).rows[0].present;
    if (exists) throw new Error('Test-run namespace already exists; refusing overwrite');
    const plan = await nativePlan(client);
    const recorded = (await client.query('select version,sha256 from public.h2s_schema_migrations')).rows;
    for (const source of sources.filter(s => /^03[1-9]_/.test(s.file))) {
      if (!recorded.some(r => r.version === source.file && r.sha256 === source.sha256)) {
        throw new Error('Existing native baseline migration checksum differs: ' + source.file);
      }
    }
    await client.query(`create role ${quote(names.role)} nologin noinherit`);
    await client.query(`grant ${quote(names.role)} to current_user`);
    await client.query(`create schema ${quote(names.schema)} authorization ${quote(names.role)}`);
    await client.query(`create schema ${quote(names.storageSchema)} authorization ${quote(names.role)}`);
    phase = 'native_schema_only_baseline';
    for (const table of plan.names) {
      await client.query(`create table ${quote(names.schema)}.${quote(table)}
        (like public.${quote(table)} including all)`);
      await client.query(`alter table ${quote(names.schema)}.${quote(table)} owner to ${quote(names.role)}`);
    }
    for (const table of ['buckets','objects']) {
      await client.query(`create table ${quote(names.storageSchema)}.${quote(table)} (like storage.${quote(table)} including all)`);
      await client.query(`alter table ${quote(names.storageSchema)}.${quote(table)} owner to ${quote(names.role)}`);
    }
    await client.query(`set local role ${quote(names.role)}`);
    await client.query(`set local search_path=${quote(names.schema)},pg_catalog,extensions`);
    for (const schema of [names.schema, names.storageSchema]) {
      await client.query(`revoke all on schema ${quote(schema)} from public,anon,authenticated`);
      await client.query(`grant usage on schema ${quote(schema)} to service_role`);
    }
    await client.query(`alter default privileges in schema ${quote(names.schema)} grant all on tables to service_role`);
    await client.query(`grant all on all tables in schema ${quote(names.schema)} to service_role`);
    const identity = { marker, ...names, sourceCommit, nativeBaselineFingerprint: plan.fingerprint };
    for (const schema of [names.schema, names.storageSchema]) {
      await client.query(`comment on schema ${quote(schema)} is ${require('pg').escapeLiteral(JSON.stringify(identity))}`);
    }
    for (const fk of plan.foreignKeys) {
      await client.query(`alter table ${quote(names.schema)}.${quote(fk.relname)}
        add constraint ${quote(fk.conname)} ${retargetSql(fk.definition, names)}`);
    }
    await client.query(`alter table ${quote(names.storageSchema)}.objects enable row level security`);
    await client.query(`create table ${quote(names.schema)}.h2s_test_run(
      run_id uuid primary key,source_commit text not null,baseline_sha256 text not null,
      created_at timestamptz not null default now(),status text not null default 'prepared',
      api_previous_role_schemas text,api_previous_effective_schemas text[])`);
    await client.query(`insert into ${quote(names.schema)}.h2s_test_run(run_id,source_commit,baseline_sha256) values($1,$2,$3)`,
      [runId,sourceCommit,plan.fingerprint]);
    await client.query(`create table ${quote(names.schema)}.h2s_test_migrations(
      version text primary key,sha256 text not null,applied_sha256 text not null,applied_at timestamptz not null default now())`);
    await client.query(`create table ${quote(names.schema)}.h2s_test_webhooks(
      event_id text primary key,run_id uuid not null,type text not null,
      livemode boolean not null check(not livemode),received_at timestamptz not null default now())`);
    for (const source of sources) {
      phase = source.file;
      const transformed = retargetSql(sandboxMigration(source), names);
      await client.query(transformed);
      await client.query(`insert into ${quote(names.schema)}.h2s_test_migrations(version,sha256,applied_sha256) values($1,$2,$3)`,
        [source.file,source.sha256,digest(transformed)]);
    }
    await client.query('reset role');
    const after = await publicFingerprint(client);
    if (before !== after) throw new Error('Public schema changed during isolated preparation; refusing commit');
    await client.query('commit');
    return { ...identity, nativeTablesCloned: plan.names, productionRowsCopied: 0,
      publicFingerprintBefore: before, publicFingerprintAfter: after, publicSchemaUnchanged: true,
      migrations: sources.map(({ file,sha256 }) => ({ file,sha256 })), phase: 'prepared' };
  } catch (error) {
    await client.query('rollback');
    error.sandboxPhase = phase;
    throw error;
  }
}
async function cleanupSandbox(client, { runId, confirmRun, storageClient }) {
  const names = runNames(runId);
  if (runId !== confirmRun) throw new Error('Cleanup requires exact matching test-run confirmation');
  await client.query('begin');
  try {
    await client.query("set local lock_timeout='500ms'; set local statement_timeout='15s'");
    const schemas = (await client.query(`select n.nspname,r.rolname as owner,obj_description(n.oid,'pg_namespace') as identity
      from pg_namespace n join pg_roles r on r.oid=n.nspowner where n.nspname=any($1::text[])`,
    [[names.schema,names.storageSchema]])).rows;
    if (schemas.length !== 2 || schemas.some(s => s.owner !== names.role)) throw new Error('Owned run schemas are absent or ownership differs');
    for (const schema of schemas) {
      const identity = JSON.parse(schema.identity || '{}');
      if (identity.marker !== marker || identity.runId !== runId || identity.schema !== names.schema) {
        throw new Error('Native run ownership marker does not match');
      }
    }
    const ledger = (await client.query(`select * from ${quote(names.schema)}.h2s_test_run`)).rows;
    if (ledger.length !== 1 || ledger[0].run_id !== runId) throw new Error('Test-run ledger is ambiguous');
    const auxiliary = (await client.query(`select p.reltoastrelid as oid from pg_class p
      join pg_namespace n on n.oid=p.relnamespace where n.nspname=any($1::text[]) and p.reltoastrelid<>0
      union select i.indexrelid from pg_class p join pg_namespace n on n.oid=p.relnamespace
      join pg_index i on i.indrelid=p.reltoastrelid where n.nspname=any($1::text[])`,
    [[names.schema,names.storageSchema]])).rows.map(row => row.oid);
    const external = (await client.query(`select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
      join pg_roles r on r.oid=c.relowner where r.rolname=$1 and n.nspname<>all($2::text[])
      and not(c.oid=any($3::oid[]))`,
    [names.role,[names.schema,names.storageSchema],auxiliary])).rows;
    if (external.length) throw new Error('Run role owns objects outside its namespaces; refusing cascading cleanup');
    const dependents = (await client.query(`select distinct owned."schema" from pg_depend d
      cross join lateral pg_identify_object(d.classid,d.objid,d.objsubid) owned
      cross join lateral pg_identify_object(d.refclassid,d.refobjid,d.refobjsubid) referenced
      where referenced."schema"=any($1::text[]) and owned."schema" is not null
        and owned."schema"<>all($1::text[])
        and not(d.classid='pg_class'::regclass and d.objid=any($2::oid[]))`,
    [[names.schema,names.storageSchema],auxiliary])).rows;
    if (dependents.length) throw new Error('External namespace depends on this test run; refusing cascading cleanup');
    const storage = (await client.query('select id from storage.buckets where id=any($1::text[])',
      [['h2s-test-'+runId+'-files','h2s-test-'+runId+'-proof']])).rows;
    if (storage.length) {
      if (!storageClient) throw new Error('Remove only this run storage objects/buckets through the Storage API before namespace cleanup');
      for (const bucket of storage) {
        const emptied = await storageClient.emptyBucket(bucket.id);
        if (emptied.error) throw new Error('Run storage could not be emptied through the Storage API');
        const deadline = Date.now() + 30000;
        while (true) {
          const objects = await client.query('select exists(select 1 from storage.objects where bucket_id=$1) as remaining',
            [bucket.id]);
          if (!objects.rows[0].remaining) break;
          if (Date.now() >= deadline) throw new Error('Run storage emptying has not completed; namespace cleanup was refused');
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        const deleted = await storageClient.deleteBucket(bucket.id);
        if (deleted.error) throw new Error('Run bucket could not be removed; storage cleanup is incomplete');
      }
      const remaining = await client.query('select id from storage.buckets where id=any($1::text[])',
        [storage.map(bucket => bucket.id)]);
      if (remaining.rows.length) throw new Error('Run storage metadata still exists after provider cleanup');
    }
    const apiSettings = (await client.query(`select split_part(v,'=',2) as schemas from pg_db_role_setting s
      join pg_roles r on r.oid=s.setrole cross join lateral unnest(s.setconfig) v
      where r.rolname='authenticator' and split_part(v,'=',1)='pgrst.db_schemas'`)).rows;
    if (apiSettings.length>1) throw new Error('Ambiguous API schema settings; refusing cleanup');
    if (apiSettings[0]?.schemas.split(',').map(s=>s.trim()).includes(names.schema)) {
      if (!ledger[0].api_previous_effective_schemas) throw new Error('API exposure has no recorded restore boundary');
      const current = apiSettings[0].schemas.split(',').map(s=>s.trim());
      const remaining = current.filter(s=>s!==names.schema);
      if (ledger[0].api_previous_role_schemas === null &&
        JSON.stringify(remaining) === JSON.stringify(ledger[0].api_previous_effective_schemas)) {
        await client.query('alter role authenticator reset pgrst.db_schemas');
      } else {
        await client.query(`alter role authenticator set pgrst.db_schemas to ${require('pg').escapeLiteral(remaining.join(','))}`);
      }
      await client.query("notify pgrst,'reload config'");
    }
    const before = await publicFingerprint(client);
    await client.query(`drop schema ${quote(names.storageSchema)} cascade`);
    await client.query(`drop schema ${quote(names.schema)} cascade`);
    await client.query(`drop role ${quote(names.role)}`);
    const after = await publicFingerprint(client);
    if (before !== after) throw new Error('Cleanup changed public schema; refusing commit');
    await client.query('commit');
    return { runId, cleaned: true, publicSchemaUnchanged: true };
  } catch (error) { await client.query('rollback'); throw error; }
}
module.exports = { runNames, publicFingerprint, nativePlan, migrationSources, transactionBody, sandboxMigration, prepareSandbox, cleanupSandbox };
