const fs=require('node:fs'),path=require('node:path');
const version='035_commercial_business_tools.sql';
const functions={
  commercial_email_contact:'p_id uuid',
  commercial_business_record:'p_lead_id uuid, p_revision integer, p_operation_id uuid, p_actor jsonb, p_action text, p_payload jsonb',
  commercial_email_claim:'p_id uuid, p_lead_id uuid, p_request_id uuid, p_purpose text, p_content jsonb, p_actor jsonb, p_retry boolean',
  commercial_email_finish:'p_id uuid, p_state text, p_provider_id text, p_error text, p_retry_safe boolean',
  commercial_email_event:'p_id uuid, p_event jsonb',
  commercial_file_record:'p_id uuid, p_lead_id uuid, p_actor jsonb, p_file jsonb, p_complete boolean',
};
const typeNames={uuid:'uuid',integer:'integer',text:'text',boolean:'boolean',timestamptz:'timestamp with time zone',jsonb:'jsonb'};
async function inspect(client,applied){
  const sql=fs.readFileSync(path.join(__dirname,'..','migrations',version),'utf8').replace(/\r\n/g,'\n');
  const definitions=[...sql.matchAll(/create table public\.(\w+) \(([\s\S]*?)\n\);/g)];
  const names=definitions.map(match=>match[1]);
  const tables=(await client.query(`select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[])`,[names])).rows;
  const routines=(await client.query(`select p.proname,p.prosrc,p.prosecdef,p.proconfig,pg_get_function_identity_arguments(p.oid) arguments,
    has_function_privilege('anon',p.oid,'execute') anon_execute,has_function_privilege('authenticated',p.oid,'execute') auth_execute,
    has_function_privilege('service_role',p.oid,'execute') service_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any($1::text[])`,[Object.keys(functions)])).rows;
  const bucket=(await client.query(`select public,file_size_limit,allowed_mime_types from storage.buckets where id='commercial-private-files'`)).rows;
  const storage=(await client.query(`select c.relrowsecurity rls,has_table_privilege(current_user,'storage.buckets','INSERT') bucket_insert,
    (select count(*) from pg_policy p where p.polrelid=c.oid and p.polpermissive and
      (0=any(p.polroles) or exists(select 1 from unnest(p.polroles) role_id where role_id<>0
        and (pg_has_role('anon',role_id,'USAGE') or pg_has_role('authenticated',role_id,'USAGE'))))) browser_policies
    from pg_class c where c.oid='storage.objects'::regclass`)).rows[0];
  if(!storage?.rls||Number(storage.browser_policies)!==0)throw Error('035 private Storage default-deny protections changed; reconcile browser policies');
  if(!applied){
    if(tables.length||routines.length||bucket.length)throw Error('035 objects/storage exist without a verified ledger entry; reconcile before adoption');
    if(!storage.bucket_insert)throw Error('035 requires authorized bucket INSERT access');
    return {applied:false,reviewOnly:true,storagePrerequisitesVerified:true};
  }
  if(tables.length!==names.length||tables.some(t=>!t.relrowsecurity)||routines.length!==Object.keys(functions).length)throw Error('035 schema/RLS/functions incomplete');
  for(const row of routines){
    const body=new RegExp(`create function public\\.${row.proname}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`).exec(sql)?.[1];
    if(!body||row.prosrc.replace(/\r\n/g,'\n').trim()!==body.trim()||row.arguments!==functions[row.proname]||!row.prosecdef
      ||!row.proconfig?.includes('search_path=pg_catalog, public')||row.anon_execute||row.auth_execute||!row.service_execute){
      throw Error('035 service-only atomic function contract changed');
    }
  }
  const columns=(await client.query(`select table_name,column_name,data_type,is_nullable from information_schema.columns
    where table_schema='public' and table_name=any($1::text[])`,[names])).rows;
  for(const [,name,body] of definitions){
    const expected=[...body.matchAll(/^\s+(\w+) (uuid|integer|text|boolean|timestamptz|jsonb)(.*)$/gm)];
    if(columns.filter(c=>c.table_name===name).length!==expected.length||expected.some(([,column,type,rest])=>
      !columns.some(c=>c.table_name===name&&c.column_name===column&&c.data_type===typeNames[type]
        &&c.is_nullable===(/not null|primary key/.test(rest)?'NO':'YES'))))throw Error('035 columns differ from reviewed schema');
  }
  const grants=(await client.query(`select grantee,table_name,privilege_type from information_schema.role_table_grants
    where table_schema='public' and table_name=any($1::text[])`,[names])).rows;
  if(grants.some(g=>['PUBLIC','anon','authenticated'].includes(g.grantee)||(g.grantee==='service_role'&&g.privilege_type!=='SELECT'))
    ||names.some(name=>!grants.some(g=>g.table_name===name&&g.grantee==='service_role'&&g.privilege_type==='SELECT')))throw Error('035 read-only service table grants changed');
  if(bucket.length!==1||bucket[0].public!==false||Number(bucket[0].file_size_limit)!==3145728
    ||JSON.stringify([...bucket[0].allowed_mime_types].sort())!==JSON.stringify(['application/pdf','image/jpeg','image/png','image/webp']))throw Error('035 private Storage protections changed');
  return {applied:true,serviceOnlyVerified:true,privateStorageVerified:true,atomicEmailAndBusinessRecordsVerified:true};
}
module.exports={version,inspect};
