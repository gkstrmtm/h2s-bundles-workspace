-- REVIEW ONLY. Additive, UUID-native staging only; does not activate a launch or modify signed evidence.
-- 056 and all historical SC artifacts, acceptance, deadlines and financial policies remain immutable.
begin;
do $$ begin
  if not public.field_sales_native_staging_scope() then
    raise exception '057 requires the verified UUID-owned native sandbox' using errcode='42501';
  end if;
end $$;

alter table public.field_sales_settings add column door_to_door_launch jsonb default null;
create function public.field_sales_nc_launch() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
  select public.field_sales_native_staging_scope() and exists(select 1 from public.field_sales_settings
    where door_to_door_launch='{"enabled":true,"jurisdiction":"NC","municipality":"Charlotte","status":"staging_only","productionApproved":false}'::jsonb)
$$;
create function public.field_sales_nc_settings_guard() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.door_to_door_launch is not null and
    (not public.field_sales_native_staging_scope() or new.door_to_door_launch not in
      ('{"enabled":false}'::jsonb,
       '{"enabled":true,"jurisdiction":"NC","municipality":"Charlotte","status":"staging_only","productionApproved":false}'::jsonb)) then
    raise exception 'Only verified native Charlotte NC staging launch configuration is allowed' using errcode='42501';
  end if;
  return new;
end $$;
create trigger field_sales_nc_settings_guard before insert or update of door_to_door_launch on public.field_sales_settings
  for each row execute function public.field_sales_nc_settings_guard();

create function public.field_sales_nc_territory(p_state text,p_city text,p_channel text) returns boolean
language sql immutable set search_path=pg_catalog,public as $$
  select coalesce(p_state ~ '^[A-Za-z]{2}$' and length(btrim(p_city)) between 1 and 200
    and p_channel in ('door_to_door','other')
    and (p_channel='other' or (upper(p_state)='NC' and lower(btrim(p_city))='charlotte')),false)
