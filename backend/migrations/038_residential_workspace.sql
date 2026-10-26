-- Review-only. No sends, new jobs, payments, or automatic appointments.
do $$
begin
  if exists(select 1 from public.commercial_leads l
    left join public.commercial_lead_operations o using(lead_id)
    left join public.commercial_reservations r using(lead_id)
    where l.attribution->>'market'='residential' and (o.next_follow_up_at is not null or r.lead_id is not null)) then
    raise exception 'Reconcile existing homeowner callbacks/reservations before migration 038; no reminder backfill is authorized';
  end if;
end $$;
alter table public.commercial_lead_operations
  add column residential_callback_revision integer not null default 0 check(residential_callback_revision>=0),
  add column residential_callback_status text not null default 'none'
    check(residential_callback_status in ('none','scheduled','completed','cancelled'));
create table public.residential_notices (
  notice_id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.commercial_leads(lead_id),
  request_id uuid not null references public.commercial_consultation_requests(request_id),
  kind text not null check(kind in ('owner_callback','owner_installation','customer_confirmation','customer_installation','customer_cancellation')),
  version integer not null check(version>0),
  due_at timestamptz not null,
  expires_at timestamptz not null check(expires_at>due_at),
  state text not null default 'pending' check(state in ('pending','accepted','review_required','superseded','expired','skipped')),
  details jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(request_id,kind,version)
);
create index residential_notices_due on public.residential_notices(due_at) where state='pending';
alter table public.residential_notices enable row level security;
revoke all on public.residential_notices from public,anon,authenticated,service_role;
grant select on public.residential_notices to service_role;

create function public.h2s_residential_callback_guard() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not exists(select 1 from public.commercial_leads where lead_id=new.lead_id and attribution->>'market'='residential') then return new; end if;
  if new.disposition='closed' or new.completed_at is not null then new.next_follow_up_at:=null; end if;
  if new.next_follow_up_at is not null then new.residential_callback_status:='scheduled';
  elsif old.residential_callback_status='scheduled' and new.residential_callback_status<>'completed' then
    new.residential_callback_status:='cancelled';
  end if;
  if new.next_follow_up_at is distinct from old.next_follow_up_at
    or new.residential_callback_status is distinct from coalesce(old.residential_callback_status,'none') then
    new.residential_callback_revision:=coalesce(old.residential_callback_revision,0)+1;
  else new.residential_callback_revision:=coalesce(old.residential_callback_revision,0); end if;
  return new;
end $$;
create trigger h2s_residential_callback_guard before insert or update on public.commercial_lead_operations
  for each row execute function public.h2s_residential_callback_guard();

create function public.h2s_enqueue_residential_callback() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare req public.commercial_consultation_requests;
begin
  if new.residential_callback_revision=0 then return new; end if;
  if new.residential_callback_revision<>coalesce(old.residential_callback_revision,0) then
    update public.residential_notices set state='superseded',updated_at=clock_timestamp()
      where lead_id=new.lead_id and kind='owner_callback' and state in ('pending','review_required');
  end if;
  select * into req from public.commercial_consultation_requests where lead_id=new.lead_id
    and metadata->>'request_kind'='residential_inquiry' order by created_at desc limit 1;
  if req.status='approved' and new.residential_callback_status='scheduled' and new.next_follow_up_at>clock_timestamp() then
    insert into public.residential_notices(lead_id,request_id,kind,version,due_at,expires_at)
      values(new.lead_id,req.request_id,'owner_callback',new.residential_callback_revision,
        greatest(clock_timestamp(),new.next_follow_up_at-interval '15 minutes'),new.next_follow_up_at)
      on conflict(request_id,kind,version) do nothing;
  end if;
  return new;
end $$;
create trigger h2s_residential_callback_notices after insert or update on public.commercial_lead_operations
  for each row execute function public.h2s_enqueue_residential_callback();

