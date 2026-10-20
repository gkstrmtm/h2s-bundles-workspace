-- REVIEW ONLY: reconcile existing active duplicates before applying.
-- No customer rows are deleted or merged, and existing RLS is left unchanged.
alter table public.commercial_leads add column if not exists revision bigint not null default 0;
alter table public.commercial_leads add column if not exists last_save_key text;
alter table public.commercial_leads alter column last_submitted_at drop not null;
alter table public.commercial_consultation_requests add column if not exists submission_key text;
-- Phone-only commercial appointments have no invented email. Other orders retain the email requirement.
do $$
begin
  if exists (select 1 from public.h2s_orders where order_id like 'APPT-COM-%'
      or coalesce(metadata_json ? 'commercial_consultation_request_id',false))
    or exists (select 1 from public.commercial_consultation_requests where related_order_id is not null) then
    raise exception 'Reconcile existing commercial appointment markers and request links before migration 031; no automatic backfill is authorized.';
  end if;
end $$;
alter table public.h2s_orders add column commercial_request_id uuid
  references public.commercial_consultation_requests(request_id);
alter table public.h2s_orders alter column customer_email drop not null;
alter table public.h2s_orders add constraint h2s_orders_email_required_except_commercial check (
  customer_email is not null or commercial_request_id is not null
);
alter table public.h2s_orders add constraint h2s_orders_commercial_link check (
  (commercial_request_id is null and order_id not like 'APPT-COM-%'
    and not coalesce(metadata_json ? 'commercial_consultation_request_id',false))
  or (
    commercial_request_id is not null and order_id='APPT-COM-'||commercial_request_id::text
    and coalesce(metadata_json->>'commercial_consultation_request_id'=commercial_request_id::text,false)
  )
);

create or replace function public.commercial_protect_appointment()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
declare
  caller text := coalesce(nullif(current_setting('role',true),'none'),current_user);
  old_commercial boolean := false;
  new_commercial boolean := false;
  request_id uuid;
begin
  if TG_OP='TRUNCATE' then
    if caller in ('anon','authenticated','service_role') or current_user in ('anon','authenticated','service_role') then
      raise exception 'API roles cannot truncate appointments' using errcode='42501';
    end if;
    return null;
  end if;
  if TG_OP in ('UPDATE','DELETE') then
    old_commercial := old.commercial_request_id is not null or old.order_id like 'APPT-COM-%'
      or coalesce(old.metadata_json ? 'commercial_consultation_request_id',false);
    request_id := old.commercial_request_id;
  end if;
  if TG_OP in ('INSERT','UPDATE') then
    new_commercial := new.commercial_request_id is not null or new.order_id like 'APPT-COM-%'
      or coalesce(new.metadata_json ? 'commercial_consultation_request_id',false);
    request_id := coalesce(request_id,new.commercial_request_id);
  end if;
  if old_commercial or new_commercial then
    if caller in ('anon','authenticated') or current_user in ('anon','authenticated') then
      raise exception 'Commercial appointments require the authorized commercial workflow' using errcode='42501';
    end if;
    -- Generic backend routes also use service_role; only the scoped appointment RPC may write these rows.
    if (caller='service_role' or current_user='service_role')
      and (request_id is null or current_setting('h2s.commercial_appointment_request_id',true) is distinct from request_id::text) then
      raise exception 'Commercial appointments must be changed through the scoped commercial RPC' using errcode='42501';
    end if;
    if TG_OP='UPDATE' and old.commercial_request_id is not null
      and (new.commercial_request_id is distinct from old.commercial_request_id
        or new.id is distinct from old.id or new.order_id is distinct from old.order_id) then
      raise exception 'Commercial appointment identity cannot be changed';
    end if;
  end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.commercial_protect_appointment() from public,anon,authenticated;
grant execute on function public.commercial_protect_appointment() to service_role;
create trigger commercial_appointment_write_guard before insert or update or delete on public.h2s_orders
  for each row execute function public.commercial_protect_appointment();
create trigger commercial_appointment_truncate_guard before truncate on public.h2s_orders
  for each statement execute function public.commercial_protect_appointment();

do $$
begin
  if exists (
    select lead_id from public.commercial_consultation_requests
    where status in ('pending','approved','customer_confirmed','escalated','reschedule_requested')
    group by lead_id having count(*) > 1
  ) then
    raise exception 'Reconcile existing active commercial request duplicates before migration 031; no rows were changed.';
  end if;
