-- REVIEW ONLY. Incremental native-run upgrade after 052; retarget to the exact owned run.
-- Do not replay 044/046 against an existing run. This transaction refuses public/fixtures.
-- Proposed configuration is not production approval. No settings or business data are enabled here.
-- Execute normalized reviewed SQL as the run's NOLOGIN owner with its private search_path.
-- Existing run: apply only 053 after installed 052. Fresh run: normal source order, then 053.
-- Native policy_approve/catalog publish payloads are unchanged; both select staging_only automatically.
-- Direct staging seeds leave approval identity/time NULL. Catalog source_evidence must contain
-- stagingOnly:true, productionApproved:false; agreement approval_evidence records staging authorization,
-- not legal approval. All legal copies, cancellation calendars and payment/economic gates still apply.
begin;
create or replace function public.field_sales_native_staging_scope() returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare ns record; storage_ns record; identity jsonb; run_uuid uuid; ledger record;
begin
  select (n.nspname) as schema_name,n.nspowner,r.rolname,r.rolcanlogin,r.rolsuper,r.rolbypassrls,
    obj_description(n.oid,'pg_namespace') as marker into ns
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=n.nspowner
    where p.oid='public.field_sales_native_staging_scope()'::regprocedure and p.proowner=n.nspowner;
  if not found or ns.schema_name !~ '^h2s_test_[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$'
    or ns.rolname<>ns.schema_name||'_owner' or ns.rolcanlogin or ns.rolsuper or ns.rolbypassrls then return false; end if;
  identity:=ns.marker::jsonb;
  run_uuid:=(identity->>'runId')::uuid;
  if identity->>'marker' is distinct from 'home2smart-native-test-run-v1'
    or replace(run_uuid::text,'-','') is distinct from substr(ns.schema_name,10)
    or identity->>'schema' is distinct from ns.schema_name
    or identity->>'storageSchema' is distinct from ns.schema_name||'_storage'
    or identity->>'role' is distinct from ns.rolname
    or coalesce(identity->>'sourceCommit','') !~ '^[a-f0-9]{40}$'
    or coalesce(identity->>'nativeBaselineFingerprint','') !~ '^[a-f0-9]{64}$' then return false; end if;
  select n.nspowner,obj_description(n.oid,'pg_namespace') as marker into storage_ns
    from pg_namespace n where n.nspname=ns.schema_name||'_storage';
  if not found or storage_ns.nspowner<>ns.nspowner or storage_ns.marker::jsonb is distinct from identity then return false; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname=ns.schema_name and c.relname='h2s_test_run' and c.relkind='r' and c.relowner=ns.nspowner) then return false; end if;
  select count(*) as count,bool_and(run_id=run_uuid and source_commit=identity->>'sourceCommit'
    and baseline_sha256=identity->>'nativeBaselineFingerprint') as matches into ledger from public.h2s_test_run;
  return ledger.count=1 and coalesce(ledger.matches,false);
exception when others then return false;
end $$;
create or replace function public.field_sales_configuration_usable(p_status text,p_production_status text) returns boolean
language sql stable set search_path=pg_catalog,public as $$
  select p_production_status in ('approved','published') and
    (p_status=p_production_status or (p_status='staging_only' and public.field_sales_native_staging_scope()))
$$;
do $$ begin
  if not public.field_sales_native_staging_scope() then
    raise exception '053 requires the verified UUID-owned native sandbox' using errcode='42501';
  end if;
end $$;

alter table public.field_sales_catalogs
  add column if not exists "productionApproved" boolean generated always as (status='published') stored,
  add column if not exists "stagingOnly" boolean generated always as (status='staging_only') stored;
alter table public.field_sales_agreement_policies
  add column if not exists "productionApproved" boolean generated always as (status='approved') stored,
  add column if not exists "stagingOnly" boolean generated always as (status='staging_only') stored;
alter table public.field_sales_workflow_policies
  add column if not exists "productionApproved" boolean generated always as (status='approved') stored,
  add column if not exists "stagingOnly" boolean generated always as (status='staging_only') stored;
