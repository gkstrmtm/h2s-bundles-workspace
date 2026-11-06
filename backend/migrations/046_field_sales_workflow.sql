-- REVIEW ONLY. Requires 045 and the co-located 036/041/042 authorities.
-- The native portal artifact table must pre-exist this migration for enrolled proof retention.
-- No policy, enrollment, production payment or assignment gate is activated.
begin;
create table public.field_sales_workflow_policies (
  policy_id uuid primary key,
  kind text not null check(kind in ('legal','commission','settlement')),
  status text not null default 'draft' check(status in ('draft','approved','retired','staging_only')),
  "productionApproved" boolean generated always as (status='approved') stored,
  "stagingOnly" boolean generated always as (status='staging_only') stored,
  definition jsonb not null check(jsonb_typeof(definition)='object'),
  approved_by uuid references public."Dashboard_Users"("User_ID"),
  approved_at timestamptz,
  approval_evidence jsonb,
  check(status<>'staging_only' or (public.field_sales_native_staging_scope() and approved_by is null and approved_at is null
    and coalesce(jsonb_typeof(approval_evidence)='object' and approval_evidence<>'{}'::jsonb,false))),
  check(status in ('draft','staging_only') or (approved_by is not null and approved_at is not null
    and jsonb_typeof(approval_evidence)='object' and approval_evidence<>'{}'::jsonb))
);
create table public.field_sales_workflow_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  live_enabled boolean not null default false
);
insert into public.field_sales_workflow_settings values(true,false,false);
alter table public.h2s_dispatch_jobs add column if not exists metadata_json jsonb;
create table public.field_sales_workflows (
  quote_id uuid primary key references public.field_sales_quotes(quote_id),
  lead_id uuid not null references public.field_sales_opportunities(lead_id),
  revision integer not null default 1,
  state text not null default 'enrolled' check(state in ('enrolled','scheduled','completed','cancelled','refund_review')),
  representative_id uuid not null references public.field_sales_representatives(user_id),
  credit_evidence jsonb not null,
  legal_policy_id uuid not null references public.field_sales_workflow_policies(policy_id),
  commission_policy_id uuid not null references public.field_sales_workflow_policies(policy_id),
  settlement_policy_id uuid not null references public.field_sales_workflow_policies(policy_id),
  commission_start_date date,
  commission_start_evidence text,
  rate_effective_date date,
  deposit_cents bigint not null check(deposit_cents>0),
  balance_cents bigint not null check(balance_cents>=0),
  job_id uuid unique references public.h2s_dispatch_jobs(job_id),
  technician_id uuid references public.h2s_pros(pro_id),
  cancellation_deadline timestamptz,
  completed_at timestamptz,
  completion_operation_id uuid unique,
  completion_evidence jsonb,
  completion_proof jsonb,
  hours numeric,
  technician_expenses jsonb not null default '[]' check(jsonb_typeof(technician_expenses)='array'),
  expenses jsonb not null default '[]' check(jsonb_typeof(expenses)='array'),
  costs_complete boolean not null default false,
  cost_review_evidence jsonb,
  cost_approved_by uuid references public."Dashboard_Users"("User_ID"),
  cost_approved_at timestamptz,
  verified_paid_at timestamptz,
  fully_paid_event_id text,
  created_by uuid not null references public."Dashboard_Users"("User_ID"),
  created_at timestamptz not null default now()
);
create unique index field_sales_one_active_workflow on public.field_sales_workflows(lead_id)
  where state not in ('cancelled');
