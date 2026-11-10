'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { retargetSql, validateSourceName } = require('../tools/staging-sql-namespace.cjs');

const targets = { schema: 'h2s_test_run_20261105', storageSchema: 'h2s_test_run_20261105_storage' };
const migrationDir = path.join(__dirname, '..', 'migrations');
const sources = fs.readdirSync(migrationDir).filter(name =>
  /^(?:007_|014_create_commercial_|03[1-9]_|04[1-9]_|05[0-2]_)/.test(name));

for (const name of ['058_field_sales_offer_assistant.sql','059_field_sales_offer_business_conflicts.sql']) {
  test(`retargets offer migration ${name} without widening dynamic SQL permissions`, () => {
    assert.equal(validateSourceName(name),name);
    const actual=retargetSql(fs.readFileSync(path.join(migrationDir,name),'utf8'),targets);
    assert.doesNotMatch(actual,/\bpublic\./i);
    assert.equal(retargetSql(actual,targets),actual);
    assert.ok(actual.includes(targets.schema));
  });
}

test('only the exact 23 reviewed migration basenames are approved', () => {
  assert.equal(sources.length, 23);
  for (const name of sources) assert.equal(validateSourceName(name), name);
  for (const name of [
    '040_residential_address_guards.sql', '014_add_sms_sender_metadata.sql',
    '030_owner_media_placement_fields.sql', '052_future.sql', '031_unknown.sql',
    '../migrations/031_commercial_reliability.sql', '..\\031_commercial_reliability.sql',
    'C:\\031_commercial_reliability.sql', '031_commercial_reliability.sql\0',
    '031_COMMERCIAL_RELIABILITY.SQL', '', null, undefined,
  ]) assert.throws(() => validateSourceName(name), /Unapproved staging migration source name/);
});

for (const name of sources) {
  test(`retargets the complete reviewed migration ${name}`, () => {
    const source = fs.readFileSync(path.join(migrationDir, name), 'utf8');
    const actual = retargetSql(source, targets);
    assert.equal(typeof actual, 'string');
    assert.equal(retargetSql(actual, targets), actual, 'retargeting is idempotent');
    if (/public\./.test(source)) assert.ok(actual.includes(`${targets.schema}.`));
    assert.doesNotMatch(actual, /\bpublic\./i, 'reviewed SQL has no residual app references');
    assert.doesNotMatch(actual, /\bstorage\./i, 'reviewed SQL has no residual storage references');
    assert.doesNotMatch(actual, /search_path\s*=\s*(?:pg_catalog\s*,\s*)?public\b/i);
    assert.doesNotMatch(actual, /\b(?:table_schema|schemaname|nspname)\s*=\s*'(?:public|storage)'/i);
    for (const line of source.split('\n').filter(line => /^\s*--/.test(line))) {
      assert.ok(actual.includes(line), 'comments remain byte-for-byte unchanged');
    }
    if (/from public,anon,authenticated/.test(source)) {
      assert.match(actual, /from public,anon,authenticated/, 'PUBLIC is still the grant role');
    }
    if (['007', '014'].includes(name.slice(0, 3))) {
      assert.equal(actual, source, 'unqualified baseline objects rely on caller search_path');
    }
  });
}

test('unquoted and quoted schema qualifiers change, SQL roles and storage columns do not', () => {
  const sql = `CREATE TABLE public.items (id int);
SELECT * FROM "public"."items";
SELECT * FROM PUBLIC.items;
INSERT INTO storage.buckets(id,name,public) VALUES ('x','x',false);
SELECT "public", public FROM "storage"."buckets";
REVOKE ALL ON public.items FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON "public"."items" TO PUBLIC;
GRANT SELECT ON storage.objects TO service_role;`;
  assert.equal(retargetSql(sql, targets), `CREATE TABLE ${targets.schema}.items (id int);
SELECT * FROM "${targets.schema}"."items";
SELECT * FROM ${targets.schema}.items;
INSERT INTO ${targets.storageSchema}.buckets(id,name,public) VALUES ('x','x',false);
SELECT "public", public FROM "${targets.storageSchema}"."buckets";
REVOKE ALL ON ${targets.schema}.items FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON "${targets.schema}"."items" TO PUBLIC;
GRANT SELECT ON ${targets.storageSchema}.objects TO service_role;`);
});

test('preserves customer text, escaped apostrophes, nested comments and non-code dollar literals', () => {
  const sql = `-- public.orders and storage.objects
/* public.orders /* 'public' */ storage.objects */
SELECT 'Customer public.orders is public', 'storage.objects', 'public',
  'It''s a public schema', $$Customer public.orders$$, $note$storage.objects$note$,
  public_token, 'https://example.test/public/a', "public display name",
  'standard_conforming_strings', 'language', 'nspname' = 'public',
  'public' = 'table_schema', 'as'
  'public.items';`;
  assert.equal(retargetSql(sql, targets), sql);
});