-- Only the reviewed status/evidence checks change; all other constraints remain authoritative.
do $$ declare t text; k record; begin
  foreach t in array array['field_sales_catalogs','field_sales_agreement_policies','field_sales_workflow_policies'] loop
    for k in select conname from pg_constraint where conrelid in
      (select oid from pg_class where relnamespace='public'::regnamespace and relname=t) and contype='c'
      and conname in (t||'_status_check',t||'_check',t||'_check1',
        t||'_scope_status',t||'_scope_staging',t||'_scope_approval') loop
      execute format('alter table public.%I drop constraint %I',t,k.conname);
    end loop;
  end loop;
end $$;
alter table public.field_sales_catalogs
  add constraint field_sales_catalogs_scope_status check(status in ('draft','published','retired','staging_only')),
  add constraint field_sales_catalogs_scope_staging check(status<>'staging_only' or
    (public.field_sales_native_staging_scope() and approved_by is null and published_at is null
      and source_evidence @> '{"stagingOnly":true,"productionApproved":false}'::jsonb
      and coalesce(definition->>'currency'='usd' and (definition->>'validForMinutes')::integer between 1 and 43200,false))),
  add constraint field_sales_catalogs_scope_approval check(status in ('draft','staging_only') or
    (approved_by is not null and published_at is not null and coalesce(length(source_evidence->>'approvalEvidence'),0)>0
      and definition->>'currency'='usd' and definition->>'validForMinutes' is not null
      and (definition->>'validForMinutes')::integer between 1 and 43200));
alter table public.field_sales_agreement_policies
  add constraint field_sales_agreement_policies_scope_status check(status in ('draft','approved','retired','staging_only')),
  add constraint field_sales_agreement_policies_scope_staging check(status<>'staging_only' or
    (public.field_sales_native_staging_scope() and approved_by is null and approved_at is null
      and coalesce(length(terms),0)>0 and coalesce(length(cancellation_information),0)>0
      and coalesce(length(electronic_delivery),0)>0 and coalesce(length(payment_terms),0)>0 and coalesce(length(approval_evidence),0)>0)),
  add constraint field_sales_agreement_policies_scope_approval check(status in ('draft','staging_only') or
    (approved_by is not null and approved_at is not null and coalesce(length(terms),0)>0
      and coalesce(length(cancellation_information),0)>0 and coalesce(length(electronic_delivery),0)>0
      and coalesce(length(payment_terms),0)>0 and coalesce(length(approval_evidence),0)>0));
alter table public.field_sales_workflow_policies
  add constraint field_sales_workflow_policies_scope_status check(status in ('draft','approved','retired','staging_only')),
  add constraint field_sales_workflow_policies_scope_staging check(status<>'staging_only' or
    (public.field_sales_native_staging_scope() and approved_by is null and approved_at is null
      and coalesce(jsonb_typeof(approval_evidence)='object' and approval_evidence<>'{}'::jsonb,false))),
  add constraint field_sales_workflow_policies_scope_approval check(status in ('draft','staging_only') or
    (approved_by is not null and approved_at is not null and jsonb_typeof(approval_evidence)='object' and approval_evidence<>'{}'::jsonb));

-- Exact, counted literal patches preserve later wrappers and cancellation-amendment fixes.
-- This transaction-local validator executes no SQL and is dropped before commit.
create function public.field_sales_staging_patch(p_source text,p_expected integer,p_before_length integer,
  p_updated text,p_without_before text,p_without_after text,p_overlap boolean) returns text
language plpgsql set search_path=pg_catalog,public as $$
declare occurrences integer;
begin
  occurrences:=(length(p_source)-length(p_without_before))/p_before_length;
  if p_without_after<>p_source then
    if occurrences<>(case when p_overlap then p_expected else 0 end) then
      raise exception '053 reviewed fragment mismatch: partial upgrade'; end if;
    return p_source;
  end if;
  if occurrences<>p_expected or p_updated=p_source then
    raise exception '053 reviewed fragment mismatch (expected %, got %, fragment length %, function %)',
      p_expected,occurrences,p_before_length,split_part(p_source,chr(10),1);
  end if;
  return p_updated;
