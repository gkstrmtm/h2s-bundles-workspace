-- Review-only. Does not activate schedules, messaging or provider configuration.
create table public.sms_delivery_receipts (
  message_sid text primary key check (message_sid ~ '^(SM|MM)[a-fA-F0-9]{32}$'),
  account_sid text not null check (account_sid ~ '^AC[a-fA-F0-9]{32}$'),
  to_phone text not null,
  from_phone text not null,
  status text not null check (status in ('scheduled','accepted','queued','sending','sent','delivered','read','failed','undelivered','canceled')),
  status_rank integer not null,
  received_at timestamptz not null default clock_timestamp(),
  last_error_code text,
  last_error_message text,
  conflicting_terminal boolean not null default false
);
create table public.sms_delivery_events (
  message_sid text not null references public.sms_delivery_receipts(message_sid),
  event_key text not null check (event_key ~ '^[a-f0-9]{64}$'),
  status text not null,
  error_code text,
  error_message text,
  received_at timestamptz not null default clock_timestamp(),
  primary key(message_sid,event_key)
);
alter table public.sms_delivery_receipts enable row level security;
alter table public.sms_delivery_events enable row level security;
revoke all on public.sms_delivery_receipts,public.sms_delivery_events from public,anon,authenticated,service_role;
grant select on public.sms_delivery_receipts,public.sms_delivery_events to service_role;

create function public.sms_record_delivery(p_event_key text,p_event jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  receipt public.sms_delivery_receipts;
  incoming_status text:=p_event->>'status';
  incoming_rank integer;
  accepted_event boolean;
  conflict boolean;
begin
  if jsonb_typeof(p_event) is distinct from 'object' or p_event_key is null or p_event_key !~ '^[a-f0-9]{64}$'
    or coalesce(p_event->>'messageSid','') !~ '^(SM|MM)[a-fA-F0-9]{32}$'
    or coalesce(p_event->>'accountSid','') !~ '^AC[a-fA-F0-9]{32}$'
    or coalesce(p_event->>'to','') !~ '^\+[0-9]{7,15}$'
    or coalesce(p_event->>'from','') !~ '^\+[0-9]{7,15}$' then
    raise exception 'Invalid SMS delivery identity' using errcode='22023';
  end if;
  incoming_rank:=case incoming_status when 'scheduled' then 0 when 'accepted' then 10 when 'queued' then 10
    when 'sending' then 20 when 'sent' then 30 when 'failed' then 40 when 'undelivered' then 40
    when 'canceled' then 40 when 'delivered' then 50 when 'read' then 50 else null end;
  if incoming_rank is null then raise exception 'Invalid delivery status' using errcode='22023'; end if;
  insert into public.sms_delivery_receipts(message_sid,account_sid,to_phone,from_phone,status,status_rank)
    values(p_event->>'messageSid',p_event->>'accountSid',p_event->>'to',p_event->>'from',incoming_status,incoming_rank)
    on conflict do nothing;
  select * into receipt from public.sms_delivery_receipts where message_sid=p_event->>'messageSid' for update;
  if receipt.account_sid<>p_event->>'accountSid' or receipt.to_phone<>p_event->>'to' or receipt.from_phone<>p_event->>'from' then
    raise exception 'Delivery correlation mismatch' using errcode='22023';
  end if;
  insert into public.sms_delivery_events(message_sid,event_key,status,error_code,error_message)
    values(receipt.message_sid,p_event_key,incoming_status,nullif(left(p_event->>'errorCode',32),''),
      nullif(left(p_event->>'errorMessage',500),''))
    on conflict do nothing returning true into accepted_event;
  if accepted_event is not true then return to_jsonb(receipt); end if;
  conflict:=(receipt.status_rank=40 and incoming_rank=50) or (receipt.status_rank=50 and incoming_rank=40);
  update public.sms_delivery_receipts set
    status=case when incoming_rank>receipt.status_rank then incoming_status else receipt.status end,
    status_rank=greatest(incoming_rank,receipt.status_rank),
    received_at=case when incoming_rank>receipt.status_rank or (conflict and not receipt.conflicting_terminal) or not exists
      (select 1 from public.sms_delivery_events where message_sid=receipt.message_sid and event_key<>p_event_key)
      then clock_timestamp() else receipt.received_at end,
    last_error_code=coalesce(nullif(left(p_event->>'errorCode',32),''),receipt.last_error_code),
    last_error_message=coalesce(nullif(left(p_event->>'errorMessage',500),''),receipt.last_error_message),
    conflicting_terminal=receipt.conflicting_terminal or conflict
    where message_sid=receipt.message_sid returning * into receipt;
  return to_jsonb(receipt);
end $$;

create function public.commercial_record_follow_up(
  p_lead_id uuid,p_revision integer,p_operation_id uuid,p_actor jsonb,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  operation public.commercial_lead_operations;
  job_status text;
  prior public.commercial_lead_activity;
begin
  perform 1 from public.commercial_leads where lead_id=p_lead_id for update;
  select * into operation from public.commercial_lead_operations where lead_id=p_lead_id for update;
  select * into prior from public.commercial_lead_activity where operation_id=p_operation_id;
  if found then
    return public.commercial_record_operation(p_lead_id,p_revision,p_operation_id,p_actor,'follow_up',p_payload);
  end if;
  if coalesce(p_payload#>>'{followUp,mode}','') not in ('automatic','manual','customer_callback') then
    raise exception 'Explicit follow-up mode required' using errcode='22023';
  end if;
  if operation.installation_job_id is not null then
    select status into job_status from public.h2s_dispatch_jobs where job_id=operation.installation_job_id for update;
  end if;
  if p_payload#>>'{followUp,mode}'='automatic' and
    (operation.disposition='closed' or operation.completed_at is not null or job_status in ('completed','done','cancelled')
      or p_payload->>'disposition'='closed') and nullif(p_payload->>'nextFollowUpAt','') is not null then
    raise exception 'Terminal work cannot generate automatic follow-up' using errcode='40001';
  end if;
  if p_payload#>>'{followUp,mode}'='customer_callback' and nullif(p_payload->>'nextFollowUpAt','') is null
    and p_payload->>'disposition'<>'closed' then
    raise exception 'Customer callback time required' using errcode='22023';
  end if;
  return public.commercial_record_operation(p_lead_id,p_revision,p_operation_id,p_actor,'follow_up',p_payload);
end $$;
revoke all on function public.sms_record_delivery(text,jsonb),
  public.commercial_record_follow_up(uuid,integer,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.sms_record_delivery(text,jsonb),
  public.commercial_record_follow_up(uuid,integer,uuid,jsonb,jsonb) to service_role;
