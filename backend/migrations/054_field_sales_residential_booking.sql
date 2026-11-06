-- REVIEW ONLY. Native-run compatibility after 053; leave the checksum-pinned 038 source unchanged.
-- Retarget and apply only this incremental migration to an existing verified run.
-- No inquiry, consent, approval, reservation, payment or notification is manufactured here.
-- Also classify the single premature enrolled-balance/full-payment gate as invalid input,
-- without changing any missing-configuration SQLSTATE or any financial eligibility condition.
begin;
do $$ begin
  if not public.field_sales_native_staging_scope() then
    raise exception '054 requires the verified UUID-owned native sandbox' using errcode='42501';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.commercial_reservations'::regclass
    and tgfoid='public.h2s_enqueue_residential_booking()'::regprocedure and not tgisinternal and tgenabled='O') then
    raise exception '054 requires the active residential booking authority from 038' using errcode='55000';
  end if;
end $$;
create or replace function public.h2s_enqueue_residential_booking() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare req public.commercial_consultation_requests; field_booking boolean:=false;
begin
  if not exists(select 1 from public.commercial_leads where lead_id=new.lead_id and attribution->>'market'='residential') then return new; end if;
  select * into req from public.commercial_consultation_requests where lead_id=new.lead_id
    and metadata->>'request_kind'='residential_inquiry' order by created_at desc limit 1;
  -- The workflow creates its exact job links only after legal/payment gates pass.
  -- Recheck the shared scheduling gate for later calendar changes as well.
  if req.request_id is null and new.state='confirmed' and public.field_sales_native_staging_scope() then
    select exists(
      select 1 from public.commercial_leads l
      join public.field_sales_opportunities o on o.lead_id=l.lead_id
      join public.field_sales_opportunities customer on customer.lead_id=o.customer_id and customer.customer_id=customer.lead_id
      join public.field_sales_commands intake on intake.lead_id=o.lead_id and intake.actor_id=o.created_by and intake.action in ('create','repeat')
      join public.field_sales_workflows w on w.lead_id=o.lead_id and w.state in ('enrolled','scheduled')
      join public.field_sales_quotes q on q.quote_id=w.quote_id and q.lead_id=o.lead_id and q.state='approved'
      join public.field_sales_orders sale on sale.quote_id=q.quote_id and sale.lead_id=o.lead_id and sale.order_id=q.order_uuid
      join public.commercial_lead_operations op on op.lead_id=o.lead_id and op.order_id=sale.order_id and op.installation_job_id=w.job_id
      join public.h2s_dispatch_jobs job on job.job_id=w.job_id and job.order_id=sale.order_id::text and job.status in ('queued','assigned')
      where l.lead_id=new.lead_id and l.attribution->>'intake'='field_sales' and o.status<>'closed'
        and exists(select 1 from public.field_sales_settings where enabled)
        and exists(select 1 from public.field_sales_transaction_settings where enabled)
        and (public.field_sales_workflow_gates(w.quote_id)->>'canSchedule')::boolean
    ) into field_booking;
  end if;
  if new.state in ('tentative','confirmed') and ((req.status is distinct from 'approved' and not field_booking)
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
do $balance$
declare src text; old_count integer; new_count integer;
begin
  src:=pg_get_functiondef('public.field_sales_reserve_checkout(uuid,uuid,uuid,uuid,text)'::regprocedure);
  old_count:=(length(src)-length(replace(src,
    $old$raise exception 'Enrolled sales require 25%% first and balance only after installation completion' using errcode='55000';$old$,'')))/
    length($old$raise exception 'Enrolled sales require 25%% first and balance only after installation completion' using errcode='55000';$old$);
  new_count:=(length(src)-length(replace(src,
    $new$raise exception 'Enrolled sales require 25%% first and balance only after installation completion' using errcode='22023';$new$,'')))/
    length($new$raise exception 'Enrolled sales require 25%% first and balance only after installation completion' using errcode='22023';$new$);
  if old_count+new_count<>1 then raise exception '054 enrolled balance gate differs from reviewed source'; end if;
  if old_count=1 then
    src:=replace(src,
      $old$raise exception 'Enrolled sales require 25%% first and balance only after installation completion' using errcode='55000';$old$,
      $new$raise exception 'Enrolled sales require 25%% first and balance only after installation completion' using errcode='22023';$new$);
    execute src;
  end if;
end $balance$;
commit;
