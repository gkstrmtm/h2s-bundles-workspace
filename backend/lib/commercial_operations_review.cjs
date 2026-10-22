const version = '032_commercial_operations.sql';
const tables = ['commercial_lead_operations','commercial_lead_activity'];
const functions = ['commercial_record_operation'];

async function preflight(client) {
  const rows = (await client.query(`select table_name,column_name,data_type from information_schema.columns
    where table_schema='public' and table_name=any($1::text[])`, [
    ['commercial_leads','h2s_orders','h2s_dispatch_jobs','h2s_dispatch_job_assignments','h2s_pros'],
  ])).rows;
  for (const [table, column, type] of [
    ['commercial_leads','lead_id','uuid'],['commercial_leads','revision','bigint'],['commercial_leads','updated_at','timestamp with time zone'],
    ['h2s_orders','id','uuid'],['h2s_orders','commercial_request_id','uuid'],['h2s_orders','metadata_json','jsonb'],
    ['h2s_orders','address','text'],
    ['h2s_orders','updated_at','timestamp with time zone'],
    ['h2s_dispatch_jobs','job_id','uuid'],['h2s_dispatch_jobs','order_id','text'],
    ['h2s_dispatch_jobs','status','text'],['h2s_dispatch_jobs','due_at','timestamp with time zone'],
    ['h2s_dispatch_jobs','updated_at','timestamp with time zone'],
    ['h2s_dispatch_job_assignments','job_id','text'],['h2s_dispatch_job_assignments','pro_id','text'],
    ['h2s_dispatch_job_assignments','state','text'],
    ['h2s_dispatch_job_assignments','created_at','timestamp with time zone'],
    ['h2s_dispatch_job_assignments','updated_at','timestamp with time zone'],
    ['h2s_dispatch_job_assignments','assign_id','text'],['h2s_pros','pro_id','uuid'],['h2s_pros','is_active','boolean'],
  ]) {
    if (!rows.some(row => row.table_name === table && row.column_name === column && row.data_type === type)) {
      throw new Error(`032 prerequisite changed: ${table}.${column}; reconcile the actual schema before applying`);
    }
  }
  return { prerequisiteSchemaVerified: true };
}
async function inspect(client, applied) {
  await preflight(client);
  const rows = (await client.query(`select c.relname name,c.relrowsecurity rls,
    has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') anon_access,
    has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') authenticated_access,
    has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') direct_write
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[])`, [tables])).rows;
  if (!applied) {
    if (rows.length) throw new Error('032 objects exist without a verified ledger entry; reconcile before adoption');
    return { applied: false, prerequisiteSchemaVerified: true };
  }
  if (rows.length !== 2 || rows.some(row => !row.rls || row.anon_access || row.authenticated_access || row.direct_write)) {
    throw new Error('032 table permissions/RLS differ from the reviewed default-deny contract');
  }
  const rpc = (await client.query(`select p.proname name,p.prosecdef definer,p.proconfig config,
    has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any($1::text[])`, [functions])).rows;
  if (rpc.length !== 1 || rpc.some(row => !row.definer || !row.config?.includes('search_path=public, pg_temp')
    || row.anon_execute || row.authenticated_execute || !row.service_execute)) {
    throw new Error('032 RPC permissions/search paths differ from the reviewed service-only contract');
  }
  return { applied: true, prerequisiteSchemaVerified: true, defaultDenyVerified: true };
}
module.exports = { version, preflight, inspect };
