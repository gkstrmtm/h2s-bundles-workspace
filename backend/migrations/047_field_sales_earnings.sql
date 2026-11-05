-- REVIEW ONLY; requires 045/046. No accounts, policy approvals or external payments.
begin;
create table public.field_sales_earning_qualifications (
  quote_id uuid primary key references public.field_sales_quotes(quote_id),
  order_id uuid not null unique,
  lead_id uuid not null references public.field_sales_opportunities(lead_id),
  representative_id uuid not null references public."Dashboard_Users"("User_ID"),
  eligible_event_id text not null,
  qualifies_at timestamptz not null,
  evidence jsonb not null,
  unique(order_id,eligible_event_id)
);
create table public.field_sales_earning_reviews (
  review_id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.field_sales_earning_qualifications(quote_id),
  state text not null check(state in ('calculation_review','earned','held')),
  reasons jsonb not null,
  evidence jsonb not null,
  input_hash text not null,
  created_at timestamptz not null default now(),
  unique(quote_id,input_hash)
);
create table public.field_sales_earning_entries (
  entry_id uuid primary key default gen_random_uuid(),
  quote_id uuid not null unique references public.field_sales_earning_qualifications(quote_id),
  order_id uuid not null unique,
  lead_id uuid not null,
  representative_id uuid not null references public."Dashboard_Users"("User_ID"),
  eligible_event_id text not null,
  qualifies_at timestamptz not null,
  basis_cents bigint not null check(basis_cents between 0 and 100000000),
  amount_cents bigint not null check(amount_cents between 0 and 100000000),
  rate_basis_points integer not null check(rate_basis_points in (5500,5000,4500)),
  tenure_day integer not null check(tenure_day>0),
  rate_event_at timestamptz not null,
  policy_id uuid not null references public.field_sales_workflow_policies(policy_id),
  snapshot jsonb not null,
  input_hash text not null,
  created_at timestamptz not null default now(),
  unique(order_id,eligible_event_id)
);
create table public.field_sales_earning_adjustments (
  adjustment_id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.field_sales_earning_entries(entry_id),
  amount_cents bigint not null check(amount_cents between -100000000 and 100000000),
  reason text not null check(length(trim(reason))>0),
  evidence jsonb not null,
  source_snapshot jsonb not null,
  source_hash text not null,
  reviewed_by uuid not null references public."Dashboard_Users"("User_ID"),
  reviewed_at timestamptz not null default now()
);
create table public.field_sales_earning_runs (
  run_id uuid primary key default gen_random_uuid(),
  run_date date not null,
  policy_id uuid not null references public.field_sales_workflow_policies(policy_id),
  policy_snapshot jsonb not null,
  amount_cents bigint not null check(amount_cents between 0 and 100000000),
  beneficiaries jsonb not null,
  created_by uuid not null references public."Dashboard_Users"("User_ID"),
  created_at timestamptz not null default now()
);
create table public.field_sales_earning_allocations (
  allocation_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.field_sales_earning_runs(run_id),
  entry_id uuid references public.field_sales_earning_entries(entry_id),
  adjustment_id uuid references public.field_sales_earning_adjustments(adjustment_id),
  representative_id uuid not null references public."Dashboard_Users"("User_ID"),
  amount_cents bigint not null,
  check((entry_id is null)<>(adjustment_id is null)),
  unique(run_id,entry_id),unique(run_id,adjustment_id)
);
create table public.field_sales_earning_run_events (
  event_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.field_sales_earning_runs(run_id),
  kind text not null check(kind in ('approved','exported','reconciled_paid','abandoned')),
  actor_id uuid not null references public."Dashboard_Users"("User_ID"),
  evidence jsonb not null,
  recorded_at timestamptz not null default now(),
  unique(run_id,kind)
);
create table public.field_sales_earning_settlements (
  settlement_id uuid primary key default gen_random_uuid(),
  run_id uuid not null unique references public.field_sales_earning_runs(run_id),
  reference text not null unique,
  proof jsonb not null,
  reconciled_by uuid not null references public."Dashboard_Users"("User_ID"),
  recorded_at timestamptz not null default now()
);
create table public.field_sales_earning_operations (
  operation_id uuid primary key,
  actor_id uuid not null references public."Dashboard_Users"("User_ID"),
  action text not null,
  input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
-- Mutable uniqueness claims are not ledger history; abandonment releases only these claims.
create table public.field_sales_earning_active_runs (
  run_id uuid primary key references public.field_sales_earning_runs(run_id),
  run_date date not null unique
);
create table public.field_sales_earning_allocation_claims (
  allocation_id uuid primary key references public.field_sales_earning_allocations(allocation_id),
  run_id uuid not null references public.field_sales_earning_active_runs(run_id),
  entry_id uuid unique references public.field_sales_earning_entries(entry_id),
  adjustment_id uuid unique references public.field_sales_earning_adjustments(adjustment_id),
  check((entry_id is null)<>(adjustment_id is null))
);
create view public.field_sales_earning_effective_allocations as
  select a.* from public.field_sales_earning_allocations a
  join public.field_sales_earning_allocation_claims c on c.allocation_id=a.allocation_id;
alter table public.field_sales_earning_active_runs enable row level security;
alter table public.field_sales_earning_allocation_claims enable row level security;
revoke all on public.field_sales_earning_active_runs,public.field_sales_earning_allocation_claims,
  public.field_sales_earning_effective_allocations from public,anon,authenticated,service_role;
create function public.field_sales_earning_claim() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('field-earnings-runs',0));
  if tg_table_name='field_sales_earning_runs' then
    insert into public.field_sales_earning_active_runs(run_id,run_date) values(new.run_id,new.run_date);
  else
    insert into public.field_sales_earning_allocation_claims(allocation_id,run_id,entry_id,adjustment_id)
      values(new.allocation_id,new.run_id,new.entry_id,new.adjustment_id);
  end if;
  return new;
