-- Development-only additive administration; no existing prices or publication states are changed.
begin;
create table public.field_sales_catalog_admin_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into public.field_sales_catalog_admin_settings values(true,false);
create function public.field_sales_catalog_admin_access(p_actor uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if public.field_sales_access(p_actor)<>'ADMIN' then
    raise exception 'Administrator required for catalog configuration' using errcode='42501';
  end if;
  perform 1 from public.field_sales_catalog_admin_settings where enabled for share;
  if not found then raise exception 'Catalog administration is disabled' using errcode='55000'; end if;
end $$;
create function public.field_sales_catalog_admin_read(p_actor uuid,p_catalog uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  perform public.field_sales_catalog_admin_access(p_actor);
  if p_catalog is not null and not exists(select 1 from public.field_sales_catalogs where catalog_id=p_catalog) then
    raise exception 'Catalog version not found' using errcode='P0002';
  end if;
  select jsonb_build_object('catalogs',coalesce(jsonb_agg(x.entry),'[]'::jsonb),
    'total',(select count(*) from public.field_sales_catalogs where p_catalog is null or catalog_id=p_catalog)) into result
    from (select to_jsonb(c)||jsonb_build_object('digest',
      encode(sha256(convert_to(c.definition::text,'UTF8')),'hex')) entry
      from public.field_sales_catalogs c where p_catalog is null or c.catalog_id=p_catalog
      order by c.version,c.catalog_id limit 100) x;
  return result;
end $$;
create function public.field_sales_catalog_admin_command(p_actor uuid,p_operation uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous public.field_sales_commands; catalog public.field_sales_catalogs; target uuid;
begin
  perform public.field_sales_catalog_admin_access(p_actor);
  if p_operation is null or jsonb_typeof(p_payload) is distinct from 'object'
    or p_action not in ('create_draft','publish','retire') then
    raise exception 'Explicit catalog action and operation required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('field-sales-command:'||p_operation,0));
  select * into previous from public.field_sales_commands where operation_id=p_operation;
  if found then
    if previous.actor_id<>p_actor or previous.action<>'catalog.'||p_action or previous.payload<>p_payload then
      raise exception 'Operation key reused with changed input' using errcode='40001';
    end if;
    return jsonb_build_object('catalogId',p_payload->>'catalogId','replayed',true);
  end if;
  target:=(p_payload->>'catalogId')::uuid;
  if target is null then raise exception 'Catalog identifier required' using errcode='22023'; end if;
  if p_action='create_draft' then
    if length(coalesce(p_payload->>'version','')) not between 1 and 120
      or jsonb_typeof(p_payload->'definition') is distinct from 'object'
      or jsonb_typeof(p_payload->'sourceEvidence') is distinct from 'object' then
      raise exception 'Draft definition, version and source evidence required' using errcode='22023';
    end if;
    insert into public.field_sales_catalogs(catalog_id,version,definition,source_evidence)
      values(target,p_payload->>'version',p_payload->'definition',p_payload->'sourceEvidence');
  else
    select * into catalog from public.field_sales_catalogs where catalog_id=target for update;
    if not found then raise exception 'Catalog version not found' using errcode='P0002'; end if;
    if p_payload->>'expectedDigest' is distinct from encode(sha256(convert_to(catalog.definition::text,'UTF8')),'hex') then
      raise exception 'Catalog definition changed; reload before approval' using errcode='40001';
    end if;
    if p_action='publish' then
      if catalog.source_evidence->>'stagingOnly'='true' and not public.field_sales_native_staging_scope() then
        raise exception 'Staging catalog cannot become production published' using errcode='42501'; end if;
      if catalog.status<>'draft' or length(coalesce(p_payload->>'approvalEvidence','')) not between 3 and 2000
        or catalog.definition->>'currency'<>'usd'
        or (catalog.definition->>'validForMinutes')::integer not between 1 and 43200
        or catalog.definition->>'validForMinutes' is null
        or jsonb_typeof(catalog.definition->'services') is distinct from 'array'
        or jsonb_array_length(catalog.definition->'services')=0
        or exists(select 1 from jsonb_array_elements(catalog.definition->'services') s
          where jsonb_typeof(s->'markets') is distinct from 'array' or jsonb_array_length(s->'markets')=0) then
        raise exception 'Published catalog requires approved scope, markets, validity and evidence' using errcode='22023';
      end if;
      update public.field_sales_catalogs set status=case when public.field_sales_native_staging_scope() then 'staging_only' else 'published' end,
        approved_by=case when public.field_sales_native_staging_scope() then null else p_actor end,
        published_at=case when public.field_sales_native_staging_scope() then null else now() end,
        source_evidence=case when public.field_sales_native_staging_scope()
          then source_evidence||jsonb_build_object('stagingOnly',true,'productionApproved',false,'stagingAuthorization',p_payload->>'approvalEvidence')
          else jsonb_set(source_evidence,'{approvalEvidence}',to_jsonb(p_payload->>'approvalEvidence')) end
        where catalog_id=target;
    else
      if catalog.status<>'published' then raise exception 'Only a published version may retire' using errcode='22023'; end if;
      update public.field_sales_catalogs set status='retired' where catalog_id=target;
    end if;
  end if;
  insert into public.field_sales_commands(operation_id,actor_id,action,payload)
    values(p_operation,p_actor,'catalog.'||p_action,p_payload);
  return jsonb_build_object('catalogId',target,'replayed',false);
end $$;
alter table public.field_sales_catalog_admin_settings enable row level security;
revoke all on public.field_sales_catalog_admin_settings from public,anon,authenticated,service_role;
grant select on public.field_sales_catalog_admin_settings to service_role;
revoke all on function public.field_sales_catalog_admin_access(uuid),
  public.field_sales_catalog_admin_read(uuid,uuid),public.field_sales_catalog_admin_command(uuid,uuid,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.field_sales_catalog_admin_access(uuid),
  public.field_sales_catalog_admin_read(uuid,uuid),public.field_sales_catalog_admin_command(uuid,uuid,text,jsonb)
  to service_role;
commit;
