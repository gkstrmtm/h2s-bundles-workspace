-- REVIEW ONLY. Requires 007, 014, 031, 032, 035, 037 in the verified SAME project.
-- No existing accounts/lead rows are changed and both application/setup gates default off.
begin;
create table public.field_sales_settings(singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into public.field_sales_settings values(true,false);
create table public.field_sales_representatives(
  user_id uuid primary key references public."Dashboard_Users"("User_ID"),
  active boolean not null default false,
  updated_at timestamptz not null default now()
);
create table public.field_sales_services(
  service_id text primary key check(service_id ~ '^[a-z][a-z0-9_]{1,79}$'),
  version integer not null check(version>0),
  enabled boolean not null default true,
  definition jsonb not null check(jsonb_typeof(definition)='object'
    and jsonb_typeof(definition->'questions')='array' and jsonb_typeof(definition->'photos')='array')
);
insert into public.field_sales_services(service_id,version,definition) values
('tv_mounting',1,'{"label":"TV mounting","queueLabel":"TV Mounting","markets":["residential","commercial"],"questions":[{"id":"quantity","label":"Number of TVs","type":"number","required":true,"min":1,"max":100},{"id":"size","label":"Largest TV (inches)","type":"number","required":true,"min":19,"max":150},{"id":"surface","label":"Wall / installation surface","type":"select","required":true,"options":["Drywall / studs","Brick / masonry","Above fireplace","Other / management review"]},{"id":"mount","label":"Equipment preference","type":"select","required":true,"options":["Customer-owned mount","Fixed mount","Tilt mount","Full-motion mount","Discuss options"]}],"photos":["Mounting surface","TV and connection location"]}'),
('cameras_owned',1,'{"label":"Customer-owned cameras","queueLabel":"Security Cameras","markets":["residential","commercial"],"questions":[{"id":"quantity","label":"Camera quantity","type":"number","required":true,"min":1,"max":100},{"id":"equipment","label":"Existing equipment / model","type":"text","required":true},{"id":"installation","label":"Installation type","type":"select","required":true,"options":["Battery / wireless","Plug-in wireless","Wired / PoE","Unknown / review"]},{"id":"requirements","label":"Power, network, heights and cable paths","type":"text","required":true}],"photos":["Camera mounting locations","Power and network location"]}'),
('cameras_included',1,'{"label":"Equipment-included camera assessment","queueLabel":"Security Cameras","markets":["residential","commercial"],"questions":[{"id":"quantity","label":"Requested camera quantity","type":"number","required":true,"min":1,"max":100},{"id":"installation","label":"Installation preference","type":"select","required":true,"options":["Wireless","Wired / PoE","Discuss options"]},{"id":"equipment","label":"Equipment preferences (not an approved package)","type":"text","required":true},{"id":"coverage","label":"Coverage, power, network and installation requirements","type":"text","required":true}],"photos":["Coverage locations","Power and network location"]}'),
('smart_locks',1,'{"label":"Smart lock service interest","queueLabel":"Smart Locks","markets":["residential","commercial"],"questions":[{"id":"quantity","label":"Door quantity","type":"number","required":true,"min":1,"max":100},{"id":"requirements","label":"Door / lock type, equipment ownership and installation needs","type":"text","required":true}],"photos":["Door and existing lock"]}'),
('soundbar_mounting',1,'{"label":"Soundbar mounting service interest","queueLabel":"Soundbar Mounting","markets":["residential","commercial"],"questions":[{"id":"quantity","label":"Soundbar quantity","type":"number","required":true,"min":1,"max":100},{"id":"requirements","label":"Soundbar model, mount preference, wall and cable needs","type":"text","required":true}],"photos":["Soundbar mounting location"]}'),
('smart_home_setup',1,'{"label":"Smart home setup service interest","queueLabel":"Smart Home Setup","markets":["residential","commercial"],"questions":[{"id":"requirements","label":"Devices, existing equipment, network and installation requirements","type":"text","required":true}],"photos":["Device and installation location"]}');
create table public.field_sales_opportunities(
  lead_id uuid primary key references public.commercial_leads(lead_id),
  owner_user_id uuid not null references public.field_sales_representatives(user_id),
  revision integer not null default 0,
  services jsonb not null check(jsonb_typeof(services)='array'),
  assessments jsonb not null default '{}',
  status text not null default 'new' check(status in ('new','assessing','ready_for_review','reviewed','needs_information','closed')),
  notes text not null default '',
  photo_consent boolean not null default false,
  consent_note text not null default '',
  consent_actor uuid references public."Dashboard_Users"("User_ID"),
  consent_at timestamptz,
  created_by uuid not null references public."Dashboard_Users"("User_ID"),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.field_sales_commands(
  operation_id uuid primary key, actor_id uuid not null references public."Dashboard_Users"("User_ID"),
  lead_id uuid references public.commercial_leads(lead_id), action text not null, payload jsonb not null,
  created_at timestamptz not null default now()
);
create table public.field_sales_photos(
  file_id uuid primary key references public.commercial_business_files(file_id),
  lead_id uuid not null references public.field_sales_opportunities(lead_id),
  service_id text not null references public.field_sales_services(service_id), label text not null,
  actor_id uuid not null references public."Dashboard_Users"("User_ID"),
  consent_note text not null, consent_at timestamptz not null
);
create index field_sales_owner on public.field_sales_opportunities(owner_user_id,updated_at desc);
create function public.field_sales_access(p_actor uuid) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text;
begin
  if not exists(select 1 from public.field_sales_settings where enabled) then
    raise exception 'Field Sales setup gate is disabled' using errcode='55000';
  end if;
  select "Role" into r from public."Dashboard_Users" where "User_ID"=p_actor and not "Is_Disabled" for share;
  if r='ADMIN' then return r; end if;
  if r='SALES' then
    perform 1 from public.field_sales_representatives where user_id=p_actor and active for share;
    if found then return r; end if;
  end if;
  raise exception 'Field Sales access denied' using errcode='42501';
end $$;
create function public.field_sales_read(p_actor uuid,p_lead_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text; owned public.field_sales_opportunities; result jsonb;
begin
  r:=public.field_sales_access(p_actor);
  if p_lead_id is null then
    select jsonb_build_object('opportunities',coalesce(jsonb_agg(x.entry),'[]'::jsonb),
      'total',(select count(*) from public.field_sales_opportunities where r='ADMIN' or owner_user_id=p_actor)) into result
      from (select jsonb_build_object('lead_id',o.lead_id,'owner_user_id',o.owner_user_id,'revision',o.revision,
        'status',o.status,'services',o.services,'full_name',l.full_name,'phone',l.phone,'address',l.project_address,
        'market',coalesce(l.attribution->>'market','commercial'),'follow_up_at',q.next_follow_up_at) entry
        from public.field_sales_opportunities o join public.commercial_leads l using(lead_id)
        left join public.commercial_lead_operations q using(lead_id)
        where r='ADMIN' or o.owner_user_id=p_actor order by o.updated_at desc,o.lead_id limit 100) x;
    return result||jsonb_build_object('representatives',case when r='ADMIN' then
      (select coalesce(jsonb_agg(jsonb_build_object('user_id',f.user_id,'active',f.active and not u."Is_Disabled" and u."Role"='SALES',
        'display_name',u."Display_Name",'username',u."Username")),'[]'::jsonb)
        from public.field_sales_representatives f join public."Dashboard_Users" u on u."User_ID"=f.user_id) else '[]'::jsonb end);
  end if;
  select * into owned from public.field_sales_opportunities where lead_id=p_lead_id for share;
  if not found or (r<>'ADMIN' and owned.owner_user_id<>p_actor) then raise exception 'Record not found or not assigned' using errcode='P0002'; end if;
  return jsonb_build_object('opportunity',to_jsonb(owned),'lead',(select jsonb_build_object('lead_id',lead_id,
    'full_name',full_name,'phone',phone,'project_address',project_address,'project_city',project_city,'attribution',
    jsonb_build_object('market',coalesce(attribution->>'market','commercial'))) from public.commercial_leads where lead_id=p_lead_id),
    'followUpAt',(select next_follow_up_at from public.commercial_lead_operations where lead_id=p_lead_id),
    'history',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select operation_id,action,actor_name,created_at,payload
      from public.commercial_lead_activity where lead_id=p_lead_id order by revision desc limit 100) x),
    'photos',(select coalesce(jsonb_agg(jsonb_build_object('file_id',p.file_id,'service_id',p.service_id,'label',p.label,
      'state',f.state,'content_type',f.content_type,'object_path',f.object_path)),'[]'::jsonb)
      from public.field_sales_photos p join public.commercial_business_files f using(file_id) where p.lead_id=p_lead_id));
end $$;
create function public.field_sales_command(p_actor uuid,p_operation uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text; old public.field_sales_commands; o public.field_sales_opportunities; l public.commercial_leads;
  lead uuid; owner_id uuid; queue_revision integer; labels jsonb; market text;
  audit_payload jsonb:=p_payload-'pinSalt'-'pinHash'; item text; svc public.field_sales_services;
begin
  r:=public.field_sales_access(p_actor);
  perform pg_advisory_xact_lock(hashtextextended('field-sales-command:'||p_operation,0));
  select * into old from public.field_sales_commands where operation_id=p_operation;
  if found then
    if old.actor_id<>p_actor or old.action<>p_action or old.payload<>audit_payload then raise exception 'Operation key reused with changed input' using errcode='40001'; end if;
    if old.lead_id is not null then perform public.field_sales_read(p_actor,old.lead_id); end if;
    return jsonb_build_object('leadId',old.lead_id,'replayed',true);
  end if;
  if p_action in ('account_create','account_state') then
    if r<>'ADMIN' then raise exception 'Administrator required' using errcode='42501'; end if;
    if p_action='account_create' then
      if coalesce(p_payload->>'username','') !~ '^[A-Z][A-Z0-9]{2,31}$'
        or length(coalesce(p_payload->>'displayName','')) not between 1 and 120
        or length(coalesce(p_payload->>'pinHash',''))<40 or length(coalesce(p_payload->>'pinSalt',''))<20 then
        raise exception 'Invalid account details' using errcode='22023'; end if;
      insert into public."Dashboard_Users"("User_ID","Username","Display_Name","Role","Is_Disabled","Pin_Salt","Pin_Hash")
        values(p_operation,p_payload->>'username',p_payload->>'displayName','SALES',true,p_payload->>'pinSalt',p_payload->>'pinHash');
      insert into public.field_sales_representatives(user_id) values(p_operation);
    else
      owner_id:=(p_payload->>'userId')::uuid;
      perform 1 from public."Dashboard_Users" where "User_ID"=owner_id and "Role"='SALES' for update;
      if not found then raise exception 'Sales representative not found' using errcode='P0002'; end if;
      perform 1 from public.field_sales_representatives where user_id=owner_id for update;
      if not found then
        raise exception 'Sales representative not found' using errcode='P0002'; end if;
      update public.field_sales_representatives set active=(p_payload->>'active')::boolean,updated_at=now() where user_id=owner_id;
      update public."Dashboard_Users" set "Is_Disabled"=not (p_payload->>'active')::boolean,"Updated_At"=now() where "User_ID"=owner_id;
      delete from public."Dashboard_Sessions" where "User_ID"=owner_id;
    end if;
  else
    if p_action in ('create','attach','assign') then
      owner_id:=(p_payload->>'ownerId')::uuid;
      if r<>'ADMIN' and (p_action<>'create' or owner_id<>p_actor) then
        raise exception 'Administrator or own prospect required' using errcode='42501'; end if;
      perform 1 from public."Dashboard_Users" where "User_ID"=owner_id and "Role"='SALES' and not "Is_Disabled" for share;
      if not found then raise exception 'Active representative required' using errcode='22023'; end if;
      perform 1 from public.field_sales_representatives where user_id=owner_id and active for share;
      if not found then raise exception 'Active representative required' using errcode='22023'; end if;
    end if;
    if p_action='create' then
      owner_id:=(p_payload->>'ownerId')::uuid;
      if r<>'ADMIN' and owner_id<>p_actor then raise exception 'Own prospects only' using errcode='42501'; end if;
      market:=p_payload->>'market';
      if market not in ('residential','commercial') or coalesce(p_payload->>'phone','') !~ '^\+[1-9][0-9]{6,14}$'
        or length(coalesce(p_payload->>'fullName','')) not between 1 and 120
        or length(coalesce(p_payload->>'address','')) not between 1 and 500 then raise exception 'Invalid prospect' using errcode='22023'; end if;
      perform pg_advisory_xact_lock(hashtextextended('field-sales-phone:'||(p_payload->>'phone'),0));
      if exists(select 1 from public.commercial_leads where
        regexp_replace(phone,'[^0-9]','','g') in (substring(p_payload->>'phone' from 2),
          case when p_payload->>'phone' like '+1%' then substring(p_payload->>'phone' from 3) else substring(p_payload->>'phone' from 2) end)) then
        raise exception 'Possible existing inquiry. Management must verify its exact record; no duplicate was created.' using errcode='40001';
      end if;
      if jsonb_typeof(p_payload->'services') is distinct from 'array' or jsonb_array_length(p_payload->'services') not between 1 and 20 then
        raise exception 'Service selection required' using errcode='22023'; end if;
      for item in select jsonb_array_elements_text(p_payload->'services') loop
        select * into svc from public.field_sales_services where service_id=item and enabled;
        if not found or not (svc.definition->'markets' ? market)
          or (p_payload#>>array['assessments',item,'version'])::integer is distinct from svc.version then
          raise exception 'Service definition changed; reload' using errcode='40001'; end if;
      end loop;
      select jsonb_agg(distinct s.definition->>'queueLabel') into labels from public.field_sales_services s
        where s.enabled and p_payload->'services' ? s.service_id;
      if labels is null then raise exception 'Service interest required' using errcode='22023'; end if;
      insert into public.commercial_leads(public_token,full_name,phone,project_address,project_city,service_needs,attribution,notes,contact_preference)
        values(gen_random_uuid()::text||gen_random_uuid()::text,p_payload->>'fullName',p_payload->>'phone',
          p_payload->>'address',p_payload->>'city',labels,jsonb_build_object('market',market,'intake','field_sales'),
          p_payload->>'notes','call') returning * into l;
      lead:=l.lead_id;
    else
      lead:=(p_payload->>'leadId')::uuid;
      select * into l from public.commercial_leads where lead_id=lead for update;
      if not found then raise exception 'Record not found' using errcode='P0002'; end if;
    end if;
    if p_action in ('create','attach') then
      if p_action='attach' and (r<>'ADMIN' or length(coalesce(p_payload->>'evidence',''))<3) then raise exception 'Management evidence required' using errcode='42501'; end if;
      owner_id:=(p_payload->>'ownerId')::uuid;
      insert into public.field_sales_opportunities(lead_id,owner_user_id,services,assessments,created_by)
        values(lead,owner_id,coalesce(p_payload->'services','[]'::jsonb),coalesce(p_payload->'assessments','{}'::jsonb),p_actor);
    else
      select * into o from public.field_sales_opportunities where lead_id=lead for update;
      if not found or (r<>'ADMIN' and o.owner_user_id<>p_actor) then raise exception 'Record not found or not assigned' using errcode='P0002'; end if;
      if o.revision<>(p_payload->>'revision')::integer then raise exception 'Opportunity changed; reload before saving' using errcode='40001'; end if;
      if p_action='save' then
        if r='SALES' and o.status='closed' then raise exception 'Closed opportunity requires management review' using errcode='42501'; end if;
        if jsonb_typeof(p_payload->'services') is distinct from 'array' or jsonb_array_length(p_payload->'services') not between 1 and 20 then
          raise exception 'Service selection required' using errcode='22023'; end if;
        for item in select jsonb_array_elements_text(p_payload->'services') loop
          select * into svc from public.field_sales_services where service_id=item and enabled;
          if not found or not (svc.definition->'markets' ? coalesce(l.attribution->>'market','commercial'))
            or (p_payload#>>array['assessments',item,'version'])::integer is distinct from svc.version then
            raise exception 'Service definition changed; reload' using errcode='40001'; end if;
        end loop;
        update public.field_sales_opportunities set services=p_payload->'services',assessments=p_payload->'assessments',
          notes=p_payload->>'notes',photo_consent=(p_payload->>'photoConsent')::boolean,
          consent_note=p_payload->>'consentNote',consent_actor=p_actor,consent_at=now(),
          status=case when (p_payload->>'submit')::boolean then 'ready_for_review' else 'assessing' end where lead_id=lead;
        if l.attribution->>'intake'='field_sales' then
          select jsonb_agg(distinct s.definition->>'queueLabel') into labels from public.field_sales_services s
            where p_payload->'services' ? s.service_id;
          update public.commercial_leads set service_needs=labels where lead_id=lead;
        end if;
      elsif p_action='assign' then
        if r<>'ADMIN' then raise exception 'Administrator required' using errcode='42501'; end if;
        owner_id:=(p_payload->>'ownerId')::uuid;
        update public.field_sales_opportunities set owner_user_id=owner_id where lead_id=lead;
      elsif p_action='review' then
        if r<>'ADMIN' or p_payload->>'status' not in ('reviewed','needs_information','closed') then raise exception 'Management review required' using errcode='42501'; end if;
        update public.field_sales_opportunities set status=p_payload->>'status' where lead_id=lead;
      else raise exception 'Unsupported sales action' using errcode='22023';
      end if;
    end if;
    update public.field_sales_opportunities set revision=revision+1,updated_at=now() where lead_id=lead;
    insert into public.commercial_lead_operations(lead_id) values(lead) on conflict do nothing;
    update public.commercial_lead_operations set revision=revision+1,updated_at=now(),
      next_follow_up_at=case when p_action in ('create','save') then (p_payload->>'followUpAt')::timestamptz else next_follow_up_at end
      where lead_id=lead returning revision into queue_revision;
    insert into public.commercial_lead_activity(operation_id,lead_id,revision,actor_id,actor_name,action,payload)
      select p_operation,lead,queue_revision,p_actor::text,"Display_Name",'field_sales.'||p_action,
        audit_payload-'assessments' from public."Dashboard_Users" where "User_ID"=p_actor;
  end if;
  insert into public.field_sales_commands(operation_id,actor_id,lead_id,action,payload) values(p_operation,p_actor,lead,p_action,audit_payload);
  return jsonb_build_object('leadId',lead,'replayed',false);
end $$;
create function public.field_sales_photo(p_actor uuid,p_operation uuid,p_lead_id uuid,p_file jsonb,p_complete boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text; o public.field_sales_opportunities; f public.commercial_business_files; p public.field_sales_photos; svc public.field_sales_services; queue_revision integer;
begin
  r:=public.field_sales_access(p_actor);
  perform 1 from public.commercial_leads where lead_id=p_lead_id for update;
  select * into o from public.field_sales_opportunities where lead_id=p_lead_id for update;
  if not found or (r<>'ADMIN' and o.owner_user_id<>p_actor) then raise exception 'Record not found or not assigned' using errcode='P0002'; end if;
  if r='SALES' and o.status='closed' then raise exception 'Closed opportunity requires management review' using errcode='42501'; end if;
  if not o.photo_consent or length(o.consent_note)<1 then raise exception 'Current customer photo permission required' using errcode='42501'; end if;
  select * into svc from public.field_sales_services where service_id=p_file->>'serviceId' and enabled;
  if not found or not(o.services ? svc.service_id) or not(svc.definition->'photos' ? (p_file->>'label')) then
    raise exception 'Choose a configured photo label for an interested service' using errcode='22023'; end if;
  select * into f from public.commercial_business_files where file_id=p_operation for update;
  if found then
    select * into p from public.field_sales_photos where file_id=p_operation;
    if not found or f.lead_id<>p_lead_id or p.actor_id<>p_actor or f.sha256<>p_file->>'sha256'
      or f.filename<>p_file->>'filename' or p.label<>p_file->>'label' or p.service_id<>p_file->>'serviceId'
      or f.content_type<>p_file->>'contentType' or f.byte_size<>(p_file->>'byteSize')::integer then
      raise exception 'Photo operation reused with changed information' using errcode='40001'; end if;
  else
    if p_complete or p_file->>'contentType' not in ('image/jpeg','image/png','image/webp') then raise exception 'Reserve valid photo first' using errcode='22023'; end if;
    insert into public.commercial_business_files(file_id,lead_id,purpose,filename,content_type,byte_size,sha256,object_path,note,actor)
      values(p_operation,p_lead_id,'contact_note',p_file->>'filename',p_file->>'contentType',(p_file->>'byteSize')::integer,
        p_file->>'sha256','field-sales/'||p_lead_id||'/'||p_operation,p_file->>'label',jsonb_build_object('id',p_actor,'role',r))
      returning * into f;
    insert into public.field_sales_photos values(p_operation,p_lead_id,svc.service_id,p_file->>'label',p_actor,o.consent_note,o.consent_at);
  end if;
  if p_complete and f.state='pending' then
    update public.commercial_business_files set state='ready' where file_id=p_operation returning * into f;
    update public.field_sales_opportunities set revision=revision+1,updated_at=now(),
      status=case when status in ('reviewed','ready_for_review') then 'assessing' else status end where lead_id=p_lead_id;
    insert into public.commercial_lead_operations(lead_id) values(p_lead_id) on conflict do nothing;
    update public.commercial_lead_operations set revision=revision+1,updated_at=now()
      where lead_id=p_lead_id returning revision into queue_revision;
    insert into public.commercial_lead_activity(operation_id,lead_id,revision,actor_id,actor_name,action,payload)
      select p_operation,p_lead_id,queue_revision,p_actor::text,"Display_Name",'field_sales.photo',
        jsonb_build_object('fileId',p_operation,'serviceId',svc.service_id,'label',p.label,'sha256',f.sha256)
        from public."Dashboard_Users" where "User_ID"=p_actor;
  end if;
  return jsonb_build_object('state',f.state,'object_path',f.object_path);
end $$;
create function public.field_sales_guard_role() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if new."Role" is distinct from old."Role" and (new."Role"='SALES' or old."Role"='SALES') then
    raise exception 'Sales role transitions require an approved migration; use representative account controls' using errcode='42501';
  end if;
  return new;
end $$;
create trigger field_sales_guard_role before update of "Role" on public."Dashboard_Users"
  for each row execute function public.field_sales_guard_role();
-- Extend only field-origin descriptive service interests, not prices or public intake behavior.
create or replace function public.h2s_guard_lead_market() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare market text:=coalesce(new.attribution->>'market','commercial'); availability jsonb:=coalesce(new.assessment_answers->'availabilityPreferences','[]'::jsonb); item jsonb;
begin
  if market not in ('residential','commercial') or (tg_op='UPDATE' and market is distinct from coalesce(old.attribution->>'market','commercial')) then
    raise exception 'Lead market cannot change' using errcode='22023'; end if;
  if tg_op='UPDATE' and (new.attribution->>'intake'='field_sales' or old.attribution->>'intake'='field_sales')
    and new.attribution->>'intake' is distinct from old.attribution->>'intake' then
    raise exception 'Field intake provenance cannot change' using errcode='22023'; end if;
  if market='residential' then
    if jsonb_typeof(new.service_needs) is distinct from 'array' or jsonb_array_length(new.service_needs)<1
      or jsonb_typeof(availability) is distinct from 'array' or jsonb_array_length(availability)>3 then raise exception 'Invalid residential interests/availability' using errcode='22023'; end if;
    if new.attribution->>'intake'='field_sales' then
      if jsonb_array_length(new.service_needs)>20 or exists(select 1 from jsonb_array_elements_text(new.service_needs) label
        where not exists(select 1 from public.field_sales_services s where s.definition->>'queueLabel'=label and s.definition->'markets' ? 'residential')) then
        raise exception 'Unknown field service interest' using errcode='22023'; end if;
    elsif jsonb_array_length(new.service_needs)>2 or exists(select 1 from jsonb_array_elements_text(new.service_needs) s where s not in ('TV Mounting','Security Cameras')) then
      raise exception 'Residential services are invalid' using errcode='22023';
    end if;
    for item in select value from jsonb_array_elements(availability) loop
      if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'period','') not in ('morning','afternoon','evening','flexible')
        or coalesce(item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or ((item->>'date')::date)::text<>item->>'date' then
        raise exception 'Availability is not a booking' using errcode='22023'; end if;
    end loop;
  end if;
  return new;
end $$;
do $$ declare t text; f regprocedure; begin
  foreach t in array array['field_sales_settings','field_sales_representatives','field_sales_services','field_sales_opportunities','field_sales_commands','field_sales_photos'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
  end loop;
  foreach f in array array['public.field_sales_access(uuid)'::regprocedure,'public.field_sales_read(uuid,uuid)'::regprocedure,
    'public.field_sales_command(uuid,uuid,text,jsonb)'::regprocedure,'public.field_sales_photo(uuid,uuid,uuid,jsonb,boolean)'::regprocedure] loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
commit;
