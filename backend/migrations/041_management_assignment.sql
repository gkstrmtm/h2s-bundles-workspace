-- REVIEW ONLY. Not registered for production application.
-- Adds a pending-offer operation; never accepts a job or creates payout records.
begin;

create table public.h2s_management_assignment_config (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false
);
insert into public.h2s_management_assignment_config values(true,false);

create table public.h2s_management_assignment_requests (
  operation_id uuid primary key,
  job_id uuid not null references public.h2s_dispatch_jobs(job_id),
  pro_id uuid not null references public.h2s_pros(pro_id),
  actor_user_id uuid not null,
  expected_context text not null,
  note text not null,
  result jsonb,
  created_at timestamptz not null default now()
);
create index on public.h2s_management_assignment_requests(job_id);

create table public.h2s_management_assignment_activity (
  event_id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.h2s_dispatch_jobs(job_id),
  assignment_id text not null,
  pro_reference text,
  old_state text,
  new_state text,
  operation_id uuid references public.h2s_management_assignment_requests(operation_id),
  actor_user_id uuid,
  source text not null,
  created_at timestamptz not null default now()
);

alter table public.h2s_management_assignment_config enable row level security;
alter table public.h2s_management_assignment_requests enable row level security;
alter table public.h2s_management_assignment_activity enable row level security;
revoke all on public.h2s_management_assignment_config,public.h2s_management_assignment_requests,
  public.h2s_management_assignment_activity from public,anon,authenticated,service_role;
grant select on public.h2s_management_assignment_config,public.h2s_management_assignment_requests,
  public.h2s_management_assignment_activity to service_role;

create function public.h2s_management_assignment_context(p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare j public.h2s_dispatch_jobs; o public.h2s_orders; n integer; a jsonb; eligible boolean; reason text;
begin
  select * into j from public.h2s_dispatch_jobs where job_id=p_job_id;
  if not found then raise exception 'Job not found' using errcode='P0002'; end if;
  select count(*) into n from public.h2s_orders where id::text=lower(j.order_id) or order_id=j.order_id;
  if n<>1 then raise exception 'Job must resolve to exactly one order' using errcode='22023'; end if;
  select * into o from public.h2s_orders where id::text=lower(j.order_id) or order_id=j.order_id;
  if (select count(*) from public.h2s_dispatch_job_assignments where lower(job_id)=j.job_id::text)>100 then
    raise exception 'Assignment history requires reconciliation' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('assignmentId',assign_id,'proReference',pro_id,
    'state',state,'updatedAt',updated_at) order by assign_id),'[]') into a
    from public.h2s_dispatch_job_assignments where lower(job_id)=j.job_id::text;
  eligible:=j.status='queued';
  reason:=case when eligible then null else 'Only queued jobs can receive a new offer.' end;
  if o.commercial_request_id is not null or o.order_id like 'APPT-COM-%'
    or nullif(o.metadata_json->>'commercial_consultation_request_id','') is not null
    or o.total is null or o.total<=0 then
    eligible:=false; reason:='Choose a priced installation, not a consultation or unresolved order.';
  end if;
  if lower(coalesce(o.status,'')) ~ '(pending|unpaid|cancel|refund|disput)' then
    eligible:=false; reason:='Order state prevents a new technician offer. Reconcile existing payment/order evidence first.';
  end if;
  if exists(select 1 from public.h2s_dispatch_job_assignments where lower(job_id)=j.job_id::text
    and (state is null or state not in('declined','expired','cancelled','canceled','completed','done','rejected'))) then
    eligible:=false; reason:='An assignment or offer already exists. Reconcile it before creating another.';
  end if;
  return jsonb_build_object('jobId',j.job_id,'rawStatus',j.status,'scheduledAt',j.due_at,
    'orderId',o.id,'orderReference',o.order_id,'service',o.service_name,'customerName',o.customer_name,
    'assignments',a,'eligible',eligible,'reason',reason,
    'legacyPayoutBridge',exists(select 1 from public.h2s_jobs l where l.job_id=j.job_id::text
      and nullif(trim(o.customer_email),'') is not null and lower(trim(l.customer_email))=lower(trim(o.customer_email))),
    'context',md5(jsonb_build_object('job',to_jsonb(j),'order',to_jsonb(o),'assignments',a)::text));
end $$;

