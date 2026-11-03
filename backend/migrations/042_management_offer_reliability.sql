-- REVIEW ONLY. Requires 041; no production application is authorized.
begin;

create table public.h2s_dispatch_legacy_job_links (
  dispatch_job_id uuid primary key references public.h2s_dispatch_jobs(job_id),
  legacy_job_id text not null unique references public.h2s_jobs(job_id),
  evidence_basis text not null check(evidence_basis in('source_record','reviewed_reconciliation')),
  evidence_reference text not null check(length(trim(evidence_reference)) between 1 and 2000),
  reviewed_by_user_id uuid not null,
  reviewed_at timestamptz not null default now()
);
alter table public.h2s_dispatch_legacy_job_links enable row level security;
revoke all on public.h2s_dispatch_legacy_job_links from public,anon,authenticated,service_role;
grant select on public.h2s_dispatch_legacy_job_links to service_role;

create or replace function public.h2s_management_assignment_context(p_job_id uuid) returns jsonb
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
    'legacyPayoutBridge',exists(select 1 from public.h2s_dispatch_legacy_job_links m
      join public.h2s_jobs l on l.job_id=m.legacy_job_id where m.dispatch_job_id=j.job_id
      and nullif(trim(o.customer_email),'') is not null and lower(trim(l.customer_email))=lower(trim(o.customer_email))),
    'context',md5(jsonb_build_object('job',to_jsonb(j),'order',to_jsonb(o),'assignments',a)::text));
end $$;

alter table public.h2s_management_assignment_activity add column actor_pro_id uuid references public.h2s_pros(pro_id);
create or replace function public.h2s_audit_management_assignment() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare operation uuid; actor uuid; technician uuid;
begin
  if not exists(select 1 from public.h2s_management_assignment_requests where job_id::text=lower(NEW.job_id)) then return NEW; end if;
  if TG_OP='UPDATE' and NEW.state is not distinct from OLD.state then return NEW; end if;
  operation:=nullif(current_setting('h2s.assignment_operation',true),'')::uuid;
  technician:=nullif(current_setting('h2s.assignment_responding_pro',true),'')::uuid;
  select actor_user_id into actor from public.h2s_management_assignment_requests where operation_id=operation;
  insert into public.h2s_management_assignment_activity(job_id,assignment_id,pro_reference,old_state,new_state,
    operation_id,actor_user_id,actor_pro_id,source) values(NEW.job_id::uuid,NEW.assign_id,NEW.pro_id,
    case when TG_OP='UPDATE' then OLD.state else null end,NEW.state,operation,actor,technician,
    case when technician is not null then 'technician_response'
      when operation is null then 'existing_assignment_handler' else 'management' end);
  return NEW;
end $$;

-- A handler can observe "unenrolled" just before a management offer commits.
-- Recheck under 041's parent lock so that legacy writes cannot bypass the RPC.
create function public.h2s_require_managed_offer_response() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.h2s_management_assignment_requests where job_id::text=lower(NEW.job_id)) then
    if TG_OP='UPDATE' and NEW.assign_id is distinct from OLD.assign_id then
      raise exception 'Retain the managed assignment identity' using errcode='23514';
    end if;
    if TG_OP='INSERT' and NEW.state in('accepted','assigned','scheduled','in_progress') then
      raise exception 'Managed offers require an authenticated technician response' using errcode='42501';
    end if;
    if TG_OP='UPDATE' and OLD.state in('pending','offer_sent')
      and NEW.state in('accepted','declined','assigned','scheduled','in_progress')
      and (NEW.state not in('accepted','declined')
        or nullif(current_setting('h2s.assignment_responding_pro',true),'') is distinct from NEW.pro_id) then
      raise exception 'Managed offers require the atomic response operation' using errcode='42501';
    end if;
  end if;
  return NEW;
end $$;
create trigger h2s_management_offer_response_guard before insert or update on public.h2s_dispatch_job_assignments
  for each row execute function public.h2s_require_managed_offer_response();

