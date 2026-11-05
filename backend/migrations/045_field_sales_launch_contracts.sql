-- Additive development contract. Apply only to an explicitly authorized isolated/production target.
-- Existing origins remain unknown; no accounts, catalog or activation settings are changed.
begin;
alter table public.field_sales_opportunities
  add column originating_user_id uuid references public.field_sales_representatives(user_id);
alter table public.field_sales_representatives
  add column commission_start_date date,
  add column commission_start_evidence text,
  add column commission_terms_revision integer not null default 0,
  add column commission_terms_set_by uuid references public."Dashboard_Users"("User_ID"),
  add column commission_terms_set_at timestamptz,
  add constraint field_sales_start_evidence check(commission_start_date is null
    or (coalesce(length(commission_start_evidence),0) between 3 and 2000
      and commission_terms_set_by is not null and commission_terms_set_at is not null));

create function public.field_sales_freeze_origin() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='INSERT' then
    new.originating_user_id:=new.owner_user_id;
    return new;
  end if;
  if tg_op='DELETE' then
    if old.originating_user_id is not null then
      raise exception 'Original lead identity is retained; close the opportunity instead' using errcode='42501';
    end if;
    return old;
  end if;
  if new.originating_user_id is distinct from old.originating_user_id
    or (old.originating_user_id is not null and
      (new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
        or new.lead_id is distinct from old.lead_id)) then
    raise exception 'Original lead and representative identities are immutable' using errcode='42501';
  end if;
  return new;
end $$;
create trigger field_sales_origin before insert or update or delete on public.field_sales_opportunities
  for each row execute function public.field_sales_freeze_origin();

alter function public.field_sales_read(uuid,uuid) rename to field_sales_read_before_launch;
create function public.field_sales_read(p_actor uuid,p_lead_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text; result jsonb; enriched jsonb;
begin
  r:=public.field_sales_access(p_actor);
  result:=public.field_sales_read_before_launch(p_actor,p_lead_id);
  if p_lead_id is null then
    select coalesce(jsonb_agg(x.entry||jsonb_build_object('originating_user_id',o.originating_user_id,
      'created_by',o.created_by) order by x.position),'[]'::jsonb) into enriched
      from jsonb_array_elements(result->'opportunities') with ordinality x(entry,position)
      join public.field_sales_opportunities o on o.lead_id=(x.entry->>'lead_id')::uuid;
    result:=jsonb_set(result,'{opportunities}',enriched);
    if r='ADMIN' then
      select coalesce(jsonb_agg(x.entry||jsonb_build_object(
        'commission_start_date',f.commission_start_date,'commission_start_evidence',f.commission_start_evidence,
        'commission_terms_revision',f.commission_terms_revision,
        'commission_terms_set_by',f.commission_terms_set_by,'commission_terms_set_at',f.commission_terms_set_at)
        order by x.position),'[]'::jsonb) into enriched
        from jsonb_array_elements(result->'representatives') with ordinality x(entry,position)
        join public.field_sales_representatives f on f.user_id=(x.entry->>'user_id')::uuid;
      result:=jsonb_set(result,'{representatives}',enriched);
    end if;
  end if;
  if r='SALES' then
    result:=result||jsonb_build_object('commissionProfile',(select jsonb_build_object(
      'commission_start_date',commission_start_date,'commission_start_evidence',commission_start_evidence,
      'commission_terms_revision',commission_terms_revision)
      from public.field_sales_representatives where user_id=p_actor));
  end if;
  return result;
end $$;

create function public.field_sales_identity_command(p_actor uuid,p_operation uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous public.field_sales_commands; target uuid; profile public.field_sales_representatives;
  start_date date; evidence text; expected_revision integer;
begin
  if public.field_sales_access(p_actor)<>'ADMIN' then
    raise exception 'Administrator required for compensation identity evidence' using errcode='42501';
  end if;
  if p_operation is null or jsonb_typeof(p_payload) is distinct from 'object'
    or not(p_payload ?& array['userId','commissionStartDate','commissionStartEvidence','termsRevision']) then
    raise exception 'Explicit representative terms and operation required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('field-sales-command:'||p_operation,0));
  select * into previous from public.field_sales_commands where operation_id=p_operation;
  if found then
    if previous.actor_id<>p_actor or previous.action<>'representative_terms' or previous.payload<>p_payload then
      raise exception 'Operation key reused with changed input' using errcode='40001';
    end if;
    return jsonb_build_object('replayed',true,'userId',p_payload->>'userId');
  end if;
  target:=(p_payload->>'userId')::uuid;
  evidence:=p_payload->>'commissionStartEvidence';
  expected_revision:=(p_payload->>'termsRevision')::integer;
  if expected_revision is null or expected_revision<0 or length(coalesce(evidence,'')) not between 3 and 2000
    or (p_payload->>'commissionStartDate' is not null
      and (p_payload->>'commissionStartDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or ((p_payload->>'commissionStartDate')::date)::text<>p_payload->>'commissionStartDate')) then
    raise exception 'Valid date or explicit unknown, evidence and revision required' using errcode='22023';
  end if;
  start_date:=(p_payload->>'commissionStartDate')::date;
  perform 1 from public."Dashboard_Users" where "User_ID"=target and "Role"='SALES' for share;
  if not found then raise exception 'Sales representative not found' using errcode='P0002'; end if;
  select * into profile from public.field_sales_representatives where user_id=target for update;
  if not found then raise exception 'Sales representative not found' using errcode='P0002'; end if;
  if profile.commission_terms_revision<>expected_revision then
    raise exception 'Representative terms changed; reload' using errcode='40001';
  end if;
  update public.field_sales_representatives set commission_start_date=start_date,commission_start_evidence=evidence,
    commission_terms_revision=commission_terms_revision+1,commission_terms_set_by=p_actor,
    commission_terms_set_at=now(),updated_at=now() where user_id=target;
  insert into public.field_sales_commands(operation_id,actor_id,action,payload)
    values(p_operation,p_actor,'representative_terms',p_payload);
  return jsonb_build_object('replayed',false,'userId',target,'termsRevision',expected_revision+1);
end $$;
revoke all on function public.field_sales_freeze_origin() from public,anon,authenticated,service_role;
revoke all on function public.field_sales_read(uuid,uuid),
  public.field_sales_identity_command(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.field_sales_read(uuid,uuid),
  public.field_sales_identity_command(uuid,uuid,jsonb) to service_role;
commit;
