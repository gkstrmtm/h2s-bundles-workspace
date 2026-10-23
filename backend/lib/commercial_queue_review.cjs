const fs = require('node:fs'), path = require('node:path');
const version = '034_commercial_followup_delivery.sql';
async function inspect(client, applied) {
  const tables = (await client.query(`select c.relname name,c.relrowsecurity rls from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
    and c.relname in ('sms_delivery_receipts','sms_delivery_events')`)).rows;
  const functions = (await client.query(`select p.proname name,p.prosrc source,p.prosecdef definer,p.proconfig config,
    pg_get_function_identity_arguments(p.oid) arguments,
    has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('sms_record_delivery','commercial_record_follow_up')`)).rows;
  if (!applied) {
    if (tables.length || functions.length) throw new Error('034 objects exist without a verified ledger entry; reconcile before adoption');
    return { applied: false, reviewOnly: true };
  }
  if (tables.length !== 2 || tables.some(table => !table.rls) || functions.length !== 2) throw new Error('034 receipt schema/RLS incomplete');
  const source = fs.readFileSync(path.join(__dirname,'..','migrations',version),'utf8').replace(/\r\n/g,'\n').split('$$');
  const expected = {
    sms_record_delivery: ['p_event_key text, p_event jsonb', source[1]],
    commercial_record_follow_up: ['p_lead_id uuid, p_revision integer, p_operation_id uuid, p_actor jsonb, p_payload jsonb', source[3]],
  };
  for (const row of functions) {
    if (!row.definer || !row.config?.includes('search_path=public, pg_temp') || row.arguments !== expected[row.name][0]
      || row.source.replace(/\r\n/g,'\n').trim() !== expected[row.name][1].trim()
      || row.anon_execute || row.authenticated_execute || !row.service_execute) throw new Error('034 service-only atomic RPC contract changed');
  }
  const grants = (await client.query(`select grantee,table_name,privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name in ('sms_delivery_receipts','sms_delivery_events')`)).rows;
  if (grants.some(row => ['PUBLIC','anon','authenticated'].includes(row.grantee)
    || (row.grantee === 'service_role' && row.privilege_type !== 'SELECT'))
    || tables.some(table => !grants.some(row => row.grantee === 'service_role' && row.table_name === table.name && row.privilege_type === 'SELECT'))) {
    throw new Error('034 receipt table access differs from service-read/RPC-write contract');
  }
  const columns = (await client.query(`select table_name,column_name,data_type,is_nullable from information_schema.columns
    where table_schema='public' and table_name in ('sms_delivery_receipts','sms_delivery_events')`)).rows;
  const schema = {
    sms_delivery_receipts: { message_sid:'text',account_sid:'text',to_phone:'text',from_phone:'text',status:'text',
      status_rank:'integer',received_at:'timestamp with time zone',last_error_code:'text',last_error_message:'text',conflicting_terminal:'boolean' },
    sms_delivery_events: { message_sid:'text',event_key:'text',status:'text',error_code:'text',error_message:'text',received_at:'timestamp with time zone' },
  };
  for (const [table, fields] of Object.entries(schema)) {
    if (columns.filter(row => row.table_name === table).length !== Object.keys(fields).length
      || Object.entries(fields).some(([name,type]) => !columns.some(row => row.table_name === table && row.column_name === name && row.data_type === type
        && row.is_nullable === (['last_error_code','last_error_message','error_code','error_message'].includes(name) ? 'YES' : 'NO')))) {
      throw new Error('034 receipt columns differ from reviewed schema');
    }
  }
  return { applied: true, atomicReceiptsVerified: true, guardedFollowUpVerified: true, serviceOnlyVerified: true };
}
module.exports = { version, inspect };