end $$;

create unique index if not exists commercial_one_active_request
  on public.commercial_consultation_requests(lead_id)
  where status in ('pending','approved','customer_confirmed','escalated','reschedule_requested');
create unique index if not exists commercial_submission_key
  on public.commercial_consultation_requests(lead_id,submission_key) where submission_key is not null;

create table if not exists public.commercial_effects (
  request_id uuid not null references public.commercial_consultation_requests(request_id),
  kind text not null,
  state text not null check(state in ('processing','accepted','failed','uncertain')),
  details jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key(request_id,kind)
);
alter table public.commercial_effects enable row level security;
revoke all on public.commercial_effects from public, anon, authenticated, service_role;
grant select,insert,update on public.commercial_effects to service_role;

create or replace function public.commercial_save_lead(
  p_token text, p_revision bigint, p_save_key text, p_patch jsonb
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare old_row public.commercial_leads; saved public.commercial_leads;
begin
  if length(p_token) < 20 or length(p_save_key) < 16 or p_revision < 0 then
    raise exception 'Invalid commercial save identity';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('commercial-lead:' || p_token,0));
  select * into old_row from public.commercial_leads where public_token=p_token for update;
  if found and old_row.last_save_key=p_save_key then return jsonb_build_object('lead',to_jsonb(old_row),'replayed',true); end if;
  if (old_row.lead_id is not null and old_row.revision<>p_revision)
     or (old_row.lead_id is null and p_revision<>0) then
    return jsonb_build_object('conflict',true,'lead',to_jsonb(old_row));
  end if;
  select * into saved from jsonb_populate_record(null::public.commercial_leads,
    p_patch || jsonb_build_object('lead_id',coalesce(old_row.lead_id,gen_random_uuid()),
      'public_token',p_token,'revision',coalesce(old_row.revision,0)+1,'last_save_key',p_save_key,
      'created_at',coalesce(old_row.created_at,now()),'updated_at',now()));
  insert into public.commercial_leads select saved.*
  on conflict(public_token) do update set
    full_name=excluded.full_name,company_name=excluded.company_name,email=excluded.email,phone=excluded.phone,
    contact_preference=excluded.contact_preference,business_type=excluded.business_type,
    project_address=excluded.project_address,project_city=excluded.project_city,
    project_state=excluded.project_state,project_postal_code=excluded.project_postal_code,
    scope_summary=excluded.scope_summary,timeline=excluded.timeline,budget_band=excluded.budget_band,
    site_count=excluded.site_count,service_needs=excluded.service_needs,
    assessment_answers=excluded.assessment_answers,attribution=excluded.attribution,notes=excluded.notes,
    completeness_score=excluded.completeness_score,completeness_bucket=excluded.completeness_bucket,
    priority_tier=excluded.priority_tier,revision=excluded.revision,last_save_key=excluded.last_save_key,
    updated_at=excluded.updated_at
  returning * into saved;
  return jsonb_build_object('lead',to_jsonb(saved));
end $$;