create function public.h2s_enqueue_residential_booking() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare req public.commercial_consultation_requests;
begin
  if not exists(select 1 from public.commercial_leads where lead_id=new.lead_id and attribution->>'market'='residential') then return new; end if;
  select * into req from public.commercial_consultation_requests where lead_id=new.lead_id
    and metadata->>'request_kind'='residential_inquiry' order by created_at desc limit 1;
  if new.state in ('tentative','confirmed') and (req.status is distinct from 'approved'
    or exists(select 1 from public.commercial_lead_operations where lead_id=new.lead_id and disposition='closed')) then
    raise exception 'Accept homeowner follow-up and reopen the lead before reserving installation time' using errcode='22023';
  end if;
  if tg_op='UPDATE' and new.state=old.state and new.starts_at=old.starts_at and new.ends_at=old.ends_at
    and new.timezone=old.timezone and new.expires_at is not distinct from old.expires_at then
    update public.residential_notices set version=new.revision,updated_at=clock_timestamp()
      where lead_id=new.lead_id and kind<>'owner_callback' and version=old.revision;
    return new;
  end if;
  update public.residential_notices set state='superseded',updated_at=clock_timestamp()
    where lead_id=new.lead_id and kind<>'owner_callback' and state in ('pending','review_required');
  if req.status='approved' and new.state='confirmed' and new.starts_at>clock_timestamp() then
    insert into public.residential_notices(lead_id,request_id,kind,version,due_at,expires_at) values
      (new.lead_id,req.request_id,'customer_confirmation',new.revision,clock_timestamp(),new.starts_at),
      (new.lead_id,req.request_id,'owner_installation',new.revision,greatest(clock_timestamp(),new.starts_at-interval '60 minutes'),new.starts_at),
      (new.lead_id,req.request_id,'customer_installation',new.revision,greatest(clock_timestamp(),new.starts_at-interval '60 minutes'),new.starts_at);
  elsif req.status='approved' and new.state='cancelled' and old.state='confirmed' then
    insert into public.residential_notices(lead_id,request_id,kind,version,due_at,expires_at)
      values(new.lead_id,req.request_id,'customer_cancellation',new.revision,clock_timestamp(),clock_timestamp()+interval '24 hours');
  end if;
  return new;
end $$;
create trigger h2s_residential_booking_notices after insert or update on public.commercial_reservations
  for each row execute function public.h2s_enqueue_residential_booking();

create function public.h2s_residential_workspace_ready() returns text
language sql stable security invoker set search_path=public,pg_temp as $$ select '038'::text $$;