test('preserves ordinary standard-conforming regex strings from reviewed SQL', () => {
  const sql = String.raw`SELECT '\s+', 'public\.(items)', '^storage\.objects$', 'public'::text;`;
  assert.equal(retargetSql(sql, targets), sql);
});

test('search_path retargets schema lists, not SQL role PUBLIC', () => {
  const sql = `SET LOCAL search_path TO "public", pg_temp;
SET search_path = pg_catalog, public, storage;
CREATE FUNCTION public.f() RETURNS int LANGUAGE sql
SET search_path=public,pg_temp AS $$ SELECT 1 $$;
REVOKE ALL ON FUNCTION public.f() FROM PUBLIC;`;
  const actual = retargetSql(sql, targets);
  assert.match(actual, new RegExp(`search_path TO "${targets.schema}", pg_temp`));
  assert.match(actual, new RegExp(`search_path = pg_catalog, ${targets.schema}, ${targets.storageSchema}`));
  assert.match(actual, new RegExp(`search_path=${targets.schema},pg_temp`));
  assert.match(actual, /FROM PUBLIC/);
});

test('retargets catalog namespace predicates and reg* references only in reference contexts', () => {
  const sql = `SELECT * FROM pg_namespace n WHERE n.nspname='public';
SELECT * FROM pg_namespace n WHERE 'storage'=n.nspname;
SELECT * FROM information_schema.tables WHERE table_schema = 'public';
SELECT 'public'::regnamespace, 'public.f(uuid,text)'::regprocedure,
  '"public"."T"'::pg_catalog.regclass, 'storage.objects'::regclass,
  to_regclass('storage.buckets'), pg_catalog.to_regprocedure('public.f(uuid)'),
  $$public.items$$::regclass, 'Customer says public.items';`;
  const actual = retargetSql(sql, targets);
  assert.match(actual, new RegExp(`n.nspname='${targets.schema}'`));
  assert.match(actual, new RegExp(`'${targets.storageSchema}'=n.nspname`));
  assert.match(actual, new RegExp(`table_schema = '${targets.schema}'`));
  assert.match(actual, new RegExp(`'${targets.schema}'::regnamespace`));
  assert.ok(actual.includes(`'"${targets.schema}"."T"'::pg_catalog.regclass`));
  assert.ok(actual.includes(`to_regclass('${targets.storageSchema}.buckets')`));
  assert.ok(actual.includes(`$$${targets.schema}.items$$::regclass`));
  assert.ok(actual.includes("'Customer says public.items'"));
});

test('handles static CAST and namespace lookup spellings without changing ordinary literal text', () => {
  const sql = `SELECT to_regnamespace('public'), pg_catalog.to_regnamespace('storage'),
    CAST('public.items' AS regclass), CAST('"storage"."objects"' AS pg_catalog.regclass),
    CAST('public' AS regnamespace), 'public.items'::text;`;
  assert.equal(retargetSql(sql, targets), `SELECT to_regnamespace('${targets.schema}'), pg_catalog.to_regnamespace('${targets.storageSchema}'),
    CAST('${targets.schema}.items' AS regclass), CAST('"${targets.storageSchema}"."objects"' AS pg_catalog.regclass),
    CAST('${targets.schema}' AS regnamespace), 'public.items'::text;`);
});

test('retargets every supported namespace equality spelling in either direction', () => {
  for (const column of ['table_schema', 'schemaname', 'nspname']) {
    for (const identifier of [column, `n.${column}`, `"${column}"`, `"n"."${column}"`]) {
      for (const schema of ['public', 'storage']) {
        for (const literal of [`'${schema}'`, `$$${schema}$$`, `$schema$${schema}$schema$`]) {
          const target = schema === 'public' ? targets.schema : targets.storageSchema;
          const expected = literal.replace(schema, target);
          for (const [source, rewritten] of [
            [`${identifier} = ${literal}`, `${identifier} = ${expected}`],
            [`${literal} = ${identifier}`, `${expected} = ${identifier}`],
          ]) {
            const sql = `SELECT 1 FROM information_schema.columns n WHERE ${source};`;
            assert.equal(retargetSql(sql, targets),
              `SELECT 1 FROM information_schema.columns n WHERE ${rewritten};`, source);
          }
        }
      }
    }
  }
});