end $$;
create trigger earning_run_claim after insert on public.field_sales_earning_runs
  for each row execute function public.field_sales_earning_claim();
create trigger earning_allocation_claim after insert on public.field_sales_earning_allocations
  for each row execute function public.field_sales_earning_claim();
create function public.field_sales_earning_freeze() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin raise exception 'Sales earnings evidence is append-only; reviewed adjustments required' using errcode='42501'; end $$;
do $$ declare t text; begin
  foreach t in array array['qualifications','reviews','entries','adjustments','runs','allocations','run_events','settlements','operations'] loop
    execute format('create trigger earning_freeze before update or delete on public.field_sales_earning_%I for each row execute function public.field_sales_earning_freeze()',t);
    execute format('alter table public.field_sales_earning_%I enable row level security',t);
    execute format('revoke all on public.field_sales_earning_%I from public,anon,authenticated,service_role',t);
  end loop;
end $$;
create function public.field_sales_earning_cents(p_value jsonb,p_signed boolean default false) returns bigint
language plpgsql immutable set search_path=pg_catalog,public as $$
declare v bigint;
begin
  if p_value is null or jsonb_typeof(p_value)<>'number' or p_value::text !~ '^-?[0-9]+$' then raise exception 'Exact actual integer cents required'; end if;
  v:=p_value::text::bigint;
  if v not between -100000000 and 100000000 or (not p_signed and v<0) then raise exception 'Actual cents out of range'; end if;
  return v;
