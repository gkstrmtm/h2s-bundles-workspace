-- REVIEW ONLY. Prerequisites: 032/035/037/043; never apply as part of application startup.
-- No catalog, legal language, deposit policy or transaction gate is activated here.
begin;
-- Staging is an owned native run, never an environment flag or caller-supplied schema.
create function public.field_sales_native_staging_scope() returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare ns record; storage_ns record; identity jsonb; run_uuid uuid; ledger record;
begin
  select (n.nspname) as schema_name,n.nspowner,r.rolname,r.rolcanlogin,r.rolsuper,r.rolbypassrls,
    obj_description(n.oid,'pg_namespace') as marker into ns
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=n.nspowner
    where p.oid='public.field_sales_native_staging_scope()'::regprocedure and p.proowner=n.nspowner;
  if not found or ns.schema_name !~ '^h2s_test_[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$'
    or ns.rolname<>ns.schema_name||'_owner' or ns.rolcanlogin or ns.rolsuper or ns.rolbypassrls then return false; end if;
  identity:=ns.marker::jsonb;
  run_uuid:=(identity->>'runId')::uuid;
  if identity->>'marker' is distinct from 'home2smart-native-test-run-v1'
    or replace(run_uuid::text,'-','') is distinct from substr(ns.schema_name,10)
    or identity->>'schema' is distinct from ns.schema_name
    or identity->>'storageSchema' is distinct from ns.schema_name||'_storage'
    or identity->>'role' is distinct from ns.rolname
    or coalesce(identity->>'sourceCommit','') !~ '^[a-f0-9]{40}$'
    or coalesce(identity->>'nativeBaselineFingerprint','') !~ '^[a-f0-9]{64}$' then return false; end if;
  select n.nspowner,obj_description(n.oid,'pg_namespace') as marker into storage_ns
    from pg_namespace n where n.nspname=ns.schema_name||'_storage';
  if not found or storage_ns.nspowner<>ns.nspowner or storage_ns.marker::jsonb is distinct from identity then return false; end if;
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname=ns.schema_name and c.relname='h2s_test_run' and c.relkind='r' and c.relowner=ns.nspowner) then return false; end if;
  select count(*) as count,bool_and(run_id=run_uuid and source_commit=identity->>'sourceCommit'
    and baseline_sha256=identity->>'nativeBaselineFingerprint') as matches into ledger from public.h2s_test_run;
  return ledger.count=1 and coalesce(ledger.matches,false);
exception when others then return false;
end $$;
create function public.field_sales_configuration_usable(p_status text,p_production_status text) returns boolean
language sql stable set search_path=pg_catalog,public as $$
  select p_production_status in ('approved','published') and
    (p_status=p_production_status or (p_status='staging_only' and public.field_sales_native_staging_scope()))
