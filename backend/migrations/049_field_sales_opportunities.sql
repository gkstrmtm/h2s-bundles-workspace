-- REVIEW ONLY. Requires 043/045; compatible with 044/046-048. No activation.
begin;
alter table public.field_sales_opportunities
  add column customer_id uuid references public.commercial_leads(lead_id);
update public.field_sales_opportunities set customer_id=lead_id;
alter table public.field_sales_opportunities alter column customer_id set not null;
create index field_sales_customer_history on public.field_sales_opportunities(customer_id,created_at desc,lead_id);
create index field_sales_owner_history on public.field_sales_opportunities(owner_user_id,created_at desc,lead_id);
create index field_sales_history on public.field_sales_opportunities(created_at desc,lead_id);
create index field_sales_follow_up on public.commercial_lead_operations(next_follow_up_at,lead_id)
  where next_follow_up_at is not null;
alter table public.commercial_leads add column field_sales_search tsvector generated always as
  (to_tsvector('simple',coalesce(full_name,'')||' '||coalesce(phone,'')||' '||
    right(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),10)||' '||
    coalesce(project_address,'')||' '||coalesce(project_city,''))) stored;
create index field_sales_customer_search on public.commercial_leads using gin(field_sales_search);

create function public.field_sales_customer_identity() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_op='INSERT' then
    new.customer_id:=coalesce(new.customer_id,new.lead_id);
    if new.customer_id<>new.lead_id and not exists(select 1 from public.field_sales_opportunities
      where lead_id=new.customer_id and customer_id=lead_id) then
      raise exception 'Exact canonical customer required' using errcode='22023';
    end if;
  elsif new.customer_id is distinct from old.customer_id then
    raise exception 'Customer identity is immutable; no automatic merging' using errcode='42501';
  end if;
  return new;
end $$;
create trigger field_sales_customer_identity before insert or update on public.field_sales_opportunities
  for each row execute function public.field_sales_customer_identity();