end $$;
do $upgrade$
declare src text; result text;
begin
  src:=pg_get_functiondef('public.field_sales_freeze_transaction()'::regprocedure);
  result:=public.field_sales_staging_patch(src,2,length($old$(to_jsonb(new)-'status')<>(to_jsonb(old)-'status')$old$),
    replace(src,$old$(to_jsonb(new)-'status')<>(to_jsonb(old)-'status')$old$,$new$(to_jsonb(new)-array['status','productionApproved','stagingOnly'])<>(to_jsonb(old)-array['status','productionApproved','stagingOnly'])$new$),
    replace(src,$old$(to_jsonb(new)-'status')<>(to_jsonb(old)-'status')$old$,''),replace(src,$new$(to_jsonb(new)-array['status','productionApproved','stagingOnly'])<>(to_jsonb(old)-array['status','productionApproved','stagingOnly'])$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_transaction_read(uuid,uuid)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$c.status in ('draft','published')$old$),
    replace(src,$old$c.status in ('draft','published')$old$,$new$(c.status='draft' or public.field_sales_configuration_usable(c.status,'published'))$new$),
    replace(src,$old$c.status in ('draft','published')$old$,''),replace(src,$new$(c.status='draft' or public.field_sales_configuration_usable(c.status,'published'))$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_transaction_read(uuid,uuid)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$p.status='approved'$old$),
    replace(src,$old$p.status='approved'$old$,$new$public.field_sales_configuration_usable(p.status,'approved')$new$),
    replace(src,$old$p.status='approved'$old$,''),replace(src,$new$public.field_sales_configuration_usable(p.status,'approved')$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_transaction_command_legacy(uuid,uuid,uuid,text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$c.status not in ('draft','published')$old$),
    replace(src,$old$c.status not in ('draft','published')$old$,$new$not (c.status='draft' or public.field_sales_configuration_usable(c.status,'published'))$new$),
    replace(src,$old$c.status not in ('draft','published')$old$,''),replace(src,$new$not (c.status='draft' or public.field_sales_configuration_usable(c.status,'published'))$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_transaction_command_legacy(uuid,uuid,uuid,text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$case when c.status='published' and jsonb_array_length$old$),
    replace(src,$old$case when c.status='published' and jsonb_array_length$old$,$new$case when public.field_sales_configuration_usable(c.status,'published') and jsonb_array_length$new$),
    replace(src,$old$case when c.status='published' and jsonb_array_length$old$,''),replace(src,$new$case when public.field_sales_configuration_usable(c.status,'published') and jsonb_array_length$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_transaction_command_legacy(uuid,uuid,uuid,text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$if c.status<>'published' then$old$),
    replace(src,$old$if c.status<>'published' then$old$,$new$if not public.field_sales_configuration_usable(c.status,'published') then$new$),
    replace(src,$old$if c.status<>'published' then$old$,''),replace(src,$new$if not public.field_sales_configuration_usable(c.status,'published') then$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_transaction_command_legacy(uuid,uuid,uuid,text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$or c.approved_by is null or c.published_at is null)$old$),
    replace(src,$old$or c.approved_by is null or c.published_at is null)$old$,$new$or (c.status<>'staging_only' and (c.approved_by is null or c.published_at is null))
      or not public.field_sales_configuration_usable(c.status,'published'))$new$),
    replace(src,$old$or c.approved_by is null or c.published_at is null)$old$,''),replace(src,$new$or (c.status<>'staging_only' and (c.approved_by is null or c.published_at is null))
      or not public.field_sales_configuration_usable(c.status,'published'))$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_transaction_command_legacy(uuid,uuid,uuid,text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$jsonb_build_object('pricingStatus',case when c.status='published' then 'published' else 'unpublished_not_payable' end)$old$),
    replace(src,$old$jsonb_build_object('pricingStatus',case when c.status='published' then 'published' else 'unpublished_not_payable' end)$old$,$new$jsonb_build_object('pricingStatus',case when c.status='staging_only' then 'staging_only'
      when c.status='published' then 'published' else 'unpublished_not_payable' end,
      'productionApproved',c.status='published','stagingOnly',c.status='staging_only')$new$),
    replace(src,$old$jsonb_build_object('pricingStatus',case when c.status='published' then 'published' else 'unpublished_not_payable' end)$old$,''),replace(src,$new$jsonb_build_object('pricingStatus',case when c.status='staging_only' then 'staging_only'
      when c.status='published' then 'published' else 'unpublished_not_payable' end,
      'productionApproved',c.status='published','stagingOnly',c.status='staging_only')$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_transaction_command_legacy(uuid,uuid,uuid,text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$p.status='approved'$old$),
    replace(src,$old$p.status='approved'$old$,$new$public.field_sales_configuration_usable(p.status,'approved')$new$),
    replace(src,$old$p.status='approved'$old$,''),replace(src,$new$public.field_sales_configuration_usable(p.status,'approved')$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_customer_agreement_legacy(text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$where quote_id=a.quote_id;$old$),
    replace(src,$old$where quote_id=a.quote_id;$old$,$new$where quote_id=a.quote_id;
  if (a.policy_snapshot->>'stagingOnly'='true' or q.snapshot->>'stagingOnly'='true')
    and not public.field_sales_native_staging_scope() then
    raise exception 'Staging agreement requires its verified native test run' using errcode='42501'; end if;$new$),
    replace(src,$old$where quote_id=a.quote_id;$old$,''),replace(src,$new$where quote_id=a.quote_id;
  if (a.policy_snapshot->>'stagingOnly'='true' or q.snapshot->>'stagingOnly'='true')
    and not public.field_sales_native_staging_scope() then
    raise exception 'Staging agreement requires its verified native test run' using errcode='42501'; end if;$new$,''),true);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_workflow_freeze()'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$to_jsonb(old)-'status'=to_jsonb(new)-'status'$old$),
    replace(src,$old$to_jsonb(old)-'status'=to_jsonb(new)-'status'$old$,$new$to_jsonb(old)-array['status','productionApproved','stagingOnly']=to_jsonb(new)-array['status','productionApproved','stagingOnly']$new$),
    replace(src,$old$to_jsonb(old)-'status'=to_jsonb(new)-'status'$old$,''),replace(src,$new$to_jsonb(old)-array['status','productionApproved','stagingOnly']=to_jsonb(new)-array['status','productionApproved','stagingOnly']$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_workflow_document_gate(uuid,boolean)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$status='approved'$old$),
    replace(src,$old$status='approved'$old$,$new$public.field_sales_configuration_usable(status,'approved')$new$),
    replace(src,$old$status='approved'$old$,''),replace(src,$new$public.field_sales_configuration_usable(status,'approved')$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_workflow_deadline(uuid,timestamp with time zone)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$p.status='approved'$old$),
    replace(src,$old$p.status='approved'$old$,$new$public.field_sales_configuration_usable(p.status,'approved')$new$),
    replace(src,$old$p.status='approved'$old$,''),replace(src,$new$public.field_sales_configuration_usable(p.status,'approved')$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_workflow_read(uuid,uuid,uuid)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$or status='approved'$old$),
    replace(src,$old$or status='approved'$old$,$new$or public.field_sales_configuration_usable(status,'approved')$new$),
    replace(src,$old$or status='approved'$old$,''),replace(src,$new$or public.field_sales_configuration_usable(status,'approved')$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_workflow_command(uuid,uuid,uuid,uuid,integer,text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$job uuid; linked uuid; v jsonb;$old$),
    replace(src,$old$job uuid; linked uuid; v jsonb;$old$,$new$job uuid; linked uuid; v jsonb;
  configuration_status text;$new$),
    replace(src,$old$job uuid; linked uuid; v jsonb;$old$,''),replace(src,$new$job uuid; linked uuid; v jsonb;
  configuration_status text;$new$,''),true);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_workflow_command(uuid,uuid,uuid,uuid,integer,text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$elsif p_action='policy_approve' and pol.status='draft' then$old$),
    replace(src,$old$elsif p_action='policy_approve' and pol.status='draft' then$old$,$new$elsif p_action='policy_approve' and pol.status='draft' then
        configuration_status:=case when public.field_sales_native_staging_scope() then 'staging_only'
          else coalesce(p_payload->>'status','approved') end;
        if coalesce(p_payload->>'status','approved') not in ('approved','staging_only')
          or (configuration_status='staging_only' and not public.field_sales_native_staging_scope()) then
          raise exception 'Staging configuration requires a verified native test run' using errcode='42501'; end if;$new$),
    replace(src,$old$elsif p_action='policy_approve' and pol.status='draft' then$old$,''),replace(src,$new$elsif p_action='policy_approve' and pol.status='draft' then
        configuration_status:=case when public.field_sales_native_staging_scope() then 'staging_only'
          else coalesce(p_payload->>'status','approved') end;
        if coalesce(p_payload->>'status','approved') not in ('approved','staging_only')
          or (configuration_status='staging_only' and not public.field_sales_native_staging_scope()) then
          raise exception 'Staging configuration requires a verified native test run' using errcode='42501'; end if;$new$,''),true);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_workflow_command(uuid,uuid,uuid,uuid,integer,text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$and status='approved')) then$old$),
    replace(src,$old$and status='approved')) then$old$,$new$and (status='approved' or (configuration_status='staging_only' and public.field_sales_configuration_usable(status,'approved'))))) then$new$),
    replace(src,$old$and status='approved')) then$old$,''),replace(src,$new$and (status='approved' or (configuration_status='staging_only' and public.field_sales_configuration_usable(status,'approved'))))) then$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_workflow_command(uuid,uuid,uuid,uuid,integer,text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$set status='approved',approved_by=p_actor,approved_at=now(),$old$),
    replace(src,$old$set status='approved',approved_by=p_actor,approved_at=now(),$old$,$new$set status=configuration_status,
          approved_by=case when configuration_status='staging_only' then null else p_actor end,
          approved_at=case when configuration_status='staging_only' then null else now() end,$new$),
    replace(src,$old$set status='approved',approved_by=p_actor,approved_at=now(),$old$,''),replace(src,$new$set status=configuration_status,
          approved_by=case when configuration_status='staging_only' then null else p_actor end,
          approved_at=case when configuration_status='staging_only' then null else now() end,$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_workflow_command(uuid,uuid,uuid,uuid,integer,text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$and kind=a->>'kind' and status='approved')$old$),
    replace(src,$old$and kind=a->>'kind' and status='approved')$old$,$new$and kind=a->>'kind' and public.field_sales_configuration_usable(status,'approved'))$new$),
    replace(src,$old$and kind=a->>'kind' and status='approved')$old$,''),replace(src,$new$and kind=a->>'kind' and public.field_sales_configuration_usable(status,'approved'))$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_transaction_command(uuid,uuid,uuid,text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$policy_id=w.legal_policy_id and status='approved'$old$),
    replace(src,$old$policy_id=w.legal_policy_id and status='approved'$old$,$new$policy_id=w.legal_policy_id and public.field_sales_configuration_usable(status,'approved')$new$),
    replace(src,$old$policy_id=w.legal_policy_id and status='approved'$old$,''),replace(src,$new$policy_id=w.legal_policy_id and public.field_sales_configuration_usable(status,'approved')$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_earnings_observe(uuid,boolean)'::regprocedure);
  result:=public.field_sales_staging_patch(src,2,length($old$and kind='commission' and status='approved'$old$),
    replace(src,$old$and kind='commission' and status='approved'$old$,$new$and kind='commission' and public.field_sales_configuration_usable(status,'approved')$new$),
    replace(src,$old$and kind='commission' and status='approved'$old$,''),replace(src,$new$and kind='commission' and public.field_sales_configuration_usable(status,'approved')$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_earnings_command(uuid,uuid,text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$and kind='settlement' and status='approved'$old$),
    replace(src,$old$and kind='settlement' and status='approved'$old$,$new$and kind='settlement' and public.field_sales_configuration_usable(status,'approved')$new$),
    replace(src,$old$and kind='settlement' and status='approved'$old$,''),replace(src,$new$and kind='settlement' and public.field_sales_configuration_usable(status,'approved')$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_earnings_observe(uuid,boolean)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$pol.policy_id is null or pol.approved_by is null or pol.approved_at is null$old$),
    replace(src,$old$pol.policy_id is null or pol.approved_by is null or pol.approved_at is null$old$,$new$pol.policy_id is null or not public.field_sales_configuration_usable(pol.status,'approved')
      or (pol.status<>'staging_only' and (pol.approved_by is null or pol.approved_at is null))$new$),
    replace(src,$old$pol.policy_id is null or pol.approved_by is null or pol.approved_at is null$old$,''),replace(src,$new$pol.policy_id is null or not public.field_sales_configuration_usable(pol.status,'approved')
      or (pol.status<>'staging_only' and (pol.approved_by is null or pol.approved_at is null))$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_earnings_command(uuid,uuid,text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$pol.policy_id is null or pol.approved_by is null or pol.approved_at is null$old$),
    replace(src,$old$pol.policy_id is null or pol.approved_by is null or pol.approved_at is null$old$,$new$pol.policy_id is null or not public.field_sales_configuration_usable(pol.status,'approved')
      or (pol.status<>'staging_only' and (pol.approved_by is null or pol.approved_at is null))$new$),
    replace(src,$old$pol.policy_id is null or pol.approved_by is null or pol.approved_at is null$old$,''),replace(src,$new$pol.policy_id is null or not public.field_sales_configuration_usable(pol.status,'approved')
      or (pol.status<>'staging_only' and (pol.approved_by is null or pol.approved_at is null))$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_catalog_admin_command(uuid,uuid,text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$if p_action='publish' then$old$),
    replace(src,$old$if p_action='publish' then$old$,$new$if p_action='publish' then
      if catalog.source_evidence->>'stagingOnly'='true' and not public.field_sales_native_staging_scope() then
        raise exception 'Staging catalog cannot become production published' using errcode='42501'; end if;$new$),
    replace(src,$old$if p_action='publish' then$old$,''),replace(src,$new$if p_action='publish' then
      if catalog.source_evidence->>'stagingOnly'='true' and not public.field_sales_native_staging_scope() then
        raise exception 'Staging catalog cannot become production published' using errcode='42501'; end if;$new$,''),true);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_catalog_admin_command(uuid,uuid,text,jsonb)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$set status='published',approved_by=p_actor,published_at=now(),
        source_evidence=jsonb_set(source_evidence,'{approvalEvidence}',to_jsonb(p_payload->>'approvalEvidence'))$old$),
    replace(src,$old$set status='published',approved_by=p_actor,published_at=now(),
        source_evidence=jsonb_set(source_evidence,'{approvalEvidence}',to_jsonb(p_payload->>'approvalEvidence'))$old$,$new$set status=case when public.field_sales_native_staging_scope() then 'staging_only' else 'published' end,
        approved_by=case when public.field_sales_native_staging_scope() then null else p_actor end,
        published_at=case when public.field_sales_native_staging_scope() then null else now() end,
        source_evidence=case when public.field_sales_native_staging_scope()
          then source_evidence||jsonb_build_object('stagingOnly',true,'productionApproved',false,'stagingAuthorization',p_payload->>'approvalEvidence')
          else jsonb_set(source_evidence,'{approvalEvidence}',to_jsonb(p_payload->>'approvalEvidence')) end$new$),
    replace(src,$old$set status='published',approved_by=p_actor,published_at=now(),
        source_evidence=jsonb_set(source_evidence,'{approvalEvidence}',to_jsonb(p_payload->>'approvalEvidence'))$old$,''),replace(src,$new$set status=case when public.field_sales_native_staging_scope() then 'staging_only' else 'published' end,
        approved_by=case when public.field_sales_native_staging_scope() then null else p_actor end,
        published_at=case when public.field_sales_native_staging_scope() then null else now() end,
        source_evidence=case when public.field_sales_native_staging_scope()
          then source_evidence||jsonb_build_object('stagingOnly',true,'productionApproved',false,'stagingAuthorization',p_payload->>'approvalEvidence')
          else jsonb_set(source_evidence,'{approvalEvidence}',to_jsonb(p_payload->>'approvalEvidence')) end$new$,''),false);
  src:=replace(result,'',''); execute src;
  src:=pg_get_functiondef('public.field_sales_workflow_bind_mode(uuid,uuid,text)'::regprocedure);
  result:=public.field_sales_staging_patch(src,1,length($old$if p_mode='live' and (not exists$old$),
    replace(src,$old$if p_mode='live' and (not exists$old$,$new$if p_mode='live' and (public.field_sales_native_staging_scope() or not exists$new$),
    replace(src,$old$if p_mode='live' and (not exists$old$,''),replace(src,$new$if p_mode='live' and (public.field_sales_native_staging_scope() or not exists$new$,''),false);
  src:=replace(result,'',''); execute src;
end $upgrade$;
drop function public.field_sales_staging_patch(text,integer,integer,text,text,text,boolean);
revoke all on function public.field_sales_native_staging_scope(),public.field_sales_configuration_usable(text,text) from public,anon,authenticated;
grant execute on function public.field_sales_native_staging_scope(),public.field_sales_configuration_usable(text,text) to service_role;
commit;