$$;
create table public.field_sales_catalogs (
  catalog_id uuid primary key,
  version text not null unique,
  status text not null default 'draft' check(status in ('draft','published','retired','staging_only')),
  "productionApproved" boolean generated always as (status='published') stored,
  "stagingOnly" boolean generated always as (status='staging_only') stored,
  definition jsonb not null check(jsonb_typeof(definition)='object'),
  source_evidence jsonb not null,
  approved_by uuid references public."Dashboard_Users"("User_ID"),
  published_at timestamptz,
  check(status<>'staging_only' or (public.field_sales_native_staging_scope() and approved_by is null and published_at is null
    and source_evidence @> '{"stagingOnly":true,"productionApproved":false}'::jsonb
    and coalesce(definition->>'currency'='usd' and (definition->>'validForMinutes')::integer between 1 and 43200,false))),
  check(status in ('draft','staging_only') or (approved_by is not null and published_at is not null
    and coalesce(length(source_evidence->>'approvalEvidence'),0)>0
    and definition->>'currency'='usd' and definition->>'validForMinutes' is not null
    and (definition->>'validForMinutes')::integer between 1 and 43200))
);
create table public.field_sales_agreement_policies (
  policy_id uuid primary key,
  version text not null unique,
  status text not null default 'draft' check(status in ('draft','approved','retired','staging_only')),
  "productionApproved" boolean generated always as (status='approved') stored,
  "stagingOnly" boolean generated always as (status='staging_only') stored,
  terms text, cancellation_information text, electronic_delivery text, payment_terms text,
  approval_evidence text,
  approved_by uuid references public."Dashboard_Users"("User_ID"),
  approved_at timestamptz,
  check(status<>'staging_only' or (public.field_sales_native_staging_scope() and approved_by is null and approved_at is null
    and coalesce(length(terms),0)>0 and coalesce(length(cancellation_information),0)>0
    and coalesce(length(electronic_delivery),0)>0 and coalesce(length(payment_terms),0)>0
    and coalesce(length(approval_evidence),0)>0)),
  check(status in ('draft','staging_only') or (approved_by is not null and approved_at is not null
    and coalesce(length(terms),0)>0 and coalesce(length(cancellation_information),0)>0 and coalesce(length(electronic_delivery),0)>0
    and coalesce(length(payment_terms),0)>0 and coalesce(length(approval_evidence),0)>0))
);
create table public.field_sales_transaction_settings (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  agreement_policy_id uuid references public.field_sales_agreement_policies(policy_id),
  deposit_policy jsonb,
  check(deposit_policy is null or (jsonb_typeof(deposit_policy)='object'
    and deposit_policy ?& array['approvedBy','approvedAt','approvalEvidence']))
);
insert into public.field_sales_transaction_settings(singleton) values(true);
create table public.field_sales_quotes (
  quote_id uuid primary key,
  lead_id uuid not null references public.field_sales_opportunities(lead_id),
  revision integer not null check(revision>0),
  parent_quote_id uuid references public.field_sales_quotes(quote_id),
  catalog_id uuid not null references public.field_sales_catalogs(catalog_id),
  catalog_hash text not null,
  opportunity_revision integer not null,
  snapshot jsonb not null,
  quote_hash text not null,
  state text not null check(state in ('draft','pending_approval','approved','rejected')),
  created_by uuid not null references public."Dashboard_Users"("User_ID"),
  attributed_user_id uuid not null references public."Dashboard_Users"("User_ID"),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  order_uuid uuid not null default gen_random_uuid() unique,
  unique(lead_id,revision),
  check(state<>'approved' or (expires_at is not null and snapshot->>'totalCents' is not null and (snapshot->>'totalCents')::bigint between 1 and 100000000))
);
create table public.field_sales_agreements (
  agreement_id uuid primary key,
  quote_id uuid not null unique references public.field_sales_quotes(quote_id),
  lead_id uuid not null references public.field_sales_opportunities(lead_id),
  quote_hash text not null,
  policy_id uuid not null references public.field_sales_agreement_policies(policy_id),
  policy_snapshot jsonb not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  prepared_by uuid not null references public."Dashboard_Users"("User_ID"),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  acceptance jsonb
);
create table public.field_sales_checkouts (
  checkout_id uuid primary key,
  quote_id uuid not null references public.field_sales_quotes(quote_id),
  agreement_id uuid not null references public.field_sales_agreements(agreement_id),
  lead_id uuid not null references public.field_sales_opportunities(lead_id),
  kind text not null check(kind in ('full','deposit','balance')),
  amount_cents bigint not null check(amount_cents between 1 and 100000000),
  policy_snapshot jsonb not null,
  created_by uuid not null references public."Dashboard_Users"("User_ID"),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  session_id text unique, checkout_url text, payment_intent_id text unique,
  state text not null default 'creating' check(state in ('creating','open','pending','failed','expired','paid','refunded','partially_refunded','payment_exception')),
  captured_cents bigint not null default 0,
  refunded_cents bigint not null default 0,
  disputed boolean not null default false,
  provider_state text,
  last_checked_at timestamptz,
  check(captured_cents between 0 and amount_cents and refunded_cents between 0 and captured_cents)
);
create unique index field_sales_one_open_checkout on public.field_sales_checkouts(quote_id)
  where state in ('creating','open','pending','failed');
create table public.field_sales_payment_events (
  event_id text primary key,
  checkout_id uuid not null references public.field_sales_checkouts(checkout_id),
  receipt jsonb not null,
  created_at timestamptz not null default now()
);
create table public.field_sales_orders (
  quote_id uuid primary key references public.field_sales_quotes(quote_id),
  lead_id uuid not null references public.field_sales_opportunities(lead_id),
  order_id uuid not null unique references public.h2s_orders(id),
  created_at timestamptz not null default now()
);
create function public.field_sales_freeze_transaction() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if tg_table_name='field_sales_quotes' or tg_op='DELETE' then
    raise exception 'Immutable transaction evidence; create a new revision' using errcode='42501';
  elsif tg_table_name='field_sales_agreements' then
    if old.accepted_at is not null or (to_jsonb(new)-'accepted_at'-'acceptance')<>(to_jsonb(old)-'accepted_at'-'acceptance') then
      raise exception 'Agreement identity and evidence are immutable' using errcode='42501';
    end if;
  elsif tg_table_name='field_sales_catalogs' and old.status<>'draft' then
    if (to_jsonb(new)-array['status','productionApproved','stagingOnly'])<>(to_jsonb(old)-array['status','productionApproved','stagingOnly']) or new.status<>'retired' then
      raise exception 'Published catalog versions are immutable' using errcode='42501'; end if;
  elsif tg_table_name='field_sales_agreement_policies' and old.status<>'draft' then
    if (to_jsonb(new)-array['status','productionApproved','stagingOnly'])<>(to_jsonb(old)-array['status','productionApproved','stagingOnly']) or new.status<>'retired' then
      raise exception 'Approved legal versions are immutable' using errcode='42501'; end if;
  end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['field_sales_quotes','field_sales_agreements','field_sales_catalogs','field_sales_agreement_policies'] loop
    execute format('create trigger field_sales_freeze before update or delete on public.%I for each row execute function public.field_sales_freeze_transaction()',t);
  end loop;