create function public.h2s_management_assignment_preview(p_job_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare snapshot jsonb; people jsonb; history jsonb;
begin
  if not coalesce((select enabled from public.h2s_management_assignment_config where singleton),false) then
    return jsonb_build_object('enabled',false);
  end if;
  snapshot:=public.h2s_management_assignment_context(p_job_id);
  if (select count(*) from public.h2s_pros where is_active=true and nullif(trim(name),'') is not null)>200 then
    raise exception 'Technician directory requires a bounded search before assignment' using errcode='22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('proId',p.pro_id,'name',p.name) order by p.name,p.pro_id),'[]') into people
    from public.h2s_pros p where p.is_active=true and nullif(trim(p.name),'') is not null
    and not exists(select 1 from public.h2s_dispatch_job_assignments a
      join public.h2s_dispatch_jobs j on j.job_id::text=lower(a.job_id)
      where (lower(a.pro_id)=p.pro_id::text or a.pro_id=p.email)
        and j.job_id<>p_job_id and j.status not in('completed','done','cancelled')
        and (a.state is null or a.state not in('declined','expired','cancelled','canceled','completed','done','rejected'))
        and j.due_at=(select due_at from public.h2s_dispatch_jobs where job_id=p_job_id));
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.event_id),'[]') into history from
    (select a.event_id,a.old_state,a.new_state,a.actor_user_id,a.source,a.created_at,r.note
      from public.h2s_management_assignment_activity a
      left join public.h2s_management_assignment_requests r on r.operation_id=a.operation_id
      where a.job_id=p_job_id order by a.created_at desc,a.event_id limit 20) e;
  return jsonb_build_object('enabled',true,'job',snapshot,'technicians',people,'history',history);
end $$;

-- Serialize existing writers as well as the new RPC. Restrictions apply only
-- to jobs enrolled by this operation; historical unrelated rows are not repaired.
create function public.h2s_guard_management_assignment() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare key text; managed boolean;
begin
  key:=case when TG_OP='DELETE' then OLD.job_id else NEW.job_id end;
  if TG_OP='UPDATE' and (NEW.job_id is distinct from OLD.job_id or NEW.pro_id is distinct from OLD.pro_id)
    and exists(select 1 from public.h2s_management_assignment_requests where job_id::text=lower(OLD.job_id)) then
    raise exception 'Managed assignment identity cannot be changed' using errcode='23514';
  end if;
  perform 1 from public.h2s_dispatch_jobs where job_id::text=lower(key) for update;
  managed:=exists(select 1 from public.h2s_management_assignment_requests where job_id::text=lower(key));
  if managed then
    -- Updating the locked parent also rejects stale repeatable-read snapshots.
    update public.h2s_dispatch_jobs set updated_at=clock_timestamp() where job_id::text=lower(key);
    if TG_OP='DELETE' then
      raise exception 'Retain managed assignment history; use a state transition' using errcode='23514';
    end if;
    if (NEW.state is null or NEW.state not in('declined','expired','cancelled','canceled','completed','done','rejected'))
      and exists(select 1 from public.h2s_dispatch_jobs where job_id::text=lower(key) and status in('completed','done','cancelled')) then
      raise exception 'Closed jobs cannot receive an active assignment' using errcode='23514';
    end if;
    if (NEW.state is null or NEW.state not in('declined','expired','cancelled','canceled','completed','done','rejected'))
      and exists(select 1 from public.h2s_dispatch_job_assignments
        where lower(job_id)=lower(key) and assign_id<>NEW.assign_id
        and (state is null or state not in('declined','expired','cancelled','canceled','completed','done','rejected'))) then
      raise exception 'Job already has an assignment or pending offer' using errcode='23505';
    end if;
  end if;
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end $$;
create trigger h2s_management_assignment_guard before insert or update or delete
  on public.h2s_dispatch_job_assignments for each row execute function public.h2s_guard_management_assignment();

create function public.h2s_audit_management_assignment() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare operation uuid; actor uuid;
begin
  if not exists(select 1 from public.h2s_management_assignment_requests where job_id::text=lower(NEW.job_id)) then return NEW; end if;
  if TG_OP='UPDATE' and NEW.state is not distinct from OLD.state then return NEW; end if;
  operation:=nullif(current_setting('h2s.assignment_operation',true),'')::uuid;
  select actor_user_id into actor from public.h2s_management_assignment_requests where operation_id=operation;
  insert into public.h2s_management_assignment_activity(job_id,assignment_id,pro_reference,old_state,new_state,
    operation_id,actor_user_id,source) values(NEW.job_id::uuid,NEW.assign_id,NEW.pro_id,
    case when TG_OP='UPDATE' then OLD.state else null end,NEW.state,operation,actor,
    case when operation is null then 'existing_assignment_handler' else 'management' end);
  return NEW;