$$;
create function public.field_sales_nc_require_lead(p_lead uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare l public.commercial_leads;
begin
  if not public.field_sales_nc_launch() then return; end if;
  select * into l from public.commercial_leads where lead_id=p_lead for update;
  if not found or not public.field_sales_nc_territory(l.project_state,l.project_city,l.attribution->>'salesChannel')
    or upper(l.project_state) is distinct from l.attribution->>'state' then
    raise exception 'Explicit stored state, city and salesChannel required; door-to-door launch is Charlotte NC only'
      using errcode='55000';
  end if;
end $$;
create function public.field_sales_nc_attribution_guard() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if old.attribution ? 'salesChannel' and old.attribution->>'intake'='field_sales' and
    (new.attribution->'salesChannel' is distinct from old.attribution->'salesChannel'
      or new.attribution->'state' is distinct from old.attribution->'state'
      or new.project_state is distinct from old.project_state) then
    raise exception 'Explicit field sale state and channel are immutable; create a separately reviewed opportunity'
      using errcode='42501';
  end if;
  return new;
end $$;
create trigger field_sales_nc_attribution_guard before update on public.commercial_leads
  for each row execute function public.field_sales_nc_attribution_guard();

alter function public.field_sales_command(uuid,uuid,text,jsonb) rename to field_sales_command_pre_nc;
create function public.field_sales_command(p_actor uuid,p_operation uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb; source public.commercial_leads; inquiry uuid; channel text; state text;
begin
  perform public.field_sales_access(p_actor);
  if public.field_sales_nc_launch() then
    if p_action='create' then
      if not public.field_sales_nc_territory(p_payload->>'state',p_payload->>'city',p_payload->>'salesChannel') then
        raise exception 'Explicit state, city and salesChannel required; door-to-door launch is Charlotte NC only'
          using errcode='22023';
      end if;
      state:=upper(p_payload->>'state'); channel:=p_payload->>'salesChannel';
    elsif p_action in ('repeat','attach','save') then
      perform public.field_sales_nc_require_lead((p_payload->>'leadId')::uuid);
      select * into source from public.commercial_leads where lead_id=(p_payload->>'leadId')::uuid;
      state:=source.project_state; channel:=source.attribution->>'salesChannel';
      if (p_payload ? 'state' and upper(p_payload->>'state') is distinct from state)
        or (p_payload ? 'salesChannel' and p_payload->>'salesChannel' is distinct from channel) then
        raise exception 'Repeat/attach cannot reclassify stored sale territory or channel' using errcode='42501';
      end if;
    end if;
  end if;
  result:=public.field_sales_command_pre_nc(p_actor,p_operation,p_action,p_payload);
  inquiry:=(result->>'leadId')::uuid;
  if public.field_sales_nc_launch() and p_action in ('create','repeat','attach') and not coalesce((result->>'replayed')::boolean,false) then
    update public.commercial_leads set project_state=state,
      attribution=attribution||jsonb_build_object('state',state,'salesChannel',channel) where lead_id=inquiry;
  end if;
  if public.field_sales_nc_launch() and p_action in ('create','repeat','attach','save') then
    perform public.field_sales_nc_require_lead(inquiry);
  end if;
  return result;
end $$;

alter function public.field_sales_read(uuid,uuid) rename to field_sales_read_pre_nc;
create function public.field_sales_read(p_actor uuid,p_lead_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare result jsonb; l public.commercial_leads;
begin
  result:=public.field_sales_read_pre_nc(p_actor,p_lead_id);
  result:=result||jsonb_build_object('doorToDoorLaunch',case when public.field_sales_nc_launch()
    then (select door_to_door_launch from public.field_sales_settings) else null end);
  if p_lead_id is not null and result->'lead' is not null then
    select * into l from public.commercial_leads where lead_id=p_lead_id;
    result:=jsonb_set(result,'{lead}',result->'lead'||jsonb_build_object('project_state',l.project_state,'state',l.project_state,
      'attribution',coalesce(result#>'{lead,attribution}','{}')||
        jsonb_build_object('state',l.attribution->'state','salesChannel',l.attribution->'salesChannel')));
  end if;
  return result;
end $$;

create function public.field_sales_signature_protocol(p_protocol text) returns boolean
language sql immutable set search_path=pg_catalog,public as $$
  select coalesce(p_protocol in ('h2s-customer-service-v1','h2s-customer-service-nc-v1'),false)
$$;
-- Voluntary NC customer-protective extension, not a determination of NC statutory "business day".
-- The original SC calendar remains unchanged. The ordinary deadline/hold engine consumes this
-- printed NC calendar and 056's following-midnight adjustment without rewriting any deadline.
alter function public.field_sales_signature_calendar(uuid,timestamptz) rename to field_sales_signature_calendar_pre_nc;
create function public.field_sales_signature_calendar(p_quote uuid,p_from timestamptz) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c jsonb; day date:=(p_from at time zone 'America/New_York')::date;
begin
  if exists(select 1 from public.field_sales_agreements where quote_id=p_quote and accepted_at is not null
      and acceptance->>'protocol'='h2s-customer-service-v1')
    or not exists(select 1 from public.field_sales_workflow_artifacts where quote_id=p_quote and kind='agreement'
      and coalesce(content#>>'{customer_document,protocol}',content->>'protocol')='h2s-customer-service-nc-v1') then
    return public.field_sales_signature_calendar_pre_nc(p_quote,p_from);
  end if;
  select p.definition->'cancellationCalendar' into c from public.field_sales_workflows w
    join public.field_sales_workflow_policies p on p.policy_id=w.legal_policy_id
    where w.quote_id=p_quote and public.field_sales_configuration_usable(p.status,'approved');
  return coalesce(c->>'timezone'='America/New_York' and c->'businessDays'='3'::jsonb
    and c->>'startEvent'='acceptance' and c->>'deadlineLocalTime'='23:59'
    and c->'excludedWeekdays'='[6,7]'::jsonb and jsonb_typeof(c->'holidays')='array'
    and not exists(select 1 from generate_series(extract(year from day)::integer-1,
      extract(year from day)::integer+2) y cross join lateral public.field_sales_signature_holidays(y) h
      where h between make_date(extract(year from day)::integer,1,1)
        and make_date(extract(year from day)::integer+1,12,31)
        and not (c->'holidays' @> jsonb_build_array(h::text))),false);
end $$;
-- The quote customer is server-owned. A policy cannot turn an SC quote into an NC sale.
create function public.field_sales_nc_source(p_quote uuid,p_document jsonb) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare q public.field_sales_quotes; l public.commercial_leads; territory jsonb:=p_document#>'{sale,territory}';
begin
  select * into q from public.field_sales_quotes where quote_id=p_quote;
  select * into l from public.commercial_leads where lead_id=q.lead_id;
  return coalesce(public.field_sales_nc_launch()
    and p_document->>'protocol'='h2s-customer-service-nc-v1'
    and p_document->>'version'='customer-service-nc-v1'
    and p_document#>>'{sale,jurisdiction}'='NC'
    and p_document#>>'{sale,location}'='residence'
    and p_document#>'{sale,personalSolicitation}'='true'::jsonb
    and p_document#>>'{sale,oralPresentationLanguage}'='en'
    and p_document#>>'{sale,cancellationEligibility}'='covered'
    and jsonb_typeof(p_document#>'{sale,oralNoticeEvidence}')='string'
    and length(btrim(p_document#>>'{sale,oralNoticeEvidence}')) between 3 and 40000
    and jsonb_typeof(territory)='object'
    and territory->>'state'='NC' and lower(btrim(territory->>'municipality'))='charlotte'
    and territory->'solicitationAuthorized'='true'::jsonb and territory->'syntheticOnly'='true'::jsonb
    and not exists(select 1 from unnest(array['verifiedAddress','addressEvidence','permitReviewEvidence']) k
      where jsonb_typeof(territory->k) is distinct from 'string' or length(btrim(territory->>k)) not between 3 and 40000)
    and territory->>'verifiedAddress'=q.snapshot#>>'{customer,address}'
    and q.snapshot#>>'{customer,state}'='NC'
    and q.snapshot#>>'{customer,salesChannel}'='door_to_door'
    and lower(btrim(q.snapshot#>>'{customer,city}'))='charlotte'
    and l.project_state='NC' and l.attribution->>'state'='NC'
    and l.attribution->>'salesChannel'='door_to_door'
    and lower(btrim(l.project_city))='charlotte'
    and l.project_address=q.snapshot#>>'{customer,address}',false);
end $$;

-- Transaction-local, exact-count source edits reuse 056's complete evidence normalization.
-- Any upstream drift aborts the entire migration rather than silently dropping a legal guard.
create function public.field_sales_nc_patch(p_source text,p_without text,p_length integer,p_count integer) returns void
language plpgsql set search_path=pg_catalog,public as $$
begin
  if p_count<1 or p_length<1 or (length(p_source)-length(p_without))/p_length<>p_count then
    raise exception '057 reviewed source mismatch';
  end if;
end $$;
do $patch$
declare src text; pair record;
begin
  -- Broaden only protocol predicates; output is selected from the frozen source below.
  for pair in select * from (values
    ('public.field_sales_workflow_deadline(uuid,timestamp with time zone)'::regprocedure,1,0,1),
    ('public.field_sales_workflow_document_gate(uuid,boolean)'::regprocedure,2,1,0),
    ('public.field_sales_signature_normalize(uuid,jsonb)'::regprocedure,1,1,0),
    ('public.field_sales_customer_agreement_pre_signature(text,jsonb)'::regprocedure,0,1,0),
    ('public.field_sales_customer_agreement(text,jsonb)'::regprocedure,1,3,0),
    ('public.field_sales_customer_signature_context(text)'::regprocedure,1,0,0)
  ) x(signature,source_count,accepted_count,distinct_count) loop
    src:=pg_get_functiondef(pair.signature);
    if pair.source_count>0 then
      perform public.field_sales_nc_patch(src,
        replace(src,'coalesce(content#>>''{customer_document,protocol}'',content->>''protocol'')=''h2s-customer-service-v1''',''),
        length('coalesce(content#>>''{customer_document,protocol}'',content->>''protocol'')=''h2s-customer-service-v1'''),pair.source_count);
      src:=replace(src,'coalesce(content#>>''{customer_document,protocol}'',content->>''protocol'')=''h2s-customer-service-v1''',
        'public.field_sales_signature_protocol(coalesce(content#>>''{customer_document,protocol}'',content->>''protocol''))');
    end if;
    if pair.accepted_count>0 then
      perform public.field_sales_nc_patch(src,replace(src,'a.acceptance->>''protocol''=''h2s-customer-service-v1''',''),
        length('a.acceptance->>''protocol''=''h2s-customer-service-v1'''),pair.accepted_count);
      src:=replace(src,'a.acceptance->>''protocol''=''h2s-customer-service-v1''',
        'public.field_sales_signature_protocol(a.acceptance->>''protocol'')');
    end if;
    if pair.distinct_count>0 then
      perform public.field_sales_nc_patch(src,replace(src,'acceptance->>''protocol'' is distinct from ''h2s-customer-service-v1''',''),
        length('acceptance->>''protocol'' is distinct from ''h2s-customer-service-v1'''),pair.distinct_count);
      src:=replace(src,'acceptance->>''protocol'' is distinct from ''h2s-customer-service-v1''',
        'not public.field_sales_signature_protocol(acceptance->>''protocol'')');
    end if;
    execute src;
  end loop;
  -- The context uses a qualified acceptance reference.
  src:=pg_get_functiondef('public.field_sales_customer_signature_context(text)'::regprocedure);
  perform public.field_sales_nc_patch(src,
    replace(src,'a.acceptance->>''protocol'' is distinct from ''h2s-customer-service-v1''',''),
    length('a.acceptance->>''protocol'' is distinct from ''h2s-customer-service-v1'''),1);
  src:=replace(src,
    'a.acceptance->>''protocol'' is distinct from ''h2s-customer-service-v1''',
    'not public.field_sales_signature_protocol(a.acceptance->>''protocol'')');
  execute src;
  src:=pg_get_functiondef('public.field_sales_workflow_document_gate(uuid,boolean)'::regprocedure);
  perform public.field_sales_nc_patch(src,replace(src,'field_sales_signature_calendar(p_quote,now())',''),
    length('field_sales_signature_calendar(p_quote,now())'),1);
  src:=replace(src,
    'field_sales_signature_calendar(p_quote,now())',
    'field_sales_nc_source(p_quote,source) and public.field_sales_signature_calendar(p_quote,now())');
  execute src;
  src:=pg_get_functiondef('public.field_sales_signature_normalize(uuid,jsonb)'::regprocedure);
  perform public.field_sales_nc_patch(src,replace(src,'protocol_source->>''version'' is distinct from ''customer-service-v1''',''),
    length('protocol_source->>''version'' is distinct from ''customer-service-v1'''),1);
  src:=replace(src,'protocol_source->>''version'' is distinct from ''customer-service-v1''',
    'not public.field_sales_nc_source(p_quote,protocol_source)');
  perform public.field_sales_nc_patch(src,replace(src,'protocol_source#>>''{sale,jurisdiction}'' is distinct from ''SC''',''),
    length('protocol_source#>>''{sale,jurisdiction}'' is distinct from ''SC'''),1);
  src:=replace(src,'protocol_source#>>''{sale,jurisdiction}'' is distinct from ''SC''',
    'protocol_source#>>''{sale,jurisdiction}'' is distinct from ''NC''');
  perform public.field_sales_nc_patch(src,replace(src,'Approved covered South Carolina service agreement and seller identity required',''),
    length('Approved covered South Carolina service agreement and seller identity required'),1);
  src:=replace(src,'Approved covered South Carolina service agreement and seller identity required',
    'Approved covered Charlotte NC service agreement, territory review and seller identity required');
  perform public.field_sales_nc_patch(src,
    replace(src,'coalesce(f.content#>>''{customer_document,protocol}'',f.content->>''protocol'')=''h2s-customer-service-v1''',''),
    length('coalesce(f.content#>>''{customer_document,protocol}'',f.content->>''protocol'')=''h2s-customer-service-v1'''),1);
  src:=replace(src,
    'coalesce(f.content#>>''{customer_document,protocol}'',f.content->>''protocol'')=''h2s-customer-service-v1''',
    'coalesce(f.content#>>''{customer_document,protocol}'',f.content->>''protocol'')=protocol_source->>''protocol''');
  perform public.field_sales_nc_patch(src,replace(src,'f.content->>''version''=''sc-ftc-cancellation-v1''',''),
    length('f.content->>''version''=''sc-ftc-cancellation-v1'''),1);
  src:=replace(src,'f.content->>''version''=''sc-ftc-cancellation-v1''','f.content->>''version''=''nc-ftc-cancellation-v1''');
  perform public.field_sales_nc_patch(src,replace(src,'''protocol'',''h2s-customer-service-v1''',''),
    length('''protocol'',''h2s-customer-service-v1'''),2);
  src:=replace(src,'''protocol'',''h2s-customer-service-v1''','''protocol'',protocol_source->>''protocol''');
  perform public.field_sales_nc_patch(src,
    replace(src,$old$'<footer data-h2s-signature-evidence="h2s-customer-service-v1"><p>Electronically signed by '$old$,''),
    length($old$'<footer data-h2s-signature-evidence="h2s-customer-service-v1"><p>Electronically signed by '$old$),1);
  src:=replace(src,
    $old$'<footer data-h2s-signature-evidence="h2s-customer-service-v1"><p>Electronically signed by '$old$,
    $new$'<footer data-h2s-signature-evidence="'||(protocol_source->>'protocol')||'"><p>Electronically signed by '$new$);
  execute src;
  src:=pg_get_functiondef('public.field_sales_signature_admission()'::regprocedure);
  perform public.field_sales_nc_patch(src,replace(src,'new.acceptance->>''protocol'' is distinct from ''h2s-customer-service-v1''',''),
    length('new.acceptance->>''protocol'' is distinct from ''h2s-customer-service-v1'''),1);
  src:=replace(src,
    'new.acceptance->>''protocol'' is distinct from ''h2s-customer-service-v1''',
    'new.acceptance->>''protocol'' is distinct from ''h2s-customer-service-nc-v1'' or not public.field_sales_nc_source(new.quote_id,
      (select coalesce(content->''customer_document'',content) from public.field_sales_workflow_artifacts
        where quote_id=new.quote_id and kind=''agreement'' and not (content ? ''operationId'' and content ? ''signedAt'')))');
  execute src;
  src:=pg_get_functiondef('public.field_sales_transaction_command_legacy(uuid,uuid,uuid,text,jsonb)'::regprocedure);
  perform public.field_sales_nc_patch(src,replace(src,'''city'',l.project_city,''state'',l.project_state,',''),
    length('''city'',l.project_city,''state'',l.project_state,'),1);
  src:=replace(src,
    '''city'',l.project_city,''state'',l.project_state,',
    '''city'',l.project_city,''state'',l.project_state,''salesChannel'',l.attribution->>''salesChannel'',');
  execute src;
end $patch$;
drop function public.field_sales_nc_patch(text,text,integer,integer);

alter function public.field_sales_transaction_command(uuid,uuid,uuid,text,jsonb) rename to field_sales_transaction_command_pre_nc;
create function public.field_sales_transaction_command(p_actor uuid,p_operation uuid,p_lead uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_action in ('quote','submit','approve','agreement') and not
    (p_action='agreement' and exists(select 1 from public.field_sales_agreements
      where quote_id=(p_payload->>'quoteId')::uuid and accepted_at is not null)) then
    perform public.field_sales_nc_require_lead(p_lead);
  end if;
  return public.field_sales_transaction_command_pre_nc(p_actor,p_operation,p_lead,p_action,p_payload);
end $$;
alter function public.field_sales_workflow_command(uuid,uuid,uuid,uuid,integer,text,jsonb) rename to field_sales_workflow_command_pre_nc;
create function public.field_sales_workflow_command(p_actor uuid,p_operation uuid,p_lead uuid,p_quote uuid,p_revision integer,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_action in ('enroll','documents_publish','preparation') and not exists(
    select 1 from public.field_sales_agreements where quote_id=p_quote and accepted_at is not null) then
    perform public.field_sales_nc_require_lead(p_lead);
  end if;
  return public.field_sales_workflow_command_pre_nc(p_actor,p_operation,p_lead,p_quote,p_revision,p_action,p_payload);
end $$;

alter function public.field_sales_reserve_checkout(uuid,uuid,uuid,uuid,text) rename to field_sales_reserve_checkout_pre_nc;
create function public.field_sales_reserve_checkout(p_actor uuid,p_operation uuid,p_lead uuid,p_quote uuid,p_kind text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if p_kind is distinct from 'balance' and exists(select 1 from public.field_sales_agreements
    where quote_id=p_quote and accepted_at is not null and acceptance->>'protocol'='h2s-customer-service-v1')
    and not exists(select 1 from public.field_sales_checkouts
      where checkout_id=p_operation and quote_id=p_quote and lead_id=p_lead and created_by=p_actor and kind=p_kind) then
    raise exception 'Previously accepted SC protocol allows existing checkout retries and balances only' using errcode='55000';
  end if;
  return public.field_sales_reserve_checkout_pre_nc(p_actor,p_operation,p_lead,p_quote,p_kind);
end $$;

-- SQL authorization retains the original role-only contract. The public RPC additionally
-- returns launch metadata so paginated API listings do not need a recursive detail read.
alter function public.field_sales_access(uuid) rename to field_sales_access_role_pre_nc;
do $access$
declare f regprocedure; src text; occurrences integer;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and position('field_sales_access(' in p.prosrc)>0 loop
    src:=pg_get_functiondef(f);
    occurrences:=(length(src)-length(replace(src,'field_sales_access(','')))/length('field_sales_access(');
    if occurrences<1 then raise exception '057 authorization caller source differs: %',f; end if;
    src:=replace(src,'field_sales_access(','field_sales_access_role_pre_nc(');
    if position('field_sales_access(' in src)>0
      or (length(src)-length(replace(src,'field_sales_access_role_pre_nc(','')))/
        length('field_sales_access_role_pre_nc(')<occurrences then
      raise exception '057 authorization caller rewrite incomplete: %',f;
    end if;
    execute src;
  end loop;
end $access$;
create function public.field_sales_access(p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare actor_role text;
begin
  actor_role:=public.field_sales_access_role_pre_nc(p_actor);
  return jsonb_build_object('role',actor_role,'doorToDoorLaunch',case when public.field_sales_nc_launch()
    then (select door_to_door_launch from public.field_sales_settings) else null end);
end $$;

-- Keep every renamed historical RPC private. Owners can reuse internals; clients cannot bypass wrappers.
do $permissions$
declare f record;
begin
  for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and (p.proname like 'field_sales_nc_%' or p.proname like 'field_sales_signature_%'
      or p.proname like 'field_sales_access%'
      or p.proname like 'field_sales_command%' or p.proname like 'field_sales_read%'
      or p.proname like 'field_sales_transaction_command%' or p.proname like 'field_sales_workflow_command%'
      or p.proname like 'field_sales_reserve_checkout%'
      or p.proname like 'field_sales_customer_agreement%' or p.proname like 'field_sales_customer_signature_context%'
      or p.proname like 'field_sales_workflow_document_gate%' or p.proname like 'field_sales_workflow_deadline%') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
    if f.proname in ('field_sales_access','field_sales_command','field_sales_read','field_sales_transaction_command','field_sales_workflow_command',
      'field_sales_customer_agreement','field_sales_customer_signature_context','field_sales_workflow_document_gate','field_sales_workflow_deadline',
      'field_sales_reserve_checkout') then
      execute format('grant execute on function %s to service_role',f.signature);
    end if;
  end loop;
end $permissions$;
commit;
