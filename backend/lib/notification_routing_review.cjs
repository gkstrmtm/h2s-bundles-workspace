const fs=require('node:fs'),path=require('node:path');
const version='039_notification_routing.sql';
const tables=['notification_routing','notification_routing_activity'];
async function inspect(client,applied){
  const relations=(await client.query(`select c.relname name,c.relrowsecurity rls from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[]) and c.relkind='r'`,[tables])).rows;
  const rpc=(await client.query(`select p.prosrc source,p.prosecdef definer,p.proconfig config,
    oidvectortypes(p.proargtypes) arguments,format_type(p.prorettype,null) returns,
    has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='h2s_save_notification_routing'`)).rows;
  if(!applied){
    if(relations.length||rpc.length)throw new Error('039 objects exist without verified migration history; reconcile explicitly');
    return {applied:false,reviewOnly:true};
  }
  if(relations.length!==2||relations.some(row=>!row.rls)||rpc.length!==1)throw new Error('039 routing schema/RLS incomplete');
  const sql=fs.readFileSync(path.join(__dirname,'..','migrations',version),'utf8').replace(/\r\n/g,'\n');
  const body=/create function public\.h2s_save_notification_routing\([\s\S]*?as \$\$([\s\S]*?)\$\$;/.exec(sql)[1];
  const fn=rpc[0];
  if(fn.source.replace(/\r\n/g,'\n').trim()!==body.trim()||!fn.definer
    ||JSON.stringify(fn.config)!==JSON.stringify(['search_path=public, pg_temp'])
    ||fn.arguments!=='text, integer, jsonb, text'||fn.returns!=='jsonb'
    ||fn.anon_execute||fn.authenticated_execute||!fn.service_execute)throw new Error('039 routing function or privileges changed');
  const policies=(await client.query("select 1 from pg_policies where schemaname='public' and tablename=any($1::text[])",[tables])).rows;
  if(policies.length)throw new Error('039 routing tables must remain default-deny');
  for(const table of tables){
    const access=(await client.query(`select role,
      has_table_privilege(role,$1,'SELECT') can_select,
      has_any_column_privilege(role,$1,'SELECT') column_select,
      has_table_privilege(role,$1,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') can_write,
      has_any_column_privilege(role,$1,'INSERT,UPDATE') column_write
      from unnest(array['anon','authenticated','service_role']) role`,['public.'+table])).rows;
    if(access.length!==3||access.some(row=>row.can_write||row.column_write||row.can_select!==(row.role==='service_role')
      ||row.column_select!==(row.role==='service_role')))throw new Error('039 routing table grants changed');
  }
  const constraints=(await client.query(`select c.relname table_name,x.conname name,pg_get_constraintdef(x.oid) definition,x.convalidated valid
    from pg_constraint x join pg_class c on c.oid=x.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[]) and x.contype<>'n'`,[tables])).rows;
  const compact=value=>value.toLowerCase().replace(/::text/g,'').replace(/public\./g,'').replace(/[\s()"]/g,'');
  const expected=[
    ['notification_routing',"CHECK (route_key='residential_owner')"],
    ['notification_routing',String.raw`CHECK (phone ~ '^\+[1-9][0-9]{10,14}$')`],
    ['notification_routing','CHECK (revision>0)'],
    ['notification_routing',"CHECK (jsonb_typeof(updated_by)='object')"],
    ['notification_routing','PRIMARY KEY (route_key)'],
    ['notification_routing_activity','PRIMARY KEY (activity_id)'],
    ['notification_routing_activity','FOREIGN KEY (route_key) REFERENCES notification_routing(route_key)'],
    ['notification_routing_activity','CHECK (revision>0)'],
    ['notification_routing_activity',"CHECK (previous_source=ANY (ARRAY['environment','saved']))"],
    ['notification_routing_activity','UNIQUE (route_key,revision)'],
  ].map(([table,definition])=>table+':'+compact(definition)).sort();
  const actual=constraints.map(row=>row.table_name+':'+compact(row.definition)).sort();
  if(constraints.some(row=>!row.valid)||JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('039 routing constraints changed');
  const columns=(await client.query(`select table_name,column_name name,data_type type,is_nullable nullable,column_default default_value
    from information_schema.columns where table_schema='public' and table_name=any($1::text[]) order by table_name,ordinal_position`,[tables])).rows;
  const signatures=[
    ['notification_routing','route_key','text','NO',null],['notification_routing','phone','text','NO',null],
    ['notification_routing','revision','integer','NO',null],['notification_routing','updated_at','timestamp with time zone','NO','now()'],
    ['notification_routing','updated_by','jsonb','NO',null],
    ['notification_routing_activity','activity_id','uuid','NO','gen_random_uuid()'],
    ['notification_routing_activity','route_key','text','NO',null],['notification_routing_activity','revision','integer','NO',null],
    ['notification_routing_activity','previous_phone','text','YES',null],['notification_routing_activity','phone','text','NO',null],
    ['notification_routing_activity','previous_source','text','NO',null],['notification_routing_activity','actor','jsonb','NO',null],
    ['notification_routing_activity','changed_at','timestamp with time zone','NO','now()'],
  ];
  if(JSON.stringify(columns.map(row=>[row.table_name,row.name,row.type,row.nullable,row.default_value]))!==JSON.stringify(signatures))throw new Error('039 routing columns changed');
  const triggers=(await client.query(`select 1 from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[]) and not t.tgisinternal`,[tables])).rows;
  if(triggers.length)throw new Error('039 unreviewed routing trigger');
  return {applied:true,reviewOnly:false,defaultDeny:true,atomicAudit:true,revisionChecked:true};
}
module.exports={version,inspect};