end $$;
create function public.field_sales_transaction_access(p_actor uuid,p_lead uuid) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text;
begin
  r:=public.field_sales_access(p_actor);
  perform 1 from public.field_sales_transaction_settings where enabled for share;
  if not found then raise exception 'Field transactions are disabled' using errcode='55000'; end if;
  if p_lead is not null then
    perform 1 from public.commercial_leads where lead_id=p_lead for update;
    perform 1 from public.field_sales_opportunities where lead_id=p_lead and (r='ADMIN' or owner_user_id=p_actor) for share;
    if not found then raise exception 'Record not found or not assigned' using errcode='P0002'; end if;
  end if;
  return r;
end $$;
create function public.field_sales_transaction_read(p_actor uuid,p_lead uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text;
begin
  r:=public.field_sales_transaction_access(p_actor,p_lead);
  return jsonb_build_object(
    'catalogs',(select coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('digest',encode(sha256(convert_to(c.definition::text,'UTF8')),'hex'))),'[]')
      from public.field_sales_catalogs c where (c.status='draft' or public.field_sales_configuration_usable(c.status,'published'))),
    'policyReady',exists(select 1 from public.field_sales_transaction_settings s join public.field_sales_agreement_policies p on p.policy_id=s.agreement_policy_id where public.field_sales_configuration_usable(p.status,'approved')),
    'depositConfigured',(select deposit_policy is not null from public.field_sales_transaction_settings),
    'quotes',(select coalesce(jsonb_agg(x),'[]') from (select q.* from public.field_sales_quotes q
      join public.field_sales_opportunities o using(lead_id) where (p_lead is null or q.lead_id=p_lead) and (r='ADMIN' or o.owner_user_id=p_actor)
      order by q.created_at desc,q.revision desc limit 100) x),
    'agreements',(select coalesce(jsonb_agg(to_jsonb(a)-'token_hash'),'[]') from public.field_sales_agreements a
      join public.field_sales_opportunities o using(lead_id) where (p_lead is null or a.lead_id=p_lead) and (r='ADMIN' or o.owner_user_id=p_actor)),
    'payments',(select coalesce(jsonb_agg(to_jsonb(c)-'checkout_url'),'[]') from public.field_sales_checkouts c
      join public.field_sales_opportunities o using(lead_id) where (p_lead is null or c.lead_id=p_lead) and (r='ADMIN' or o.owner_user_id=p_actor)),
    'orders',(select coalesce(jsonb_agg(to_jsonb(f)||jsonb_build_object('order_reference',h.order_id,'status',h.status,'total',h.total,'payment',h.metadata_json->'field_sales')),'[]')
      from public.field_sales_orders f join public.h2s_orders h on h.id=f.order_id join public.field_sales_opportunities o on o.lead_id=f.lead_id
      where (p_lead is null or f.lead_id=p_lead) and (r='ADMIN' or o.owner_user_id=p_actor)));
