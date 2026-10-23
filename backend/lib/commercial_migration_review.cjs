const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const version = '031_commercial_reliability.sql';
const tables = ['commercial_leads', 'commercial_consultation_requests', 'h2s_orders', 'commercial_effects'];
const functions = [
  'commercial_save_lead', 'commercial_submit_request', 'commercial_reschedule_request',
  'commercial_claim_effect', 'commercial_finish_effect', 'commercial_attach_photo',
  'commercial_create_appointment', 'commercial_record_appointment_error',
  'commercial_protect_appointment',
];
const baselinePath = path.join(__dirname, '..', 'migration-baselines', '031_commercial_reliability.json');
const sqlPath = path.join(__dirname, '..', 'migrations', version);
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const compact = value => String(value || '').toLowerCase().replace(/::text(?:\[\])?/g, '').replace(/[\s()"]/g, '');
const equal = (actual, expected, label) => {
  if (digest(actual) !== digest(expected)) throw new Error(`031 verification failed: ${label}`);
};

async function snapshot(client) {
  const params = [tables];
  const relations = (await client.query(`select c.relname name,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
    pg_get_userbyid(c.relowner) owner,c.relacl::text acl from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname=any($1::text[]) order by 1`, params)).rows;
  const columns = (await client.query(`select c.relname table_name,a.attname name,
    format_type(a.atttypid,a.atttypmod) type,a.attnotnull not_null,a.attgenerated generated,
    pg_get_expr(d.adbin,d.adrelid) default_value,a.attacl::text acl
    from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname='public' and c.relname=any($1::text[]) and a.attnum>0 and not a.attisdropped
    order by 1,a.attnum`, params)).rows;
  const constraints = (await client.query(`select c.relname table_name,x.conname name,x.contype type,
    pg_get_constraintdef(x.oid) definition,x.convalidated validated from pg_constraint x
    join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[]) and x.contype<>'n' order by 1,2`, params)).rows;
  const indexes = (await client.query(`select c.relname table_name,i.relname name,x.indisunique unique,
    x.indisvalid valid,pg_get_expr(x.indpred,x.indrelid) predicate,pg_get_indexdef(x.indexrelid) definition,
    array(select pg_get_indexdef(x.indexrelid,k,false) from generate_series(1,x.indnkeyatts) k) columns
    from pg_index x join pg_class c on c.oid=x.indrelid join pg_class i on i.oid=x.indexrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[]) order by 1,2`, params)).rows;
  const policies = (await client.query(`select tablename table_name,policyname,permissive,roles::text,cmd,qual,with_check
    from pg_policies where schemaname='public' and tablename=any($1::text[]) order by 1,2`, params)).rows;
  const triggers = (await client.query(`select c.relname table_name,t.tgname name,t.tgenabled enabled,
    pg_get_triggerdef(t.oid) definition,p.prosrc function_body,p.prosecdef security_definer,p.proconfig config
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid where n.nspname='public' and c.relname=any($1::text[])
    and not t.tgisinternal order by 1,2`, params)).rows;
  const routines = (await client.query(`select p.proname name,oidvectortypes(p.proargtypes) arguments,
    format_type(p.prorettype,null) returns,p.prosecdef security_definer,p.proconfig config,p.provolatile volatility,
    p.prosrc body,p.proacl::text acl,
    has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any($1::text[]) order by 1,2`, [functions])).rows;
  const roles = (await client.query(`select rolname name,rolsuper superuser,rolbypassrls bypass_rls
    from pg_roles where rolname in ('anon','authenticated','service_role') order by 1`)).rows;
  const defaultPrivileges = (await client.query(`select pg_get_userbyid(d.defaclrole) owner,n.nspname schema,
    d.defaclobjtype type,d.defaclacl::text acl from pg_default_acl d
    left join pg_namespace n on n.oid=d.defaclnamespace
    where (n.nspname='public' or d.defaclnamespace=0) and d.defaclobjtype in ('r','f')
    order by 1,2,3`)).rows;
  const effectsAccess = relations.some(row => row.name === 'commercial_effects') ? (await client.query(`
    select role,has_table_privilege(role,'public.commercial_effects','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') any_access,
      has_table_privilege(role,'public.commercial_effects','SELECT') can_select,
      has_table_privilege(role,'public.commercial_effects','INSERT') can_insert,
      has_table_privilege(role,'public.commercial_effects','UPDATE') can_update,
      has_table_privilege(role,'public.commercial_effects','DELETE') can_delete,
      has_any_column_privilege(role,'public.commercial_effects','SELECT,INSERT,UPDATE') column_access
    from unnest(array['anon','authenticated','service_role']) role order by role`)).rows : [];
  return { relations, columns, constraints, indexes, policies, triggers, routines, roles, defaultPrivileges, effectsAccess };
}

async function preflight(client) {
  const row = (await client.query(`select
    (select count(*)::int from (select lead_id from public.commercial_consultation_requests
      where status in ('pending','approved','customer_confirmed','escalated','reschedule_requested')
      group by lead_id having count(*)>1) d) active_request_duplicate_groups,
    (select count(*)::int from (select order_id from public.h2s_orders where order_id like 'APPT-COM-%'
      group by order_id having count(*)>1) d) appointment_duplicate_groups,
    (select count(*)::int from public.h2s_orders where customer_email is null) existing_null_order_emails,
    (select count(*)::int from public.commercial_leads where length(public_token)<20) short_legacy_tokens,
    (select count(*)::int from public.h2s_orders where order_id like 'APPT-COM-%'
      or coalesce(metadata_json ? 'commercial_consultation_request_id',false)) commercial_appointment_markers,
    (select count(*)::int from public.commercial_consultation_requests where related_order_id is not null) linked_commercial_requests`)).rows[0];
  return row;
}

function loadBaseline(target) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const review = target.commercial031;
  if (baseline.projectRef !== target.projectRef || baseline.environment !== target.environment) throw new Error('031 baseline target/environment mismatch');
  if (!review || review.baselineSha256 !== digest(baseline.schema)) throw new Error('031 baseline is missing or changed; reconcile explicitly');
  const sql = fs.readFileSync(sqlPath, 'utf8').replace(/\r\n/g, '\n');
  if (review.sqlSha256 !== crypto.createHash('sha256').update(sql).digest('hex')) throw new Error('031 SQL differs from the reviewed checksum');
  return baseline.schema;
}

function assertBaseline(schema, target) {
  equal(schema, loadBaseline(target), 'live catalog differs from the reviewed commercial baseline');
}

function assertPost(schema, target) {
  const baseline = loadBaseline(target);
  equal(schema.relations.filter(row => row.name !== 'commercial_effects'), baseline.relations, 'existing table owners, grants and RLS');
  equal(schema.policies, baseline.policies, 'existing/default-deny policies');
  const newTriggers = ['commercial_appointment_write_guard', 'commercial_appointment_truncate_guard'];
  equal(schema.triggers.filter(row => !newTriggers.includes(row.name)
    && !require('./commercial_calendar_review.cjs').isReviewedOrderTrigger(row)), baseline.triggers, 'existing trigger definitions and functions');
  equal(schema.roles, baseline.roles, 'API role privilege flags');
  equal(schema.defaultPrivileges, baseline.defaultPrivileges, 'existing default privileges');
  const newColumns = ['commercial_leads.revision', 'commercial_leads.last_save_key', 'commercial_consultation_requests.submission_key', 'h2s_orders.commercial_request_id'];
  const oldColumns = schema.columns.filter(row => row.table_name !== 'commercial_effects' && !newColumns.includes(`${row.table_name}.${row.name}`));
  equal(oldColumns, baseline.columns.map(row => ['commercial_leads.last_submitted_at', 'h2s_orders.customer_email'].includes(`${row.table_name}.${row.name}`)
    ? { ...row, not_null: false } : row), 'existing columns except reviewed nullability changes');
  const added = schema.columns.filter(row => newColumns.includes(`${row.table_name}.${row.name}`));
  for (const [table, name, type, notNull, defaultValue] of [
    ['commercial_leads', 'revision', 'bigint', true, '0'],
    ['commercial_leads', 'last_save_key', 'text', false, null],
    ['commercial_consultation_requests', 'submission_key', 'text', false, null],
    ['h2s_orders', 'commercial_request_id', 'uuid', false, null],
  ]) {
    const row = added.find(item => item.table_name === table && item.name === name);
    if (!row || row.type !== type || row.not_null !== notNull || row.default_value !== defaultValue || row.acl || row.generated) {
      throw new Error(`031 verification failed: ${table}.${name}`);
    }
  }
  const effects = schema.relations.find(row => row.name === 'commercial_effects');
  const owner = baseline.relations.find(row => row.name === 'h2s_orders').owner;
  if (!effects?.rls || effects.force_rls || effects.owner !== owner
    || effects.acl !== `{${owner}=arwdDxtm/${owner},service_role=arw/${owner}}`) throw new Error('031 effects RLS, owner or grants are incorrect');
  const effectColumns = schema.columns.filter(row => row.table_name === 'commercial_effects');
  equal(effectColumns.map(row => [row.name, row.type, row.not_null, row.generated, row.acl]), [
    ['request_id','uuid',true,'',null], ['kind','text',true,'',null], ['state','text',true,'',null],
    ['details','jsonb',true,'',null], ['updated_at','timestamp with time zone',true,'',null],
  ], 'effect columns');
  equal(effectColumns.map(row => row.default_value), [null, null, null, "'{}'::jsonb", 'now()'], 'effects defaults');
  const addedConstraints = ['h2s_orders_email_required_except_commercial', 'commercial_effects_pkey',
    'commercial_effects_request_id_fkey', 'commercial_effects_state_check',
    'h2s_orders_commercial_request_id_fkey', 'h2s_orders_commercial_link'];
  equal(schema.constraints.filter(row => !addedConstraints.includes(row.name)
    && !require('./commercial_calendar_review.cjs').isReviewedOrderConstraint(row, schema.triggers)), baseline.constraints, 'existing constraints');
  const patterns = {
    h2s_orders_email_required_except_commercial: 'checkcustomer_emailisnotnullorcommercial_request_idisnotnull',
    h2s_orders_commercial_request_id_fkey: 'foreignkeycommercial_request_idreferencescommercial_consultation_requestsrequest_id',
    h2s_orders_commercial_link: "checkcommercial_request_idisnullandorder_id!~~'appt-com-%'andnotcoalescemetadata_json?'commercial_consultation_request_id',falseorcommercial_request_idisnotnullandorder_id='appt-com-'||commercial_request_idandcoalescemetadata_json->>'commercial_consultation_request_id'=commercial_request_id,false",
    commercial_effects_pkey: 'primarykeyrequest_id,kind',
    commercial_effects_request_id_fkey: 'foreignkeyrequest_idreferencescommercial_consultation_requestsrequest_id',
    commercial_effects_state_check: "checkstate=anyarray['processing','accepted','failed','uncertain']",
  };
  if (schema.constraints.filter(row => addedConstraints.includes(row.name)).length !== addedConstraints.length) throw new Error('031 constraint set differs');
  for (const [name, expected] of Object.entries(patterns)) {
    const row = schema.constraints.find(item => item.name === name);
    const table = name.startsWith('h2s_orders_') ? 'h2s_orders' : 'commercial_effects';
    if (!row?.validated || row.table_name !== table || compact(row.definition) !== expected) throw new Error(`031 constraint differs: ${name}`);
  }
  const newIndexes = {
    commercial_one_active_request: ['commercial_consultation_requests', ['lead_id'], "status=anyarray['pending','approved','customer_confirmed','escalated','reschedule_requested']"],
    commercial_submission_key: ['commercial_consultation_requests', ['lead_id','submission_key'], 'submission_keyisnotnull'],
    commercial_effects_pkey: ['commercial_effects', ['request_id','kind'], ''],
  };
  equal(schema.indexes.filter(row => !Object.hasOwn(newIndexes, row.name)), baseline.indexes, 'existing indexes');
  if (!schema.constraints.some(row => row.table_name === 'h2s_orders' && row.name === 'h2s_orders_order_id_key'
    && row.validated && compact(row.definition) === 'uniqueorder_id')) throw new Error('Global order key uniqueness is required');
  for (const [name, [table, columns, predicate]] of Object.entries(newIndexes)) {
    const row = schema.indexes.find(item => item.name === name);
    const definition = `create unique index ${name} on public.${table} using btree (${columns.join(',')})${predicate ? ` where ${predicate}` : ''}`;
    if (!row?.unique || !row.valid || row.table_name !== table || digest(row.columns) !== digest(columns)
      || compact(row.predicate) !== predicate || compact(row.definition) !== compact(definition)) {
      throw new Error(`031 index differs: ${name}`);
    }
  }
  const definitions = [...fs.readFileSync(sqlPath, 'utf8').replace(/\r\n/g, '\n').matchAll(
    /create or replace function public\.(\w+)\([\s\S]*?\)\s+returns\s+(\w+)[\s\S]*?as \$\$([\s\S]*?)\$\$;/gi)];
  if (schema.routines.length !== functions.length || definitions.length !== functions.length) throw new Error('031 routine set differs');
  for (const [index, name] of functions.entries()) {
    const routine = schema.routines.find(row => row.name === name);
    const definition = definitions.find(match => match[1] === name);
    const signatures = ['text, bigint, text, jsonb', 'uuid, text, jsonb', 'uuid, uuid, text, text, jsonb',
      'uuid, text', 'uuid, text, text, jsonb', 'uuid, text', 'uuid', 'uuid, text', ''];
    if (!routine || routine.arguments !== signatures[index] || routine.security_definer || routine.volatility !== 'v'
      || digest(routine.config) !== digest(['search_path=public, pg_temp'])
      || routine.body.trim() !== definition[3].trim() || routine.returns !== definition[2].toLowerCase()
      || routine.acl !== `{${owner}=X/${owner},service_role=X/${owner}}`
      || routine.anon_execute || routine.authenticated_execute || !routine.service_execute) {
      throw new Error(`031 routine body, signature, search path or execution grants differ: ${name}`);
    }
  }
  const guard = schema.routines.find(row => row.name === 'commercial_protect_appointment');
  const addedTriggers = schema.triggers.filter(row => newTriggers.includes(row.name));
  if (addedTriggers.length !== 2) throw new Error('031 appointment guard triggers are missing');
  for (const [name, definition] of [
    ['commercial_appointment_write_guard', 'CREATE TRIGGER commercial_appointment_write_guard BEFORE INSERT OR DELETE OR UPDATE ON public.h2s_orders FOR EACH ROW EXECUTE FUNCTION commercial_protect_appointment()'],
    ['commercial_appointment_truncate_guard', 'CREATE TRIGGER commercial_appointment_truncate_guard BEFORE TRUNCATE ON public.h2s_orders FOR EACH STATEMENT EXECUTE FUNCTION commercial_protect_appointment()'],
  ]) {
    const row = addedTriggers.find(item => item.name === name);
    if (!row || row.table_name !== 'h2s_orders' || row.enabled !== 'O' || compact(row.definition) !== compact(definition)
      || row.function_body !== guard.body || row.security_definer || digest(row.config) !== digest(guard.config)) {
      throw new Error(`031 appointment trigger differs: ${name}`);
    }
  }
  for (const row of schema.effectsAccess) {
    if (row.role !== 'service_role' && (row.any_access || row.column_access)) throw new Error('031 effects API access is not default-deny');
    if (row.role === 'service_role' && (!row.can_select || !row.can_insert || !row.can_update || row.can_delete)) throw new Error('031 effects service grants differ');
  }
  if (schema.effectsAccess.length !== 3) throw new Error('031 effects role checks are incomplete');
}

async function inspect(client, target, applied) {
  const schema = await snapshot(client);
  if (applied) assertPost(schema, target);
  else assertBaseline(schema, target);
  const counts = await preflight(client);
  if (!applied && (counts.active_request_duplicate_groups || counts.appointment_duplicate_groups || counts.existing_null_order_emails
    || counts.commercial_appointment_markers || counts.linked_commercial_requests)) {
    throw new Error('031 preflight found conflicting existing records; reconcile without deleting or merging automatically');
  }
  return { state: applied ? 'applied_verified' : 'reviewed_baseline_pending', applied, authorized: target.authorizedMigrations?.includes(version) === true && target.commercial031?.reviewOnly === false,
    schemaSha256: digest(schema), preflight: counts };
}

module.exports = { version, functions, tables, snapshot, preflight, digest, assertBaseline, assertPost, inspect };
