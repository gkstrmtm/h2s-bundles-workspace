-- Additive, review-only until explicitly authorized through the guarded runner.
-- Existing dispatch rows, assignment states and checkout contracts are retained.
create table public.commercial_lead_operations (
  lead_id uuid primary key references public.commercial_leads(lead_id),
  revision integer not null default 0 check (revision >= 0),
  responsible_id text,
  responsible_name text,
  next_follow_up_at timestamptz,
  disposition text not null default 'open' check (disposition in ('open','closed')),
  disposition_reason text,
  order_id uuid unique references public.h2s_orders(id),
  installation_job_id uuid unique references public.h2s_dispatch_jobs(job_id),
  completed_at timestamptz,
  completed_by jsonb,
  updated_at timestamptz not null default now(),
  check ((order_id is null) = (installation_job_id is null)),
  check (disposition <> 'closed' or (disposition_reason is not null and disposition_reason ~ '[^[:space:]]'))
);
create table public.commercial_lead_activity (
  operation_id uuid primary key,
  lead_id uuid not null references public.commercial_leads(lead_id),
  revision integer not null,
  actor_id text not null,
  actor_name text not null,
  action text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(lead_id,revision)
);
create index commercial_lead_activity_history on public.commercial_lead_activity(lead_id,revision desc);
create index commercial_lead_operations_follow_up on public.commercial_lead_operations(next_follow_up_at)
  where disposition='open';
alter table public.commercial_lead_operations enable row level security;
alter table public.commercial_lead_activity enable row level security;
revoke all on public.commercial_lead_operations,public.commercial_lead_activity from public,anon,authenticated,service_role;
grant select on public.commercial_lead_operations,public.commercial_lead_activity to service_role;

create function public.commercial_record_operation(
  p_lead_id uuid,p_revision integer,p_operation_id uuid,p_actor jsonb,p_action text,p_payload jsonb
) returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $$
declare
  lead public.commercial_leads;
  operation public.commercial_lead_operations;
  prior public.commercial_lead_activity;
  ord public.h2s_orders;
  job public.h2s_dispatch_jobs;
  start_at timestamptz;
  end_at timestamptz;
  assigned_pro text;