test('retargets information_schema dispatch checks recursively inside a 046-style conditional', () => {
  const sql = `DO $migration$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='h2s_dispatch_jobs' AND column_name='recipient_id') THEN
    ALTER TABLE public.h2s_dispatch_jobs ALTER COLUMN recipient_id DROP NOT NULL;
  END IF;
END $migration$;`;
  const actual = retargetSql(sql, targets);
  assert.ok(actual.includes(`table_schema='${targets.schema}'`));
  assert.ok(actual.includes(`ALTER TABLE ${targets.schema}.h2s_dispatch_jobs`));
  assert.ok(actual.includes("table_name='h2s_dispatch_jobs' AND column_name='recipient_id'"));
});

test('supports the optional language clause before a DO body', () => {
  const sql = 'DO LANGUAGE plpgsql $body$ BEGIN DELETE FROM public.items; END $body$;';
  assert.equal(retargetSql(sql, targets),
    `DO LANGUAGE plpgsql $body$ BEGIN DELETE FROM ${targets.schema}.items; END $body$;`);
});

test('recurses through tagged PL/pgSQL bodies and nested dynamic SQL with doubled quotes', () => {
  const sql = `DO $outer$
BEGIN
  EXECUTE 'create trigger t before update on public.items for each row execute function public.f()';
  EXECUTE format('revoke all on public.%I from public,anon,authenticated',t);
  EXECUTE format('create trigger t before update on public.field_sales_earning_%I for each row execute function public.f()',t);
  EXECUTE $sql$CREATE FUNCTION public.inner_fn() RETURNS text LANGUAGE sql
    SET search_path=public,pg_temp AS $body$SELECT 'Customer public.items', public.f()$body$$sql$;
  RAISE NOTICE 'Customer public.items';
END $outer$;`;
  const actual = retargetSql(sql, targets);
  assert.ok(actual.includes(`'create trigger t before update on ${targets.schema}.items`));
  assert.ok(actual.includes(`on ${targets.schema}.%I from public,anon,authenticated`));
  assert.ok(actual.includes(`on ${targets.schema}.field_sales_earning_%I`));
  assert.ok(actual.includes(`CREATE FUNCTION ${targets.schema}.inner_fn()`));
  assert.ok(actual.includes(`$body$SELECT 'Customer public.items', ${targets.schema}.f()$body$`));
  assert.ok(actual.includes("RAISE NOTICE 'Customer public.items'"));
});

test('migration 035 redirects storage prerequisite probes and bucket insert, not the public column', () => {
  const source = fs.readFileSync(path.join(migrationDir, '035_commercial_business_tools.sql'), 'utf8');
  const actual = retargetSql(source, targets);
  assert.ok(actual.includes(`to_regclass('${targets.storageSchema}.buckets')`));
  assert.ok(actual.includes(`oid='${targets.storageSchema}.objects'::regclass`));
  assert.ok(actual.includes(`polrelid='${targets.storageSchema}.objects'::regclass`));
  assert.ok(actual.includes(`insert into ${targets.storageSchema}.buckets(id,name,public,file_size_limit,allowed_mime_types)`));
});

test('migration 046 retargets introspected function identities, both patch fragments and catalog filters', () => {
  const source = fs.readFileSync(path.join(migrationDir, '046_field_sales_workflow.sql'), 'utf8');
  const actual = retargetSql(source, targets);
  assert.ok(actual.includes(`pg_get_functiondef('${targets.schema}.field_sales_record_receipt(uuid,text,jsonb)'::regprocedure)`));
  assert.equal(actual.split(`select enabled from ${targets.schema}.h2s_management_assignment_config`).length - 1, 2);
  assert.ok(actual.includes(`from ${targets.schema}.field_sales_workflows w join ${targets.schema}.field_sales_workflow_settings`));
  assert.equal(actual.split(`pronamespace='${targets.schema}'::regnamespace`).length - 1, 2);
  assert.ok(actual.includes("w.state=''scheduled''"));
  assert.ok(actual.includes("wf.state=''cancelled''"));
});

test('migration 052 retargets shared-dispatch catalog probes and constraint-expression formatting', () => {
  const source = fs.readFileSync(path.join(migrationDir, '052_shared_dispatch_installation.sql'), 'utf8');
  const actual = retargetSql(source, targets);
  assert.ok(actual.includes(`table_schema='${targets.schema}'`));
  assert.ok(actual.includes(`attrelid='${targets.schema}.h2s_dispatch_jobs'::regclass`));
  assert.ok(actual.includes(`conrelid='${targets.schema}.h2s_dispatch_jobs'::regclass`));
  assert.ok(actual.includes(`format('alter table ${targets.schema}.h2s_dispatch_jobs drop constraint %I',existing.conname)`));
  assert.ok(actual.includes(`format('alter table ${targets.schema}.h2s_dispatch_jobs add constraint %I check(job_kind=''installation'' or (%s))'`));
  assert.ok(actual.includes('existing.conname,existing.expression'));
  for (const bad of [
    source.replace('existing.conname,existing.expression', 'existing.conname,user_input'),
    source.replace('pg_get_expr(conbin,conrelid)', 'user_expression(conbin,conrelid)'),
    source.replace("conrelid='public.h2s_dispatch_jobs'", "conrelid='public.other_table'"),
    source.replace("check(job_kind=''installation'' or (%s))", 'check(%s)'),
  ]) assert.throws(() => retargetSql(bad, targets), /Unsupported staging SQL: unreviewed raw SQL interpolation/);
});