end $$;
create trigger h2s_management_assignment_audit after insert or update on public.h2s_dispatch_job_assignments
  for each row execute function public.h2s_audit_management_assignment();

create function public.h2s_management_assign_technician(
  p_job_id uuid,p_pro_id uuid,p_operation_id uuid,p_actor_user_id uuid,p_context text,p_note text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare previous public.h2s_management_assignment_requests; snapshot jsonb; pro public.h2s_pros;
  assignment text; response jsonb;
begin
  perform set_config('lock_timeout','5s',true);
  if not coalesce((select enabled from public.h2s_management_assignment_config where singleton),false) then
    raise exception 'Management assignment writes are disabled' using errcode='42501';
  end if;
  if p_actor_user_id is null or p_operation_id is null or length(trim(coalesce(p_note,''))) not between 1 and 2000
    or p_context is null or p_context !~ '^[a-f0-9]{32}$' then
    raise exception 'Complete assignment review and provide a note' using errcode='22023';
  end if;
  -- The same request cannot execute concurrently on different jobs.
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,41));
  select * into previous from public.h2s_management_assignment_requests where operation_id=p_operation_id;
  if found then
    if previous.job_id<>p_job_id or previous.pro_id<>p_pro_id or previous.actor_user_id<>p_actor_user_id
      or previous.expected_context<>p_context or previous.note<>p_note then
      raise exception 'Operation key was already used for different input' using errcode='23505';
    end if;
    if previous.result is null then raise exception 'Assignment result requires reconciliation' using errcode='40001'; end if;
    return previous.result||jsonb_build_object('replayed',true);
  end if;
  perform 1 from public.h2s_dispatch_jobs where job_id=p_job_id for update;
  if not found then raise exception 'Job not found' using errcode='P0002'; end if;
  -- Share directory locks and deterministic ordering with other management offers.
  select * into pro from public.h2s_pros where pro_id=p_pro_id for update;
  if not found or pro.is_active is distinct from true or nullif(trim(pro.name),'') is null then
    raise exception 'Choose a named active technician' using errcode='22023';
  end if;
  perform 1 from public.h2s_orders where id::text=lower((select order_id from public.h2s_dispatch_jobs where job_id=p_job_id))
    or order_id=(select order_id from public.h2s_dispatch_jobs where job_id=p_job_id) for share;
  snapshot:=public.h2s_management_assignment_context(p_job_id);
  if snapshot->>'context'<>p_context then raise exception 'Job changed. Reload and review before assigning.' using errcode='40001'; end if;
  if not (snapshot->>'eligible')::boolean then raise exception '%',snapshot->>'reason' using errcode='22023'; end if;
  if not exists(select 1 from jsonb_array_elements(public.h2s_management_assignment_preview(p_job_id)->'technicians') t
    where t->>'proId'=p_pro_id::text) then
    raise exception 'Technician is no longer eligible for this schedule' using errcode='22023';
  end if;
  insert into public.h2s_management_assignment_requests(operation_id,job_id,pro_id,actor_user_id,expected_context,note)
    values(p_operation_id,p_job_id,p_pro_id,p_actor_user_id,p_context,p_note);
  perform set_config('h2s.assignment_operation',p_operation_id::text,true);
  assignment:='h2s-management:'||gen_random_uuid()::text;
  insert into public.h2s_dispatch_job_assignments(assign_id,job_id,pro_id,state,offer_sent_at,created_at,updated_at)
    values(assignment,p_job_id::text,p_pro_id::text,'pending',now(),now(),now());
  perform set_config('h2s.assignment_operation','',true);
  response:=jsonb_build_object('operationId',p_operation_id,'jobId',p_job_id,'proId',p_pro_id,
    'assignmentId',assignment,'state','pending','requiresAcceptance',true,'replayed',false);
  update public.h2s_management_assignment_requests set result=response where operation_id=p_operation_id;
  return response;
end $$;

revoke all on function public.h2s_management_assignment_context(uuid),
  public.h2s_management_assignment_preview(uuid), public.h2s_guard_management_assignment(),
  public.h2s_audit_management_assignment(), public.h2s_management_assign_technician(uuid,uuid,uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.h2s_management_assignment_preview(uuid),
  public.h2s_management_assign_technician(uuid,uuid,uuid,uuid,text,text) to service_role;
commit;