begin
  if nullif(trim(p_actor->>'id'),'') is null or nullif(trim(p_actor->>'name'),'') is null
    or p_operation_id is null or p_revision is null or p_revision<0
    or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Invalid commercial operation' using errcode='22023';
  end if;
  select * into lead from public.commercial_leads where lead_id=p_lead_id for update;
  if not found then raise exception 'Lead not found' using errcode='P0002'; end if;
  insert into public.commercial_lead_operations(lead_id) values(p_lead_id) on conflict do nothing;
  select * into operation from public.commercial_lead_operations where lead_id=p_lead_id for update;
  select * into prior from public.commercial_lead_activity where operation_id=p_operation_id;
  if found then
    if prior.lead_id<>p_lead_id or prior.actor_id<>p_actor->>'id'
      or prior.action<>p_action or prior.payload<>p_payload then
      raise exception 'Operation key reused for different content' using errcode='22023';
    end if;
    return to_jsonb(operation);
  end if;
  if operation.revision<>p_revision then
    raise exception 'Lead changed; reload before saving. Your draft has not been applied.' using errcode='40001';
  end if;

  if p_action='follow_up' then
    if coalesce(p_payload->>'disposition','') not in ('open','closed')
      or (p_payload->>'disposition'='closed' and coalesce(p_payload->>'reason','') !~ '[^[:space:]]')
      or (p_payload ? 'contact' and (
        coalesce(p_payload#>>'{contact,channel}','') not in ('call','email','sms','other')
        or coalesce(p_payload#>>'{contact,outcome}','') not in ('no_response','reached','left_message','requested_callback','other')
        or nullif(trim(p_payload#>>'{contact,note}'),'') is null)) then
      raise exception 'Disposition, contact outcome and notes must be valid' using errcode='22023';
    end if;
    operation.responsible_id:=nullif(p_payload->>'responsibleId','');
    operation.responsible_name:=nullif(p_payload->>'responsibleName','');
    operation.next_follow_up_at:=nullif(p_payload->>'nextFollowUpAt','')::timestamptz;
    operation.disposition:=p_payload->>'disposition';
    operation.disposition_reason:=nullif(trim(p_payload->>'reason'),'');
  elsif p_action='location' then
    if lead.updated_at is distinct from (p_payload->>'expectedUpdatedAt')::timestamptz then
      raise exception 'Lead location changed; reload before saving' using errcode='40001';
    end if;
    update public.commercial_leads set
      project_address=nullif(trim(p_payload->>'address'),''),
      project_city=nullif(trim(p_payload->>'city'),''),
      project_state=nullif(trim(p_payload->>'state'),''),
      project_postal_code=nullif(trim(p_payload->>'postalCode'),''),
      revision=revision+1,updated_at=now() where lead_id=p_lead_id;
  elsif p_action='link' then
    if operation.order_id is not null then
      raise exception 'An installation is already linked; review the existing relationship' using errcode='22023';
    end if;
    select * into ord from public.h2s_orders where id=(p_payload->>'orderId')::uuid for update;
    if not found then raise exception 'Priced order not found' using errcode='22023'; end if;
    select * into job from public.h2s_dispatch_jobs where job_id=(p_payload->>'jobId')::uuid for update;
    if not found or not coalesce(job.order_id in (ord.id::text,ord.order_id),false)
      or ord.total is null or ord.total<=0 or ord.commercial_request_id is not null
      or ord.total::text in ('NaN','Infinity','-Infinity')
      or (ord.metadata_json is not null and jsonb_typeof(ord.metadata_json)<>'object')
      or ord.order_id like 'APPT-COM-%'
      or ord.metadata_json->>'commercial_consultation_request_id' is not null then
      raise exception 'Choose an existing priced installation and its matching job, not a consultation' using errcode='22023';
    end if;
    if not (coalesce(lower(nullif(lead.email,''))=lower(nullif(ord.customer_email,'')),false)
      or coalesce(nullif(regexp_replace(lead.phone,'\D','','g'),'')=
        nullif(regexp_replace(coalesce(ord.customer_phone,ord.phone),'\D','','g'),''),false)) then
      raise exception 'Order contact does not match this lead; reconcile contact information first' using errcode='22023';
    end if;
    operation.order_id:=ord.id;
    operation.installation_job_id:=job.job_id;
  elsif p_action in ('schedule','assign','start','complete') then
    select * into ord from public.h2s_orders where id=operation.order_id for update;
    if not found then raise exception 'Quote/payment setup required' using errcode='22023'; end if;
    select * into job from public.h2s_dispatch_jobs where job_id=operation.installation_job_id for update;
    if not found or not coalesce(job.order_id in (ord.id::text,ord.order_id),false)
      or ord.total is null or ord.total<=0
      or ord.total::text in ('NaN','Infinity','-Infinity')
      or (ord.metadata_json is not null and jsonb_typeof(ord.metadata_json)<>'object')
      or ord.commercial_request_id is not null or ord.order_id like 'APPT-COM-%'
      or ord.metadata_json->>'commercial_consultation_request_id' is not null then
      raise exception 'Installation relationship changed; reconcile before continuing' using errcode='22023';
    end if;
    if job.updated_at is distinct from (p_payload->>'expectedJobUpdatedAt')::timestamptz
      or ord.updated_at is distinct from (p_payload->>'expectedOrderUpdatedAt')::timestamptz then
      raise exception 'Installation or order changed; reload before saving' using errcode='40001';
    end if;
    if p_action='schedule' then
      start_at:=(p_payload->>'start')::timestamptz;
      end_at:=(p_payload->>'end')::timestamptz;
      if start_at is null or end_at is null or start_at<=now() or end_at<=start_at
        or end_at-start_at>interval '24 hours' or job.status not in ('queued','assigned') then
        raise exception 'Use a future installation window for a queued or assigned job' using errcode='22023';
      end if;
      -- Preserve the established sparse dispatch schema: due_at + order schedule.
      update public.h2s_dispatch_jobs set due_at=start_at,updated_at=now() where job_id=job.job_id;
      update public.h2s_orders set delivery_date=(p_payload->>'date')::date,delivery_time=p_payload->>'window',
        metadata_json=coalesce(metadata_json,'{}') || jsonb_build_object(
          'scheduled_date',start_at,'scheduled_end',end_at,'scheduled_tz',p_payload->>'timezone',
          'time_window',p_payload->>'window','schedule_status','Scheduled','scheduled_at',now(),
          'scheduled_via','commercial_queue'),updated_at=now() where id=ord.id;
    elsif p_action='assign' then
      if job.status not in ('queued','assigned') or nullif(trim(p_payload->>'note'),'') is null then
        raise exception 'Assign only a queued or assigned installation, with assignment notes' using errcode='22023';
      end if;
      perform 1 from public.h2s_pros pro where pro.pro_id::text=p_payload->>'proId'
        and to_jsonb(pro)->>'is_active'='true' for update;
      if not found then raise exception 'Choose an existing active installer' using errcode='22023'; end if;
      perform 1 from public.h2s_dispatch_job_assignments where job_id=job.job_id::text for update;
      if exists(select 1 from public.h2s_dispatch_job_assignments where job_id=job.job_id::text
        and state in ('accepted','assigned','scheduled','in_progress') and pro_id is distinct from p_payload->>'proId') then
        raise exception 'An installer is already assigned; reconcile before reassignment' using errcode='40001';
      end if;
      if not exists(select 1 from public.h2s_dispatch_job_assignments where job_id=job.job_id::text
        and pro_id=p_payload->>'proId' and state in ('accepted','assigned','scheduled','in_progress')) then
        insert into public.h2s_dispatch_job_assignments(assign_id,job_id,pro_id,state,created_at,updated_at)
          values(gen_random_uuid()::text,job.job_id::text,p_payload->>'proId','assigned',now(),now());
      end if;
      update public.h2s_dispatch_jobs set status='assigned',updated_at=now() where job_id=job.job_id;
    else
      perform 1 from public.h2s_dispatch_job_assignments where job_id=job.job_id::text for update;
      select min(pro_id) into assigned_pro from public.h2s_dispatch_job_assignments
        where job_id=job.job_id::text and state in ('accepted','assigned','scheduled','in_progress')
        having count(distinct pro_id)=1;
      if assigned_pro is null or assigned_pro is distinct from p_payload->>'proId' then
        raise exception 'One unambiguous recorded installation assignee is required' using errcode='22023';
      end if;
      if p_action='start' then
        if job.status<>'assigned' or nullif(trim(p_payload->>'note'),'') is null or job.due_at is null
          or nullif(trim(ord.address),'') is null then
          raise exception 'Start requires an assigned installation, schedule, address and notes' using errcode='22023';
        end if;
        if ord.metadata_json->>'order_required'='true'
          and coalesce(ord.metadata_json->>'order_stage','') not in ('DELIVERED','NOT_NEEDED') then
          raise exception 'Equipment must be delivered before starting the installation' using errcode='22023';
        end if;
        update public.h2s_dispatch_jobs set status='in_progress',updated_at=now() where job_id=job.job_id;
      else
      if job.status<>'in_progress' or nullif(trim(p_payload->>'note'),'') is null then
        raise exception 'Only an in-progress installation can be completed, with completion notes' using errcode='22023';
      end if;
      if exists(select 1 from jsonb_array_elements(coalesce(ord.metadata_json->'pain_flags','[]')) flag
        where flag->>'severity'='CRITICAL' and nullif(flag->>'resolved_at','') is null) then
        raise exception 'Resolve critical installation flags before completion' using errcode='22023';
      end if;
      update public.h2s_dispatch_jobs set status='completed',updated_at=now() where job_id=job.job_id;
      operation.completed_at:=now();
      operation.completed_by:=p_actor;
      end if;
    end if;
  else
    raise exception 'Unknown commercial operation' using errcode='22023';
  end if;
  operation.revision:=operation.revision+1;
  operation.updated_at:=now();
  update public.commercial_lead_operations set
    revision=operation.revision,responsible_id=operation.responsible_id,responsible_name=operation.responsible_name,
    next_follow_up_at=operation.next_follow_up_at,disposition=operation.disposition,
    disposition_reason=operation.disposition_reason,order_id=operation.order_id,
    installation_job_id=operation.installation_job_id,completed_at=operation.completed_at,
    completed_by=operation.completed_by,updated_at=operation.updated_at where lead_id=p_lead_id;
  insert into public.commercial_lead_activity(operation_id,lead_id,revision,actor_id,actor_name,action,payload)
    values(p_operation_id,p_lead_id,operation.revision,p_actor->>'id',p_actor->>'name',p_action,p_payload);
  return to_jsonb(operation);
end $$;

revoke all on function public.commercial_record_operation(uuid,integer,uuid,jsonb,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.commercial_record_operation(uuid,integer,uuid,jsonb,text,jsonb) to service_role;