test('validates namespace options before processing SQL', () => {
  for (const name of ['public', 'storage', 'auth', 'extensions', 'pg_catalog', 'pg_temp', 'pg_anything',
    'information_schema', 'UPPER', 'bad-name', 'a.b', 'a";drop schema public;--', '', 'a'.repeat(64), null, undefined]) {
    assert.throws(() => retargetSql('SELECT 1', { ...targets, schema: name }), /Invalid isolated schema/);
    assert.throws(() => retargetSql('SELECT 1', { ...targets, storageSchema: name }), /Invalid isolated storageSchema/);
  }
  assert.throws(() => retargetSql('SELECT 1', { schema: targets.schema, storageSchema: targets.schema }), /distinct/);
  assert.throws(() => retargetSql(null, targets), /SQL must be a string/);
  assert.throws(() => retargetSql('SELECT 1'), /Namespace options required/);
});

test('fails explicitly on unsupported or ambiguous schema and executable constructs', () => {
  for (const sql of [
    'CREATE SCHEMA public;', 'DROP SCHEMA storage CASCADE;', 'ALTER TABLE public.t SET SCHEMA public;',
    'GRANT USAGE ON SCHEMA public TO service_role;', 'ALTER ROLE service_role SET search_path=public;',
    'ALTER DATABASE app SET search_path=public;', 'ALTER SYSTEM SET search_path=public;',
    'CREATE EXTENSION pgcrypto;', 'RESET search_path;', 'RESET ALL;', 'RESET ROLE;',
    'SET ROLE service_role;', 'SET LOCAL ROLE service_role;', 'SET SESSION AUTHORIZATION postgres;',
    'SET standard_conforming_strings=off;',
    'SET search_path TO "$user", public;', "SET search_path TO 'public';",
    "SELECT set_config('search_path','public',true);", "SELECT set_config(setting_name,'public',true);",
    "SELECT set_config('SEARCH_PATH','public',true);",
    "SELECT set_config('search_'||'path','public',true);",
    "SELECT set_config('role','service_role',true);",
    "SELECT * FROM pg_namespace WHERE nspname IN ('public');",
    "SELECT * FROM pg_namespace WHERE nspname IS NOT DISTINCT FROM 'public';",
    "SELECT to_regclass(name);", "SELECT to_regclass('other_schema.t');",
    "SELECT to_regclass('public.items' || suffix);",
    "SELECT 'public.bad; DROP TABLE public.x'::regclass;",
    "DO $$ BEGIN EXECUTE 'delete from public.items' || suffix; END $$;",
    "DO $$ BEGIN EXECUTE format(template,t); END $$;",
    "DO $$ BEGIN EXECUTE format('delete from public.items' || suffix); END $$;",
    "DO $$ BEGIN EXECUTE format('select * from %I.%I',s,t); END $$;",
    "DO $$ BEGIN EXECUTE format('%s',query); END $$;",
    "DO $$ BEGIN EXECUTE format('%1$s',query); END $$;",
    "DO $$ BEGIN EXECUTE format('select * from %1$I.%2$I',s,t); END $$;",
    "DO $$ BEGIN EXECUTE query; END $$;",
    "DO $$ BEGIN EXECUTE src; END $$;",
    "DO $$ BEGIN src:='delete from public.items'; EXECUTE src; END $$;",
    "SELECT format('select * from public.%I',t);",
    "CREATE FUNCTION public.f() RETURNS text AS 'select public.x' LANGUAGE sql;",
    "DO 'BEGIN DELETE FROM public.items; END';",
    'CREATE FUNCTION public.f() RETURNS text AS $$public.x$$ LANGUAGE plpythonu;',
    "SELECT E'public\\x2et';", "SELECT U&'public\\002et';",
    "SELECT 'unterminated", 'SELECT "unterminated', 'DO $$ unterminated', '/* unterminated',
    'SELECT * FROM other.public.items;',
    'SELECT * FROM public.;',
  ]) assert.throws(() => retargetSql(sql, targets), /Unsupported staging SQL:/, sql);
});