end $$;
create function public.field_sales_transaction_command(p_actor uuid,p_operation uuid,p_lead uuid,p_action text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text; cmd public.field_sales_commands; q public.field_sales_quotes; parent public.field_sales_quotes;
  c public.field_sales_catalogs; o public.field_sales_opportunities; l public.commercial_leads;
  a public.field_sales_agreements; policy public.field_sales_agreement_policies; deposit jsonb; deposit_cents bigint;
  pay public.field_sales_checkouts; settings public.field_sales_transaction_settings;
  snap jsonb; rev integer; qr integer; amount bigint; net bigint; result_id uuid; state text; identity jsonb;
begin
  r:=public.field_sales_transaction_access(p_actor,p_lead);
  perform pg_advisory_xact_lock(hashtextextended('field-sales-command:'||p_operation,0));
  select * into cmd from public.field_sales_commands where operation_id=p_operation;
  if found then
    if cmd.actor_id<>p_actor or cmd.lead_id<>p_lead or cmd.action<>'commerce.'||p_action or cmd.payload<>p_payload then
      raise exception 'Operation key reused with changed input' using errcode='40001'; end if;
    return jsonb_build_object('id',p_operation,'replayed',true);
  end if;
  select * into o from public.field_sales_opportunities where lead_id=p_lead;
  select * into l from public.commercial_leads where lead_id=p_lead;
  if o.status='closed' then raise exception 'Closed opportunity requires management review' using errcode='42501'; end if;
  if p_action in ('quote','submit','approve','reject') then
    if exists(select 1 from public.field_sales_agreements where lead_id=p_lead and accepted_at is not null) then
      raise exception 'Accepted contract requires a separately approved amendment or cancellation' using errcode='40001'; end if;
    if p_action='quote' then
      select * into c from public.field_sales_catalogs where catalog_id=(p_payload->>'catalogId')::uuid for share;
      if not found or not (c.status='draft' or public.field_sales_configuration_usable(c.status,'published')) or encode(sha256(convert_to(c.definition::text,'UTF8')),'hex')<>p_payload->>'catalogHash'
        or o.revision<>(p_payload->>'opportunityRevision')::integer then
        raise exception 'Catalog or assessment changed; reload' using errcode='40001'; end if;
      snap:=p_payload->'snapshot'; state:='draft';
      if jsonb_typeof(snap->'lines') is distinct from 'array' or jsonb_array_length(snap->'lines')<1 then
        raise exception 'Calculated quote lines required' using errcode='22023'; end if;
      snap:=snap||jsonb_build_object('customer',jsonb_build_object('name',l.full_name,'phone',l.phone,'address',l.project_address,
        'city',l.project_city,'state',l.project_state,'postalCode',l.project_postal_code,'market',coalesce(l.attribution->>'market','commercial')));
    else
      select * into parent from public.field_sales_quotes where quote_id=(p_payload->>'quoteId')::uuid and lead_id=p_lead;
      if not found or parent.revision<>(select max(revision) from public.field_sales_quotes where lead_id=p_lead)
        or parent.opportunity_revision<>o.revision then raise exception 'Quote or assessment changed; create/review latest revision' using errcode='40001'; end if;
      select * into c from public.field_sales_catalogs where catalog_id=parent.catalog_id for share;
      if encode(sha256(convert_to(c.definition::text,'UTF8')),'hex')<>parent.catalog_hash then raise exception 'Catalog changed; calculate a new quote' using errcode='40001'; end if;
      snap:=parent.snapshot;
      if p_action='submit' then
        if parent.state<>'draft' then raise exception 'Only a draft can be submitted' using errcode='40001'; end if;
        state:=case when public.field_sales_configuration_usable(c.status,'published') and jsonb_array_length(snap->'approvalReasons')=0 and (snap->>'totalCents')::bigint>0 then 'approved' else 'pending_approval' end;
      else
        if r<>'ADMIN' or length(coalesce(p_payload->>'reason',''))<3 then raise exception 'Management approval and reason required' using errcode='42501'; end if;
        if parent.state<>'pending_approval' then raise exception 'Submit exception for review first' using errcode='40001'; end if;
        if p_action='reject' then state:='rejected';
        else
          if not public.field_sales_configuration_usable(c.status,'published') then raise exception 'Only an approved published catalog can authorize payment' using errcode='22023'; end if;
          if p_payload ? 'amountCents' then
            if (p_payload->>'amountCents')::bigint not between 1 and 100000000 then raise exception 'Invalid approved amount' using errcode='22023'; end if;
            snap:=snap||jsonb_build_object('totalCents',(p_payload->>'amountCents')::bigint,'managementAdjustmentCents',
              (p_payload->>'amountCents')::bigint-coalesce((snap->>'totalCents')::bigint,0));
          end if;
          if coalesce((snap->>'totalCents')::bigint,0)<1 or length(coalesce(p_payload->>'scopeConfirmation',''))<3 then
            raise exception 'Final price and scope confirmation required' using errcode='22023'; end if;
          state:='approved';
        end if;
        snap:=snap||jsonb_build_object('managementReview',jsonb_build_object('actorId',p_actor,'reason',p_payload->>'reason',
          'scopeConfirmation',p_payload->>'scopeConfirmation','decision',state));
      end if;
    end if;
    if state='approved' and ((c.definition->>'validForMinutes')::integer not between 1 and 43200
      or (c.status<>'staging_only' and (c.approved_by is null or c.published_at is null))
      or not public.field_sales_configuration_usable(c.status,'published')) then raise exception 'Approved catalog validity is required' using errcode='22023'; end if;
    snap:=snap||jsonb_build_object('pricingStatus',case when c.status='staging_only' then 'staging_only'
      when c.status='published' then 'published' else 'unpublished_not_payable' end,
      'productionApproved',c.status='published','stagingOnly',c.status='staging_only');
    select coalesce(max(revision),0)+1 into rev from public.field_sales_quotes where lead_id=p_lead;
    insert into public.field_sales_quotes(quote_id,lead_id,revision,parent_quote_id,catalog_id,catalog_hash,opportunity_revision,snapshot,quote_hash,state,created_by,attributed_user_id,expires_at)
      values(p_operation,p_lead,rev,parent.quote_id,c.catalog_id,encode(sha256(convert_to(c.definition::text,'UTF8')),'hex'),o.revision,snap,
        encode(sha256(convert_to(snap::text,'UTF8')),'hex'),state,p_actor,o.owner_user_id,
        case when state='approved' then now()+make_interval(mins=>(c.definition->>'validForMinutes')::integer) else null end);
  elsif p_action='agreement' then
    select * into q from public.field_sales_quotes where quote_id=(p_payload->>'quoteId')::uuid and lead_id=p_lead;
    if not found or q.state<>'approved' or q.expires_at<=now() or q.opportunity_revision<>o.revision
      or q.revision<>(select max(revision) from public.field_sales_quotes where lead_id=p_lead) then
      raise exception 'Current approved unexpired quote required' using errcode='40001'; end if;
    select p.* into policy from public.field_sales_transaction_settings s join public.field_sales_agreement_policies p
      on p.policy_id=s.agreement_policy_id where public.field_sales_configuration_usable(p.status,'approved') for share of p;
    if not found then raise exception 'Agreement, cancellation and electronic delivery approval is missing' using errcode='55000'; end if;
    select deposit_policy into deposit from public.field_sales_transaction_settings;
    if deposit is not null then
      if deposit->>'agreementPolicyId' is distinct from policy.policy_id::text
        or coalesce(length(deposit->>'approvalEvidence'),0)<3 or coalesce(length(deposit->>'approvedAt'),0)=0
        or not exists(select 1 from public."Dashboard_Users" where "User_ID"::text=deposit->>'approvedBy' and "Role"='ADMIN') then
        raise exception 'Deposit policy requires explicit approval tied to this agreement version' using errcode='55000'; end if;
      if not isfinite((deposit->>'approvedAt')::timestamptz) then raise exception 'Deposit approval date is invalid' using errcode='22023'; end if;
      if deposit->>'mode'='fixed' then deposit_cents:=(deposit->>'amountCents')::bigint;
      elsif deposit->>'mode'='basis_points' and (deposit->>'basisPoints')::integer between 1 and 9999 then
        deposit_cents:=ceil((q.snapshot->>'totalCents')::bigint*(deposit->>'basisPoints')::numeric/10000);
      else raise exception 'Approved deposit calculation is invalid' using errcode='22023'; end if;
      if deposit_cents is null or deposit_cents<=0 or deposit_cents>=(q.snapshot->>'totalCents')::bigint then
        raise exception 'Deposit does not fit this quote; payment terms require management review' using errcode='22023'; end if;
    end if;
    if coalesce(p_payload->>'tokenHash','') !~ '^[a-f0-9]{64}$' then raise exception 'Secure customer handoff required' using errcode='22023'; end if;
    insert into public.field_sales_agreements(agreement_id,quote_id,lead_id,quote_hash,policy_id,policy_snapshot,token_hash,expires_at,prepared_by)
      values(p_operation,q.quote_id,p_lead,q.quote_hash,policy.policy_id,to_jsonb(policy)||jsonb_build_object('depositPolicy',deposit,
        'paymentPlan',jsonb_build_object('fullCents',(q.snapshot->>'totalCents')::bigint,'depositCents',deposit_cents,
          'remainingAfterDepositCents',(q.snapshot->>'totalCents')::bigint-deposit_cents)),p_payload->>'tokenHash',q.expires_at,p_actor);
  else raise exception 'Unsupported transaction action' using errcode='22023';
  end if;
  insert into public.field_sales_commands(operation_id,actor_id,lead_id,action,payload) values(p_operation,p_actor,p_lead,'commerce.'||p_action,p_payload);
  insert into public.commercial_lead_operations(lead_id) values(p_lead) on conflict do nothing;
  update public.commercial_lead_operations set revision=revision+1,updated_at=now() where lead_id=p_lead returning revision into qr;
  insert into public.commercial_lead_activity(operation_id,lead_id,revision,actor_id,actor_name,action,payload)
    select p_operation,p_lead,qr,p_actor::text,"Display_Name",'field_sales.commerce.'||p_action,
      (p_payload-'tokenHash'-'snapshot')||jsonb_build_object('recordId',p_operation) from public."Dashboard_Users" where "User_ID"=p_actor;
  return jsonb_build_object('id',p_operation,'replayed',false);
end $$;
create function public.field_sales_customer_agreement(p_token_hash text,p_accept jsonb default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.field_sales_agreements; q public.field_sales_quotes; o public.field_sales_opportunities; qr integer;
begin
  if not exists(select 1 from public.field_sales_transaction_settings where enabled) then raise exception 'Field transactions disabled' using errcode='55000'; end if;
  select * into a from public.field_sales_agreements where token_hash=p_token_hash;
  if not found or a.expires_at<=now() then raise exception 'Agreement link unavailable or expired' using errcode='P0002'; end if;
  perform 1 from public.commercial_leads where lead_id=a.lead_id for update;
  select * into a from public.field_sales_agreements where agreement_id=a.agreement_id for update;
  select * into q from public.field_sales_quotes where quote_id=a.quote_id;
  if (a.policy_snapshot->>'stagingOnly'='true' or q.snapshot->>'stagingOnly'='true')
    and not public.field_sales_native_staging_scope() then
    raise exception 'Staging agreement requires its verified native test run' using errcode='42501'; end if;
  select * into o from public.field_sales_opportunities where lead_id=a.lead_id;
  if q.state<>'approved' or q.quote_hash<>a.quote_hash or q.expires_at<=now() or o.revision<>q.opportunity_revision or o.status='closed'
    or q.revision<>(select max(revision) from public.field_sales_quotes where lead_id=a.lead_id) then
    raise exception 'Quote changed or unavailable; management review required' using errcode='40001'; end if;
  if p_accept is not null then
    if p_accept->>'quoteHash' is distinct from a.quote_hash or p_accept->>'policyVersion' is distinct from a.policy_snapshot->>'version'
      or p_accept->>'accepted' is distinct from 'true' or p_accept->>'electronicDelivery' is distinct from 'true'
      or length(coalesce(p_accept->>'name','')) not between 1 and 120
      or coalesce(p_accept->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Exact quote, approved terms and customer acceptance required' using errcode='22023'; end if;
    if a.accepted_at is not null then
      if a.acceptance-'operationId'<>p_accept-'operationId' then raise exception 'Acceptance already recorded with different evidence' using errcode='40001'; end if;
    else
      update public.field_sales_agreements set accepted_at=now(),acceptance=p_accept where agreement_id=a.agreement_id returning * into a;
      insert into public.commercial_lead_operations(lead_id) values(a.lead_id) on conflict do nothing;
      update public.commercial_lead_operations set revision=revision+1,updated_at=now() where lead_id=a.lead_id returning revision into qr;
      insert into public.commercial_lead_activity(operation_id,lead_id,revision,actor_id,actor_name,action,payload)
        values((p_accept->>'operationId')::uuid,a.lead_id,qr,'customer-handoff',p_accept->>'name','field_sales.agreement.accepted',
          jsonb_build_object('agreementId',a.agreement_id,'quoteId',q.quote_id,'quoteHash',q.quote_hash,'policyVersion',a.policy_snapshot->>'version'));
    end if;
  end if;
  return jsonb_build_object('agreement',jsonb_build_object('agreement_id',a.agreement_id,'accepted_at',a.accepted_at,
    'acceptance',a.acceptance,'policy_snapshot',jsonb_build_object('version',a.policy_snapshot->'version',
      'terms',a.policy_snapshot->'terms','cancellation_information',a.policy_snapshot->'cancellation_information',
      'electronic_delivery',a.policy_snapshot->'electronic_delivery','payment_terms',a.policy_snapshot->'payment_terms',
      'paymentPlan',a.policy_snapshot->'paymentPlan')),'quote',
    jsonb_build_object('quote_id',q.quote_id,'quote_hash',q.quote_hash,'revision',q.revision,
      'snapshot',(q.snapshot-'managementReview')||case when q.snapshot ? 'managementReview'
        then jsonb_build_object('managementReview',(q.snapshot->'managementReview')-'actorId') else '{}'::jsonb end,'expires_at',q.expires_at));
end $$;
create function public.field_sales_reserve_checkout(p_actor uuid,p_operation uuid,p_lead uuid,p_quote uuid,p_kind text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text; q public.field_sales_quotes; a public.field_sales_agreements; pay public.field_sales_checkouts; policy jsonb; total bigint; net bigint; amount bigint; o public.field_sales_opportunities;
begin
  r:=public.field_sales_transaction_access(p_actor,p_lead);
  select * into q from public.field_sales_quotes where quote_id=p_quote and lead_id=p_lead;
  select * into a from public.field_sales_agreements where quote_id=p_quote;
  select * into o from public.field_sales_opportunities where lead_id=p_lead;
  if q.quote_id is null or a.accepted_at is null or q.state<>'approved' or a.quote_hash<>q.quote_hash or q.expires_at<=now()
    or q.opportunity_revision<>o.revision or o.status='closed'
    or q.revision<>(select max(revision) from public.field_sales_quotes where lead_id=p_lead) then
    raise exception 'Current accepted agreement and approved unexpired quote required' using errcode='40001'; end if;
  select * into pay from public.field_sales_checkouts where checkout_id=p_operation;
  if found then
    if pay.quote_id<>p_quote or pay.kind<>p_kind or pay.created_by<>p_actor then raise exception 'Checkout key reused' using errcode='40001'; end if;
    return to_jsonb(pay);
  end if;
  if q.expires_at<now()+interval '31 minutes' then raise exception 'Quote validity must cover the Stripe checkout window; management review required' using errcode='40001'; end if;
  select * into pay from public.field_sales_checkouts where quote_id=p_quote and state in ('creating','open','pending','failed');
  if found then
    if pay.kind<>p_kind then raise exception 'An existing payment attempt must be reconciled first' using errcode='40001'; end if;
    return to_jsonb(pay);
  end if;
  if exists(select 1 from public.field_sales_checkouts where quote_id=p_quote and (refunded_cents>0 or disputed or state='payment_exception')) then
    raise exception 'Refund or payment exception requires management review, not automatic recollection' using errcode='40001'; end if;
  total:=(q.snapshot->>'totalCents')::bigint;
  select coalesce(sum(captured_cents-refunded_cents),0) into net from public.field_sales_checkouts where quote_id=p_quote;
  if net>=total then raise exception 'Quote already fully collected' using errcode='40001'; end if;
  if p_kind='full' and net=0 then amount:=total; policy:=jsonb_build_object('mode','full','agreementPolicy',a.policy_id);
  elsif p_kind='balance' and net>0 then amount:=total-net; policy:=jsonb_build_object('mode','balance','agreementPolicy',a.policy_id);
  elsif p_kind='deposit' and net=0 then
    policy:=a.policy_snapshot->'depositPolicy';
    if policy='null'::jsonb then policy:=null; end if;
    if policy is null then raise exception 'Deposit policy has not been approved' using errcode='55000'; end if;
    if policy->>'mode'='fixed' then amount:=(policy->>'amountCents')::bigint;
    elsif policy->>'mode'='basis_points' then amount:=ceil(total*(policy->>'basisPoints')::numeric/10000);
    else raise exception 'Approved deposit policy is invalid' using errcode='22023'; end if;
    if amount is null or amount<=0 or amount>=total then raise exception 'Deposit must be a positive approved partial amount' using errcode='22023'; end if;
  else raise exception 'Select an eligible payment workflow' using errcode='22023'; end if;
  insert into public.field_sales_checkouts(checkout_id,quote_id,agreement_id,lead_id,kind,amount_cents,policy_snapshot,created_by,expires_at)
    values(p_operation,p_quote,a.agreement_id,p_lead,p_kind,amount,policy,p_actor,least(q.expires_at,now()+interval '1 hour')) returning * into pay;
  return to_jsonb(pay);
end $$;
create function public.field_sales_record_receipt(p_checkout uuid,p_event text,p_receipt jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare pay public.field_sales_checkouts; q public.field_sales_quotes; a public.field_sales_agreements;
  net bigint; captured bigint; refunded bigint; total bigint; status text; order_ref text; linked public.field_sales_orders; metadata jsonb; qr integer;
begin
  perform 1 from public.field_sales_transaction_settings where enabled for share;
  if not found then raise exception 'Payment reconciliation is disabled; event retained for retry' using errcode='55000'; end if;
  select * into pay from public.field_sales_checkouts where checkout_id=p_checkout;
  if not found then raise exception 'Reserved checkout missing; reconciliation required' using errcode='P0002'; end if;
  perform 1 from public.commercial_leads where lead_id=pay.lead_id for update;
  select * into pay from public.field_sales_checkouts where checkout_id=p_checkout for update;
  select * into q from public.field_sales_quotes where quote_id=pay.quote_id;
  select * into a from public.field_sales_agreements where agreement_id=pay.agreement_id;
  if a.accepted_at is null or q.quote_hash<>a.quote_hash or q.state<>'approved'
    or p_receipt->>'livemode' is distinct from 'false' or p_receipt->>'quoteId' is distinct from q.quote_id::text
    or p_receipt->>'agreementId' is distinct from a.agreement_id::text or p_receipt->>'leadId' is distinct from pay.lead_id::text
    or p_receipt->>'quoteHash' is distinct from q.quote_hash or (p_receipt->>'amountCents')::bigint<>pay.amount_cents
    or p_receipt->>'currency' is distinct from 'usd' or length(coalesce(p_receipt->>'sessionId',''))<4
    or (pay.session_id is not null and pay.session_id<>p_receipt->>'sessionId') then
    raise exception 'Verified Stripe receipt does not match the reserved contract' using errcode='22023'; end if;
  captured:=(p_receipt->>'capturedCents')::bigint; refunded:=(p_receipt->>'refundedCents')::bigint;
  if captured is null or refunded is null or captured not between 0 and pay.amount_cents or refunded not between 0 and captured
    or (captured>0 and length(coalesce(p_receipt->>'paymentIntentId',''))<4)
    or p_receipt->>'state' not in ('open','pending','failed','expired','paid','payment_exception') then
    raise exception 'Invalid verified payment facts' using errcode='22023'; end if;
  update public.field_sales_checkouts set session_id=p_receipt->>'sessionId',
    checkout_url=coalesce(p_receipt->>'checkoutUrl',checkout_url),payment_intent_id=coalesce(p_receipt->>'paymentIntentId',payment_intent_id),
    provider_state=coalesce(p_receipt->>'paymentIntentStatus',p_receipt->>'sessionStatus'),
    captured_cents=greatest(captured_cents,captured),refunded_cents=greatest(refunded_cents,refunded),
    disputed=disputed or coalesce((p_receipt->>'disputed')::boolean,false),last_checked_at=now()
    where checkout_id=p_checkout returning * into pay;
  update public.field_sales_checkouts set state=case when pay.disputed then 'payment_exception'
    when pay.refunded_cents=pay.amount_cents then 'refunded' when pay.refunded_cents>0 then 'partially_refunded'
    when pay.captured_cents=pay.amount_cents then 'paid' else p_receipt->>'state' end where checkout_id=p_checkout returning * into pay;
  insert into public.field_sales_payment_events(event_id,checkout_id,receipt) values(p_event,p_checkout,p_receipt) on conflict(event_id) do nothing;
  if exists(select 1 from public.field_sales_payment_events where event_id=p_event and checkout_id<>p_checkout) then
    raise exception 'Provider event identity conflict' using errcode='40001'; end if;
  select coalesce(sum(captured_cents),0),coalesce(sum(refunded_cents),0) into captured,refunded from public.field_sales_checkouts where quote_id=q.quote_id;
  net:=captured-refunded; total:=(q.snapshot->>'totalCents')::bigint;
  if captured>total then raise exception 'Overcollection requires reconciliation' using errcode='40001'; end if;
  status:=case when exists(select 1 from public.field_sales_checkouts where quote_id=q.quote_id and disputed) then 'payment_exception'
    when refunded>0 then case when net=0 then 'refunded' else 'partially_refunded' end
    when net=total then 'paid' when net>0 then 'deposit_collected' else pay.state end;
  metadata:=jsonb_build_object('quoteId',q.quote_id,'quoteHash',q.quote_hash,'agreementId',a.agreement_id,'leadId',q.lead_id,
    'attributedUserId',q.attributed_user_id,'capturedCents',captured,'refundedCents',refunded,'netCollectedCents',net,
    'remainingCents',greatest(total-net,0),'paymentStatus',status,'fulfillment','management_review','mode','test');
  if captured>0 then
    select * into linked from public.field_sales_orders where quote_id=q.quote_id;
    if not found then
      order_ref:='FS-'||q.order_uuid;
      insert into public.h2s_orders(id,order_id,subtotal,total,currency,status,session_id,payment_intent_id,items,customer_name,customer_email,customer_phone,address,city,state,zip,metadata_json)
        values(q.order_uuid,order_ref,total::numeric/100,total::numeric/100,'usd','field_sales_management_review',pay.session_id,pay.payment_intent_id,
          (q.snapshot->'lines')::text,q.snapshot#>>'{customer,name}',a.acceptance->>'email',q.snapshot#>>'{customer,phone}',
          q.snapshot#>>'{customer,address}',q.snapshot#>>'{customer,city}',q.snapshot#>>'{customer,state}',q.snapshot#>>'{customer,postalCode}',
          jsonb_build_object('h2s_flow','field_sales_v1','field_sales',metadata));
      insert into public.field_sales_orders(quote_id,lead_id,order_id) values(q.quote_id,q.lead_id,q.order_uuid);
    else
      update public.h2s_orders set metadata_json=jsonb_set(coalesce(metadata_json,'{}'),'{field_sales}',metadata,true),
        status='field_sales_management_review' where id=linked.order_id;
    end if;
  end if;
  return jsonb_build_object('payment',to_jsonb(pay)-'checkout_url','summary',metadata,'orderId',case when captured>0 then q.order_uuid else null end);
end $$;
do $$ declare t text; f regprocedure; begin
  foreach t in array array['field_sales_catalogs','field_sales_agreement_policies','field_sales_transaction_settings','field_sales_quotes',
    'field_sales_agreements','field_sales_checkouts','field_sales_payment_events','field_sales_orders'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to service_role',t);
  end loop;
  foreach f in array array['public.field_sales_native_staging_scope()'::regprocedure,'public.field_sales_configuration_usable(text,text)'::regprocedure,
    'public.field_sales_transaction_access(uuid,uuid)'::regprocedure,'public.field_sales_transaction_read(uuid,uuid)'::regprocedure,
    'public.field_sales_transaction_command(uuid,uuid,uuid,text,jsonb)'::regprocedure,'public.field_sales_customer_agreement(text,jsonb)'::regprocedure,
    'public.field_sales_reserve_checkout(uuid,uuid,uuid,uuid,text)'::regprocedure,'public.field_sales_record_receipt(uuid,text,jsonb)'::regprocedure] loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
commit;