end $$;
create function public.field_sales_earning_has_evidence(p_value jsonb) returns boolean
language plpgsql immutable set search_path=pg_catalog,public as $$
begin
  if p_value is null or p_value='null'::jsonb then return false; end if;
  if jsonb_typeof(p_value)='string' then return length(trim(p_value#>>'{}'))>0; end if;
  if jsonb_typeof(p_value)='array' then
    return jsonb_array_length(p_value)>0 and not exists(select 1 from jsonb_array_elements(p_value) where not public.field_sales_earning_has_evidence(value));
  end if;
  if jsonb_typeof(p_value)='object' then
    if p_value ? 'evidence' then return public.field_sales_earning_has_evidence(p_value->'evidence'); end if;
    return exists(select 1 from jsonb_each(p_value) where public.field_sales_earning_has_evidence(value));
  end if;
  return false;
end
$$;
create function public.field_sales_earnings_observe(p_quote uuid,p_reviewed boolean default false) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare f jsonb; q public.field_sales_earning_qualifications; e public.field_sales_earning_entries;
  pol public.field_sales_workflow_policies; rep public.field_sales_representatives;
  reasons jsonb:='[]'; snap jsonb; h text; at_event timestamptz; tenure integer; rate integer;
  equipment bigint:=0; materials bigint:=0; fee bigint; basis bigint; amount bigint; x jsonb; category text; seen boolean; state text; quantity numeric; unit bigint; line_amount bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('field-earning:'||p_quote::text,0));
  f:=public.field_sales_workflow_order_facts(p_quote);
  select * into q from public.field_sales_earning_qualifications where quote_id=p_quote;
  if q.quote_id is null then
    if f->>'completedAt' is null or f->>'verifiedPaidAt' is null or nullif(f->>'eligibleEventId','') is null
      or coalesce((f->>'disputed')::boolean,true) or coalesce((f->>'refundedCents')::bigint,-1)<>0
      or (f->>'netPaidCents')::bigint<>(f->>'totalCents')::bigint then
      return jsonb_build_object('state','pending_qualification','qualifiesAt',null);
    end if;
    select * into pol from public.field_sales_workflow_policies where policy_id=(f->>'commissionPolicyId')::uuid and kind='commission' and status='approved';
    select * into rep from public.field_sales_representatives where user_id=(f->>'representativeId')::uuid;
    rep.commission_start_date:=(f->>'commissionStartDate')::date;
    rep.commission_start_evidence:=f->>'commissionStartEvidence';
    insert into public.field_sales_earning_qualifications(quote_id,order_id,lead_id,representative_id,eligible_event_id,qualifies_at,evidence)
      values(p_quote,(f->>'orderId')::uuid,(f->>'leadId')::uuid,(f->>'representativeId')::uuid,f->>'eligibleEventId',
        greatest((f->>'completedAt')::timestamptz,(f->>'verifiedPaidAt')::timestamptz),
        f||jsonb_build_object('commissionPolicySnapshot',to_jsonb(pol),'representativeStartDate',rep.commission_start_date,
          'representativeStartEvidence',rep.commission_start_evidence)) returning * into q;
  end if;
  select * into e from public.field_sales_earning_entries where quote_id=p_quote;
  if e.entry_id is not null then
    return jsonb_build_object('state',case when public.field_sales_earning_needs_review(e.entry_id) then 'held' else 'earned' end,
      'entryId',e.entry_id,'qualifiesAt',q.qualifies_at);
  end if;
  select * into pol from public.field_sales_workflow_policies where policy_id=(f->>'commissionPolicyId')::uuid and kind='commission' and status='approved';
  select * into rep from public.field_sales_representatives where user_id=q.representative_id;
  if q.evidence->'commissionPolicySnapshot'->>'policy_id' is not null then
    select * into pol from jsonb_populate_record(null::public.field_sales_workflow_policies,q.evidence->'commissionPolicySnapshot');
  elsif not p_reviewed then pol:=null; end if;
  if q.evidence->>'representativeStartDate' is not null and nullif(trim(q.evidence->>'representativeStartEvidence'),'') is not null then
    rep.commission_start_date:=(q.evidence->>'representativeStartDate')::date;
    rep.commission_start_evidence:=q.evidence->>'representativeStartEvidence';
  elsif not p_reviewed then rep.commission_start_date:=null; rep.commission_start_evidence:=null; end if;
  snap:=jsonb_build_object('facts',f,'qualification',to_jsonb(q),'policy',to_jsonb(pol),'representativeStartDate',rep.commission_start_date,
    'representativeStartEvidence',rep.commission_start_evidence);
  begin
    if pol.policy_id is null or pol.approved_by is null or pol.approved_at is null or not public.field_sales_earning_has_evidence(pol.approval_evidence)
      then raise exception 'Approved commission policy is unavailable'; end if;
    if rep.commission_start_date is null or nullif(trim(rep.commission_start_evidence),'') is null then raise exception 'Evidenced representative start date is unavailable'; end if;
    if pol.definition->>'creditPolicy' is distinct from 'approved_attribution'
      or pol.definition->>'accountingPolicy' is distinct from 'customer_revenue_less_actual_equipment_materials_provider_fees'
      or pol.definition->>'rounding' is distinct from 'half_away_from_zero'
      or pol.definition->'rates' is distinct from '[{"throughDay":30,"basisPoints":5500},{"throughDay":60,"basisPoints":5000},{"throughDay":null,"basisPoints":4500}]'::jsonb
      or nullif(pol.definition->>'timezone','') is null then raise exception 'Approved commission accounting/rate policy requires review'; end if;
    at_event:=case pol.definition->>'rateEffectiveEvent' when 'accepted' then (q.evidence->>'acceptedAt')::timestamptz
      when 'completed' then (q.evidence->>'completedAt')::timestamptz when 'qualified' then q.qualifies_at else null end;
    if at_event is null then raise exception 'Approved rate event is unavailable'; end if;
    tenure:=(at_event at time zone (pol.definition->>'timezone'))::date-rep.commission_start_date+1;
    if tenure<1 then raise exception 'Rate event precedes representative start date'; end if;
    rate:=case when tenure<=30 then 5500 when tenure<=60 then 5000 else 4500 end;
    if coalesce((f->>'disputed')::boolean,true) or coalesce((f->>'refundedCents')::bigint,-1)<>0
      or (f->>'netPaidCents')::bigint<>(q.evidence->>'totalCents')::bigint then raise exception 'Refund/dispute requires reviewed accounting adjustment'; end if;
    if f->'costsComplete' is distinct from 'true'::jsonb or not public.field_sales_earning_has_evidence(f->'costReviewEvidence')
      or f->'costReviewEvidence'->'actualCostsReviewed' is distinct from 'true'::jsonb
      or nullif(trim(f->'costReviewEvidence'->>'reference'),'') is null
      or nullif(f->>'costApprovedBy','') is null or nullif(f->>'costApprovedAt','') is null then
      raise exception 'Management-approved actual cost completeness/evidence required; technician rows alone are not payable costs'; end if;
    if jsonb_typeof(f->'expenses') is distinct from 'array' then raise exception 'Actual expense evidence unavailable'; end if;
    if exists(select 1 from jsonb_array_elements(f->'expenses') where coalesce(value->>'category','') not in ('equipment','materials','wages')) then
      raise exception 'Approved actual cost categories require review'; end if;
    foreach category in array array['equipment','materials'] loop
      seen:=false;
      for x in select value from jsonb_array_elements(f->'expenses') where value->>'category'=category loop
        seen:=true;
        if x->'actual' is distinct from 'true'::jsonb or jsonb_typeof(x->'evidence') is distinct from 'object'
          or not public.field_sales_earning_has_evidence(x->'evidence') then raise exception 'Actual % evidence unavailable',category; end if;
        if jsonb_typeof(x->'quantity') is distinct from 'number' then raise exception 'Approved actual quantity and unit cost required'; end if;
        quantity:=(x->>'quantity')::numeric;
        unit:=public.field_sales_earning_cents(x->'unitCents'); line_amount:=public.field_sales_earning_cents(x->'amountCents');
        if quantity not between 0 and 100000 or quantity*1000000<>trunc(quantity*1000000) or quantity*unit<>line_amount then
          raise exception 'Actual quantity/unit cost/amount do not reconcile exactly'; end if;
        if line_amount=0 and coalesce(length(trim(x->>'zeroCostAttestation')),0)<3 then raise exception 'Explicit reviewed zero-cost attestation required'; end if;
        if category='equipment' then equipment:=equipment+line_amount;
        else materials:=materials+line_amount; end if;
      end loop;
      if not seen then raise exception 'Actual % evidence unavailable',category; end if;
    end loop;
    fee:=public.field_sales_earning_cents(f->'processingFeeCents');
    if not public.field_sales_earning_has_evidence(f->'processingFeeEvidence') then raise exception 'Actual provider fee evidence unavailable'; end if;
    basis:=public.field_sales_earning_cents(q.evidence->'totalCents')-equipment-materials-fee;
    if basis<0 then raise exception 'Negative actual basis requires reviewed adjustment; no floor applied'; end if;
    amount:=(basis*rate+5000)/10000;
  exception when others then reasons:=jsonb_build_array(sqlerrm);
  end;
  h:=encode(sha256(convert_to(snap::text,'UTF8')),'hex');
  state:=case when jsonb_array_length(reasons)>0 then 'calculation_review' else 'earned' end;
  insert into public.field_sales_earning_reviews(quote_id,state,reasons,evidence,input_hash) values(p_quote,state,reasons,snap,h) on conflict do nothing;
  if state='earned' then
    insert into public.field_sales_earning_entries(quote_id,order_id,lead_id,representative_id,eligible_event_id,qualifies_at,basis_cents,amount_cents,
      rate_basis_points,tenure_day,rate_event_at,policy_id,snapshot,input_hash)
      values(p_quote,q.order_id,q.lead_id,q.representative_id,q.eligible_event_id,q.qualifies_at,basis,amount,rate,tenure,at_event,pol.policy_id,snap,h)
      returning * into e;
  end if;
  return jsonb_build_object('state',state,'entryId',e.entry_id,'qualifiesAt',q.qualifies_at,'reasons',reasons);
end $$;
create function public.field_sales_earning_run_date(p_at timestamptz,p_definition jsonb) returns date
language plpgsql stable set search_path=pg_catalog,public as $$
declare local_at timestamp; friday date; candidate date; holidays jsonb; convention text; cutoff time; direction integer; n integer;
begin
  if nullif(p_definition->>'timezone','') is null or (p_definition->>'cutoff') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or nullif(trim(p_definition->>'method'),'') is null or nullif(trim(p_definition->>'classification'),'') is null
    or coalesce(p_definition->>'holidayConvention','') not in ('skip','previous_business_day','next_business_day')
    or jsonb_typeof(p_definition->'holidays') is distinct from 'array' then raise exception 'Approved Friday settlement policy requires review'; end if;
  holidays:=p_definition->'holidays'; convention:=p_definition->>'holidayConvention'; cutoff:=(p_definition->>'cutoff')::time;
  if exists(select 1 from jsonb_array_elements_text(holidays) h where h !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or h::date::text<>h) then raise exception 'Invalid approved holiday date'; end if;
  local_at:=p_at at time zone (p_definition->>'timezone');
  friday:=local_at::date+((5-extract(dow from local_at)::integer+7)%7);
  if friday=local_at::date and local_at::time>=cutoff then friday:=friday+7; end if;
  for n in 1..104 loop
    candidate:=friday;
    if holidays ? friday::text then
      if convention='skip' then friday:=friday+7; continue; end if;
      direction:=case when convention='previous_business_day' then -1 else 1 end;
      loop candidate:=candidate+direction; exit when extract(dow from candidate) not in (0,6) and not holidays ? candidate::text; end loop;
    end if;
    if candidate>local_at::date or (candidate=local_at::date and local_at::time<cutoff) then return candidate; end if;
    friday:=friday+7;
  end loop;
  raise exception 'No eligible Friday date in approved calendar';
end $$;
create function public.field_sales_earning_review_current(p_entry uuid,p_run_date date default null,p_definition jsonb default null) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare e public.field_sales_earning_entries; f jsonb;
begin
  select * into e from public.field_sales_earning_entries where entry_id=p_entry;
  if e.entry_id is null then return false; end if;
  f:=public.field_sales_workflow_order_facts(e.quote_id);
  return exists(select 1 from public.field_sales_earning_adjustments a
    where a.entry_id=p_entry and a.source_snapshot->'facts'=f
      and a.source_hash=encode(sha256(convert_to(f::text,'UTF8')),'hex')
      and (p_run_date is null or public.field_sales_earning_run_date(a.reviewed_at,p_definition)<=p_run_date));
end $$;
create function public.field_sales_earning_needs_review(p_entry uuid,p_run_date date default null,p_definition jsonb default null) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare e public.field_sales_earning_entries; f jsonb; changed boolean;
begin
  select * into e from public.field_sales_earning_entries where entry_id=p_entry;
  if e.entry_id is null then return true; end if;
  f:=public.field_sales_workflow_order_facts(e.quote_id);
  changed:=coalesce((f->>'disputed')::boolean,true) or coalesce((f->>'refundedCents')::bigint,-1)<>0
    or f->'costsComplete' is distinct from 'true'::jsonb or not public.field_sales_earning_has_evidence(f->'costReviewEvidence')
    or f->'costReviewEvidence'->'actualCostsReviewed' is distinct from 'true'::jsonb
    or nullif(trim(f->'costReviewEvidence'->>'reference'),'') is null
    or nullif(f->>'costApprovedBy','') is null or nullif(f->>'costApprovedAt','') is null
    or (f->'totalCents') is distinct from (e.snapshot->'facts'->'totalCents')
    or (f->'netPaidCents') is distinct from (e.snapshot->'facts'->'netPaidCents')
    or (f->'expenses') is distinct from (e.snapshot->'facts'->'expenses')
    or (f->'processingFeeCents') is distinct from (e.snapshot->'facts'->'processingFeeCents')
    or not public.field_sales_earning_has_evidence(f->'processingFeeEvidence')
    or exists(select 1 from public.field_sales_earning_adjustments a where a.entry_id=p_entry
      and not exists(select 1 from public.field_sales_earning_effective_allocations c where c.adjustment_id=a.adjustment_id)
      and (a.source_snapshot->'facts' is distinct from f or a.source_hash<>encode(sha256(convert_to(f::text,'UTF8')),'hex')));
  return changed and not public.field_sales_earning_review_current(p_entry,p_run_date,p_definition);
end $$;
create function public.field_sales_earning_settled_at(p_value jsonb,p_created timestamptz) returns timestamptz
language plpgsql stable set search_path=pg_catalog,public as $$
declare value_at timestamptz;
begin
  if p_value is null or jsonb_typeof(p_value) is distinct from 'string'
    or (p_value#>>'{}') !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-5][0-9])$' then
    raise exception 'Explicit valid settlement timestamp with timezone is required';
  end if;
  begin value_at:=(p_value#>>'{}')::timestamptz;
  exception when others then raise exception 'Explicit valid settlement timestamp with timezone is required';
  end;
  if value_at is null or value_at>now() or value_at<p_created then
    raise exception 'Settlement timestamp must be between run creation and now';
  end if;
  return value_at;
end $$;
create function public.field_sales_earnings_command(p_actor uuid,p_operation uuid,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare old public.field_sales_earning_operations; result jsonb; e public.field_sales_earning_entries;
  run public.field_sales_earning_runs; pol public.field_sales_workflow_policies; rid uuid; amount bigint; ben jsonb; proof jsonb; x jsonb; f jsonb; candidates jsonb;
begin
  if public.field_sales_access(p_actor)<>'ADMIN' then raise exception 'Administrator earnings review required' using errcode='42501'; end if;
  if p_operation is null or jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Idempotent earnings command required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('field-earnings-operation:'||p_operation::text,0));
  select * into old from public.field_sales_earning_operations where operation_id=p_operation;
  if old.operation_id is not null then
    if old.actor_id<>p_actor or old.action<>p_action or old.input<>p_input then raise exception 'Operation ID reused with different earnings command'; end if;
    return old.result;
  end if;
  if p_action='review_order' then
    result:=public.field_sales_earnings_observe((p_input->>'quoteId')::uuid,true);
  elsif p_action='review_adjustment' then
    perform pg_advisory_xact_lock(hashtextextended('field-earnings-runs',0));
    select * into e from public.field_sales_earning_entries where entry_id=(p_input->>'entryId')::uuid;
    if e.entry_id is null then raise exception 'Earning entry unavailable' using errcode='P0002'; end if;
    amount:=public.field_sales_earning_cents(p_input->'amountCents',true);
    if nullif(trim(p_input->>'reason'),'') is null or not public.field_sales_earning_has_evidence(p_input->'evidence') then raise exception 'Reviewed adjustment reason/evidence required'; end if;
    f:=public.field_sales_workflow_order_facts(e.quote_id);
    insert into public.field_sales_earning_adjustments(entry_id,amount_cents,reason,evidence,source_snapshot,source_hash,reviewed_by)
      values(e.entry_id,amount,p_input->>'reason',p_input->'evidence',jsonb_build_object('facts',f,'originalEntry',to_jsonb(e)),
        encode(sha256(convert_to(f::text,'UTF8')),'hex'),p_actor) returning adjustment_id into rid;
    result:=jsonb_build_object('adjustmentId',rid,'state','reviewed','amountCents',amount);
  elsif p_action='create_run' then
    perform pg_advisory_xact_lock(hashtextextended('field-earnings-runs',0));
    select * into pol from public.field_sales_workflow_policies where policy_id=(p_input->>'settlementPolicyId')::uuid and kind='settlement' and status='approved';
    if pol.policy_id is null or pol.approved_by is null or pol.approved_at is null or not public.field_sales_earning_has_evidence(pol.approval_evidence) then raise exception 'Approved settlement version required'; end if;
    perform public.field_sales_earning_run_date(now(),pol.definition);
    if (p_input->>'runDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (p_input->>'runDate')::date::text<>p_input->>'runDate' then raise exception 'Valid run date required'; end if;
    if exists(select 1 from public.field_sales_earning_active_runs where run_date=(p_input->>'runDate')::date) then raise exception 'A run already owns this settlement date'; end if;
    if exists(select 1 from public.field_sales_earning_adjustments a
      where a.amount_cents<0 and public.field_sales_earning_run_date(a.reviewed_at,pol.definition)<=(p_input->>'runDate')::date
        and not exists(select 1 from public.field_sales_earning_effective_allocations aa where aa.adjustment_id=a.adjustment_id)
        and exists(select 1 from public.field_sales_earning_effective_allocations ae where ae.entry_id=a.entry_id)) then
      raise exception 'Allocated earning correction requires separate approved recovery/legal review; no automatic netting, wage clawback or representative debt is authorized';
    end if;
    rid:=gen_random_uuid();
    select coalesce(jsonb_agg(to_jsonb(c)),'[]') into candidates from (
      select a.entry_id,null::uuid adjustment_id,a.representative_id,a.amount_cents from public.field_sales_earning_entries a
      where not exists(select 1 from public.field_sales_earning_effective_allocations b where b.entry_id=a.entry_id)
        and public.field_sales_earning_run_date(a.qualifies_at,pol.definition)<=(p_input->>'runDate')::date
        and not exists(select 1 from public.field_sales_earning_adjustments z where z.entry_id=a.entry_id
          and not exists(select 1 from public.field_sales_earning_effective_allocations za where za.adjustment_id=z.adjustment_id)
          and public.field_sales_earning_run_date(z.reviewed_at,pol.definition)>(p_input->>'runDate')::date)
        and not public.field_sales_earning_needs_review(a.entry_id,(p_input->>'runDate')::date,pol.definition)
      union all
      select null,a.adjustment_id,e2.representative_id,a.amount_cents from public.field_sales_earning_adjustments a
      join public.field_sales_earning_entries e2 on e2.entry_id=a.entry_id
      where not exists(select 1 from public.field_sales_earning_effective_allocations b where b.adjustment_id=a.adjustment_id)
        and public.field_sales_earning_run_date(a.reviewed_at,pol.definition)<=(p_input->>'runDate')::date
        and not public.field_sales_earning_needs_review(e2.entry_id,(p_input->>'runDate')::date,pol.definition)
        and public.field_sales_earning_review_current(e2.entry_id,(p_input->>'runDate')::date,pol.definition)
        and (exists(select 1 from public.field_sales_earning_effective_allocations b where b.entry_id=e2.entry_id)
          or public.field_sales_earning_run_date(e2.qualifies_at,pol.definition)<=(p_input->>'runDate')::date)
    ) c;
    if jsonb_array_length(candidates)=0 then raise exception 'No eligible unallocated earnings for this run'; end if;
    if exists(select 1 from jsonb_to_recordset(candidates) as c(representative_id uuid,amount_cents bigint) group by representative_id having sum(amount_cents)<0) then raise exception 'Negative representative settlement requires reviewed recovery policy; no silent floor'; end if;
    select sum(amount_cents) into amount from jsonb_to_recordset(candidates) as c(amount_cents bigint);
    if amount not between 0 and 100000000 then raise exception 'Run amount requires review'; end if;
    select jsonb_agg(jsonb_build_object('representativeId',representative_id,'amountCents',total) order by representative_id) into ben
      from (select representative_id,sum(amount_cents) total from jsonb_to_recordset(candidates) as c(representative_id uuid,amount_cents bigint) group by representative_id) b;
    -- A requested date must itself be an approved Friday/holiday-adjusted slot.
    if public.field_sales_earning_run_date(((p_input->>'runDate')::date-7)::timestamp at time zone (pol.definition->>'timezone'),pol.definition)<>(p_input->>'runDate')::date
      and public.field_sales_earning_run_date((p_input->>'runDate')::date::timestamp at time zone (pol.definition->>'timezone'),pol.definition)<>(p_input->>'runDate')::date then
      raise exception 'Requested run date is not an approved Friday calendar slot';
    end if;
    insert into public.field_sales_earning_runs(run_id,run_date,policy_id,policy_snapshot,amount_cents,beneficiaries,created_by)
      values(rid,(p_input->>'runDate')::date,pol.policy_id,to_jsonb(pol),amount,ben,p_actor);
    insert into public.field_sales_earning_allocations(run_id,entry_id,adjustment_id,representative_id,amount_cents)
      select rid,entry_id,adjustment_id,representative_id,amount_cents from jsonb_to_recordset(candidates) as c(entry_id uuid,adjustment_id uuid,representative_id uuid,amount_cents bigint);
    result:=jsonb_build_object('runId',rid,'state','draft','amountCents',amount,'beneficiaries',ben);
  elsif p_action in ('approve_run','export_run','record_settlement','abandon_run') then
    rid:=(p_input->>'runId')::uuid;
    if p_action in ('approve_run','export_run','abandon_run') then perform pg_advisory_xact_lock(hashtextextended('field-earnings-runs',0)); end if;
    perform pg_advisory_xact_lock(hashtextextended('field-earnings-run:'||rid::text,0));
    select * into run from public.field_sales_earning_runs where run_id=rid;
    if run.run_id is null then raise exception 'Run unavailable' using errcode='P0002'; end if;
    if exists(select 1 from public.field_sales_earning_run_events where run_id=rid and kind='abandoned') then raise exception 'Run is abandoned; use a new run and operation'; end if;
    if p_action in ('approve_run','export_run') and exists(
      select 1 from public.field_sales_earning_effective_allocations a
      left join public.field_sales_earning_adjustments d on d.adjustment_id=a.adjustment_id
      join public.field_sales_earning_entries b on b.entry_id=coalesce(a.entry_id,d.entry_id)
      where a.run_id=rid and (public.field_sales_earning_needs_review(b.entry_id,run.run_date,run.policy_snapshot->'definition')
        or (d.adjustment_id is not null and not public.field_sales_earning_review_current(b.entry_id,run.run_date,run.policy_snapshot->'definition'))
        or exists(select 1 from public.field_sales_earning_adjustments z where z.entry_id=b.entry_id
          and not exists(select 1 from public.field_sales_earning_effective_allocations za where za.adjustment_id=z.adjustment_id)))
    ) then raise exception 'Run contains unresolved refund/dispute evidence; reviewed adjustment required'; end if;
    if p_action='abandon_run' then
      if exists(select 1 from public.field_sales_earning_run_events where run_id=rid and kind in ('exported','reconciled_paid'))
        or exists(select 1 from public.field_sales_earning_settlements where run_id=rid) then raise exception 'Exported or reconciled runs cannot be abandoned'; end if;
      if jsonb_typeof(p_input->'reason') is distinct from 'string' or coalesce(length(trim(p_input->>'reason')),0) not between 3 and 2000
        or not public.field_sales_earning_has_evidence(p_input->'evidence') then raise exception 'Abandonment reason and audit evidence required'; end if;
      insert into public.field_sales_earning_run_events(run_id,kind,actor_id,evidence)
        values(rid,'abandoned',p_actor,jsonb_build_object('reason',p_input->>'reason','evidence',p_input->'evidence'));
      delete from public.field_sales_earning_allocation_claims where run_id=rid;
      delete from public.field_sales_earning_active_runs where run_id=rid;
      result:=jsonb_build_object('runId',rid,'state','abandoned','effectiveAllocationsReleased',true,'externalPaymentInitiated',false);
    elsif p_action='approve_run' then
      if not public.field_sales_earning_has_evidence(p_input->'evidence') then raise exception 'Run approval evidence required'; end if;
      insert into public.field_sales_earning_run_events(run_id,kind,actor_id,evidence) values(rid,'approved',p_actor,p_input->'evidence');
      result:=jsonb_build_object('runId',rid,'state','approved');
    elsif p_action='export_run' then
      if not exists(select 1 from public.field_sales_earning_run_events where run_id=rid and kind='approved') then raise exception 'Run approval required before export'; end if;
      if not public.field_sales_earning_has_evidence(p_input->'evidence') then raise exception 'Export evidence required'; end if;
      insert into public.field_sales_earning_run_events(run_id,kind,actor_id,evidence) values(rid,'exported',p_actor,p_input->'evidence');
      result:=jsonb_build_object('runId',rid,'state','exported','amountCents',run.amount_cents,'beneficiaries',run.beneficiaries,'method',run.policy_snapshot->'definition'->>'method');
    else
      if not exists(select 1 from public.field_sales_earning_run_events where run_id=rid and kind='exported') then raise exception 'Reviewed export required before reconciliation'; end if;
      proof:=p_input->'proof';
      if jsonb_typeof(proof) is distinct from 'object' or proof->'independentReconciliation' is distinct from 'true'::jsonb or not public.field_sales_earning_has_evidence(proof->'evidence')
        or nullif(trim(proof->>'reference'),'') is null or proof->>'method' is distinct from run.policy_snapshot->'definition'->>'method'
        or public.field_sales_earning_cents(proof->'amountCents')<>run.amount_cents
        or jsonb_typeof(proof->'beneficiaries') is distinct from 'array' then raise exception 'Independent settlement amount/method/reference/evidence required'; end if;
      perform public.field_sales_earning_settled_at(proof->'settledAt',run.created_at);
      select jsonb_agg(jsonb_build_object('representativeId',(value->>'representativeId')::uuid,'amountCents',public.field_sales_earning_cents(value->'amountCents')) order by (value->>'representativeId')::uuid) into ben from jsonb_array_elements(proof->'beneficiaries');
      if ben is distinct from run.beneficiaries then raise exception 'Settlement beneficiaries do not match frozen export'; end if;
      insert into public.field_sales_earning_settlements(run_id,reference,proof,reconciled_by) values(rid,proof->>'reference',proof,p_actor);
      insert into public.field_sales_earning_run_events(run_id,kind,actor_id,evidence) values(rid,'reconciled_paid',p_actor,proof);
      result:=jsonb_build_object('runId',rid,'state','reconciled_paid','externalPaymentInitiated',false);
    end if;
  else raise exception 'Unsupported earnings command';
  end if;
  insert into public.field_sales_earning_operations(operation_id,actor_id,action,input,result) values(p_operation,p_actor,p_action,p_input,result);
  return result;
end $$;
create function public.field_sales_earnings_read(p_actor uuid,p_representative uuid default null,p_quote uuid default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare role text; reps uuid[]; orders jsonb:='[]'; entries jsonb; adjustments jsonb; runs jsonb; r record; f jsonb; q public.field_sales_earning_qualifications;
  e public.field_sales_earning_entries; review public.field_sales_earning_reviews; pending integer:=0; needs_review integer:=0;
begin
  role:=public.field_sales_access(p_actor);
  if role='SALES' and p_representative is not null and p_representative<>p_actor then raise exception 'Own earnings only' using errcode='42501'; end if;
  for r in select quote_id from public.field_sales_orders where p_quote is null or quote_id=p_quote loop
    begin f:=public.field_sales_workflow_order_facts(r.quote_id); exception when sqlstate 'P0002' then continue; end;
    if role='SALES' and (f->>'representativeId')::uuid<>p_actor then continue; end if;
    if p_representative is not null and (f->>'representativeId')::uuid<>p_representative then continue; end if;
    select * into q from public.field_sales_earning_qualifications where quote_id=r.quote_id;
    select * into e from public.field_sales_earning_entries where quote_id=r.quote_id;
    select * into review from public.field_sales_earning_reviews where quote_id=r.quote_id order by created_at desc,review_id desc limit 1;
    if q.quote_id is null then pending:=pending+1; elsif e.entry_id is null then needs_review:=needs_review+1; end if;
    orders:=orders||jsonb_build_array(jsonb_build_object('quoteId',r.quote_id,'orderId',f->'orderId','leadId',f->'leadId','representativeId',f->'representativeId',
      'totalCents',f->'totalCents','netPaidCents',f->'netPaidCents','completedAt',f->'completedAt','qualifiesAt',q.qualifies_at,
      'state',case when e.entry_id is not null and public.field_sales_earning_needs_review(e.entry_id) then 'held'
        when e.entry_id is not null then 'earned' when q.quote_id is not null then 'calculation_review' else 'pending_qualification' end,
      'reasons',coalesce(review.reasons,'[]'),'disputed',f->'disputed','refundedCents',f->'refundedCents'));
  end loop;
  if p_quote is not null and jsonb_array_length(orders)=0 then raise exception 'Attributed order unavailable' using errcode='P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('entryId',a.entry_id,'quoteId',a.quote_id,'orderId',a.order_id,'leadId',a.lead_id,'representativeId',a.representative_id,
    'qualifiesAt',a.qualifies_at,'amountCents',a.amount_cents,'basisCents',a.basis_cents,'rateBasisPoints',a.rate_basis_points,'tenureDay',a.tenure_day,
    'rateEventAt',a.rate_event_at,'policyId',a.policy_id,'inputHash',a.input_hash,
    'snapshot',case when role='ADMIN' then a.snapshot else jsonb_build_object('basisCents',a.basis_cents,'amountCents',a.amount_cents,
      'policyId',a.policy_id,'rateBasisPoints',a.rate_basis_points,'tenureDay',a.tenure_day,'rateEventAt',a.rate_event_at,
      'representativeStartDate',a.snapshot->'representativeStartDate') end,'createdAt',a.created_at) order by a.qualifies_at),'[]') into entries
    from public.field_sales_earning_entries a where (role='ADMIN' or a.representative_id=p_actor) and (p_representative is null or a.representative_id=p_representative) and (p_quote is null or a.quote_id=p_quote);
  select coalesce(jsonb_agg(jsonb_build_object('adjustmentId',a.adjustment_id,'entryId',a.entry_id,'representativeId',e2.representative_id,'amountCents',a.amount_cents,
    'effect','earning_correction_not_debt','sourceHash',a.source_hash,
    'settlementState',case when exists(select 1 from public.field_sales_earning_effective_allocations aa where aa.adjustment_id=a.adjustment_id) then 'allocated'
      when a.amount_cents<0 and exists(select 1 from public.field_sales_earning_effective_allocations ae where ae.entry_id=a.entry_id) then 'recovery_review_required' else 'unallocated' end,
    'reason',case when role='ADMIN' then a.reason else 'Reviewed adjustment' end,
    'evidence',case when role='ADMIN' then a.evidence else null end,'reviewedBy',a.reviewed_by,'reviewedAt',a.reviewed_at) order by a.reviewed_at),'[]') into adjustments
    from public.field_sales_earning_adjustments a join public.field_sales_earning_entries e2 on e2.entry_id=a.entry_id
    where (role='ADMIN' or e2.representative_id=p_actor) and (p_representative is null or e2.representative_id=p_representative) and (p_quote is null or e2.quote_id=p_quote);
  select coalesce(jsonb_agg(jsonb_build_object('runId',a.run_id,'runDate',a.run_date,'policyId',a.policy_id,
    'state',coalesce((select kind from public.field_sales_earning_run_events where run_id=a.run_id order by case kind when 'abandoned' then 4 when 'reconciled_paid' then 3 when 'exported' then 2 else 1 end desc limit 1),'draft'),
    'canAbandon',role='ADMIN' and not exists(select 1 from public.field_sales_earning_run_events where run_id=a.run_id and kind in ('abandoned','exported','reconciled_paid')),
    'abandonment',(select jsonb_build_object('reason',case when role='ADMIN' then evidence->>'reason' else 'Unexported run abandoned' end,
      'evidence',case when role='ADMIN' then evidence->'evidence' else null end,'abandonedBy',actor_id,'abandonedAt',recorded_at)
      from public.field_sales_earning_run_events where run_id=a.run_id and kind='abandoned'),
    'amountCents',case when role='ADMIN' and p_representative is null then a.amount_cents else (select coalesce(sum(b.amount_cents),0) from public.field_sales_earning_allocations b where b.run_id=a.run_id and b.representative_id=coalesce(p_representative,p_actor)) end,
    'beneficiaries',case when role='ADMIN' and p_representative is null then a.beneficiaries else (select jsonb_agg(value) from jsonb_array_elements(a.beneficiaries) where (value->>'representativeId')::uuid=coalesce(p_representative,p_actor)) end,
    'method',a.policy_snapshot->'definition'->>'method','classification',a.policy_snapshot->'definition'->>'classification','createdAt',a.created_at) order by a.run_date),'[]') into runs
    from public.field_sales_earning_runs a where exists(select 1 from public.field_sales_earning_allocations b left join public.field_sales_earning_entries c on c.entry_id=b.entry_id
      left join public.field_sales_earning_adjustments d on d.adjustment_id=b.adjustment_id left join public.field_sales_earning_entries e3 on e3.entry_id=d.entry_id
      where b.run_id=a.run_id and (role='ADMIN' or b.representative_id=p_actor) and (p_representative is null or b.representative_id=p_representative)
      and (p_quote is null or coalesce(c.quote_id,e3.quote_id)=p_quote));
  return jsonb_build_object('orders',orders,'entries',entries,'adjustments',adjustments,'runs',runs,'summary',jsonb_build_object(
    'pendingQualification',pending,'calculationReview',needs_review,
    'earnedCents',(select coalesce(sum((value->>'amountCents')::bigint),0) from jsonb_array_elements(entries)),
    'adjustmentCents',(select coalesce(sum((value->>'amountCents')::bigint),0) from jsonb_array_elements(adjustments)),
    'allocatedCents',(select coalesce(sum(a.amount_cents),0) from public.field_sales_earning_effective_allocations a
      left join public.field_sales_earning_adjustments b on b.adjustment_id=a.adjustment_id
      join public.field_sales_earning_entries c on c.entry_id=coalesce(a.entry_id,b.entry_id)
      where (role='ADMIN' or a.representative_id=p_actor) and (p_representative is null or a.representative_id=p_representative) and (p_quote is null or c.quote_id=p_quote)),
    'reconciledPaidCents',(select coalesce(sum(a.amount_cents),0) from public.field_sales_earning_effective_allocations a
      left join public.field_sales_earning_adjustments b on b.adjustment_id=a.adjustment_id
      join public.field_sales_earning_entries c on c.entry_id=coalesce(a.entry_id,b.entry_id)
      where (role='ADMIN' or a.representative_id=p_actor) and (p_representative is null or a.representative_id=p_representative) and (p_quote is null or c.quote_id=p_quote)
      and exists(select 1 from public.field_sales_earning_settlements s where s.run_id=a.run_id))));
end $$;
create function public.field_sales_earning_observe_trigger() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.field_sales_workflows where quote_id=new.quote_id) then
    perform public.field_sales_earnings_observe(new.quote_id);
  end if;
  return new;
end $$;
create trigger z_field_earning_workflow_observe after insert or update on public.field_sales_workflows
  for each row execute function public.field_sales_earning_observe_trigger();
create trigger z_field_earning_receipt_observe after insert or update on public.field_sales_checkouts
  for each row execute function public.field_sales_earning_observe_trigger();
revoke all on function public.field_sales_earning_freeze(),public.field_sales_earning_cents(jsonb,boolean),
  public.field_sales_earning_has_evidence(jsonb),public.field_sales_earnings_observe(uuid,boolean),
  public.field_sales_earning_run_date(timestamptz,jsonb),public.field_sales_earning_needs_review(uuid,date,jsonb),
  public.field_sales_earning_review_current(uuid,date,jsonb),
  public.field_sales_earning_settled_at(jsonb,timestamptz),public.field_sales_earning_claim(),public.field_sales_earnings_command(uuid,uuid,text,jsonb),
  public.field_sales_earnings_read(uuid,uuid,uuid),public.field_sales_earning_observe_trigger() from public,anon,authenticated,service_role;
grant execute on function public.field_sales_earnings_command(uuid,uuid,text,jsonb),public.field_sales_earnings_read(uuid,uuid,uuid) to service_role;
commit;
