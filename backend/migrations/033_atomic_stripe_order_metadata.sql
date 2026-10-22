-- Review-only. Merge webhook patches against the locked current order, never a client snapshot.
create function public.stripe_patch_order(
  p_order_id text,
  p_metadata jsonb,
  p_checkout jsonb default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  retained jsonb;
  schedule jsonb;
  result jsonb;
begin
  if nullif(btrim(p_order_id),'') is null or p_metadata is null
    or jsonb_typeof(p_metadata)<>'object'
    or (p_checkout is not null and jsonb_typeof(p_checkout)<>'object') then
    raise exception 'Invalid Stripe order patch' using errcode='22023';
  end if;
  if p_checkout is not null and exists (
    select 1 from jsonb_object_keys(p_checkout) k
    where k not in ('payment_intent_id','address','city','state','zip','customer_name','customer_phone')
  ) then
    raise exception 'Unsupported checkout field' using errcode='22023';
  end if;

  select metadata_json into retained from public.h2s_orders where order_id=p_order_id for update;
  if not found then raise exception 'Stripe order not found' using errcode='P0002'; end if;
  retained:=coalesce(retained,'{}'::jsonb);
  if jsonb_typeof(retained)<>'object' then
    raise exception 'Order metadata requires reconciliation' using errcode='22023';
  end if;
  -- Presence, including JSON null, wins: an operationally cleared schedule must stay cleared.
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into schedule
    from jsonb_each(retained)
    where key in ('scheduled_date','scheduled_end','scheduled_tz','time_window',
      'schedule_status','scheduled_at','scheduled_via');
  if p_metadata ? 'job_details' then retained:=retained-'job_details_json'; end if;

  update public.h2s_orders o set
    metadata_json=retained||p_metadata||schedule,
    payment_intent_id=case when p_checkout ? 'payment_intent_id' then p_checkout->>'payment_intent_id' else o.payment_intent_id end,
    status=case when p_checkout is not null then 'paid' else o.status end,
    address=case when p_checkout ? 'address' then p_checkout->>'address' else o.address end,
    city=case when p_checkout ? 'city' then p_checkout->>'city' else o.city end,
    state=case when p_checkout ? 'state' then p_checkout->>'state' else o.state end,
    zip=case when p_checkout ? 'zip' then p_checkout->>'zip' else o.zip end,
    customer_name=case when p_checkout ? 'customer_name' then p_checkout->>'customer_name' else o.customer_name end,
    customer_phone=case when p_checkout ? 'customer_phone' then p_checkout->>'customer_phone' else o.customer_phone end,
    updated_at=clock_timestamp()
    where o.order_id=p_order_id
    returning jsonb_build_object('order_id',o.order_id) into result;
  return result;
end;
$$;
revoke all on function public.stripe_patch_order(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.stripe_patch_order(text,jsonb,jsonb) to service_role;
