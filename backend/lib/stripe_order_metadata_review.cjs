const fs = require('node:fs');
const path = require('node:path');
const version = '033_atomic_stripe_order_metadata.sql';

async function inspect(client, applied) {
  const columns = (await client.query(`select column_name,data_type from information_schema.columns
    where table_schema='public' and table_name='h2s_orders'`)).rows;
  for (const [name, type] of [
    ...['order_id','payment_intent_id','status','address','city','state','zip','customer_name','customer_phone'].map(name => [name,'text']),
    ['metadata_json','jsonb'],['updated_at','timestamp with time zone'],
  ]) {
    if (!columns.some(column => column.column_name === name && column.data_type === type)) {
      throw new Error(`033 prerequisite changed: h2s_orders.${name}; reconcile before applying`);
    }
  }
  const rows = (await client.query(`select p.prosrc source,p.prosecdef definer,p.proconfig config,
    pg_get_function_identity_arguments(p.oid) arguments,
    has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='stripe_patch_order'`)).rows;
  if (!applied) {
    if (rows.length) throw new Error('033 RPC exists without a verified ledger entry; reconcile before adoption');
    return { applied:false, prerequisiteSchemaVerified:true };
  }
  const source = fs.readFileSync(path.join(__dirname,'..','migrations',version),'utf8').replace(/\r\n/g,'\n').split('$$')[1].trim();
  const rpc = rows[0];
  if (rows.length !== 1 || rpc.definer || !rpc.config?.includes('search_path=public, pg_temp')
    || rpc.arguments !== 'p_order_id text, p_metadata jsonb, p_checkout jsonb'
    || rpc.source.replace(/\r\n/g,'\n').trim() !== source || rpc.anon_execute || rpc.authenticated_execute || !rpc.service_execute) {
    throw new Error('033 RPC differs from the reviewed atomic service-only contract');
  }
  return { applied:true, prerequisiteSchemaVerified:true, atomicRpcVerified:true };
}
module.exports = { version, inspect };