create function public.h2s_record_residential_callback(p_token text,p_revision integer,p_operation_id uuid,p_actor jsonb,p_action text,p_due_at timestamptz,p_note text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare req public.commercial_consultation_requests; op public.commercial_lead_operations; prior public.commercial_lead_activity; payload jsonb; owner_lead uuid;
begin
  if p_operation_id is null or p_revision is null or p_revision<0 or p_action is null
    or p_action not in ('schedule_callback','complete_callback','cancel_callback')
    or coalesce(trim(p_actor->>'id'),'')='' or coalesce(trim(p_actor->>'name'),'')=''
    or coalesce(trim(p_note),'')='' or length(p_note)>1000 then
    raise exception 'Authenticated callback details and a note are required' using errcode='22023';
  end if;
  select lead_id into owner_lead from public.commercial_consultation_requests where response_token=p_token;
  perform 1 from public.commercial_leads where lead_id=owner_lead and attribution->>'market'='residential' for update;
  if not found then raise exception 'Homeowner inquiry not found' using errcode='22023'; end if;
  select * into req from public.commercial_consultation_requests where response_token=p_token;
  if req.metadata->>'request_kind' is distinct from 'residential_inquiry' then
    raise exception 'Homeowner inquiry required' using errcode='22023';
  end if;
  insert into public.commercial_lead_operations(lead_id) values(owner_lead) on conflict do nothing;
  select * into op from public.commercial_lead_operations where lead_id=owner_lead for update;
  payload:=jsonb_build_object('action',p_action,'dueAt',p_due_at,'note',trim(p_note));
  select * into prior from public.commercial_lead_activity where operation_id=p_operation_id;
  if found then
    if prior.lead_id<>owner_lead or prior.actor_id<>p_actor->>'id' or prior.action<>'residential_callback' or prior.payload<>payload then
      raise exception 'Operation key reused for different callback details' using errcode='22023';
    end if;
    return to_jsonb(op);
  end if;
  if op.residential_callback_revision<>p_revision then raise exception 'Callback changed; reload before saving' using errcode='40001'; end if;
  if req.status<>'approved' or op.disposition='closed' or op.completed_at is not null then
    raise exception 'Accept follow-up and reopen the lead before scheduling a callback' using errcode='22023';
  end if;
  if p_action='schedule_callback' and (p_due_at is null or not isfinite(p_due_at) or p_due_at<=clock_timestamp()) then
    raise exception 'Choose a future callback time' using errcode='22023';
  end if;
  if p_action<>'schedule_callback' and (op.residential_callback_status<>'scheduled' or p_due_at is not null) then
    raise exception 'Choose a currently scheduled callback to complete or cancel' using errcode='22023';
  end if;
  update public.commercial_lead_operations set revision=revision+1,
    responsible_id=p_actor->>'id',responsible_name=p_actor->>'name',
    next_follow_up_at=case when p_action='schedule_callback' then p_due_at end,
    residential_callback_status=case p_action when 'schedule_callback' then 'scheduled' when 'complete_callback' then 'completed' else 'cancelled' end,
    disposition_reason=trim(p_note),updated_at=clock_timestamp() where lead_id=owner_lead returning * into op;
  insert into public.commercial_lead_activity(operation_id,lead_id,revision,actor_id,actor_name,action,payload)
    values(p_operation_id,owner_lead,op.revision,p_actor->>'id',p_actor->>'name','residential_callback',payload);
  return to_jsonb(op);
end $$;

create function public.h2s_claim_residential_notice(p_notice_id uuid,p_now timestamptz,p_owner_phone text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare notice public.residential_notices; lead public.commercial_leads; req public.commercial_consultation_requests;
  op public.commercial_lead_operations; booking public.commercial_reservations; effect public.commercial_effects;
begin
  if p_now is null or not isfinite(p_now) then raise exception 'Valid notice clock required' using errcode='22023'; end if;
  select * into notice from public.residential_notices where notice_id=p_notice_id;
  if not found then raise exception 'Notice not found' using errcode='22023'; end if;
  -- Match reservation writers' lock order; the existing effect ledger claims
  -- the send inside this transaction, after the authoritative state check.
  perform 1 from public.commercial_calendar where singleton for update;
  select * into lead from public.commercial_leads where lead_id=notice.lead_id for update;
  select * into op from public.commercial_lead_operations where lead_id=notice.lead_id for update;
  select * into req from public.commercial_consultation_requests where request_id=notice.request_id for update;
  select * into notice from public.residential_notices where notice_id=p_notice_id for update;
  select * into booking from public.commercial_reservations where lead_id=notice.lead_id;
  if notice.state<>'pending' or notice.due_at>p_now then return jsonb_build_object('action','not_due'); end if;
  if notice.expires_at<=p_now then
    update public.residential_notices set state='expired',updated_at=clock_timestamp() where notice_id=p_notice_id;
    return jsonb_build_object('action','expired');
  end if;
  if lead.attribution->>'market' is distinct from 'residential' or req.status<>'approved'
    or req.metadata->>'request_kind' is distinct from 'residential_inquiry'
    or (notice.kind='owner_callback' and (op.disposition='closed' or op.completed_at is not null
      or op.residential_callback_status<>'scheduled' or op.residential_callback_revision<>notice.version
      or op.next_follow_up_at is distinct from notice.expires_at))
    or (notice.kind<>'owner_callback' and (booking.lead_id is null or booking.revision<>notice.version
      or (notice.kind='customer_cancellation' and booking.state<>'cancelled')
      or (notice.kind<>'customer_cancellation' and (booking.state<>'confirmed' or booking.starts_at is distinct from notice.expires_at)))) then
    update public.residential_notices set state='superseded',updated_at=clock_timestamp() where notice_id=p_notice_id;
    return jsonb_build_object('action','superseded');
  end if;
  if p_owner_phone is null or req.assigned_technician_phone is distinct from p_owner_phone or lead.phone=p_owner_phone then
    update public.residential_notices set state='review_required',details='{"reason":"Reviewer routing changed"}',updated_at=clock_timestamp() where notice_id=p_notice_id;
    return jsonb_build_object('action','routing_review_required');
  end if;
  if notice.kind like 'customer_%' and (lead.contact_preference<>'sms'
    or lead.attribution#>'{communicationConsent,smsOptIn}' is distinct from 'true'::jsonb) then
    update public.residential_notices set state='skipped',details='{"reason":"Customer texting consent unavailable"}',updated_at=clock_timestamp() where notice_id=p_notice_id;
    return jsonb_build_object('action','consent_skipped');
  end if;
  if notice.kind='customer_installation' and not exists(select 1 from public.residential_notices
    where request_id=notice.request_id and version=notice.version and kind='customer_confirmation' and state='accepted') then
    return jsonb_build_object('action','confirmation_pending');
  end if;
  if not public.commercial_claim_effect(req.request_id,'residential_notice:'||notice.notice_id::text) then
    select * into effect from public.commercial_effects where request_id=req.request_id and kind='residential_notice:'||notice.notice_id::text;
    if effect.state='processing' and effect.updated_at>clock_timestamp()-interval '5 minutes' then
      return jsonb_build_object('action','already_claimed');
    end if;
    update public.residential_notices set state=case when effect.state='accepted' then 'accepted' else 'review_required' end,
      details=coalesce(effect.details,'{}'),updated_at=clock_timestamp() where notice_id=p_notice_id;
    return jsonb_build_object('action',case when effect.state='accepted' then 'already_claimed' else 'reconciliation_required' end);
  end if;
  return jsonb_build_object('action','send','notice',to_jsonb(notice),'lead',to_jsonb(lead),'request',to_jsonb(req),
    'callback',to_jsonb(op),'booking',case when booking.lead_id is not null then to_jsonb(booking) end);
end $$;
create function public.h2s_finish_residential_notice(p_notice_id uuid,p_result jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare notice public.residential_notices; effect_state text;
begin
  select * into notice from public.residential_notices where notice_id=p_notice_id;
  if not found or jsonb_typeof(p_result) is distinct from 'object' or not (p_result ? 'ok') then
    raise exception 'Valid notice result required' using errcode='22023';
  end if;
  effect_state:=case when p_result->>'ok'='true' then 'accepted' when p_result->>'retrySafe'='true' then 'failed' else 'uncertain' end;
  perform public.commercial_finish_effect(notice.request_id,'residential_notice:'||notice.notice_id::text,effect_state,p_result);
  update public.residential_notices set state=case when p_result->>'ok'='true' then 'accepted' else 'review_required' end,
    details=p_result,updated_at=clock_timestamp() where notice_id=p_notice_id and state='pending';
end $$;
revoke all on function public.h2s_residential_callback_guard(),public.h2s_enqueue_residential_callback(),
  public.h2s_enqueue_residential_booking(),public.h2s_residential_workspace_ready(),
  public.h2s_record_residential_callback(text,integer,uuid,jsonb,text,timestamptz,text),
  public.h2s_claim_residential_notice(uuid,timestamptz,text),public.h2s_finish_residential_notice(uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.h2s_residential_workspace_ready(),
  public.h2s_record_residential_callback(text,integer,uuid,jsonb,text,timestamptz,text),
  public.h2s_claim_residential_notice(uuid,timestamptz,text),public.h2s_finish_residential_notice(uuid,jsonb) to service_role;