alter function public.field_sales_command(uuid,uuid,text,jsonb) rename to field_sales_command_before_repeat;
create function public.field_sales_command(p_actor uuid,p_operation uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text; source public.field_sales_opportunities; customer public.commercial_leads;
  previous public.field_sales_commands; owner_id uuid; inquiry uuid; labels jsonb; svc public.field_sales_services; item text;
begin
  if p_action<>'repeat' then return public.field_sales_command_before_repeat(p_actor,p_operation,p_action,p_payload); end if;
  r:=public.field_sales_access(p_actor);
  if p_operation is null or length(btrim(coalesce(p_payload->>'evidence',''))) not between 3 and 2000 then
    raise exception 'Explicit verified customer relationship and operation required' using errcode='22023'; end if;
  select * into source from public.field_sales_opportunities where lead_id=(p_payload->>'leadId')::uuid for share;
  if not found or (r<>'ADMIN' and source.owner_user_id<>p_actor) then
    raise exception 'Customer not found or not assigned' using errcode='P0002'; end if;
  select * into customer from public.commercial_leads where lead_id=source.customer_id for update;
  perform pg_advisory_xact_lock(hashtextextended('field-sales-command:'||p_operation,0));
  select * into previous from public.field_sales_commands where operation_id=p_operation;
  if found then
    if previous.actor_id<>p_actor or previous.action<>'repeat' or previous.payload<>p_payload then
      raise exception 'Operation key reused with changed input' using errcode='40001'; end if;
    perform public.field_sales_read(p_actor,previous.lead_id);
    return jsonb_build_object('leadId',previous.lead_id,'customerId',source.customer_id,'replayed',true);
  end if;
  owner_id:=(p_payload->>'ownerId')::uuid;
  if r<>'ADMIN' and owner_id<>p_actor then raise exception 'Own opportunities only' using errcode='42501'; end if;
  if not exists(select 1 from public.field_sales_representatives f join public."Dashboard_Users" u on u."User_ID"=f.user_id
    where f.user_id=owner_id and f.active and u."Role"='SALES' and not u."Is_Disabled") then
    raise exception 'Active representative required' using errcode='22023'; end if;
  if jsonb_typeof(p_payload->'services') is distinct from 'array' or jsonb_array_length(p_payload->'services') not between 1 and 20 then
    raise exception 'Service selection required' using errcode='22023'; end if;
  for item in select jsonb_array_elements_text(p_payload->'services') loop
    select * into svc from public.field_sales_services where service_id=item and enabled;
    if not found or not (svc.definition->'markets' ? coalesce(customer.attribution->>'market','commercial'))
      or (p_payload#>>array['assessments',item,'version'])::integer is distinct from svc.version then
      raise exception 'Service definition changed; reload' using errcode='40001'; end if;
  end loop;
  select jsonb_agg(distinct definition->>'queueLabel') into labels from public.field_sales_services
    where p_payload->'services' ? service_id;
  -- commercial_leads is the existing inquiry/work ledger, not a second customer registry.
  -- The new inquiry retains its own address/activity/fulfillment contracts and points to one customer.
  insert into public.commercial_leads(public_token,full_name,phone,project_address,project_city,service_needs,attribution,notes,contact_preference)
    values(gen_random_uuid()::text||gen_random_uuid()::text,customer.full_name,customer.phone,
      customer.project_address,customer.project_city,labels,
      jsonb_build_object('market',coalesce(customer.attribution->>'market','commercial'),'intake','field_sales',
        'customer_id',source.customer_id,'repeat_of',source.lead_id),p_payload->>'notes','call')
    returning lead_id into inquiry;
  insert into public.field_sales_opportunities(lead_id,customer_id,owner_user_id,services,assessments,notes,created_by,revision)
    values(inquiry,source.customer_id,owner_id,p_payload->'services',p_payload->'assessments',coalesce(p_payload->>'notes',''),p_actor,1);
  insert into public.commercial_lead_operations(lead_id,revision,next_follow_up_at)
    values(inquiry,1,(p_payload->>'followUpAt')::timestamptz);
  insert into public.commercial_lead_activity(operation_id,lead_id,revision,actor_id,actor_name,action,payload)
    select p_operation,inquiry,1,p_actor::text,"Display_Name",'field_sales.repeat',
      (p_payload-'assessments')||jsonb_build_object('customerId',source.customer_id)
      from public."Dashboard_Users" where "User_ID"=p_actor;
  insert into public.field_sales_commands(operation_id,actor_id,lead_id,action,payload)
    values(p_operation,p_actor,inquiry,'repeat',p_payload);
  return jsonb_build_object('leadId',inquiry,'customerId',source.customer_id,'replayed',false);
end $$;

alter function public.field_sales_read(uuid,uuid) rename to field_sales_read_before_customer;
create function public.field_sales_read(p_actor uuid,p_lead_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  result:=public.field_sales_read_before_customer(p_actor,p_lead_id);
  if p_lead_id is not null then
    result:=jsonb_set(result,'{lead,customer_id}',to_jsonb((select customer_id from public.field_sales_opportunities where lead_id=p_lead_id)));
  end if;
  return result;
end $$;

create function public.field_sales_page(p_actor uuid,p_search text,p_owner uuid,p_customer uuid,p_due boolean,
  p_limit integer,p_after timestamptz,p_after_id uuid,p_as_of timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text; rows jsonb; total bigint; summary jsonb; more boolean; cursor jsonb; reps jsonb; search_query tsquery;
begin
  r:=public.field_sales_access(p_actor);
  if p_limit is null or p_limit not between 1 and 100 or length(coalesce(p_search,''))>120
    or p_due is null or p_as_of is null or (p_after is null)<>(p_after_id is null) then
    raise exception 'Valid bounded page and cursor required' using errcode='22023'; end if;
  if r<>'ADMIN' and p_owner is not null and p_owner<>p_actor then
    raise exception 'Own opportunities only' using errcode='42501'; end if;
  if p_customer is not null and not exists(select 1 from public.field_sales_opportunities
    where customer_id=p_customer and (r='ADMIN' or owner_user_id=p_actor)) then
    raise exception 'Customer not found or not assigned' using errcode='P0002'; end if;
  select to_tsquery('simple',string_agg(quote_literal(token[1])||':*',' & ')) into search_query
    from regexp_matches(lower(coalesce(p_search,'')),'[[:alnum:]]+','g') token;
  with authorized as (
    select o.*,l.full_name,l.phone,l.project_address,l.project_city,coalesce(l.attribution->>'market','commercial') market,
      q.next_follow_up_at
    from public.field_sales_opportunities o join public.commercial_leads l using(lead_id)
    left join public.commercial_lead_operations q using(lead_id)
    where (r='ADMIN' or o.owner_user_id=p_actor) and (p_owner is null or o.owner_user_id=p_owner)
      and (p_customer is null or o.customer_id=p_customer)
      and (coalesce(p_search,'')='' or l.field_sales_search @@ search_query)
  ), filtered as (
    select * from authorized where not p_due or (status<>'closed' and next_follow_up_at<=p_as_of)
  ), page as (
    select * from filtered where p_after is null
      or (p_due and (next_follow_up_at>p_after or (next_follow_up_at=p_after and lead_id>p_after_id)))
      or (not p_due and (created_at<p_after or (created_at=p_after and lead_id>p_after_id)))
    order by case when p_due then next_follow_up_at end asc,case when not p_due then created_at end desc,lead_id
    limit p_limit+1
  ), numbered as (
    select *,row_number() over(order by case when p_due then next_follow_up_at end asc,
      case when not p_due then created_at end desc,lead_id) position from page
  )
  select (select count(*) from filtered),
    (select jsonb_build_object('active',count(*) filter(where status<>'closed'),
      'due',count(*) filter(where status<>'closed' and next_follow_up_at<=p_as_of),
      'upcoming',count(*) filter(where status<>'closed' and next_follow_up_at>p_as_of and next_follow_up_at<=p_as_of+interval '24 hours'),
      'awaitingReview',count(*) filter(where status='ready_for_review')) from authorized),
    coalesce(jsonb_agg(jsonb_build_object('lead_id',lead_id,'customer_id',customer_id,'owner_user_id',owner_user_id,
      'originating_user_id',originating_user_id,'created_by',created_by,'revision',revision,'status',status,'services',services,
      'full_name',full_name,'phone',phone,'address',project_address,'market',market,'created_at',created_at,
      'follow_up_at',next_follow_up_at) order by position) filter(where position<=p_limit),'[]'),
    coalesce(bool_or(position>p_limit),false),
    (jsonb_agg(jsonb_build_object('at',case when p_due then next_follow_up_at else created_at end,'id',lead_id)
      order by position desc) filter(where position<=p_limit))->0
    into total,summary,rows,more,cursor from numbered;
  select coalesce(jsonb_agg(jsonb_build_object('user_id',f.user_id,'display_name',u."Display_Name",'username',u."Username",
    'active',f.active and not u."Is_Disabled",'commission_start_date',f.commission_start_date,
    'commission_start_evidence',f.commission_start_evidence,'commission_terms_revision',f.commission_terms_revision)
    order by u."Display_Name",f.user_id),'[]') into reps
    from public.field_sales_representatives f join public."Dashboard_Users" u on u."User_ID"=f.user_id
    where r='ADMIN';
  return jsonb_build_object('opportunities',rows,'total',total,'summary',summary,'representatives',reps,
    'nextCursor',case when more then cursor end,'asOf',p_as_of,
    'commissionProfile',(select jsonb_build_object('commission_start_date',commission_start_date,
      'commission_start_evidence',commission_start_evidence,'commission_terms_revision',commission_terms_revision)
      from public.field_sales_representatives where user_id=p_actor));
end $$;
revoke all on function public.field_sales_customer_identity() from public,anon,authenticated,service_role;
revoke all on function public.field_sales_command_before_repeat(uuid,uuid,text,jsonb),
  public.field_sales_read_before_customer(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.field_sales_command(uuid,uuid,text,jsonb),public.field_sales_read(uuid,uuid),
  public.field_sales_page(uuid,text,uuid,uuid,boolean,integer,timestamptz,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.field_sales_command(uuid,uuid,text,jsonb),public.field_sales_read(uuid,uuid),
  public.field_sales_page(uuid,text,uuid,uuid,boolean,integer,timestamptz,uuid,timestamptz) to service_role;
commit;
