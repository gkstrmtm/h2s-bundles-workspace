const fs=require('node:fs'),path=require('node:path');
const version='038_residential_workspace.sql';
const functions=['h2s_residential_callback_guard','h2s_enqueue_residential_callback','h2s_enqueue_residential_booking',
  'h2s_residential_workspace_ready','h2s_record_residential_callback','h2s_claim_residential_notice','h2s_finish_residential_notice'];
async function inspect(client,applied){
  const rpc=(await client.query(`select p.proname name,p.prosrc source,p.prosecdef definer,p.proconfig config,
    has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any($1::text[])`,[functions])).rows;
  const columns=(await client.query(`select column_name name,is_nullable nullable,column_default default_value
    from information_schema.columns where table_schema='public' and table_name='commercial_lead_operations'
    and column_name in ('residential_callback_revision','residential_callback_status')`)).rows;
  const table=(await client.query(`select c.relrowsecurity rls from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='residential_notices' and c.relkind='r'`)).rows;
  if(!applied){
    if(rpc.length||columns.length||table.length)throw new Error('038 objects exist without verified migration history; reconcile before adoption');
    return {applied:false,reviewOnly:true};
  }
  if(rpc.length!==functions.length||columns.length!==2||table.length!==1||!table[0].rls)throw new Error('038 workspace schema or RLS is incomplete');
  const sql=fs.readFileSync(path.join(__dirname,'..','migrations',version),'utf8').replace(/\r\n/g,'\n');
  for(const row of rpc){
    const expected=new RegExp(`create function public\\.${row.name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`).exec(sql)?.[1];
    const guard=functions.slice(0,3).includes(row.name);
    if(!expected||row.source.replace(/\r\n/g,'\n').trim()!==expected.trim()
      ||row.definer!==(row.name!=='h2s_residential_workspace_ready')
      ||JSON.stringify(row.config)!==JSON.stringify(['search_path=public, pg_temp'])
      ||row.anon_execute||row.authenticated_execute||row.service_execute===guard)throw new Error('038 reviewed function or privileges changed');
  }
  if(columns.some(c=>c.nullable!=='NO')||!columns.find(c=>c.name==='residential_callback_revision').default_value.includes('0')
    ||!columns.find(c=>c.name==='residential_callback_status').default_value.includes("'none'"))throw new Error('038 callback defaults changed');
  const triggers=(await client.query(`select t.tgname name,t.tgenabled enabled,pg_get_triggerdef(t.oid) definition
    from pg_trigger t where t.tgname in ('h2s_residential_callback_guard','h2s_residential_callback_notices','h2s_residential_booking_notices')`)).rows;
  const definitions=[
    'CREATE TRIGGER h2s_residential_callback_guard BEFORE INSERT OR UPDATE ON public.commercial_lead_operations FOR EACH ROW EXECUTE FUNCTION h2s_residential_callback_guard()',
    'CREATE TRIGGER h2s_residential_callback_notices AFTER INSERT OR UPDATE ON public.commercial_lead_operations FOR EACH ROW EXECUTE FUNCTION h2s_enqueue_residential_callback()',
    'CREATE TRIGGER h2s_residential_booking_notices AFTER INSERT OR UPDATE ON public.commercial_reservations FOR EACH ROW EXECUTE FUNCTION h2s_enqueue_residential_booking()',
  ];
  if(triggers.length!==3||triggers.some(t=>t.enabled!=='O'||!definitions.includes(t.definition)))throw new Error('038 notice triggers changed');
  const access=(await client.query(`select has_table_privilege('anon','public.residential_notices','SELECT') anon_select,
    has_table_privilege('authenticated','public.residential_notices','SELECT') authenticated_select,
    has_table_privilege('service_role','public.residential_notices','SELECT') service_select,
    has_table_privilege('service_role','public.residential_notices','INSERT,UPDATE,DELETE') service_write`)).rows[0];
  if(access.anon_select||access.authenticated_select||!access.service_select||access.service_write)throw new Error('038 default-deny grants changed');
  const constraints=(await client.query(`select pg_get_constraintdef(oid) definition,convalidated valid from pg_constraint
    where conrelid='public.residential_notices'::regclass and contype<>'n'`)).rows;
  if(constraints.length!==8||constraints.some(c=>!c.valid)
    ||!constraints.some(c=>c.definition==='UNIQUE (request_id, kind, version)')
    ||!constraints.some(c=>c.definition.includes('expires_at > due_at')))throw new Error('038 notice constraints changed');
  const index=(await client.query(`select i.indisvalid valid,i.indisready ready,pg_get_indexdef(i.indexrelid) definition,
    pg_get_expr(i.indpred,i.indrelid) predicate from pg_index i join pg_class c on c.oid=i.indexrelid
    where c.relname='residential_notices_due'`)).rows;
  if(index.length!==1||!index[0].valid||!index[0].ready||!index[0].definition.includes('(due_at)')||!index[0].predicate?.includes("'pending'"))throw new Error('038 due-notice index changed');
  return {applied:true,reviewOnly:false,callbackAuditVerified:true,versionedNoticesVerified:true,serviceOnlyClaims:true};
}
module.exports={version,inspect};
