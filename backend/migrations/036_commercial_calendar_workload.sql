-- Review-only. No scheduler, outbound sends, orders or jobs are created.
alter table public.commercial_lead_operations add column hold_until timestamptz,
  add column closure_outcome text,add column sales_chasing_paused boolean not null default false;
create table public.commercial_calendar (
  singleton boolean primary key default true check(singleton),
  name text not null default 'Home2Smart installation calendar',
  revision bigint not null default 0
);
insert into public.commercial_calendar(singleton) values(true);
create table public.commercial_reservations (
  lead_id uuid primary key references public.commercial_leads(lead_id),
  revision integer not null check(revision>0),
  state text not null check(state in ('tentative','confirmed','cancelled','completed')),
  starts_at timestamptz not null,
  ends_at timestamptz not null constraint commercial_reservations_window_check check(ends_at>starts_at),
  expires_at timestamptz,
  timezone text not null,
  reason text not null check(reason ~ '[^[:space:]]'),
  updated_at timestamptz not null default clock_timestamp(),
  check(state<>'tentative' or expires_at is not null)
);
create table public.commercial_calendar_activity (
  operation_id uuid primary key,
  lead_id uuid not null references public.commercial_leads(lead_id),
  actor_id text not null,
  actor_name text not null,
  action text not null,
  input jsonb not null,
  before_state jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index commercial_reservations_window on public.commercial_reservations(starts_at,ends_at);
alter table public.commercial_calendar enable row level security;
alter table public.commercial_reservations enable row level security;
alter table public.commercial_calendar_activity enable row level security;
revoke all on public.commercial_calendar,public.commercial_reservations,public.commercial_calendar_activity
  from public,anon,authenticated,service_role;
grant select on public.commercial_calendar,public.commercial_reservations,public.commercial_calendar_activity to service_role;

create function public.commercial_guard_reservation() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- A real row update serializes READ COMMITTED writers and rejects stale
  -- repeatable-read snapshots. Capacity checks cannot race across leads.
  update public.commercial_calendar set revision=revision+1 where singleton;
  if new.state='confirmed' or (new.state='tentative' and new.expires_at>clock_timestamp()) then
    if exists(select 1 from public.commercial_reservations r where r.lead_id<>new.lead_id
      and (r.state='confirmed' or (r.state='tentative' and r.expires_at>clock_timestamp()))
      and r.starts_at<new.ends_at and new.starts_at<r.ends_at) then
      raise exception 'That time is reserved on the shared Home2Smart calendar' using errcode='23P01';
    end if;
  end if;
  return new;
end $$;
create trigger commercial_reservation_capacity before insert or update on public.commercial_reservations
  for each row execute function public.commercial_guard_reservation();

create function public.commercial_guard_workload() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.disposition='closed' then
    new.sales_chasing_paused:=true;
    new.next_follow_up_at:=null;
    new.hold_until:=null;
    new.closure_outcome:=coalesce(new.closure_outcome,'other');
  else
    new.closure_outcome:=null;
  end if;
  if new.hold_until>clock_timestamp() then new.sales_chasing_paused:=true; end if;
  return new;
end $$;
create trigger commercial_workload_guard before insert or update on public.commercial_lead_operations
  for each row execute function public.commercial_guard_workload();

create function public.commercial_record_workload(
  p_lead_id uuid,p_revision integer,p_operation_id uuid,p_actor jsonb,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  intent text:=p_payload->>'intent';
  due timestamptz:=nullif(p_payload->>'nextFollowUpAt','')::timestamptz;
  payload jsonb;
  result jsonb;
  prior public.commercial_lead_activity;
begin
  perform 1 from public.commercial_leads where lead_id=p_lead_id for update;
  select * into prior from public.commercial_lead_activity where operation_id=p_operation_id;
  if found then
    if prior.lead_id<>p_lead_id or prior.actor_id is distinct from p_actor->>'id'
      or prior.payload->'workload' is distinct from p_payload then
      raise exception 'Operation key reused for different content' using errcode='22023';
    end if;
    return (select to_jsonb(o) from public.commercial_lead_operations o where lead_id=p_lead_id);
  end if;
  if intent not in ('next_action','hold','close','reopen') or intent is null
    or coalesce(p_payload->>'reason','') !~ '[^[:space:]]'
    or (intent in ('hold','next_action') and (due is null or not isfinite(due) or due<=clock_timestamp()))
    or (intent='close' and coalesce(p_payload->>'outcome','') not in
      ('won','declined','no_response','duplicate','not_a_fit','other')) then
    raise exception 'Choose an action, reason, and a future due time for next action or hold' using errcode='22023';
  end if;
  if intent in ('hold','next_action') and (nullif(trim(p_payload->>'responsibleId'),'') is null
    or nullif(trim(p_payload->>'responsibleName'),'') is null) then
    raise exception 'Responsible staff required' using errcode='22023';
  end if;
  if p_payload->>'resumeConsultationChasing'='true' and (intent not in ('next_action','reopen')
    or not exists(select 1 from public.commercial_consultation_requests where lead_id=p_lead_id
      and status in ('pending','escalated','reschedule_requested') and related_order_id is null
      and selected_slot_start>clock_timestamp() and coalesce(metadata->>'request_kind','')<>'manual_follow_up')) then
    raise exception 'Review a pending consultation with a future window before explicitly resuming its reminders' using errcode='22023';
  end if;
  payload:=jsonb_build_object('responsibleId',p_payload->>'responsibleId',
    'responsibleName',p_payload->>'responsibleName','disposition',case when intent='close' then 'closed' else 'open' end,
    'reason',p_payload->>'reason','nextFollowUpAt',case when intent in ('hold','next_action') then due::text else '' end,
    'followUp',jsonb_build_object('mode','manual','reason',p_payload->>'reason'),'workload',p_payload);
  result:=public.commercial_record_follow_up(p_lead_id,p_revision,p_operation_id,p_actor,payload);
  update public.commercial_lead_operations set hold_until=case when intent='hold' then due else null end,
    closure_outcome=case when intent='close' then p_payload->>'outcome' else null end,
    sales_chasing_paused=case when intent in ('hold','close') then true
      when p_payload->>'resumeConsultationChasing'='true' then false else sales_chasing_paused end where lead_id=p_lead_id;
  return (select to_jsonb(o) from public.commercial_lead_operations o where lead_id=p_lead_id);
end $$;

create function public.commercial_record_reservation(
  p_lead_id uuid,p_revision integer,p_operation_id uuid,p_actor jsonb,p_action text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  old public.commercial_reservations;
  saved public.commercial_reservations;
  prior public.commercial_calendar_activity;
  operation public.commercial_lead_operations;
  start_at timestamptz;
  end_at timestamptz;
  expiry timestamptz;
begin
  if nullif(trim(p_actor->>'id'),'') is null or nullif(trim(p_actor->>'name'),'') is null
    or p_operation_id is null or p_revision is null or p_revision<0
    or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Authenticated operation details required' using errcode='22023';
  end if;
  update public.commercial_calendar set revision=revision+1 where singleton;
  perform 1 from public.commercial_leads where lead_id=p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode='22023'; end if;
  select * into old from public.commercial_reservations where lead_id=p_lead_id for update;
  select * into prior from public.commercial_calendar_activity where operation_id=p_operation_id;
  if found then
    if prior.lead_id<>p_lead_id or prior.actor_id<>p_actor->>'id' or prior.action<>p_action or prior.input<>p_payload then
      raise exception 'Operation key reused for different content' using errcode='22023';
    end if;
    return to_jsonb(old);
  end if;
  if coalesce(old.revision,0)<>p_revision then raise exception 'Reservation changed; reload before saving' using errcode='40001'; end if;
  if coalesce(p_payload->>'reason','') !~ '[^[:space:]]' or length(p_payload->>'reason')>1000
    or p_action not in ('hold','confirm','reschedule','cancel') or p_action is null then
    raise exception 'Choose a calendar action and reason' using errcode='22023';
  end if;
  select * into operation from public.commercial_lead_operations where lead_id=p_lead_id;
  if operation.installation_job_id is not null and exists(select 1 from public.h2s_dispatch_jobs
    where job_id=operation.installation_job_id and status not in ('queued','assigned')) then
    raise exception 'Installation already started or ended; reconcile it before changing the calendar' using errcode='22023';
  end if;
  if p_action='cancel' then
    if old.lead_id is null or old.state='cancelled' then raise exception 'No active reservation to cancel' using errcode='22023'; end if;
    saved:=old;
    saved.state:='cancelled';
    saved.expires_at:=null;
  else
    if p_action='hold' and old.state='confirmed' then
      raise exception 'Reschedule or cancel a confirmed booking explicitly' using errcode='22023';
    end if;
    if p_action='reschedule' and (old.lead_id is null or old.state='cancelled'
      or (old.state='tentative' and old.expires_at<=clock_timestamp())) then
      raise exception 'Create a new hold or confirm an agreed booking' using errcode='22023';
    end if;
    if p_action='confirm' and coalesce(p_payload->>'customerAgreed','')<>'true' then
      raise exception 'Explicit customer agreement is required to confirm' using errcode='22023';
    end if;
    if p_action='reschedule' and old.state='confirmed' and coalesce(p_payload->>'customerAgreed','')<>'true' then
      raise exception 'Confirm customer agreement to the changed window' using errcode='22023';
    end if;
    start_at:=(p_payload->>'start')::timestamptz;
    end_at:=(p_payload->>'end')::timestamptz;
    expiry:=nullif(p_payload->>'expiresAt','')::timestamptz;
    if start_at is null or end_at is null or not isfinite(start_at) or not isfinite(end_at)
      or start_at<=clock_timestamp() or end_at<=start_at
      or not exists(select 1 from pg_timezone_names where name=p_payload->>'timezone') then
      raise exception 'Use a future start, later end and valid time zone' using errcode='22023';
    end if;
    saved.state:=case when p_action='confirm' then 'confirmed' when p_action='reschedule' then old.state else 'tentative' end;
    if saved.state='tentative' and (expiry is null or not isfinite(expiry) or expiry<=clock_timestamp()) then
      raise exception 'A tentative hold requires a staff-selected future expiry' using errcode='22023';
    end if;
    saved.starts_at:=start_at; saved.ends_at:=end_at;
    saved.expires_at:=case when saved.state='tentative' then expiry else null end;
    saved.timezone:=p_payload->>'timezone';
  end if;
  saved.lead_id:=p_lead_id; saved.revision:=p_revision+1;
  saved.reason:=p_payload->>'reason'; saved.updated_at:=clock_timestamp();
  insert into public.commercial_reservations values(saved.*)
    on conflict(lead_id) do update set revision=excluded.revision,state=excluded.state,starts_at=excluded.starts_at,
      ends_at=excluded.ends_at,expires_at=excluded.expires_at,timezone=excluded.timezone,reason=excluded.reason,updated_at=excluded.updated_at;
  insert into public.commercial_calendar_activity(operation_id,lead_id,actor_id,actor_name,action,input,before_state,after_state)
    values(p_operation_id,p_lead_id,p_actor->>'id',p_actor->>'name',p_action,p_payload,
      case when old.lead_id is not null then to_jsonb(old) end,to_jsonb(saved));
  if operation.installation_job_id is not null and saved.state in ('confirmed','cancelled') then
    update public.h2s_dispatch_jobs set due_at=case when saved.state='confirmed' then saved.starts_at end,updated_at=now()
      where job_id=operation.installation_job_id;
    update public.h2s_orders set
      delivery_date=case when saved.state='confirmed' then (saved.starts_at at time zone saved.timezone)::date end,
      delivery_time=case when saved.state='confirmed' then
        to_char(saved.starts_at at time zone saved.timezone,'HH24:MI')||' - '||to_char(saved.ends_at at time zone saved.timezone,'HH24:MI') end,
      metadata_json=(coalesce(metadata_json,'{}')-'scheduled_date'-'scheduled_end'-'scheduled_tz'-'time_window'-'schedule_status')
        ||case when saved.state='confirmed' then jsonb_build_object('scheduled_date',saved.starts_at,
          'scheduled_end',saved.ends_at,'scheduled_tz',saved.timezone,'schedule_status','Scheduled') else '{}'::jsonb end,
      updated_at=now() where id=operation.order_id;
  end if;
  return to_jsonb(saved);
end $$;

-- Deferred synchronization sees the final order + job pair, including legacy
-- schedule writes. Incomplete or conflicting windows fail the entire transaction.
create function public.commercial_sync_calendar() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  op public.commercial_lead_operations;
  job public.h2s_dispatch_jobs;
  ord public.h2s_orders;
  reservation public.commercial_reservations;
  finish timestamptz;
  zone text;
begin
  for op in select * from public.commercial_lead_operations where installation_job_id is not null
    and ((tg_table_name='commercial_lead_operations' and lead_id=(to_jsonb(new)->>'lead_id')::uuid)
      or (tg_table_name='h2s_dispatch_jobs' and installation_job_id=(to_jsonb(new)->>'job_id')::uuid)
      or (tg_table_name='h2s_orders' and order_id=(to_jsonb(new)->>'id')::uuid))
  loop
    update public.commercial_calendar set revision=revision+1 where singleton;
    select * into job from public.h2s_dispatch_jobs where job_id=op.installation_job_id;
    select * into ord from public.h2s_orders where id=op.order_id;
    select * into reservation from public.commercial_reservations where lead_id=op.lead_id;
    if job.status in ('completed','done','cancelled') then
      if reservation.state in ('tentative','confirmed') then
        update public.commercial_reservations set state=case when job.status='cancelled' then 'cancelled' else 'completed' end,
          expires_at=null,revision=revision+1,reason='Linked installation '||job.status,updated_at=clock_timestamp() where lead_id=op.lead_id;
        insert into public.commercial_calendar_activity values(gen_random_uuid(),op.lead_id,'installation-sync','Installation schedule',
          'installation_ended','{}',to_jsonb(reservation),(select to_jsonb(r) from public.commercial_reservations r where lead_id=op.lead_id),clock_timestamp());
      end if;
      continue;
    end if;
    finish:=nullif(ord.metadata_json->>'scheduled_end','')::timestamptz;
    zone:=coalesce(nullif(ord.metadata_json->>'scheduled_tz',''),'UTC');
    if tg_table_name='commercial_lead_operations' and job.due_at is null and finish is null and reservation.state='confirmed' then
      perform public.commercial_record_reservation(op.lead_id,reservation.revision,gen_random_uuid(),
        jsonb_build_object('id','calendar-link','name','Existing installation link'),'reschedule',
        jsonb_build_object('start',reservation.starts_at,'end',reservation.ends_at,'timezone',reservation.timezone,
          'customerAgreed',true,'reason','Apply existing agreed reservation to explicitly linked installation'));
      continue;
    end if;
    if job.due_at is null and finish is null then
      if reservation.state='confirmed' then
        update public.commercial_reservations set state='cancelled',expires_at=null,revision=revision+1,
          reason='Existing installation window explicitly removed',updated_at=clock_timestamp() where lead_id=op.lead_id;
        insert into public.commercial_calendar_activity values(gen_random_uuid(),op.lead_id,'installation-sync','Installation schedule',
          'cancel','{}',to_jsonb(reservation),(select to_jsonb(r) from public.commercial_reservations r where lead_id=op.lead_id),clock_timestamp());
      end if;
      continue;
    end if;
    if job.due_at is null or finish is null or finish<=job.due_at or not isfinite(finish)
      or not isfinite(job.due_at) then
      raise exception 'Linked installation needs a complete valid start/end window before calendar adoption' using errcode='22023';
    end if;
    if reservation.state='confirmed' and reservation.starts_at=job.due_at and reservation.ends_at=finish then continue; end if;
    if reservation.state='tentative' and reservation.expires_at>clock_timestamp() then
      raise exception 'Resolve the tentative reservation before changing the linked installation window' using errcode='22023';
    end if;
    insert into public.commercial_reservations values(op.lead_id,coalesce(reservation.revision,0)+1,'confirmed',
      job.due_at,finish,null,zone,'Existing installation window',clock_timestamp())
    on conflict(lead_id) do update set revision=excluded.revision,state=excluded.state,starts_at=excluded.starts_at,
      ends_at=excluded.ends_at,expires_at=null,timezone=excluded.timezone,reason=excluded.reason,updated_at=excluded.updated_at;
    insert into public.commercial_calendar_activity values(gen_random_uuid(),op.lead_id,'installation-sync','Installation schedule',
      'installation_window','{}',case when reservation.lead_id is not null then to_jsonb(reservation) end,
      (select to_jsonb(r) from public.commercial_reservations r where lead_id=op.lead_id),clock_timestamp());
  end loop;
  return null;
end $$;
create constraint trigger commercial_calendar_order_sync after update on public.h2s_orders
  deferrable initially deferred for each row execute function public.commercial_sync_calendar();
create constraint trigger commercial_calendar_job_sync after update on public.h2s_dispatch_jobs
  deferrable initially deferred for each row execute function public.commercial_sync_calendar();
create constraint trigger commercial_calendar_link_sync after insert or update of installation_job_id on public.commercial_lead_operations
  deferrable initially deferred for each row execute function public.commercial_sync_calendar();
-- Reconcile existing linked windows through the same guarded path; no guessed
-- duration, no silently discarded overlap, no changes to their saved instants.
update public.commercial_lead_operations set installation_job_id=installation_job_id where installation_job_id is not null;
set constraints commercial_calendar_link_sync immediate;
set constraints commercial_calendar_link_sync deferred;

create table public.h2s_job_preparation (
  job_id uuid primary key references public.h2s_dispatch_jobs(job_id),
  revision integer not null check(revision>0),
  scope_reviewed boolean not null,
  materials text not null check(materials in ('unreviewed','blocked','ready','not_required')),
  access text not null check(access in ('unreviewed','blocked','ready')),
  blockers text not null check(length(blockers)<=4000),
  note text not null check(note ~ '[^[:space:]]' and length(note)<=4000),
  context jsonb not null check(jsonb_typeof(context)='object'),
  updated_by jsonb not null,
  updated_at timestamptz not null default clock_timestamp()
);
create table public.h2s_job_preparation_activity (
  operation_id uuid primary key,
  job_id uuid not null references public.h2s_dispatch_jobs(job_id),
  revision integer not null,
  actor_id text not null,
  actor_name text not null,
  payload jsonb not null,
  before_state jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(job_id,revision)
);
alter table public.h2s_job_preparation enable row level security;
alter table public.h2s_job_preparation_activity enable row level security;
revoke all on public.h2s_job_preparation,public.h2s_job_preparation_activity from public,anon,authenticated,service_role;
grant select on public.h2s_job_preparation,public.h2s_job_preparation_activity to service_role;

create function public.h2s_job_readiness(p_job_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  job public.h2s_dispatch_jobs;
  ord public.h2s_orders;
  prep public.h2s_job_preparation;
  context jsonb;
  reasons text[];
begin
  select * into job from public.h2s_dispatch_jobs where job_id=p_job_id;
  if not found then raise exception 'Job not found' using errcode='P0002'; end if;
  if (select count(*) from public.h2s_orders where id::text=job.order_id or order_id=job.order_id)<>1 then
    raise exception 'Reconcile the job/order relationship before preparation' using errcode='22023';
  end if;
  select * into ord from public.h2s_orders where id::text=job.order_id or order_id=job.order_id;
  select * into prep from public.h2s_job_preparation where job_id=p_job_id;
  context:=jsonb_build_object('orderId',ord.id,'scope',to_jsonb(ord)->'items','service',to_jsonb(ord)->'service_name',
    'instructions',to_jsonb(ord)->'special_instructions','address',ord.address,'city',ord.city,'state',ord.state,'zip',ord.zip,
    'start',job.due_at,'end',ord.metadata_json->'scheduled_end','equipmentRequired',ord.metadata_json->'order_required',
    'equipmentStage',ord.metadata_json->'order_stage','jobEquipment',to_jsonb(job)#>'{metadata,order_stage}');
  reasons:=array_remove(array[
    case when not coalesce(prep.scope_reviewed,false) then 'Review the existing job scope' end,
    case when coalesce(prep.materials,'unreviewed') not in ('ready','not_required') then 'Resolve materials preparation' end,
    case when coalesce(prep.access,'unreviewed')<>'ready' then 'Review site access and work location' end,
    case when nullif(trim(prep.blockers),'') is not null then prep.blockers end,
    case when ord.metadata_json->>'order_required'='true' and coalesce(ord.metadata_json->>'order_stage','') not in ('DELIVERED','NOT_NEEDED')
      then 'Existing equipment ordering must be delivered before start' end,
    case when to_jsonb(job)#>>'{metadata,order_stage}' is not null and ord.metadata_json->>'order_stage' is not null
      and to_jsonb(job)#>>'{metadata,order_stage}'<>ord.metadata_json->>'order_stage'
      then 'Job and order equipment states differ; reconcile the existing records' end,
    case when prep.job_id is not null and prep.context is distinct from context then 'Scope, work location, equipment or schedule changed; review preparation again' end
  ],null);
  return jsonb_build_object('record',case when prep.job_id is not null then to_jsonb(prep) end,
    'context',context,'ready',cardinality(reasons)=0,'blockers',to_jsonb(reasons));
end $$;

create function public.h2s_record_job_preparation(
  p_job_id uuid,p_revision integer,p_operation_id uuid,p_actor jsonb,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  job public.h2s_dispatch_jobs;
  ord public.h2s_orders;
  prep public.h2s_job_preparation;
  prior public.h2s_job_preparation_activity;
  saved public.h2s_job_preparation;
begin
  if p_job_id is null or p_operation_id is null or p_revision is null or p_revision<0
    or nullif(trim(p_actor->>'id'),'') is null or nullif(trim(p_actor->>'name'),'') is null
    or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Valid preparation operation and authenticated actor required' using errcode='22023';
  end if;
  -- Match existing operation lock order: order, then job. The job lock also
  -- serializes preparation edits against start, including non-Commercial callers.
  select o.* into ord from public.h2s_orders o join public.h2s_dispatch_jobs j
    on j.order_id in (o.id::text,o.order_id) where j.job_id=p_job_id for update of o;
  select * into job from public.h2s_dispatch_jobs where job_id=p_job_id for update;
  if job.job_id is null or ord.id is null then raise exception 'Linked job/order required' using errcode='22023'; end if;
  select * into prior from public.h2s_job_preparation_activity where operation_id=p_operation_id;
  if found then
    if prior.job_id<>p_job_id or prior.actor_id<>p_actor->>'id' or prior.payload<>p_payload then
      raise exception 'Preparation operation key reused for different content' using errcode='22023';
    end if;
    return public.h2s_job_readiness(p_job_id);
  end if;
  select * into prep from public.h2s_job_preparation where job_id=p_job_id for update;
  if coalesce(prep.revision,0)<>p_revision
    or p_payload->'context' is distinct from public.h2s_job_readiness(p_job_id)->'context'
    or job.updated_at is distinct from (p_payload->>'expectedJobUpdatedAt')::timestamptz
    or ord.updated_at is distinct from (p_payload->>'expectedOrderUpdatedAt')::timestamptz then
    raise exception 'Job, order or preparation changed; review latest before saving' using errcode='40001';
  end if;
  if job.status not in ('queued','assigned') then raise exception 'Preparation is editable only before work starts' using errcode='22023'; end if;
  if jsonb_typeof(p_payload->'scopeReviewed') is distinct from 'boolean'
    or coalesce(p_payload->>'materials','') not in ('unreviewed','blocked','ready','not_required')
    or coalesce(p_payload->>'access','') not in ('unreviewed','blocked','ready')
    or nullif(trim(p_payload->>'note'),'') is null or length(p_payload->>'note')>4000
    or length(coalesce(p_payload->>'blockers',''))>4000 then
    raise exception 'Valid scope, materials, site review and notes required' using errcode='22023';
  end if;
  insert into public.h2s_job_preparation values(p_job_id,p_revision+1,(p_payload->>'scopeReviewed')::boolean,
    p_payload->>'materials',p_payload->>'access',coalesce(trim(p_payload->>'blockers'),''),trim(p_payload->>'note'),
    public.h2s_job_readiness(p_job_id)->'context',p_actor,clock_timestamp())
    on conflict(job_id) do update set revision=excluded.revision,scope_reviewed=excluded.scope_reviewed,
      materials=excluded.materials,access=excluded.access,blockers=excluded.blockers,note=excluded.note,
      context=excluded.context,updated_by=excluded.updated_by,updated_at=excluded.updated_at returning * into saved;
  update public.h2s_dispatch_jobs set updated_at=clock_timestamp() where job_id=p_job_id;
  insert into public.h2s_job_preparation_activity values(p_operation_id,p_job_id,saved.revision,
    p_actor->>'id',p_actor->>'name',p_payload,case when prep.job_id is not null then to_jsonb(prep) end,to_jsonb(saved),clock_timestamp());
  return public.h2s_job_readiness(p_job_id);
end $$;

create function public.h2s_guard_job_preparation() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status in ('completed','done') and exists(select 1 from public.commercial_lead_operations o
    where o.installation_job_id=new.job_id
      and current_setting('h2s.commercial_completion',true) is distinct from o.lead_id::text) then
    raise exception 'Complete linked Commercial work through its staff-controlled job detail; automatic payout/messages are not authorized'
      using errcode='22023';
  end if;
  if new.status in ('in_progress','in-progress','started') and old.status is distinct from new.status
    and (exists(select 1 from public.commercial_lead_operations where installation_job_id=new.job_id)
      or exists(select 1 from public.h2s_job_preparation where job_id=new.job_id)) then
    if new.due_at is distinct from old.due_at or new.order_id is distinct from old.order_id then
      raise exception 'Job schedule/order changed; review preparation before starting' using errcode='22023';
    end if;
    perform 1 from public.h2s_job_preparation where job_id=new.job_id for share;
    if not (public.h2s_job_readiness(new.job_id)->>'ready')::boolean then
      raise exception 'Preparation blockers must be resolved and reviewed before starting work' using errcode='22023';
    end if;
    if exists(select 1 from public.commercial_lead_operations o where o.installation_job_id=new.job_id
      and not exists(select 1 from public.commercial_reservations r where r.lead_id=o.lead_id
        and r.state='confirmed' and r.starts_at=new.due_at)) then
      raise exception 'Confirm the installation reservation before starting work' using errcode='22023';
    end if;
  end if;
  return new;
end $$;
create trigger h2s_job_preparation_start before update of status on public.h2s_dispatch_jobs
  for each row execute function public.h2s_guard_job_preparation();

create function public.commercial_record_job_operation(
  p_lead_id uuid,p_revision integer,p_operation_id uuid,p_actor jsonb,p_action text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if p_action not in ('start','complete') then raise exception 'Choose start or complete' using errcode='22023'; end if;
  perform set_config('h2s.commercial_completion',p_lead_id::text,true);
  result:=public.commercial_record_operation(p_lead_id,p_revision,p_operation_id,p_actor,p_action,p_payload);
  perform set_config('h2s.commercial_completion','',true);
  return result;
end $$;

create function public.commercial_record_work_location(
  p_lead_id uuid,p_revision integer,p_operation_id uuid,p_actor jsonb,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare result jsonb; op public.commercial_lead_operations; ord public.h2s_orders; job public.h2s_dispatch_jobs;
begin
  perform 1 from public.commercial_leads where lead_id=p_lead_id for update;
  if exists(select 1 from public.commercial_lead_activity where operation_id=p_operation_id) then
    return public.commercial_record_operation(p_lead_id,p_revision,p_operation_id,p_actor,'location',p_payload);
  end if;
  result:=public.commercial_record_operation(p_lead_id,p_revision,p_operation_id,p_actor,'location',p_payload);
  select * into op from public.commercial_lead_operations where lead_id=p_lead_id;
  select * into ord from public.h2s_orders where id=op.order_id for update;
  select * into job from public.h2s_dispatch_jobs where job_id=op.installation_job_id for update;
  if job.job_id is null or job.status not in ('queued','assigned') or nullif(trim(p_payload->>'address'),'') is null then
    raise exception 'A linked, unstarted job and work address are required' using errcode='22023';
  end if;
  if ord.updated_at is distinct from (p_payload->>'expectedOrderUpdatedAt')::timestamptz
    or job.updated_at is distinct from (p_payload->>'expectedJobUpdatedAt')::timestamptz then
    raise exception 'Job/order changed; review before applying the work location' using errcode='40001';
  end if;
  update public.h2s_orders set address=p_payload->>'address',city=p_payload->>'city',
    state=p_payload->>'state',zip=p_payload->>'postalCode',updated_at=clock_timestamp() where id=ord.id;
  update public.h2s_dispatch_jobs set updated_at=clock_timestamp() where job_id=job.job_id;
  return result;
end $$;
revoke all on function public.h2s_job_readiness(uuid),
  public.h2s_record_job_preparation(uuid,integer,uuid,jsonb,jsonb),public.h2s_guard_job_preparation(),
  public.commercial_record_job_operation(uuid,integer,uuid,jsonb,text,jsonb),
  public.commercial_record_work_location(uuid,integer,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.h2s_job_readiness(uuid),
  public.h2s_record_job_preparation(uuid,integer,uuid,jsonb,jsonb),
  public.commercial_record_job_operation(uuid,integer,uuid,jsonb,text,jsonb),
  public.commercial_record_work_location(uuid,integer,uuid,jsonb,jsonb) to service_role;

create function public.commercial_calendar_snapshot(p_start timestamptz,p_end timestamptz,p_lead_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
    or p_end<=p_start or p_end-p_start>interval '62 days' then
    raise exception 'Choose a calendar range of at most 62 days' using errcode='22023';
  end if;
  return jsonb_build_object('name',(select name from public.commercial_calendar where singleton),
    'booking',(select to_jsonb(r)||jsonb_build_object('effective_state',
      case when r.state='tentative' and r.expires_at<=statement_timestamp() then 'expired' else r.state end)
      from public.commercial_reservations r where r.lead_id=p_lead_id),
    'history',coalesce((select jsonb_agg(h order by h.created_at desc) from
      (select * from public.commercial_calendar_activity where lead_id=p_lead_id order by created_at desc limit 50) h),'[]'::jsonb),
    'entries',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object(
      'customer',coalesce(nullif(l.company_name,''),nullif(l.full_name,''),'Commercial lead'),
      'location',case when j.job_id is not null then concat_ws(', ',nullif(o.address,''),nullif(o.city,''),nullif(o.state,''))
        else concat_ws(', ',nullif(l.project_address,''),nullif(l.project_city,''),nullif(l.project_state,'')) end,
      'job_id',j.job_id,'job_status',j.status,
      'preparation',case when j.job_id is not null then public.h2s_job_readiness(j.job_id)-'record'-'context' end,
      'effective_state',case when r.state='tentative' and r.expires_at<=statement_timestamp() then 'expired' else r.state end)
      order by r.starts_at,r.lead_id) from public.commercial_reservations r join public.commercial_leads l using(lead_id)
      left join public.commercial_lead_operations op using(lead_id)
      left join public.h2s_dispatch_jobs j on j.job_id=op.installation_job_id
      left join public.h2s_orders o on o.id=op.order_id
      where r.starts_at<p_end and r.ends_at>p_start),'[]'::jsonb));
end $$;

revoke all on function public.commercial_guard_reservation(),public.commercial_sync_calendar(),
  public.commercial_guard_workload(),
  public.commercial_calendar_snapshot(timestamptz,timestamptz,uuid),
  public.commercial_record_workload(uuid,integer,uuid,jsonb,jsonb),
  public.commercial_record_reservation(uuid,integer,uuid,jsonb,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.commercial_record_workload(uuid,integer,uuid,jsonb,jsonb),
  public.commercial_record_reservation(uuid,integer,uuid,jsonb,text,jsonb),
  public.commercial_calendar_snapshot(timestamptz,timestamptz,uuid) to service_role;
