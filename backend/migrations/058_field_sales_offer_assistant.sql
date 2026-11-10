-- REVIEW ONLY. Apply to the verified isolated staging namespace, not production.
begin;
create table public.field_sales_offer_discoveries (
  lead_id uuid not null references public.field_sales_opportunities(lead_id),
  revision integer not null check(revision > 0),
  operation_id uuid not null unique references public.field_sales_commands(operation_id),
  actor_id uuid not null references public."Dashboard_Users"("User_ID"),
  document jsonb not null check(jsonb_typeof(document)='object' and octet_length(document::text)<=65536),
  created_at timestamptz not null default now(),
  primary key(lead_id,revision)
);
create index field_sales_offer_reference_usage on public.field_sales_commands(actor_id,created_at)
where action in ('offer.ask','offer.knowledge');
create function public.field_sales_offer_immutable() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  raise exception 'Discovery revisions are immutable; append a new revision' using errcode='40001';
end $$;
create trigger field_sales_offer_immutable before update or delete on public.field_sales_offer_discoveries
for each row execute function public.field_sales_offer_immutable();
alter table public.field_sales_offer_discoveries enable row level security;
revoke all on public.field_sales_offer_discoveries from public,anon,authenticated;

create function public.field_sales_offer_read(p_actor uuid,p_lead uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform public.field_sales_read(p_actor,p_lead);
  if p_lead is null then raise exception 'Exact owned opportunity required' using errcode='22023'; end if;
  return jsonb_build_object(
    'discovery',(select to_jsonb(d) from public.field_sales_offer_discoveries d where lead_id=p_lead order by revision desc limit 1),
    'history',(select coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) from
      (select revision,created_at,actor_id,document from public.field_sales_offer_discoveries where lead_id=p_lead order by revision desc limit 10) h)
  );
end $$;