create function public.h2s_management_respond_to_offer(p_job_id uuid,p_pro_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.h2s_dispatch_jobs; a public.h2s_dispatch_job_assignments;
begin
  perform set_config('lock_timeout','5s',true);
  if p_action is null or p_action not in('accept','decline') or p_pro_id is null then
    raise exception 'Invalid offer response' using errcode='22023';
  end if;
  select * into j from public.h2s_dispatch_jobs where job_id=p_job_id for update;
  if not found then raise exception 'Job not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.h2s_management_assignment_requests where job_id=p_job_id) then
    raise exception 'Not a management offer' using errcode='42501';
  end if;
  perform 1 from public.h2s_pros where pro_id=p_pro_id and is_active is true for update;
  if not found then raise exception 'Technician is not active' using errcode='42501'; end if;
  select arow.* into a from public.h2s_dispatch_job_assignments arow
    join public.h2s_management_assignment_requests r on r.result->>'assignmentId'=arow.assign_id
    where r.job_id=p_job_id and r.pro_id=p_pro_id and lower(arow.job_id)=p_job_id::text
      and lower(arow.pro_id)=p_pro_id::text
    order by coalesce(arow.state in('pending','offer_sent','accepted'),false) desc,
      r.created_at desc,r.operation_id desc limit 1 for update of arow;
  if not found then raise exception 'Offer ownership requires reconciliation' using errcode='42501'; end if;
  if (p_action='accept' and a.state='accepted') or (p_action='decline' and a.state='declined') then
    if p_action='accept' and j.status not in('assigned','in_progress','completed','done','cancelled') then
      raise exception 'Assignment and job status disagree' using errcode='23514';
    end if;
    return jsonb_build_object('assignment',to_jsonb(a),'job_status',j.status,'replayed',true);
  end if;
  if a.state is null or a.state not in('pending','offer_sent') or j.status<>'queued' then
    raise exception 'Offer is no longer pending' using errcode='23514';
  end if;
  if exists(select 1 from public.h2s_dispatch_job_assignments where lower(job_id)=p_job_id::text
    and assign_id<>a.assign_id and (state is null or state not in('declined','expired','cancelled','canceled','completed','done','rejected'))) then
    raise exception 'Conflicting assignment requires reconciliation' using errcode='23505';
  end if;
  if p_action='accept' and j.due_at is not null and exists(
    select 1 from public.h2s_dispatch_job_assignments other_a join public.h2s_dispatch_jobs other_j
      on lower(other_a.job_id)=other_j.job_id::text
    where other_j.job_id<>p_job_id and lower(other_a.pro_id)=p_pro_id::text and other_j.due_at=j.due_at
      and other_j.status not in('completed','done','cancelled')
      and (other_a.state is null or other_a.state not in('declined','expired','cancelled','canceled','completed','done','rejected'))) then
    raise exception 'Technician has a competing appointment or offer' using errcode='23505';
  end if;
  perform set_config('h2s.assignment_responding_pro',p_pro_id::text,true);
  update public.h2s_dispatch_job_assignments set
    state=case when p_action='accept' then 'accepted' else 'declined' end,
    accepted_at=case when p_action='accept' then now() else accepted_at end,
    declined_at=case when p_action='decline' then now() else declined_at end,updated_at=now()
    where assign_id=a.assign_id returning * into a;
  if p_action='accept' then
    update public.h2s_dispatch_jobs set status='assigned',updated_at=now() where job_id=p_job_id;
  end if;
  perform set_config('h2s.assignment_responding_pro','',true);
  return jsonb_build_object('assignment',to_jsonb(a),'job_status',case when p_action='accept' then 'assigned' else j.status end,'replayed',false);
end $$;
revoke all on function public.h2s_management_respond_to_offer(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.h2s_management_respond_to_offer(uuid,uuid,text) to service_role;
commit;