create or replace function public.commercial_submit_request(p_lead_id uuid,p_key text,p_patch jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare existing public.commercial_consultation_requests; saved public.commercial_consultation_requests;
begin
  if length(p_key)<16 then raise exception 'Missing submission identity'; end if;
  perform pg_advisory_xact_lock(hashtextextended('commercial-request:'||p_lead_id::text,0));
  select * into existing from public.commercial_consultation_requests where lead_id=p_lead_id
    and (submission_key=p_key or status in ('pending','approved','customer_confirmed','escalated','reschedule_requested'))
    order by created_at desc limit 1;
  if found then return jsonb_build_object('request',to_jsonb(existing),'created',false); end if;
  select * into saved from jsonb_populate_record(null::public.commercial_consultation_requests,
    p_patch || jsonb_build_object('request_id',gen_random_uuid(),'lead_id',p_lead_id,'submission_key',p_key,
      'reminder_count',0,'created_at',now(),'updated_at',now()));
  insert into public.commercial_consultation_requests select saved.* returning * into saved;
  update public.commercial_leads set last_submitted_at=now() where lead_id=p_lead_id;
  return jsonb_build_object('request',to_jsonb(saved),'created',true);
end $$;

create or replace function public.commercial_reschedule_request(
  p_request_id uuid,p_lead_id uuid,p_expected_token text,p_key text,p_patch jsonb
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare req public.commercial_consultation_requests;
begin
  select * into req from public.commercial_consultation_requests where request_id=p_request_id and lead_id=p_lead_id for update;
  if not found then raise exception 'Commercial request not found'; end if;
  if req.metadata->>'last_reschedule_key'=p_key then return jsonb_build_object('request',to_jsonb(req),'replayed',true); end if;
  if req.response_token<>p_expected_token or req.related_order_id is not null
    or req.status not in ('pending','escalated','reschedule_requested') then
    raise exception 'Request changed; reload before rescheduling';
  end if;
  update public.commercial_consultation_requests set
    status='pending',preferred_slots=p_patch->'preferred_slots',
    selected_slot_start=(p_patch->>'selected_slot_start')::timestamptz,
    selected_slot_end=(p_patch->>'selected_slot_end')::timestamptz,
    assigned_technician_name=p_patch->>'assigned_technician_name',
    assigned_technician_phone=p_patch->>'assigned_technician_phone',
    response_token=p_patch->>'response_token',response_channel=null,response_note=null,response_at=null,
    reminder_count=0,last_reminder_at=null,next_reminder_at=(p_patch->>'next_reminder_at')::timestamptz,
    metadata=metadata||coalesce(p_patch->'metadata','{}')||jsonb_build_object('last_reschedule_key',p_key),
    updated_at=now()
    where request_id=p_request_id returning * into req;
  return jsonb_build_object('request',to_jsonb(req),'replayed',false);
end $$;

create or replace function public.commercial_claim_effect(p_request_id uuid,p_kind text)
returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
declare claimed boolean;
begin
  insert into public.commercial_effects(request_id,kind,state) values(p_request_id,p_kind,'processing')
    on conflict(request_id,kind) do update set state='processing',updated_at=now()
    where commercial_effects.state='failed'
    returning true into claimed;
  if claimed then
    update public.commercial_consultation_requests
      set metadata=jsonb_set(metadata,'{workflow}',coalesce(metadata->'workflow','{}') ||
        jsonb_build_object(p_kind,jsonb_build_object('state','processing','updatedAt',now())))
      where request_id=p_request_id;
  end if;
  return coalesce(claimed,false);
end $$;

create or replace function public.commercial_finish_effect(p_request_id uuid,p_kind text,p_state text,p_details jsonb)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  update public.commercial_effects set state=p_state,details=p_details,updated_at=now()
    where request_id=p_request_id and kind=p_kind and state='processing';
  if not found then raise exception 'Commercial effect claim was lost'; end if;
  update public.commercial_consultation_requests
    set metadata=jsonb_set(metadata,'{workflow}',coalesce(metadata->'workflow','{}') ||
      jsonb_build_object(p_kind,jsonb_build_object('state',p_state,'details',p_details,'updatedAt',now()))),
      updated_at=now()
    where request_id=p_request_id;
end $$;

create or replace function public.commercial_attach_photo(p_lead_id uuid,p_url text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare saved public.commercial_leads;
begin
  select * into saved from public.commercial_leads where lead_id=p_lead_id for update;
  if not found then raise exception 'Commercial lead not found'; end if;
  if saved.project_photo_urls ? p_url then return to_jsonb(saved); end if;
  if jsonb_array_length(saved.project_photo_urls)>=8 then raise exception 'Maximum eight attachments reached'; end if;
  update public.commercial_leads set project_photo_urls=project_photo_urls||jsonb_build_array(p_url)
    where lead_id=p_lead_id returning * into saved;
  return to_jsonb(saved);
end $$;

create or replace function public.commercial_create_appointment(p_request_id uuid)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare req public.commercial_consultation_requests; lead public.commercial_leads; appt public.h2s_orders; key text; previous_context text;
begin
  select * into req from public.commercial_consultation_requests where request_id=p_request_id for update;
  select * into lead from public.commercial_leads where lead_id=req.lead_id;
  if req.request_id is null or lead.lead_id is null or req.status not in ('approved','customer_confirmed') or req.selected_slot_start is null
    or req.selected_slot_start <= now()
    or req.selected_slot_end is null or req.selected_slot_end-req.selected_slot_start<>interval '30 minutes'
    or extract(dow from req.selected_slot_start at time zone 'America/New_York') in (0,6)
    or to_char(req.selected_slot_start at time zone 'America/New_York','HH24:MI') not in ('09:00','11:00','13:30','15:30')
    or extract(second from req.selected_slot_start)<>0
    or req.metadata->>'request_kind'='manual_follow_up' or lead.contact_preference<>'sms'
    or lead.attribution#>'{communicationConsent,smsOptIn}' is distinct from 'true'::jsonb then
    raise exception 'An approved text request with permission and a future supported Eastern window is required for appointment creation';
  end if;
  key := 'APPT-COM-'||req.request_id::text;
  if req.related_order_id is not null then
    select * into appt from public.h2s_orders where id=req.related_order_id;
    if not found then raise exception 'Linked appointment is missing; reconcile before retrying'; end if;
  else
    select * into appt from public.h2s_orders where order_id=key;
  end if;
  if found and (appt.commercial_request_id is distinct from req.request_id or appt.order_id<>key) then
    raise exception 'Linked appointment does not match the commercial request; reconcile before retrying';
  end if;
  if not found then
    previous_context := current_setting('h2s.commercial_appointment_request_id',true);
    perform set_config('h2s.commercial_appointment_request_id',req.request_id::text,true);
    select * into appt from jsonb_populate_record(null::public.h2s_orders,jsonb_build_object(
      'id',gen_random_uuid(),'order_id',key,'commercial_request_id',req.request_id,'customer_email',lead.email,'customer_name',coalesce(lead.full_name,lead.company_name),
      'customer_phone',lead.phone,'name',coalesce(lead.full_name,lead.company_name),'phone',lead.phone,
      'status','queued','delivery_date',(req.selected_slot_start at time zone 'America/New_York')::date,
      'delivery_time',to_char(req.selected_slot_start at time zone 'America/New_York','HH12:MI AM'),
      'service_name','Commercial Consultation','appointment_confirmed',true,'subtotal',0,'total',0,
      'items',jsonb_build_array(jsonb_build_object('type','appointment','service','Commercial Consultation')),
      'metadata_json',jsonb_build_object('commercial_consultation_request_id',req.request_id,
        'slot_start_iso',req.selected_slot_start,'slot_end_iso',req.selected_slot_end,'time_zone','America/New_York'),
      'created_at',now(),'updated_at',now()));
    insert into public.h2s_orders(order_id,commercial_request_id,customer_email,customer_name,customer_phone,name,phone,status,
      delivery_date,delivery_time,service_name,appointment_confirmed,subtotal,total,items,metadata_json,created_at,updated_at)
    values(appt.order_id,appt.commercial_request_id,appt.customer_email,appt.customer_name,appt.customer_phone,appt.name,appt.phone,appt.status,
      appt.delivery_date,appt.delivery_time,appt.service_name,appt.appointment_confirmed,appt.subtotal,appt.total,
      appt.items,appt.metadata_json,appt.created_at,appt.updated_at) returning * into appt;
    perform set_config('h2s.commercial_appointment_request_id',coalesce(previous_context,''),true);
  end if;
  update public.commercial_consultation_requests set related_order_id=appt.id,metadata=metadata-'appointment_error'
    where request_id=p_request_id;
  return to_jsonb(appt);
end $$;

create or replace function public.commercial_record_appointment_error(p_request_id uuid,p_error text)
returns void language sql security invoker set search_path=public,pg_temp as $$
  update public.commercial_consultation_requests
    set metadata=metadata||jsonb_build_object('appointment_error',p_error)
    where request_id=p_request_id;
$$;

revoke all on function public.commercial_save_lead(text,bigint,text,jsonb),
  public.commercial_submit_request(uuid,text,jsonb),public.commercial_reschedule_request(uuid,uuid,text,text,jsonb),public.commercial_claim_effect(uuid,text),
  public.commercial_finish_effect(uuid,text,text,jsonb),public.commercial_attach_photo(uuid,text),
  public.commercial_create_appointment(uuid),public.commercial_record_appointment_error(uuid,text) from public,anon,authenticated;
grant execute on function public.commercial_save_lead(text,bigint,text,jsonb),
  public.commercial_submit_request(uuid,text,jsonb),public.commercial_reschedule_request(uuid,uuid,text,text,jsonb),public.commercial_claim_effect(uuid,text),
  public.commercial_finish_effect(uuid,text,text,jsonb),public.commercial_attach_photo(uuid,text),
  public.commercial_create_appointment(uuid),public.commercial_record_appointment_error(uuid,text) to service_role;