create function public.field_sales_offer_save(p_actor uuid,p_operation uuid,p_lead uuid,p_revision integer,p_document jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare current_revision integer; previous public.field_sales_commands; catalog public.field_sales_catalogs; event text;
begin
  perform public.field_sales_read(p_actor,p_lead);
  if p_lead is null or p_revision is null or p_revision<0 or p_revision>=2147483646
    or jsonb_typeof(p_document) is distinct from 'object' or octet_length(p_document::text)>65536
    or p_document->'answers'->>'schemaVersion' is distinct from '1'
    or coalesce(p_document->>'knowledgeHash','') !~ '^[a-f0-9]{64}$'
    or coalesce(p_document->>'stage','') not in ('progress','recommendation')
    or jsonb_typeof(p_document->'recommendation') is distinct from 'object' then
    raise exception 'Validated versioned discovery required' using errcode='22023';
  end if;
  perform 1 from public.field_sales_opportunities where lead_id=p_lead and status<>'closed' for update;
  if not found then raise exception 'Open owned opportunity required' using errcode='42501'; end if;
  perform public.field_sales_read(p_actor,p_lead);
  perform pg_advisory_xact_lock(hashtextextended('field-sales-command:'||p_operation,0));
  select * into previous from public.field_sales_commands where operation_id=p_operation;
  if found then
    if previous.actor_id<>p_actor or previous.lead_id<>p_lead or previous.action not in ('offer.started','offer.progress','offer.recommended')
      or previous.payload<>jsonb_build_object('revision',p_revision,'document',p_document) then
      raise exception 'Operation key reused with changed discovery' using errcode='40001';
    end if;
    if (select max(revision) from public.field_sales_offer_discoveries where lead_id=p_lead)<>p_revision+1 then
      raise exception 'Another revision followed this interrupted save; reload the current copy' using errcode='40001';
    end if;
    return public.field_sales_offer_read(p_actor,p_lead)||jsonb_build_object('replayed',true);
  end if;
  select coalesce(max(revision),0) into current_revision from public.field_sales_offer_discoveries where lead_id=p_lead;
  if current_revision<>p_revision then raise exception 'Discovery changed; reload the saved revision' using errcode='40001'; end if;
  if p_document->'answers'->>'catalogId' is not null then
    select * into catalog from public.field_sales_catalogs where catalog_id=(p_document->'answers'->>'catalogId')::uuid for share;
    if not found or catalog.status='retired'
      or encode(sha256(convert_to(catalog.definition::text,'UTF8')),'hex')<>p_document->'recommendation'->>'catalogHash' then
      raise exception 'Catalog changed; reload and recompute recommendations' using errcode='40001';
    end if;
  end if;
  event:=case when p_document->>'stage'='recommendation' then 'offer.recommended' when current_revision=0 then 'offer.started' else 'offer.progress' end;
  insert into public.field_sales_commands(operation_id,actor_id,lead_id,action,payload)
    values(p_operation,p_actor,p_lead,event,jsonb_build_object('revision',p_revision,'document',p_document));
  insert into public.field_sales_offer_discoveries(lead_id,revision,operation_id,actor_id,document)
    values(p_lead,current_revision+1,p_operation,p_actor,p_document);
  return public.field_sales_offer_read(p_actor,p_lead);
end $$;

create function public.field_sales_offer_quote(p_actor uuid,p_operation uuid,p_lead uuid,p_revision integer,p_knowledge_hash text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare saved public.field_sales_offer_discoveries; result jsonb; replay boolean;
begin
  perform public.field_sales_read(p_actor,p_lead);
  perform 1 from public.field_sales_opportunities where lead_id=p_lead for update;
  perform public.field_sales_read(p_actor,p_lead);
  select * into saved from public.field_sales_offer_discoveries where lead_id=p_lead order by revision desc limit 1;
  if not found or saved.revision<>p_revision or saved.document->>'knowledgeHash'<>p_knowledge_hash
    or saved.document->'recommendation'->>'canCreateQuote' is distinct from 'true'
    or saved.document->'answers'->>'catalogId' is distinct from p_payload->>'catalogId'
    or saved.document->'recommendation'->>'catalogHash' is distinct from p_payload->>'catalogHash' then
    raise exception 'Current qualified discovery and unchanged catalog required' using errcode='40001';
  end if;
  select exists(select 1 from public.field_sales_commands where operation_id=p_operation) into replay;
  p_payload:=jsonb_set(p_payload,'{snapshot,discoveryReference}',
    jsonb_build_object('revision',p_revision,'knowledgeHash',p_knowledge_hash,'operationId',saved.operation_id));
  result:=public.field_sales_transaction_command(p_actor,p_operation,p_lead,'quote',p_payload);
  if not replay then
    insert into public.field_sales_commands(operation_id,actor_id,lead_id,action,payload)
      values(gen_random_uuid(),p_actor,p_lead,'offer.quote',jsonb_build_object('quoteId',result->>'id','discoveryRevision',p_revision,'knowledgeHash',p_knowledge_hash));
  end if;
  return result;
end $$;

create function public.field_sales_offer_reference(p_actor uuid,p_operation uuid,p_lead uuid,p_ai boolean,p_entry_ids jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare previous public.field_sales_commands; payload jsonb; event_action text;
begin
  perform public.field_sales_read(p_actor,p_lead);
  if p_lead is null or p_ai is null or jsonb_typeof(p_entry_ids) is distinct from 'array' or jsonb_array_length(p_entry_ids)>3
    or exists(select 1 from jsonb_array_elements_text(p_entry_ids) x where x !~ '^[a-z][a-z0-9_]{0,79}$') then
    raise exception 'Scoped reference event required' using errcode='22023';
  end if;
  perform 1 from public.field_sales_opportunities where lead_id=p_lead for share;
  perform public.field_sales_read(p_actor,p_lead);
  perform pg_advisory_xact_lock(hashtextextended('field-offer-reference:'||p_actor,0));
  payload:=jsonb_build_object('entryIds',p_entry_ids,'aiRequested',p_ai);
  event_action:=case when p_ai then 'offer.ask' else 'offer.knowledge' end;
  select * into previous from public.field_sales_commands where operation_id=p_operation;
  if found then
    if previous.actor_id<>p_actor or previous.lead_id<>p_lead or previous.action<>event_action or previous.payload<>payload then
      raise exception 'Reference operation reused with different input' using errcode='40001'; end if;
    return jsonb_build_object('replayed',true);
  end if;
  if (select count(*) from public.field_sales_commands where actor_id=p_actor and action in ('offer.ask','offer.knowledge')
    and created_at>now()-interval '15 minutes')>=30 or (p_ai and
    (select count(*) from public.field_sales_commands where actor_id=p_actor and action='offer.ask' and created_at>now()-interval '15 minutes')>=10) then
    raise exception 'Reference usage limit reached; wait before trying again' using errcode='P0001';
  end if;
  insert into public.field_sales_commands(operation_id,actor_id,lead_id,action,payload) values(p_operation,p_actor,p_lead,event_action,payload);
  return jsonb_build_object('replayed',false);
end $$;

revoke all on function public.field_sales_offer_read(uuid,uuid),public.field_sales_offer_save(uuid,uuid,uuid,integer,jsonb),
  public.field_sales_offer_quote(uuid,uuid,uuid,integer,text,jsonb),public.field_sales_offer_reference(uuid,uuid,uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.field_sales_offer_read(uuid,uuid),public.field_sales_offer_save(uuid,uuid,uuid,integer,jsonb),
  public.field_sales_offer_quote(uuid,uuid,uuid,integer,text,jsonb),public.field_sales_offer_reference(uuid,uuid,uuid,boolean,jsonb) to service_role;
commit;
