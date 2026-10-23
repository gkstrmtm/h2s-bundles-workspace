const fs = require('node:fs'), path = require('node:path');
const version = '036_commercial_calendar_workload.sql';
const tables = ['commercial_calendar','commercial_reservations','commercial_calendar_activity','h2s_job_preparation','h2s_job_preparation_activity'];
const functions = ['commercial_guard_reservation','commercial_guard_workload','commercial_record_workload','commercial_record_reservation',
  'commercial_sync_calendar','commercial_calendar_snapshot','h2s_job_readiness','h2s_record_job_preparation',
  'h2s_guard_job_preparation','commercial_record_job_operation','commercial_record_work_location'];
function isReviewedOrderTrigger(row) {
  const sql = fs.readFileSync(path.join(__dirname,'..','migrations',version),'utf8').replace(/\r\n/g,'\n');
  const body = /create function public\.commercial_sync_calendar\([\s\S]*?as \$\$([\s\S]*?)\$\$;/.exec(sql)?.[1];
  const definition = 'CREATE CONSTRAINT TRIGGER commercial_calendar_order_sync AFTER UPDATE ON public.h2s_orders DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commercial_sync_calendar()';
  return row.table_name === 'h2s_orders' && row.name === 'commercial_calendar_order_sync' && row.enabled === 'O'
    && row.definition === definition && body && row.function_body.replace(/\r\n/g,'\n').trim() === body.trim()
    && row.security_definer === true && JSON.stringify(row.config) === JSON.stringify(['search_path=public, pg_temp']);
}
async function inspect(client, applied) {
  const rows = (await client.query(`select c.relname name,c.relrowsecurity rls,
    has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') anon_access,
    has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') authenticated_access,
    has_table_privilege('service_role',c.oid,'SELECT') service_read,
    has_table_privilege('service_role',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE') service_write
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[])`, [tables])).rows;
  const rpc = (await client.query(`select p.proname name,p.prosecdef definer,p.prosrc source,p.proconfig config,
    has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[])`, [functions])).rows;
  const columns = (await client.query(`select column_name,data_type from information_schema.columns
    where table_schema='public' and table_name='commercial_lead_operations' and column_name in ('hold_until','closure_outcome','sales_chasing_paused')`)).rows;
  if (!applied) {
    if (rows.length || rpc.length || columns.length) throw new Error('036 objects exist without verified history; reconcile before adoption');
    return { applied: false, reviewOnly: true };
  }
  if (rows.length !== tables.length || rows.some(row => !row.rls || row.anon_access || row.authenticated_access || !row.service_read || row.service_write)
    || columns.length !== 3 || !columns.some(row => row.column_name === 'hold_until' && row.data_type === 'timestamp with time zone')
    || !columns.some(row => row.column_name === 'closure_outcome' && row.data_type === 'text')
    || !columns.some(row => row.column_name === 'sales_chasing_paused' && row.data_type === 'boolean')) throw new Error('036 schema/RLS/service-read contract changed');
  const sql = fs.readFileSync(path.join(__dirname,'..','migrations',version),'utf8').replace(/\r\n/g,'\n');
  if (rpc.length !== functions.length) throw new Error('036 calendar functions incomplete');
  for (const row of rpc) {
    const expected = new RegExp(`create function public\\.${row.name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`).exec(sql)?.[1];
    const service = row.name.startsWith('commercial_record_') || ['commercial_calendar_snapshot','h2s_job_readiness','h2s_record_job_preparation'].includes(row.name);
    if (!expected || row.source.replace(/\r\n/g,'\n').trim() !== expected.trim() || !row.definer
      || !row.config?.includes('search_path=public, pg_temp') || row.anon_execute || row.authenticated_execute
      || row.service_execute !== service) throw new Error('036 reviewed function or execute grants changed');
  }
  const triggers = (await client.query(`select tgname,tgenabled,tgdeferrable,tginitdeferred,p.proname function_name from pg_trigger t
    join pg_proc p on p.oid=t.tgfoid
    where tgname in ('commercial_reservation_capacity','commercial_workload_guard','commercial_calendar_order_sync','commercial_calendar_job_sync','commercial_calendar_link_sync','h2s_job_preparation_start')`)).rows;
  if (triggers.length !== 6 || triggers.some(row => row.tgenabled !== 'O'
    || row.function_name !== (row.tgname === 'commercial_reservation_capacity' ? 'commercial_guard_reservation'
      : row.tgname === 'commercial_workload_guard' ? 'commercial_guard_workload'
        : row.tgname === 'h2s_job_preparation_start' ? 'h2s_guard_job_preparation' : 'commercial_sync_calendar')
    || !['commercial_reservation_capacity','commercial_workload_guard','h2s_job_preparation_start'].includes(row.tgname) && (!row.tgdeferrable || !row.tginitdeferred))) {
    throw new Error('036 atomic capacity/legacy schedule synchronization triggers changed');
  }
  const constraints = (await client.query(`select conname,pg_get_constraintdef(oid) definition from pg_constraint
    where conrelid in ('public.commercial_calendar'::regclass,'public.commercial_reservations'::regclass,'public.commercial_calendar_activity'::regclass,
      'public.h2s_job_preparation'::regclass,'public.h2s_job_preparation_activity'::regclass)`)).rows;
  for (const [name,pattern] of [
    ['commercial_calendar_pkey',/PRIMARY KEY \(singleton\)/],['commercial_calendar_singleton_check',/CHECK \(singleton\)/],
    ['commercial_reservations_pkey',/PRIMARY KEY \(lead_id\)/],['commercial_reservations_window_check',/ends_at > starts_at/],
    ['commercial_reservations_lead_id_fkey',/REFERENCES commercial_leads\(lead_id\)/],
    ['commercial_calendar_activity_pkey',/PRIMARY KEY \(operation_id\)/],
    ['h2s_job_preparation_pkey',/PRIMARY KEY \(job_id\)/],
    ['h2s_job_preparation_job_id_fkey',/REFERENCES h2s_dispatch_jobs\(job_id\)/],
    ['h2s_job_preparation_activity_job_id_revision_key',/UNIQUE \(job_id, revision\)/],
  ]) {
    if (!constraints.some(row => row.conname === name && pattern.test(row.definition))) throw new Error('036 calendar constraints changed: '+name);
  }
  return { applied: true, serviceOnlyVerified: true, atomicCapacityVerified: true, installationSyncVerified: true };
}
module.exports = { version, inspect, isReviewedOrderTrigger };
