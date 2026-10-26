const fs=require('node:fs'),path=require('node:path');
const version='037_residential_inquiries.sql';
const functions=['h2s_guard_lead_market','h2s_guard_inquiry_request','h2s_residential_intake_ready',
  'h2s_submit_residential_inquiry','h2s_review_residential_inquiry'];
function isReviewedInquiryTrigger(row){
  const lead=row.name==='h2s_lead_market_guard';
  if(!lead&&row.name!=='h2s_inquiry_request_guard')return false;
  const table=lead?'commercial_leads':'commercial_consultation_requests';
  const name=lead?'h2s_guard_lead_market':'h2s_guard_inquiry_request';
  const sql=fs.readFileSync(path.join(__dirname,'..','migrations',version),'utf8').replace(/\r\n/g,'\n');
  const body=new RegExp(`create function public\\.${name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`).exec(sql)?.[1];
  return row.table_name===table&&row.enabled==='O'
    &&row.definition===`CREATE TRIGGER ${row.name} BEFORE INSERT OR UPDATE ON public.${table} FOR EACH ROW EXECUTE FUNCTION ${name}()`
    &&!!body&&row.function_body?.replace(/\r\n/g,'\n').trim()===body.trim()
    &&row.security_definer===true&&JSON.stringify(row.config)===JSON.stringify(['search_path=public, pg_temp']);
}
function isReviewedMarketIndex(row){
  const compact=value=>String(value||'').toLowerCase().replace(/::text/g,'').replace(/[\s()"]/g,'');
  return row.table_name==='commercial_leads'&&row.name==='h2s_lead_market_submitted'
    &&row.valid===true&&row.unique===false&&!row.predicate
    &&compact(row.definition)===compact("CREATE INDEX h2s_lead_market_submitted ON public.commercial_leads USING btree (COALESCE((attribution ->> 'market'::text), 'commercial'::text), last_submitted_at DESC)");
}
async function inspect(client,applied) {
  const rpc=(await client.query(`select p.proname name,p.prosrc source,p.prosecdef definer,p.proconfig config,
    has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any($1::text[])`,[functions])).rows;
  const triggers=(await client.query(`select c.relname table_name,t.tgname name,t.tgenabled enabled,pg_get_triggerdef(t.oid) definition
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and t.tgname in ('h2s_lead_market_guard','h2s_inquiry_request_guard')`)).rows;
  const index=(await client.query(`select pg_get_indexdef(i.indexrelid) definition,i.indisvalid valid,i.indisready ready,
    pg_get_expr(i.indpred,i.indrelid) predicate from pg_index i join pg_class c on c.oid=i.indexrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='h2s_lead_market_submitted'`)).rows;
  if(!applied){
    if(rpc.length || triggers.length || index.length) throw new Error('037 objects exist without verified history; reconcile before adoption');
    const existing=(await client.query("select exists(select 1 from public.commercial_leads where attribution->>'market'='residential') present")).rows[0];
    if(existing.present)throw new Error('Existing residential records require reconciliation before migration 037');
    return {applied:false,reviewOnly:true};
  }
  if(rpc.length!==functions.length || triggers.length!==2 || index.length!==1)throw new Error('037 homeowner objects are incomplete');
  const sql=fs.readFileSync(path.join(__dirname,'..','migrations',version),'utf8').replace(/\r\n/g,'\n');
  for(const row of rpc){
    const expected=new RegExp(`create function public\\.${row.name}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`).exec(sql)?.[1];
    const guard=row.name.startsWith('h2s_guard_'),definer=guard || row.name==='h2s_review_residential_inquiry';
    if(!expected || row.source.replace(/\r\n/g,'\n').trim()!==expected.trim() || row.definer!==definer
      || JSON.stringify(row.config)!==JSON.stringify(['search_path=public, pg_temp']) || row.anon_execute || row.authenticated_execute
      || row.service_execute===guard)throw new Error('037 reviewed function or execute privileges changed');
  }
  for(const row of triggers){
    const lead=row.name==='h2s_lead_market_guard',table=lead?'commercial_leads':'commercial_consultation_requests';
    const definition=`CREATE TRIGGER ${row.name} BEFORE INSERT OR UPDATE ON public.${table} FOR EACH ROW EXECUTE FUNCTION ${lead?'h2s_guard_lead_market':'h2s_guard_inquiry_request'}()`;
    if(row.table_name!==table || row.enabled!=='O' || row.definition!==definition)throw new Error('037 market or non-booking trigger changed');
  }
  if(!index[0].valid || !index[0].ready || index[0].predicate
    || !index[0].definition.includes('attribution') || !index[0].definition.includes("'commercial'::text")
    || !index[0].definition.includes('last_submitted_at DESC'))throw new Error('037 market index changed');
  return {applied:true,reviewOnly:false,marketIsolationVerified:true,inquiryDoesNotBook:true,reviewAuditVerified:true};
}
module.exports={version,inspect,isReviewedInquiryTrigger,isReviewedMarketIndex};