create table public.field_sales_workflow_proof_bindings (
  quote_id uuid not null references public.field_sales_workflows(quote_id),
  service_id text not null,
  requirement_id text not null,
  artifact_id uuid not null references public.h2s_dispatch_job_artifacts(artifact_id) on delete cascade,
  recorded_by uuid not null references public.h2s_pros(pro_id),
  recorded_at timestamptz not null default now(),
  primary key(quote_id,service_id,requirement_id,artifact_id),
  unique(quote_id,artifact_id)
);
create table public.field_sales_workflow_proof_checks (
  quote_id uuid not null references public.field_sales_workflows(quote_id),
  service_id text not null,
  requirement_id text not null,
  affirmed boolean not null check(affirmed),
  evidence jsonb not null check(jsonb_typeof(evidence)='object' and evidence<>'{}'),
  recorded_by uuid not null references public.h2s_pros(pro_id),
  recorded_at timestamptz not null default now(),
  primary key(quote_id,service_id,requirement_id)
);
create table public.field_sales_workflow_artifacts (
  artifact_id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.field_sales_workflows(quote_id),
  kind text not null check(kind in ('quote','agreement','notice')),
  label text not null,
  content jsonb not null,
  content_hash text not null,
  approved_by uuid not null references public."Dashboard_Users"("User_ID"),
  approved_at timestamptz not null default now(),
  approval_evidence jsonb not null,
  unique(quote_id,kind,label)
);
create table public.field_sales_workflow_delivery (
  delivery_id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.field_sales_workflows(quote_id),
  actor_reference text not null,
  method text not null check(method in ('customer_retrieval','recorded_delivery')),
  artifact_hashes jsonb not null,
  evidence jsonb not null,
  created_at timestamptz not null default now()
);
create table public.field_sales_workflow_commands (
  operation_id uuid primary key,
  actor_reference text not null,
  quote_id uuid references public.field_sales_workflows(quote_id),
  action text not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create table public.field_sales_workflow_refunds (
  operation_id uuid primary key,
  checkout_id uuid not null references public.field_sales_checkouts(checkout_id),
  actor_id uuid not null references public."Dashboard_Users"("User_ID"),
  amount_cents bigint not null check(amount_cents>0),
  previous_refunded_cents bigint not null,
  evidence jsonb not null,
  state text not null default 'reserved' check(state in ('reserved','provider_pending','verified','failed')),
  provider_refund_id text unique,
  provider_receipt jsonb,
  created_at timestamptz not null default now()
);
create table public.field_sales_workflow_handoffs (
  handoff_id uuid primary key,
  quote_id uuid not null references public.field_sales_workflows(quote_id),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  scope text not null check(scope='accepted_documents_balance'),
  duration_minutes integer not null check(duration_minutes between 1 and 1440),
  expires_at timestamptz not null,
  issued_by uuid not null references public."Dashboard_Users"("User_ID"),
  created_at timestamptz not null default now()
);
create unique index field_sales_one_active_refund on public.field_sales_workflow_refunds(checkout_id)
  where state in ('reserved','provider_pending');
alter table public.field_sales_checkouts add column processing_fee_cents bigint check(processing_fee_cents>=0),
  add column processing_fee_evidence jsonb,
  add column stripe_mode text not null default 'test' check(stripe_mode in ('test','live')),
  add column stripe_mode_bound boolean not null default false;

create function public.field_sales_workflow_freeze() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_table_name='field_sales_workflow_policies' then
    if tg_op='UPDATE' and old.status='draft' then return new; end if;
    if tg_op='DELETE' and old.status='draft' then return old; end if;
    if tg_op='UPDATE' and old.status='approved'
      and new.status='retired' and to_jsonb(old)-array['status','productionApproved','stagingOnly']=to_jsonb(new)-array['status','productionApproved','stagingOnly'] then return new; end if;
  end if;
  if tg_table_name='field_sales_workflows' and tg_op='UPDATE' then
    if (to_jsonb(old)-array['revision','state','job_id','technician_id','cancellation_deadline','completed_at',
      'completion_operation_id','completion_evidence','completion_proof','hours','technician_expenses','expenses','costs_complete',
      'cost_review_evidence','cost_approved_by','cost_approved_at','verified_paid_at','fully_paid_event_id'])
      is distinct from (to_jsonb(new)-array['revision','state','job_id','technician_id','cancellation_deadline','completed_at',
      'completion_operation_id','completion_evidence','completion_proof','hours','technician_expenses','expenses','costs_complete',
      'cost_review_evidence','cost_approved_by','cost_approved_at','verified_paid_at','fully_paid_event_id'])
      or (old.completed_at is not null and row(old.completed_at,old.completion_operation_id,old.completion_evidence,old.completion_proof,old.hours,old.technician_expenses)
        is distinct from row(new.completed_at,new.completion_operation_id,new.completion_evidence,new.completion_proof,new.hours,new.technician_expenses))
      or (old.costs_complete and row(old.expenses,old.costs_complete,old.cost_review_evidence,old.cost_approved_by,old.cost_approved_at)
        is distinct from row(new.expenses,new.costs_complete,new.cost_review_evidence,new.cost_approved_by,new.cost_approved_at))
      or (old.verified_paid_at is not null and row(old.verified_paid_at,old.fully_paid_event_id)
        is distinct from row(new.verified_paid_at,new.fully_paid_event_id))
      or (old.job_id is not null and old.job_id is distinct from new.job_id)
      or (old.cancellation_deadline is not null and old.cancellation_deadline is distinct from new.cancellation_deadline) then
      raise exception 'Immutable enrollment/completion evidence' using errcode='42501';
    end if;
    return new;
  end if;
  raise exception 'Immutable approved workflow evidence; create a new version' using errcode='42501';
end $$;
do $$ declare t text; begin
  foreach t in array array['field_sales_workflow_policies','field_sales_workflows','field_sales_workflow_artifacts',
    'field_sales_workflow_delivery','field_sales_workflow_commands','field_sales_workflow_handoffs'] loop
    execute format('create trigger field_sales_workflow_freeze before update or delete on public.%I for each row execute function public.field_sales_workflow_freeze()',t);
  end loop;
end $$;

create function public.field_sales_workflow_access(p_actor uuid,p_lead uuid) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text;
begin
  r:=public.field_sales_transaction_access(p_actor,p_lead);
  if not exists(select 1 from public.field_sales_workflow_settings where enabled) then
    raise exception 'Field workflow disabled; no lifecycle changes authorized' using errcode='55000'; end if;
  return r;
end $$;
create function public.field_sales_workflow_order_facts(p_quote uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare w public.field_sales_workflows; q public.field_sales_quotes; net bigint; refunded bigint; fee bigint; fee_evidence jsonb; dispute boolean;
  rate_policy jsonb; rate_at timestamptz; rate_date date;
begin
  select * into w from public.field_sales_workflows where quote_id=p_quote;
  if not found then raise exception 'Exact enrolled quote unavailable' using errcode='P0002'; end if;
  select * into q from public.field_sales_quotes where quote_id=p_quote;
  select definition into rate_policy from public.field_sales_workflow_policies where policy_id=w.commission_policy_id;
  rate_at:=case rate_policy->>'rateEffectiveEvent'
    when 'accepted' then (select accepted_at from public.field_sales_agreements where quote_id=p_quote)
    when 'completed' then w.completed_at
    when 'qualified' then case when w.completed_at is not null and w.verified_paid_at is not null then greatest(w.completed_at,w.verified_paid_at) end end;
  if rate_at is not null and exists(select 1 from pg_timezone_names where name=rate_policy->>'timezone') then
    rate_date:=(rate_at at time zone (rate_policy->>'timezone'))::date; end if;
  select coalesce(sum(captured_cents-refunded_cents),0),coalesce(sum(refunded_cents),0),coalesce(bool_or(disputed),false),
    case when count(*) filter(where captured_cents>0 and processing_fee_cents is null)>0 then null
      else coalesce(sum(processing_fee_cents) filter(where captured_cents>0),0) end,
    coalesce(jsonb_agg(jsonb_build_object('checkoutId',checkout_id,'evidence',processing_fee_evidence))
      filter(where captured_cents>0),'[]') into net,refunded,dispute,fee,fee_evidence
    from public.field_sales_checkouts where quote_id=p_quote;
  return jsonb_build_object('quoteId',p_quote,'orderId',(select order_id from public.field_sales_orders where quote_id=p_quote),
    'leadId',w.lead_id,'representativeId',w.representative_id,'totalCents',(q.snapshot->>'totalCents')::bigint,
    'netPaidCents',net,'acceptedAt',(select accepted_at from public.field_sales_agreements where quote_id=p_quote),
    'completedAt',w.completed_at,'expenses',w.expenses,'processingFeeCents',fee,'processingFeeEvidence',fee_evidence,
    'costsComplete',w.costs_complete,'costReviewEvidence',w.cost_review_evidence,'costApprovedBy',w.cost_approved_by,'costApprovedAt',w.cost_approved_at,
    'disputed',dispute,'refundedCents',refunded,'legalPolicyId',w.legal_policy_id,'commissionPolicyId',w.commission_policy_id,
    'settlementPolicyId',w.settlement_policy_id,'rateEffectiveDate',coalesce(w.rate_effective_date,rate_date),
    'commissionStartDate',w.commission_start_date,'commissionStartEvidence',w.commission_start_evidence,
    'verifiedPaidAt',w.verified_paid_at,'eligibleEventId',case when w.completed_at is not null and w.fully_paid_event_id is not null
      then w.completion_operation_id::text||':'||w.fully_paid_event_id end);
end $$;
create function public.field_sales_workflow_validate_costs(p_expenses jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,public as $$
declare cost jsonb;
begin
  if jsonb_typeof(p_expenses) is distinct from 'array' or jsonb_array_length(p_expenses) not between 2 and 100 then return false; end if;
  for cost in select value from jsonb_array_elements(p_expenses) loop
    if cost->>'category' not in ('equipment','materials') or cost->>'actual' is distinct from 'true'
      or jsonb_typeof(cost->'amountCents') is distinct from 'number' or jsonb_typeof(cost->'unitCents') is distinct from 'number'
      or jsonb_typeof(cost->'quantity') is distinct from 'number' or jsonb_typeof(cost->'evidence') is distinct from 'object'
      or cost->'evidence'='{}'::jsonb then return false; end if;
    if (cost->>'amountCents')::numeric not between 0 and 100000000 or (cost->>'amountCents')::numeric<>trunc((cost->>'amountCents')::numeric)
      or (cost->>'unitCents')::numeric not between 0 and 100000000 or (cost->>'unitCents')::numeric<>trunc((cost->>'unitCents')::numeric)
      or (cost->>'quantity')::numeric not between 0 and 100000 or (cost->>'quantity')::numeric<>round((cost->>'quantity')::numeric,6)
      or (cost->>'amountCents')::numeric<>(cost->>'unitCents')::numeric*(cost->>'quantity')::numeric
      or ((cost->>'amountCents')::numeric=0 and length(trim(coalesce(cost->>'zeroCostAttestation','')))<3) then return false; end if;
  end loop;
  return exists(select 1 from jsonb_array_elements(p_expenses) row_cost where row_cost->>'category'='equipment')
    and exists(select 1 from jsonb_array_elements(p_expenses) row_cost where row_cost->>'category'='materials');
end $$;
create function public.field_sales_workflow_guard_job() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare quote uuid;
begin
  select quote_id into quote from public.field_sales_workflows where job_id=new.job_id;
  if quote is not null and new.status in ('completed','done')
    and current_setting('h2s.field_sales_completion',true) is distinct from quote::text then
    raise exception 'Enrolled installation requires authenticated workflow completion and actual-cost evidence; legacy fallback prohibited' using errcode='55000'; end if;
  return new;
end $$;
create trigger field_sales_workflow_job_guard before update on public.h2s_dispatch_jobs
  for each row execute function public.field_sales_workflow_guard_job();
create function public.field_sales_workflow_document_gate(p_quote uuid,p_retrieval boolean default false) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare w public.field_sales_workflows; d jsonb; hashes jsonb;
begin
  select * into w from public.field_sales_workflows where quote_id=p_quote;
  if not found then return true; end if;
  select definition into d from public.field_sales_workflow_policies where policy_id=w.legal_policy_id and public.field_sales_configuration_usable(status,'approved');
  if d is null or not exists(select 1 from public.field_sales_workflow_artifacts where quote_id=p_quote and kind='quote')
    or not exists(select 1 from public.field_sales_workflow_artifacts where quote_id=p_quote and kind='agreement')
    or exists(select 1 from jsonb_array_elements(d->'requiredNotices') n where not exists(
      select 1 from public.field_sales_workflow_artifacts a where a.quote_id=p_quote and a.kind='notice' and a.label=n->>'label'
        and a.content=n->'content')) then return false; end if;
  select jsonb_agg(content_hash order by kind,label) into hashes from public.field_sales_workflow_artifacts where quote_id=p_quote;
  if p_retrieval then return exists(select 1 from public.field_sales_workflow_delivery where quote_id=p_quote
    and method='customer_retrieval' and artifact_hashes=hashes); end if;
  return true;
end $$;
create function public.field_sales_workflow_deadline(p_quote uuid,p_from timestamptz) returns timestamptz
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare c jsonb; day date; remaining integer; n integer:=0;
begin
  select p.definition->'cancellationCalendar' into c from public.field_sales_workflows w
    join public.field_sales_workflow_policies p on p.policy_id=w.legal_policy_id where w.quote_id=p_quote and public.field_sales_configuration_usable(p.status,'approved');
  if c is null or not c ?& array['timezone','businessDays','deadlineLocalTime','excludedWeekdays','holidays','startEvent']
    or c->>'startEvent' not in ('delivery','acceptance')
    or jsonb_typeof(c->'excludedWeekdays') is distinct from 'array' or jsonb_typeof(c->'holidays') is distinct from 'array'
    or not exists(select 1 from pg_timezone_names where name=c->>'timezone')
    or (c->>'businessDays')::integer not between 0 and 366
    or c->>'deadlineLocalTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Approved cancellation calendar is unresolved' using errcode='55000'; end if;
  remaining:=(c->>'businessDays')::integer; day:=(p_from at time zone (c->>'timezone'))::date;
  while remaining>0 loop
    day:=day+1; n:=n+1;
    if n>3700 then raise exception 'Cancellation calendar has no available business days' using errcode='55000'; end if;
    if not (c->'excludedWeekdays' @> jsonb_build_array(extract(isodow from day)::integer))
      and not (c->'holidays' @> jsonb_build_array(day::text)) then remaining:=remaining-1; end if;
  end loop;
  return (day+(c->>'deadlineLocalTime')::time) at time zone (c->>'timezone');
end $$;

create function public.field_sales_workflow_requirements(p_quote uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare lines jsonb; line jsonb; requirements jsonb; requirement jsonb; seen jsonb:='{}'; ids jsonb; result jsonb:='[]'; service text;
begin
  select snapshot->'lines' into lines from public.field_sales_quotes where quote_id=p_quote and state='approved';
  if jsonb_typeof(lines) is distinct from 'array' then raise exception 'Approved quote service snapshot unavailable' using errcode='55000'; end if;
  for line in select value from jsonb_array_elements(lines) loop
    service:=line->>'serviceId'; requirements:=coalesce(line->'completionRequirements','[]');
    if service is null or service !~ '^[a-z][a-z0-9_-]{0,79}$' or jsonb_typeof(requirements) is distinct from 'array'
      or jsonb_array_length(requirements)>100 then raise exception 'Pinned completion requirements invalid' using errcode='55000'; end if;
    if seen ? service then
      if seen->service<>requirements then raise exception 'Conflicting pinned requirements for the same service' using errcode='55000'; end if;
      continue;
    end if;
    seen:=seen||jsonb_build_object(service,requirements); ids:='[]';
    for requirement in select value from jsonb_array_elements(requirements) loop
      if jsonb_typeof(requirement) is distinct from 'object'
        or requirement-array['id','label','type','minimumCount']<>'{}'
        or coalesce(requirement->>'id','') !~ '^[a-z][a-z0-9_-]{0,79}$'
        or ids @> jsonb_build_array(requirement->>'id')
        or jsonb_typeof(requirement->'label') is distinct from 'string'
        or length(btrim(requirement->>'label')) not between 1 and 2000
        or coalesce(requirement->>'type','') not in ('photo','signature','checklist')
        or jsonb_typeof(requirement->'minimumCount') is distinct from 'number'
        or (requirement->>'minimumCount')::numeric not between 1 and 100
        or (requirement->>'minimumCount')::numeric<>trunc((requirement->>'minimumCount')::numeric)
        or (requirement->>'type'='checklist' and (requirement->>'minimumCount')::numeric<>1) then
        raise exception 'Pinned completion requirement invalid' using errcode='55000';
      end if;
      ids:=ids||jsonb_build_array(requirement->>'id');
      result:=result||jsonb_build_array(requirement||jsonb_build_object('serviceId',service));
    end loop;
  end loop;
  return result;
end $$;

-- Reuse the existing authenticated portal upload authority, never client flags or reference text.
create function public.field_sales_workflow_proof(p_job uuid,p_pro uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare artifacts jsonb; photos integer; signatures integer; customer jsonb; requirements jsonb; requirement jsonb;
  selected jsonb; check_record public.field_sales_workflow_proof_checks; count_selected integer;
  requirement_complete boolean; complete boolean; missing jsonb; statuses jsonb:='[]'; quote uuid;
begin
  if to_regclass('public.h2s_dispatch_job_artifacts') is null then
    raise exception 'Existing portal installation artifact authority unavailable; certify schema before workflow activation' using errcode='55000';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.h2s_dispatch_job_artifacts')
    and tgname='field_sales_workflow_proof_freeze' and tgenabled<>'D') then
    raise exception 'Installation proof retention authority unavailable; certify schema before workflow activation' using errcode='55000';
  end if;
  select jsonb_build_object('jobId',w.job_id,'quoteId',w.quote_id,'leadId',w.lead_id,'orderId',o.order_id)
    into customer from public.field_sales_workflows w join public.field_sales_orders o on o.quote_id=w.quote_id and o.lead_id=w.lead_id
    join public.h2s_dispatch_jobs j on j.job_id=w.job_id and j.order_id=o.order_id::text
    where w.job_id=p_job and w.technician_id=p_pro;
  if customer is null then
    raise exception 'Exact enrolled job, order and customer relationship changed; reconcile before completion' using errcode='40001';
  end if;
  quote:=(customer->>'quoteId')::uuid;
  select coalesce(jsonb_agg(jsonb_build_object('artifactId',a.artifact_id,'type',a.type,
    'proId',a.pro_id,'url',a.url,'createdAt',a.created_at) order by a.artifact_id),'[]'),
    count(*) filter(where a.type='photo'),count(*) filter(where a.type='signature')
    into artifacts,photos,signatures
    from public.h2s_dispatch_job_artifacts a
    where a.job_id::text=p_job::text and a.pro_id::text=p_pro::text
      and a.type in ('photo','signature') and a.artifact_id is not null and a.created_at is not null
      and a.created_at<=now() and exists(select 1 from public.h2s_dispatch_job_assignments pa
        where pa.job_id=p_job::text and pa.pro_id=p_pro::text and pa.state in ('accepted','assigned','done','completed')
          and pa.accepted_at is not null and a.created_at>=pa.accepted_at)
      and (a.url ~ '^https?://' or a.url ~ '^data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+$');
  requirements:=public.field_sales_workflow_requirements(quote);
  complete:=photos>0 and signatures>0;
  missing:=to_jsonb(array_remove(array[
      case when photos=0 then 'Upload installation photos' end,
      case when signatures=0 then 'Collect customer signature' end],null));
  for requirement in select value from jsonb_array_elements(requirements) loop
    select coalesce(jsonb_agg(b.artifact_id order by b.artifact_id),'[]'),count(*) into selected,count_selected
      from public.field_sales_workflow_proof_bindings b
      where b.quote_id=quote and b.service_id=requirement->>'serviceId' and b.requirement_id=requirement->>'id'
        and b.recorded_by=p_pro and exists(select 1 from jsonb_array_elements(artifacts) a
          where a->>'artifactId'=b.artifact_id::text and a->>'type'=requirement->>'type');
    select * into check_record from public.field_sales_workflow_proof_checks c
      where c.quote_id=quote and c.service_id=requirement->>'serviceId' and c.requirement_id=requirement->>'id' and c.recorded_by=p_pro
        and exists(select 1 from public.h2s_dispatch_job_assignments pa where pa.job_id=p_job::text and pa.pro_id=p_pro::text
          and pa.accepted_at is not null and c.recorded_at>=pa.accepted_at);
    requirement_complete:=case when requirement->>'type'='checklist' then coalesce(check_record.affirmed,false)
      and jsonb_typeof(check_record.evidence)='object' and length(btrim(check_record.evidence->>'reference'))>=3
      else count_selected>=(requirement->>'minimumCount')::integer end;
    complete:=complete and coalesce(requirement_complete,false);
    if not coalesce(requirement_complete,false) then
      missing:=missing||jsonb_build_array((requirement->>'serviceId')||': '||(requirement->>'label'));
    end if;
    statuses:=statuses||jsonb_build_array(requirement||jsonb_build_object('artifactIds',selected,
      'affirmed',coalesce(check_record.affirmed,false),'evidence',check_record.evidence,
      'complete',coalesce(requirement_complete,false),'missingCount',case when coalesce(requirement_complete,false) then 0
        when requirement->>'type'='checklist' then 1 else greatest(0,(requirement->>'minimumCount')::integer-count_selected) end));
  end loop;
  return customer||jsonb_build_object('photoCount',photos,'signatureCount',signatures,'complete',complete,
    'requirementsHash',encode(sha256(convert_to(requirements::text,'UTF8')),'hex'),'requirements',statuses,
    'candidates',coalesce((select jsonb_agg(a-array['url','proId']) from jsonb_array_elements(artifacts) a),'[]'),
    'missing',missing,'artifacts',artifacts);
end $$;

create function public.field_sales_workflow_proof_record_freeze() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform 1 from public.field_sales_workflows where quote_id=old.quote_id for update;
  if exists(select 1 from public.field_sales_workflows where quote_id=old.quote_id and completed_at is not null) then
    raise exception 'Completed installation requirement evidence is immutable' using errcode='40001';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger field_sales_workflow_binding_freeze before update or delete on public.field_sales_workflow_proof_bindings
  for each row execute function public.field_sales_workflow_proof_record_freeze();
create trigger field_sales_workflow_check_freeze before update or delete on public.field_sales_workflow_proof_checks
  for each row execute function public.field_sales_workflow_proof_record_freeze();

create function public.field_sales_workflow_proof_summary(p_job uuid,p_pro uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
  select p-array['artifacts','candidates']||jsonb_build_object('requirements',
    coalesce((select jsonb_agg(r-'evidence') from jsonb_array_elements(p->'requirements') r),'[]'))
    from (select public.field_sales_workflow_proof(p_job,p_pro) p) source
$$;

create function public.field_sales_workflow_proof_freeze() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform 1 from public.field_sales_workflows where job_id::text=old.job_id::text for update;
  if exists(select 1 from public.field_sales_workflows w where w.job_id::text=old.job_id::text
    and w.completed_at is not null and w.completion_proof->'artifacts'
      @> jsonb_build_array(jsonb_build_object('artifactId',old.artifact_id))) then
    raise exception 'Completed installation proof is immutable' using errcode='40001';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
do $$ begin
  if to_regclass('public.h2s_dispatch_job_artifacts') is null then
    raise exception 'Native portal installation artifact authority required before workflow migration' using errcode='55000';
  end if;
  create trigger field_sales_workflow_proof_freeze before update or delete on public.h2s_dispatch_job_artifacts
    for each row execute function public.field_sales_workflow_proof_freeze();
end $$;

create function public.field_sales_workflow_read(p_actor uuid,p_lead uuid default null,p_quote uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text; rows jsonb; policies jsonb;
begin
  r:=public.field_sales_workflow_access(p_actor,p_lead);
  if p_quote is not null and not exists(select 1 from public.field_sales_quotes q join public.field_sales_opportunities o using(lead_id)
    where q.quote_id=p_quote and (r='ADMIN' or o.owner_user_id=p_actor)) then
    raise exception 'Quote not found or not assigned' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('definitionHash',
    encode(sha256(convert_to(p.definition::text,'UTF8')),'hex')) order by kind,status,policy_id),'[]') into policies
    from public.field_sales_workflow_policies p where r='ADMIN' or public.field_sales_configuration_usable(status,'approved');
  select coalesce(jsonb_agg(public.field_sales_workflow_order_facts(w.quote_id)||jsonb_build_object(
    'revision',w.revision,'state',w.state,'jobId',w.job_id,'technicianId',w.technician_id,
    'depositCents',w.deposit_cents,'balanceCents',greatest(0,(public.field_sales_workflow_order_facts(w.quote_id)->>'totalCents')::bigint
      -(public.field_sales_workflow_order_facts(w.quote_id)->>'netPaidCents')::bigint),
    'agreedBalanceCents',w.balance_cents,'hours',w.hours,'technicianExpenses',w.technician_expenses,'cancellationDeadline',w.cancellation_deadline,
    'proof',case when w.job_id is not null and w.technician_id is not null
      then public.field_sales_workflow_proof_summary(w.job_id,w.technician_id) end,
    'documents',coalesce((select jsonb_agg(jsonb_build_object('artifactId',artifact_id,'kind',kind,'label',label,'content',content,
      'contentHash',content_hash,'approvedAt',approved_at) order by kind,label) from public.field_sales_workflow_artifacts where quote_id=w.quote_id),'[]'),
    'deliveryEvidence',coalesce((select jsonb_agg(to_jsonb(d)) from public.field_sales_workflow_delivery d where quote_id=w.quote_id),'[]'),
    'refunds',coalesce((select jsonb_agg(to_jsonb(rf)) from public.field_sales_workflow_refunds rf
      join public.field_sales_checkouts c using(checkout_id) where c.quote_id=w.quote_id),'[]'),
    'requiredArtifacts',jsonb_build_array(jsonb_build_object('kind','quote','label','Approved quote','content',
      (select snapshot from public.field_sales_quotes where quote_id=w.quote_id)),jsonb_build_object('kind','agreement','label','Approved agreement',
      'content',(select to_jsonb(ap)-array['approved_by','approval_evidence'] from public.field_sales_agreement_policies ap
        join public.field_sales_workflow_policies wp on ap.policy_id=(wp.definition->>'agreementPolicyId')::uuid where wp.policy_id=w.legal_policy_id)))
      ||coalesce((select jsonb_agg(n||jsonb_build_object('kind','notice')) from public.field_sales_workflow_policies wp,
        jsonb_array_elements(wp.definition->'requiredNotices') n where wp.policy_id=w.legal_policy_id),'[]'),
    'gates',public.field_sales_workflow_gates(w.quote_id),
    'reservation',(select to_jsonb(v) from public.commercial_reservations v where lead_id=w.lead_id),
    'preparation',case when w.job_id is not null then public.h2s_job_readiness(w.job_id) end,
    'assignmentPreview',case when w.job_id is not null and r='ADMIN' then public.h2s_management_assignment_preview(w.job_id) end,
    'holds',to_jsonb(array_remove(array[
      case when not public.field_sales_workflow_document_gate(w.quote_id,true) then 'Approved documents and customer retrieval required' end,
      case when (public.field_sales_workflow_order_facts(w.quote_id)->>'netPaidCents')::bigint<w.deposit_cents then 'Verified 25% deposit required before scheduling' end,
      case when w.cancellation_deadline is null or w.cancellation_deadline>now() then 'Configured cancellation deadline must clear before scheduling' end,
      case when w.completed_at is null then 'Installation completion required before balance collection' end,
      case when w.job_id is not null and w.technician_id is not null and w.completed_at is null
        and not (public.field_sales_workflow_proof(w.job_id,w.technician_id)->>'complete')::boolean
        then 'Upload installation photos and collect customer signature before completion' end,
      case when not w.costs_complete then 'Management approval of complete actual equipment/material costs required for earnings' end,
      case when public.field_sales_workflow_order_facts(w.quote_id)->'processingFeeCents'='null'::jsonb then 'Provider processing fees unresolved' end,
      case when w.state in ('cancelled','refund_review') then 'Cancellation/refund review prevents further collection and scheduling' end
    ],null))) order by w.created_at desc),'[]') into rows
    from public.field_sales_workflows w join public.field_sales_opportunities o using(lead_id)
    where (r='ADMIN' or o.owner_user_id=p_actor) and (p_lead is null or w.lead_id=p_lead) and (p_quote is null or w.quote_id=p_quote);
  return jsonb_build_object('policies',policies,'workflows',rows,'nextActions',
    case when r='ADMIN' then jsonb_build_array('enroll','documents_publish','delivery_record','schedule','reschedule','preparation','assign','cancel','refund_review','cost_review')
      else jsonb_build_array('checkout','refresh_payment') end);
end $$;

create function public.field_sales_workflow_gates(p_quote uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare w public.field_sales_workflows; facts jsonb; ready boolean; eligible boolean;
begin
  select * into w from public.field_sales_workflows where quote_id=p_quote;
  facts:=public.field_sales_workflow_order_facts(p_quote);
  eligible:=exists(select 1 from public.field_sales_workflow_settings where enabled)
    and w.state not in ('cancelled','refund_review') and public.field_sales_workflow_document_gate(p_quote,true)
    and facts->>'acceptedAt' is not null and facts->>'disputed'='false' and (facts->>'refundedCents')::bigint=0;
  ready:=eligible and (facts->>'netPaidCents')::bigint>=w.deposit_cents;
  return jsonb_build_object('canDeposit',eligible and w.completed_at is null and (facts->>'netPaidCents')::bigint=0,
    'canBalance',ready and w.completed_at is not null and (facts->>'netPaidCents')::bigint<(facts->>'totalCents')::bigint,
    'canSchedule',ready and w.completed_at is null and w.cancellation_deadline is not null and w.cancellation_deadline<=now(),
    'canAssign',ready and w.job_id is not null and w.completed_at is null and w.cancellation_deadline is not null and w.cancellation_deadline<=now()
      and case when w.job_id is not null then (public.h2s_job_readiness(w.job_id)->>'ready')::boolean else false end,
    'canComplete',w.state='scheduled' and w.technician_id is not null and w.completed_at is null
      and case when w.job_id is not null and w.technician_id is not null then
        (public.h2s_job_readiness(w.job_id)->>'ready')::boolean
        and (public.field_sales_workflow_proof(w.job_id,w.technician_id)->>'complete')::boolean else false end);
end $$;

create function public.field_sales_workflow_installation(p_pro uuid,p_job uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.field_sales_workflows;
begin
  select * into w from public.field_sales_workflows where job_id=p_job;
  if not found then return jsonb_build_object('enrolled',false); end if;
  if not exists(select 1 from public.field_sales_workflow_settings where enabled) then
    raise exception 'Enrolled installation authority disabled' using errcode='55000'; end if;
  if w.technician_id is distinct from p_pro or not exists(select 1 from public.h2s_pros where pro_id=p_pro and is_active)
    or not exists(select 1 from public.h2s_dispatch_job_assignments where job_id=p_job::text and pro_id=p_pro::text
      and state in ('accepted','assigned','done','completed')) then
    raise exception 'Authenticated exact assigned technician required' using errcode='42501'; end if;
  return jsonb_build_object('enrolled',true,'workflow',jsonb_build_object('quoteId',w.quote_id,'jobId',w.job_id,
    'revision',w.revision,'state',w.state,'completedAt',w.completed_at,'expenses',w.technician_expenses,'hours',w.hours,
    'proof',public.field_sales_workflow_proof(w.job_id,p_pro)-'artifacts',
    'canComplete',public.field_sales_workflow_gates(w.quote_id)->'canComplete',
    'preparation',public.h2s_job_readiness(p_job),'gates',public.field_sales_workflow_gates(w.quote_id)));
end $$;

create function public.field_sales_workflow_command(p_actor uuid,p_operation uuid,p_lead uuid,p_quote uuid,p_revision integer,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text; prior public.field_sales_workflow_commands; w public.field_sales_workflows; q public.field_sales_quotes;
  pol public.field_sales_workflow_policies; a jsonb; actor jsonb; facts jsonb; result jsonb; job uuid; linked uuid; v jsonb;
  configuration_status text;
begin
  r:=public.field_sales_workflow_access(p_actor,p_lead);
  if r<>'ADMIN' then raise exception 'Management workflow authority required' using errcode='42501'; end if;
  if p_operation is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Operation and object payload required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('field-workflow:'||p_operation,0));
  select * into prior from public.field_sales_workflow_commands where operation_id=p_operation;
  if found then
    if prior.actor_reference<>p_actor::text or prior.action<>p_action or prior.payload<>p_payload
      or prior.quote_id is distinct from p_quote then raise exception 'Workflow operation reused with different input' using errcode='40001'; end if;
    return prior.result||jsonb_build_object('replayed',true);
  end if;
  select jsonb_build_object('id',"User_ID",'name',"Display_Name") into actor from public."Dashboard_Users" where "User_ID"=p_actor;
  if p_action like 'policy_%' then
    select * into pol from public.field_sales_workflow_policies where policy_id=(p_payload->>'policy_id')::uuid for update;
    if p_action='policy_create' then
      if pol.policy_id is not null then raise exception 'Policy version already exists' using errcode='40001'; end if;
      insert into public.field_sales_workflow_policies(policy_id,kind,definition)
        values((p_payload->>'policy_id')::uuid,p_payload->>'kind',p_payload->'definition');
    else
      if pol.policy_id is null then raise exception 'Policy version unavailable' using errcode='P0002'; end if;
      if p_action in ('policy_update','policy_approve') and p_payload->>'expectedDefinitionHash' is distinct from
        encode(sha256(convert_to(pol.definition::text,'UTF8')),'hex') then
        raise exception 'Policy definition changed; reload the reviewed draft before editing or approving' using errcode='40001'; end if;
      if p_action='policy_update' and pol.status='draft' then
        update public.field_sales_workflow_policies set definition=p_payload->'definition' where policy_id=pol.policy_id;
      elsif p_action='policy_delete_draft' and pol.status='draft' then
        delete from public.field_sales_workflow_policies where policy_id=pol.policy_id;
      elsif p_action='policy_approve' and pol.status='draft' then
        configuration_status:=case when public.field_sales_native_staging_scope() then 'staging_only'
          else coalesce(p_payload->>'status','approved') end;
        if coalesce(p_payload->>'status','approved') not in ('approved','staging_only')
          or (configuration_status='staging_only' and not public.field_sales_native_staging_scope()) then
          raise exception 'Staging configuration requires a verified native test run' using errcode='42501'; end if;
        if jsonb_typeof(p_payload->'evidence') is distinct from 'object' or p_payload->'evidence'='{}'::jsonb then
          raise exception 'Explicit approval evidence required' using errcode='22023'; end if;
        if pol.kind='legal' and (pol.definition->>'depositBasisPoints' is distinct from '2500'
          or jsonb_typeof(pol.definition->'requiredNotices') is distinct from 'array'
          or jsonb_array_length(pol.definition->'requiredNotices')<1
          or not pol.definition ? 'cancellationCalendar'
          or not exists(select 1 from public.field_sales_agreement_policies where policy_id=(pol.definition->>'agreementPolicyId')::uuid
            and (status='approved' or (configuration_status='staging_only' and public.field_sales_configuration_usable(status,'approved'))))) then
          raise exception 'Approved agreement, notices, 25%% and cancellation calendar required' using errcode='55000'; end if;
        if pol.kind='legal' then
          v:=pol.definition->'cancellationCalendar';
          if not v ?& array['timezone','businessDays','deadlineLocalTime','excludedWeekdays','holidays','startEvent']
            or v->>'startEvent' not in ('delivery','acceptance')
            or not exists(select 1 from pg_timezone_names where name=v->>'timezone')
            or jsonb_typeof(v->'businessDays') is distinct from 'number' or (v->>'businessDays')::numeric<>trunc((v->>'businessDays')::numeric)
            or (v->>'businessDays')::numeric not between 0 and 366
            or v->>'deadlineLocalTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            or jsonb_typeof(v->'excludedWeekdays') is distinct from 'array' or jsonb_typeof(v->'holidays') is distinct from 'array'
            or exists(select 1 from jsonb_array_elements(v->'excludedWeekdays') day_value
              where jsonb_typeof(day_value)<>'number' or day_value::text !~ '^[1-7]$')
            or jsonb_array_length(v->'excludedWeekdays')>=7
            or exists(select 1 from jsonb_array_elements(pol.definition->'requiredNotices') notice
              where length(coalesce(notice->>'label',''))<1 or notice->'content' is null) then
            raise exception 'Legal notice copies and explicit usable cancellation calendar required' using errcode='55000'; end if;
        elsif pol.kind='commission' then
          if not pol.definition ?& array['timezone','rateEffectiveEvent','creditPolicy','accountingPolicy','rounding','rates']
            or not exists(select 1 from pg_timezone_names where name=pol.definition->>'timezone')
            or pol.definition->>'rateEffectiveEvent' not in ('accepted','completed','qualified')
            or pol.definition->>'creditPolicy' is distinct from 'approved_attribution'
            or pol.definition->>'accountingPolicy' is distinct from 'customer_revenue_less_actual_equipment_materials_provider_fees'
            or pol.definition->>'rounding' is distinct from 'half_away_from_zero'
            or jsonb_typeof(pol.definition->'rates') is distinct from 'array' or jsonb_array_length(pol.definition->'rates')<1 then
            raise exception 'Approved commission attribution, rate event, tenure rates and no-wage-deduction accounting required' using errcode='55000'; end if;
        elsif pol.kind='settlement' then
          if not pol.definition ?& array['timezone','cutoff','holidayConvention','holidays','method','classification']
            or not exists(select 1 from pg_timezone_names where name=pol.definition->>'timezone')
            or pol.definition->>'cutoff' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
            or pol.definition->>'holidayConvention' not in ('skip','previous_business_day','next_business_day')
            or jsonb_typeof(pol.definition->'holidays') is distinct from 'array'
            or length(coalesce(pol.definition->>'method',''))<1 or length(coalesce(pol.definition->>'classification',''))<1 then
            raise exception 'Approved settlement timezone, cutoff, holiday convention, method and classification required' using errcode='55000'; end if;
        end if;
        update public.field_sales_workflow_policies set status=configuration_status,
          approved_by=case when configuration_status='staging_only' then null else p_actor end,
          approved_at=case when configuration_status='staging_only' then null else now() end,
          approval_evidence=p_payload->'evidence' where policy_id=pol.policy_id;
      elsif p_action='policy_retire' and pol.status='approved' then
        update public.field_sales_workflow_policies set status='retired' where policy_id=pol.policy_id;
      else raise exception 'Policy transition unavailable; approved versions are immutable' using errcode='40001'; end if;
    end if;
    result:=jsonb_build_object('policyId',p_payload->>'policy_id','definitionHash',
      (select encode(sha256(convert_to(definition::text,'UTF8')),'hex') from public.field_sales_workflow_policies
        where policy_id=(p_payload->>'policy_id')::uuid));
  else
    if p_lead is null or p_quote is null or p_revision is null then raise exception 'Exact lead, quote and revision required' using errcode='22023'; end if;
    select * into q from public.field_sales_quotes where quote_id=p_quote and lead_id=p_lead;
    if not found then raise exception 'Exact quote unavailable' using errcode='P0002'; end if;
    select * into w from public.field_sales_workflows where quote_id=p_quote for update;
    if p_action='enroll' then
      if w.quote_id is not null or p_revision<>0 or q.state<>'approved'
        or exists(select 1 from public.field_sales_agreements where quote_id=p_quote)
        or exists(select 1 from public.field_sales_orders where quote_id=p_quote) then
        raise exception 'Enroll a new approved quote before agreement or collection; no historical adoption' using errcode='40001'; end if;
      if jsonb_typeof(p_payload->'credit_evidence') is distinct from 'object' or p_payload->'credit_evidence'='{}'::jsonb
        or not exists(select 1 from public.field_sales_representatives where user_id=(p_payload->>'representative_id')::uuid and active) then
        raise exception 'Approved active representative and immutable credit evidence required' using errcode='22023'; end if;
      foreach a in array array[jsonb_build_object('id',p_payload->>'legal_policy_id','kind','legal'),
        jsonb_build_object('id',p_payload->>'commission_policy_id','kind','commission'),
        jsonb_build_object('id',p_payload->>'settlement_policy_id','kind','settlement')] loop
        if not exists(select 1 from public.field_sales_workflow_policies where policy_id=(a->>'id')::uuid and kind=a->>'kind' and public.field_sales_configuration_usable(status,'approved')) then
          raise exception 'Approved legal, commission and settlement versions required' using errcode='55000'; end if;
      end loop;
      insert into public.field_sales_workflows(quote_id,lead_id,representative_id,credit_evidence,legal_policy_id,commission_policy_id,
        settlement_policy_id,commission_start_date,commission_start_evidence,deposit_cents,balance_cents,created_by)
        values(p_quote,p_lead,(p_payload->>'representative_id')::uuid,p_payload->'credit_evidence',(p_payload->>'legal_policy_id')::uuid,
          (p_payload->>'commission_policy_id')::uuid,(p_payload->>'settlement_policy_id')::uuid,
          (select commission_start_date from public.field_sales_representatives where user_id=(p_payload->>'representative_id')::uuid),
          (select commission_start_evidence from public.field_sales_representatives where user_id=(p_payload->>'representative_id')::uuid),
          ceil((q.snapshot->>'totalCents')::numeric*2500/10000),
          (q.snapshot->>'totalCents')::bigint-ceil((q.snapshot->>'totalCents')::numeric*2500/10000),p_actor) returning * into w;
      perform public.field_sales_workflow_deadline(p_quote,now());
    else
      if w.quote_id is null then raise exception 'Enrolled workflow unavailable' using errcode='P0002'; end if;
      if w.revision<>p_revision then raise exception 'Workflow changed; reload exact revision' using errcode='40001'; end if;
      if w.state in ('cancelled','completed') and p_action not in ('refund_review','delivery_record','cost_review') then
        raise exception 'Ended installation requires management review' using errcode='40001'; end if;
      facts:=public.field_sales_workflow_order_facts(p_quote);
      if p_action='documents_publish' then
        if exists(select 1 from public.field_sales_workflow_artifacts where quote_id=p_quote)
          or exists(select 1 from public.field_sales_agreements where quote_id=p_quote and accepted_at is not null) then
          raise exception 'Approved artifacts immutable; create an amended quote' using errcode='40001'; end if;
        if jsonb_typeof(p_payload->'artifacts') is distinct from 'array' or jsonb_array_length(p_payload->'artifacts') not between 3 and 20
          or jsonb_typeof(p_payload->'evidence') is distinct from 'object' or p_payload->'evidence'='{}'::jsonb then
          raise exception 'Exact approved customer documents and evidence required' using errcode='22023'; end if;
        for a in select value from jsonb_array_elements(p_payload->'artifacts') loop
          if a->>'kind'='quote' and a->'content' is distinct from q.snapshot then
            raise exception 'Customer quote artifact must match immutable quote snapshot' using errcode='22023'; end if;
          if a->>'kind'='agreement' and a->'content' is distinct from
            (select to_jsonb(ap)-array['approved_by','approval_evidence'] from public.field_sales_agreement_policies ap
             join public.field_sales_workflow_policies wp on ap.policy_id=(wp.definition->>'agreementPolicyId')::uuid where wp.policy_id=w.legal_policy_id) then
            raise exception 'Agreement artifact must match approved legal policy copy' using errcode='22023'; end if;
          if length(coalesce(a->>'label',''))<1 or a->'content' is null then raise exception 'Document content and label required' using errcode='22023'; end if;
          insert into public.field_sales_workflow_artifacts(quote_id,kind,label,content,content_hash,approved_by,approval_evidence)
            values(p_quote,a->>'kind',a->>'label',a->'content',encode(sha256(convert_to((a->'content')::text,'UTF8')),'hex'),p_actor,p_payload->'evidence');
        end loop;
        if not public.field_sales_workflow_document_gate(p_quote) then raise exception 'All approved notice copies required' using errcode='55000'; end if;
      elsif p_action='delivery_record' then
        if not public.field_sales_workflow_document_gate(p_quote) or not (p_payload->'evidence') ?& array['method','deliveredAt','recipient','reference'] then
          raise exception 'Approved document delivery method, recipient, time and reference required' using errcode='22023'; end if;
        insert into public.field_sales_workflow_delivery(quote_id,actor_reference,method,artifact_hashes,evidence)
          values(p_quote,p_actor::text,'recorded_delivery',(select jsonb_agg(content_hash order by kind,label)
            from public.field_sales_workflow_artifacts where quote_id=p_quote),p_payload->'evidence');
      elsif p_action='cost_review' then
        if w.completed_at is null or w.costs_complete or not public.field_sales_workflow_validate_costs(p_payload->'expenses')
          or jsonb_typeof(p_payload->'evidence') is distinct from 'object' or p_payload#>>'{evidence,actualCostsReviewed}' is distinct from 'true'
          or length(coalesce(p_payload#>>'{evidence,reference}',''))<3 then
          raise exception 'Completed work, complete actual quantities/unit amounts/receipts and explicit management cost approval required' using errcode='22023'; end if;
        update public.field_sales_workflows set expenses=p_payload->'expenses',costs_complete=true,cost_review_evidence=p_payload->'evidence',
          cost_approved_by=p_actor,cost_approved_at=now() where quote_id=p_quote;
      elsif p_action in ('schedule','reschedule','preparation','assign') then
        if w.state='refund_review' or not public.field_sales_workflow_document_gate(p_quote,true)
          or w.cancellation_deadline is null or w.cancellation_deadline>now()
          or (facts->>'netPaidCents')::bigint<w.deposit_cents or facts->>'disputed'='true' or (facts->>'refundedCents')::bigint>0
          or (select accepted_at from public.field_sales_agreements where quote_id=p_quote) is null then
          raise exception 'Accepted delivered notices and verified 25%% deposit without exceptions required' using errcode='55000'; end if;
        select order_id into linked from public.field_sales_orders where quote_id=p_quote;
        if linked is null or linked<>q.order_uuid then raise exception 'Exact enrolled order unavailable' using errcode='55000'; end if;
        if p_action in ('schedule','reschedule') then
          if w.job_id is null then
            if exists(select 1 from public.commercial_lead_operations where lead_id=p_lead
              and (installation_job_id is not null or order_id is not null)) then
              raise exception 'Existing linked work prevents a new installation' using errcode='40001'; end if;
            job:=gen_random_uuid();
            if exists(select 1 from information_schema.columns where table_schema='public'
              and table_name='h2s_dispatch_jobs' and column_name='job_kind') then
              insert into public.h2s_dispatch_jobs(job_id,order_id,status,job_kind,metadata_json)
                values(job,linked::text,'queued','installation',
                  jsonb_build_object('field_sales_workflow',jsonb_build_object('enrolled',true,'quoteId',p_quote,'leadId',p_lead,'orderId',linked)));
            else
              insert into public.h2s_dispatch_jobs(job_id,order_id,status,metadata_json) values(job,linked::text,'queued',
                jsonb_build_object('field_sales_workflow',jsonb_build_object('enrolled',true,'quoteId',p_quote,'leadId',p_lead,'orderId',linked)));
            end if;
            update public.commercial_lead_operations set order_id=linked,installation_job_id=job,revision=revision+1 where lead_id=p_lead;
            update public.field_sales_workflows set job_id=job where quote_id=p_quote;
            w.job_id:=job;
          end if;
          perform public.commercial_record_reservation(p_lead,(p_payload->>'reservation_revision')::integer,p_operation,actor,
            case when p_action='schedule' then 'confirm' else 'reschedule' end,
            p_payload-array['reservation_revision']);
          update public.field_sales_workflows set state='scheduled' where quote_id=p_quote;
        elsif p_action='preparation' then
          if w.job_id is null then raise exception 'Schedule exact installation first' using errcode='55000'; end if;
          v:=p_payload-array['preparation_revision'];
          v:=v||jsonb_build_object('context',public.h2s_job_readiness(w.job_id)->'context',
            'expectedJobUpdatedAt',(select updated_at from public.h2s_dispatch_jobs where job_id=w.job_id),
            'expectedOrderUpdatedAt',(select updated_at from public.h2s_orders where id=linked));
          perform public.h2s_record_job_preparation(w.job_id,(p_payload->>'preparation_revision')::integer,p_operation,actor,v);
        else
          if w.job_id is null or not (public.h2s_job_readiness(w.job_id)->>'ready')::boolean then
            raise exception 'Prepared exact installation required before technician offer' using errcode='55000'; end if;
          perform public.h2s_management_assign_technician(w.job_id,(p_payload->>'pro_id')::uuid,p_operation,p_actor,
            p_payload->>'context',p_payload->>'note');
          update public.field_sales_workflows set technician_id=(p_payload->>'pro_id')::uuid where quote_id=p_quote;
        end if;
      elsif p_action in ('cancel','refund_review') then
        if length(coalesce(p_payload->>'reason',''))<3 or jsonb_typeof(p_payload->'evidence') is distinct from 'object' or p_payload->'evidence'='{}'::jsonb then
          raise exception 'Cancellation/refund reason and evidence required; no nonrefund presumption' using errcode='22023'; end if;
        if p_action='cancel' then
          if exists(select 1 from public.field_sales_checkouts where quote_id=p_quote and state in ('creating','open','pending','failed')) then
            raise exception 'Expire or reconcile every active checkout before cancellation; a browser return is not cancellation' using errcode='40001'; end if;
          if w.completed_at is not null then raise exception 'Completed installation requires refund review' using errcode='40001'; end if;
          if w.job_id is not null then
            update public.h2s_dispatch_jobs set status='cancelled',updated_at=now() where job_id=w.job_id;
            update public.h2s_dispatch_job_assignments set state='cancelled',updated_at=now() where job_id=w.job_id::text
              and state not in ('declined','expired','rejected','cancelled','canceled');
          elsif exists(select 1 from public.commercial_reservations where lead_id=p_lead and state in ('confirmed','tentative')) then
            perform public.commercial_record_reservation(p_lead,(select revision from public.commercial_reservations where lead_id=p_lead),
              p_operation,actor,'cancel',jsonb_build_object('reason',p_payload->>'reason'));
          end if;
          update public.field_sales_workflows set state='cancelled' where quote_id=p_quote;
        else update public.field_sales_workflows set state='refund_review' where quote_id=p_quote; end if;
      else raise exception 'Unsupported workflow action' using errcode='22023'; end if;
      update public.field_sales_workflows set revision=revision+1 where quote_id=p_quote;
    end if;
    result:=jsonb_build_object('quoteId',p_quote,'revision',(select revision from public.field_sales_workflows where quote_id=p_quote));
  end if;
  insert into public.field_sales_workflow_commands(operation_id,actor_reference,quote_id,action,payload,result)
    values(p_operation,p_actor::text,p_quote,p_action,p_payload,result);
  return result||jsonb_build_object('replayed',false);
end $$;

create function public.field_sales_workflow_record_proof(p_pro uuid,p_job uuid,p_operation uuid,p_revision integer,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.field_sales_workflows; prior public.field_sales_workflow_commands; proof jsonb; requirements jsonb;
  row jsonb; requirement jsonb; artifact jsonb; artifact_id uuid; seen_ids jsonb:='[]'; seen_keys jsonb:='[]'; key text; result jsonb;
begin
  select * into w from public.field_sales_workflows where job_id=p_job;
  if not found then return jsonb_build_object('enrolled',false); end if;
  perform 1 from public.commercial_leads where lead_id=w.lead_id for update;
  select * into w from public.field_sales_workflows where job_id=p_job for update;
  perform 1 from public.h2s_dispatch_jobs where job_id=p_job for update;
  perform public.field_sales_workflow_installation(p_pro,p_job);
  if p_operation is null or p_revision is null then raise exception 'Proof operation and workflow revision required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('field-workflow:'||p_operation,0));
  select * into prior from public.field_sales_workflow_commands where operation_id=p_operation;
  if found then
    if prior.actor_reference<>p_pro::text or prior.quote_id<>w.quote_id or prior.action<>'proof_record' or prior.payload<>p_payload then
      raise exception 'Proof retry changed evidence' using errcode='40001';
    end if;
    return prior.result||jsonb_build_object('replayed',true);
  end if;
  if w.revision<>p_revision or w.completed_at is not null or w.state<>'scheduled'
    or (select status from public.h2s_dispatch_jobs where job_id=p_job) not in ('queued','assigned','in_progress') then
    raise exception 'Installation changed; reload before recording proof' using errcode='40001';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' or p_payload-array['bindings','checklists']<>'{}'
    or jsonb_typeof(p_payload->'bindings') is distinct from 'array' or jsonb_typeof(p_payload->'checklists') is distinct from 'array'
    or jsonb_array_length(p_payload->'bindings')>3000 or jsonb_array_length(p_payload->'checklists')>3000 then
    raise exception 'Explicit proof bindings and checklists required' using errcode='22023';
  end if;
  perform 1 from public.h2s_dispatch_job_artifacts where job_id::text=p_job::text for share;
  proof:=public.field_sales_workflow_proof(p_job,p_pro); requirements:=public.field_sales_workflow_requirements(w.quote_id);
  for row in select value from jsonb_array_elements(p_payload->'bindings') loop
    key:=jsonb_build_array(row->>'serviceId',row->>'requirementId')::text;
    select value into requirement from jsonb_array_elements(requirements)
      where value->>'serviceId'=row->>'serviceId' and value->>'id'=row->>'requirementId' and value->>'type' in ('photo','signature');
    if not found or jsonb_typeof(row) is distinct from 'object' or row-array['serviceId','requirementId','artifactIds']<>'{}'
      or seen_keys @> jsonb_build_array(key) or jsonb_typeof(row->'artifactIds') is distinct from 'array'
      or jsonb_array_length(row->'artifactIds')>100 then
      raise exception 'Choose a distinct pinned photo/signature requirement and artifact IDs' using errcode='22023';
    end if;
    seen_keys:=seen_keys||jsonb_build_array(key);
    for artifact in select value from jsonb_array_elements(row->'artifactIds') loop
      if jsonb_typeof(artifact) is distinct from 'string' or artifact#>>'{}' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
        raise exception 'Native artifact UUID required' using errcode='22023';
      end if;
      artifact_id:=(artifact#>>'{}')::uuid;
      if seen_ids @> jsonb_build_array(artifact_id) then
        raise exception 'A native artifact cannot satisfy two configured requirements or be counted twice' using errcode='22023';
      end if;
      if not exists(select 1 from jsonb_array_elements(proof->'artifacts') candidate
        where candidate->>'artifactId'=artifact_id::text and candidate->>'type'=requirement->>'type') then
        raise exception 'Artifact must belong to the exact job/current pro after acceptance and match the required type' using errcode='22023';
      end if;
      seen_ids:=seen_ids||jsonb_build_array(artifact_id);
    end loop;
  end loop;
  for row in select value from jsonb_array_elements(p_payload->'checklists') loop
    key:=jsonb_build_array(row->>'serviceId',row->>'requirementId')::text;
    if jsonb_typeof(row) is distinct from 'object' or row-array['serviceId','requirementId','affirmed','evidence']<>'{}'
      or seen_keys @> jsonb_build_array(key) or row->'affirmed' is distinct from 'true'::jsonb
      or jsonb_typeof(row->'evidence') is distinct from 'object' or row->'evidence'='{}'
      or jsonb_typeof(row#>'{evidence,reference}') is distinct from 'string'
      or length(btrim(row#>>'{evidence,reference}')) not between 3 and 2000
      or not exists(select 1 from jsonb_array_elements(requirements) rule
        where rule->>'serviceId'=row->>'serviceId' and rule->>'id'=row->>'requirementId' and rule->>'type'='checklist') then
      raise exception 'Pinned checklist requires explicit affirmative confirmation and evidence reference' using errcode='22023';
    end if;
    seen_keys:=seen_keys||jsonb_build_array(key);
  end loop;
  delete from public.field_sales_workflow_proof_bindings where quote_id=w.quote_id;
  delete from public.field_sales_workflow_proof_checks where quote_id=w.quote_id;
  for row in select value from jsonb_array_elements(p_payload->'bindings') loop
    for artifact in select value from jsonb_array_elements(row->'artifactIds') loop
      insert into public.field_sales_workflow_proof_bindings(quote_id,service_id,requirement_id,artifact_id,recorded_by)
        values(w.quote_id,row->>'serviceId',row->>'requirementId',(artifact#>>'{}')::uuid,p_pro);
    end loop;
  end loop;
  for row in select value from jsonb_array_elements(p_payload->'checklists') loop
    insert into public.field_sales_workflow_proof_checks(quote_id,service_id,requirement_id,affirmed,evidence,recorded_by)
      values(w.quote_id,row->>'serviceId',row->>'requirementId',true,row->'evidence',p_pro);
  end loop;
  update public.field_sales_workflows set revision=revision+1 where quote_id=w.quote_id;
  result:=jsonb_build_object('enrolled',true,'proofRecorded',true,'revision',w.revision+1,'replayed',false);
  insert into public.field_sales_workflow_commands values(p_operation,p_pro::text,w.quote_id,'proof_record',p_payload,result,now());
  return result;
end $$;

create function public.field_sales_workflow_complete(p_pro uuid,p_job uuid,p_operation uuid,p_revision integer,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.field_sales_workflows; prior public.field_sales_workflow_commands; e jsonb; result jsonb; proof jsonb;
begin
  select * into w from public.field_sales_workflows where job_id=p_job;
  if not found then return jsonb_build_object('enrolled',false); end if;
  if not exists(select 1 from public.field_sales_workflow_settings where enabled) then
    raise exception 'Enrolled completion authority disabled' using errcode='55000'; end if;
  perform 1 from public.commercial_leads where lead_id=w.lead_id for update;
  select * into w from public.field_sales_workflows where quote_id=w.quote_id for update;
  perform 1 from public.h2s_dispatch_jobs where job_id=p_job for update;
  if w.technician_id is distinct from p_pro or not exists(select 1 from public.h2s_pros where pro_id=p_pro and is_active)
    or not exists(select 1 from public.h2s_dispatch_job_assignments where job_id=p_job::text and pro_id=p_pro::text
      and state in ('accepted','assigned','done','completed')) then
    raise exception 'Authenticated exact assigned technician required' using errcode='42501'; end if;
  if p_operation is null or p_revision is null then raise exception 'Completion operation and workflow revision required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('field-workflow:'||p_operation,0));
  select * into prior from public.field_sales_workflow_commands where operation_id=p_operation;
  if found then
    if prior.actor_reference<>p_pro::text or prior.quote_id<>w.quote_id or prior.action<>'complete' or prior.payload<>p_payload then
      raise exception 'Completion retry changed evidence' using errcode='40001'; end if;
    return prior.result||jsonb_build_object('replayed',true);
  end if;
  if w.revision<>p_revision or w.completed_at is not null or w.state<>'scheduled'
    or (select status from public.h2s_dispatch_jobs where job_id=p_job) not in ('queued','assigned','in_progress')
    or not (public.h2s_job_readiness(p_job)->>'ready')::boolean then
    raise exception 'Installation state or preparation changed; reconcile before completion' using errcode='40001'; end if;
  if not public.field_sales_workflow_validate_costs(p_payload->'expenses')
    or jsonb_typeof(p_payload->'hours') is distinct from 'number' or (p_payload->>'hours')::numeric not between 0.01 and 10000
    or jsonb_typeof(p_payload->'evidence') is distinct from 'object' or p_payload->'evidence'='{}'::jsonb then
    raise exception 'Actual equipment/material quantities, amounts, hours and completion evidence required' using errcode='22023'; end if;
  if to_regclass('public.h2s_dispatch_job_artifacts') is null then
    raise exception 'Existing portal installation artifact authority unavailable; certify schema before workflow activation' using errcode='55000';
  end if;
  perform 1 from public.h2s_dispatch_job_artifacts where job_id::text=p_job::text for share;
  proof:=public.field_sales_workflow_proof(p_job,p_pro);
  if not (proof->>'complete')::boolean then
    raise exception 'Completion proof missing: %',proof->'missing' using errcode='22023';
  end if;
  update public.field_sales_workflows set completed_at=now(),completion_operation_id=p_operation,
    completion_evidence=p_payload->'evidence',completion_proof=proof,hours=(p_payload->>'hours')::numeric,
    technician_expenses=p_payload->'expenses',
    state='completed',revision=revision+1 where quote_id=w.quote_id;
  perform set_config('h2s.commercial_completion',w.lead_id::text,true);
  perform set_config('h2s.field_sales_completion',w.quote_id::text,true);
  update public.h2s_dispatch_jobs set status='completed',updated_at=now() where job_id=p_job;
  update public.h2s_dispatch_job_assignments set state='completed',updated_at=now() where job_id=p_job::text and pro_id=p_pro::text and state in ('assigned','accepted');
  result:=jsonb_build_object('enrolled',true,'jobId',p_job,'quoteId',w.quote_id,'completed',true,'balanceCollectionEligible',true,
    'externalPaymentInitiated',false,'revision',w.revision+1);
  insert into public.field_sales_workflow_commands values(p_operation,p_pro::text,w.quote_id,'complete',p_payload,result,now());
  return result;
end $$;

alter function public.field_sales_transaction_command(uuid,uuid,uuid,text,jsonb) rename to field_sales_transaction_command_legacy;
create function public.field_sales_transaction_command(p_actor uuid,p_operation uuid,p_lead uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.field_sales_workflows; d jsonb;
begin
  perform public.field_sales_transaction_access(p_actor,p_lead);
  if p_action='agreement' then
    select * into w from public.field_sales_workflows where quote_id=(p_payload->>'quoteId')::uuid;
    if found then
      perform public.field_sales_workflow_access(p_actor,p_lead);
      select definition into d from public.field_sales_workflow_policies where policy_id=w.legal_policy_id and public.field_sales_configuration_usable(status,'approved');
      if not public.field_sales_workflow_document_gate(w.quote_id) or d is null
        or (select agreement_policy_id from public.field_sales_transaction_settings)::text is distinct from d->>'agreementPolicyId'
        or (select deposit_policy->>'mode' from public.field_sales_transaction_settings) is distinct from 'basis_points'
        or (select deposit_policy->>'basisPoints' from public.field_sales_transaction_settings) is distinct from '2500' then
        raise exception 'Exact approved legal documents and 2500bps deposit configuration required' using errcode='55000'; end if;
    end if;
  end if;
  return public.field_sales_transaction_command_legacy(p_actor,p_operation,p_lead,p_action,p_payload);
end $$;
alter function public.field_sales_customer_agreement(text,jsonb) rename to field_sales_customer_agreement_legacy;
create function public.field_sales_customer_agreement(p_token_hash text,p_accept jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare q uuid; w public.field_sales_workflows; result jsonb; docs jsonb; hashes jsonb; agreement public.field_sales_agreements; start_event text;
begin
  select quote_id into q from public.field_sales_agreements where token_hash=p_token_hash;
  if q is not null and exists(select 1 from public.field_sales_workflows where quote_id=q)
    and not exists(select 1 from public.field_sales_agreements where quote_id=q and expires_at>now()) then
    raise exception 'Customer capability expired; request an authenticated renewed balance/document handoff' using errcode='P0002'; end if;
  if q is null then
    select quote_id into q from public.field_sales_workflow_handoffs where token_hash=p_token_hash and expires_at>now()
      and scope='accepted_documents_balance';
    if q is not null and not exists(select 1 from public.field_sales_agreements where quote_id=q and accepted_at is not null) then
      raise exception 'Renewed capability cannot accept an expired unaccepted quote' using errcode='42501'; end if;
  end if;
  select * into w from public.field_sales_workflows where quote_id=q;
  if found then
    perform 1 from public.commercial_leads where lead_id=w.lead_id for update;
    if not exists(select 1 from public.field_sales_workflow_settings where enabled) or (p_accept is not null and w.state in ('cancelled','refund_review'))
      or not public.field_sales_workflow_document_gate(q,p_accept is not null) then
      raise exception 'Approved notice copies and customer retrieval required before acceptance' using errcode='55000'; end if;
    select jsonb_agg(jsonb_build_object('artifactId',artifact_id,'kind',kind,'label',label,'content',content,
      'contentHash',content_hash,'approvedAt',approved_at) order by kind,label),
      jsonb_agg(content_hash order by kind,label) into docs,hashes from public.field_sales_workflow_artifacts where quote_id=q;
    if p_accept is null then
      insert into public.field_sales_workflow_delivery(quote_id,actor_reference,method,artifact_hashes,evidence)
        values(q,'customer-handoff','customer_retrieval',hashes,jsonb_build_object('agreementTokenAuthenticated',true,'retrievedAt',now()));
      select definition#>>'{cancellationCalendar,startEvent}' into start_event from public.field_sales_workflow_policies where policy_id=w.legal_policy_id;
      if start_event='delivery' then
        update public.field_sales_workflows set cancellation_deadline=coalesce(cancellation_deadline,public.field_sales_workflow_deadline(q,now()))
          where quote_id=q returning * into w;
      end if;
    end if;
  end if;
  select * into agreement from public.field_sales_agreements where quote_id=q;
  if w.quote_id is not null and agreement.accepted_at is not null then
    if p_accept is not null and agreement.acceptance-'operationId' is distinct from p_accept-'operationId' then
      raise exception 'Acceptance already recorded with different evidence' using errcode='40001'; end if;
    result:=jsonb_build_object('agreement',jsonb_build_object('agreement_id',agreement.agreement_id,'accepted_at',agreement.accepted_at,
      'acceptance',agreement.acceptance,'policy_snapshot',agreement.policy_snapshot-array['approved_by','approval_evidence']),
      'quote',(select jsonb_build_object('quote_id',quote_id,'quote_hash',quote_hash,'revision',revision,
        'snapshot',snapshot-'managementReview','expires_at',expires_at) from public.field_sales_quotes where quote_id=q));
  else result:=public.field_sales_customer_agreement_legacy(p_token_hash,p_accept); end if;
  if w.quote_id is not null then
    select * into agreement from public.field_sales_agreements where quote_id=q;
    select definition#>>'{cancellationCalendar,startEvent}' into start_event from public.field_sales_workflow_policies where policy_id=w.legal_policy_id;
    if start_event='acceptance' and agreement.accepted_at is not null then
      update public.field_sales_workflows set cancellation_deadline=coalesce(cancellation_deadline,
        public.field_sales_workflow_deadline(q,agreement.accepted_at)) where quote_id=q returning * into w;
    end if;
    result:=result||jsonb_build_object('workflow',jsonb_build_object('quoteId',q,'documents',docs,'cancellationDeadline',w.cancellation_deadline,
      'gates',public.field_sales_workflow_gates(q),'netPaidCents',public.field_sales_workflow_order_facts(q)->'netPaidCents',
      'depositCents',w.deposit_cents,'balanceCents',greatest(0,(public.field_sales_workflow_order_facts(q)->>'totalCents')::bigint
        -(public.field_sales_workflow_order_facts(q)->>'netPaidCents')::bigint),
      'agreedBalanceCents',w.balance_cents,'completedAt',w.completed_at,
      'payments',coalesce((select jsonb_agg(jsonb_build_object('checkout_id',checkout_id,'state',state,
        'captured_cents',captured_cents,'refunded_cents',refunded_cents,'disputed',disputed))
        from public.field_sales_checkouts where quote_id=q),'[]'),
      'deliveryEvidence',jsonb_build_array(jsonb_build_object('method','customer_retrieval','artifactHashes',hashes))));
  end if;
  return result;
end $$;
create function public.field_sales_workflow_customer_context(p_token_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.field_sales_agreements; w public.field_sales_workflows;
begin
  select * into a from public.field_sales_agreements where token_hash=p_token_hash and expires_at>now();
  if not found then
    select ag.* into a from public.field_sales_workflow_handoffs h join public.field_sales_agreements ag using(quote_id)
      where h.token_hash=p_token_hash and h.expires_at>now() and h.scope='accepted_documents_balance' and ag.accepted_at is not null;
  end if;
  select * into w from public.field_sales_workflows where quote_id=a.quote_id;
  if w.quote_id is null or a.accepted_at is null or w.state in ('cancelled','refund_review')
    or not exists(select 1 from public.field_sales_workflow_settings where enabled)
    or not public.field_sales_workflow_document_gate(w.quote_id,true) then
    raise exception 'Exact accepted enrolled customer handoff required' using errcode='42501'; end if;
  return jsonb_build_object('quoteId',w.quote_id,'leadId',w.lead_id,
    'actorId',(select owner_user_id from public.field_sales_opportunities where lead_id=w.lead_id));
end $$;
create function public.field_sales_workflow_renew_handoff(p_actor uuid,p_operation uuid,p_quote uuid,p_token_hash text,p_minutes integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.field_sales_workflows; handoff public.field_sales_workflow_handoffs;
begin
  select * into w from public.field_sales_workflows where quote_id=p_quote;
  if not found then raise exception 'Exact enrolled quote required' using errcode='P0002'; end if;
  perform public.field_sales_workflow_access(p_actor,w.lead_id);
  if p_operation is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_minutes is null or p_minutes not between 1 and 1440
    or not exists(select 1 from public.field_sales_agreements where quote_id=p_quote and accepted_at is not null) then
    raise exception 'Accepted immutable agreement and configured finite customer capability lifespan required' using errcode='55000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('field-handoff:'||p_operation,0));
  select * into handoff from public.field_sales_workflow_handoffs where handoff_id=p_operation;
  if found then
    if handoff.quote_id<>p_quote or handoff.issued_by<>p_actor or handoff.token_hash<>p_token_hash or handoff.duration_minutes<>p_minutes then
      raise exception 'Handoff operation reused with changed scope' using errcode='40001'; end if;
  else
    insert into public.field_sales_workflow_handoffs(handoff_id,quote_id,token_hash,scope,duration_minutes,expires_at,issued_by)
      values(p_operation,p_quote,p_token_hash,'accepted_documents_balance',p_minutes,now()+make_interval(mins=>p_minutes),p_actor)
      returning * into handoff;
  end if;
  return jsonb_build_object('handoffId',handoff.handoff_id,'expiresAt',handoff.expires_at,'scope',handoff.scope);
end $$;
alter function public.field_sales_reserve_checkout(uuid,uuid,uuid,uuid,text) rename to field_sales_reserve_checkout_legacy;
create function public.field_sales_reserve_checkout(p_actor uuid,p_operation uuid,p_lead uuid,p_quote uuid,p_kind text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.field_sales_workflows; q public.field_sales_quotes; a public.field_sales_agreements; pay public.field_sales_checkouts; facts jsonb; amount bigint;
begin
  perform public.field_sales_transaction_access(p_actor,p_lead);
  select * into w from public.field_sales_workflows where quote_id=p_quote and lead_id=p_lead for update;
  if not found then return public.field_sales_reserve_checkout_legacy(p_actor,p_operation,p_lead,p_quote,p_kind); end if;
  perform public.field_sales_workflow_access(p_actor,p_lead);
  select * into q from public.field_sales_quotes where quote_id=p_quote;
  select * into a from public.field_sales_agreements where quote_id=p_quote;
  facts:=public.field_sales_workflow_order_facts(p_quote);
  if a.accepted_at is null or not public.field_sales_workflow_document_gate(p_quote,true) or w.state in ('cancelled','refund_review')
    or facts->>'disputed'='true' or (facts->>'refundedCents')::bigint>0 then
    raise exception 'Delivered accepted notices and reconciled enrolled payment state required' using errcode='55000'; end if;
  if p_kind not in ('deposit','balance') or (p_kind='balance' and w.completed_at is null) then
    raise exception 'Enrolled sales require 25%% first and balance only after installation completion' using errcode='22023'; end if;
  select * into pay from public.field_sales_checkouts where checkout_id=p_operation;
  if found then
    if pay.quote_id<>p_quote or pay.kind<>p_kind or pay.created_by<>p_actor then raise exception 'Checkout key reused' using errcode='40001'; end if;
    return to_jsonb(pay);
  end if;
  select * into pay from public.field_sales_checkouts where quote_id=p_quote and state in ('creating','open','pending','failed');
  if found then
    if pay.kind<>p_kind then raise exception 'Existing receipt lock requires reconciliation' using errcode='40001'; end if;
    return to_jsonb(pay);
  end if;
  if p_kind='deposit' then
    if (facts->>'netPaidCents')::bigint<>0 or q.expires_at<now()+interval '31 minutes' then
      raise exception 'Deposit already collected or quote window unavailable' using errcode='40001'; end if;
    amount:=w.deposit_cents;
  else
    if (facts->>'netPaidCents')::bigint<w.deposit_cents then raise exception 'Verified deposit required' using errcode='55000'; end if;
    amount:=(facts->>'totalCents')::bigint-(facts->>'netPaidCents')::bigint;
  end if;
  if amount<=0 then raise exception 'Current net balance already paid' using errcode='40001'; end if;
  insert into public.field_sales_checkouts(checkout_id,quote_id,agreement_id,lead_id,kind,amount_cents,policy_snapshot,created_by,expires_at)
    values(p_operation,p_quote,a.agreement_id,p_lead,p_kind,amount,jsonb_build_object('mode',p_kind,'basisPoints',2500,
      'legalPolicyId',w.legal_policy_id,'fullCents',facts->'totalCents','depositCents',w.deposit_cents,'balanceCents',w.balance_cents),
      p_actor,case when p_kind='deposit' then least(q.expires_at,now()+interval '1 hour') else now()+interval '1 hour' end) returning * into pay;
  return to_jsonb(pay);
end $$;
-- Adapt only the existing receipt's mode predicate. Its identity checks, row locks,
-- net-balance updates, monotonic capture/refund counters and legacy order creation remain authoritative.
do $$ declare src text; begin
  src:=pg_get_functiondef('public.field_sales_record_receipt(uuid,text,jsonb)'::regprocedure);
  src:=replace(src,'p_receipt->>''livemode'' is distinct from ''false''',
    '(p_receipt->>''livemode'') is distinct from (case when pay.stripe_mode=''live'' and exists(select 1 from public.field_sales_workflows where quote_id=pay.quote_id) then ''true'' else ''false'' end)');
  execute src;
end $$;
alter function public.field_sales_record_receipt(uuid,text,jsonb) rename to field_sales_record_receipt_legacy;
create function public.field_sales_record_receipt(p_checkout uuid,p_event text,p_receipt jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare pay public.field_sales_checkouts; w public.field_sales_workflows; result jsonb; facts jsonb;
begin
  select * into pay from public.field_sales_checkouts where checkout_id=p_checkout;
  perform 1 from public.commercial_leads where lead_id=pay.lead_id for update;
  select * into w from public.field_sales_workflows where quote_id=pay.quote_id for update;
  if found and not exists(select 1 from public.field_sales_workflow_settings where enabled) then
    raise exception 'Enrolled receipt authority disabled; retry required' using errcode='55000'; end if;
  result:=public.field_sales_record_receipt_legacy(p_checkout,p_event,p_receipt);
  update public.field_sales_workflow_refunds set state='verified' where checkout_id=p_checkout and state='provider_pending'
    and provider_receipt->>'status'='succeeded'
    and (select refunded_cents from public.field_sales_checkouts where checkout_id=p_checkout)>=previous_refunded_cents+amount_cents;
  if p_receipt->'processingFeeCents' is not null and p_receipt->'processingFeeCents'<>'null'::jsonb then
    if jsonb_typeof(p_receipt->'processingFeeCents') is distinct from 'number'
      or (p_receipt->>'processingFeeCents')::numeric<>trunc((p_receipt->>'processingFeeCents')::numeric)
      or (p_receipt->>'processingFeeCents')::bigint<0
      or p_receipt#>>'{processingFeeEvidence,verified}' is distinct from 'true'
      or p_receipt#>>'{processingFeeEvidence,source}' is distinct from 'stripe.balance_transaction'
      or p_receipt#>>'{processingFeeEvidence,paymentIntentId}' is distinct from p_receipt->>'paymentIntentId' then
      raise exception 'Actual provider balance transaction fee evidence required' using errcode='22023'; end if;
    update public.field_sales_checkouts set processing_fee_cents=(p_receipt->>'processingFeeCents')::bigint,
      processing_fee_evidence=p_receipt->'processingFeeEvidence' where checkout_id=p_checkout;
  end if;
  if w.quote_id is not null then
    facts:=public.field_sales_workflow_order_facts(w.quote_id);
    if (facts->>'netPaidCents')::bigint=(facts->>'totalCents')::bigint and facts->>'disputed'='false' and (facts->>'refundedCents')::bigint=0 then
      update public.field_sales_workflows set verified_paid_at=coalesce(verified_paid_at,now()),
        fully_paid_event_id=coalesce(fully_paid_event_id,p_event) where quote_id=w.quote_id;
    end if;
    update public.h2s_orders set status=case when w.state='cancelled' then 'cancelled'
        when facts->>'disputed'='true' or (facts->>'refundedCents')::bigint>0 then 'field_sales_payment_exception'
        else 'field_sales_enrolled' end,
      metadata_json=jsonb_set(metadata_json,'{field_sales,mode}',to_jsonb(pay.stripe_mode),true)
      ||jsonb_build_object('field_sales_workflow',jsonb_build_object('quoteId',w.quote_id,'jobId',w.job_id,'enrolled',true))
      where id=(select order_id from public.field_sales_orders where quote_id=w.quote_id);
    update public.field_sales_workflows set revision=revision+1 where quote_id=w.quote_id;
    result:=jsonb_set(result,'{summary,mode}',to_jsonb(pay.stripe_mode),true);
  end if;
  return result;
end $$;
create function public.field_sales_workflow_reserve_refund(p_actor uuid,p_operation uuid,p_checkout uuid,p_amount bigint,p_evidence jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare pay public.field_sales_checkouts; req public.field_sales_workflow_refunds; r text;
begin
  select * into pay from public.field_sales_checkouts where checkout_id=p_checkout;
  r:=public.field_sales_workflow_access(p_actor,pay.lead_id);
  if r<>'ADMIN' then raise exception 'Management refund authority required' using errcode='42501'; end if;
  select * into pay from public.field_sales_checkouts where checkout_id=p_checkout for update;
  perform pg_advisory_xact_lock(hashtextextended('field-refund:'||p_operation,0));
  select * into req from public.field_sales_workflow_refunds where operation_id=p_operation;
  if found then
    if req.actor_id<>p_actor or req.checkout_id<>p_checkout or req.amount_cents<>p_amount or req.evidence<>p_evidence then
      raise exception 'Refund retry changed approved input' using errcode='40001'; end if;
    return to_jsonb(req);
  end if;
  if not exists(select 1 from public.field_sales_workflows where quote_id=pay.quote_id and state in ('cancelled','refund_review'))
    or p_operation is null or p_amount is null or p_amount not between 1 and pay.captured_cents-pay.refunded_cents
    or pay.payment_intent_id is null or pay.disputed or jsonb_typeof(p_evidence) is distinct from 'object' or p_evidence='{}'::jsonb then
    raise exception 'Approved cancellation/refund review and exact refundable provider receipt required' using errcode='55000'; end if;
  insert into public.field_sales_workflow_refunds(operation_id,checkout_id,actor_id,amount_cents,previous_refunded_cents,evidence)
    values(p_operation,p_checkout,p_actor,p_amount,pay.refunded_cents,p_evidence) returning * into req;
  return to_jsonb(req);
end $$;
create function public.field_sales_workflow_refund_result(p_actor uuid,p_operation uuid,p_receipt jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare req public.field_sales_workflow_refunds; pay public.field_sales_checkouts; role_name text;
begin
  select * into req from public.field_sales_workflow_refunds where operation_id=p_operation;
  select * into pay from public.field_sales_checkouts where checkout_id=req.checkout_id;
  role_name:=public.field_sales_workflow_access(p_actor,pay.lead_id);
  select * into req from public.field_sales_workflow_refunds where operation_id=p_operation for update;
  select * into pay from public.field_sales_checkouts where checkout_id=req.checkout_id for update;
  if role_name<>'ADMIN' or req.actor_id<>p_actor
    or p_receipt->>'paymentIntentId' is distinct from pay.payment_intent_id
    or (p_receipt->>'amountCents')::bigint is distinct from req.amount_cents
    or p_receipt->>'currency' is distinct from 'usd'
    or p_receipt->>'livemode' is distinct from (pay.stripe_mode='live')::text
    or p_receipt->>'status' not in ('pending','succeeded','failed','canceled')
    or length(coalesce(p_receipt->>'refundId',''))<4 then
    raise exception 'Provider refund identity/amount requires reconciliation' using errcode='22023'; end if;
  if req.provider_refund_id is not null and req.provider_refund_id<>p_receipt->>'refundId' then
    raise exception 'Refund provider identity conflict' using errcode='40001'; end if;
  update public.field_sales_workflow_refunds set provider_refund_id=p_receipt->>'refundId',provider_receipt=p_receipt,
    state=case when p_receipt->>'status' in ('failed','canceled') then 'failed'
      when p_receipt->>'status'='succeeded' and pay.refunded_cents>=req.previous_refunded_cents+req.amount_cents then 'verified'
      else 'provider_pending' end where operation_id=p_operation returning * into req;
  return to_jsonb(req);
end $$;
create function public.field_sales_workflow_bind_mode(p_actor uuid,p_checkout uuid,p_mode text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare pay public.field_sales_checkouts;
begin
  select * into pay from public.field_sales_checkouts where checkout_id=p_checkout;
  if not found then raise exception 'Reserved checkout unavailable' using errcode='P0002'; end if;
  perform public.field_sales_transaction_access(p_actor,pay.lead_id);
  select * into pay from public.field_sales_checkouts where checkout_id=p_checkout for update;
  if pay.created_by<>p_actor or p_mode not in ('test','live') then raise exception 'Checkout mode authority denied' using errcode='42501'; end if;
  if p_mode='live' and (public.field_sales_native_staging_scope() or not exists(select 1 from public.field_sales_workflows where quote_id=pay.quote_id)
    or not exists(select 1 from public.field_sales_workflow_settings where enabled and live_enabled)) then
    raise exception 'Distinct live payment approval disabled' using errcode='55000'; end if;
  if (pay.session_id is not null or pay.stripe_mode_bound) and pay.stripe_mode<>p_mode then
    raise exception 'Reserved provider mode immutable even while creation is uncertain' using errcode='40001'; end if;
  update public.field_sales_checkouts set stripe_mode=p_mode,stripe_mode_bound=true where checkout_id=p_checkout;
  return jsonb_build_object('mode',p_mode);
end $$;
-- Reuse the existing assignment authority for explicitly enrolled jobs only.
-- The legacy global assignment configuration is neither changed nor enabled.
do $$ declare fn regprocedure; src text; begin
  foreach fn in array array['public.h2s_management_assignment_preview(uuid)'::regprocedure,
    'public.h2s_management_assign_technician(uuid,uuid,uuid,uuid,text,text)'::regprocedure] loop
    src:=pg_get_functiondef(fn);
    src:=replace(src,
      'if not coalesce((select enabled from public.h2s_management_assignment_config where singleton),false) then',
      'if not coalesce((select enabled from public.h2s_management_assignment_config where singleton),false)
        and not exists(select 1 from public.field_sales_workflows w join public.field_sales_workflow_settings s on s.singleton
          where w.job_id=p_job_id and s.enabled and w.state=''scheduled'') then');
    execute src;
  end loop;
end $$;
do $$ declare src text; begin
  src:=pg_get_functiondef('public.field_sales_transaction_command_legacy(uuid,uuid,uuid,text,jsonb)'::regprocedure);
  src:=replace(src,'where lead_id=p_lead and accepted_at is not null)',
    'where lead_id=p_lead and accepted_at is not null and quote_id not in
      (select wf.quote_id from public.field_sales_workflows wf where wf.state=''cancelled''))');
  execute src;
end $$;
do $$ declare t text; f regprocedure; begin
  foreach t in array array['field_sales_workflow_policies','field_sales_workflow_settings','field_sales_workflows',
    'field_sales_workflow_proof_bindings','field_sales_workflow_proof_checks',
    'field_sales_workflow_artifacts','field_sales_workflow_delivery','field_sales_workflow_commands','field_sales_workflow_refunds',
    'field_sales_workflow_handoffs'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
  end loop;
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace
    and (proname like 'field_sales_workflow_%' or proname in ('field_sales_transaction_command','field_sales_customer_agreement',
      'field_sales_reserve_checkout','field_sales_record_receipt')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
  -- Legacy internal implementations cannot bypass enrollment guards through PostgREST.
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace
    and proname in ('field_sales_transaction_command_legacy','field_sales_customer_agreement_legacy',
      'field_sales_reserve_checkout_legacy','field_sales_record_receipt_legacy') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  end loop;
end $$;
commit;
